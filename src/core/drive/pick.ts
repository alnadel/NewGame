// Controls v3 shared policy (docs/CONTROLS_V3.md §3.2, §3.3, §3.5, §10.2; CORE): the picks, the
// ignition and pour moments and the Gust floor, shared by the driver and the bots. The C0b contract:
// every export at its final signature, the picks −1 and the moments Infinity until C0c.

import type { ElObj, ElState } from '../objects.ts';
import type { SimState } from '../sim/types.ts';

/** §3.2: ticks from now to object i's ignition moment, for a verb that lands `lead` ticks after it is sent (≤ 0: now). */
export function emberDue(_s: SimState, _i: number, _lead: number): number {
  return Infinity;
}

/** §3.2: ticks from now to object i's last working tick (the walker one tick on); past it the target can no longer burn in time. */
export function emberLast(_s: SimState, _i: number): number {
  return Infinity;
}

/** §3.2: the object a press arms: the unarmed required wall with the earliest last working tick, else the earliest puddle (−1 none). */
export function emberPick(_s: SimState, _armed: Readonly<Int16Array>): number {
  return -1;
}

/** §3.3: the site a press pours into: the most urgent crossing, else the nearest plot not downwind, else any plot (−1 none). */
export function sproutPick(_s: SimState, _inJob: Readonly<Int16Array>): number {
  return -1;
}

/** §3.3: a job's goal: a crossing's need; a plot's treeMin, or size + step capped at treeMax. */
export function jobGoal(_o: ElObj): number {
  return Infinity;
}

/** Rain predicted over object o at some tick `from`..`to` ticks from now (no new gust), every 3 ticks. */
export function showered(_s: SimState, _el: ElState, _o: ElObj, _from: number, _to: number): boolean {
  return false;
}

/** A plot a later fire would reach: downwind of a bramble or gate in an Ember stretch while the breeze spreads fire. */
export function downwind(_s: SimState, _el: ElState, _p: ElObj): boolean {
  return false;
}

/** Weather of Gust's own stretch still ahead (not passed) that would cover the trail. */
export function ownAhead(_s: SimState, _el: ElState): boolean {
  return false;
}

/** §3.5: the Lift the governor keeps back (the policy's floor). */
export function gustFloor(_s: SimState, _el: ElState): number {
  return Infinity;
}
