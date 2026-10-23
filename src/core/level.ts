// Campaign levels in core (CAMPAIGN_PLAN §2): resolving a RunConfig from a level, the level's
// progress along the trail, and the outcome (goal, stars) of a run on it. Elementals Trials
// (docs/ELEMENTALS.md §3.0) run through the same flow with their own LevelDef (trialLevel).

import { goalMet, starsFor, type LevelDef } from '../config/campaign.ts';
import { anyLevelDef, trialDef, trialStars } from '../config/trials.ts';
import { dayStartTick, dayTicks, tickAtMinute, TICK_HZ } from './clock.ts';
import type { RunLevel } from './sim/events.ts';
import { V16_NONE, type RunConfig, type SimState } from './sim/types.ts';

/** Day and tick after dawn of an in-game minute count (see clock.ts tickAtMinute). */
export function minuteStart(minutes: number): { day: number; dayTick: number } {
  const tick = tickAtMinute(minutes);
  let day = 1;
  while (dayStartTick(day + 1) <= tick) day++;
  return { day, dayTick: Math.min(dayTicks(day) - 1, tick - dayStartTick(day)) };
}

/**
 * The RunConfig of a campaign level: seed, profile 3, tutorial off, plan off, the level's forecast
 * (when not clear), biome, start day and time, drain and mods. `base` supplies the rest
 * (reducedMotion, lesson, mode); the level's fields always win, so the level is the run's identity.
 * A Trial adds its mechanics, every v1.6 rule off and one ability charge.
 */
export function campaignConfig(id: number, base: Partial<RunConfig> = {}): RunConfig {
  const level = anyLevelDef(id);
  if (!level) throw new Error(`unknown campaign level ${id}`);
  const start = minuteStart(level.startMinute);
  const cfg: RunConfig = {
    reducedMotion: false,
    ...base,
    seed: level.seed,
    mode: 'campaign',
    profile: 3,
    tutorial: false,
    plan: false,
    level: level.id,
    mods: level.concepts,
    biome: level.biome,
    drain: level.drain,
    startDay: start.day,
    startT: start.dayTick / TICK_HZ,
  };
  if (level.forecast !== 'clear') cfg.forecast = level.forecast;
  else delete cfg.forecast;
  const trial = trialDef(id);
  if (trial) {
    cfg.mechanics = trial.mech;
    cfg.v16 = V16_NONE;
    cfg.startFrost = 1;
  }
  return cfg;
}

/** `cfg` itself when it names no level; otherwise the level's config (campaignConfig) over it. */
export function resolveLevelConfig(cfg: RunConfig): RunConfig {
  return cfg.level === undefined ? cfg : campaignConfig(cfg.level, cfg);
}

/** Progress along a campaign level, 0 at the start line to 1 at the finish (0 outside the campaign). */
export function levelProgress(s: SimState): number {
  const w = s.world;
  if (!w.level || !Number.isFinite(w.finishY)) return 0;
  const p = (s.nubs.y - w.startY) / (w.finishY - w.startY);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/**
 * The outcome of a campaign run: passed and stars once the finish line was crossed (phase 'won'),
 * else 0. v1.6: RunConfig.relaxedGoal (the soft-fail) scores the goal as 'finish'. A Trial is
 * never relaxed and scores trialStars.
 */
export function levelOutcome(level: LevelDef, s: SimState): RunLevel {
  const won = s.phase === 'won';
  const trial = s.trial;
  const relaxed = !trial && s.cfg.relaxedGoal === true;
  const passed = won && goalMet(level, s.stats, relaxed);
  const stars = trial ? trialStars(trial, s.stats, passed) : passed ? starsFor(level, s.stats, relaxed) : 0;
  return { id: level.id, passed, stars, introduces: level.introduces };
}
