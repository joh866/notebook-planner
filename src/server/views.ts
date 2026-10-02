import { DateTime } from 'luxon';
import { addDays, dayOf, weekStartOf } from '../core/day';
import { groupTasks } from '../core/groups';
import { blockLength } from '../core/length';
import { classesOn, routineOccursOn, slotOn } from '../core/recurrence';
import { streak } from '../core/streak';
import { clockOnDay, minutesOnDay, resolveZone } from '../core/time';
import { deadlineDay, deadlineMoment, dueTone, effectiveWindow, isOverdue } from '../core/urgency';
import type {
  BlockItem,
  ClassItem,
  DailyRow,
  DaySchedule,
  DayView,
  DeadlineView,
  MonthView,
  RoutineItem,
  RoutineStepView,
  ScheduleItem,
  StepView,
  TaskCard,
  WeekView,
} from '../shared/api';
import type { Db } from './db/client';
import * as t from './db/schema';
import { defaultSettings } from './db/seed';

// Builds what the web app shows. Loads the rows, calls src/core, and shapes the result.
// The data is one person's, so each view loads every table once.

type Rows<T extends { $inferSelect: unknown }> = T['$inferSelect'][];

function load(db: Db) {
  return {
    settings: getSettings(db),
    tasks: db.select().from(t.tasks).all(),
    taskSteps: db.select().from(t.taskSteps).orderBy(t.taskSteps.sortOrder).all(),
    conditions: db.select().from(t.conditions).all(),
    routines: db.select().from(t.routines).orderBy(t.routines.sortOrder).all(),
    routineChecks: db.select().from(t.routineChecks).all(),
    routineSteps: db.select().from(t.routineSteps).orderBy(t.routineSteps.sortOrder).all(),
    routineStepChecks: db.select().from(t.routineStepChecks).all(),
    routineSlots: db.select().from(t.routineSlots).all(),
    slotExceptions: db.select().from(t.routineSlotExceptions).all(),
    classes: db.select().from(t.classes).all(),
    classSkips: db.select().from(t.classSkips).all(),
    blocks: db.select().from(t.blocks).all(),
    sometime: db.select().from(t.sometime).all(),
  };
}
type Data = ReturnType<typeof load>;

/** The settings row, created with defaults the first time. */
export function getSettings(db: Db) {
  const row = db.select().from(t.settings).get();
  if (row) return row;
  db.insert(t.settings).values(defaultSettings).onConflictDoNothing().run();
  return db.select().from(t.settings).get()!;
}

interface Ctx {
  data: Data;
  now: DateTime;
  zone: string;
  homeZone: string;
  today: string;
}

function context(db: Db, now: DateTime, deviceZone: string | undefined): Ctx {
  const data = load(db);
  const homeZone = data.settings.homeTimeZone;
  const zone = resolveZone(data.settings.timeZone, deviceZone ?? homeZone);
  return { data, now, zone, homeZone, today: dayOf(now, zone) };
}

const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;
const utc = (s: string) => DateTime.fromISO(s, { zone: 'utc' });

function stepsOf(ctx: Ctx, taskId: string): StepView[] {
  return ctx.data.taskSteps
    .filter((s) => s.taskId === taskId)
    .map((s) => ({ id: s.id, title: s.title, minutes: s.minutes, waiting: s.waiting, done: s.done }));
}

function routineStepsOn(ctx: Ctx, routineId: string, date: string): RoutineStepView[] {
  return ctx.data.routineSteps
    .filter((s) => s.routineId === routineId)
    .map((s) => ({
      id: s.id, title: s.title, minutes: s.minutes, waiting: s.waiting,
      checked: ctx.data.routineStepChecks.some((c) => c.stepId === s.id && c.date === date),
    }));
}

const routineChecked = (ctx: Ctx, routineId: string, date: string) =>
  ctx.data.routineChecks.some((c) => c.routineId === routineId && c.date === date);

function classItems(ctx: Ctx, date: string): ClassItem[] {
  const skips = new Set(ctx.data.classSkips.map((s) => `${s.classId}@${s.date}`));
  const byId = new Map(ctx.data.classes.map((c) => [c.id, c]));
  return classesOn(ctx.data.classes, date, ctx.zone, skips).map((o) => {
    const c = byId.get(o.classId)!;
    return {
      type: 'class', id: `${c.id}@${o.homeDate}`, classId: c.id, homeDate: o.homeDate,
      code: c.code, kind: c.kind, fullName: c.fullName, location: c.location, categoryId: c.categoryId,
      startAt: iso(o.startAt), startMin: minutesOnDay(o.startAt, date, ctx.zone), endMin: minutesOnDay(o.endAt, date, ctx.zone),
      skipped: o.skipped,
    };
  });
}

