import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { BlockItem, ClassItem, RoutineItem } from '../shared/api';
import {
  busyOf, capacity, firstFit, freeMinutes, freeSlots, freeWindow, placeNew, planDay, remainingMinutes, scoreTask, shapeOf,
  type DayFree, type PlanClock, type PlanTask,
} from './planner';

const CHI = 'America/Chicago';
/** Friday, October 2, 2026 at 3pm in Chicago. */
const clock: PlanClock = { now: DateTime.fromISO('2026-10-02T15:00', { zone: CHI }), today: '2026-10-02', zone: CHI, homeZone: CHI };
const chicago = (s: string) => DateTime.fromISO(s, { zone: CHI }).toUTC().toISO({ suppressMilliseconds: true })!;

const task = (id: string, more: Partial<PlanTask> = {}): PlanTask => ({
  id, title: id, window: 'soon', dueAt: null, dueDate: null, estLow: null, estHigh: null, sittingMinutes: null, sessionMinutes: null,
  doneAt: null, steps: [], sometime: null, scheduled: false, ifPending: false, after: null, ...more,
});
const day = (date: string, from: number, to: number, busy: [number, number][] = []): DayFree => ({ date, from, to, busy });

const LAUNDRY = [
  { title: 'Load the washer', minutes: 10, waiting: false },
  { title: 'Washing', minutes: 55, waiting: true },
  { title: 'Move to the dryer', minutes: 5, waiting: false },
  { title: 'Drying', minutes: 55, waiting: true },
  { title: 'Fold and put away', minutes: 15, waiting: false },
];

describe('free time', () => {
  it('runs from wake time, or now plus 10 minutes when planning today, to bedtime', () => {
    expect(freeWindow('2026-10-03', '2026-10-02', null, 540, 1440)).toEqual({ from: 540, to: 1440 });
    expect(freeWindow('2026-10-02', '2026-10-02', 900, 540, 1440)).toEqual({ from: 910, to: 1440 });
  });

  it('keeps 10 minutes from busy blocks and starts on 15-minute marks', () => {
    // A class from 11 to 12:20: free until 10:45, then from 12:30.
    expect(freeSlots(600, 1440, [[660, 740]])).toEqual([[600, 645], [750, 1440]]);
    expect(freeSlots(605, 700, [])).toEqual([[615, 690]]);
    // Gaps under 15 minutes don't count.
    expect(freeSlots(600, 720, [[620, 640], [660, 720]])).toEqual([]);
    expect(freeMinutes(600, 1440, [[660, 740]])).toBe(45 + 690);
  });

  it('counts classes, events, routines, and task blocks as busy, but not open time, skips, or waiting parts', () => {
    const base = { startAt: '', categoryId: null };
    const cls = (id: string, a: number, b: number, skipped = false): ClassItem => ({
      ...base, type: 'class', id, classId: id, homeDate: '', code: '', kind: '', fullName: null, location: null, skipped, startMin: a, endMin: b,
    });
    const blk = (id: string, kind: BlockItem['kind'], a: number, b: number): BlockItem => ({
      ...base, type: 'block', id, kind, title: id, taskId: null, startMin: a, endMin: b, durationMinutes: b - a, tentative: false, label: null,
      location: null, pinned: true, reason: null, rolledFrom: null, done: false, missed: false, steps: [], nextStep: null, condition: null, askNow: false, items: [],
    });
    const laundry: RoutineItem = {
      ...base, type: 'routine', id: 'l', slotId: 'l', routineId: 'l', title: 'Laundry', start: '10:00', durationMinutes: 140, changed: false,
      checked: false, startMin: 600, endMin: 740, steps: LAUNDRY.map((s, i) => ({ ...s, id: String(i), checked: false, streak: null })),
    };
    expect(busyOf([cls('a', 660, 740), cls('b', 800, 860, true), blk('o', 'open', 900, 960), blk('e', 'event', 960, 1020), blk('p', 'task', 1100, 1160), laundry], new Set(['p'])))
      .toEqual([[600, 610], [660, 740], [665, 670], [725, 740], [960, 1020]]);
  });
});

describe('fitting a task', () => {
  it('puts hands-on parts around busy time, letting waiting parts overlap it', () => {
    const shape = shapeOf(140, LAUNDRY);
    expect(shape).toEqual({ minutes: 140, handsOn: [[0, 10], [65, 70], [125, 140]] });
    // A class 10:30–11:20: the start it finds keeps every hands-on part 10 minutes clear of it.
    const at = firstFit(540, 1440, shape, [[630, 680]]);
    expect(at).not.toBeNull();
    for (const [a, b] of shape.handsOn) expect(at! + b <= 620 || at! + a >= 690).toBe(true);
    // A plain task can't overlap at all.
    expect(firstFit(540, 1440, shapeOf(60, []), [[600, 720]])).toBe(730 + 5);
  });

  it('ends by the limit', () => {
    expect(firstFit(600, 700, shapeOf(120, []), [])).toBeNull();
  });
});

