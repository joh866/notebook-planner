import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { DateTime } from 'luxon';
import { DecideInputSchema, type ConditionAnswer, type DecisionResult } from '../shared/api';
import type { DecisionYes } from '../shared/schemas';
import * as t from './db/schema';
import { notFound, readBody, type Run } from './resources';
import { findRows, whereKey } from './undo';

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

  /** Yes on a check-in question: every task waiting on it moves to Soon. */
  app.post('/api/conditions/:id/answer', (c) => c.json(run((tx, change): ConditionAnswer => {
    const cond = findRows(tx, 'conditions', whereKey('conditions', { id: c.req.param('id') }))[0];
    if (!cond) throw notFound('check-in question');
    const waiting = tx.select().from(t.tasks)
      .where(and(eq(t.tasks.conditionId, cond.id as string), eq(t.tasks.window, 'waiting')))
      .all() as Row[];
    change.before('conditions', [cond]);
    tx.update(t.conditions).set({ answeredAt: now().toUTC().toISO({ suppressMilliseconds: true })! }).where(whereKey('conditions', cond)).run();
    change.before('tasks', waiting);
    for (const task of waiting) tx.update(t.tasks).set({ window: 'soon' }).where(whereKey('tasks', task)).run();
    return { moved: waiting.map((x) => ({ id: x.id as string, title: x.title as string })) };
  })));
}
