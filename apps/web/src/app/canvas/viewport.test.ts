import { describe, expect, it } from 'vitest';

import { MAX_ZOOM, MIN_ZOOM } from '../constants';
import { clampScale, zoomViewportAt } from './viewport';

describe('viewport zoom', () => {
  it('clamps the scale', () => {
    expect(clampScale(10)).toBe(MAX_ZOOM);
    expect(clampScale(0.01)).toBe(MIN_ZOOM);
    expect(clampScale(1.25)).toBe(1.25);
  });

  it('keeps the world point under the anchor fixed', () => {
    const before = { x: 40, y: -20, scale: 1 };
    const anchor = { x: 300, y: 200 };
    const after = zoomViewportAt(before, 1.5, anchor);

    const worldBefore = { x: (anchor.x - before.x) / before.scale, y: (anchor.y - before.y) / before.scale };
    const worldAfter = { x: (anchor.x - after.x) / after.scale, y: (anchor.y - after.y) / after.scale };
    expect(after.scale).toBe(1.5);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });

  it('does not zoom past the limits', () => {
    expect(zoomViewportAt({ x: 0, y: 0, scale: 1 }, 50, { x: 10, y: 10 }).scale).toBe(MAX_ZOOM);
  });
});
