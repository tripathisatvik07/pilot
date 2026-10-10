// Plant food lives on a coarse grid rather than as individual pellets: it keeps the cost of
// food constant regardless of how much there is, and makes "grazing pressure" a natural
// consequence of many creatures sharing one cell.

import type { SimConfig } from './config.ts';
import { TileableNoise } from './noise.ts';
import type { Rng } from './rng.ts';
import { wrap } from './geometry.ts';

export class FoodField {
  readonly cols: number;
  readonly rows: number;
  readonly cellW: number;
  readonly cellH: number;
  /** Plant energy per cell. */
  readonly food: Float32Array;
  /** Static 0..1 fertility per cell; scales each cell's carrying capacity. */
  readonly fertility: Float32Array;
  /** Carrion (meat) energy per cell, left by carcasses; only meat-eaters can digest it. */
  readonly meat: Float32Array;
  private readonly cfg: SimConfig;

  constructor(cfg: SimConfig, rng: Rng) {
    this.cfg = cfg;
    this.cols = cfg.foodCols;
    this.rows = cfg.foodRows;
    this.cellW = cfg.worldWidth / this.cols;
    this.cellH = cfg.worldHeight / this.rows;
    const n = this.cols * this.rows;
    this.food = new Float32Array(n);
    this.fertility = new Float32Array(n);
    this.meat = new Float32Array(n);

    const noise = new TileableNoise(rng, cfg.fertilityNoiseScale, cfg.worldHeight / cfg.worldWidth);
    const raw = new Float64Array(n);
    let lo = Infinity;
    let hi = -Infinity;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v = noise.sample((c + 0.5) / this.cols, (r + 0.5) / this.rows);
        raw[r * this.cols + c] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    // Normalise so every seed gets the full fertility range: otherwise an unlucky seed
    // could produce a uniformly mediocre world with no real oases.
    const span = hi - lo || 1;
    for (let i = 0; i < n; i++) {
      const t = Math.pow((raw[i] - lo) / span, cfg.fertilityContrast);
      this.fertility[i] = cfg.fertilityMin + (1 - cfg.fertilityMin) * t;
      this.food[i] = cfg.foodMax * this.fertility[i] * cfg.foodInitialFraction;
    }
  }

  /** Regrowth multiplier for a given tick: >1 in summer, <1 in winter. */
  seasonFactor(tick: number): number {
    if (this.cfg.seasonPeriod <= 0) return 1;
    return 1 + this.cfg.seasonAmplitude * Math.sin((2 * Math.PI * tick) / this.cfg.seasonPeriod);
  }

  /** Advance plant growth by one tick. */
  update(tick: number): void {
    const s = Math.max(0, this.seasonFactor(tick));
    const r = this.cfg.foodGrowthRate * s;
    const seed = this.cfg.foodSeedRate * s;
    const kMax = this.cfg.foodMax;
    const hardCap = kMax * 2; // carcasses may overfill a cell; logistic decay pulls it back
    const food = this.food;
    const fert = this.fertility;
    for (let i = 0; i < food.length; i++) {
      const k = kMax * fert[i];
      const f = food[i];
      // Logistic term gives slow start, fast middle, saturating top; the small seed term
      // lets a completely grazed cell restart (pure logistic would stay at 0 forever). The
      // seed term shrinks as the cell fills so the equilibrium is exactly the capacity k.
      let next = f + r * f * (1 - f / k) + seed * (k - f);
      if (next < 0) next = 0;
      else if (next > hardCap) next = hardCap;
      food[i] = next;
    }
    // Carrion rots exponentially, so it is a short-lived bonus near recent deaths.
    const keep = 1 - this.cfg.carrionDecay;
    const meat = this.meat;
    for (let i = 0; i < meat.length; i++) if (meat[i] > 0) meat[i] = meat[i] < 0.01 ? 0 : meat[i] * keep;
  }

  /** Index of the cell containing world point (x, y). */
  cellIndex(x: number, y: number): number {
    let c = Math.floor(wrap(x, this.cfg.worldWidth) / this.cellW);
    let r = Math.floor(wrap(y, this.cfg.worldHeight) / this.cellH);
    // Guard against float rounding at the far edge.
    if (c >= this.cols) c = this.cols - 1;
    if (r >= this.rows) r = this.rows - 1;
    return r * this.cols + c;
  }

  /** Plant energy at a world point. */
  sample(x: number, y: number): number {
    return this.food[this.cellIndex(x, y)];
  }

  /** Remove up to `amount` from a cell; returns what was actually taken. */
  take(index: number, amount: number): number {
    const have = this.food[index];
    const got = amount < have ? amount : have;
    this.food[index] = have - got;
    return got;
  }

  /** Add energy to the cell under (x, y), e.g. from a carcass. */
  deposit(x: number, y: number, amount: number): void {
    const i = this.cellIndex(x, y);
    this.food[i] = Math.min(this.cfg.foodMax * 2, this.food[i] + amount);
  }

  /** Leave carrion in the cell under (x, y). */
  depositMeat(x: number, y: number, amount: number): void {
    if (amount > 0) this.meat[this.cellIndex(x, y)] += amount;
  }

  /** Remove up to `amount` carrion from a cell; returns what was taken. */
  takeMeat(index: number, amount: number): number {
    const have = this.meat[index];
    const got = amount < have ? amount : have;
    this.meat[index] = have - got;
    return got;
  }

  totalMeat(): number {
    let t = 0;
    for (let i = 0; i < this.meat.length; i++) t += this.meat[i];
    return t;
  }

  total(): number {
    let t = 0;
    for (let i = 0; i < this.food.length; i++) t += this.food[i];
    return t;
  }
}
