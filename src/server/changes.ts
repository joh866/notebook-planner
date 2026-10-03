import { randomUUID } from 'node:crypto';
import { and, eq, gte, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { DateTime } from 'luxon';
import { addDays, dayOf, weekday } from '../core/day';
import { atMinute, clockOnDay, parseClock, resolveZone } from '../core/time';
import { dueLabel, fmtTime, relWord } from '../core/words';
import { ChangeInputSchema, ZoneSchema, type AddQuestion, type ChangeDone, type ChangesResult } from '../shared/api';
import { findCategory } from '../shared/categories';
import { ParsedChangeSchema, type ParsedChange } from '../shared/parsed';
import type { Db } from './db/client';
import * as t from './db/schema';
import { readBody, type Run } from './resources';
import { logTime } from './sessions';
import { findRows, whereKey, type Change, type Tx } from './undo';
import { getSettings } from './views';

// Changes to things that already exist, from the add box (spec §11, "Changes to existing things"):
// done, delete, update, move, check a step, and report time. When it's unclear which item is meant,
// nothing changes and the result asks which one.

type Row = Record<string, unknown>;

export interface ChangeCtx {
  now: DateTime;
  /** The zone the user is in. Times they type happen here. */
  zone: string;
  /** Deadlines are Chicago moments (spec §3). */
  homeZone: string;
  /** The planner day, and the calendar day that just started between midnight and 4am. */
  today: string;
  calToday: string;
}

type Kind = 'task' | 'routine' | 'event' | 'step';
interface Candidate {
  kind: Kind;
  id: string;
  title: string;
  /** Title plus notes and the parent's title, for matching words. */
  text: string;
  /** Steps: whose step it is. */
  parent?: { kind: 'task' | 'routine'; id: string; title: string };
}

const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'thing', 'stuff', 'my', 'done', 'finished']);
/** Words that name something: 3+ letters, or a number ("chapter 2"). */
const keep = (w: string) => (w.length >= 3 || /^\d+$/.test(w)) && !STOP.has(w);

/** Every word (3+ letters) appears in the text, allowing "reading" to match "read". */
function matches(text: string, words: string[]): boolean {
  const have = norm(text).split(' ');
  return words.every((w) => {
    if (/^\d+$/.test(w)) return have.includes(w);
    const stem = w.length > 5 ? w.slice(0, w.length - 3) : w;
    return have.some((h) => h.startsWith(stem) || (h.length >= 4 && w.startsWith(h)));
  });
}

function candidates(tx: Tx, ctx: ChangeCtx, action: ParsedChange['action']): Candidate[] {
  const tasks = tx.select().from(t.tasks).where(isNull(t.tasks.doneAt)).all();
  if (action === 'checkStep') {
    const taskSteps = tx.select().from(t.taskSteps).all().flatMap((s) => {
      const task = tasks.find((x) => x.id === s.taskId);
      return task ? [{ kind: 'step' as const, id: s.id, title: s.title, text: `${s.title} ${task.title} ${task.meta ?? ''}`, parent: { kind: 'task' as const, id: task.id, title: task.title } }] : [];
    });
    const routines = tx.select().from(t.routines).all();
    const routineSteps = tx.select().from(t.routineSteps).all().flatMap((s) => {
      const r = routines.find((x) => x.id === s.routineId);
      return r ? [{ kind: 'step' as const, id: s.id, title: s.title, text: `${s.title} ${r.title}`, parent: { kind: 'routine' as const, id: r.id, title: r.title } }] : [];
    });
    return [...taskSteps, ...routineSteps];
  }
  const out: Candidate[] = tasks.map((x) => ({ kind: 'task', id: x.id, title: x.title, text: `${x.title} ${x.shortName ?? ''} ${x.meta ?? ''}` }));
  if (action === 'log') return out;
  for (const r of tx.select().from(t.routines).all()) out.push({ kind: 'routine', id: r.id, title: r.title, text: r.title });
  const since = iso(atMinute(addDays(ctx.today, -1), 4 * 60, ctx.zone));
  for (const b of tx.select().from(t.blocks).where(and(eq(t.blocks.kind, 'event'), gte(t.blocks.startAt, since))).all()) {
    out.push({ kind: 'event', id: b.id, title: b.title ?? 'Event', text: `${b.title ?? ''} ${b.label ?? ''} ${b.location ?? ''}` });
  }
  return out;
}

type Resolved = { target: Candidate } | { question: AddQuestion } | { missing: string };

