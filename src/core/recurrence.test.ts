import { describe, expect, it } from 'vitest';
import { classesOn, routineOccursOn, slotOn, type Repeat, type WeeklyClass } from './recurrence';

const CHI = 'America/Chicago';

const daily: Repeat = { repeat: 'daily' };
const laundry: Repeat = { repeat: 'weekly', repeatDays: [6] };
const cleanDorm: Repeat = { repeat: 'weekly', repeatDays: [6], repeatEvery: 2, repeatFrom: '2026-10-03' };

describe('routineOccursOn', () => {
  it('repeats daily routines every day', () => {
    expect(routineOccursOn(daily, '2026-10-02')).toBe(true);
    expect(routineOccursOn(daily, '2026-11-01')).toBe(true);
  });

  it('repeats weekly routines on their days only', () => {
    expect(routineOccursOn(laundry, '2026-10-03')).toBe(true);
    expect(routineOccursOn(laundry, '2026-10-10')).toBe(true);
    expect(routineOccursOn(laundry, '2026-10-02')).toBe(false);
  });

  it('repeats every other week counting from the first day', () => {
    expect(routineOccursOn(cleanDorm, '2026-09-26')).toBe(false); // before it starts
    expect(routineOccursOn(cleanDorm, '2026-10-03')).toBe(true);
    expect(routineOccursOn(cleanDorm, '2026-10-10')).toBe(false);
    expect(routineOccursOn(cleanDorm, '2026-10-17')).toBe(true);
    expect(routineOccursOn(cleanDorm, '2026-10-31')).toBe(true);
    expect(routineOccursOn(cleanDorm, '2026-11-07')).toBe(false);
    expect(routineOccursOn(cleanDorm, '2026-11-14')).toBe(true);
    expect(routineOccursOn(cleanDorm, '2026-10-16')).toBe(false); // right week, wrong day
  });

  it('handles every other week with several days', () => {
    const r: Repeat = { repeat: 'weekly', repeatDays: [2, 4], repeatEvery: 2, repeatFrom: '2026-10-04' };
    expect(routineOccursOn(r, '2026-10-06')).toBe(true);
    expect(routineOccursOn(r, '2026-10-08')).toBe(true);
    expect(routineOccursOn(r, '2026-10-13')).toBe(false);
    expect(routineOccursOn(r, '2026-10-20')).toBe(true);
  });
});

describe('slotOn', () => {
  const slot = { id: 's1', start: '09:00', durationMinutes: 30 };

  it('uses the slot time on days the routine falls on', () => {
    expect(slotOn(daily, slot, '2026-10-02', [])).toEqual({
      slotId: 's1', date: '2026-10-02', start: '09:00', durationMinutes: 30, changed: false,
    });
    expect(slotOn(laundry, { ...slot, durationMinutes: 140 }, '2026-10-02', [])).toBeNull();
  });

  it('applies per-day exceptions to that day only', () => {
    const ex = [
      { slotId: 's1', date: '2026-10-02', skipped: true },
      { slotId: 's1', date: '2026-10-03', skipped: false, start: '10:30' },
      { slotId: 's1', date: '2026-10-04', skipped: false, durationMinutes: 15 },
      { slotId: 'other', date: '2026-10-05', skipped: true },
    ];
    expect(slotOn(daily, slot, '2026-10-02', ex)).toBeNull();
    expect(slotOn(daily, slot, '2026-10-03', ex)).toMatchObject({ start: '10:30', durationMinutes: 30, changed: true });
    expect(slotOn(daily, slot, '2026-10-04', ex)).toMatchObject({ start: '09:00', durationMinutes: 15, changed: true });
    expect(slotOn(daily, slot, '2026-10-05', ex)).toMatchObject({ start: '09:00', changed: false });
  });
});

describe('classesOn', () => {
  const classes: WeeklyClass[] = [
    { id: 'econ-disc', days: [5], start: '13:30', end: '14:50', timeZone: CHI },
    { id: 'math', days: [1, 3, 5], start: '12:30', end: '13:20', timeZone: CHI },
    { id: 'sosc', days: [2, 4], start: '14:00', end: '15:20', timeZone: CHI },
    { id: 'econ-lec', days: [1, 3], start: '11:00', end: '12:20', timeZone: CHI },
  ];
  const none = new Set<string>();

  it('lists a day’s classes in time order', () => {
    const fri = classesOn(classes, '2026-10-02', CHI, none);
    expect(fri.map((c) => c.classId)).toEqual(['math', 'econ-disc']);
    expect(fri[1]!.startAt.toUTC().toISO()).toBe('2026-10-02T18:30:00.000Z');
    expect(fri[1]!.endAt.toUTC().toISO()).toBe('2026-10-02T19:50:00.000Z');
    expect(classesOn(classes, '2026-10-03', CHI, none)).toEqual([]);
  });

  it('shows a 2pm Chicago class at 3pm in New York', () => {
    const [sosc] = classesOn(classes, '2026-10-06', 'America/New_York', none);
    expect(sosc!.classId).toBe('sosc');
    expect(sosc!.startAt.setZone('America/New_York').toFormat('HH:mm')).toBe('15:00');
  });

  it('can land on a different day far from Chicago', () => {
    // Thursday 2pm in Chicago is Friday 4am in Tokyo.
    const fri = classesOn(classes, '2026-10-02', 'Asia/Tokyo', none);
    const sosc = fri.find((c) => c.classId === 'sosc');
    expect(sosc).toMatchObject({ homeDate: '2026-10-01' });
    expect(sosc!.startAt.setZone('Asia/Tokyo').toFormat('ccc HH:mm')).toBe('Fri 04:00');
    expect(classesOn(classes, '2026-10-01', 'Asia/Tokyo', none).some((c) => c.classId === 'sosc')).toBe(false);
  });

  it('keeps Chicago clock times across the Nov 1 change', () => {
    const before = classesOn(classes, '2026-10-26', CHI, none).find((c) => c.classId === 'econ-lec')!;
    const after = classesOn(classes, '2026-11-02', CHI, none).find((c) => c.classId === 'econ-lec')!;
    expect(before.startAt.toUTC().toFormat('HH:mm')).toBe('16:00');
    expect(after.startAt.toUTC().toFormat('HH:mm')).toBe('17:00');
    expect(after.startAt.setZone(CHI).toFormat('HH:mm')).toBe('11:00');
  });

  it('marks skipped days without dropping the class', () => {
    const fri = classesOn(classes, '2026-10-02', CHI, new Set(['econ-disc@2026-10-02']));
    expect(fri.find((c) => c.classId === 'econ-disc')!.skipped).toBe(true);
    expect(fri.find((c) => c.classId === 'math')!.skipped).toBe(false);
    const nextFri = classesOn(classes, '2026-10-09', CHI, new Set(['econ-disc@2026-10-02']));
    expect(nextFri.find((c) => c.classId === 'econ-disc')!.skipped).toBe(false);
  });
});
