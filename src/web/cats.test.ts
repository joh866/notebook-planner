import { describe, expect, it } from 'vitest';
import type { CategoryView } from '../shared/api';
import { CUSTOM_COLORS, categoryName, findCategory, nextColor } from './cats';

const cat = (id: string, name: string, builtin = true): CategoryView => ({ id, name, color: builtin ? null : '#000000', builtin, sortOrder: 0 });
const CATS = [cat('class', 'Classes'), cat('errand', 'Errands'), cat('growth', 'Growth'), cat('life', 'Life'), cat('routine', 'Routines')];

describe('findCategory', () => {
  it('matches ids, names, #tags, and aliases, ignoring case', () => {
    expect(findCategory(CATS, 'errand')?.id).toBe('errand');
    expect(findCategory(CATS, 'Errands')?.id).toBe('errand');
    expect(findCategory(CATS, '#errands')?.id).toBe('errand');
    expect(findCategory(CATS, 'homework')?.id).toBe('class');
    expect(findCategory(CATS, ' GROWTH ')?.id).toBe('growth');
  });

  it('finds custom categories by name, and nothing for a new or empty name', () => {
    const list = [...CATS, cat('k1', 'Health club', false)];
    expect(findCategory(list, 'health club')?.id).toBe('k1');
    expect(findCategory(list, 'Music')).toBeUndefined();
    expect(findCategory(list, '#')).toBeUndefined();
  });
});

describe('new categories', () => {
  it('cycles through the custom colors', () => {
    expect(nextColor(CATS)).toBe(CUSTOM_COLORS[0]);
    expect(nextColor([...CATS, cat('k1', 'Music', false)])).toBe(CUSTOM_COLORS[1]);
  });

  it('capitalizes a typed name and drops the #', () => {
    expect(categoryName('#music practice')).toBe('Music practice');
  });
});
