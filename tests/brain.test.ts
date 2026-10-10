import { describe, expect, it } from 'vitest';
import { forward } from '../src/sim/brain.ts';
import { BRAIN_HIDDEN, BRAIN_INPUTS, BRAIN_OUTPUTS } from '../src/sim/config.ts';
import { B2_OFFSET, GENOME_LENGTH, W1_OFFSET, W2_OFFSET } from '../src/sim/genome.ts';
import { Rng } from '../src/sim/rng.ts';

const STRIDE = BRAIN_INPUTS + BRAIN_HIDDEN + BRAIN_OUTPUTS;

describe('brain forward pass', () => {
  it('matches a hand-computed example', () => {
    const g = new Float32Array(GENOME_LENGTH);
    const act = new Float32Array(STRIDE);
    const BIAS = BRAIN_INPUTS - 2; // index of the constant-1 input
    act[BIAS] = 1;
    act[0] = 0.5;
    // hidden0 = tanh(0.5·1 + 2·0.5) = tanh(1.5)
    g[W1_OFFSET + 0 * BRAIN_INPUTS + BIAS] = 0.5;
    g[W1_OFFSET + 0 * BRAIN_INPUTS + 0] = 2;
    // hidden1 = tanh(−1·1) = tanh(−1)
    g[W1_OFFSET + 1 * BRAIN_INPUTS + BIAS] = -1;
    // out0 = tanh(0.1 + 1·h0 − 2·h1)
    g[B2_OFFSET + 0] = 0.1;
    g[W2_OFFSET + 0 * BRAIN_HIDDEN + 0] = 1;
    g[W2_OFFSET + 0 * BRAIN_HIDDEN + 1] = -2;
    // out3 = tanh(−0.3) (bias only)
    g[B2_OFFSET + 3] = -0.3;

    forward(g, 0, act, 0);

    const h0 = Math.tanh(1.5);
    const h1 = Math.tanh(-1);
    expect(act[BRAIN_INPUTS + 0]).toBeCloseTo(h0, 6);
    expect(act[BRAIN_INPUTS + 1]).toBeCloseTo(h1, 6);
    for (let h = 2; h < BRAIN_HIDDEN; h++) expect(act[BRAIN_INPUTS + h]).toBe(0);
    const out = BRAIN_INPUTS + BRAIN_HIDDEN;
    expect(act[out + 0]).toBeCloseTo(Math.tanh(0.1 + h0 - 2 * h1), 6);
    expect(act[out + 1]).toBe(0);
    expect(act[out + 2]).toBe(0);
    expect(act[out + 3]).toBeCloseTo(Math.tanh(-0.3), 6);
  });

  it('matches a naive matrix implementation for random weights, at an offset', () => {
    const rng = new Rng(3);
    const g = new Float32Array(GENOME_LENGTH * 3);
    for (let i = 0; i < g.length; i++) g[i] = rng.gaussian();
    const act = new Float32Array(STRIDE * 2);
    const inputs = Array.from({ length: BRAIN_INPUTS }, () => rng.range(-1, 1));
    act.set(inputs, STRIDE);
    const gOff = GENOME_LENGTH * 2;
    forward(g, gOff, act, STRIDE);

    const W1 = (h: number, i: number) => g[gOff + W1_OFFSET + h * BRAIN_INPUTS + i];
    const W2 = (o: number, h: number) => g[gOff + W2_OFFSET + o * BRAIN_HIDDEN + h];
    const hidden = Array.from({ length: BRAIN_HIDDEN }, (_, h) =>
      Math.tanh(inputs.reduce((s, x, i) => s + W1(h, i) * Math.fround(x), 0)),
    );
    for (let o = 0; o < BRAIN_OUTPUTS; o++) {
      const z = g[gOff + B2_OFFSET + o] + hidden.reduce((s, x, h) => s + W2(o, h) * Math.fround(x), 0);
      expect(act[STRIDE + BRAIN_INPUTS + BRAIN_HIDDEN + o]).toBeCloseTo(Math.tanh(z), 5);
    }
    // The first activation block must be untouched.
    for (let i = 0; i < STRIDE; i++) expect(act[i]).toBe(0);
  });

  it('zero weights give zero outputs (creature idles)', () => {
    const g = new Float32Array(GENOME_LENGTH);
    const act = new Float32Array(STRIDE).fill(0.7);
    forward(g, 0, act, 0);
    for (let o = 0; o < BRAIN_OUTPUTS; o++) expect(act[BRAIN_INPUTS + BRAIN_HIDDEN + o]).toBe(0);
  });
});
