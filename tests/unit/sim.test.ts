// Sim rules (V1_PLAN §5): Chill rates, profiles, glare, multiplier, PHEW, melting, night, death, hold.
import { describe, expect, it } from 'vitest';
import type { ProfileId } from '../../src/config/days.ts';
import { dayParams } from '../../src/config/days.ts';
import { elevation, yAtDayTick } from '../../src/core/clock.ts';
import { cosD, sinD, tanD } from '../../src/core/dmath.ts';
import { makeCaster, makePrism } from '../../src/core/gen/catalog.ts';
import { insertBall, insertCaster, insertPickup } from '../../src/core/gen/store.ts';
import { rectPoly } from '../../src/core/geom.ts';
import { glareOffset } from '../../src/core/shadows.ts';
import { createRun } from '../../src/core/sim/create.ts';
import type { SimEvent } from '../../src/core/sim/events.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { step } from '../../src/core/sim/step.ts';
import { NO_INPUT, type RunConfig, type SimState } from '../../src/core/sim/types.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { trailX } from '../../src/core/trail.ts';

const TAP = { dTheta: 0, down: false, downEdge: true, upEdge: true, release: 0, key: 0 as const };

/** A run whose world is emptied (and frozen: no further generation), so Nubs is in full sun. */
function lab(cfg: Partial<RunConfig> = {}): SimState {
  const s = createRun({ ...headlessConfig(1), ...cfg });
  const w = s.world;
  w.casters.length = 0;
  w.byId.clear();
  w.clouds.length = 0;
  w.balls.length = 0;
  w.pickups.length = 0;
  w.validatedThrough = 1e6;
  return s;
}

let shadeId = 1_000_000;
/** Covers the trail from y0 to y1 with overlapping 80×80 slabs-on-the-ground: Nubs is always inside one. */
function shade(s: SimState, y0 = -100, y1 = 6000): void {
  for (let y = y0; y <= y1; y += 40) {
    const x = trailX(s.world.trail, y);
    insertCaster(
      s.world,
      makeCaster({
        id: shadeId++, kind: 'rock', name: 'the Test Rock', biome: 'meadow', x, y, rot: 0,
        parts: [makePrism(rectPoly(x, y, 80, 80, 1, 0), 100)], side: 1, rescue: false, gate: false, ballId: -1, chunk: 0,
      }),
    );
  }
}

function unshade(s: SimState): void {
  const w = s.world;
  for (let i = w.casters.length - 1; i >= 0; i--) {
    const c = w.casters[i]!;
    if (c.name === 'the Test Rock') {
      w.casters.splice(i, 1);
      w.byId.delete(c.id);
    }
  }
}

/**
 * Steps n clock ticks with no input; returns all events. A run still holding is started first (a
 * tap, then the start beat, during which the clock does not move).
 */
function run(s: SimState, n: number): SimEvent[] {
  const all: SimEvent[] = [];
  if (s.phase === 'hold') {
    step(s, TAP);
    all.push(...s.events);
    while (s.ready > 0) {
      step(s, NO_INPUT);
      all.push(...s.events);
    }
  }
  for (let i = 0; i < n && s.phase !== 'dead'; i++) {
    step(s, NO_INPUT);
    all.push(...s.events);
  }
  return all;
}

const READY = TUNING.start.readyTicks;

