// How long a task's block is when it goes on the schedule (spec §12, "Block length").

export interface Lengths {
  sittingMinutes?: number | null;
  sessionMinutes?: number | null;
  estLow?: number | null;
}

/**
 * Its sitting length, or its session length for skill-building items, or the low end of its
 * estimate, or 30 minutes.
 */
export function blockLength(t: Lengths): number {
  return t.sittingMinutes ?? t.sessionMinutes ?? t.estLow ?? 30;
}

// Quick things (spec §10): short tasks the planner batches into one block.

/** A task estimated at this many minutes or less is quick. */
export const QUICK_MAX = 15;
/** A "Quick things" block holds about this many minutes at most. */
export const BATCH_MAX = 30;

export interface QuickFields extends Lengths {
  estHigh?: number | null;
  quick?: boolean | null;
}

/** Marked quick by the add box, or estimated at 15 minutes or less. Sittings and sessions are never quick. */
export function isQuick(t: QuickFields): boolean {
  if (t.sittingMinutes || t.sessionMinutes) return false;
  if (t.quick) return true;
  const est = t.estHigh ?? t.estLow;
  return est != null && est <= QUICK_MAX;
}

/** How long a quick task takes inside a batch: the low end of its estimate, or 10 minutes. */
export const quickLength = (t: QuickFields) => Math.min(t.estLow ?? t.estHigh ?? 10, QUICK_MAX);
