// Campaign (Journey) runs in the game layer (CAMPAIGN_PLAN §4): the run config of a level, the
// intro card's words, the goal line of the Results, and what the HUD's goal pill shows.

import { campaignConfig as levelConfig, CONCEPTS, type ConceptId, type LevelDef, type RunConfig, type RunStats } from '../core/index.ts';

/** How long the run freezes on the FINISH stamp before the Results (s). */
export const FINISH_FREEZE_S = 1.0;
/** A tap this long after the finish skips the rest of the freeze. */
export const FINISH_SKIP_S = 0.35;

/**
 * The config of a campaign level (§4): the core's campaignConfig (the level's seed, profile 3, no
 * tutorial chunk, no Day Plan, its concepts as mods, its drain, start time, biome and forecast)
 * plus the player's reduced motion and the first lesson on level 1 for a player who has not
 * passed it yet. Never the comfort ladder.
 */
export function campaignConfig(level: LevelDef, reducedMotion: boolean, tutorialDone: boolean): RunConfig {
  const base: Partial<RunConfig> = { reducedMotion };
  if (level.id === 1 && !tutorialDone) base.lesson = true;
  return levelConfig(level.id, base);
}

/** The intro card's lines: "LEVEL 6", "Glass Garden", the concept line (icon id, name, blurb), the goal and the star rules. */
export interface IntroCard {
  kicker: string;
  title: string;
  concept: ConceptId | null;
  conceptName: string;
  blurb: string;
  goal: string;
  /** The three star rules: the goal ("Finish", "4 flakes", "20 Snow"), "6 flakes", "≤ 4 s in sun". */
  stars: [string, string, string];
}

export function introCard(level: LevelDef): IntroCard {
  const c = level.introduces ? CONCEPTS[level.introduces] : null;
  return {
    kicker: `LEVEL ${level.id}`,
    title: level.name,
    concept: c?.id ?? null,
    conceptName: c ? conceptLabel(level, c.id) : conceptList(level),
    blurb: c?.blurb ?? '',
    goal: goalText(level),
    stars: starRules(level),
  };
}

/** The star rules' short labels (CAMPAIGN_PLAN §3: pass, the flakes, a cool run). */
export function starRules(level: LevelDef): [string, string, string] {
  const g = level.goal;
  const pass = g.kind === 'flakes' ? `${g.target} flakes` : g.kind === 'snow' ? `${g.target} Snow` : 'Finish';
  return [pass, `${level.stars.flakes} flakes`, `≤ ${Math.ceil(level.stars.sunSec)} s in sun`];
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

/** "Reach the finish", "Collect 8 flakes", "Score 20 Snow". */
export function goalText(level: LevelDef): string {
  const g = level.goal;
  if (g.kind === 'flakes') return `Collect ${g.target} flakes`;
  if (g.kind === 'snow') return `Score ${g.target} Snow`;
  return 'Reach the finish';
}

/**
 * The Results goal line: "Collected 9/8 flakes", "Scored 24/20 Snow", "Reached the finish", or the
 * miss. A pass short of three stars adds what the next star needs ("Next ★: 12 flakes").
 */
export function goalLine(level: LevelDef, stats: Pick<RunStats, 'flakes' | 'snow'> & Partial<Pick<RunStats, 'litTotal' | 'minChill'>>, passed: boolean): string {
  const g = level.goal;
  const snow = Math.floor(stats.snow);
  if (!passed) {
    if (g.kind === 'flakes') return `Not enough flakes: ${stats.flakes}/${g.target}`;
    if (g.kind === 'snow') return `Not enough Snow: ${snow}/${g.target}`;
    return 'Melted before the finish';
  }
  const line = g.kind === 'flakes' ? `Collected ${stats.flakes}/${g.target} flakes` : g.kind === 'snow' ? `Scored ${snow}/${g.target} Snow` : 'Reached the finish';
  return line + nextStarHint(level, stats);
}

/** " · Next ★: …" for the first star a pass missed, or "" at three stars (or without the stats). */
export function nextStarHint(level: LevelDef, stats: Pick<RunStats, 'flakes'> & Partial<Pick<RunStats, 'litTotal' | 'minChill'>>): string {
  const st = level.stars;
  if (stats.flakes < st.flakes) return ` · Next ★: ${st.flakes} flakes`;
  if (stats.litTotal === undefined || stats.minChill === undefined) return '';
  if (stats.litTotal > st.sunSec) return ` · Next ★: under ${Math.ceil(st.sunSec)} s in the sun (${Math.round(stats.litTotal)} s)`;
  if (stats.minChill < st.minChill) return ` · Next ★: keep Chill above ${st.minChill}`;
  return '';
}

/** The short miss line stamped at the finish of a failed goal. */
export function missLine(level: LevelDef): string {
  return level.goal.kind === 'snow' ? 'NOT ENOUGH SNOW' : 'NOT ENOUGH FLAKES';
}

/** Star bits of a run in progress (starState): the goal is met, the flakes star is earned, the cool run is lost. */
export const STAR_GOAL = 1;
export const STAR_FLAKES = 2;
export const STAR_COOL_LOST = 4;

/**
 * The stars so far, as bits (the HUD's pips, the Pause card): the goal met (a flakes or Snow goal
 * reached; a finish goal only at the line), the flakes star earned, and the cool run lost (Chill
 * fell under stars.minChill or Nubs spent more than stars.sunSec in the sun). starsFor's rules.
 */
export function starState(level: LevelDef, stats: Pick<RunStats, 'flakes' | 'snow' | 'litTotal' | 'minChill'>, finished: boolean): number {
  const goal = level.goal.kind === 'finish' ? finished : goalMetLive(level, stats);
  const cool = stats.minChill >= level.stars.minChill && stats.litTotal <= level.stars.sunSec;
  return (goal ? STAR_GOAL : 0) | (stats.flakes >= level.stars.flakes ? STAR_FLAKES : 0) | (cool ? 0 : STAR_COOL_LOST);
}

/** A flakes or Snow goal already reached in the run (a finish goal: false until the line). */
export function goalMetLive(level: LevelDef, stats: Pick<RunStats, 'flakes' | 'snow'>): boolean {
  const g = level.goal;
  return g.kind === 'flakes' ? stats.flakes >= g.target : g.kind === 'snow' ? stats.snow >= g.target : false;
}

/** What the HUD's goal pill counts: flakes/target, snow/target, or plain Snow (−1 target). */
export function hudGoal(level: LevelDef | null, stats: Pick<RunStats, 'flakes' | 'snow'>): { value: number; target: number; flakes: boolean } {
  if (!level || level.goal.kind === 'finish') return { value: Math.floor(stats.snow), target: -1, flakes: false };
  if (level.goal.kind === 'flakes') return { value: stats.flakes, target: level.goal.target, flakes: true };
  return { value: Math.floor(stats.snow), target: level.goal.target, flakes: false };
}
