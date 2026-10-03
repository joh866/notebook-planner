import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { DateTime } from 'luxon';
import { canvasAssignments, type Assignment } from '../core/canvas';
import { parseICal } from '../core/ical';
import { deadlineMoment } from '../core/urgency';
import type { CanvasSync } from '../shared/api';
import type { Db } from './db/client';
import * as t from './db/schema';
import type { Run } from './resources';
import { Change, findRows, whereKey, type Tx } from './undo';
import { getSettings } from './views';

// Canvas's calendar feed (spec §14, "Canvas"). The server fetches the saved link on start and every
// few hours. Assignments become tasks with deadlines in Classes, marked "From Canvas". Fetching
// again updates them instead of making new ones, and never overwrites something the user changed.
// The link is private: it's never logged or put in a message.

/** Gets a feed's text. Tests pass a saved sample. */
export type FetchFeed = (url: string) => Promise<string>;

/** A failure with a reason that's safe to show (no link in it). */
export class FeedError extends Error {}

export const httpFeed: FetchFeed = async (url) => {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: 'text/calendar' } });
  } catch {
    throw new FeedError('couldn’t reach Canvas');
  }
  if (!res.ok) throw new FeedError(`Canvas answered ${res.status}`);
  return res.text();
};

/** How often the server fetches the feed. */
export const CANVAS_EVERY_MS = 3 * 60 * 60 * 1000;

type Snapshot = (typeof t.feedItems.$inferSelect)['snapshot'];
const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;
const snapshotOf = (a: Assignment): Snapshot => ({ title: a.title, meta: a.course, dueAt: a.dueAt, dueDate: a.dueDate });

/**
 * Applies a feed's assignments. New ones due from now on become tasks. Known ones update only the
 * fields still as the feed last wrote them, so the user's changes stay. One the user deleted stays
 * deleted.
 */
export function applyAssignments(tx: Tx, change: Change, list: Assignment[], now: DateTime, homeZone: string): Omit<CanvasSync, 'error'> {
  let added = 0;
  let updated = 0;
  const hasClass = !!tx.select().from(t.categories).where(eq(t.categories.id, 'class')).get();
  for (const a of list) {
    const snap = snapshotOf(a);
    const known = findRows(tx, 'feedItems', whereKey('feedItems', { uid: a.uid }))[0] as (typeof t.feedItems.$inferSelect) | undefined;
    if (!known) {
      // Assignments already past their deadline aren't added: the feed can't say if they were turned in.
      const due = deadlineMoment(a, homeZone);
      if (due && due < now) continue;
      const order = tx.select({ max: sql<number | null>`max(${t.tasks.sortOrder})` }).from(t.tasks).get()?.max ?? -1;
      const task = {
        id: randomUUID(), title: a.title, meta: a.course, categoryId: hasClass ? 'class' : null, window: 'soon' as const,
        dueAt: a.dueAt, dueDate: a.dueDate, sortOrder: order + 1,
      };
      tx.insert(t.tasks).values(task).run();
      change.created('tasks', [task]);
      const item = { uid: a.uid, source: 'canvas' as const, taskId: task.id, snapshot: snap, lastSeenAt: iso(now) };
      tx.insert(t.feedItems).values(item).run();
      change.created('feedItems', [item]);
      added++;
      continue;
    }
    change.before('feedItems', [known]);
    const task = known.taskId ? tx.select().from(t.tasks).where(eq(t.tasks.id, known.taskId)).get() : undefined;
    if (!task) {
      tx.update(t.feedItems).set({ lastSeenAt: iso(now) }).where(eq(t.feedItems.uid, a.uid)).run();
      continue;
    }
    const old = known.snapshot;
    const set: Partial<typeof t.tasks.$inferInsert> = {};
    const next: Snapshot = { ...old };
    if (task.title === old.title && a.title !== old.title) {
      set.title = a.title;
      next.title = a.title;
    }
    if (task.meta === old.meta && a.course !== old.meta) {
      set.meta = a.course;
      next.meta = a.course;
    }
    const dueSame = task.dueAt === old.dueAt && task.dueDate === old.dueDate;
    if (dueSame && (a.dueAt !== old.dueAt || a.dueDate !== old.dueDate)) {
      set.dueAt = a.dueAt;
      set.dueDate = a.dueDate;
      next.dueAt = a.dueAt;
      next.dueDate = a.dueDate;
    }
    if (Object.keys(set).length) {
      change.before('tasks', [task]);
      tx.update(t.tasks).set(set).where(eq(t.tasks.id, task.id)).run();
      updated++;
    }
    tx.update(t.feedItems).set({ snapshot: next, lastSeenAt: iso(now) }).where(eq(t.feedItems.uid, a.uid)).run();
  }
  return { added, updated, seen: list.length };
}

/** Records the last fetch on the settings row: when, and what it found or why it failed. */
function note(tx: Tx | Db, now: DateTime, text: string) {
  tx.update(t.settings).set({ canvasSyncedAt: iso(now), canvasNote: text }).where(eq(t.settings.id, 1)).run();
}

const summary = (r: Omit<CanvasSync, 'error'>) =>
  `${r.seen} assignment${r.seen === 1 ? '' : 's'}${r.added ? `, ${r.added} new` : ''}${r.updated ? `, ${r.updated} updated` : ''}`;

/** Fetches the saved feed and applies it. `run` makes it a change with Undo (the Check now button). */
export async function syncCanvas(db: Db, now: DateTime, fetchFeed: FetchFeed, run?: Run): Promise<{ item: CanvasSync; undo: string | null } | null> {
  const settings = getSettings(db);
  const url = settings.canvasFeedUrl;
  if (!url) return null;
  let text: string;
  try {
    text = await fetchFeed(url);
  } catch (e) {
    const reason = e instanceof FeedError ? e.message : 'couldn’t reach Canvas';
    note(db, now, `Couldn’t check: ${reason}`);
    return { item: { added: 0, updated: 0, seen: 0, error: reason }, undo: null };
  }
  const codes = db.select().from(t.classes).all().map((c) => c.code);
  const list = canvasAssignments(parseICal(text, settings.homeTimeZone), codes);
  const apply = (tx: Tx, change: Change): CanvasSync => {
    const r = applyAssignments(tx, change, list, now, settings.homeTimeZone);
    note(tx, now, summary(r));
    return { ...r, error: null };
  };
  if (run) return run(apply);
  return { item: db.transaction((tx) => apply(tx, new Change())), undo: null };
}

/** Fetches on start and every few hours. Failures are noted in settings, never thrown. */
export function startCanvasSync(db: Db, fetchFeed: FetchFeed = httpFeed): () => void {
  const tick = () => void syncCanvas(db, DateTime.utc(), fetchFeed).catch(() => console.warn('Canvas check failed'));
  tick();
  const id = setInterval(tick, CANVAS_EVERY_MS);
  return () => clearInterval(id);
}

export function registerCanvas(app: Hono, db: Db, run: Run, now: () => DateTime, fetchFeed: FetchFeed) {
  /** The Check now button in Settings. */
  app.post('/api/canvas/sync', async (c) => {
    const r = await syncCanvas(db, now(), fetchFeed, run);
    return c.json(r ?? { item: { added: 0, updated: 0, seen: 0, error: 'there’s no Canvas link saved' }, undo: null });
  });
}
