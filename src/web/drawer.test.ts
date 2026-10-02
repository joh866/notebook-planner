import { describe, expect, it } from 'vitest';
import { drawerHeights, nearestStop, tapped } from './drawer';

describe('phone drawer', () => {
  it('stops at 64px, about half the screen, and just below the header', () => {
    expect(drawerHeights(844, 130)).toEqual({ peek: 64, half: 439, max: 710 });
  });

  it('never makes half taller than full, and keeps full usable on a short screen', () => {
    expect(drawerHeights(400, 250)).toEqual({ peek: 64, half: 208, max: 220 });
  });

  it('snaps a dragged height to the nearest stop', () => {
    const hs = drawerHeights(844, 130);
    expect(nearestStop(80, hs)).toBe('peek');
    expect(nearestStop(300, hs)).toBe('half');
    expect(nearestStop(620, hs)).toBe('max');
  });

  it('opens halfway on a tap, and closes on the next', () => {
    expect(tapped('peek')).toBe('half');
    expect(tapped('half')).toBe('peek');
    expect(tapped('max')).toBe('peek');
  });
});
