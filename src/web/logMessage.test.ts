import { describe, expect, it } from 'vitest';
import type { LogResult } from '../shared/api';
import { logMessage } from './logMessage';

const CHI = 'America/Chicago';
const base: LogResult = {
  taskId: 'muqaddimah', title: 'Read The Muqaddimah', minutes: 82, done: true,
  session: { id: 's', taskId: 'muqaddimah', startAt: '2026-10-02T20:46:00Z', endAt: '2026-10-02T22:08:00Z' },
  block: { id: 'b', startAt: '2026-10-02T20:46:00Z', endAt: '2026-10-02T22:08:00Z' },
  trimmed: [{ id: 'rso-fair', title: 'RSO fair', endAt: '2026-10-02T20:46:00Z' }],
};

describe('logMessage', () => {
  it('says what was finished and every event it ended (spec §11)', () => {
    expect(logMessage(base, '2026-10-02', CHI)).toBe('Marked “Read The Muqaddimah” done, 3:46–5:08pm (82 min). Ended RSO fair at 3:46pm.');
  });

  it('says partial progress, and the day when it isn’t today', () => {
    const partial = { ...base, done: false, minutes: 40, block: null, trimmed: [], session: { ...base.session, endAt: '2026-10-02T21:26:00Z' } };
    expect(logMessage(partial, '2026-10-03', CHI)).toBe('Logged 40 min on “Read The Muqaddimah”, yesterday 3:46–4:26pm.');
  });
});
