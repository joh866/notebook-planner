import type { DateTime } from 'luxon';
import { compareByDeadline, effectiveWindow, type UrgencyTask } from './urgency';

// Task panel groups (spec §9). Within a group, tasks with deadlines come first, earliest first,
// then the user's own order.

export interface GroupTask extends UrgencyTask {
  id: string;
  sortOrder: number;
}

export interface TaskGroups<T> {
  overdue: T[];
  near: T[];
  week: T[];
  soon: T[];
  decide: T[];
  ongoing: T[];
  /** Most recently done first. */
  done: T[];
}

export function groupTasks<T extends GroupTask>(tasks: T[], now: DateTime, zone: string, homeZone: string): TaskGroups<T> {
  const g: TaskGroups<T> = { overdue: [], near: [], week: [], soon: [], decide: [], ongoing: [], done: [] };
  const sorted = [...tasks].sort((a, b) => compareByDeadline(a, b, homeZone) || a.sortOrder - b.sortOrder);
  // Tasks with a condition stay in their own window (spec §9): there's no Waiting group.
  for (const t of sorted) g[effectiveWindow(t, now, zone, homeZone)].push(t);
  g.done.sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  return g;
}
