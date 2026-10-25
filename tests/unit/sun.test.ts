// V1_PLAN §3.4: the eight required sun-control cases, driven through updateSun().
import { describe, expect, it } from 'vitest';
import { angleDiff } from '../../src/core/dmath.ts';
import { createRun } from '../../src/core/sim/create.ts';
import type { SimEvent } from '../../src/core/sim/events.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { updateSun } from '../../src/core/sim/sun.ts';
import type { InputFrame, SimState } from '../../src/core/sim/types.ts';

const base = createRun(headlessConfig(1));

/** A run state with the sun at θ, sun elevation eps (30° → 600°/s follow) and no events. */
function sunState(theta: number, eps = 30, reducedMotion = false): SimState {
  const s: SimState = {
    ...base,
    cfg: { ...base.cfg, reducedMotion },
    eps,
    events: [],
    sun: { theta, lag: 0, omega: 0, omegaRel: 0, mode: 'idle', detent: Math.floor(theta / 15), dTheta: 0, keyTicks: 0, keySign: 0, gust: 0, locked: false },
  };
  return s;
}

function f(p: Partial<InputFrame> = {}): InputFrame {
  return { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0, ...p };
}

/** Steps until the sun is idle (or n ticks); returns all events. */
function settle(s: SimState, n = 600): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n && s.sun.mode !== 'idle'; i++) {
    s.events.length = 0;
    updateSun(s, f());
    all.push(...s.events);
  }
  return all;
}

