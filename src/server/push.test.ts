import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PushState, PushTest } from '../shared/api';
import { createApp } from './app';
import { hashPassword } from './auth';
import { openDb, type Db } from './db/client';
import { seed } from './db/seed';
import * as t from './db/schema';
import { pushFromEnv, sendDue, type Payload, type SendPush } from './push';

const CHI = 'America/Chicago';
const chi = (s: string) => DateTime.fromISO(s, { zone: CHI });
const SUB = { endpoint: 'https://push.example.com/send/abc', keys: { p256dh: 'BPk', auth: 'au' }, zone: CHI };

let db: Db;
let clock: DateTime;
let sent: { endpoint: string; payload: Payload }[];
let failWith: number | null;
let app: ReturnType<typeof createApp>;
const send: SendPush = async (sub, payload) => {
  if (failWith) throw Object.assign(new Error('push failed'), { statusCode: failWith });
  sent.push({ endpoint: sub.endpoint, payload });
};

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  clock = chi('2026-10-02T12:20');
  sent = [];
  failWith = null;
  app = createApp({ db, now: () => clock, push: { publicKey: 'PUBLIC', send } });
});

async function call<T>(method: string, path: string, body?: unknown, on = app) {
  const res = await on.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

describe('web push (spec §13, §14)', () => {
  it('gives the public key and keeps one subscription per device', async () => {
    expect((await call<PushState>('GET', '/api/push')).body).toEqual({ publicKey: 'PUBLIC', devices: 0 });
    expect((await call<PushState>('PUT', '/api/push/subscription', SUB)).body.devices).toBe(1);
    // The same device again (the app opening in New York) updates its zone instead of adding one.
    await call('PUT', '/api/push/subscription', { ...SUB, zone: 'America/New_York' });
    const rows = db.select().from(t.pushSubscriptions).all();
    expect(rows.map((r) => [r.endpoint, r.zone])).toEqual([[SUB.endpoint, 'America/New_York']]);
    expect((await call<PushState>('DELETE', '/api/push/subscription', { endpoint: SUB.endpoint })).body.devices).toBe(0);
  });

  it('refuses a subscription that isn’t an https push address', async () => {
    expect((await call('PUT', '/api/push/subscription', { ...SUB, endpoint: 'http://push.example.com/x' })).status).toBe(400);
    expect((await call('PUT', '/api/push/subscription', { ...SUB, zone: 'Mars/Base' })).status).toBe(400);
  });

  it('sends what’s due once, to every device', async () => {
    await call('PUT', '/api/push/subscription', SUB);
    await call('PUT', '/api/push/subscription', { ...SUB, endpoint: 'https://push.example.com/send/phone' });
    const notes = await sendDue(db, clock, send);
    // Friday at 12:20pm: math at 12:30. The morning summary (9:15) is long past, so it isn't sent late.
    expect(notes.map((n) => n.title)).toEqual(['MATH 15910 lecture in 10 minutes']);
    expect(sent.map((s) => [s.endpoint.split('/').pop(), s.payload.title, s.payload.body])).toEqual([
      ['abc', 'MATH 15910 lecture in 10 minutes', 'Ryerson Phys Lab 255'],
      ['phone', 'MATH 15910 lecture in 10 minutes', 'Ryerson Phys Lab 255'],
    ]);
    expect(sent[0]!.payload.url).toBe('/');
    // A minute later, nothing new.
    expect(await sendDue(db, clock.plus({ minutes: 1 }), send)).toEqual([]);
    expect(sent).toHaveLength(2);
  });

  it('sends nothing without a device, and follows the settings', async () => {
    expect(await sendDue(db, clock, send)).toEqual([]);
    await call('PUT', '/api/push/subscription', SUB);
    await call('PATCH', '/api/settings', { notify: { classes: false } });
    expect(await sendDue(db, clock, send)).toEqual([]);
  });

  it('uses the zone of the device that opened the app last when the setting is automatic', async () => {
    await call('PUT', '/api/push/subscription', { ...SUB, zone: 'America/New_York' });
    await call('PATCH', '/api/settings', { notify: { planTomorrow: true } });
    // Bedtime 12am in New York is 11pm there, 10pm in Chicago.
    const notes = await sendDue(db, chi('2026-10-02T22:00'), send);
    expect(notes.map((n) => n.title)).toEqual(['Plan tomorrow']);
  });

  it('forgets a device whose subscription is gone', async () => {
    await call('PUT', '/api/push/subscription', SUB);
    failWith = 410;
    await sendDue(db, clock, send);
    expect(db.select().from(t.pushSubscriptions).all()).toEqual([]);
  });

  it('the test button sends to every device and says how many', async () => {
    expect((await call<PushTest>('POST', '/api/push/test')).body).toEqual({ sent: 0, failed: 0 });
    await call('PUT', '/api/push/subscription', SUB);
    expect((await call<PushTest>('POST', '/api/push/test')).body).toEqual({ sent: 1, failed: 0 });
    expect(sent[0]!.payload.title).toBe('Test notification');
    failWith = 500;
    expect((await call<PushTest>('POST', '/api/push/test')).body).toEqual({ sent: 0, failed: 1 });
    // A server error doesn't mean the device is gone.
    expect(db.select().from(t.pushSubscriptions).all()).toHaveLength(1);
  });

  it('without push keys the API says so, and it needs sign-in like everything else', async () => {
    const plain = createApp({ db });
    expect((await call<PushState>('GET', '/api/push', undefined, plain)).body.publicKey).toBeNull();
    const locked = createApp({ db, push: { publicKey: 'PUBLIC', send }, auth: { passwordHash: hashPassword('a long password'), secret: 'x'.repeat(40), secure: true } });
    expect((await call('GET', '/api/push', undefined, locked)).status).toBe(401);
    expect((await call('POST', '/api/push/test', undefined, locked)).status).toBe(401);
  });

  it('reads the keys from .env', () => {
    expect(pushFromEnv({})).toBeUndefined();
    expect(pushFromEnv({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'https://planner.example.com' }))
      .toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'https://planner.example.com' });
  });
});
