import { DateTime } from 'luxon';
import type { CheckInView, DaySchedule, ScheduleItem } from '../shared/api';
import type { Notify } from '../shared/schemas';
import { clockOnDay } from './time';
import { stepParts } from './timeline';
import { fmtTime } from './words';

// Which notifications are due, and what they say (spec §13, "Notifications"). Pure: the server loads
// today's and tomorrow's schedules, passes them in with the current moment, and sends what's due.
// Each notification has a key made from what it's about and when, so it's sent once, and something
// moved to a new time gets a new one.

export interface NotifyInput {
  now: DateTime;
  /** The zone the schedules are shown in. */
  zone: string;
  wakeTime: string;
  bedTime: string;
  on: Notify;
  /** Today's schedule and tomorrow's. */
  day: DaySchedule;
  tomorrow: DaySchedule;
  /** Unanswered check-in questions, as the task panel shows them. */
  checkIns: CheckInView[];
}

export interface Note {
  key: string;
  kind: keyof Notify;
  at: DateTime;
  title: string;
  body: string;
}

/** How long after it was due a notification still goes out (say, after a restart). Older ones are dropped. */
export const LATE_LIMIT_MIN = 10;
/** The deadline reminder the evening before, local time. */
export const EVENING = '19:00';
/** The check-in question reminder, local time. */
export const CHECK_IN_TIME = '12:00';
/** The morning summary comes this long after the usual wake time. */
export const SUMMARY_AFTER_WAKE_MIN = 15;

