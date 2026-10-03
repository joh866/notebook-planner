import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { DateTime } from 'luxon';
import { dayOf } from '../core/day';
import { freeMinutes, placeNew, planDay, type Placement } from '../core/planner';
import { atMinute } from '../core/time';
import { PlanInputSchema, ZoneSchema, type PlanResult } from '../shared/api';
import type { Db } from './db/client';
import * as t from './db/schema';
import { readBody, type Run } from './resources';
import { findRows, whereKey, type Change, type Tx } from './undo';
import { planInputs } from './views';

// The planner on the server (spec §12): the Plan button, and automatic scheduling for new and
// rolled-over tasks. The math is in src/core/planner.ts; this reads the rows and writes the blocks.

const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;
const utc = (s: string) => DateTime.fromISO(s, { zone: 'utc' });

/**
 * Writes penciled blocks for placements: task blocks, new "Quick things" blocks, and quick tasks
 * joining one. A placed task leaves the Sometime lane. Returns each task's start.
 */
function pencil(tx: Tx, change: Change, placements: Placement[], zone: string): Map<string, string> {
  const out = new Map<string, string>();
  /** Quick blocks made in this run, by their "new:<taskId>" name. */
  const made = new Map<string, string>();
  const join = (blockId: string, taskIds: string[]) => {
    const sortFrom = tx.select().from(t.quickItems).where(eq(t.quickItems.blockId, blockId)).all().length;
    const rows = taskIds.map((taskId, i) => ({ blockId, taskId, sortOrder: sortFrom + i }));
    tx.insert(t.quickItems).values(rows).run();
    change.created('quickItems', rows);
  };
  for (const p of placements) {
    const startAt = iso(atMinute(p.date, p.startMin, zone));
    const members = p.batch ?? [p.taskId];
    if (p.joinBlockId) {
      const id = made.get(p.joinBlockId) ?? p.joinBlockId;
      const block = findRows(tx, 'blocks', whereKey('blocks', { id }))[0]!;
      change.before('blocks', [block]);
      tx.update(t.blocks).set({ durationMinutes: (block.durationMinutes as number) + p.minutes }).where(whereKey('blocks', block)).run();
      join(id, [p.taskId]);
      out.set(p.taskId, block.startAt as string);
    } else {
      const row = {
        id: randomUUID(), kind: p.batch ? ('quick' as const) : ('task' as const), taskId: p.batch ? null : p.taskId,
        title: p.batch ? 'Quick things' : null, startAt, durationMinutes: p.minutes, pinned: false, reason: p.reason, rolledFrom: p.rolledFrom,
      };
      tx.insert(t.blocks).values(row).run();
      change.created('blocks', [row]);
      if (p.batch) {
        join(row.id, p.batch);
        made.set(`new:${p.taskId}`, row.id);
      }
      for (const id of members) out.set(id, startAt);
    }
    for (const taskId of members) {
      const some = findRows(tx, 'sometime', whereKey('sometime', { taskId }));
      if (some.length && some[0]!.date === p.date) {
        change.before('sometime', some);
        tx.delete(t.sometime).where(whereKey('sometime', { taskId })).run();
      }
    }
  }
  return out;
}

/**
 * Automatic scheduling (spec §12), when the setting is on: pencils in the given tasks if they're
 * Today or tomorrow, This week, or Overdue. Part of the caller's change, so one Undo covers both.
 */
export function autoPencil(db: Db, tx: Tx, change: Change, now: DateTime, deviceZone: string | undefined, taskIds: string[]): Map<string, string> {
  if (!taskIds.length) return new Map();
  const p = planInputs(db, now, deviceZone);
  if (!p.settings.autoSchedule) return new Map();
  const ids = new Set(taskIds);
  const placements = placeNew(p.tasks().filter((x) => ids.has(x.id)), p.clock, (date) => p.day(date));
  return pencil(tx, change, placements, p.zone);
}

export function registerPlan(app: Hono, db: Db, run: Run, now: () => DateTime) {
  /**
   * The Plan button (spec §12): lifts the penciled blocks from the rest of the day, then places the
   * best-scoring unscheduled tasks into its free time, at most 6.
   */
  app.post('/api/plan', async (c) => {
    const q = c.req.query('tz');
    const device = q === undefined ? undefined : ZoneSchema.parse(q);
    const { date } = await readBody(c, PlanInputSchema);
    const at = now();
    return c.json(run((tx, change): PlanResult => {
      const p = planInputs(db, at, device);
      if (date < p.today) throw new HTTPException(409, { message: 'That day has already passed' });

      const done = new Set(p.tasks().filter((x) => x.doneAt).map((x) => x.id));
      // Penciled task blocks, and penciled "Quick things" blocks with something left to do.
      const unfinished = (b: (typeof p.blocks)[number]) => b.kind === 'task'
        ? !!b.taskId && !done.has(b.taskId)
        : b.kind === 'quick' && p.quickItems.some((q) => q.blockId === b.id && !done.has(q.taskId));
      const lifted = p.blocks.filter((b) =>
        !b.pinned && unfinished(b) && dayOf(utc(b.startAt), p.zone) === date && (date !== p.today || utc(b.startAt) >= at));
      const skip = new Set(lifted.map((b) => b.id));
      const keep = new Map(lifted.flatMap((b) => (b.taskId ? [[b.taskId, b.durationMinutes] as const] : [])));

      const day = p.day(date, skip);
      const free = freeMinutes(day.from, day.to, day.busy);
      const placements = planDay(day, p.tasks(skip), p.clock, keep);

      for (const b of lifted) {
        change.beforeDelete(tx, 'blocks', [b]);
        tx.delete(t.blocks).where(whereKey('blocks', b)).run();
      }
      const starts = pencil(tx, change, placements, p.zone);
      const titles = new Map(p.tasks().map((x) => [x.id, x.title]));
      return {
        date, lifted: lifted.length, free,
        placed: placements.flatMap((x) => (x.batch ?? [x.taskId]).map((id) => ({
          taskId: id, title: titles.get(id)!, startAt: starts.get(id)!, reason: x.reason,
        }))),
      };
    }));
  });
}
