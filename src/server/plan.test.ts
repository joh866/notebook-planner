import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AddResult, BlockItem, DayView, PlanResult } from '../shared/api';
import { createApp } from './app';
import { openDb, type Db } from './db/client';
import { seed } from './db/seed';
import * as t from './db/schema';

const CHI = 'America/Chicago';
/** Friday, October 2, 2026 at 3pm in Chicago. */
const FRI_3PM = DateTime.fromISO('2026-10-02T15:00', { zone: CHI });

let db: Db;
let clock: DateTime;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  clock = FRI_3PM;
  // No AI: the add box uses the local guess.
  app = createApp({ db, now: () => clock, sort: () => Promise.reject(new Error('no AI in tests')) });
});

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
const plan = (date: string) => call<{ item: PlanResult; undo: string | null }>('POST', '/api/plan?tz=America/Chicago', { date });
const day = (date: string) => call<DayView>('GET', `/api/day/${date}?tz=America/Chicago`).then((r) => r.body);
const taskBlocks = (d: DayView) => d.schedule.filter((x): x is BlockItem => x.type === 'block' && x.kind === 'task');
const local = (iso: string) => DateTime.fromISO(iso).setZone(CHI).toFormat('HH:mm');

describe('POST /api/plan', () => {
  it('pencils tasks into today’s free time after now, with reasons (spec §12)', async () => {
    const { status, body } = await plan('2026-10-02');
    expect(status).toBe(200);
    expect(body.item.placed.map((p) => [p.title, local(p.startAt), p.reason])).toEqual([
      ['Read The Muqaddimah', '16:15', 'Due Tue 2pm'],
      ['Problem Set 1', '17:45', 'Due Wed 11am'],
      ['Clean the wooden container, store folders', '19:30', 'Today or tomorrow'],
      ['Consolidate the quant plan', '20:00', 'Today or tomorrow'],
      ['Problem Set 1', '21:00', 'Due Oct 9, 12pm'],
    ]);
    const blocks = taskBlocks(await day('2026-10-02'));
    expect(blocks).toHaveLength(5);
    expect(blocks.every((b) => !b.pinned && b.reason)).toBe(true);
    // The Muqaddimah goes in its 75-minute sitting.
    expect(blocks[0]).toMatchObject({ title: 'Read The Muqaddimah', durationMinutes: 75 });
  });

  it('re-plans the same way, lifting its own penciled blocks but keeping pinned ones and resized lengths', async () => {
    const first = await plan('2026-10-02');
    const muq = taskBlocks(await day('2026-10-02')).find((b) => b.taskId === 'muqaddimah')!;
    await call('POST', '/api/drops?tz=America/Chicago', { action: 'resizeBlock', blockId: muq.id, minutes: 60 });
    const again = await plan('2026-10-02');
    expect(again.body.item.lifted).toBe(5);
    // The shorter Muqaddimah block leaves room for one more.
    expect(again.body.item.placed.map((p) => p.title).slice(0, 5)).toEqual(first.body.item.placed.map((p) => p.title));
    expect(taskBlocks(await day('2026-10-02')).find((b) => b.taskId === 'muqaddimah')).toMatchObject({ durationMinutes: 60 });

    // A block you placed stays put, and its task isn't planned again.
    const pinned = (await call<{ item: unknown }>('POST', '/api/drops?tz=America/Chicago', { action: 'placeTask', taskId: 'quant', date: '2026-10-02', startMin: 16 * 60 + 15 })).status;
    expect(pinned).toBe(200);
    const third = await plan('2026-10-02');
    expect(third.body.item.placed.map((p) => p.taskId)).not.toContain('quant');
    const blocks = taskBlocks(await day('2026-10-02'));
    expect(blocks.find((b) => b.taskId === 'quant')).toMatchObject({ pinned: true, startMin: 975 });
  });

  it('plans a task committed to the day first, and takes it out of the Sometime lane', async () => {
    await call('PUT', '/api/sometime/number-theory', { date: '2026-10-03' });
    const { body } = await plan('2026-10-03');
    expect(body.item.placed[0]).toMatchObject({ taskId: 'number-theory', reason: 'You picked this day for it' });
    expect(local(body.item.placed[0]!.startAt)).toBe('09:45');
    expect((await day('2026-10-03')).sometime).toEqual([]);
  });

  it('undoes the whole plan at once', async () => {
    const before = db.select().from(t.blocks).all();
    await call('PUT', '/api/sometime/number-theory', { date: '2026-10-02' });
    const { body } = await plan('2026-10-02');
    await call('POST', `/api/undo/${body.undo}`);
    expect(db.select().from(t.blocks).all()).toEqual(before);
    expect((await day('2026-10-02')).sometime.map((s) => s.taskId)).toEqual(['number-theory']);
  });

  it('says there’s no free time left, and refuses past days', async () => {
    clock = DateTime.fromISO('2026-10-02T23:55', { zone: CHI });
    expect((await plan('2026-10-02')).body.item).toMatchObject({ placed: [], free: 0 });
    expect((await plan('2026-10-01')).status).toBe(409);
  });
});

describe('automatic scheduling (off by default)', () => {
  const add = (text: string) => call<{ item: AddResult }>('POST', '/api/add?tz=America/Chicago', { text });

  it('leaves new tasks in the list when off', async () => {
    const { body } = await add('Call mom tomorrow');
    expect(body.item.added[0]).toMatchObject({ window: 'near', penciled: null });
  });

  it('pencils new near and this-week tasks in when on, but not Soon ones', async () => {
    await call('PATCH', '/api/settings', { autoSchedule: true });
    const { body } = await add('Call mom tomorrow\nGet razor (in the near future)\nLearn juggling');
    const [mom, razor, juggling] = body.item.added as Extract<AddResult['added'][number], { kind: 'task' }>[];
    expect(local(mom!.penciled!)).toBe('16:15'); // After the RSO fair, 3–4pm.
    expect(local(razor!.penciled!)).toBe('17:00');
    expect(juggling!.penciled).toBeNull();
    const blocks = taskBlocks(await day('2026-10-02'));
    expect(blocks.map((b) => [b.title, b.pinned, b.reason])).toEqual([['Call mom', false, 'Today or tomorrow'], ['Get razor', false, 'This week']]);
  });

  it('pencils rolled-over tasks in when on', async () => {
    await call('PATCH', '/api/settings', { autoSchedule: true });
    await call('PUT', '/api/sometime/container', { date: '2026-10-01' });
    const { body } = await call<{ item: { moved: string[] } }>('POST', '/api/rollover?tz=America/Chicago');
    expect(body.item).toEqual({ moved: ['container'], today: '2026-10-02' });
    expect((await day('2026-10-02')).sometime).toEqual([]);
    expect(taskBlocks(await day('2026-10-02'))[0]).toMatchObject({ taskId: 'container', reason: 'Not finished yesterday', rolledFrom: '2026-10-01' });
  });
});

describe('the capacity warning', () => {
  it('shows when the work due is more than half the free time before it', async () => {
    expect((await day('2026-10-02')).capacity).toBeNull();
    // Saturday at 11am, with 8–10 hours of work.
    await call('POST', '/api/tasks', { title: 'Big essay', window: 'near', dueAt: '2026-10-03T16:00:00Z', estLow: 480, estHigh: 600 });
    expect((await day('2026-10-02')).capacity).toMatchObject({ level: 'tight', work: 540, dueAt: '2026-10-03T16:00:00Z' });
  });
});
