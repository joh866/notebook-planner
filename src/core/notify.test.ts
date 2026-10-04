import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { BlockItem, ClassItem, DaySchedule, DeadlineView, RoutineItem } from '../shared/api';
import type { Notify } from '../shared/schemas';
import { notesDue, notesFor, type NotifyInput } from './notify';

const CHI = 'America/Chicago';
const at = (date: string, hhmm: string) => DateTime.fromISO(`${date}T${hhmm}`, { zone: CHI });
const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;
const local = (d: DateTime) => d.setZone(CHI).toFormat('MM-dd HH:mm');
const ALL: Notify = { classes: true, taskStarts: true, deadlines: true, morningSummary: true, planTomorrow: true, checkIns: true, waitingEnds: true };

const base = { categoryId: null };
const cls = (date: string, hhmm: string, skipped = false): ClassItem => ({
  ...base, type: 'class', id: `econ@${date}`, classId: 'econ', homeDate: date, code: 'ECON 20010', kind: 'Lecture',
  fullName: 'Elements of Economic Analysis', location: 'Saieh 021', skipped,
  startAt: iso(at(date, hhmm)), startMin: 0, endMin: 80,
});
const blk = (id: string, date: string, hhmm: string, minutes: number, more: Partial<BlockItem> = {}): BlockItem => ({
  ...base, type: 'block', id, kind: 'task', title: id, taskId: id, startAt: iso(at(date, hhmm)), startMin: 0, endMin: minutes,
  durationMinutes: minutes, tentative: false, label: null, location: null, pinned: false, reason: null, rolledFrom: null,
  done: false, missed: false, steps: [], nextStep: null, condition: null, askNow: false, items: [], logged: null, running: false, ...more,
});
const laundry = (date: string, checked: string[] = []): RoutineItem => ({
  ...base, type: 'routine', id: `l@${date}`, slotId: 'l', routineId: 'laundry', title: 'Laundry', start: '10:00', durationMinutes: 140,
  changed: false, checked: false, startAt: iso(at(date, '10:00')), startMin: 600, endMin: 740,
  steps: [
    { title: 'Load the washer', minutes: 10, waiting: false },
    { title: 'Washing', minutes: 55, waiting: true },
    { title: 'Move to the dryer', minutes: 5, waiting: false },
    { title: 'Drying', minutes: 55, waiting: true },
    { title: 'Fold and put away', minutes: 15, waiting: false },
  ].map((s, i) => ({ ...s, id: String(i), checked: checked.includes(s.title), streak: null })),
});
const due = (name: string, date: string, hhmm: string | null, done = false): DeadlineView => ({
  taskId: name, name, dueAt: hhmm ? iso(at(date, hhmm)) : null, dueDate: hhmm ? null : date, atMin: null, done,
});
const sched = (date: string, schedule: DaySchedule['schedule'] = [], deadlines: DeadlineView[] = []): DaySchedule => ({ date, schedule, deadlines, sometime: [] });

function input(now: DateTime, day: DaySchedule, tomorrow: DaySchedule, more: Partial<NotifyInput> = {}): NotifyInput {
  return { now, zone: CHI, wakeTime: '09:00', bedTime: '00:00', on: ALL, day, tomorrow, checkIns: [], ...more };
}

