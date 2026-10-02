// Category names and colors, used by the web app (the dot picker) and the server (the add box).

interface Cat {
  id: string;
  name: string;
  builtin: boolean;
}

/** Colors for new custom categories, in order (spec §4). */
export const CUSTOM_COLORS = ['#E07B39', '#2BA5A5', '#C9443A', '#7A8B2E', '#B05FC4', '#4A90D9'];

const ALIASES: Record<string, string> = {
  classes: 'class', school: 'class', schoolwork: 'class', homework: 'class',
  errands: 'errand', shopping: 'errand', personal: 'life', health: 'life',
  routines: 'routine',
};

/** The category a typed name means: an id, a name, or a common alias ("#errands", "homework"). */
export function findCategory<C extends Cat>(categories: C[], raw: string): C | undefined {
  const t = raw.replace(/^#/, '').trim().toLowerCase();
  if (!t) return undefined;
  const id = ALIASES[t] ?? t;
  return categories.find((c) => c.id === id || c.name.toLowerCase() === t);
}

/** The color for the next custom category, cycling through CUSTOM_COLORS. */
export function nextColor(categories: Cat[]): string {
  const custom = categories.filter((c) => !c.builtin).length;
  return CUSTOM_COLORS[custom % CUSTOM_COLORS.length]!;
}

/** "health club" → "Health club". */
export const categoryName = (raw: string) => {
  const t = raw.replace(/^#/, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
