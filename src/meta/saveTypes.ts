// Persistent save schema (v4: v2 of docs/V1_1_PLAN.md §5 CC-9, the Journey campaign of
// docs/CAMPAIGN_PLAN.md §5 (v3) and the v1.4 gamification of docs/V1_4_PLAN.md). Owned by
// src/meta/save.ts; read by game/session and ui. An older build reading a newer save sees 'future'
// and stays read-only.

import type { Feature } from './gamify.ts';

export interface Settings {
  /** 0..1, default 0.8 */
  sfx: number;
  /** 0..1, default 0.6 */
  music: number;
  haptics: boolean;
  /** 0.6..1.5, default 1.0 */
  sensitivity: number;
  invert: boolean;
  reducedMotion: 'auto' | 'on' | 'off';
  highContrast: boolean;
  guide: 'auto' | 'always' | 'off';
  /** Name on challenge links (challenge.ts sanitizeName); '' = none. */
  name: string;
  /** Adaptive comfort: endless runs climb or ease the comfort ladder (default on). */
  comfort: boolean;
  /** Testing: every Journey level is playable (default off). */
  unlockAll: boolean;
  /** Controls v3 (docs/CONTROLS_V3.md §8.1): aim help (§4.3; 'strong' marks the run assisted). */
  aim: 'standard' | 'strong' | 'light' | 'off';
  /** Swing Boost (§1.2), off by default. */
  swingBoost: boolean;
  /** The action button's side (§1.1). */
  hand: 'right' | 'left';
  /** Auto actions (§3.6): Ember and Sprout act on their own (marks the run assisted). */
  autoAct: boolean;
}

export interface SaveStats {
  runs: number;
  /** The best run at standard rules: endless runs at rung 4 (not the warm-up) and challenges. */
  bestMinutes: number;
  /**
   * The best endless run at eased rules: comfort rungs R1-R3, the warm-up run, and the first
   * BEST_FROM_RUNS runs (progression.ts), never the tutorial run (its Chill floor). Shown, marked
   * eased, where those rules are played.
   */
  easedBest: number;
  bestSnowRun: number;
  lifetimeSnow: number;
  wallet: number;
  phews: number;
  flakes: number;
  daysSurvived: number;
  maxDay: number;
  dailyDaysPlayed: number;
  cloudSeconds: number;
  /** True once any run has reached its first night. */
  reachedNight: boolean;
  /** Comfort rung of the next endless run, 0 (tutorial) .. 4 (standard). */
  comfort: number;
  playSeconds: number;
  swings: number;
  /** Weeks that closed with 5+ sunny days. */
  sunnyWeeks: number;
  /** Bit i: survived a noon under FORECAST_IDS[i]. */
  forecastNoons: number;
}

export interface MissionSlot {
  id: string;
  progress: number;
  done: boolean;
  /** Finished runs in a row without progress (the Swap button shows at 5). */
  stale: number;
}

/** The retired Today's errand (v1.1-v1.2), always empty now (save.ts emptyErrand). */
export interface ErrandState {
  date: string;
  id: string;
  progress: number;
  done: boolean;
}

/** A finished non-debug endless run: minutes, run Snow, comfort rung played (0..4), local date. */
export interface RunRecord {
  m: number;
  s: number;
  r: number;
  d: string;
  /** 1: the warm-up run after the climb to standard (r is 4, the rules were eased: days.ts STANDARD_WARMUP). */
  w?: 1;
}

export interface WeekState {
  /** Monday of the current week ('YYYY-MM-DD'), or '' before the first run. */
  start: string;
  /** Bit i: a run finished on start + i days. */
  days: number;
  /** Retired in v1.4 (the Sunny Week no longer pays Snow): kept for older builds reading the save. */
  paid: number;
  /** Best Day reached per weekday (Monday first). */
  best: number[];
}

export interface DailyEntry {
  tries: number;
  bestMinutes: number;
  bestSnow: number;
  /** Share glyph strip of the best try. */
  glyphs: string;
}

