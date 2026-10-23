// Elementals heroes (docs/ELEMENTALS.md §1, §4.7): the shared hero helpers of C0, and the §1.7 rate
// table at the trial drains.
import { describe, expect, it } from 'vitest';
import { trialDef, type TrialDef } from '../../src/config/trials.ts';
import { tickAtMinute } from '../../src/core/clock.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { abilityHero, heroHealth, heroRates, heroStart, nextTagHero, nextTagTicks, relayY, tagLocked } from '../../src/core/sim/heroes.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { worldYAtTick } from '../../src/core/gen/plan.ts';

const R = 30;
/** The table rounded to 0.1 (+ 0 turns a rounded −0 into 0). */
const row = (t: Float64Array | null): number[] => Array.from(t as Float64Array, (v) => Math.round(v * 10) / 10 + 0);

describe('hero rates (§1.7)', () => {
  it('pins the table heroes at the trial drains', () => {
    // c = 0..10
    expect(row(heroRates('nubs', 26, R))).toEqual([30, 18.8, 7.6, -3.6, -14.8, -26, -31.2, -36.4, -41.6, -46.8, -52]);
    expect(row(heroRates('ember', 26, R))).toEqual([-26, -18.4, -10.8, -3.2, 4.4, 12, 19.2, 26.4, 33.6, 40.8, 48]);
    expect(row(heroRates('ember', 18, R)).slice(0, 7)).toEqual([-18, -12, -6, 0, 6, 12, 19.2]);
    // Ember's safe set is rate(c) > 0: c 3 at D 18 is not safe.
    expect((heroRates('ember', 18, R) as Float64Array)[3]).toBeLessThanOrEqual(0);
    expect(row(heroRates('sprout', 24, R))).toEqual([-9.6, 18, 18, 18, 18, -24, -26.4, -28.8, -31.2, -33.6, -36]);
    expect(row(heroRates('sprout', 20, R))[0]).toBe(-8);
    expect(row(heroRates('sprout', 20, R))[10]).toBe(-30);
    expect(heroRates('ember', 26, R)).toBe(heroRates('ember', 26, R));
    expect(heroRates('volt', 26, R)).toBeNull();
    expect(heroRates('drip', 24, R)).toBeNull();
  });
});

describe('hero helpers', () => {
  it('health, start meters and the ability hero', () => {
    expect(heroStart('drip', 100)).toBe(50);
    expect(heroStart('ember', 100)).toBe(100);
    const s = createRun(campaignConfig(1004));
    expect(heroHealth(s.nubs)).toBe(100);
    s.nubs.chill = 80;
    expect(heroHealth(s.nubs)).toBe(40);
    const n = createRun(campaignConfig(1006));
    n.nubs.chill = 60;
    expect(heroHealth(n.nubs)).toBe(60);
    expect(abilityHero(n)).toBe('nubs');
    expect(abilityHero(createRun(campaignConfig(1007)))).toBe('sprout');
    expect(abilityHero(createRun(campaignConfig(1003)))).toBe('volt');
    expect(abilityHero(createRun(campaignConfig(12)))).toBe('nubs');
  });

  it('schedules a relay on the 6-tick grid', () => {
    const s = createRun(campaignConfig(1005));
    const t = trialDef(1005) as TrialDef;
    const tag = 6 * Math.round(tickAtMinute(300) / 6);
    expect(nextTagTicks(s)).toBe(tag - s.tickAbs);
    expect(nextTagHero(s)).toBe('ember');
    expect(tagLocked(s)).toBe(false);
    expect(relayY(s, 0)).toBe(worldYAtTick(s.world, tag));
    expect(relayY(s, t.relays.length)).toBe(-1e9);
    const solo = createRun(campaignConfig(1001));
    expect([nextTagTicks(solo), nextTagHero(solo), tagLocked(solo)]).toEqual([-1, null, false]);
  });
});
