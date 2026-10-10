// The World owns all simulation state and advances it with a fixed timestep. Nothing in
// here touches the DOM or wall-clock time, so the same code runs in the browser, in Node
// scripts and in tests, and a given seed always produces the same history.

import { type SimConfig, withDefaults } from './config.ts';
import {
  ACT_OUTPUT,
  ACT_STRIDE,
  CreaturePool,
  FLOAT_FIELDS,
  INT_FIELDS,
} from './creatures.ts';
import { FoodField } from './food.ts';
import {
  brainComplexity,
  decodeTrait,
  GENOME_LENGTH,
  randomGenome,
  TRAIT_INDEX,
  TRAIT_OFFSET,
} from './genome.ts';
import { normAngle, wrap } from './geometry.ts';
import { Rng } from './rng.ts';

export const SAVE_FORMAT_VERSION = 1;

/** Output neuron indices. */
export const OUT_TURN = 0;
export const OUT_THRUST = 1;
export const OUT_EAT = 2;
export const OUT_REPRO = 3;

export interface CreatureRecord {
  slot: number;
  f: Record<string, number>;
  i: Record<string, number>;
  genome: number[];
  act: number[];
}

export interface WorldSnapshot {
  version: number;
  config: SimConfig;
  tick: number;
  rngState: number;
  nextId: number;
  food: number[];
  freeList: number[];
  creatures: CreatureRecord[];
}

export class World {
  readonly cfg: SimConfig;
  readonly rng: Rng;
  readonly food: FoodField;
  readonly pool: CreaturePool;
  tick = 0;
  /** Next creature id to hand out (ids are never reused, unlike slots). */
  nextId = 1;

  constructor(config: Partial<SimConfig> = {}, populate = true) {
    this.cfg = withDefaults(config);
    this.rng = new Rng(this.cfg.seed);
    this.food = new FoodField(this.cfg, this.rng);
    this.pool = new CreaturePool(this.cfg.maxCreatures);
    if (populate) this.spawnFounders(this.cfg.initialPopulation);
  }

  // ------------------------------------------------------------------------------------
  // Creation
  // ------------------------------------------------------------------------------------

  /** Spawn `n` random founders anywhere in the world. */
  spawnFounders(n: number): void {
    const cfg = this.cfg;
    const rng = this.rng;
    for (let k = 0; k < n; k++) {
      const slot = this.pool.allocate();
      if (slot < 0) return;
      const carnivore = rng.next() < cfg.initialCarnivoreFraction;
      // Founders are clear specialists: with convex diet trade-offs a 50/50 founder would
      // be bad at both and die immediately, wasting the founding population.
      const dietGene = carnivore ? rng.range(0.8, 1) : rng.range(0, 0.15);
      randomGenome(rng, cfg, this.pool.genomes, slot * GENOME_LENGTH, dietGene);
      this.initSlot(slot, rng.range(0, cfg.worldWidth), rng.range(0, cfg.worldHeight), 0, 0);
      // Stagger founder ages so they do not all die of old age in the same tick.
      this.pool.age[slot] = rng.range(0, cfg.maxAge * 0.5);
      this.pool.energy[slot] = this.pool.maxEnergy[slot] * cfg.initialEnergyFraction;
      this.pool.lineage[slot] = this.pool.id[slot];
    }
  }

  /**
   * Add one creature with an explicit genome (used by tests and tools). Returns its slot,
   * or -1 if the pool is full.
   */
  addCreature(genome: ArrayLike<number>, x: number, y: number, energy: number, heading = 0): number {
    const slot = this.pool.allocate();
    if (slot < 0) return -1;
    this.pool.genomes.set(genome, slot * GENOME_LENGTH);
    this.initSlot(slot, x, y, 0, 0);
    this.pool.heading[slot] = heading;
    this.pool.energy[slot] = Math.min(energy, this.pool.maxEnergy[slot]);
    this.pool.lineage[slot] = this.pool.id[slot];
    return slot;
  }

