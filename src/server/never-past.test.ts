import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { AddResult, BlockItem, DayView, PlanResult } from '../shared/api';
import type { ParsedItem } from '../shared/parsed';
import type { SortChunk } from './ai';
import { createApp } from './app';
import { openDb } from './db/client';
import { seed } from './db/seed';

// Never in the past (spec §10): new items from the add box, the Plan button, and automatic
// scheduling. Between midnight and 4am, "today" means the calendar day that just started.

const CHI = 'America/Chicago';
/** Saturday, October 3, 2026 at 12:47am: still Friday night (the planner day is Oct 2). */
const AFTER_MIDNIGHT = DateTime.fromISO('2026-10-03T00:47', { zone: CHI });
/** Friday, October 2, 2026 at 5:30pm. */
const FRI_EVENING = DateTime.fromISO('2026-10-02T17:30', { zone: CHI });

function setup(now: DateTime, reply?: Partial<ParsedItem>[]) {
  const db = openDb(':memory:');
  seed(db);
  const prompts: string[] = [];
  const sort: SortChunk = async (system) => {
    prompts.push(system);
    if (!reply) throw new Error('no AI in tests');
    return reply;
  };
  const app = createApp({ db, now: () => now, sort });
  const call = async <T,>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json()) as T;
  };
  return {
    prompts,
    call,
    add: (text: string) => call<{ item: AddResult }>('POST', `/api/add?tz=${CHI}`, { text }).then((r) => r.item),
    plan: (date: string) => call<{ item: PlanResult }>('POST', `/api/plan?tz=${CHI}`, { date }).then((r) => r.item),
    day: (date: string) => call<DayView>('GET', `/api/day/${date}?tz=${CHI}`),
  };
}
const local = (iso: string) => DateTime.fromISO(iso).setZone(CHI).toFormat('yyyy-MM-dd HH:mm');
const eventAt = (r: AddResult) => {
  const e = r.added.find((a) => a.kind === 'event');
  return e && e.kind === 'event' ? local(e.startAt) : null;
};

describe('the add box after midnight', () => {
  it('reads "2:30pm today" at 12:47am as that afternoon, with the local guess', async () => {
    const s = setup(AFTER_MIDNIGHT);
    expect(eventAt(await s.add('Meet Sam at 2:30pm today'))).toBe('2026-10-03 14:30');
  });

  it('moves a reply that put "2:30pm today" on the night before to that afternoon', async () => {
    const s = setup(AFTER_MIDNIGHT, [{ type: 'event', title: 'Meet Sam', date: '2026-10-02', start: '14:30' }]);
    expect(eventAt(await s.add('Meet Sam at 2:30pm today'))).toBe('2026-10-03 14:30');
  });

  it('keeps a reply that already says the day that just started', async () => {
    const s = setup(AFTER_MIDNIGHT, [{ type: 'event', title: 'Meet Sam', date: '2026-10-03', start: '14:30' }]);
    expect(eventAt(await s.add('Meet Sam at 2:30pm today'))).toBe('2026-10-03 14:30');
  });

  it('still reads late-night times as tonight', async () => {
    for (const date of ['2026-10-02', '2026-10-03']) {
      const s = setup(AFTER_MIDNIGHT, [{ type: 'event', title: 'Call home', date, start: '01:30' }]);
      expect(eventAt(await s.add('Call home at 1:30am')), date).toBe('2026-10-03 01:30');
    }
  });

  it('tells the AI which day "today" is', async () => {
    const s = setup(AFTER_MIDNIGHT, []);
    await s.add('Meet Sam at 2:30pm today');
    expect(s.prompts[0]).toContain('the calendar date is Saturday 2026-10-03');
    expect(s.prompts[0]).toContain('"2:30pm today" is 2026-10-03 at 14:30');
  });

  it('puts a deadline "today" on the day that just started', async () => {
    const s = setup(AFTER_MIDNIGHT, [
      { type: 'task', title: 'Hand in the form', due: { date: '2026-10-02', time: '14:00' } },
      { type: 'task', title: 'Pay rent', due: { date: '2026-10-02' } },
    ]);
    const { added } = await s.add('Hand in the form by 2pm today, pay rent today');
    const tasks = await s.call<{ title: string; dueAt: string | null; dueDate: string | null }[]>('GET', '/api/tasks');
    const find = (t: string) => tasks.find((x) => x.title === t)!;
    expect(added).toHaveLength(2);
    expect(local(find('Hand in the form').dueAt!)).toBe('2026-10-03 14:00');
    expect(find('Pay rent').dueDate).toBe('2026-10-03');
  });

  it('puts an event with no time "today" in the coming day’s Sometime lane', async () => {
    const s = setup(AFTER_MIDNIGHT, [{ type: 'event', title: 'Pick up the package', date: '2026-10-02' }]);
    expect((await s.add('pick up the package today')).added[0]).toMatchObject({ kind: 'sometime', date: '2026-10-03' });
  });
});

describe('the add box in the evening', () => {
  it('moves a time that has already passed today to its next occurrence', async () => {
    const s = setup(FRI_EVENING, [{ type: 'event', title: 'Call home', date: '2026-10-02', start: '15:00' }]);
    expect(eventAt(await s.add('call home at 3pm'))).toBe('2026-10-03 15:00');
  });

  it('leaves a time later today alone', async () => {
    const s = setup(FRI_EVENING, [{ type: 'event', title: 'Dinner', date: '2026-10-02', start: '19:00' }]);
    expect(eventAt(await s.add('dinner at 7'))).toBe('2026-10-02 19:00');
  });
});

describe('the planner never places anything before now', () => {
  const taskBlocks = (d: DayView) => d.schedule.filter((x): x is BlockItem => x.type === 'block' && x.kind === 'task');

  it('Plan places today’s tasks after now, in the evening', async () => {
    const s = setup(FRI_EVENING);
    const r = await s.plan('2026-10-02');
    expect(r.placed.length).toBeGreaterThan(0);
    for (const p of r.placed) expect(DateTime.fromISO(p.startAt) >= FRI_EVENING, p.title).toBe(true);
  });

  it('Plan after midnight places nothing in the past, on either day', async () => {
    const s = setup(AFTER_MIDNIGHT);
    expect((await s.plan('2026-10-02')).placed).toEqual([]);
    const sat = await s.plan('2026-10-03');
    expect(sat.placed.length).toBeGreaterThan(0);
    for (const p of sat.placed) expect(local(p.startAt) >= '2026-10-03 09:00', p.title).toBe(true);
  });

  it('automatic scheduling pencils new tasks in after now', async () => {
    const s = setup(FRI_EVENING);
    await s.call('PATCH', '/api/settings', { autoSchedule: true });
    await s.add('Call mom tomorrow\nGet razor (in the near future)');
    const blocks = [...taskBlocks(await s.day('2026-10-02')), ...taskBlocks(await s.day('2026-10-03'))];
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(DateTime.fromISO(b.startAt) >= FRI_EVENING, b.title ?? '').toBe(true);
  });
});
