// The World owns all simulation state and advances it with a fixed timestep. Nothing in
// here touches the DOM or wall-clock time, so the same code runs in the browser, in Node
// scripts and in tests, and a given seed always produces the same history.

import { forward } from './brain.ts';
import { INPUTS_PER_RAY, type SimConfig, TRAITS, VISION_RAYS, withDefaults } from './config.ts';
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
  mutateInto,
  randomGenome,
  TRAIT_INDEX,
  TRAIT_OFFSET,
} from './genome.ts';
import { normAngle, TAU, wrap } from './geometry.ts';
import { Rng } from './rng.ts';
import { SpatialHash } from './spatial.ts';
import { Stats, type StatsState } from './stats.ts';

/** Largest possible body size; bounds the neighbour search for attack targets. */
const MAX_SIZE = TRAITS[TRAIT_INDEX.size].max;

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
  stats: StatsState;
}

export class World {
  readonly cfg: SimConfig;
  readonly rng: Rng;
  readonly food: FoodField;
  readonly pool: CreaturePool;
  readonly hash: SpatialHash;
  readonly stats: Stats;
  tick = 0;
  /** Next creature id to hand out (ids are never reused, unlike slots). */
  nextId = 1;
  // Per-ray scratch for sense(); reused to avoid allocating every call.
  private readonly nearD2 = new Float64Array(VISION_RAYS);
  private readonly nearSlot = new Int32Array(VISION_RAYS);
  private readonly parents: Int32Array;

  constructor(config: Partial<SimConfig> = {}, populate = true) {
    this.cfg = withDefaults(config);
    this.rng = new Rng(this.cfg.seed);
    this.food = new FoodField(this.cfg, this.rng);
    this.pool = new CreaturePool(this.cfg.maxCreatures);
    this.hash = new SpatialHash(this.cfg.worldWidth, this.cfg.worldHeight, this.cfg.hashCellSize, this.cfg.maxCreatures);
    this.stats = new Stats(this.cfg);
    this.parents = new Int32Array(this.cfg.maxCreatures);
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
    this.reproduce();
    this.ageAndDie();
    if (this.cfg.immigrationFloor > 0 && this.pool.count < this.cfg.immigrationFloor) {
      const n = this.cfg.immigrationFloor - this.pool.count;
      this.spawnFounders(n);
      this.stats.log(this.tick, 'immigration', `${n} founders immigrated (population below floor)`);
    }
    this.tick++;
    if (this.tick % this.cfg.statsInterval === 0) this.recordSample();
  }

  /** Take a sample unless one was already taken at this exact tick. */
  recordSampleIfNeeded(): void {
    const last = this.stats.latest();
    if (!last || last.tick !== this.tick) this.recordSample();
  }

  /** Take a stats sample now (also used by the UI right after reset/load). */
  recordSample(): void {
    this.stats.sample(this.tick, this.pool, this.food.total(), this.food.seasonFactor(this.tick));
  }

