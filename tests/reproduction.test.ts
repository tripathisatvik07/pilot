import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config.ts';
import { B2_OFFSET, BRAIN_GENES, GENOME_LENGTH, mutateInto, TRAIT_OFFSET } from '../src/sim/genome.ts';
import { runHeadless } from '../src/sim/headless.ts';
import { Rng } from '../src/sim/rng.ts';
import { OUT_REPRO } from '../src/sim/world.ts';
import { emptyWorld, makeGenome, SMALL_WORLD } from './helpers.ts';

/** A genome whose brain always wants to reproduce (and does nothing else). */
function breeder(): Float32Array {
  const g = makeGenome({ reproThreshold: 0.5, size: 1, diet: 0 });
  g[B2_OFFSET + OUT_REPRO] = 3;
  return g;
}

describe('reproduction', () => {
  it('pays reproCostFraction and gives the child paid × reproEfficiency', () => {
    const w = emptyWorld({ mutationRate: 0, bigMutationChance: 0 });
    w.food.food.fill(0);
    const parent = w.addCreature(breeder(), 200, 200, 100);
    w.pool.age[parent] = 500;
    const p = w.pool;
    w.step();
    expect(w.population).toBe(2);
    const child = [...Array(p.capacity).keys()].find((s) => p.alive[s] && s !== parent)!;
    const before = 100 - p.basalRate[parent] - 0; // speed stays 0: zero thrust weights
    const paid = before * w.cfg.reproCostFraction;
    expect(p.energy[parent]).toBeCloseTo(before - paid, 6);
    // The child is born after the act phase, then also ages; it paid nothing yet.
    expect(p.energy[child]).toBeCloseTo(paid * w.cfg.reproEfficiency, 6);
    expect(p.generation[child]).toBe(1);
    expect(p.parentId[child]).toBe(p.id[parent]);
    expect(p.lineage[child]).toBe(p.lineage[parent]);
    expect(p.children[parent]).toBe(1);
    // With mutation disabled the genome is an exact copy.
    expect(Array.from(p.genomeView(child))).toEqual(Array.from(p.genomeView(parent)));
    const dist = Math.hypot(p.x[child] - p.x[parent], p.y[child] - p.y[parent]);
    expect(dist).toBeLessThanOrEqual(w.cfg.birthSpread + 1e-9);
  });

  it('respects the energy threshold, minimum age and cooldown', () => {
    const w = emptyWorld();
    w.food.food.fill(0);
    const poor = w.addCreature(breeder(), 100, 100, 40); // below 0.5 × 120
    w.pool.age[poor] = 500;
    const young = w.addCreature(breeder(), 300, 100, 110);
    w.pool.age[young] = 0;
    w.step();
    expect(w.population).toBe(2);

    const w2 = emptyWorld();
    w2.food.food.fill(0);
    const a = w2.addCreature(breeder(), 100, 100, 120);
    w2.pool.age[a] = 500;
    w2.step();
    expect(w2.population).toBe(2);
    w2.step(); // still has 60ish energy > threshold? no: 0.5×120 = 60 needed, cooldown also blocks
    expect(w2.population).toBe(2);
  });

  it('no birth when the pool is full', () => {
    const w = emptyWorld({ maxCreatures: 1 });
    w.food.food.fill(0);
    const a = w.addCreature(breeder(), 100, 100, 120);
    w.pool.age[a] = 500;
    w.step();
    expect(w.population).toBe(1);
    expect(w.pool.energy[a]).toBeGreaterThan(110); // did not pay for a child that was never born
  });
});

describe('mutation', () => {
  it('changes genes, keeps traits in [0,1] and weights within ±weightClamp', () => {
    const cfg = { ...DEFAULT_CONFIG, mutationRate: 1, traitMutationSigma: 0.5, weightMutationSigma: 3 };
    const rng = new Rng(4);
    const g = new Float32Array(GENOME_LENGTH * 2);
    for (let i = 0; i < GENOME_LENGTH; i++) g[i] = i < BRAIN_GENES ? 0 : 0.5;
    for (let k = 0; k < 50; k++) {
      mutateInto(rng, cfg, g, 0, GENOME_LENGTH);
      g.copyWithin(0, GENOME_LENGTH, GENOME_LENGTH * 2);
    }
    let changed = 0;
    for (let i = 0; i < GENOME_LENGTH; i++) {
      const v = g[i];
      if (i < BRAIN_GENES) {
        expect(Math.abs(v)).toBeLessThanOrEqual(cfg.weightClamp);
        if (v !== 0) changed++;
      } else {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        if (v !== 0.5) changed++;
      }
    }
    expect(changed).toBeGreaterThan(GENOME_LENGTH * 0.9);
  });

  it('a large mutation founds a new lineage', () => {
    const w = emptyWorld({ bigMutationChance: 1 });
    w.food.food.fill(0);
    const parent = w.addCreature(breeder(), 100, 100, 120);
    w.pool.age[parent] = 500;
    const child = w.spawnChild(parent);
    expect(w.pool.lineage[child]).toBe(w.pool.id[child]);
    expect(w.pool.lineage[child]).not.toBe(w.pool.lineage[parent]);
  });

  it('mutation is light by default: most trait genes of a child stay close to the parent', () => {
    const rng = new Rng(8);
    const g = new Float32Array(GENOME_LENGTH * 2);
    for (let i = TRAIT_OFFSET; i < GENOME_LENGTH; i++) g[i] = 0.5;
    let big = 0;
    for (let k = 0; k < 200; k++) {
      mutateInto(rng, DEFAULT_CONFIG, g, 0, GENOME_LENGTH);
      for (let i = TRAIT_OFFSET; i < GENOME_LENGTH; i++) if (Math.abs(g[GENOME_LENGTH + i] - 0.5) > 0.2) big++;
    }
    expect(big / (200 * (GENOME_LENGTH - TRAIT_OFFSET))).toBeLessThan(0.02);
  });
});

describe('headless run', () => {
  it('runs 4,000 ticks with births, generations, samples and a living population', () => {
    const res = runHeadless({ ticks: 4000, config: { seed: 2 } });
    expect(res.world.tick).toBe(4000);
    expect(res.final.population).toBeGreaterThan(0);
    expect(res.final.maxGeneration).toBeGreaterThan(2);
    expect(res.world.stats.state.totalBirths).toBeGreaterThan(100);
    expect(res.world.stats.samples.length).toBe(4000 / res.world.cfg.statsInterval + 1);
    expect(res.maxPopulation).toBeLessThan(res.world.cfg.maxCreatures);
  });

  it('is deterministic: two headless runs give identical samples', () => {
    const a = runHeadless({ ticks: 1500, config: { ...SMALL_WORLD, seed: 3 } });
    const b = runHeadless({ ticks: 1500, config: { ...SMALL_WORLD, seed: 3 } });
    expect(JSON.stringify(a.world.stats.samples)).toBe(JSON.stringify(b.world.stats.samples));
  });
});
