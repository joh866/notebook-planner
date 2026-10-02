import { describe, expect, it } from 'vitest';
import { systemPrompt } from './prompt';

describe('systemPrompt', () => {
  const p = systemPrompt({
    today: '2026-10-02',
    time: '17:30',
    classes: [{ code: 'SOSC 16100', kind: 'Seminar', days: [2, 4], start: '14:00', end: '15:20' }],
    customCategories: ['Music'],
  });

  it('gives today, the time, the next 14 days with weekdays, and the classes (spec §11)', () => {
    expect(p).toContain('Today is Friday 2026-10-02, and the time is 17:30.');
    expect(p).toContain('Fri 2026-10-02, Sat 2026-10-03');
    expect(p).toContain('Thu 2026-10-15.');
    expect(p).not.toContain('2026-10-16');
    expect(p).toContain('SOSC 16100 Seminar Tue/Thu 14:00-15:20');
  });

  it('lists custom categories and the rules', () => {
    expect(p).toContain('"routine", "music"');
    expect(p).toContain('Never invent a date, time, or deadline');
    expect(p).toContain('Times from 00:00 to 04:00 belong to the night of the given day');
  });
});
