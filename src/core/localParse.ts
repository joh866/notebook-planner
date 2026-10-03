import { DateTime } from 'luxon';
import type { ParsedItem } from '../shared/parsed';
import { addDays, diffDays, weekday } from './day';

// The add box's simple local guess, for when the AI can't be reached (spec §11, "Long input"). It
// reads the same notes the AI does, with plain rules: header lines carry a date, time, and course
// to the lines under them, and remarks in parentheses set the window and repeats. It never invents
// a date or time that isn't written down.

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const pad = (n: number) => String(n).padStart(2, '0');
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const tidy = (s: string) => s.replace(/\s{2,}/g, ' ').replace(/\s+([,.?!])/g, '$1').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '').trim();

/**
 * "2:00pm", "11am", "7:00" as "HH:mm". Without am or pm, hours before 8 are taken as pm.
 * `night` reads "12:30pm" as just after midnight, the usual slip for a bedtime.
 */
export function clockFromText(s: string, night = false): string | null {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  const ap = m[3]?.toLowerCase().replace(/\./g, '');
  if (night && h === 12) h = 0;
  else if (ap === 'pm' && h < 12) h += 12;
  else if (ap === 'am' && h === 12) h = 0;
  else if (!ap && (night ? h >= 4 && h < 12 : h < 8)) h += 12;
  return `${pad(h)}:${pad(min)}`;
}

/** "10/6" as a day: this year, or next year if that's long past. */
function dayFromSlash(month: number, day: number, today: string): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = Number(today.slice(0, 4));
  const d = `${year}-${pad(month)}-${pad(day)}`;
  if (!DateTime.fromFormat(d, 'yyyy-MM-dd').isValid) return null;
  return diffDays(today, d) < -60 ? `${year + 1}-${pad(month)}-${pad(day)}` : d;
}

/** The next day (today counts) that falls on a weekday. */
function nextWeekday(today: string, wd: number): string {
  let d = today;
  while (weekday(d) !== wd) d = addDays(d, 1);
  return d;
}

const weekdayIn = (s: string) => {
  const m = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i.exec(s);
  return m ? WEEKDAYS.indexOf(m[1]!.toLowerCase().slice(0, 3)) : null;
};

const windowFor = (today: string, date: string): ParsedItem['win'] => {
  const n = diffDays(today, date);
  return n <= 1 ? 'near' : n <= 6 ? 'week' : 'soon';
};

function guessCategory(text: string, course: string | null): string {
  if (course || /\b(pset|problem set|reading|essay|homework|lab|exam|quiz|midterm|lecture|class)\b/i.test(text)) return 'class';
  if (/\b(buy|get|pick up|return|order|shop)\b/i.test(text)) return 'errand';
  if (/\b(study|learn|project|resume|internship|course|skill|plan|research|book)\b/i.test(text)) return 'growth';
  return 'life';
}

interface Context {
  date: string | null;
  time: string | null;
  course: string | null;
}

