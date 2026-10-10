// Seeded, tileable 2D value noise. Used once at world creation to build the fertility map.
// It must tile because the world is a torus: an oasis crossing the right edge has to
// continue on the left edge, otherwise there would be a visible seam of barren land.

import type { Rng } from './rng.ts';

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** One octave of value noise on a lattice of `latticeW × latticeH` points that wraps. */
class ValueNoiseOctave {
  private readonly lattice: Float64Array;
  private readonly w: number;
  private readonly h: number;

  constructor(rng: Rng, latticeW: number, latticeH: number) {
    this.w = Math.max(1, latticeW);
    this.h = Math.max(1, latticeH);
    this.lattice = new Float64Array(this.w * this.h);
    for (let i = 0; i < this.lattice.length; i++) this.lattice[i] = rng.next();
  }

  /** Sample at (u, v) in [0,1)² of the world; returns roughly 0..1. */
  sample(u: number, v: number): number {
    const fx = u * this.w;
    const fy = v * this.h;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smoothstep(fx - x0);
    const ty = smoothstep(fy - y0);
    const xa = ((x0 % this.w) + this.w) % this.w;
    const ya = ((y0 % this.h) + this.h) % this.h;
    const xb = (xa + 1) % this.w;
    const yb = (ya + 1) % this.h;
    const l = this.lattice;
    const top = l[ya * this.w + xa] * (1 - tx) + l[ya * this.w + xb] * tx;
    const bottom = l[yb * this.w + xa] * (1 - tx) + l[yb * this.w + xb] * tx;
    return top * (1 - ty) + bottom * ty;
  }
}

/**
 * Two-octave fractal value noise. `scale` is how many lattice cells span the world width;
 * the height gets a proportional count so blobs stay roughly round.
 */
export class TileableNoise {
  private readonly octaves: ValueNoiseOctave[];

  constructor(rng: Rng, scale: number, aspect: number) {
    const w = Math.max(1, Math.round(scale));
    const h = Math.max(1, Math.round(scale * aspect));
    this.octaves = [new ValueNoiseOctave(rng, w, h), new ValueNoiseOctave(rng, w * 2, h * 2)];
  }

  sample(u: number, v: number): number {
    // Second octave at half weight adds ragged coastlines to the big blobs.
    return (this.octaves[0].sample(u, v) + 0.5 * this.octaves[1].sample(u, v)) / 1.5;
  }
}
