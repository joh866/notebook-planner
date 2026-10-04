import { randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { DateTime } from 'luxon';
import { fromGoogle, writeBackPlan, type GoogleEventRaw, type PushBlock, type PushBody } from '../core/google';
import { GooglePatchSchema, type GoogleStatus, type GoogleSyncResult } from '../shared/api';
import type { Db } from './db/client';
import * as t from './db/schema';
import { readBody } from './resources';
import { getSettings } from './views';

// Google Calendar (spec §14, "Google Calendar"). You connect once with Google sign-in (OAuth). The
// server keeps the lasting sign-in (a refresh token) in the database, reads your calendars every
// 15 minutes, and, when write-back is on, sends planned blocks to a "Planner" calendar it made.
// The client secret comes from .env. Neither it nor any token is ever logged or sent to the browser.

/** Read your calendars, and make the Planner calendar and change only the events in it. */
export const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.app.created'];
export const GOOGLE_EVERY_MS = 15 * 60 * 1000;
/** After a change in the app, write-back waits this long, so a burst of changes goes out once. */
export const SOON_MS = 20 * 1000;
/** Days of Google events read: from two weeks back to four months ahead. */
const READ_BACK_DAYS = 14;
const READ_AHEAD_DAYS = 120;
/** Days of planned blocks sent: from yesterday to a month ahead. */
const SEND_BACK_DAYS = 1;
const SEND_AHEAD_DAYS = 30;
const PLANNER_CALENDAR = 'Planner';
const STATE_COOKIE = 'google_state';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Where Google sends you back. Worked out from the request when not set. */
  redirectUri?: string;
}

/** Reads the Google client from the environment. Undefined when it isn't set up. */
export function googleFromEnv(env: NodeJS.ProcessEnv): GoogleConfig | undefined {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret, redirectUri: env.GOOGLE_REDIRECT_URI?.trim() || undefined };
}

/** A failure with a reason that's safe to show. `status` is Google's HTTP status, when there was one. */
export class GoogleError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}
/** Google no longer accepts the lasting sign-in (revoked, or expired). Connect again. */
export class SignInGone extends GoogleError {}

export interface GoogleCalendarRaw {
  id: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  /** Shown in Google Calendar's own list. */
  selected?: boolean;
}

/** Google's endpoints. Tests pass a fake. */
export interface GoogleApi {
  authUrl(config: GoogleConfig, redirectUri: string, state: string): string;
  exchange(config: GoogleConfig, code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number }>;
  refresh(config: GoogleConfig, refreshToken: string): Promise<{ accessToken: string; expiresIn: number }>;
  revoke(token: string): Promise<void>;
  calendars(token: string): Promise<GoogleCalendarRaw[]>;
  events(token: string, calendarId: string, timeMin: string, timeMax: string): Promise<GoogleEventRaw[]>;
  createCalendar(token: string, name: string, timeZone: string): Promise<string>;
  insertEvent(token: string, calendarId: string, body: PushBody): Promise<string>;
  /** Throws a GoogleError with status 404 or 410 when the event is gone. */
  updateEvent(token: string, calendarId: string, eventId: string, body: PushBody): Promise<void>;
  deleteEvent(token: string, calendarId: string, eventId: string): Promise<void>;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL = 'https://www.googleapis.com/calendar/v3';
const enc = encodeURIComponent;
const gone = (e: unknown) => e instanceof GoogleError && (e.status === 404 || e.status === 410);

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new GoogleError('couldn’t reach Google');
  }
}

