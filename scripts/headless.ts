// Run the simulation without a browser and print population, mean traits and max generation.
//
//   node scripts/headless.ts --ticks 50000 --seed 3 --every 2500 [--config '{"foodMax":40}']

import { parseArgs } from 'node:util';
import { formatHeader, formatSample, runHeadless } from '../src/sim/headless.ts';

const { values } = parseArgs({
  options: {
    ticks: { type: 'string', default: '20000' },
    seed: { type: 'string', default: '1' },
    every: { type: 'string', default: '1000' },
    config: { type: 'string', default: '{}' },
  },
});

const ticks = Number(values.ticks);
const seed = Number(values.seed);
const every = Number(values.every);
const overrides = JSON.parse(values.config!);

console.log(`Terrarium headless: seed=${seed} ticks=${ticks} overrides=${JSON.stringify(overrides)}`);
console.log(formatHeader());
const t0 = performance.now();
const res = runHeadless({
  ticks,
  config: { ...overrides, seed },
  reportEvery: every,
  onReport: (s) => console.log(formatSample(s)),
});
const secs = (performance.now() - t0) / 1000;
const st = res.world.stats.state;
console.log('---');
console.log(
  `final tick ${res.world.tick}: population ${res.final.population} (herb ${res.final.herbivores}, carn ${res.final.carnivores}), ` +
    `max generation ${res.final.maxGeneration}`,
);
console.log(`population range over run: ${res.minPopulation}..${res.maxPopulation}; births ${st.totalBirths}, kills ${st.totalKills}`);
console.log(`carnivores present in ${res.carnivoreSamples}/${res.totalSamples} samples; extinct at: ${res.extinctAt ?? 'never'}`);
console.log(`${secs.toFixed(1)} s wall, ${(res.world.tick / secs).toFixed(0)} ticks/s`);
console.log('events:');
for (const e of res.world.stats.events.slice(-15)) console.log(`  [${e.tick}] ${e.text}`);
