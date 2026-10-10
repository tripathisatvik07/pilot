import { describe, expect, it } from 'vitest';
import { ACT_OUTPUT, ACT_STRIDE } from '../src/sim/creatures.ts';
import { moveCost, OUT_EAT, OUT_THRUST, World } from '../src/sim/world.ts';
import { emptyWorld, makeGenome } from './helpers.ts';

function outputs(w: World, s: number): Float32Array {
  return w.pool.act.subarray(s * ACT_STRIDE + ACT_OUTPUT, s * ACT_STRIDE + ACT_OUTPUT + 4);
}

describe('energy accounting', () => {
  it('energy change = plant eaten − basal − movement, exactly', () => {
    const w = emptyWorld({ turnRateMax: 0 });
    const s = w.addCreature(makeGenome({ size: 1.2, diet: 0 }), 100, 100, 40);
    const cell = w.food.cellIndex(100, 100);
    w.food.food.fill(0);
    w.food.food[cell] = 10;
    const p = w.pool;
    for (let t = 0; t < 20; t++) {
      const e0 = p.energy[s];
      const totalFood0 = w.food.total();
      w.step();
      const out = outputs(w, s);
      const eaten = totalFood0 - w.food.total();
      if (out[OUT_EAT] <= 0) expect(eaten).toBe(0);
      const v = p.speed[s];
      const expected = e0 - p.basalRate[s] - moveCost(w.cfg, p.size[s], v) + eaten;
      expect(p.energy[s]).toBeCloseTo(expected, 4);
      expect(v).toBeLessThanOrEqual(p.maxSpeed[s] * Math.max(0, out[OUT_THRUST]) + 1e-9 + p.maxSpeed[s]);
    }
  });

  it('a pure carnivore cannot digest plants', () => {
    const w = emptyWorld();
    w.addCreature(makeGenome({ diet: 1 }), 100, 100, 40);
    const before = w.food.total();
    w.run(50);
    expect(w.food.total()).toBe(before);
  });

  it('energy never exceeds max energy', () => {
    const w = emptyWorld();
    const s = w.addCreature(makeGenome({ diet: 0 }), 100, 100, 1000);
    w.step();
    expect(w.pool.energy[s]).toBeLessThanOrEqual(w.pool.maxEnergy[s]);
  });
});

describe('toroidal wrapping', () => {
  it('moving off the right/bottom edge reappears on the left/top', () => {
    const w = emptyWorld({ turnRateMax: 0, speedResponse: 0 });
    const W = w.cfg.worldWidth;
    const H = w.cfg.worldHeight;
    const s = w.addCreature(makeGenome(), W - 0.5, H - 0.5, 50, Math.PI / 4);
    w.pool.speed[s] = 2;
    w.step();
    expect(w.pool.x[s]).toBeGreaterThanOrEqual(0);
    expect(w.pool.x[s]).toBeLessThan(2);
    expect(w.pool.y[s]).toBeGreaterThanOrEqual(0);
    expect(w.pool.y[s]).toBeLessThan(2);
  });

  it('moving off the left edge reappears on the right', () => {
    const w = emptyWorld({ turnRateMax: 0, speedResponse: 0 });
    const s = w.addCreature(makeGenome(), 0.5, 10, 50, Math.PI);
    w.pool.speed[s] = 2;
    w.step();
    expect(w.pool.x[s]).toBeGreaterThan(w.cfg.worldWidth - 2);
    expect(w.pool.x[s]).toBeLessThan(w.cfg.worldWidth);
  });
});

describe('death and food drop', () => {
  it('starvation kills and drops corpseDropFraction × body energy', () => {
    const w = emptyWorld();
    w.food.food.fill(0);
    const s = w.addCreature(makeGenome({ size: 1.5, diet: 1 }), 300, 300, 0.0001);
    const size = w.pool.size[s];
    w.step();
    expect(w.pool.alive[s]).toBe(0);
    expect(w.population).toBe(0);
    const expected = w.cfg.corpseDropFraction * w.cfg.bodyEnergy * size;
    expect(w.food.total()).toBeCloseTo(expected, 3);
    expect(w.food.sample(300, 300)).toBeCloseTo(expected, 3);
  });

  it('old age kills and the leftover energy is part of the carcass', () => {
    const w = emptyWorld();
    w.food.food.fill(0);
    const s = w.addCreature(makeGenome({ size: 1, diet: 1 }), 50, 50, 60);
    w.pool.age[s] = w.cfg.maxAge;
    w.step();
    expect(w.pool.alive[s]).toBe(0);
    // Energy just before death = 60 − one tick of costs; the carcass is body + that energy.
    const p = w.pool;
    const left = 60 - p.basalRate[s] - moveCost(w.cfg, p.size[s], p.speed[s]);
    const expected = w.cfg.corpseDropFraction * (w.cfg.bodyEnergy * p.size[s] + left);
    expect(w.food.total()).toBeCloseTo(expected, 3);
  });

  it('freed slots are reused', () => {
    const w = emptyWorld();
    w.food.food.fill(0);
    const a = w.addCreature(makeGenome(), 10, 10, 0.0001);
    w.step();
    expect(w.pool.alive[a]).toBe(0);
    const b = w.addCreature(makeGenome(), 10, 10, 50);
    expect(b).toBe(a);
  });
});

describe('world determinism with creatures', () => {
  it('same seed gives byte-identical state after 5,000 ticks', () => {
    const a = new World({ seed: 99 });
    const b = new World({ seed: 99 });
    a.run(5000);
    b.run(5000);
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });

  it('save → load → continue equals an uninterrupted run', () => {
    const a = new World({ seed: 5 });
    a.run(1500);
    const b = World.deserialize(JSON.parse(JSON.stringify(a.serialize())));
    a.run(1500);
    b.run(1500);
    expect(JSON.stringify(b.serialize())).toBe(JSON.stringify(a.serialize()));
  });
});
