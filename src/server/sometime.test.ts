import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DayView } from '../shared/api';
import type { ParsedItem } from '../shared/parsed';
import { createApp } from './app';
import { openDb } from './db/client';
import { seed } from './db/seed';

// The Sometime lane (spec §7) holds everything meant for the day that has no time yet, from five
// sources. A chip leaves the lane once it gets a time on the schedule.

const CHI = 'America/Chicago';
/** Friday, October 2, 2026 at 10am. */
const NOW = DateTime.fromISO('2026-10-02T10:00', { zone: CHI });

let app: ReturnType<typeof createApp>;
let clock: DateTime;
let reply: Partial<ParsedItem>[] | null;

beforeEach(() => {
  const db = openDb(':memory:');
  seed(db);
  clock = NOW;
  reply = null;
  app = createApp({ db, now: () => clock, sort: async () => { if (!reply) throw new Error('no AI in tests'); return reply; } });
});

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json()) as T;
}
const lane = async (date: string) => (await call<DayView>('GET', `/api/day/${date}?tz=${CHI}`)).sometime;
const titles = async (date: string) => (await lane(date)).map((s) => s.title);
const add = (text: string) => call('POST', `/api/add?tz=${CHI}`, { text });

describe('the Sometime lane', () => {
  it('shows a task dragged into it', async () => {
    await call('POST', '/api/drops?tz=America/Chicago', { action: 'commitTask', taskId: 'container', date: '2026-10-02' });
    expect(await lane('2026-10-02')).toEqual([expect.objectContaining({ taskId: 'container', due: false, rolledFrom: null })]);
  });

  it('shows a task the add box understood as "today" with no time', async () => {
    await add('Call the bank today');
    expect(await titles('2026-10-02')).toEqual(['Call the bank']);
    reply = [{ type: 'task', title: 'Email the TA', win: 'near', date: '2026-10-02' }];
    await add('email the TA today');
    expect(await titles('2026-10-02')).toEqual(['Call the bank', 'Email the TA']);
  });

  it('shows a day-only deadline due that day, without an ×', async () => {
    const { item } = await call<{ item: { id: string } }>('POST', '/api/tasks', { title: 'Pick up new parcel', window: 'near', dueDate: '2026-10-02' });
    expect(await lane('2026-10-02')).toEqual([expect.objectContaining({ taskId: item.id, title: 'Pick up new parcel', due: true })]);
    expect(await lane('2026-10-03')).toEqual([]);
    // A timed deadline isn't in the lane: it has its own line on the schedule.
    await call('POST', '/api/tasks', { title: 'Hand in the form', window: 'near', dueAt: '2026-10-02T21:00:00Z' });
    expect(await titles('2026-10-02')).toEqual(['Pick up new parcel']);
  });

  it('shows a task rolled over from an earlier day', async () => {
    await call('PUT', '/api/sometime/container', { date: '2026-10-01' });
    await call('POST', `/api/rollover?tz=${CHI}`);
    expect(await lane('2026-10-02')).toEqual([expect.objectContaining({ taskId: 'container', rolledFrom: '2026-10-01' })]);
  });

  it('shows an event with no time', async () => {
    reply = [{ type: 'event', title: 'Pick up the package', date: '2026-10-02' }];
    await add('pick up the package today');
    expect(await titles('2026-10-02')).toEqual(['Pick up the package']);
  });

  it('lets a chip go once it has a time on the schedule', async () => {
    const { item } = await call<{ item: { id: string } }>('POST', '/api/tasks', { title: 'Pick up new parcel', window: 'near', dueDate: '2026-10-02' });
    await call('PUT', '/api/sometime/container', { date: '2026-10-02' });
    expect(await titles('2026-10-02')).toEqual(['Clean the wooden container, store folders', 'Pick up new parcel']);
    await call('POST', `/api/drops?tz=${CHI}`, { action: 'placeTask', taskId: item.id, date: '2026-10-02', startMin: 13 * 60 });
    await call('POST', `/api/drops?tz=${CHI}`, { action: 'placeTask', taskId: 'container', date: '2026-10-02', startMin: 14 * 60 });
    expect(await lane('2026-10-02')).toEqual([]);
  });
});

describe('classes are never deadlines', () => {
  it('names a task due at a class’s start for the work, not the class', async () => {
    reply = [{ type: 'task', title: 'Review ECON 20010 discussion notes', win: 'week', short: 'ECON lecture', due: { date: '2026-10-05', time: '11:00' } }];
    await add('review econ discussion notes before the next lecture');
    const tasks = await call<{ title: string; shortName: string | null; dueAt: string | null }[]>('GET', '/api/tasks');
    expect(tasks.find((t) => t.title.startsWith('Review ECON'))).toMatchObject({ shortName: null, dueAt: '2026-10-05T16:00:00Z' });
  });

  it('shows a short name that names a class as the task’s title in the header and deadline lines', async () => {
    // Data from before the fix: a short name that only names the class.
    await call('POST', '/api/tasks', { title: 'Review ECON 20010 discussion notes', shortName: 'ECON lecture', window: 'week', dueAt: '2026-10-02T20:00:00Z' });
    const day = await call<DayView>('GET', `/api/day/2026-10-02?tz=${CHI}`);
    expect(day.header.nextDeadline?.name).toBe('Review ECON 20010 discussion notes');
    expect(day.nextDeadlineNames).toEqual(['Review ECON 20010 discussion notes']);
    expect(day.deadlines.map((d) => d.name)).toContain('Review ECON 20010 discussion notes');
    expect(day.deadlines.map((d) => d.name)).not.toContain('ECON lecture');
  });

  it('gives no deadline to a task that only names a class meeting', async () => {
    reply = [{ type: 'task', title: 'ECON lecture', due: { date: '2026-10-05', time: '11:00' } }];
    await add('econ lecture monday 11');
    const tasks = await call<{ title: string; dueAt: string | null }[]>('GET', '/api/tasks');
    expect(tasks.find((t) => t.title === 'ECON lecture')?.dueAt).toBeNull();
  });
});
