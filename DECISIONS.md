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
