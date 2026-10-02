import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { DateTime } from 'luxon';
import { dayOf } from '../core/day';
import { blockLength } from '../core/length';
import { atMinute, clockOf, resolveZone } from '../core/time';
import { DropInputSchema, ZoneSchema, type DropInput, type DropResult } from '../shared/api';
import type { Db } from './db/client';
import * as t from './db/schema';
import { notFound, readBody, type Run } from './resources';
import { findRows, tableOf, whereKey, type Change, type TableName, type Tx } from './undo';
import { getSettings } from './views';

// Drag and drop (spec §10, "Drag and drop"). Each drop is one change with one Undo.

type Row = Record<string, unknown>;

interface Ctx {
  zone: string;
  now: DateTime;
  today: string;
}

/** A drop can be a few minutes behind the server's clock, since the page's clock ticks every 15 seconds. */
const PAST_GRACE_MINUTES = 5;

const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;

function need(tx: Tx, name: TableName, id: string, what: string): Row {
  const row = findRows(tx, name, whereKey(name, { id }))[0];
  if (!row) throw notFound(what);
  return row;
}

function remove(tx: Tx, change: Change, name: TableName, row: Row) {
  change.beforeDelete(tx, name, [row]);
  tx.delete(tableOf(name)).where(whereKey(name, row)).run();
}

function update(tx: Tx, change: Change, name: TableName, row: Row, set: Row) {
  change.before(name, [row]);
  tx.update(tableOf(name)).set(set as never).where(whereKey(name, row)).run();
}

function insert(tx: Tx, change: Change, name: TableName, row: Row) {
  tx.insert(tableOf(name)).values(row as never).run();
  change.created(name, [row]);
}

/** Drops on today can't land in the past. */
function startOn(ctx: Ctx, date: string, startMin: number): string {
  const at = atMinute(date, startMin, ctx.zone);
  if (date === ctx.today && at < ctx.now.minus({ minutes: PAST_GRACE_MINUTES })) {
    throw new HTTPException(409, { message: 'That time has already passed' });
  }
  return iso(at);
}

/**
 * Sets one day's change to a routine slot. Fields left null follow the slot, and a change with
 * nothing left is removed.
 */
function setException(tx: Tx, change: Change, slotId: string, date: string, fields: { start?: string | null; durationMinutes?: number | null }) {
  const key = { slotId, date };
  const existing = findRows(tx, 'routineSlotExceptions', whereKey('routineSlotExceptions', key))[0];
  const row = { skipped: false, start: null, durationMinutes: null, ...existing, ...fields, ...key };
  const empty = !row.skipped && row.start == null && row.durationMinutes == null;
  if (existing && empty) remove(tx, change, 'routineSlotExceptions', existing);
  else if (existing) update(tx, change, 'routineSlotExceptions', existing, row);
  else if (!empty) insert(tx, change, 'routineSlotExceptions', row);
}

