import { describe, expect, it } from 'vitest';
import { twelveHour } from './words';

describe('twelveHour', () => {
  it('turns 24-hour times after a time word into 12-hour ones', () => {
    expect(twelveHour('Meet at 13:30 in Crerar')).toBe('Meet at 1:30pm in Crerar');
    expect(twelveHour('Start by 09:00, done before 23:15')).toBe('Start by 9am, done before 11:15pm');
    expect(twelveHour('Leave around 00:30')).toBe('Leave around 12:30am');
  });

  it('turns ranges into 12-hour ranges', () => {
    expect(twelveHour('Office hours 13:00-14:30')).toBe('Office hours 1–2:30pm');
    expect(twelveHour('Study 11:00–13:00')).toBe('Study 11am–1pm');
  });

  it('leaves 12-hour times and other numbers alone', () => {
    expect(twelveHour('Before 2:00pm, read John 3:16')).toBe('Before 2:00pm, read John 3:16');
    expect(twelveHour('Chap. 2 & 3')).toBe('Chap. 2 & 3');
  });
});
