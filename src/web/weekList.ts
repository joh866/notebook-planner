import type { DaySchedule } from '../shared/api';
import { classTitle } from './ClassDialog';
import { cap, fmtTime } from './format';

// The rows of one day's card in the phone week list (spec §8, "Week, phone").

export interface WeekRow {
  key: string;
  /** "2pm", "End of day", or "Sometime". */
  time: string;
  text: string;
  look: 'due' | 'class' | 'skipped' | 'event' | 'task' | 'sometime' | 'google';
  categoryId: string | null;
  done: boolean;
}

/** Day-only deadlines and Sometime entries come after everything with a time. */
const END_OF_DAY = 10_000;
const SOMETIME = 20_000;

/** Unfinished deadlines, classes, events, placed tasks, and Sometime entries, in time order. Routines and open time are left out. */
export function weekRows(day: DaySchedule): WeekRow[] {
  const out: (WeekRow & { at: number })[] = [];
  for (const d of day.deadlines) {
    if (d.done) continue;
    out.push({
      key: `due-${d.taskId}`, at: d.atMin ?? END_OF_DAY, time: d.atMin != null ? fmtTime(d.atMin) : 'End of day',
      text: `Due: ${cap(d.name)}`, look: 'due', categoryId: null, done: false,
    });
  }
  for (const x of day.schedule) {
    const base = { key: x.id, at: x.startMin, time: fmtTime(x.startMin) };
    if (x.type === 'class') {
      out.push({ ...base, text: classTitle(x), look: x.skipped ? 'skipped' : 'class', categoryId: x.categoryId ?? 'class', done: false });
    } else if (x.type === 'google') {
      out.push({ ...base, text: x.title, look: 'google', categoryId: null, done: false });
    } else if (x.type === 'block' && x.kind !== 'open') {
      const text = x.kind === 'quick'
        ? `Quick things: ${x.items.map((i) => i.title).join(', ')}`
        : x.kind === 'task' ? x.title ?? 'Task' : `${x.title ?? 'Event'}${x.tentative ? ' (roughly)' : ''}`;
      out.push({ ...base, text, look: x.kind === 'task' || x.kind === 'quick' ? 'task' : 'event', categoryId: x.categoryId, done: x.done });
    }
  }
  for (const e of day.allDay) {
    out.push({ key: `ad-${e.id}`, at: -1, time: 'All day', text: e.title, look: 'google', categoryId: null, done: false });
  }
  // A day-only deadline is already listed as due.
  for (const s of day.sometime.filter((x) => !x.due)) {
    out.push({ key: `st-${s.taskId}`, at: SOMETIME, time: 'Sometime', text: s.title, look: 'sometime', categoryId: s.categoryId, done: s.done });
  }
  return out
    .sort((a, b) => a.at - b.at)
    .map((r) => ({ key: r.key, time: r.time, text: r.text, look: r.look, categoryId: r.categoryId, done: r.done }));
}
