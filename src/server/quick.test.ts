import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BlockItem, DayView, PlanResult } from '../shared/api';
import { createApp } from './app';
import { openDb, type Db } from './db/client';
import { seed } from './db/seed';
import * as t from './db/schema';

// Quick things (spec §10): short tasks batched into one block.

const CHI = 'America/Chicago';
/** Saturday, October 3, 2026 at 8am, before wake time. */
const NOW = DateTime.fromISO('2026-10-03T08:00', { zone: CHI });

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: DateTime;

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  clock = NOW;
  app = createApp({ db, now: () => clock, sort: () => Promise.reject(new Error('no AI in tests')) });
});

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
const day = async (date = '2026-10-04') => (await call<DayView>('GET', `/api/day/${date}?tz=${CHI}`)).body;
const quickBlocks = (d: DayView) => d.schedule.filter((x): x is BlockItem => x.type === 'block' && x.kind === 'quick');
const drop = (body: unknown) => call<{ undo: string }>('POST', `/api/drops?tz=${CHI}`, body);
async function quickTask(title: string, minutes = 10, quick = true) {
  const r = await call<{ item: { id: string } }>('POST', '/api/tasks', { title, window: 'near', estLow: minutes, estHigh: minutes, quick });
  return r.body.item.id;
}

describe('Quick things', () => {
  it('the planner batches quick tasks into one block, listed with checkboxes', async () => {
    const ids = [await quickTask('Text Sam back', 5), await quickTask('Reply to the RSO email'), await quickTask('Book a haircut')];
    const { body } = await call<{ item: PlanResult }>('POST', `/api/plan?tz=${CHI}`, { date: '2026-10-04' });
    const quick = body.item.placed.filter((p) => p.reason === 'Quick things');
    expect(quick.map((p) => p.taskId)).toEqual(ids);
    expect(new Set(quick.map((p) => p.startAt)).size).toBe(1);

    const [block] = quickBlocks(await day());
    expect(block).toMatchObject({ title: 'Quick things', durationMinutes: 25, pinned: false, done: false });
    expect(block!.items.map((x) => [x.title, x.minutes])).toEqual([['Text Sam back', 5], ['Reply to the RSO email', 10], ['Book a haircut', 10]]);
    // They count as scheduled, so the card says when.
    const card = (await day()).groups.near.find((x) => x.id === ids[0]);
    expect(card).toMatchObject({ quick: true, scheduled: { startAt: block!.startAt } });

    // Planning again lifts the penciled batch and makes it again.
    const again = await call<{ item: PlanResult }>('POST', `/api/plan?tz=${CHI}`, { date: '2026-10-04' });
    expect(again.body.item.lifted).toBeGreaterThan(0);
    expect(quickBlocks(await day())).toHaveLength(1);
  });

  it('a short task dropped onto the block joins it, and dragging one out unbatches it', async () => {
    const a = await quickTask('Text Sam back');
    await call('POST', `/api/plan?tz=${CHI}`, { date: '2026-10-04' });
    const [block] = quickBlocks(await day());
    const b = await quickTask('Venmo roommates', 5, false);

    const join = await drop({ action: 'joinBatch', taskId: b, blockId: block!.id });
    expect(join.status).toBe(200);
    expect(quickBlocks(await day())[0]!.items.map((x) => x.taskId)).toEqual([a, b]);

    // Onto the list: it leaves the batch.
    await drop({ action: 'leaveBatch', taskId: b, blockId: block!.id });
    expect(quickBlocks(await day())[0]!.items.map((x) => x.taskId)).toEqual([a]);

    // Onto the schedule: it gets its own block, and the empty batch goes away.
    await drop({ action: 'placeTask', taskId: a, date: '2026-10-04', startMin: 14 * 60 });
    const d = await day();
    expect(quickBlocks(d)).toEqual([]);
    expect(d.schedule.some((x) => x.type === 'block' && x.taskId === a)).toBe(true);
  });

  it('Undo puts a joined task back where it was', async () => {
    await quickTask('Text Sam back');
    await call('POST', `/api/plan?tz=${CHI}`, { date: '2026-10-04' });
    const [block] = quickBlocks(await day());
    const b = await quickTask('Venmo roommates', 5);
    const join = await drop({ action: 'joinBatch', taskId: b, blockId: block!.id });
    await call('POST', `/api/undo/${join.body.undo}`);
    expect(quickBlocks(await day())[0]!.items).toHaveLength(1);
    expect(db.select().from(t.blocks).all().find((x) => x.id === block!.id)?.durationMinutes).toBe(10);
  });

  it('checking every task in the block marks it done', async () => {
    const a = await quickTask('Text Sam back');
    await call('POST', `/api/plan?tz=${CHI}`, { date: '2026-10-04' });
    await call('PATCH', `/api/tasks/${a}`, { doneAt: '2026-10-04T15:00:00Z' });
    expect(quickBlocks(await day())[0]).toMatchObject({ done: true, items: [{ done: true }] });
  });

  it('an unfinished task in a past batch rolls over to today’s Sometime lane', async () => {
    const a = await quickTask('Text Sam back');
    await call('POST', `/api/plan?tz=${CHI}`, { date: '2026-10-04' });
    clock = DateTime.fromISO('2026-10-05T09:00', { zone: CHI });
    const r = await call<{ item: { moved: string[] } }>('POST', `/api/rollover?tz=${CHI}`);
    expect(r.body.item.moved).toContain(a);
    expect((await day('2026-10-05')).sometime.map((s) => s.taskId)).toContain(a);
    expect(quickBlocks(await day())[0]?.items ?? []).toEqual([]);
  });

  it('the add box marks quick tasks', async () => {
    const appAi = createApp({ db, now: () => clock, sort: async () => [{ type: 'task', title: 'Email the TA', win: 'near', quick: true }] });
    await appAi.request(`/api/add?tz=${CHI}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'email the TA' }) });
    expect(db.select().from(t.tasks).all().find((x) => x.title === 'Email the TA')?.quick).toBe(true);
  });
});
