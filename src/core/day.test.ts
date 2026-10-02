import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { addDays, dayEnd, dayOf, dayStart, diffDays, monthCells, weekStartOf, weekday } from './day';

const CHI = 'America/Chicago';
const at = (iso: string, zone = CHI) => DateTime.fromISO(iso, { zone });

describe('the 4am day boundary', () => {
  it('counts anything before 4am as the previous night', () => {
    expect(dayOf(at('2026-10-02T03:59'), CHI)).toBe('2026-10-01');
    expect(dayOf(at('2026-10-02T04:00'), CHI)).toBe('2026-10-02');
    expect(dayOf(at('2026-10-02T23:59'), CHI)).toBe('2026-10-02');
    expect(dayOf(at('2026-10-03T00:30'), CHI)).toBe('2026-10-02');
  });

  it('reads the day in the given zone', () => {
    // 3:30am in Chicago is 4:30am in New York.
    const instant = at('2026-10-02T03:30');
    expect(dayOf(instant, CHI)).toBe('2026-10-01');
    expect(dayOf(instant, 'America/New_York')).toBe('2026-10-02');
  });

  it('starts and ends days at 4am local', () => {
    expect(dayStart('2026-10-02', CHI).toISO()).toBe('2026-10-02T04:00:00.000-05:00');
    expect(dayEnd('2026-10-02', CHI).toISO()).toBe('2026-10-03T04:00:00.000-05:00');
  });

  it('handles the Nov 1, 2026 daylight saving change', () => {
    // Both 1:30ams on Nov 1 belong to Oct 31's night.
    const first = DateTime.fromISO('2026-11-01T06:30:00Z').setZone(CHI);
    const second = DateTime.fromISO('2026-11-01T07:30:00Z').setZone(CHI);
    expect(first.hour).toBe(1);
    expect(second.hour).toBe(1);
    expect(dayOf(first, CHI)).toBe('2026-10-31');
    expect(dayOf(second, CHI)).toBe('2026-10-31');
    // Oct 31's planner day is 25 hours long; Nov 1's is 24.
    expect(dayEnd('2026-10-31', CHI).diff(dayStart('2026-10-31', CHI), 'hours').hours).toBe(25);
    expect(dayEnd('2026-11-01', CHI).diff(dayStart('2026-11-01', CHI), 'hours').hours).toBe(24);
    expect(dayStart('2026-11-01', CHI).toISO()).toBe('2026-11-01T04:00:00.000-06:00');
  });
});

describe('day math', () => {
  it('adds and counts days, across months and DST', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(diffDays('2026-10-31', '2026-11-02')).toBe(2);
    expect(diffDays('2026-10-06', '2026-10-02')).toBe(-4);
  });

  it('numbers weekdays from Sunday = 0', () => {
    expect(weekday('2026-10-02')).toBe(5); // Friday
    expect(weekday('2026-10-04')).toBe(0); // Sunday
    expect(weekday('2026-10-03')).toBe(6); // Saturday
  });

  it('finds the start of the fixed calendar week', () => {
    expect(weekStartOf('2026-10-02', 0)).toBe('2026-09-27');
    expect(weekStartOf('2026-10-03', 0)).toBe('2026-09-27');
    expect(weekStartOf('2026-10-04', 0)).toBe('2026-10-04');
    expect(weekStartOf('2026-10-02', 1)).toBe('2026-09-28');
    expect(weekStartOf('2026-10-04', 1)).toBe('2026-09-28');
  });

  it('lays out whole weeks for a month grid', () => {
    const oct = monthCells('2026-10', 0);
    expect(oct).toHaveLength(35);
    expect([oct[0], oct[34]]).toEqual(['2026-09-27', '2026-10-31']);
    const monday = monthCells('2026-10', 1);
    expect([monday[0], monday.at(-1)]).toEqual(['2026-09-28', '2026-11-01']);
    expect(monthCells('2026-02', 0)).toHaveLength(28); // Feb 1, 2026 is a Sunday, and it has 28 days
    expect(monthCells('2026-08', 0)).toHaveLength(42); // Aug 1 is a Saturday
  });

  it('rejects malformed days', () => {
    expect(() => addDays('Oct 2', 1)).toThrow();
  });
});
