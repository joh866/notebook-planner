import { describe, expect, it } from 'vitest';
import { isQuick, quickLength } from './length';

describe('quick tasks (spec §10)', () => {
  it('counts tasks marked quick, or estimated at 15 minutes or less', () => {
    expect(isQuick({ quick: true })).toBe(true);
    expect(isQuick({ estLow: 5, estHigh: 15 })).toBe(true);
    expect(isQuick({ estLow: 10, estHigh: 20 })).toBe(false);
    expect(isQuick({})).toBe(false);
    expect(isQuick({ quick: true, sessionMinutes: 10 })).toBe(false);
  });

  it('takes the low end of the estimate inside a batch, or 10 minutes', () => {
    expect(quickLength({ estLow: 5, estHigh: 15 })).toBe(5);
    expect(quickLength({ quick: true })).toBe(10);
    expect(quickLength({ estLow: 40 })).toBe(15);
  });
});
