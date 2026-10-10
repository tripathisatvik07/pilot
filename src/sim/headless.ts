// Headless runner shared by the CLI scripts and the tests. Pure: it only drives a World.

import { type SimConfig, TRAITS } from './config.ts';
import type { Sample } from './stats.ts';
import { World } from './world.ts';

export interface HeadlessOptions {
  ticks: number;
  config?: Partial<SimConfig>;
  /** Called every `reportEvery` ticks with the latest sample. */
  reportEvery?: number;
  onReport?: (s: Sample, world: World) => void;
}

export interface HeadlessResult {
  world: World;
  final: Sample;
  minPopulation: number;
  maxPopulation: number;
  /** Ticks at which there was at least one herbivore / carnivore, at sample resolution. */
  herbivoreSamples: number;
  carnivoreSamples: number;
  totalSamples: number;
  extinctAt: number | null;
  carnivoresExtinctAt: number | null;
}

export function runHeadless(opts: HeadlessOptions): HeadlessResult {
  const world = new World(opts.config ?? {});
  world.recordSample();
  let minPop = Infinity;
  let maxPop = 0;
  let herbSamples = 0;
  let carnSamples = 0;
  let total = 0;
  let extinctAt: number | null = null;
  let carnExtinctAt: number | null = null;
  const every = opts.reportEvery ?? 0;
  for (let t = 0; t < opts.ticks; t++) {
    world.step();
    if (world.tick % world.cfg.statsInterval === 0) {
      const s = world.stats.latest()!;
      total++;
      if (s.population < minPop) minPop = s.population;
      if (s.population > maxPop) maxPop = s.population;
      if (s.herbivores > 0) herbSamples++;
      if (s.carnivores > 0) carnSamples++;
      else if (carnExtinctAt === null && world.tick > 0) carnExtinctAt = world.tick;
      if (s.population === 0 && extinctAt === null) extinctAt = world.tick;
    }
    if (every > 0 && world.tick % every === 0 && opts.onReport) {
      world.recordSampleIfNeeded();
      opts.onReport(world.stats.latest()!, world);
    }
    if (world.population === 0) {
      extinctAt ??= world.tick;
      break;
    }
  }
  world.recordSampleIfNeeded();
  return {
    world,
    final: world.stats.latest()!,
    minPopulation: minPop === Infinity ? world.population : minPop,
    maxPopulation: maxPop,
    herbivoreSamples: herbSamples,
    carnivoreSamples: carnSamples,
    totalSamples: total,
    extinctAt,
    carnivoresExtinctAt: carnExtinctAt,
  };
}

/** One fixed-width text row for a sample (used by the CLI scripts). */
export function formatSample(s: Sample): string {
  const traits = s.meanTraits.map((v) => v.toFixed(2).padStart(6)).join(' ');
  return (
    `${String(s.tick).padStart(7)} ${String(s.population).padStart(5)} ${String(s.herbivores).padStart(5)} ` +
    `${String(s.carnivores).padStart(5)} ${String(s.maxGeneration).padStart(5)} ${traits} ${s.foodTotal.toFixed(0).padStart(7)}`
  );
}

export function formatHeader(): string {
  const names = TRAITS.map((t) => t.key.slice(0, 6).padStart(6)).join(' ');
  return `${'tick'.padStart(7)} ${'pop'.padStart(5)} ${'herb'.padStart(5)} ${'carn'.padStart(5)} ${'maxGn'.padStart(5)} ${names} ${'food'.padStart(7)}`;
}
