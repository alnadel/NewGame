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
 * The eight trials (§3), in n order, each pinned by `node scripts/sim.ts --trials --pick <n>` with
 * the gates it measured (§3.9-§3.10; G4 is humanDial's passes of 16, G6 the Dare's share of the 24
 * G3 + G4 runs). Calibration beyond §3.10, recorded in the CORE report: the drain also rises (2 at a
 * time) where a trial was too easy for G4/G5 at the spec's drain on every salt surveyed (T1, T4, T5,
 * T6, T8); T4 has no 'flurry' (its 7-flake ice-cube clusters froze every bot on every salt); gates
 * no salt can reach are waived per trial in scripts/sim16/trials.ts GATE_WAIVERS.
 */
export const TRIALS: readonly TrialDef[] = Object.freeze([
  // T1: salt 0; start 330 → 390 (§3.10, two steps), drain 26 → 40 (G5 failed and humanDial passed
  // 16/16 on 40 of 40 salts at 26). G1 margin 61/20 · G2 pass h60 · G5 idle 66%, best θ200 93% ·
  // G3 8/8 · G4 14/16 · G6 33%.
  trial(1, 'Kindling', 7, 0, 'meadow', 'dazzle', ['giants'], 390, 270, 40, ['ember'], [], null, PLAIN, { kind: 'blazeSave', target: 60 }, 40, [],
    'EMBER · Fire', 'Ember feeds on light and shade snuffs it. Swipe down to BLAZE through a shadow.', ['Blaze 1 s', 'Heat ≥ 40'],
    FINISH, undefined, undefined, 'Dare · Blaze through shade 1 s'),
  // T2: salt 0 → 6, concepts ['giants'] → [] (with giants one constant angle passed, and no §3.10
  // lever restored G5 inside humanDial's band); drain 24 → 18 (§3.10: humanDial 0-13% on every salt
  // at 24); Dare blooms 2 → 5 (§3.10 nudges: 79% at 2, 3 and 4). G1 margin 93/20 · G2 pass h90 ·
  // G5 idle 54%, best θ260 96% · G3 8/8 · G4 10/16 · G6 58%.
  trial(2, 'Dappled Lane', 15, 6, 'meadow', 'clear', [], 120, 300, 18, ['sprout'], [], null, BUDS, { kind: 'blooms', target: 5 }, 40, [],
    'SPROUT · Leaf', 'Sprout feeds on the edge of a shadow. Swipe down to SEED a sunflower.', ['Bloom 5', 'Sap ≥ 40']),
  // T3: salt 0, as specified. G1 none (Volt) · G2 striker pass h87 · G5 idle 76%, best θ120 98% ·
  // G3 8/8 · G4 waived (16/16) · G6 50%.
  trial(3, 'Thunder Alley', 8, 0, 'oldtown', 'clear', ['dense'], 180, 300, 26, ['volt'], [], null, PLAIN, { kind: 'chain', target: 5 }, 35, [],
    'VOLT · Storm', 'Volt must strike NEW shade, 40° from the last. Swipe down: THUNDERCLAP.', ['Chain x5', 'Spark ≥ 35']),
  // T4: salt 0; no 'flurry'; drain 24 → 36 (without flurry a constant angle passed on 10 of 10
  // salts at 24); Dare calm 720 → 1140 ticks (§3.10 nudges: 83% at 12 s, 71% at 15 s). G1 margin
  // 29/20 · G2 pass h21 · G5 idle 88%, best θ220 89% · G3 8/8 · G4 12/16 · G6 29%.
  trial(4, 'Steam and Frost', 11, 0, 'meadow', 'breezy', [], 240, 300, 36, ['drip'], [], null, PLAIN, { kind: 'calm', target: 1140 }, 40, [],
    'DRIP · Water', 'Sun warms Drip and shade cools it. Keep the needle off both ends.', ['Calm 19 s', 'Temp 20-80']),
  // T5: salt 0; drain 26 → 40 (G5 passed on 2 of 40 salts at 26, humanDial 16/16). G1 margin 58/20 ·
  // G2 pass h58 · G5 idle 8%, best θ330 73% · G3 8/8 · G4 12/16 · G6 waived (67%: 2 is every TAG).
  trial(5, 'Day Shift', 2, 0, 'oldtown', 'clear', [], 120, 480, 40, ['nubs', 'ember'], [{ minute: 300, to: 'ember' }, { minute: 480, to: 'nubs' }], null, PLAIN,
    { kind: 'cleanTags', target: 2 }, 35, [1],
    'NUBS ▸ EMBER ▸ NUBS', 'Ember takes over at 11\u00a0AM, Nubs at 2\u00a0PM. Flip the sun at every TAG.', ['2 clean TAGs', 'All ≥ 35']),
  // T6: salt 2; drain 18 → 32 (G5 failed on 40 of 40 salts at 18, humanDial 16/16); the duo snap
  // smothers Ember at snapSmother. G1 margin 79/15 · G2 pass h83 · G5 idle 37%, best θ320 87% ·
  // G3 8/8 · G4 13/16 · G6 46%.
  trial(6, 'Fire and Ice', 9, 2, 'meadow', 'clear', ['giants'], 180, 240, 32, ['nubs', 'ember'], [], { left: 'nubs', right: 'ember', ability: 'nubs' }, PLAIN,
    { kind: 'harmony', target: 180 }, 30, [1],
    'NUBS + EMBER', 'Nubs wants shade, Ember wants light. Split one shadow between them.', ['Harmony 3 s', 'Both ≥ 30'], FINISH, 'Finish with both'),
  // T7: salt 3 → 6, concepts ['dense'] → [] (with dense one constant angle passed). G1 margin
  // 92/15 · G2 pass h94 · G5 idle 39%, best θ20 80% · G3 8/8 · G4 9/16 · G6 13%.
  trial(7, 'Shade Garden', 5, 6, 'meadow', 'clear', [], 120, 240, 20, ['nubs', 'sprout'], [], { left: 'nubs', right: 'sprout', ability: 'sprout' }, BUDS,
    { kind: 'harmony', target: 240 }, 30, [2],
    'NUBS + SPROUT', 'Shade for Nubs, the edge for Sprout. Blooms grow shade for both.', ['Harmony 4 s', 'Both ≥ 30'],
    { kind: 'blooms', target: 2 }, 'Bloom 2 buds', 'Bloom 2'),
  // T8: salt 31; drain 24 → 32 (G5 failed on 40 of 40 salts at 24). G1 margin 60/20 · G2 pass h26 ·
  // G5 idle 14%, best θ140 79% · G3 8/8 · G4 8/16 · G6 42%.
  trial(8, 'Five Elements', 17, 31, 'meadow', 'breezy', [], 60, 600, 32, ['sprout', 'nubs', 'ember', 'drip', 'volt'],
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
