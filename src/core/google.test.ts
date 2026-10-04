import { describe, expect, it } from 'vitest';
import { allDayOn, fromGoogle, pushBody, writeBackPlan, type PushBlock } from './google';

// Google Calendar (spec §14): reading events, and what write-back sends.

describe('fromGoogle', () => {
  it('stores a timed event as UTC moments', () => {
    const e = fromGoogle({
      id: 'a', summary: ' Dinner with Sam ', location: 'Medici', htmlLink: 'https://calendar.google.com/x',
      start: { dateTime: '2026-10-06T18:30:00-05:00' }, end: { dateTime: '2026-10-06T20:00:00-05:00' },
    });
    expect(e).toEqual({
      eventId: 'a', title: 'Dinner with Sam', location: 'Medici', link: 'https://calendar.google.com/x', busy: true,
      startAt: '2026-10-06T23:30:00Z', endAt: '2026-10-07T01:00:00Z', startDate: null, endDate: null,
    });
  });

  it('keeps all-day events as days, with the end day not included', () => {
    const e = fromGoogle({ id: 'b', summary: 'Fall break', start: { date: '2026-10-08' }, end: { date: '2026-10-10' } })!;
    expect([e.startDate, e.endDate, e.startAt]).toEqual(['2026-10-08', '2026-10-10', null]);
    expect(['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'].map((d) => allDayOn(e, d))).toEqual([false, true, true, false]);
  });

  it('leaves out cancelled and declined events, and marks "Free" ones as not busy', () => {
    const at = { start: { dateTime: '2026-10-06T18:00:00Z' }, end: { dateTime: '2026-10-06T19:00:00Z' } };
    expect(fromGoogle({ id: 'c', status: 'cancelled', ...at })).toBeNull();
    expect(fromGoogle({ id: 'd', attendees: [{ self: true, responseStatus: 'declined' }], ...at })).toBeNull();
    expect(fromGoogle({ id: 'e', transparency: 'transparent', ...at })!.busy).toBe(false);
    expect(fromGoogle({ id: 'f', ...at })!.title).toBe('(No title)');
    expect(fromGoogle({ id: 'g' })).toBeNull();
  });
});

describe('write-back', () => {
  const block = (over: Partial<PushBlock> = {}): PushBlock => ({
    blockId: 'b1', title: 'Read The Muqaddimah', startAt: '2026-10-05T19:00:00Z', durationMinutes: 90,
    location: null, done: false, pinned: false, reason: 'Due Tue 2pm', ...over,
  });

  it('sends a block with its times, how it got there, and its id', () => {
    expect(pushBody(block())).toEqual({
      summary: 'Read The Muqaddimah', description: 'Penciled in by Planner: due Tue 2pm.',
      start: { dateTime: '2026-10-05T19:00:00Z' }, end: { dateTime: '2026-10-05T20:30:00Z' },
      extendedProperties: { private: { plannerBlockId: 'b1' } },
    });
    expect(pushBody(block({ done: true, pinned: true, location: 'Regenstein' }))).toMatchObject({
      summary: '✓ Read The Muqaddimah', location: 'Regenstein', description: 'Pinned in Planner.',
    });
  });

  it('creates new blocks, updates changed ones, leaves the same ones, and removes gone ones', () => {
    const same = block({ blockId: 'same' });
    const moved = block({ blockId: 'moved', startAt: '2026-10-05T21:00:00Z' });
    const pushed = [
      { blockId: 'same', eventId: 'e-same', sent: JSON.stringify(pushBody(same)) },
      { blockId: 'moved', eventId: 'e-moved', sent: JSON.stringify(pushBody(block({ blockId: 'moved' }))) },
      { blockId: 'gone', eventId: 'e-gone', sent: '{}' },
      { blockId: 'old', eventId: 'e-old', sent: '{}' },
    ];
    const plan = writeBackPlan([same, moved, block({ blockId: 'new' })], pushed, new Set(['old']));
    expect(plan.create.map((x) => x.blockId)).toEqual(['new']);
    expect(plan.update.map((x) => [x.blockId, x.eventId, x.body.start.dateTime])).toEqual([['moved', 'e-moved', '2026-10-05T21:00:00Z']]);
    expect(plan.remove).toEqual([{ blockId: 'gone', eventId: 'e-gone' }]);
  });
});
