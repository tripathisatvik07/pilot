// Every tunable constant of the simulation lives here, each with a one-line note on what
// turning it up does. The World takes a full SimConfig, so experiments can override any
// subset: `new World({ ...DEFAULT_CONFIG, seed: 7, foodGrowthRate: 0.02 })`.

// ---------------------------------------------------------------------------------------
// Structural constants. These change the genome layout, so changing them makes old saves
// incompatible; that is why they are not part of SimConfig.
// ---------------------------------------------------------------------------------------

/** Number of vision rays spread evenly across the field of view. */
export const VISION_RAYS = 5;
/** Values sensed per ray: food level, nearest-creature closeness, relative size. */
export const INPUTS_PER_RAY = 3;
/** Extra inputs: own energy, own speed, bias (constant 1), slow oscillator. */
export const EXTRA_INPUTS = 4;
/** Total brain inputs. */
export const BRAIN_INPUTS = VISION_RAYS * INPUTS_PER_RAY + EXTRA_INPUTS;
/** Hidden tanh neurons. More = more expressive brains but a slower tick. */
export const BRAIN_HIDDEN = 10;
/** Outputs: turn, thrust, eat/attack intent, reproduce intent. */
export const BRAIN_OUTPUTS = 4;

export interface SimConfig {
  /** Seed for the PRNG; same seed + same config gives an identical run. */
  seed: number;

  // --- World & food -------------------------------------------------------------------
  /** World width in units (wraps around). */
  worldWidth: number;
  /** World height in units (wraps around). */
  worldHeight: number;
  /** Food grid columns; fewer = coarser, cheaper food field. */
  foodCols: number;
  /** Food grid rows. */
  foodRows: number;
  /** Max plant energy one cell holds (logistic carrying capacity); higher = richer world, bigger population. */
  foodMax: number;
  /** Logistic regrowth rate per tick; higher = cells refill faster after grazing. */
  foodGrowthRate: number;
  /** Fraction of foodMax that sprouts per tick even in a bare cell, so grazed-out land can recover. */
  foodSeedRate: number;
  /** Starting fill of each cell as a fraction of its fertile capacity. */
  foodInitialFraction: number;
  /** Length of a full summer→winter→summer cycle, in ticks. */
  seasonPeriod: number;
  /** Season strength: regrowth is multiplied by 1 ± this; 0 disables seasons. */
  seasonAmplitude: number;
  /** Fertility of the poorest land (0..1); lower = harsher deserts between oases. */
  fertilityMin: number;
  /** Noise lattice cells across the world; higher = more, smaller oases. */
  fertilityNoiseScale: number;
  /** Exponent applied to the noise; higher = sharper, rarer oases. */
  fertilityContrast: number;

  // --- Population ---------------------------------------------------------------------
  /** Creatures spawned at tick 0. */
  initialPopulation: number;
  /** Share of founders that start as carnivores (diet near 1) instead of herbivores. */
  initialCarnivoreFraction: number;
  /** Pool capacity; births are refused when full, a hard ceiling against explosions. */
  maxCreatures: number;
  /** If the population drops below this, random founders immigrate (0 disables). */
  immigrationFloor: number;

  // --- Body & metabolism ----------------------------------------------------------------
  /** Creatures die after this many ticks. */
  maxAge: number;
  /** Max stored energy per unit of size; higher = bigger reserves, survive famine longer. */
  energyPerSize: number;
  /** Energy of founders as a fraction of their max. */
  initialEnergyFraction: number;
  /** Basal (idle) energy cost per tick per unit size; the main pressure to keep eating. */
  basalCost: number;
  /** Extra basal cost per unit of mean |brain weight|; higher pushes evolution toward sparse brains. */
  brainCostCoef: number;
  /** Extra basal cost per 100 units of vision range; makes long sight a real trade-off. */
  visionCostCoef: number;
  /** Extra basal cost per unit of max-speed trait; fast bodies are expensive to maintain. */
  speedTraitCostCoef: number;
  /** Movement cost coefficient: cost = coef × size × speed²; higher favours slow grazers. */
  moveCostCoef: number;
  /** Max turn per tick in radians. */
  turnRateMax: number;
  /** How quickly actual speed follows the thrust command (0..1); lower = more inertia. */
  speedResponse: number;
  /** Body radius per unit size, used for attack reach and drawing. */
  bodyRadius: number;