async function tokenCall(params: Record<string, string>) {
  const res = await call(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (json.error === 'invalid_grant') throw new SignInGone('Google ended the sign-in', res.status);
  if (!res.ok || typeof json.access_token !== 'string') throw new GoogleError(`Google sign-in answered ${res.status}`, res.status);
  return json as { access_token: string; refresh_token?: string; expires_in?: number };
}

async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await call(`${CAL}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new GoogleError(`Google Calendar answered ${res.status}`, res.status);
  return (res.status === 204 ? {} : await res.json()) as T;
}

async function pages<T>(token: string, path: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await api<{ items?: T[]; nextPageToken?: string }>(token, 'GET', `${path}${pageToken ? `&pageToken=${enc(pageToken)}` : ''}`);
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export const httpGoogle: GoogleApi = {
  authUrl: (config, redirectUri, state) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    // Offline with consent: Google gives a lasting sign-in every time you connect.
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  })}`,
  exchange: async (config, code, redirectUri) => {
    const r = await tokenCall({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
    return { accessToken: r.access_token, refreshToken: r.refresh_token ?? null, expiresIn: r.expires_in ?? 3600 };
  },
  refresh: async (config, refreshToken) => {
    const r = await tokenCall({ refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token' });
    return { accessToken: r.access_token, expiresIn: r.expires_in ?? 3600 };
  },
  revoke: async (token) => {
    await call(`https://oauth2.googleapis.com/revoke?token=${enc(token)}`, { method: 'POST' });
  },
  calendars: (token) => pages<GoogleCalendarRaw>(token, '/users/me/calendarList?minAccessRole=reader&maxResults=250'),
  events: (token, calendarId, timeMin, timeMax) =>
    pages<GoogleEventRaw>(token, `/calendars/${enc(calendarId)}/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${enc(timeMin)}&timeMax=${enc(timeMax)}`),
  createCalendar: async (token, name, timeZone) => (await api<{ id: string }>(token, 'POST', '/calendars', { summary: name, timeZone })).id,
  insertEvent: async (token, calendarId, body) => (await api<{ id: string }>(token, 'POST', `/calendars/${enc(calendarId)}/events`, body)).id,
  updateEvent: async (token, calendarId, eventId, body) => {
    await api(token, 'PUT', `/calendars/${enc(calendarId)}/events/${enc(eventId)}`, body);
  },
  deleteEvent: async (token, calendarId, eventId) => {
    try {
      await api(token, 'DELETE', `/calendars/${enc(calendarId)}/events/${enc(eventId)}`);
    } catch (e) {
      if (!gone(e)) throw e;
    }
  },
};

const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;
const utc = (s: string) => DateTime.fromISO(s, { zone: 'utc' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The connection, its syncs, and write-back. One per server. */
export class GoogleService {
  private access: { token: string; until: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private soonTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly db: Db,
    readonly config: GoogleConfig | undefined,
    readonly api: GoogleApi = httpGoogle,
    private readonly now: () => DateTime = () => DateTime.utc(),
  ) {}

  private account() {
    return this.db.select().from(t.googleAccount).where(eq(t.googleAccount.id, 1)).get();
  }

  private note(text: string) {
    this.db.update(t.googleAccount).set({ syncedAt: iso(this.now()), note: text }).where(eq(t.googleAccount.id, 1)).run();
  }

  status(): GoogleStatus {
    const a = this.account();
    return {
      configured: !!this.config,
      connected: !!a,
      expired: !!a && !a.refreshToken,
      email: a?.email ?? null,
      calendars: a ? this.db.select().from(t.googleCalendars).orderBy(t.googleCalendars.sortOrder).all().map((c) => ({ id: c.id, name: c.name, on: c.on })) : [],
      writeBack: a?.writeBack ?? false,
      syncedAt: a?.syncedAt ?? null,
      note: a?.note ?? null,
    };
  }

  /** One at a time, in order: syncs, write-back, and disconnecting never overlap. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private async token(): Promise<string> {
    const a = this.account();
    if (!this.config || !a?.refreshToken) throw new SignInGone('not connected');
    if (this.access && this.access.until > Date.now() + 60_000) return this.access.token;
    const r = await this.api.refresh(this.config, a.refreshToken);
    this.access = { token: r.accessToken, until: Date.now() + r.expiresIn * 1000 };
    return r.accessToken;
  }

  /** Finishes Google sign-in: keeps the lasting sign-in, then syncs. */
  async connect(code: string, redirectUri: string): Promise<GoogleSyncResult | null> {
    if (!this.config) throw new GoogleError('Google Calendar isn’t set up on the server');
    const r = await this.api.exchange(this.config, code, redirectUri);
    const refreshToken = r.refreshToken ?? this.account()?.refreshToken ?? null;
    if (!refreshToken) throw new GoogleError('Google didn’t give a lasting sign-in');
    this.access = { token: r.accessToken, until: Date.now() + r.expiresIn * 1000 };
    const row = { id: 1, refreshToken, connectedAt: iso(this.now()), note: null };
    this.db.insert(t.googleAccount).values(row).onConflictDoUpdate({ target: t.googleAccount.id, set: row }).run();
    return this.sync();
  }

  /** Reads your calendars and their events, then sends planned blocks when write-back is on. */
  sync(): Promise<GoogleSyncResult | null> {
    return this.serial(() => this.doSync());
  }

  private async doSync(): Promise<GoogleSyncResult | null> {
    const a = this.account();
    if (!this.config || !a?.refreshToken) return null;
    try {
      const token = await this.token();
      const list = await this.api.calendars(token);
      this.saveCalendars(list, a.plannerCalendarId);
      const now = this.now();
      const on = this.db.select().from(t.googleCalendars).where(eq(t.googleCalendars.on, true)).all();
      let events = 0;
      for (const cal of on) {
        const raw = await this.api.events(token, cal.id, iso(now.minus({ days: READ_BACK_DAYS })), iso(now.plus({ days: READ_AHEAD_DAYS })));
        const rows = raw.flatMap((r) => {
          const e = fromGoogle(r);
          return e ? [{ calendarId: cal.id, ...e }] : [];
        });
        // The same event id updates in place: the calendar's events are replaced together.
        this.db.transaction((tx) => {
          tx.delete(t.googleEvents).where(eq(t.googleEvents.calendarId, cal.id)).run();
          for (const row of rows) tx.insert(t.googleEvents).values(row).onConflictDoNothing().run();
        });
        events += rows.length;
      }
      const sent = a.writeBack ? await this.push(token, list.map((c) => c.id)) : 0;
      this.note(`${plural(events, 'event')} from ${plural(on.length, 'calendar')}${a.writeBack ? `, ${plural(sent, 'change')} sent to the Planner calendar` : ''}`);
      return { events, calendars: on.length, sent, error: null };
    } catch (e) {
      return { events: 0, calendars: 0, sent: 0, error: this.failed(e) };
    }
  }

  /** Notes why a sync failed and returns the reason. A sign-in Google ended is dropped, so Settings asks to connect again. */
  private failed(e: unknown): string {
    let reason = e instanceof GoogleError ? e.message : 'couldn’t reach Google';
    if (e instanceof GoogleError && e.status === 401) this.access = null;
    if (e instanceof SignInGone) {
      this.access = null;
      this.db.update(t.googleAccount).set({ refreshToken: null }).where(eq(t.googleAccount.id, 1)).run();
      reason = 'Google ended the sign-in. Connect again';
    }
    this.note(`Couldn’t sync: ${reason}`);
    return reason;
  }

  /** Keeps the calendar list in step with Google's. New calendars start on when Google shows them. The Planner calendar isn't read. */
  private saveCalendars(list: GoogleCalendarRaw[], plannerId: string | null) {
    this.db.transaction((tx) => {
      const known = new Map(tx.select().from(t.googleCalendars).all().map((c) => [c.id, c]));
      const shown = list.filter((c) => c.id !== plannerId);
      shown.forEach((c, i) => {
        const row = {
          id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary, sortOrder: c.primary ? -1 : i,
          on: known.get(c.id)?.on ?? (!!c.primary || !!c.selected),
        };
        tx.insert(t.googleCalendars).values(row).onConflictDoUpdate({ target: t.googleCalendars.id, set: row }).run();
      });
      const ids = new Set(shown.map((c) => c.id));
      const goneIds = [...known.keys()].filter((id) => !ids.has(id));
      if (goneIds.length) tx.delete(t.googleCalendars).where(inArray(t.googleCalendars.id, goneIds)).run();
      const primary = list.find((c) => c.primary);
      if (primary) tx.update(t.googleAccount).set({ email: primary.id }).where(eq(t.googleAccount.id, 1)).run();
    });
  }

  /** Planned blocks as sent to Google: tasks, "Quick things", and events from yesterday to a month ahead. */
  private blocksToSend() {
    const now = this.now();
    const from = now.minus({ days: SEND_BACK_DAYS });
    const to = now.plus({ days: SEND_AHEAD_DAYS });
    const tasks = new Map(this.db.select().from(t.tasks).all().map((x) => [x.id, x]));
    const quick = this.db.select().from(t.quickItems).orderBy(t.quickItems.sortOrder).all();
    const send: PushBlock[] = [];
    const keep = new Set<string>();
    for (const b of this.db.select().from(t.blocks).all()) {
      if (b.kind === 'open') continue;
      const start = utc(b.startAt);
      if (start.plus({ minutes: b.durationMinutes }) < from || start > to) {
        keep.add(b.id);
        continue;
      }
      const task = b.taskId ? tasks.get(b.taskId) : undefined;
      const items = b.kind === 'quick' ? quick.filter((q) => q.blockId === b.id).flatMap((q) => tasks.get(q.taskId) ?? []) : [];
      if (b.kind === 'quick' && !items.length) continue;
      send.push({
        blockId: b.id,
        title: b.kind === 'quick' ? `Quick things: ${items.map((x) => x.title).join(', ')}` : task?.title ?? b.title ?? 'Event',
        startAt: b.startAt, durationMinutes: b.durationMinutes, location: b.location,
        done: task ? !!task.doneAt : b.kind === 'quick' ? items.every((x) => x.doneAt) : b.done,
        // Events you made are yours; only task blocks can be penciled in.
        pinned: b.pinned || b.kind === 'event', reason: b.reason,
      });
    }
    return { send, keep };
  }

  /** Makes the Planner calendar match the planned blocks. Each change is saved as it goes, so a failure partway never duplicates. */
  private async push(token: string, calendarIds: string[]): Promise<number> {
    let calId = this.account()?.plannerCalendarId ?? null;
    if (!calId || !calendarIds.includes(calId)) {
      // Missing (first time, or deleted in Google): make it, and forget what was sent to the old one.
      calId = await this.api.createCalendar(token, PLANNER_CALENDAR, getSettings(this.db).homeTimeZone);
      this.db.update(t.googleAccount).set({ plannerCalendarId: calId }).where(eq(t.googleAccount.id, 1)).run();
      this.db.delete(t.googlePushed).run();
    }
    const { send, keep } = this.blocksToSend();
    const plan = writeBackPlan(send, this.db.select().from(t.googlePushed).all(), keep);
    for (const c of plan.create) {
      const eventId = await this.api.insertEvent(token, calId, c.body);
      this.db.insert(t.googlePushed).values({ blockId: c.blockId, eventId, sent: c.sent }).run();
    }
    for (const u of plan.update) {
      let eventId = u.eventId;
      try {
        await this.api.updateEvent(token, calId, u.eventId, u.body);
      } catch (e) {
        // Deleted in Google: send it again.
        if (!gone(e)) throw e;
        eventId = await this.api.insertEvent(token, calId, u.body);
      }
      this.db.update(t.googlePushed).set({ eventId, sent: u.sent }).where(eq(t.googlePushed.blockId, u.blockId)).run();
    }
    for (const r of plan.remove) {
      await this.api.deleteEvent(token, calId, r.eventId);
      this.db.delete(t.googlePushed).where(eq(t.googlePushed.blockId, r.blockId)).run();
    }
    return plan.create.length + plan.update.length + plan.remove.length;
  }

  /** Removes everything write-back sent. Used when it's turned off and when disconnecting. */
  private async unpush(token: string) {
    const calId = this.account()?.plannerCalendarId;
    for (const p of this.db.select().from(t.googlePushed).all()) {
      if (calId) await this.api.deleteEvent(token, calId, p.eventId);
      this.db.delete(t.googlePushed).where(eq(t.googlePushed.blockId, p.blockId)).run();
    }
  }

  /** Which calendars to read, and write-back on or off. Turning a calendar off drops its events right away. */
  async update(input: { calendars?: Record<string, boolean>; writeBack?: boolean }): Promise<GoogleStatus> {
    const a = this.account();
    if (!a) return this.status();
    let read = false;
    for (const [id, on] of Object.entries(input.calendars ?? {})) {
      const cal = this.db.select().from(t.googleCalendars).where(eq(t.googleCalendars.id, id)).get();
      if (!cal || cal.on === on) continue;
      this.db.update(t.googleCalendars).set({ on }).where(eq(t.googleCalendars.id, id)).run();
      if (!on) this.db.delete(t.googleEvents).where(eq(t.googleEvents.calendarId, id)).run();
      read ||= on;
    }
    if (input.writeBack !== undefined && input.writeBack !== a.writeBack) {
      this.db.update(t.googleAccount).set({ writeBack: input.writeBack }).where(eq(t.googleAccount.id, 1)).run();
      if (input.writeBack) read = true;
      else {
        await this.serial(async () => {
          try {
            await this.unpush(await this.token());
            this.note('Took planned blocks off the Planner calendar');
          } catch (e) {
            this.failed(e);
          }
        });
      }
    }
    if (read) await this.sync();
    return this.status();
  }

  /** Takes write-back's events off Google, ends the sign-in, and forgets the account and its events. */
  disconnect(): Promise<void> {
    return this.serial(async () => {
      const a = this.account();
      if (!a) return;
      if (a.refreshToken && this.config) {
        try {
          await this.unpush(await this.token());
        } catch {
          // Best effort: disconnecting still goes ahead.
        }
        await this.api.revoke(a.refreshToken).catch(() => {});
      }
      this.access = null;
      this.db.transaction((tx) => {
        tx.delete(t.googlePushed).run();
        tx.delete(t.googleEvents).run();
        tx.delete(t.googleCalendars).run();
        tx.delete(t.googleAccount).run();
      });
    });
  }

  /** After a change in the app: with write-back on, sync a little later. */
  soon() {
    if (!this.account()?.writeBack) return;
    if (this.soonTimer) clearTimeout(this.soonTimer);
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null;
      void this.sync().catch(() => console.warn('Google sync failed'));
    }, SOON_MS);
  }

  /** Syncs on start and every 15 minutes. Failures are noted, never thrown. */
  start(): () => void {
    const tick = () => void this.sync().catch(() => console.warn('Google sync failed'));
    tick();
    const id = setInterval(tick, GOOGLE_EVERY_MS);
    return () => clearInterval(id);
  }
}

/** Where Google sends you back: set in .env, or this server's own address (Caddy passes the real one). */
function redirectUri(c: Context, config: GoogleConfig): string {
  if (config.redirectUri) return config.redirectUri;
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || url.host;
  return `${proto}://${host}/api/google/callback`;
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function registerGoogle(app: Hono, google: GoogleService, secure: boolean) {
  app.get('/api/google', (c) => c.json(google.status()));

  /** The Connect button: off to Google's sign-in, with a one-time state so the answer can be trusted. */
  app.get('/api/google/connect', (c) => {
    if (!google.config) return c.redirect('/?google=not-set-up');
    const state = randomBytes(24).toString('base64url');
    setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure, sameSite: 'Lax', path: '/api/google', maxAge: 10 * 60 });
    return c.redirect(google.api.authUrl(google.config, redirectUri(c, google.config), state));
  });

  /** Google sends you back here. The page then says how it went. */
  app.get('/api/google/callback', async (c) => {
    const want = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: '/api/google', secure });
    const { code, state, error } = c.req.query();
    if (error) return c.redirect('/?google=denied');
    if (!google.config || !code || !state || !want || !same(state, want)) return c.redirect('/?google=failed');
    try {
      const r = await google.connect(code, redirectUri(c, google.config));
      return c.redirect(r?.error ? '/?google=sync-failed' : '/?google=connected');
    } catch {
      return c.redirect('/?google=failed');
    }
  });

  app.patch('/api/google', async (c) => c.json(await google.update(await readBody(c, GooglePatchSchema))));

  /** The Sync now button. */
  app.post('/api/google/sync', async (c) => {
    const r = await google.sync();
    return c.json<GoogleSyncResult>(r ?? { events: 0, calendars: 0, sent: 0, error: 'Google Calendar isn’t connected' });
  });

  app.post('/api/google/disconnect', async (c) => {
    await google.disconnect();
    return c.json(google.status());
  });
}
