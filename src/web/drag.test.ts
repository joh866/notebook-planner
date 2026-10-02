import { describe, expect, it } from 'vitest';
import type { BlockItem, ClassItem, RoutineItem } from '../shared/api';
import { accepts, movable, type DragItem } from './drag';
import { shown } from './Schedule';

const TODAY = '2026-10-02';
const placed = { startAt: '2026-10-02T20:00:00Z', startMin: 900, endMin: 960 };
const block = (over: Partial<BlockItem>): BlockItem => ({
  type: 'block', id: 'b', kind: 'task', title: 'Read', categoryId: null, taskId: 't', durationMinutes: 60, tentative: false,
  label: null, location: null, pinned: true, reason: null, rolledFrom: null, done: false, missed: false, steps: [], nextStep: null,
  ...placed, ...over,
});
const routine: RoutineItem = {
  type: 'routine', id: 's@d', slotId: 's', routineId: 'r', title: 'Night routine', categoryId: 'routine', start: '15:00',
  durationMinutes: 60, changed: false, checked: false, steps: [], ...placed,
};
const klass: ClassItem = {
  type: 'class', id: 'c@d', classId: 'c', homeDate: TODAY, code: 'ECON 20010', kind: 'Lecture', fullName: null, location: null,
  categoryId: 'class', skipped: false, ...placed,
};
const asBlock = (item: BlockItem | RoutineItem | ClassItem): DragItem => {
  const b = shown(item, TODAY);
  return { type: 'block', b, title: b.title, minutes: 60 };
};

describe('drop rules (spec §10)', () => {
  const card: DragItem = { type: 'task', taskId: 't', title: 'Read', minutes: 30 };
  const chip: DragItem = { type: 'sometime', taskId: 't', title: 'Read', minutes: 30 };
  const row: DragItem = { type: 'routine', routineId: 'r', title: 'Meditate', minutes: 10 };

  it('task cards go on the schedule or the Sometime lane', () => {
    expect([accepts(card, 'grid'), accepts(card, 'sometime'), accepts(card, 'tasks')]).toEqual([true, true, false]);
  });

  it('Sometime chips go on the schedule or back to the list', () => {
    expect([accepts(chip, 'grid'), accepts(chip, 'sometime'), accepts(chip, 'tasks')]).toEqual([true, false, true]);
  });

  it('Daily checklist rows go on the schedule only', () => {
    expect([accepts(row, 'grid'), accepts(row, 'sometime'), accepts(row, 'tasks')]).toEqual([true, false, false]);
  });

  it('task blocks move, go to the Sometime lane, or go back to the list', () => {
    const b = asBlock(block({}));
    expect([accepts(b, 'grid'), accepts(b, 'sometime'), accepts(b, 'tasks')]).toEqual([true, true, true]);
  });

  it('events and routines move or come off the schedule, but have no Sometime', () => {
    for (const b of [asBlock(block({ kind: 'event', taskId: null })), asBlock(routine)]) {
      expect([accepts(b, 'grid'), accepts(b, 'sometime'), accepts(b, 'tasks')]).toEqual([true, false, true]);
    }
  });

  it('classes, skipped classes, and open time stay put', () => {
    expect(movable(shown(klass, TODAY))).toBe(false);
    expect(movable(shown({ ...klass, skipped: true }, TODAY))).toBe(false);
    expect(movable(shown(block({ kind: 'open', taskId: null }), TODAY))).toBe(false);
    expect(movable(shown(block({ kind: 'event', tentative: true, taskId: null }), TODAY))).toBe(true);
    expect(accepts(asBlock(klass), 'grid')).toBe(false);
  });

  it('a resize never lands in a drop zone', () => {
    const b = shown(block({}), TODAY);
    expect(accepts({ type: 'resize', b, title: 'Read', minutes: 60 }, 'grid')).toBe(false);
  });
});
