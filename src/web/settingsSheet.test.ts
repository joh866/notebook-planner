import { describe, expect, it } from 'vitest';
import { NotifySchema } from '../shared/schemas';
import { clampDayTime, classLine, NOTIFY_ROWS, zoneCity, zoneList } from './settingsSheet';

describe('settings sheet', () => {
  it('keeps wake and bed times in range', () => {
    expect(clampDayTime('wake', '08:30')).toEqual({ value: '08:30', note: null });
    expect(clampDayTime('wake', '05:00')).toEqual({ value: '06:00', note: 'Set to 6am, the earliest it can be.' });
    expect(clampDayTime('wake', '13:15').value).toBe('12:00');
    expect(clampDayTime('bed', '00:00')).toEqual({ value: '00:00', note: null });
    expect(clampDayTime('bed', '01:30').value).toBe('01:30');
    expect(clampDayTime('bed', '03:00')).toEqual({ value: '02:00', note: 'Set to 2am, the latest it can be.' });
    expect(clampDayTime('bed', '19:00').value).toBe('21:00');
  });

  it('has a switch for every notification', () => {
    expect(NOTIFY_ROWS.map((r) => r.key).sort()).toEqual(Object.keys(NotifySchema.shape).sort());
  });

  it('names time zones', () => {
    expect(zoneCity('America/New_York')).toBe('New York');
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(zoneList(['Europe/Paris', 'America/Chicago', 'UTC'], 'Asia/Tokyo', 'America/Chicago'))
      .toEqual(['America/Chicago', 'Asia/Tokyo', 'Europe/Paris']);
  });

  it('describes a class', () => {
    expect(classLine({ days: [5, 1, 3], start: '10:30', end: '11:20', location: 'Kent Chemical Laboratory 107' }))
      .toBe('Mon, Wed, and Fri, 10:30–11:20am, Kent 107');
    expect(classLine({ days: [2, 4], start: '12:30', end: '13:50', location: null })).toBe('Tue and Thu, 12:30–1:50pm');
  });
});
