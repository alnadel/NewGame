// Seeded, platform-independent PRNG utilities. Integer math only (Math.imul, >>>),
// so every engine produces bit-identical sequences. Pure: this module imports nothing, so config
// tables (the campaign builder) and core can both draw from it.

/** xmur3 string hash -> generator of 32-bit unsigned seeds. */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** One-shot 32-bit hash of a string. */
export function hashString(str: string): number {
  return xmur3(str)();
}

/** splitmix32 finalizer: mixes a 32-bit value into a well-distributed 32-bit value. */
export function splitmix32(a: number): number {
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t ^= t >>> 15;
  t = Math.imul(t, 0x735a2d97);
  t ^= t >>> 15;
  return t >>> 0;
}

/** mulberry32 step: returns [nextState, outputUint32]. Kept allocation-free via the Rng class. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Next uint32. */
  u32(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)] as T;
  }

  /** Weighted pick: weights need not sum to 1. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i] as number;
      if (r < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }
}

/**
 * Independent stream for (seed, ...keys). Streams never share state, so adding draws to one
 * stream can't shift another (e.g. rngFor(seed, 'chunk', k)).
 */
export function rngFor(seed: number, ...keys: (string | number)[]): Rng {
  let h = splitmix32(seed >>> 0);
  for (const k of keys) {
    const kh = typeof k === 'number' ? splitmix32((k | 0) ^ 0x5bd1e995) : hashString(k);
    h = splitmix32(h ^ kh);
  }
  return new Rng(h);
}