export function localParse(text: string, today: string): ParsedItem[] {
  const out: ParsedItem[] = [];
  let cat: string | null = null;
  let ctx: Context = { date: null, time: null, course: null };
  /** Inside a "Today:" plan, where "Label: time" lines are events. */
  let plan = false;
  /** "Right now: 5:30pm" gives its time to the next line. */
  let pendingAt: string | null = null;

  for (const raw of text.replace(/^\uFEFF/, '').split('\n')) {
    const bullet = /^\s*[-•*]/.test(raw);
    const line = raw.replace(/^\s*[-•*]\s*/, '').trim();
    if (!line) {
      // A blank line ends the headers above it.
      ctx = { date: null, time: null, course: null };
      cat = null;
      pendingAt = null;
      continue;
    }

    // ---- Header lines ----
    const catHead = /^category\s*:\s*(.+)$/i.exec(line);
    if (catHead) {
      cat = catHead[1]!.trim();
      continue;
    }
    const dateHead = /^(\d{1,2})\/(\d{1,2})\b\s*(\([^)]*\))?\s*$/.exec(line);
    if (dateHead) {
      ctx = { date: dayFromSlash(Number(dateHead[1]), Number(dateHead[2]), today), time: null, course: null };
      continue;
    }
    if (/^[A-Z]{2,5}\s?\d{4,5}$/.test(line)) {
      ctx.course = line;
      continue;
    }
    const timeHead = /^\(\s*(?:before|by|due)\s+([^)]+)\)$/i.exec(line);
    if (timeHead) {
      ctx.time = clockFromText(timeHead[1]!);
      continue;
    }
    if (/^today\s*:?\s*$/i.test(line)) {
      plan = true;
      ctx = { date: today, time: null, course: null };
      continue;
    }

    // ---- A time plan for today: "Right now: 5:30pm", "Dinner: Around 7:00pm? Contingent" ----
    // Outside a plan, a "Label: time" line with am or pm is one too.
    // The label can't end in a digit, so the colon in "at 2:30pm" isn't one.
    const labeled = bullet ? null : /^([^:]{0,39}[^:\d]):\s*(.+)$/.exec(line);
    const planLine = labeled && (plan || /\d\s*(am|pm)\b/i.test(labeled[2]!)) ? labeled : null;
    if (planLine) {
      const label = planLine[1]!.trim();
      const rest = planLine[2]!;
      const at = clockFromText(rest);
      if (/^(right )?now$/i.test(label)) {
        pendingAt = at;
        continue;
      }
      const tentative = /\baround\b|\?|contingent|depends|maybe/i.test(rest);
      const note = tidy(tidy(rest.replace(/^.*?\d{1,2}(:\d{2})?\s*(am|pm)?\??/i, '')).replace(/^contingent\b/i, ''));
      out.push({
        type: 'event', title: cap(label), date: today, cat: 'life',
        ...(at ? { start: at } : {}), ...(tentative ? { tentative: true } : {}), ...(note ? { meta: cap(note) } : {}),
      });
      continue;
    }

    // ---- An item ----
    const remarks = [...line.matchAll(/\(([^)]*)\)?/g)].map((m) => m[1]!.toLowerCase()).join('; ');
    let main = tidy(line.replace(/\([^)]*\)?/g, ' '));
    const all = `${main.toLowerCase()} ${remarks}`;
    const item: ParsedItem = { type: 'task', title: main };

    if (plan) {
      const planTag = /#([\w-]+)/.exec(main);
      if (planTag) main = tidy(main.replace(planTag[0], ''));
      const sleep = /^(sleep|bed|go to bed)\b.*?\b(?:by|at)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i.exec(main);
      if (sleep || pendingAt) {
        out.push({
          type: 'event', title: sleep ? 'Sleep' : cap(main), date: today, cat: planTag ? planTag[1]! : 'life',
          start: sleep ? clockFromText(sleep[2]!, true)! : pendingAt!,
          ...(sleep && /[-–]/.test(main) ? { tentative: true } : {}),
        });
        pendingAt = null;
        continue;
      }
      // The rest of today's plan goes in today's Sometime lane.
      out.push({ type: 'event', title: cap(main), date: today, cat: planTag ? planTag[1]! : guessCategory(main, null) });
      continue;
    }

    // Repeats: "(daily thing)", "(weekly thing on saturday)", "(biweekly thing on saturday)".
    const wd = weekdayIn(remarks) ?? weekdayIn(main);
    if (/\b(daily|every day|each day|every night|every morning)\b/.test(all)) {
      item.type = 'routine';
      item.repeat = { days: 'daily' };
    } else if (/\b(biweekly|every other week|every two weeks)\b/.test(all)) {
      item.type = 'routine';
      item.repeat = { days: [wd ?? weekday(today)], every: 2 };
    } else if (/\b(weekly|every week)\b/.test(all) || /\bevery (sun|mon|tue|wed|thu|fri|sat)/.test(all)) {
      item.type = 'routine';
      item.repeat = { days: [wd ?? weekday(today)], every: 1 };
    }
    if (item.type === 'routine') {
      item.cat = 'routine';
      item.title = cap(main);
      out.push(item);
      continue;
    }

    // An event with a time under a date header: "RSO fair at 3pm".
    const at = /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.exec(main);
    if (at && (ctx.date || /\b(today|tonight|tomorrow)\b/i.test(main))) {
      const date = ctx.date ?? (/\btomorrow\b/i.test(main) ? addDays(today, 1) : today);
      const title = tidy(main.replace(at[0], '').replace(/\b(today|tonight|tomorrow)\b/i, ''));
      out.push({ type: 'event', title: cap(title || main), date, start: clockFromText(at[1]!)!, cat: guessCategory(main, ctx.course) });
      continue;
    }

    // A deadline: from the headers above, or "due Friday at 5pm" in the line.
    const dueIn = /\b(?:due|by|before)\s+(today|tomorrow|sun|mon|tue|wed|thu|fri|sat)[a-z]*(?:\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/i.exec(main);
    if (dueIn) {
      const w = dueIn[1]!.toLowerCase();
      const date = w === 'today' ? today : w === 'tomorrow' ? addDays(today, 1) : nextWeekday(addDays(today, 1), WEEKDAYS.indexOf(w.slice(0, 3)));
      item.due = { date, ...(dueIn[2] ? { time: clockFromText(dueIn[2]) } : {}) };
      main = tidy(main.replace(dueIn[0], ''));
    } else if (ctx.date) {
      item.due = { date: ctx.date, ...(ctx.time ? { time: ctx.time } : {}) };
    }
    if (ctx.course) item.meta = ctx.course;

    // An "if" condition (spec §10, "Conditions"): the item keeps its window and gets a check-in question.
    if (/\b(contingent|depends on)\b/.test(remarks) || /\bonce\b/i.test(main)) {
      const cond = /\b(if|once|when)\b\s+([^,;?]+?)(?=\s+and\s|[,;?]|$)/i.exec(main);
      const phrase = cond ? tidy(`${cond[1]} ${cond[2]}`) : null;
      item.if = phrase ? phrase.charAt(0).toLowerCase() + phrase.slice(1) : 'if it happens';
      item.ask = phrase ? `${cap(phrase)}?` : 'Has it happened yet?';
      if (cond) main = tidy(main.replace(cond[0], ''));
    }

    // The window, from the remarks and the deadline.
    if (/\?/.test(main) && !item.if) item.win = 'decide';
    else if (/\bnear near future\b|\btoday\b|\btomorrow\b|\btonight\b/.test(all)) item.win = 'near';
    else if (/\bnear future\b|\bthis week\b|\babout a week\b/.test(all)) item.win = 'week';
    else if (/\b(skill|ongoing|no end)\b/.test(all)) item.win = 'ongoing';
    else if (item.due) item.win = windowFor(today, item.due.date);
    else item.win = 'soon';

    // A task for today, with no time, goes in today's Sometime lane (spec §7).
    if (!item.due && !item.if && item.win !== 'decide' && /\b(today|tonight)\b(?![’'])/i.test(main)) item.date = today;
    main = tidy(main.replace(/\b(this week|today|tomorrow|tonight)\b(?![’'])/i, ''));

    const tag = /#([\w-]+)/.exec(main);
    if (tag) main = tidy(main.replace(tag[0], ''));
    item.cat = tag ? tag[1]! : cat && /homework|school|class/i.test(cat) ? 'class' : guessCategory(main, ctx.course);
    item.title = cap(main) || cap(line);
    out.push(item);
  }
  return out;
}
