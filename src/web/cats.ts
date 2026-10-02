import type { CSSProperties } from 'react';
import type { CategoryView } from '../shared/api';

/** Built-in category ids that have a palette color (spec §4). */
const PALETTE = new Set(['class', 'errand', 'growth', 'life', 'routine']);

/** The category's color as a CSS value. Built-ins follow day and night; custom ones keep their own. */
export function catColor(categories: CategoryView[], id: string | null): string {
  const c = id ? categories.find((x) => x.id === id) : undefined;
  if (c?.color) return c.color;
  return id && PALETTE.has(id) ? `var(--c-${id})` : 'var(--c-none)';
}

export const catStyle = (categories: CategoryView[], id: string | null) => ({ '--cat': catColor(categories, id) }) as CSSProperties;

export function catName(categories: CategoryView[], id: string | null): string {
  return (id && categories.find((x) => x.id === id)?.name) || 'No category';
}

/** Colors for new custom categories, in order (from the prototype). */
export const CUSTOM_COLORS = ['#E07B39', '#2BA5A5', '#C9443A', '#7A8B2E', '#B05FC4', '#4A90D9'];

const ALIASES: Record<string, string> = {
  classes: 'class', school: 'class', schoolwork: 'class', homework: 'class',
  errands: 'errand', shopping: 'errand', personal: 'life', health: 'life',
};

/** The category a typed name means: an id, a name, or a common alias ("#errands", "homework"). */
export function findCategory(categories: CategoryView[], raw: string): CategoryView | undefined {
  const t = raw.replace(/^#/, '').trim().toLowerCase();
  if (!t) return undefined;
  const id = ALIASES[t] ?? t;
  return categories.find((c) => c.id === id || c.name.toLowerCase() === t);
}

/** The color for the next custom category, cycling through CUSTOM_COLORS. */
export function nextColor(categories: CategoryView[]): string {
  const custom = categories.filter((c) => !c.builtin).length;
  return CUSTOM_COLORS[custom % CUSTOM_COLORS.length]!;
}

/** "health club" → "Health club". */
export const categoryName = (raw: string) => {
  const t = raw.replace(/^#/, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
