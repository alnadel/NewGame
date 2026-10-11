// Persistent save schema (v1). Owned by src/meta/save.ts; read by game/session and ui.

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
}

export interface SaveStats {
  runs: number;
  bestMinutes: number;
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
}

export interface MissionSlot {
  id: string;
  progress: number;
  done: boolean;
}

export interface DailyEntry {
  tries: number;
  bestMinutes: number;
  bestSnow: number;
  /** Share glyph strip of the best try. */
  glyphs: string;
}

export interface SaveV1 {
  v: 1;
  createdAt: number;
  settings: Settings;
  stats: SaveStats;
  unlocks: { cosmetics: string[]; achievements: string[] };
  equipped: { scarf: string; hat: string; nose: string };
  missions: { cursor: number; tier: number; active: MissionSlot[] };
  /** Keyed by local date YYYY-MM-DD; pruned to the latest 60. */
  daily: Record<string, DailyEntry>;
  flags: {
    hintsShown: number;
    /** TECH_SPEC §12: the first lesson (the ghost hint that slows time until a successful swing) was passed. */
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
