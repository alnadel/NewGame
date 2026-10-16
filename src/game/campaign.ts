// Campaign (Journey) runs in the game layer (CAMPAIGN_PLAN §4): the run config of a level, the
// intro card's words, the goal line of the Results, and what the HUD's goal pill shows.
//
// v1.6 (docs/V1_6_PLAN.md §2.6): a level's Dares (LevelDef.feats; star 2 when it has any, else the
// flakes star) and its verb goals ('deep', 'swings', 'blooms'…) are named on the intro card, counted
// live on the HUD pill (the goal until it is met, then the Dare), shown with their counts on the
// Pause card and hinted at on the Results. Counts come from the core's featValue, or from the sim's
// `feat` events (`seen`) where those run ahead of it. After two missed goals the save relaxes the
// level's goal to the finish (RunConfig.relaxedGoal, the soft-fail).

import {
  campaignConfig as levelConfig,
  CONCEPTS,
  featMet,
  featValue,
  goalMet as coreGoalMet,
  goalValue as coreGoalValue,
  SOFT_FAIL_MISSES,
  type ConceptId,
  type FeatKind,
  type FeatSpec,
  type GoalKind,
  type LevelDef,
  type LevelStats,
  type RunConfig,
  type RunStats,
} from '../core/index.ts';

/** How long the run freezes on the FINISH stamp before the Results (s). */
export const FINISH_FREEZE_S = 1.0;
/** A tap this long after the finish skips the rest of the freeze. */
export const FINISH_SKIP_S = 0.35;
/** Goal misses on a level after which its goal relaxes to the finish (§2.6 soft-fail; the core's number). */
export { SOFT_FAIL_MISSES };

/** Live Dare counts from the sim's `feat` events (by kind), for counts the core's featValue doesn't have yet. */
export type FeatSeen = ReadonlyMap<FeatKind, number>;
const NONE: FeatSeen = new Map();

/** Stats as the campaign helpers read them (the Dare counters are optional). */
type Stats = Pick<LevelStats, 'flakes' | 'snow'> & Partial<LevelStats>;

/**
 * The config of a campaign level (§4): the core's campaignConfig (the level's seed, profile 3, no
 * tutorial chunk, no Day Plan, its concepts as mods, its drain, start time, biome and forecast)
 * plus the player's reduced motion, the first lesson on level 1 for a player who has not passed it
 * yet, and the soft-fail (`relaxed`: the goal scores as the finish). Never the comfort ladder.
 */
export function campaignConfig(level: LevelDef, reducedMotion: boolean, tutorialDone: boolean, relaxed = false): RunConfig {
  const base: Partial<RunConfig> = { reducedMotion };
  if (level.id === 1 && !tutorialDone) base.lesson = true;
  if (relaxed && level.goal.kind !== 'finish') base.relaxedGoal = true;
  return levelConfig(level.id, base);
}

/** The Dare kind a verb goal is worded and drawn with ('gate' as 'gates'; finish and Snow none). */
const goalFeat = (k: GoalKind): FeatKind | undefined => (k === 'gate' ? 'gates' : k === 'finish' || k === 'snow' ? undefined : (k as FeatKind));
/**
 * Verb goals the core counts with their Dare's own counter, so the sim's `feat` events may count
 * them live. The others count differently: 'gate' counts gateShaded (the Dare gateDeep),
 * 'snapSave' every snap-shaded tick (the Dare only earned snaps), 'flip' is met within its target
 * ticks of the flip (the Dare within 12).
 */
const goalCountsLikeDare = (k: GoalKind): boolean => k === 'deep' || k === 'clean' || k === 'swings' || k === 'blooms' || k === 'brittle' || k === 'parry';

/**
 * Each Dare's glyph (render/glyphs.ts) and short label: '#' is the target, '$' the target in
 * seconds (ticks), '*' a plural 's'.
 */
const FEAT_WORDS: Readonly<Record<FeatKind, readonly [string, string]>> = {
  blooms: ['sunflower', 'Bloom #'],
  swings: ['swing', '# SWING*'],
  deep: ['deep', '$ s deep'],
  snapSave: ['coldsnap', '$ s snap shade'],
  parry: ['flare', 'Parry #'],
  brittle: ['brittle', 'Save # glass'],
  flakes: ['frosty', '# flakes'],
  clean: ['glare', '# clean ball*'],
  ride: ['cloud', 'Ride a cloud'],
  gates: ['gate', 'Deep arch'],
  flip: ['eclipse', 'Shade the flip'],
  still: ['lock', 'Hold # lock*'],
  ring: ['ring', 'Reach ×#'],
};

/** Counts in ticks (shown in seconds). */
export function featInSeconds(kind: FeatKind): boolean {
  return kind === 'deep' || kind === 'snapSave';
}

