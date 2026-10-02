import { addDays } from './day';
import { routineOccursOn, type Repeat } from './recurrence';

// Routine streaks for the Daily checklist (spec §9, "4-day streak").

/**
 * Days in a row a routine was checked, counting only the days it falls on. A day that isn't
 * checked yet doesn't break the streak while it's still that day, so the count runs from the
 * last day it occurred before `date` and adds `date` if it's checked.
 */
export function streak(r: Repeat, checked: Set<string>, date: string, maxDays = 400): number {
  let count = 0;
  let d = date;
  for (let i = 0; i < maxDays; i++, d = addDays(d, -1)) {
    if (r.repeatFrom && d < r.repeatFrom) break;
    if (!routineOccursOn(r, d)) continue;
    if (checked.has(d)) count++;
    else if (d !== date) break;
  }
  return count;
}