  /** Run n ticks. */
  run(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /**
   * Sense + think for every creature. All creatures perceive the same snapshot (positions
   * are not touched here), so slot order gives nobody an information advantage.
   */
  private think(): void {
    const p = this.pool;
    const hash = this.hash;
    hash.build(p.alive, p.x, p.y);
    for (let s = 0; s < p.capacity; s++) {
      if (!p.alive[s]) continue;
      this.sense(s);
      forward(p.genomes, s * GENOME_LENGTH, p.act, s * ACT_STRIDE);
    }
  }

  /** Fill the brain inputs of slot s and find its attack target. */
  sense(s: number): void {
    const p = this.pool;
    const cfg = this.cfg;
    const food = this.food;
    const hash = this.hash;
    const W = cfg.worldWidth;
    const H = cfg.worldHeight;
    const act = p.act;
    const a0 = s * ACT_STRIDE;
    const x = p.x[s];
    const y = p.y[s];
    const heading = p.heading[s];
    const range = p.visionRange[s];
    const fov = p.fov[s];
    const halfFov = fov * 0.5;
    const n = VISION_RAYS;

    // --- Food along each ray: nearer samples count more, so "food ahead, close" > "far".
    const samples = cfg.raySamples;
    const invMax = 1 / cfg.foodMax;
    for (let k = 0; k < n; k++) {
      const a = heading - halfFov + (fov * (k + 0.5)) / n;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      let best = 0;
      for (let j = 1; j <= samples; j++) {
        const d = (range * j) / samples;
        const v = food.food[food.cellIndex(x + cx * d, y + cy * d)] * invMax * (1 - (0.5 * (j - 1)) / samples);
        if (v > best) best = v;
      }
      act[a0 + k * INPUTS_PER_RAY] = best > 1 ? 1 : best;
    }

    // --- Creatures: nearest one per ray sector, plus the nearest attackable one in front.
    const nearD2 = this.nearD2;
    const nearSlot = this.nearSlot;
    const range2 = range * range;
    for (let k = 0; k < n; k++) {
      nearD2[k] = range2;
      nearSlot[k] = -1;
    }
    const myRadius = p.size[s] * cfg.bodyRadius;
    let target = -1;
    let targetD2 = Infinity;
    const cone = cfg.attackCone;
    const maxReach = myRadius + 2 * cfg.bodyRadius * MAX_SIZE + cfg.attackReach;
    const radius = range > maxReach ? range : maxReach;
    const radius2 = radius * radius;

    // Inline version of SpatialHash.forEachNear: this is the hottest loop in the program and
    // avoiding a closure call per neighbour roughly halves its cost.
    const cols = hash.cols;
    const rows = hash.rows;
    let c0 = Math.floor((x - radius) / hash.cellW);
    let c1 = Math.floor((x + radius) / hash.cellW);
    let r0 = Math.floor((y - radius) / hash.cellH);
    let r1 = Math.floor((y + radius) / hash.cellH);
    if (c1 - c0 + 1 >= cols) {
      c0 = 0;
      c1 = cols - 1;
    }
    if (r1 - r0 + 1 >= rows) {
      r0 = 0;
      r1 = rows - 1;
    }
    const start = hash.cellStart;
    const items = hash.cellItems;
    const halfW = W * 0.5;
    const halfH = H * 0.5;
    for (let r = r0; r <= r1; r++) {
      const rr = r < 0 ? r + rows : r >= rows ? r - rows : r;
      for (let c = c0; c <= c1; c++) {
        const cc = c < 0 ? c + cols : c >= cols ? c - cols : c;
        const cell = rr * cols + cc;
        const end = start[cell + 1];
        for (let it = start[cell]; it < end; it++) {
          const o = items[it];
          if (o === s) continue;
          let dx = p.x[o] - x;
          if (dx >= halfW) dx -= W;
          else if (dx < -halfW) dx += W;
          let dy = p.y[o] - y;
          if (dy >= halfH) dy -= H;
          else if (dy < -halfH) dy += H;
          const d2 = dx * dx + dy * dy;
          if (d2 >= radius2) continue; // most neighbours fail here, before the atan2
          const rel = normAngle(Math.atan2(dy, dx) - heading);
          // Attack target: within reach (body radii + attackReach) and inside the front cone.
          if (rel > -cone && rel < cone && d2 < targetD2) {
            const reach = myRadius + p.size[o] * cfg.bodyRadius + cfg.attackReach;
            if (d2 < reach * reach) {
              target = o;
              targetD2 = d2;
            }
          }
          if (d2 < range2) {
            const t = rel + halfFov;
            if (t >= 0 && t < fov) {
              let k = Math.floor((t / fov) * n);
              if (k >= n) k = n - 1;
              if (d2 < nearD2[k]) {
                nearD2[k] = d2;
                nearSlot[k] = o;
              }
            }
          }
        }
      }
    }
    p.target[s] = target;

    const mySize = p.size[s];
    for (let k = 0; k < n; k++) {
      const base = a0 + k * INPUTS_PER_RAY;
      const o = nearSlot[k];
      if (o < 0) {
        // Nothing seen: closeness 0 and relative size 0 read as "empty".
        act[base + 1] = 0;
        act[base + 2] = 0;
      } else {
        act[base + 1] = 1 - Math.sqrt(nearD2[k]) / range;
        // (other − me)/(other + me): +ve = bigger than me (danger?), −ve = smaller (prey?).
        act[base + 2] = (p.size[o] - mySize) / (p.size[o] + mySize);
      }
    }

    // --- Internal state.
    const e = a0 + VISION_RAYS * INPUTS_PER_RAY;
    act[e] = p.energy[s] / p.maxEnergy[s];
    act[e + 1] = p.speed[s] / p.maxSpeed[s];
    act[e + 2] = 1; // bias
    act[e + 3] = Math.sin((TAU * p.age[s]) / cfg.oscillatorPeriod);
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
      if (p.attackTimer[s] > 0) p.attackTimer[s]--;
      if (p.reproTimer[s] > 0) p.reproTimer[s]--;

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

  /**
   * Asexual reproduction. Parents are collected first and born afterwards so a newborn
   * landing in a later slot cannot itself be considered in the same tick.
   */
  private reproduce(): void {
    const p = this.pool;
    const cfg = this.cfg;
    const parents = this.parents;
    let n = 0;
    for (let s = 0; s < p.capacity; s++) {
      if (!p.alive[s]) continue;
      if (
        p.act[s * ACT_STRIDE + ACT_OUTPUT + OUT_REPRO] > 0 &&
        p.energy[s] > p.reproThreshold[s] * p.maxEnergy[s] &&
        p.age[s] >= cfg.minReproAge &&
        p.reproTimer[s] <= 0
      ) {
        parents[n++] = s;
      }
    }
    for (let k = 0; k < n; k++) {
      if (this.spawnChild(parents[k]) < 0) break; // pool full: nobody else can breed this tick
    }
  }

  /** Create one mutated offspring of `parent`. Returns the child slot or -1 if full. */
  spawnChild(parent: number): number {
    const p = this.pool;
    const cfg = this.cfg;
    const rng = this.rng;
    const child = p.allocate();
    if (child < 0) return -1;
    const big = mutateInto(rng, cfg, p.genomes, parent * GENOME_LENGTH, child * GENOME_LENGTH);
    const angle = rng.range(-Math.PI, Math.PI);
    const dist = rng.range(0, cfg.birthSpread);
    this.initSlot(
      child,
      p.x[parent] + Math.cos(angle) * dist,
      p.y[parent] + Math.sin(angle) * dist,
      p.id[parent],
      p.generation[parent] + 1,
    );
    // A large mutation is a big enough jump to call it a new lineage.
    p.lineage[child] = big ? p.id[child] : p.lineage[parent];
    const paid = p.energy[parent] * cfg.reproCostFraction;
    p.energy[parent] -= paid;
    p.energy[child] = Math.min(paid * cfg.reproEfficiency, p.maxEnergy[child]);
    p.reproTimer[parent] = cfg.reproCooldown;
    p.children[parent]++;
    this.stats.onBirth(this.tick, p.diet[child], p.generation[child], p.id[child]);
    return child;
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
  kill(slot: number, byPredator = false): void {
    const p = this.pool;
    this.stats.onDeath(byPredator);
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
      stats: structuredClone(this.stats.state),
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
    w.stats.state = structuredClone(snap.stats);
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
