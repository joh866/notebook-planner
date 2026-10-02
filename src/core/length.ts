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