/** Which existing item a change means: its id, or words that name exactly one item. */
function resolve(tx: Tx, ctx: ChangeCtx, c: ParsedChange): Resolved {
  const all = candidates(tx, ctx, c.action);
  const ask = (options: Candidate[]): Resolved => ({
    question: {
      prompt: `Which one did you mean${c.match ? ` by “${c.match}”` : ''}?`,
      options: options.slice(0, 6).map((o) => ({ id: o.id, title: o.parent ? `${o.title} (${o.parent.title})` : o.title })),
      change: { ...c },
    },
  });
  let id = c.id;
  // A task block's id means its task.
  if (id && !all.some((x) => x.id === id)) {
    const block = tx.select().from(t.blocks).where(eq(t.blocks.id, id)).get();
    if (block?.taskId) id = block.taskId;
  }
  // checkStep with the task's (or routine's) id: the step is named in `step`.
  if (c.action === 'checkStep' && id && c.step && !all.some((x) => x.id === id)) {
    const parentId = id;
    const steps = all.filter((x) => x.parent?.id === parentId);
    const byStep = steps.filter((x) => x.id === c.step || matches(x.title, norm(c.step!).split(' ').filter(keep)));
    if (byStep.length === 1) return { target: byStep[0]! };
    if (byStep.length > 1) return ask(byStep);
    return { missing: c.step };
  }
  const hit = id ? all.find((x) => x.id === id) : undefined;
  if (hit) return { target: hit };
  const offered = (c.options ?? []).map((o) => all.find((x) => x.id === o)).filter((x): x is Candidate => !!x);
  if (offered.length > 1) return ask(offered);
  if (offered.length === 1) return { target: offered[0]! };
  const words = norm(c.match ?? c.step ?? '').split(' ').filter(keep);
  if (!words.length) return { missing: c.match ?? c.id ?? 'that' };
  const found = all.filter((x) => matches(x.text, words));
  if (found.length === 1) return { target: found[0]! };
  return found.length ? ask(found) : { missing: c.match ?? c.step ?? 'that' };
}

/** A local day and "HH:mm" as a moment in the user's zone. Before 4am is that day's night. */
const momentAt = (ctx: ChangeCtx, date: string, hhmm: string) => clockOnDay(date, hhmm, ctx.zone);

/** Reported time: the date given, or today, or yesterday when that time hasn't come yet today. */
function reportedStart(ctx: ChangeCtx, c: ParsedChange): DateTime {
  if (!c.start) return ctx.now.minus({ minutes: c.minutes ?? 0 });
  let at = momentAt(ctx, c.date ?? ctx.today, c.start);
  if (!c.date && at > ctx.now) at = momentAt(ctx, addDays(ctx.today, -1), c.start);
  return at;
}

function update(tx: Tx, change: Change, name: 'tasks' | 'routines' | 'blocks' | 'taskSteps', id: string, set: Row) {
  const rows = findRows(tx, name, whereKey(name, { id }));
  change.before(name, rows);
  const table = { tasks: t.tasks, routines: t.routines, blocks: t.blocks, taskSteps: t.taskSteps }[name];
  tx.update(table).set(set as never).where(eq(table.id, id)).run();
}

function remove(tx: Tx, change: Change, name: 'tasks' | 'routines' | 'blocks', id: string) {
  const rows = findRows(tx, name, whereKey(name, { id }));
  change.beforeDelete(tx, name, rows);
  const table = { tasks: t.tasks, routines: t.routines, blocks: t.blocks }[name];
  tx.delete(table).where(eq(table.id, id)).run();
}

/** A per-day check, recorded for Undo. */
function check(tx: Tx, change: Change, name: 'routineChecks' | 'routineStepChecks', row: Row) {
  if (findRows(tx, name, whereKey(name, row)).length) return;
  tx.insert(name === 'routineChecks' ? t.routineChecks : t.routineStepChecks).values(row as never).run();
  change.created(name, [row]);
}

/** Checks a routine for a day, with all its steps (spec §10, "Routine steps"). */
function checkRoutine(tx: Tx, change: Change, routineId: string, date: string) {
  check(tx, change, 'routineChecks', { routineId, date });
  for (const s of tx.select().from(t.routineSteps).where(eq(t.routineSteps.routineId, routineId)).all()) {
    check(tx, change, 'routineStepChecks', { stepId: s.id, date });
  }
}

