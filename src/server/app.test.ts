import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgendaView, BlockItem, ClassItem, DayView, MonthView, RoutineItem, WeekView } from '../shared/api';
import { createApp } from './app';
import { openDb } from './db/client';
import { seed } from './db/seed';

const CHI = 'America/Chicago';
/** Friday, October 2, 2026 at 3pm in Chicago. */
const FRI_3PM = DateTime.fromISO('2026-10-02T15:00', { zone: CHI });

let clock: DateTime;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const db = openDb(':memory:');
  seed(db);
  clock = FRI_3PM;
  app = createApp({ db, now: () => clock });
});

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
const get = <T>(path: string) => call<T>('GET', path).then((r) => r.body);
const undo = (token: unknown) => call('POST', `/api/undo/${token}`);

const ids = (list: { id: string }[]) => list.map((x) => x.id);
const ofType = <T extends DayView['schedule'][number]['type']>(day: DayView, type: T) =>
  day.schedule.filter((x) => x.type === type) as Extract<DayView['schedule'][number], { type: T }>[];

describe('GET /api/day', () => {
  it('shows Friday’s schedule, checklist, and task groups', async () => {
    const day = await get<DayView>('/api/day/2026-10-02?tz=America/Chicago');
    expect(day).toMatchObject({ date: '2026-10-02', today: '2026-10-02', zone: CHI });

    const classes = ofType(day, 'class');
    expect(classes.map((c) => [c.classId, c.startMin, c.endMin])).toEqual([
      ['math-lec', 750, 800],
      ['econ-disc', 810, 890],
    ]);
    expect(ofType(day, 'routine').map((r) => [r.routineId, r.startMin])).toEqual([['morning', 540], ['night', 1380]]);
    expect(ofType(day, 'block')).toEqual([expect.objectContaining({ id: 'rso-fair', kind: 'event', startMin: 900, pinned: true })]);

    // Meditate and gratitude are morning steps since spec v0.5, and gratitude keeps a streak on its step.
    expect(day.daily.map((r) => r.routineId)).toEqual(['morning', 'night', 'supplements']);
    expect(day.daily.find((r) => r.routineId === 'morning')?.steps.at(-1)).toMatchObject({ title: 'Gratitude journal, 5 things', streak: 0, checked: false });
    expect(day.daily.find((r) => r.routineId === 'morning')?.time).toBe('09:00');

    expect(ids(day.groups.overdue)).toEqual([]);
    expect(ids(day.groups.near)).toEqual(['container', 'quant']);
    expect(ids(day.groups.week).slice(0, 4)).toEqual(['muqaddimah', 'response', 'math-pset', 'econ-pset']);
    expect(day.groups.week[0]).toMatchObject({ dueTone: 'soon', effectiveWindow: 'week' });
    // Tasks with a condition stay in their own windows, and their questions are check-ins (spec v0.5).
    expect(day.checkIns.map((c) => [c.conditionId, c.titles])).toEqual([
      ['cold', ['Gym', 'Check out boxing club']],
      ['arch', ['ARCH reading and photo upload']],
      ['qnet', ['Update resume, apply to internships']],
    ]);
    expect(ids(day.groups.week)).toEqual(expect.arrayContaining(['gym', 'boxing', 'arch-reading']));
    expect(ids(day.groups.soon)).toContain('resume');
    expect(day.groups.week.find((x) => x.id === 'gym')?.condition).toMatchObject({ kind: 'if', text: 'once the cold is fully gone' });
    expect(ids(day.groups.decide)).toEqual(['blanket', 'topper', 'skip-disc', 'epiphany-build']);
    expect(ids(day.groups.ongoing)).toEqual(['number-theory']);
    expect(day.header).toEqual({
      overdue: [],
      nextDeadline: { taskId: 'muqaddimah', name: 'the Muqaddimah reading', dueAt: '2026-10-06T19:00:00Z', dueDate: null },
    });
  });

  it('defaults to today, and to the home zone without ?tz', async () => {
    const day = await get<DayView>('/api/day');
    expect(day.date).toBe('2026-10-02');
    expect(day.zone).toBe(CHI);
  });

  it('counts the night before 4am as the previous day', async () => {
    clock = DateTime.fromISO('2026-10-03T02:00', { zone: CHI });
    expect((await get<DayView>('/api/day')).date).toBe('2026-10-02');
  });

  it('shows classes at local time when traveling, while routines stay put', async () => {
    const day = await get<DayView>('/api/day/2026-10-02?tz=America/New_York');
    expect(day.zone).toBe('America/New_York');
    expect(ofType(day, 'class').find((c) => c.classId === 'econ-disc')?.startMin).toBe(870); // 2:30pm in New York
    expect(ofType(day, 'routine').find((r) => r.routineId === 'morning')?.startMin).toBe(540); // still 9am
  });

  it('shows deadline lines on the day they fall', async () => {
    const day = await get<DayView>('/api/day/2026-10-06');
    expect(day.deadlines.map((d) => [d.taskId, d.atMin])).toEqual([['muqaddimah', 840], ['response', 840]]);
  });

  it('adds weekly routines on their day, with laundry’s steps', async () => {
    const sat = await get<DayView>('/api/day/2026-10-03');
    expect(sat.daily.map((r) => r.routineId)).toEqual(['morning', 'night', 'supplements', 'laundry', 'dorm']);
    const laundry = sat.daily.find((r) => r.routineId === 'laundry')!;
    expect(laundry.steps.map((s) => [s.minutes, s.waiting])).toEqual([[10, false], [55, true], [5, false], [55, true], [15, false]]);

    const nextSat = await get<DayView>('/api/day/2026-10-10');
    expect(nextSat.daily.map((r) => r.routineId)).toContain('laundry');
    expect(nextSat.daily.map((r) => r.routineId)).not.toContain('dorm'); // every other week
  });

  it('rejects a bad date or zone', async () => {
    expect((await call('GET', '/api/day/2026-02-30')).status).toBe(400);
    expect((await call('GET', '/api/day/tomorrow')).status).toBe(400);
    expect((await call('GET', '/api/day?tz=Mars/Olympus')).status).toBe(400);
  });
});