  /** Reset all per-slot fields for a freshly allocated slot whose genome is already written. */
  private initSlot(slot: number, x: number, y: number, parentId: number, generation: number): void {
    const p = this.pool;
    p.x[slot] = wrap(x, this.cfg.worldWidth);
    p.y[slot] = wrap(y, this.cfg.worldHeight);
    p.heading[slot] = this.rng.range(-Math.PI, Math.PI);
    p.speed[slot] = 0;
    p.energy[slot] = 0;
    p.age[slot] = 0;
    p.attackTimer[slot] = 0;
    p.reproTimer[slot] = 0;
    p.id[slot] = this.nextId++;
    p.parentId[slot] = parentId;
    p.generation[slot] = generation;
    p.lineage[slot] = 0;
    p.children[slot] = 0;
    p.kills[slot] = 0;
    p.act.fill(0, slot * ACT_STRIDE, (slot + 1) * ACT_STRIDE);
    this.deriveTraits(slot);
  }

  /** Decode traits and precompute per-creature constants from the genome. */
  deriveTraits(slot: number): void {
    const p = this.pool;
    const cfg = this.cfg;
    const g = p.genomes;
    const base = slot * GENOME_LENGTH + TRAIT_OFFSET;
    const trait = (k: keyof typeof TRAIT_INDEX) => decodeTrait(TRAIT_INDEX[k], g[base + TRAIT_INDEX[k]]);
    const size = trait('size');
    p.size[slot] = size;
    p.maxSpeed[slot] = trait('maxSpeed');
    p.visionRange[slot] = trait('visionRange');
    p.fov[slot] = trait('fov');
    p.metabolism[slot] = trait('metabolism');
    p.diet[slot] = trait('diet');
    p.reproThreshold[slot] = trait('reproThreshold');
    p.maxEnergy[slot] = cfg.energyPerSize * size;
    p.plantEff[slot] = Math.pow(1 - p.diet[slot], cfg.plantDietExponent);
    p.meatEff[slot] = Math.pow(p.diet[slot], cfg.meatDietExponent);
    p.basalRate[slot] = basalRate(cfg, size, p.metabolism[slot], p.visionRange[slot], p.maxSpeed[slot],
      brainComplexity(g, slot * GENOME_LENGTH));
  }

  // ------------------------------------------------------------------------------------
  // Tick
  // ------------------------------------------------------------------------------------

  /** Advance the simulation by exactly one fixed timestep. */
  step(): void {
    this.food.update(this.tick);
    this.think();
    this.act();
    this.ageAndDie();
    this.tick++;
  }

