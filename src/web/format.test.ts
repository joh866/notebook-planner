import { describe, expect, it } from 'vitest';
import { clockMin, deadlineOn, dueLabel, fmtDur, fmtRange, fmtTime, joinAnd, planLabel, planTarget, relWord, shortLoc } from './format';

describe('times', () => {
  it('formats clock times and ranges', () => {
    expect(fmtTime(540)).toBe('9am');
    expect(fmtTime(1215)).toBe('8:15pm');
    expect(fmtTime(1440)).toBe('12am');
    expect(fmtTime(1500)).toBe('1am');
    expect(fmtRange(660, 740)).toBe('11am–12:20pm');
    expect(fmtRange(1050, 1140)).toBe('5:30–7pm');
    expect(fmtRange(810, 890)).toBe('1:30–2:50pm');
    expect(fmtRange(1380, 1440)).toBe('11pm–12am');
  });

  it('formats durations', () => {
    expect(fmtDur(45)).toBe('45m');
    expect(fmtDur(60, 60)).toBe('1h');
    expect(fmtDur(20, 40)).toBe('20–40m');
    expect(fmtDur(180, 300)).toBe('3–5h');
    expect(fmtDur(45, 120)).toBe('45m–2h');
    expect(fmtDur(90, 150)).toBe('1.5–2.5h');
  });

  it('puts times before 4am in that day’s night', () => {
    expect(clockMin('09:00')).toBe(540);
    expect(clockMin('00:00')).toBe(1440);
    expect(clockMin('03:30')).toBe(1650);
    expect(clockMin('04:00')).toBe(240);
  });
});

describe('days', () => {
  const FRI = '2026-10-02';

  it('names nearby days', () => {
    expect(relWord(FRI, FRI)).toBe('today');
    expect(relWord(FRI, '2026-10-03')).toBe('tomorrow');
    expect(relWord(FRI, '2026-10-01')).toBe('yesterday');
    expect(relWord(FRI, '2026-10-06')).toBe('Tuesday');
    expect(relWord(FRI, '2026-09-29')).toBe('last Tuesday');
    expect(relWord(FRI, '2026-10-14')).toBe('Oct 14');
  });

  it('labels due chips', () => {
    expect(dueLabel(FRI, '2026-10-06', 840)).toBe('Tue 2pm');
    expect(dueLabel(FRI, '2026-10-03', 660)).toBe('tomorrow 11am');
    expect(dueLabel(FRI, '2026-10-09', null)).toBe('Oct 9');
    expect(dueLabel(FRI, '2026-10-08', null)).toBe('Thu');
    expect(dueLabel(FRI, '2026-10-14', 660)).toBe('Oct 14, 11am');
    expect(dueLabel(FRI, '2026-09-29', 840)).toBe('Tue 2pm');
  });

  it('reads deadlines in the shown zone', () => {
    expect(deadlineOn({ dueAt: '2026-10-06T19:00:00Z', dueDate: null }, 'America/Chicago')).toEqual({ date: '2026-10-06', min: 840 });
    expect(deadlineOn({ dueAt: '2026-10-06T19:00:00Z', dueDate: null }, 'America/New_York')).toEqual({ date: '2026-10-06', min: 900 });
    expect(deadlineOn({ dueAt: null, dueDate: '2026-10-09' }, 'America/Chicago')).toEqual({ date: '2026-10-09', min: null });
    expect(deadlineOn({ dueAt: null, dueDate: null }, 'America/Chicago')).toBeNull();
  });
});

describe('Plan button', () => {
  const FRI = '2026-10-02';

  it('plans the selected day, or tomorrow after 9pm today, and hides on past days', () => {
    expect(planTarget(FRI, FRI, 600)).toBe(FRI);
    expect(planTarget(FRI, FRI, 1260)).toBe('2026-10-03');
    expect(planTarget(FRI, '2026-10-01', 600)).toBeNull();
    expect(planTarget(FRI, '2026-10-05', 1300)).toBe('2026-10-05');
  });

  it('names the day', () => {
    expect(planLabel(FRI, FRI)).toBe('Plan today');
    expect(planLabel(FRI, '2026-10-03')).toBe('Plan tomorrow');
    expect(planLabel(FRI, '2026-10-05')).toBe('Plan Monday');
    expect(planLabel(FRI, '2026-10-14')).toBe('Plan Oct 14');
  });
});

describe('words', () => {
  it('joins lists and shortens rooms', () => {
    expect(joinAnd(['a'])).toBe('a');
    expect(joinAnd(['a', 'b'])).toBe('a and b');
    expect(joinAnd(['a', 'b', 'c'])).toBe('a, b, and c');
    expect(shortLoc('Saieh Hall for Economics 021')).toBe('Saieh 021');
    expect(shortLoc('Home')).toBe('Home');
  });
});
