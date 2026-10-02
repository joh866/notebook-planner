import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));
export const DEFAULT_DB_PATH = fileURLToPath(new URL('../../../data/planner.db', import.meta.url));

/** Opens a database and applies any pending migrations. Tests pass ':memory:'. */
export function openDb(path: string = DEFAULT_DB_PATH): Db {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
