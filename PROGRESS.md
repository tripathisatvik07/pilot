# Progress

## Milestone status

| # | Milestone | Status |
|---|---|---|
| 1 | Setup, config, PRNG, food field + seasons, heatmap | done |
| 2 | Creatures, energy economy, random-walk brain, rendering | done |
| 3 | Neural brains, vision rays, spatial hash | pending |
| 4 | Reproduction, mutation, headless script, tuning | pending |
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
