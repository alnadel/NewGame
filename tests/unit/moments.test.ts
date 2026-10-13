// v1.4 in-run moments: the stars so far (the HUD pips and the Pause card), the toast queue under
// the HUD, mission toasts measured live from the save's active missions, the first levels' tips and
// the COMEBACK.
import { describe, expect, it } from 'vitest';
import { createRun, levelDef, type SimEvent, type SimState } from '../../src/core/index.ts';
import { campaignConfig, STAR_COOL_LOST, STAR_FLAKES, STAR_GOAL, starState } from '../../src/game/campaign.ts';
import { LEVEL_TIPS, RunMoments } from '../../src/game/moments.ts';
import { defaults } from '../../src/meta/save.ts';
import { createBanners, endToasts, showToast, updateBanners } from '../../src/render/banners.ts';

const stats = (flakes: number, snow: number, litTotal: number, minChill: number) => ({ flakes, snow, litTotal, minChill });

describe('starState', () => {
  it('lights the goal and flakes stars as they are met and loses the cool run for good', () => {
    const l2 = levelDef(2)!;
    const goal = l2.goal.target;
    expect(starState(l2, stats(0, 0, 0, 100), false)).toBe(0);
    expect(starState(l2, stats(goal, 0, 0, 100), false)).toBe(STAR_GOAL);
    expect(starState(l2, stats(l2.stars.flakes, 0, 0, 100), false)).toBe(STAR_GOAL | STAR_FLAKES);
    expect(starState(l2, stats(0, 0, l2.stars.sunSec + 0.1, 100), false)).toBe(STAR_COOL_LOST);
    expect(starState(l2, stats(0, 0, 0, l2.stars.minChill - 1), false)).toBe(STAR_COOL_LOST);
    // A finish goal is met only at the line.
    const l1 = levelDef(1)!;
    expect(starState(l1, stats(0, 0, 0, 100), false) & STAR_GOAL).toBe(0);
    expect(starState(l1, stats(0, 0, 0, 100), true) & STAR_GOAL).toBe(STAR_GOAL);
  });
});

describe('toast queue', () => {
  const run = (b: ReturnType<typeof createBanners>, s: number) => {
    for (let t = 0; t < s; t += 0.1) updateBanners(b, 0.1, false);
  };
  it('waits behind a stamp, shows one at a time, then leaves', () => {
    const b = createBanners();
    b.stamp = 0;
    b.stampHold = 0.5;
    showToast(b, 'mission', 'MISSION ✓ 1/3', 'Reach 9:00 AM', null, 1);
    updateBanners(b, 0.1, false);
    expect(b.toastT).toBe(-1);
    run(b, 1.2);
    expect(b.toastT).toBeGreaterThanOrEqual(0);
    run(b, 2);
    expect(b.toasts).toHaveLength(0);
  });
  it('a mission goes ahead of waiting tips, a new tip replaces a waiting one, a long-shown tip steps aside', () => {
    const b = createBanners();
    showToast(b, 'tip', 'TIP', 'one', 'drag', 4);
    updateBanners(b, 0.1, false);
    showToast(b, 'tip', 'TIP', 'two', 'drag', 4);
    showToast(b, 'tip', 'TIP', 'three', 'drag', 4);
    expect(b.toasts.map((t) => t.text)).toEqual(['one', 'three']);
    showToast(b, 'mission', 'MISSION ✓ 1/3', 'm1', null, 2);
    showToast(b, 'mission', 'MISSION ✓ 2/3', 'm2', null, 2);
    expect(b.toasts.map((t) => t.text)).toEqual(['one', 'm1', 'm2', 'three']);
    run(b, 1.8);
    showToast(b, 'mission', 'MISSION ✓ 3/3', 'm3', null, 2);
    // 'one' has shown 1.8 s: it is already fading out.
    expect(b.toastT).toBeGreaterThan(4);
    run(b, 0.4);
    expect(b.toasts[0]!.text).toBe('m1');
  });
  it('the run ending drops what waits', () => {
    const b = createBanners();
    showToast(b, 'tip', 'TIP', 'one', 'drag', 4);
    updateBanners(b, 0.1, false);
    showToast(b, 'mission', 'MISSION ✓ 1/3', 'm1', null, 2);
    endToasts(b);
    expect(b.toasts.map((t) => t.text)).toEqual(['one']);
    run(b, 0.5);
    expect(b.toasts).toHaveLength(0);
  });
});

