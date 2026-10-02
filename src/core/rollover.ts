import { DateTime } from 'luxon';
import { dayOf } from './day';

// Rollover (spec §10). At 4am, any unfinished task that was scheduled on, or committed to, a past
// day moves to today's Sometime lane, marked with the day it came from. This only works out the
// changes; the server applies them (with Undo).

export interface RolloverTask {
  id: string;
  doneAt?: string | null;
}

export interface RolloverBlock {
  id: string;
  taskId: string;
  /** UTC ISO. */
  startAt: string;
}

export interface SometimeEntry {
  taskId: string;
  date: string;
  rolledFrom?: string | null;
}

export interface RolloverResult {
  /** Past task blocks to take off the schedule. */
  removeBlockIds: string[];
  /** Sometime entries to write, one per task, replacing any existing entry. */
  sometime: Required<SometimeEntry>[];
}

/**
 * Works out what moves to `today`. Tasks that are done, or that are already on the schedule or
 * committed to today or later, stay where they are. A rolled block is marked from the day it was
 * on; a rolled Sometime entry keeps its original day.
 */
export function rollover(
  today: string,
  zone: string,
  tasks: RolloverTask[],
  taskBlocks: RolloverBlock[],
  sometime: SometimeEntry[],
): RolloverResult {
  const open = new Set(tasks.filter((t) => !t.doneAt).map((t) => t.id));
  const blockDays = taskBlocks.map((b) => ({ b, date: dayOf(DateTime.fromISO(b.startAt, { zone: 'utc' }), zone) }));

  const current = new Set<string>();
  for (const { b, date } of blockDays) if (date >= today) current.add(b.taskId);
  for (const s of sometime) if (s.date >= today) current.add(s.taskId);

  const removeBlockIds: string[] = [];
  const from = new Map<string, string>();
  for (const { b, date } of blockDays) {
    if (date >= today || !open.has(b.taskId) || current.has(b.taskId)) continue;
    removeBlockIds.push(b.id);
    const prev = from.get(b.taskId);
    if (!prev || date > prev) from.set(b.taskId, date);
  }
  for (const s of sometime) {
    if (s.date >= today || !open.has(s.taskId) || current.has(s.taskId) || from.has(s.taskId)) continue;
    from.set(s.taskId, s.rolledFrom ?? s.date);
  }

  return {
    removeBlockIds,
    sometime: [...from].map(([taskId, rolledFrom]) => ({ taskId, date: today, rolledFrom })),
  };
}