function routineItems(ctx: Ctx, date: string): RoutineItem[] {
  const out: RoutineItem[] = [];
  for (const r of ctx.data.routines) {
    for (const slot of ctx.data.routineSlots.filter((s) => s.routineId === r.id)) {
      const o = slotOn(r, slot, date, ctx.data.slotExceptions);
      if (!o) continue;
      const startAt = clockOnDay(date, o.start, ctx.zone);
      const startMin = minutesOnDay(startAt, date, ctx.zone);
      out.push({
        type: 'routine', id: `${slot.id}@${date}`, slotId: slot.id, routineId: r.id, title: r.title, categoryId: r.categoryId,
        start: o.start, durationMinutes: o.durationMinutes, changed: o.changed,
        startAt: iso(startAt), startMin, endMin: startMin + o.durationMinutes,
        checked: routineChecked(ctx, r.id, date), steps: routineStepsOn(ctx, r.id, date),
      });
    }
  }
  return out;
}

function blockItem(ctx: Ctx, b: Rows<typeof t.blocks>[number], date: string): BlockItem {
  const task = b.taskId ? ctx.data.tasks.find((x) => x.id === b.taskId) : undefined;
  const steps = task ? stepsOf(ctx, task.id) : [];
  const start = utc(b.startAt);
  const startMin = minutesOnDay(start, date, ctx.zone);
  const done = task ? !!task.doneAt : b.done;
  const ended = start.plus({ minutes: b.durationMinutes }) <= ctx.now;
  return {
    type: 'block', id: b.id, kind: b.kind, title: task?.title ?? b.title, categoryId: b.categoryId ?? task?.categoryId ?? null,
    taskId: b.taskId, startAt: b.startAt, startMin, endMin: startMin + b.durationMinutes, durationMinutes: b.durationMinutes,
    tentative: b.tentative, label: b.label, location: b.location, pinned: b.pinned, reason: b.reason, rolledFrom: b.rolledFrom,
    done, missed: b.kind === 'task' && !done && ended && date === ctx.today,
    steps, nextStep: steps.find((s) => !s.done)?.title ?? null,
  };
}

function blockItems(ctx: Ctx, date: string): BlockItem[] {
  return ctx.data.blocks.filter((b) => dayOf(utc(b.startAt), ctx.zone) === date).map((b) => blockItem(ctx, b, date));
}

function deadlinesOn(ctx: Ctx, date: string): DeadlineView[] {
  return ctx.data.tasks
    .filter((task) => deadlineDay(task, ctx.zone) === date)
    .map((task) => ({
      taskId: task.id, name: task.shortName ?? task.title, dueAt: task.dueAt, dueDate: task.dueDate,
      atMin: task.dueAt ? minutesOnDay(utc(task.dueAt), date, ctx.zone) : null, done: !!task.doneAt,
    }))
    .sort((a, b) => (a.atMin ?? Infinity) - (b.atMin ?? Infinity));
}

function scheduleFor(ctx: Ctx, date: string): DaySchedule {
  const schedule: ScheduleItem[] = [...classItems(ctx, date), ...routineItems(ctx, date), ...blockItems(ctx, date)]
    .sort((a, b) => a.startMin - b.startMin);
  const sometime = ctx.data.sometime
    .filter((s) => s.date === date)
    .flatMap((s) => {
      const task = ctx.data.tasks.find((x) => x.id === s.taskId);
      return task
        ? [{ taskId: task.id, title: task.title, categoryId: task.categoryId, done: !!task.doneAt, rolledFrom: s.rolledFrom, minutes: blockLength(task) }]
        : [];
    });
  return { date, schedule, deadlines: deadlinesOn(ctx, date), sometime };
}

function dailyRows(ctx: Ctx, date: string): DailyRow[] {
  return ctx.data.routines
    .filter((r) => routineOccursOn(r, date))
    .map((r) => {
      const checked = new Set(ctx.data.routineChecks.filter((c) => c.routineId === r.id).map((c) => c.date));
      const slots = ctx.data.routineSlots.filter((s) => s.routineId === r.id);
      const slot = slots.map((s) => slotOn(r, s, date, ctx.data.slotExceptions)).find((o) => o);
      return {
        routineId: r.id, title: r.title, categoryId: r.categoryId, durationMinutes: r.durationMinutes,
        checked: checked.has(date), skipped: slots.length > 0 && !slot, streak: r.showStreak ? streak(r, checked, date) : null,
        time: slot?.start ?? null, steps: routineStepsOn(ctx, r.id, date),
      };
    });
}

function taskCard(ctx: Ctx, task: Rows<typeof t.tasks>[number]): TaskCard {
  const block = ctx.data.blocks
    .filter((b) => b.taskId === task.id && dayOf(utc(b.startAt), ctx.zone) >= ctx.today)
    .sort((a, b) => utc(a.startAt).toMillis() - utc(b.startAt).toMillis())[0];
  const some = ctx.data.sometime.find((s) => s.taskId === task.id);
  return {
    id: task.id, title: task.title, meta: task.meta, notes: task.notes, categoryId: task.categoryId, window: task.window,
    effectiveWindow: effectiveWindow(task, ctx.now, ctx.zone, ctx.homeZone),
    dueAt: task.dueAt, dueDate: task.dueDate, dueTone: dueTone(task, ctx.now, ctx.zone, ctx.homeZone),
    shortName: task.shortName, estLow: task.estLow, estHigh: task.estHigh, sittingMinutes: task.sittingMinutes,
    sessionMinutes: task.sessionMinutes, conditionId: task.conditionId, decisionYes: task.decisionYes ?? null, doneAt: task.doneAt,
    steps: stepsOf(ctx, task.id),
    scheduled: block ? { startAt: block.startAt } : some && some.date >= ctx.today ? { sometime: some.date } : null,
  };
}

