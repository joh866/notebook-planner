import { describe, expect, it } from 'vitest';
import { clockParts, clockValue, minuteChoices } from './timeParts';

describe('the 12-hour time picker', () => {
  it('splits "HH:mm" into 12-hour parts', () => {
    expect(clockParts('00:00')).toEqual({ hour: 12, minute: 0, pm: false });
    expect(clockParts('09:05')).toEqual({ hour: 9, minute: 5, pm: false });
    expect(clockParts('12:20')).toEqual({ hour: 12, minute: 20, pm: true });
    expect(clockParts('13:30')).toEqual({ hour: 1, minute: 30, pm: true });
  });

  it('puts the parts back together', () => {
    for (const v of ['00:00', '00:30', '09:05', '11:59', '12:00', '12:20', '13:30', '23:45']) {
      expect(clockValue(clockParts(v))).toBe(v);
    }
    expect(clockValue({ hour: 12, minute: 0, pm: false })).toBe('00:00');
    expect(clockValue({ hour: 12, minute: 15, pm: true })).toBe('12:15');
  });

  it('offers every 5 minutes, and keeps an in-between minute', () => {
    expect(minuteChoices(30)).toHaveLength(12);
    expect(minuteChoices(52)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 52, 55]);
  });
});
