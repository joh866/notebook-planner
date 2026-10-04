import { DateTime } from 'luxon';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleEventRaw, PushBody } from '../core/google';
import type { DayView, GoogleStatus, GoogleSyncResult, MonthView, WeekView } from '../shared/api';
import { createApp } from './app';
import { openDb, type Db } from './db/client';
import { seed } from './db/seed';
import * as t from './db/schema';
import { GoogleError, GoogleService, SignInGone, SOON_MS, type GoogleApi, type GoogleCalendarRaw } from './google';
import { planInputs } from './views';

// Google Calendar (spec §14), against a fake Google: connecting, reading events, and write-back.

const CHI = 'America/Chicago';
const NOW = DateTime.fromISO('2026-10-05T10:00', { zone: CHI });
const CONFIG = { clientId: 'client-id', clientSecret: 'client-secret' };
const REFRESH = 'refresh-token-secret';
const at = (date: string, hhmm: string) => DateTime.fromISO(`${date}T${hhmm}`, { zone: CHI }).toISO()!;

class FakeGoogle implements GoogleApi {
  calendarList: GoogleCalendarRaw[] = [
    { id: 'me@example.com', summary: 'me@example.com', primary: true, selected: true },
    { id: 'friends', summary: 'Friends', summaryOverride: 'Friends & family', selected: true },
    { id: 'holidays', summary: 'Holidays', selected: false },
  ];
  eventsBy: Record<string, GoogleEventRaw[]> = {
    'me@example.com': [
      { id: 'dinner', summary: 'Dinner with Sam', location: 'Medici on 57th, 1327 E 57th St', htmlLink: 'https://calendar.google.com/dinner',
        start: { dateTime: at('2026-10-05', '18:00') }, end: { dateTime: at('2026-10-05', '19:30') } },
      { id: 'focus', summary: 'Focus time', transparency: 'transparent', start: { dateTime: at('2026-10-05', '15:00') }, end: { dateTime: at('2026-10-05', '16:00') } },
      { id: 'break', summary: 'Fall break', start: { date: '2026-10-05' }, end: { date: '2026-10-07' } },
      { id: 'gone', status: 'cancelled', start: { dateTime: at('2026-10-05', '12:00') }, end: { dateTime: at('2026-10-05', '13:00') } },
    ],
    friends: [{ id: 'party', summary: 'Party', start: { dateTime: at('2026-10-06', '20:00') }, end: { dateTime: at('2026-10-06', '23:00') } }],
    holidays: [{ id: 'h', summary: 'A holiday', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } }],
  };
  planner = new Map<string, PushBody>();
  plannerId: string | null = null;
  refreshError: Error | null = null;
  revoked: string[] = [];
  read: string[] = [];
  calls = 0;

  authUrl = (_: unknown, redirectUri: string, state: string) => `https://accounts.example/auth?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  exchange = async (_: unknown, code: string) => {
    if (code !== 'good-code') throw new GoogleError('bad code', 400);
    return { accessToken: 'access-1', refreshToken: REFRESH, expiresIn: 3600 };
  };
  refresh = async () => {
    if (this.refreshError) throw this.refreshError;
    return { accessToken: 'access-2', expiresIn: 3600 };
  };
  revoke = async (token: string) => void this.revoked.push(token);
  calendars = async () => {
    this.calls++;
    return [...this.calendarList, ...(this.plannerId ? [{ id: this.plannerId, summary: 'Planner' }] : [])];
  };
  events = async (_: string, id: string) => {
    this.read.push(id);
    return this.eventsBy[id] ?? [];
  };
  createCalendar = async (_: string, name: string) => {
    this.plannerId = `cal-${name}`;
    return this.plannerId;
  };
  private n = 0;
  insertEvent = async (_: string, cal: string, body: PushBody) => {
    expect(cal).toBe(this.plannerId);
    const id = `ev${++this.n}`;
    this.planner.set(id, body);
    return id;
  };
  updateEvent = async (_: string, __: string, id: string, body: PushBody) => {
    if (!this.planner.has(id)) throw new GoogleError('gone', 410);
    this.planner.set(id, body);
  };
  deleteEvent = async (_: string, __: string, id: string) => void this.planner.delete(id);
}

let db: Db;
let fake: FakeGoogle;
let google: GoogleService;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  fake = new FakeGoogle();
  google = new GoogleService(db, CONFIG, fake, () => NOW);
  app = createApp({ db, now: () => NOW, google });
});
afterEach(() => vi.useRealTimers());

async function call<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(path, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, location: res.headers.get('location'), cookie: res.headers.get('set-cookie'), text: await res.text(), json: () => 0 as unknown as T };
}
const get = async <T>(path: string) => JSON.parse((await call('GET', path)).text) as T;
const status = () => get<GoogleStatus>('/api/google');
const day = (date = '2026-10-05') => get<DayView>(`/api/day/${date}?tz=${CHI}`);

/** Connect, the way the browser does it: off to Google, then back with the code and the same state. */
async function connect(code = 'good-code') {
  const go = await call('GET', '/api/google/connect', undefined, { host: 'planner.example.com', 'x-forwarded-proto': 'https' });
  const state = new URL(go.location!).searchParams.get('state')!;
  const cookie = go.cookie!.split(';')[0]!;
  return call('GET', `/api/google/callback?code=${code}&state=${state}`, undefined, { cookie });
}

describe('connecting', () => {
  it('says when the server has no Google client set up', async () => {
    app = createApp({ db, now: () => NOW });
    expect(await status()).toMatchObject({ configured: false, connected: false });
    expect((await call('GET', '/api/google/connect')).location).toBe('/?google=not-set-up');
  });

  it('goes to Google with a one-time state and this server’s address to come back to', async () => {
    const go = await call('GET', '/api/google/connect', undefined, { host: 'planner.example.com', 'x-forwarded-proto': 'https' });
    expect(go.status).toBe(302);
    const url = new URL(go.location!);
    expect(url.searchParams.get('redirect_uri')).toBe('https://planner.example.com/api/google/callback');
    expect(go.cookie).toMatch(/google_state=[\w-]{20,};.*HttpOnly/i);
  });

  it('turns away an answer without the matching state, and a refused one', async () => {
    expect((await call('GET', '/api/google/callback?code=good-code&state=forged', undefined, { cookie: 'google_state=other' })).location).toBe('/?google=failed');
    expect((await call('GET', '/api/google/callback?error=access_denied')).location).toBe('/?google=denied');
    expect((await connect('bad-code')).location).toBe('/?google=failed');
    expect((await status()).connected).toBe(false);
  });

  it('keeps the sign-in, picks the calendars Google shows, and syncs', async () => {
    expect((await connect()).location).toBe('/?google=connected');
    const s = await status();
    expect(s).toMatchObject({ configured: true, connected: true, expired: false, email: 'me@example.com', writeBack: false });
    expect(s.calendars).toEqual([
      { id: 'me@example.com', name: 'me@example.com', on: true },
      { id: 'friends', name: 'Friends & family', on: true },
      { id: 'holidays', name: 'Holidays', on: false },
    ]);
    expect(s.note).toBe('4 events from 2 calendars');
    expect(fake.read.sort()).toEqual(['friends', 'me@example.com']);
    // The token stays on the server.
    expect(JSON.stringify(s)).not.toContain(REFRESH);
    expect(db.select().from(t.googleAccount).get()!.refreshToken).toBe(REFRESH);
  });
});

describe('reading events', () => {
  beforeEach(async () => {
    await connect();
  });

  it('shows timed events in gray on their day, and all-day ones in the Sometime lane', async () => {
    const d = await day();
    const g = d.schedule.filter((x) => x.type === 'google');
    expect(g.map((x) => [x.title, x.startMin, x.endMin, x.busy, x.calendar])).toEqual([
      ['Focus time', 15 * 60, 16 * 60, false, 'me@example.com'],
      ['Dinner with Sam', 18 * 60, 19.5 * 60, true, 'me@example.com'],
    ]);
    expect(d.allDay.map((x) => x.title)).toEqual(['Fall break']);
    expect((await day('2026-10-06')).allDay.map((x) => x.title)).toEqual(['Fall break']);
    expect((await day('2026-10-07')).allDay).toEqual([]);
    const week = await get<WeekView>(`/api/week/2026-10-05?tz=${CHI}`);
    expect(week.days.find((x) => x.date === '2026-10-06')!.schedule.some((x) => x.type === 'google' && x.title === 'Party')).toBe(true);
    const month = await get<MonthView>(`/api/month/2026-10?tz=${CHI}`);
    expect(month.days.find((x) => x.date === '2026-10-05')!.google.map((x) => x.title)).toEqual(['Fall break', 'Focus time', 'Dinner with Sam']);
  });

  it('counts busy events as busy for the planner, and leaves "Free" ones open', () => {
    const busy = planInputs(db, NOW, CHI).day('2026-10-05').busy;
    expect(busy).toContainEqual([18 * 60, 19.5 * 60]);
    expect(busy).not.toContainEqual([15 * 60, 16 * 60]);
  });

  it('updates events on the next sync instead of adding them again, and drops deleted ones', async () => {
    fake.eventsBy['me@example.com'] = [{ ...fake.eventsBy['me@example.com']![0]!, summary: 'Dinner with Sam and Ali' }];
    const r = JSON.parse((await call('POST', '/api/google/sync')).text) as GoogleSyncResult;
    expect(r).toEqual({ events: 2, calendars: 2, sent: 0, error: null });
    const g = (await day()).schedule.filter((x) => x.type === 'google');
    expect(g.map((x) => x.title)).toEqual(['Dinner with Sam and Ali']);
  });

  it('turning a calendar off takes its events off right away; turning one on reads it', async () => {
    await call('PATCH', '/api/google', { calendars: { 'me@example.com': false, holidays: true } });
    const d = await day();
    expect(d.schedule.some((x) => x.type === 'google')).toBe(false);
    expect(d.allDay).toEqual([]);
    expect((await day('2026-10-12')).allDay.map((x) => x.title)).toEqual(['A holiday']);
    // The choice is kept on later syncs.
    await google.sync();
    expect((await status()).calendars.map((c) => c.on)).toEqual([false, true, true]);
  });

  it('asks to connect again when Google ends the sign-in', async () => {
    fake.refreshError = new SignInGone('Google ended the sign-in', 400);
    (google as unknown as { access: null }).access = null;
    const r = await google.sync();
    expect(r!.error).toBe('Google ended the sign-in. Connect again');
    expect(await status()).toMatchObject({ connected: true, expired: true });
    // Events already read stay until you connect again or disconnect.
    expect((await day()).schedule.some((x) => x.type === 'google')).toBe(true);
  });

  it('disconnecting ends the sign-in with Google and forgets the account and its events', async () => {
    await call('POST', '/api/google/disconnect');
    expect(fake.revoked).toEqual([REFRESH]);
    expect(await status()).toMatchObject({ connected: false, calendars: [] });
    expect((await day()).schedule.some((x) => x.type === 'google')).toBe(false);
  });
});

describe('write-back', () => {
  const block = async (body: Record<string, unknown>) => JSON.parse((await call('POST', '/api/blocks', body)).text) as { item: { id: string } };
  const sent = () => [...fake.planner.values()].map((b) => b.summary).sort();

  beforeEach(async () => {
    await connect();
  });

  it('is off until turned on, then sends planned blocks to a Planner calendar it makes, which isn’t read back', async () => {
    await block({ kind: 'task', taskId: 'muqaddimah', startAt: at('2026-10-05', '13:00'), durationMinutes: 90, pinned: false, reason: 'Due Tue 2pm' });
    await google.sync();
    expect(fake.plannerId).toBeNull();
    await call('PATCH', '/api/google', { writeBack: true });
    expect(fake.plannerId).toBe('cal-Planner');
    // Today's task block goes; the RSO fair on Oct 2 is before yesterday, so it's left alone.
    expect([...fake.planner.values()].map((b) => [b.summary, b.description, b.start.dateTime])).toEqual([
      ['Read The Muqaddimah', 'Penciled in by Planner: due Tue 2pm.', '2026-10-05T18:00:00Z'],
    ]);
    expect((await status()).calendars.map((c) => c.id)).not.toContain('cal-Planner');
    expect(fake.read).not.toContain('cal-Planner');
  });

  it('sends moves and removals, and only what changed', async () => {
    await call('PATCH', '/api/google', { writeBack: true });
    const ev = await block({ kind: 'event', title: 'Coffee chat', startAt: at('2026-10-06', '11:00'), durationMinutes: 30 });
    await google.sync();
    expect(sent()).toEqual(['Coffee chat']);
    expect((await google.sync())!.sent).toBe(0);
    await call('PATCH', `/api/blocks/${ev.item.id}`, { startAt: at('2026-10-06', '12:00') });
    expect((await google.sync())!.sent).toBe(1);
    expect([...fake.planner.values()][0]!.start.dateTime).toBe('2026-10-06T17:00:00Z');
    // Deleted in Google: sent again on the next change.
    fake.planner.clear();
    await call('PATCH', `/api/blocks/${ev.item.id}`, { done: true });
    await google.sync();
    expect(sent()).toEqual(['✓ Coffee chat']);
    await call('DELETE', `/api/blocks/${ev.item.id}`);
    await google.sync();
    expect(sent()).toEqual([]);
  });

  it('a change in the app goes out a little later on its own', async () => {
    await call('PATCH', '/api/google', { writeBack: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await block({ kind: 'event', title: 'Coffee chat', startAt: at('2026-10-06', '11:00'), durationMinutes: 30 });
    await block({ kind: 'event', title: 'Office hours', startAt: at('2026-10-06', '14:00'), durationMinutes: 60 });
    const before = fake.calls;
    await vi.advanceTimersByTimeAsync(SOON_MS - 1000);
    expect(sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    await google.sync();
    expect(fake.calls - before).toBe(2);
    expect(sent()).toEqual(['Coffee chat', 'Office hours']);
  });

  it('turning it off takes the blocks back off Google', async () => {
    await call('PATCH', '/api/google', { writeBack: true });
    await block({ kind: 'event', title: 'Coffee chat', startAt: at('2026-10-06', '11:00'), durationMinutes: 30 });
    await google.sync();
    await call('PATCH', '/api/google', { writeBack: false });
    expect(sent()).toEqual([]);
    expect(db.select().from(t.googlePushed).all()).toEqual([]);
  });
});
