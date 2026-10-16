// v1.6 on the game side (docs/V1_6_PLAN.md §2, §4, §9 GAME and amendment A2's META items): the
// MechView read from the run (and robust to the contract's stub values), the Dares' words and live
// counts, the soft-fail's miss count in the save, the missions retargeted (T8 is in content.test),
// and the new events' audio, haptics and tips.
import { describe, expect, it } from 'vitest';
import { buildRunResult, createRun, debugFlare, levelDef, TUNING, type LevelDef, type SimEvent, type SimState } from '../../src/core/index.ts';
import type { SfxName } from '../../src/audio/recipes.ts';
import { createAudioView } from '../../src/audio/scene.ts';
import { SfxRouter } from '../../src/audio/sfxRouter.ts';
import {
  campaignConfig,
  dareText,
  featLabel,
  goalLine,
  goalMetLive,
  goalText,
  hudGoal,
  introCard,
  missLine,
  nextStarHint,
  SOFT_FAIL_MISSES,
  STAR_FLAKES,
  starRules,
  starState,
} from '../../src/game/campaign.ts';
import { createMechanics, mechanicOf } from '../../src/game/mechanics.ts';
import { createMoments, MECH_TIPS, SOFT_FAIL_TIP } from '../../src/game/moments.ts';
import { applyRunResult } from '../../src/meta/progression.ts';
import { defaults, migrate } from '../../src/meta/save.ts';
import { mergeSaves } from '../../src/meta/saveMerge.ts';
import { hapticForEvent } from '../../src/platform/haptics.ts';
import { createBanners } from '../../src/render/banners.ts';
import { snapsText } from '../../src/render/hud.ts';

const endless = (): SimState => createRun({ seed: 7, mode: 'endless', profile: 3, tutorial: false, reducedMotion: false });

/** Level `id` with these Dares (CORE-2 assigns them; the contract leaves every level's empty). */
const withFeats = (id: number, feats: LevelDef['feats']): LevelDef => ({ ...levelDef(id)!, feats });

describe('MechView (game/mechanics.ts)', () => {
  it('reads the v1.6 state defensively: two pips with the Bank, the ring flag, no layers at the stub values', () => {
    // The Frost Bank ships off (V16_SHIP): one gauge by default, two pips when a run switches it on.
    expect(createMechanics().fill(endless(), 0).pips).toBe(1);
    const s = createRun({ seed: 7, mode: 'endless', profile: 3, tutorial: false, reducedMotion: false, v16: { bank: true } });
    const m = createMechanics();
    const v = m.fill(s, 0);
    expect(v.pips).toBe(2);
    expect(v.ring).toBe(true);
    expect(v.mult).toBe(s.nubs.mult);
    expect(v.ringFill).toBe(0);
    expect(v.flarePhase).toBe(0);
    expect(v.flare).toBeNull();
    expect(v.land).toBeNull();
    expect(v.noonHeat).toBe(1);
    // The meter's fill is the Bank's hundredths (or the v1.5 meter, whichever says more).
    s.nubs.frostH = 160;
    expect(m.fill(s, 0).frost).toBeCloseTo(1.6);
    // With the rules switched off the meter is one gauge and the badge keeps its v1.5 bar.
    const off = createRun({ seed: 7, mode: 'endless', profile: 3, tutorial: false, reducedMotion: false, v16: { bank: false, ring: false } });
    const vo = createMechanics().fill(off, 0);
    expect(vo.pips).toBe(1);
    expect(vo.ring).toBe(false);
  });

  it('follows a kept flare through its phases (the warning counts down), and records parries and misses', () => {
    const s = endless();
    const m = createMechanics();
    const f = debugFlare(s, 0, 10);
    // The sim's own state machine (CORE-2) drives the phase: a sim at phase 1 on this flare.
    s.flareIdx = s.world.flares.indexOf(f);
    s.flareId = f.id;
    s.flarePhase = 1;
    s.tickAbs = f.warnTick + (f.riseTick - f.warnTick) / 4;
    let v = m.fill(s, 0);
    expect(v.flarePhase).toBe(1);
    expect(v.flareLeft).toBeCloseTo(0.75);
    s.flarePhase = 3;
    s.tickAbs = f.holdTick + 1;
    v = m.fill(s, 0);
    expect(v.flarePhase).toBe(3);
    expect(v.flareLeft).toBe(0);
    const sig = v.flareSig;
    m.onEvent({ e: 'flareParry', id: f.id, snap: false, snow: 5 });
    v = m.fill(s, 0);
    expect(v.flareOut.get(f.id)).toBe(1);
    expect(v.flareSig).not.toBe(sig);
  });

  it('stages its demos without errors and stands in for the sim while they last', () => {
    const s = endless();
    s.phase = 'day';
    const m = createMechanics();
    const routed: string[] = [];
    m.route = (ev) => routed.push(ev.e);
    const snap = { theta: 90 } as never;
    for (const d of ['ring', 'bleed', 'trick', 'pips', 'spill', 'cash', 'bank', 'land', 'landing', 'deepBand', 'glass', 'flare', 'parry', 'noonHeat']) {
      expect(m.demo(d, s, snap, 1)).toBe(true);
    }
    expect(m.demo('nope', s, snap, 1)).toBe(false);
    let v = m.fill(s, 1.5);
    expect(v.noonHeat).toBe(1.25);
    expect(v.snapLeft).toBeGreaterThan(0);
    expect(v.glass?.length).toBe(360);
    // The landing's teal stands in for guide.land while its snap lasts.
    m.demo('land', s, snap, 2);
    v = m.fill(s, 2.5);
    expect(v.land?.length).toBe(360);
    expect(routed).toEqual(expect.arrayContaining(['ringTrick', 'frostSpill', 'snapCash', 'snap', 'snapLand', 'flareWarn', 'flareParry', 'dawn']));
    expect(mechanicOf('brittle')).toBe('glass');
    expect(mechanicOf('flare')).toBe('flare');
    expect(snapsText(30)).toBe('+0.3');
  });
});

