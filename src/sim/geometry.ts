// Toroidal geometry helpers. The world wraps on both axes, so "distance" always means the
// shortest way around the torus.

export const TAU = Math.PI * 2;

/** Wrap a coordinate into [0, size). */
export function wrap(v: number, size: number): number {
  if (v >= 0 && v < size) return v; // fast path: most moves stay inside
  v = v % size;
  if (v < 0) v += size;
  // -0 % size can give -0, and float rounding of (tiny negative + size) can give size.
  return v >= size ? 0 : v;
}

/** Shortest signed delta from a to b on a ring of length size, in [-size/2, size/2). */
export function wrapDelta(a: number, b: number, size: number): number {
  let d = b - a;
  const half = size * 0.5;
  if (d >= half) d -= size;
  else if (d < -half) d += size;
  return d;
}

/** Normalise an angle into [-PI, PI). */
export function normAngle(a: number): number {
  if (a >= -Math.PI && a < Math.PI) return a;
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
