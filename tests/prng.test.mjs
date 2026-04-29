import { describe, it, expect } from 'vitest';
import { mulberry32, seedFromTuple, makePrng, rngInt, rngPick, rngBool } from '../src/prng.js';

describe('mulberry32', () => {
  it('produces a deterministic sequence for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });
  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let identicalCount = 0;
    for (let i = 0; i < 100; i++) if (a() === b()) identicalCount++;
    expect(identicalCount).toBeLessThan(2);
  });
  it('returns values in [0,1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('seedFromTuple', () => {
  it('is stable for the same tuple', () => {
    expect(seedFromTuple('p', 'median', 1)).toBe(seedFromTuple('p', 'median', 1));
  });
  it('changes when any field changes', () => {
    const a = seedFromTuple('p', 'median', 1);
    expect(seedFromTuple('q', 'median', 1)).not.toBe(a);
    expect(seedFromTuple('p', 'rich', 1)).not.toBe(a);
    expect(seedFromTuple('p', 'median', 2)).not.toBe(a);
  });
});

describe('rng helpers', () => {
  it('rngInt is in [min, max)', () => {
    const r = makePrng('persona', 'median', 1);
    for (let i = 0; i < 500; i++) {
      const v = rngInt(r, 5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });
  it('rngPick returns elements from the array', () => {
    const r = makePrng('persona', 'median', 2);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) expect(arr).toContain(rngPick(r, arr));
  });
  it('rngBool obeys probability roughly', () => {
    const r = makePrng('persona', 'median', 3);
    let yes = 0;
    for (let i = 0; i < 5000; i++) if (rngBool(r, 0.3)) yes++;
    // 30% ± 3% on 5000 samples is comfortably wide.
    expect(yes / 5000).toBeGreaterThan(0.27);
    expect(yes / 5000).toBeLessThan(0.33);
  });
});
