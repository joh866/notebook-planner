import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEMES } from '../shared/themes';

// Every theme is the same set of variables (spec §4): each one in the list has its own block in
// themes.css that sets all of the colors.

const css = readFileSync(fileURLToPath(new URL('./themes.css', import.meta.url)), 'utf8');
const COLORS = ['--bg', '--ink', '--muted', '--line', '--panel', '--card', '--frame', '--accent', '--red', '--hl', '--fill',
  '--c-class', '--c-errand', '--c-growth', '--c-life', '--c-routine'];

describe('themes.css', () => {
  it.each(THEMES.map((t) => t.id))('sets every color for %s', (id) => {
    const block = new RegExp(`^body\\[data-theme="${id}"\\] \\{([^}]*)\\}`, "m").exec(css)?.[1];
    expect(block, id).toBeDefined();
    for (const v of COLORS) expect(block, `${id} ${v}`).toMatch(new RegExp(`${v}:`));
  });

  it('only styles themes that are in the list', () => {
    const named = [...css.matchAll(/data-theme="([\w-]+)"/g)].map((m) => m[1]!);
    expect(named.filter((id) => !THEMES.some((t) => t.id === id))).toEqual([]);
  });
});
