// Shared contract between the simulation (src/core) and its consumers (audio, UI, meta, render).
// The sim emits these; nothing else constructs SimEvents. Extend only additively.

export type HourGlyph = 'cool' | 'warm' | 'hot' | 'melt';

export type DeathCause = 'glare' | 'cloud' | 'gap' | 'plain';

export interface DeathInfo {
  day: number;
  tDay: number;
  /** Score in in-game minutes: (day-1)*720 + floor(720*tDay/Dl). */
  minutes: number;
  /** Exact clock of death, e.g. "12:07 PM". */
  time: string;
  /** World position of the puddle. */
  x: number;
  y: number;
  cause: DeathCause;
  /** Full death line, e.g. "Melted by You at 12:07 PM, between the Mossy Oak and the Little Hut." */
  line: string;
  lastId?: number;
  lastName?: string;
  nextId?: number;
  nextName?: string;
  ballId?: number;
}

export type SimEvent =
  | { e: 'start' }
  | { e: 'go' }
  | { e: 'detent'; dir: 1 | -1; index: number }
  | { e: 'catch'; omega: number }
  | { e: 'flake'; mult: number; degree: number; x: number; y: number; snow: number }
  | { e: 'crystal'; mult: number; x: number; y: number; snow: number }
  | { e: 'flower'; x: number; y: number; snow: number }
  | { e: 'flakeMelt'; x: number; y: number }
  | { e: 'shadeEnter'; litFor: number }
  | { e: 'shadeExit' }
  | { e: 'multUp'; level: number }
  | { e: 'multReset'; from: number }
  | { e: 'phew' }
  | { e: 'noonBanner' }
  | { e: 'noonPassed' }
  | { e: 'nightStart'; day: number }
  | { e: 'dawn'; day: number }
  | { e: 'cloudCapture'; id: number }
  | { e: 'glareTouch'; ballId: number }
  | { e: 'lowChill' }
  | { e: 'hourEnd'; day: number; hour: number; glyph: HourGlyph }
  | { e: 'gateArch'; noon: boolean }
  | { e: 'ballPassed'; clean: boolean }
  | { e: 'death'; info: DeathInfo };

export type SimEventName = SimEvent['e'];

export interface RunStats {
  flakes: number;
  flakesMelted: number;
  crystals: number;
  flowers: number;
  phews: number;
  snow: number;
  maxMult: number;
  /** Longest continuous time at x5 (s). */
  x5HoldBest: number;
  /** Longest continuous time fully shaded by a single cloud (s). */
  cloudRideBest: number;
  /** Total seconds with a cloud providing the shade. */
  cloudSeconds: number;
  ballsPassedClean: number;
  ballGlared: boolean;
  /** Walked under a gate arch between 11:00 AM and 1:00 PM. */
  gateNoon: boolean;
  /** Highest day reached (1-based). Reaching night of day N counts as day N. */
  dayReached: number;
  /** Nights survived (number of dawns after the first). */
  nightsReached: number;
  minutes: number;
  /** Total integral of f over daylight (s). */
  litTotal: number;
}

export type RunMode = 'endless' | 'daily' | 'challenge';

export interface RunResult {
  mode: RunMode;
  seed: number;
  dailyDate?: string;
  profile: 0 | 1 | 2 | 3;
  minutes: number;
  day: number;
  /** "Day 2 · 2:40 PM" (exact minutes). */
  clock: string;
  stats: RunStats;
  death: DeathInfo;
  /** One array per day reached; 12 entries for complete days, fewer for the final day (ending in 'melt'). */
  hourGlyphs: HourGlyph[][];
  /** Pentatonic degrees of flake pickups (max 32), filled by the session for the results melody. */
  melody: number[];
  /** True when the guide was forced on via settings ("Always"). */
  assisted: boolean;
}
