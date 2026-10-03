import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { loggedMinutes, sessionMinutes, trimmedEvents } from './sessions';

const NOW = DateTime.fromISO('2026-10-02T23:00:00Z', { zone: 'utc' });

describe('sessions', () => {
  it('counts whole minutes, and a running session up to now', () => {
    expect(sessionMinutes({ startAt: '2026-10-02T20:46:00Z', endAt: '2026-10-02T22:08:00Z' }, NOW)).toBe(82);
    expect(sessionMinutes({ startAt: '2026-10-02T22:20:00Z', endAt: null }, NOW)).toBe(40);
    expect(loggedMinutes([{ startAt: '2026-10-02T20:46:00Z', endAt: '2026-10-02T22:08:00Z' }, { startAt: '2026-10-02T22:20:00Z', endAt: null }], NOW)).toBe(122);
  });
});

describe('trimmedEvents', () => {
  // The RSO fair is 3–4pm Chicago (20:00–21:00Z). The reading starts at 3:46pm.
  const fair = { id: 'rso-fair', startAt: '2026-10-02T20:00:00Z', durationMinutes: 60 };

  it('ends an event that was going when you switched', () => {
    expect(trimmedEvents([fair], '2026-10-02T20:46:00Z')).toEqual([{ id: 'rso-fair', durationMinutes: 46 }]);
  });

  it('leaves events that ended before, or start after', () => {
    expect(trimmedEvents([fair], '2026-10-02T21:00:00Z')).toEqual([]);
    expect(trimmedEvents([fair], '2026-10-02T19:30:00Z')).toEqual([]);
  });
});
