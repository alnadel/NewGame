// SWING (CO3 with amendment A3), Frost grace and phewMinChill. The SWING rule is checked tick by
// tick on applyDaylight with scripted coverage (f, shading source, θ), then on real runs.
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/config/tuning.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import type { SimEvent } from '../../src/core/sim/events.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { applyDaylight, applyNight } from '../../src/core/sim/nubs.ts';
import { step } from '../../src/core/sim/step.ts';
import type { RunConfig, SimState } from '../../src/core/sim/types.ts';

const SW = TUNING.swing;
const CONFIRM = SW.confirmTicks;

/** A started run whose daylight ticks are driven by hand: coverage is scripted, Chill stays high. */
function rig(cfg: Partial<RunConfig> = {}): SimState {
  const s = createRun({ ...headlessConfig(1), plan: false, ...cfg });
  s.phase = 'day';
  s.tick = 1000;
  return s;
}

/**
 * One scripted daylight tick: Nubs fully shaded by caster `src` (src ≥ 0) or lit (src < 0), with
 * the sun at θ. Returns the tick's SWING events.
 */
function tick(s: SimState, src: number, theta: number): Extract<SimEvent, { e: 'swing' }>[] {
  s.events.length = 0;
  s.tick++;
  const nb = s.nubs;
  nb.f = src >= 0 ? 0 : 1;
  nb.w.fill(src >= 0 ? 0 : 1);
  nb.shaderId = src;
  nb.cloudId = -1;
  nb.chill = 90;
  s.sun.theta = theta;
  applyDaylight(s);
  return s.events.filter((e): e is Extract<SimEvent, { e: 'swing' }> => e.e === 'swing');
}

/** Shade under `src` for n ticks at θ; returns every SWING fired. */
function hold(s: SimState, src: number, theta: number, n: number): Extract<SimEvent, { e: 'swing' }>[] {
  const out: Extract<SimEvent, { e: 'swing' }>[] = [];
  for (let i = 0; i < n; i++) out.push(...tick(s, src, theta));
  return out;
}

/** Shade under A at θa, `gap` lit ticks, then shade under B at θb held for `held` ticks. */
function handoff(theta: number, gap: number, held = CONFIRM, s = rig()): { s: SimState; swings: Extract<SimEvent, { e: 'swing' }>[] } {
  hold(s, 1, 100, 30);
  hold(s, -1, 100 + theta / 2, gap);
  return { s, swings: hold(s, 2, 100 + theta, held) };
}

describe('SWING', () => {
  it('needs a ≥ 38° turn: 37° gives nothing, 38° a SWING worth 1 Snow', () => {
    expect(TUNING.swing.minDeg).toBe(38);
    expect(handoff(37, 5).swings).toHaveLength(0);
    const { s, swings } = handoff(38, 5);
    expect(swings).toHaveLength(1);
    expect(swings[0]).toMatchObject({ deg: 38, chain: 1, snow: 1, x: s.nubs.x, y: s.nubs.y });
    expect(s.stats.swings).toBe(1);
    expect(s.stats.swingChainBest).toBe(1);
  });

  it('needs the hand-off within 20 lit ticks: a 21-tick gap gives nothing, 20 a SWING; deg is the turn between the two shaded ticks', () => {
    expect(handoff(60, 21).swings).toHaveLength(0);
    expect(handoff(60, 20).swings).toHaveLength(1);
    expect(handoff(60, 0).swings[0]?.deg).toBe(60);
    expect(handoff(-170, 3).swings[0]?.deg).toBe(170);
  });

  it('is confirmed only after the new source keeps Nubs fully shaded for 15 ticks, and fires on that tick (A3)', () => {
    expect(handoff(90, 4, CONFIRM - 1).swings).toHaveLength(0);
    const s = rig();
    hold(s, 1, 0, 10);
    hold(s, -1, 30, 2);
    for (let i = 1; i < CONFIRM; i++) expect(tick(s, 2, 90), `tick ${i}`).toHaveLength(0);
    expect(tick(s, 2, 90)).toHaveLength(1);
    expect(hold(s, 2, 90, 100)).toHaveLength(0);
    // A lit tick or another source during the confirmation cancels it.
    const t = rig();
    hold(t, 1, 0, 10);
    hold(t, 2, 90, CONFIRM - 1);
    tick(t, -1, 90);
    expect(hold(t, 2, 90, 40)).toHaveLength(0);
    const u = rig();
    hold(u, 1, 0, 10);
    hold(u, 2, 90, 5);
    expect(hold(u, 3, 90, 40)).toHaveLength(0);
    expect(SW.confirmTicks).toBe(15);
  });

  it('never fires for the same source, or for continuous shade handed between sources', () => {
    const s = rig();
    hold(s, 1, 0, 10);
    hold(s, -1, 30, 5);
    expect(hold(s, 1, 90, 40)).toHaveLength(0);
    // Continuous shade: θ turns 60° while still shaded, and the source changes on the way.
    const t = rig();
    for (let i = 0; i <= 60; i++) tick(t, 1, i);
    expect(hold(t, 2, 60, 40)).toHaveLength(0);
    expect(t.stats.swings).toBe(0);
  });

  it('chains within 180 ticks (×2 at +180, ×1 at +181), pays the chain in Snow and caps at ×5', () => {
    for (const [wait, chain] of [
      [180, 2],
      [181, 1],
    ] as const) {
      const s = rig();
      hold(s, 1, 0, 10);
      const first = hold(s, 2, 90, CONFIRM);
      const t1 = s.tick;
      expect(first).toHaveLength(1);
      // The next hand-off confirms exactly `wait` ticks after the first.
      hold(s, 2, 90, wait - CONFIRM);
      const second = hold(s, 3, 180, CONFIRM);
      expect(second).toHaveLength(1);
      expect(s.tick - t1).toBe(wait);
      expect(second[0]!.chain).toBe(chain);
      expect(second[0]!.snow).toBe(chain);
    }
    const s = rig();
    const snow0 = s.stats.snow;
    let theta = 0;
    let src = 1;
    hold(s, src, theta, 10);
    const chains: number[] = [];
    for (let i = 0; i < 7; i++) {
      theta += 90;
      src++;
      for (const e of hold(s, src, theta, 40)) chains.push(e.chain);
    }
    expect(chains).toEqual([1, 2, 3, 4, 5, 5, 5]);
    expect(s.stats.snow - snow0).toBe(1 + 2 + 3 + 4 + 5 + 5 + 5);
    expect(s.stats.swingChainBest).toBe(5);
    expect(s.stats.swings).toBe(7);
  });

  it('is never multiplied by the Frost multiplier', () => {
    const s = rig();
    s.nubs.mult = 5;
    hold(s, 1, 0, 10);
    const snow0 = s.stats.snow;
    expect(hold(s, 2, 90, CONFIRM)[0]?.snow).toBe(1);
    expect(s.stats.snow - snow0).toBe(1);
  });

  it('resets at night: a hand-off across the night never fires', () => {
    const s = rig();
    hold(s, 1, 0, 10);
    for (let i = 0; i < 5; i++) applyNight(s);
    expect(hold(s, 2, 90, 40)).toHaveLength(0);
  });
});

