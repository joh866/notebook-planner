import { randomUUID } from 'node:crypto';
import { and, eq, inArray, getTableColumns, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from './db/client';
import * as t from './db/schema';

// Undo for every change (spec §2.4, AGENTS.md). A change records the rows as they were before it
// touched them, plus the keys of rows it created. Undo removes the created rows and writes the old
// ones back, including children that a delete cascaded to and links it set to null.

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Row = Record<string, unknown>;

/** Every table, parents before children, with its primary key. */
const TABLES = {
  categories: { table: t.categories, key: ['id'] },
  conditions: { table: t.conditions, key: ['id'] },
  tasks: { table: t.tasks, key: ['id'] },
  taskSteps: { table: t.taskSteps, key: ['id'] },
  routines: { table: t.routines, key: ['id'] },
  routineChecks: { table: t.routineChecks, key: ['routineId', 'date'] },
  routineSteps: { table: t.routineSteps, key: ['id'] },
  routineStepChecks: { table: t.routineStepChecks, key: ['stepId', 'date'] },
  routineSlots: { table: t.routineSlots, key: ['id'] },
  routineSlotExceptions: { table: t.routineSlotExceptions, key: ['slotId', 'date'] },
  classes: { table: t.classes, key: ['id'] },
  classSkips: { table: t.classSkips, key: ['classId', 'date'] },
  blocks: { table: t.blocks, key: ['id'] },
  sometime: { table: t.sometime, key: ['taskId'] },
  settings: { table: t.settings, key: ['id'] },
} satisfies Record<string, { table: SQLiteTable; key: string[] }>;

export type TableName = keyof typeof TABLES;
const ORDER = Object.keys(TABLES) as TableName[];

/** Foreign keys from schema.ts, by what happens to the child when the parent is deleted. */
const REFS: { child: TableName; column: string; parent: TableName; cascade: boolean }[] = [
  { child: 'tasks', column: 'categoryId', parent: 'categories', cascade: false },
  { child: 'routines', column: 'categoryId', parent: 'categories', cascade: false },
  { child: 'classes', column: 'categoryId', parent: 'categories', cascade: false },
  { child: 'blocks', column: 'categoryId', parent: 'categories', cascade: false },
  { child: 'tasks', column: 'conditionId', parent: 'conditions', cascade: false },
  { child: 'taskSteps', column: 'taskId', parent: 'tasks', cascade: true },
  { child: 'blocks', column: 'taskId', parent: 'tasks', cascade: true },
  { child: 'sometime', column: 'taskId', parent: 'tasks', cascade: true },
  { child: 'routineChecks', column: 'routineId', parent: 'routines', cascade: true },
  { child: 'routineSteps', column: 'routineId', parent: 'routines', cascade: true },
  { child: 'routineSlots', column: 'routineId', parent: 'routines', cascade: true },
  { child: 'routineStepChecks', column: 'stepId', parent: 'routineSteps', cascade: true },
  { child: 'routineSlotExceptions', column: 'slotId', parent: 'routineSlots', cascade: true },
  { child: 'classSkips', column: 'classId', parent: 'classes', cascade: true },
];

export const tableOf = (name: TableName) => TABLES[name].table as SQLiteTable;
const columnsOf = (name: TableName) => getTableColumns(tableOf(name)) as Record<string, SQLiteColumn>;
const keyOf = (name: TableName, row: Row) => JSON.stringify(TABLES[name].key.map((k) => row[k]));

export function whereKey(name: TableName, row: Row): SQL {
  const cols = columnsOf(name);
  return and(...TABLES[name].key.map((k) => eq(cols[k]!, row[k])))!;
}

export function findRows(tx: Tx | Db, name: TableName, where: SQL): Row[] {
  return tx.select().from(tableOf(name)).where(where).all() as Row[];
}

export interface UndoEntry {
  restore: Map<TableName, Map<string, Row>>;
  remove: Map<TableName, Map<string, Row>>;
}

/** The inverse of one change, built up while it runs. */
export class Change implements UndoEntry {
  restore = new Map<TableName, Map<string, Row>>();
  remove = new Map<TableName, Map<string, Row>>();

  private bucket(map: Map<TableName, Map<string, Row>>, name: TableName) {
    let m = map.get(name);
    if (!m) map.set(name, (m = new Map()));
    return m;
  }

  /** Call before updating or deleting rows. Keeps the first state seen. */
  before(name: TableName, rows: Row[]) {
    for (const row of rows) {
      const k = keyOf(name, row);
      if (this.remove.get(name)?.has(k)) continue;
      const m = this.bucket(this.restore, name);
      if (!m.has(k)) m.set(k, { ...row });
    }
  }

  /** Call after inserting rows. A key that existed before is restored instead. */
  created(name: TableName, rows: Row[]) {
    for (const row of rows) {
      const k = keyOf(name, row);
      if (!this.restore.get(name)?.has(k)) this.bucket(this.remove, name).set(k, row);
    }
  }

  /** Call before deleting rows. Also records what the delete cascades to or unlinks. */
  beforeDelete(tx: Tx, name: TableName, rows: Row[]) {
    if (!rows.length) return;
    this.before(name, rows);
    const ids = rows.map((r) => r.id).filter((id) => id != null);
    if (!ids.length) return;
    for (const ref of REFS.filter((r) => r.parent === name)) {
      const children = findRows(tx, ref.child, inArray(columnsOf(ref.child)[ref.column]!, ids));
      if (ref.cascade) this.beforeDelete(tx, ref.child, children);
      else this.before(ref.child, children);
    }
  }

  get empty() {
    return ![...this.restore.values(), ...this.remove.values()].some((m) => m.size);
  }
}

/** Puts the database back the way it was before a change. */
export function applyUndo(tx: Tx, entry: UndoEntry) {
  for (const name of [...ORDER].reverse()) {
    for (const row of entry.remove.get(name)?.values() ?? []) tx.delete(tableOf(name)).where(whereKey(name, row)).run();
  }
  for (const name of ORDER) {
    const cols = columnsOf(name);
    const target = TABLES[name].key.map((k) => cols[k]!);
    for (const row of entry.restore.get(name)?.values() ?? []) {
      tx.insert(tableOf(name)).values(row as never).onConflictDoUpdate({ target, set: row as never }).run();
    }
  }
}

/** Recent changes, kept in memory while the server runs. Each token works once. */
export class UndoStore {
  private entries = new Map<string, UndoEntry>();
  constructor(private limit = 100) {}

  push(entry: UndoEntry): string {
    const token = randomUUID();
    this.entries.set(token, entry);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    return token;
  }

  take(token: string): UndoEntry | undefined {
    const entry = this.entries.get(token);
    this.entries.delete(token);
    return entry;
  }
}
