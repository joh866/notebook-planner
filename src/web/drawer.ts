// The phone task drawer's stops (spec §5, "Phone"): closed (64px), half, or full. Full stops just
// below the header, so the date and the deadline line stay visible.

export type DrawerStop = 'peek' | 'half' | 'max';

export const PEEK_PX = 64;

export type DrawerHeights = Record<DrawerStop, number>;

/** Heights for a screen of `screenH` pixels whose header ends `headerBottom` pixels from the screen's top. */
export function drawerHeights(screenH: number, headerBottom: number): DrawerHeights {
  const max = Math.max(220, Math.round(screenH - headerBottom - 4));
  return { peek: PEEK_PX, half: Math.min(max, Math.round(screenH * 0.52)), max };
}

/** The stop closest to a dragged height. */
export function nearestStop(h: number, hs: DrawerHeights): DrawerStop {
  return (['peek', 'half', 'max'] as const).reduce((best, k) => (Math.abs(hs[k] - h) < Math.abs(hs[best] - h) ? k : best), 'peek');
}

/** A tap on the handle opens it halfway, or closes it. */
export const tapped = (s: DrawerStop): DrawerStop => (s === 'peek' ? 'half' : 'peek');
