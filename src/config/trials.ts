// Elementals v2 (docs/ELEMENTALS_V2.md §5, §7.3): the seven Elemental Trials (ids 1001..1007), kept
// apart from the 200-level Journey. A trial's world is the one the generator builds for the LevelDef
// that trialLevel() makes of it; the cast, relays and objects are the trial's own and never part of
// a world (core/sim/elements.ts places the objects at run creation).

import { levelDef, type LevelDef, type LevelStats, type Mechanics } from './campaign.ts';
import type { ConceptId } from './concepts.ts';
import type { BiomeId } from './days.ts';
import type { ForecastId } from './forecasts.ts';
import type { HeroId } from './heroes.ts';
import { hashString } from './rng.ts';

export const TRIAL_BASE = 1000;
export const TRIAL_COUNT = 7;
/** 1001..1007. */
export const TRIAL_IDS: readonly number[] = /* @__PURE__ */ Object.freeze([1001, 1002, 1003, 1004, 1005, 1006, 1007]);
export type TrialDareKind = 'burns' | 'drinks' | 'trees' | 'grove' | 'cloudRide';

/** Trial object kinds (§3.1); EL_KINDS order is the hash index. */
export type ElKind = 'bramble' | 'gate' | 'ice' | 'gap' | 'stream' | 'plot' | 'puddle' | 'stone' | 'rain' | 'fog';
export const EL_KINDS: readonly ElKind[] = /* @__PURE__ */ Object.freeze(['bramble', 'gate', 'ice', 'gap', 'stream', 'plot', 'puddle', 'stone', 'rain', 'fog'] as ElKind[]);

/** One authored object (§5.0). */
export interface ElPlace {
  readonly k: ElKind;
  /** The in-game minute at which the walker reaches its y. */
  readonly m: number;
  /** Lateral offset from the trail centre (u, + east); weather: at waking. 0 for walls and crossings. */
  readonly dx: number;
  /** Crossings: half-length along y (12-18); weather: rx. Omitted: the kind's TUNING radius. */
  readonly r?: number;
  /** Weather drift (u/s, + east). */
  readonly drift?: number;
}

export interface TrialRelay { readonly minute: number; readonly to: HeroId }

/** Per-trial calibration levers (§6.5); defaults { legStart: [], costMul: 1, evapMul: 1 }. */
export interface TrialTune {
  /** Start meter per leg index; 0 or absent = the element's TUNING start. */
  readonly legStart: readonly number[];
  /** Scales Ember's tap costs and Gust's swipe cost on this Trial (0.8..1.2). */
  readonly costMul: number;
  /** Scales Drip's evaporation on this Trial (0.8..1.2). */
  readonly evapMul: number;
}

export interface TrialDef {
  readonly id: number;            // 1000 + n
  readonly n: number;             // 1..7
  readonly name: string;
  readonly chapter: number;       // theme, air and music palette (same biome)
  readonly salt: number;          // seed = hashString(`trial-${id}-${salt}`)
  readonly seed: number;
  readonly biome: BiomeId;
  readonly forecast: ForecastId;  // 'clear' on every v2 Trial
  readonly concepts: readonly ConceptId[];  // [] on every v2 Trial
  readonly startMinute: number;
  readonly lengthMinutes: number;
  /** Nubs' drain on this Trial. */
  readonly drain: number;
  /** Elements in order of first appearance; cast[0] walks first. */
  readonly cast: readonly HeroId[];
  readonly relays: readonly TrialRelay[];
  /** The element this Trial introduces (its ghost gesture and intro tips), or null. */
  readonly intro: HeroId | null;
  /** Constant wind (u/s, + east) under Gust's (§3.6). */
  readonly breeze: number;
  readonly objects: readonly ElPlace[];
  readonly tune: TrialTune;
  readonly mech: Mechanics;       // { buds: false, snap: true, deep: false, brittle: false }
  readonly goal: { readonly kind: 'finish'; readonly target: 0 };
  readonly dare: { readonly kind: TrialDareKind; readonly target: number };
  /** Star 3: the lowest steady health of any life meter never below this. */
  readonly steady: number;
  /** Trial numbers that must be passed (stars > 0) before this one opens. */
  readonly requires: readonly number[];
  /** Intro card words (§10.2). */
  readonly card: { readonly chip: string; readonly blurb: string; readonly goal: string; readonly stars: readonly [string, string, string]; readonly dare: string };
}

/** Every trial: the Cold Snap slot on; buds, deep shade and glass off. */
const MECH: Mechanics = Object.freeze({ buds: false, snap: true, deep: false, brittle: false });
const FINISH = Object.freeze({ kind: 'finish', target: 0 } as const);
const TUNE: TrialTune = Object.freeze({ legStart: Object.freeze([]), costMul: 1, evapMul: 1 });
/** The object codes of the authoring strings (below). */
const CODE: Readonly<Record<string, ElKind>> = { b: 'bramble', g: 'gate', i: 'ice', x: 'gap', s: 'stream', p: 'plot', u: 'puddle', t: 'stone', r: 'rain', f: 'fog' };

