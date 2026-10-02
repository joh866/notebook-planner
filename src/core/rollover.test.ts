import { describe, expect, it } from 'vitest';
import { rollover } from './rollover';

const CHI = 'America/Chicago';
const TODAY = '2026-10-02';

describe('rollover', () => {
  const tasks = [{ id: 'book' }, { id: 'quant' }, { id: 'done', doneAt: '2026-10-01T20:00:00Z' }, { id: 'future' }];

  it('moves unfinished tasks from past blocks to today’s Sometime lane', () => {
    const blocks = [
      { id: 'b1', taskId: 'book', startAt: '2026-10-02T02:00:00Z' }, // Oct 1, 9pm Chicago
      { id: 'b2', taskId: 'done', startAt: '2026-10-01T15:00:00Z' },
    ];
    expect(rollover(TODAY, CHI, tasks, blocks, [])).toEqual({
      removeBlockIds: ['b1'],
      sometime: [{ taskId: 'book', date: TODAY, rolledFrom: '2026-10-01' }],
    });
  });

  it('treats a block after midnight as part of the previous day', () => {
    // 2am Oct 2 in Chicago is still Oct 1's night, so at 4am on Oct 2 it rolls over.
    const blocks = [{ id: 'b1', taskId: 'book', startAt: '2026-10-02T07:00:00Z' }];
    expect(rollover(TODAY, CHI, tasks, blocks, []).sometime).toEqual([
      { taskId: 'book', date: TODAY, rolledFrom: '2026-10-01' },
    ]);
    // But on Oct 1 it hasn't rolled yet.
    expect(rollover('2026-10-01', CHI, tasks, blocks, []).removeBlockIds).toEqual([]);
  });

  it('moves past Sometime entries and keeps the day they first came from', () => {
    const sometime = [
      { taskId: 'quant', date: '2026-10-01', rolledFrom: '2026-09-30' },
      { taskId: 'book', date: '2026-09-29' },
      { taskId: 'done', date: '2026-10-01' },
    ];
    expect(rollover(TODAY, CHI, tasks, [], sometime)).toEqual({
      removeBlockIds: [],
      sometime: [
        { taskId: 'quant', date: TODAY, rolledFrom: '2026-09-30' },
        { taskId: 'book', date: TODAY, rolledFrom: '2026-09-29' },
      ],
    });
  });

  it('leaves tasks alone that are already on today or later', () => {
    const blocks = [
      { id: 'old', taskId: 'book', startAt: '2026-09-30T20:00:00Z' },
      { id: 'new', taskId: 'book', startAt: '2026-10-03T20:00:00Z' },
    ];
    const sometime = [{ taskId: 'future', date: '2026-10-05' }, { taskId: 'quant', date: TODAY }];
    expect(rollover(TODAY, CHI, tasks, blocks, sometime)).toEqual({ removeBlockIds: [], sometime: [] });
  });

  it('rolls a task with several past blocks once, from its latest day', () => {
    const blocks = [
      { id: 'b1', taskId: 'book', startAt: '2026-09-29T20:00:00Z' },
      { id: 'b2', taskId: 'book', startAt: '2026-10-01T20:00:00Z' },
    ];
    const sometime = [{ taskId: 'book', date: '2026-09-28' }];
    expect(rollover(TODAY, CHI, tasks, blocks, sometime)).toEqual({
      removeBlockIds: ['b1', 'b2'],
      sometime: [{ taskId: 'book', date: TODAY, rolledFrom: '2026-10-01' }],
    });
  });

  it('does nothing when there is nothing to roll', () => {
    expect(rollover(TODAY, CHI, tasks, [], [])).toEqual({ removeBlockIds: [], sometime: [] });
  });
});
