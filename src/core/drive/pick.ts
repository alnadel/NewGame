// Controls v3 shared policy (docs/CONTROLS_V3.md §3.2, §3.3, §3.5, §10.2; CORE): the ignition moment,
// the shower and downwind tests and the Gust floor with its weather test, shared by the driver and
// the bots (bots/elements.ts calls these instead of its private copies; the refactor's proof commit
// of §9.3 keeps every Trial hash). The picks, the last working tick and the job goals are stubs until
// the driver's commit.

import { TUNING } from '../../config/tuning.ts';
import { worldYAtTick } from '../gen/plan.ts';
import { EL_GONE, type ElObj, type ElState } from '../objects.ts';
import { arriveTicks, burnLeft, contactTicks, nextTagTicks, walkerAt, weatherXAt } from '../sim/elements.ts';
import type { SimState } from '../sim/types.ts';
import { trailX } from '../trail.ts';

const E = TUNING.elements;
const O = E.objects;
const FI = E.fire;
const DE = TUNING.drive.ember;
const DG = TUNING.drive.gust;

/** The walker's pace now (u per tick). */
export function paceOf(s: SimState): number {
  return worldYAtTick(s.world, s.tickAbs + 1) - s.nubs.y;
}

/** Ticks object o burns once lit (0 for a kind that does not burn). */
export function burnTicksOf(o: ElObj): number {
  return (E.ember.burnTicks as Partial<Record<string, number>>)[o.kind] ?? 0;
}

/** A bramble or gate Ember itself will reach (its own fire feeds it). */
export function ownWall(s: SimState, o: ElObj): boolean {
  return (o.kind === 'bramble' || o.kind === 'gate') && walkerAt(s, o.y - O.wallDepth / 2) === 'ember';
}

/** Ticks left to light ice or a wall another walker reaches: it must burn out first, and be lit `tagMargin` ticks before the next TAG. */
export function emberLeft(s: SimState, o: ElObj, tagMargin: number): number {
  const n = nextTagTicks(s);
  return Math.min(burnLeft(s, o), n < 0 ? Infinity : n - tagMargin);
}

/**
 * §3.2: ticks from now to object i's ignition moment (≤ 0: now) for a verb that lands `lead` ticks
 * after it is sent (the driver 0, the bots their press lead): an own bramble or gate in the middle of
 * its sweet window; ice or a wall another walker reaches once emberLeft is within nowTicks; a puddle
 * on Ember's path dryTicks before contact while Flame is above dryFlame (else never: Ember wades
 * it). Showers are the caller's (showered). `tagMargin`: the TAG margin of emberLeft (the bots keep
 * their own).
 */
export function emberDue(s: SimState, i: number, lead: number, tagMargin: number = DE.tagMargin): number {
  const o = (s.el as ElState).objs[i] as ElObj;
  if (o.kind === 'puddle') return s.nubs.chill <= DE.dryFlame ? Infinity : contactTicks(s, o) - lead - DE.dryTicks;
  if (o.kind !== 'bramble' && o.kind !== 'gate' && o.kind !== 'ice') return Infinity;
  if (!ownWall(s, o)) return emberLeft(s, o, tagMargin) - lead - E.ember.nowTicks;
  const pace = paceOf(s);
  return (o.y - O.wallDepth / 2 - s.nubs.y - lead * pace - (burnTicksOf(o) * pace + E.near) / 2) / pace;
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
export function showered(s: SimState, el: ElState, o: ElObj, from: number, to: number): boolean {
  for (let j = 0; j < el.objs.length; j++) {
    const r = el.objs[j] as ElObj;
    if (r.kind !== 'rain' || r.state === EL_GONE || Math.abs(r.y - o.y) > r.r) continue;
    for (let k = from; k <= to; k += 3) {
      const ex = (o.x - weatherXAt(s, r, k)) / r.r;
      const ey = (o.y - r.y) / (E.weather.ryRatio * r.r);
      if (ex * ex + ey * ey <= 1) return true;
    }
  }
  return false;
}

/** A plot a later fire would reach: downwind of a bramble or gate in an Ember stretch while the breeze spreads fire. */
export function downwind(s: SimState, el: ElState, p: ElObj): boolean {
  const b = s.trial?.breeze ?? 0;
  if (b < FI.spreadAt && b > -FI.spreadAt) return false;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if ((o.kind !== 'bramble' && o.kind !== 'gate') || o.state === EL_GONE || walkerAt(s, o.y) !== 'ember') continue;
    const dx = p.x - o.x;
    if (Math.abs(p.y - o.y) <= FI.reachY && Math.abs(dx) <= FI.reach && (b < 0 ? -dx : dx) >= -FI.upwind) return true;
  }
  return false;
}

/**
 * 1 − (predicted offset / r)² of weather o from the trail as the walker reaches its centre and as it
 * reaches half its far side (the larger: a cloud the walker is already entering still counts).
 */
export function overlapQ(s: SimState, o: ElObj, ry: number): number {
  const tr = s.world.trail;
  const n = arriveTicks(s, o.y);
  const a = (weatherXAt(s, o, n < 0 ? 0 : n) - trailX(tr, o.y)) / o.r;
  const m = arriveTicks(s, o.y + ry / 2);
  const b = (weatherXAt(s, o, m < 0 ? 0 : m) - trailX(tr, o.y)) / o.r;
  return 1 - Math.min(a * a, b * b);
}

/** Weather of Gust's own stretch still ahead (not passed) that would cover the trail. */
export function ownAhead(s: SimState, el: ElState): boolean {
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.state === EL_GONE || (o.kind !== 'rain' && o.kind !== 'fog')) continue;
    const ry = E.weather.ryRatio * o.r;
    if (o.y + ry < s.nubs.y || walkerAt(s, o.y) !== 'gust') continue;
    if (overlapQ(s, o, ry) > 0) return true;
  }
  return false;
}

/**
 * §3.5: the Lift the governor keeps back (the policy's floor): `lift` while weather of Gust's own
 * stretch can still soak it, else one gust's price (costMul applied) + `gain`.
 */
export function gustFloor(s: SimState, el: ElState): number {
  return ownAhead(s, el) ? DG.lift : E.gust.swipe * (s.trial?.tune.costMul ?? 1) + DG.gain;
}
