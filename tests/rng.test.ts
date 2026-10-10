import { describe, expect, it } from 'vitest';
import { Rng, hashSeed } from '../src/sim/rng.ts';

describe('Rng (mulberry32)', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++;
    expect(same).toBeLessThan(3);
  });

  it('stays in [0,1) and is roughly uniform', () => {
    const r = new Rng(7);
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 100_000).toBeCloseTo(0.5, 2);
  });

  it('gaussian has mean ~0 and std ~1', () => {
    const r = new Rng(9);
    let s = 0;
    let s2 = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) {
      const g = r.gaussian();
      s += g;
      s2 += g * g;
    }
    expect(s / n).toBeCloseTo(0, 1);
    expect(Math.sqrt(s2 / n)).toBeCloseTo(1, 1);
  });

  it('can resume from a saved state', () => {
    const a = new Rng(123);
    for (let i = 0; i < 10; i++) a.next();
    const b = new Rng(0);
    b.state = a.state;
    expect(b.next()).toBe(a.next());
  });

  it('hashSeed keeps integers and hashes text', () => {
    expect(hashSeed('123')).toBe(123);
    expect(hashSeed('hello')).toBe(hashSeed('hello'));
    expect(hashSeed('hello')).not.toBe(hashSeed('world'));
  });
});
