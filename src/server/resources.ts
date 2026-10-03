import { randomUUID } from 'node:crypto';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import {
  BlockInputSchema,
  BlockPatchSchema,
  CategoryInputSchema,
  CategoryPatchSchema,
  ClassInputSchema,
  ClassPatchSchema,
  ConditionInputSchema,
  ConditionPatchSchema,
  DaySchema,
  RoutineInputSchema,
  RoutinePatchSchema,
  RoutineStepInputSchema,
  RoutineStepPatchSchema,
  SlotExceptionInputSchema,
  SlotInputSchema,
  SlotPatchSchema,
  SometimeInputSchema,
  StepInputSchema,
  StepPatchSchema,
  TaskInputSchema,
  TaskPatchSchema,
  blockProblem,
  classProblem,
  routineProblem,
  taskProblem,
} from '../shared/api';
import type { Db } from './db/client';
import * as t from './db/schema';
import { Change, findRows, whereKey, type TableName, type Tx } from './undo';

// Create, update, and delete for every kind of item. Every change returns an Undo token.

type Row = Record<string, unknown>;
export type Run = <T>(fn: (tx: Tx, change: Change) => T) => { item: T; undo: string | null };

export async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const json: unknown = await c.req.json().catch(() => {
    throw new HTTPException(400, { message: 'The body must be JSON' });
  });
  return schema.parse(json);
}

export const notFound = (what: string) => new HTTPException(404, { message: `No ${what} with that id` });

function invalid(problem: string | null) {
  if (problem) throw new HTTPException(400, { message: problem });
}

const columnsOf = (table: SQLiteTable) => getTableColumns(table) as Record<string, SQLiteColumn>;

function nextSortOrder(tx: Tx, table: SQLiteTable): number {
  const col = columnsOf(table).sortOrder!;
  const row = tx.select({ max: sql<number | null>`max(${col})` }).from(table).get();
  return (row?.max ?? -1) + 1;
}

/** Inserts rows and records them for Undo. */
function insert(tx: Tx, change: Change, name: TableName, table: SQLiteTable, rows: Row[]) {
  if (!rows.length) return;
  tx.insert(table).values(rows as never).run();
  change.created(name, rows);
}

interface ResourceSpec {
  name: TableName;
  table: SQLiteTable;
  /** Plural noun in the URL, like "tasks". */
  path: string;
  what: string;
  create: z.ZodType;
  patch: z.ZodType;
  /** Created under a parent: POST /api/{parent.path}/:id/{parent.as}. */
  parent?: { name: TableName; path: string; as: string; column: string };
  problem?: (row: Row) => string | null;
  /** Fills in fields from the parent, like a slot's length from its routine. */
  defaults?: (row: Row, parent: Row | undefined) => Row;
  /** Inserts nested rows (steps, slots) after the item itself. */
  children?: (tx: Tx, change: Change, item: Row, input: Row) => void;
  canDelete?: (row: Row) => string | null;
}

function resource(app: Hono, db: Db, run: Run, spec: ResourceSpec) {
  const { name, table, path, what } = spec;
  const byId = (tx: Tx | Db, id: string) => findRows(tx, name, whereKey(name, { id }))[0];
  const hasSortOrder = 'sortOrder' in columnsOf(table);

  const create = async (c: Context, parentId?: string) => {
    const input = (await readBody(c, spec.create)) as Row;
    const fields = { ...input };
    delete fields.steps;
    delete fields.slots;
    const result = run((tx, change) => {
      let parent: Row | undefined;
      if (spec.parent) {
        parent = findRows(tx, spec.parent.name, whereKey(spec.parent.name, { id: parentId }))[0];
        if (!parent) throw notFound(spec.parent.path.replace(/s$/, ''));
        fields[spec.parent.column] = parentId;
      }
      let row: Row = { id: randomUUID(), ...fields };
      if (hasSortOrder && row.sortOrder == null) row.sortOrder = nextSortOrder(tx, table);
      if (spec.defaults) row = spec.defaults(row, parent);
      invalid(spec.problem?.(row) ?? null);
      insert(tx, change, name, table, [row]);
      spec.children?.(tx, change, row, input);
      return byId(tx, row.id as string)!;
    });
    return c.json(result, 201);
  };

  if (spec.parent) {
    const p = spec.parent;
    app.post(`/api/${p.path}/:parentId/${p.as}`, (c) => create(c, c.req.param('parentId')));
  } else {
    app.post(`/api/${path}`, (c) => create(c));
  }

  app.get(`/api/${path}`, (c) => {
    const column = spec.parent?.column;
    const parentId = column ? c.req.query(column) : undefined;
    const rows = column && parentId
      ? findRows(db, name, eq(columnsOf(table)[column]!, parentId))
      : (db.select().from(table).all() as Row[]);
    return c.json(rows);
  });

  app.get(`/api/${path}/:id`, (c) => {
    const row = byId(db, c.req.param('id'));
    if (!row) throw notFound(what);
    return c.json(row);
  });

  app.patch(`/api/${path}/:id`, async (c) => {
    const input = (await readBody(c, spec.patch)) as Row;
    return c.json(run((tx, change) => {
      const existing = byId(tx, c.req.param('id'));
      if (!existing) throw notFound(what);
      invalid(spec.problem?.({ ...existing, ...input }) ?? null);
      if (!Object.keys(input).length) return existing;
      change.before(name, [existing]);
      tx.update(table).set(input as never).where(whereKey(name, existing)).run();
      return byId(tx, existing.id as string)!;
    }));
  });

  app.delete(`/api/${path}/:id`, (c) => c.json(run((tx, change) => {
    const existing = byId(tx, c.req.param('id'));
    if (!existing) throw notFound(what);
    const refused = spec.canDelete?.(existing);
    if (refused) throw new HTTPException(409, { message: refused });
    change.beforeDelete(tx, name, [existing]);
    tx.delete(table).where(whereKey(name, existing)).run();
    return null;
  })));
}