describe('scoreTask', () => {
  it('scores by window, deadline, and commitment (spec §12)', () => {
    expect(scoreTask(task('a', { window: 'near' }), '2026-10-02', clock)).toEqual({ score: 60, reason: 'Today or tomorrow' });
    expect(scoreTask(task('a', { window: 'ongoing' }), '2026-10-02', clock)).toEqual({ score: 6, reason: 'Practice session' });
    expect(scoreTask(task('a', { window: 'soon' }), '2026-10-02', clock)).toEqual({ score: 12, reason: 'Free time, no rush' });
    // Due Tuesday at 2pm, 4 days out, 5h high estimate: This week, 30 + 90/5 + 20.
    const muq = task('m', { window: 'week', dueAt: chicago('2026-10-06T14:00'), estLow: 180, estHigh: 300 });
    expect(scoreTask(muq, '2026-10-02', clock)).toEqual({ score: 30 + 18 + 20, reason: 'Due Tue 2pm' });
    expect(scoreTask(muq, '2026-10-05', clock)!.score).toBeCloseTo(30 + 45 + 20);
    const late = task('o', { window: 'near', dueAt: chicago('2026-10-01T12:00') });
    expect(scoreTask(late, '2026-10-02', clock)).toEqual({ score: 400, reason: 'Overdue' });
  });

  it('adds 200 for a task committed to that day', () => {
    expect(scoreTask(task('a', { sometime: { date: '2026-10-02', rolledFrom: '2026-10-01' } }), '2026-10-02', clock))
      .toEqual({ score: 212, reason: 'Not finished yesterday' });
    expect(scoreTask(task('a', { sometime: { date: '2026-10-03', rolledFrom: null } }), '2026-10-03', clock))
      .toEqual({ score: 212, reason: 'You picked this day for it' });
  });

  it('never plans unanswered "if", decision, done, or already-due tasks', () => {
    expect(scoreTask(task('a', { ifPending: true }), '2026-10-02', clock)).toBeNull();
    expect(scoreTask(task('a', { window: 'decide' }), '2026-10-02', clock)).toBeNull();
    expect(scoreTask(task('a', { doneAt: chicago('2026-10-02T10:00') }), '2026-10-02', clock)).toBeNull();
    expect(scoreTask(task('a', { window: 'week', dueDate: '2026-10-03' }), '2026-10-04', clock)).toBeNull();
  });
});

describe('planDay', () => {
  it('places the highest scores first into free time, with buffers between them', () => {
    const placed = planDay(day('2026-10-02', 910, 1440, [[960, 1020]]), [
      task('soon', { estLow: 30 }),
      task('near', { window: 'near', estLow: 45 }),
      task('due', { window: 'week', dueAt: chicago('2026-10-06T14:00'), sittingMinutes: 75 }),
    ], clock);
    // Today or tomorrow (60) beats due Tuesday (30 + 90/5 = 48), which beats Soon (12).
    expect(placed.map((p) => [p.taskId, p.startMin, p.minutes, p.reason])).toEqual([
      ['near', 1035, 45, 'Today or tomorrow'],
      ['due', 1095, 75, 'Due Tue 2pm'],
      ['soon', 915, 30, 'Free time, no rush'],
    ]);
  });

  it('places at most 6, skipping scheduled tasks and ones committed to another day', () => {
    const many = Array.from({ length: 9 }, (_, i) => task(`t${i}`, { estLow: 30 }));
    many.push(task('sched', { window: 'near', scheduled: true }), task('other', { window: 'near', sometime: { date: '2026-10-05', rolledFrom: null } }));
    const placed = planDay(day('2026-10-03', 540, 1440), many, clock);
    expect(placed).toHaveLength(6);
    expect(placed.map((p) => p.taskId)).not.toContain('sched');
    expect(placed.map((p) => p.taskId)).not.toContain('other');
  });

  it('ends a task due that day 15 minutes before its deadline', () => {
    const t = task('pset', { window: 'near', dueAt: chicago('2026-10-03T11:00'), sittingMinutes: 90 });
    expect(planDay(day('2026-10-03', 540, 1440), [t], clock)[0]).toMatchObject({ startMin: 540 });
    // Not enough room before 10:45: it isn't placed.
    expect(planDay(day('2026-10-03', 600, 1440), [t], clock)).toEqual([]);
  });

  it('keeps the length of a resized block it lifted, and carries where it rolled from', () => {
    const t = task('r', { window: 'near', estLow: 30, sometime: { date: '2026-10-02', rolledFrom: '2026-10-01' } });
    expect(planDay(day('2026-10-02', 910, 1440), [t], clock, new Map([['r', 50]]))[0])
      .toMatchObject({ minutes: 50, rolledFrom: '2026-10-01', reason: 'Not finished yesterday' });
  });

  it('gives laundry-style tasks their full length with only hands-on parts busy', () => {
    const t = task('laundry', { window: 'near', steps: LAUNDRY.map((s) => ({ ...s, done: false })) });
    const [p] = planDay(day('2026-10-03', 540, 1440, [[640, 700]]), [t], clock);
    expect(p).toMatchObject({ minutes: 140 });
  });
});