describe('GET /api/week and /api/month', () => {
  it('returns the fixed calendar week, starting Sunday', async () => {
    const week = await get<WeekView>('/api/week/2026-10-02');
    expect(week.start).toBe('2026-09-27');
    expect(week.days.map((d) => d.date)).toEqual([
      '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03',
    ]);
    const mon = week.days[1]!;
    expect(mon.schedule.filter((x) => x.type === 'class').map((c) => (c as ClassItem).classId)).toEqual(['econ-lec', 'math-lec']);
  });

  it('follows the week start setting', async () => {
    await call('PATCH', '/api/settings', { weekStart: 1 });
    expect((await get<WeekView>('/api/week/2026-10-02')).start).toBe('2026-09-28');
  });

  it('lists each day’s deadlines, events, and weekly chores', async () => {
    const month = await get<MonthView>('/api/month/2026-10');
    expect(month.days).toHaveLength(31);
    const day = (d: number) => month.days[d - 1]!;
    expect(day(2).events.map((e) => e.id)).toEqual(['rso-fair']);
    expect(day(3).chores.map((c) => c.routineId)).toEqual(['laundry', 'dorm']);
    expect(day(10).chores.map((c) => c.routineId)).toEqual(['laundry']);
    expect(day(6).deadlines.map((d) => d.taskId)).toEqual(['muqaddimah', 'response']);
    expect(day(9).deadlines.map((d) => d.taskId)).toEqual(['econ-pset']);
  });
});

