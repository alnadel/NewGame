// Controls v3 aim help (docs/CONTROLS_V3.md §4; CORE): the capture radius per run (§4.3) and where a
// lift would settle (§4.2). The C0b contract: aimRadius is the full table; settleTarget returns NaN
// (it would not move) until the magnet lands.

import { TRIAL_BASE } from '../../config/trials.ts';
import { AIM_OVERRIDE, TUNING } from '../../config/tuning.ts';
import type { RunConfig, SimState } from '../sim/types.ts';
import type { AimSetting } from './driver.ts';

const A = TUNING.drive.aim;

/**
 * §4.3: the capture radius (°; 0 off) and whether the magnet tracks, for a run. `level` is
 * RunConfig.level (a Trial's id, 1001..1007), `rung` the Endless comfort rung (−1 none). Standard
 * follows the schedule (Journey 14/12/10 by L1-40, 41-100, 101-200; Endless R0-R4 14, 14, 14, 12,
 * 10; Daily and challenges 10; Trials 14) unless AIM_OVERRIDE names the level, Trial or rung; Strong
 * is 14, Light 8 without track, Off and 'blind' levels 0.
 */
export function aimRadius(setting: AimSetting, ctx: { mode: RunConfig['mode']; level: number | null; rung: number; trial: boolean; blind: boolean }): { deg: number; track: boolean } {
  if (ctx.blind || setting === 'off') return { deg: 0, track: false };
  if (setting !== 'standard') return { deg: setting === 'light' ? A.light : A.strong, track: setting === 'strong' };
  const l = ctx.level ?? 1;
  const camp = ctx.mode === 'campaign';
  const endless = ctx.mode === 'endless';
  const o = AIM_OVERRIDE[ctx.trial ? `T${l - TRIAL_BASE}` : camp ? `L${l}` : endless ? `R${ctx.rung}` : ''];
  if (o) return { deg: o.deg, track: o.track };
  // Endless runs off the ladder (rung −1) play the standard rules: R4's radius.
  const deg = ctx.trial ? A.trials : camp ? A.journey[l <= 40 ? 0 : l <= 100 ? 1 : 2] : endless ? (A.endless[ctx.rung] ?? A.endless[4]) : A.daily;
  return { deg: deg as number, track: true };
}

/** §4.2: where a lift at θ would settle now (NaN: it would not move). Allocation-free; the dial preview and the tests use it. */
export function settleTarget(_s: SimState, _theta: number, _aimDeg: number, _nowOnly: boolean): number {
  return NaN;
}
