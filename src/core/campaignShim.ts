// V12-SHIM — the campaign core contract (CAMPAIGN_PLAN §2-§3) as the game and render layers need it, until the
// core batch's `src/config/campaign.ts` lands in `src/core/index.ts`. Integration replaces every
// import of this module with `../core/index.ts` and deletes the file:
//   - CONCEPTS, CAMPAIGN_LEVELS, CHAPTERS, levelDef, starsFor, levelProgress, ConceptId, LevelDef
//     (the same names and signatures; the level table here is a plausible stand-in, not the real one);
//   - `CAMPAIGN` (= RunMode 'campaign'), `WON` (= Phase 'won') and `isWon(s)` (= s.phase === 'won');
//   - `SimStateV12` (= SimState once it carries mods, eclipse, moonlit, sun.gust and sun.locked),
//     `asV12(run)` (identity then) and `CampaignRunConfig` (= RunConfig);
//   - `LevelWonEvent` (= the SimEvent 'levelWon');
//   - `shimCampaignTick` (gone: the sim sets the phase, the fields and emits levelWon itself).
// Nothing here changes the simulation: the gust, lock and eclipse fields are written for the
// renderer only, and the finish line is detected by the session after each tick.

import {
  dayLength,
  dayTicks,
  hashString,
  TICK_HZ,
  yAtDayTick,
  type BiomeId,
  type ForecastId,
  type Phase,
  type RunConfig,
  type RunMode,
  type RunStats,
  type SimState,
  type SunState,
} from './index.ts';

export type ConceptId =
  | 'drag'
  | 'flakes'
  | 'cloud'
  | 'noon'
  | 'oldtown'
  | 'glare'
  | 'swing'
  | 'gate'
  | 'breezy'
  | 'long'
  | 'heat'
  | 'overcast'
  | 'dazzle'
  | 'market'
  | 'sprint'
  | 'stroll'
  | 'giants'
  | 'lowland'
  | 'sparse'
  | 'dense'
  | 'drought'
  | 'fleet'
  | 'thaw'
  | 'frosty'
  | 'ration'
  | 'meltfast'
  | 'hardy'
  | 'flurry'
  | 'heavy'
  | 'slippery'
  | 'clockwork'
  | 'gusts'
  | 'lock'
  | 'fog'
  | 'blind'
  | 'eclipse'
  | 'sunset'
  | 'moonlit'
  | 'marathon'
  | 'boss';

export type GoalKind = 'finish' | 'flakes' | 'snow';
export type ConceptKind = 'teach' | 'world' | 'sun' | 'chill' | 'sky' | 'goal';

export interface Concept {
  id: ConceptId;
  name: string;
  blurb: string;
  /** A glyphs.ts id (render/glyphs.ts drawConceptGlyph). */
  icon: string;
  kind: ConceptKind;
}

export interface LevelDef {
  id: number;
  chapter: number;
  name: string;
  seed: number;
  biome: BiomeId;
  forecast: ForecastId;
  concepts: readonly ConceptId[];
  introduces: ConceptId | null;
  /** Minutes since 6:00 AM of Day 1 (0 = dawn, 360 = noon). */
  startMinute: number;
  lengthMinutes: number;
  goal: { kind: GoalKind; target: number };
  stars: { flakes: number; minChill: number };
  drain: number;
}

/**
 * The concept catalog in teaching order (level 1..40 introduces CONCEPT_ORDER[id − 1]): id, the
 * teaching level's title, the concept's own short name, the blurb, the kind.
 */
