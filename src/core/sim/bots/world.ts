// v1.6 world and Journey terms of the bots (docs/V1_6_PLAN.md §2.3, §2.5, §2.6; CORE-2 owns this
// file): the reactive bot's glass terms and preAim (the nearest guide.flare bin in a warning's last
// 18 ticks), the oracle's glass and Feat terms, and humanFeat's Dare focus. bots.ts calls these
// hooks at fixed points; the contract stubs change nothing. No allocation per call.

import type { BotHookCtx } from '../bots.ts';
import type { SimState } from '../types.ts';

/** Reactive bot, each guide refresh: add world terms to `score` (360 bins, already holding now/next/gold). */
export function worldReactiveScore(_ctx: BotHookCtx, _s: SimState, _score: Float64Array): void {}

/** Reactive bot, every tick: the bin to steer to (`target` is the score's pick; preAim may override it). */
export function worldReactiveAim(_ctx: BotHookCtx, _s: SimState, target: number): number {
  return target;
}

/** Oracle, each plan: a bonus (Chill units) for bin `b` with this slack, added to its value. */
export function worldOracleBonus(_ctx: BotHookCtx, _s: SimState, _b: number, _slack: number): number {
  return 0;
}

/** humanFeat, each decision: the aim target (`target` is humanDial's pick; the Dare focus may replace it). */
export function worldHumanTarget(_ctx: BotHookCtx, _s: SimState, target: number): number {
  return target;
}
