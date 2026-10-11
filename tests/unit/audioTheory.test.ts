import { describe, expect, it } from 'vitest';
import {
  ARP_CHANCE,
  ARP_PATTERNS,
  C4_HZ,
  PROGRESSION,
  STEP_S,
  arpHit,
  arpLevel,
  arpNoteSemis,
  bellDegree,
  chordAt,
  crackleRate,
  degreeHz,
  degreeSemis,
  detentHz,
  heartbeatPeriod,
  keyOffset,
  keyRootHz,
  multUpNotes,
  noonWindow,
  padCutoffHz,
  sizzleAmount,
  sizzleHz,
} from '../../src/audio/theory.ts';

const pc = (s: number) => ((s % 12) + 12) % 12;

describe('tempo', () => {
  it('runs a 90 BPM 16th-note grid', () => {
    expect(STEP_S).toBeCloseTo(0.16667, 4);
  });
});

describe('key system', () => {
  it('moves up a fifth each day, folded into [-5, +6] semitones around C4', () => {
    const offsets = Array.from({ length: 13 }, (_, i) => keyOffset(i + 1));
    // C, G, D, A, E, B, F#, C#, G#, D#, A#, F, C
    expect(offsets).toEqual([0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5, 0]);
    for (let day = 1; day < 40; day++) {
      expect(pc(keyOffset(day + 1) - keyOffset(day))).toBe(7);
      expect(keyOffset(day)).toBeGreaterThanOrEqual(-5);
      expect(keyOffset(day)).toBeLessThanOrEqual(6);
    }
  });

  it('puts Day 1 at C4 and later days on the right tonic', () => {
    expect(keyRootHz(1)).toBeCloseTo(261.63, 2);
    expect(keyRootHz(1)).toBe(C4_HZ);
    expect(keyRootHz(2)).toBeCloseTo(196.0, 1); // G3
    expect(keyRootHz(4)).toBeCloseTo(220.0, 1); // A3
    expect(keyRootHz(0)).toBe(C4_HZ); // clamps nonsense days to Day 1
  });
});

describe('pentatonic degrees', () => {
  it('maps degrees to major-pentatonic semitones across octaves', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(degreeSemis)).toEqual([0, 2, 4, 7, 9, 12, 14, 21]);
    expect(degreeSemis(-1)).toBe(-3);
    expect(degreeSemis(-5)).toBe(-12);
  });

  it('gives flake-bell frequencies in octaves 5-6', () => {
    expect(degreeHz(1, 0, 5)).toBeCloseTo(523.25, 1); // C5
    expect(degreeHz(1, 3, 5)).toBeCloseTo(783.99, 1); // G5
    expect(degreeHz(1, 9, 5)).toBeCloseTo(1760.0, 1); // A6
    expect(degreeHz(2, 0, 5)).toBeCloseTo(392.0, 1); // G4 on Day 2
  });

  it('folds any pickup count into degrees 0..9', () => {
    expect([0, 9, 10, 23, -1, -11].map(bellDegree)).toEqual([0, 9, 0, 3, 9, 9]);
  });
});

describe('harmony', () => {
  const triads: Record<string, number[]> = { I: [0, 4, 7], vi: [9, 0, 4], IV: [5, 9, 0], V: [7, 11, 2] };
  const roots: Record<string, number> = { I: 0, vi: 9, IV: 5, V: 7 };

  it('cycles I-vi-IV-V', () => {
    expect(PROGRESSION.map((c) => c.name)).toEqual(['I', 'vi', 'IV', 'V']);
    expect(chordAt(4).name).toBe('I');
    expect(chordAt(-1).name).toBe('V');
  });

  it('voices each chord with its own tones and its root in the bass', () => {
    for (const c of PROGRESSION) {
      expect(c.tones.map(pc).sort((a, b) => a - b)).toEqual([...(triads[c.name] as number[])].sort((a, b) => a - b));
      expect(pc(c.bass)).toBe(roots[c.name]);
    }
  });

  it('voice-leads smoothly around the whole cycle, V back to I included', () => {
    let total = 0;
    for (let i = 0; i < PROGRESSION.length; i++) {
      const a = chordAt(i).tones;
      const b = chordAt(i + 1).tones;
      for (let v = 0; v < 3; v++) {
        const move = Math.abs((b[v] as number) - (a[v] as number));
        expect(move).toBeLessThanOrEqual(3);
        total += move;
      }
    }
    // 12 semitones per cycle is the minimum possible for I-vi-IV-V in close position.
    expect(total).toBe(12);
  });

  it('keeps the pad within a fifth of the tonic', () => {
    for (const c of PROGRESSION) for (const t of c.tones) expect(Math.abs(t)).toBeLessThanOrEqual(7);
  });
});

