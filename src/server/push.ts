import { eq, lt } from 'drizzle-orm';
import type { Hono } from 'hono';
import { DateTime } from 'luxon';
import webpush from 'web-push';
import { notesDue, type Note } from '../core/notify';
import { PushSubscribeSchema, PushUnsubscribeSchema, type PushState, type PushTest } from '../shared/api';
import type { Db } from './db/client';
import * as t from './db/schema';
import { readBody } from './resources';
import { notifyInputs } from './views';

// Web push (spec §13 and §14, "Notifications"). Devices subscribe from Settings. Every minute the
// server works out what's due (src/core/notify.ts) and sends it to every device, once. The private
// key is read here only and never sent anywhere; the public key goes to the browser, which needs it.

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** Who's sending: the site's address or a mailto: link. Push services may use it to get in touch. */
  subject: string;
}

type Subscription = typeof t.pushSubscriptions.$inferSelect;
/** What a device receives. The service worker shows it. */
export interface Payload {
  title: string;
  body: string;
  tag: string;
  url: string;
}
/** Sends one push. Throws with `statusCode` 404 or 410 when the device's subscription is gone. Tests pass a fake. */
export type SendPush = (sub: Subscription, payload: Payload) => Promise<void>;

/** Push is on when .env has both keys (`npm run push-keys` writes them). */
export function pushFromEnv(env: NodeJS.ProcessEnv): PushConfig | undefined {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return undefined;
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT?.trim() || 'mailto:planner@localhost' };
}

export function webPushSender(config: PushConfig): SendPush {
  const vapidDetails = { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey };
  return async (sub, payload) => {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      // A reminder that's an hour late isn't worth showing.
      { vapidDetails, TTL: 60 * 60, urgency: 'high', timeout: 15_000 },
    );
  };
}

const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;
const gone = (e: unknown) => [404, 410].includes((e as { statusCode?: number }).statusCode ?? 0);

/** Sends a payload to every device. Devices whose subscription is gone are forgotten. */
async function sendAll(db: Db, send: SendPush, payload: Payload): Promise<PushTest> {
  let sent = 0;
  let failed = 0;
  for (const sub of db.select().from(t.pushSubscriptions).all()) {
    try {
      await send(sub, payload);
      sent++;
    } catch (e) {
      failed++;
      if (gone(e)) db.delete(t.pushSubscriptions).where(eq(t.pushSubscriptions.endpoint, sub.endpoint)).run();
      // The address is private to the device, so only the status is logged.
      else console.warn(`Push failed (${(e as { statusCode?: number }).statusCode ?? 'no answer'})`);
    }
  }
  return { sent, failed };
}

/** The zone of the device that opened the app most recently, for the "auto" time zone setting. */
function lastZone(db: Db): string | undefined {
  return db.select().from(t.pushSubscriptions).all().sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0]?.zone;
}

/** Sends what's due now and hasn't been sent. Returns the notes sent. */
export async function sendDue(db: Db, now: DateTime, send: SendPush): Promise<Note[]> {
  if (!db.select().from(t.pushSubscriptions).get()) return [];
  // Keys are kept for a few days, which is longer than any note stays due.
  db.delete(t.sentNotifications).where(lt(t.sentNotifications.sentAt, iso(now.minus({ days: 3 })))).run();
  const due = notesDue(notifyInputs(db, now, lastZone(db)));
  const fresh = due.filter((n) => !db.select().from(t.sentNotifications).where(eq(t.sentNotifications.key, n.key)).get());
  for (const n of fresh) {
    // Marked first, so a crash midway never sends it twice.
    db.insert(t.sentNotifications).values({ key: n.key, sentAt: iso(now) }).onConflictDoNothing().run();
    await sendAll(db, send, { title: n.title, body: n.body, tag: n.key, url: '/' });
  }
  return fresh;
}

/** How often the server checks for notifications. */
export const PUSH_EVERY_MS = 60 * 1000;

/** Checks every minute. Failures are logged without details, never thrown. */
export function startPush(db: Db, send: SendPush): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await sendDue(db, DateTime.utc(), send);
    } catch {
      console.warn('Notification check failed');
    } finally {
      busy = false;
    }
  };
  void tick();
  const id = setInterval(() => void tick(), PUSH_EVERY_MS);
  return () => clearInterval(id);
}

export function registerPush(app: Hono, db: Db, now: () => DateTime, push: { publicKey: string; send: SendPush } | undefined) {
  const devices = () => db.select().from(t.pushSubscriptions).all().length;

  app.get('/api/push', (c) => c.json<PushState>({ publicKey: push?.publicKey ?? null, devices: devices() }));

  /** Turns notifications on for this device, or refreshes its time zone when the app opens. */
  app.put('/api/push/subscription', async (c) => {
    const { endpoint, keys, zone } = await readBody(c, PushSubscribeSchema);
    const row = { endpoint, p256dh: keys.p256dh, auth: keys.auth, zone, lastSeenAt: iso(now()) };
    db.insert(t.pushSubscriptions).values(row).onConflictDoUpdate({ target: t.pushSubscriptions.endpoint, set: row }).run();
    return c.json<PushState>({ publicKey: push?.publicKey ?? null, devices: devices() });
  });

  app.delete('/api/push/subscription', async (c) => {
    const { endpoint } = await readBody(c, PushUnsubscribeSchema);
    db.delete(t.pushSubscriptions).where(eq(t.pushSubscriptions.endpoint, endpoint)).run();
    return c.json<PushState>({ publicKey: push?.publicKey ?? null, devices: devices() });
  });

  /** The test button: a push to every device. */
  app.post('/api/push/test', async (c) => {
    if (!push) return c.json<PushTest>({ sent: 0, failed: 0 });
    return c.json(await sendAll(db, push.send, {
      title: 'Test notification', body: 'Notifications work on this device.', tag: 'test', url: '/',
    }));
  });
}
