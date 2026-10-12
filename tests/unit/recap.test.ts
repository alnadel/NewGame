// Death recap tips (GR12's rules, in core per A13): every branch of deathTip, the facts deathRecap
// reads from a dying state, and that the human model's standard-rules deaths nearly always get advice.
import { describe, expect, it } from 'vitest';
import { rungConfig } from '../../src/config/days.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { headlessConfig, runBot } from '../../src/core/sim/headless.ts';
import { deathRecap, deathTip, type DeathRecap } from '../../src/core/sim/recap.ts';
import { step } from '../../src/core/sim/step.ts';
import { NO_INPUT } from '../../src/core/sim/types.ts';

const base: DeathRecap = { cause: 'gap', litShare10: 0.2, window: 10, theta: 90, away: null, nowAway: null, exposure: 0.2, minuteOfDay: 200 };
const tip = (over: Partial<DeathRecap>, invert = false, variant = 0): string | null => deathTip({ ...base, ...over }, invert, variant);

describe('deathTip', () => {
  it('glare comes first', () => {
    expect(tip({ cause: 'glare', away: 20, exposure: 3, litShare10: 1 })).toBe('Red arcs are glare. Keep the little sun out.');
  });

  it('shade in reach: how far and the finger direction only (no screen side to contradict the arrow)', () => {
    // A leftward drag turns the sun counter-clockwise (+), unless the controls are inverted.
    expect(tip({ away: 40, nowAway: 40, exposure: 1.5 })).toBe('Thick teal was 40° away. Drag ←.');
    expect(tip({ away: -40, nowAway: -40, exposure: 2 })).toBe('Thick teal was 40° away. Drag →.');
    expect(tip({ away: 40, nowAway: 40, exposure: 2 }, true)).toBe('Thick teal was 40° away. Drag →.');
    expect(tip({ away: -40, nowAway: -40, exposure: 2 }, true)).toBe('Thick teal was 40° away. Drag ←.');
    // The pointer's place on the dial no longer matters: θ 270 reads the same as θ 90.
    expect(tip({ theta: 270, away: 30.4, nowAway: 30.4, exposure: 2 })).toBe('Thick teal was 30° away. Drag ←.');
    // Shade that lasts is preferred; shade that is ending is the fallback.
    expect(tip({ away: 100, nowAway: -20, exposure: 2 })).toBe('Thick teal was 100° away. Drag ←.');
    expect(tip({ away: null, nowAway: -20, exposure: 2 })).toBe('Shade was 20° away. Drag →.');
    expect(tip({ away: 150, nowAway: -60, exposure: 2 })).toBe('Shade was 60° away. Drag →.');
    for (const t of [tip({ away: 58, nowAway: 58, exposure: 2 }), tip({ theta: 300, away: -58, nowAway: -58, exposure: 2 })]) {
      expect(t).not.toMatch(/left|right/);
    }
  });

  it('shade in reach needs ≥ 0.5 s of sun, shade within 120° and a turn that rounds to ≥ 1°', () => {
    expect(TUNING.recap.exposureSec).toBe(0.5);
    expect(TUNING.recap.maxAwayDeg).toBe(120);
    expect(tip({ away: 40, nowAway: 40, exposure: 0.49 })).toBeNull();
    expect(tip({ away: 120, nowAway: 120, exposure: 0.5 })).toBe('Thick teal was 120° away. Drag ←.');
    expect(tip({ away: 121, nowAway: 121, exposure: 3 })).toBeNull();
    expect(tip({ away: 0.3, nowAway: 0.3, exposure: 3 })).toBeNull();
    expect(tip({ away: null, nowAway: null, exposure: 3 })).toBeNull();
  });

  it('then lots of sun lately (over the seconds actually walked), then noon, else nothing', () => {
    expect(tip({ litShare10: 0.35 })).toBe('In the sun 4 of the last 10 s. Short dips add up.');
    expect(tip({ litShare10: 1, away: 130, nowAway: 130, exposure: 9 })).toBe('In the sun 10 of the last 10 s. Short dips add up.');
    // A run that melted 2 s after it started can't have spent 10 s in the sun.
    expect(tip({ litShare10: 1, window: 2, exposure: 2 })).toBe('In the sun 2 of the last 2 s. Short dips add up.');
    expect(tip({ litShare10: 0.34 })).toBeNull();
    expect(tip({ minuteOfDay: 300 })).toBe('Noon shadows are stubs. Ride a cloud or hug tall walls.');
    expect(tip({ minuteOfDay: 420 })).toBe('Noon shadows are stubs. Ride a cloud or hug tall walls.');
    expect(tip({ minuteOfDay: 299 })).toBeNull();
    expect(tip({ minuteOfDay: 421 })).toBeNull();
    expect(TUNING.recap.litShare).toBe(0.35);
  });

  it('the wording rotates with the run count, so the same kind of melt reads fresh', () => {
    for (const over of [{ litShare10: 0.6 }, { away: 30, nowAway: 30, exposure: 2 }, { minuteOfDay: 360 }, { cause: 'glare' as const }]) {
      const lines = new Set([0, 1, 2, 3].map((v) => tip(over, false, v)));
      expect(lines.size, JSON.stringify(over)).toBeGreaterThanOrEqual(2);
    }
    // Every phrasing of a sunny melt keeps its numbers.
    for (let v = 0; v < 3; v++) expect(tip({ litShare10: 0.6 }, false, v)).toMatch(/\b6 of the last 10 s\b/);
    for (let v = 0; v < 3; v++) expect(tip({ away: -30, nowAway: -30, exposure: 2 }, false, v)).toMatch(/30° away.*→|→.*30° away/);
  });
});

