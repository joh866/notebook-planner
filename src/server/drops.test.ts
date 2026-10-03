import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BlockItem, DayView, DropInput, RoutineItem } from '../shared/api';
import { createApp } from './app';
import { openDb } from './db/client';
import { seed } from './db/seed';

const CHI = 'America/Chicago';
/** Friday, October 2, 2026 at 3pm in Chicago. */
const FRI_3PM = DateTime.fromISO('2026-10-02T15:00', { zone: CHI });
const FRI = '2026-10-02';
const SAT = '2026-10-03';

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const db = openDb(':memory:');
  seed(db);
  app = createApp({ db, now: () => FRI_3PM });
});

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
const dropIt = (body: DropInput, tz = CHI) => call<{ item: unknown; undo: string | null; error?: string }>('POST', `/api/drops?tz=${tz}`, body);
const day = (date: string, tz = CHI) => call<DayView>('GET', `/api/day/${date}?tz=${tz}`).then((r) => r.body);
const undo = (token: unknown) => call('POST', `/api/undo/${token}`);
const blocks = (d: DayView) => d.schedule.filter((x): x is BlockItem => x.type === 'block');
const routines = (d: DayView) => d.schedule.filter((x): x is RoutineItem => x.type === 'routine');

describe('POST /api/drops', () => {
  it('places a task card at a time, pinned, with its sitting length, and undoes it', async () => {
    const r = await dropIt({ action: 'placeTask', taskId: 'muqaddimah', date: SAT, startMin: 600 });
    expect(r.status).toBe(200);
    const sat = await day(SAT);
    expect(blocks(sat)).toEqual([expect.objectContaining({ taskId: 'muqaddimah', startMin: 600, endMin: 675, pinned: true, kind: 'task' })]);
    await undo(r.body.undo);
    expect(blocks(await day(SAT))).toEqual([]);
  });

  it('takes a Sometime chip off the lane when it’s placed, keeping where it rolled from', async () => {
    await call('PUT', '/api/sometime/quant', { date: FRI, rolledFrom: '2026-10-01' });
    const r = await dropIt({ action: 'placeTask', taskId: 'quant', date: FRI, startMin: 1080 });
    const fri = await day(FRI);
    expect(fri.sometime).toEqual([]);
    expect(blocks(fri).find((b) => b.taskId === 'quant')).toMatchObject({ startMin: 1080, endMin: 1125, rolledFrom: '2026-10-01' });
    // One Undo puts both back.
    await undo(r.body.undo);
    const back = await day(FRI);
    expect(back.sometime.map((s) => [s.taskId, s.rolledFrom])).toEqual([['quant', '2026-10-01']]);
    expect(blocks(back).some((b) => b.taskId === 'quant')).toBe(false);
  });

  it('won’t drop into the past on today, or put decision items on the schedule', async () => {
    expect((await dropIt({ action: 'placeTask', taskId: 'quant', date: FRI, startMin: 600 })).status).toBe(409);
    // An "if" item can go on the schedule; it asks "Still on?" when its time comes (spec v0.5).
    expect((await dropIt({ action: 'placeTask', taskId: 'gym', date: SAT, startMin: 600 })).status).toBe(200);
    expect((await dropIt({ action: 'placeTask', taskId: 'blanket', date: SAT, startMin: 600 })).status).toBe(409);
    // A few minutes behind the server's clock is fine.
    expect((await dropIt({ action: 'placeTask', taskId: 'quant', date: FRI, startMin: 15 * 60 - 3 })).status).toBe(200);
  });

  it('rejects positions off the schedule', async () => {
    expect((await dropIt({ action: 'placeTask', taskId: 'quant', date: SAT, startMin: 120 })).status).toBe(400);
    expect((await dropIt({ action: 'placeTask', taskId: 'quant', date: SAT, startMin: 1700 })).status).toBe(400);
  });

  it('commits a task block to the Sometime lane, taking it off the schedule', async () => {
    await dropIt({ action: 'placeTask', taskId: 'quant', date: SAT, startMin: 600 });
    const placed = blocks(await day(SAT))[0]!;
    const r = await dropIt({ action: 'commitTask', taskId: 'quant', date: SAT, blockId: placed.id });
    const sat = await day(SAT);
    expect(blocks(sat)).toEqual([]);
    expect(sat.sometime.map((s) => s.taskId)).toEqual(['quant']);
    await undo(r.body.undo);
    const back = await day(SAT);
    expect(blocks(back).map((b) => b.id)).toEqual([placed.id]);
    expect(back.sometime).toEqual([]);
  });

  it('commits a card to a day, and refuses a block from another task', async () => {
    await dropIt({ action: 'commitTask', taskId: 'container', date: SAT });
    expect((await day(SAT)).sometime.map((s) => s.taskId)).toEqual(['container']);
    expect((await dropIt({ action: 'commitTask', taskId: 'quant', date: FRI, blockId: 'rso-fair' })).status).toBe(409);
  });

  it('moves a penciled block and pins it', async () => {
    const made = await call<{ item: { id: string } }>('POST', '/api/blocks', {
      kind: 'task', taskId: 'quant', startAt: '2026-10-03T15:00:00Z', durationMinutes: 30, pinned: false,
    });
    await dropIt({ action: 'moveBlock', blockId: made.body.item.id, date: SAT, startMin: 1260 });
    expect(blocks(await day(SAT))[0]).toMatchObject({ startMin: 1260, pinned: true });
  });

  it('moves a tentative event and updates its label', async () => {
    const made = await call<{ item: { id: string } }>('POST', '/api/blocks', {
      kind: 'event', title: 'Dinner', startAt: '2026-10-03T00:00:00Z', durationMinutes: 60, tentative: true, label: 'Around 7, depends on friends',
    });
    await dropIt({ action: 'moveBlock', blockId: made.body.item.id, date: FRI, startMin: 1230, label: 'Around 8:30, depends on friends' });
    expect(blocks(await day(FRI)).find((b) => b.id === made.body.item.id)).toMatchObject({ startMin: 1230, label: 'Around 8:30, depends on friends' });
  });

  it('moves a routine for this day only, or every day', async () => {
    const r = await dropIt({ action: 'moveRoutine', slotId: 'night-slot', date: FRI, startMin: 1410 });
    expect(routines(await day(FRI)).find((x) => x.slotId === 'night-slot')).toMatchObject({ startMin: 1410, changed: true });
    expect(routines(await day(SAT)).find((x) => x.slotId === 'night-slot')).toMatchObject({ startMin: 1380, changed: false });

    // "Every day instead": undo the one-day move, then move the slot itself.
    await undo(r.body.undo);
    await dropIt({ action: 'moveRoutine', slotId: 'night-slot', date: FRI, startMin: 1410, everyDay: true });
    expect(routines(await day(FRI)).find((x) => x.slotId === 'night-slot')).toMatchObject({ startMin: 1410, changed: false });
    expect(routines(await day(SAT)).find((x) => x.slotId === 'night-slot')).toMatchObject({ startMin: 1410, start: '23:30' });
  });

  it('moving a routine back to its usual time clears the day’s change, but keeps a one-day length', async () => {
    await dropIt({ action: 'resizeRoutine', slotId: 'night-slot', date: SAT, minutes: 60 });
    await dropIt({ action: 'moveRoutine', slotId: 'night-slot', date: SAT, startMin: 1320 });
    await dropIt({ action: 'moveRoutine', slotId: 'night-slot', date: SAT, startMin: 1380 });
    expect(routines(await day(SAT)).find((x) => x.slotId === 'night-slot')).toMatchObject({ startMin: 1380, endMin: 1440, changed: true });
    await dropIt({ action: 'resizeRoutine', slotId: 'night-slot', date: SAT, minutes: 45 });
    expect(routines(await day(SAT)).find((x) => x.slotId === 'night-slot')).toMatchObject({ changed: false });
  });

  it('puts a checklist routine on the schedule every day it repeats', async () => {
    const r = await dropIt({ action: 'placeRoutine', routineId: 'meditate', date: SAT, startMin: 600 });
    expect(r.body.item).toEqual({ routine: { title: 'Meditate 10 min', repeat: 'daily', repeatDays: null, repeatEvery: 1, start: '10:00' } });
    for (const d of [FRI, SAT, '2026-10-04']) {
      expect(routines(await day(d)).find((x) => x.routineId === 'meditate')).toMatchObject({ startMin: 600, endMin: 610 });
    }
    expect((await day(SAT)).daily.find((x) => x.routineId === 'meditate')?.time).toBe('10:00');
    await undo(r.body.undo);
    expect(routines(await day(SAT)).some((x) => x.routineId === 'meditate')).toBe(false);
  });

  it('a weekly routine lands on its own days only', async () => {
    await dropIt({ action: 'placeRoutine', routineId: 'laundry', date: SAT, startMin: 660 });
    expect(routines(await day(SAT)).find((x) => x.routineId === 'laundry')).toMatchObject({ startMin: 660, endMin: 800 });
    expect(routines(await day('2026-10-04')).some((x) => x.routineId === 'laundry')).toBe(false);
  });

  it('dropping a routine that’s already on the schedule moves it on every day and clears the day’s skip', async () => {
    await call('PUT', `/api/slot-exceptions/morning-slot/${SAT}`, { skipped: true });
    await dropIt({ action: 'placeRoutine', routineId: 'morning', date: SAT, startMin: 570 });
    expect(routines(await day(SAT)).find((x) => x.routineId === 'morning')).toMatchObject({ startMin: 570 });
    expect(routines(await day('2026-10-04')).find((x) => x.routineId === 'morning')).toMatchObject({ startMin: 570 });
  });

  it('resizes blocks, and routines for one day or every day', async () => {
    const r = await dropIt({ action: 'resizeBlock', blockId: 'rso-fair', minutes: 90 });
    expect(blocks(await day(FRI))[0]).toMatchObject({ startMin: 900, endMin: 990 });
    await undo(r.body.undo);
    expect(blocks(await day(FRI))[0]).toMatchObject({ endMin: 960 });

    await dropIt({ action: 'resizeRoutine', slotId: 'morning-slot', date: SAT, minutes: 45 });
    expect(routines(await day(SAT)).find((x) => x.slotId === 'morning-slot')).toMatchObject({ endMin: 585, changed: true });
    expect(routines(await day('2026-10-04')).find((x) => x.slotId === 'morning-slot')).toMatchObject({ endMin: 570 });
    await dropIt({ action: 'resizeRoutine', slotId: 'morning-slot', date: SAT, minutes: 45, everyDay: true });
    expect(routines(await day('2026-10-04')).find((x) => x.slotId === 'morning-slot')).toMatchObject({ endMin: 585, changed: false });
  });

  it('reads positions in the device’s zone when the setting is automatic', async () => {
    // 10am in New York is 9am in Chicago.
    await dropIt({ action: 'placeTask', taskId: 'quant', date: SAT, startMin: 600 }, 'America/New_York');
    expect(blocks(await day(SAT))[0]).toMatchObject({ startAt: '2026-10-03T14:00:00Z', startMin: 540 });
  });

  it('places across the night daylight saving ends', async () => {
    await dropIt({ action: 'placeTask', taskId: 'quant', date: '2026-10-31', startMin: 1530 });
    expect(blocks(await day('2026-10-31'))[0]).toMatchObject({ startMin: 1530 });
  });

  it('404s on missing items', async () => {
    expect((await dropIt({ action: 'moveBlock', blockId: 'nope', date: SAT, startMin: 600 })).status).toBe(404);
    expect((await dropIt({ action: 'moveRoutine', slotId: 'nope', date: SAT, startMin: 600 })).status).toBe(404);
  });
});
