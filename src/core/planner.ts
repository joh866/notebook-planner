import { DateTime } from 'luxon';
import type { ScheduleItem } from '../shared/api';
import type { Window } from '../shared/schemas';
import { addDays, diffDays } from './day';
import { blockLength } from './length';
import { stepParts } from './timeline';
import { deadlineDay, effectiveWindow, isOverdue, type EffectiveWindow } from './urgency';
import { minutesOnDay } from './time';
import { dueLabel, relWord } from './words';

// The planner (spec §12). Plain code: it scores tasks and fits them into free time. Minutes are
// wall-clock minutes on a planner day, past 1440 after midnight, as on the schedule.

/** [start, end) in minutes. */
export type Interval = [number, number];

/** Free time keeps this far from anything busy. */
export const BUFFER = 10;
/** Start times round up to this. */
export const STEP = 15;
/** At most this many tasks per Plan press. */
export const MAX_PER_RUN = 6;
/** A task due on the planned day must end this long before its deadline. */
export const DEADLINE_MARGIN = 15;

const roundUp = (m: number) => Math.ceil(m / STEP) * STEP;
const roundDown = (m: number) => Math.floor(m / STEP) * STEP;

/** A day's free window: from wake time (or now plus 10 minutes, planning today) to bedtime. */
export interface DayFree {
  date: string;
  from: number;
  to: number;
  busy: Interval[];
}

export function freeWindow(date: string, today: string, nowMin: number | null, wakeMin: number, bedMin: number): { from: number; to: number } {
  return { from: date === today && nowMin != null ? nowMin + BUFFER : wakeMin, to: bedMin };
}

/** The busy parts of something with steps: everything, unless it has waiting steps, which are free. */
function handsOn(startMin: number, endMin: number, steps: { title: string; minutes: number | null; waiting: boolean }[]): Interval[] {
  const parts = stepParts(startMin, steps);
  if (!parts.length) return [[startMin, endMin]];
  return parts.filter((p) => !p.waiting).map((p) => [p.startMin, p.endMin]);
}

/**
 * What's busy on a day's schedule: classes, events, routines, and task blocks. Skipped classes and
 * open time are free, and so are the waiting parts of laundry-style steps. Blocks in `skip` (the
 * penciled ones a plan lifts) are left out.
 */
