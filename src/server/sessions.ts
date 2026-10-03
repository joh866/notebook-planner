import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { DateTime } from 'luxon';
import { dayOf } from '../core/day';
import { loggedMinutes, sessionMinutes, trimmedEvents } from '../core/sessions';
import { resolveZone } from '../core/time';
import {
  LogInputSchema, SessionPatchSchema, StopInputSchema, ZoneSchema,
  type LogResult, type SessionView, type TimeLogEntry,
} from '../shared/api';
import type { Db } from './db/client';
import * as t from './db/schema';
import { notFound, readBody, type Run } from './resources';
import { findRows, whereKey, type Change, type Tx } from './undo';
import { getSettings } from './views';

// Actual time (spec §10, "Actual time and the time log"): Start and Stop, reporting what you did,
// and the time log. Each change is one Undo.

type Row = Record<string, unknown>;
type SessionRow = typeof t.taskSessions.$inferSelect;

const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;
const utc = (s: string) => DateTime.fromISO(s, { zone: 'utc' });

function need(tx: Tx, name: 'tasks' | 'taskSessions', id: string, what: string): Row {
  const row = findRows(tx, name, whereKey(name, { id }))[0];
  if (!row) throw notFound(what);
  return row;
}

const view = (s: SessionRow): SessionView => ({ id: s.id, taskId: s.taskId, startAt: s.startAt, endAt: s.endAt });

/** Sets a session's times. A logged block showing it moves along. */
function setSession(tx: Tx, change: Change, s: Row, startAt: string, endAt: string | null) {
  change.before('taskSessions', [s]);
  tx.update(t.taskSessions).set({ startAt, endAt }).where(whereKey('taskSessions', s)).run();
  if (!endAt) return;
  const minutes = Math.max(1, Math.round(utc(endAt).diff(utc(startAt), 'minutes').minutes));
  for (const b of tx.select().from(t.blocks).where(eq(t.blocks.sessionId, s.id as string)).all()) {
    change.before('blocks', [b]);
    tx.update(t.blocks).set({ startAt, durationMinutes: minutes }).where(eq(t.blocks.id, b.id)).run();
  }
}

/**
 * A finished task reported with its time (spec §10, "Reporting what you did"). It's checked off, and
 * its block for that day moves to when it actually happened. Any other upcoming blocks for it go,
 * and so does its place in a "Quick things" block or the Sometime lane. An event going on when it
 * started ends there.
 */
function finish(tx: Tx, change: Change, task: Row, s: SessionRow, zone: string, now: DateTime): Pick<LogResult, 'block' | 'trimmed'> {
  const endAt = s.endAt ?? iso(now);
  const minutes = sessionMinutes({ startAt: s.startAt, endAt }, now) || 1;
  change.before('tasks', [task]);
  tx.update(t.tasks).set({ doneAt: endAt }).where(eq(t.tasks.id, task.id as string)).run();

  const date = dayOf(utc(s.startAt), zone);
  const blocks = tx.select().from(t.blocks).where(and(eq(t.blocks.taskId, task.id as string), isNull(t.blocks.sessionId))).all();
  const sameDay = blocks.filter((b) => dayOf(utc(b.startAt), zone) === date)
    .sort((a, b) => Math.abs(utc(a.startAt).diff(utc(s.startAt)).toMillis()) - Math.abs(utc(b.startAt).diff(utc(s.startAt)).toMillis()));
  const target = sameDay[0];
  const set = { kind: 'task' as const, startAt: s.startAt, durationMinutes: minutes, pinned: true, sessionId: s.id, reason: null };
  let blockId: string;
  if (target) {
    change.before('blocks', [target]);
    tx.update(t.blocks).set(set).where(eq(t.blocks.id, target.id)).run();
    blockId = target.id;
  } else {
    const row = { id: randomUUID(), taskId: task.id as string, ...set };
    tx.insert(t.blocks).values(row).run();
    change.created('blocks', [row]);
    blockId = row.id;
  }
  // It's done, so other upcoming blocks for it aren't needed.
  for (const b of blocks) {
    if (b.id === blockId || utc(b.startAt) < now) continue;
    change.beforeDelete(tx, 'blocks', [b]);
    tx.delete(t.blocks).where(eq(t.blocks.id, b.id)).run();
  }
  const batched = tx.select().from(t.quickItems).where(eq(t.quickItems.taskId, task.id as string)).all();
  for (const q of batched) {
    change.before('quickItems', [q]);
    tx.delete(t.quickItems).where(whereKey('quickItems', q)).run();
  }
  const some = findRows(tx, 'sometime', whereKey('sometime', { taskId: task.id }));
  if (some.length) {
    change.before('sometime', some);
    tx.delete(t.sometime).where(whereKey('sometime', { taskId: task.id })).run();
  }

  const events = tx.select().from(t.blocks).where(eq(t.blocks.kind, 'event')).all();
  const trimmed: LogResult['trimmed'] = [];
  for (const cut of trimmedEvents(events, s.startAt)) {
    const e = events.find((x) => x.id === cut.id)!;
    change.before('blocks', [e]);
    tx.update(t.blocks).set({ durationMinutes: cut.durationMinutes }).where(eq(t.blocks.id, e.id)).run();
    trimmed.push({ id: e.id, title: e.title ?? 'Event', endAt: s.startAt });
  }
  return { block: { id: blockId, startAt: s.startAt, endAt: iso(utc(s.startAt).plus({ minutes })) }, trimmed };
}

