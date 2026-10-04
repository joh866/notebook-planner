import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AuthState } from '../shared/api';

// One-person sign-in (spec §3). The password is kept only as a scrypt hash in .env, and a signed-in
// device holds a cookie signed with SESSION_SECRET. Nothing is stored in the database, so changing
// SESSION_SECRET signs every device out.

export interface AuthConfig {
  /** From `npm run set-password`: "scrypt:<salt>:<hash>", both base64url. */
  passwordHash: string;
  /** At least 32 random bytes. Signs the session cookie. */
  secret: string;
  /** Send the cookie over HTTPS only. On in production. */
  secure: boolean;
}

export const COOKIE = 'planner_session';
const DAY_MS = 24 * 60 * 60 * 1000;
/** A signed-in device stays signed in this long after its last visit. */
export const SESSION_DAYS = 90;
/** Wrong passwords allowed per address before it has to wait. */
export const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

const KEY_LEN = 32;
const b64 = (b: Buffer) => b.toString('base64url');

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt:${b64(salt)}:${b64(scryptSync(password, salt, KEY_LEN))}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  if (want.length !== KEY_LEN) return false;
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, 'base64url'), KEY_LEN), want);
}

export const newSecret = () => b64(randomBytes(32));

const sign = (payload: string, secret: string) => b64(createHmac('sha256', secret).update(payload).digest());

/** A session token: "v1.<expires ms>.<signature>". */
export function makeToken(secret: string, nowMs: number): string {
  const payload = `v1.${nowMs + SESSION_DAYS * DAY_MS}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** The token's expiry in ms, or null when it's forged, malformed, or expired. */
export function readToken(token: string | undefined, secret: string, nowMs: number): number | null {
  if (!token) return null;
  const at = token.lastIndexOf('.');
  if (at < 0) return null;
  const payload = token.slice(0, at);
  const given = Buffer.from(token.slice(at + 1), 'base64url');
  const want = Buffer.from(sign(payload, secret), 'base64url');
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  const [v, exp] = payload.split('.');
  const expires = Number(exp);
  if (v !== 'v1' || !Number.isFinite(expires) || expires <= nowMs) return null;
  return expires;
}

/** Paths that work without signing in. */
const OPEN = new Set(['/api/health', '/api/auth', '/api/auth/sign-in', '/api/auth/sign-out']);

const SignInSchema = z.object({ password: z.string().min(1).max(500) });

/**
 * Adds the sign-in routes and, when `config` is set, requires a session for every other /api path.
 * Without a config (local development and tests), everything stays open and /api/auth says so.
 */
export function registerAuth(app: Hono, config: AuthConfig | undefined, nowMs: () => number) {
  /** Wrong passwords per address: how many since `first`, and when a lock ends (0 when not locked). */
  const failures = new Map<string, { count: number; first: number; until: number }>();
  // Caddy sets X-Forwarded-For. The app only listens on 127.0.0.1 in production, so it can't be spoofed
  // from outside.
  const who = (h: string | undefined) => h?.split(',')[0]?.trim() || 'local';

  const issue = (c: Context) => {
    setCookie(c, COOKIE, makeToken(config!.secret, nowMs()), {
      httpOnly: true,
      secure: config!.secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
  };

  app.use('/api/*', async (c, next) => {
    if (!config || OPEN.has(c.req.path)) return next();
    const expires = readToken(getCookie(c, COOKIE), config.secret, nowMs());
    if (expires === null) return c.json({ error: 'Sign in first' }, 401);
    // Keep a device that's in use signed in: renew once a day.
    if (expires - nowMs() < (SESSION_DAYS - 1) * DAY_MS) issue(c);
    return next();
  });

  app.get('/api/auth', (c) => {
    const signedIn = !config || readToken(getCookie(c, COOKIE), config.secret, nowMs()) !== null;
    return c.json<AuthState>({ required: !!config, signedIn });
  });

  app.post('/api/auth/sign-in', async (c) => {
    if (!config) return c.json<AuthState>({ required: false, signedIn: true });
    const ip = who(c.req.header('x-forwarded-for'));
    const now = nowMs();
    let f = failures.get(ip);
    // A lock that ended, or tries spread out over more than the lock time, start counting again.
    if (f && (f.until ? f.until <= now : now - f.first > LOCK_MS)) f = undefined;
    if (f?.until) {
      const minutes = Math.ceil((f.until - now) / 60_000);
      return c.json({ error: `Too many tries. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` }, 429);
    }
    const parsed = SignInSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !verifyPassword(parsed.data.password, config.passwordHash)) {
      const count = (f?.count ?? 0) + 1;
      failures.set(ip, { count, first: f?.first ?? now, until: count >= MAX_FAILURES ? now + LOCK_MS : 0 });
      return c.json({ error: 'That password isn’t right.' }, 401);
    }
    failures.delete(ip);
    issue(c);
    return c.json<AuthState>({ required: true, signedIn: true });
  });

  app.post('/api/auth/sign-out', (c) => {
    deleteCookie(c, COOKIE, { path: '/', secure: config?.secure ?? false });
    return c.json<AuthState>({ required: !!config, signedIn: !config });
  });
}

/**
 * Reads the sign-in settings from the environment. Returns undefined when neither is set (local
 * development); throws when only one is, or when production has neither.
 */
export function authFromEnv(env: NodeJS.ProcessEnv): AuthConfig | undefined {
  const passwordHash = env.AUTH_PASSWORD_HASH?.trim();
  const secret = env.SESSION_SECRET?.trim();
  const production = env.NODE_ENV === 'production';
  if (!passwordHash && !secret) {
    if (production) throw new Error('Sign-in isn’t set up. Run `npm run set-password` on the server.');
    return undefined;
  }
  if (!passwordHash || !secret) throw new Error('.env needs both AUTH_PASSWORD_HASH and SESSION_SECRET. Run `npm run set-password`.');
  if (secret.length < 32) throw new Error('SESSION_SECRET is too short. Run `npm run set-password` to make a new one.');
  return { passwordHash, secret, secure: production };
}

/** Sets `name=value` in the text of a .env file, replacing that line if it's there. */
export function setEnvLine(text: string, name: string, value: string): string {
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, () => line);
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`;
}