const utc = (s: string) => DateTime.fromISO(s, { zone: 'utc' });
const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;
const at12 = (d: DateTime, zone: string) => {
  const z = d.setZone(zone);
  return fmtTime(z.hour * 60 + z.minute);
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Econ PSet 1 at 12pm, Get razor": unfinished deadlines on a day, timed ones first. */
function dueList(s: DaySchedule, zone: string, after?: DateTime): string[] {
  return s.deadlines
    .filter((d) => !d.done && (!after || !d.dueAt || utc(d.dueAt) > after))
    .map((d) => (d.dueAt ? `${d.name} at ${at12(utc(d.dueAt), zone)}` : d.name));
}

/** "2 classes, the first at 9:30am" for a day, or null with none. */
function classLine(s: DaySchedule, zone: string): string | null {
  const list = s.schedule.filter((x) => x.type === 'class' && !x.skipped);
  if (!list.length) return null;
  return `${plural(list.length, 'class', 'classes')}, ${list.length === 1 ? 'at' : 'the first at'} ${at12(utc(list[0]!.startAt), zone)}`;
}

/** Notes tied to items on a schedule: classes, task starts, and waiting parts ending. */
function itemNotes(items: ScheduleItem[], input: NotifyInput): Note[] {
  const out: Note[] = [];
  for (const x of items) {
    const start = utc(x.startAt);
    if (x.type === 'class') {
      if (x.skipped) continue;
      out.push({
        key: `class:${x.id}:${x.startAt}`, kind: 'classes', at: start.minus({ minutes: 10 }),
        title: `${x.code} ${x.kind.toLowerCase()} in 10 minutes`, body: x.location ?? x.fullName ?? '',
      });
      continue;
    }
    if (x.type === 'block' && (x.kind === 'task' || x.kind === 'quick') && !x.done) {
      const range = `${at12(start, input.zone)}–${at12(start.plus({ minutes: x.durationMinutes }), input.zone)}`;
      const quick = x.kind === 'quick';
      const body = x.condition?.kind === 'if'
        ? `${range}. Still on? Open the planner to say yes or no.`
        : quick
          ? x.items.filter((i) => !i.done).map((i) => i.title).join(', ') || range
          : x.nextStep ? `${range}. First: ${x.nextStep}` : range;
      out.push({ key: `start:${x.id}:${x.startAt}`, kind: 'taskStarts', at: start, title: quick ? 'Quick things' : (x.title ?? 'Task'), body });
    }
    // A waiting part ending says what's next (spec §10, "Waiting time inside a task").
    const unfinished = x.type === 'routine' ? !x.checked : x.type === 'block' && !x.done;
    if (!unfinished) continue;
    if (x.type === 'google') continue;
    const steps = x.type === 'routine'
      ? x.steps.map((s) => ({ ...s, done: s.checked }))
      : x.steps;
    const timed = steps.filter((s) => s.minutes);
    const parts = stepParts(x.startMin, timed);
    parts.forEach((p, i) => {
      const next = timed[i + 1];
      if (!p.waiting || !next || next.waiting || next.done) return;
      const at = start.plus({ minutes: p.endMin - x.startMin });
      out.push({
        key: `wait:${x.id}:${i}:${iso(at)}`, kind: 'waitingEnds', at,
        title: `${x.title ?? 'Waiting'}: ${p.title} is done`, body: `Next: ${next.title}.`,
      });
    });
  }
  return out;
}

/** Every notification for today (planner day, from 4am), whether or not it's due yet, in time order. */
export function notesFor(input: NotifyInput): Note[] {
  const { day, tomorrow, zone } = input;
  const out: Note[] = itemNotes([...day.schedule, ...tomorrow.schedule], input);

  const evening = clockOnDay(day.date, EVENING, zone);
  const tomorrowDue = dueList(tomorrow, zone);
  if (tomorrowDue.length) {
    out.push({ key: `due-eve:${tomorrow.date}`, kind: 'deadlines', at: evening, title: 'Due tomorrow', body: tomorrowDue.join(', ') });
  }
  const wake = clockOnDay(day.date, input.wakeTime, zone);
  const todayDue = dueList(day, zone, wake);
  if (todayDue.length) out.push({ key: `due-morn:${day.date}`, kind: 'deadlines', at: wake, title: 'Due today', body: todayDue.join(', ') });

  // The morning summary: classes, what's planned, and what's due.
  const tasks = day.schedule.filter((x) => x.type === 'block' && (x.kind === 'task' || x.kind === 'quick') && !x.done);
  const summary = [
    classLine(day, zone),
    tasks.length ? `${plural(tasks.length, 'task')} planned` : null,
    dueList(day, zone).length ? `due today: ${dueList(day, zone).join(', ')}` : null,
  ].filter(Boolean);
  out.push({
    key: `morning:${day.date}`, kind: 'morningSummary', at: wake.plus({ minutes: SUMMARY_AFTER_WAKE_MIN }), title: 'Good morning',
    body: summary.length ? `${capital(summary.join('; '))}.` : 'Nothing on the schedule yet. Plan your day when you’re ready.',
  });

  // An hour before bedtime.
  const bed = clockOnDay(day.date, input.bedTime, zone);
  const ahead = [classLine(tomorrow, zone), tomorrowDue.length ? `due: ${tomorrowDue.join(', ')}` : null].filter(Boolean);
  out.push({
    key: `plan:${day.date}`, kind: 'planTomorrow', at: bed.minus({ hours: 1 }), title: 'Plan tomorrow',
    body: `${ahead.length ? `Tomorrow: ${ahead.join('; ')}. ` : ''}Open the planner to plan it.`,
  });

  // Check-in questions, at most once a day.
  if (input.checkIns.length) {
    const [first, ...rest] = input.checkIns;
    out.push({
      key: `checkin:${day.date}`, kind: 'checkIns', at: clockOnDay(day.date, CHECK_IN_TIME, zone), title: 'Check-in',
      body: `${first!.question}${rest.length ? ` (and ${plural(rest.length, 'more question')})` : ''}`,
    });
  }

  return out.filter((n) => input.on[n.kind]).sort((a, b) => a.at.toMillis() - b.at.toMillis());
}

/** The notifications due now: their time has come, within the last few minutes. */
export function notesDue(input: NotifyInput): Note[] {
  const since = input.now.minus({ minutes: LATE_LIMIT_MIN });
  return notesFor(input).filter((n) => n.at <= input.now && n.at > since);
}
