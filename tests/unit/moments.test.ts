// v1.4 in-run moments: the stars so far (the HUD pips and the Pause card), the toast queue under
// the HUD, mission toasts measured live from the save's active missions, the first levels' tips and
// the COMEBACK.
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/config/tuning.ts';
import { createBot, createRun, levelDef, NOTE_CALM, NOTE_NOTCH, NOTE_REFUSE, NOTE_SETTLE, REFUSE_FULL, REFUSE_NOTHING, step, trialLevel, type SimEvent, type SimState } from '../../src/core/index.ts';
import { campaignConfig, STAR_COOL_LOST, STAR_FLAKES, STAR_GOAL, starState } from '../../src/game/campaign.ts';
import { createMoments, ELEMENT_TIPS, LEVEL_TIPS, MECH_TIPS, MIXER_TIPS, RELAY_TIPS, SETTLE_TIP, withDare } from '../../src/game/moments.ts';
import { mechanicOf } from '../../src/game/mechanics.ts';
import { defaults } from '../../src/meta/save.ts';
import { createBanners, endToast, endToasts, holdToasts, resetBanners, showToast, updateBanners } from '../../src/render/banners.ts';

const stats = (flakes: number, snow: number, litTotal: number, minChill: number) => ({ flakes, snow, litTotal, minChill });

