// The simulation core must stay pure so it runs headless and deterministically.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SIM_DIR = join(import.meta.dirname, '..', 'src', 'sim');
const FORBIDDEN = [/Math\.random/, /Date\.now/, /performance\.now/, /\bdocument\./, /\bwindow\./, /new Date\(/];

describe('src/sim purity', () => {
  for (const file of readdirSync(SIM_DIR).filter((f) => f.endsWith('.ts'))) {
    it(`${file} has no DOM, clock or Math.random use`, () => {
      // Strip comments first: explaining *why* we avoid Math.random is fine, calling it is not.
      const src = readFileSync(join(SIM_DIR, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const re of FORBIDDEN) expect(src, `${file} matches ${re}`).not.toMatch(re);
    });
  }
});
