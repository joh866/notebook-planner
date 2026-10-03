import { describe, expect, it } from 'vitest';
import type { AddResult, AddedItem } from '../shared/api';
import { addMessage } from './addMessage';

const LABELS = { overdue: 'Overdue', near: 'Today or tomorrow', week: 'This week', soon: 'Soon', waiting: 'Waiting on something', decide: 'Needs a decision', ongoing: 'Ongoing' };
const CHI = 'America/Chicago';
const result = (added: AddedItem[], more: Partial<AddResult> = {}): AddResult => ({ added, chunks: 1, fellBack: 0, reason: null, changes: [], questions: [], offers: [], missing: [], ...more });
const msg = (r: AddResult) => addMessage(r, '2026-10-02', CHI, LABELS);

describe('addMessage', () => {
  it('names the group a single task went to', () => {
    expect(msg(result([{ kind: 'task', id: '1', title: 'Get razor', window: 'week' }]))).toBe('Added “Get razor” to This week. Sorted by AI.');
  });

  it('says when automatic scheduling penciled it in', () => {
    expect(msg(result([{ kind: 'task', id: '1', title: 'Get razor', window: 'week', penciled: '2026-10-02T21:00:00Z' }])))
      .toBe('Added “Get razor” to This week, penciled in today at 4pm. Sorted by AI.');
    expect(msg(result([
      { kind: 'task', id: '1', title: 'A', window: 'near', penciled: '2026-10-02T21:00:00Z' },
      { kind: 'task', id: '2', title: 'B', window: 'soon', penciled: null },
    ]))).toBe('Added 2 items: 2 tasks. Penciled in 1. Sorted by AI.');
  });

  it('says when a single event is, and where a Sometime task went', () => {
    expect(msg(result([{ kind: 'event', id: '1', title: 'Dinner', date: '2026-10-02', startAt: '2026-10-03T00:00:00Z' }])))
      .toBe('Added “Dinner” today at 7pm. Sorted by AI.');
    expect(msg(result([{ kind: 'sometime', id: '1', title: 'Pick up package', date: '2026-10-03' }])))
      .toBe('Added “Pick up package” to Sometime tomorrow. Sorted by AI.');
    expect(msg(result([{ kind: 'routine', id: '1', title: 'Stretch' }]))).toBe('Added the routine “Stretch”. Sorted by AI.');
  });

  it('counts several items by kind', () => {
    const added: AddedItem[] = [
      { kind: 'task', id: '1', title: 'A', window: 'soon' },
      { kind: 'sometime', id: '2', title: 'B', date: '2026-10-02' },
      { kind: 'routine', id: '3', title: 'C' },
      { kind: 'class', id: '4', title: 'D' },
      { kind: 'class', id: '5', title: 'E' },
    ];
    expect(msg(result(added))).toBe('Added 5 items: 2 tasks, 1 routine, and 2 classes. Sorted by AI.');
  });

  it('says when it’s a simple guess, and why', () => {
    const one: AddedItem[] = [{ kind: 'task', id: '1', title: 'Get razor', window: 'week' }];
    expect(msg(result(one, { fellBack: 1, reason: 'there’s no ANTHROPIC_API_KEY in .env' })))
      .toBe('Added “Get razor” to This week. The AI wasn’t available, so this is a simple guess (there’s no ANTHROPIC_API_KEY in .env).');
    expect(msg(result(one, { chunks: 4, fellBack: 1, reason: 'the AI took too long to answer' })))
      .toBe('Added “Get razor” to This week. Part of this is a simple guess, because the AI didn’t answer for 1 of 4 parts (the AI took too long to answer).');
  });

  it('says when nothing was found', () => {
    expect(msg(result([]))).toBe('Couldn’t find anything to add in that.');
  });
});