export function dayView(db: Db, now: DateTime, date: string | undefined, deviceZone?: string): DayView {
  const ctx = context(db, now, deviceZone);
  const day = date ?? ctx.today;
  const cards = new Map(ctx.data.tasks.map((task) => [task.id, taskCard(ctx, task)]));
  const g = groupTasks(ctx.data.tasks, now, ctx.zone, ctx.homeZone);
  const toCards = (list: { id: string }[]) => list.map((x) => cards.get(x.id)!);
  const name = (task: Rows<typeof t.tasks>[number]) => task.shortName ?? task.title;

  const next = ctx.data.tasks
    .filter((task) => !task.doneAt && !isOverdue(task, now, ctx.homeZone) && deadlineMoment(task, ctx.homeZone))
    .sort((a, b) => deadlineMoment(a, ctx.homeZone)!.toMillis() - deadlineMoment(b, ctx.homeZone)!.toMillis() || a.sortOrder - b.sortOrder)[0];

  return {
    zone: ctx.zone, homeZone: ctx.homeZone, now: iso(now), today: ctx.today,
    ...scheduleFor(ctx, day),
    daily: dailyRows(ctx, day),
    groups: {
      overdue: toCards(g.overdue), near: toCards(g.near), week: toCards(g.week), soon: toCards(g.soon),
      waiting: g.waiting.map((w) => {
        const c = ctx.data.conditions.find((x) => x.id === w.conditionId);
        return {
          condition: c ? { id: c.id, question: c.question, snoozedUntil: c.snoozedUntil, answeredAt: c.answeredAt } : null,
          ask: !!c && !c.answeredAt && (!c.snoozedUntil || c.snoozedUntil <= ctx.today),
          tasks: toCards(w.tasks),
        };
      }),
      decide: toCards(g.decide), ongoing: toCards(g.ongoing), done: toCards(g.done),
    },
    header: {
      overdue: g.overdue.map((task) => ({ taskId: task.id, name: name(task) })),
      nextDeadline: next ? { taskId: next.id, name: name(next), dueAt: next.dueAt, dueDate: next.dueDate } : null,
    },
  };
}

/** The fixed calendar week containing `date` (spec §8). */
export function weekView(db: Db, now: DateTime, date: string | undefined, deviceZone?: string): WeekView {
  const ctx = context(db, now, deviceZone);
  const start = weekStartOf(date ?? ctx.today, ctx.data.settings.weekStart);
  return {
    zone: ctx.zone, homeZone: ctx.homeZone, now: iso(now), today: ctx.today, start,
    days: Array.from({ length: 7 }, (_, i) => scheduleFor(ctx, addDays(start, i))),
  };
}

/** Every day of a "yyyy-MM" month: deadlines, events, weekly chores, and skipped classes (spec §8). */
export function monthView(db: Db, now: DateTime, month: string | undefined, deviceZone?: string): MonthView {
  const ctx = context(db, now, deviceZone);
  const m = month ?? ctx.today.slice(0, 7);
  const first = `${m}-01`;
  const length = DateTime.fromFormat(first, 'yyyy-MM-dd').daysInMonth!;
  return {
    zone: ctx.zone, homeZone: ctx.homeZone, now: iso(now), today: ctx.today, month: m, weekStart: ctx.data.settings.weekStart,
    days: Array.from({ length }, (_, i) => {
      const date = addDays(first, i);
      return {
        date,
        deadlines: deadlinesOn(ctx, date),
        events: blockItems(ctx, date).filter((b) => b.kind === 'event'),
        chores: ctx.data.routines
          .filter((r) => r.repeat === 'weekly' && routineOccursOn(r, date))
          .map((r) => ({ routineId: r.id, title: r.title, categoryId: r.categoryId })),
        skippedClasses: classItems(ctx, date).filter((c) => c.skipped),
      };
    }),
  };
}

/** What rollover (spec §10) needs to work out today's changes. */
export function rolloverInputs(db: Db, now: DateTime, deviceZone?: string) {
  const ctx = context(db, now, deviceZone);
  return {
    today: ctx.today,
    zone: ctx.zone,
    tasks: ctx.data.tasks,
    taskBlocks: ctx.data.blocks.flatMap((b) => (b.taskId ? [{ id: b.id, taskId: b.taskId, startAt: b.startAt }] : [])),
    sometime: ctx.data.sometime,
  };
}
