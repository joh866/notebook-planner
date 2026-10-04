import { DateTime } from 'luxon';

// Google Calendar (spec §14). Pure: turns Google's event data into what the planner stores, and works
// out what to send to the "Planner" calendar when write-back is on. The server does the fetching.

/** The parts of a Google Calendar event that are read (Events resource, API v3). */
export interface GoogleEventRaw {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/**
 * A Google event as stored. Timed events have `startAt` and `endAt` (UTC ISO). All-day events have
 * `startDate` and `endDate` ("yyyy-MM-dd"), with the end day not included, as Google gives it.
 */
export interface CalEvent {
  eventId: string;
  title: string;
  location: string | null;
  link: string | null;
  /** False for events marked "Free" in Google, which the planner can schedule over. */
  busy: boolean;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
}

const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** One Google event as stored, or null for cancelled ones, ones you declined, and ones with no usable time. */
export function fromGoogle(raw: GoogleEventRaw): CalEvent | null {
  if (raw.status === 'cancelled') return null;
  if (raw.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;
  const base = {
    eventId: raw.id, title: raw.summary?.trim() || '(No title)', location: raw.location?.trim() || null,
    link: raw.htmlLink ?? null, busy: raw.transparency !== 'transparent',
  };
  const s = raw.start, e = raw.end;
  if (s?.dateTime && e?.dateTime) {
    const a = DateTime.fromISO(s.dateTime, { setZone: true });
    const b = DateTime.fromISO(e.dateTime, { setZone: true });
    if (!a.isValid || !b.isValid || b < a) return null;
    return { ...base, startAt: iso(a), endAt: iso(b), startDate: null, endDate: null };
  }
  if (s?.date && DAY.test(s.date)) {
    const end = e?.date && DAY.test(e.date) && e.date > s.date ? e.date : DateTime.fromISO(s.date).plus({ days: 1 }).toISODate()!;
    return { ...base, startAt: null, endAt: null, startDate: s.date, endDate: end };
  }
  return null;
}

/** Whether an all-day event covers a day. */
export const allDayOn = (e: Pick<CalEvent, 'startDate' | 'endDate'>, date: string) =>
  !!e.startDate && !!e.endDate && e.startDate <= date && date < e.endDate;

// ---------- Write-back to the "Planner" calendar ----------

/** A planned block, as sent to Google. */
export interface PushBlock {
  blockId: string;
  title: string;
  /** UTC ISO. */
  startAt: string;
  durationMinutes: number;
  location: string | null;
  done: boolean;
  /** Pinned by you, or penciled in by the planner with its reason. */
  pinned: boolean;
  reason: string | null;
}

/** The Google event body for a block. The block's id goes in a private property so it can be found again. */
export interface PushBody {
  summary: string;
  location?: string;
  description: string;
  start: { dateTime: string };
  end: { dateTime: string };
  extendedProperties: { private: { plannerBlockId: string } };
}

export function pushBody(b: PushBlock): PushBody {
  const start = DateTime.fromISO(b.startAt, { zone: 'utc' });
  const how = b.pinned ? 'Pinned in Planner.' : `Penciled in by Planner${b.reason ? `: ${b.reason.charAt(0).toLowerCase()}${b.reason.slice(1)}` : ''}.`;
  return {
    summary: `${b.done ? '✓ ' : ''}${b.title}`,
    ...(b.location ? { location: b.location } : {}),
    description: how,
    start: { dateTime: iso(start) },
    end: { dateTime: iso(start.plus({ minutes: b.durationMinutes })) },
    extendedProperties: { private: { plannerBlockId: b.blockId } },
  };
}

/** A block already in Google: its event id, and the body last sent. */
export interface Pushed {
  blockId: string;
  eventId: string;
  sent: string;
}

export interface WriteBackPlan {
  create: { blockId: string; body: PushBody; sent: string }[];
  update: { blockId: string; eventId: string; body: PushBody; sent: string }[];
  remove: { blockId: string; eventId: string }[];
}

/**
 * What to change in the Planner calendar so it matches `blocks`. A block sent before that isn't in
 * `blocks` is removed, unless it's in `keep` (a block that still exists but is outside the days sent).
 */
export function writeBackPlan(blocks: PushBlock[], pushed: Pushed[], keep: Set<string> = new Set()): WriteBackPlan {
  const plan: WriteBackPlan = { create: [], update: [], remove: [] };
  const byBlock = new Map(pushed.map((p) => [p.blockId, p]));
  const wanted = new Set<string>();
  for (const b of blocks) {
    wanted.add(b.blockId);
    const body = pushBody(b);
    const sent = JSON.stringify(body);
    const p = byBlock.get(b.blockId);
    if (!p) plan.create.push({ blockId: b.blockId, body, sent });
    else if (p.sent !== sent) plan.update.push({ blockId: b.blockId, eventId: p.eventId, body, sent });
  }
  for (const p of pushed) if (!wanted.has(p.blockId) && !keep.has(p.blockId)) plan.remove.push({ blockId: p.blockId, eventId: p.eventId });
  return plan;
}
