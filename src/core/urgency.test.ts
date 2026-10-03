import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { compareByDeadline, daysLeft, deadlineMoment, dueTone, effectiveWindow, isOverdue, type UrgencyTask } from './urgency';

const CHI = 'America/Chicago';
const NY = 'America/New_York';
const at = (iso: string) => DateTime.fromISO(iso, { zone: CHI });
const NOW = at('2026-10-02T10:00');

// Seed deadlines (spec §16), as UTC.
const muqaddimah = '2026-10-06T19:00:00.000Z'; // Tue Oct 6, 2pm Chicago
const mathPset = '2026-10-07T16:00:00.000Z'; // Wed Oct 7, 11am
const econPset = '2026-10-09T17:00:00.000Z'; // Fri Oct 9, noon

const win = (t: UrgencyTask, now = NOW, zone = CHI) => effectiveWindow(t, now, zone, CHI);

describe('deadlines', () => {
  it('ends a day-only deadline at 4am the next morning', () => {
    expect(deadlineMoment({ dueDate: '2026-10-02' }, CHI)!.toISO()).toBe('2026-10-03T04:00:00.000-05:00');
    expect(deadlineMoment({ dueAt: muqaddimah }, CHI)!.toMillis()).toBe(Date.parse(muqaddimah));
    expect(deadlineMoment({}, CHI)).toBeNull();
  });

  it('counts days left from the planner day', () => {
    expect(daysLeft({ dueAt: muqaddimah }, '2026-10-02', CHI)).toBe(4);
    expect(daysLeft({ dueDate: '2026-10-03' }, '2026-10-02', CHI)).toBe(1);
    expect(daysLeft({}, '2026-10-02', CHI)).toBeNull();
  });
});

describe('isOverdue', () => {
  it('turns overdue at a timed deadline', () => {
    const t: UrgencyTask = { window: 'week', dueAt: muqaddimah };
    expect(isOverdue(t, at('2026-10-06T13:59'), CHI)).toBe(false);
    expect(isOverdue(t, at('2026-10-06T14:00'), CHI)).toBe(true);
  });

  it('turns overdue at 4am after a day-only deadline', () => {
    const t: UrgencyTask = { window: 'near', dueDate: '2026-10-02' };
    expect(isOverdue(t, at('2026-10-02T23:59'), CHI)).toBe(false);
    expect(isOverdue(t, at('2026-10-03T03:59'), CHI)).toBe(false);
    expect(isOverdue(t, at('2026-10-03T04:00'), CHI)).toBe(true);
  });

  it('is never overdue once done or without a deadline', () => {
    expect(isOverdue({ window: 'near', dueDate: '2026-09-01', doneAt: '2026-09-01T12:00:00Z' }, NOW, CHI)).toBe(false);
    expect(isOverdue({ window: 'near' }, NOW, CHI)).toBe(false);
  });

  it('handles the 25-hour Oct 31 night', () => {
    const t: UrgencyTask = { window: 'near', dueDate: '2026-10-31' };
    // 3:30am CST on Nov 1 is after the clocks fall back, but still before 4am.
    expect(isOverdue(t, DateTime.fromISO('2026-11-01T09:30:00Z'), CHI)).toBe(false);
    expect(isOverdue(t, DateTime.fromISO('2026-11-01T10:00:00Z'), CHI)).toBe(true);
  });
});

