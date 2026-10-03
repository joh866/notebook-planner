import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

// Does a database match what the migrations make? Step 14 copies data/planner.db to the server, so
// its schema has to be exactly the one the migrations describe: the same tables, columns,
// constraints, and indexes, and the same record of which migrations ran.

const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));

export interface SchemaDiff {
  kind: 'table' | 'index' | 'trigger' | 'view' | 'migration';
  name: string;
  /** What the live database has, or null when it's missing. */
  live: string | null;
  /** What the migrations make, or null when the live database has something extra. */
  expected: string | null;
}

interface Entry {
  type: string;
  name: string;
  sql: string | null;
}

const entries = (db: Database.Database): Entry[] =>
  db.prepare(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all() as Entry[];

/** The migrations' record: each file's hash and its journal time, in order. */
function expectedMigrations(): { hash: string; createdAt: number }[] {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
  return journal.entries.map((e) => ({
    hash: createHash('sha256').update(readFileSync(join(migrationsFolder, `${e.tag}.sql`), 'utf8')).digest('hex'),
    createdAt: e.when,
  }));
}

/** A fresh, empty database with every migration applied. */
function expectedDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

/** Every way `live` differs from what the migrations make. Empty means they match. */
export function compareSchema(live: Database.Database): SchemaDiff[] {
  const fresh = expectedDb();
  const want = entries(fresh);
  const have = entries(live);
  fresh.close();
  const out: SchemaDiff[] = [];
  const key = (e: Entry) => `${e.type}:${e.name}`;
  const haveBy = new Map(have.map((e) => [key(e), e]));
  const wantBy = new Map(want.map((e) => [key(e), e]));
  for (const w of want) {
    const h = haveBy.get(key(w));
    if (!h || h.sql !== w.sql) out.push({ kind: w.type as SchemaDiff['kind'], name: w.name, live: h?.sql ?? null, expected: w.sql });
  }
  for (const h of have) {
    if (!wantBy.has(key(h))) out.push({ kind: h.type as SchemaDiff['kind'], name: h.name, live: h.sql, expected: null });
  }

  const ran = live.prepare('SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY id').all() as { hash: string; createdAt: number }[];
  const files = expectedMigrations();
  for (let i = 0; i < Math.max(ran.length, files.length); i++) {
    const r = ran[i];
    const f = files[i];
    if (r?.hash !== f?.hash || Number(r?.createdAt) !== f?.createdAt) {
      out.push({ kind: 'migration', name: `#${i}`, live: r ? `${r.hash} @ ${r.createdAt}` : null, expected: f ? `${f.hash} @ ${f.createdAt}` : null });
    }
  }
  return out;
}

const columnsOf = (db: Database.Database, table: string) =>
  JSON.stringify(db.prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)`).all(table));

/**
 * Fixes differences that are only in a table's constraints (like a missing ON DELETE), and the
 * stored migration hashes. A constraint change doesn't touch any stored rows, so the table's
 * definition is rewritten in place, as SQLite documents for this kind of change. Anything else
 * (a missing or different column, an extra table) is left alone and returned.
 */
export function repairSchema(live: Database.Database): { fixed: SchemaDiff[]; left: SchemaDiff[] } {
  const diffs = compareSchema(live);
  const fresh = expectedDb();
  const fixable = diffs.filter((d) => d.kind === 'table' && d.live && d.expected && columnsOf(live, d.name) === columnsOf(fresh, d.name));
  fresh.close();
  const files = expectedMigrations();
  const hashes = diffs.filter((d) => d.kind === 'migration' && d.live && d.expected
    && d.live.split(' @ ')[1] === d.expected.split(' @ ')[1]);

  // better-sqlite3 runs in SQLite's defensive mode, which blocks writing the stored schema. It's
  // lifted only for this rewrite.
  if (fixable.length) live.unsafeMode(true);
  try {
    live.transaction(() => {
      if (fixable.length) {
        const version = live.pragma('schema_version', { simple: true }) as number;
        live.pragma('writable_schema = ON');
        const set = live.prepare(`UPDATE sqlite_master SET sql = ? WHERE type = 'table' AND name = ?`);
        for (const d of fixable) set.run(d.expected, d.name);
        live.pragma(`schema_version = ${version + 1}`);
        live.pragma('writable_schema = OFF');
      }
      const setHash = live.prepare('UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?');
      for (const d of hashes) {
        const f = files[Number(d.name.slice(1))]!;
        setHash.run(f.hash, f.createdAt);
      }
    })();
  } finally {
    live.unsafeMode(false);
  }

  const integrity = live.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`The database failed its integrity check after the repair: ${String(integrity)}`);
  const broken = live.pragma('foreign_key_check') as unknown[];
  if (broken.length) throw new Error(`${broken.length} rows break a foreign key after the repair`);
  const left = compareSchema(live);
  return { fixed: diffs.filter((d) => !left.some((l) => l.kind === d.kind && l.name === d.name)), left };
}
