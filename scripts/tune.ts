// Multi-seed tuning harness: runs several seeds (in parallel worker threads) for N ticks and
// reports, per seed, whether the population went extinct, exploded (hit the pool cap) and
// whether herbivores and carnivores coexisted to the end.
//
//   node scripts/tune.ts --ticks 50000 --seeds 1,2,3,4,5 [--config '{"foodMax":35}']

import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { runHeadless } from '../src/sim/headless.ts';

interface Job {
  seed: number;
  ticks: number;
  overrides: Record<string, unknown>;
}

interface JobResult {
  seed: number;
  ticks: number;
  finalPop: number;
  herb: number;
  carn: number;
  minPop: number;
  maxPop: number;
  maxGen: number;
  carnSamples: number;
  totalSamples: number;
  extinctAt: number | null;
  carnExtinctAt: number | null;
  meanDiet: number;
  births: number;
  kills: number;
  cap: number;
  secs: number;
  minCarnLate: number;
}

function runJob(job: Job): JobResult {
  const t0 = performance.now();
  let minCarnLate = Infinity;
  const res = runHeadless({
    ticks: job.ticks,
    config: { ...job.overrides, seed: job.seed },
    reportEvery: 1000,
    onReport: (s) => {
      // Carnivore floor over the second half of the run: shows how close to extinction they came.
      if (s.tick >= job.ticks / 2) minCarnLate = Math.min(minCarnLate, s.carnivores);
    },
  });
  const f = res.final;
  return {
    seed: job.seed,
    ticks: res.world.tick,
    finalPop: f.population,
    herb: f.herbivores,
    carn: f.carnivores,
    minPop: res.minPopulation,
    maxPop: res.maxPopulation,
    maxGen: f.maxGeneration,
    carnSamples: res.carnivoreSamples,
    totalSamples: res.totalSamples,
    extinctAt: res.extinctAt,
    carnExtinctAt: res.carnivoresExtinctAt,
    meanDiet: f.meanTraits[5],
    births: res.world.stats.state.totalBirths,
    kills: res.world.stats.state.totalKills,
    cap: res.world.cfg.maxCreatures,
    secs: (performance.now() - t0) / 1000,
    minCarnLate: minCarnLate === Infinity ? 0 : minCarnLate,
  };
}

if (!isMainThread) {
  parentPort!.postMessage(runJob(workerData as Job));
} else {
  const { values } = parseArgs({
    options: {
      ticks: { type: 'string', default: '50000' },
      seeds: { type: 'string', default: '1,2,3,4,5' },
      config: { type: 'string', default: '{}' },
    },
  });
  const ticks = Number(values.ticks);
  const seeds = values.seeds!.split(',').map(Number);
  const overrides = JSON.parse(values.config!);
  const parallel = Math.max(1, Math.min(seeds.length, availableParallelism()));
  console.log(`tune: ${seeds.length} seeds × ${ticks} ticks, ${parallel} workers, overrides ${JSON.stringify(overrides)}`);

  const queue = seeds.map((seed) => ({ seed, ticks, overrides }));
  const results: JobResult[] = [];
  const runNext = (): Promise<void> => {
    const job = queue.shift();
    if (!job) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), { workerData: job });
      w.once('message', (r: JobResult) => {
        results.push(r);
        resolve();
      });
      w.once('error', reject);
    }).then(runNext);
  };
  await Promise.all(Array.from({ length: parallel }, runNext));
  results.sort((a, b) => a.seed - b.seed);

  console.log('seed | final pop (herb/carn) | pop range | max gen | carn floor (2nd half) | births | kills | outcome | secs');
  let coexist = 0;
  let survived = 0;
  for (const r of results) {
    const exploded = r.maxPop >= r.cap;
    const extinct = r.extinctAt !== null;
    const both = !extinct && r.herb > 0 && r.carn > 0;
    if (!extinct && !exploded) survived++;
    if (both) coexist++;
    const outcome = extinct ? `EXTINCT@${r.extinctAt}` : exploded ? 'EXPLODED' : both ? 'coexist' : r.carn === 0 ? `no carnivores (lost @${r.carnExtinctAt})` : 'no herbivores';
    console.log(
      `${r.seed} | ${r.finalPop} (${r.herb}/${r.carn}) | ${r.minPop}..${r.maxPop} | ${r.maxGen} | ${r.minCarnLate} | ${r.births} | ${r.kills} | ${outcome} | ${r.secs.toFixed(0)}`,
    );
  }
  console.log(`SUMMARY: survived without extinction/explosion: ${survived}/${results.length}; herbivore+carnivore coexistence at end: ${coexist}/${results.length}`);
}