describe('Dares (game/campaign.ts)', () => {
  it('names a level\'s Dare on the intro card, its star rule and the finale\'s choice', () => {
    const one = withFeats(12, [{ kind: 'blooms', target: 2 }]);
    const card = introCard(one);
    expect(card.dare).toBe('Dare · Bloom 2');
    expect(card.dareGlyph).toBe('sunflower');
    expect(card.stars[1]).toBe('Bloom 2');
    const two = withFeats(50, [{ kind: 'blooms', target: 2 }, { kind: 'parry', target: 6 }]);
    expect(dareText(two)).toBe('Bloom 2 or Parry 6');
    expect(starRules(two)[1]).toBe('A Dare');
    // Without Dares the flakes star stays (every v1.6 level has one; a made-up level checks the words).
    expect(introCard(withFeats(12, [])).dare).toBe('');
    expect(starRules(withFeats(12, []))[1]).toMatch(/flakes$/);
    expect(featLabel({ kind: 'deep', target: 90 }, one)).toBe('1.5 s deep');
    expect(featLabel({ kind: 'brittle', target: 1 }, one)).toBe('Save 1 glass');
    expect(featLabel({ kind: 'swings', target: 3 }, one)).toBe('3 SWINGs');
    expect(featLabel({ kind: 'still', target: 2 }, { ...one, concepts: ['gusts'] })).toBe('Hold 2 gusts');
  });

  it('counts the Dare live on the pill (from the sim\'s feat events) and lights star 2 when it is met', () => {
    const lv = withFeats(12, [{ kind: 'blooms', target: 2 }]);
    const st = { flakes: 0, snow: 3, litTotal: 0, minChill: 100 };
    const seen = new Map<'blooms', number>([['blooms', 1]]);
    const g = hudGoal(lv, st, undefined, false, seen);
    expect(g).toMatchObject({ value: 1, target: 2, glyph: 'sunflower', sec: false });
    expect(starState(lv, st, false, false, seen) & STAR_FLAKES).toBe(0);
    seen.set('blooms', 2);
    expect(starState(lv, st, false, false, seen) & STAR_FLAKES).toBe(STAR_FLAKES);
    expect(nextStarHint(lv, { ...st, flakes: 0 }, new Map([['blooms', 1]]))).toBe(' · Next ★: Bloom 2 (1/2)');
    // A deep Dare counts ticks and shows seconds.
    const deep = withFeats(12, [{ kind: 'deep', target: 90 }]);
    expect(hudGoal(deep, st, undefined, false, new Map([['deep', 30]]))).toMatchObject({ value: 30, target: 90, glyph: 'deep', sec: true });
  });

  it('a verb goal counts until it is met, then the pill moves on to the Dare', () => {
    const lv: LevelDef = { ...withFeats(8, [{ kind: 'blooms', target: 3 }]), goal: { kind: 'swings', target: 1 } };
    const st = { flakes: 0, snow: 0, litTotal: 0, minChill: 100 };
    expect(goalText(lv)).toBe('1 SWING');
    expect(hudGoal(lv, st, undefined, false, new Map([['swings', 0]]))).toMatchObject({ value: 0, target: 1, glyph: 'swing' });
    expect(missLine(lv)).toBe('GOAL MISSED');
    expect(goalLine(lv, st, false, false, new Map(), 1)).toBe('Goal missed: 1 SWING (0/1)');
    expect(goalLine(lv, st, false, false, new Map(), SOFT_FAIL_MISSES)).toMatch(/Next try: just reach the finish$/);
  });

  it('verb goals count the way the core scores them (gate: shaded, snapSave: every snap tick, flip: within its ticks)', () => {
    const gate = levelDef(13)!;
    const snap = levelDef(10)!;
    const flip = levelDef(36)!;
    expect([gate.goal.kind, snap.goal.kind, flip.goal.kind]).toEqual(['gate', 'snapSave', 'flip']);
    const st = { flakes: 0, snow: 0, litTotal: 0, minChill: 100 };
    expect(goalText(gate)).toBe('Shade the arch');
    // Deep under the arch is the Dare's count, not the goal's.
    expect(hudGoal(gate, { ...st, gateShaded: 0, gateDeep: 1 })).toMatchObject({ value: 0, target: gate.goal.target, glyph: 'gate' });
    expect(goalMetLive(gate, { ...st, gateShaded: 1, gateDeep: 0 })).toBe(true);
    expect(goalMetLive(snap, { ...st, snapSavedTicks: snap.goal.target, earnedSnapSavedTicks: 0 })).toBe(true);
    expect(goalMetLive(flip, { ...st, flipTicks: flip.goal.target })).toBe(true);
    expect(goalMetLive(flip, { ...st, flipTicks: 0 })).toBe(false);
    expect(goalLine(flip, { ...st, flipTicks: 0 }, false)).toBe('Goal missed: Shade the flip (0/1)');
  });

  it('the soft-fail relaxes a missed goal to the finish: the config, the words and the pill', () => {
    const lv = levelDef(2)!;
    expect(lv.goal.kind).toBe('flakes');
    expect(campaignConfig(lv, false, true, true).relaxedGoal).toBe(true);
    expect(campaignConfig(lv, false, true).relaxedGoal).toBeUndefined();
    // A finish goal has nothing to relax.
    expect(campaignConfig(levelDef(1)!, false, true, true).relaxedGoal).toBeUndefined();
    expect(goalText(lv, true)).toBe('Reach the finish');
    expect(starRules(lv, true)[0]).toBe('Finish');
    // Relaxed, the pill counts the level's Dare (L2: flakes), or plain Snow on a level without one.
    const dare = lv.feats[0]!;
    expect(hudGoal(lv, { flakes: 1, snow: 4 }, undefined, true)).toMatchObject({ value: dare.kind === 'flakes' ? 1 : 0, target: dare.target });
    expect(hudGoal(withFeats(2, []), { flakes: 1, snow: 4 }, undefined, true)).toMatchObject({ value: 4, target: -1 });
    expect(introCard(lv, true).goal).toBe('Reach the finish');
    const s = createRun(campaignConfig(lv, false, true, true));
    expect(s.cfg.relaxedGoal).toBe(true);
  });
});

