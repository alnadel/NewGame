// Elementals (docs/ELEMENTALS.md §3, §4.3): the eight Elemental Trials (ids 1001..1008), kept apart
// from the 200-level Journey. A trial's world is the one the generator builds for the LevelDef that
// trialLevel() makes of it; the cast, relays and duo are the trial's own and never part of a world.

import { levelDef, type LevelDef, type LevelStats, type Mechanics } from './campaign.ts';
import type { ConceptId } from './concepts.ts';
import type { BiomeId } from './days.ts';
import type { ForecastId } from './forecasts.ts';
import type { HeroId } from './heroes.ts';
import { hashString } from './rng.ts';

export const TRIAL_BASE = 1000;
export const TRIAL_COUNT = 8;
/** 1001..1008. */
export const TRIAL_IDS: readonly number[] = Object.freeze([1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008]);
export type TrialDareKind = 'blazeSave' | 'blooms' | 'chain' | 'calm' | 'cleanTags' | 'harmony' | 'flakes';

export interface TrialRelay { readonly minute: number; readonly to: HeroId }
export interface TrialDuo { readonly left: HeroId; readonly right: HeroId; readonly ability: HeroId }

export interface TrialDef {
  readonly id: number;            // 1000 + n
  readonly n: number;             // 1..8
  readonly name: string;
  readonly chapter: number;       // theme, air and music palette (same biome)
  readonly salt: number;          // seed = hashString(`trial-${id}-${salt}`)
  readonly seed: number;
  readonly biome: BiomeId;
  readonly forecast: ForecastId;
  readonly concepts: readonly ConceptId[];
  readonly startMinute: number;
  readonly lengthMinutes: number;
  readonly drain: number;
  /** Walking order: cast[0] starts; a duo lists [left, right]. */
  readonly cast: readonly HeroId[];
  readonly relays: readonly TrialRelay[];
  readonly duo: TrialDuo | null;
  readonly mech: Mechanics;       // all four keys
  readonly goal: { readonly kind: 'finish' | 'blooms'; readonly target: number };
  readonly dare: { readonly kind: TrialDareKind; readonly target: number };
  /** Star 3: the lowest health of any body never below this. */
  readonly steady: number;
  /** Trial numbers that must be passed (stars > 0) before this one opens. */
  readonly requires: readonly number[];
  /** Intro card words (§6.2). */
  readonly card: { readonly chip: string; readonly blurb: string; readonly goal: string; readonly stars: readonly [string, string, string]; readonly dare: string };
}

/** Every trial: the Cold Snap slot on, deep shade and glass off; Sunflower buds on T2, T7 and T8 only. */
const PLAIN: Mechanics = Object.freeze({ buds: false, snap: true, deep: false, brittle: false });
const BUDS: Mechanics = Object.freeze({ buds: true, snap: true, deep: false, brittle: false });
const FINISH = Object.freeze({ kind: 'finish', target: 0 } as const);

/**
 * One trial. The card's goal defaults to "Reach the finish", its first star to "Finish" and its
 * Dare line to "Dare · " + the second star.
 */
function trial(
  n: number,
  name: string,
  chapter: number,
  salt: number,
  biome: BiomeId,
  forecast: ForecastId,
  concepts: readonly ConceptId[],
  startMinute: number,
  lengthMinutes: number,
  drain: number,
  cast: readonly HeroId[],
  relays: readonly TrialRelay[],
  duo: TrialDuo | null,
  mech: Mechanics,
  dare: TrialDef['dare'],
  steady: number,
  requires: readonly number[],
  chip: string,
  blurb: string,
  stars: readonly [string, string],
  goal: TrialDef['goal'] = FINISH,
  goalLine = 'Reach the finish',
  first = 'Finish',
  dareLine = `Dare · ${stars[0]}`,
): TrialDef {
  const id = TRIAL_BASE + n;
  return Object.freeze({
    id, n, name, chapter, salt, seed: hashString(`trial-${id}-${salt}`), biome, forecast, concepts, startMinute, lengthMinutes, drain,
    cast, relays, duo, mech, goal, dare, steady, requires,
    card: Object.freeze({ chip, blurb, goal: goalLine, stars: [first, stars[0], stars[1]] as const, dare: dareLine }),
  });
}

