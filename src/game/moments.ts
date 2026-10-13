// In-run moments (v1.4, docs/V1_4_PLAN.md §4 GAME): the toasts under the HUD when a mission step
// lands ("MISSION ✓ 2/3"), the first Journey levels' contextual tips, and the COMEBACK, a slow
// burn survived. Read-only on the save: mission progress is the save's active missions measured
// against the live run (meta missionValue); the meta layer still decides everything at the end.

import { levelProgress, type LevelDef, type RunResult, type SimEvent, type SimState } from '../core/index.ts';
import { missionLabel, missionReward, missionTarget, missionValue, parseMissionId } from '../meta/missions.ts';
import type { MissionDef } from '../meta/content.ts';
import type { Save } from '../meta/saveTypes.ts';
import { showToast, type Banners } from '../render/banners.ts';
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
const TIP_HOLD = 4.2;
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

export class RunMoments {
  private readonly banners: Banners;
  private readonly sinks: MomentSinks;
  private readonly tracked: Tracked[] = [];
  private done = 0;
  private total = 0;
  private lastCheck = 0;
  /** missionValue reads only `minutes` and `stats`: one reused probe instead of a RunResult per check. */
  private readonly probe = { minutes: 0, stats: null as unknown as RunResult['stats'] };
  private tips: readonly (readonly [TipOn, string])[] = [];
  private tipsShown = 0;
  private tipGlyph: string | null = null;
  private level: LevelDef | null = null;
  /** COMEBACK: armed by Chill under the PHEW line while lit; the tick shade was found (−1 none). */
  private burn = false;
  private shadeAt = -1;

  constructor(banners: Banners, sinks: MomentSinks) {
    this.banners = banners;
    this.sinks = sinks;
  }

  /**
   * A run begins. `scored`: the run will fold into the save (no debug params), so its mission steps
   * are real. Tips show on a Journey level from LEVEL_TIPS until it is passed.
   */
  begin(save: Save, level: LevelDef | null, scored: boolean): void {
    this.tracked.length = 0;
    this.done = 0;
    this.total = 0;
    this.lastCheck = 0;
    this.burn = false;
    this.shadeAt = -1;
    this.level = level;
    this.tipsShown = 0;
    this.tips = level && (save.campaign.stars[level.id - 1] ?? 0) === 0 ? (LEVEL_TIPS[level.id] ?? []) : [];
    this.tipGlyph = level ? (level.concepts[0] ?? null) : null;
    if (!scored) return;
    for (const slot of save.missions.active) {
      const parsed = parseMissionId(slot.id);
      if (!parsed) continue;
      this.total++;
      if (slot.done) {
        this.done++;
        continue;
      }
      const target = missionTarget(parsed.def, parsed.tier);
      this.tracked.push({ def: parsed.def, target, label: `${missionLabel(parsed.def, parsed.tier)} · +${missionReward(parsed.def, parsed.tier)} Snow`, hit: slot.progress >= target });
    }
  }

  /** One tick's event (Session.onTickEvent). */
  onEvent(ev: SimEvent, s: SimState): void {
    switch (ev.e) {
      case 'go':
        this.tip('go');
        break;
      case 'flake':
        this.tip('flake');
        if (this.level && goalMetLive(this.level, s.stats)) this.tip('goal');
        break;
      case 'flakeMelt':
        if (this.level && !goalMetLive(this.level, s.stats)) this.tip('melt');
        break;
      case 'cloudCapture':
        this.tip('cloud');
        break;
      case 'phew':
        // A PHEW already celebrates this dip.
        this.burn = false;
        break;
      case 'shadeEnter':
        if (this.burn) this.shadeAt = s.tick;
        break;
      case 'shadeExit':
        this.shadeAt = -1;
        break;
      default:
        break;
    }
  }

  /** Once per stepped frame, after the ticks. */
  update(s: SimState): void {
    if (s.phase !== 'day') return;
    if (this.level && this.tips.length > 0) {
      const p = levelProgress(s);
      if (p >= 0.25) this.tip('p25');
      if (p >= 0.6) this.tip('p60');
    }
    const nb = s.nubs;
    if (!s.lessonOn) {
      if (nb.f > 0 && nb.chill < s.params.phewT) this.burn = true;
      else if (nb.chill > COMEBACK_REARM * nb.maxChill && this.shadeAt < 0) this.burn = false;
      if (this.burn && this.shadeAt >= 0 && s.tick - this.shadeAt >= COMEBACK_HOLD && nb.f === 0) {
        this.burn = false;
        this.shadeAt = -1;
        this.sinks.comeback(nb.x, nb.y);
      }
    }
    if (this.tracked.length === 0 || s.tick - this.lastCheck < MISSION_EVERY) return;
    this.lastCheck = s.tick;
    this.probe.minutes = s.minutes;
    this.probe.stats = s.stats;
    for (const m of this.tracked) {
      if (m.hit || missionValue(m.def, this.probe as unknown as RunResult) < m.target) continue;
      m.hit = true;
      this.done++;
      const all = this.done >= this.total;
      showToast(this.banners, 'mission', `${all ? 'ALL MISSIONS' : 'MISSION'} ✓ ${this.done}/${this.total}`, m.label, null, MISSION_HOLD);
      this.sinks.mission();
    }
  }

  /** Shows the level's tip for `on`, once per run. */
  private tip(on: TipOn): void {
    for (let i = 0; i < this.tips.length; i++) {
      const bit = 1 << i;
      const t = this.tips[i] as readonly [TipOn, string];
      if (t[0] !== on || (this.tipsShown & bit) !== 0) continue;
      this.tipsShown |= bit;
      showToast(this.banners, 'tip', 'TIP', t[1], this.tipGlyph, TIP_HOLD);
    }
  }
}
