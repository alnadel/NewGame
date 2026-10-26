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
 * card's goal is "Reach the finish", its first star "Finish" and its third "Meters ≥ <steady>".
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
      chip: chip || walkers.join(' ▸ ').toUpperCase(), blurb, goal: 'Reach the finish', stars: ['Finish', star, `Meters ≥ ${steady}`] as const, dare: `Dare · ${dareLine}`,
    }),
  });
}

/**
 * The seven trials (§5.1-§5.7), in n order, pinned by `node scripts/sim.ts --trials --pick <n>` (§6.5;
 * T6 and T7 re-authored by the lead's decisions, §13.3): each pin's levers carry the gates measured on
 * it (G1 audit margins per leg, G2 path low, G3 reactive wins, G4 humanEl passes, G5b best constant
 * angle of the 360 a degree apart, G6 Dare share). The global pass moved TUNING.elements first
 * (tuning.ts). The verifier round (§13.3) made G5b scan every degree and G0 require every plot,
 * puddle and stone to show (at least half of it clear of the drawn casters); no Trial passes a
 * constant angle on a 0.25° scan either.
 */
export const TRIALS: readonly TrialDef[] = Object.freeze([
  // T1 pin: salt 468 (the G5b scan: salts whose sun cannot stay fixed, then humanEl in its band);
  // drain 28 → 34, Nubs' legs 100 → 80, Ember 80 → 60 and costMul 1.2 (each easier set was too easy:
  // G5/G5b, humanEl above 95%). Measured: G1 82/60/83, G2 low 60, G3 8/8, G4 15/16 (94%), G5c on
  // sight 8 vs 59, G5b best θ241 dies at 23%, G6 burns ≥ 7 96% (WAIVERS: every finisher burns them all).
  // Fix round 3 (G9b, Ember gets 1.5 s before anything is due): the first wall b376 → b381 (its due
  // prompt 1.28 → 1.63 s after the TAG); every other gate as before (G9's shortest m381 158 ticks).
  trial(1, 'Kindling', 7, 'meadow', 240, 400, 34, 0, [[340, 'ember'], [556, 'nubs']], 'ember',
    'b381 b405 t434 g448 b477 g506 b535 i580', ['burns', 7], 30, [],
    'Tap each wall just before Ember gets there. Light refuels the flame.', 'Burn all 7', 'Burn all 7 walls', '', 468, { legStart: [80, 60, 80], costMul: 1.2 }),
  // T2 pin: salt 187; drain 26 → 28; Drip 70 → 50 and evapMul 1.2 (G5b: the held sun at a constant
  // angle walked Drip's leg), Nubs' closing leg 100 → 80. The verifier round (§13.3, §6.5 levers
  // only): puddle 218 +20 lay wholly under the Old Oak's canopy with no spot in ±6 min and ±8 u that
  // shows, so it is removed (the Drip leg's one object) and the Dare is §5's 6 again ("Drink 6",
  // "Drink all 6 puddles"; it was 7); stone 232 +10 → 229 +4 (wholly under the Mossy Oak's lumps) and
  // puddle 246 → 252 (82% under the Blue Elm's). At 229 +4 the stone sits on the planned lane, which a
  // constant sun at 242-249° or 331-337° (they walked T2 on the degree scan) can no longer afford.
  // Measured: G1 100/28/74 (Drip marks: chosen 45° 50, worst 310° 28), G2 low 38 (worst bin 37), G3
  // 8/8, G4 15/16 (94%), G5b best θ250 dies at 98%, G6 drinks ≥ 6 96% (WAIVERS: every puddle is in
  // Drip's reach, so every finisher drinks them all).
  trial(2, 'Puddle Run', 5, 'meadow', 60, 400, 28, 0, [[160, 'drip'], [376, 'nubs']], 'drip',
    'u189:-18 t203:-4 t229:4 u252:-8 t261:-20 u275:22 t290:14 u304 t318:-10 u333:-22 t344:24 u354:12', ['drinks', 6], 30, [],
    'Set the sun, then drag to steer Drip through shade and puddles. Dodge hot stones.', 'Drink 6', 'Drink all 6 puddles', '', 187, { legStart: [100, 50, 80], evapMul: 1.2 }),
  // T3 pin: salt 3584 (salts 0..199: 6 clear G0's plot clearance and none fails a constant sun
  // angle, so --pick ran past 199); drain 28 → 34 and Nubs' legs 100 → 80 (too easy: a constant
  // angle walked them). Measured: G1 83/39/83 (Sap low 39 on the crossings, 12 with 2 plots), G2 low
  // 81, G3 8/8, G4 13/16 (81%), G5b best θ282 dies at 23%, G6 trees ≥ 2 33%.
  trial(3, 'Green Bridge', 15, 'meadow', 240, 400, 34, 0, [[340, 'sprout'], [556, 'nubs']], 'sprout',
    'p369:44 x408:0:12 s450:0:14 p476:-44 x502:0:16 s530:0:12 p572:44 p586:-44 p600:44', ['trees', 2], 30, [],
    'Hold on the ground ahead: vines bridge gaps, trees shade Nubs. Sun speeds them.', 'Grow 2 trees', 'Grow 2 trees', '', 3584, { legStart: [80, 80, 80] }),
  // T4 pin: salt 605 (from a scan of salts on Nubs' opening leg: 0..199 held none that a constant
  // sun angle could not walk with a ±20 Nubs lever); drain 28 → 34 and Nubs' legs 100 → 80 (too
  // easy). Gust 80 → 90 lets the east/30 spam Gust through (G5d). Measured: G1 82/bots/83, G2 low
  // 80, G3 8/8, G4 12/16 (75%), G5d every spam Gust grounded in Gust's leg, G5b best θ284 dies at
  // 24%, G6 cloudRide ≥ 60 83% (WAIVERS: every finisher's Gust brings the ride cloud on; the +25%
  // target, 75, still measured 83%).
  trial(4, 'Weather Vane', 8, 'oldtown', 180, 400, 34, 0, [[280, 'gust'], [496, 'nubs']], 'gust',
    'r312:-100:55:20 f340:80:70:-12 r365:110:60:-24 r385:-150:55:0 f400:-90:80:14 r425:150:55:0 r440:-100:60:22 r465:100:65:-20 r520:-190:90:6', ['cloudRide', 60], 30, [],
    "Swipe to blow rain and fog off Gust's path. Rain shades Nubs: push a cloud onto him.", 'Rain ride 1 s', 'Ride a rain cloud 1 s', '', 605, { legStart: [80, 80, 80] }),
  // T5 pin: salt 1113 (found by the G5b scan: 0..1112 held no salt whose sun could not stay fixed);
  // drain 28 → 34, Nubs' legs 100 → 80, Ember 80 → 60, Drip 70 → 50, costMul and evapMul 1.2 (too
  // easy: each element leg passed with its verb off); puddles 425 −18 → −26 and 492 18 → 26 (8 u
  // from the trail: an unsteered Drip drank them) and 530 −16 → −17 (G0 clearance); Dare 4 → 5
  // (+25%, its bound). Measured: G1 83/60/32/83 (Drip marks: chosen 45° 49, worst 300° 32), G2 low
  // 50 (worst bin 42), G3 8/8, G4 16/16 (100%), G5b best θ291 dies at 71%, G6 drinks ≥ 5 92%, G7 the
  // ice left standing kills Drip. G4 and G6 are WAIVERS: every lever is at its bound, salts 0..6000
  // hold no other whose sun cannot stay fixed with humanEl under 90%, and a second shower over a wall
  // (one object added) changed nothing; every finisher drinks the five puddles.
  // Fix round 3 (G9b): the first wall b245 → b258 (its due prompt 0.78 → 1.68 s after the TAG; G6 92%,
  // every other gate as before).
  trial(5, 'Steam', 11, 'meadow', 120, 504, 34, 0, [[216, 'ember'], [390, 'drip'], [564, 'nubs']], null,
    'b258 u270 r296:176:50:-48 g296 t320 b344 i372 i412 u425:-26 i436 t452:10 t474:-14 u492:26 t512:-4 u530:-17 t546:16', ['drinks', 5], 25, [1, 2],
    'Melt the ice for Drip: every puddle grows him. Puddles and rain douse Ember!', 'Drink 5', 'Drink 5 puddles', '', 1113,
    { legStart: [80, 60, 50, 80], costMul: 1.2, evapMul: 1.2 }),
  // T6 pin, re-authored by the lead's decisions (docs/ELEMENTALS_V2.md §13.3): the Nubs legs move
  // toward midday (start 150 → 226, 8:30 → 9:46 AM; the closing leg 3:36-4:40 → 3:28-4:28 PM), Gust's
  // leg 10.0 → 8.0 s and Sprout's 12.9 → 9.1 s, every object re-timed in its leg. Gust's weather: a
  // cloud drifting in from the west (r355), one waiting east (r365), one drifting in from the east
  // (r372), a fog drifting on (f394), one waiting west (r413): east early, west late (the first pin's
  // added r330 is gone). The hand-off: a small fog a west wind clears (f449:-35:55:6) and the garden
  // cloud waiting east, r461:140:100:0 (dry left alone; the hand-off's west swipes put it over Sprout
  // and the garden plot). Two crossings (gap, stream: r14) and six plots. Salt 198; drain 34 → 38;
  // legStart [60, 60, 65, 80] (Nubs 80 → 60, Gust 65 → 60, Sprout 100 → 65: below the Sap cap the
  // garden rain counts); costMul 1.2 → 1; plot 464 44 → 43 (G0 clearance). Verifier round (G0: every
  // plot shows): plot 561 +56 → −44 (84% under the Old Pine's canopy) and plot 582 +44 → 578 −44
  // (wholly under the Fancy Maple's). Measured: G1 63/bots/65/83 (Sap low 65, 13 with 3 plots), G2
  // low 37, G3 8/8, G4 13/16 (81%), G5 idle, both verbs off and the four spams fail, G5b best θ193
  // dies at 23%, G6 trees ≥ 3 25%, G7 without the hand-off swipes Sap 41 vs 65 and 2 trees (the plan 3).
  trial(6, 'Rain Garden', 9, 'meadow', 226, 402, 38, 0, [[322, 'gust'], [437, 'sprout'], [568, 'nubs']], null,
    'r355:-110:60:22 r365:130:55:0 r372:110:60:-24 f394:-80:75:14 r413:-150:55:0 f449:-35:55:6 r461:140:100:0 p464:43 x511:0:14 p530:-44 s548:0:14 p561:-44 p578:-44 p597:-43 p610:40', ['trees', 3], 25, [3, 4],
    'Clear the fog for Sprout and blow the rain onto its path: rain feeds plants.', 'Grow 3 trees', 'Grow 3 trees', '', 198,
    { legStart: [60, 60, 65, 80] }),
  // T7 pin, re-authored by the lead's decisions (§13.3): the Nubs legs move toward midday (start
  // 60 → 86, 7:00 → 7:26 AM; the closing leg 3:58-5:00 → 3:50-4:50 PM), the element legs 7.5/8.3/7.9/
  // 6.9 → 6.9/7.8/6.9/6.7 s, every object re-timed in its leg. Gust's leg is T6's with its drifts set
  // against the −16 breeze (the first pin's added r196 is gone); the hand-off fog f294:-60:55:16 (a
  // west wind clears it) and the garden cloud waiting east, r306:140:100:16; crossings r14 → r12.
  // Drip's stretch (G5, Drip's leg must need its steer): the second ice wall is now an on-trail hot
  // stone (t540) and the puddles lie off the walking line (u545:-22, u562:24), so an unsteered Drip
  // meets three stones and only the melted ice's puddle. Salt 1266; drain 36 → 42; legStart [50, 60,
  // 70, 50, 40, 60] (Nubs 80 → 50 opening and 80 → 60 closing, Gust 70 → 60, Sprout 100 → 70, Ember
  // 60 → 50, Drip 50 → 40); evapMul 1.2; plot 340 −44 → −36 (G0 clearance). Verifier round: the
  // opening start 60 → 50 (θ325-326 walked the whole Trial on the degree scan, with an opening low of
  // 0.7-4.8; the closing leg kills every other angle that lives through the opening); puddle 529 −22
  // → 545 −22 (wholly under the Crooked Oak's canopy; 545 shows in full, between the stones at 540 and
  // 552) and plot 426 +44 → 428 (71% under the Blue Elm's). Measured: G1 53/bots/67/50/37/63 (Drip
  // marks: chosen 85° 39, worst 100° 37), G2 low 27 (worst bin 27), G3 8/8, G4 13/16 (81%), G5 idle,
  // every element leg with its verb off (Drip's too: the path, reactive 0/8 and humanEl 0/16 with
  // Drip's steer off fail in Drip's leg) and the four spams fail, G5b best θ317 dies at 97%, G6 grove
  // ≥ 3 33%, G7 plot 420 burns and without the hand-off swipes Sap 52 vs 67.
  trial(7, 'Five Elements', 17, 'meadow', 86, 564, 42, -16, [[182, 'gust'], [282, 'sprout'], [394, 'ember'], [494, 'drip'], [590, 'nubs']], null,
    'r214:-110:60:38 r222:130:55:16 r230:110:60:-8 f245:-80:75:24 r263:-150:55:16 f294:-60:55:16 r306:140:100:16 p309:44 p340:-36 x355:0:12 s383:0:12 p420:-44 b423 p428:44 u437 r453:133:55:-24 g453 b472 t483 i518 t540:0 u545:-22 t552:3 u562:24 t575:-2', ['grove', 3], 25, [5, 6],
    'Five elements, one day. The breeze spreads fire west: keep three trees.', '3 trees standing', 'Keep 3 trees standing', 'ALL FIVE ELEMENTS', 1266,
    { legStart: [50, 60, 70, 50, 40, 60], evapMul: 1.2 }),
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