/**
 * A row keyed by an item and a day, like a routine checked on a date. PUT sets it, DELETE clears
 * it. Both are safe to repeat.
 */
/** Turns a per-day row (a check) on or off, recording it for Undo. */
function setDay(tx: Tx, change: Change, name: TableName, table: SQLiteTable, row: Row, on: boolean) {
  const existing = findRows(tx, name, whereKey(name, row));
  if (on && !existing.length) insert(tx, change, name, table, [row]);
  if (!on && existing.length) {
    change.before(name, existing);
    tx.delete(table).where(whereKey(name, row)).run();
  }
}

function dayToggle(app: Hono, run: Run, spec: {
  path: string;
  parent: TableName;
  what: string;
  name: TableName;
  table: SQLiteTable;
  /** The row for this item and day. */
  row: (id: string, date: string, body: Row) => Row;
  body?: z.ZodType;
  /** Runs in the same change after the item is turned on or off for the day. */
  then?: (tx: Tx, change: Change, id: string, date: string, on: boolean) => void;
}) {
  const route = `/api/${spec.path}/:id/:date`;
  const params = (c: Context) => ({ id: c.req.param('id')!, date: DaySchema.parse(c.req.param('date')) });

  app.put(route, async (c) => {
    const { id, date } = params(c);
    const body = spec.body ? ((await readBody(c, spec.body)) as Row) : {};
    return c.json(run((tx, change) => {
      if (!findRows(tx, spec.parent, whereKey(spec.parent, { id }))[0]) throw notFound(spec.what);
      const row = spec.row(id, date, body);
      const existing = findRows(tx, spec.name, whereKey(spec.name, row))[0];
      if (existing) {
        change.before(spec.name, [existing]);
        tx.update(spec.table).set(row as never).where(whereKey(spec.name, row)).run();
      } else {
        insert(tx, change, spec.name, spec.table, [row]);
      }
      spec.then?.(tx, change, id, date, true);
      return findRows(tx, spec.name, whereKey(spec.name, row))[0]!;
    }));
  });

  app.delete(route, (c) => {
    const { id, date } = params(c);
    return c.json(run((tx, change) => {
      const key = spec.row(id, date, {});
      const existing = findRows(tx, spec.name, whereKey(spec.name, key));
      change.before(spec.name, existing);
      tx.delete(spec.table).where(whereKey(spec.name, key)).run();
      spec.then?.(tx, change, id, date, false);
      return null;
    }));
  });
}

