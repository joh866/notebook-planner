import { DateTime } from 'luxon';
import { DAY_START_HOUR, addDays, dayOf } from './day';

// Time zones (spec §3).
// - Classes are wall-clock times in their own zone (Chicago), so they shift when traveling.
// - Routines, wake time, and bedtime are local "HH:mm" and follow the user.

export const HOME_TIME_ZONE = 'America/Chicago';

/** The zone to display in. "auto" follows the device. */
export function resolveZone(setting: string, deviceZone: string): string {
  return setting === 'auto' ? deviceZone : setting;
}

/** Minutes after midnight for "HH:mm". */
export function parseClock(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Not a clock time: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Not a clock time: ${hhmm}`);
  return h * 60 + min;
}

/**
 * The instant a clock time happens on a planner day in `zone`. Times before 4am belong to the
 * night at the end of that day, so "00:00" bedtime on Oct 2 is midnight going into Oct 3.
 */
export function clockOnDay(date: string, hhmm: string, zone: string): DateTime {
  const mins = parseClock(hhmm);
  const calendar = mins < DAY_START_HOUR * 60 ? addDays(date, 1) : date;
  const [y, mo, d] = calendar.split('-').map(Number);
  return DateTime.fromObject({ year: y, month: mo, day: d, hour: Math.floor(mins / 60), minute: mins % 60 }, { zone });
}

/**
 * Where an instant sits on a planner day's schedule, as wall-clock minutes after that day's
 * midnight in `zone`. Times after midnight run past 1440 (1am is 1500).
 */
export function minutesOnDay(instant: DateTime, date: string, zone: string): number {
  const local = instant.setZone(zone);
  const mins = local.hour * 60 + local.minute;
  return local.toFormat('yyyy-MM-dd') === date ? mins : mins + 1440;
}

/** True when an instant falls on a planner day in `zone`. */
export function isOnDay(instant: DateTime, date: string, zone: string): boolean {
  return dayOf(instant, zone) === date;
}

/**
 * The instant at wall-clock minute `m` of a planner day in `zone`. The inverse of `minutesOnDay`:
 * minutes past 1440 are after midnight, in the night at the end of that day.
 */
export function atMinute(date: string, m: number, zone: string): DateTime {
  const calendar = m >= 1440 ? addDays(date, 1) : date;
  const mins = ((m % 1440) + 1440) % 1440;
  const [y, mo, d] = calendar.split('-').map(Number);
  return DateTime.fromObject({ year: y, month: mo, day: d, hour: Math.floor(mins / 60), minute: mins % 60 }, { zone });
}

/** Local "HH:mm" for a wall-clock minute on the schedule (1500 is "01:00"). */
export function clockOf(m: number): string {
  const mins = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}