/**
 * A trial's objects, authored as space-separated `<code><m>[:dx[:r[:drift]]]` entries (codes: b
 * bramble, g gate, i ice, x gap, s stream, p plot, u puddle, t stone, r rain, f fog): "u189:-18" is
 * a puddle at minute 189, 18 u west; "x408:0:12" a gap of r 12; "r312:-100:55:20" a rain cloud
 * waking 100 u west, rx 55, drifting 20 u/s east.
 */
function objects(src: string): readonly ElPlace[] {
  return Object.freeze(
    src.split(' ').map((e) => {
      const [m, dx, r, drift] = e.slice(1).split(':').map(Number) as [number, number?, number?, number?];
      const o: { k: ElKind; m: number; dx: number; r?: number; drift?: number } = { k: CODE[e[0] as string] as ElKind, m, dx: dx ?? 0 };
      if (r !== undefined) o.r = r;
      if (drift !== undefined) o.drift = drift;
      return Object.freeze(o);
    }),
  );
}

/**
 * One trial (§5). Every run starts with Nubs, so the cast is Nubs then each relay's newcomer in order,
 * and the card's chip names the walkers in order ("NUBS ▸ EMBER ▸ NUBS") unless `chip` is given; the
 * card's goal is "Reach the finish", its first star "Finish" and its third "All ≥ <steady>".
 */
function trial(
  n: number,
  name: string,
  chapter: number,
  biome: BiomeId,
  startMinute: number,
  lengthMinutes: number,
  drain: number,
  breeze: number,
  relays: readonly (readonly [number, HeroId])[],
  intro: HeroId | null,
  src: string,
  dare: readonly [TrialDareKind, number],
  steady: number,
  requires: readonly number[],
  blurb: string,
  star: string,
  dareLine: string,
  chip = '',
  salt = 0,
  tune: Partial<TrialTune> = TUNE,
): TrialDef {
  const id = TRIAL_BASE + n;
  const walkers: HeroId[] = ['nubs', ...relays.map((r) => r[1])];
  return Object.freeze({
    id, n, name, chapter, salt, seed: hashString(`trial-${id}-${salt}`), biome, forecast: 'clear', concepts: [], startMinute, lengthMinutes, drain,
    cast: [...new Set(walkers)], relays: relays.map(([minute, to]) => Object.freeze({ minute, to })), intro, breeze, objects: objects(src), tune: tune === TUNE ? TUNE : Object.freeze({ ...TUNE, ...tune }), mech: MECH,
    goal: FINISH, dare: { kind: dare[0], target: dare[1] }, steady, requires,
    card: Object.freeze({
      chip: chip || walkers.join(' ▸ ').toUpperCase(), blurb, goal: 'Reach the finish', stars: ['Finish', star, `All ≥ ${steady}`] as const, dare: `Dare · ${dareLine}`,
    }),
  });
}

/**
 * The seven trials (§5.1-§5.7), in n order, pinned by `node scripts/sim.ts --trials --pick <n>` (§6.5):
 * each pin's levers carry the gates measured on it (G1 audit margins per leg, G2 path low, G3
 * reactive wins, G4 humanEl passes, G5b best constant angle, G6 Dare share). The global pass moved
 * TUNING.elements first (tuning.ts).
 */
