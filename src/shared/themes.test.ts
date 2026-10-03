import { describe, expect, it } from 'vitest';
import { partnerOf, THEMES } from './themes';

describe('themes', () => {
  it('come in day and night pairs that point at each other', () => {
    for (const t of THEMES) {
      const p = THEMES.find((x) => x.id === t.partner)!;
      expect(p.mode, t.id).not.toBe(t.mode);
      expect(partnerOf(p.id)).toBe(t.id);
    }
    expect(THEMES.filter((t) => t.mode === 'day')).toHaveLength(7);
  });
});