describe('RunMoments', () => {
  const sinks = () => {
    const log: string[] = [];
    return { log, sinks: { mission: () => log.push('mission'), comeback: () => log.push('comeback') } };
  };
  const dayRun = (level?: number): SimState => {
    const s = createRun(level ? campaignConfig(levelDef(level)!, false, true) : { seed: 7, profile: 3 });
    s.phase = 'day';
    return s;
  };

  it('toasts each active mission when the live run reaches it, with the count of three', () => {
    const save = defaults(0);
    save.missions.active = [
      { id: 'flakes-10', progress: 0, done: false, stale: 0 },
      { id: 'reach-9am', progress: 0, done: true, stale: 0 },
      { id: 'mult-3', progress: 0, done: false, stale: 0 },
    ];
    const b = createBanners();
    const { log, sinks: k } = sinks();
    const m = new RunMoments(b, k);
    m.begin(save, null, true);
    const s = dayRun();
    s.tick = 100;
    s.stats.flakes = 9;
    m.update(s);
    expect(b.toasts).toHaveLength(0);
    s.tick += 6;
    s.stats.flakes = 10;
    m.update(s);
    expect(b.toasts.map((t) => t.kicker.replace(/‌/g, ''))).toEqual(['MISSION ✓ 2/3']);
    expect(b.toasts[0]!.text).toMatch(/^Collect 10 flakes.* · \+\d+ Snow$/);
    s.tick += 6;
    s.stats.maxMult = 3;
    m.update(s);
    expect(b.toasts[1]!.kicker).toBe('ALL MISSIONS ✓ 3/3');
    expect(log).toEqual(['mission', 'mission']);
    // An unscored (debug) run tracks nothing.
    m.begin(save, null, false);
    s.stats.flakes = 99;
    s.tick += 6;
    m.update(s);
    expect(log).toHaveLength(2);
  });

  it('shows a level tip once per run, and none once the level is passed', () => {
    const save = defaults(0);
    const b = createBanners();
    const m = new RunMoments(b, sinks().sinks);
    const s = dayRun(3);
    m.begin(save, levelDef(3)!, true);
    const go: SimEvent = { e: 'go' };
    m.onEvent(go, s);
    m.onEvent(go, s);
    expect(b.toasts.map((t) => t.text)).toEqual([LEVEL_TIPS[3]![0]![1]]);
    expect(b.toasts[0]!.glyph).toBe('cloud');
    save.campaign.stars[2] = 1;
    b.toasts.length = 0;
    m.begin(save, levelDef(3)!, true);
    m.onEvent(go, s);
    expect(b.toasts).toHaveLength(0);
  });

  it('COMEBACK: a slow burn under the PHEW line, then held shade; a PHEW on the way in takes its place', () => {
    const b = createBanners();
    const { log, sinks: k } = sinks();
    const m = new RunMoments(b, k);
    m.begin(defaults(0), null, false);
    const s = dayRun();
    const nb = s.nubs;
    const burn = (): void => {
      nb.f = 1;
      nb.chill = s.params.phewT - 5;
      m.update(s);
      nb.f = 0;
      s.tick += 1;
      m.onEvent({ e: 'shadeEnter', litFor: 2 }, s);
    };
    burn();
    s.tick += 44;
    m.update(s);
    expect(log).toEqual([]);
    s.tick += 1;
    m.update(s);
    expect(log).toEqual(['comeback']);
    // Once per dip: Chill has to climb back over half before the next one.
    burn();
    s.tick += 60;
    m.update(s);
    expect(log).toEqual(['comeback']);
    nb.chill = nb.maxChill * 0.6;
    m.update(s);
    burn();
    m.onEvent({ e: 'phew' }, s);
    s.tick += 60;
    m.update(s);
    expect(log).toEqual(['comeback']);
  });
});