const secs = (ticks: number): string => String(Math.round(ticks / 6) / 10);
const gusty = (level?: Pick<LevelDef, 'concepts'>): boolean => level?.concepts.includes('gusts') === true;

/** The Dare's (or verb goal's) glyph; a Gusts level's 'still' Dare is about gusts. */
export function featGlyph(kind: FeatKind, level?: Pick<LevelDef, 'concepts'>): string {
  return kind === 'still' && gusty(level) ? 'gusts' : FEAT_WORDS[kind][0];
}

/** A Dare's short label: "Bloom 2", "3 SWINGs", "2.5 s deep", "Parry 6", "Save 1 glass", "Reach ×4". */
export function featLabel(f: FeatSpec, level: Pick<LevelDef, 'concepts' | 'lengthMinutes'>): string {
  const t = f.target;
  const w = f.kind === 'still' && gusty(level) ? 'Hold # gust*' : FEAT_WORDS[f.kind][1];
  return w.replace('#', String(t)).replace('$', secs(t)).replace('*', t === 1 ? '' : 's');
}

/** The level's Dares as one line: "Bloom 2", or a finale's "Bloom 2 or Parry 6" ('' when it has none). */
export function dareText(level: LevelDef): string {
  return level.feats.map((f) => featLabel(f, level)).join(' or ');
}

/** Every Dare with its live count: "10 flakes 7/10 · or Parry 4 2/4" (a finale's two), "Bloom 2 1/2" (one). */
export function dareProgressText(level: LevelDef, stats: Stats, seen: FeatSeen = NONE): string {
  return level.feats.map((f) => `${featLabel(f, level)} ${countText(featLive(f.kind, stats, seen), f.target, featInSeconds(f.kind))}`).join(' · or ');
}

/** A Dare's live count: the core's featValue, or the sim's last `feat` event for it if that ran ahead. */
export function featLive(kind: FeatKind, stats: Stats, seen: FeatSeen = NONE): number {
  return Math.max(featValue(kind, stats as LevelStats), seen.get(kind) ?? 0);
}

/** Any of the level's Dares met (star 2 on a level with Dares). */
export function dareMet(level: LevelDef, stats: Stats, seen: FeatSeen = NONE): boolean {
  if (featMet(level, stats as LevelStats)) return true;
  for (const f of level.feats) if (featLive(f.kind, stats, seen) >= f.target) return true;
  return false;
}

/** The intro card's lines: "LEVEL 6", "Glass Garden", the concept line (icon id, name, blurb), the goal and the star rules. */
export interface IntroCard {
  kicker: string;
  title: string;
  concept: ConceptId | null;
  conceptName: string;
  blurb: string;
  goal: string;
  /** The three star rules: the goal ("Finish", "4 flakes", "20 Snow"), "6 flakes" or the Dare, "≤ 4 s in sun". */
  stars: [string, string, string];
  /** v1.6: the Dare line ("Dare · Bloom 2", '' none) and its glyph. */
  dare: string;
  dareGlyph: string | null;
}

export function introCard(level: LevelDef, relaxed = false): IntroCard {
  const c = level.introduces ? CONCEPTS[level.introduces] : null;
  const f = level.feats[0];
  return {
    kicker: `LEVEL ${level.id}`,
    title: level.name,
    concept: c?.id ?? null,
    conceptName: c ? conceptLabel(level, c.id) : conceptList(level),
    blurb: c?.blurb ?? '',
    goal: goalText(level, relaxed),
    stars: starRules(level, relaxed),
    dare: f ? `Dare · ${dareText(level)}` : '',
    dareGlyph: f ? featGlyph(f.kind, level) : null,
  };
}

/** The star rules' short labels (CAMPAIGN_PLAN §3: pass, the flakes or the Dare, a cool run). */
export function starRules(level: LevelDef, relaxed = false): [string, string, string] {
  const g = level.goal;
  const verb = goalFeat(g.kind);
  const pass = relaxed || g.kind === 'finish' ? 'Finish' : g.kind === 'snow' ? `${g.target} Snow` : verb ? verbGoalLabel(level, verb) : 'Finish';
  const two = level.feats.length > 0 ? (level.feats.length > 1 ? 'A Dare' : featLabel(level.feats[0] as FeatSpec, level)) : `${level.stars.flakes} flakes`;
  return [pass, two, `≤ ${Math.ceil(level.stars.sunSec)} s in sun`];
}

/**
 * The concept row's label on a teaching level: the concept's name, or "New concept" when the
 * catalog names the concept after the level itself (the card's title already says it).
 */
export function conceptLabel(level: Pick<LevelDef, 'name'>, id: ConceptId): string {
  const c = CONCEPTS[id];
  return c.name === level.name ? 'New concept' : c.name;
}

