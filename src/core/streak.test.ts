import { describe, expect, it } from 'vitest';
import { streak } from './streak';

const daily = { repeat: 'daily' as const };
const saturdays = { repeat: 'weekly' as const, repeatDays: [6] };

describe('streak', () => {
  it('counts days in a row, including today when checked', () => {
    const checked = new Set(['2026-09-30', '2026-10-01', '2026-10-02']);
    expect(streak(daily, checked, '2026-10-02')).toBe(3);
  });

  it('keeps the streak while today is still unchecked', () => {
    const checked = new Set(['2026-09-30', '2026-10-01']);
    expect(streak(daily, checked, '2026-10-02')).toBe(2);
  });

  it('breaks on a missed past day', () => {
    const checked = new Set(['2026-09-29', '2026-10-01', '2026-10-02']);
    expect(streak(daily, checked, '2026-10-02')).toBe(2);
    expect(streak(daily, new Set(), '2026-10-02')).toBe(0);
  });

  it('only counts the days a weekly routine falls on', () => {
    const checked = new Set(['2026-09-26', '2026-10-03']);
    expect(streak(saturdays, checked, '2026-10-08')).toBe(2);
  });

  it('stops at the first day the repeat counts from', () => {
    const r = { ...daily, repeatFrom: '2026-10-01' };
    expect(streak(r, new Set(['2026-10-01', '2026-10-02']), '2026-10-02')).toBe(2);
  });
});
