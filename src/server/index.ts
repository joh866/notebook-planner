import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Health } from '../shared/schemas';

const app = new Hono();

app.get('/api/health', (c) => c.json<Health>({ ok: true }));

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`API on http://localhost:${port}`);
});
