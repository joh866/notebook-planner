import { describe, expect, it } from 'vitest';
import { lookForHour } from './look';

describe('lookForHour', () => {
  it('is day from 8am to 8pm and night otherwise', () => {
    expect(lookForHour(7)).toBe('night');
    expect(lookForHour(8)).toBe('day');
    expect(lookForHour(19)).toBe('day');
    expect(lookForHour(20)).toBe('night');
    expect(lookForHour(0)).toBe('night');
  });

  it('respects a forced setting', () => {
    expect(lookForHour(12, 'night')).toBe('night');
    expect(lookForHour(23, 'day')).toBe('day');
  });
});
