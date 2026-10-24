// In-run moments (v1.4, docs/V1_4_PLAN.md §4 GAME): the toasts under the HUD when a mission step
// lands ("MISSION ✓ 2/3"), the first Journey levels' contextual tips, and the COMEBACK, a slow
// burn survived. Read-only on the save: mission progress is the save's active missions measured
// against the live run (meta missionValue); the meta layer still decides everything at the end.
//
// v1.5: the level that teaches a mechanic (Sunflower buds, Cold Snap, deep shade: game/mechanics.ts
// finds it by its concept) gets that mechanic's tips (MECH_TIPS) until it is passed, shown when the
// moment comes (a bud ahead, the first bloom, the meter full, a snap, deep shade). A new player's
// first endless and daily runs (fewer than NEW_PLAYER_RUNS) get the bud and deep-shade moment tips.
//
// v1.6 (docs/V1_6_PLAN.md §2): the Flow Ring on L2 (the first ×up), the Frost Bank and Garden on the
// Cold Snap's level (a pip full, a snap with a bud in reach, the first cash-in), glass flakes on
// their level (the first glass window on the dial) and Heat Flares on theirs (the first warning).
// A new player's endless runs get the ring's first drop from ×3 or more, the Garden, the cash-in,
// the glass and the flare tips too; the flare's comes FLARE_LEAD before the first kept flare's
// warning (it is on the ruler long before), goes ahead of any other toast and leaves at the rise,
// so it is read before the countdown runs and never after it. A level whose goal was relaxed (the
// soft-fail) says so at go.
//
// Elementals v2 (docs/ELEMENTALS_V2.md §7.11, §10.3): a Trial gets no Journey tips, mission steps or
// COMEBACK. Until it is passed it gets its elements' tips (ELEMENT_TIPS, each shown while that
// element walks: 'tag' when its first leg begins, Nubs' on his second; 'target', 'low', 'water',
// 'stone' and 'plot' when the moment comes), the hand-off tips (RELAY_TIPS, at the first telegraph
// into Drip, into Gust, and any other) and a mixer's own (MIXER_TIPS, at go). A TAG drops the stale
// toasts and the outgoing element's tips.

import {
  burnTarget,
  elHealth,
  FLARE_KEPT,
  growTarget,
  levelProgress,
  queryBuds,
  trialDef,
  TUNING,
  type Bud,
  type HeroId,
  type LevelDef,
  type RunResult,
  type SimEvent,
  type SimState,
} from '../core/index.ts';
import { missionLabel, missionReward, missionTarget, missionValue, parseMissionId } from '../meta/missions.ts';
import type { MissionDef } from '../meta/content.ts';
import { featureUnlocked } from '../meta/gamify.ts';
import type { Save } from '../meta/saveTypes.ts';
import { clearToasts, endToast, endToasts, showToast, type Banners } from '../render/banners.ts';
import { goalMetLive, trialGlyph } from './campaign.ts';
import { mechanicOf, type Mechanic } from './mechanics.ts';

/**
 * When a tip shows: at go, at a share of the level, on the first flake, melt or cloud, at the goal.
 * Elementals v2: 'tag' an element's first leg begins; 'target' its first target enters the window;
 * 'low' its steady health first under 40; 'water' (Ember) a puddle or rain ahead, (Sprout) rain on
 * Sprout or a site; 'stone' (Drip) a hot stone ahead; 'plot' (Sprout) a soil patch in the window.
 */
export type TipOn =
  | 'go' | 'p25' | 'p60' | 'flake' | 'melt' | 'cloud' | 'goal' | 'bud' | 'bloom' | 'frost' | 'snap' | 'deep' | 'mult' | 'drop'
  | 'cash' | 'hot' | 'amber' | 'heal' | 'noon' | 'snapBud' | 'glass' | 'glassSaved' | 'soon' | 'scorch' | 'tagSoon' | 'tag'
  | 'target' | 'low' | 'water' | 'stone' | 'plot';

type Tips = readonly (readonly [TipOn, string])[];

