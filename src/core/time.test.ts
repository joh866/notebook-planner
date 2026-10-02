import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { clockOnDay, isOnDay, minutesOnDay, parseClock, resolveZone } from './time';

const CHI = 'America/Chicago';
const NY = 'America/New_York';

describe('resolveZone', () => {
  it('follows the device on auto, otherwise uses the setting', () => {
    expect(resolveZone('auto', NY)).toBe(NY);
    expect(resolveZone(CHI, NY)).toBe(CHI);
  });
});

describe('parseClock', () => {
  it('reads HH:mm as minutes', () => {
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('13:30')).toBe(810);
    expect(() => parseClock('9:00')).toThrow();
    expect(() => parseClock('24:00')).toThrow();
  });
});

describe('clockOnDay', () => {
  it('places a Chicago class time as a fixed moment', () => {
    const t = clockOnDay('2026-10-02', '14:00', CHI);
    expect(t.toUTC().toISO()).toBe('2026-10-02T19:00:00.000Z');
    // Seen from New York, that's 3pm.
    expect(t.setZone(NY).hour).toBe(15);
  });

  it('keeps a local routine time at the same clock time when traveling', () => {
    expect(clockOnDay('2026-10-02', '09:00', NY).setZone(NY).hour).toBe(9);
    expect(clockOnDay('2026-10-02', '09:00', CHI).setZone(CHI).hour).toBe(9);
  });

  it('puts times before 4am in the night at the end of the day', () => {
    expect(clockOnDay('2026-10-02', '00:00', CHI).toISO()).toBe('2026-10-03T00:00:00.000-05:00');
    expect(clockOnDay('2026-10-02', '03:59', CHI).toISO()).toBe('2026-10-03T03:59:00.000-05:00');
    expect(clockOnDay('2026-10-02', '04:00', CHI).toISO()).toBe('2026-10-02T04:00:00.000-05:00');
  });

  it('uses the right offset on each side of the Nov 1 change', () => {
    expect(clockOnDay('2026-10-30', '14:00', CHI).toUTC().toISO()).toBe('2026-10-30T19:00:00.000Z');
    expect(clockOnDay('2026-11-02', '14:00', CHI).toUTC().toISO()).toBe('2026-11-02T20:00:00.000Z');
    // A 2pm Chicago class is 3pm in New York on both sides, since both zones change together.
    expect(clockOnDay('2026-11-02', '14:00', CHI).setZone(NY).hour).toBe(15);
  });
});

describe('minutesOnDay and isOnDay', () => {
  it('measures wall-clock minutes from the day’s midnight, running past 1440 after midnight', () => {
    const date = '2026-10-02';
    expect(minutesOnDay(clockOnDay(date, '09:00', CHI), date, CHI)).toBe(540);
    expect(minutesOnDay(clockOnDay(date, '01:00', CHI), date, CHI)).toBe(1500);
    // A 2pm Chicago class sits at 3pm on a New York schedule.
    expect(minutesOnDay(clockOnDay(date, '14:00', CHI), date, NY)).toBe(900);
  });

  it('checks which planner day an instant is on', () => {
    const late = DateTime.fromISO('2026-10-03T02:00', { zone: CHI });
    expect(isOnDay(late, '2026-10-02', CHI)).toBe(true);
    expect(isOnDay(late, '2026-10-03', CHI)).toBe(false);
  });
});
