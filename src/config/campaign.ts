// V12-SHIM: a stand-in for the core batch's campaign catalog and level builder (docs/CAMPAIGN_PLAN.md
// §2-§3). It exports the exact names and shapes the UI/meta layer consumes (CONCEPTS, CAMPAIGN_LEVELS,
// CHAPTERS, levelDef, starsFor); the level table here is a simple deterministic placeholder, not the
// tuned campaign. Integration replaces this whole file with core's.

import type { BiomeId } from './days.ts';
import type { ForecastId } from './forecasts.ts';

export type ConceptId =
  | 'drag' | 'flakes' | 'cloud' | 'noon' | 'oldtown' | 'glare' | 'swing' | 'gate' | 'breezy' | 'long'
  | 'heat' | 'overcast' | 'dazzle' | 'market' | 'sprint' | 'stroll' | 'giants' | 'lowland' | 'sparse' | 'dense'
  | 'drought' | 'fleet' | 'thaw' | 'frosty' | 'ration' | 'meltfast' | 'hardy' | 'flurry' | 'heavy' | 'slippery'
  | 'clockwork' | 'gusts' | 'lock' | 'fog' | 'blind' | 'eclipse' | 'sunset' | 'moonlit' | 'marathon' | 'boss';

export type ConceptKind = 'teach' | 'world' | 'sun' | 'chill' | 'sky' | 'goal';
export type GoalKind = 'finish' | 'flakes' | 'snow';

export interface Concept {
  id: ConceptId;
  name: string;
  blurb: string;
  /** A glyph id (render/glyphs.ts); the UI maps concept ids to its own icon set. */
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
  startMinute: number;
  lengthMinutes: number;
  goal: { kind: GoalKind; target: number };
  stars: { flakes: number; minChill: number };
  drain: number;
}

const c = (id: ConceptId, name: string, blurb: string, icon: string, kind: ConceptKind): Concept => ({ id, name, blurb, icon, kind });

/** The 40 concepts in teaching order (levels 1-40 introduce one each). */
export const CONCEPT_IDS: readonly ConceptId[] = [
  'drag', 'flakes', 'cloud', 'noon', 'oldtown', 'glare', 'swing', 'gate', 'breezy', 'long',
  'heat', 'overcast', 'dazzle', 'market', 'sprint', 'stroll', 'giants', 'lowland', 'sparse', 'dense',
  'drought', 'fleet', 'thaw', 'frosty', 'ration', 'meltfast', 'hardy', 'flurry', 'heavy', 'slippery',
  'clockwork', 'gusts', 'lock', 'fog', 'blind', 'eclipse', 'sunset', 'moonlit', 'marathon', 'boss',
];

export const CONCEPTS: Readonly<Record<ConceptId, Concept>> = {
  drag: c('drag', 'First Shade', 'Drag left or right: the sun swings, and every shadow with it.', 'drag', 'teach'),
  flakes: c('flakes', 'Flake Trail', 'Snowflakes are Snow. Walk through them in the shade.', 'flake', 'goal'),
  cloud: c('cloud', 'Umbrella', 'Clouds are moving shade.', 'cloud', 'sky'),
  noon: c('noon', 'High Noon', 'At noon the shadows shrink to almost nothing.', 'noon', 'sun'),
  oldtown: c('oldtown', 'Old Town', 'Houses and walls throw long, square shade.', 'oldtown', 'world'),
  glare: c('glare', 'Glass Garden', 'Gazing balls throw light back. Red arcs on the dial are glare.', 'glare', 'world'),
  swing: c('swing', 'SWING!', 'Hand the shade off straight into the next shadow for extra Snow.', 'swing', 'goal'),
  gate: c('gate', 'The Gate', 'Walk under the arch at full shade for +10 Snow.', 'gate', 'world'),
  breezy: c('breezy', 'Breezy', 'The wind carries extra clouds across the sky.', 'breezy', 'sky'),
  long: c('long', 'Long Shadows', 'A low sun: long shade all day.', 'long', 'sun'),
  heat: c('heat', 'Heat Wave', 'Chill drains faster in the heat.', 'heat', 'chill'),
  overcast: c('overcast', 'Overcast', 'A grey lid of clouds; the sun barely bites.', 'overcast', 'sky'),
  dazzle: c('dazzle', 'Dazzle', 'Sparkling air: glare everywhere there is glass.', 'dazzle', 'sky'),
  market: c('market', 'Market Day', 'Stalls crowd Old Town with small, busy shade.', 'market', 'world'),
  sprint: c('sprint', 'Sprint', 'Nubs walks faster: shade comes and goes quickly.', 'sprint', 'world'),
  stroll: c('stroll', 'Stroll', 'A slow walk under a hungry sun.', 'stroll', 'chill'),
  giants: c('giants', 'Giants', 'Huge casters, huge shadows.', 'giants', 'world'),
  lowland: c('lowland', 'Lowland', 'Low casters: short, stubby shade.', 'lowland', 'world'),
  sparse: c('sparse', 'Wide Open', 'Far between: every shadow counts.', 'sparse', 'world'),
  dense: c('dense', 'Crowded', 'Shade everywhere, if you can read it.', 'dense', 'world'),
  drought: c('drought', 'Drought', 'Not one cloud all day.', 'drought', 'sky'),
  fleet: c('fleet', 'Cloud Fleet', 'A fleet of small clouds.', 'fleet', 'sky'),
  thaw: c('thaw', 'Thin Ice', 'Chill drains hard in the light.', 'thaw', 'chill'),
  frosty: c('frosty', 'Frosty', 'Chill refills fast in the shade.', 'frosty', 'chill'),
  ration: c('ration', 'Rationed', 'Half a tank of Chill, all day.', 'ration', 'chill'),
  meltfast: c('meltfast', 'Quick Melt', 'Flakes melt the moment the sun touches them.', 'meltfast', 'goal'),
  hardy: c('hardy', 'Hardy Flakes', 'These flakes never melt. Collect them all.', 'hardy', 'goal'),
  flurry: c('flurry', 'Flurry', 'Big, tight clusters of flakes.', 'flurry', 'goal'),
  heavy: c('heavy', 'Heavy Sun', 'The sun stops where you leave it: no coasting.', 'heavy', 'sun'),
  slippery: c('slippery', 'Slippery Sun', 'The sun coasts a long way. Catch it.', 'slippery', 'sun'),
  clockwork: c('clockwork', 'Clockwork', 'The sun snaps to the hour marks.', 'clockwork', 'sun'),
  gusts: c('gusts', 'Gusts', 'Gusts of wind push the sun around.', 'gusts', 'sun'),
  lock: c('lock', 'Sun Lock', 'Now and then the sun locks in place. Plan ahead.', 'lock', 'sun'),
  fog: c('fog', 'Fog', 'You cannot see far ahead.', 'fog', 'sky'),
  blind: c('blind', 'No Dial', 'No safe arcs on the dial. Read the shadows.', 'blind', 'teach'),
  eclipse: c('eclipse', 'Eclipse', 'Rest in the dark, then it’s back.', 'eclipse', 'sky'),
  sunset: c('sunset', 'Sunset Run', 'Into the dusk: the shade grows as you go.', 'sunset', 'sun'),
  moonlit: c('moonlit', 'Moonlit', 'A night run under a moon that casts shade.', 'moonlit', 'sun'),
  marathon: c('marathon', 'Marathon', 'A long way, across one night.', 'marathon', 'goal'),
  boss: c('boss', 'Heat Dome', 'The sun straight overhead and a hungry drain.', 'boss', 'sun'),
};

