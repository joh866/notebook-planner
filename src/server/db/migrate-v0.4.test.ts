import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb, type Db } from './client';
import { seed } from './seed';
import * as schema from './schema';
import * as t from './schema';

const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));
const v03Seed = readFileSync(fileURLToPath(new URL('../../../tests/fixtures/seed-v0.3.sql', import.meta.url)), 'utf8');

// A copy of the migrations folder with only 0000_init, to build a database as it was after step 2.
const initOnly = mkdtempSync(join(tmpdir(), 'planner-migrations-'));
cpSync(join(migrationsFolder, '0000_init.sql'), join(initOnly, '0000_init.sql'));
cpSync(join(migrationsFolder, 'meta'), join(initOnly, 'meta'), { recursive: true });
const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
writeFileSync(join(initOnly, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }));
afterAll(() => rmSync(initOnly, { recursive: true, force: true }));

/** A database seeded with v0.3, then `change` applied (the user's edits), then all migrations. */
function migratedV03(change?: (sqlite: Database.Database) => void): Db {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: initOnly });
  sqlite.transaction(() => {
    sqlite.pragma('defer_foreign_keys = ON');
    sqlite.exec(v03Seed);
  })();
  change?.(sqlite);
  migrate(db, { migrationsFolder });
  return db;
}

const fresh = () => {
  const db = openDb(':memory:');
  seed(db);
  return db;
};

/** Rows to compare, without columns that depend on when or in what order the rows were made. */
const snapshot = (db: Db) => ({
  routines: db.select().from(t.routines).orderBy(t.routines.id).all(),
  routineSteps: db.select().from(t.routineSteps).orderBy(t.routineSteps.id).all(),
  taskSteps: db.select().from(t.taskSteps).orderBy(t.taskSteps.id).all(),
  tasks: db.select().from(t.tasks).orderBy(t.tasks.id).all().map((task) => ({ ...task, createdAt: '', sortOrder: 0 })),
});

describe('v0.4 data migration', () => {
  it('brings a v0.3-seeded database to the v0.4 seed', () => {
    expect(snapshot(migratedV03())).toEqual(snapshot(fresh()));
  });

  it('leaves alone anything the user created or changed', () => {
    const db = migratedV03((sqlite) => {
      sqlite.exec(`
        UPDATE routines SET duration_minutes = 20 WHERE id = 'gratitude';
        UPDATE routines SET duration_minutes = 90 WHERE id = 'laundry';
        UPDATE task_steps SET done = 1 WHERE id = 'shopping-step-2';
        UPDATE tasks SET title = 'Epiphany deep dive' WHERE id = 'epiphany';
        INSERT INTO tasks (id, title, window) VALUES ('mine', 'My own task', 'near');
      `);
    });
    const routine = (id: string) => db.select().from(t.routines).where(eq(t.routines.id, id)).get();
    expect(routine('gratitude')?.durationMinutes).toBe(20);
    expect(routine('laundry')?.durationMinutes).toBe(90);
    expect(db.select().from(t.routineSteps).all()).toHaveLength(0);
    expect(routine('dorm')?.durationMinutes).toBe(30); // unchanged by the user, so it still updates

    const steps = db.select().from(t.taskSteps).where(eq(t.taskSteps.taskId, 'shopping')).orderBy(t.taskSteps.sortOrder).all();
    expect(steps.map((s) => [s.title, s.done])).toEqual([
      ['Small towels for gym and bathroom', false], ['Razor', true], ['Shower mat (ask roommates about cost and who buys)', false],
    ]);

    const task = (id: string) => db.select().from(t.tasks).where(eq(t.tasks.id, id)).get();
    expect(task('epiphany')).toMatchObject({ title: 'Epiphany deep dive', window: 'ongoing' });
    expect(task('epiphany-build')?.window).toBe('decide');
    expect(task('mine')?.title).toBe('My own task');
  });

  it('adds nothing to an empty database, so the seed still runs', () => {
    const db = openDb(':memory:');
    expect(db.select().from(t.tasks).all()).toHaveLength(0);
    expect(db.select().from(t.routineSteps).all()).toHaveLength(0);
    expect(seed(db)).toBe(true);
  });
});
