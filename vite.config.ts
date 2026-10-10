import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the production build works from any sub-path (e.g. GitHub Pages).
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    // The headless/tuning tests run thousands of ticks; give them room on slow machines.
    testTimeout: 120_000,
  },
});
