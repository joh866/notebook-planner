import { describe, expect, it } from 'vitest';
import { blockLength } from './length';

describe('blockLength', () => {
  it('uses the sitting, then the session, then the low estimate, then 30 minutes', () => {
    expect(blockLength({ sittingMinutes: 75, estLow: 180 })).toBe(75);
    expect(blockLength({ sessionMinutes: 45 })).toBe(45);
    expect(blockLength({ estLow: 20, sessionMinutes: null })).toBe(20);
    expect(blockLength({})).toBe(30);
  });
});
