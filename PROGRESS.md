# Progress

## Milestone status

| # | Milestone | Status |
|---|---|---|
| 1 | Setup, config, PRNG, food field + seasons, heatmap | done |
| 2 | Creatures, energy economy, random-walk brain, rendering | done |
| 3 | Neural brains, vision rays, spatial hash | done |
| 4 | Reproduction, mutation, headless script, tuning | done |
| 5 | Diet, predation, combat, coexistence tuning | done |
| 6 | Inspector, NN diagram, charts, event log | done |
| 7 | Save/load, speed controls, README, cleanup | done |

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
| D-final | D as default (before milestone 7 perf changes) | 1–10 | 10/10 | 10/10 also free of extinction/explosion |

D-final per seed (50,000 ticks), superseded by the re-verification below:

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

**Re-verification after the milestone 7 performance work** (vision code optimised: fast atan2,
pruning; tiny numeric differences change chaotic trajectories, so every seed's history changed):

| Run | Defaults | Seeds | Survive | Coexist |
|---|---|---|---|---|
| R1 | as above (carrion 0.8) | 1–10 | 10/10 | 7/10 (seeds 6, 7, 9 lost carnivores at 30.8k, 40.8k, 48.3k) |
| F | `carrionFraction` 1.0 | 6, 7, 9, 11 | 4/4 | 4/4 (carn floor 12..28) |
| G | `carrionDecay` 0.0006 | 6, 7, 9, 11 | 4/4 | 4/4 (carn floor 2..28, weaker) |
| **FINAL** | **`carrionFraction` 1.0 (shipped defaults)** | **1–10** | **10/10** | **8/10** |

Shipped defaults, per seed (50,000 ticks, `node scripts/tune.ts --ticks 50000 --seeds 1,2,3,4,5,6,7,8,9,10`):

| seed | final pop (herb/carn) | pop range | max gen | carn floor | births | kills | outcome |
|---|---|---|---|---|---|---|---|
| 1 | 676 (544/132) | 217..1164 | 233 | 41 | 73,540 | 64,724 | coexist |
| 2 | 510 (226/284) | 76..791 | 144 | 21 | 40,996 | 34,816 | coexist |
| 3 | 509 (477/32) | 69..711 | 130 | 2 | 36,813 | 30,481 | coexist |
| 4 | 483 (196/287) | 91..575 | 175 | 37 | 41,507 | 32,962 | coexist |
| 5 | 548 (548/0) | 102..766 | 113 | 0 | 23,032 | 12,278 | carnivores lost at 41,550 |
| 6 | 500 (368/132) | 127..801 | 135 | 28 | 41,966 | 30,828 | coexist |
| 7 | 497 (449/48) | 149..781 | 94 | 12 | 36,055 | 27,062 | coexist |
| 8 | 389 (161/228) | 57..809 | 107 | 21 | 29,401 | 21,534 | coexist |
| 9 | 494 (280/214) | 111..1006 | 282 | 21 | 84,455 | 71,403 | coexist |
| 10 | 606 (606/0) | 79..652 | 127 | 0 | 28,568 | 16,499 | carnivores lost at 31,900 |

**Result: seeds 1–5 → 4/5 coexist (meets the "at least 4 of 5" bar); seeds 1–10 → 8/10; 10/10
never went extinct or exploded.** Carnivore persistence is stochastic: the coexistence rate moved
between 7/10 and 10/10 across code versions with nearly identical rules, so expect roughly
80% of seeds to keep carnivores to 50k ticks. I stopped tuning here because further changes only
moved which seeds failed.

The immigration safety net (`immigrationFloor`) stayed **disabled (0)** in every run, so no
outside creatures were added. Known weak spot: populations swing hard (down to 57–150 creatures in winter) and carnivores
can still die out late in a run.

### Milestone 6
- Added `src/ui/inspector.ts` (click-to-inspect panel + live network diagram), `src/ui/charts.ts`
  (plain-canvas line/stacked charts: population, herbivore/carnivore share, mean traits, max
  generation), the event log panel and the full control panel in `src/main.ts`.
- Added `scripts/e2e.ts` (Playwright via `playwright-core` + the pre-installed Chromium; no browser
  download). First run: `E2E FAILED` — a 404 for `/favicon.ico` logged a console error, and the
  creature the script clicked had died before the check. Fixes: inline SVG favicon; the script now
  clicks the most energetic creature. Second run: `E2E PASSED` (tick 4,712, population 425 =
  277 herbivores / 154 carnivores, 270 distinct canvas colours).
- Polish after looking at the screenshot: trait-chart legend overlapped the title (legend now moves
  to its own row when needed), network output labels were clipped, small grazers were hard to see.

### Milestone 7
- Save/load: Export/Import JSON buttons; new tests: JSON round-trip is byte-identical (including
  stats, events and carrion), a loaded world continues identically through births/deaths/kills,
  unknown save versions are rejected, missing config keys are defaulted. Speed slider 1×–50× with a
  14 ms per-frame budget; HUD shows fps, ticks/s, ms per tick, draw ms.
- Performance: profiling showed sensing ≈ 80% of a tick. Optimised the neighbour loop (local-frame
  cone test, nearest-distance pruning, front-only rejection, `fastAtan2`, rotated ray vectors):
  dense tick 23 → ~15 ms at ~3,000 creatures. Hash cell sizes 15–80 benchmarked (40 best). New
  tests: `fastAtan2` accuracy (< 2e-5 rad), geometry helpers, event detector, immigration floor.
- Problem: after these changes the 10-seed coexistence check dropped from 10/10 to 7/10 (chaotic
  trajectories) → retuned `carrionFraction` 0.8 → 1.0 → 8/10 (details in the milestone 5 section).
- Problem: `npm test` passed but Vitest reported `Timeout calling "onTaskUpdate"`: long CPU-bound
  tests in parallel files starved the worker RPC (Vitest also runs the sim ~2× slower than plain Node
  because of its module transform). Fix: tests that only need "a living world" use a quarter-size
  world (`SMALL_WORLD`), the food-only determinism test spawns no creatures, and Vitest uses the
  `forks` pool. The required full-default 5,000-tick determinism test is unchanged.

#### Performance numbers (final code)
| Measurement | Command | Result | Target |
|---|---|---|---|
| 100,000 headless ticks, default world (mean pop 502) | `npm run bench` | 120.0 s (833 ticks/s) | ~60 s — **missed by 2×** |
| 2,200 creatures, Node | `npm run bench` | 7.54 ms/tick | fits a 16.7 ms frame |
| 2,200 creatures, headless Chromium | `npm run e2e` | 7.7 ms sim + 2.9 ms draw; **33.9 fps** | 60 fps — JS fits, but not reached in this GPU-less container |
| ~1,000 creatures at 1×, headless Chromium | `npm run e2e` | 49 fps, 3.2 ms sim + 0.9 ms draw | — |

See DECISIONS.md #13 for analysis and options.

## Definition of done — verification (final run)

| Check | Command | Result |
|---|---|---|
| Install + build, zero TS errors | `rm -rf node_modules dist && npm install && npm run build` | OK: `tsc` clean, `vite build` produced `dist/` |
| Tests incl. determinism + headless | `npm test` | **68/68 passed**, 10 files, no errors (~50 s). Includes byte-identical state after 5,000 ticks with the full default config, save/load continuation, headless-run tests |
| Headless tuning evidence (M4, M5) | `node scripts/tune.ts ...` | Recorded above (M4: 5/5 survive; M5: 10/10 survive, 8/10 coexist, 4/5 on seeds 1–5) |
| Dev app in a real browser, 30 s | `npm run e2e` (Playwright + `/opt/pw-browsers/chromium`) | **E2E PASSED**: no console errors; tick 4,117, population 1,039 (464 herbivores / 576 carnivores); canvas 401 distinct colours (non-blank); inspector shows the clicked creature; `docs/screenshot.png` saved |
| Docs exist and are accurate | — | README.md, ARCHITECTURE.md, DECISIONS.md, EXPLAINED.md, PROGRESS.md |
| Committed and pushed | `git push origin claude/gracious-clarke-tqdfaa` | see git log |