describe('the soft-fail\'s miss count in the save (META, A2)', () => {
  const missed = (save: ReturnType<typeof defaults>, goalMiss = true) => {
    const s = createRun(campaignConfig(levelDef(2)!, false, true));
    return applyRunResult(save, buildRunResult(s), { today: '2026-10-16', goalMiss }).save;
  };

  it('counts a level\'s goal misses (only those), keeps them through a reload and merges by the larger', () => {
    const fresh = defaults(1);
    expect(fresh.campaign.misses).toBeUndefined();
    expect(missed(fresh, false).campaign.misses).toBeUndefined();
    const once = missed(fresh);
    expect(once.campaign.misses?.[1]).toBe(1);
    const twice = missed(once);
    expect(twice.campaign.misses?.[1]).toBe(SOFT_FAIL_MISSES);
    // Lossless: the field round-trips through the save's sanitizer and a cross-tab merge.
    const back = migrate(JSON.stringify(twice)).save;
    expect(back.campaign.misses?.[1]).toBe(2);
    expect(back.campaign.misses).toHaveLength(twice.campaign.stars.length);
    expect(migrate(JSON.stringify(fresh)).save.campaign.misses).toBeUndefined();
    const merged = mergeSaves(null, once, twice);
    expect(merged.campaign.misses?.[1]).toBe(2);
    expect(mergeSaves(null, fresh, fresh).campaign.misses).toBeUndefined();
    // Damaged values are clamped.
    const bad = JSON.parse(JSON.stringify(twice));
    bad.campaign.misses = [-3, 'x', 400];
    expect(migrate(JSON.stringify(bad)).save.campaign.misses?.slice(0, 3)).toEqual([0, 0, 9]);
  });
});