describe('GET /api/agenda', () => {
  it('covers the next 10 days from today by default, across a month end', async () => {
    const a = await get<AgendaView>('/api/agenda');
    expect(a.from).toBe('2026-10-02');
    expect(a.days.map((d) => d.date)).toEqual(Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 2).padStart(2, '0')}`));
    expect(a.days[0]!.events.map((e) => e.id)).toEqual(['rso-fair']);
    expect(a.days[4]!.deadlines.map((d) => d.taskId)).toEqual(['muqaddimah', 'response']);
    const late = await get<AgendaView>('/api/agenda/2026-10-27?days=8');
    expect(late.days.map((d) => d.date).slice(-3)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('shows skipped classes', async () => {
    await call('PUT', '/api/class-skips/econ-disc/2026-10-09');
    const a = await get<AgendaView>('/api/agenda/2026-10-09?days=1');
    expect(a.days[0]!.skippedClasses.map((c) => c.classId)).toEqual(['econ-disc']);
  });

  it('rejects a bad day count', async () => {
    expect((await call('GET', '/api/agenda?days=0')).status).toBe(400);
    expect((await call('GET', '/api/agenda?days=43')).status).toBe(400);
    expect((await call('GET', '/api/agenda?days=two')).status).toBe(400);
  });
});

describe('tasks', () => {
  it('creates a task with steps, and it shows in its group', async () => {
    const { status, body } = await call<{ item: { id: string; sortOrder: number }; undo: string }>('POST', '/api/tasks', {
      title: 'Get razor', window: 'week', categoryId: 'errand', estLow: 15, estHigh: 30,
      steps: [{ title: 'Find the store' }, { title: 'Buy it' }],
    });
    expect(status).toBe(201);
    expect(body.item.sortOrder).toBe(18);
    const day = await get<DayView>('/api/day');
    const card = day.groups.week.find((t) => t.id === body.item.id)!;
    expect(card.steps.map((s) => s.title)).toEqual(['Find the store', 'Buy it']);

    await undo(body.undo);
    const after = await get<DayView>('/api/day');
    expect(after.groups.week.find((t) => t.id === body.item.id)).toBeUndefined();
  });

  it('stores deadline moments as UTC', async () => {
    const { body } = await call<{ item: { dueAt: string } }>('POST', '/api/tasks', {
      title: 'Hand in essay', window: 'soon', dueAt: '2026-10-20T17:00:00-05:00',
    });
    expect(body.item.dueAt).toBe('2026-10-20T22:00:00Z');
  });

  it('validates input', async () => {
    const bad = [
      {},
      { title: 'x', window: 'later' },
      { title: '', window: 'week' },
      { title: 'x', window: 'week', dueAt: '2026-10-06T19:00:00Z', dueDate: '2026-10-06' },
      { title: 'x', window: 'week', estLow: 60, estHigh: 30 },
      { title: 'x', window: 'week', estLow: 12.5 },
      { title: 'x', window: 'week', color: 'red' },
      { title: 'x', window: 'week', dueDate: '2026-13-01' },
    ];
    for (const body of bad) expect((await call('POST', '/api/tasks', body)).status, JSON.stringify(body)).toBe(400);
    const notJson = await app.request('/api/tasks', { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } });
    expect(notJson.status).toBe(400);
  });

  it('rejects links to things that don’t exist', async () => {
    expect((await call('POST', '/api/tasks', { title: 'x', window: 'week', categoryId: 'nope' })).status).toBe(409);
  });

  it('updates a task, checking the merged deadline', async () => {
    expect((await call('PATCH', '/api/tasks/muqaddimah', { dueDate: '2026-10-06' })).status).toBe(400);
    const res = await call<{ item: { dueAt: null; dueDate: string } }>('PATCH', '/api/tasks/muqaddimah', {
      dueAt: null, dueDate: '2026-10-07',
    });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ dueAt: null, dueDate: '2026-10-07' });
    expect((await call('PATCH', '/api/tasks/nope', { title: 'x' })).status).toBe(404);
  });

  it('checks a task off and undoes it', async () => {
    const { body } = await call('PATCH', '/api/tasks/quant', { doneAt: '2026-10-02T20:00:00Z' });
    expect(ids((await get<DayView>('/api/day')).groups.done)).toEqual(['quant']);
    await undo(body.undo);
    expect(ids((await get<DayView>('/api/day')).groups.near)).toContain('quant');
  });

  it('deletes a task with its steps, and Undo brings them back', async () => {
    await call('POST', '/api/blocks', { kind: 'task', taskId: 'muqaddimah', startAt: '2026-10-02T23:00:00Z', durationMinutes: 75 });
    const del = await call('DELETE', '/api/tasks/muqaddimah');
    expect(del.status).toBe(200);
    expect((await call('GET', '/api/tasks/muqaddimah')).status).toBe(404);
    expect(await get('/api/task-steps?taskId=muqaddimah')).toEqual([]);

    expect((await undo(del.body.undo)).status).toBe(200);
    const steps = await get<{ title: string }[]>('/api/task-steps?taskId=muqaddimah');
    expect(steps.map((s) => s.title)).toEqual(['Chapter 2', 'Chapter 3, sections 1–15', 'Chapter 6, sections 34–37']);
    const day = await get<DayView>('/api/day');
    expect(ofType(day, 'block').map((b) => b.taskId)).toContain('muqaddimah');
  });

  it('uses each Undo token once', async () => {
    const del = await call('DELETE', '/api/tasks/quant');
    expect((await undo(del.body.undo)).status).toBe(200);
    expect((await undo(del.body.undo)).status).toBe(404);
  });

  it('adds, edits, and removes steps', async () => {
    const add = await call<{ item: { id: string; taskId: string } }>('POST', '/api/tasks/shopping/steps', { title: 'Soap' });
    expect(add.status).toBe(201);
    expect(add.body.item.taskId).toBe('shopping');
    expect((await call('PATCH', `/api/task-steps/${add.body.item.id}`, { done: true })).status).toBe(200);
    expect((await call('DELETE', `/api/task-steps/${add.body.item.id}`)).status).toBe(200);
    expect((await call('POST', '/api/tasks/nope/steps', { title: 'Soap' })).status).toBe(404);
  });
});

describe('blocks', () => {
  it('places a task on the schedule with its title and next step', async () => {
    const { body } = await call<{ item: { id: string } }>('POST', '/api/blocks', {
      kind: 'task', taskId: 'muqaddimah', startAt: '2026-10-03T01:15:00Z', durationMinutes: 75,
    });
    const day = await get<DayView>('/api/day');
    const block = ofType(day, 'block').find((b) => b.id === body.item.id) as BlockItem;
    expect(block).toMatchObject({ title: 'Read The Muqaddimah', startMin: 1215, pinned: true, nextStep: 'Chapter 2', missed: false });
    expect(day.groups.week.find((t) => t.id === 'muqaddimah')?.scheduled).toEqual({ startAt: '2026-10-03T01:15:00Z' });
  });

  it('marks a task block missed once its time passes today', async () => {
    await call('POST', '/api/blocks', { kind: 'task', taskId: 'quant', startAt: '2026-10-02T17:00:00Z', durationMinutes: 60 });
    const block = ofType(await get<DayView>('/api/day'), 'block').find((b) => b.taskId === 'quant');
    expect(block?.missed).toBe(true);
  });

  it('moves a block and undoes the move', async () => {
    const moved = await call('PATCH', '/api/blocks/rso-fair', { startAt: '2026-10-02T22:00:00Z', tentative: true });
    expect(ofType(await get<DayView>('/api/day'), 'block')[0]).toMatchObject({ startMin: 1020, tentative: true });
    await undo(moved.body.undo);
    expect(ofType(await get<DayView>('/api/day'), 'block')[0]).toMatchObject({ startMin: 900, tentative: false });
  });

  it('needs a task for task blocks and a title for events', async () => {
    expect((await call('POST', '/api/blocks', { kind: 'task', startAt: '2026-10-02T22:00:00Z', durationMinutes: 30 })).status).toBe(400);
    expect((await call('POST', '/api/blocks', { kind: 'event', startAt: '2026-10-02T22:00:00Z', durationMinutes: 30 })).status).toBe(400);
    expect((await call('PATCH', '/api/blocks/rso-fair', { title: null })).status).toBe(400);
  });
});

describe('routines', () => {
  it('checks a step off for one day, with a streak on the gratitude step', async () => {
    await call('PUT', '/api/routine-step-checks/morning-step-6/2026-10-01');
    const check = await call('PUT', '/api/routine-step-checks/morning-step-6/2026-10-02');
    expect(check.status).toBe(200);
    const gratitude = async () => (await get<DayView>('/api/day')).daily.find((r) => r.routineId === 'morning')?.steps.at(-1);
    expect(await gratitude()).toMatchObject({ checked: true, streak: 2 });

    await undo(check.body.undo);
    expect(await gratitude()).toMatchObject({ checked: false, streak: 1 });
  });

  it('checks every step when the routine is checked, and the routine when every step is (spec §10)', async () => {
    const supplements = async () => (await get<DayView>('/api/day')).daily.find((r) => r.routineId === 'supplements')!;
    const all = await call<{ undo: string }>('PUT', '/api/routine-checks/supplements/2026-10-02');
    expect((await supplements()).steps.map((s) => s.checked)).toEqual([true, true]);
    await undo(all.body.undo);
    expect(await supplements()).toMatchObject({ checked: false, steps: [{ checked: false }, { checked: false }] });

    await call('PUT', '/api/routine-step-checks/supplements-step-1/2026-10-02');
    expect((await supplements()).checked).toBe(false);
    await call('PUT', '/api/routine-step-checks/supplements-step-2/2026-10-02');
    expect((await supplements()).checked).toBe(true);
    await call('DELETE', '/api/routine-step-checks/supplements-step-1/2026-10-02');
    expect(await supplements()).toMatchObject({ checked: false, steps: [{ checked: false }, { checked: true }] });
  });

  it('checks routine steps off on their own', async () => {
    await call('PUT', '/api/routine-step-checks/laundry-step-1/2026-10-03');
    const sat = await get<DayView>('/api/day/2026-10-03');
    expect(sat.daily.find((r) => r.routineId === 'laundry')?.steps.map((s) => s.checked)).toEqual([true, false, false, false, false]);
  });

  it('skips or moves a routine for one day only', async () => {
    await call('PUT', '/api/slot-exceptions/night-slot/2026-10-02', { skipped: true });
    await call('PUT', '/api/slot-exceptions/morning-slot/2026-10-02', { start: '10:00' });
    const fri = await get<DayView>('/api/day/2026-10-02');
    expect(ofType(fri, 'routine').map((r: RoutineItem) => [r.routineId, r.start, r.changed])).toEqual([['morning', '10:00', true]]);
    const sat = await get<DayView>('/api/day/2026-10-03');
    expect(ofType(sat, 'routine').map((r) => r.start)).toEqual(['09:00', '23:00']);

    await call('DELETE', '/api/slot-exceptions/night-slot/2026-10-02');
    expect(ofType(await get<DayView>('/api/day/2026-10-02'), 'routine')).toHaveLength(2);
  });

  it('creates a routine with steps and a time, and Undo deletes it all', async () => {
    const { status, body } = await call<{ item: { id: string }; undo: string }>('POST', '/api/routines', {
      title: 'Stretch', durationMinutes: 15, repeat: 'weekly', repeatDays: [1, 3], categoryId: 'routine',
      steps: [{ title: 'Legs' }], slots: [{ start: '08:00' }],
    });
    expect(status).toBe(201);
    const mon = await get<DayView>('/api/day/2026-10-05');
    expect(ofType(mon, 'routine').find((r) => r.routineId === body.item.id)).toMatchObject({ start: '08:00', durationMinutes: 15 });

    await undo(body.undo);
    expect((await call('GET', `/api/routines/${body.item.id}`)).status).toBe(404);
    expect(await get('/api/routine-slots?routineId=' + body.item.id)).toEqual([]);
  });

  it('puts a routine on the schedule with a new time', async () => {
    const { body } = await call<{ item: { durationMinutes: number } }>('POST', '/api/routines/supplements/slots', { start: '21:00' });
    expect(body.item.durationMinutes).toBe(5);
    expect((await get<DayView>('/api/day')).daily.find((r) => r.routineId === 'supplements')?.time).toBe('21:00');
  });

  it('validates repeats', async () => {
    expect((await call('POST', '/api/routines', { title: 'x', durationMinutes: 5, repeat: 'weekly' })).status).toBe(400);
    expect((await call('POST', '/api/routines', { title: 'x', durationMinutes: 5, repeat: 'weekly', repeatDays: [6], repeatEvery: 2 }))
      .status).toBe(400);
    expect((await call('POST', '/api/routines/morning/slots', { start: '9am' })).status).toBe(400);
  });
});

describe('classes', () => {
  it('skips one class and un-skips it', async () => {
    await call('PUT', '/api/class-skips/econ-disc/2026-10-02');
    let disc = ofType(await get<DayView>('/api/day'), 'class').find((c) => c.classId === 'econ-disc');
    expect(disc?.skipped).toBe(true);
    const month = await get<MonthView>('/api/month/2026-10');
    expect(month.days[1]!.skippedClasses.map((c) => c.classId)).toEqual(['econ-disc']);

    await call('DELETE', '/api/class-skips/econ-disc/2026-10-02');
    disc = ofType(await get<DayView>('/api/day'), 'class').find((c) => c.classId === 'econ-disc');
    expect(disc?.skipped).toBe(false);
  });

  it('creates, edits, and deletes a weekly class', async () => {
    const add = await call<{ item: { id: string; timeZone: string; days: number[] } }>('POST', '/api/classes', {
      code: 'CMSC 14100', kind: 'Lab', days: [4, 2, 2], start: '16:00', end: '17:20', categoryId: 'class',
    });
    expect(add.status).toBe(201);
    expect(add.body.item).toMatchObject({ timeZone: CHI, days: [2, 4] });
    expect((await call('PATCH', `/api/classes/${add.body.item.id}`, { end: '15:00' })).status).toBe(400);
    const del = await call('DELETE', `/api/classes/${add.body.item.id}`);
    expect(del.status).toBe(200);
  });
});

describe('Sometime lane and rollover', () => {
  it('commits a task to a day, then rolls it over the next morning', async () => {
    const put = await call('PUT', '/api/sometime/container', { date: '2026-10-02' });
    expect(put.status).toBe(200);
    expect((await get<DayView>('/api/day')).sometime.map((s) => s.taskId)).toEqual(['container']);

    clock = DateTime.fromISO('2026-10-03T09:00', { zone: CHI });
    const roll = await call<{ item: { today: string; moved: string[] }; undo: string }>('POST', '/api/rollover');
    expect(roll.body.item).toEqual({ today: '2026-10-03', moved: ['container'] });
    expect((await get<DayView>('/api/day')).sometime).toEqual([
      expect.objectContaining({ taskId: 'container', rolledFrom: '2026-10-02' }),
    ]);

    await undo(roll.body.undo);
    expect((await get<DayView>('/api/day/2026-10-02')).sometime.map((s) => s.taskId)).toEqual(['container']);
  });

  it('moves an unfinished past task block to today’s lane', async () => {
    await call('POST', '/api/blocks', { kind: 'task', taskId: 'quant', startAt: '2026-10-02T23:00:00Z', durationMinutes: 60 });
    clock = DateTime.fromISO('2026-10-03T09:00', { zone: CHI });
    await call('POST', '/api/rollover');
    const sat = await get<DayView>('/api/day');
    expect(ofType(sat, 'block')).toEqual([]);
    expect(sat.sometime).toEqual([expect.objectContaining({ taskId: 'quant', rolledFrom: '2026-10-02' })]);
    expect(ofType(await get<DayView>('/api/day/2026-10-02'), 'block').map((b) => b.taskId)).toEqual([null]); // only the RSO fair
  });

  it('returns no Undo when nothing moves', async () => {
    expect((await call('POST', '/api/rollover')).body).toEqual({ item: { today: '2026-10-02', moved: [] }, undo: null });
  });
});

describe('categories, check-ins, and settings', () => {
  it('deletes a custom category, unlinking its tasks, and Undo relinks them', async () => {
    const cat = await call<{ item: { id: string } }>('POST', '/api/categories', { name: 'Health', color: '#2BA5A5' });
    await call('PATCH', '/api/tasks/gym', { categoryId: cat.body.item.id });
    const del = await call('DELETE', `/api/categories/${cat.body.item.id}`);
    expect((await get<{ categoryId: string | null }>('/api/tasks/gym')).categoryId).toBeNull();
    await undo(del.body.undo);
    expect((await get<{ categoryId: string | null }>('/api/tasks/gym')).categoryId).toBe(cat.body.item.id);
  });

  it('won’t delete a built-in category', async () => {
    expect((await call('DELETE', '/api/categories/class')).status).toBe(409);
  });

  it('hides a check-in question after Not yet until the snooze ends', async () => {
    await call('PATCH', '/api/conditions/cold', { snoozedUntil: '2026-10-03' });
    const fri = await get<DayView>('/api/day');
    expect(fri.checkIns.find((c) => c.conditionId === 'cold')).toBeUndefined();
    clock = DateTime.fromISO('2026-10-03T09:00', { zone: CHI });
    const sat = await get<DayView>('/api/day');
    expect(sat.checkIns.find((c) => c.conditionId === 'cold')).toBeDefined();
  });

  it('updates settings and merges notifications', async () => {
    const res = await call<{ item: { wakeTime: string; notify: Record<string, boolean> }; undo: string }>('PATCH', '/api/settings', {
      wakeTime: '08:30', notify: { checkIns: true },
    });
    expect(res.body.item.wakeTime).toBe('08:30');
    expect(res.body.item.notify).toMatchObject({ checkIns: true, classes: true });
    expect((await call('PATCH', '/api/settings', { timeZone: 'Nowhere' })).status).toBe(400);
    expect((await call('PATCH', '/api/settings', { weekStart: 3 })).status).toBe(400);
    await undo(res.body.undo);
    expect((await get<{ wakeTime: string }>('/api/settings')).wakeTime).toBe('09:00');
  });

  it('fills in notifications added after the row was saved', async () => {
    const res = await call<{ item: { notify: Record<string, boolean> } }>('PATCH', '/api/settings', { notify: { waitingEnds: false } });
    expect(res.body.item.notify).toMatchObject({ waitingEnds: false, classes: true });
    expect((await get<{ notify: Record<string, boolean> }>('/api/settings')).notify.waitingEnds).toBe(false);
  });

  it('counts unfinished tasks in each category', async () => {
    const before = await get<Record<string, number>>('/api/category-counts');
    expect(before.errand).toBeGreaterThan(0);
    const errand = (await get<{ id: string; categoryId: string | null }[]>('/api/tasks')).find((x) => x.categoryId === 'errand')!;
    await call('PATCH', `/api/tasks/${errand.id}`, { doneAt: FRI_3PM.toUTC().toISO() });
    expect((await get<Record<string, number>>('/api/category-counts')).errand ?? 0).toBe(before.errand! - 1);
  });

  it('saves and clears the Canvas feed link', async () => {
    await call('PATCH', '/api/settings', { canvasFeedUrl: 'https://canvas.uchicago.edu/feeds/calendars/user_abc.ics' });
    expect((await get<{ canvasFeedUrl: string | null }>('/api/settings')).canvasFeedUrl).toContain('canvas');
    expect((await call('PATCH', '/api/settings', { canvasFeedUrl: 'not a link' })).status).toBe(400);
    await call('PATCH', '/api/settings', { canvasFeedUrl: null });
    expect((await get<{ canvasFeedUrl: string | null }>('/api/settings')).canvasFeedUrl).toBeNull();
  });

  it('uses a fixed time zone setting over the device zone', async () => {
    await call('PATCH', '/api/settings', { timeZone: 'America/New_York' });
    expect((await get<DayView>('/api/day?tz=America/Los_Angeles')).zone).toBe('America/New_York');
  });
});

describe('decisions and check-ins', () => {
  type Decided = { item: { made: { id: string; title: string; window: string } | null; skipped: { classId: string; date: string } | null }; undo: string };

  it('Yes turns a decision into a task in its category, and Undo brings the decision back', async () => {
    const res = await call<Decided>('POST', '/api/tasks/blanket/decide', { yes: true });
    expect(res.status).toBe(200);
    expect(res.body.item.made).toMatchObject({ title: 'Get a new blanket', window: 'soon' });
    expect((await call('GET', '/api/tasks/blanket')).status).toBe(404);
    const day = await get<DayView>('/api/day');
    expect(day.groups.soon.find((t) => t.id === res.body.item.made!.id)).toMatchObject({ categoryId: 'errand' });
    expect(ids(day.groups.decide)).not.toContain('blanket');

    await undo(res.body.undo);
    const after = await get<DayView>('/api/day');
    expect(ids(after.groups.decide)).toContain('blanket');
    expect(after.groups.soon.find((t) => t.title === 'Get a new blanket')).toBeUndefined();
  });

  it('Yes on "Skip econ discussion Friday?" skips that class, and Undo un-skips it', async () => {
    const res = await call<Decided>('POST', '/api/tasks/skip-disc/decide', { yes: true });
    expect(res.body.item.skipped).toEqual({ classId: 'econ-disc', date: '2026-10-02' });
    const disc = (d: DayView) => ofType(d, 'class').find((c) => c.classId === 'econ-disc')!;
    expect(disc(await get<DayView>('/api/day')).skipped).toBe(true);
    await undo(res.body.undo);
    const after = await get<DayView>('/api/day');
    expect(disc(after).skipped).toBe(false);
    expect(ids(after.groups.decide)).toContain('skip-disc');
  });

  it('No drops the decision without doing anything else', async () => {
    const res = await call<Decided>('POST', '/api/tasks/skip-disc/decide', { yes: false });
    expect(res.body.item).toEqual({ made: null, skipped: null });
    const day = await get<DayView>('/api/day');
    expect(ids(day.groups.decide)).not.toContain('skip-disc');
    expect(ofType(day, 'class').find((c) => c.classId === 'econ-disc')!.skipped).toBe(false);
  });

  it('only answers decisions', async () => {
    expect((await call('POST', '/api/tasks/quant/decide', { yes: true })).status).toBe(409);
    expect((await call('POST', '/api/tasks/nope/decide', { yes: true })).status).toBe(404);
    expect((await call('POST', '/api/tasks/blanket/decide', {})).status).toBe(400);
  });

  it('Yes on a check-in clears the condition from every task with it, and Undo puts it back', async () => {
    const res = await call<{ item: { cleared: { id: string }[] }; undo: string }>('POST', '/api/conditions/cold/answer');
    expect(ids(res.body.item.cleared)).toEqual(['gym', 'boxing']);
    const day = await get<DayView>('/api/day');
    // They stay in their own window, now as normal tasks.
    expect(day.groups.week.filter((x) => ['gym', 'boxing'].includes(x.id)).map((x) => x.condition)).toEqual([null, null]);
    expect(day.checkIns.find((c) => c.conditionId === 'cold')).toBeUndefined();
    expect((await get<{ answeredAt: string }>('/api/conditions/cold')).answeredAt).toBe('2026-10-02T20:00:00Z');

    await undo(res.body.undo);
    const after = await get<DayView>('/api/day');
    expect(after.checkIns.find((c) => c.conditionId === 'cold')).toBeDefined();
    expect(after.groups.week.find((x) => x.id === 'gym')?.condition).toMatchObject({ kind: 'if', conditionId: 'cold' });
    expect((await call('POST', '/api/conditions/nope/answer')).status).toBe(404);
  });

  it('marks a routine skipped in the checklist when its time is skipped for the day', async () => {
    await call('PUT', '/api/slot-exceptions/morning-slot/2026-10-02', { skipped: true });
    const day = await get<DayView>('/api/day');
    expect(day.daily.find((r) => r.routineId === 'morning')).toMatchObject({ skipped: true, time: null });
    expect(day.daily.find((r) => r.routineId === 'supplements')).toMatchObject({ skipped: false });
  });
});