/** Elementals v2 (§10.3): each element's tips, shown while it walks until the Trial is passed. */
export const ELEMENT_TIPS: Readonly<Record<HeroId, Tips>> = {
  ember: [
    ['tag', "Ember's turn! Tap a wall just before Ember reaches it."],
    ['target', 'Tap when the ring pulses: Ember walks through its own fire and takes it back.'],
    ['water', 'Puddles and rain douse Ember, and rain puts fires out. Tap a puddle to dry it.'],
    ['low', 'Low flame! Turn the sun onto Ember to refuel.'],
  ],
  drip: [
    ['tag', "Drip's turn! Drag sideways: Drip follows your finger. The sun holds."],
    ['target', 'Puddles and shade grow Drip. Steer into them.'],
    ['stone', 'Hot stones shrink Drip. Steer around the orange glow.'],
  ],
  sprout: [
    ['tag', "Sprout's turn! Hold on the soil patch ahead to grow a plant."],
    ['target', 'Hold on the gap now: a bridge takes time to grow. Sun on it helps.'],
    ['plot', 'Hold on a soil patch to grow a tree: shade for Nubs later.'],
    ['water', 'Rain gives Sprout sap and makes plants grow fast.'],
  ],
  gust: [
    ['tag', "Gust's turn! Swipe left or right to blow the weather off the trail."],
    ['target', 'Each swipe costs Lift. Swipe early: the wind keeps pushing.'],
    ['low', 'Low Lift! Swipe less and stay dry: clear air restores Lift.'],
  ],
  // Every Trial starts with Nubs: his 'tag' tip is for his second leg.
  nubs: [['tag', 'Nubs again: drag to turn the sun and stay in shade.']],
};

/** Elementals v2: the hand-off tips, at the first telegraph into Drip, into Gust, and any other (no element). */
export const RELAY_TIPS: readonly (readonly [TipOn, string, HeroId?])[] = [
  ['tagSoon', 'Drip is next: the sun will hold. Turn it to the dashed arcs now!', 'drip'],
  ['tagSoon', 'Gust is next: the sun will hold where you leave it.', 'gust'],
  ['tagSoon', 'Hand-off soon! The next element plays its own way.'],
];

/** Elementals v2: the mixers' own tips (Trial n), at go. */
export const MIXER_TIPS: Readonly<Record<number, Tips>> = {
  5: [['go', 'Melt the ice past the Tag Stone for Drip. Wait out the shower before you burn.']],
  6: [['go', 'Blow the fog off Sprout\'s path and the rain onto it: rain feeds Sprout.']],
  7: [['go', 'The breeze blows west and fire spreads with it. Keep four trees standing!']],
};

/**
 * Contextual tips for the first Journey levels, shown on each try until the level is passed. Level
 * 1's lesson (the ghost hand and the cue line) teaches the drag itself, so its tips come later.
 */
export const LEVEL_TIPS: Readonly<Record<number, readonly (readonly [TipOn, string])[]>> = {
  1: [
    ['p25', 'The bar up top fills as Nubs nears the finish flag.'],
    // {n}: the level's flakes Dare (begin() fills it in, or drops the sentence when it dares another verb).
    ['flake', 'Flakes are Snow. Collect {n} for the second star!'],
    ['p60', 'Third star: a cool run. Its ring drains while Nubs is in the sun.'],
  ],
  2: [
    ['go', 'Flakes melt in the sun: shade them before Nubs gets there.'],
    ['mult', 'Shade fills the ring round your ×. Idle sun drains it.'],
    ['melt', 'One melted! Shade the next flakes early.'],
    ['goal', 'Goal done! Now bring Nubs home to the flag.'],
  ],
  3: [
    ['go', "Watch the sky: a cloud's shadow is shade too."],
    ['cloud', 'Cloud shade! It drifts on its own, so ride it while it lasts.'],
    ['p60', 'No shade close by? Swing the sun to reach the next shadow.'],
  ],
};

/** A saved glass cluster's frost waits for the next snap (the meter's ghost chip). */
const GLASS_SAVED_TIP = 'Glass saved! Its frost waits for your next snap.';

/** The Heat Flare tip (two lines at 360 px): the real cue, the rim, and where to go. */
const FLARE_TIP = 'Heat Flare! Reach frost-rimmed teal before the rim runs out.';
/** The first endless flare's tip, read before its warning (two lines at 390 px). */
const FLARE_SOON_TIP = 'Heat Flare soon! Before its rim runs out, reach frost-rimmed teal.';
/** The flare tip shows this long (ticks) before the warning: a tip's read (TIP_HOLD) ahead of a 2 s countdown. */
const FLARE_LEAD = 240;
/**
 * The flare tip's toast hold (s): a ceiling only. It leaves when the game reaches the rise (the
 * toast clock runs on real time, the flare on game time, which lags it on a loaded device).
 */
const FLARE_TIP_MAX_S = 30;

