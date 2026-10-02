import { DateTime } from 'luxon';
import { diffDays, weekday } from './day';

// Plain words for times and days, shared by the UI and the planner's reasons ("Due Tue 2pm").

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const SHORT_DAYS = DAYS.map((d) => d.slice(0, 3));

/** "9am", "8:15pm". Minutes are wall-clock minutes on a day (over 1440 after midnight). */
export function fmtTime(m: number): string {
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}

/** "today", "tomorrow", "yesterday", "Tuesday", "last Tuesday", or "Oct 14". */
export function relWord(today: string, date: string): string {
  const n = diffDays(today, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 1 && n < 7) return DAYS[weekday(date)]!;
  if (n < -1 && n > -7) return `last ${DAYS[weekday(date)]}`;
  return DateTime.fromFormat(date, 'yyyy-MM-dd').toFormat('LLL d');
}

/** The due chip's words: "today 2pm", "Tue 2pm", "Fri", "Oct 14, 11am". */
export function dueLabel(today: string, date: string, atMin: number | null): string {
  const n = diffDays(today, date);
  const day = n === 0 ? 'today' : n === 1 ? 'tomorrow' : Math.abs(n) < 7 && n !== -1 ? SHORT_DAYS[weekday(date)]! : relWord(today, date);
  return atMin == null ? day : `${day}${Math.abs(n) >= 7 ? ',' : ''} ${fmtTime(atMin)}`;
}
