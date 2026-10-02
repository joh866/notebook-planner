import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { groupTasks, type GroupTask } from './groups';

const CHI = 'America/Chicago';
const now = DateTime.fromISO('2026-10-02T15:00', { zone: CHI });

const task = (id: string, extra: Partial<GroupTask>): GroupTask => ({ id, window: 'soon', sortOrder: 0, ...extra });

describe('groupTasks', () => {
  it('puts tasks in their effective group', () => {
    const g = groupTasks(
      [
        task('late', { window: 'week', dueDate: '2026-10-01' }),
        task('tomorrow', { window: 'soon', dueDate: '2026-10-03' }),
        task('tue', { window: 'soon', dueAt: '2026-10-06T19:00:00Z' }),
        task('far', { window: 'soon', dueDate: '2026-10-20' }),
        task('learn', { window: 'ongoing' }),
        task('maybe', { window: 'decide' }),
        task('finished', { window: 'week', doneAt: '2026-10-01T12:00:00Z' }),
      ],
      now, CHI, CHI,
    );
    expect(g.overdue.map((t) => t.id)).toEqual(['late']);
    expect(g.near.map((t) => t.id)).toEqual(['tomorrow']);
    expect(g.week.map((t) => t.id)).toEqual(['tue']);
    expect(g.soon.map((t) => t.id)).toEqual(['far']);
    expect(g.ongoing.map((t) => t.id)).toEqual(['learn']);
    expect(g.decide.map((t) => t.id)).toEqual(['maybe']);
    expect(g.done.map((t) => t.id)).toEqual(['finished']);
  });

  it('sorts deadlines first, earliest first, then by the user’s order', () => {
    const g = groupTasks(
      [
        task('b', { window: 'week', sortOrder: 2 }),
        task('a', { window: 'week', sortOrder: 1 }),
        task('dayOnly', { window: 'week', dueDate: '2026-10-06', sortOrder: 9 }),
        task('timed', { window: 'week', dueAt: '2026-10-06T19:00:00Z', sortOrder: 9 }),
      ],
      now, CHI, CHI,
    );
    expect(g.week.map((t) => t.id)).toEqual(['timed', 'dayOnly', 'a', 'b']);
  });

  it('groups waiting tasks under their check-in question', () => {
    const g = groupTasks(
      [
        task('gym', { window: 'waiting', conditionId: 'cold', sortOrder: 0 }),
        task('arch', { window: 'waiting', conditionId: 'arch', sortOrder: 1 }),
        task('boxing', { window: 'waiting', conditionId: 'cold', sortOrder: 2 }),
      ],
      now, CHI, CHI,
    );
    expect(g.waiting).toEqual([
      { conditionId: 'cold', tasks: [expect.objectContaining({ id: 'gym' }), expect.objectContaining({ id: 'boxing' })] },
      { conditionId: 'arch', tasks: [expect.objectContaining({ id: 'arch' })] },
    ]);
  });

  it('lists the most recently done first', () => {
    const g = groupTasks(
      [
        task('old', { doneAt: '2026-09-30T12:00:00Z' }),
        task('new', { doneAt: '2026-10-02T12:00:00Z' }),
      ],
      now, CHI, CHI,
    );
    expect(g.done.map((t) => t.id)).toEqual(['new', 'old']);
  });
});
