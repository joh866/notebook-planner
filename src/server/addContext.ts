import { desc, isNotNull } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { addDays, dayOf } from '../core/day';
import type { PromptContext } from '../core/prompt';
import { routineOccursOn } from '../core/recurrence';
import { loggedMinutes } from '../core/sessions';
import { minutesOnDay } from '../core/time';
import { deadlineDay, effectiveWindow } from '../core/urgency';
import { dueLabel, fmtTime, SHORT_DAYS } from '../core/words';
import { categoryName } from '../shared/categories';
import type { Db } from './db/client';
import * as t from './db/schema';

// What the add box tells the AI about what already exists (spec §11, "Rules"): tasks, routines,
// today's and tomorrow's schedule, open check-ins, and recent actual times for better estimates.
// Times are written 12-hour, as the AI should write them.

const utc = (s: string) => DateTime.fromISO(s, { zone: 'utc' });
/** About the last 40 finished tasks (spec §10, "Better estimates"). */
const RECENT = 40;

const range = (lo: number | null, hi: number | null) => (lo == null ? null : hi == null || hi === lo ? `${lo}` : `${lo}-${hi}`);

export function promptExisting(db: Db, now: DateTime, zone: string, homeZone: string, today: string): NonNullable<PromptContext['existing']> {
  // Built-in categories go by the words the prompt uses ("class", "errand"); custom ones by name.
  const cats = new Map(db.select().from(t.categories).all().map((c) => [c.id, c.builtin ? c.id : c.name.toLowerCase()]));
  const tasks = db.select().from(t.tasks).all();
  const steps = db.select().from(t.taskSteps).orderBy(t.taskSteps.sortOrder).all();
  const sessions = db.select().from(t.taskSessions).all();
  const conditions = db.select().from(t.conditions).all();

  const taskLines = tasks.filter((x) => !x.doneAt).map((x) => {
    const due = deadlineDay(x, zone);
    const bits = [
      effectiveWindow(x, now, zone, homeZone),
      x.categoryId ? cats.get(x.categoryId) : null,
      due ? `due ${dueLabel(today, due, x.dueAt ? minutesOnDay(utc(x.dueAt), due, zone) : null)}` : null,
      range(x.estLow, x.estHigh) ? `est ${range(x.estLow, x.estHigh)} min` : null,
      x.meta,
      x.conditionId ? `if ${conditions.find((c) => c.id === x.conditionId)?.question ?? '?'}` : null,
      x.afterTaskId ? `after ${tasks.find((y) => y.id === x.afterTaskId)?.title ?? '?'}` : null,
    ].filter(Boolean);
    const mine = steps.filter((s) => s.taskId === x.id);
    const stepText = mine.length ? `; steps: ${mine.map((s) => `[${s.id}] ${s.title}${s.done ? ' (done)' : ''}`).join(', ')}` : '';
    return `[${x.id}] ${x.title} (${bits.join('; ')}${stepText})`;
  });

  const routineSteps = db.select().from(t.routineSteps).orderBy(t.routineSteps.sortOrder).all();
  const slots = db.select().from(t.routineSlots).all();
  const routineLines = db.select().from(t.routines).orderBy(t.routines.sortOrder).all().map((r) => {
    const when = r.repeat === 'daily' ? 'daily' : `${r.repeatEvery > 1 ? 'every other ' : 'every '}${(r.repeatDays ?? []).map((d) => SHORT_DAYS[d]).join('/')}`;
    const slot = slots.find((s) => s.routineId === r.id);
    const mine = routineSteps.filter((s) => s.routineId === r.id);
    const stepText = mine.length ? `; steps: ${mine.map((s) => `[${s.id}] ${s.title}`).join(', ')}` : '';
    return `[${r.id}] ${r.title} (${when}${slot ? ` at ${fmtTime(minutesOfClock(slot.start))}` : ''}${stepText})`;
  });

  // Today's and tomorrow's blocks, and routine times.
  const days = [today, addDays(today, 1)];
  const scheduleLines: string[] = [];
  for (const date of days) {
    const label = date === today ? 'today' : 'tomorrow';
    for (const b of db.select().from(t.blocks).all()) {
      const start = utc(b.startAt);
      if (dayOf(start, zone) !== date) continue;
      const a = minutesOnDay(start, date, zone);
      const title = b.title ?? tasks.find((x) => x.id === b.taskId)?.title ?? 'Task';
      const what = b.kind === 'task' ? `task block for [${b.taskId}]` : b.kind;
      scheduleLines.push(`[${b.id}] ${label} ${fmtTime(a)}-${fmtTime(a + b.durationMinutes)} ${title} (${what}${b.tentative ? ', tentative' : ''})`);
    }
    for (const r of db.select().from(t.routines).all()) {
      const slot = slots.find((s) => s.routineId === r.id);
      if (slot && routineOccursOn(r, date)) scheduleLines.push(`${label} ${fmtTime(minutesOfClock(slot.start))} ${r.title} (routine [${r.id}])`);
    }
  }

  const today0 = today;
  const checkIns = conditions
    .filter((c) => !c.answeredAt && (!c.snoozedUntil || c.snoozedUntil <= today0) && tasks.some((x) => x.conditionId === c.id && !x.doneAt))
    .map((c) => `[${c.id}] ${c.question}`);

  // Recent actual times, and averages by category, so estimates match how fast they are.
  const done = db.select().from(t.tasks).where(isNotNull(t.tasks.doneAt)).orderBy(desc(t.tasks.doneAt)).limit(RECENT).all();
  const recent: string[] = [];
  const byCat = new Map<string, { n: number; est: number; estN: number; actual: number }>();
  for (const x of done) {
    const mine = sessions.filter((s) => s.taskId === x.id);
    const actual = mine.length ? loggedMinutes(mine, now) : null;
    const est = range(x.estLow, x.estHigh);
    const feel = x.durationFeedback === 'longer' ? 'took longer' : x.durationFeedback === 'shorter' ? 'took less' : x.durationFeedback === 'as_planned' ? 'about as planned' : null;
    if (actual == null && !feel) continue;
    recent.push(`${x.title}${x.categoryId ? ` (${cats.get(x.categoryId)})` : ''}: ${est ? `est ${est}` : 'no estimate'}, ${actual != null ? `took ${actual}` : feel}`);
    if (actual != null) {
      const k = x.categoryId ?? 'none';
      const g = byCat.get(k) ?? { n: 0, est: 0, estN: 0, actual: 0 };
      g.n++;
      g.actual += actual;
      if (x.estLow != null) {
        g.est += (x.estLow + (x.estHigh ?? x.estLow)) / 2;
        g.estN++;
      }
      byCat.set(k, g);
    }
  }
  const averages = [...byCat].map(([k, g]) =>
    `${k === 'none' ? 'no category' : (cats.get(k) ?? categoryName(k))}: ${g.n} done, took ${Math.round(g.actual / g.n)} min on average${g.estN ? `, estimated ${Math.round(g.est / g.estN)}` : ''}`);

  const edited = tasks.filter((x) => x.estEditedAt && x.estLow != null)
    .sort((a, b) => b.estEditedAt!.localeCompare(a.estEditedAt!)).slice(0, 20)
    .map((x) => `${x.title}: ${range(x.estLow, x.estHigh)} min`);

  return { tasks: taskLines, routines: routineLines, schedule: scheduleLines, checkIns, recent, averages, edited };
}

const minutesOfClock = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