const CATALOG: readonly [ConceptId, string, string, string, ConceptKind][] = [
  ['drag', 'First Shade', 'Drag', 'Drag anywhere: the sun swings, every shadow swings with it. Keep Nubs in the blue.', 'teach'],
  ['flakes', 'Flake Trail', 'Flakes', 'Flakes count. Walk through them in the shade to keep them.', 'goal'],
  ['cloud', 'Umbrella', 'Clouds', 'Clouds are moving shade. Ride one and the sun can do what it likes.', 'sky'],
  ['noon', 'High Noon', 'Noon', 'A high sun throws short shadows. Hug the big things.', 'sun'],
  ['oldtown', 'Old Town', 'Old Town', 'Houses, arches and walls: long, square shade in a crowded street.', 'world'],
  ['glare', 'Glass Garden', 'Glare', 'Gazing balls throw light back. Red arcs on the dial are glare.', 'world'],
  ['swing', 'SWING!', 'Swing', 'Hand the shade from one shadow to the next in one sweep: SWING Snow counts.', 'goal'],
  ['gate', 'The Gate', 'Gate', 'A gate arch at the midpoint. Pass under it in full shade for +10 Snow.', 'world'],
  ['breezy', 'Breezy', 'Breezy', 'Clouds hurry across the sky. Catch them while they last.', 'sky'],
  ['long', 'Long Shadows', 'Long Shadows', 'A low sun all day: shadows stretch far. Reach for them.', 'sun'],
  ['heat', 'Heat Wave', 'Heat Wave', 'Chill melts faster in the glare. Every gap costs.', 'chill'],
  ['overcast', 'Overcast', 'Overcast', 'A grey sky softens the sun; the shade is wide but thin.', 'sky'],
  ['dazzle', 'Dazzle', 'Dazzle', 'Glints on every bright patch. Trust the blue, not the sparkle.', 'sky'],
  ['market', 'Market Day', 'Market', 'Stalls and bunting fill the street: small shade, lots of it.', 'world'],
  ['sprint', 'Sprint', 'Sprint', 'Nubs walks faster. Shadows pass sooner; plan ahead.', 'world'],
  ['stroll', 'Stroll', 'Stroll', 'A slow walk under a hungry sun: every shadow must last.', 'world'],
  ['giants', 'Giants', 'Giants', 'Everything stands taller: huge shadows, if you can reach them.', 'world'],
  ['lowland', 'Lowland', 'Lowland', 'Stubby casters, stubby shade. Keep the sun low.', 'world'],
  ['sparse', 'Wide Open', 'Wide Open', 'Casters are far apart. Make each one count.', 'world'],
  ['dense', 'Crowded', 'Crowded', 'Shade everywhere, and glare between. Pick a lane.', 'world'],
  ['drought', 'Drought', 'Drought', 'Not one cloud all day. Shadows only.', 'sky'],
  ['fleet', 'Cloud Fleet', 'Cloud Fleet', 'Three times the clouds, each a little smaller.', 'sky'],
  ['thaw', 'Thin Ice', 'Thin Ice', 'Chill drains fast. Short trips only.', 'chill'],
  ['frosty', 'Frosty', 'Frosty', 'Shade refills Chill quickly. Breathe, then go.', 'chill'],
  ['ration', 'Rationed', 'Rationed', 'Half a tank of Chill, all day.', 'chill'],
  ['meltfast', 'Quick Melt', 'Quick Melt', 'Flakes melt in half a second of sun. Shade first, then grab.', 'goal'],
  ['hardy', 'Hardy Flakes', 'Hardy Flakes', 'These flakes never melt. Collect fifteen.', 'goal'],
  ['flurry', 'Flurry', 'Flurry', 'Flakes come seven at a time, cluster after cluster.', 'goal'],
  ['heavy', 'Heavy Sun', 'Heavy Sun', 'The sun follows slowly and never coasts. Lead it.', 'sun'],
  ['slippery', 'Slippery Sun', 'Slippery Sun', 'The sun coasts a long way after a flick. Catch it.', 'sun'],
  ['clockwork', 'Clockwork', 'Clockwork', 'The sun snaps to 30° steps when you let go.', 'sun'],
  ['gusts', 'Gusts', 'Gusts', 'Every few seconds a gust turns the sun. Lean against it.', 'sun'],
  ['lock', 'Sun Lock', 'Sun Lock', 'Now and then the sun locks for a moment. Be in shade when it does.', 'sun'],
  ['fog', 'Fog', 'Fog', 'The road ahead fades out. The dial only shows the shade you have now.', 'sky'],
  ['blind', 'No Dial', 'No Dial', 'No safe arcs on the dial. Read the shadows themselves.', 'sky'],
  ['eclipse', 'Eclipse', 'Eclipse', 'Rest in the dark, then it\u2019s back.', 'sky'],
  ['sunset', 'Sunset Run', 'Sunset', 'From 3 PM into dusk: the shadows grow with every step.', 'sun'],
  ['moonlit', 'Moonlit', 'Moonlit', 'A night run under a moon that burns. Moon shadows keep you.', 'sun'],
  ['marathon', 'Marathon', 'Marathon', 'A whole day and night and on into the next morning.', 'world'],
  ['boss', 'Heat Dome', 'Heat Dome', 'The sun at its highest and hottest. Everything you know.', 'chill'],
];

