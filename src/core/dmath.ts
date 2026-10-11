// Deterministic trigonometry for the simulation and world generation.
//
// Math.sin & co. are implementation-defined in JavaScript, so V8 and JavaScriptCore may disagree in
// the last bit, which would fork worlds and replays between Android and iPhone. These functions are
// built only from + − * /, Math.sqrt, Math.round/floor and comparisons, all of which IEEE-754 pins
// down exactly, so every engine produces bit-identical results.
//
// Kernels are fdlibm's (__kernel_sin/__kernel_cos/atan, coefficients copied as literals), with
// Cody-Waite range reduction. Accuracy is within ~1 ulp for |x| ≤ 1e6; determinism is the point.

const PIO2_HI = 1.5707963267341256; // first 33 bits of π/2: k·PIO2_HI is exact for |k| < 2^20
const PIO2_LO = 6.077100506506192e-11; // π/2 − PIO2_HI
const INV_PIO2 = 6.36619772367581382433e-1;
const PI = 3.14159265358979311600e0;
const PI_O_2 = 1.57079632679489655800e0;
const PI_LO = 1.22464679914735317720e-16;

/** Radians per degree and degrees per radian. */
export const DEG = PI / 180;
export const RAD = 180 / PI;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin(x + y) for |x| ≲ π/4, where y is the tail of the reduced argument. */
function kSin(x: number, y: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

/** cos(x + y) for |x| ≲ π/4. */
function kCos(x: number, y: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (((1 - w) - hz) + (z * r - x * y));
}

// Reduction scratch (module-level so the hot path never allocates).
let redR = 0;
let redY = 0;

/** Cody-Waite: x = k·π/2 + (redR + redY). Returns the quadrant k & 3. */
function reduce(x: number): number {
  const k = Math.round(x * INV_PIO2);
  const hi = x - k * PIO2_HI;
  const lo = k * PIO2_LO;
  redR = hi - lo;
  redY = hi - redR - lo;
  return k & 3;
}

/** Deterministic sin (radians). */
export function dsin(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return kSin(x, 0);
  switch (reduce(x)) {
    case 0:
      return kSin(redR, redY);
    case 1:
      return kCos(redR, redY);
    case 2:
      return -kSin(redR, redY);
    default:
      return -kCos(redR, redY);
  }
}

/** Deterministic cos (radians). */
export function dcos(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return kCos(x, 0);
  switch (reduce(x)) {
    case 0:
      return kCos(redR, redY);
    case 1:
      return -kSin(redR, redY);
    case 2:
      return -kCos(redR, redY);
    default:
      return kSin(redR, redY);
  }
}

/** Deterministic tan (radians). */
export function dtan(x: number): number {
  return dsin(x) / dcos(x);
}

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT0 = 3.33333333333329318027e-1;
const AT1 = -1.99999999998764832476e-1;
const AT2 = 1.42857142725034663711e-1;
const AT3 = -1.11111104054623557880e-1;
const AT4 = 9.09088713343650656196e-2;
const AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2;
const AT7 = -5.83357013379057348645e-2;
const AT8 = 4.97687799461593236017e-2;
const AT9 = -3.65315727442169155270e-2;
const AT10 = 1.62858201153657823623e-2;

/** Deterministic atan (radians), fdlibm s_atan.c. */
export function datan(x0: number): number {
  if (x0 !== x0) return NaN;
  const neg = x0 < 0;
  let x = neg ? -x0 : x0;
  if (x >= 7.378697629483821e19) {
    // |x| ≥ 2^66: atan(x) = ±π/2 to working precision.
    const r = ATAN_HI[3] as number;
    return neg ? -r : r;
  }
  let id: number;
  if (x < 0.4375) {
    if (x < 7.450580596923828e-9) return x0; // |x| < 2^-27
    id = -1;
  } else if (x < 1.1875) {
    if (x < 0.6875) {
      id = 0;
      x = (2 * x - 1) / (2 + x);
    } else {
      id = 1;
      x = (x - 1) / (x + 1);
    }
  } else if (x < 2.4375) {
    id = 2;
    x = (x - 1.5) / (1 + 1.5 * x);
  } else {
    id = 3;
    x = -1 / x;
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) {
    const r = x - x * (s1 + s2);
    return neg ? -r : r;
  }
  const r = (ATAN_HI[id] as number) - ((x * (s1 + s2) - (ATAN_LO[id] as number)) - x);
  return neg ? -r : r;
}

/** Deterministic atan2 (radians) in [−π, π], fdlibm e_atan2.c quadrant logic. */
export function datan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x === 1) return datan(y);
  const yNeg = y < 0 || (y === 0 && 1 / y < 0);
  const xNeg = x < 0 || (x === 0 && 1 / x < 0);
  const m = (xNeg ? 2 : 0) + (yNeg ? 1 : 0);
  if (y === 0) {
    if (m === 0 || m === 1) return y;
    return m === 2 ? PI : -PI;
  }
  if (x === 0) return yNeg ? -PI_O_2 : PI_O_2;
  if (x === Infinity || x === -Infinity) {
    if (y === Infinity || y === -Infinity) {
      const q = x === Infinity ? PI / 4 : (3 * PI) / 4;
      return yNeg ? -q : q;
    }
    if (x === Infinity) return yNeg ? -0 : 0;
    return yNeg ? -PI : PI;
  }
  if (y === Infinity || y === -Infinity) return yNeg ? -PI_O_2 : PI_O_2;
  const ay = yNeg ? -y : y;
  const ax = xNeg ? -x : x;
  const q = ay / ax;
  let z: number;
  if (q > 1.152921504606847e18) {
    z = PI_O_2 + 0.5 * PI_LO; // |y/x| > 2^60
  } else if (xNeg && q < 8.673617379884035e-19) {
    z = 0; // |y/x| < 2^-60 with x < 0
  } else {
    z = datan(q);
  }
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

