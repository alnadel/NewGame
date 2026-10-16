// v1.6 economy terms of the bots (docs/V1_6_PLAN.md §2.1, §2.2, §2.4; CORE-1 owns this file):
// the reactive bot's fresh-SWING preference and policies (plain, chase, naive, safe), its snap rule
// (panic or plan, the overflow charge, the Garden's gold and guide.land) and the oracle's snap and
// landing terms. bots.ts calls these hooks at fixed points; the contract stubs change nothing.
// No allocation per call.

import type { BotHookCtx } from '../bots.ts';
import type { SimState } from '../types.ts';

/** Reactive bot, each guide refresh: add economy terms to `score` (360 bins, already holding now/next/gold). */
export function econReactiveScore(_ctx: BotHookCtx, _s: SimState, _score: Float64Array): void {}

/** Reactive bot, every tick: whether to cast a snap (`snap` is the v1.5 panic rule's answer). */
export function econReactiveSnap(_ctx: BotHookCtx, _s: SimState, snap: boolean): boolean {
  return snap;
}

/** Oracle, each plan: a bonus (Chill units) for bin `b` with this slack, added to its value. */
export function econOracleBonus(_ctx: BotHookCtx, _s: SimState, _b: number, _slack: number): number {
  return 0;
}

/** Oracle, each plan: whether to snap next tick (`snap` is the v1.5 rule's answer, `slack` the best bin's). */
export function econOracleSnap(_ctx: BotHookCtx, _s: SimState, snap: boolean, _slack: number): boolean {
  return snap;
}