export const CONCEPT_ORDER: readonly ConceptId[] = Object.freeze(CATALOG.map((c) => c[0]));

/** The title of the level that teaches each concept. */
const TEACH_TITLE: Readonly<Record<ConceptId, string>> = Object.freeze(Object.fromEntries(CATALOG.map(([id, title]) => [id, title])) as Record<ConceptId, string>);

export const CONCEPTS: Readonly<Record<ConceptId, Concept>> = Object.freeze(
  Object.fromEntries(CATALOG.map(([id, , name, blurb, kind]) => [id, Object.freeze({ id, name, blurb, icon: id, kind })])) as Record<ConceptId, Concept>,
);

const CHAPTER_NAMES: readonly string[] = [
  'First Light',
  'Old Town',
  'Weather',
  'Tall and Small',
  'Chill',
  'Flakes',
  'The Sun',
  'Hard Sky',
  'Night',
  'Heat Dome',
  'Second Wind',
  'Back Streets',
  'Storm Front',
  'Giants Walk',
  'Deep Freeze',
  'Flurries',
  'Wild Sun',
  'Blind Run',
  'Long Night',
  'The Dome',
];

export const CHAPTERS: readonly { id: number; name: string; biome: BiomeId }[] = Object.freeze(
  CHAPTER_NAMES.map((name, i) => Object.freeze({ id: i + 1, name, biome: (i % 2 === 0 ? 'meadow' : 'oldtown') as BiomeId })),
);

/** Forecast concepts and the forecast they set. */
const FORECAST_OF: Partial<Record<ConceptId, ForecastId>> = { breezy: 'breezy', long: 'long', heat: 'heat', overcast: 'overcast', dazzle: 'dazzle', market: 'market' };
const TOWN_ONLY: readonly ConceptId[] = ['oldtown', 'market', 'gate'];
const MEADOW_ONLY: readonly ConceptId[] = ['dazzle'];

function teachLevel(id: number): LevelDef {
  const concept = CONCEPT_ORDER[id - 1] as ConceptId;
  const name = TEACH_TITLE[concept];
  let biome: BiomeId = TOWN_ONLY.includes(concept) ? 'oldtown' : 'meadow';
  let startMinute = 60;
  let lengthMinutes = 360;
  let drain = Math.min(50, 35 + Math.floor(id / 4) * 2);
  let goal: LevelDef['goal'] = { kind: 'finish', target: 0 };
  switch (concept) {
    case 'drag':
      startMinute = 0;
      drain = 35;
      break;
    case 'flakes':
      goal = { kind: 'flakes', target: 8 };
      break;
    case 'noon':
      startMinute = 270;
      lengthMinutes = 180;
      break;
    case 'swing':
      goal = { kind: 'snow', target: 20 };
      break;
    case 'hardy':
      goal = { kind: 'flakes', target: 15 };
      break;
    case 'lock':
    case 'gusts':
      drain = Math.min(drain, 40);
      break;
    case 'sunset':
      startMinute = 540;
      lengthMinutes = 180;
      break;
    case 'marathon':
      lengthMinutes = 1080;
      break;
    case 'boss':
      startMinute = 180;
      lengthMinutes = 360;
      drain = 55;
      break;
    default:
      break;
  }
  if (id >= 13 && id % 2 === 1 && !MEADOW_ONLY.includes(concept) && !TOWN_ONLY.includes(concept) && concept !== 'drag') biome = 'oldtown';
  if (MEADOW_ONLY.includes(concept)) biome = 'meadow';
  const flakes = goal.kind === 'flakes' ? goal.target + 2 : 6 + Math.floor(id / 5);
  return Object.freeze({
    id,
    chapter: Math.ceil(id / 10),
    name,
    seed: hashString(`journey-${id}`),
    biome,
    forecast: FORECAST_OF[concept] ?? 'clear',
    concepts: Object.freeze([concept]),
    introduces: concept,
    startMinute,
    lengthMinutes,
    goal,
    stars: Object.freeze({ flakes, minChill: 40 }),
    drain,
  });
}

