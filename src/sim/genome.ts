// Genome layout and mutation. A genome is one flat Float32Array:
//
//   [ W1: hidden×inputs | W2: outputs×hidden | B2: outputs | traits: 7 genes in 0..1 ]
//
// Keeping brain and body in one vector means a single mutation routine handles both, and
// the inspector/serialiser can treat a genome as an opaque array of numbers. There is no
// hidden-layer bias block: the constant "bias" input already gives every hidden neuron one.

import {
  BRAIN_HIDDEN,
  BRAIN_INPUTS,
  BRAIN_OUTPUTS,
  type SimConfig,
  TRAITS,
  type TraitKey,
} from './config.ts';
import type { Rng } from './rng.ts';

export const W1_OFFSET = 0;
export const W1_SIZE = BRAIN_HIDDEN * BRAIN_INPUTS;
export const W2_OFFSET = W1_OFFSET + W1_SIZE;
export const W2_SIZE = BRAIN_OUTPUTS * BRAIN_HIDDEN;
export const B2_OFFSET = W2_OFFSET + W2_SIZE;
export const B2_SIZE = BRAIN_OUTPUTS;
/** Number of brain parameters (all are unbounded weights, clamped to ±weightClamp). */
export const BRAIN_GENES = B2_OFFSET + B2_SIZE;
export const TRAIT_OFFSET = BRAIN_GENES;
export const TRAIT_COUNT = TRAITS.length;
export const GENOME_LENGTH = TRAIT_OFFSET + TRAIT_COUNT;

/** Index of each trait within the trait block. */
export const TRAIT_INDEX: Readonly<Record<TraitKey, number>> = Object.fromEntries(
  TRAITS.map((t, i) => [t.key, i]),
) as Record<TraitKey, number>;

/** Decode a 0..1 trait gene into its real-valued range. */
export function decodeTrait(traitIndex: number, gene: number): number {
  const t = TRAITS[traitIndex];
  return t.min + (t.max - t.min) * gene;
}

/** Inverse of decodeTrait; handy for building genomes with specific traits in tests. */
export function encodeTrait(key: TraitKey, value: number): number {
  const t = TRAITS[TRAIT_INDEX[key]];
  return (value - t.min) / (t.max - t.min);
}

/** Mean |weight| over the brain block — the "brain complexity" that costs basal energy. */
export function brainComplexity(g: Float32Array, offset = 0): number {
  let s = 0;
  for (let i = 0; i < BRAIN_GENES; i++) s += Math.abs(g[offset + i]);
  return s / BRAIN_GENES;
}

/**
 * Write a random founder genome into `out` at `offset`. `diet` lets the World seed
 * herbivore and carnivore founders; other traits start uniformly random.
 */
export function randomGenome(
  rng: Rng,
  cfg: SimConfig,
  out: Float32Array,
  offset: number,
  dietGene: number,
): void {
  for (let i = 0; i < BRAIN_GENES; i++) out[offset + i] = rng.gaussian() * cfg.initialWeightSigma;
  for (let t = 0; t < TRAIT_COUNT; t++) out[offset + TRAIT_OFFSET + t] = rng.next();
  out[offset + TRAIT_OFFSET + TRAIT_INDEX.diet] = dietGene;
}

/**
 * Copy parent genome → child genome with mutation, in place in the pool's genome array.
 * Returns true if a large mutation happened (the child then founds a new lineage).
 */
export function mutateInto(
  rng: Rng,
  cfg: SimConfig,
  genomes: Float32Array,
  parentOffset: number,
  childOffset: number,
): boolean {
  genomes.copyWithin(childOffset, parentOffset, parentOffset + GENOME_LENGTH);
  const clamp = cfg.weightClamp;
  // Small mutations: each gene independently, so the expected number of changes per birth
  // is mutationRate × GENOME_LENGTH (~24 with defaults) — enough drift, rarely destructive.
  for (let i = 0; i < GENOME_LENGTH; i++) {
    if (rng.next() >= cfg.mutationRate) continue;
    mutateGene(rng, cfg, genomes, childOffset, i, 1, clamp);
  }
  // Rare large mutation: a few genes jump far. This is what lets a lineage cross fitness
  // valleys (e.g. herbivore → carnivore) that small steps alone would not.
  if (rng.next() < cfg.bigMutationChance) {
    for (let k = 0; k < cfg.bigMutationGenes; k++) {
      mutateGene(rng, cfg, genomes, childOffset, rng.int(GENOME_LENGTH), cfg.bigMutationScale, clamp);
    }
    return true;
  }
  return false;
}

function mutateGene(
  rng: Rng,
  cfg: SimConfig,
  g: Float32Array,
  offset: number,
  i: number,
  scale: number,
  clamp: number,
): void {
  const j = offset + i;
  if (i < BRAIN_GENES) {
    const v = g[j] + rng.gaussian() * cfg.weightMutationSigma * scale;
    g[j] = v > clamp ? clamp : v < -clamp ? -clamp : v;
  } else {
    const v = g[j] + rng.gaussian() * cfg.traitMutationSigma * scale;
    g[j] = v > 1 ? 1 : v < 0 ? 0 : v;
  }
}
