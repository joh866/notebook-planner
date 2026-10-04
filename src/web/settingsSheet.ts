import type { Notify } from '../shared/schemas';
import { clockMin, fmtRange, fmtTime, joinAnd, shortLoc } from './format';

// Words and limits for the settings sheet (spec §13).

/** The schedule opens between 6am and noon, and closes between 9pm and 2am (as in the prototype). */
const WAKE = { min: 6 * 60, max: 12 * 60 };
const BED = { min: 21 * 60, max: 26 * 60 };

const hhmm = (m: number) => {
  const d = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
};

/** A wake or bed time kept in range, plus a note when it had to change. */
export function clampDayTime(which: 'wake' | 'bed', value: string): { value: string; note: string | null } {
  const r = which === 'wake' ? WAKE : BED;
  const m = clockMin(value);
  if (m < r.min) return { value: hhmm(r.min), note: `Set to ${fmtTime(r.min)}, the earliest it can be.` };
  if (m > r.max) return { value: hhmm(r.max), note: `Set to ${fmtTime(r.max)}, the latest it can be.` };
  return { value, note: null };
}

/** The notification switches, in spec §13's order. */
export const NOTIFY_ROWS: { key: keyof Notify; label: string; sub: string }[] = [
  { key: 'classes', label: 'Before each class', sub: '10 minutes before it starts' },
  { key: 'taskStarts', label: 'When a scheduled task starts', sub: 'Includes ones the planner put on your schedule' },
  { key: 'deadlines', label: 'Deadlines', sub: 'The evening before and the morning of' },
  { key: 'morningSummary', label: 'Morning summary', sub: 'What’s on today, shortly after you usually wake up' },
  { key: 'planTomorrow', label: 'Plan tomorrow', sub: 'An hour before your usual bedtime' },
  { key: 'checkIns', label: 'Check-in questions', sub: 'Like “Is the cold fully gone?”, at most once a day' },
  { key: 'waitingEnds', label: 'When a waiting part ends', sub: 'Like “Move your laundry to the dryer”' },
];

/** "America/New_York" → "New York". "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export const zoneCity = (zone: string) => zone.split('/').pop()!.replace(/_/g, ' ');

/** Every time zone this browser knows, with the ones in use included, sorted by name. */
export function zoneList(known: string[], ...include: string[]): string[] {
  return [...new Set([...known, ...include])].filter((z) => z.includes('/')).sort();
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon, Wed, and Fri, 10:30–11:20am, Kent 107" for a class row in the sheet. */
export function classLine(c: { days: number[]; start: string; end: string; location: string | null }): string {
  const days = joinAnd([...c.days].sort().map((d) => DAY_NAMES[d]!));
  const loc = shortLoc(c.location);
  return `${days}, ${fmtRange(clockMin(c.start), clockMin(c.end))}${loc ? `, ${loc}` : ''}`;
}

/** What the test button says (spec §13). */
export function pushTestMessage(r: { sent: number; failed: number }): string {
  if (!r.sent && !r.failed) return 'No device has notifications on yet. Turn them on for this device first.';
  const to = r.sent ? `Sent to ${r.sent} device${r.sent === 1 ? '' : 's'}. Check your notifications.` : 'It didn’t go through.';
  return r.failed ? `${to} ${r.failed} device${r.failed === 1 ? '' : 's'} didn’t take it.` : to;
}

/** Why notifications can't be turned on here, or null when they can. */
export function pushBlocker(support: 'ok' | 'install-first' | 'unsupported', publicKey: string | null): string | null {
  if (!publicKey) return 'Notifications aren’t set up on this server. They work in the online app.';
  if (support === 'install-first') return 'On iPhone, add the planner to your Home Screen first (Share, then Add to Home Screen). Then open it from there and turn notifications on.';
  if (support === 'unsupported') return 'This browser can’t get notifications.';
  return null;
}

/** What the page says after Google sends you back from Connect (`?google=` on the address). Null for anything else. */
export function googleReturnMessage(code: string | null): string | null {
  switch (code) {
    case 'connected': return 'Google Calendar is connected. Your events show in gray.';
    case 'sync-failed': return 'Google Calendar is connected, but the first sync didn’t work. Try Sync now in Settings.';
    case 'denied': return 'Google Calendar wasn’t connected, since access wasn’t allowed.';
    case 'failed': return 'Couldn’t connect Google Calendar. Try Connect again.';
    case 'not-set-up': return 'Google Calendar isn’t set up on the server yet. The steps are in GOOGLE.md.';
    default: return null;
  }
}

/** What Sync now says. */
export function googleSyncMessage(r: { events: number; calendars: number; sent: number; error: string | null }, writeBack: boolean): string {
  if (r.error) return `Couldn’t sync Google Calendar: ${r.error}.`;
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  return `Synced ${n(r.events, 'event')} from ${n(r.calendars, 'calendar')}${writeBack ? `, and sent ${n(r.sent, 'change')} to the Planner calendar` : ''}.`;
}