/** Levels 41-200: two or three concepts of the chapter, never two of one kind but 'world'. */
function comboLevel(id: number): LevelDef {
  const chapter = Math.ceil(id / 10);
  const ch = CHAPTERS[chapter - 1] as { name: string; biome: BiomeId };
  const biome = ch.biome;
  const rng = hashString(`journey-${id}`);
  const pool = CONCEPT_ORDER.filter((c) => c !== 'drag' && c !== 'oldtown' && c !== 'marathon' && (biome === 'oldtown' ? !MEADOW_ONLY.includes(c) : !TOWN_ONLY.includes(c)));
  const concepts: ConceptId[] = [];
  const kinds = new Set<ConceptKind>();
  const want = id % 10 === 0 ? 3 : 2 + ((rng >>> 3) & 1);
  let x = rng;
  for (let tries = 0; concepts.length < want && tries < 40; tries++) {
    x = ((Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0) ^ (x >>> 12)) >>> 0;
    const c = pool[x % pool.length] as ConceptId;
    const k = CONCEPTS[c].kind;
    if (concepts.includes(c) || (k !== 'world' && kinds.has(k))) continue;
    if (FORECAST_OF[c] !== undefined && concepts.some((o) => FORECAST_OF[o] !== undefined)) continue;
    concepts.push(c);
    kinds.add(k);
  }
  const curve = (chapter - 5) / 15;
  const lengthMinutes = Math.round(360 + 360 * curve);
  const forecastConcept = concepts.find((c) => FORECAST_OF[c] !== undefined);
  const goalConcept = concepts.find((c) => c === 'flakes' || c === 'hardy' || c === 'swing' || c === 'flurry');
  const goal: LevelDef['goal'] =
    goalConcept === 'swing' ? { kind: 'snow', target: Math.round(20 * (1 + curve)) } : goalConcept ? { kind: 'flakes', target: Math.round(8 * (1 + curve)) } : { kind: 'finish', target: 0 };
  return Object.freeze({
    id,
    chapter,
    name: `${ch.name} ${id % 10 === 0 ? 'X' : ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][(id % 10) - 1]}`,
    seed: hashString(`journey-${id}`),
    biome,
    forecast: forecastConcept ? (FORECAST_OF[forecastConcept] as ForecastId) : 'clear',
    concepts: Object.freeze(concepts),
    introduces: null,
    startMinute: 60,
    lengthMinutes,
    goal,
    stars: Object.freeze({ flakes: Math.round(8 * (1 + curve)), minChill: 40 }),
    drain: Math.round(id % 10 === 0 ? 55 : 40 + 15 * curve),
  });
}

export const CAMPAIGN_LEVELS: readonly LevelDef[] = Object.freeze(Array.from({ length: 200 }, (_, i) => (i < 40 ? teachLevel(i + 1) : comboLevel(i + 1))));

export function levelDef(id: number): LevelDef | null {
  return Number.isInteger(id) && id >= 1 && id <= CAMPAIGN_LEVELS.length ? (CAMPAIGN_LEVELS[id - 1] as LevelDef) : null;
}

/** Stars for a passed level: 1, +1 for enough flakes, +1 for the lowest Chill staying high. */
export function starsFor(level: LevelDef, stats: Pick<RunStats, 'flakes'> & { minChill: number }): 0 | 1 | 2 | 3 {
  let n = 1;
  if (stats.flakes >= level.stars.flakes) n++;
  if (stats.minChill >= level.stars.minChill) n++;
  return n as 1 | 2 | 3;
}

// ---- Run config, mode and phase ---------------------------------------------------------------

/** RunMode 'campaign'. */
export const CAMPAIGN: RunMode = 'campaign' as RunMode;
/** Phase 'won'. */
export const WON: Phase = 'won' as Phase;

export function isWon(s: SimState): boolean {
  return s.phase === WON;
}

/** RunConfig with the campaign fields. */
export type CampaignRunConfig = RunConfig & {
  level?: number;
  mods?: readonly ConceptId[];
  biome?: BiomeId;
};

/** SimState with the campaign fields the renderer reads. */
export type SimStateV12 = SimState & {
  mods: Set<ConceptId>;
  /** Eclipse darkness 0..1. */
  eclipse: number;
  moonlit: boolean;
  readonly sun: SunState & { gust: -1 | 0 | 1; locked: boolean };
};

/** Gives a run the campaign fields (idempotent). */
export function asV12(run: SimState): SimStateV12 {
  const s = run as SimStateV12;
  const cfg = s.cfg as CampaignRunConfig;
  if (!(s.mods instanceof Set)) s.mods = new Set(cfg.mods ?? []);
  if (typeof s.eclipse !== 'number') s.eclipse = 0;
  if (typeof s.moonlit !== 'boolean') s.moonlit = s.mods.has('moonlit');
  if (s.sun.gust === undefined) s.sun.gust = 0;
  if (s.sun.locked === undefined) s.sun.locked = false;
  return s;
}

