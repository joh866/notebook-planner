import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

/** Where `npm run build` puts the web app. */
export const WEB_DIR = fileURLToPath(new URL('../../dist', import.meta.url));

/**
 * Serves the built web app: files from `dir`, and index.html for any other page so a reload on the
 * phone works. Vite names files in assets/ by their contents, so those can be kept for a year; the
 * page and the service worker are checked every time so an update shows up on the next open.
 */
export function serveWeb(app: Hono, dir: string) {
  const indexPath = join(dir, 'index.html');
  if (!existsSync(indexPath)) throw new Error(`No web app at ${dir}. Run \`npm run build\` first.`);
  const index = readFileSync(indexPath, 'utf8');

  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next();
    await next();
    if (!c.req.path.startsWith('/assets/')) c.header('Cache-Control', 'no-cache');
  });
  app.use('*', serveStatic({ root: dir }));
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(index)));
}
