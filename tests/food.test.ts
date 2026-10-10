import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config.ts';
import { FoodField } from '../src/sim/food.ts';
import { Rng } from '../src/sim/rng.ts';
import { World } from '../src/sim/world.ts';

describe('FoodField', () => {
  it('has fertility spanning [fertilityMin, 1] (oases and deserts exist)', () => {
    const f = new FoodField(DEFAULT_CONFIG, new Rng(1));
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of f.fertility) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeCloseTo(DEFAULT_CONFIG.fertilityMin, 5);
    expect(hi).toBeCloseTo(1, 5);
  });

  it('regrows a grazed cell toward its capacity, never above it', () => {
    const cfg = { ...DEFAULT_CONFIG, seasonAmplitude: 0 };
    const f = new FoodField(cfg, new Rng(3));
    f.food.fill(0);
    for (let t = 0; t < 20_000; t++) f.update(t);
    for (let i = 0; i < f.food.length; i++) {
      const k = cfg.foodMax * f.fertility[i];
      expect(f.food[i]).toBeLessThanOrEqual(k * 1.0001);
      expect(f.food[i]).toBeGreaterThan(k * 0.95);
    }
  });

  it('grows faster in summer than in winter', () => {
    const cfg = { ...DEFAULT_CONFIG, seasonAmplitude: 0.8, seasonPeriod: 1000 };
    const summer = new FoodField(cfg, new Rng(5));
    const winter = new FoodField(cfg, new Rng(5));
    summer.food.fill(1);
    winter.food.fill(1);
    summer.update(250); // sin peak
    winter.update(750); // sin trough
    expect(summer.total()).toBeGreaterThan(winter.total());
  });

  it('wraps cell lookups around the torus', () => {
    const f = new FoodField(DEFAULT_CONFIG, new Rng(1));
    expect(f.cellIndex(-1, -1)).toBe(f.cellIndex(DEFAULT_CONFIG.worldWidth - 1, DEFAULT_CONFIG.worldHeight - 1));
    expect(f.cellIndex(DEFAULT_CONFIG.worldWidth, 0)).toBe(f.cellIndex(0, 0));
  });
});

describe('World determinism (food only)', () => {
  it('same seed gives identical food after 2,000 ticks; different seed differs', () => {
    const a = new World({ seed: 11, initialPopulation: 0 });
    const b = new World({ seed: 11, initialPopulation: 0 });
    const c = new World({ seed: 12, initialPopulation: 0 });
    a.run(2000);
    b.run(2000);
    c.run(2000);
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
    expect(JSON.stringify(a.serialize().food)).not.toBe(JSON.stringify(c.serialize().food));
  });
});