export const TRIALS: readonly TrialDef[] = Object.freeze([
  // T1 pin: salt 193; drain 28 → 34, Nubs' legs 100 → 80, Ember 80 → 70 and costMul 1.2 (each
  // lever set easier than this one was too easy: G5/G5b). Measured: G1 78/70/83, G2 low 70, G3 8/8, G4 14/16 (88%), G5c on sight
  // 11 vs 69, G5b best θ330 dies at 23%, G6 burns ≥ 7 33%.
  trial(1, 'Kindling', 7, 'meadow', 240, 400, 34, 0, [[340, 'ember'], [556, 'nubs']], 'ember',
    'b376 b405 t434 g448 b477 g506 b535 i580', ['burns', 7], 30, [],
    'Tap each wall just before Ember gets there. Light refuels the flame.', 'Burn all 7', 'Burn all 7 walls', '', 193, { legStart: [80, 70, 80], costMul: 1.2 }),
  // T2 pin: salt 187; drain 26 → 28; Drip 70 → 50 and evapMul 1.2 (G5b: the held sun at a constant
  // angle walked Drip's leg), Nubs' closing leg 100 → 80; Dare 6 → 7 (+17%; G6 above its band).
  // Measured: G1 100/28/74 (Drip marks: chosen 45° 50, worst 310° 28), G2 low 49 (worst bin 37), G3
  // 8/8, G4 15/16 (94%), G5b best θ340 dies at 99%, G6 drinks ≥ 7 88% (WAIVERS: every puddle is in
  // Drip's reach, so every finisher drinks them all).
  trial(2, 'Puddle Run', 5, 'meadow', 60, 400, 28, 0, [[160, 'drip'], [376, 'nubs']], 'drip',
    'u189:-18 t203:-4 u218:20 t232:10 u246:-8 t261:-20 u275:22 t290:14 u304 t318:-10 u333:-22 t344:24 u354:12', ['drinks', 7], 30, [],
    'Set the sun, then drag to steer Drip through shade and puddles. Dodge hot stones.', 'Drink 7', 'Drink all 7 puddles', '', 187, { legStart: [100, 50, 80], evapMul: 1.2 }),
  // T3 pin: salt 3292 (salts 0..199: 6 clear G0's plot clearance and none fails a constant sun
  // angle, so --pick ran past 199); drain 28 → 34 and Nubs' legs 100 → 80 (too easy); Sprout 80 → 100
  // (G6: no bot had Sap left for 2 trees). Measured: G1 76/3/83 (Sap low 3), G2 low 76, G3 8/8, G4
  // 12/16 (75%), G5b best θ130 dies at 19%, G6 trees ≥ 2 33%.
  trial(3, 'Green Bridge', 15, 'meadow', 240, 400, 34, 0, [[340, 'sprout'], [556, 'nubs']], 'sprout',
    'p369:44 x408:0:12 s450:0:14 p476:-44 x502:0:16 s530:0:12 p572:44 p586:-44 p600:44', ['trees', 2], 30, [],
    'Hold on the ground ahead: vines bridge gaps, trees shade Nubs. Sun speeds them.', 'Grow 2 trees', 'Grow 2 trees', '', 3292, { legStart: [80, 100, 80] }),
  trial(4, 'Weather Vane', 8, 'oldtown', 180, 400, 28, 0, [[280, 'gust'], [496, 'nubs']], 'gust',
    'r312:-100:55:20 f340:80:70:-12 r365:110:60:-24 r385:-150:55:0 f400:-90:80:14 r425:150:55:0 r440:-100:60:22 r465:100:65:-20 r520:-190:90:6', ['cloudRide', 60], 30, [],
    "Swipe to blow rain and fog off Gust's path. Each swipe costs Lift.", 'Rain ride 1 s', 'Ride a rain cloud 1 s'),
  trial(5, 'Steam', 11, 'meadow', 120, 504, 28, 0, [[216, 'ember'], [390, 'drip'], [564, 'nubs']], null,
    'b245 u270 r296:176:50:-48 g296 t320 b344 i372 i412 u425:-18 i436 t452:10 t474:-14 u492:18 t512:-4 u530:-16 t546:16', ['drinks', 4], 25, [1, 2],
    'Melt the ice for Drip: every puddle grows him. Puddles and rain douse Ember!', 'Drink 4', 'Drink 4 puddles'),
  trial(6, 'Rain Garden', 9, 'meadow', 150, 490, 28, 0, [[246, 'gust'], [390, 'sprout'], [576, 'nubs']], null,
    'f280:90:70:-14 r300:130:55:0 r312:-110:60:22 f352:-80:75:14 r360:-150:55:0 f402:60:70:-10 r414:120:85:6 p418:44 x464:0:14 s500:0:16 p520:-44 x545:0:16 p590:44 p606:-44 p620:44', ['trees', 3], 25, [3, 4],
    'Clear the fog for Sprout and blow the rain onto its path: rain feeds plants.', 'Grow 3 trees', 'Grow 3 trees'),
  trial(7, 'Five Elements', 17, 'meadow', 60, 600, 30, -16, [[156, 'gust'], [264, 'sprout'], [384, 'ember'], [498, 'drip'], [598, 'nubs']], null,
    'r186:125:55:-4 r206:120:55:16 f214:-110:70:30 r236:100:60:0 r248:-150:55:16 f276:-30:70:16 r288:150:80:8 p288:44 p330:-44 x338:0:14 s364:0:14 p410:-44 b413 p416:44 u428 r446:133:55:-24 g446 b468 t480 i522 u532:-18 i546 t556:12 u570:16 t582:-10', ['grove', 4], 25, [5, 6],
    'Five elements, one day. The breeze spreads fire west: keep four trees.', '4 trees standing', 'Keep 4 trees standing', 'ALL FIVE ELEMENTS'),
]);

/** True for an integer trial id 1001..1007. */
export function isTrialId(id: number | undefined): boolean {
  return id !== undefined && Number.isInteger(id) && id > TRIAL_BASE && id <= TRIAL_BASE + TRIAL_COUNT;
}

export function trialDef(id: number): TrialDef | null {
  return isTrialId(id) ? (TRIALS[id - TRIAL_BASE - 1] as TrialDef) : null;
}

const levelMemo: LevelDef[] = [];

/**
 * The LevelDef the world and the Results flow use (memoized): no Dares, flares or teaching, and a
 * flake and sun bar no run reaches, so the Journey's starsFor can never award a trial a star.
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
  return stats[kind] ?? 0;
}

/**
 * 0 when the goal is unmet, else 1..3 (the Journey's "2 of 3"): +1 for the Dare, +1 for Steady (the
 * lowest steady health of any life meter, stats.minChill on trials, never below `steady`).
 */
export function trialStars(t: TrialDef, stats: LevelStats, goalMet: boolean): 0 | 1 | 2 | 3 {
  if (!goalMet) return 0;
  const two = trialDareValue(t.dare.kind, stats) >= t.dare.target;
  const three = stats.minChill >= t.steady;
  return two && three ? 3 : two || three ? 2 : 1;
}