function drop(tx: Tx, change: Change, d: DropInput, ctx: Ctx): DropResult {
  const none: DropResult = { routine: null };
  switch (d.action) {
    case 'placeTask': {
      const task = need(tx, 'tasks', d.taskId, 'task');
      if (task.window === 'waiting' || task.window === 'decide') {
        throw new HTTPException(409, { message: 'Waiting and decision items can’t go on the schedule' });
      }
      const startAt = startOn(ctx, d.date, d.startMin);
      const some = findRows(tx, 'sometime', whereKey('sometime', { taskId: task.id }))[0];
      if (some) remove(tx, change, 'sometime', some);
      insert(tx, change, 'blocks', {
        id: randomUUID(), kind: 'task', taskId: task.id, startAt, durationMinutes: blockLength(task),
        pinned: true, rolledFrom: some?.rolledFrom ?? null,
      });
      return none;
    }

    case 'commitTask': {
      const task = need(tx, 'tasks', d.taskId, 'task');
      let rolledFrom: unknown = null;
      if (d.blockId) {
        const block = need(tx, 'blocks', d.blockId, 'block');
        if (block.taskId !== task.id) throw new HTTPException(409, { message: 'That block belongs to another task' });
        rolledFrom = block.rolledFrom;
        remove(tx, change, 'blocks', block);
      }
      const existing = findRows(tx, 'sometime', whereKey('sometime', { taskId: task.id }))[0];
      const row = { taskId: task.id, date: d.date, rolledFrom: existing?.rolledFrom ?? rolledFrom ?? null };
      if (existing) update(tx, change, 'sometime', existing, row);
      else insert(tx, change, 'sometime', row);
      return none;
    }

    case 'moveBlock': {
      const block = need(tx, 'blocks', d.blockId, 'block');
      const set: Row = { startAt: startOn(ctx, d.date, d.startMin), pinned: true };
      if (d.label !== undefined) set.label = d.label;
      update(tx, change, 'blocks', block, set);
      return none;
    }

    case 'moveRoutine': {
      const slot = need(tx, 'routineSlots', d.slotId, 'routine time');
      startOn(ctx, d.date, d.startMin);
      const start = clockOf(d.startMin);
      if (d.everyDay) {
        if (start !== slot.start) update(tx, change, 'routineSlots', slot, { start });
        setException(tx, change, d.slotId, d.date, { start: null });
      } else {
        setException(tx, change, d.slotId, d.date, { start: start === slot.start ? null : start });
      }
      return none;
    }

    case 'placeRoutine': {
      const routine = need(tx, 'routines', d.routineId, 'routine');
      startOn(ctx, d.date, d.startMin);
      const start = clockOf(d.startMin);
      const slot = tx.select().from(t.routineSlots).where(eq(t.routineSlots.routineId, d.routineId)).orderBy(asc(t.routineSlots.start)).get();
      if (slot) {
        if (start !== slot.start) update(tx, change, 'routineSlots', slot, { start });
        const ex = findRows(tx, 'routineSlotExceptions', whereKey('routineSlotExceptions', { slotId: slot.id, date: d.date }))[0];
        if (ex) remove(tx, change, 'routineSlotExceptions', ex);
      } else {
        insert(tx, change, 'routineSlots', { id: randomUUID(), routineId: routine.id, start, durationMinutes: routine.durationMinutes });
      }
      return {
        routine: {
          title: routine.title as string, repeat: routine.repeat as 'daily' | 'weekly', repeatDays: (routine.repeatDays as number[] | null) ?? null,
          repeatEvery: (routine.repeatEvery as number | null) ?? 1, start,
        },
      };
    }

    case 'resizeBlock': {
      const block = need(tx, 'blocks', d.blockId, 'block');
      if (block.durationMinutes !== d.minutes) update(tx, change, 'blocks', block, { durationMinutes: d.minutes });
      return none;
    }

    case 'resizeRoutine': {
      const slot = need(tx, 'routineSlots', d.slotId, 'routine time');
      if (d.everyDay) {
        if (slot.durationMinutes !== d.minutes) update(tx, change, 'routineSlots', slot, { durationMinutes: d.minutes });
        setException(tx, change, d.slotId, d.date, { durationMinutes: null });
      } else {
        setException(tx, change, d.slotId, d.date, { durationMinutes: d.minutes === slot.durationMinutes ? null : d.minutes });
      }
      return none;
    }
  }
}

export function registerDrops(app: Hono, db: Db, run: Run, now: () => DateTime) {
  app.post('/api/drops', async (c) => {
    const q = c.req.query('tz');
    const device = q === undefined ? undefined : ZoneSchema.parse(q);
    const input = await readBody(c, DropInputSchema);
    const settings = getSettings(db);
    const zone = resolveZone(settings.timeZone, device ?? settings.homeTimeZone);
    const at = now();
    return c.json(run((tx, change) => drop(tx, change, input, { zone, now: at, today: dayOf(at, zone) })));
  });
}