  // --- Eating & predation -----------------------------------------------------------------
  /** Plant energy eaten per tick per unit size × metabolism, before diet efficiency. */
  biteSize: number;
  /** Plant efficiency = (1 − diet)^this; >1 makes generalists worse than specialists. */
  plantDietExponent: number;
  /** Meat efficiency = diet^this; >1 makes half-carnivores poor hunters. */
  meatDietExponent: number;
  /** Damage per attack per unit size × metabolism (scaled by meat efficiency and size ratio). */
  attackDamage: number;
  /** Extra reach beyond both body radii for an attack to land. */
  attackReach: number;
  /** Half-angle (radians) of the cone in front in which an attack can land. */
  attackCone: number;
  /** Ticks an attacker must wait between attacks ("handling time"); higher stabilises predator–prey cycles. */
  attackCooldown: number;
  /** Energy an attack costs per unit size (× meat efficiency), so attacking is never free. */
  attackCost: number;
  /** Fraction of damage dealt that the attacker absorbs as energy. */
  meatTransfer: number;
  /** Energy locked in a body per unit size; released as a carcass on death. */
  bodyEnergy: number;
  /** Fraction of a carcass (body + leftover energy) a predator eats on a kill (× meat efficiency). */
  killFeastFraction: number;
  /** Fraction of a carcass that fertilises the food cell it dies in. */
  corpseDropFraction: number;
  /** Diet above this counts as "carnivore" for stats, colours and events. */
  carnivoreThreshold: number;

  // --- Reproduction & mutation --------------------------------------------------------------
  /** Fraction of the parent's energy paid to make one child. */
  reproCostFraction: number;
  /** Fraction of the paid energy the child actually receives (the rest is lost). */
  reproEfficiency: number;
  /** Creatures younger than this cannot reproduce. */
  minReproAge: number;
  /** Ticks a parent must wait between births. */
  reproCooldown: number;
  /** Children appear up to this far from the parent. */
  birthSpread: number;
  /** Chance each gene mutates at birth. */
  mutationRate: number;
  /** Std-dev of a normal mutation on a brain weight. */
  weightMutationSigma: number;
  /** Std-dev of a normal mutation on a trait gene (genes live in 0..1). */
  traitMutationSigma: number;
  /** Chance per birth of a large mutation (several genes jump; founds a new lineage). */
  bigMutationChance: number;
  /** Genes touched by a large mutation. */
  bigMutationGenes: number;
  /** Std-dev multiplier for large mutations relative to the normal sigma. */
  bigMutationScale: number;
  /** Brain weights are clamped to ±this so mutations cannot blow up. */
  weightClamp: number;
  /** Std-dev of brain weights in founders. */
  initialWeightSigma: number;

  // --- Brain & senses ------------------------------------------------------------------------
  /** Period of the built-in oscillator input, in ticks (gives brains a sense of rhythm). */
  oscillatorPeriod: number;
  /** Food samples taken along each vision ray. */
  raySamples: number;

  // --- Statistics & events ---------------------------------------------------------------------
  /** Ticks between stats samples. */
  statsInterval: number;
  /** Max stored samples; when full, history is thinned by half (keeps long runs bounded). */
  historyLength: number;
  /** A population drop of this fraction from the recent peak logs a "population crash". */
  crashFraction: number;
  /** Samples looked back when detecting crashes. */
  crashWindow: number;
  /** Share of the population a lineage needs to be announced as the new dominant lineage. */
  dominantLineageShare: number;
  /** Max events kept in the log. */
  maxEvents: number;
}