export function registerResources(app: Hono, db: Db, run: Run) {
  resource(app, db, run, {
    name: 'categories', table: t.categories, path: 'categories', what: 'category',
    create: CategoryInputSchema, patch: CategoryPatchSchema,
    canDelete: (row) => (row.builtin ? 'Built-in categories can’t be deleted' : null),
  });

  resource(app, db, run, {
    name: 'conditions', table: t.conditions, path: 'conditions', what: 'check-in question',
    create: ConditionInputSchema, patch: ConditionPatchSchema,
  });

  resource(app, db, run, {
    name: 'tasks', table: t.tasks, path: 'tasks', what: 'task',
    create: TaskInputSchema, patch: TaskPatchSchema, problem: taskProblem,
    children: (tx, change, task, input) => {
      const steps = (input.steps as Row[] | undefined) ?? [];
      insert(tx, change, 'taskSteps', t.taskSteps, steps.map((s, i) => ({ id: randomUUID(), sortOrder: i, ...s, taskId: task.id })));
    },
  });

  resource(app, db, run, {
    name: 'taskSteps', table: t.taskSteps, path: 'task-steps', what: 'step',
    create: StepInputSchema, patch: StepPatchSchema,
    parent: { name: 'tasks', path: 'tasks', as: 'steps', column: 'taskId' },
  });

  resource(app, db, run, {
    name: 'routines', table: t.routines, path: 'routines', what: 'routine',
    create: RoutineInputSchema, patch: RoutinePatchSchema, problem: routineProblem,
    children: (tx, change, routine, input) => {
      const steps = (input.steps as Row[] | undefined) ?? [];
      const slots = (input.slots as Row[] | undefined) ?? [];
      insert(tx, change, 'routineSteps', t.routineSteps,
        steps.map((s, i) => ({ id: randomUUID(), sortOrder: i, ...s, routineId: routine.id })));
      insert(tx, change, 'routineSlots', t.routineSlots,
        slots.map((s) => ({ id: randomUUID(), durationMinutes: routine.durationMinutes, ...s, routineId: routine.id })));
    },
  });

  resource(app, db, run, {
    name: 'routineSteps', table: t.routineSteps, path: 'routine-steps', what: 'routine step',
    create: RoutineStepInputSchema, patch: RoutineStepPatchSchema,
    parent: { name: 'routines', path: 'routines', as: 'steps', column: 'routineId' },
  });

  resource(app, db, run, {
    name: 'routineSlots', table: t.routineSlots, path: 'routine-slots', what: 'routine time',
    create: SlotInputSchema, patch: SlotPatchSchema,
    parent: { name: 'routines', path: 'routines', as: 'slots', column: 'routineId' },
    defaults: (row, routine) => ({ ...row, durationMinutes: row.durationMinutes ?? routine?.durationMinutes }),
  });

  resource(app, db, run, {
    name: 'classes', table: t.classes, path: 'classes', what: 'class',
    create: ClassInputSchema, patch: ClassPatchSchema, problem: classProblem,
  });

  resource(app, db, run, {
    name: 'blocks', table: t.blocks, path: 'blocks', what: 'block',
    create: BlockInputSchema, patch: BlockPatchSchema, problem: blockProblem,
  });

  dayToggle(app, run, {
    path: 'routine-checks', parent: 'routines', what: 'routine', name: 'routineChecks', table: t.routineChecks,
    row: (routineId, date) => ({ routineId, date }),
    // Checking the routine checks all its steps; unchecking it clears them (spec §10, "Routine steps").
    then: (tx, change, routineId, date, on) => {
      for (const step of tx.select().from(t.routineSteps).where(eq(t.routineSteps.routineId, routineId)).all()) {
        setDay(tx, change, 'routineStepChecks', t.routineStepChecks, { stepId: step.id, date }, on);
      }
    },
  });
  dayToggle(app, run, {
    path: 'routine-step-checks', parent: 'routineSteps', what: 'routine step', name: 'routineStepChecks', table: t.routineStepChecks,
    row: (stepId, date) => ({ stepId, date }),
    // Checking every step checks the routine; unchecking one unchecks it.
    then: (tx, change, stepId, date, on) => {
      const step = tx.select().from(t.routineSteps).where(eq(t.routineSteps.id, stepId)).get()!;
      const all = tx.select().from(t.routineSteps).where(eq(t.routineSteps.routineId, step.routineId)).all();
      const checked = new Set(tx.select().from(t.routineStepChecks).where(eq(t.routineStepChecks.date, date)).all().map((c) => c.stepId));
      if (!on || all.every((s) => checked.has(s.id))) {
        setDay(tx, change, 'routineChecks', t.routineChecks, { routineId: step.routineId, date }, on);
      }
    },
  });
  dayToggle(app, run, {
    path: 'class-skips', parent: 'classes', what: 'class', name: 'classSkips', table: t.classSkips,
    row: (classId, date) => ({ classId, date }),
  });
  dayToggle(app, run, {
    path: 'slot-exceptions', parent: 'routineSlots', what: 'routine time', name: 'routineSlotExceptions', table: t.routineSlotExceptions,
    body: SlotExceptionInputSchema,
    row: (slotId, date, body) => ({ skipped: false, start: null, durationMinutes: null, ...body, slotId, date }),
  });

  // A task committed to a day without a time (spec §7). One entry per task.
  app.put('/api/sometime/:taskId', async (c) => {
    const taskId = c.req.param('taskId');
    const body = await readBody(c, SometimeInputSchema);
    return c.json(run((tx, change) => {
      if (!findRows(tx, 'tasks', whereKey('tasks', { id: taskId }))[0]) throw notFound('task');
      const row = { taskId, date: body.date, rolledFrom: body.rolledFrom ?? null };
      const existing = findRows(tx, 'sometime', whereKey('sometime', row))[0];
      if (existing) change.before('sometime', [existing]);
      tx.insert(t.sometime).values(row).onConflictDoUpdate({ target: t.sometime.taskId, set: row }).run();
      if (!existing) change.created('sometime', [row]);
      return row;
    }));
  });

  app.delete('/api/sometime/:taskId', (c) => c.json(run((tx, change) => {
    const key = { taskId: c.req.param('taskId') };
    change.before('sometime', findRows(tx, 'sometime', whereKey('sometime', key)));
    tx.delete(t.sometime).where(whereKey('sometime', key)).run();
    return null;
  })));
}
