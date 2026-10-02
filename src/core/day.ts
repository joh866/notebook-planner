import { DateTime } from 'luxon';

// Planner days (spec §3). A day is a local "yyyy-MM-dd" that runs from 4:00 AM to 4:00 AM the next
// morning, so anything before 4am counts as the previous night. Weekdays are 0–6, Sunday = 0.

export const DAY_START_HOUR = 4;

const FMT = 'yyyy-MM-dd';

function parseDay(date: string): DateTime {
  const d = DateTime.fromFormat(date, FMT, { zone: 'UTC' });
  if (!d.isValid) throw new Error(`Not a day: ${date}`);
  return d;
}

/** The planner day an instant falls on in `zone`. Uses the local clock, so DST days work. */
export function dayOf(instant: DateTime, zone: string): string {
  const local = instant.setZone(zone);
  const d = local.hour < DAY_START_HOUR ? local.minus({ days: 1 }) : local;
  return d.toFormat(FMT);
}

/** When a planner day starts (4:00 AM local) in `zone`. */
export function dayStart(date: string, zone: string): DateTime {
  const d = parseDay(date);
  return DateTime.fromObject({ year: d.year, month: d.month, day: d.day, hour: DAY_START_HOUR }, { zone });
}

/** When a planner day ends: 4:00 AM local the next morning. */
export function dayEnd(date: string, zone: string): DateTime {
  return dayStart(addDays(date, 1), zone);
}

export function addDays(date: string, n: number): string {
  return parseDay(date).plus({ days: n }).toFormat(FMT);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: string, b: string): number {
  return Math.round(parseDay(b).diff(parseDay(a), 'days').days);
}

/** 0–6, Sunday = 0. */
export function weekday(date: string): number {
  return parseDay(date).weekday % 7;
}

/** First day of the fixed calendar week containing `date` (spec §8). `weekStart` is 0 (Sunday) or 1 (Monday). */
export function weekStartOf(date: string, weekStart: number): string {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}

/**
 * The days a calendar grid shows for a "yyyy-MM" month: whole weeks from the week containing the
 * 1st through the week containing the last day.
 */
export function monthCells(month: string, weekStart: number): string[] {
  const first = `${month}-01`;
  const last = parseDay(first).endOf('month').toFormat(FMT);
  const out: string[] = [];
  for (let d = weekStartOf(first, weekStart); d <= last || out.length % 7; d = addDays(d, 1)) out.push(d);
  return out;
}
