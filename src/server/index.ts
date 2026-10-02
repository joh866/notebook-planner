import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { DEFAULT_DB_PATH, openDb } from './db/client';

mkdirSync(dirname(DEFAULT_DB_PATH), { recursive: true });
const app = createApp({ db: openDb(DEFAULT_DB_PATH) });

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`API on http://localhost:${port}`);
});
