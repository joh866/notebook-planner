import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { DEFAULT_DB_PATH } from './client';
import { compareSchema } from './schemaCheck';

// npm run db:check: does data/planner.db match the migrations exactly? It only reads the database.
// Step 14 copies this database to the server, so it should pass before then.

if (!existsSync(DEFAULT_DB_PATH)) {
  console.log('db:check: there’s no data/planner.db yet, so there’s nothing to compare.');
} else {
  const db = new Database(DEFAULT_DB_PATH, { readonly: true, fileMustExist: true });
  const diffs = compareSchema(db);
  db.close();
  if (!diffs.length) {
    console.log('db:check: data/planner.db matches the migrations.');
  } else {
    console.error(`db:check: data/planner.db differs from the migrations in ${diffs.length} place${diffs.length === 1 ? '' : 's'}:`);
    for (const d of diffs) {
      console.error(`\n  ${d.kind} ${d.name}\n    live:     ${d.live ?? '(missing)'}\n    expected: ${d.expected ?? '(not in the migrations)'}`);
    }
    console.error('\nnpm run db:repair fixes differences that are only in constraints or migration hashes, after a backup.');
    process.exit(1);
  }
}
