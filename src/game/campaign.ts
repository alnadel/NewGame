// Campaign (Journey) runs in the game layer (CAMPAIGN_PLAN §4): the run config of a level, the
// intro card's words, the goal line of the Results, and what the HUD's goal pill shows.

import { campaignConfig as levelConfig, CONCEPTS, type ConceptId, type LevelDef, type RunConfig, type RunStats } from '../core/index.ts';

/** How long the run freezes on the FINISH stamp before the Results (s). */
export const FINISH_FREEZE_S = 1.0;

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

/** The intro card's lines: "LEVEL 6", "Glass Garden", and the concept line (icon id, name, blurb). */
export interface IntroCard {
  kicker: string;
  title: string;
  concept: ConceptId | null;
  conceptName: string;
  blurb: string;
  goal: string;
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
  };
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

/** The Results goal line: "Collected 9/8 flakes", "Scored 24/20 Snow", "Reached the finish", or the miss. */
export function goalLine(level: LevelDef, stats: Pick<RunStats, 'flakes' | 'snow'>, passed: boolean): string {
  const g = level.goal;
  if (g.kind === 'flakes') return passed ? `Collected ${stats.flakes}/${g.target} flakes` : `Not enough flakes: ${stats.flakes}/${g.target}`;
  if (g.kind === 'snow') return passed ? `Scored ${Math.floor(stats.snow)}/${g.target} Snow` : `Not enough Snow: ${Math.floor(stats.snow)}/${g.target}`;
  return passed ? 'Reached the finish' : 'Melted before the finish';
}

/** The short miss line stamped at the finish of a failed goal. */
export function missLine(level: LevelDef): string {
  return level.goal.kind === 'snow' ? 'NOT ENOUGH SNOW' : 'NOT ENOUGH FLAKES';
}

/** What the HUD's goal pill counts: flakes/target, snow/target, or plain Snow (−1 target). */
export function hudGoal(level: LevelDef | null, stats: Pick<RunStats, 'flakes' | 'snow'>): { value: number; target: number; flakes: boolean } {
  if (!level || level.goal.kind === 'finish') return { value: Math.floor(stats.snow), target: -1, flakes: false };
  if (level.goal.kind === 'flakes') return { value: stats.flakes, target: level.goal.target, flakes: true };
  return { value: Math.floor(stats.snow), target: level.goal.target, flakes: false };
}