describe('placeNew (automatic scheduling)', () => {
  const free = (date: string) => day(date, date === clock.today ? 910 : 540, 1440);

  it('pencils near, this week, and overdue tasks in the first free slot', () => {
    const placed = placeNew([
      task('n', { window: 'near', estLow: 30 }),
      task('w', { window: 'week', estLow: 60 }),
      task('s', { window: 'soon' }),
      task('o', { window: 'ongoing' }),
    ], clock, free);
    expect(placed.map((p) => [p.taskId, p.date, p.startMin])).toEqual([['n', '2026-10-02', 915], ['w', '2026-10-02', 960]]);
  });

  it('looks up to the deadline, and only on a committed day', () => {
    const full = (date: string) => day(date, 540, 1440, date === '2026-10-02' ? [[0, 2000]] : []);
    const placed = placeNew([
      task('d', { window: 'week', dueDate: '2026-10-04', estLow: 30 }),
      task('c', { window: 'near', sometime: { date: '2026-10-02', rolledFrom: null } }),
    ], clock, full);
    expect(placed.map((p) => [p.taskId, p.date])).toEqual([['d', '2026-10-03']]);
  });
});

describe('capacity', () => {
  const free = (date: string) => day(date, date === clock.today ? 910 : 540, 1440);

  it('warns when the work due is more than half, or more than 80%, of the free time before it', () => {
    // Free before Saturday 11am: Friday 15:10–24:00 (525m) + Saturday 9–11 (120m) = 645m.
    const due = chicago('2026-10-03T11:00');
    expect(capacity([task('a', { dueAt: due, estLow: 240, estHigh: 300 })], clock, free, new Map())).toBeNull();
    expect(capacity([task('a', { dueAt: due, estLow: 300, estHigh: 400 })], clock, free, new Map()))
      .toEqual({ level: 'heads-up', work: 350, free: 645, dueAt: due, dueDate: null });
    expect(capacity([task('a', { dueAt: due, estLow: 500, estHigh: 600 })], clock, free, new Map())).toMatchObject({ level: 'tight' });
  });

  it('counts finished steps and time already set aside, and skips far-off or overdue deadlines', () => {
    const due = chicago('2026-10-03T11:00');
    const steps = [{ title: 'a', minutes: null, waiting: false, done: true }, { title: 'b', minutes: null, waiting: false, done: false }];
    expect(remainingMinutes({ estLow: 300, estHigh: 400, steps })).toBe(175);
    expect(capacity([task('a', { dueAt: due, estLow: 300, estHigh: 400, steps })], clock, free, new Map())).toBeNull();
    expect(capacity([task('far', { dueDate: '2026-10-12', estLow: 6000, estHigh: 6000 })], clock, free, new Map())).toBeNull();
    expect(capacity([task('late', { dueAt: chicago('2026-10-01T09:00'), estLow: 6000, estHigh: 6000 })], clock, free, new Map())).toBeNull();
  });
});

