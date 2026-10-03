import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { DateTime } from 'luxon';
import { DEFAULT_DB_PATH } from './client';
import { compareSchema, repairSchema } from './schemaCheck';

// npm run db:repair: makes data/planner.db match the migrations, after backing it up to
// data/backups/. It only fixes what's safe (constraints and migration hashes); anything else is
// reported and left alone.

if (!existsSync(DEFAULT_DB_PATH)) {
  console.log('db:repair: there’s no data/planner.db, so there’s nothing to repair.');
  process.exit(0);
}
const db = new Database(DEFAULT_DB_PATH, { fileMustExist: true });
db.pragma('foreign_keys = ON');
if (!compareSchema(db).length) {
  console.log('db:repair: data/planner.db already matches the migrations. Nothing changed.');
  process.exit(0);
}

const dir = join(dirname(DEFAULT_DB_PATH), 'backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `planner-${DateTime.now().toFormat("yyyy-MM-dd'T'HHmmss")}.db`);
await db.backup(backup);
// Make sure the backup opens and has the same rows before changing anything.
const copy = new Database(backup, { readonly: true, fileMustExist: true });
const count = (d: Database.Database) => (d.prepare('SELECT count(*) AS n FROM tasks').get() as { n: number }).n;
if (copy.pragma('integrity_check', { simple: true }) !== 'ok' || count(copy) !== count(db)) {
  console.error(`db:repair: the backup at ${backup} didn’t check out, so nothing was changed.`);
  process.exit(1);
}
copy.close();
console.log(`db:repair: backed up to ${backup}`);

const { fixed, left } = repairSchema(db);
db.close();
for (const d of fixed) console.log(`  fixed ${d.kind} ${d.name}`);
if (left.length) {
  console.error(`db:repair: ${left.length} difference${left.length === 1 ? '' : 's'} need a real migration:`);
  for (const d of left) console.error(`  ${d.kind} ${d.name}`);
  process.exit(1);
}
console.log('db:repair: data/planner.db now matches the migrations.');
