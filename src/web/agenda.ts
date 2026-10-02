import { DateTime } from 'luxon';
import { diffDays } from '../core/day';
import type { DeadlineView, MonthDay } from '../shared/api';
import { classTitle } from './ClassDialog';
import { cap, fmtTime } from './format';

// What a day's line in "Coming up" (spec §5) and the month view (spec §8) says.

export interface AgendaLine {
  key: string;
  text: string;
  due: boolean;
  categoryId: string | null;
}

/** Day-only deadlines sort after timed ones on the same day (spec §10). */
const END_OF_DAY = 10_000;

/** "Due 2pm: The Muqaddimah reading", or "Due: Econ PSet 1" for a day-only deadline. */
export const dueText = (d: DeadlineView) => `Due${d.atMin != null ? ` ${fmtTime(d.atMin)}` : ''}: ${cap(d.name)}`;

/** A day's unfinished deadlines, events, and skipped classes, in time order. */
export function agendaLines(day: MonthDay): AgendaLine[] {
  const out: (AgendaLine & { at: number })[] = [];
  for (const d of day.deadlines) {
    if (!d.done) out.push({ key: `due-${d.taskId}`, at: d.atMin ?? END_OF_DAY, text: dueText(d), due: true, categoryId: null });
  }
  for (const e of day.events) {
    out.push({
      key: e.id, at: e.startMin, due: false, categoryId: e.categoryId,
      text: `${fmtTime(e.startMin)} ${e.title ?? 'Event'}${e.tentative ? ' (roughly)' : ''}`,
    });
  }
  for (const c of day.skippedClasses) {
    out.push({ key: c.id, at: c.startMin, text: `Skipping ${classTitle(c)}`, due: false, categoryId: c.categoryId ?? 'class' });
  }
  return out.sort((a, b) => a.at - b.at).map((x) => ({ key: x.key, text: x.text, due: x.due, categoryId: x.categoryId }));
}

/** "Today, Oct 2", "Tomorrow, Oct 3", "Sunday, Oct 4". */
export function agendaDayLabel(today: string, date: string): string {
  const n = diffDays(today, date);
  const d = DateTime.fromFormat(date, 'yyyy-MM-dd');
  const name = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : d.toFormat('cccc');
  return `${name}, ${d.toFormat('LLL d')}`;
}

/** Up to four dots for a day in the phone month: red for unfinished deadlines, then events in their category colors (spec §8). */
export function monthDots(day: MonthDay): { key: string; due: boolean; categoryId: string | null }[] {
  return [
    ...day.deadlines.filter((d) => !d.done).map((d) => ({ key: `due-${d.taskId}`, due: true, categoryId: null })),
    ...day.events.map((e) => ({ key: e.id, due: false, categoryId: e.categoryId })),
  ].slice(0, 4);
}