describe('conditions (spec §10)', () => {
  const get = task('get', { title: 'Get The Muqaddimah', window: 'week', estLow: 20 });
  const read = task('read', { title: 'Read The Muqaddimah', window: 'week', dueAt: chicago('2026-10-06T14:00'), estLow: 180, sittingMinutes: 75,
    after: { taskId: 'get', ends: null } });

  it('can’t place Read The Muqaddimah before Get The Muqaddimah', () => {
    const placed = planDay(day('2026-10-03', 9 * 60, 24 * 60), [read, get], clock);
    const at = new Map(placed.map((p) => [p.taskId, p]));
    expect(at.get('get')).toBeDefined();
    expect(at.get('read')!.startMin).toBeGreaterThanOrEqual(at.get('get')!.startMin + at.get('get')!.minutes);
  });

  it('leaves an "after" item off the day when its prerequisite isn’t on it, or comes later', () => {
    expect(planDay(day('2026-10-03', 9 * 60, 24 * 60), [read], clock)).toEqual([]);
    const later = { ...read, after: { taskId: 'get', ends: { date: '2026-10-04', min: 600 } } };
    expect(planDay(day('2026-10-03', 9 * 60, 24 * 60), [later], clock)).toEqual([]);
  });

  it('places an "after" item after its prerequisite ends that day, and freely on later days', () => {
    const sameDay = { ...read, after: { taskId: null, ends: { date: '2026-10-03', min: 14 * 60 } } };
    expect(planDay(day('2026-10-03', 9 * 60, 24 * 60), [sameDay], clock)[0]!.startMin).toBeGreaterThanOrEqual(14 * 60);
    const before = { ...read, after: { taskId: null, ends: { date: '2026-10-02', min: 20 * 60 } } };
    expect(planDay(day('2026-10-03', 9 * 60, 24 * 60), [before], clock)[0]!.startMin).toBe(9 * 60);
  });

  it('never plans an "if" item until it’s answered, by the Plan button or automatic scheduling', () => {
    const gym = task('gym', { window: 'near', estLow: 60, ifPending: true });
    expect(planDay(day('2026-10-03', 9 * 60, 24 * 60), [gym], clock)).toEqual([]);
    expect(placeNew([gym], clock, (d) => day(d, 9 * 60, 24 * 60))).toEqual([]);
    expect(planDay(day('2026-10-03', 9 * 60, 24 * 60), [{ ...gym, ifPending: false }], clock)).toHaveLength(1);
  });

  it('automatic scheduling puts an "after" item after its prerequisite', () => {
    const getNear = { ...get, window: 'near' as const };
    const readNear = { ...read, window: 'near' as const, dueAt: null };
    const placed = placeNew([readNear, getNear], clock, (d) => day(d, d === '2026-10-02' ? 15 * 60 + 10 : 9 * 60, 24 * 60));
    // Read comes first in the list but waits for Get, then goes after it.
    const g = placed.find((p) => p.taskId === 'get')!;
    const r = placed.find((p) => p.taskId === 'read')!;
    expect([g.date, r.date]).toEqual(['2026-10-02', '2026-10-02']);
    expect(r.startMin).toBeGreaterThanOrEqual(g.startMin + g.minutes);
  });
});

describe('Quick things (spec §10)', () => {
  const q = (id: string, est: number, more: Partial<PlanTask> = {}) => task(id, { window: 'near', estLow: est, estHigh: est, quick: true, ...more });

  it('batches quick tasks into blocks of about 30 minutes, placed where the best one would go', () => {
    const placed = planDay(day('2026-10-03', 9 * 60, 24 * 60), [q('a', 10), q('b', 10), q('c', 10), q('d', 10), task('big', { window: 'near', estLow: 60 })], clock);
    expect(placed.map((p) => [p.batch ?? p.taskId, p.minutes, p.reason])).toEqual([
      [['a', 'b', 'c'], 30, 'Quick things'],
      [['d'], 10, 'Quick things'],
      ['big', 60, 'Today or tomorrow'],
    ]);
    expect(placed[0]!.startMin).toBe(9 * 60);
  });

  it('keeps "after" items and resized blocks out of batches', () => {
    const placed = planDay(day('2026-10-03', 9 * 60, 24 * 60), [q('a', 10), q('b', 10, { after: { taskId: null, ends: { date: '2026-10-02', min: 0 } } })], clock);
    expect(placed.map((p) => p.batch ?? p.taskId)).toEqual([['a'], 'b']);
  });

  it('automatic scheduling adds a quick task to a batch with room, or starts one', () => {
    const d = day('2026-10-02', 15 * 60 + 10, 24 * 60, [[16 * 60, 16 * 60 + 15]]);
    d.batches = [{ blockId: 'qb', startMin: 16 * 60, minutes: 15 }];
    const placed = placeNew([q('a', 10), q('b', 10), q('c', 10)], clock, () => d);
    expect(placed.map((p) => [p.taskId, p.joinBlockId ?? null, p.batch ?? null, p.startMin])).toEqual([
      ['a', 'qb', null, 960],
      ['b', null, ['b'], 15 * 60 + 15],
      ['c', 'new:b', null, 15 * 60 + 15],
    ]);
  });
});
