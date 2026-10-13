// In-run moments (v1.4, docs/V1_4_PLAN.md §4 GAME): the toasts under the HUD when a mission step
// lands ("MISSION ✓ 2/3"), the first Journey levels' contextual tips, and the COMEBACK, a slow
// burn survived. Read-only on the save: mission progress is the save's active missions measured
// against the live run (meta missionValue); the meta layer still decides everything at the end.

import { levelProgress, type LevelDef, type RunResult, type SimEvent, type SimState } from '../core/index.ts';
import { missionLabel, missionReward, missionTarget, missionValue, parseMissionId } from '../meta/missions.ts';
import type { MissionDef } from '../meta/content.ts';
import type { Save } from '../meta/saveTypes.ts';
import { endToasts, showToast, type Banners } from '../render/banners.ts';
import { goalMetLive } from './campaign.ts';

/** When a tip shows: at go, at a share of the level, on the first flake, melt or cloud, at the goal. */
export type TipOn = 'go' | 'p25' | 'p60' | 'flake' | 'melt' | 'cloud' | 'goal';

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
    ['melt', 'One melted! Shade the next flakes early.'],
    ['goal', 'Goal done! Now bring Nubs home to the flag.'],
  ],
  3: [
    ['go', "Watch the sky: a cloud's shadow is shade too."],
    ['cloud', 'Cloud shade! It drifts on its own, so ride it while it lasts.'],
    ['p60', 'No shade close by? Swing the sun to reach the next shadow.'],
  ],
};

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
  begin(save: Save, level: LevelDef | null, scored: boolean): void;
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
  let tips: readonly (readonly [TipOn, string])[] = [];
  let tipsShown = 0;
  let tipGlyph: string | null = null;
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
    begin(save, lv, scored) {
      tracked.length = 0;
      done = total = lastCheck = tipsShown = 0;
      burn = spent = false;
      shadeAt = -1;
      level = lv;
      tips = lv && (save.campaign.stars[lv.id - 1] ?? 0) === 0 ? (LEVEL_TIPS[lv.id] ?? []) : [];
      tipGlyph = lv ? (lv.concepts[0] ?? null) : null;
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
