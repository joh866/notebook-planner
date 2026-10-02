import { DateTime } from 'luxon';
import { DAY_START_HOUR, dayOf, diffDays, weekday } from '../core/day';
import { minutesOnDay, parseClock } from '../core/time';
import { DAYS, fmtTime, relWord } from '../core/words';

export { dueLabel, fmtTime, relWord } from '../core/words';

// Words and labels for the UI. Minutes are wall-clock minutes after a day's midnight (over 1440
// after midnight), as the API returns them.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function joinAnd(a: string[]): string {
  if (a.length < 2) return a.join('');
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(', ')}, and ${a[a.length - 1]}`;
}

/** "11–12:20pm", "1:30–2:50pm", "11pm–12am". */
export function fmtRange(a: number, b: number): string {
  const A = fmtTime(a);
  const B = fmtTime(b);
  return `${A.slice(-2) === B.slice(-2) ? A.slice(0, -2) : A}–${B}`;
}

/** "45m", "1h", "1.5h", "45–90m", "3–5h". */
export function fmtDur(lo: number, hi?: number | null): string {
  const f = (m: number) => (m < 60 ? `${m}m` : `${String(Math.round((m / 60) * 10) / 10)}h`);
  if (hi == null || lo === hi) return f(lo);
  if (hi <= 90) return `${lo}–${hi}m`;
  if (lo >= 60) return `${f(lo).slice(0, -1)}–${f(hi)}`;
  return `${f(lo)}–${f(hi)}`;
}

/** Minutes for a local "HH:mm" on the schedule. Before 4am is that day's night, so "00:00" is 1440. */
export function clockMin(hhmm: string): number {
  const m = parseClock(hhmm);
  return m < DAY_START_HOUR * 60 ? m + 1440 : m;
}

const parse = (date: string) => DateTime.fromFormat(date, 'yyyy-MM-dd');

/** "Friday, October 2". */
export const longDate = (date: string) => parse(date).toFormat('cccc, LLLL d');
/** "Fri, Oct 2". */
export const shortDate = (date: string) => parse(date).toFormat('ccc, LLL d');

/** Where a UTC moment falls in `zone`: its planner day and minutes on that day. */
export function momentOn(isoUtc: string, zone: string): { date: string; min: number } {
  const at = DateTime.fromISO(isoUtc, { zone: 'utc' });
  const date = dayOf(at, zone);
  return { date, min: minutesOnDay(at, date, zone) };
}

/** A deadline's day and time (null for day-only) as seen from `zone`. */
export function deadlineOn(d: { dueAt: string | null; dueDate: string | null }, zone: string): { date: string; min: number | null } | null {
  if (d.dueAt) return momentOn(d.dueAt, zone);
  if (d.dueDate) return { date: d.dueDate, min: null };
  return null;
}

/** The Plan button's day (spec §7): hidden on past days, and after 9pm today it plans tomorrow. */
export function planTarget(today: string, selected: string, nowMin: number): string | null {
  const n = diffDays(today, selected);
  if (n < 0) return null;
  if (n === 0 && nowMin >= 21 * 60) return parse(today).plus({ days: 1 }).toFormat('yyyy-MM-dd');
  return selected;
}

/** "Plan today", "Plan tomorrow", "Plan Friday", or "Plan Oct 14". */
export function planLabel(today: string, target: string): string {
  const n = diffDays(today, target);
  if (n === 0) return 'Plan today';
  if (n === 1) return 'Plan tomorrow';
  if (n < 7) return `Plan ${DAYS[weekday(target)]}`;
  return `Plan ${parse(target).toFormat('LLL d')}`;
}

/** "Saieh Hall for Economics 021" becomes "Saieh 021". */
export function shortLoc(loc: string | null): string {
  const w = (loc ?? '').trim().split(/\s+/);
  if (w.length >= 2 && /\d/.test(w[w.length - 1]!)) return `${w[0]} ${w[w.length - 1]}`;
  return loc ?? '';
}

export const monthName = (i: number) => MONTHS[i]!;

/** A tentative event's label after it moves: "Around 7, depends on friends" becomes "Around 8:30pm, depends on friends". */
export function aroundLabel(label: string | null, m: number): string {
  const at = `Around ${fmtTime(m)}`;
  if (label && /^around\b/i.test(label)) return label.replace(/^around[^,]*/i, at);
  return at;
}

/** How a routine repeats: "every day", "every Saturday", "every other Saturday", "every Monday and Wednesday". */
export function repeatWords(r: { repeat: 'daily' | 'weekly'; repeatDays: number[] | null; repeatEvery: number }): string {
  if (r.repeat === 'daily' || !r.repeatDays?.length) return 'every day';
  return `every ${r.repeatEvery > 1 ? 'other ' : ''}${joinAnd(r.repeatDays.map((d) => DAYS[d]!))}`;
}

/** "5h", "4h 30m", "45m", rounded to 15 minutes. */
export function fmtHours(m: number): string {
  const r = Math.round(m / 15) * 15;
  const h = Math.floor(r / 60);
  const mm = r % 60;
  return h ? `${h}h${mm ? ` ${mm}m` : ''}` : `${mm}m`;
}

/**
 * The capacity warning (spec §6): "Tight: about 5h of work is due by Tuesday at 2pm, and you have
 * about 4h of free time before then."
 */
export function capacityText(c: { level: 'heads-up' | 'tight'; work: number; free: number; dueAt: string | null; dueDate: string | null }, today: string, zone: string): string {
  const at = deadlineOn(c, zone)!;
  const when = `${relWord(today, at.date)}${at.min != null ? ` at ${fmtTime(at.min)}` : ''}`;
  return `${c.level === 'tight' ? 'Tight' : 'Heads up'}: about ${fmtHours(c.work)} of work is due by ${when}, and you have about ${fmtHours(c.free)} of free time before then.`;
}

/** "Penciled in 4 tasks for today." and the like, after the Plan button (spec §12). */
export function planMessage(r: { date: string; placed: { title: string; startAt: string }[]; lifted: number; free: number }, today: string, zone: string): string {
  const day = relWord(today, r.date);
  const n = r.placed.length;
  if (n === 1) {
    const at = momentOn(r.placed[0]!.startAt, zone);
    return `Penciled in “${r.placed[0]!.title}” ${day} at ${fmtTime(at.min)}.`;
  }
  if (n > 1) return `Penciled in ${n} tasks for ${day}.`;
  if (r.free < 15) return `There’s no free time left ${day}.`;
  return 'Nothing to plan. Everything is scheduled, waiting, or needs a decision.';
}
