import { describe, expect, it } from 'vitest';
import type { BlockItem, ClassItem, MonthDay } from '../shared/api';
import { agendaDayLabel, agendaLines, monthDots } from './agenda';

const event = (over: Partial<BlockItem>) => ({ id: 'e', kind: 'event', title: 'RSO fair', startMin: 900, tentative: false, categoryId: 'life', ...over }) as BlockItem;
const skipped = { id: 'econ-disc@2026-10-02', code: 'ECON 20010', kind: 'Discussion', startMin: 810, categoryId: 'class' } as ClassItem;

const day = (over: Partial<MonthDay>): MonthDay => ({ date: '2026-10-02', deadlines: [], events: [], chores: [], skippedClasses: [], ...over });

describe('agendaLines', () => {
  it('lists deadlines, events, and skipped classes in time order, with day-only deadlines last', () => {
    const lines = agendaLines(day({
      deadlines: [
        { taskId: 'a', name: 'econ PSet 1', dueAt: null, dueDate: '2026-10-02', atMin: null, done: false },
        { taskId: 'b', name: 'the Muqaddimah reading', dueAt: 'x', dueDate: null, atMin: 840, done: false },
        { taskId: 'c', name: 'done one', dueAt: 'x', dueDate: null, atMin: 600, done: true },
      ],
      events: [event({}), event({ id: 'd', title: 'Dinner', startMin: 1140, tentative: true })],
      skippedClasses: [skipped],
    }));
    expect(lines.map((l) => l.text)).toEqual([
      'Skipping ECON 20010 discussion',
      'Due 2pm: The Muqaddimah reading',
      '3pm RSO fair',
      '7pm Dinner (roughly)',
      'Due: Econ PSet 1',
    ]);
    expect(lines.filter((l) => l.due)).toHaveLength(2);
  });
});

describe('agendaDayLabel', () => {
  it('names today, tomorrow, and other days', () => {
    expect(agendaDayLabel('2026-10-02', '2026-10-02')).toBe('Today, Oct 2');
    expect(agendaDayLabel('2026-10-02', '2026-10-03')).toBe('Tomorrow, Oct 3');
    expect(agendaDayLabel('2026-10-02', '2026-10-04')).toBe('Sunday, Oct 4');
  });
});

describe('monthDots', () => {
  it('puts unfinished deadlines first in red, then events, up to four', () => {
    const dots = monthDots(day({
      deadlines: [
        { taskId: 'a', name: 'a', dueAt: null, dueDate: '2026-10-02', atMin: null, done: false },
        { taskId: 'c', name: 'c', dueAt: null, dueDate: '2026-10-02', atMin: null, done: true },
      ],
      events: [event({}), event({ id: 'e2' }), event({ id: 'e3' }), event({ id: 'e4' })],
    }));
    expect(dots.map((d) => [d.key, d.due])).toEqual([['due-a', true], ['e', false], ['e2', false], ['e3', false]]);
    expect(dots[1]!.categoryId).toBe('life');
  });
});