/** The names of a combination level's concepts, joined ("Gusts · Fog"). */
export function conceptList(level: LevelDef): string {
  return level.concepts.map((id) => CONCEPTS[id].name).join(' · ');
}

/** "Reach the finish", "Collect 8 flakes", "Score 20 Snow", or a verb goal's label ("1 SWING", "Bloom 1"…). */
export function goalText(level: LevelDef, relaxed = false): string {
  const g = level.goal;
  const verb = goalFeat(g.kind);
  return relaxed || !verb ? (g.kind === 'snow' && !relaxed ? `Score ${g.target} Snow` : 'Reach the finish') : verb === 'flakes' ? `Collect ${g.target} flakes` : verbGoalLabel(level, verb);
}

/** A verb goal's label: its Dare's words, except the 'gate' goal (the arch shaded, not deep). */
function verbGoalLabel(level: LevelDef, verb: FeatKind): string {
  return level.goal.kind === 'gate' ? 'Shade the arch' : featLabel({ kind: verb, target: level.goal.target }, level);
}

/**
 * A goal's live count: flakes, Snow, or the core's goalValue for a verb goal (raised by the sim's
 * `feat` events where the goal counts like its Dare); a 'flip' goal counts 1 once met.
 */
export function goalValue(level: LevelDef, stats: Stats, seen: FeatSeen = NONE): number {
  const g = level.goal;
  if (g.kind === 'snow') return Math.floor(stats.snow);
  if (g.kind === 'flakes') return stats.flakes;
  if (g.kind === 'finish') return 0;
  if (g.kind === 'flip') return coreGoalMet(level, stats as LevelStats) ? 1 : 0;
  const v = coreGoalValue(g.kind, stats as LevelStats);
  return goalCountsLikeDare(g.kind) ? Math.max(v, seen.get(g.kind as FeatKind) ?? 0) : v;
}

/** What goalValue counts toward: the goal's target ('flip': 1, met or not). */
export function goalTarget(level: LevelDef): number {
  return level.goal.kind === 'flip' ? 1 : level.goal.target;
}

/** A count against its target: "9/8", or "1.2/1.5 s" for ticks. */
export function countText(value: number, target: number, sec: boolean): string {
  return sec ? `${secs(value)}/${secs(target)} s` : `${Math.floor(value)}/${target}`;
}

/**
 * The Results goal line: "Collected 9/8 flakes", "Scored 24/20 Snow", "Reached the finish", or the
 * miss. A pass short of three stars adds what the next star needs ("Next ★: 12 flakes"). `misses`
 * (the level's goal misses, this one included) tells a missed player when the goal eases.
 */
export function goalLine(level: LevelDef, stats: Stats, passed: boolean, relaxed = false, seen: FeatSeen = NONE, misses = 0): string {
  const g = level.goal;
  const snow = Math.floor(stats.snow);
  const verb = relaxed ? undefined : goalFeat(g.kind);
  if (!passed) {
    if (relaxed || g.kind === 'finish') return 'Melted before the finish';
    const soft = misses >= SOFT_FAIL_MISSES ? ' · Next try: just reach the finish' : '';
    if (g.kind === 'flakes') return `Not enough flakes: ${stats.flakes}/${g.target}${soft}`;
    if (g.kind === 'snow') return `Not enough Snow: ${snow}/${g.target}${soft}`;
    if (verb) return `Goal missed: ${goalText(level)} (${countText(goalValue(level, stats, seen), goalTarget(level), featInSeconds(verb))})${soft}`;
    return 'Melted before the finish';
  }
  const line =
    relaxed || g.kind === 'finish'
      ? 'Reached the finish'
      : g.kind === 'flakes'
        ? `Collected ${stats.flakes}/${g.target} flakes`
        : g.kind === 'snow'
          ? `Scored ${snow}/${g.target} Snow`
          : `${goalText(level)} ✓`;
  return line + nextStarHint(level, stats, seen);
}

/** " · Next ★: …" for the first star a pass missed (the Dare's, or the flakes), or "" at three stars (or without the stats). */
export function nextStarHint(level: LevelDef, stats: Stats, seen: FeatSeen = NONE): string {
  const st = level.stars;
  const f = level.feats[0];
  if (f) {
    if (!dareMet(level, stats, seen)) {
      const sec = featInSeconds(f.kind);
      return ` · Next ★: ${level.feats.length > 1 ? dareProgressText(level, stats, seen) : `${dareText(level)} (${countText(featLive(f.kind, stats, seen), f.target, sec)})`}`;
    }
  } else if (stats.flakes < st.flakes) return ` · Next ★: ${st.flakes} flakes`;
  if (stats.litTotal === undefined || stats.minChill === undefined) return '';
  if (stats.litTotal > st.sunSec) return ` · Next ★: under ${Math.ceil(st.sunSec)} s in the sun (${Math.round(stats.litTotal)} s)`;
  if (stats.minChill < st.minChill) return ` · Next ★: keep Chill above ${st.minChill}`;
  return '';
}