describe('sun control', () => {
  it('1. catching mid-coast moves θ by less than 1°', () => {
    const s = sunState(100);
    s.sun.mode = 'coasting';
    s.sun.omega = 300;
    updateSun(s, f({ downEdge: true, down: true }));
    expect(s.events.some((e) => e.e === 'catch' && e.omega === 300)).toBe(true);
    for (let i = 0; i < 30; i++) updateSun(s, f({ down: true }));
    expect(Math.abs(angleDiff(s.sun.theta, 100))).toBeLessThan(1);
    expect(s.sun.omega).toBe(0);
    expect(s.sun.mode).toBe('dragging');
  });

  it('2. a 180° drag over 120 ms then a 60 ms hold ends within 1° of +180°', () => {
    const s = sunState(20);
    const per = 180 / 7;
    updateSun(s, f({ downEdge: true, down: true, dTheta: per }));
    for (let i = 1; i < 7; i++) updateSun(s, f({ down: true, dTheta: per }));
    for (let i = 0; i < 3; i++) updateSun(s, f({ down: true }));
    updateSun(s, f({ upEdge: true, release: 0 }));
    settle(s);
    expect(Math.abs(angleDiff(s.sun.theta, 200))).toBeLessThan(1);
    expect(s.sun.mode).toBe('idle');
  });

  it("3. the release tick's dTheta is applied", () => {
    const s = sunState(0);
    updateSun(s, f({ downEdge: true, down: true }));
    updateSun(s, f({ upEdge: true, dTheta: 30, release: 0 }));
    settle(s);
    expect(Math.abs(angleDiff(s.sun.theta, 30))).toBeLessThan(1e-9);
  });

  it('4. key and finger together never oscillate', () => {
    const s = sunState(180);
    updateSun(s, f({ downEdge: true, down: true, dTheta: 2, key: -1 }));
    let sign = 0;
    for (let i = 0; i < 120; i++) {
      updateSun(s, f({ down: true, dTheta: 2, key: -1 }));
      const d = s.sun.dTheta;
      if (sign === 0) sign = Math.sign(d);
      expect(Math.sign(d)).toBe(sign);
      expect(Math.abs(d)).toBeLessThanOrEqual(3.5 + 1e-9); // +2 finger, −2.5 … −5.5 key
    }
    // Finger alone afterwards just follows the finger; no stored lag fights it.
    updateSun(s, f({ down: true, dTheta: 2 }));
    expect(s.sun.dTheta).toBeCloseTo(2, 9);
  });

  it('5. coasting decays by e^(−3.5/60) per tick and stops below 5°/s', () => {
    const s = sunState(0);
    s.sun.mode = 'coasting';
    s.sun.omega = 200;
    updateSun(s, f());
    expect(s.sun.theta).toBeCloseTo(200 / 60, 9);
    expect(s.sun.omega).toBeCloseTo(200 * 0.9433354499, 9);
    settle(s);
    expect(s.sun.omega).toBe(0);
    // Total travel ≈ ω·DT/(1 − friction) minus the tail below 5°/s.
    expect(s.sun.theta).toBeGreaterThan(55);
    expect(s.sun.theta).toBeLessThan(59);
  });

  it('6. release velocity is clamped to ±360°/s (±180°/s reduced motion)', () => {
    for (const [reduced, cap] of [
      [false, 360],
      [true, 180],
    ] as const) {
      const s = sunState(0, 30, reduced);
      updateSun(s, f({ downEdge: true, down: true }));
      updateSun(s, f({ upEdge: true, release: -1000 }));
      expect(s.sun.mode).toBe('coasting');
      expect(s.sun.omega).toBe(-cap);
    }
  });

  it('7. follow rate caps at 600, 450 (ε < 15°) and 300 (reduced motion) °/s', () => {
    for (const [eps, reduced, rate] of [
      [30, false, 600],
      [10, false, 450],
      [30, true, 300],
      [10, true, 300],
    ] as const) {
      const s = sunState(0, eps, reduced);
      updateSun(s, f({ downEdge: true, down: true, dTheta: 90 }));
      expect(s.sun.dTheta).toBeCloseTo(rate / 60, 9);
      expect(s.sun.lag).toBeCloseTo(90 - rate / 60, 9);
    }
  });

  it('the sunFollow and sunFriction params still cap the follow and stop the coast (no concept sets them: Controls v3)', () => {
    const s = sunState(0);
    s.params = { ...s.params, sunFollow: 220, sunFriction: 0 };
    updateSun(s, f({ downEdge: true, down: true, dTheta: 90 }));
    expect(s.sun.dTheta).toBeCloseTo(220 / 60, 9);
    updateSun(s, f({ upEdge: true, release: 1000 }));
    expect(s.sun.omegaRel).toBe(0);
    expect(settle(s).length).toBeGreaterThanOrEqual(0);
    expect(s.sun.mode).toBe('idle');
    // The retired gusts never blow: SunState.gust stays 0.
    expect(s.sun.gust).toBe(0);
  });

  it('8. a detent event at each 15° crossing', () => {
    const s = sunState(1);
    const events: SimEvent[] = [];
    // A fine key turns a steady 90°/s: 240 ticks are one full turn.
    for (let i = 0; i < 240; i++) {
      s.events.length = 0;
      updateSun(s, f({ key: 2 }));
      events.push(...s.events);
    }
    const detents = events.filter((e) => e.e === 'detent');
    expect(detents.length).toBe(24);
    expect(detents.every((e) => e.e === 'detent' && e.dir === 1)).toBe(true);
    expect(new Set(detents.map((e) => (e.e === 'detent' ? e.index : -1))).size).toBe(24);
    // And clockwise.
    const back: SimEvent[] = [];
    for (let i = 0; i < 20; i++) {
      s.events.length = 0;
      updateSun(s, f({ key: -2 }));
      back.push(...s.events);
    }
    expect(back.filter((e) => e.e === 'detent' && e.dir === -1).length).toBe(2);
  });

  it('catch semantics are unchanged by K1: a flick coasts and a touch-down still stops it dead', () => {
    const s = sunState(10);
    updateSun(s, f({ downEdge: true, down: true }));
    updateSun(s, f({ upEdge: true, release: 900 }));
    expect(s.sun.mode).toBe('coasting');
    for (let i = 0; i < 10; i++) updateSun(s, f());
    const at = s.sun.theta;
    expect(s.sun.omega).toBeGreaterThan(200);
    s.events.length = 0;
    updateSun(s, f({ downEdge: true, down: true }));
    expect(s.events.some((e) => e.e === 'catch')).toBe(true);
    expect(s.sun.omega).toBe(0);
    expect(s.sun.mode).toBe('dragging');
    for (let i = 0; i < 30; i++) updateSun(s, f({ down: true }));
    expect(Math.abs(angleDiff(s.sun.theta, at))).toBeLessThan(1e-9);
  });

  it('a fast 270° swipe goes the long way round', () => {
    const s = sunState(0);
    updateSun(s, f({ downEdge: true, down: true, dTheta: 270 }));
    for (let i = 0; i < 40; i++) updateSun(s, f({ down: true }));
    expect(Math.abs(angleDiff(s.sun.theta, 270))).toBeLessThan(1e-9);
    // It travelled counter-clockwise the whole time.
    expect(s.sun.lag).toBe(0);
  });
});

