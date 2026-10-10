import { describe, expect, it } from 'vitest';
import { wrapDelta } from '../src/sim/geometry.ts';
import { Rng } from '../src/sim/rng.ts';
import { SpatialHash } from '../src/sim/spatial.ts';
import { ACT_STRIDE } from '../src/sim/creatures.ts';
import { DEFAULT_CONFIG } from '../src/sim/config.ts';
import { emptyWorld, makeGenome } from './helpers.ts';

describe('SpatialHash', () => {
  it('finds exactly the same neighbours as brute force, including across edges', () => {
    const W = 1200;
    const H = 800;
    const n = 1500;
    const rng = new Rng(17);
    const alive = new Uint8Array(n);
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      alive[i] = rng.next() < 0.9 ? 1 : 0;
      xs[i] = rng.range(0, W);
      ys[i] = rng.range(0, H);
    }
    const hash = new SpatialHash(W, H, 40, n);
    hash.build(alive, xs, ys);
    for (let q = 0; q < 200; q++) {
      const qx = q < 20 ? rng.range(0, 30) : rng.range(0, W); // some queries hug the edge
      const qy = rng.range(0, H);
      const r = rng.range(5, 450);
      const got: number[] = [];
      hash.forEachNear(qx, qy, r, (s) => {
        const dx = wrapDelta(qx, xs[s], W);
        const dy = wrapDelta(qy, ys[s], H);
        if (dx * dx + dy * dy < r * r) got.push(s);
      });
      const want: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!alive[i]) continue;
        const dx = wrapDelta(qx, xs[i], W);
        const dy = wrapDelta(qy, ys[i], H);
        if (dx * dx + dy * dy < r * r) want.push(i);
      }
      expect(new Set(got).size).toBe(got.length); // no duplicates even for huge radii
      expect(got.sort((a, b) => a - b)).toEqual(want);
    }
  });
});

describe('vision sensing', () => {
  const rayBase = (s: number, k: number) => s * ACT_STRIDE + k * 3;

  it('sees a creature straight ahead in the middle ray with correct closeness and size', () => {
    const w = emptyWorld({ ...DEFAULT_CONFIG });
    const g = makeGenome({ visionRange: 100, fov: 2, size: 1 });
    const me = w.addCreature(g, 100, 100, 50, 0);
    const other = w.addCreature(makeGenome({ size: 2 }), 150, 100, 50, 0);
    w.hash.build(w.pool.alive, w.pool.x, w.pool.y);
    w.sense(me);
    const mid = rayBase(me, 2);
    expect(w.pool.act[mid + 1]).toBeCloseTo(1 - 50 / 100, 5);
    expect(w.pool.act[mid + 2]).toBeCloseTo((2 - 1) / (2 + 1), 5);
    for (const k of [0, 1, 3, 4]) expect(w.pool.act[rayBase(me, k) + 1]).toBe(0);
    expect(w.pool.target[me]).toBe(-1); // 50 units is out of attack reach
    void other;
  });

  it('sees across the world edge and picks an attack target in reach', () => {
    const w = emptyWorld({ ...DEFAULT_CONFIG });
    const me = w.addCreature(makeGenome({ visionRange: 60, fov: 2 }), 5, 400, 50, Math.PI); // facing −x
    const other = w.addCreature(makeGenome(), 1195, 400, 50, 0); // 10 units "behind" the edge
    w.hash.build(w.pool.alive, w.pool.x, w.pool.y);
    w.sense(me);
    expect(w.pool.act[rayBase(me, 2) + 1]).toBeCloseTo(1 - 10 / 60, 5);
    expect(w.pool.target[me]).toBe(other);
  });

  it('ignores creatures behind it', () => {
    const w = emptyWorld({ ...DEFAULT_CONFIG });
    const me = w.addCreature(makeGenome({ visionRange: 100, fov: 1 }), 500, 400, 50, 0);
    w.addCreature(makeGenome(), 470, 400, 50, 0);
    w.hash.build(w.pool.alive, w.pool.x, w.pool.y);
    w.sense(me);
    for (let k = 0; k < 5; k++) expect(w.pool.act[rayBase(me, k) + 1]).toBe(0);
    expect(w.pool.target[me]).toBe(-1);
  });

  it('food rays read the food field in the ray direction', () => {
    const w = emptyWorld({ ...DEFAULT_CONFIG });
    w.food.food.fill(0);
    const me = w.addCreature(makeGenome({ visionRange: 60, fov: 2 }), 305, 305, 50, 0);
    // Put food ~20 units straight ahead (first sample of the middle ray). Positions avoid cell
    // borders because float32 trait genes make the decoded range 59.99999…, not exactly 60.
    w.food.food[w.food.cellIndex(325, 305)] = w.cfg.foodMax;
    w.hash.build(w.pool.alive, w.pool.x, w.pool.y);
    w.sense(me);
    expect(w.pool.act[rayBase(me, 2)]).toBeCloseTo(1, 5);
    expect(w.pool.act[rayBase(me, 0)]).toBe(0);
  });
});
