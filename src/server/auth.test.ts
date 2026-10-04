import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthState } from '../shared/api';
import { createApp } from './app';
import {
  authFromEnv,
  COOKIE,
  hashPassword,
  makeToken,
  MAX_FAILURES,
  readToken,
  SESSION_DAYS,
  setEnvLine,
  verifyPassword,
} from './auth';
import { openDb } from './db/client';
import { seed } from './db/seed';
import { serveWeb } from './web';

const PASSWORD = 'correct horse battery';
const SECRET = 'a'.repeat(43);
const HASH = hashPassword(PASSWORD);
const DAY = 24 * 60 * 60 * 1000;

describe('passwords and tokens', () => {
  it('checks a password against its hash, with a fresh salt each time', () => {
    expect(verifyPassword(PASSWORD, HASH)).toBe(true);
    expect(verifyPassword('wrong', HASH)).toBe(false);
    expect(hashPassword(PASSWORD)).not.toBe(HASH);
    expect(verifyPassword(PASSWORD, 'not-a-hash')).toBe(false);
  });

  it('accepts its own token until it expires, and nothing forged', () => {
    const now = Date.UTC(2026, 9, 3);
    const token = makeToken(SECRET, now);
    expect(readToken(token, SECRET, now)).toBe(now + SESSION_DAYS * DAY);
    expect(readToken(token, SECRET, now + SESSION_DAYS * DAY)).toBeNull();
    expect(readToken(token, 'b'.repeat(43), now)).toBeNull();
    const [, , sig] = token.split('.');
    expect(readToken(`v1.${now + 1000 * DAY}.${sig}`, SECRET, now)).toBeNull();
    expect(readToken(undefined, SECRET, now)).toBeNull();
    expect(readToken('garbage', SECRET, now)).toBeNull();
  });
});

describe('authFromEnv', () => {
  it('is off on localhost without settings, and required in production', () => {
    expect(authFromEnv({})).toBeUndefined();
    expect(() => authFromEnv({ NODE_ENV: 'production' })).toThrow(/set-password/);
  });

  it('needs both settings and a long secret', () => {
    expect(() => authFromEnv({ AUTH_PASSWORD_HASH: HASH })).toThrow(/both/);
    expect(() => authFromEnv({ AUTH_PASSWORD_HASH: HASH, SESSION_SECRET: 'short' })).toThrow(/too short/);
    expect(authFromEnv({ AUTH_PASSWORD_HASH: HASH, SESSION_SECRET: SECRET, NODE_ENV: 'production' }))
      .toEqual({ passwordHash: HASH, secret: SECRET, secure: true });
  });
});

describe('setEnvLine', () => {
  it('replaces a line that’s there and adds one that isn’t, leaving the rest alone', () => {
    const env = 'ANTHROPIC_MODEL=x\nSESSION_SECRET=old\n';
    expect(setEnvLine(env, 'SESSION_SECRET', 'new')).toBe('ANTHROPIC_MODEL=x\nSESSION_SECRET=new\n');
    expect(setEnvLine('A=1', 'B', '2')).toBe('A=1\nB=2\n');
    expect(setEnvLine('', 'B', '$2')).toBe('B=$2\n');
  });
});

describe('sign-in on the API', () => {
  let clock: DateTime;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const db = openDb(':memory:');
    seed(db);
    clock = DateTime.fromISO('2026-10-03T15:00', { zone: 'America/Chicago' });
    app = createApp({ db, now: () => clock, auth: { passwordHash: HASH, secret: SECRET, secure: true } });
  });

  const signIn = (password: string, ip = '203.0.113.5') =>
    app.request('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ password }),
    });
  const cookieOf = (res: Response) => res.headers.get('set-cookie')?.match(new RegExp(`${COOKIE}=([^;]+)`))?.[1];
  const withCookie = (token: string) => ({ headers: { cookie: `${COOKIE}=${token}` } });

  it('keeps every planner path closed without a sign-in, except health and the sign-in itself', async () => {
    expect((await app.request('/api/day')).status).toBe(401);
    expect((await app.request('/api/tasks', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/api/health')).status).toBe(200);
    expect(await (await app.request('/api/auth')).json()).toEqual<AuthState>({ required: true, signedIn: false });
  });

  it('signs in with the right password and sets a secure, HTTP-only cookie', async () => {
    expect((await signIn('wrong')).status).toBe(401);
    const res = await signIn(PASSWORD);
    expect(res.status).toBe(200);
    const header = res.headers.get('set-cookie')!;
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/SameSite=Lax/);
    const token = cookieOf(res)!;
    expect((await app.request('/api/day', withCookie(token))).status).toBe(200);
    expect(await (await app.request('/api/auth', withCookie(token))).json()).toEqual<AuthState>({ required: true, signedIn: true });
  });

  it('renews a sign-in that’s in use, and lets an unused one run out', async () => {
    const token = cookieOf(await signIn(PASSWORD))!;
    // The same day: no new cookie.
    expect((await app.request('/api/day', withCookie(token))).headers.get('set-cookie')).toBeNull();
    clock = clock.plus({ days: 2 });
    const renewed = cookieOf(await app.request('/api/day', withCookie(token)));
    expect(renewed).toBeTruthy();
    clock = clock.plus({ days: SESSION_DAYS - 1 });
    expect((await app.request('/api/day', withCookie(token))).status).toBe(401);
    expect((await app.request('/api/day', withCookie(renewed!))).status).toBe(200);
  });

  it('makes an address wait after too many wrong passwords, even for the right one', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect((await signIn('wrong')).status).toBe(401);
    expect((await signIn(PASSWORD)).status).toBe(429);
    // Another address isn't blocked.
    expect((await signIn(PASSWORD, '198.51.100.7')).status).toBe(200);
    clock = clock.plus({ minutes: 16 });
    expect((await signIn(PASSWORD)).status).toBe(200);
  });

  it('signs out by clearing the cookie', async () => {
    const res = await app.request('/api/auth/sign-out', { method: 'POST' });
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${COOKIE}=;`));
  });

  it('stays open on localhost without a password set', async () => {
    const open = createApp({ db: openDb(':memory:') });
    expect((await open.request('/api/day')).status).toBe(200);
    expect(await (await open.request('/api/auth')).json()).toEqual<AuthState>({ required: false, signedIn: true });
  });
});

describe('serveWeb', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planner-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Planner</title>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'sw.js'), '// sw');
  const app = new Hono();
  app.get('/api/health', (c) => c.json({ ok: true }));
  serveWeb(app, dir);

  it('serves built files, keeping hashed assets and rechecking the rest', async () => {
    const asset = await app.request('/assets/app-abc123.js');
    expect(await asset.text()).toBe('console.log(1)');
    expect(asset.headers.get('cache-control')).toMatch(/immutable/);
    const sw = await app.request('/sw.js');
    expect(await sw.text()).toBe('// sw');
    expect(sw.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers any page with index.html, but not unknown API paths', async () => {
    const page = await app.request('/week');
    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/<title>Planner/);
    expect((await app.request('/api/nope')).status).toBe(404);
    expect((await app.request('/api/health')).status).toBe(200);
  });
});
