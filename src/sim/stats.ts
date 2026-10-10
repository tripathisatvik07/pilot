// Population statistics and the event detector. Sampling happens inside the simulation (not
// the UI) so headless runs, charts and saved games all see the same history, and so events
// are deterministic too.

import { type SimConfig, TRAITS } from './config.ts';
import type { CreaturePool } from './creatures.ts';

export interface Sample {
  tick: number;
  population: number;
  herbivores: number;
  carnivores: number;
  maxGeneration: number;
  /** Mean of each trait, in TRAITS order (real units, not genes). */
  meanTraits: number[];
  foodTotal: number;
  /** Regrowth multiplier at this tick (seasons). */
  season: number;
  dominantLineage: number;
  dominantShare: number;
  /** Counts since the previous sample. */
  births: number;
  deaths: number;
  kills: number;
}

export type EventKind =
  | 'first-carnivore'
  | 'population-crash'
  | 'dominant-lineage'
  | 'carnivores-extinct'
  | 'herbivores-extinct'
  | 'extinction'
  | 'immigration';

export interface SimEvent {
  tick: number;
  kind: EventKind;
  text: string;
}

export interface StatsState {
  samples: Sample[];
  events: SimEvent[];
  births: number;
  deaths: number;
  kills: number;
  firstCarnivoreSeen: boolean;
  dominantLineage: number;
  lastCrashTick: number;
  hadCarnivores: boolean;
  hadHerbivores: boolean;
  totalBirths: number;
  totalKills: number;
}

export class Stats {
  state: StatsState = {
    samples: [],
    events: [],
    births: 0,
    deaths: 0,
    kills: 0,
    firstCarnivoreSeen: false,
    dominantLineage: -1,
    lastCrashTick: -1e9, // not -Infinity: it must survive a JSON round-trip
    hadCarnivores: false,
    hadHerbivores: false,
    totalBirths: 0,
    totalKills: 0,
  };
  private readonly cfg: SimConfig;

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
  }

  get samples(): Sample[] {
    return this.state.samples;
  }

  get events(): SimEvent[] {
    return this.state.events;
  }

  latest(): Sample | undefined {
    return this.state.samples[this.state.samples.length - 1];
  }

  log(tick: number, kind: EventKind, text: string): void {
    const ev = this.state.events;
    ev.push({ tick, kind, text });
    if (ev.length > this.cfg.maxEvents) ev.splice(0, ev.length - this.cfg.maxEvents);
  }

  /** Called by World for every birth. */
  onBirth(tick: number, diet: number, generation: number, id: number): void {
    const st = this.state;
    st.births++;
    st.totalBirths++;
    // Founders don't count: the event marks the first carnivore produced by reproduction.
    if (!st.firstCarnivoreSeen && diet > this.cfg.carnivoreThreshold) {
      st.firstCarnivoreSeen = true;
      this.log(tick, 'first-carnivore', `First carnivore born: #${id}, generation ${generation}, diet ${diet.toFixed(2)}`);
    }
  }

  onDeath(killed: boolean): void {
    this.state.deaths++;
    if (killed) {
      this.state.kills++;
      this.state.totalKills++;
    }
  }

  /** Take a sample of the pool and run the event detectors. */
  sample(tick: number, pool: CreaturePool, foodTotal: number, season: number): Sample {
    const cfg = this.cfg;
    const st = this.state;
    const nT = TRAITS.length;
    const sums = new Float64Array(nT);
    let herb = 0;
    let carn = 0;
    let maxGen = 0;
    const lineages = new Map<number, number>();
    const traitArrays = [pool.size, pool.maxSpeed, pool.visionRange, pool.fov, pool.metabolism, pool.diet, pool.reproThreshold];
    for (let s = 0; s < pool.capacity; s++) {
      if (!pool.alive[s]) continue;
      for (let t = 0; t < nT; t++) sums[t] += traitArrays[t][s];
      if (pool.diet[s] > cfg.carnivoreThreshold) carn++;
      else herb++;
      if (pool.generation[s] > maxGen) maxGen = pool.generation[s];
      const l = pool.lineage[s];
      lineages.set(l, (lineages.get(l) ?? 0) + 1);
    }
    const pop = herb + carn;
    let domL = -1;
    let domN = 0;
    for (const [l, n] of lineages) {
      if (n > domN) {
        domN = n;
        domL = l;
      }
    }
    const sample: Sample = {
      tick,
      population: pop,
      herbivores: herb,
      carnivores: carn,
      maxGeneration: maxGen,
      meanTraits: Array.from(sums, (v) => (pop > 0 ? v / pop : 0)),
      foodTotal,
      season,
      dominantLineage: domL,
      dominantShare: pop > 0 ? domN / pop : 0,
      births: st.births,
      deaths: st.deaths,
      kills: st.kills,
    };
    st.births = 0;
    st.deaths = 0;
    st.kills = 0;

    this.detect(sample);

    st.samples.push(sample);
    // Thin the history by half when full: memory stays bounded and the charts still span
    // the whole run, just at a coarser resolution for older data.
    if (st.samples.length > cfg.historyLength) st.samples = st.samples.filter((_, i) => i % 2 === 0 || i === st.samples.length - 1);
    return sample;
  }

  private detect(s: Sample): void {
    const cfg = this.cfg;
    const st = this.state;

    // Population crash: a drop of crashFraction from the peak of the recent window.
    const recent = st.samples.slice(-cfg.crashWindow);
    let peak = 0;
    for (const r of recent) if (r.population > peak) peak = r.population;
    if (
      peak >= 20 &&
      s.population < peak * (1 - cfg.crashFraction) &&
      s.tick - st.lastCrashTick > cfg.crashWindow * cfg.statsInterval
    ) {
      st.lastCrashTick = s.tick;
      this.log(s.tick, 'population-crash', `Population crash: ${peak} → ${s.population}`);
    }

    // Extinctions (logged once per group, re-armed if the group comes back).
    if (s.carnivores > 0) st.hadCarnivores = true;
    else if (st.hadCarnivores) {
      st.hadCarnivores = false;
      this.log(s.tick, 'carnivores-extinct', 'Carnivores went extinct');
    }
    if (s.herbivores > 0) st.hadHerbivores = true;
    else if (st.hadHerbivores) {
      st.hadHerbivores = false;
      this.log(s.tick, 'herbivores-extinct', 'Herbivores went extinct');
    }
    if (s.population === 0 && (st.samples.length === 0 || st.samples[st.samples.length - 1].population > 0)) {
      this.log(s.tick, 'extinction', 'All life is extinct');
    }

    // New dominant lineage.
    if (
      s.dominantLineage !== st.dominantLineage &&
      s.dominantShare >= cfg.dominantLineageShare &&
      s.population >= 20
    ) {
      st.dominantLineage = s.dominantLineage;
      this.log(
        s.tick,
        'dominant-lineage',
        `New dominant lineage L${s.dominantLineage} (${Math.round(s.dominantShare * 100)}% of population)`,
      );
    }
  }
}
