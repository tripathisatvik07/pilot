# Terrarium — Architecture

Terrarium is split into a **pure simulation core** (`src/sim`) and a **browser shell**
(`src/ui`, `src/main.ts`). The core never touches the DOM, `Math.random` or `Date.now`, so
the exact same code runs in the browser, in Node scripts (`scripts/`) and in Vitest.

## Files

| File | Responsibility |
|---|---|
| `src/sim/config.ts` | Every tunable constant, each with a one-line explanation. `SimConfig` type + `DEFAULT_CONFIG`. |
| `src/sim/rng.ts` | `Rng`: seeded mulberry32 PRNG with a serialisable 32-bit state; uniform, range, Gaussian helpers. |
| `src/sim/noise.ts` | Seeded 2D value noise (tileable on the torus) used for the fertility map ("oases"). |
| `src/sim/food.ts` | `FoodField`: coarse grid of plant energy with logistic regrowth, seasons, fertility, deposits, plus a carrion (meat) layer that rots. |
| `src/sim/genome.ts` | Genome layout (brain weights + body traits), trait decoding, random genomes, mutation. |
| `src/sim/brain.ts` | Feed-forward net (inputs → 10 tanh hidden → 4 tanh outputs) operating on flat typed arrays. |
| `src/sim/spatial.ts` | `SpatialHash`: uniform grid on the torus, rebuilt each tick with a counting sort. |
| `src/sim/creatures.ts` | `CreaturePool`: structure-of-arrays storage for all creature state, free-list slot reuse. |
| `src/sim/world.ts` | `World`: owns everything above and runs the fixed-timestep `tick()`. Also (de)serialisation. |
| `src/sim/stats.ts` | Periodic population/trait samples (bounded history) and the event detector. |
| `src/sim/geometry.ts` | Toroidal helpers (wrap, shortest delta, angle normalisation) and a fast `atan2`. |
| `src/sim/headless.ts` | `runHeadless()`: drives a World for N ticks and summarises it (shared by scripts and tests). |
| `src/ui/*` | Canvas renderer, inspector + NN diagram, plain-canvas charts, controls, event log, save/load. |
| `src/main.ts` | Wires the UI to a `World` and runs the `requestAnimationFrame` loop. |
| `scripts/headless.ts` | Runs N ticks in Node and prints population, mean traits, max generation. |
| `scripts/tune.ts` | Runs several seeds for 50k ticks and reports extinction/explosion/coexistence. |
| `scripts/bench.ts` | Throughput benchmark (ticks/s) for the performance targets. |
| `scripts/e2e.ts` | Playwright smoke test against the dev server; writes `docs/screenshot.png`. |
| `tests/*.test.ts` | Vitest unit + integration tests (determinism, energy accounting, brain, hash, …). |

## Data structures

* **Creatures: structure of arrays.** One `Float64Array` per scalar field (`x`, `y`, `heading`,
  `speed`, `energy`, `age`, …), one `Int32Array` per integer field (`id`, `parentId`,
  `generation`, `lineage`, …), a `Uint8Array alive`, plus flat `Float32Array`s for all
  genomes (`capacity × GENOME_LENGTH`) and brain activations. Decoded body traits are cached in
  their own arrays at birth so the hot loop never re-decodes genes. Why: thousands of
  creatures × every tick — typed arrays keep memory contiguous, avoid GC pressure and make
  serialisation a simple array copy. Dead slots go on a free-list stack, which is
  deterministic (LIFO) so slot assignment is reproducible.
* **Genome:** one `Float32Array` per creature: brain weights first, then 7 trait genes in
  `[0,1]` that decode linearly into `[min,max]` ranges from config.
* **Food field:** `Float32Array` of `cols × rows` cells (default 60×40) plus a static
  `fertility` array built from seeded value noise, and a `meat` array (carrion) on the same grid.
* **Spatial hash:** `cellStart` (`Int32Array`, cells+1) and `cellItems` (`Int32Array`, capacity),
  built by counting sort each tick — O(n), no per-tick allocation, deterministic order.

## The tick (fixed timestep, `World.tick()`)

1. **Environment:** food regrows (logistic × season × fertility).
2. **Spatial hash rebuild** from current positions.
3. **Sense + think** for every living creature in slot order: 5 vision rays (food sampled along
   each ray, nearest creature and its relative size per ray sector, via the hash), own energy,
   own speed, bias, a slow oscillator → brain forward pass → outputs stored.
4. **Act** in slot order: tick down cooldowns, turn, thrust/move (wrapping), pay movement +
   basal metabolism; if the eat/attack intent is on: graze plants and scavenge carrion from the
   current cell (each scaled by diet efficiency) and attack the target found during sensing
   (damage, energy transfer; a kill frees the victim's slot immediately and feeds the predator).
5. **Reproduce:** creatures above their threshold with a positive reproduce output queue a birth;
   births are applied after the act phase so newborns never act in their birth tick.
6. **Age + death:** energy ≤ 0 or age > max age → slot freed; part of the carcass fertilises
   the plant cell underneath and part is left as carrion. (Optional immigration floor, off by default.)
7. **Stats:** every `statsInterval` ticks a sample is recorded and events are detected.

All randomness comes from one `Rng` owned by the `World`, consumed in a fixed order, so same
seed + same config ⇒ byte-identical state. The UI only ever calls `world.tick()` and reads state.

## Why this shape

* Purity makes determinism testable and lets the 50k-tick tuning runs happen in Node.
* Splitting sense/think from act means every creature decides on the same snapshot of the
  world (no first-mover advantage from slot order for perception); interactions (eating,
  attacks) are still resolved in slot order, which is deterministic.
* There is no fitness function anywhere — only energy in, energy out, death and birth.

## Performance techniques

* Sensing inlines the spatial-hash walk (no closure per neighbour), transforms neighbours into the
  creature's local frame so the attack cone is two comparisons, skips any neighbour farther than
  the worst of the five per-ray nearest distances (no angle needed), rejects neighbours behind
  when the field of view is < 180°, and uses a polynomial `fastAtan2`.
* Food rays are generated by rotating one unit vector instead of 10 trig calls.
* Drawing buckets creatures into ~40 colour groups, one `fill()` per group.
* Measured numbers and the gap to the targets are recorded in PROGRESS.md / DECISIONS.md.

## Rendering loop (browser)

`requestAnimationFrame` → run `speed` ticks (capped by a ~12 ms time budget so the UI never
freezes) → draw heatmap (60×40 `ImageData` scaled up with smoothing = soft heatmap) →
draw creatures as triangles → update inspector, charts and log at a lower rate (~5 Hz).