/** Applies one resolved change. Returns what it did. */
function apply(tx: Tx, change: Change, ctx: ChangeCtx, c: ParsedChange, target: Candidate): ChangeDone | string {
  const done = (action: ChangeDone['action'], detail: string | null = null): ChangeDone =>
    ({ action, kind: target.kind, id: target.id, title: target.title, detail }) as ChangeDone;

  if (target.kind === 'step') {
    const parent = target.parent!;
    if (parent.kind === 'task') update(tx, change, 'taskSteps', target.id, { done: true });
    else {
      check(tx, change, 'routineStepChecks', { stepId: target.id, date: ctx.today });
      const steps = tx.select().from(t.routineSteps).where(eq(t.routineSteps.routineId, parent.id)).all();
      const checked = new Set(tx.select().from(t.routineStepChecks).where(eq(t.routineStepChecks.date, ctx.today)).all().map((x) => x.stepId));
      if (steps.every((s) => checked.has(s.id))) check(tx, change, 'routineChecks', { routineId: parent.id, date: ctx.today });
    }
    return done('checkStep', parent.title);
  }

  switch (c.action) {
    case 'log':
    case 'done': {
      if (target.kind === 'task' && (c.action === 'log' || c.start || c.minutes)) {
        const start = reportedStart(ctx, c);
        const end = c.end ? momentAt(ctx, dayOf(start, ctx.zone), c.end) : undefined;
        const log = logTime(tx, change, target.id, {
          startAt: iso(start), ...(end && end > start ? { endAt: iso(end) } : { minutes: c.minutes ?? 30 }),
          done: c.action === 'done' || c.done !== false,
        }, ctx.zone, ctx.now);
        return { action: 'log', kind: 'task', id: target.id, title: target.title, detail: null, log };
      }
      if (target.kind === 'task') update(tx, change, 'tasks', target.id, { doneAt: iso(ctx.now) });
      else if (target.kind === 'routine') checkRoutine(tx, change, target.id, ctx.today);
      else update(tx, change, 'blocks', target.id, { done: true });
      return done('done');
    }

    case 'delete': {
      remove(tx, change, target.kind === 'task' ? 'tasks' : target.kind === 'routine' ? 'routines' : 'blocks', target.id);
      return done('delete');
    }

    case 'update': {
      const words: string[] = [];
      if (target.kind === 'task') {
        const set: Row = {};
        if (c.title) {
          set.title = c.title;
          words.push(`renamed “${c.title}”`);
        }
        if (c.meta !== undefined) set.meta = c.meta;
        if (c.notes !== undefined) set.notes = c.notes;
        if (c.short) set.shortName = c.short;
        if (c.win) set.window = c.win;
        if (c.est) {
          [set.estLow, set.estHigh] = c.est;
          set.estEditedAt = iso(ctx.now);
          words.push(`about ${c.est[0]}–${c.est[1]} min`);
        }
        if (c.cat) {
          const cat = findCategory(tx.select().from(t.categories).all(), c.cat);
          if (cat) set.categoryId = cat.id;
        }
        if (c.due !== undefined) {
          set.dueAt = null;
          set.dueDate = null;
          if (c.due?.time) set.dueAt = iso(clockOnDay(c.due.date, c.due.time, ctx.homeZone));
          else if (c.due) set.dueDate = c.due.date;
          words.push(c.due ? `due ${dueLabel(ctx.today, c.due.date, c.due.time ? parseClock(c.due.time) : null)}` : 'no deadline');
        }
        update(tx, change, 'tasks', target.id, set);
      } else if (target.kind === 'event') {
        const set: Row = {};
        if (c.title) set.title = c.title;
        if (c.loc) set.location = c.loc;
        if (c.meta !== undefined) set.label = c.meta;
        update(tx, change, 'blocks', target.id, set);
      } else if (c.title) {
        update(tx, change, 'routines', target.id, { title: c.title });
      }
      return done('update', words.join(', ') || null);
    }

    case 'move':
      return move(tx, change, ctx, c, target, done);
  }
  return 'that';
}

