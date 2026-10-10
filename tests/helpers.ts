// Shared test helpers.
import { DEFAULT_CONFIG, type SimConfig } from '../src/sim/config.ts';
import { encodeTrait, GENOME_LENGTH, TRAIT_INDEX, TRAIT_OFFSET } from '../src/sim/genome.ts';
import { World } from '../src/sim/world.ts';

/** A world with no founders and frozen plants, so energy flows can be measured exactly. */
export function emptyWorld(overrides: Partial<SimConfig> = {}): World {
  return new World(
    { ...DEFAULT_CONFIG, foodGrowthRate: 0, foodSeedRate: 0, seasonAmplitude: 0, ...overrides },
    false,
  );
}

/** A genome with all-zero brain weights and mid-range traits, optionally overridden. */
export function makeGenome(traits: Partial<Record<keyof typeof TRAIT_INDEX, number>> = {}): Float32Array {
  const g = new Float32Array(GENOME_LENGTH);
  for (let t = 0; t < GENOME_LENGTH - TRAIT_OFFSET; t++) g[TRAIT_OFFSET + t] = 0.5;
  for (const [k, v] of Object.entries(traits)) {
    g[TRAIT_OFFSET + TRAIT_INDEX[k as keyof typeof TRAIT_INDEX]] = encodeTrait(k as keyof typeof TRAIT_INDEX, v);
  }
  return g;
}

/** A quarter-size world: same rules, ~4× cheaper per tick. For tests that only need "a living world". */
export const SMALL_WORLD: Partial<SimConfig> = {
  worldWidth: 600,
  worldHeight: 400,
  foodCols: 30,
  foodRows: 20,
  initialPopulation: 100,
};
