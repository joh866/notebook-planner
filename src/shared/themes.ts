import { z } from 'zod';

// Themes (spec §4, "Themes"): day and night pairs. Their values are in src/web/themes.css, taken
// exactly from design/theme-samples.html and design/theme-samples-3.html.

export const THEMES = [
  { id: 'notebook-day', name: 'Notebook day', mode: 'day', partner: 'notebook-night' },
  { id: 'notebook-night', name: 'Notebook night', mode: 'night', partner: 'notebook-day' },
  { id: 'sleek-light', name: 'Sleek light', mode: 'day', partner: 'sleek-dark' },
  { id: 'sleek-dark', name: 'Sleek dark', mode: 'night', partner: 'sleek-light' },
  { id: 'glass-light', name: 'Glass light', mode: 'day', partner: 'glass-dark' },
  { id: 'glass-dark', name: 'Glass dark', mode: 'night', partner: 'glass-light' },
  { id: 'mono', name: 'Mono', mode: 'day', partner: 'mono-night' },
  { id: 'mono-night', name: 'Mono night', mode: 'night', partner: 'mono' },
  { id: 'sepia', name: 'Sepia Paper', mode: 'day', partner: 'hearth-dusk' },
  { id: 'hearth-dusk', name: 'Hearth Dusk', mode: 'night', partner: 'sepia' },
  { id: 'solarized', name: 'Solarized Lite', mode: 'day', partner: 'ember' },
  { id: 'ember', name: 'Ember', mode: 'night', partner: 'solarized' },
  { id: 'ink-coral', name: 'Ink & Coral', mode: 'day', partner: 'harbor-dusk' },
  { id: 'harbor-dusk', name: 'Harbor Dusk', mode: 'night', partner: 'ink-coral' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
export const ThemeSchema = z.enum(THEMES.map((x) => x.id) as [ThemeId, ...ThemeId[]]);

export const themeById = (id: string) => THEMES.find((x) => x.id === id);
/** The theme that goes with this one: picking a day theme pre-fills its night partner (spec §13). */
export const partnerOf = (id: ThemeId): ThemeId => themeById(id)!.partner;