/** Journey campaign progress (docs/CAMPAIGN_PLAN.md §5). */
export interface CampaignState {
  /** Stars per level, index id − 1, 0..3 (0 = not passed); as long as the level table. */
  stars: number[];
  /** The highest playable level (1 on a fresh save; one past the last passed level). */
  unlocked: number;
  /** The last level played, 0 before any. */
  lastLevel: number;
  /**
   * v1.6 soft-fail (docs/V1_6_PLAN.md §2.6): goal misses per level (index id − 1; a run reached the
   * finish with its goal unmet). Two relax the level's goal to the finish. Absent until the first miss.
   */
  misses?: number[];
}

/**
 * Elementals v2 (docs/ELEMENTALS_V2.md): best stars per Trial (index n − 1, 7 entries, 0..3) and whether
 * the screen was opened. Absent until either; kept apart from the Journey's campaign, so no Journey
 * count sees a Trial.
 */
export interface Elementals2State {
  stars: number[];
  seen: boolean;
}

/** The 7-day daily reward calendar (meta/gamify.ts claimDaily). */
export interface StreakState {
  /** Local date of the last claim, or '' before the first. */
  last: string;
  /** Days claimed in a row (unbounded; the calendar shows ((days − 1) mod 7) + 1). */
  days: number;
  /** The longest run of days ever claimed. */
  best: number;
  /** This 7-day cycle's free missed day was used. */
  freezeUsed: boolean;
}

/** v1.4 gamification (docs/V1_4_PLAN.md, meta/gamify.ts). */
export interface GamifyState {
  /** Lifetime XP (the Sun Rank). */
  xp: number;
  /** Unopened Snow Globes. */
  globes: number;
  /** Snow Globes opened so far (seeds the next pick). */
  opened: number;
  /** Missions finished toward the next Snow Globe (0..2; the third pays it). */
  missionSet: number;
  streak: StreakState;
  /** Features unlocked by progress (sticky; the testing toggle opens the rest without storing them). */
  features: Feature[];
  /** Unlocked features whose button was seen since (no "NEW" ribbon). */
  seenFeatures: Feature[];
  /** Wardrobe items seen while owned or affordable (the rest show a "new" dot). */
  seenItems: string[];
  /** Achievements unlocked when the Profile was last opened. */
  seenTrophies: number;
}

export interface Save {
  v: 4;
  createdAt: number;
  settings: Settings;
  stats: SaveStats;
  unlocks: { cosmetics: string[]; achievements: string[] };
  equipped: { scarf: string; hat: string; nose: string; shades: string };
  missions: { cursor: number; tier: number; active: MissionSlot[]; deferred: string[]; errand: ErrandState };
  /** Keyed by local date YYYY-MM-DD; pruned to the latest 60. */
  daily: Record<string, DailyEntry>;
  /** Snowbot's par minutes per Daily date, the latest 14. */
  pars: Record<string, number>;
  /** The last 30 finished non-debug endless runs, oldest first. */
  history: RunRecord[];
  week: WeekState;
  campaign: CampaignState;
  /**
   * Elementals v2 Trials (absent on a save that never opened the screen or passed a Trial). v1's
   * `elementals` is dropped by sanitize: its Trials were replaced.
   */
  elementals2?: Elementals2State;
  gamify: GamifyState;
  /** Local date of the last finished run, or ''. */
  lastPlay: string;
  flags: {
    hintsShown: number;
    /** The first-run lesson was passed (the sim's lessonDone). */
    tutorialDone: boolean;
    installSheetShown: boolean;
    persistRequested: boolean;
    storageWarned: boolean;
    /**
     * Mission progress is in the polish-wave units ('hold-x5' = best multiplier level, not seconds
     * held at ×5). Always true once validated; saves without it are converted once on load.
     */
    missionsV2: boolean;
    /** Controls v3 (docs/CONTROLS_V3.md §6.1): the Cold Snap's first full meter was taught (ghost press, slow time). */
    snapTeach: boolean;
    /** Controls v3 (§6.1, §6.2): Nubs' aim-help tip (the first rescue capture) has shown. */
    settleTip: boolean;
  };
}