describe('effectiveWindow', () => {
  it('moves tasks up as deadlines approach', () => {
    expect(win({ window: 'soon', dueAt: econPset })).toBe('soon'); // 7 days away
    expect(win({ window: 'soon', dueAt: mathPset })).toBe('week'); // 5 days
    expect(win({ window: 'soon', dueAt: muqaddimah })).toBe('week'); // 4 days
    expect(win({ window: 'week', dueAt: muqaddimah }, at('2026-10-05T09:00'))).toBe('near'); // tomorrow
    expect(win({ window: 'week', dueAt: muqaddimah }, at('2026-10-06T09:00'))).toBe('near'); // today
    expect(win({ window: 'week', dueAt: muqaddimah }, at('2026-10-06T14:00'))).toBe('overdue');
  });

  it('moves up at 2 days, not 1', () => {
    expect(win({ window: 'soon', dueDate: '2026-10-04' })).toBe('week');
    expect(win({ window: 'soon', dueDate: '2026-10-03' })).toBe('near');
    expect(win({ window: 'ongoing', dueDate: '2026-10-08' })).toBe('week'); // 6 days
    expect(win({ window: 'ongoing', dueDate: '2026-10-09' })).toBe('ongoing'); // 7 days
  });

  it('never moves a Today-or-tomorrow task down to This week', () => {
    expect(win({ window: 'near', dueAt: muqaddimah })).toBe('near');
  });

  it('keeps tasks without deadlines in their own window', () => {
    expect(win({ window: 'week' })).toBe('week');
    expect(win({ window: 'ongoing' })).toBe('ongoing');
  });

  it('leaves decision items where they are', () => {
    expect(win({ window: 'decide', dueDate: '2026-09-30' })).toBe('decide');
    expect(win({ window: 'decide', dueDate: '2026-10-02' })).toBe('decide');
  });

  it('puts finished tasks in Done', () => {
    expect(win({ window: 'near', dueDate: '2026-09-30', doneAt: '2026-09-30T12:00:00Z' })).toBe('done');
  });

  it('counts days in the zone the user is in', () => {
    // Due Sat Oct 3 at 11pm Chicago is Sunday at midnight in New York, which still belongs to Saturday.
    const t: UrgencyTask = { window: 'soon', dueAt: '2026-10-04T04:00:00.000Z' };
    expect(win(t, NOW, NY)).toBe('near');
    // Due Sun 2:30am Chicago is Sun 3:30am in New York (still Saturday night) but 4:30pm in Tokyo.
    const late: UrgencyTask = { window: 'soon', dueAt: '2026-10-04T07:30:00.000Z' };
    expect(daysLeft(late, '2026-10-02', CHI)).toBe(1);
    expect(daysLeft(late, '2026-10-02', NY)).toBe(1);
    expect(daysLeft(late, '2026-10-02', 'Asia/Tokyo')).toBe(2);
  });
});

describe('dueTone', () => {
  it('matches the due chip colors in spec §9', () => {
    const tone = (t: UrgencyTask, now = NOW) => dueTone(t, now, CHI, CHI);
    expect(tone({ window: 'soon', dueAt: econPset })).toBe('plain');
    expect(tone({ window: 'soon', dueAt: mathPset })).toBe('soon');
    expect(tone({ window: 'soon', dueDate: '2026-10-03' })).toBe('urgent');
    expect(tone({ window: 'soon', dueDate: '2026-10-02' })).toBe('urgent');
    expect(tone({ window: 'soon', dueDate: '2026-10-01' })).toBe('overdue');
    expect(tone({ window: 'soon', dueDate: '2026-10-01', doneAt: '2026-10-01T12:00:00Z' })).toBe('plain');
    expect(tone({ window: 'soon' })).toBeNull();
  });
});

describe('compareByDeadline', () => {
  it('sorts deadlines earliest first, day-only after timed on the same day, none last', () => {
    const items = [
      { id: 'none' },
      { id: 'math', dueAt: mathPset },
      { id: 'tueDay', dueDate: '2026-10-06' },
      { id: 'muq', dueAt: muqaddimah },
      { id: 'tueLate', dueAt: '2026-10-07T07:00:00.000Z' }, // Wed 2am Chicago, still Tuesday night
    ];
    const sorted = [...items].sort((a, b) => compareByDeadline(a, b, CHI)).map((i) => i.id);
    expect(sorted).toEqual(['muq', 'tueLate', 'tueDay', 'math', 'none']);
  });
});
