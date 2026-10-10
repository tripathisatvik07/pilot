# Progress

## Milestone status

| # | Milestone | Status |
|---|---|---|
| 1 | Setup, config, PRNG, food field + seasons, heatmap | done |
| 2 | Creatures, energy economy, random-walk brain, rendering | done |
| 3 | Neural brains, vision rays, spatial hash | done |
| 4 | Reproduction, mutation, headless script, tuning | done |
| 5 | Diet, predation, combat, coexistence tuning | pending |
| 6 | Inspector, NN diagram, charts, event log | pending |
| 7 | Save/load, speed controls, README, cleanup | pending |

## Log

### Milestone 1
- `npm test`: 17/17 passed (rng, food field, food-only world determinism, src/sim purity).
- `npm run build`: OK, zero TypeScript errors.
- Problem: the food test showed cells settling *above* capacity, because the constant
  "seed" term (sprouting in bare cells) pushed the logistic equilibrium past K.
  Fix: the seed term is now `seed × (K − F)`, which vanishes at capacity.
- Problem: purity test flagged `Math.random` in a *comment* in rng.ts. Fix: the test strips
  comments before scanning.

### Milestone 2
- `npm test`: 29/29 passed. New: exact energy accounting (eaten − basal − movement per tick),
  carnivores cannot digest plants, energy cap, wrapping on all edges, starvation and old-age
  death with the exact carcass deposit, slot reuse, 5,000-tick byte-identical determinism with
  creatures, and save → load → continue equals an uninterrupted run.
- `npm run build`: OK.
- Problems: `addCreature` did not clamp energy to max (test caught it; fixed). A slot-reuse test
  failed because the test creature was grazing the default food and did not starve; the test
  now empties the food field first.

### Milestone 3
- `npm test`: 39/39 passed. New: forward pass vs a hand-computed example and vs a naive matrix
  implementation; spatial hash returns exactly the brute-force neighbour set (incl. edge wrap and
  radii larger than half the world, no duplicates); vision rays see ahead / across the world edge /
  not behind; food rays read the right cells; attack target selection.
- Problem: food-ray test hit the wrong cell because trait genes are float32, so a vision range of
  60 decodes to 59.99999 and the sample landed just across a cell border. Fixed the test to keep
  sample points away from cell borders (the behaviour itself is fine).
- First perf reading: ~7.7 ms/tick with ~1,300–2,000 creatures (Node 22).

### Milestone 4
- `npm test`: 48/48 passed. New: reproduction energy accounting (parent pays
  `reproCostFraction`, child gets `paid × reproEfficiency`), threshold/min-age/cooldown/full-pool
  gates, mutation bounds, large mutation → new lineage, mutation magnitude, headless run
  (4,000 ticks: population > 0, generations > 2, births > 100, sample count), headless determinism.
- Added `scripts/headless.ts` (single run, prints a table) and `scripts/tune.ts` (multi-seed, runs
  in parallel worker threads, prints a verdict per seed).

#### Milestone 4 tuning evidence (no predation yet)
Command: `node scripts/tune.ts --ticks 50000 --seeds 1,2,3,4,5` with the defaults at this commit.

| seed | final pop | pop range over 50k ticks | max generation | births | outcome |
|---|---|---|---|---|---|
| 1 | 774 | 226..1222 | 59 | 17,070 | survived |
| 2 | 700 | 148..771 | 66 | 16,497 | survived |
| 3 | 1,584 | 208..1,813 | 34 | 13,727 | survived |
| 4 | 827 | 162..863 | 44 | 8,720 | survived |
| 5 | 1,165 | 166..1,478 | 54 | 14,923 | survived |

5/5 seeds neither went extinct nor exploded (pool cap 4,000; peak 1,813). The population swings
with the seasons (8,000-tick cycle) but recovers every winter. The seeded carnivores (10%) die out
within ~3,000 ticks, as expected: they cannot attack until milestone 5 and cannot digest plants.
The first defaults survived, so no tuning changes were needed at this stage.

Performance at this point: ~490 ticks/s single-threaded at ~700 creatures (≈2 µs per creature per
tick: ~1 µs sensing, ~0.8 µs brain). See the perf section later for the final numbers.
