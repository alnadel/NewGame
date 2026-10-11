import { describe, expect, it } from 'vitest';
import { hashString, Rng, rngFor, splitmix32, xmur3 } from '../../src/core/rng.ts';

describe('rng', () => {
  it('produces the known first outputs for seed 1', () => {
    const r = new Rng(1);
    const out: number[] = [];
    for (let i = 0; i < 10; i++) out.push(r.u32());
    expect(out).toEqual([
      2693262067, 11749833, 2265367787, 4213581821, 4159151403, 1207330352, 2632122864, 3095568220, 1828783984,
      4272732017,
    ]);
  });

  it('produces the known first outputs for seed 0xDEADBEEF', () => {
    const r = new Rng(0xdeadbeef);
    const out: number[] = [];
    for (let i = 0; i < 10; i++) out.push(r.u32());
    expect(out).toEqual([
      4043151706, 1147597007, 3315858022, 1538288752, 2042435954, 3600176436, 484360372, 1362401224, 379893202,
      1051950098,
    ]);
  });

  it('rngFor streams are stable and independent', () => {
    const a = rngFor(42, 'chunk', 3);
    expect([a.u32(), a.u32(), a.u32()]).toEqual([3324348458, 4069260069, 1080803164]);
    // Drawing from one stream never shifts another.
    const b1 = rngFor(42, 'chunk', 4);
    const first = b1.u32();
    const noisy = rngFor(42, 'chunk', 3);
    for (let i = 0; i < 100; i++) noisy.u32();
    expect(rngFor(42, 'chunk', 4).u32()).toBe(first);
    expect(rngFor(42, 'chunk', 4).u32()).not.toBe(rngFor(42, 'chunk', 5).u32());
    expect(rngFor(42, 'trail').u32()).not.toBe(rngFor(43, 'trail').u32());
  });

  it('int stays within inclusive bounds and hits both ends', () => {
    const r = new Rng(7);
    let lo = false;
    let hi = false;
    for (let i = 0; i < 5000; i++) {
      const v = r.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
      expect(Number.isInteger(v)).toBe(true);
      if (v === 3) lo = true;
      if (v === 9) hi = true;
    }
    expect(lo && hi).toBe(true);
  });

  it('next/range/chance/pick/weighted behave', () => {
    const r = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const y = r.range(-2, 5);
      expect(y).toBeGreaterThanOrEqual(-2);
      expect(y).toBeLessThan(5);
    }
    expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']));
    for (let i = 0; i < 200; i++) expect(r.weighted(['x', 'y'], [0, 1])).toBe('y');
  });

  it('string hashing is stable', () => {
    expect(hashString('shady-daily-2026-10-11')).toBe(3742440394);
    const g = xmur3('abc');
    expect(g()).not.toBe(g());
    expect(splitmix32(0)).toBe(splitmix32(0));
  });
});