describe('v1.6 events: audio, haptics, tips', () => {
  const router = () => {
    const played: SfxName[] = [];
    let now = 1000;
    const r = new SfxRouter({ play: (name) => played.push(name), applyScene: () => {} }, () => now);
    const view = Object.assign(createAudioView(), { screen: 'play', phase: 'day' });
    return { played, send: (ev: SimEvent, dt = 0) => ((now += dt), r.onEvents([ev], view)) };
  };

  it('cues the cash-in, a spill, a parry, a landing and a flare warning; only losing ×5 sounds; tricks are throttled', () => {
    const t = router();
    t.send({ e: 'snapCash', level: 4, refundH: 30 });
    t.send({ e: 'snapCash', level: 1, refundH: 0 });
    t.send({ e: 'frostSpill', lostH: 20 });
    t.send({ e: 'flareParry', id: 1, snap: false, snow: 5 });
    t.send({ e: 'snapLand', chain: 2, own: true, x: 0, y: 0 });
    t.send({ e: 'flareWarn', id: 1, ticks: 120, d: 10 });
    t.send({ e: 'multDown', from: 3, to: 2, cause: 'bleed' });
    t.send({ e: 'multDown', from: 5, to: 4, cause: 'bleed' });
    t.send({ e: 'multDown', from: 5, to: 1, cause: 'snap' });
    expect(t.played).toEqual(['frostReady', 'snapEnd', 'parry', 'swing', 'flareWarn', 'multReset']);
    t.played.length = 0;
    for (let i = 0; i < 10; i++) t.send({ e: 'ringTrick', kind: 'streak', units: 300 }, 20);
    expect(t.played.filter((n) => n === 'budGrow').length).toBeLessThanOrEqual(2);
  });

  it('buzzes a parry, a landing, a trick and a flare warning', () => {
    expect(hapticForEvent({ e: 'flareParry', id: 1, snap: true, snow: 5 })).toBe('crystal');
    expect(hapticForEvent({ e: 'snapLand', chain: 1, own: false, x: 0, y: 0 })).toBe('bloom');
    expect(hapticForEvent({ e: 'ringTrick', kind: 'bloom', units: 600 })).toBe('tick');
    expect(hapticForEvent({ e: 'flareWarn', id: 1, ticks: 120, d: 8 })).toBe('frost');
    expect(hapticForEvent({ e: 'flareMiss', id: 1, lit: 9 })).toBe('glare');
    expect(hapticForEvent({ e: 'multDown', from: 3, to: 2, cause: 'bleed' })).toBeNull();
    expect(hapticForEvent({ e: 'clusterSaved', cluster: 1, brittle: true, n: 3, x: 0, y: 0 })).toBe('crystal');
    expect(hapticForEvent({ e: 'feat', kind: 'blooms', value: 1, target: 2 })).toBeNull();
  });

  it('tips: the soft-fail at go, the glass and flare levels at their moments, a new player\'s ring drop', () => {
    const b = createBanners();
    const m = createMoments(b, { mission: () => {}, comeback: () => {} });
    const texts = (): string[] => b.toasts.map((t) => t.text);
    const s = createRun(campaignConfig(levelDef(2)!, false, true, true));
    s.phase = 'day';
    m.begin(defaults(0), levelDef(2)!, true, true);
    m.onEvent({ e: 'go' }, s);
    expect(texts()).toContain(SOFT_FAIL_TIP);
    // A level teaching glass flakes: the first glass window on the dial.
    b.toasts.length = 0;
    m.begin(defaults(0), { ...levelDef(12)!, introduces: 'brittle' as never }, true);
    s.guide.flake[40] = 1;
    s.tick += 12;
    m.update(s);
    expect(texts()).toEqual([MECH_TIPS.glass[0]![1]]);
    s.guide.flake[40] = 0;
    // A level teaching flares: the first warning.
    b.toasts.length = 0;
    m.begin(defaults(0), { ...levelDef(12)!, introduces: 'flare' as never }, true);
    m.onEvent({ e: 'flareWarn', id: 1, ticks: 72, d: 10 }, s);
    expect(texts()).toEqual([MECH_TIPS.flare[0]![1]]);
    // A new player's endless run: the ring's first drop from ×3 or more (not a snap's cash-in).
    b.toasts.length = 0;
    const e = endless();
    m.begin(defaults(0), null, true);
    m.onEvent({ e: 'multDown', from: 4, to: 1, cause: 'snap' }, e);
    m.onEvent({ e: 'multDown', from: 2, to: 1, cause: 'bleed' }, e);
    expect(texts()).toEqual([]);
    m.onEvent({ e: 'multDown', from: 3, to: 2, cause: 'bleed' }, e);
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toMatch(/drains the ring/);
  });

  it('the tunings the HUD reads exist (the contract\'s starting values)', () => {
    expect(TUNING.ring.need).toHaveLength(4);
    expect(TUNING.bank.capH).toBe(200);
    expect(TUNING.brittle.meltBudget).toBeLessThan(TUNING.pickups.meltBudget);
  });
});