export function registerSessions(app: Hono, db: Db, run: Run, now: () => DateTime) {
  const zoneOf = (c: Context) => {
    const q = c.req.query('tz');
    const settings = getSettings(db);
    return resolveZone(settings.timeZone, q === undefined ? settings.homeTimeZone : ZoneSchema.parse(q));
  };
  const running = (tx: Tx) => tx.select().from(t.taskSessions).where(isNull(t.taskSessions.endAt)).all();

  /** Start: a running session. One runs at a time, so starting stops any other. */
  app.post('/api/tasks/:id/start', (c) => c.json(run((tx, change): SessionView => {
    const task = need(tx, 'tasks', c.req.param('id'), 'task');
    if (task.doneAt) throw new HTTPException(409, { message: 'That task is already done' });
    const at = iso(now());
    for (const s of running(tx)) {
      if (s.taskId === task.id) return view(s);
      setSession(tx, change, s, s.startAt, at);
    }
    const row = { id: randomUUID(), taskId: task.id as string, startAt: at, endAt: null };
    tx.insert(t.taskSessions).values(row).run();
    change.created('taskSessions', [row]);
    return view(tx.select().from(t.taskSessions).where(eq(t.taskSessions.id, row.id)).get()!);
  })));

  /** Stop the running session. With `done`, the task is finished too, and its block moves to when it happened. */
  app.post('/api/tasks/:id/stop', async (c) => {
    const { done } = await readBody(c, StopInputSchema);
    const zone = zoneOf(c);
    return c.json(run((tx, change): LogResult => {
      const task = need(tx, 'tasks', c.req.param('id'), 'task');
      const s = running(tx).find((x) => x.taskId === task.id);
      if (!s) throw new HTTPException(409, { message: 'That task isn’t running' });
      const at = now();
      setSession(tx, change, s, s.startAt, iso(at));
      const fresh = tx.select().from(t.taskSessions).where(eq(t.taskSessions.id, s.id)).get()!;
      const result = done ? finish(tx, change, task, fresh, zone, at) : { block: null, trimmed: [] };
      return { taskId: task.id as string, title: task.title as string, session: view(fresh), minutes: sessionMinutes(fresh, at), done: !!done, ...result };
    }));
  });

  /**
   * Report time spent: "82 minutes starting at 3:46pm". With `done`, the task is finished and its
   * block moves there (spec §10). Without it, it's partial progress, and the remaining estimate shrinks.
   */
  app.post('/api/tasks/:id/log', async (c) => {
    const input = await readBody(c, LogInputSchema);
    const zone = zoneOf(c);
    return c.json(run((tx, change): LogResult => logTime(tx, change, c.req.param('id'), input, zone, now())));
  });

  /** Add a session from the time log. */
  app.post('/api/tasks/:id/sessions', async (c) => {
    const input = await readBody(c, LogInputSchema);
    return c.json(run((tx, change): SessionView => {
      const task = need(tx, 'tasks', c.req.param('id'), 'task');
      const row = { id: randomUUID(), taskId: task.id as string, startAt: input.startAt, endAt: endOf(input) };
      tx.insert(t.taskSessions).values(row).run();
      change.created('taskSessions', [row]);
      return view(row as SessionRow);
    }));
  });

  /** Edit a session's times (the time log). A logged block moves with it. */
  app.patch('/api/task-sessions/:id', async (c) => {
    const input = await readBody(c, SessionPatchSchema);
    return c.json(run((tx, change): SessionView => {
      const s = need(tx, 'taskSessions', c.req.param('id'), 'session') as SessionRow;
      const startAt = input.startAt ?? s.startAt;
      const endAt = input.endAt === undefined ? s.endAt : input.endAt;
      if (endAt && utc(endAt) <= utc(startAt)) throw new HTTPException(400, { message: 'A session must end after it starts' });
      setSession(tx, change, s, startAt, endAt);
      return view({ ...s, startAt, endAt });
    }));
  });

  /** Delete a session. A logged block showing it stays, as a normal block. */
  app.delete('/api/task-sessions/:id', (c) => c.json(run((tx, change) => {
    const s = need(tx, 'taskSessions', c.req.param('id'), 'session');
    // Unlink first: databases migrated before 0007 was fixed don't clear this link on their own.
    const linked = tx.select().from(t.blocks).where(eq(t.blocks.sessionId, s.id as string)).all();
    change.before('blocks', linked);
    tx.update(t.blocks).set({ sessionId: null }).where(eq(t.blocks.sessionId, s.id as string)).run();
    change.beforeDelete(tx, 'taskSessions', [s]);
    tx.delete(t.taskSessions).where(whereKey('taskSessions', s)).run();
    return null;
  })));

  /** The time log: finished tasks, newest first, with the estimate next to the actual time (spec §10). */
  app.get('/api/time-log', (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 40) || 40, 1), 200);
    const at = now();
    const done = db.select().from(t.tasks).where(isNotNull(t.tasks.doneAt)).orderBy(desc(t.tasks.doneAt)).limit(limit).all();
    const sessions = db.select().from(t.taskSessions).orderBy(t.taskSessions.startAt).all();
    return c.json(done.map((task): TimeLogEntry => {
      const mine = sessions.filter((s) => s.taskId === task.id);
      return {
        taskId: task.id, title: task.title, categoryId: task.categoryId, doneAt: task.doneAt!,
        estLow: task.estLow, estHigh: task.estHigh, actualMinutes: mine.length ? loggedMinutes(mine, at) : null,
        durationFeedback: task.durationFeedback, sessions: mine.map(view),
      };
    }));
  });
}

const endOf = (input: { startAt: string; endAt?: string; minutes?: number }) =>
  input.endAt ?? iso(utc(input.startAt).plus({ minutes: input.minutes ?? 0 }));

/** Records time spent on a task, and finishes it with `done`. Also used by the add box (step 13e). */
export function logTime(tx: Tx, change: Change, taskId: string, input: { startAt: string; endAt?: string; minutes?: number; done?: boolean }, zone: string, at: DateTime): LogResult {
  const task = need(tx, 'tasks', taskId, 'task');
  const endAt = endOf(input);
  if (utc(endAt) <= utc(input.startAt)) throw new HTTPException(400, { message: 'A session must end after it starts' });
  const row = { id: randomUUID(), taskId: task.id as string, startAt: input.startAt, endAt, createdAt: iso(at) };
  tx.insert(t.taskSessions).values(row).run();
  change.created('taskSessions', [row]);
  const result = input.done ? finish(tx, change, task, row, zone, at) : { block: null, trimmed: [] };
  return { taskId: task.id as string, title: task.title as string, session: view(row), minutes: sessionMinutes(row, at), done: !!input.done, ...result };
}
