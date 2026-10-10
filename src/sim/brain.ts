// Feed-forward neural network: inputs → BRAIN_HIDDEN tanh → BRAIN_OUTPUTS tanh.
// It reads weights straight out of the pool's genome array and writes activations into the
// pool's activation array, so a forward pass allocates nothing. tanh keeps every output in
// [-1, 1], which maps cleanly onto "turn left/right" and "intent on/off" decisions.

import { BRAIN_HIDDEN, BRAIN_INPUTS, BRAIN_OUTPUTS } from './config.ts';
import { B2_OFFSET, W1_OFFSET, W2_OFFSET } from './genome.ts';

/**
 * Run one forward pass.
 * @param genomes   flat genome array; this creature's genome starts at `gOff`
 * @param act       flat activation array; inputs at `aOff`, then hidden, then outputs
 *                  (inputs must already be filled in)
 */
export function forward(genomes: Float32Array, gOff: number, act: Float32Array, aOff: number): void {
  const hOff = aOff + BRAIN_INPUTS;
  const oOff = hOff + BRAIN_HIDDEN;
  let w = gOff + W1_OFFSET;
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    let sum = 0;
    for (let i = 0; i < BRAIN_INPUTS; i++) sum += genomes[w++] * act[aOff + i];
    act[hOff + h] = Math.tanh(sum);
  }
  w = gOff + W2_OFFSET;
  const b = gOff + B2_OFFSET;
  for (let o = 0; o < BRAIN_OUTPUTS; o++) {
    let sum = genomes[b + o];
    for (let h = 0; h < BRAIN_HIDDEN; h++) sum += genomes[w++] * act[hOff + h];
    act[oOff + o] = Math.tanh(sum);
  }
}