  /** Run n ticks. */
  run(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /**
   * Placeholder brain (milestone 2): a correlated random walk that always tries to eat.
   * Replaced by the neural network in milestone 3.
   */
  private think(): void {
    const p = this.pool;
    for (let s = 0; s < p.capacity; s++) {
      if (!p.alive[s]) continue;
      const o = s * ACT_STRIDE + ACT_OUTPUT;
      const turn = p.act[o + OUT_TURN] * 0.9 + this.rng.gaussian() * 0.3;
      p.act[o + OUT_TURN] = Math.max(-1, Math.min(1, turn));
      p.act[o + OUT_THRUST] = 0.5;
      p.act[o + OUT_EAT] = 1;
      p.act[o + OUT_REPRO] = -1;
    }
  }

  /** Apply outputs: turn, move, pay energy, eat. */
  private act(): void {
    const p = this.pool;
    const cfg = this.cfg;
    const W = cfg.worldWidth;
    const H = cfg.worldHeight;
    for (let s = 0; s < p.capacity; s++) {
      if (!p.alive[s]) continue;
      const o = s * ACT_STRIDE + ACT_OUTPUT;
      const turn = p.act[o + OUT_TURN];
      const thrust = p.act[o + OUT_THRUST];
      const eat = p.act[o + OUT_EAT];

      // Movement: speed eases toward the commanded speed, giving bodies some inertia.
      p.heading[s] = normAngle(p.heading[s] + turn * cfg.turnRateMax);
      const target = (thrust > 0 ? thrust : 0) * p.maxSpeed[s];
      const v = p.speed[s] + (target - p.speed[s]) * cfg.speedResponse;
      p.speed[s] = v;
      p.x[s] = wrap(p.x[s] + Math.cos(p.heading[s]) * v, W);
      p.y[s] = wrap(p.y[s] + Math.sin(p.heading[s]) * v, H);

      // Energy out: basal metabolism + kinetic cost (quadratic, so sprinting is expensive).
      p.energy[s] -= p.basalRate[s] + moveCost(cfg, p.size[s], v);

      // Energy in: graze the cell underfoot. Diet limits how much plant matter can be
      // processed, so carnivores barely dent the food supply.
      if (eat > 0) {
        const want = cfg.biteSize * p.size[s] * p.metabolism[s] * p.plantEff[s];
        const room = p.maxEnergy[s] - p.energy[s];
        if (want > 0 && room > 0) {
          const got = this.food.take(this.food.cellIndex(p.x[s], p.y[s]), want < room ? want : room);
          p.energy[s] += got;
        }
      }
    }
  }

  /** Age everyone; remove the starved and the old, returning part of their body to the soil. */
  private ageAndDie(): void {
    const p = this.pool;
    const cfg = this.cfg;
    for (let s = 0; s < p.capacity; s++) {
      if (!p.alive[s]) continue;
      p.age[s] += 1;
      if (p.energy[s] <= 0 || p.age[s] > cfg.maxAge) this.kill(s);
    }
  }

  /** Remove a creature and drop part of its carcass into the food field. */
  kill(slot: number): void {
    const p = this.pool;
    const carcass = this.carcassEnergy(slot);
    this.food.deposit(p.x[slot], p.y[slot], carcass * this.cfg.corpseDropFraction);
    p.release(slot);
  }

  /** Energy in a dead body: structural body energy plus whatever reserve was left. */
  carcassEnergy(slot: number): number {
    const p = this.pool;
    return this.cfg.bodyEnergy * p.size[slot] + Math.max(0, p.energy[slot]);
  }

  // ------------------------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------------------------

  get population(): number {
    return this.pool.count;
  }

  // ------------------------------------------------------------------------------------
  // Serialisation
  // ------------------------------------------------------------------------------------

  /** Plain-JSON snapshot of the complete state; enough to resume bit-for-bit. */
  serialize(): WorldSnapshot {
    const p = this.pool;
    const creatures: CreatureRecord[] = [];
    for (let s = 0; s < p.capacity; s++) {
      if (!p.alive[s]) continue;
      const f: Record<string, number> = {};
      const i: Record<string, number> = {};
      for (const k of FLOAT_FIELDS) f[k] = p[k][s];
      for (const k of INT_FIELDS) i[k] = p[k][s];
      creatures.push({
        slot: s,
        f,
        i,
        genome: Array.from(p.genomeView(s)),
        act: Array.from(p.act.subarray(s * ACT_STRIDE, (s + 1) * ACT_STRIDE)),
      });
    }
    return {
      version: SAVE_FORMAT_VERSION,
      config: { ...this.cfg },
      tick: this.tick,
      rngState: this.rng.state,
      nextId: this.nextId,
      food: Array.from(this.food.food),
      freeList: p.freeList(),
      creatures,
    };
  }

  static deserialize(snap: WorldSnapshot): World {
    if (snap.version !== SAVE_FORMAT_VERSION) {
      throw new Error(`Unsupported save version ${snap.version} (expected ${SAVE_FORMAT_VERSION})`);
    }
    // Rebuilding from config regenerates the static fertility map deterministically; every
    // piece of dynamic state is then overwritten from the snapshot.
    const w = new World(snap.config, false);
    w.tick = snap.tick;
    w.rng.state = snap.rngState >>> 0;
    w.nextId = snap.nextId;
    w.food.food.set(snap.food);
    const p = w.pool;
    p.resetFreeList();
    for (const c of snap.creatures) {
      const s = c.slot;
      p.alive[s] = 1;
      p.count++;
      for (const k of FLOAT_FIELDS) p[k][s] = c.f[k];
      for (const k of INT_FIELDS) p[k][s] = c.i[k];
      p.genomes.set(c.genome, s * GENOME_LENGTH);
      p.act.set(c.act, s * ACT_STRIDE);
      w.deriveTraits(s);
    }
    p.restoreFreeList(snap.freeList);
    return w;
  }
}

/** Energy burned per tick at rest. Exported so tests can check the accounting exactly. */
export function basalRate(
  cfg: SimConfig,
  size: number,
  metabolism: number,
  visionRange: number,
  maxSpeed: number,
  complexity: number,
): number {
  return (
    cfg.basalCost *
    size *
    metabolism *
    (1 +
      cfg.brainCostCoef * complexity +
      (cfg.visionCostCoef * visionRange) / 100 +
      cfg.speedTraitCostCoef * maxSpeed)
  );
}

/** Kinetic energy cost of moving at speed v for one tick. */
export function moveCost(cfg: SimConfig, size: number, v: number): number {
  return cfg.moveCostCoef * size * v * v;
}