export interface LevelWonEvent {
  e: 'levelWon';
  passed: boolean;
  stars: 0 | 1 | 2 | 3;
  flakes: number;
  minChill: number;
}

// ---- Level geometry ---------------------------------------------------------------------------

/** Day and day tick of a campaign minute (daylight minutes only: 720 per day, nights add none). */
function tickOfMinute(minute: number): { day: number; dayTick: number } {
  const day = Math.floor(minute / 720) + 1;
  return { day, dayTick: Math.round(((minute - (day - 1) * 720) / 720) * dayTicks(day)) };
}

export function yAtMinute(minute: number): number {
  const { day, dayTick } = tickOfMinute(minute);
  return yAtDayTick(day, dayTick);
}

/** Seconds after Day 1's dawn for cfg.startT. */
export function startTOf(level: LevelDef): number {
  return (level.startMinute / 720) * dayLength(1);
}

export function levelStartY(level: LevelDef): number {
  return yAtMinute(level.startMinute);
}

export function levelFinishY(level: LevelDef): number {
  return yAtMinute(level.startMinute + level.lengthMinutes);
}

/** 0..1 along the level (0 before a campaign run starts; 1 at the finish line; 0 outside the campaign). */
export function levelProgress(s: SimState): number {
  const level = levelDef((s.cfg as CampaignRunConfig).level ?? -1);
  if (!level) return 0;
  const y0 = levelStartY(level);
  const y1 = levelFinishY(level);
  if (y1 <= y0) return 1;
  const p = (s.nubs.y - y0) / (y1 - y0);
  return p <= 0 ? 0 : p >= 1 ? 1 : p;
}

// ---- Per-tick stand-ins for the sim's concept behaviour ----------------------------------------

const GUST_PERIOD = 8;
const GUST_S = 2;
const LOCK_PERIOD = 7;
const LOCK_S = 1.2;
const ECLIPSE_S = 6;
const ECLIPSE_RAMP = 0.5;

/** The gust direction of gust number `k` of a level (seeded). */
export function gustDir(seed: number, k: number): -1 | 1 {
  return (hashString(`gust-${seed}-${k}`) & 1) === 0 ? -1 : 1;
}

/**
 * After a tick of a campaign run: writes the render-side fields (gust, locked, eclipse) from the
 * level's timetable, and detects the finish line. Returns the levelWon event once, on the tick Nubs
 * crosses the line alive (the run is then frozen in the 'won' phase), else null.
 */
export function shimCampaignTick(s: SimStateV12, level: LevelDef, minChill: number): LevelWonEvent | null {
  if (s.phase === 'hold' || s.phase === 'dead' || isWon(s)) return null;
  const t = s.tick / TICK_HZ;
  const sun = s.sun;
  if (s.mods.has('gusts')) {
    const k = Math.floor(t / GUST_PERIOD);
    const inGust = t - k * GUST_PERIOD >= GUST_PERIOD - GUST_S;
    sun.gust = inGust ? gustDir(s.cfg.seed, k) : 0;
  } else {
    sun.gust = 0;
  }
  sun.locked = s.mods.has('lock') && t % LOCK_PERIOD >= LOCK_PERIOD - LOCK_S;
  if (s.mods.has('eclipse')) {
    const y0 = levelStartY(level);
    const y1 = levelFinishY(level);
    const mid = (y0 + y1) / 2;
    // Seconds since Nubs reached the midpoint (at the day's walk speed).
    const since = (s.nubs.y - mid) / Math.max(1e-6, s.params.v);
    const w = since < 0 ? 0 : since > ECLIPSE_S ? 0 : Math.min(1, since / ECLIPSE_RAMP, (ECLIPSE_S - since) / ECLIPSE_RAMP);
    s.eclipse = w;
  } else {
    s.eclipse = 0;
  }
  if (s.nubs.y < levelFinishY(level) || s.nubs.chill <= 0) return null;
  s.phase = WON;
  const flakes = s.stats.flakes;
  const passed = level.goal.kind === 'finish' ? true : level.goal.kind === 'flakes' ? flakes >= level.goal.target : s.stats.snow >= level.goal.target;
  return { e: 'levelWon', passed, stars: passed ? starsFor(level, { flakes, minChill }) : 0, flakes, minChill };
}
