import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { compareSchema, repairSchema } from './schemaCheck';

// The live database has to match the migrations exactly before step 14 copies it to the server.

const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));

// A copy of the migrations with 0007 as it was first applied to data/planner.db: drizzle-kit's
// version, before the hand fix added ON DELETE set null to blocks.session_id.
const early = mkdtempSync(join(tmpdir(), 'planner-migrations-'));
cpSync(migrationsFolder, early, { recursive: true });
const fixed = readFileSync(join(migrationsFolder, '0007_sessions.sql'), 'utf8');
writeFileSync(join(early, '0007_sessions.sql'), fixed.replace('REFERENCES task_sessions(id) ON UPDATE no action ON DELETE set null;', 'REFERENCES task_sessions(id);'));
afterAll(() => rmSync(early, { recursive: true, force: true }));

function migrated(folder: string) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(drizzle(db), { migrationsFolder: folder });
  return db;
}

describe('compareSchema', () => {
  it('finds nothing on a database the migrations made', () => {
    expect(compareSchema(migrated(migrationsFolder))).toEqual([]);
  });

  it('finds the missing delete rule and the old migration hash', () => {
    const diffs = compareSchema(migrated(early));
    expect(diffs.map((d) => [d.kind, d.name])).toEqual([['table', 'blocks'], ['migration', '#7']]);
    expect(diffs[0]!.live).toContain('`session_id` text REFERENCES task_sessions(id),');
    expect(diffs[0]!.expected).toContain('`session_id` text REFERENCES task_sessions(id) ON UPDATE no action ON DELETE set null,');
  });

  it('finds a missing table, an extra one, and a different column', () => {
    const db = migrated(migrationsFolder);
    db.exec('DROP TABLE feed_items; CREATE TABLE scratch (x int); ALTER TABLE settings ADD extra text;');
    expect(compareSchema(db).map((d) => [d.kind, d.name, d.live === null, d.expected === null])).toEqual([
      ['table', 'feed_items', true, false], ['table', 'settings', false, false], ['table', 'scratch', false, true],
    ]);
  });
});

describe('repairSchema', () => {
  it('fixes the delete rule and the hash, keeping every row, and the rule then works', () => {
    const db = migrated(early);
    db.exec(`
      INSERT INTO tasks (id, title, window) VALUES ('t', 'Read', 'week');
      INSERT INTO task_sessions (id, task_id, start_at, end_at) VALUES ('s', 't', '2026-10-02T20:46:00Z', '2026-10-02T22:08:00Z');
      INSERT INTO blocks (id, kind, task_id, start_at, duration_minutes, session_id) VALUES ('b', 'task', 't', '2026-10-02T20:46:00Z', 82, 's');
    `);
    // Before: deleting the session is refused, since the link has no delete rule.
    expect(() => db.exec(`DELETE FROM task_sessions WHERE id = 's'`)).toThrow(/FOREIGN KEY/);

    const r = repairSchema(db);
    expect(r.fixed.map((d) => d.name)).toEqual(['blocks', '#7']);
    expect(r.left).toEqual([]);
    expect(compareSchema(db)).toEqual([]);
    expect(db.prepare('SELECT id, session_id FROM blocks').all()).toEqual([{ id: 'b', session_id: 's' }]);

    db.exec(`DELETE FROM task_sessions WHERE id = 's'`);
    expect(db.prepare('SELECT session_id FROM blocks').get()).toEqual({ session_id: null });
  });

  it('leaves alone what it can’t fix safely', () => {
    const db = migrated(migrationsFolder);
    db.exec('ALTER TABLE settings ADD extra text;');
    const r = repairSchema(db);
    expect(r.fixed).toEqual([]);
    expect(r.left.map((d) => d.name)).toEqual(['settings']);
  });
});