describe('Frost grace (v1.5; the v1.6 ring off)', () => {
  /** ×3 built in shade, then `lit` lit ticks with a quick turn by `turn` (done by the 4th), then shade. */
  function stretch(lit: number, turn: number): number {
    const s = rig({ v16: { ring: false } });
    s.nubs.mult = 3;
    hold(s, 1, 0, 5);
    for (let i = 1; i <= lit; i++) tick(s, -1, (turn * Math.min(3, i - 1)) / 3);
    hold(s, 2, turn, 2);
    return s.nubs.mult;
  }

  it('keeps the multiplier through a 15-tick lit stretch with a 40° turn, but not with a 10° turn', () => {
    expect(stretch(15, 40)).toBe(3);
    expect(stretch(15, 10)).toBe(1);
    expect(stretch(8, 10)).toBe(3); // shorter than the 9-tick reset
  });

  it('with a big turn the reset waits for 21 lit ticks', () => {
    expect(stretch(20, 90)).toBe(3);
    expect(stretch(21, 90)).toBe(1);
    expect([TUNING.mult.resetLitTicks, TUNING.mult.graceLitTicks, TUNING.mult.graceDeg]).toEqual([9, 21, 30]);
  });
});

describe('phewMinChill', () => {
  it('records the lowest pre-tick Chill at any PHEW (100 when none)', () => {
    const s = rig();
    expect(s.stats.phewMinChill).toBe(100);
    const phewAt = (chill: number): void => {
      s.nubs.phewOpen = true;
      s.nubs.highChillTick = s.tick;
      tick(s, -1, 0);
      s.nubs.chill = chill;
      s.events.length = 0;
      s.tick++;
      s.nubs.f = 0;
      s.nubs.w.fill(0);
      applyDaylight(s);
      expect(s.events.some((e) => e.e === 'phew')).toBe(true);
    };
    phewAt(9);
    expect(s.stats.phewMinChill).toBe(9);
    phewAt(4.5);
    expect(s.stats.phewMinChill).toBe(4.5);
    phewAt(12);
    expect(s.stats.phewMinChill).toBe(4.5);
  });
});

describe('SWING in real runs', () => {
  it('reactive runs land SWINGs; every event matches the stats and leaves Chill and death untouched', () => {
    let total = 0;
    for (const seed of [3, 5]) {
      const s = createRun(headlessConfig(seed, 3));
      const bot = createBot('reactive');
      let events = 0;
      let snow = 0;
      for (let i = 0; i < 60 * 120 && s.phase !== 'dead'; i++) {
        step(s, bot.next(s));
        for (const e of s.events) {
          if (e.e !== 'swing') continue;
          events++;
          snow += e.snow;
          expect(e.deg).toBeGreaterThanOrEqual(SW.minDeg);
          expect(e.chain).toBeGreaterThanOrEqual(1);
          expect(e.chain).toBeLessThanOrEqual(SW.chainMax);
        }
      }
      expect(s.stats.swings).toBe(events);
      expect(snow).toBeGreaterThanOrEqual(events);
      total += events;
    }
    expect(total).toBeGreaterThan(0);
  }, 30_000);
});
