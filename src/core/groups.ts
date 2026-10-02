import type { DateTime } from 'luxon';
import { compareByDeadline, effectiveWindow, type UrgencyTask } from './urgency';

// Task panel groups (spec §9). Within a group, tasks with deadlines come first, earliest first,
// then the user's own order.

export interface GroupTask extends UrgencyTask {
  id: string;
  sortOrder: number;
  conditionId?: string | null;
}

export interface WaitingGroup<T> {
  /** The check-in question these tasks wait on, or null for tasks without one. */
  conditionId: string | null;
  tasks: T[];
}

export interface TaskGroups<T> {
  overdue: T[];
  near: T[];
  week: T[];
  soon: T[];
  waiting: WaitingGroup<T>[];
  decide: T[];
  ongoing: T[];
  /** Most recently done first. */
  done: T[];
}

export function groupTasks<T extends GroupTask>(tasks: T[], now: DateTime, zone: string, homeZone: string): TaskGroups<T> {
  const g: TaskGroups<T> = { overdue: [], near: [], week: [], soon: [], waiting: [], decide: [], ongoing: [], done: [] };
  const sorted = [...tasks].sort((a, b) => compareByDeadline(a, b, homeZone) || a.sortOrder - b.sortOrder);
  for (const t of sorted) {
    const w = effectiveWindow(t, now, zone, homeZone);
    if (w !== 'waiting') {
      g[w].push(t);
      continue;
    }
    const key = t.conditionId ?? null;
    let group = g.waiting.find((x) => x.conditionId === key);
    if (!group) g.waiting.push((group = { conditionId: key, tasks: [] }));
    group.tasks.push(t);
  }
  g.done.sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  return g;
}