describe('sim rules', () => {
  it('holds the clock, Nubs and Chill until the first touch, then starts at θ0', () => {
    const s = lab();
    for (let i = 0; i < 50; i++) step(s, NO_INPUT);
    expect([s.tick, s.dayTick, s.nubs.y, s.nubs.chill, s.phase]).toEqual([0, 0, 0, 100, 'hold']);
    step(s, { ...TAP, dTheta: 45, upEdge: false, down: true });
    expect(s.events[0]).toEqual({ e: 'start' });
    expect(s.sun.theta).toBe(s.theta0);
    expect(s.tick).toBe(1);
    expect(s.phase).toBe('day');
  });

  it('opens with a start beat: the sun follows the finger while the clock, Nubs and Chill wait', () => {
    expect(READY).toBeGreaterThanOrEqual(36);
    const s = lab();
    step(s, { ...TAP, upEdge: false, down: true });
    expect(s.ready).toBe(READY - 1);
    const drag = { dTheta: 2, down: true, downEdge: false, upEdge: false, release: 0, key: 0 as const };
    const events: SimEvent[] = [];
    while (s.ready > 0) {
      expect([s.dayTick, s.nubs.y, s.nubs.chill, s.minutes]).toEqual([0, 0, 100, 0]);
      step(s, drag);
      events.push(...s.events);
    }
    // The sun moved during the beat (full sun here, so coverage is live and lit), nothing else did.
    expect(Math.abs(s.sun.theta - s.theta0)).toBeGreaterThan(60);
    expect(s.nubs.f).toBe(1);
    expect([s.dayTick, s.nubs.y, s.nubs.chill, s.tick]).toEqual([0, 0, 100, READY]);
    expect(events.filter((e) => e.e === 'go')).toHaveLength(1);
    expect(events[events.length - 1]).toEqual({ e: 'go' });
    // Then the clock runs: one tick later Nubs has walked and Chill is draining.
    step(s, drag);
    expect(s.dayTick).toBe(1);
    expect(s.nubs.y).toBeGreaterThan(0);
    expect(s.nubs.chill).toBeLessThan(100);
  });

  it('the start beat leaves the idle outcome unchanged (the clock is frozen, θ stays θ0)', () => {
    const a = createRun(headlessConfig(4));
    step(a, TAP);
    while (a.ready > 0) step(a, NO_INPUT);
    expect([a.sun.theta, a.dayTick, a.nubs.chill]).toEqual([a.theta0, 0, 100]);
  });

  it('full sun drains 100 → 0 in 100/55 s (±1 tick) and kills Nubs', () => {
    const s = lab();
    const ev = run(s, 400);
    expect(s.phase).toBe('dead');
    expect(Math.abs(s.tick - READY - (100 / 55) * 60)).toBeLessThanOrEqual(1);
    const death = ev.find((e) => e.e === 'death');
    expect(death && death.e === 'death' && death.info.line).toBe('Melted by You at 6:26 AM.');
    expect(s.hourGlyphs[0]).toEqual(['melt']);
    expect(s.death?.cause).toBe('plain');
  });

  it('drain follows the profile: 30, 40, 40, 55 per second', () => {
    const drains = [30, 40, 40, 55];
    for (let p = 0; p < 4; p++) {
      const s = lab({ profile: p as ProfileId, tutorial: false });
      run(s, 30);
      expect(s.nubs.chill).toBeCloseTo(100 - drains[p]! * 0.5, 9);
    }
  });

  it('full shade regenerates 30/s', () => {
    const s = lab({ startChill: 40 });
    shade(s);
    run(s, 60);
    expect(s.nubs.f).toBe(0);
    expect(s.nubs.chill).toBeCloseTo(70, 9);
  });

  it('glare doubles the lit weight and the drain', () => {
    // Glare needs ε ≥ 8°, so start at 6:24 AM (t = 2 s).
    const s = lab({ startT: 2 });
    // Put a ball so that its glare spot is centered on Nubs on the first tick.
    const p = dayParams(1, 3);
    const cot = 1 / tanD(elevation(p, 121 / 60));
    const g = glareOffset(cot);
    const y = yAtDayTick(1, 121);
    const x = trailX(s.world.trail, y);
    insertBall(s.world, { id: 77, x: x - cosD(s.theta0) * g, y: y - sinD(s.theta0) * g, name: 'the Fancy Gazing Ball', casterId: -1, day: 1 });
    const ev = run(s, 1);
    expect(s.nubs.glare).toBe(5);
    expect(s.nubs.f).toBe(2);
    expect(s.nubs.chill).toBeCloseTo(100 - (2 * 55) / 60, 9);
    expect(ev.some((e) => e.e === 'glareTouch' && e.ballId === 77)).toBe(true);
  });

  it('multiplier: +1 per 4.0 s of full shade, survives a flicker, resets after 0.15 s lit', () => {
    const s = lab();
    shade(s);
    let ev = run(s, 239);
    expect(s.nubs.mult).toBe(1);
    ev = run(s, 1);
    expect(ev).toContainEqual({ e: 'multUp', level: 2 });
    run(s, 720);
    expect(s.nubs.mult).toBe(5);
    unshade(s);
    run(s, 5);
    shade(s, s.nubs.y - 100, s.nubs.y + 4000);
    run(s, 2);
    expect(s.nubs.mult).toBe(5);
    unshade(s);
    ev = run(s, 8);
    expect(s.nubs.mult).toBe(5);
    ev = run(s, 1);
    expect(ev).toContainEqual({ e: 'multReset', from: 5 });
    expect(s.nubs.mult).toBe(1);
    expect(s.stats.maxMult).toBe(5);
  });

  it('PHEW fires below T after recent Chill ≥ 40, then latches until Chill > 50', () => {
    const s = lab();
    run(s, 94); // full sun: Chill 100 → 13.8
    expect(s.nubs.chill).toBeLessThan(15);
    shade(s);
    let ev = run(s, 1);
    expect(ev.some((e) => e.e === 'phew')).toBe(true);
    expect(s.stats.phews).toBe(1);
    expect(s.stats.snow).toBe(3);
    // Latched: lit again then shaded again while still low → no PHEW.
    unshade(s);
    run(s, 3);
    shade(s, s.nubs.y - 100, s.nubs.y + 6000);
    ev = run(s, 1);
    expect(ev.some((e) => e.e === 'shadeEnter')).toBe(true);
    expect(ev.some((e) => e.e === 'phew')).toBe(false);
    // Recover above 50 (re-opens the latch), dive again, shade: PHEW.
    run(s, 90);
    expect(s.nubs.chill).toBeGreaterThan(50);
    unshade(s);
    while (s.nubs.chill >= 15) run(s, 1);
    shade(s, s.nubs.y - 100, s.nubs.y + 6000);
    ev = run(s, 1);
    expect(ev.some((e) => e.e === 'phew')).toBe(true);
    expect(s.stats.phews).toBe(2);
  });

  it('PHEW needs recent Chill ≥ 40 and uses T = 20 for profiles 0-2', () => {
    const cold = lab({ startChill: 14 });
    run(cold, 3);
    shade(cold);
    expect(run(cold, 1).some((e) => e.e === 'phew')).toBe(false);

    const gentle = lab({ profile: 1, tutorial: false });
    while (gentle.nubs.chill >= 19) run(gentle, 1);
    expect(gentle.nubs.chill).toBeGreaterThan(15);
    shade(gentle);
    expect(run(gentle, 1).some((e) => e.e === 'phew')).toBe(true);
  });

  it('a lit flake melts after 1.0 s, only within 1.6 s of walking ahead', () => {
    const s = lab();
    const near = { id: 501, kind: 'flake' as const, x: trailX(s.world.trail, 100), y: 100, day: 1, melt: 0, state: 0 as const };
    const far = { id: 502, kind: 'flake' as const, x: trailX(s.world.trail, 300), y: 300, day: 1, melt: 0, state: 0 as const };
    insertPickup(s.world, near);
    insertPickup(s.world, far);
    const ev = run(s, 59);
    expect(near.state).toBe(0);
    expect(far.melt).toBe(0);
    const ev2 = run(s, 1);
    expect(near.state).toBe(2);
    expect(ev2).toContainEqual({ e: 'flakeMelt', x: near.x, y: 100 });
    expect(ev.length).toBeGreaterThan(0);
    expect(s.stats.flakesMelted).toBe(1);
  });

  it('collecting a flake pays the multiplier in Snow and +6 Chill', () => {
    const s = lab({ startChill: 50 });
    shade(s);
    const fl = { id: 601, kind: 'flake' as const, x: trailX(s.world.trail, 40), y: 40, day: 1, melt: 0, state: 0 as const };
    insertPickup(s.world, fl);
    const ev = run(s, 60);
    expect(fl.state).toBe(1);
    const got = ev.find((e) => e.e === 'flake');
    expect(got && got.e === 'flake' && got.snow).toBe(1);
    expect(s.stats.snow).toBe(1);
    expect(s.stats.flakes).toBe(1);
    expect(s.nubs.chill).toBeCloseTo(50 + 30 + 6, 9);
  });

  it('night regenerates +30/s, dawn refills, and the day emits its clock events', () => {
    const s = lab({ startT: 49, startChill: 100 });
    let ev = run(s, 60);
    expect(ev.some((e) => e.e === 'nightStart' && e.day === 1)).toBe(true);
    expect(s.phase).toBe('night');
    const atDusk = s.nubs.chill;
    run(s, 60);
    expect(s.nubs.chill).toBeCloseTo(Math.min(100, atDusk + 30), 9);
    ev = run(s, 420);
    expect(ev).toContainEqual({ e: 'dawn', day: 2 });
    expect(s.day).toBe(2);
    // Refilled at dawn; the dawn tick itself is already daylight (full sun here).
    expect(s.nubs.chill).toBeCloseTo(100 - 55 / 60, 9);
    expect(s.stats.nightsReached).toBe(1);
  });

  it('noon banner, noon passed and twelve hour glyphs in a shaded day', () => {
    const s = lab();
    shade(s, -100, 4000);
    const ev = run(s, 3000);
    const at = (name: string): number => ev.findIndex((e) => e.e === name);
    expect(at('noonBanner')).toBeGreaterThan(-1);
    expect(at('noonPassed')).toBeGreaterThan(at('noonBanner'));
    const hours = ev.filter((e) => e.e === 'hourEnd');
    expect(hours.length).toBe(12);
    expect(hours.every((e) => e.e === 'hourEnd' && e.glyph === 'cool')).toBe(true);
    expect(s.hourGlyphs[0]).toEqual(Array(12).fill('cool'));
    expect(ev.some((e) => e.e === 'nightStart')).toBe(true);
  });

  it('records the Melt Map history every 20 u', () => {
    const s = lab();
    shade(s);
    run(s, 600); // 10 s at 70 u/s = 700 u
    expect(s.historyCount).toBe(Math.floor(s.nubs.y / 20) + 1);
    // Entry 10 is the first tick at or past y = 200 (Nubs walks 70/60 u per tick).
    expect(s.history[4 * 10 + 1]! - 200).toBeGreaterThanOrEqual(0);
    expect(s.history[4 * 10 + 1]! - 200).toBeLessThan(70 / 60);
    expect(s.history[4 * 10 + 2]).toBe(100);
  });
});