describe('starState', () => {
  it('lights the goal and flakes stars as they are met and loses the cool run for good', () => {
    const l2 = levelDef(2)!;
    const goal = l2.goal.target;
    expect(starState(l2, stats(0, 0, 0, 100), false)).toBe(0);
    expect(starState(l2, stats(goal, 0, 0, 100), false)).toBe(STAR_GOAL);
    // Star 2 is L2's flakes Dare (sized by the bake).
    expect(starState(l2, stats(l2.feats[0]!.target, 0, 0, 100), false)).toBe(STAR_GOAL | STAR_FLAKES);
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
    // 'two' has waited a second: the next tip takes its place.
    b.toastClock += 1;
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
  it('two tips of one moment both show: a tip queued under a second ago is never replaced, nothing on screen or not', () => {
    const b = createBanners();
    showToast(b, 'tip', 'TIP', 'cash', 'coldsnap', 4);
    showToast(b, 'tip', 'TIP', 'snapBud', 'coldsnap', 4);
    expect(b.toasts.map((t) => t.text)).toEqual(['cash', 'snapBud']);
    run(b, 5);
    expect(b.toasts.map((t) => t.text)).toEqual(['snapBud']);
  });
  it('a stamp or card over a toast on screen hides it and holds its clock until it has gone (fix round 3)', () => {
    const b = createBanners();
    showToast(b, 'tip', 'TIP', 'one', 'drag', 3);
    run(b, 1);
    const t = b.toastT;
    b.stamp = 0;
    b.stampHold = 0.6;
    run(b, 0.5);
    expect(b.toastT).toBe(t);
    expect(b.toastHide).toBeGreaterThan(0.9);
    run(b, 1);
    expect(b.stamp).toBe(-1);
    expect(b.toastHide).toBeLessThan(0.1);
    expect(b.toastT).toBeGreaterThan(t);
    expect(b.toasts.map((x) => x.text)).toEqual(['one']);
  });
  it('an urgent toast drops what waits and the one on screen starts to leave', () => {
    const b = createBanners();
    showToast(b, 'tip', 'TIP', 'one', 'drag', 4);
    updateBanners(b, 0.1, false);
    showToast(b, 'mission', 'MISSION ✓ 1/3', 'm1', null, 2);
    showToast(b, 'tip', 'TIP', 'now', 'flare', 3, true);
    expect(b.toasts.map((x) => x.text)).toEqual(['one', 'now']);
    run(b, 0.4);
    expect(b.toasts[0]!.text).toBe('now');
  });
  it('an urgent tip waiting behind a leaving toast is never replaced, overtaken or cut short (merge, fix round 3)', () => {
    // e2e: the first flare's tip queued behind a leaving tip, then the deep-shade tip arrived in the
    // same 0.3 s and replaced it, so a new player never read it.
    const b = createBanners();
    showToast(b, 'tip', 'TIP', 'bud', 'drag', 4);
    updateBanners(b, 0.1, false);
    showToast(b, 'tip', 'TIP', 'soon', 'flare', 30, true);
    showToast(b, 'tip', 'TIP', 'deep', 'deep', 4);
    showToast(b, 'mission', 'MISSION ✓ 1/3', 'm1', null, 2);
    expect(b.toasts.map((x) => x.text)).toEqual(['bud', 'soon', 'm1', 'deep']);
    run(b, 0.6);
    expect(b.toasts[0]!.text).toBe('soon');
    // On screen past TIP_YIELD_S, a mission does not make it step aside: it holds until it is ended.
    run(b, 2);
    showToast(b, 'mission', 'MISSION ✓ 2/3', 'm2', null, 2);
    run(b, 1);
    expect(b.toasts[0]!.text).toBe('soon');
    endToast(b, 'soon');
    run(b, 0.4);
    expect(b.toasts.map((x) => x.text)).toEqual(['m1', 'm2', 'deep']);
  });
  it('a tip waits 6 s after the last toast left (the top band rests) and while a cue is read; a mission does not', () => {
    const b = createBanners();
    showToast(b, 'tip', 'TIP', 'one', 'drag', 1);
    showToast(b, 'tip', 'TIP', 'two', 'drag', 1);
    run(b, 1.7);
    expect(b.toasts.map((t) => t.text)).toEqual(['two']);
    run(b, 5);
    expect(b.toastT).toBe(-1);
    run(b, 1.2);
    expect(b.toastT).toBeGreaterThanOrEqual(0);
    run(b, 2);
    showToast(b, 'mission', 'MISSION ✓ 1/3', 'm1', null, 1);
    updateBanners(b, 0.1, false);
    expect(b.toasts[0]!.text).toBe('m1');
    expect(b.toastT).toBeGreaterThanOrEqual(0);
    resetBanners(b);
    holdToasts(b, 2.4);
    showToast(b, 'tip', 'TIP', 'go', 'drag', 3);
    run(b, 2.2);
    expect(b.toastT).toBe(-1);
    run(b, 0.4);
    expect(b.toastT).toBeGreaterThanOrEqual(0);
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
    const s = createRun(level ? campaignConfig(levelDef(level)!, false, true) : { seed: 7, mode: 'endless', profile: 3, tutorial: false, reducedMotion: false });
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
    const m = createMoments(b, k);
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
    s.stats.maxMult = 4;
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

  it('a Journey level toasts no mission steps before Missions open (fix round 2); Endless still does', () => {
    const save = defaults(0);
    save.missions.active = [{ id: 'flakes-10', progress: 0, done: false, stale: 0 }];
    const b = createBanners();
    const m = createMoments(b, sinks().sinks);
    const s = dayRun(2);
    s.tick = 100;
    s.stats.flakes = 10;
    m.begin(save, levelDef(2)!, true);
    m.update(s);
    expect(b.toasts.filter((t) => t.kind === 'mission')).toHaveLength(0);
    save.settings.unlockAll = true;
    m.begin(save, levelDef(2)!, true);
    s.tick += 6;
    m.update(s);
    expect(b.toasts.filter((t) => t.kind === 'mission')).toHaveLength(1);
    save.settings.unlockAll = false;
    b.toasts.length = 0;
    m.begin(save, null, true);
    s.tick += 6;
    m.update(s);
    expect(b.toasts.filter((t) => t.kind === 'mission')).toHaveLength(1);
  });

  it('a tip that names a count reads it from the level (L1: its flakes Dare); a level daring another verb drops that sentence', () => {
    for (const [id, tips] of Object.entries(LEVEL_TIPS)) {
      const lv = levelDef(Number(id))!;
      const f = lv.feats.find((x) => x.kind === 'flakes');
      for (const [, text] of tips) {
        const t = withDare(text, lv);
        expect(t).not.toContain('{n}');
        if (text.includes('{n}') && f) expect(t).toContain(`Collect ${f.target} `);
      }
    }
    expect(levelDef(1)!.feats.some((x) => x.kind === 'flakes')).toBe(true);
    expect(withDare('Flakes are Snow. Collect {n} for the second star!', { ...levelDef(1)!, feats: [{ kind: 'blooms', target: 1 }] })).toBe('Flakes are Snow.');
  });

  it('shows a level tip once per run, and none once the level is passed', () => {
    const save = defaults(0);
    const b = createBanners();
    const m = createMoments(b, sinks().sinks);
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

  it('v1.5: a level teaching a mechanic shows its tips at their moments; a new player gets the moment tips in endless', () => {
    const save = defaults(0);
    const b = createBanners();
    const m = createMoments(b, sinks().sinks);
    const s = dayRun(12);
    // Found by the concept's id (the core names it); a stand-in level teaching Cold Snap.
    m.begin(save, { ...levelDef(12)!, introduces: 'snap' as never }, true);
    const seen: string[] = [];
    const evs = [
      { e: 'go' },
      { e: 'frostReady' },
      { e: 'snap', x: 0, y: 0, cloudId: 1 },
      { e: 'snapCash', level: 4, refundH: 30 },
      { e: 'snapCash', level: 3, refundH: 0, hot: true },
      // Economy iteration 2: an amber snap at ×1 pours nothing and still teaches the gauge.
      { e: 'snapCash', level: 1, refundH: 0, amber: true },
      // A missed flare scorched the tank: the next snap heals it, and says so.
      { e: 'flareMiss', id: 1, lit: 30 },
      { e: 'snapCash', level: 1, refundH: 0, hot: true },
    ] as SimEvent[];
    for (const ev of evs) {
      s.flareScorch = ev.e === 'flareMiss' ? 40 : 0;
      m.onEvent(ev, s);
      if (ev.e === 'snap') {
        // v1.6: a bud in reach while the snap lasts (the dial's gold) brings the Garden's tip.
        s.snapTicks = 60;
        s.guide.bud[90] = 1;
        s.tick += 6;
        m.update(s);
        s.snapTicks = 0;
        s.guide.bud[90] = 0;
      }
      seen.push(...b.toasts.map((t) => t.text));
      b.toasts.length = 0;
    }
    expect(seen).toEqual(MECH_TIPS.snap.map((t) => t[1]));
    // Endless, a new player: a bud coming into view ahead.
    b.toasts.length = 0;
    const e = dayRun();
    m.begin(save, null, true);
    // The world now has generated buds (sorted by y): keep only this one in view.
    e.world.buds.length = 0;
    e.world.buds.push({ id: 999, x: e.nubs.x + 40, y: e.nubs.y + 120, face: 90, grow: 0, state: 0, casterId: -1 });
    e.tick = 50;
    m.update(e);
    expect(b.toasts).toHaveLength(1);
    expect(b.toasts[0]!.text).toMatch(/^A bud!/);
    // Economy iteration 2: a snap in the Noon Heat pours nothing, and says so once.
    b.toasts.length = 0;
    m.onEvent({ e: 'snapCash', level: 3, refundH: 0, noon: true }, e);
    expect(b.toasts.map((t) => t.text)).toEqual(['In the Noon Heat a snap pours nothing: snap before 11 or after 1.']);
    // A saved glass cluster's frost waits on the meter for the next snap, and says so once.
    b.toasts.length = 0;
    e.glassBankH = TUNING.bank.clusterH;
    m.onEvent({ e: 'clusterSaved', cluster: 1, brittle: true, n: 5, x: 0, y: 0 }, e);
    expect(b.toasts.map((t) => t.text)).toEqual(['Glass saved! Its frost waits for your next snap.']);
    e.glassBankH = 0;
    // A seasoned player gets none.
    save.stats.runs = 50;
    b.toasts.length = 0;
    m.begin(save, null, true);
    m.onEvent({ e: 'deepEnter' }, e);
    expect(b.toasts).toHaveLength(0);
    expect(mechanicOf('frosty')).toBeNull();
  });

  it('COMEBACK: a slow burn under the PHEW line, then held shade; a PHEW on the way in takes its place', () => {
    const b = createBanners();
    const { log, sinks: k } = sinks();
    const m = createMoments(b, k);
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

  it('Elementals: a Trial shows no Journey tips and no mission steps; a TAG drops the stale toasts', () => {
    const save = defaults(0);
    save.missions.active = [{ id: 'flakes-10', progress: 0, done: false, stale: 0 }];
    save.settings.unlockAll = true;
    const b = createBanners();
    const { log, sinks: k } = sinks();
    const m = createMoments(b, k);
    const s = createRun(campaignConfig(trialLevel(1005)!, false, true));
    s.phase = 'day';
    m.begin(save, trialLevel(1005)!, true);
    m.onEvent({ e: 'go' }, s);
    // Only the mixer's own tip (docs/ELEMENTALS_V2.md §10.3) at go.
    expect(b.toasts.map((t) => t.text)).toEqual([MIXER_TIPS[5]![0]![1]]);
    s.tick = 100;
    s.stats.flakes = 10;
    m.update(s);
    expect(log).toEqual([]);
    showToast(b, 'tip', 'TIP', 'stale', null, 3);
    m.onEvent({ e: 'tag', from: 'nubs', to: 'ember', index: 0 }, s);
    // The stale toasts leave; Ember's turn says how it plays, with its glyph.
    expect(b.toasts.map((t) => [t.text, t.glyph])).toEqual([[ELEMENT_TIPS.ember[0]![1], 'ember']]);
  });

  /** Plays Trial `id` with the core reactive bot into relay `leg` (each tick's events routed), collecting the tips shown. */
  const playTips = (id: number, leg: number, passed = false) => {
    const save = defaults(0);
    if (passed) save.elementals2 = { stars: [1, 1, 1, 1, 1, 1, 1], seen: true };
    const b = createBanners();
    const m = createMoments(b, sinks().sinks);
    const lv = trialLevel(id)!;
    const s = createRun(campaignConfig(lv, false, true));
    m.begin(save, lv, true);
    const bot = createBot('reactive');
    const seen: string[] = [];
    const drain = (): void => {
      for (const t of b.toasts) if (!seen.includes(t.text)) seen.push(t.text);
      b.toasts.length = 0;
    };
    // Up to the TAG, then a few ticks into the leg (the moments are looked for every 6 ticks).
    for (let n = 0, after = 0; n < 20_000 && after < 12 && s.phase !== 'dead' && s.phase !== 'won'; n++) {
      if (s.relayIdx >= leg) after++;
      step(s, bot.next(s));
      for (const ev of s.events) m.onEvent(ev, s);
      drain();
      m.update(s);
      drain();
    }
    return { s, m, seen, drain };
  };

  it("Elementals v2: each element's tips while it walks, the hand-off tips and none once the Trial is passed", () => {
    // T1: the first telegraph (into Ember) is the general hand-off tip; Ember's turn, then its first wall in reach.
    const t1 = playTips(1001, 1);
    expect(t1.s.nubs.hero).toBe('ember');
    expect(t1.seen).toEqual([RELAY_TIPS[2]![1], ELEMENT_TIPS.ember[0]![1], ELEMENT_TIPS.ember[1]![1]]);
    // Its low-Flame tip reads the steady health (under 40).
    t1.s.nubs.chill = 30;
    t1.s.tick += 6;
    t1.m.update(t1.s);
    t1.drain();
    expect(t1.seen).toContain(ELEMENT_TIPS.ember[3]![1]);
    // T2: the telegraph into Drip says the sun will hold; Drip's turn; its puddles and hot stones ahead.
    const t2 = playTips(1002, 1);
    expect(t2.seen).toEqual(expect.arrayContaining([RELAY_TIPS[0]![1], ELEMENT_TIPS.drip[0]![1], ELEMENT_TIPS.drip[1]![1], ELEMENT_TIPS.drip[2]![1]]));
    expect(t2.seen).not.toContain(RELAY_TIPS[2]![1]);
    // T3: Sprout's turn, a site in reach and a soil patch in the window; Nubs' tip on his second leg.
    const t3 = playTips(1003, 2);
    expect(t3.seen).toEqual(expect.arrayContaining([ELEMENT_TIPS.sprout[0]![1], ELEMENT_TIPS.sprout[1]![1], ELEMENT_TIPS.sprout[2]![1], ELEMENT_TIPS.nubs[0]![1]]));
    expect(t3.seen.indexOf(ELEMENT_TIPS.nubs[0]![1])).toBeGreaterThan(t3.seen.indexOf(ELEMENT_TIPS.sprout[0]![1]));
    // T4: the telegraph into Gust, Gust's turn and its weather.
    const t4 = playTips(1004, 1);
    expect(t4.seen).toEqual(expect.arrayContaining([RELAY_TIPS[1]![1], ELEMENT_TIPS.gust[0]![1], ELEMENT_TIPS.gust[1]![1]]));
    // A passed Trial shows none.
    expect(playTips(1001, 2, true).seen).toEqual([]);
  });

  it("Controls v3: the driver's triggers: due, the first refusal of each reason, a gale notch, an auto-calm (docs/CONTROLS_V3.md §6.2)", () => {
    // Ember's leg of a fresh T1: the first due prompt, ahead of other toasts.
    const t1 = playTips(1001, 1);
    t1.s.tick += 6;
    t1.m.update(t1.s, 1);
    t1.drain();
    expect(t1.seen).toContain(ELEMENT_TIPS.ember[4]![1]);
    // Each refusal reason once, in its chip's words (a repeat of the same reason adds nothing).
    for (const [a, text] of [[REFUSE_NOTHING, 'Nothing to burn yet'], [REFUSE_NOTHING + 16, 'Nothing to burn yet'], [REFUSE_FULL, 'Two walls ready']] as const) {
      expect(t1.m.onDrive(NOTE_REFUSE, a, t1.s, text)).toBe(false);
    }
    t1.drain();
    expect(t1.seen.filter((x) => x === 'Nothing to burn yet' || x === 'Two walls ready')).toEqual(['Nothing to burn yet', 'Two walls ready']);
    // Gust's leg of T4: the first gale notch and the first auto-calm (not a breeze, nor a calm press).
    const t4 = playTips(1004, 1);
    expect(t4.s.nubs.hero).toBe('gust');
    t4.m.onDrive(NOTE_NOTCH, 1, t4.s, '');
    t4.m.onDrive(NOTE_CALM, 0, t4.s, '');
    t4.drain();
    expect(t4.seen).not.toContain(ELEMENT_TIPS.gust[3]![1]);
    expect(t4.seen).not.toContain(ELEMENT_TIPS.gust[4]![1]);
    t4.m.onDrive(NOTE_NOTCH, -2, t4.s, '');
    t4.m.onDrive(NOTE_CALM, 1, t4.s, '');
    t4.drain();
    expect(t4.seen).toEqual(expect.arrayContaining([ELEMENT_TIPS.gust[3]![1], ELEMENT_TIPS.gust[4]![1]]));
    // A passed Trial gets no refusal tips.
    const done = playTips(1001, 1, true);
    done.m.onDrive(NOTE_REFUSE, REFUSE_NOTHING, done.s, 'Nothing to burn yet');
    done.drain();
    expect(done.seen).toEqual([]);
  });

  it("Controls v3: Nubs' settle tip shows at his first rescue capture outside the lesson, once per profile (§6.1)", () => {
    const save = defaults(0);
    save.stats.runs = 40;
    const b = createBanners();
    const m = createMoments(b, sinks().sinks);
    const s = dayRun();
    m.begin(save, null, true);
    // A track re-inset (a = 0) or a lesson run says nothing; a rescue capture does, once.
    expect(m.onDrive(NOTE_SETTLE, 0, s, '')).toBe(false);
    s.lessonOn = true;
    expect(m.onDrive(NOTE_SETTLE, 1, s, '')).toBe(false);
    s.lessonOn = false;
    expect(m.onDrive(NOTE_SETTLE, 1, s, '')).toBe(true);
    expect(b.toasts.map((t) => t.text)).toEqual([SETTLE_TIP]);
    expect(m.onDrive(NOTE_SETTLE, 1, s, '')).toBe(false);
    // Once the profile has seen it, never again; an experienced player's run shows no refusal tips.
    save.flags.settleTip = true;
    m.begin(save, null, true);
    expect(m.onDrive(NOTE_SETTLE, 1, s, '')).toBe(false);
    m.onDrive(NOTE_REFUSE, 1, s, 'Cold Snap charging · 40%');
    expect(b.toasts.map((t) => t.text)).toEqual([SETTLE_TIP]);
  });

});