export const CHAPTERS: readonly { id: number; name: string; biome: BiomeId }[] = [
  'First Light', 'Cobbles', 'Glass and Gates', 'Weather Fronts', 'Market Mornings',
  'Tall Shade', 'Wide Fields', 'Thin Ice', 'Flake Season', 'Sun Handling',
  'Clockwork Sky', 'Long Haul', 'Blind Alleys', 'Dusk Patrol', 'Moon Road',
  'Heat Dome', 'The Gauntlet', 'High Summer', 'Last Shade', 'Solstice',
].map((name, i) => ({ id: i + 1, name, biome: i % 2 === 0 ? ('meadow' as const) : ('oldtown' as const) }));

/** A tiny string hash (FNV-1a) for the placeholder seeds; core's hashString replaces it. */
function shimHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const NAME_A = ['Quiet', 'Bright', 'Long', 'Little', 'Dusty', 'Cool', 'Wide', 'Slow', 'Sharp', 'Golden'];
const NAME_B = ['Lane', 'Steps', 'Garden', 'Crossing', 'Walk', 'Yard', 'Bend', 'Climb', 'Stretch', 'Mile'];

function buildCampaign(): LevelDef[] {
  const out: LevelDef[] = [];
  for (let id = 1; id <= 200; id++) {
    const chapter = Math.ceil(id / 10);
    const chap = CHAPTERS[chapter - 1] as { id: number; name: string; biome: BiomeId };
    const introduces = id <= 40 ? (CONCEPT_IDS[id - 1] as ConceptId) : null;
    const concepts: ConceptId[] = introduces
      ? [introduces]
      : [CONCEPT_IDS[(id * 7) % 40] as ConceptId, CONCEPT_IDS[(id * 13 + 5) % 40] as ConceptId];
    const name = introduces ? CONCEPTS[introduces].name : `${NAME_A[(id * 3) % 10]} ${NAME_B[(id * 7 + chapter) % 10]}`;
    const t = (chapter - 1) / 19;
    const goal: LevelDef['goal'] =
      introduces === 'flakes' ? { kind: 'flakes', target: 8 } : introduces === 'swing' ? { kind: 'snow', target: 20 } : { kind: 'finish', target: 0 };
    out.push({
      id,
      chapter,
      name,
      seed: shimHash(`journey-${id}`),
      biome: chap.biome,
      forecast: 'clear',
      concepts,
      introduces,
      startMinute: 0,
      lengthMinutes: Math.round(360 + 360 * t),
      goal,
      stars: { flakes: Math.round(10 + 30 * t), minChill: Math.round(20 + 20 * t) },
      drain: Math.round(40 + 15 * t),
    });
  }
  return out;
}

export const CAMPAIGN_LEVELS: readonly LevelDef[] = buildCampaign();

export function levelDef(id: number): LevelDef | null {
  return Number.isInteger(id) && id >= 1 && id <= CAMPAIGN_LEVELS.length ? (CAMPAIGN_LEVELS[id - 1] as LevelDef) : null;
}

/** Stars of a passed level: 1 for passing, +1 for the flakes, +1 for the lowest Chill (0 when not passed). */
export function starsFor(level: LevelDef, stats: { flakes: number; minChill: number }, passed = true): 0 | 1 | 2 | 3 {
  if (!passed) return 0;
  let n = 1;
  if (stats.flakes >= level.stars.flakes) n += 1;
  if (stats.minChill >= level.stars.minChill) n += 1;
  return n as 1 | 2 | 3;
}
