import { describe, expect, it } from 'vitest';
import type { BlockItem, ClassItem, DaySchedule, RoutineItem } from '../shared/api';
import { weekRows } from './weekList';

const block = (over: Partial<BlockItem>) => ({ type: 'block', id: 'b', kind: 'event', title: 'RSO fair', startMin: 900, endMin: 960, tentative: false, categoryId: 'life', done: false, ...over }) as BlockItem;
const cls = { type: 'class', id: 'econ@2026-10-02', code: 'ECON 20010', kind: 'Lecture', startMin: 630, endMin: 710, categoryId: null, skipped: false } as ClassItem;
const routine = { type: 'routine', id: 'r', title: 'Meditate', startMin: 480, endMin: 490, categoryId: null } as RoutineItem;

describe('weekRows', () => {
  it('lists deadlines, classes, events, tasks, and Sometime in time order, without routines or open time', () => {
    const day: DaySchedule = {
      date: '2026-10-02',
      schedule: [
        block({}),
        routine,
        cls,
        { ...cls, id: 'skip', code: 'MATH 15300', kind: '', startMin: 540, skipped: true },
        block({ id: 'o', kind: 'open', title: null, startMin: 700 }),
        block({ id: 't', kind: 'task', title: 'Math PSet 1', startMin: 1200, categoryId: 'class', done: true }),
        block({ id: 'd', title: 'Dinner', startMin: 1140, tentative: true }),
      ],
      deadlines: [
        { taskId: 'a', name: 'econ PSet 1', dueAt: null, dueDate: '2026-10-02', atMin: null, done: false },
        { taskId: 'm', name: 'the Muqaddimah reading', dueAt: 'x', dueDate: null, atMin: 840, done: false },
        { taskId: 'x', name: 'finished', dueAt: 'x', dueDate: null, atMin: 600, done: true },
      ],
      sometime: [{ taskId: 's', title: 'Shopping run', categoryId: 'errand', done: false, rolledFrom: null, minutes: 60, due: false }],
      allDay: [],
    };
    expect(weekRows(day).map((r) => [r.time, r.text, r.look])).toEqual([
      ['9am', 'MATH 15300', 'skipped'],
      ['10:30am', 'ECON 20010 lecture', 'class'],
      ['2pm', 'Due: The Muqaddimah reading', 'due'],
      ['3pm', 'RSO fair', 'event'],
      ['7pm', 'Dinner (roughly)', 'event'],
      ['8pm', 'Math PSet 1', 'task'],
      ['End of day', 'Due: Econ PSet 1', 'due'],
      ['Sometime', 'Shopping run', 'sometime'],
    ]);
    expect(weekRows(day).find((r) => r.key === 't')!.done).toBe(true);
  });

  it('is empty on a day with nothing on it', () => {
    expect(weekRows({ date: '2026-10-03', schedule: [routine], deadlines: [], sometime: [], allDay: [] })).toEqual([]);
  });
});
