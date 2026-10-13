// Persistent save schema (v3: v2 of docs/V1_1_PLAN.md §5 CC-9 plus the Journey campaign of
// docs/CAMPAIGN_PLAN.md §5). Owned by src/meta/save.ts; read by game/session and ui. An older build
// reading a newer save sees 'future' and stays read-only.

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

/** Today's errand: the same for everyone on a local date. */
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
  /** Paid rewards: bit 0 three days, bit 1 five, bit 2 seven. */
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
}

export interface Save {
  v: 3;
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
  };
}
