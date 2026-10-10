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
   carnivores were starving, not over-hunting). Leaving 80% of each carcass as slowly rotting meat
   that only meat-eaters can digest gives predators a buffer through prey troughs — the classic
   "detritus/scavenger" stabiliser. Carrion alone gave 5/8 seeds; adding richer kills (`meatTransfer` 0.8, `killFeastFraction` 0.8) gave 10/10 (see PROGRESS.md). The "food"
   that vision rays report is therefore *edible* food for that creature: `plants × plantEff +
   carrion × meatEff`.
10. **Satiation (`huntSatiation`) kept as a knob but disabled (1.0)** because the tuning showed it
    hurt carnivores.
11. **Rendering does not draw wrapped copies** of creatures straddling an edge; at their size this is
    invisible, and it halves drawing work.
12. **Stats/events are computed inside the simulation** (every `statsInterval` ticks) and saved with
    the world, so charts and the log survive export/import and are identical headless.