/** Deterministic acos (radians); x is clamped to [−1, 1]. */
export function dacos(x: number): number {
  const c = x < -1 ? -1 : x > 1 ? 1 : x;
  return datan2(Math.sqrt((1 - c) * (1 + c)), c);
}

// ---------------------------------------------------------------------------------------------
// Degree helpers. Reduction happens in degrees (exact for multiples of 90°), so sinD(90) === 1,
// sinD(180) === 0 and cosD(90) === 0 exactly (never −0: negated branches add +0).

/** Quadrant of the last degree reduction and the reduced angle in radians. */
let degR = 0;
function reduceDeg(d: number): number {
  const k = Math.round(d / 90);
  degR = (d - 90 * k) * DEG;
  return k & 3;
}

export function sinD(d: number): number {
  if (d !== d || d === Infinity || d === -Infinity) return NaN;
  switch (reduceDeg(d)) {
    case 0:
      return kSin(degR, 0);
    case 1:
      return kCos(degR, 0);
    case 2:
      return -kSin(degR, 0) + 0;
    default:
      return -kCos(degR, 0) + 0;
  }
}

export function cosD(d: number): number {
  if (d !== d || d === Infinity || d === -Infinity) return NaN;
  switch (reduceDeg(d)) {
    case 0:
      return kCos(degR, 0);
    case 1:
      return -kSin(degR, 0) + 0;
    case 2:
      return -kCos(degR, 0) + 0;
    default:
      return kSin(degR, 0);
  }
}

export function tanD(d: number): number {
  return sinD(d) / cosD(d);
}

/** Direction of (x, y) in degrees, in [0, 360). atan2D(0, 0) is 0. */
export function atan2D(y: number, x: number): number {
  let a = datan2(y, x) * RAD;
  if (a < 0) {
    a += 360;
    if (a >= 360) a = 0;
  }
  return a + 0; // normalizes −0
}

/** acos in degrees, x clamped to [−1, 1]. */
export function acosD(x: number): number {
  return dacos(x) * RAD;
}

/** Wraps an angle into [0, 360). */
export function wrapDeg(a: number): number {
  let r = a - 360 * Math.floor(a / 360);
  if (r >= 360) r -= 360;
  if (r < 0) r += 360;
  return r + 0;
}

/** Signed shortest difference a − b, in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = wrapDeg(a - b);
  return d > 180 ? d - 360 : d;
}

/**
 * Hermite smoothstep: 0 for x ≤ a, 1 for x ≥ b, t²(3 − 2t) with t = (x − a)/(b − a) between.
 * Plain arithmetic, so it is bit-identical on every engine. Requires a < b.
 */
export function smoothstep(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

/** cos/sin of whole degrees: SUN_COS[b] = cosD(b), b ∈ [0, 360). Angular-mask bin centers. */
export const SUN_COS = new Float64Array(360);
export const SUN_SIN = new Float64Array(360);
for (let b = 0; b < 360; b++) {
  SUN_COS[b] = cosD(b);
  SUN_SIN[b] = sinD(b);
}

/** cos/sin of 15°·i, i ∈ [0, 24): caster rotations and detents. */
export const ROT15_COS = new Float64Array(24);
export const ROT15_SIN = new Float64Array(24);
for (let i = 0; i < 24; i++) {
  ROT15_COS[i] = cosD(15 * i);
  ROT15_SIN[i] = sinD(15 * i);
}
