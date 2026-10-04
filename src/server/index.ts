import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { authFromEnv } from './auth';
import { startCanvasSync } from './canvas';
import { DEFAULT_DB_PATH, openDb } from './db/client';
import { GoogleService, googleFromEnv } from './google';
import { pushFromEnv, startPush, webPushSender } from './push';
import { serveWeb, WEB_DIR } from './web';

// Secrets live in .env (AGENTS.md). Node reads it into process.env; nothing here prints it.
if (existsSync('.env')) process.loadEnvFile('.env');

let auth;
try {
  auth = authFromEnv(process.env);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

mkdirSync(dirname(DEFAULT_DB_PATH), { recursive: true });
const db = openDb(DEFAULT_DB_PATH);
const pushConfig = pushFromEnv(process.env);
const push = pushConfig ? { publicKey: pushConfig.publicKey, send: webPushSender(pushConfig) } : undefined;
const google = new GoogleService(db, googleFromEnv(process.env));
const app = createApp({ db, auth, push, google });
// Online, the same server hands out the built web app (step 14). Locally, Vite does.
if (process.env.NODE_ENV === 'production') serveWeb(app, WEB_DIR);
// The Canvas feed, on start and every few hours (spec §14).
startCanvasSync(db);
// Google Calendar, on start and every 15 minutes (spec §14).
if (google.config) google.start();
// Notifications, checked every minute (spec §13).
if (push) startPush(db, push.send);

const port = Number(process.env.API_PORT ?? 8787);
// Only this machine can reach the app directly. Online, Caddy passes HTTPS requests to it.
const hostname = process.env.HOST ?? '127.0.0.1';
serve({ fetch: app.fetch, port, hostname }, () => {
  console.log(`API on http://${hostname}:${port}${auth ? ', sign-in on' : ''}${push ? ', notifications on' : ''}${google.config ? ', Google Calendar on' : ''}`);
});
