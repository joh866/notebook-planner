import { describe, expect, it } from 'vitest';
import { aroundLabel, clockMin, deadlineOn, dueLabel, fmtDur, fmtRange, fmtTime, joinAnd, planLabel, planTarget, relWord, repeatWords, shortLoc } from './format';

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

describe('drop words', () => {
  it('updates a tentative event’s “Around” time and keeps the rest', () => {
    expect(aroundLabel('Around 7, depends on friends', 1230)).toBe('Around 8:30pm, depends on friends');
    expect(aroundLabel('around 7?', 1260)).toBe('Around 9pm');
    expect(aroundLabel(null, 1140)).toBe('Around 7pm');
    expect(aroundLabel('Depends on friends', 1140)).toBe('Around 7pm');
  });

  it('says how a routine repeats', () => {
    expect(repeatWords({ repeat: 'daily', repeatDays: null, repeatEvery: 1 })).toBe('every day');
    expect(repeatWords({ repeat: 'weekly', repeatDays: [6], repeatEvery: 1 })).toBe('every Saturday');
    expect(repeatWords({ repeat: 'weekly', repeatDays: [6], repeatEvery: 2 })).toBe('every other Saturday');
    expect(repeatWords({ repeat: 'weekly', repeatDays: [1, 3], repeatEvery: 1 })).toBe('every Monday and Wednesday');
  });
});

describe('planner words', () => {
  it('rounds hours to 15 minutes', async () => {
    const { fmtHours } = await import('./format');
    expect(fmtHours(300)).toBe('5h');
    expect(fmtHours(268)).toBe('4h 30m');
    expect(fmtHours(44)).toBe('45m');
  });

  it('says the capacity warning as the spec does (§6)', async () => {
    const { capacityText } = await import('./format');
    expect(capacityText({ level: 'tight', work: 300, free: 240, dueAt: '2026-10-06T19:00:00Z', dueDate: null }, '2026-10-02', 'America/Chicago'))
      .toBe('Tight: about 5h of work is due by Tuesday at 2pm, and you have about 4h of free time before then.');
    expect(capacityText({ level: 'heads-up', work: 90, free: 160, dueAt: null, dueDate: '2026-10-03' }, '2026-10-02', 'America/Chicago'))
      .toBe('Heads up: about 1h 30m of work is due by tomorrow, and you have about 2h 45m of free time before then.');
  });

  it('says what the Plan button did', async () => {
    const { planMessage } = await import('./format');
    const one = { date: '2026-10-02', placed: [{ title: 'Read', startAt: '2026-10-02T21:15:00Z' }], lifted: 0, free: 300 };
    expect(planMessage(one, '2026-10-02', 'America/Chicago')).toBe('Penciled in “Read” today at 4:15pm.');
    expect(planMessage({ ...one, date: '2026-10-03', placed: [one.placed[0]!, one.placed[0]!] }, '2026-10-02', 'America/Chicago')).toBe('Penciled in 2 tasks for tomorrow.');
    expect(planMessage({ ...one, placed: [], free: 0 }, '2026-10-02', 'America/Chicago')).toBe('There’s no free time left today.');
    expect(planMessage({ ...one, placed: [] }, '2026-10-02', 'America/Chicago')).toBe('Nothing to plan. Everything is scheduled, waiting, or needs a decision.');
  });
});
