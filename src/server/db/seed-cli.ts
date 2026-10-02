import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_DB_PATH, openDb } from './client';
import { seed } from './seed';

mkdirSync(dirname(DEFAULT_DB_PATH), { recursive: true });
const seeded = seed(openDb(DEFAULT_DB_PATH));
console.log(seeded ? `Seeded ${DEFAULT_DB_PATH}` : 'The database already has data, so nothing was changed.');
