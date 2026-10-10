// Seeded PRNG. The simulation must be reproducible, so every random decision goes through
// one of these instead of Math.random. mulberry32 is tiny, fast and its whole state is a
// single uint32, which makes saving/restoring the generator trivial.

export class Rng {
  /** Current 32-bit state. Public so World can serialise it. */
  state: number;

  constructor(seed: number) {
    // Force to uint32 so any integer seed (or a hashed string) is a valid state.
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /**
   * Standard normal sample (Box–Muller). We deliberately do not cache the second value:
   * a cached spare would be hidden state that must also be serialised.
   */
  gaussian(): number {
    // 1 - next() is in (0, 1], so log never sees 0.
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/** Turn an arbitrary string (e.g. the seed box in the UI) into a uint32 seed (FNV-1a). */
export function hashSeed(text: string): number {
  const asNumber = Number(text);
  if (text.trim() !== '' && Number.isInteger(asNumber)) return asNumber >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
