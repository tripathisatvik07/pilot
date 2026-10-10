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
