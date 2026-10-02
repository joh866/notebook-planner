import { randomUUID } from 'node:crypto';
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

/** Writes penciled blocks for placements. A placed task leaves the Sometime lane. Returns each block's start by task. */
function pencil(tx: Tx, change: Change, placements: Placement[], zone: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of placements) {
    const startAt = iso(atMinute(p.date, p.startMin, zone));
    const row = {
      id: randomUUID(), kind: 'task' as const, taskId: p.taskId, startAt, durationMinutes: p.minutes,
      pinned: false, reason: p.reason, rolledFrom: p.rolledFrom,
    };
    tx.insert(t.blocks).values(row).run();
    change.created('blocks', [row]);
    const some = findRows(tx, 'sometime', whereKey('sometime', { taskId: p.taskId }));
    if (some.length && some[0]!.date === p.date) {
      change.before('sometime', some);
      tx.delete(t.sometime).where(whereKey('sometime', { taskId: p.taskId })).run();
    }
    out.set(p.taskId, startAt);
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
      const lifted = p.blocks.filter((b) =>
        b.kind === 'task' && !b.pinned && b.taskId && !done.has(b.taskId)
        && dayOf(utc(b.startAt), p.zone) === date && (date !== p.today || utc(b.startAt) >= at));
      const skip = new Set(lifted.map((b) => b.id));
      const keep = new Map(lifted.map((b) => [b.taskId!, b.durationMinutes]));

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
        placed: placements.map((x) => ({ taskId: x.taskId, title: titles.get(x.taskId)!, startAt: starts.get(x.taskId)!, reason: x.reason })),
      };
    }));
  });
}
