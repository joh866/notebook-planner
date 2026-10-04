import { DateTime } from 'luxon';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { rollover } from '../core/rollover';
import { AgendaDaysSchema, DaySchema, MonthSchema, SettingsPatchSchema, ZoneSchema } from '../shared/api';
import type { Health } from '../shared/schemas';
import type { Db } from './db/client';
import * as t from './db/schema';
import { registerAdds } from './adds';
import { registerAuth, type AuthConfig } from './auth';
import { anthropicSorter, type SortChunk } from './ai';
import { registerAnswers } from './answers';
import { registerDrops } from './drops';
import { autoPencil, registerPlan } from './plan';
import { httpFeed, registerCanvas, type FetchFeed } from './canvas';
import { registerChanges } from './changes';
import { GoogleService, registerGoogle } from './google';
import { registerPush, type SendPush } from './push';
import { registerSessions } from './sessions';
import { notFound, readBody, registerResources, type Run } from './resources';
import { Change, UndoStore, applyUndo, findRows, whereKey } from './undo';
import { agendaView, dayView, getSettings, monthView, rolloverInputs, weekView } from './views';

export interface AppOptions {
  db: Db;
  /** The current moment. Tests pass a fixed one. */
  now?: () => DateTime;
  undo?: UndoStore;
  /** Sorts add-box text with the AI. Tests pass a fake. */
  sort?: SortChunk;
  /** Gets the Canvas feed. Tests pass a saved sample. */
  fetchFeed?: FetchFeed;
  /** One-person sign-in. Left out on localhost and in most tests, which keeps the API open. */
  auth?: AuthConfig;
  /** Web push: the public key the browser needs, and how to send. Left out without push keys. */
  push?: { publicKey: string; send: SendPush };
  /** Google Calendar (spec §14). Without one, Settings says it isn't set up. */
  google?: GoogleService;
}

/**
 * The API. Reads take `?tz=` (the device's time zone), which is used when the time zone setting
 * is "auto". Without it, the home zone is used.
 */
export function createApp({ db, now = () => DateTime.utc(), undo = new UndoStore(), sort = anthropicSorter(), fetchFeed = httpFeed, auth, push, google = new GoogleService(db, undefined) }: AppOptions) {
  const app = new Hono();

  /** Runs a change in one transaction and keeps its inverse for Undo. */
  const run: Run = (fn) => {
    const change = new Change();
    const item = db.transaction((tx) => fn(tx, change));
    return { item, undo: change.empty ? null : undo.push(change) };
  };

  const tz = (c: Context) => {
    const q = c.req.query('tz');
    return q === undefined ? undefined : ZoneSchema.parse(q);
  };
  const optional = <T>(schema: { parse: (v: unknown) => T }, v: string | undefined) => (v === undefined ? undefined : schema.parse(v));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) return c.json({ error: 'Invalid input', issues: err.issues }, 400);
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
      return c.json({ error: 'That refers to something that doesn’t exist, or already exists' }, 409);
    }
    console.error(err);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  // Before every other route, so nothing is readable without signing in.
  registerAuth(app, auth, () => now().toMillis());

  // With write-back on, a change in the app goes out to Google a little later (spec §14).
  app.use('/api/*', async (c, next) => {
    await next();
    if (c.req.method !== 'GET' && !c.req.path.startsWith('/api/google') && c.res.status < 400) google.soon();
  });

  app.get('/api/health', (c) => c.json<Health>({ ok: true }));

  app.get('/api/day/:date?', (c) => c.json(dayView(db, now(), optional(DaySchema, c.req.param('date')), tz(c))));
  app.get('/api/week/:date?', (c) => c.json(weekView(db, now(), optional(DaySchema, c.req.param('date')), tz(c))));
  app.get('/api/month/:month?', (c) => c.json(monthView(db, now(), optional(MonthSchema, c.req.param('month')), tz(c))));
  app.get('/api/agenda/:date?', (c) => {
    const days = AgendaDaysSchema.parse(c.req.query('days') ?? '10');
    return c.json(agendaView(db, now(), optional(DaySchema, c.req.param('date')), days, tz(c)));
  });

  app.get('/api/settings', (c) => c.json(getSettings(db)));
  app.patch('/api/settings', async (c) => {
    const input = await readBody(c, SettingsPatchSchema);
    return c.json(run((tx, change) => {
      const existing = getSettings(db);
      if (!Object.keys(input).length) return existing;
      change.before('settings', [existing]);
      const notify = input.notify ? { ...existing.notify, ...input.notify } : existing.notify;
      tx.update(t.settings).set({ ...input, notify }).where(whereKey('settings', existing)).run();
      return findRows(tx, 'settings', whereKey('settings', existing))[0];
    }));
  });

  /** Unfinished tasks in each category, for the settings sheet (spec §13). */
  app.get('/api/category-counts', (c) => {
    const counts: Record<string, number> = {};
    for (const task of db.select().from(t.tasks).all()) {
      if (task.doneAt || !task.categoryId) continue;
      counts[task.categoryId] = (counts[task.categoryId] ?? 0) + 1;
    }
    return c.json(counts);
  });

  registerResources(app, db, run, now);
  registerAnswers(app, run, now);
  registerDrops(app, db, run, now);
  registerAdds(app, db, run, now, sort);
  registerPlan(app, db, run, now);
  registerSessions(app, db, run, now);
  registerChanges(app, db, run, now);
  registerCanvas(app, db, run, now, fetchFeed);
  registerPush(app, db, now, push);
  registerGoogle(app, google, auth?.secure ?? false);

  /** Moves unfinished tasks from past days to today's Sometime lane (spec §10). */
  app.post('/api/rollover', (c) => {
    const zone = tz(c);
    return c.json(run((tx, change) => {
      const input = rolloverInputs(db, now(), zone);
      const result = rollover(input.today, input.zone, input.tasks, input.taskBlocks, input.sometime);
      for (const id of result.removeBlockIds) {
        // "blockId:taskId" is a task in a "Quick things" block: it leaves the batch, which stays for what's done.
        const [blockId, taskId] = id.split(':');
        if (taskId) {
          const key = { blockId, taskId };
          change.before('quickItems', findRows(tx, 'quickItems', whereKey('quickItems', key)));
          tx.delete(t.quickItems).where(whereKey('quickItems', key)).run();
          continue;
        }
        change.before('blocks', findRows(tx, 'blocks', whereKey('blocks', { id })));
        tx.delete(t.blocks).where(whereKey('blocks', { id })).run();
      }
      for (const entry of result.sometime) {
        const existing = findRows(tx, 'sometime', whereKey('sometime', entry));
        if (existing.length) change.before('sometime', existing);
        tx.insert(t.sometime).values(entry).onConflictDoUpdate({ target: t.sometime.taskId, set: entry }).run();
        if (!existing.length) change.created('sometime', [entry]);
      }
      const moved = result.sometime.map((s) => s.taskId);
      // With automatic scheduling on, rolled-over tasks are penciled in too (spec §10, "Rollover").
      autoPencil(db, tx, change, now(), zone, moved);
      return { today: input.today, moved };
    }));
  });

  app.post('/api/undo/:token', (c) => {
    const entry = undo.take(c.req.param('token'));
    if (!entry) throw notFound('change to undo');
    db.transaction((tx) => applyUndo(tx, entry));
    return c.json({ ok: true });
  });

  return app;
}
