// The World owns all simulation state and advances it with a fixed timestep. Nothing in
// here touches the DOM or wall-clock time, so the same code runs in the browser, in Node
// scripts and in tests, and a given seed always produces the same history.

import { type SimConfig, withDefaults } from './config.ts';
import { FoodField } from './food.ts';
import { Rng } from './rng.ts';

export const SAVE_FORMAT_VERSION = 1;

export interface WorldSnapshot {
  version: number;
  config: SimConfig;
  tick: number;
  rngState: number;
  food: number[];
}

export class World {
  readonly cfg: SimConfig;
  readonly rng: Rng;
  readonly food: FoodField;
  tick = 0;

  constructor(config: Partial<SimConfig> = {}) {
    this.cfg = withDefaults(config);
    this.rng = new Rng(this.cfg.seed);
    this.food = new FoodField(this.cfg, this.rng);
  }

  /** Advance the simulation by exactly one fixed timestep. */
  step(): void {
    this.food.update(this.tick);
    this.tick++;
  }

  /** Run n ticks. */
  run(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /** Plain-JSON snapshot of the complete state; enough to resume bit-for-bit. */
  serialize(): WorldSnapshot {
    return {
      version: SAVE_FORMAT_VERSION,
      config: { ...this.cfg },
      tick: this.tick,
      rngState: this.rng.state,
      food: Array.from(this.food.food),
    };
  }

  static deserialize(snap: WorldSnapshot): World {
    // Rebuilding from config regenerates the (static) fertility map deterministically;
    // then every piece of dynamic state is overwritten from the snapshot.
    const w = new World(snap.config);
    w.tick = snap.tick;
    w.rng.state = snap.rngState >>> 0;
    w.food.food.set(snap.food);
    return w;
  }
}
