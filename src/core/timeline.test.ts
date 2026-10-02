import { describe, expect, it } from 'vitest';
import { BAND_PX, HOUR_PX, columns, hourLines, segments, stepParts, totalHeight, yOf, type SegmentInput } from './timeline';

const base: SegmentInput = { wakeMin: 540, bedMin: 1440, items: [], nowMin: null, opened: { early: false, late: false } };
const state = (input: Partial<SegmentInput>) => segments({ ...base, ...input }).map((s) => [s.id, s.open, s.forced]);

describe('segments', () => {
  it('folds early morning and late night by default', () => {
    expect(state({})).toEqual([['early', false, false], ['core', true, true], ['late', false, false]]);
    expect(totalHeight(segments(base))).toBe(BAND_PX + 15 * HOUR_PX + BAND_PX);
  });

  it('opens a strip the user clicked, which can be hidden again', () => {
    expect(state({ opened: { early: true, late: false } })[0]).toEqual(['early', true, false]);
  });

  it('forces a strip open when something is scheduled there', () => {
    expect(state({ items: [{ startMin: 450, endMin: 480 }] })[0]).toEqual(['early', true, true]);
    expect(state({ items: [{ startMin: 1500, endMin: 1530 }] })[2]).toEqual(['late', true, true]);
    // Ending exactly at wake-up doesn't count.
    expect(state({ items: [{ startMin: 510, endMin: 540 }] })[0]).toEqual(['early', true, true]);
    expect(state({ items: [{ startMin: 540, endMin: 570 }] })[0]).toEqual(['early', false, false]);
  });

  it('forces a strip open when now is inside it or within 2 hours of bedtime', () => {
    expect(state({ nowMin: 420 })[0]).toEqual(['early', true, true]);
    expect(state({ nowMin: 1319 })[2]).toEqual(['late', false, false]);
    expect(state({ nowMin: 1320 })[2]).toEqual(['late', true, true]);
  });

  it('drops a strip with nothing in it', () => {
    expect(state({ wakeMin: 360 }).map((s) => s[0])).toEqual(['core', 'late']);
  });
});

describe('yOf', () => {
  it('maps minutes through folded and open stretches', () => {
    const segs = segments(base);
    expect(yOf(segs, 360)).toBe(0);
    expect(yOf(segs, 450)).toBe(BAND_PX / 2);
    expect(yOf(segs, 540)).toBe(BAND_PX);
    expect(yOf(segs, 600)).toBe(BAND_PX + HOUR_PX);
    expect(yOf(segs, 1440)).toBe(BAND_PX + 15 * HOUR_PX);
    expect(yOf(segs, 1620)).toBe(totalHeight(segs));
    expect(yOf(segs, 2000)).toBe(totalHeight(segs));
  });

  it('gives an opened strip full hours', () => {
    const segs = segments({ ...base, opened: { early: true, late: false } });
    expect(yOf(segs, 540)).toBe(3 * HOUR_PX);
  });
});

describe('hourLines', () => {
  it('draws whole hours only in open stretches', () => {
    const lines = hourLines(segments(base));
    expect(lines[0]).toBe(540);
    expect(lines.at(-1)).toBe(1440);
    expect(lines).toHaveLength(16);
  });
});

describe('columns', () => {
  it('puts overlapping blocks side by side', () => {
    const list = [
      { startMin: 600, endMin: 660 },
      { startMin: 630, endMin: 690 },
      { startMin: 700, endMin: 760 },
      { startMin: 660, endMin: 690 },
    ];
    expect(columns(list)).toEqual([{ col: 0, cols: 2 }, { col: 1, cols: 2 }, { col: 0, cols: 1 }, { col: 0, cols: 2 }]);
  });

  it('gives a lone block the full width', () => {
    expect(columns([{ startMin: 0, endMin: 30 }])).toEqual([{ col: 0, cols: 1 }]);
    expect(columns([])).toEqual([]);
  });
});

describe('stepParts', () => {
  const laundry = [
    { title: 'Load the washer', minutes: 10, waiting: false },
    { title: 'Washing', minutes: 55, waiting: true },
    { title: 'Move to the dryer', minutes: 5, waiting: false },
    { title: 'Drying', minutes: 55, waiting: true },
    { title: 'Fold and put away', minutes: 15, waiting: false },
  ];

  it('lays laundry’s parts end to end', () => {
    const parts = stepParts(600, laundry);
    expect(parts.map((p) => [p.startMin, p.endMin, p.waiting])).toEqual([
      [600, 610, false], [610, 665, true], [665, 670, false], [670, 725, true], [725, 740, false],
    ]);
  });

  it('is empty without a waiting step', () => {
    expect(stepParts(600, [{ title: 'Do the problems', minutes: 60, waiting: false }])).toEqual([]);
    expect(stepParts(600, [{ title: 'Chapter 2', minutes: null, waiting: false }])).toEqual([]);
  });
});
