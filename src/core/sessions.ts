import { DateTime } from 'luxon';

// Actual time spent on tasks (spec §10, "Actual time and the time log"). Moments are UTC ISO
// strings; `now` is passed in.

export interface Session {
  startAt: string;
  /** Null while it's running. */
  endAt: string | null;
}

const at = (s: string) => DateTime.fromISO(s, { zone: 'utc' });

/** Whole minutes in a session. A running one counts up to now. */
export function sessionMinutes(s: Session, now: DateTime): number {
  const end = s.endAt ? at(s.endAt) : now;
  return Math.max(0, Math.round(end.diff(at(s.startAt), 'minutes').minutes));
}

/** Whole minutes across sessions. */
export const loggedMinutes = (sessions: Session[], now: DateTime) => sessions.reduce((n, s) => n + sessionMinutes(s, now), 0);

export interface TimedEvent {
  id: string;
  startAt: string;
  durationMinutes: number;
}

/**
 * Events a logged session cuts short (spec §10, "Reporting what you did"): any that started before
 * the session and were still going when it began end when you switched. Returns their new lengths.
 */
export function trimmedEvents(events: TimedEvent[], startAt: string): { id: string; durationMinutes: number }[] {
  const start = at(startAt);
  return events.flatMap((e) => {
    const from = at(e.startAt);
    const to = from.plus({ minutes: e.durationMinutes });
    if (!(from < start && to > start)) return [];
    return [{ id: e.id, durationMinutes: Math.max(1, Math.round(start.diff(from, 'minutes').minutes)) }];
  });
}