/**
 * The eight trials (§3), in n order. Salts are placeholders (0) until `sim --trials --pick` pins
 * them with their measured gates (§3.9-§3.10).
 */
export const TRIALS: readonly TrialDef[] = Object.freeze([
  trial(1, 'Kindling', 7, 0, 'meadow', 'dazzle', ['giants'], 330, 270, 26, ['ember'], [], null, PLAIN, { kind: 'blazeSave', target: 60 }, 40, [],
    'EMBER · Fire', 'Ember feeds on light and shade snuffs it. Swipe down to BLAZE through a shadow.', ['Blaze 1 s', 'Heat ≥ 40'],
    FINISH, undefined, undefined, 'Dare · Blaze through shade 1 s'),
  trial(2, 'Dappled Lane', 15, 0, 'meadow', 'clear', ['giants'], 120, 300, 24, ['sprout'], [], null, BUDS, { kind: 'blooms', target: 2 }, 40, [],
    'SPROUT · Leaf', 'Sprout feeds on the edge of a shadow. Swipe down to SEED a sunflower.', ['Bloom 2', 'Sap ≥ 40']),
  trial(3, 'Thunder Alley', 8, 0, 'oldtown', 'clear', ['dense'], 180, 300, 26, ['volt'], [], null, PLAIN, { kind: 'chain', target: 5 }, 35, [],
    'VOLT · Storm', 'Volt must strike NEW shade, 40° from the last. Swipe down: THUNDERCLAP.', ['Chain x5', 'Spark ≥ 35']),
  trial(4, 'Steam and Frost', 11, 0, 'meadow', 'breezy', ['flurry'], 240, 300, 24, ['drip'], [], null, PLAIN, { kind: 'calm', target: 720 }, 40, [],
    'DRIP · Water', 'Sun warms Drip and shade cools it. Keep the needle off both ends.', ['Calm 12 s', 'Temp 20-80']),
  trial(5, 'Day Shift', 2, 0, 'oldtown', 'clear', [], 120, 480, 26, ['nubs', 'ember'], [{ minute: 300, to: 'ember' }, { minute: 480, to: 'nubs' }], null, PLAIN,
    { kind: 'cleanTags', target: 2 }, 35, [1],
    'NUBS ▸ EMBER ▸ NUBS', 'Ember takes over at 11 AM, Nubs at 2 PM. Flip the sun at every TAG.', ['2 clean TAGs', 'All ≥ 35']),
  trial(6, 'Fire and Ice', 9, 0, 'meadow', 'clear', ['giants'], 180, 240, 18, ['nubs', 'ember'], [], { left: 'nubs', right: 'ember', ability: 'nubs' }, PLAIN,
    { kind: 'harmony', target: 180 }, 30, [1],
    'NUBS + EMBER', 'Nubs wants shade, Ember wants light. Split one shadow between them.', ['Harmony 3 s', 'Both ≥ 30'], FINISH, 'Finish with both'),
  trial(7, 'Shade Garden', 5, 0, 'meadow', 'clear', ['dense'], 120, 240, 20, ['nubs', 'sprout'], [], { left: 'nubs', right: 'sprout', ability: 'sprout' }, BUDS,
    { kind: 'harmony', target: 240 }, 30, [2],
    'NUBS + SPROUT', 'Shade for Nubs, the edge for Sprout. Blooms grow shade for both.', ['Harmony 4 s', 'Both ≥ 30'],
    { kind: 'blooms', target: 2 }, 'Bloom 2 buds', 'Bloom 2'),
  trial(8, 'Five Elements', 17, 0, 'meadow', 'breezy', [], 60, 600, 24, ['sprout', 'nubs', 'ember', 'drip', 'volt'],
    [{ minute: 180, to: 'nubs' }, { minute: 300, to: 'ember' }, { minute: 420, to: 'drip' }, { minute: 540, to: 'volt' }], null, BUDS,
    { kind: 'cleanTags', target: 4 }, 30, [1, 2, 3, 4],
    'SPROUT ▸ NUBS ▸ EMBER ▸ DRIP ▸ VOLT', 'Five heroes, one long day. Each takes the hour it loves.', ['4 clean TAGs', 'All ≥ 30']),
]);

