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

export { CUSTOM_COLORS, categoryName, findCategory, nextColor } from '../shared/categories';