describe('arpeggio density follows the Frost multiplier', () => {
  const hits = (level: 1 | 2 | 3 | 4 | 5) => ARP_PATTERNS[level].filter((h) => h !== 0).length;

  it('matches the GDD table', () => {
    // ×1 quarters at 50%, ×2 quarters, ×3 8ths, ×4 8ths + syncopated 16ths, ×5 full 16ths + octaves.
    expect(hits(1)).toBe(4);
    expect(ARP_CHANCE[1]).toBe(0.5);
    expect(hits(2)).toBe(4);
    expect(ARP_CHANCE[2]).toBe(1);
    expect(hits(3)).toBe(8);
    expect(hits(4)).toBe(10);
    expect(ARP_PATTERNS[4][3]).toBe(1); // a 16th off the 8th grid
    expect(hits(5)).toBe(16);
    expect(ARP_PATTERNS[5].filter((h) => h === 2).length).toBeGreaterThanOrEqual(4);
    for (const level of [1, 2, 3, 4] as const) expect(ARP_PATTERNS[level]).not.toContain(2);
  });

  it('never gets sparser as the multiplier climbs, and quarters fall on the beat', () => {
    for (const level of [1, 2, 3, 4] as const) {
      expect(hits((level + 1) as 2 | 3 | 4 | 5)).toBeGreaterThanOrEqual(hits(level));
      ARP_PATTERNS[level].forEach((h, step) => {
        if (step % 4 === 0) expect(h).not.toBe(0);
      });
    }
  });

  it('clamps levels and silences level 0', () => {
    expect(arpLevel(0.2)).toBe(1);
    expect(arpLevel(3.4)).toBe(3);
    expect(arpLevel(9)).toBe(5);
    expect(arpHit(0, 0)).toBe(0);
    expect(arpHit(2, 16)).toBe(1); // wraps by bar
    expect(arpHit(2, 1)).toBe(0);
    expect(arpHit(3, -2)).toBe(ARP_PATTERNS[3][14]);
  });

  it('walks the chord an octave above the pad, up then down, with octave jumps on demand', () => {
    const I = chordAt(0);
    const walk = Array.from({ length: 8 }, (_, n) => arpNoteSemis(I, n, 1));
    // I is voiced G-C-E, so the arpeggio rolls G5 C6 E6 G6 and back.
    expect(walk).toEqual([7, 12, 16, 19, 16, 12, 7, 12]);
    expect(arpNoteSemis(I, 0, 2)).toBe(19);
  });
});

describe('state → sound curves', () => {
  it('pad cutoff: warm at dawn, bright at noon, 500 Hz at night', () => {
    expect(padCutoffHz(0, 48, false)).toBe(300);
    expect(padCutoffHz(48, 48, false)).toBe(2500);
    expect(padCutoffHz(24, 48, false)).toBe(850);
    expect(padCutoffHz(60, 48, false)).toBe(2500);
    expect(padCutoffHz(30, 48, true)).toBe(500);
  });

  it('noon cicadas swell in over 0.4-0.5 Dl and out by 0.6 Dl', () => {
    expect(noonWindow(0.3)).toBe(0);
    expect(noonWindow(0.4)).toBe(0);
    expect(noonWindow(0.45)).toBeCloseTo(0.5, 6);
    expect(noonWindow(0.5)).toBe(1);
    expect(noonWindow(0.55)).toBeCloseTo(0.5, 6);
    expect(noonWindow(0.6)).toBe(0);
    expect(noonWindow(0.9)).toBe(0);
    for (let u = 0.4; u < 0.5; u += 0.01) expect(noonWindow(u + 0.01)).toBeGreaterThanOrEqual(noonWindow(u));
  });

  it('sizzle follows f', () => {
    expect(sizzleAmount(0)).toBe(0);
    expect(sizzleAmount(2)).toBe(1.5);
    expect(sizzleHz(0)).toBe(2500);
    expect(sizzleHz(1)).toBe(6000);
    expect(sizzleHz(2)).toBe(6000);
    expect(crackleRate(1, 0)).toBe(20);
    expect(crackleRate(1, 1)).toBe(30);
    expect(crackleRate(2, 1)).toBe(40);
  });

  it('heartbeat runs below 25 Chill, faster below 10', () => {
    expect(heartbeatPeriod(25)).toBe(0);
    expect(heartbeatPeriod(24.9)).toBe(0.85);
    expect(heartbeatPeriod(9.9)).toBe(0.6);
  });

  it('detent clicks climb a five-step quarter-tone ladder', () => {
    expect(detentHz(0)).toBe(1800);
    expect(detentHz(4)).toBeCloseTo(1800 * Math.pow(2, 4 / 24), 6);
    expect(detentHz(5)).toBe(1800);
    expect(detentHz(-1)).toBeCloseTo(detentHz(4), 9);
  });

  it('multiplier-up chimes start root→fifth and climb with the level', () => {
    expect(multUpNotes(2)).toEqual([0, 7]);
    let prev = -1;
    for (const level of [2, 3, 4, 5]) {
      const first = multUpNotes(level)[0] as number;
      expect(first).toBeGreaterThan(prev);
      prev = first;
    }
    expect(multUpNotes(5)).toContain(12);
  });
});