/**
 * v1.5: the tips of the level that teaches each mechanic. 'bud' shows when a closed bud comes into
 * view ahead, 'bloom' on the first bloom, 'frost' when the meter is full, 'snap' on the first Cold
 * Snap, 'deep' on the first deep shade.
 */
export const MECH_TIPS: Readonly<Record<Mechanic, readonly (readonly [TipOn, string])[]>> = {
  bud: [
    ['bud', 'A bud! Gold on the dial grows it, fastest while the gauge is white.'],
    // The bud's level comes before the frost meter: its bloom banks nothing yet.
    ['bloom', 'Bloomed! Shade for the rest of the run.'],
    ['p60', 'Where gold meets teal, one angle cools Nubs and grows the bud.'],
  ],
  snap: [
    ['go', 'Sunflowers grown in shade fill the frost. Full? Swipe down.'],
    ['frost', 'A snap is ready! Swipe down, press ↓ or tap the meter.'],
    ['snapBud', 'The frost has you. The sun is free: grow a bud!'],
    ['cash', 'A white snap pours your ring into the frost and cools you full.'],
    ['hot', 'A red-hot snap only shades you. Snap before the gauge turns red.'],
    ['amber', 'An amber snap pours less and cools you part way.'],
    ['heal', 'The snap healed the scorch: shade fills your whole tank again.'],
  ],
  deep: [
    ['go', 'Two shadows on Nubs is deep shade: it cools twice as fast.'],
    ['deep', 'Deep shade! The dark teal band is double cool. Hunt the overlaps.'],
  ],
  glass: [
    ['glass', 'Glass flakes melt fast: shade them on the white glint.'],
    ['glassSaved', GLASS_SAVED_TIP],
  ],
  // The Solar Flare's level says it at go, before its first 1.2 s warning (too short to read a tip in).
  flare: [['go', FLARE_TIP]],
};

/**
 * A tip's '{n}' is the level's flakes Dare target ("Collect 6 for the second star!"); on a level that
 * dares another verb the sentence holding it is dropped, so a tip never names a count the level lacks.
 */
export function withDare(text: string, lv: LevelDef): string {
  if (!text.includes('{n}')) return text;
  const f = lv.feats.find((x) => x.kind === 'flakes');
  return f ? text.replace('{n}', String(f.target)) : text.replace(/\s*[^.!?]*\{n\}[^.!?]*[.!?]/, '');
}

/** The soft-fail's tip at go (a level whose goal was missed twice). */
export const SOFT_FAIL_TIP = 'Goal eased: just reach the finish. The Dare still earns its star.';

/**
 * Tips for the mechanics' moments in a new player's endless and daily runs (the cue line says how to
 * snap), each with its mechanic's glyph for the toast's icon disc (outside a level there is no
 * concept glyph to show).
 */
export const FIRST_TIPS: readonly (readonly [TipOn, string, string])[] = [
  [...(MECH_TIPS.bud[0] as readonly [TipOn, string]), 'sunflower'],
  [...(MECH_TIPS.deep[1] as readonly [TipOn, string]), 'deep'],
  ['drop', 'Idle sun drains the ring. Keep to the shade to keep your ×.', 'ring'],
  ...MECH_TIPS.snap.slice(2).map((t) => [...t, 'coldsnap'] as const),
  ['noon', 'In the Noon Heat a snap pours nothing: snap before 11 or after 1.', 'coldsnap'],
  ['glassSaved', GLASS_SAVED_TIP, 'brittle'],
  [...(MECH_TIPS.glass[0] as readonly [TipOn, string]), 'brittle'],
  ['soon', FLARE_SOON_TIP, 'flare'],
  ['scorch', 'Missed! The flare scorched your tank. A Cold Snap heals it.', 'flare'],
];
/** Lifetime runs under which endless and daily runs still get FIRST_TIPS. */
const NEW_PLAYER_RUNS = 12;
/** A bud this far ahead (u) counts as coming into view. */
const BUD_AHEAD = 260;

/** Mission progress is measured this often (ticks): ten times a second. */
const MISSION_EVERY = 6;
/** Shaded ticks after a slow burn before the COMEBACK lands (0.75 s), and the Chill that re-arms it. */
const COMEBACK_HOLD = 45;
const COMEBACK_REARM = 0.5;
const TIP_HOLD = 3.6;
const MISSION_HOLD = 2.6;

