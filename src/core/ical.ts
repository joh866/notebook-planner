import { DateTime } from 'luxon';

// A small iCalendar reader (RFC 5545), enough for calendar feeds like Canvas's (spec §14). It reads
// VEVENTs: their id, summary, description, link, and start, which is a moment or a whole day.

export interface ICalEvent {
  uid: string;
  summary: string;
  description: string | null;
  url: string | null;
  /** A moment (UTC ISO) when the start has a time. */
  startAt: string | null;
  /** "yyyy-MM-dd" when the start is a whole day. */
  startDate: string | null;
}

/** Undoes line folding (a line starting with a space or tab continues the one before). */
const unfold = (text: string) => text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');

/** Undoes text escaping: \n, \, \; \\ */
const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** A start value as a moment or a day. Floating times (no zone) are read in `zone`. */
function startOf(params: Record<string, string>, value: string, zone: string): { startAt: string | null; startDate: string | null } {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const d = DateTime.fromFormat(value.slice(0, 8), 'yyyyMMdd');
    return { startAt: null, startDate: d.isValid ? d.toFormat('yyyy-MM-dd') : null };
  }
  const utc = value.endsWith('Z');
  const d = DateTime.fromFormat(value.replace(/Z$/, ''), "yyyyMMdd'T'HHmmss", { zone: utc ? 'utc' : (params.TZID ?? zone) });
  return { startAt: d.isValid ? d.toUTC().toISO({ suppressMilliseconds: true }) : null, startDate: null };
}

/** The events in a feed. Ones without an id or a start are left out. */
export function parseICal(text: string, zone = 'America/Chicago'): ICalEvent[] {
  const out: ICalEvent[] = [];
  let cur: Partial<ICalEvent> | null = null;
  for (const line of unfold(text).split('\n')) {
    if (line === 'BEGIN:VEVENT') {
      cur = { description: null, url: null, startAt: null, startDate: null };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur?.uid && (cur.startAt || cur.startDate)) out.push({ summary: '', ...cur } as ICalEvent);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [name = '', ...rawParams] = line.slice(0, colon).split(';');
    const value = line.slice(colon + 1);
    const params = Object.fromEntries(rawParams.map((p) => p.split('=') as [string, string]));
    switch (name.toUpperCase()) {
      case 'UID': cur.uid = value.trim(); break;
      case 'SUMMARY': cur.summary = unescape(value).trim(); break;
      case 'DESCRIPTION': cur.description = unescape(value).trim() || null; break;
      case 'URL': cur.url = value.trim() || null; break;
      case 'DTSTART': Object.assign(cur, startOf(params, value.trim(), zone)); break;
    }
  }
  return out;
}