/** Moving a task, event, or routine to another day or time (spec §11, "Moving"). */
function move(tx: Tx, change: Change, ctx: ChangeCtx, c: ParsedChange, target: Candidate, done: (a: ChangeDone['action'], d?: string | null) => ChangeDone): ChangeDone | string {
  const date = c.date ?? ctx.calToday;
  // Times in messages are 12-hour (spec §4).
  const at12 = c.start ? fmtTime(parseClock(c.start)) : null;
  const when = `${relWord(ctx.today, date)}${at12 ? ` at ${at12}` : ''}`;
  if (target.kind === 'event') {
    const b = tx.select().from(t.blocks).where(eq(t.blocks.id, target.id)).get()!;
    const local = dayOf(DateTime.fromISO(b.startAt, { zone: 'utc' }), ctx.zone);
    const clock = c.start ?? DateTime.fromISO(b.startAt, { zone: 'utc' }).setZone(ctx.zone).toFormat('HH:mm');
    update(tx, change, 'blocks', target.id, { startAt: iso(momentAt(ctx, c.date ?? local, clock)), pinned: true });
    return done('move', when);
  }
  if (target.kind === 'task') {
    const upcoming = tx.select().from(t.blocks).where(and(eq(t.blocks.taskId, target.id), gte(t.blocks.startAt, iso(ctx.now)))).all();
    if (c.start) {
      const startAt = iso(momentAt(ctx, date, c.start));
      const [first, ...rest] = upcoming;
      if (first) update(tx, change, 'blocks', first.id, { startAt, pinned: true });
      else {
        const task = tx.select().from(t.tasks).where(eq(t.tasks.id, target.id)).get()!;
        const row = { id: randomUUID(), kind: 'task' as const, taskId: target.id, startAt, durationMinutes: task.sittingMinutes ?? task.sessionMinutes ?? task.estLow ?? 30, pinned: true };
        tx.insert(t.blocks).values(row).run();
        change.created('blocks', [row]);
      }
      for (const b of rest) remove(tx, change, 'blocks', b.id);
    } else {
      for (const b of upcoming) remove(tx, change, 'blocks', b.id);
      const existing = findRows(tx, 'sometime', whereKey('sometime', { taskId: target.id }));
      change.before('sometime', existing);
      const row = { taskId: target.id, date, rolledFrom: (existing[0]?.rolledFrom as string | null) ?? null };
      tx.insert(t.sometime).values(row).onConflictDoUpdate({ target: t.sometime.taskId, set: row }).run();
      if (!existing.length) change.created('sometime', [row]);
    }
    return done('move', when);
  }
  // A routine: a time moves it for that day; a day moves a weekly routine to that weekday.
  const r = tx.select().from(t.routines).where(eq(t.routines.id, target.id)).get()!;
  const slot = tx.select().from(t.routineSlots).where(eq(t.routineSlots.routineId, r.id)).get();
  if (c.start && slot) {
    const key = { slotId: slot.id, date };
    const existing = findRows(tx, 'routineSlotExceptions', whereKey('routineSlotExceptions', key));
    change.before('routineSlotExceptions', existing);
    const row = { skipped: false, durationMinutes: null, ...existing[0], ...key, start: c.start };
    tx.insert(t.routineSlotExceptions).values(row as never).onConflictDoUpdate({ target: [t.routineSlotExceptions.slotId, t.routineSlotExceptions.date], set: row as never }).run();
    if (!existing.length) change.created('routineSlotExceptions', [row]);
    return done('move', `${relWord(ctx.today, date)} at ${at12}, that day only`);
  }
  if (r.repeat === 'weekly' && c.date) {
    update(tx, change, 'routines', r.id, { repeatDays: [weekday(c.date)], ...(r.repeatEvery > 1 ? { repeatFrom: c.date } : {}) });
    return done('move', `every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday(c.date)]}`);
  }
  return target.title;
}

/** Applies changes. Each one either happens, asks which item was meant, or names what it couldn't find. */
export function applyChanges(tx: Tx, change: Change, ctx: ChangeCtx, list: ParsedChange[]): ChangesResult {
  const out: ChangesResult = { changes: [], questions: [], missing: [] };
  for (const c of list) {
    const r = resolve(tx, ctx, c);
    if ('question' in r) out.questions.push(r.question);
    else if ('missing' in r) out.missing.push(r.missing);
    else {
      const res = apply(tx, change, ctx, c, r.target);
      if (typeof res === 'string') out.missing.push(res);
      else out.changes.push(res);
    }
  }
  return out;
}

/** The add box's context for changes. */
export function changeCtx(db: Db, now: DateTime, device: string | undefined): ChangeCtx {
  const settings = getSettings(db);
  const zone = resolveZone(settings.timeZone, device ?? settings.homeTimeZone);
  return { now, zone, homeZone: settings.homeTimeZone, today: dayOf(now, zone), calToday: now.setZone(zone).toFormat('yyyy-MM-dd') };
}

export function registerChanges(app: Hono, db: Db, run: Run, now: () => DateTime) {
  /** A question's button: makes the change with the chosen item (spec §11). */
  app.post('/api/changes', async (c) => {
    const q = c.req.query('tz');
    const { change: raw, id } = await readBody(c, ChangeInputSchema);
    const parsed = ParsedChangeSchema.parse({ ...raw, id, options: undefined, match: undefined });
    const ctx = changeCtx(db, now(), q === undefined ? undefined : ZoneSchema.parse(q));
    return c.json(run((tx, change) => applyChanges(tx, change, ctx, [parsed])));
  });
}