/** True for an integer trial id 1001..1008. */
export function isTrialId(id: number | undefined): boolean {
  return id !== undefined && Number.isInteger(id) && id > TRIAL_BASE && id <= TRIAL_BASE + TRIAL_COUNT;
}

export function trialDef(id: number): TrialDef | null {
  return isTrialId(id) ? (TRIALS[id - TRIAL_BASE - 1] as TrialDef) : null;
}

const levelMemo: LevelDef[] = [];

/**
 * The LevelDef the world and the Results flow use (memoized; §3.0): no Dares, flares or teaching,
 * and a flake and sun bar no run reaches, so the Journey's starsFor can never award a trial a star.
 */
export function trialLevel(id: number): LevelDef | null {
  const t = trialDef(id);
  if (!t) return null;
  return (levelMemo[t.n] ??= Object.freeze({
    id: t.id,
    chapter: t.chapter,
    name: t.name,
    seed: t.seed,
    biome: t.biome,
    forecast: t.forecast,
    concepts: t.concepts,
    introduces: null,
    startMinute: t.startMinute,
    lengthMinutes: t.lengthMinutes,
    goal: t.goal,
    stars: Object.freeze({ flakes: 1e9, minChill: t.steady, sunSec: 1e9 }),
    drain: t.drain,
    feats: [],
    flares: [],
  }));
}

/** levelDef(id) ?? trialLevel(id). */
export function anyLevelDef(id: number): LevelDef | null {
  return levelDef(id) ?? trialLevel(id);
}

/** 'Trial 3' for trials, 'Level 12' otherwise (byte-identical to today's text for 1..200). */
export function levelTag(id: number): string {
  return isTrialId(id) ? `Trial ${id - TRIAL_BASE}` : `Level ${id}`;
}

/** 'T3' / 'L12' (the HUD pill). */
export function levelShort(id: number): string {
  return isTrialId(id) ? `T${id - TRIAL_BASE}` : `L${id}`;
}

/** What a trial Dare of `kind` counts in these stats (RunStats fields; a missing value is 0). */
export function trialDareValue(kind: TrialDareKind, stats: LevelStats): number {
  switch (kind) {
    case 'blazeSave':
      return stats.blazeTicks ?? 0;
    case 'blooms':
      return stats.blooms ?? 0;
    case 'chain':
      return stats.bestChain ?? 0;
    case 'calm':
      return stats.calmTicks ?? 0;
    case 'cleanTags':
      return stats.cleanTags ?? 0;
    case 'harmony':
      return stats.harmonyTicks ?? 0;
    case 'flakes':
      return stats.flakes;
  }
}

/**
 * 0 when the goal is unmet, else 1..3 (§3.0, the Journey's "2 of 3"): +1 for the Dare, +1 for
 * Steady (the lowest health of any body, stats.minChill on trials, never below `steady`).
 */
export function trialStars(t: TrialDef, stats: LevelStats, goalMet: boolean): 0 | 1 | 2 | 3 {
  if (!goalMet) return 0;
  const two = trialDareValue(t.dare.kind, stats) >= t.dare.target;
  const three = stats.minChill >= t.steady;
  return two && three ? 3 : two || three ? 2 : 1;
}
