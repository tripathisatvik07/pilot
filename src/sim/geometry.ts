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

/**
 * Fast atan2 (max error ≈ 1e-5 rad), about 3× cheaper than Math.atan2 in V8. Used in the
 * vision hot loop where it runs ~100 times per creature per tick. Pure arithmetic, so it is
 * just as deterministic as Math.atan2.
 */
export function fastAtan2(y: number, x: number): number {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  if (ax === 0 && ay === 0) return 0;
  // Reduce to z in [0, 1] so the polynomial only needs to cover one octant.
  const swap = ay > ax;
  const z = swap ? ax / ay : ay / ax;
  const z2 = z * z;
  let a = z * (0.999866 + z2 * (-0.3302995 + z2 * (0.180141 + z2 * (-0.085133 + z2 * 0.0208351))));
  if (swap) a = Math.PI / 2 - a;
  if (x < 0) a = Math.PI - a;
  return y < 0 ? -a : a;
}
