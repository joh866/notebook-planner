import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { DateTime } from 'luxon';
import { DEFAULT_DB_PATH } from './client';

// npm run db:backup: copies data/planner.db to data/backups/auto-<time>.db while the app keeps
// running (SQLite's backup API is safe alongside writes), checks the copy, and removes automatic
// copies older than 14 days. Copies made by db:repair are left alone. deploy/backup.sh runs this
// nightly and then sends data/backups off the droplet.

const KEEP_DAYS = 14;

if (!existsSync(DEFAULT_DB_PATH)) {
  console.log('db:backup: there’s no data/planner.db, so there’s nothing to back up.');
  process.exit(0);
}
const dir = join(dirname(DEFAULT_DB_PATH), 'backups');
mkdirSync(dir, { recursive: true });
const file = join(dir, `auto-${DateTime.now().toFormat("yyyy-MM-dd'T'HHmmss")}.db`);

const db = new Database(DEFAULT_DB_PATH, { readonly: true, fileMustExist: true });
await db.backup(file);
db.close();

const copy = new Database(file, { readonly: true, fileMustExist: true });
const ok = copy.pragma('integrity_check', { simple: true }) === 'ok';
copy.close();
if (!ok) {
  unlinkSync(file);
  console.error('db:backup: the copy didn’t pass SQLite’s integrity check, so it was removed.');
  process.exit(1);
}
console.log(`db:backup: saved ${file}`);

const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
for (const name of readdirSync(dir)) {
  if (!/^auto-.*\.db$/.test(name)) continue;
  const path = join(dir, name);
  if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
}