export interface TraitRange {
  /** Trait identifier, used in stats and the UI. */
  key: TraitKey;
  /** Human label. */
  label: string;
  min: number;
  max: number;
}

export type TraitKey =
  | 'size'
  | 'maxSpeed'
  | 'visionRange'
  | 'fov'
  | 'metabolism'
  | 'diet'
  | 'reproThreshold';

/**
 * Body-trait ranges. A trait gene in 0..1 decodes linearly into [min, max].
 * Order matters: it is the order of the trait genes at the end of the genome.
 */
export const TRAITS: readonly TraitRange[] = [
  // Bigger: more energy storage and damage, harder to kill, but every cost scales with size.
  { key: 'size', label: 'Size', min: 0.5, max: 2.0 },
  // Top speed in units/tick; faster bodies cost more to maintain and v² to move.
  { key: 'maxSpeed', label: 'Max speed', min: 0.4, max: 3.0 },
  // How far the eyes see; longer sight costs basal energy.
  { key: 'visionRange', label: 'Vision range', min: 25, max: 120 },
  // Total field of view in radians the 5 rays span; wide = aware, narrow = precise.
  { key: 'fov', label: 'Field of view', min: 0.4, max: 3.6 },
  // Multiplies eating/attack rate AND basal cost: fast-living vs slow-living.
  { key: 'metabolism', label: 'Metabolism', min: 0.5, max: 1.5 },
  // 0 = pure herbivore, 1 = pure carnivore.
  { key: 'diet', label: 'Diet', min: 0, max: 1 },
  // Energy (fraction of max) required before reproduction is allowed.
  { key: 'reproThreshold', label: 'Repro threshold', min: 0.3, max: 0.95 },
];

export const DEFAULT_CONFIG: SimConfig = {
  seed: 1,

  worldWidth: 1200,
  worldHeight: 800,
  foodCols: 60,
  foodRows: 40,
  foodMax: 30,
  foodGrowthRate: 0.012,
  foodSeedRate: 0.0004,
  foodInitialFraction: 0.6,
  seasonPeriod: 8000,
  seasonAmplitude: 0.6,
  fertilityMin: 0.15,
  fertilityNoiseScale: 4,
  fertilityContrast: 1.6,

  initialPopulation: 300,
  initialCarnivoreFraction: 0.1,
  maxCreatures: 4000,
  immigrationFloor: 0,

  maxAge: 5000,
  energyPerSize: 120,
  initialEnergyFraction: 0.5,
  basalCost: 0.04,
  brainCostCoef: 0.05,
  visionCostCoef: 0.3,
  speedTraitCostCoef: 0.1,
  moveCostCoef: 0.03,
  turnRateMax: 0.25,
  speedResponse: 0.25,
  bodyRadius: 4,

  biteSize: 1.2,
  plantDietExponent: 2,
  meatDietExponent: 2,
  attackDamage: 8,
  attackReach: 4,
  attackCone: 0.6,
  attackCooldown: 10,
  attackCost: 0.5,
  meatTransfer: 0.6,
  bodyEnergy: 30,
  killFeastFraction: 0.5,
  corpseDropFraction: 0.5,
  carnivoreThreshold: 0.5,

  reproCostFraction: 0.5,
  reproEfficiency: 0.85,
  minReproAge: 100,
  reproCooldown: 60,
  birthSpread: 10,
  mutationRate: 0.1,
  weightMutationSigma: 0.2,
  traitMutationSigma: 0.04,
  bigMutationChance: 0.02,
  bigMutationGenes: 6,
  bigMutationScale: 5,
  weightClamp: 4,
  initialWeightSigma: 0.6,

  oscillatorPeriod: 120,
  raySamples: 3,

  statsInterval: 50,
  historyLength: 800,
  crashFraction: 0.5,
  crashWindow: 40,
  dominantLineageShare: 0.3,
  maxEvents: 200,
};

/** Fill any missing keys (e.g. from an older save) with defaults. */
export function withDefaults(partial: Partial<SimConfig>): SimConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}
