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
    sun: { theta, lag: 0, omega: 0, omegaRel: 0, mode: 'idle', detent: Math.floor(theta / 15), dTheta: 0 },
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
      expect(Math.abs(d)).toBeLessThanOrEqual(1 + 1e-9); // +2 finger, −3 key
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

  it('8. a detent event at each 15° crossing', () => {
    const s = sunState(1);
    const events: SimEvent[] = [];
    for (let i = 0; i < 120; i++) {
      s.events.length = 0;
      updateSun(s, f({ key: 1 }));
      events.push(...s.events);
    }
    const detents = events.filter((e) => e.e === 'detent');
    expect(detents.length).toBe(24);
    expect(detents.every((e) => e.e === 'detent' && e.dir === 1)).toBe(true);
    expect(new Set(detents.map((e) => (e.e === 'detent' ? e.index : -1))).size).toBe(24);
    // And clockwise.
    const back: SimEvent[] = [];
    for (let i = 0; i < 10; i++) {
      s.events.length = 0;
      updateSun(s, f({ key: -1 }));
      back.push(...s.events);
    }
    expect(back.filter((e) => e.e === 'detent' && e.dir === -1).length).toBe(2);
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
