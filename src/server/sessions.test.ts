import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BlockItem, DayView, LogResult, TimeLogEntry } from '../shared/api';
import { createApp } from './app';
import { openDb, type Db } from './db/client';
import { seed } from './db/seed';
import * as t from './db/schema';

// Actual time and the time log (spec §10).

const CHI = 'America/Chicago';
/** Friday, October 2, 2026 at 5:30pm. The RSO fair was 3–4pm. */
const NOW = DateTime.fromISO('2026-10-02T17:30', { zone: CHI });
const chicago = (s: string) => DateTime.fromISO(s, { zone: CHI }).toUTC().toISO({ suppressMilliseconds: true })!;

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: DateTime;

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  clock = NOW;
  app = createApp({ db, now: () => clock });
});

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
const day = async (date = '2026-10-02') => (await call<DayView>('GET', `/api/day/${date}?tz=${CHI}`)).body;
const blocks = (d: DayView) => d.schedule.filter((x): x is BlockItem => x.type === 'block');
const card = (d: DayView, id: string) => [...d.groups.overdue, ...d.groups.near, ...d.groups.week, ...d.groups.soon, ...d.groups.done].find((x) => x.id === id);

describe('reporting what you did', () => {
  it('moves the block to when it happened, checks it off, and ends the RSO fair at 3:46pm, with one Undo', async () => {
    // A penciled block for the reading later today.
    await call('POST', '/api/blocks', { kind: 'task', taskId: 'muqaddimah', startAt: chicago('2026-10-02T19:00'), durationMinutes: 75, pinned: false });
    const r = await call<{ item: LogResult; undo: string }>('POST', `/api/tasks/muqaddimah/log?tz=${CHI}`, {
      startAt: chicago('2026-10-02T15:46'), minutes: 82, done: true,
    });
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({
      minutes: 82, done: true,
      block: { startAt: '2026-10-02T20:46:00Z', endAt: '2026-10-02T22:08:00Z' },
      trimmed: [{ id: 'rso-fair', title: 'RSO fair', endAt: '2026-10-02T20:46:00Z' }],
    });
    const d = await day();
    const reading = blocks(d).filter((b) => b.taskId === 'muqaddimah');
    expect(reading).toHaveLength(1);
    expect(reading[0]).toMatchObject({ startMin: 15 * 60 + 46, endMin: 17 * 60 + 8, done: true, pinned: true, logged: { minutes: 82, estimate: 75 } });
    expect(blocks(d).find((b) => b.id === 'rso-fair')).toMatchObject({ startMin: 900, endMin: 946 });

    await call('POST', `/api/undo/${r.body.undo}`);
    const back = await day();
    expect(blocks(back).find((b) => b.id === 'rso-fair')?.endMin).toBe(960);
    expect(blocks(back).filter((b) => b.taskId === 'muqaddimah').map((b) => b.startMin)).toEqual([19 * 60]);
    expect(card(back, 'muqaddimah')?.doneAt).toBeNull();
    expect(db.select().from(t.taskSessions).all()).toEqual([]);
  });

  it('records partial progress without finishing, and the remaining estimate shrinks', async () => {
    await call('POST', `/api/tasks/response/log?tz=${CHI}`, { startAt: chicago('2026-10-02T16:00'), minutes: 40 });
    const d = await day();
    expect(card(d, 'response')).toMatchObject({ doneAt: null, loggedMinutes: 40 });
    expect(blocks(d).some((b) => b.taskId === 'response')).toBe(false);
  });
});

describe('Start and Stop', () => {
  it('runs one session at a time, and Stop records it', async () => {
    await call('POST', '/api/tasks/quant/start');
    expect(card(await day(), 'quant')?.running).toMatchObject({ startAt: '2026-10-02T22:30:00Z' });
    clock = NOW.plus({ minutes: 20 });
    await call('POST', '/api/tasks/container/start');
    const d = await day();
    expect(card(d, 'quant')).toMatchObject({ running: null, loggedMinutes: 20 });
    expect(card(d, 'container')?.running).not.toBeNull();

    clock = NOW.plus({ minutes: 45 });
    const stop = await call<{ item: LogResult }>('POST', `/api/tasks/container/stop?tz=${CHI}`, {});
    expect(stop.body.item).toMatchObject({ minutes: 25, done: false, block: null });
    expect((await call('POST', `/api/tasks/container/stop?tz=${CHI}`, {})).status).toBe(409);
  });

  it('Done stops it and logs the block where it happened', async () => {
    await call('POST', '/api/tasks/quant/start');
    clock = NOW.plus({ minutes: 50 });
    const r = await call<{ item: LogResult }>('POST', `/api/tasks/quant/stop?tz=${CHI}`, { done: true });
    expect(r.body.item).toMatchObject({ done: true, minutes: 50, block: { startAt: '2026-10-02T22:30:00Z' } });
    expect(blocks(await day()).find((b) => b.taskId === 'quant')).toMatchObject({ startMin: 17 * 60 + 30, endMin: 18 * 60 + 20, logged: { minutes: 50 } });
  });
});

describe('the time log', () => {
  it('lists finished tasks newest first, with the estimate next to the actual time', async () => {
    await call('POST', `/api/tasks/muqaddimah/log?tz=${CHI}`, { startAt: chicago('2026-10-02T15:46'), minutes: 82, done: true });
    await call('PATCH', '/api/tasks/container', { doneAt: '2026-10-02T23:00:00Z' });
    const { body } = await call<TimeLogEntry[]>('GET', '/api/time-log');
    expect(body.map((e) => [e.title, e.estLow, e.estHigh, e.actualMinutes])).toEqual([
      ['Clean the wooden container, store folders', 20, 40, null],
      ['Read The Muqaddimah', 180, 300, 82],
    ]);
  });

  it('edits a session, moving its logged block, and deletes one', async () => {
    const r = await call<{ item: LogResult }>('POST', `/api/tasks/muqaddimah/log?tz=${CHI}`, { startAt: chicago('2026-10-02T15:46'), minutes: 82, done: true });
    const id = r.body.item.session.id;
    await call('PATCH', `/api/task-sessions/${id}`, { startAt: chicago('2026-10-02T16:00'), endAt: chicago('2026-10-02T17:00') });
    expect(blocks(await day()).find((b) => b.taskId === 'muqaddimah')).toMatchObject({ startMin: 960, endMin: 1020, logged: { minutes: 60 } });
    expect((await call('PATCH', `/api/task-sessions/${id}`, { endAt: chicago('2026-10-02T15:00') })).status).toBe(400);

    await call('DELETE', `/api/task-sessions/${id}`);
    expect(blocks(await day()).find((b) => b.taskId === 'muqaddimah')).toMatchObject({ logged: null, startMin: 960 });
    expect((await call<TimeLogEntry[]>('GET', '/api/time-log')).body[0]?.actualMinutes).toBeNull();
  });
});

describe('better estimates', () => {
  it('remembers when you change an estimate yourself', async () => {
    await call('PATCH', '/api/tasks/container', { estLow: 10, estHigh: 15 });
    expect(db.select().from(t.tasks).all().find((x) => x.id === 'container')?.estEditedAt).toBe('2026-10-02T22:30:00Z');
    await call('PATCH', '/api/tasks/quant', { notes: 'just notes' });
    expect(db.select().from(t.tasks).all().find((x) => x.id === 'quant')?.estEditedAt).toBeNull();
  });
});