describe('notifications (spec §13)', () => {
  const thu = '2026-10-08';
  const fri = '2026-10-09';
  const full = input(
    at(thu, '05:00'),
    sched(thu, [cls(thu, '09:30'), cls(thu, '13:30', true), blk('Read SOSC', thu, '15:00', 60, { nextStep: 'Chapter 2' }), laundry(thu)], [due('Get razor', thu, null)]),
    sched(fri, [cls(fri, '09:30')], [due('Econ PSet 1', fri, '12:00'), due('Done thing', fri, null, true)]),
    { checkIns: [{ conditionId: 'c', question: 'Is the cold fully gone?', titles: ['Gym'] }, { conditionId: 'd', question: 'Did ARCH reply?', titles: ['ARCH'] }] },
  );

  it('lists every kind at its time, in order', () => {
    expect(notesFor(full).map((n) => [local(n.at), n.kind, n.title, n.body])).toEqual([
      ['10-08 09:00', 'deadlines', 'Due today', 'Get razor'],
      ['10-08 09:15', 'morningSummary', 'Good morning', '1 class, at 9:30am; 1 task planned; due today: Get razor.'],
      ['10-08 09:20', 'classes', 'ECON 20010 lecture in 10 minutes', 'Saieh 021'],
      // Laundry: each waiting part's end says what's next. The last part isn't waiting, so nothing after it.
      ['10-08 11:05', 'waitingEnds', 'Laundry: Washing is done', 'Next: Move to the dryer.'],
      ['10-08 12:00', 'checkIns', 'Check-in', 'Is the cold fully gone? (and 1 more question)'],
      ['10-08 12:05', 'waitingEnds', 'Laundry: Drying is done', 'Next: Fold and put away.'],
      ['10-08 15:00', 'taskStarts', 'Read SOSC', '3pm–4pm. First: Chapter 2'],
      ['10-08 19:00', 'deadlines', 'Due tomorrow', 'Econ PSet 1 at 12pm'],
      ['10-08 23:00', 'planTomorrow', 'Plan tomorrow', 'Tomorrow: 1 class, at 9:30am; due: Econ PSet 1 at 12pm. Open the planner to plan it.'],
      // Tomorrow's class too, so one just after 4am isn't missed.
      ['10-09 09:20', 'classes', 'ECON 20010 lecture in 10 minutes', 'Saieh 021'],
    ]);
  });

  it('leaves out kinds that are switched off', () => {
    const on = { ...ALL, classes: false, waitingEnds: false, morningSummary: false, planTomorrow: false };
    expect(notesFor({ ...full, on }).map((n) => n.kind)).toEqual(['deadlines', 'checkIns', 'taskStarts', 'deadlines']);
  });

  it('sends only what is due now, up to 10 minutes late', () => {
    expect(notesDue({ ...full, now: at(thu, '09:09') }).map((n) => n.title)).toEqual(['Due today']);
    expect(notesDue({ ...full, now: at(thu, '09:20') }).map((n) => n.title)).toEqual(['Good morning', 'ECON 20010 lecture in 10 minutes']);
    expect(notesDue({ ...full, now: at(thu, '09:26') }).map((n) => n.title)).toEqual(['ECON 20010 lecture in 10 minutes']);
    expect(notesDue({ ...full, now: at(thu, '08:59') })).toEqual([]);
  });

  it('skips what is done, checked, or no longer next', () => {
    const day = sched(thu, [blk('Read SOSC', thu, '15:00', 60, { done: true }), laundry(thu, ['Move to the dryer'])]);
    expect(notesFor(input(at(thu, '05:00'), day, sched(fri), { on: { ...ALL, morningSummary: false, planTomorrow: false } })).map((n) => n.title))
      .toEqual(['Laundry: Drying is done']);
    const checked = { ...laundry(thu), checked: true };
    expect(notesFor(input(at(thu, '05:00'), sched(thu, [checked]), sched(fri), { on: { ...ALL, morningSummary: false, planTomorrow: false } }))).toEqual([]);
  });

  it('gives a moved block a new key, so it is sent again at its new time', () => {
    const a = notesFor(input(at(thu, '05:00'), sched(thu, [blk('x', thu, '15:00', 30)]), sched(fri))).find((n) => n.kind === 'taskStarts')!;
    const b = notesFor(input(at(thu, '05:00'), sched(thu, [blk('x', thu, '16:00', 30)]), sched(fri))).find((n) => n.kind === 'taskStarts')!;
    expect(a.key).not.toBe(b.key);
  });

  it('a timed "if" block asks if it is still on, and a quick block lists what is left', () => {
    const day = sched(thu, [
      blk('Go club', thu, '18:00', 60, { condition: { kind: 'if', conditionId: 'q', question: 'Is go club open?', text: 'if it’s open' } }),
      blk('q1', thu, '16:00', 30, { kind: 'quick', title: null, items: [
        { taskId: 'a', title: 'Text Sam', categoryId: null, done: true, minutes: 5 },
        { taskId: 'b', title: 'Email TA', categoryId: null, done: false, minutes: 10 },
      ] }),
    ]);
    const notes = notesFor(input(at(thu, '05:00'), day, sched(fri))).filter((n) => n.kind === 'taskStarts');
    expect(notes.map((n) => [n.title, n.body])).toEqual([
      ['Quick things', 'Email TA'],
      ['Go club', '6pm–7pm. Still on? Open the planner to say yes or no.'],
    ]);
  });

  it('morning deadlines leave out ones already past at wake time; an empty day still gets a summary', () => {
    const day = sched(thu, [], [due('Early form', thu, '08:00'), due('Late form', thu, '17:00')]);
    const notes = notesFor(input(at(thu, '05:00'), day, sched(fri)));
    expect(notes.find((n) => n.title === 'Due today')!.body).toBe('Late form at 5pm');
    const empty = notesFor(input(at(thu, '05:00'), sched(thu), sched(fri)));
    expect(empty.find((n) => n.kind === 'morningSummary')!.body).toBe('Nothing on the schedule yet. Plan your day when you’re ready.');
    expect(empty.find((n) => n.kind === 'planTomorrow')!.body).toBe('Open the planner to plan it.');
    expect(empty.some((n) => n.kind === 'checkIns' || n.kind === 'deadlines')).toBe(false);
  });

  it('uses the shown zone: a bedtime of 12am in New York is 11pm there', () => {
    const ny = notesFor(input(at(thu, '05:00'), sched(thu), sched(fri), { zone: 'America/New_York' }));
    expect(ny.find((n) => n.kind === 'planTomorrow')!.at.setZone('America/New_York').toFormat('HH:mm')).toBe('23:00');
  });
});