/** The short miss line stamped at the finish of a failed goal. */
export function missLine(level: LevelDef): string {
  const k = level.goal.kind;
  return k === 'snow' ? 'NOT ENOUGH SNOW' : k === 'flakes' ? 'NOT ENOUGH FLAKES' : 'GOAL MISSED';
}

/** Star bits of a run in progress (starState): the goal is met, star 2 (the Dare, or the flakes) is earned, the cool run is lost. */
export const STAR_GOAL = 1;
export const STAR_FLAKES = 2;
export const STAR_COOL_LOST = 4;

/**
 * The stars so far, as bits (the HUD's pips, the Pause card): the goal met (a flakes, Snow or verb
 * goal reached; a finish or relaxed goal only at the line), star 2 earned (a Dare met on a level
 * with Dares, else the flakes star), and the cool run lost (Chill fell under stars.minChill or
 * Nubs spent more than stars.sunSec in the sun). starsFor's rules.
 */
export function starState(level: LevelDef, stats: Stats & Pick<RunStats, 'litTotal' | 'minChill'>, finished: boolean, relaxed = false, seen: FeatSeen = NONE): number {
  const goal = level.goal.kind === 'finish' || relaxed ? finished : goalMetLive(level, stats, seen);
  const two = level.feats.length > 0 ? dareMet(level, stats, seen) : stats.flakes >= level.stars.flakes;
  const cool = stats.minChill >= level.stars.minChill && stats.litTotal <= level.stars.sunSec;
  return (goal ? STAR_GOAL : 0) | (two ? STAR_FLAKES : 0) | (cool ? 0 : STAR_COOL_LOST);
}

/**
 * A flakes, Snow or verb goal already reached in the run (a finish goal: false until the line). A
 * verb goal is met by its live count (the pill's), which the core's goalMet scores the same way.
 */
export function goalMetLive(level: LevelDef, stats: Stats, seen: FeatSeen = NONE): boolean {
  const g = level.goal;
  if (g.kind === 'finish') return false;
  if (g.kind === 'flakes') return stats.flakes >= g.target;
  if (g.kind === 'snow') return stats.snow >= g.target;
  return goalFeat(g.kind) !== undefined && goalValue(level, stats, seen) >= goalTarget(level);
}

/** What the HUD's goal pill counts. */
export interface HudGoal {
  value: number;
  /** −1: plain Snow. */
  target: number;
  flakes: boolean;
  /** v1.6: a Dare's or verb goal's glyph (null: the flake), and a count in ticks shown as seconds. */
  glyph: string | null;
  sec: boolean;
}

/**
 * What the HUD's goal pill counts (into `out`, reused every frame): a goal until it is met (flakes,
 * Snow or a verb), then the level's first unmet Dare (or its first), else the met goal, else plain Snow.
 */
export function hudGoal(level: LevelDef | null, stats: Stats, out: HudGoal = { value: 0, target: -1, flakes: false, glyph: null, sec: false }, relaxed = false, seen: FeatSeen = NONE): HudGoal {
  out.flakes = false;
  out.glyph = null;
  out.sec = false;
  const g = level?.goal;
  const verb = g && !relaxed ? goalFeat(g.kind) : undefined;
  if (!level || !g || ((g.kind === 'finish' || relaxed) && level.feats.length === 0)) {
    out.value = Math.floor(stats.snow);
    out.target = -1;
    return out;
  }
  const goalCounts = !relaxed && g.kind !== 'finish';
  if (goalCounts && (level.feats.length === 0 || !goalMetLive(level, stats, seen))) {
    if (g.kind === 'snow') {
      out.value = Math.floor(stats.snow);
    } else {
      out.value = goalValue(level, stats, seen);
      out.flakes = g.kind === 'flakes';
      if (verb && verb !== 'flakes') {
        out.glyph = featGlyph(verb, level);
        out.sec = featInSeconds(verb);
      }
    }
    out.target = goalTarget(level);
    return out;
  }
  let f = level.feats[0] as FeatSpec;
  for (const d of level.feats) {
    if (featLive(d.kind, stats, seen) < d.target) {
      f = d;
      break;
    }
  }
  out.value = featLive(f.kind, stats, seen);
  out.target = f.target;
  out.flakes = f.kind === 'flakes';
  out.glyph = f.kind === 'flakes' ? null : featGlyph(f.kind, level);
  out.sec = featInSeconds(f.kind);
  return out;
}
