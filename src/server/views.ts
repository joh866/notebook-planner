import { DateTime } from 'luxon';
import { addDays, dayOf, weekStartOf } from '../core/day';
import { groupTasks } from '../core/groups';
import { deadlineName } from '../core/classes';
import { allDayOn } from '../core/google';
import { blockLength, isQuick, quickLength } from '../core/length';
import { loggedMinutes, sessionMinutes } from '../core/sessions';
import { busyOf, capacity, freeWindow, type DayFree, type PlanClock, type PlanTask, type Prereq } from '../core/planner';
import { classesOn, routineOccursOn, slotOn } from '../core/recurrence';
import { streak } from '../core/streak';
import { clockOnDay, minutesOnDay, parseClock, resolveZone } from '../core/time';
import { deadlineDay, deadlineMoment, dueTone, effectiveWindow, isOverdue } from '../core/urgency';
import type {
  AgendaView,
  BlockItem,
  CheckInView,
  ClassItem,
  QuickItemView,
  ConditionView,
  DailyRow,
  DaySchedule,
  DayView,
  DeadlineView,
  GoogleAllDayView,
  GoogleItem,
  MonthDay,
  MonthView,
  RoutineItem,
  RoutineStepView,
  ScheduleItem,
  SometimeView,
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
    quickItems: db.select().from(t.quickItems).orderBy(t.quickItems.sortOrder).all(),
    sessions: db.select().from(t.taskSessions).orderBy(t.taskSessions.startAt).all(),
    feedItems: db.select().from(t.feedItems).all(),
    googleCalendars: db.select().from(t.googleCalendars).all(),
    googleEvents: db.select().from(t.googleEvents).all(),
  };
}
type Data = ReturnType<typeof load>;