export interface MomentSinks {
  /** A mission step landed (play the claim cue and its haptic). */
  mission(): void;
  /** COMEBACK at Nubs' position. */
  comeback(x: number, y: number): void;
}

interface Tracked {
  def: MissionDef;
  target: number;
  label: string;
  hit: boolean;
}

export interface RunMoments {
  /**
   * A run begins. `scored`: the run will fold into the save (no debug params), so its mission steps
   * are real. Tips show on a Journey level from LEVEL_TIPS until it is passed.
   */
  begin(save: Save, level: LevelDef | null, scored: boolean, relaxed?: boolean): void;
  /** One tick's event (Session.onTickEvent). */
  onEvent(ev: SimEvent, s: SimState): void;
  /** Once per stepped frame, after the ticks. */
  update(s: SimState): void;
}

/** The run's moments, toasting into `banners` (closures, so the minifier shortens the state). */
export function createMoments(banners: Banners, sinks: MomentSinks): RunMoments {
  const tracked: Tracked[] = [];
  let done = 0;
  let total = 0;
  let lastCheck = 0;
  /** missionValue reads only `minutes` and `stats`: one reused probe instead of a RunResult per check. */
  const probe = { minutes: 0, stats: null as unknown as RunResult['stats'] };
  let tips: (readonly [TipOn, string, string?])[] = [];
  /** Looks for a bud ahead (only while a tip waits for one); v1.6: for a bud in reach under a snap, a glass window. */
  let budTip = false;
  let snapBudTip = false;
  let glassTip = false;
  let budAt = -1e9;
  /** Elementals v2: the last tick the walking element's moments were looked for. */
  let elAt = -1e9;
  const budBuf: Bud[] = [];
  let tipsShown = 0;
  let tipGlyph: string | null = null;
  /** The level whose goal tips apply (null outside the Journey and on a relaxed level: its goal is the finish). */
  let level: LevelDef | null = null;
  /** COMEBACK: armed by Chill under the PHEW line while lit, spent until Chill climbs back; the tick shade was found (-1 none). */
  let burn = false;
  let spent = false;
  let shadeAt = -1;

  /** The first flare's tip is still to show (a new player's endless run); the rise that ends it (−1 none). */
  let soonTip = false;
  let soonRise = -1;
  /** A missed flare scorched the tank (a snap or nightfall heals it); a charge filled under a snap (its tip waits for the end). */
  let scorched = false;
  let frostLater = false;

  /**
   * Shows the level's tip for `on` (an element's: `who`'s; `exact`: only those whose third field is
   * `who`, none or not), once per run (an `urgent` one ahead of any other toast).
   */
  const tip = (on: TipOn, hold = TIP_HOLD, urgent = false, who?: string, exact = false): void => {
    for (let i = 0; i < tips.length; i++) {
      const t = tips[i] as readonly [TipOn, string, string?];
      if (t[0] !== on || ((who || exact) && t[2] !== who) || (tipsShown & (1 << i)) !== 0) continue;
      tipsShown |= 1 << i;
      showToast(banners, 'tip', 'TIP', t[1], t[2] ?? tipGlyph, hold, urgent);
    }
  };

  /** Elementals v2: the walking element's moments (§7.11) in its window ahead (near..range u). */
  const elementTips = (s: SimState): void => {
    const h = s.nubs.hero;
    const E = TUNING.elements;
    let puddle = false;
    let weather = false;
    let rain = false;
    let stone = false;
    let plot = false;
    let wet = (s.el?.touch ?? 0) & 2;
    for (const o of s.el?.objs ?? []) {
      const d = o.y - s.nubs.y;
      if (d > E.range) break;
      if (d < E.near || o.state === 2) continue;
      const k = o.kind;
      if (k === 'puddle') puddle = true;
      else if (k === 'stone') stone = true;
      else if (k === 'plot') plot = true;
      else if (k === 'rain' || k === 'fog') {
        weather ||= o.awake;
        rain ||= k === 'rain';
      }
      wet |= o.light & 2;
    }
    const mine = (on: TipOn, now: boolean): void => {
      if (now) tip(on, TIP_HOLD, false, h);
    };
    mine('target', h === 'ember' ? burnTarget(s, NaN, 0) >= 0 : h === 'sprout' ? growTarget(s, NaN, 0) >= 0 : h === 'drip' ? puddle : weather);
    mine('low', elHealth(s) < 40);
    mine('water', h === 'ember' ? puddle || rain : wet !== 0);
    mine('stone', stone);
    mine('plot', plot);
  };

  return {
    begin(save, lv, scored, relaxed = false) {
      tracked.length = 0;
      done = total = lastCheck = tipsShown = 0;
      burn = spent = false;
      shadeAt = -1;
      level = relaxed ? null : lv;
      tips.length = 0;
      scorched = frostLater = false;
      const trial = lv ? trialDef(lv.id) : null;
      const fresh = lv !== null && !(trial ? save.elementals2?.stars[trial.n - 1] : save.campaign.stars[lv.id - 1]);
      if (fresh && trial) {
        // A Trial's tips until it is passed: the mixer's, the hand-offs', then each element's (its glyph and walker).
        tips.push(...(MIXER_TIPS[trial.n] ?? []), ...RELAY_TIPS);
        for (const x of trial.cast) for (const t of ELEMENT_TIPS[x]) tips.push([t[0], t[1], x]);
      } else if (fresh) tips.push(...(LEVEL_TIPS[lv.id] ?? []).map((t) => [t[0], withDare(t[1], lv)] as const));
      const mech = fresh && !trial ? mechanicOf(lv.introduces) : null;
      if (mech) tips.push(...MECH_TIPS[mech]);
      else if (!lv && save.stats.runs < NEW_PLAYER_RUNS) tips.push(...FIRST_TIPS);
      // Last, so it takes the place of the level's own 'go' tip.
      if (relaxed) tips.push(['go', SOFT_FAIL_TIP]);
      budTip = tips.some((t) => t[0] === 'bud');
      snapBudTip = tips.some((t) => t[0] === 'snapBud');
      glassTip = tips.some((t) => t[0] === 'glass');
      soonTip = tips.some((t) => t[0] === 'soon');
      soonRise = -1;
      budAt = elAt = -1e9;
      tipGlyph = trial ? trialGlyph(trial) : lv ? (lv.introduces ?? lv.concepts[0] ?? null) : null;
      // A Journey level toasts no mission steps before Missions open (they still pay at the end); a
      // Trial never does (it counts toward no mission).
      if (!scored || trial || (lv && !featureUnlocked(save, 'missions'))) return;
      for (const slot of save.missions.active) {
        const parsed = parseMissionId(slot.id);
        if (!parsed) continue;
        total++;
        if (slot.done) {
          done++;
          continue;
        }
        const { def, tier } = parsed;
        const target = missionTarget(def, tier);
        tracked.push({ def, target, label: `${missionLabel(def, tier)} · +${missionReward(def, tier)} Snow`, hit: slot.progress >= target });
      }
    },

    onEvent(ev, s) {
      switch (ev.e) {
        case 'death':
        case 'levelWon':
          endToasts(banners);
          tracked.length = 0;
          break;
        case 'go':
        case 'cloudCapture':
          tip(ev.e === 'go' ? 'go' : 'cloud');
          break;
        case 'tagSoon':
          // The first telegraph into Drip, into Gust, and into any other element each say their own.
          tip('tagSoon', TIP_HOLD, false, ev.to === 'drip' || ev.to === 'gust' ? ev.to : undefined, true);
          break;
        case 'tag':
          // An element's turn: the TAG's telegraph and the last element's tips are stale (dropped, on
          // screen or waiting, and its later ones spent, all but its 'tag' tip: Nubs' is for his second
          // leg); the walker's own 'tag' tip shows after the stamp.
          clearToasts(banners);
          for (let i = 0; i < tips.length; i++) {
            const t = tips[i] as readonly [TipOn, string, string?];
            if (t[2] === ev.from && t[0] !== 'tag') tipsShown |= 1 << i;
          }
          tip('tag', TIP_HOLD, false, ev.to);
          break;
        case 'flake':
          tip('flake');
          if (level && goalMetLive(level, s.stats)) tip('goal');
          break;
        case 'flakeMelt':
          if (level && !goalMetLive(level, s.stats)) tip('melt');
          break;
        case 'phew':
          // A PHEW already celebrates this dip.
          burn = false;
          spent = true;
          break;
        case 'shadeEnter':
          if (burn) shadeAt = s.tick;
          break;
        case 'shadeExit':
          shadeAt = -1;
          break;
        case 'bloom':
          tip('bloom');
          break;
        case 'frostReady':
          // Under a snap no swipe casts: the tip waits for its end.
          if (s.snapTicks > 0) frostLater = true;
          else tip('frost');
          break;
        case 'snapEnd':
          if (frostLater && s.nubs.frost >= 1) tip('frost');
          frostLater = false;
          break;
        case 'flareMiss':
          if (s.flareScorch > 0) {
            scorched = true;
            tip('scorch');
          }
          break;
        case 'nightStart':
          scorched = false;
          break;
        case 'snap':
          tip('snap');
          break;
        case 'deepEnter':
          tip('deep');
          break;
        case 'multUp':
          tip('mult');
          break;
        case 'multDown':
          if (ev.cause === 'bleed' && ev.from >= 3) tip('drop');
          break;
        case 'snapCash':
          // The gauge's tip on the first snap whatever it pours (a snap heals a scorch first of all).
          tip(scorched ? 'heal' : ev.hot === true ? 'hot' : ev.noon === true ? 'noon' : ev.amber === true ? 'amber' : 'cash');
          scorched = false;
          break;
        case 'clusterSaved':
          // Economy iteration 2: a saved glass cluster's frost waits for the next snap (the meter's chip).
          if (ev.brittle && s.glassBankH > 0) tip('glassSaved');
          break;
        default:
          break;
      }
    },

    update(s) {
      if (s.phase !== 'day') return;
      if (soonRise >= 0 && s.tickAbs >= soonRise) {
        // The rim has run out: the flare tip leaves now.
        soonRise = -1;
        endToast(banners, FLARE_SOON_TIP);
      }
      if (tips.length > 0) {
        const p = levelProgress(s);
        if (p >= 0.25) {
          tip('p25');
        }
        if (p >= 0.6) tip('p60');
        if (s.el !== null && s.tick - elAt >= MISSION_EVERY) {
          elAt = s.tick;
          elementTips(s);
        }
        if ((snapBudTip || glassTip) && s.tick - budAt >= MISSION_EVERY) {
          // v1.6: a bud in reach under a snap; a glass flake's window on the dial.
          if (snapBudTip && s.snapTicks > 0 && s.guide.bud.includes(1)) {
            snapBudTip = false;
            tip('snapBud');
          }
          if (glassTip && s.guide.flake?.includes(1)) {
            glassTip = false;
            tip('glass');
          }
        }
        if (soonTip) {
          // The first kept flare ahead: its tip FLARE_LEAD before the warning, held to the rise.
          const fl = s.world.flares;
          for (let i = Math.max(0, s.flareIdx); i < fl.length; i++) {
            const f = fl[i];
            if (!f || f.state !== FLARE_KEPT || f.riseTick <= s.tickAbs) continue;
            if (f.warnTick - s.tickAbs <= FLARE_LEAD) {
              soonTip = false;
              soonRise = f.riseTick;
              tip('soon', FLARE_TIP_MAX_S, true);
            }
            break;
          }
        }
        if (budTip && s.tick - budAt >= MISSION_EVERY && s.world.buds) {
          budAt = s.tick;
          const n = queryBuds(s.world, s.nubs.y + 20, s.nubs.y + BUD_AHEAD, budBuf);
          for (let i = 0; i < n; i++) {
            if ((budBuf[i] as Bud).state !== 0) continue;
            budTip = false;
            tip('bud');
            break;
          }
        }
      }
      const nb = s.nubs;
      // COMEBACK reads Nubs' Chill: never on a Trial (a hero's meter means something else).
      if (!s.lessonOn && s.trial === null) {
        // One COMEBACK per dip: after one, Chill climbs back over half before the next can arm.
        const high = nb.chill > COMEBACK_REARM * nb.maxChill;
        if (high) spent = false;
        if (nb.f > 0 && nb.chill < s.params.phewT && !spent) burn = true;
        else if (high && shadeAt < 0) burn = false;
        if (burn && shadeAt >= 0 && s.tick - shadeAt >= COMEBACK_HOLD && nb.f === 0) {
          burn = false;
          spent = true;
          shadeAt = -1;
          sinks.comeback(nb.x, nb.y);
        }
      }
      if (tracked.length === 0 || s.tick - lastCheck < MISSION_EVERY) return;
      lastCheck = s.tick;
      probe.minutes = s.minutes;
      probe.stats = s.stats;
      for (const m of tracked) {
        if (m.hit || missionValue(m.def, probe as unknown as RunResult) < m.target) continue;
        m.hit = true;
        done++;
        showToast(banners, 'mission', `${done >= total ? 'ALL MISSIONS' : 'MISSION'} ✓ ${done}/${total}`, m.label, null, MISSION_HOLD);
        sinks.mission();
      }
    },
  };
}
