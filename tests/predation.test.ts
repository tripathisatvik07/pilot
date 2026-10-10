import { describe, expect, it } from 'vitest';
import { ACT_STRIDE } from '../src/sim/creatures.ts';
import { B2_OFFSET } from '../src/sim/genome.ts';
import { OUT_EAT } from '../src/sim/world.ts';
import { emptyWorld, makeGenome } from './helpers.ts';

/** A genome whose eat/attack output is always on. */
function hunter(diet: number, size = 1): Float32Array {
  const g = makeGenome({ diet, size, metabolism: 1 });
  g[B2_OFFSET + OUT_EAT] = 3;
  return g;
}

function setup(attackerDiet: number, victimEnergy = 50, attackerSize = 1, victimSize = 1) {
  const w = emptyWorld({ turnRateMax: 0 });
  w.food.food.fill(0);
  const a = w.addCreature(hunter(attackerDiet, attackerSize), 100, 100, 50, 0);
  const v = w.addCreature(makeGenome({ size: victimSize, diet: 0 }), 108, 100, victimEnergy, 0);
  return { w, a, v };
}

describe('predation', () => {
  it('a carnivore damages prey in front of it and absorbs part of the damage', () => {
    const { w, a, v } = setup(1);
    const p = w.pool;
    const cfg = w.cfg;
    const eff = p.meatEff[a];
    w.step();
    const dmg = cfg.attackDamage * p.size[a] * p.metabolism[a] * eff * 1; // equal sizes
    expect(p.alive[v]).toBe(1);
    expect(p.energy[v]).toBeCloseTo(50 - dmg - p.basalRate[v], 4);
    const expectedA = 50 - p.basalRate[a] - cfg.attackCost * p.size[a] * eff + dmg * cfg.meatTransfer;
    expect(p.energy[a]).toBeCloseTo(expectedA, 4);
    expect(p.attackTimer[a]).toBe(cfg.attackCooldown);
  });

  it('attacks respect the cooldown', () => {
    const { w, a, v } = setup(1, 100);
    const p = w.pool;
    w.step();
    const e1 = p.energy[v];
    w.step();
    // Only basal metabolism, no second bite while the attacker is on cooldown.
    expect(p.energy[v]).toBeCloseTo(e1 - p.basalRate[v], 4);
    void a;
  });

  it('a kill removes the victim, counts the kill and lets the predator feast', () => {
    const { w, a, v } = setup(1, 1);
    const p = w.pool;
    const cfg = w.cfg;
    const vSize = p.size[v];
    const eff = p.meatEff[a];
    w.step();
    expect(p.alive[v]).toBe(0);
    expect(p.kills[a]).toBe(1);
    expect(w.stats.state.totalKills).toBe(1);
    const gain = 1 * cfg.meatTransfer + cfg.bodyEnergy * vSize * cfg.killFeastFraction * eff;
    expect(p.energy[a]).toBeCloseTo(50 - p.basalRate[a] - cfg.attackCost * p.size[a] * eff + gain, 4);
    // The uneaten remainder of the body fertilises the soil.
    expect(w.food.total()).toBeCloseTo(cfg.bodyEnergy * vSize * (1 - cfg.killFeastFraction) * cfg.corpseDropFraction, 3);
  });

  it('herbivores do not attack', () => {
    const { w, v } = setup(0);
    const p = w.pool;
    w.step();
    expect(p.energy[v]).toBeCloseTo(50 - p.basalRate[v], 6);
  });

  it('bigger attackers hit harder (size ratio)', () => {
    const small = setup(1, 100, 1, 2);
    const big = setup(1, 100, 2, 1);
    small.w.step();
    big.w.step();
    const lossSmall = 100 - small.w.pool.energy[small.v];
    const lossBig = 100 - big.w.pool.energy[big.v];
    expect(lossBig).toBeGreaterThan(lossSmall * 3);
  });

  it('out-of-reach prey is safe', () => {
    const w = emptyWorld({ turnRateMax: 0 });
    w.food.food.fill(0);
    w.addCreature(hunter(1), 100, 100, 50, 0);
    const v = w.addCreature(makeGenome({ diet: 0 }), 140, 100, 50, 0);
    w.step();
    expect(w.pool.energy[v]).toBeCloseTo(50 - w.pool.basalRate[v], 6);
  });
});

describe('carrion', () => {
  it('deaths leave carrion that only meat-eaters can eat, and it rots', () => {
    const w = emptyWorld({ carrionFraction: 0.5, carrionDecay: 0.01 });
    w.food.food.fill(0);
    const victim = w.addCreature(makeGenome({ size: 1 }), 400, 400, 0.0001);
    w.step();
    expect(w.pool.alive[victim]).toBe(0);
    const ci = w.food.cellIndex(400, 400);
    const left = w.food.meat[ci];
    expect(left).toBeCloseTo(w.cfg.bodyEnergy * 1 * 0.5, 3);
    w.step(); // nobody around: only decay
    expect(w.food.meat[ci]).toBeCloseTo(left * 0.99, 3);

    const herb = w.addCreature(hunter(0), 400, 400, 20);
    const carn = w.addCreature(hunter(1), 400, 400, 20);
    const before = w.food.meat[ci];
    w.step();
    const p = w.pool;
    const bite = w.cfg.biteSize * p.size[carn] * p.metabolism[carn] * p.meatEff[carn];
    // The carnivore bit once (and may also have attacked the herbivore, which is fine);
    // the herbivore could not digest any carrion.
    expect(before * 0.99 - w.food.meat[ci]).toBeCloseTo(bite, 3);
    expect(p.energy[herb]).toBeLessThan(20);
  });

  it('a carnivore "sees" carrion as food on its rays, a herbivore does not', () => {
    const w = emptyWorld();
    w.food.food.fill(0);
    w.food.meat[w.food.cellIndex(325, 305)] = w.cfg.foodMax;
    const carn = w.addCreature(makeGenome({ visionRange: 60, fov: 2, diet: 1 }), 305, 305, 50, 0);
    const herb = w.addCreature(makeGenome({ visionRange: 60, fov: 2, diet: 0 }), 305, 305, 50, 0);
    w.hash.build(w.pool.alive, w.pool.x, w.pool.y);
    w.sense(carn);
    w.sense(herb);
    expect(w.pool.act[carn * ACT_STRIDE + 2 * 3]).toBeCloseTo(1, 5);
    expect(w.pool.act[herb * ACT_STRIDE + 2 * 3]).toBe(0);
  });
});