describe('deathRecap', () => {
  it('reads cause, sun share, exposure, clock and the nearest shade from the dying state', () => {
    // An emptied world: nothing to shade Nubs, so he melts lit the whole way.
    const s = createRun({ ...headlessConfig(1), plan: false });
    s.world.casters.length = 0;
    s.world.byId.clear();
    s.world.clouds.length = 0;
    s.world.validatedThrough = 1e6;
    const y0 = s.nubs.y;
    step(s, { ...NO_INPUT, downEdge: true, upEdge: true });
    while (s.phase !== 'dead') step(s, NO_INPUT);
    const r = deathRecap(s);
    expect(r.cause).toBe('plain');
    expect(r.litShare10).toBe(1);
    // It melted within seconds: the window covers only the seconds actually walked.
    expect(r.window).toBe(Math.min(10, Math.max(1, Math.round((s.nubs.y - y0) / s.params.v))));
    expect(r.window).toBeLessThan(10);
    expect(r.away).toBeNull();
    expect(r.nowAway).toBeNull();
    expect(r.exposure).toBeCloseTo((100 / 55) * 1, 1);
    expect(r.minuteOfDay).toBe(26);
    expect(r.theta).toBe(s.sun.theta);
    expect(deathTip(r, false)).toBe(`In the sun ${r.window} of the last ${r.window} s. Short dips add up.`);
  });

  it('prefers shade that lasts (now ∧ next) over shade that is ending', () => {
    const s = createRun({ ...headlessConfig(1), plan: false });
    s.sun.theta = 100;
    s.guide.now.fill(0);
    s.guide.next.fill(0);
    s.guide.now[110] = 1; // ending soon
    s.guide.now[60] = 1;
    s.guide.next[60] = 1; // lasts
    expect(deathRecap(s).away).toBe(-40);
    expect(deathRecap(s).nowAway).toBe(10);
    s.guide.next[60] = 0;
    expect(deathRecap(s).away).toBeNull();
    expect(deathRecap(s).nowAway).toBe(10);
  });

  it('human deaths at standard rules get a tip on ≥ 85% of 40 seeds, most of them a direction to drag', () => {
    let deaths = 0;
    let advised = 0;
    let steered = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = runBot({ ...headlessConfig(seed), ...rungConfig(4, { tutorialDone: true }) }, 60 * 60, 'human');
      if (s.phase !== 'dead') continue;
      deaths++;
      const t = deathTip(deathRecap(s), false) ?? '';
      if (t !== '') advised++;
      if (/Drag [←→]/.test(t)) steered++;
    }
    expect(deaths).toBeGreaterThan(30);
    expect(advised / deaths).toBeGreaterThanOrEqual(0.85);
    expect(steered / deaths).toBeGreaterThanOrEqual(0.4);
  }, 30_000);
});
