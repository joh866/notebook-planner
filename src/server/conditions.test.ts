import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BlockItem, DayView } from '../shared/api';
import type { ParsedItem } from '../shared/parsed';
import { createApp } from './app';
import { openDb, type Db } from './db/client';
import { seed } from './db/seed';
import * as t from './db/schema';

// Conditions (spec §10): "if" questions and "after" items, on tasks and events.

const CHI = 'America/Chicago';
/** Saturday, October 3, 2026 at 2pm. */
const NOW = DateTime.fromISO('2026-10-03T14:00', { zone: CHI });

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: DateTime;
let reply: Partial<ParsedItem>[];

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  clock = NOW;
  reply = [];
  app = createApp({ db, now: () => clock, sort: async () => reply });
});

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
const day = async (date = '2026-10-03') => (await call<DayView>('GET', `/api/day/${date}?tz=${CHI}`)).body;
const blocks = (d: DayView) => d.schedule.filter((x): x is BlockItem => x.type === 'block');
const card = (d: DayView, id: string) => [...d.groups.near, ...d.groups.week, ...d.groups.soon].find((x) => x.id === id);

describe('look C on cards', () => {
  it('shows "after" until the prerequisite is done', async () => {
    expect(card(await day(), 'muqaddimah')?.condition).toMatchObject({ kind: 'after', taskId: 'get-book', text: 'after Get The Muqaddimah' });
    await call('PATCH', '/api/tasks/get-book', { doneAt: '2026-10-03T18:00:00Z' });
    expect(card(await day(), 'muqaddimah')?.condition).toBeNull();
    expect(card(await day(), 'response')?.condition).toMatchObject({ kind: 'after', taskId: 'muqaddimah' });
  });

  it('drops the link when the prerequisite is deleted, and Undo brings it back', async () => {
    const del = await call<{ undo: string }>('DELETE', '/api/tasks/get-book');
    expect(del.status).toBe(200);
    expect(card(await day(), 'muqaddimah')?.condition).toBeNull();
    await call('POST', `/api/undo/${del.body.undo}`);
    expect(card(await day(), 'muqaddimah')?.condition).toMatchObject({ kind: 'after', taskId: 'get-book' });
  });
});

describe('a timed "if" item', () => {
  async function placeGym(startMin: number) {
    await call('POST', `/api/drops?tz=${CHI}`, { action: 'placeTask', taskId: 'gym', date: '2026-10-03', startMin });
    return blocks(await day()).find((b) => b.taskId === 'gym')!;
  }

  it('sits at its time in look C, and asks "Still on?" once its time comes', async () => {
    const gym = await placeGym(16 * 60);
    expect(gym).toMatchObject({ condition: { kind: 'if', conditionId: 'cold' }, askNow: false });
    clock = DateTime.fromISO('2026-10-03T16:05', { zone: CHI });
    expect(blocks(await day()).find((b) => b.taskId === 'gym')).toMatchObject({ askNow: true });
  });

  it('Yes makes it a normal item; the question stays while something else waits on it', async () => {
    await placeGym(16 * 60);
    const yes = await call<{ item: { removed: boolean } }>('POST', '/api/tasks/gym/still-on', { yes: true });
    expect(yes.body.item).toEqual({ removed: false });
    const d = await day();
    expect(blocks(d).find((b) => b.taskId === 'gym')).toMatchObject({ condition: null, askNow: false });
    // Boxing club still waits on "Is the cold fully gone?".
    expect(d.checkIns.map((c) => c.conditionId)).toContain('cold');
    await call('POST', '/api/tasks/boxing/still-on', { yes: true });
    expect((await day()).checkIns.map((c) => c.conditionId)).not.toContain('cold');
  });

  it('No removes it, with Undo', async () => {
    await placeGym(16 * 60);
    const no = await call<{ item: { removed: boolean }; undo: string }>('POST', '/api/tasks/gym/still-on', { yes: false });
    expect(no.body.item).toEqual({ removed: true });
    expect(db.select().from(t.tasks).all().some((x) => x.id === 'gym')).toBe(false);
    await call('POST', `/api/undo/${no.body.undo}`);
    expect(blocks(await day()).find((b) => b.taskId === 'gym')).toMatchObject({ condition: { kind: 'if' } });
  });

  it('works on an event too', async () => {
    const { body } = await call<{ item: { id: string } }>('POST', '/api/blocks', {
      kind: 'event', title: 'Go club', startAt: '2026-10-03T18:45:00Z', durationMinutes: 45, conditionId: 'arch',
    });
    expect(blocks(await day()).find((b) => b.id === body.item.id)).toMatchObject({ condition: { kind: 'if' }, askNow: true });
    await call('POST', `/api/blocks/${body.item.id}/still-on`, { yes: false });
    expect(blocks(await day()).find((b) => b.id === body.item.id)).toBeUndefined();
  });
});

describe('the add box', () => {
  it('reads "if" and "after", reusing an open question and linking to an item in the same text', async () => {
    reply = [
      { type: 'event', title: 'MTG event', date: '2026-10-03', start: '15:15', tentative: true, loc: 'Crerar Library' },
      { type: 'event', title: 'Stop by Go club', date: '2026-10-03', start: '16:15', end: '16:45', if: "if it's open", ask: 'Is the Go club open?', after: 'MTG event' },
      { type: 'task', title: 'Try climbing', win: 'week', if: 'once the cold is fully gone', ask: 'Is the cold fully gone?' },
      { type: 'task', title: 'Read chapter 3', win: 'week', after: 'get the muqaddimah' },
    ];
    const { body } = await call<{ undo: string }>('POST', `/api/add?tz=${CHI}`, { text: 'plans' });
    const d = await day();
    const goClub = blocks(d).find((b) => b.title === 'Stop by Go club')!;
    const mtg = blocks(d).find((b) => b.title === 'MTG event')!;
    expect(goClub.condition).toMatchObject({ kind: 'if', text: "if it's open", question: 'Is the Go club open?' });
    expect(db.select().from(t.blocks).all().find((b) => b.id === goClub.id)?.afterBlockId).toBe(mtg.id);
    const tasks = db.select().from(t.tasks).all();
    expect(tasks.find((x) => x.title === 'Try climbing')).toMatchObject({ conditionId: 'cold', window: 'week' });
    expect(tasks.find((x) => x.title === 'Read chapter 3')).toMatchObject({ afterTaskId: 'get-book' });
    expect(d.checkIns.map((c) => c.question)).toContain('Is the Go club open?');

    // One Undo takes it all back, links included.
    await call('POST', `/api/undo/${body.undo}`);
    expect(db.select().from(t.tasks).all().some((x) => x.title === 'Read chapter 3')).toBe(false);
    expect(db.select().from(t.blocks).all().some((b) => b.title === 'Stop by Go club')).toBe(false);
  });
});

describe('the Plan button', () => {
  it('never plans an unanswered "if" task, and plans it once answered', async () => {
    await call('PATCH', '/api/tasks/gym', { window: 'near' });
    const before = await call<{ item: { placed: { taskId: string }[] } }>('POST', `/api/plan?tz=${CHI}`, { date: '2026-10-04' });
    expect(before.body.item.placed.map((p) => p.taskId)).not.toContain('gym');
    await call('POST', `/api/undo/${(before.body as unknown as { undo: string }).undo}`);
    await call('POST', '/api/conditions/cold/answer');
    const after = await call<{ item: { placed: { taskId: string }[] } }>('POST', `/api/plan?tz=${CHI}`, { date: '2026-10-04' });
    expect(after.body.item.placed.map((p) => p.taskId)).toContain('gym');
  });
});
