# Decisions

Ambiguities resolved autonomously while building, with the reason for each.

1. **All coding done in this single session (no Sonnet sub-agents / paste-in prompts).** The
   user preference mentions planning with Opus and coding with Sonnet, but the task brief says
   the user is away and the work must be fully autonomous; handing off prompts to paste would
   block on a human. The architecture plan was still written first (ARCHITECTURE.md).
2. **Toolchain pinned to well-known majors** (Vite 7, Vitest 3, TypeScript 5.9) instead of the
   newest majors, to avoid surprises from releases newer than my experience.
3. **Scripts run with Node's built-in TypeScript type-stripping** (`node scripts/x.ts`, Node ≥ 22.18)
   rather than adding `tsx`. That requires `.ts` extensions in imports and only erasable syntax
   (no `enum`, no parameter properties) — enforced with `erasableSyntaxOnly` in tsconfig.
4. **Plant consumption is limited by diet** (`bite × (1 − diet)²`), not just the energy gained.
   Otherwise carnivores with the eat intent on would strip plants they cannot digest.
5. **Convex diet trade-off** (`plantEff = (1 − diet)²`, `meatEff = diet²`). A linear trade-off makes
   generalists as good as specialists; the convex one rewards committing to one niche, which is
   what produces distinct herbivore and carnivore groups.
6. **Founders: 90% herbivores (diet 0–0.15), 10% carnivores (diet 0.8–1).** Evolving carnivory from
   scratch requires crossing a fitness valley and happens rarely; seeding both niches makes
   coexistence a question of ecology rather than luck. The "first carnivore" event therefore means
   the first carnivore *born* (generation ≥ 1). Set `initialCarnivoreFraction: 0` to watch carnivory
   (try to) evolve from scratch.
7. **One output for eat and attack** (as specified). Attacking costs energy proportional to meat
   efficiency, so herbivores (meat efficiency ≈ 0) never attack and pay nothing; below
   `MIN_MEAT_EFF` an attack is not attempted at all.
8. **Attack target = nearest creature inside a ±`attackCone` wedge within body radii + `attackReach`**,
   chosen during sensing (same snapshot as vision). Damage scales with attacker size, metabolism,
   meat efficiency and the clamped size ratio.
9. **Carrion field added (not in the original brief).** With predation alone, carnivores went extinct
   in 5/5 seeds (Lotka–Volterra troughs drove them to zero; a satiation rule made it worse because
   carnivores were starving, not over-hunting). Leaving each carcass as slowly rotting meat (shipped: 100%)
   that only meat-eaters can digest gives predators a buffer through prey troughs — the classic
   "detritus/scavenger" stabiliser. Carrion alone gave 5/8 seeds; adding richer kills (`meatTransfer` 0.8, `killFeastFraction` 0.8) gave 10/10; after the performance changes the same rules gave 7/10, and leaving the *whole* carcass as carrion (`carrionFraction` 1.0) gave the shipped 8/10 (4/5 on seeds 1–5). See PROGRESS.md. The "food"
   that vision rays report is therefore *edible* food for that creature: `plants × plantEff +
   carrion × meatEff`.
10. **Satiation (`huntSatiation`) kept as a knob but disabled (1.0)** because the tuning showed it
    hurt carnivores.
11. **Rendering does not draw wrapped copies** of creatures straddling an edge; at their size this is
    invisible, and it halves drawing work.
12. **Stats/events are computed inside the simulation** (every `statsInterval` ticks) and saved with
    the world, so charts and the log survive export/import and are identical headless.
13. **Performance targets: measured, partly met, documented here** (Node 22 on the 4-core session
    container; Chromium = pre-installed headless build, software rendering).
    * *2,000+ creatures at 60 fps:* at 2,200 creatures the simulation takes **7.7 ms/tick** and
      drawing **2.9 ms/frame** (measured in the browser), i.e. ~10.6 ms of JavaScript per frame, which
      fits the 16.7 ms budget. Headless Chromium itself only delivered **34 fps** for that page: even
      at ~1,000 creatures with 3.3 ms of JS per frame it reached only 56 fps, so the remaining gap is
      the GPU-less container's compositing, which I could not test around (final run: 33.9 fps at
      2,200 creatures; 49 fps at ~1,000 creatures with 3.2 ms sim + 0.9 ms draw). On a normal desktop
      browser 60 fps at ~2,000 creatures is plausible but **not verified**.
    * *100,000 headless ticks in about a minute:* **missed** — measured **112–120 s** (830–890
      ticks/s) with the default world, which averages ~500 creatures. Per-creature cost is ~2 µs/tick (sensing ~1 µs, brain
      ~0.7 µs).
    * One optimization round was done after profiling (sensing was 80% of the tick): local-frame
      cone test, nearest-distance pruning, front-only rejection, `fastAtan2`, rotated ray vectors.
      That cut the dense tick from 23 ms to ~15 ms at ~3,000 creatures. Hash cell sizes 15–80 were
      benchmarked; 40 was best. An unrolled brain forward pass was measured at only ~20% faster for
      ~20% of the tick, so it was not worth the unreadable code.
    * Further options if needed: a WebAssembly core, a Web Worker for the simulation, or sensing
      every other tick for half the creatures. I left these out to keep the code easy to understand.
14. **Stopped coexistence tuning at 8/10 seeds (4/5 on seeds 1–5)** rather than adding an
    immigration floor for carnivores, which would guarantee "coexistence" artificially. The floor
    exists (`immigrationFloor`) but is off, and it would add random founders of both diets, not
    rescue carnivores specifically.
15. **Energy is not strictly conserved.** A carcass both fertilises plants (`corpseDropFraction`) and
    leaves carrion (`carrionFraction`), and plants regrow from nothing (sunlight). That is deliberate:
    the world is an open system, and the knobs are easier to reason about one at a time.
