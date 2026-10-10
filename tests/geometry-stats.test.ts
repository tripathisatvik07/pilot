import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config.ts';
import { CreaturePool } from '../src/sim/creatures.ts';
import { fastAtan2, normAngle, wrap, wrapDelta } from '../src/sim/geometry.ts';
import { Rng } from '../src/sim/rng.ts';
import { Stats } from '../src/sim/stats.ts';

describe('geometry', () => {
  it('fastAtan2 matches Math.atan2 within 2e-5 rad everywhere', () => {
    const rng = new Rng(1);
    let worst = 0;
    for (let i = 0; i < 100_000; i++) {
      const y = rng.range(-100, 100);
      const x = rng.range(-100, 100);
      worst = Math.max(worst, Math.abs(fastAtan2(y, x) - Math.atan2(y, x)));
    }
    for (const [y, x] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [0, 0]]) {
      worst = Math.max(worst, Math.abs(fastAtan2(y, x) - Math.atan2(y, x)));
    }
    expect(worst).toBeLessThan(2e-5);
  });

  it('wrap / wrapDelta / normAngle', () => {
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(10, 10)).toBe(0);
    expect(wrap(25, 10)).toBe(5);
    expect(wrapDelta(9, 1, 10)).toBe(2);
    expect(wrapDelta(1, 9, 10)).toBe(-2);
    expect(normAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 9);
    expect(normAngle(-Math.PI / 2)).toBe(-Math.PI / 2);
  });
});

describe('event detector', () => {
  function poolWith(n: number, carnivores: number, lineage = 1): CreaturePool {
    const p = new CreaturePool(500);
    for (let i = 0; i < n; i++) {
      const s = p.allocate();
      p.diet[s] = i < carnivores ? 0.9 : 0.1;
      p.lineage[s] = lineage;
      p.generation[s] = 3;
    }
    return p;
  }

  it('logs crashes, extinctions and a new dominant lineage', () => {
    const st = new Stats(DEFAULT_CONFIG);
    st.sample(0, poolWith(200, 20, 7), 0, 1);
    expect(st.events.map((e) => e.kind)).toContain('dominant-lineage');
    st.sample(50, poolWith(200, 20, 7), 0, 1);
    st.sample(100, poolWith(60, 0, 7), 0, 1);
    const kinds = st.events.map((e) => e.kind);
    expect(kinds).toContain('population-crash');
    expect(kinds).toContain('carnivores-extinct');
    st.sample(150, poolWith(0, 0), 0, 1);
    expect(st.events.map((e) => e.kind)).toContain('extinction');
  });

  it('first carnivore is announced once', () => {
    const st = new Stats(DEFAULT_CONFIG);
    st.onBirth(10, 0.2, 1, 5);
    st.onBirth(20, 0.8, 2, 6);
    st.onBirth(30, 0.9, 3, 7);
    expect(st.events.filter((e) => e.kind === 'first-carnivore')).toHaveLength(1);
    expect(st.events[0].tick).toBe(20);
  });

  it('thins history when full but keeps the latest sample', () => {
    const st = new Stats({ ...DEFAULT_CONFIG, historyLength: 10 });
    const p = poolWith(30, 3);
    for (let t = 0; t <= 20; t++) st.sample(t * 50, p, 0, 1);
    expect(st.samples.length).toBeLessThanOrEqual(11);
    expect(st.latest()!.tick).toBe(1000);
  });
});
