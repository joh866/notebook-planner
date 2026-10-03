import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { DateTime } from 'luxon';
import { DecideInputSchema, type ConditionAnswer, type DecisionResult, type StillOnResult } from '../shared/api';
import type { DecisionYes } from '../shared/schemas';
import * as t from './db/schema';
import { notFound, readBody, type Run } from './resources';
import { findRows, whereKey, type Change, type Tx } from './undo';

// Answers to decisions and check-in questions (spec §10). Each answer is one change with one Undo.

type Row = Record<string, unknown>;

export function registerAnswers(app: Hono, run: Run, now: () => DateTime) {
  /**
   * Yes or No on a "?" item. Both drop the item. Yes also does what the item says: makes a task
   * (in the decision's category) or skips a class on a day.
   */
  app.post('/api/tasks/:id/decide', async (c) => {
    const { yes } = await readBody(c, DecideInputSchema);
    return c.json(run((tx, change): DecisionResult => {
      const task = findRows(tx, 'tasks', whereKey('tasks', { id: c.req.param('id') }))[0];
      if (!task) throw notFound('task');
      if (task.window !== 'decide') throw new HTTPException(409, { message: 'That task isn’t a decision' });

      change.beforeDelete(tx, 'tasks', [task]);
      tx.delete(t.tasks).where(whereKey('tasks', task)).run();

      const then = yes ? (task.decisionYes as DecisionYes | null) : null;
      const result: DecisionResult = { made: null, skipped: null };
      if (then && 'makeTask' in then) {
        const row: Row = {
          id: randomUUID(), title: then.makeTask.title, window: then.makeTask.window, categoryId: task.categoryId,
          sortOrder: task.sortOrder,
        };
        tx.insert(t.tasks).values(row as never).run();
        change.created('tasks', [row]);
        result.made = { id: row.id as string, title: then.makeTask.title, window: then.makeTask.window };
      } else if (then && 'skipClass' in then) {
        const { classId, date } = then.skipClass;
        if (findRows(tx, 'classes', whereKey('classes', { id: classId }))[0]) {
          const key = { classId, date };
          if (!findRows(tx, 'classSkips', whereKey('classSkips', key)).length) {
            tx.insert(t.classSkips).values(key).run();
            change.created('classSkips', [key]);
          }
          result.skipped = key;
        }
      }
      return result;
    }));
  });

  /**
   * Yes on a check-in question (spec §10, "Conditions"): it's answered, and every task and event that
   * had it becomes a normal item, staying in its own window.
   */
  app.post('/api/conditions/:id/answer', (c) => c.json(run((tx, change): ConditionAnswer => {
    const cond = findRows(tx, 'conditions', whereKey('conditions', { id: c.req.param('id') }))[0];
    if (!cond) throw notFound('check-in question');
    change.before('conditions', [cond]);
    tx.update(t.conditions).set({ answeredAt: now().toUTC().toISO({ suppressMilliseconds: true })! }).where(whereKey('conditions', cond)).run();
    const tasks = tx.select().from(t.tasks).where(eq(t.tasks.conditionId, cond.id as string)).all() as Row[];
    const blocks = tx.select().from(t.blocks).where(eq(t.blocks.conditionId, cond.id as string)).all() as Row[];
    change.before('tasks', tasks);
    change.before('blocks', blocks);
    tx.update(t.tasks).set({ conditionId: null }).where(eq(t.tasks.conditionId, cond.id as string)).run();
    tx.update(t.blocks).set({ conditionId: null }).where(eq(t.blocks.conditionId, cond.id as string)).run();
    return {
      cleared: [...tasks, ...blocks].map((x) => ({ id: x.id as string, title: (x.title as string | null) ?? 'Event' })),
    };
  })));

  /**
   * "Still on?" on a timed "if" item when its time comes (spec §7). Yes makes it a normal item, and
   * answers the question too when nothing else waits on it. No removes it.
   */
  const stillOn = (name: 'tasks' | 'blocks') => async (c: Context) => {
    const { yes } = await readBody(c, DecideInputSchema);
    return c.json(run((tx, change): StillOnResult => {
      const row = findRows(tx, name, whereKey(name, { id: c.req.param('id') }))[0];
      if (!row) throw notFound(name === 'tasks' ? 'task' : 'event');
      if (!yes) {
        change.beforeDelete(tx, name, [row]);
        tx.delete(name === 'tasks' ? t.tasks : t.blocks).where(whereKey(name, row)).run();
        return { removed: true };
      }
      clearIf(tx, change, name, row);
      return { removed: false };
    }));
  };
  app.post('/api/tasks/:id/still-on', stillOn('tasks'));
  app.post('/api/blocks/:id/still-on', stillOn('blocks'));

  /** Clears an item's "if" condition. Its question is answered once nothing else unfinished has it. */
  function clearIf(tx: Tx, change: Change, name: 'tasks' | 'blocks', row: Row) {
    const id = row.conditionId as string | null;
    if (!id) return;
    change.before(name, [row]);
    if (name === 'tasks') tx.update(t.tasks).set({ conditionId: null }).where(whereKey('tasks', row)).run();
    else tx.update(t.blocks).set({ conditionId: null }).where(whereKey('blocks', row)).run();
    const others = [
      ...tx.select().from(t.tasks).where(eq(t.tasks.conditionId, id)).all().filter((x) => !x.doneAt),
      ...tx.select().from(t.blocks).where(eq(t.blocks.conditionId, id)).all().filter((x) => !x.done),
    ];
    if (others.length) return;
    const cond = findRows(tx, 'conditions', whereKey('conditions', { id }))[0];
    if (!cond || cond.answeredAt) return;
    change.before('conditions', [cond]);
    tx.update(t.conditions).set({ answeredAt: now().toUTC().toISO({ suppressMilliseconds: true })! }).where(whereKey('conditions', cond)).run();
  }
}