/** The settings row, created with defaults the first time. Notifications added later get their defaults. */
export function getSettings(db: Db) {
  let row = db.select().from(t.settings).get();
  if (!row) {
    db.insert(t.settings).values(defaultSettings).onConflictDoNothing().run();
    row = db.select().from(t.settings).get()!;
  }
  return { ...row, notify: { ...defaultSettings.notify, ...row.notify } };
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
  const r = ctx.data.routines.find((x) => x.id === routineId);
  return ctx.data.routineSteps
    .filter((s) => s.routineId === routineId)
    .map((s) => {
      const days = new Set(ctx.data.routineStepChecks.filter((c) => c.stepId === s.id).map((c) => c.date));
      return {
        id: s.id, title: s.title, minutes: s.minutes, waiting: s.waiting, checked: days.has(date),
        // A streak can belong to a step, like gratitude (spec §9).
        streak: s.showStreak && r ? streak(r, days, date) : null,
      };
    });
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

type Conditioned = { conditionId: string | null; afterTaskId: string | null; afterBlockId: string | null };
const blockEnd = (b: Rows<typeof t.blocks>[number]) => utc(b.startAt).plus({ minutes: b.durationMinutes });

/** An unanswered "if" question (one answered Yes doesn't hold anything back). */
function openQuestion(ctx: Ctx, conditionId: string | null) {
  const q = conditionId ? ctx.data.conditions.find((x) => x.id === conditionId) : undefined;
  return q && !q.answeredAt ? q : null;
}

/** The prerequisite of an "after" item, while it isn't done. An event is done once it's over or checked. */
function prerequisite(ctx: Ctx, c: Conditioned) {
  const task = c.afterTaskId ? ctx.data.tasks.find((x) => x.id === c.afterTaskId) : undefined;
  if (task && !task.doneAt) return { task, block: null };
  const block = c.afterBlockId ? ctx.data.blocks.find((x) => x.id === c.afterBlockId) : undefined;
  if (block && !block.done && blockEnd(block) > ctx.now) return { task: null, block };
  return null;
}

/** The condition that still holds on a task or event, for look C (spec §10, "Conditions"). */
function conditionOf(ctx: Ctx, c: Conditioned): ConditionView | null {
  const q = openQuestion(ctx, c.conditionId);
  if (q) return { kind: 'if', conditionId: q.id, question: q.question, text: q.phrase ?? q.question };
  const pre = prerequisite(ctx, c);
  if (!pre) return null;
  const title = pre.task?.title ?? pre.block?.title ?? (pre.block?.taskId ? ctx.data.tasks.find((x) => x.id === pre.block!.taskId)?.title : null) ?? 'it';
  return { kind: 'after', taskId: pre.task?.id ?? null, blockId: pre.block?.id ?? null, title, text: `after ${title}` };
}

/**
 * Where each task is on the schedule: its own blocks, and its place in a "Quick things" block, with
 * the minutes it takes there.
 */
function taskSlots(ctx: Ctx) {
  const out: { blockId: string; taskId: string; startAt: string; minutes: number; batched: boolean }[] = [];
  for (const b of ctx.data.blocks) if (b.taskId) out.push({ blockId: b.id, taskId: b.taskId, startAt: b.startAt, minutes: b.durationMinutes, batched: false });
  for (const q of ctx.data.quickItems) {
    const b = ctx.data.blocks.find((x) => x.id === q.blockId);
    const task = ctx.data.tasks.find((x) => x.id === q.taskId);
    if (b && task) out.push({ blockId: b.id, taskId: task.id, startAt: b.startAt, minutes: quickLength(task), batched: true });
  }
  return out;
}

/** A logged block's actual length, next to the estimate it had (spec §7, "Logged task"). */
function loggedOf(ctx: Ctx, b: Rows<typeof t.blocks>[number], task: Rows<typeof t.tasks>[number] | undefined): BlockItem['logged'] {
  const s = b.sessionId ? ctx.data.sessions.find((x) => x.id === b.sessionId) : undefined;
  if (!s) return null;
  const estimate = task ? (task.sittingMinutes ?? task.sessionMinutes ?? (task.estLow != null && task.estHigh != null ? Math.round((task.estLow + task.estHigh) / 2) : task.estLow ?? task.estHigh)) : null;
  return { minutes: sessionMinutes(s, ctx.now), estimate: estimate ?? null };
}

/** The tasks in a "Quick things" block, in order. */
function quickItemsOf(ctx: Ctx, blockId: string): QuickItemView[] {
  return ctx.data.quickItems.filter((q) => q.blockId === blockId).flatMap((q) => {
    const task = ctx.data.tasks.find((x) => x.id === q.taskId);
    return task ? [{ taskId: task.id, title: task.title, categoryId: task.categoryId, done: !!task.doneAt, minutes: quickLength(task) }] : [];
  });
}

const sessionsOf = (ctx: Ctx, taskId: string) => ctx.data.sessions.filter((x) => x.taskId === taskId);
const runningOf = (ctx: Ctx, taskId: string) => ctx.data.sessions.find((x) => x.taskId === taskId && !x.endAt);

function blockItem(ctx: Ctx, b: Rows<typeof t.blocks>[number], date: string): BlockItem {
  const task = b.taskId ? ctx.data.tasks.find((x) => x.id === b.taskId) : undefined;
  const steps = task ? stepsOf(ctx, task.id) : [];
  const start = utc(b.startAt);
  const startMin = minutesOnDay(start, date, ctx.zone);
  const items = b.kind === 'quick' ? quickItemsOf(ctx, b.id) : [];
  const done = task ? !!task.doneAt : b.kind === 'quick' ? items.length > 0 && items.every((x) => x.done) : b.done;
  const ended = start.plus({ minutes: b.durationMinutes }) <= ctx.now;
  const condition = conditionOf(ctx, task ?? b);
  return {
    type: 'block', id: b.id, kind: b.kind, title: task?.title ?? b.title, categoryId: b.categoryId ?? task?.categoryId ?? null,
    taskId: b.taskId, startAt: b.startAt, startMin, endMin: startMin + b.durationMinutes, durationMinutes: b.durationMinutes,
    tentative: b.tentative, label: b.label, location: b.location, pinned: b.pinned, reason: b.reason, rolledFrom: b.rolledFrom,
    done, missed: (b.kind === 'task' || b.kind === 'quick') && !done && ended && date === ctx.today,
    steps, nextStep: steps.find((s) => !s.done)?.title ?? null, items,
    logged: loggedOf(ctx, b, task),
    running: !!task && !!runningOf(ctx, task.id),
    condition, askNow: condition?.kind === 'if' && !done && start <= ctx.now,
  };
}

function blockItems(ctx: Ctx, date: string): BlockItem[] {
  return ctx.data.blocks.filter((b) => dayOf(utc(b.startAt), ctx.zone) === date).map((b) => blockItem(ctx, b, date));
}

/** Google events from calendars that are on (spec §14). */
function googleOn(ctx: Ctx) {
  const names = new Map(ctx.data.googleCalendars.filter((c) => c.on).map((c) => [c.id, c.name]));
  return ctx.data.googleEvents.flatMap((e) => (names.has(e.calendarId) ? [{ ...e, calendar: names.get(e.calendarId)!, id: `${e.calendarId}|${e.eventId}` }] : []));
}

/** Timed Google events starting on a day. */
function googleItems(ctx: Ctx, date: string): GoogleItem[] {
  return googleOn(ctx).flatMap((e) => {
    if (!e.startAt || !e.endAt) return [];
    const start = utc(e.startAt);
    if (dayOf(start, ctx.zone) !== date) return [];
    const startMin = minutesOnDay(start, date, ctx.zone);
    return [{
      type: 'google' as const, id: e.id, title: e.title, location: e.location, calendar: e.calendar, link: e.link, busy: e.busy,
      startAt: e.startAt, startMin, endMin: Math.max(startMin + 15, minutesOnDay(utc(e.endAt), date, ctx.zone)),
    }];
  }).sort((a, b) => a.startMin - b.startMin);
}

const googleAllDay = (ctx: Ctx, date: string): GoogleAllDayView[] =>
  googleOn(ctx).filter((e) => allDayOn(e, date)).map((e) => ({ id: e.id, title: e.title, calendar: e.calendar, link: e.link }));

function deadlinesOn(ctx: Ctx, date: string): DeadlineView[] {
  return ctx.data.tasks
    .filter((task) => deadlineDay(task, ctx.zone) === date)
    .map((task) => ({
      taskId: task.id, name: deadlineName(task, ctx.data.classes), dueAt: task.dueAt, dueDate: task.dueDate,
      atMin: task.dueAt ? minutesOnDay(utc(task.dueAt), date, ctx.zone) : null, done: !!task.doneAt,
    }))
    .sort((a, b) => (a.atMin ?? Infinity) - (b.atMin ?? Infinity));
}

/**
 * The Sometime lane (spec §7): everything meant for the day that has no time yet. Tasks picked for
 * the day (dragged in, typed as "today", rolled over, or events with no time), plus day-only
 * deadlines due that day. A task leaves the lane once it has a block on that day.
 */
function laneFor(ctx: Ctx, date: string, schedule: ScheduleItem[]): SometimeView[] {
  const placed = new Set(schedule.flatMap((x) => (x.type === 'block' ? [...(x.taskId ? [x.taskId] : []), ...x.items.map((i) => i.taskId)] : [])));
  const chip = (task: Rows<typeof t.tasks>[number], rolledFrom: string | null, due: boolean): SometimeView => ({
    taskId: task.id, title: task.title, categoryId: task.categoryId, done: !!task.doneAt, rolledFrom, minutes: blockLength(task), due,
  });
  const out: SometimeView[] = [];
  for (const s of ctx.data.sometime) {
    const task = ctx.data.tasks.find((x) => x.id === s.taskId);
    if (task && s.date === date && !placed.has(task.id)) out.push(chip(task, s.rolledFrom, false));
  }
  const picked = new Set(out.map((x) => x.taskId));
  for (const task of ctx.data.tasks) {
    if (task.dueDate === date && !task.dueAt && task.window !== 'decide' && !placed.has(task.id) && !picked.has(task.id)) {
      out.push(chip(task, null, true));
    }
  }
  return out;
}

function scheduleFor(ctx: Ctx, date: string): DaySchedule {
  const schedule: ScheduleItem[] = [...classItems(ctx, date), ...routineItems(ctx, date), ...blockItems(ctx, date), ...googleItems(ctx, date)]
    .sort((a, b) => a.startMin - b.startMin);
  return { date, schedule, deadlines: deadlinesOn(ctx, date), sometime: laneFor(ctx, date, schedule), allDay: googleAllDay(ctx, date) };
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

function taskCard(ctx: Ctx, task: Rows<typeof t.tasks>[number], slots: ReturnType<typeof taskSlots>): TaskCard {
  const block = slots
    .filter((b) => b.taskId === task.id && dayOf(utc(b.startAt), ctx.zone) >= ctx.today)
    .sort((a, b) => utc(a.startAt).toMillis() - utc(b.startAt).toMillis())[0];
  const some = ctx.data.sometime.find((s) => s.taskId === task.id);
  return {
    id: task.id, title: task.title, meta: task.meta, notes: task.notes, categoryId: task.categoryId, window: task.window,
    effectiveWindow: effectiveWindow(task, ctx.now, ctx.zone, ctx.homeZone),
    dueAt: task.dueAt, dueDate: task.dueDate, dueTone: dueTone(task, ctx.now, ctx.zone, ctx.homeZone),
    shortName: task.shortName, estLow: task.estLow, estHigh: task.estHigh, sittingMinutes: task.sittingMinutes,
    sessionMinutes: task.sessionMinutes, quick: isQuick(task), fromCanvas: ctx.data.feedItems.some((f) => f.taskId === task.id),
    running: (() => {
      const r = runningOf(ctx, task.id);
      return r ? { sessionId: r.id, startAt: r.startAt } : null;
    })(),
    loggedMinutes: loggedMinutes(sessionsOf(ctx, task.id), ctx.now), conditionId: task.conditionId, condition: task.doneAt ? null : conditionOf(ctx, task), decisionYes: task.decisionYes ?? null, doneAt: task.doneAt,
    steps: stepsOf(ctx, task.id),
    scheduled: block ? { startAt: block.startAt } : some && some.date >= ctx.today ? { sometime: some.date } : null,
  };
}

/** Unanswered check-in questions that something still waits on, unless snoozed (spec §9, "Check-ins"). */
function checkIns(ctx: Ctx): CheckInView[] {
  return ctx.data.conditions
    .filter((q) => !q.answeredAt && (!q.snoozedUntil || q.snoozedUntil <= ctx.today))
    .map((q) => ({
      conditionId: q.id, question: q.question,
      titles: [
        ...ctx.data.tasks.filter((x) => x.conditionId === q.id && !x.doneAt).map((x) => x.title),
        ...ctx.data.blocks.filter((b) => b.conditionId === q.id && !b.done && blockEnd(b) > ctx.now).map((b) => b.title ?? 'Event'),
      ],
    }))
    .filter((c) => c.titles.length);
}

/** Wall-clock minutes on a day for a local "HH:mm": before 4am is that day's night. */
const dayMinute = (hhmm: string) => {
  const m = parseClock(hhmm);
  return m < 4 * 60 ? m + 1440 : m;
};

/** Everything the planner (spec §12) reads, from one load. */
function planning(ctx: Ctx) {
  const s = ctx.data.settings;
  const wake = dayMinute(s.wakeTime);
  const bed = dayMinute(s.bedTime);
  const nowMin = minutesOnDay(ctx.now, ctx.today, ctx.zone);
  const clock: PlanClock = { now: ctx.now, today: ctx.today, zone: ctx.zone, homeZone: ctx.homeZone };
  const ends = (b: { startAt: string; durationMinutes: number }) => utc(b.startAt).plus({ minutes: b.durationMinutes });
  const slots = taskSlots(ctx);
  const slotEnds = (x: (typeof slots)[number]) => utc(x.startAt).plus({ minutes: ctx.data.blocks.find((b) => b.id === x.blockId)!.durationMinutes });

  /** Each day's free window and busy time. Blocks in `skip` count as free. Quick blocks still to come can take more. */
  const day = (date: string, skip: Set<string> = new Set()): DayFree => {
    const schedule = scheduleFor(ctx, date).schedule;
    return {
      date, ...freeWindow(date, ctx.today, nowMin, wake, bed), busy: busyOf(schedule, skip),
      batches: schedule.flatMap((x) => (x.type === 'block' && x.kind === 'quick' && !skip.has(x.id) && utc(x.startAt) > ctx.now
        ? [{ blockId: x.id, startMin: x.startMin, minutes: x.durationMinutes }] : [])),
    };
  };

  /** Tasks as the planner sees them. A task is scheduled when it has a block that hasn't ended, other than those in `skip`. */
  const tasks = (skip: Set<string> = new Set()): PlanTask[] => ctx.data.tasks.map((task) => {
    const some = ctx.data.sometime.find((x) => x.taskId === task.id);
    return {
      id: task.id, title: task.title, window: task.window, dueAt: task.dueAt, dueDate: task.dueDate,
      estLow: task.estLow, estHigh: task.estHigh, sittingMinutes: task.sittingMinutes, sessionMinutes: task.sessionMinutes,
      doneAt: task.doneAt, steps: stepsOf(ctx, task.id),
      sometime: some ? { date: some.date, rolledFrom: some.rolledFrom } : null,
      scheduled: slots.some((x) => x.taskId === task.id && !skip.has(x.blockId) && slotEnds(x) > ctx.now),
      quick: isQuick(task),
      loggedMinutes: loggedMinutes(sessionsOf(ctx, task.id), ctx.now),
      ifPending: !!openQuestion(ctx, task.conditionId),
      after: prereqOf(task, skip),
    };
  });

  /** Where an "after" item's prerequisite ends on the schedule. Blocks in `skip` are being lifted. */
  const prereqOf = (task: Rows<typeof t.tasks>[number], skip: Set<string>): Prereq | null => {
    const pre = prerequisite(ctx, task);
    if (!pre) return null;
    const placed = pre.block ? [pre.block] : slots.filter((x) => x.taskId === pre.task!.id && !skip.has(x.blockId))
      .map((x) => ctx.data.blocks.find((b) => b.id === x.blockId)!);
    const last = placed.sort((a, b) => ends(a).toMillis() - ends(b).toMillis()).at(-1);
    if (!last) return { taskId: pre.task?.id ?? null, ends: null };
    const date = dayOf(utc(last.startAt), ctx.zone);
    return { taskId: pre.task?.id ?? null, ends: { date, min: minutesOnDay(utc(last.startAt), date, ctx.zone) + last.durationMinutes } };
  };

  /** Minutes already on the schedule for each task from now on: time set aside for it. */
  const setAside = () => {
    const out = new Map<string, number>();
    for (const x of slots) {
      if (utc(x.startAt) < ctx.now) continue;
      out.set(x.taskId, (out.get(x.taskId) ?? 0) + x.minutes);
    }
    return out;
  };

  return { clock, day, tasks, setAside, blocks: ctx.data.blocks, quickItems: ctx.data.quickItems, zone: ctx.zone, today: ctx.today, settings: s };
}

/** What the Plan button and automatic scheduling read (spec §12). */
export const planInputs = (db: Db, now: DateTime, deviceZone?: string) => planning(context(db, now, deviceZone));

export function dayView(db: Db, now: DateTime, date: string | undefined, deviceZone?: string): DayView {
  const ctx = context(db, now, deviceZone);
  const plan = planning(ctx);
  const day = date ?? ctx.today;
  const slots = taskSlots(ctx);
  const cards = new Map(ctx.data.tasks.map((task) => [task.id, taskCard(ctx, task, slots)]));
  const g = groupTasks(ctx.data.tasks, now, ctx.zone, ctx.homeZone);
  const toCards = (list: { id: string }[]) => list.map((x) => cards.get(x.id)!);
  const name = (task: Rows<typeof t.tasks>[number]) => deadlineName(task, ctx.data.classes);

  const next = ctx.data.tasks
    .filter((task) => !task.doneAt && !isOverdue(task, now, ctx.homeZone) && deadlineMoment(task, ctx.homeZone))
    .sort((a, b) => deadlineMoment(a, ctx.homeZone)!.toMillis() - deadlineMoment(b, ctx.homeZone)!.toMillis() || a.sortOrder - b.sortOrder)[0];

  return {
    zone: ctx.zone, homeZone: ctx.homeZone, now: iso(now), today: ctx.today,
    ...scheduleFor(ctx, day),
    daily: dailyRows(ctx, day),
    checkIns: checkIns(ctx),
    groups: {
      overdue: toCards(g.overdue), near: toCards(g.near), week: toCards(g.week), soon: toCards(g.soon),
      decide: toCards(g.decide), ongoing: toCards(g.ongoing), done: toCards(g.done),
    },
    header: {
      overdue: g.overdue.map((task) => ({ taskId: task.id, name: name(task) })),
      nextDeadline: next ? { taskId: next.id, name: name(next), dueAt: next.dueAt, dueDate: next.dueDate } : null,
    },
    // Every unfinished task due at the next deadline's moment, named together.
    nextDeadlineNames: next
      ? ctx.data.tasks
        .filter((task) => !task.doneAt && task.dueAt === next.dueAt && task.dueDate === next.dueDate)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(name)
      : [],
    capacity: capacity(plan.tasks(), plan.clock, (d) => plan.day(d), plan.setAside()),
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

function monthDay(ctx: Ctx, date: string): MonthDay {
  return {
    date,
    deadlines: deadlinesOn(ctx, date),
    events: blockItems(ctx, date).filter((b) => b.kind === 'event'),
    chores: ctx.data.routines
      .filter((r) => r.repeat === 'weekly' && routineOccursOn(r, date))
      .map((r) => ({ routineId: r.id, title: r.title, categoryId: r.categoryId })),
    skippedClasses: classItems(ctx, date).filter((c) => c.skipped),
    google: [
      ...googleAllDay(ctx, date).map((e) => ({ id: e.id, title: e.title, startMin: null })),
      ...googleItems(ctx, date).map((e) => ({ id: e.id, title: e.title, startMin: e.startMin })),
    ],
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
    days: Array.from({ length }, (_, i) => monthDay(ctx, addDays(first, i))),
  };
}

/** `days` days from `from` (today by default), shaped like month days. The left rail's mini month and Coming up list (spec §5). */
export function agendaView(db: Db, now: DateTime, from: string | undefined, days: number, deviceZone?: string): AgendaView {
  const ctx = context(db, now, deviceZone);
  const start = from ?? ctx.today;
  return {
    zone: ctx.zone, homeZone: ctx.homeZone, now: iso(now), today: ctx.today, from: start,
    days: Array.from({ length: days }, (_, i) => monthDay(ctx, addDays(start, i))),
  };
}

/** What rollover (spec §10) needs to work out today's changes. */
export function rolloverInputs(db: Db, now: DateTime, deviceZone?: string) {
  const ctx = context(db, now, deviceZone);
  return {
    today: ctx.today,
    zone: ctx.zone,
    tasks: ctx.data.tasks,
    // A task in a "Quick things" block shows up as "blockId:taskId", so rollover takes it out of the batch.
    taskBlocks: taskSlots(ctx).map((x) => ({ id: x.batched ? `${x.blockId}:${x.taskId}` : x.blockId, taskId: x.taskId, startAt: x.startAt })),
    sometime: ctx.data.sometime,
  };
}

/**
 * What notifications (spec §13) read: today's and tomorrow's schedules and the check-ins. `deviceZone`
 * is the zone of the device that last opened the app, used when the time zone setting is "auto".
 */
export function notifyInputs(db: Db, now: DateTime, deviceZone?: string) {
  const ctx = context(db, now, deviceZone);
  const s = ctx.data.settings;
  return {
    now, zone: ctx.zone, wakeTime: s.wakeTime, bedTime: s.bedTime, on: s.notify,
    day: scheduleFor(ctx, ctx.today), tomorrow: scheduleFor(ctx, addDays(ctx.today, 1)), checkIns: checkIns(ctx),
  };
}
