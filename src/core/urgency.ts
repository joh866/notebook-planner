import { DateTime } from 'luxon';
import type { Window } from '../shared/schemas';
import { dayEnd, dayOf, diffDays } from './day';

// Deadlines, urgency windows, and overdue status (spec §9, §10). All derived, never stored.

export interface Deadline {
  /** UTC ISO moment, when a time was given. */
  dueAt?: string | null;
  /** "yyyy-MM-dd", when only a day was given. Means "by the end of that day". */
  dueDate?: string | null;
}

export interface UrgencyTask extends Deadline {
  window: Window;
  doneAt?: string | null;
}

export type EffectiveWindow = Window | 'overdue' | 'done';

/** How the due chip looks (spec §9). */
export type DueTone = 'plain' | 'soon' | 'urgent' | 'overdue';

/**
 * The moment a deadline passes. A day-only deadline ends when that day ends at 4am. Deadlines
 * are fixed Chicago moments (spec §3), so day-only ones are measured in `homeZone`.
 */
export function deadlineMoment(d: Deadline, homeZone: string): DateTime | null {
  if (d.dueAt) return DateTime.fromISO(d.dueAt, { zone: 'utc' });
  if (d.dueDate) return dayEnd(d.dueDate, homeZone);
  return null;
}

/** The planner day a deadline falls on, as seen from `zone`. */
export function deadlineDay(d: Deadline, zone: string): string | null {
  if (d.dueAt) return dayOf(DateTime.fromISO(d.dueAt, { zone: 'utc' }), zone);
  return d.dueDate ?? null;
}

export function isOverdue(t: UrgencyTask, now: DateTime, homeZone: string): boolean {
  if (t.doneAt) return false;
  const due = deadlineMoment(t, homeZone);
  return !!due && now >= due;
}

/** Days from `today` to the deadline's day, or null with no deadline. */
export function daysLeft(d: Deadline, today: string, zone: string): number | null {
  const day = deadlineDay(d, zone);
  return day == null ? null : diffDays(today, day);
}

/**
 * The group a task shows in (spec §10, "Urgency rises"). More than 6 days away it stays in its
 * own window; 2–6 days moves it up to This week; today or tomorrow moves it to Today or tomorrow;
 * past the deadline it's Overdue. Waiting and decision items stay where they are.
 */
export function effectiveWindow(t: UrgencyTask, now: DateTime, zone: string, homeZone: string): EffectiveWindow {
  if (t.doneAt) return 'done';
  if (t.window === 'waiting' || t.window === 'decide') return t.window;
  if (isOverdue(t, now, homeZone)) return 'overdue';
  const n = daysLeft(t, dayOf(now, zone), zone);
  if (n == null) return t.window;
  if (n <= 1) return 'near';
  if (n <= 6 && t.window !== 'near') return 'week';
  return t.window;
}

export function dueTone(t: UrgencyTask, now: DateTime, zone: string, homeZone: string): DueTone | null {
  const n = daysLeft(t, dayOf(now, zone), zone);
  if (n == null) return null;
  if (t.doneAt) return 'plain';
  if (isOverdue(t, now, homeZone)) return 'overdue';
  if (n <= 1) return 'urgent';
  if (n <= 6) return 'soon';
  return 'plain';
}

/**
 * Order within a group (spec §9): tasks with deadlines first, earliest first. A day-only deadline
 * sorts after timed ones on the same day, since it ends at 4am the next morning.
 */
export function compareByDeadline(a: Deadline, b: Deadline, homeZone: string): number {
  const da = deadlineMoment(a, homeZone);
  const db = deadlineMoment(b, homeZone);
  if (da && db) return da.toMillis() - db.toMillis();
  if (da) return -1;
  if (db) return 1;
  return 0;
}
