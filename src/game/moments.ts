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
// the glass and the flare tips too. A level whose goal was relaxed (the soft-fail) says so at go.

import { levelProgress, queryBuds, type Bud, type LevelDef, type RunResult, type SimEvent, type SimState } from '../core/index.ts';
import { missionLabel, missionReward, missionTarget, missionValue, parseMissionId } from '../meta/missions.ts';
import type { MissionDef } from '../meta/content.ts';
import type { Save } from '../meta/saveTypes.ts';
import { endToasts, showToast, type Banners } from '../render/banners.ts';
import { goalMetLive } from './campaign.ts';
import { mechanicOf, type Mechanic } from './mechanics.ts';

/** When a tip shows: at go, at a share of the level, on the first flake, melt or cloud, at the goal. */
export type TipOn = 'go' | 'p25' | 'p60' | 'flake' | 'melt' | 'cloud' | 'goal' | 'bud' | 'bloom' | 'frost' | 'snap' | 'deep' | 'mult' | 'drop' | 'cash' | 'snapBud' | 'glass' | 'warn';

/**
 * Contextual tips for the first Journey levels, shown on each try until the level is passed. Level
 * 1's lesson (the ghost hand and the cue line) teaches the drag itself, so its tips come later.
 */
export const LEVEL_TIPS: Readonly<Record<number, readonly (readonly [TipOn, string])[]>> = {
  1: [
    ['p25', 'The bar up top fills as Nubs nears the finish flag.'],
    ['flake', 'Flakes are Snow. Three of them earn the second star!'],
    ['p60', 'Little time in the sun earns the third star: a cool run.'],
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

/**
 * v1.5: the tips of the level that teaches each mechanic. 'bud' shows when a closed bud comes into
 * view ahead, 'bloom' on the first bloom, 'frost' when the meter is full, 'snap' on the first Cold
 * Snap, 'deep' on the first deep shade.
 */
export const MECH_TIPS: Readonly<Record<Mechanic, readonly (readonly [TipOn, string])[]>> = {
  bud: [
    ['bud', 'A bud! Shine the sun from its gold mark to grow it. Gold on the dial grows it too.'],
    ['bloom', 'Bloomed! A third of a snap of frost, and shade for the rest of the run.'],
    ['p60', 'Where gold meets teal, one angle keeps Nubs cool and grows the bud.'],
  ],
  snap: [
    ['go', 'Sunflowers fill the frost. A full pip? Swipe down.'],
    ['frost', 'A pip is full! Swipe down, press ↓ or tap it: a snap pours your ring into the frost.'],
    ['snapBud', 'The frost has you. The sun is free: grow a bud!'],
    ['cash', 'Your ring poured into the frost.'],
  ],
  deep: [
    ['go', 'Two shadows over Nubs at once is deep shade: Chill and the ring fill twice as fast.'],
    ['deep', 'Deep shade! The dark band on the teal means double cool. Hunt the overlaps.'],
  ],
  glass: [['glass', 'Glass flakes melt fast. The white arc saves them, if you can spare the sun.']],
  flare: [['warn', 'A Heat Flare! When the orange rim runs out, shadows snap shorter: slide to the frost-rimmed shade first.']],
};

/** The soft-fail's tip at go (a level whose goal was missed twice). */
export const SOFT_FAIL_TIP = 'Goal eased: just reach the finish. The Dare still earns its star.';

/** Tips for the mechanics' moments in a new player's endless and daily runs (the cue line says how to snap). */
const FIRST_TIPS = [
  MECH_TIPS.bud[0],
  MECH_TIPS.deep[1],
  ['drop', 'Idle sun drains the ring. Keep to the shade to keep your ×.'],
  MECH_TIPS.snap[2],
  MECH_TIPS.snap[3],
  MECH_TIPS.glass[0],
  MECH_TIPS.flare[0],
] as const;
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
  let tips: (readonly [TipOn, string])[] = [];
  /** Looks for a bud ahead (only while a tip waits for one); v1.6: for a bud in reach under a snap, a glass window. */
  let budTip = false;
  let snapBudTip = false;
  let glassTip = false;
  let budAt = -1e9;
  const budBuf: Bud[] = [];
  let tipsShown = 0;
  let tipGlyph: string | null = null;
  /** The level whose goal tips apply (null outside the Journey and on a relaxed level: its goal is the finish). */
  let level: LevelDef | null = null;
  /** COMEBACK: armed by Chill under the PHEW line while lit, spent until Chill climbs back; the tick shade was found (-1 none). */
  let burn = false;
  let spent = false;
  let shadeAt = -1;

  /** Shows the level's tip for `on`, once per run. */
  const tip = (on: TipOn): void => {
    for (let i = 0; i < tips.length; i++) {
      const t = tips[i] as readonly [TipOn, string];
      if (t[0] !== on || (tipsShown & (1 << i)) !== 0) continue;
      tipsShown |= 1 << i;
      showToast(banners, 'tip', 'TIP', t[1], tipGlyph, TIP_HOLD);
    }
  };

  return {
    begin(save, lv, scored, relaxed = false) {
      tracked.length = 0;
      done = total = lastCheck = tipsShown = 0;
      burn = spent = false;
      shadeAt = -1;
      level = relaxed ? null : lv;
      tips.length = 0;
      const fresh = lv !== null && (save.campaign.stars[lv.id - 1] ?? 0) === 0;
      if (fresh) tips.push(...(LEVEL_TIPS[lv.id] ?? []));
      const mech = fresh ? mechanicOf(lv.introduces) : null;
      if (mech) tips.push(...MECH_TIPS[mech]);
      else if (!lv && save.stats.runs < NEW_PLAYER_RUNS) tips.push(...(FIRST_TIPS as readonly (readonly [TipOn, string])[]));
      // Last, so it takes the place of the level's own 'go' tip.
      if (relaxed) tips.push(['go', SOFT_FAIL_TIP]);
      budTip = tips.some((t) => t[0] === 'bud');
      snapBudTip = tips.some((t) => t[0] === 'snapBud');
      glassTip = tips.some((t) => t[0] === 'glass');
      budAt = -1e9;
      tipGlyph = lv ? (lv.introduces ?? lv.concepts[0] ?? null) : null;
      if (!scored) return;
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
          tip('frost');
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
          if (ev.refundH > 0) tip('cash');
          break;
        case 'flareWarn':
          tip('warn');
          break;
        default:
          break;
      }
    },

    update(s) {
      if (s.phase !== 'day') return;
      if (tips.length > 0) {
        const p = levelProgress(s);
        if (p >= 0.25) tip('p25');
        if (p >= 0.6) tip('p60');
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
      if (!s.lessonOn) {
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
