# Progress

## Milestone status

| # | Milestone | Status |
|---|---|---|
| 1 | Setup, config, PRNG, food field + seasons, heatmap | done |
| 2 | Creatures, energy economy, random-walk brain, rendering | done |
| 3 | Neural brains, vision rays, spatial hash | done |
| 4 | Reproduction, mutation, headless script, tuning | done |
| 5 | Diet, predation, combat, coexistence tuning | done |
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
- `npm test`: 49/49 passed. New: reproduction energy accounting (parent pays
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

### Milestone 5
- `npm test`: 57/57 passed. New: attack damage and energy transfer exact accounting, cooldown,
  kill + feast + kill counter + soil deposit, herbivores never attack, size ratio, out-of-reach
  prey is safe, carrion deposit/decay/only-carnivores-digest, carnivores "see" carrion on their rays.

#### Milestone 5 tuning evidence (all runs 50,000 ticks; `node scripts/tune.ts ...`)
"Coexist" = both herbivores (diet ≤ 0.5) and carnivores (diet > 0.5) alive at tick 50,000.
"Carn floor" = fewest carnivores at any 1,000-tick report in the second half of the run.

| Run | Change vs. previous defaults | Seeds | Coexist | Notes |
|---|---|---|---|---|
| P0 | predation only (first implementation) | 1–5 | **0/5** | carnivores lost at ticks 16.7k–31.1k; population itself fine (5/5) |
| A | + `huntSatiation` 0.7, `attackCooldown` 15 | 1–4 | 0/4 | worse: carnivores lost at 4.3k–10.8k → they starve, they don't over-hunt |
| B | + carrion 0.6, `meatTransfer` 0.8, `killFeastFraction` 0.8, `attackDamage` 12 | 1–4 | 4/4 | carn floor 2..21 (seed 2 nearly lost them) |
| C | + carrion only: `carrionFraction` 0.8, `carrionDecay` 0.001 | 1–4 | 4/4 | carn floor 10..23 |
| C | (C as default) | 1–8 | 5/8 | seeds 5, 7, 8 lost carnivores at 21.7k, 23.7k, 15.3k |
| D | C + `meatTransfer` 0.8, `killFeastFraction` 0.8 | 5–8 (hard set) | 4/4 | carn floor 11..68 |
| E | D + `attackDamage` 12 | 5–8 | 3/4 | too aggressive: seed 7 lost carnivores |
| **Final** | **D as default** | **1–10** | **10/10** | 10/10 also free of extinction/explosion |

Final defaults, per seed (50,000 ticks):

| seed | final pop (herb/carn) | pop range | max gen | carn floor | births | kills | outcome |
|---|---|---|---|---|---|---|---|
| 1 | 540 (389/151) | 186..1141 | 140 | 65 | 26,865 | 18,848 | coexist |
| 2 | 766 (713/53) | 187..773 | 101 | 23 | 34,684 | 29,066 | coexist |
| 3 | 399 (366/33) | 68..668 | 144 | 7 | 33,199 | 27,196 | coexist |
| 4 | 57 (27/30) | 29..582 | 149 | 5 | 34,428 | 26,925 | coexist (deep trough at the end) |
| 5 | 291 (180/111) | 72..912 | 73 | 18 | 20,045 | 15,316 | coexist |
| 6 | 414 (389/25) | 110..763 | 159 | 12 | 39,534 | 29,413 | coexist |
| 7 | 681 (332/349) | 215..1002 | 188 | 68 | 78,612 | 62,763 | coexist |
| 8 | 480 (407/73) | 129..874 | 106 | 11 | 25,391 | 17,726 | coexist |
| 9 | 562 (334/228) | 84..1031 | 172 | 8 | 57,948 | 48,389 | coexist |
| 10 | 519 (493/26) | 89..632 | 139 | 7 | 33,187 | 22,009 | coexist |

The immigration safety net (`immigrationFloor`) stayed **disabled (0)** in every run, so no
outside creatures were added. Known weak spot: seed 4 swings down to 29 creatures, so on some
seeds beyond 50k ticks an extinction is possible; predator–prey cycles are real dynamics.