/** Touches down, lifts at `release` °/s and lets the sun settle. Returns ω_rel at the lift and the coast travel (°). */
function flick(release: number, reducedMotion = false): { omegaRel: number; omega: number; travel: number; mode: string } {
  const s = sunState(0, 30, reducedMotion);
  updateSun(s, f({ downEdge: true, down: true }));
  updateSun(s, f({ upEdge: true, release }));
  const out = { omegaRel: s.sun.mode === 'chasing' ? s.sun.omegaRel : s.sun.omega, omega: s.sun.omega, travel: 0, mode: s.sun.mode as string };
  for (let i = 0; i < 600 && s.sun.mode !== 'idle'; i++) {
    updateSun(s, f());
    out.travel += s.sun.dTheta;
  }
  return out;
}

describe('keyboard parity (CO5)', () => {
  /** Holds `key` for n ticks; returns the per-tick turns. */
  const holdKey = (s: SimState, key: InputFrame['key'], n: number): number[] => {
    const turns: number[] = [];
    for (let i = 0; i < n; i++) {
      updateSun(s, f({ key }));
      turns.push(s.sun.dTheta);
    }
    return turns;
  };

  it('a 1-tick tap turns 2.5°, and the rate ramps to 330°/s over 15 held ticks', () => {
    const tap = sunState(100);
    expect(holdKey(tap, 1, 1)[0]).toBeCloseTo(2.5, 9);
    updateSun(tap, f());
    expect(tap.sun.keyTicks).toBe(0);
    const s = sunState(100);
    const turns = holdKey(s, -1, 40);
    expect(turns[0]).toBeCloseTo(-2.5, 9);
    for (let i = 1; i < turns.length; i++) expect(Math.abs(turns[i]!)).toBeGreaterThanOrEqual(Math.abs(turns[i - 1]!) - 1e-9);
    expect(turns[15]).toBeCloseTo(-330 / 60, 9);
    expect(turns[39]).toBeCloseTo(-330 / 60, 9);
    expect(Math.abs(turns[14]!)).toBeLessThan(330 / 60);
  });

  it('60 held ticks turn at least 250°; Shift (±2) turns at a steady 90°/s', () => {
    const s = sunState(0);
    const total = holdKey(s, 1, 60).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(250);
    const fine = sunState(0);
    for (const t of holdKey(fine, -2, 30)) expect(t).toBeCloseTo(-90 / 60, 9);
    for (const t of holdKey(fine, 2, 5)) expect(t).toBeCloseTo(90 / 60, 9);
  });

  it('a reversal or a release restarts the ramp; fine keys keep counting the same sign', () => {
    const s = sunState(0);
    holdKey(s, 1, 20);
    expect(holdKey(s, -1, 1)[0]).toBeCloseTo(-2.5, 9);
    holdKey(s, -2, 20);
    expect(s.sun.keyTicks).toBe(21);
    expect(holdKey(s, -1, 1)[0]).toBeCloseTo(-5.5, 9);
    updateSun(s, f());
    expect(holdKey(s, -1, 1)[0]).toBeCloseTo(-2.5, 9);
  });
});

describe('only genuine flicks coast (K1)', () => {
  it('a 150°/s lift does not coast: the sun is idle once the chase ends', () => {
    const r = flick(150);
    expect(r.omegaRel).toBe(0);
    expect(r.mode).toBe('idle');
    expect(r.travel).toBe(0);
    // Also with a remaining lag to chase: the chase ends, then nothing.
    const s = sunState(0);
    updateSun(s, f({ downEdge: true, down: true, dTheta: 40 }));
    updateSun(s, f({ upEdge: true, dTheta: 20, release: -150 }));
    expect(s.sun.mode).toBe('chasing');
    expect(s.sun.omegaRel).toBe(0);
    settle(s);
    expect(Math.abs(angleDiff(s.sun.theta, 60))).toBeLessThan(1e-9);
    expect(s.sun.omega).toBe(0);
  });

  it('a 400°/s lift coasts at 200°/s (halfway up the smoothstep)', () => {
    expect(flick(400).omegaRel).toBe(200);
    expect(flick(-400).omegaRel).toBe(-200);
  });

  it('a 300°/s lift coasts less than 15° in total', () => {
    const r = flick(300);
    expect(r.omegaRel).toBeCloseTo(46.875, 9);
    expect(r.travel).toBeGreaterThan(0);
    expect(r.travel).toBeLessThan(15);
  });

  it('a 1000°/s flick coasts at the 360°/s cap (180 reduced) and travels about 103° as before', () => {
    const full = flick(1000);
    expect(full.omegaRel).toBe(360);
    expect(full.travel).toBeGreaterThan(101);
    expect(full.travel).toBeLessThan(106);
    expect(flick(-1000).omegaRel).toBe(-360);
    expect(flick(600).omegaRel).toBe(360);
    expect(flick(1000, true).omegaRel).toBe(180);
  });
});
