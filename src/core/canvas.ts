import type { ICalEvent } from './ical';

// Canvas's calendar feed (spec §14, "Canvas"). Assignments come as events whose id starts with
// "event-assignment-", titled "Problem Set 1 [MATH 15910 1 (Autumn 2026) Introduction to Proofs]".
// They become tasks with deadlines in Classes, matched to a course by its code.

export interface Assignment {
  uid: string;
  title: string;
  /** The matching class code ("MATH 15910"), or the course as Canvas names it. */
  course: string | null;
  dueAt: string | null;
  dueDate: string | null;
  url: string | null;
}

const CODE = /\b([A-Z]{2,5})\s?(\d{4,5})\b/;

/** The course a summary's brackets name, as one of `codes` when it matches. */
function courseOf(bracket: string | null, codes: string[]): string | null {
  if (!bracket) return null;
  const m = CODE.exec(bracket);
  if (m) {
    const code = `${m[1]} ${m[2]}`;
    return codes.find((c) => c.replace(/\s+/g, ' ').toUpperCase() === code) ?? code;
  }
  return bracket.trim() || null;
}

/** The assignments in a feed. Other calendar events are left out. */
export function canvasAssignments(events: ICalEvent[], codes: string[]): Assignment[] {
  return events.filter((e) => e.uid.startsWith('event-assignment-')).map((e) => {
    const m = /^(.*?)\s*\[([^\]]*)\]\s*$/.exec(e.summary);
    return {
      uid: e.uid,
      title: (m ? m[1]! : e.summary).trim() || 'Canvas assignment',
      course: courseOf(m ? m[2]! : null, codes),
      dueAt: e.startAt,
      dueDate: e.startAt ? null : e.startDate,
      url: e.url,
    };
  });
}
