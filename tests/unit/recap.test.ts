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

const base: DeathRecap = { cause: 'gap', litShare10: 0.2, theta: 90, away: null, exposure: 0.5, minuteOfDay: 200 };
const tip = (over: Partial<DeathRecap>, invert = false): string | null => deathTip({ ...base, ...over }, invert);

describe('deathTip', () => {
  it('glare comes first', () => {
    expect(tip({ cause: 'glare', away: 20, exposure: 3, litShare10: 1 })).toBe('Red arcs are glare. Keep the little sun out.');
  });

  it('shade was close: the side the sun pointer must move to on screen and the finger direction', () => {
    // θ 90 (pointer at the top): counter-clockwise moves it left, and a leftward drag turns that way.
    expect(tip({ away: 40, exposure: 1.5 })).toBe('Shade was 40° left. Drag ←.');
    expect(tip({ away: -40, exposure: 2 })).toBe('Shade was 40° right. Drag →.');
    // Inverted controls flip only the finger.
    expect(tip({ away: 40, exposure: 2 }, true)).toBe('Shade was 40° left. Drag →.');
    expect(tip({ away: -40, exposure: 2 }, true)).toBe('Shade was 40° right. Drag ←.');
    // θ 270 (pointer at the bottom): counter-clockwise moves it right.
    expect(tip({ theta: 270, away: 30.4, exposure: 2 })).toBe('Shade was 30° right. Drag ←.');
    // Straight down from θ 10° to −10°: the side follows the finger.
    expect(tip({ theta: 10, away: -20, exposure: 2 })).toBe('Shade was 20° right. Drag →.');
    expect(tip({ away: 90, exposure: 2 })).toBe('Shade was 90° left. Drag ←.');
  });

  it('shade was close needs ≥ 1.5 s of sun, shade within 90° and a turn that rounds to ≥ 1°', () => {
    expect(tip({ away: 40, exposure: 1.49 })).toBeNull();
    expect(tip({ away: 91, exposure: 3 })).toBeNull();
    expect(tip({ away: 0.3, exposure: 3 })).toBeNull();
    expect(tip({ away: null, exposure: 3 })).toBeNull();
  });

  it('then lots of sun lately, then noon, else nothing', () => {
    expect(tip({ litShare10: 0.35 })).toBe('In the sun 4 of the last 10 s. Short dips add up.');
    expect(tip({ litShare10: 1, away: 120, exposure: 9 })).toBe('In the sun 10 of the last 10 s. Short dips add up.');
    expect(tip({ litShare10: 0.34 })).toBeNull();
    expect(tip({ minuteOfDay: 300 })).toBe('Noon shadows are stubs. Ride a cloud or hug tall walls.');
    expect(tip({ minuteOfDay: 420 })).toBe('Noon shadows are stubs. Ride a cloud or hug tall walls.');
    expect(tip({ minuteOfDay: 299 })).toBeNull();
    expect(tip({ minuteOfDay: 421 })).toBeNull();
    expect(TUNING.recap.litShare).toBe(0.35);
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
    step(s, { ...NO_INPUT, downEdge: true, upEdge: true });
    while (s.phase !== 'dead') step(s, NO_INPUT);
    const r = deathRecap(s);
    expect(r.cause).toBe('plain');
    expect(r.litShare10).toBe(1);
    expect(r.away).toBeNull();
    expect(r.exposure).toBeCloseTo((100 / 55) * 1, 1);
    expect(r.minuteOfDay).toBe(26);
    expect(r.theta).toBe(s.sun.theta);
    expect(deathTip(r, false)).toBe('In the sun 10 of the last 10 s. Short dips add up.');
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
    s.guide.next[60] = 0;
    expect(deathRecap(s).away).toBe(10);
  });

  it('human deaths at standard rules get a "shade was close" or "short dips" tip on ≥ 85% of 40 seeds', () => {
    let deaths = 0;
    let advised = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = runBot({ ...headlessConfig(seed), ...rungConfig(4, { tutorialDone: true }) }, 60 * 120, 'human');
      if (s.phase !== 'dead') continue;
      deaths++;
      const t = deathTip(deathRecap(s), false) ?? '';
      if (t.startsWith('Shade was') || t.startsWith('In the sun')) advised++;
    }
    expect(deaths).toBeGreaterThan(30);
    expect(advised / deaths).toBeGreaterThanOrEqual(0.85);
  }, 30_000);
});
