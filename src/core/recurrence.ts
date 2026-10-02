import { DateTime } from 'luxon';
import { addDays, dayOf, diffDays, weekday } from './day';
import { clockOnDay } from './time';

// Occurrences of weekly classes and repeating routines, with per-day exceptions (spec §9, §10).
// Dates are planner days ("yyyy-MM-dd"); weekdays are 0–6 with Sunday = 0.

export interface Repeat {
  repeat: 'daily' | 'weekly';
  /** Weekdays, for weekly repeats. */
  repeatDays?: number[] | null;
  /** 1 = every week, 2 = every other week. */
  repeatEvery?: number | null;
  /** First day the repeat counts from. Needed for every other week. */
  repeatFrom?: string | null;
}

/** True when a routine falls on `date`. Every other week counts in 7-day blocks from `repeatFrom`. */
export function routineOccursOn(r: Repeat, date: string): boolean {
  if (r.repeatFrom && date < r.repeatFrom) return false;
  if (r.repeat === 'daily') return true;
  if (!r.repeatDays?.includes(weekday(date))) return false;
  const every = r.repeatEvery ?? 1;
  if (every <= 1) return true;
  if (!r.repeatFrom) throw new Error('Every-other-week repeats need repeatFrom');
  return Math.floor(diffDays(r.repeatFrom, date) / 7) % every === 0;
}

export interface Slot {
  id: string;
  start: string;
  durationMinutes: number;
}

export interface SlotException {
  slotId: string;
  date: string;
  skipped: boolean;
  start?: string | null;
  durationMinutes?: number | null;
}

export interface SlotOccurrence {
  slotId: string;
  date: string;
  /** Local "HH:mm" for that day, after any exception. */
  start: string;
  durationMinutes: number;
  /** True when this day was moved or resized on its own. */
  changed: boolean;
}

/**
 * A routine slot on one day, or null when the routine doesn't fall on that day or is skipped.
 * Routine times follow the user, so they stay "HH:mm" in whatever zone the user is in.
 */
export function slotOn(r: Repeat, slot: Slot, date: string, exceptions: SlotException[]): SlotOccurrence | null {
  if (!routineOccursOn(r, date)) return null;
  const ex = exceptions.find((e) => e.slotId === slot.id && e.date === date);
  if (ex?.skipped) return null;
  return {
    slotId: slot.id,
    date,
    start: ex?.start ?? slot.start,
    durationMinutes: ex?.durationMinutes ?? slot.durationMinutes,
    changed: !!ex && (ex.start != null || ex.durationMinutes != null),
  };
}

export interface WeeklyClass {
  id: string;
  days: number[];
  /** Wall-clock "HH:mm" in `timeZone`. */
  start: string;
  end: string;
  timeZone: string;
}

export interface ClassOccurrence {
  classId: string;
  /** The day in the class's own zone. Skips are recorded against this day. */
  homeDate: string;
  startAt: DateTime;
  endAt: DateTime;
  skipped: boolean;
}

/**
 * Classes that land on planner day `date` as seen from `zone`. A class is fixed in its own zone,
 * so a 2pm Chicago class shows at 3pm in New York, and could fall on a different day far enough away.
 * `skips` holds "classId@homeDate" keys.
 */
export function classesOn(classes: WeeklyClass[], date: string, zone: string, skips: Set<string>): ClassOccurrence[] {
  const out: ClassOccurrence[] = [];
  for (const c of classes) {
    for (const homeDate of [addDays(date, -1), date, addDays(date, 1)]) {
      if (!c.days.includes(weekday(homeDate))) continue;
      const startAt = clockOnDay(homeDate, c.start, c.timeZone);
      if (dayOf(startAt, zone) !== date) continue;
      const endAt = clockOnDay(homeDate, c.end, c.timeZone);
      out.push({ classId: c.id, homeDate, startAt, endAt, skipped: skips.has(`${c.id}@${homeDate}`) });
    }
  }
  return out.sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis());
}