export function busyOf(schedule: ScheduleItem[], skip: Set<string> = new Set()): Interval[] {
  const out: Interval[] = [];
  for (const it of schedule) {
    if (it.type === 'class') {
      if (!it.skipped) out.push([it.startMin, it.endMin]);
    } else if (it.type === 'routine') {
      out.push(...handsOn(it.startMin, it.endMin, it.steps));
    } else if (it.kind !== 'open' && !skip.has(it.id)) {
      out.push(...handsOn(it.startMin, it.endMin, it.steps));
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

const clashes = (a: number, b: number, busy: Interval[]) => busy.some(([x, y]) => a < y + BUFFER && b > x - BUFFER);

/** Free stretches between `from` and `to`, at least 15 minutes long, on 15-minute marks. */
export function freeSlots(from: number, to: number, busy: Interval[]): Interval[] {
  const out: Interval[] = [];
  let cur = from;
  for (const [a, b] of [...busy].sort((x, y) => x[0] - y[0])) {
    if (b + BUFFER <= cur) continue;
    if (a - BUFFER > cur) out.push([cur, Math.min(a - BUFFER, to)]);
    cur = Math.max(cur, b + BUFFER);
    if (cur >= to) break;
  }
  if (cur < to) out.push([cur, to]);
  return out.map(([a, b]): Interval => [roundUp(a), roundDown(b)]).filter(([a, b]) => b - a >= STEP);
}

export const freeMinutes = (from: number, to: number, busy: Interval[]) => freeSlots(from, to, busy).reduce((n, [a, b]) => n + b - a, 0);

/** A task's shape on the schedule: its length and its hands-on parts, measured from its start. */
export interface Shape {
  minutes: number;
  /** Relative to the start. A simple task is one part covering its whole length. */
  handsOn: Interval[];
}

export function shapeOf(minutes: number, steps: { title: string; minutes: number | null; waiting: boolean }[]): Shape {
  const parts = stepParts(0, steps);
  if (!parts.length) return { minutes, handsOn: [[0, minutes]] };
  const total = Math.max(minutes, parts[parts.length - 1]!.endMin);
  return { minutes: total, handsOn: parts.filter((p) => !p.waiting).map((p) => [p.startMin, p.endMin]) };
}

/**
 * The first start, on a 15-minute mark from `from`, where the whole task ends by `to` and none of
 * its hands-on parts come near anything busy.
 */
export function firstFit(from: number, to: number, shape: Shape, busy: Interval[]): number | null {
  for (let s = roundUp(from); s + shape.minutes <= to; s += STEP) {
    if (shape.handsOn.every(([a, b]) => !clashes(s + a, s + b, busy))) return s;
  }
  return null;
}

/** What the planner needs to know about a task. */
export interface PlanTask {
  id: string;
  title: string;
  window: Window;
  dueAt: string | null;
  dueDate: string | null;
  estLow: number | null;
  estHigh: number | null;
  sittingMinutes: number | null;
  sessionMinutes: number | null;
  doneAt: string | null;
  steps: { title: string; minutes: number | null; waiting: boolean; done: boolean }[];
  /** The day it's committed to in the Sometime lane, and where it rolled from. */
  sometime: { date: string; rolledFrom: string | null } | null;
  /** It already has a block from now on (not counting blocks this plan lifts). */
  scheduled: boolean;
}

export interface PlanClock {
  now: DateTime;
  today: string;
  zone: string;
  homeZone: string;
}

const BASE: Partial<Record<EffectiveWindow, number>> = { overdue: 400, near: 60, week: 30, soon: 12, ongoing: 6 };
const BASE_REASON: Partial<Record<EffectiveWindow, string>> = {
  overdue: 'Overdue', near: 'Today or tomorrow', week: 'This week', soon: 'Free time, no rush', ongoing: 'Practice session',
};

/** Where a deadline falls as seen from `zone`: its day and minute (null for day-only). */
function dueOn(t: PlanTask, zone: string): { date: string; min: number | null } | null {
  const date = deadlineDay(t, zone);
  if (!date) return null;
  return { date, min: t.dueAt ? minutesOnDay(DateTime.fromISO(t.dueAt, { zone: 'utc' }), date, zone) : null };
}

/**
 * A task's score for a day (spec §12, "Scoring"), and the reason a block would show. Null when it's
 * never planned: done, waiting, a decision, or due before that day.
 */
export function scoreTask(t: PlanTask, date: string, c: PlanClock): { score: number; reason: string } | null {
  if (t.doneAt) return null;
  const w = effectiveWindow(t, c.now, c.zone, c.homeZone);
  let score = BASE[w];
  let reason = BASE_REASON[w];
  if (score == null || reason == null) return null;
  const due = dueOn(t, c.zone);
  if (due && w !== 'overdue') {
    const left = diffDays(date, due.date);
    if (left < 0) return null;
    score += 90 / (left + 1) + (4 * (t.estHigh ?? 0)) / 60;
    reason = `Due ${dueLabel(c.today, due.date, due.min)}`;
  }
  if (t.sometime?.date === date) {
    score += 200;
    reason = t.sometime.rolledFrom ? `Not finished ${relWord(c.today, t.sometime.rolledFrom)}` : 'You picked this day for it';
  }
  return { score, reason };
}

/** The latest a task can end on a day: 15 minutes before a timed deadline that day. */
function limitOn(t: PlanTask, date: string, c: PlanClock, to: number): number {
  const due = dueOn(t, c.zone);
  if (!due || due.date !== date || due.min == null || isOverdue(t, c.now, c.homeZone)) return to;
  return Math.min(to, due.min - DEADLINE_MARGIN);
}

const lengthOf = (t: PlanTask, keep?: number) => shapeOf(keep ?? blockLength(t), keep ? [] : t.steps);

export interface Placement {
  taskId: string;
  date: string;
  startMin: number;
  minutes: number;
  reason: string;
  rolledFrom: string | null;
}

/**
 * Plans one day (spec §12, "Plan button"): scores every unfinished task that isn't scheduled and
 * places them, highest score first, into the day's free time, at most 6. `keep` holds the lengths
 * of penciled blocks the plan lifted, so a block you resized keeps its length.
 */
export function planDay(day: DayFree, tasks: PlanTask[], c: PlanClock, keep: Map<string, number> = new Map()): Placement[] {
  const busy = [...day.busy];
  const candidates = tasks
    .filter((t) => !t.scheduled && (!t.sometime || t.sometime.date === day.date))
    .flatMap((t) => {
      const s = scoreTask(t, day.date, c);
      return s ? [{ t, ...s }] : [];
    })
    .sort((a, b) => b.score - a.score);

  const out: Placement[] = [];
  for (const { t, reason } of candidates) {
    if (out.length >= MAX_PER_RUN) break;
    const shape = lengthOf(t, keep.get(t.id));
    const at = firstFit(day.from, limitOn(t, day.date, c, day.to), shape, busy);
    if (at == null) continue;
    busy.push(...shape.handsOn.map(([a, b]): Interval => [at + a, at + b]));
    out.push({ taskId: t.id, date: day.date, startMin: at, minutes: shape.minutes, reason, rolledFrom: t.sometime?.rolledFrom ?? null });
  }
  return out;
}

/** How many days ahead automatic scheduling looks, at most. */
const AUTO_HORIZON = 14;

/**
 * Automatic scheduling (spec §12): each new task in Today or tomorrow, This week, or Overdue goes
 * in the first free slot before its deadline, or within 1 or 6 days. A task committed to a day only
 * goes on that day. Soon and Ongoing tasks are never placed. `dayFree` gives each day's free time;
 * placements are added to it as they're made.
 */
export function placeNew(tasks: PlanTask[], c: PlanClock, dayFree: (date: string) => DayFree): Placement[] {
  const days = new Map<string, DayFree>();
  const get = (date: string) => {
    let d = days.get(date);
    if (!d) days.set(date, (d = dayFree(date)));
    return d;
  };
  const out: Placement[] = [];
  for (const t of tasks) {
    if (t.doneAt || t.scheduled) continue;
    const w = effectiveWindow(t, c.now, c.zone, c.homeZone);
    if (w !== 'overdue' && w !== 'near' && w !== 'week') continue;
    const due = dueOn(t, c.zone);
    const first = t.sometime?.date ?? c.today;
    const last = t.sometime?.date ?? (due && w !== 'overdue' ? due.date : addDays(c.today, w === 'week' ? 6 : 1));
    for (let date = first, n = 0; date <= last && n < AUTO_HORIZON; date = addDays(date, 1), n++) {
      const day = get(date);
      const shape = lengthOf(t);
      const at = firstFit(day.from, limitOn(t, date, c, day.to), shape, day.busy);
      if (at == null) continue;
      day.busy.push(...shape.handsOn.map(([a, b]): Interval => [at + a, at + b]));
      const reason = scoreTask(t, date, c)?.reason ?? BASE_REASON[w]!;
      out.push({ taskId: t.id, date, startMin: at, minutes: shape.minutes, reason, rolledFrom: t.sometime?.rolledFrom ?? null });
      break;
    }
  }
  return out;
}

/** About how much work is left on a task: the middle of its estimate (or 30 minutes), less finished steps. */
export function remainingMinutes(t: Pick<PlanTask, 'estLow' | 'estHigh' | 'steps'>): number {
  const base = t.estLow != null && t.estHigh != null ? (t.estLow + t.estHigh) / 2 : (t.estLow ?? t.estHigh ?? 30);
  if (!t.steps.length) return base;
  return base * (1 - t.steps.filter((s) => s.done).length / t.steps.length);
}

export interface Capacity {
  level: 'heads-up' | 'tight';
  /** Minutes of work due by the deadline, and of free time before it. */
  work: number;
  free: number;
  dueAt: string | null;
  dueDate: string | null;
}

/** Deadlines this many days out or fewer are checked. */
const CAPACITY_DAYS = 6;

/**
 * The capacity warning (spec §6): for the soonest deadline where the work due by then is more than
 * half of the free time before it. "Heads up" over 50%, "Tight" over 80%. `scheduled` is the
 * minutes already on the schedule (from now on) for each task, which is time set aside for it.
 */
export function capacity(tasks: PlanTask[], c: PlanClock, dayFree: (date: string) => DayFree, scheduled: Map<string, number>): Capacity | null {
  const open = tasks.filter((t) => !t.doneAt && t.window !== 'decide' && (t.dueAt || t.dueDate) && !isOverdue(t, c.now, c.homeZone));
  const key = (t: PlanTask) => {
    const d = dueOn(t, c.zone)!;
    return { date: d.date, min: d.min ?? Infinity };
  };
  const sorted = open.map((t) => ({ t, k: key(t) })).sort((a, b) => a.k.date.localeCompare(b.k.date) || a.k.min - b.k.min);
  const free = new Map<string, DayFree>();
  const get = (date: string) => {
    let d = free.get(date);
    if (!d) free.set(date, (d = dayFree(date)));
    return d;
  };

  const seen = new Set<string>();
  for (const { t, k } of sorted) {
    const id = `${k.date}@${k.min}`;
    if (seen.has(id) || diffDays(c.today, k.date) > CAPACITY_DAYS) continue;
    seen.add(id);
    const group = sorted.filter((x) => x.k.date < k.date || (x.k.date === k.date && x.k.min <= k.min)).map((x) => x.t);
    const work = group.reduce((n, x) => n + remainingMinutes(x), 0);
    let time = group.reduce((n, x) => n + (scheduled.get(x.id) ?? 0), 0);
    for (let date = c.today; date <= k.date; date = addDays(date, 1)) {
      const d = get(date);
      time += freeMinutes(d.from, date === k.date ? Math.min(d.to, k.min) : d.to, d.busy);
    }
    const ratio = work / Math.max(time, 1);
    if (ratio > 0.5) return { level: ratio > 0.8 ? 'tight' : 'heads-up', work: Math.round(work), free: time, dueAt: t.dueAt, dueDate: t.dueDate };
  }
  return null;
}
