# Terrarium, explained milestone by milestone

## Milestone 1 — world, randomness and plants
- **What was added:** a config file holding every tunable number, a seeded random number
  generator (mulberry32), a fertility map made from smooth seeded noise, and a 60×40 grid of
  plant energy that regrows every tick. The browser draws that grid as a soft green heatmap.
- **Why a seeded generator:** `Math.random` cannot be replayed. With our own generator whose
  whole state is one 32-bit number, the same seed always gives the same world, and saving the
  world just means saving that number too.
- **Why logistic regrowth:** a cell regrows slowly when nearly empty, fastest when half full and
  stops at capacity. Overgrazing therefore hurts (a bare cell recovers slowly), which is what
  pushes creatures to spread out. A tiny "seed" term lets fully bare cells restart.
- **Seasons** multiply regrowth by `1 + seasonAmplitude × sin(2π·tick / seasonPeriod)`.
  **Oases** come from `fertility`, which scales how much each cell can hold.
- **Tweak:** `foodMax` and `foodGrowthRate` (how rich the world is → population size),
  `seasonAmplitude`/`seasonPeriod` (boom-bust strength and length), `fertilityMin`,
  `fertilityNoiseScale`, `fertilityContrast` (how patchy the land is).

## Milestone 2 — creatures and the energy economy
- **What was added:** a creature pool stored as *structure of arrays* (one typed array per field,
  e.g. all x positions together), a genome (`Float32Array`: brain weights then 7 body-trait genes
  in 0..1) and the per-tick energy budget. A placeholder random-walk "brain" drives them for now.
- **Why SoA:** thousands of creatures every tick; typed arrays are compact, fast to loop over,
  create no garbage, and save/load becomes array copies. Dead slots go on a LIFO free list so
  slot assignment is deterministic.
- **Energy per tick:** `− basal − movement + food`. Basal = `basalCost × size × metabolism ×
  (1 + brain/vision/speed-trait surcharges)`; movement = `moveCostCoef × size × speed²`.
  Grazing takes up to `biteSize × size × metabolism × (1 − diet)²` from the cell underfoot.
- **Death:** energy ≤ 0 or age > `maxAge`. The carcass (`bodyEnergy × size` + leftover energy)
  is partly (`corpseDropFraction`) returned to the soil, so death fertilises the land.
- **Tweak:** `basalCost`, `moveCostCoef` (how expensive living/moving is), `biteSize` (how fast
  food converts to energy), `energyPerSize` (reserve size), `maxAge`, `bodyEnergy`.
