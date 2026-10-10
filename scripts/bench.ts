// Throughput benchmark for the performance targets.
//   1) headless: run N ticks with default config and report wall time / ticks per second
//   2) dense:    hold ~2,200 creatures and report ms per tick (the 60 fps browser target needs
//                the sim tick plus drawing to fit in ~16 ms per frame at 1×)
//
//   node scripts/bench.ts [--ticks 100000] [--seed 1]

import { parseArgs } from 'node:util';
import { World } from '../src/sim/world.ts';

const { values } = parseArgs({ options: { ticks: { type: 'string', default: '100000' }, seed: { type: 'string', default: '1' } } });
const ticks = Number(values.ticks);
const seed = Number(values.seed);

{
  const w = new World({ seed });
  const t0 = performance.now();
  let popSum = 0;
  for (let i = 0; i < ticks; i++) {
    w.step();
    popSum += w.population;
  }
  const secs = (performance.now() - t0) / 1000;
  console.log(
    `headless: ${ticks} ticks in ${secs.toFixed(1)} s (${(ticks / secs).toFixed(0)} ticks/s), ` +
      `mean population ${(popSum / ticks).toFixed(0)}, final ${w.population}`,
  );
}

{
  // Dense world: plenty of food, population held at ~2,200 by the pool cap (the 2,000+ target).
  const w = new World({ seed, initialPopulation: 2200, maxCreatures: 2200, foodMax: 80, foodGrowthRate: 0.03 });
  w.run(200); // warm up the JIT
  const n = 1000;
  const t0 = performance.now();
  let popSum = 0;
  for (let i = 0; i < n; i++) {
    w.step();
    popSum += w.population;
  }
  const ms = (performance.now() - t0) / n;
  console.log(`dense: mean population ${(popSum / n).toFixed(0)}, ${ms.toFixed(2)} ms/tick (budget at 60 fps: 16.7 ms incl. drawing)`);
}
