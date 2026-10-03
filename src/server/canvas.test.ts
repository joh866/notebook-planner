import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CanvasSync, DayView, SettingsView, TaskCard } from '../shared/api';
import { createApp } from './app';
import { FeedError, syncCanvas } from './canvas';
import { openDb, type Db } from './db/client';
import { seed } from './db/seed';
import * as t from './db/schema';

// Canvas's calendar feed (spec §14), from a saved sample.

const CHI = 'America/Chicago';
const NOW = DateTime.fromISO('2026-10-02T17:30', { zone: CHI });
const sample = readFileSync(fileURLToPath(new URL('../../tests/fixtures/canvas-feed.ics', import.meta.url)), 'utf8');
const LINK = 'https://canvas.example.edu/feeds/calendars/user_secret123.ics';

let db: Db;
let app: ReturnType<typeof createApp>;
let feed: string | Error;
let fetched: string[];

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  feed = sample;
  fetched = [];
  const fetchFeed = async (url: string) => {
    fetched.push(url);
    if (feed instanceof Error) throw feed;
    return feed;
  };
  app = createApp({ db, now: () => NOW, fetchFeed });
});

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
const sync = () => call<{ item: CanvasSync; undo: string | null }>('POST', '/api/canvas/sync').then((r) => r.body);
const canvasTasks = () => db.select().from(t.tasks).all().filter((x) => db.select().from(t.feedItems).all().some((f) => f.taskId === x.id));
const cards = async () => {
  const d = (await call<DayView>('GET', `/api/day?tz=${CHI}`)).body;
  return [...d.groups.overdue, ...d.groups.near, ...d.groups.week, ...d.groups.soon] as TaskCard[];
};

describe('the Canvas feed', () => {
  beforeEach(async () => {
    await call('PATCH', '/api/settings', { canvasFeedUrl: LINK });
  });

  it('makes tasks with deadlines in Classes from upcoming assignments, marked From Canvas', async () => {
    const r = await sync();
    expect(fetched).toEqual([LINK]);
    // The syllabus quiz was due before now, so it isn't added.
    expect(r.item).toEqual({ added: 4, updated: 0, seen: 5, error: null });
    expect(canvasTasks().map((x) => [x.title, x.meta, x.categoryId, x.dueAt, x.dueDate])).toEqual([
      ['Problem Set 1', 'MATH 15910', 'class', '2026-10-07T16:00:00Z', null],
      ['Reading response 1', 'SOSC 16100', 'class', null, '2026-10-09'],
      ['Problem Set 2: supply, demand, and elasticities', 'ECON 20010', 'class', '2026-10-13T04:59:00Z', null],
      ['Lab report 1', 'CHEM 11100', 'class', '2026-10-20T04:59:00Z', null],
    ]);
    const card = (await cards()).find((c) => c.title === 'Problem Set 1' && c.fromCanvas);
    expect(card).toMatchObject({ fromCanvas: true, effectiveWindow: 'week' });
    expect((await call<SettingsView>('GET', '/api/settings')).body).toMatchObject({ canvasNote: '5 assignments, 4 new', canvasSyncedAt: '2026-10-02T22:30:00Z' });
  });

  it('updates instead of duplicating when fetched again', async () => {
    await sync();
    feed = sample.replace('DTSTART:20261007T160000Z', 'DTSTART:20261008T160000Z');
    const again = await sync();
    expect(again.item).toMatchObject({ added: 0, updated: 1, seen: 5 });
    expect(canvasTasks()).toHaveLength(4);
    expect(canvasTasks().find((x) => x.title === 'Problem Set 1')?.dueAt).toBe('2026-10-08T16:00:00Z');
  });

  it('never overwrites what the user changed, and doesn’t bring back what they deleted', async () => {
    await sync();
    const pset = canvasTasks().find((x) => x.title === 'Problem Set 1')!;
    const reading = canvasTasks().find((x) => x.title === 'Reading response 1')!;
    await call('PATCH', `/api/tasks/${pset.id}`, { title: 'Math PSet 1 (the real one)', dueAt: '2026-10-07T17:00:00Z' });
    await call('DELETE', `/api/tasks/${reading.id}`);

    feed = sample.replace('Problem Set 1 [', 'Problem Set 1 (updated) [').replace('DTSTART:20261007T160000Z', 'DTSTART:20261009T160000Z');
    const again = await sync();
    expect(again.item).toMatchObject({ added: 0, updated: 0 });
    expect(db.select().from(t.tasks).all().find((x) => x.id === pset.id)).toMatchObject({ title: 'Math PSet 1 (the real one)', dueAt: '2026-10-07T17:00:00Z' });
    expect(canvasTasks().some((x) => x.title === 'Reading response 1')).toBe(false);
    expect(canvasTasks()).toHaveLength(3);
  });

  it('updates the fields the user left alone, even when they changed others', async () => {
    await sync();
    const pset = canvasTasks().find((x) => x.title === 'Problem Set 1')!;
    await call('PATCH', `/api/tasks/${pset.id}`, { title: 'Math PSet 1' });
    feed = sample.replace('DTSTART:20261007T160000Z', 'DTSTART:20261008T160000Z');
    await sync();
    expect(db.select().from(t.tasks).all().find((x) => x.id === pset.id)).toMatchObject({ title: 'Math PSet 1', dueAt: '2026-10-08T16:00:00Z' });
  });

  it('Check now has one Undo', async () => {
    const r = await sync();
    await call('POST', `/api/undo/${r.undo}`);
    expect(canvasTasks()).toEqual([]);
    expect(db.select().from(t.feedItems).all()).toEqual([]);
  });

  it('notes why a check failed, without the link', async () => {
    feed = new FeedError('Canvas answered 404');
    expect((await sync()).item).toMatchObject({ error: 'Canvas answered 404', added: 0 });
    const s = (await call<SettingsView>('GET', '/api/settings')).body;
    expect(s.canvasNote).toBe('Couldn’t check: Canvas answered 404');
    expect(s.canvasNote).not.toContain('secret123');
  });
});

describe('without a link', () => {
  it('does nothing', async () => {
    expect(await syncCanvas(db, NOW, async () => sample)).toBeNull();
    expect((await sync()).item.error).toBe('there’s no Canvas link saved');
    expect(fetched).toEqual([]);
  });
});
