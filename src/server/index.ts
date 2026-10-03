import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { startCanvasSync } from './canvas';
import { DEFAULT_DB_PATH, openDb } from './db/client';

// Secrets live in .env (AGENTS.md). Node reads it into process.env; nothing here prints it.
if (existsSync('.env')) process.loadEnvFile('.env');

mkdirSync(dirname(DEFAULT_DB_PATH), { recursive: true });
const db = openDb(DEFAULT_DB_PATH);
const app = createApp({ db });
// The Canvas feed, on start and every few hours (spec §14).
startCanvasSync(db);

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`API on http://localhost:${port}`);
});
