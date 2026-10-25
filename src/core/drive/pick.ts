// Controls v3 shared policy (docs/CONTROLS_V3.md §3.2, §3.3, §3.5, §10.2; CORE): Ember's ignition
// moment, last working tick and pick, Sprout's pick and job goals, the shower and downwind tests and
// the Gust floor with its weather test. The driver plays them; the bots (bots/elements.ts) call the
// moment, the tests and the floor instead of their private copies (the refactor's proof commit of §9.3
// kept every Trial hash). Every read is for the state step() will see: it walks one tick before it
// resolves a verb.

import { TUNING } from '../../config/tuning.ts';
import { worldYAtTick } from '../gen/plan.ts';
import { EL_GONE, EL_IDLE, type ElObj, type ElState } from '../objects.ts';
import {
  arriveTicks,
  burnLeft,
  burnTarget,
  burnTicksOf,
  contactTicks,
  edgeOf,
  growLeft,
  growTarget,
  isCrossing,
  isWall,
  needOf,
  nextTagTicks,
  ownWall,
  walkerAt,
  weatherXAt,
} from '../sim/elements.ts';
import type { SimState } from '../sim/types.ts';
import { trailX } from '../trail.ts';

const E = TUNING.elements;
const O = E.objects;
const FI = E.fire;
const SP = E.sprout;
const DE = TUNING.drive.ember;
const DS = TUNING.drive.sprout;
const DG = TUNING.drive.gust;

/** The walker's pace now (u per tick). */
export function paceOf(s: SimState): number {
  return worldYAtTick(s.world, s.tickAbs + 1) - s.nubs.y;
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
  if (!isWall(o.kind)) return Infinity;
  if (!ownWall(s, o)) return emberLeft(s, o, tagMargin) - lead - E.ember.nowTicks;
  const pace = paceOf(s);
  return (o.y - O.wallDepth / 2 - s.nubs.y - lead * pace - (burnTicksOf(o) * pace + E.near) / 2) / pace;
}

/** The point a verb on object o is sent at: a puddle's or plot's centre, else its trail point. */
export function targetX(s: SimState, o: ElObj): number {
  return o.kind === 'puddle' || o.kind === 'plot' ? o.x : trailX(s.world.trail, o.y);
}

/** Ticks from now to the last tick a verb sent then still finds object o's contact edge `near` ahead, the walker one tick on (< 0: past). */
export function nearLast(s: SimState, o: ElObj): number {
  const pace = paceOf(s);
  return (edgeOf(o) - s.nubs.y - pace - E.near) / pace;
}

/**
 * §3.2: ticks from now to object i's last working tick (≥ 0: a tap sent now still burns it in time),
 * the walker one tick on: an own bramble or gate, or a puddle, while its contact edge stays `near`
 * ahead; ice and others' walls while emberLeft (the driver's TAG margin) is at least 1.
 */
export function emberLast(s: SimState, i: number): number {
  const o = (s.el as ElState).objs[i] as ElObj;
  return o.kind === 'puddle' || ownWall(s, o) ? nearLast(s, o) : emberLeft(s, o, DE.tagMargin) - 1;
}

/**
 * §3.2: the object a press arms (−1 none): the unarmed required wall (bramble, gate, ice) with the
 * earliest last working tick (ties: the nearer contact edge, then the lower index); only when none is
 * in range, the unarmed puddle with the earliest. Each is `near..range` ahead, still workable and a
 * target its own point resolves to (burnTarget).
 */
export function emberPick(s: SimState, armed: Readonly<Int16Array>): number {
  const el = s.el;
  if (el === null || s.nubs.hero !== 'ember') return -1;
  let best = -1;
  let bestWall = false;
  let bestLast = Infinity;
  let bestEdge = Infinity;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    const wall = isWall(o.kind);
    if (o.state !== EL_IDLE || (!wall && (o.kind !== 'puddle' || bestWall)) || armed[0] === i || armed[1] === i) continue;
    const ahead = edgeOf(o) - s.nubs.y;
    if (ahead < E.near || ahead > E.range) continue;
    const last = emberLast(s, i);
    if (last < 0 || (wall === bestWall && (last > bestLast || (last === bestLast && ahead >= bestEdge)))) continue;
    if (burnTarget(s, targetX(s, o), o.y) !== i) continue;
    best = i;
    bestWall = wall;
    bestLast = last;
    bestEdge = ahead;
  }
  return best;
}

/**
 * §3.3: the site a press pours into (−1 none): the unbridged crossing with the least growLeft; else
 * the nearest plot without a tree that is not downwind; else the nearest such plot even if downwind.
 * Each can still take Sap, is not in a job (`inJob`), still starts a hold one tick on and resolves to
 * itself at its point (growTarget).
 */
export function sproutPick(s: SimState, inJob: Readonly<Int16Array>): number {
  const el = s.el;
  if (el === null || s.nubs.hero !== 'sprout') return -1;
  let best = -1;
  // 0 a crossing (by growLeft), 1 a plot, 2 a downwind plot (by y).
  let rank = 3;
  let key = Infinity;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    const c = isCrossing(o.kind);
    if (o.state === EL_GONE || (!c && (o.kind !== 'plot' || o.casterId >= 0 || rank === 0)) || inJob[0] === i || inJob[1] === i || o.size >= needOf(o)) continue;
    const r = c ? 0 : downwind(s, el, o) ? 2 : 1;
    const k = c ? growLeft(s, o) : o.y;
    if (r > rank || (r === rank && k >= key) || nearLast(s, o) < 0 || growTarget(s, targetX(s, o), o.y) !== i) continue;
    best = i;
    rank = r;
    key = k;
  }
  return best;
}

/** §3.3: a job's goal: a crossing's need; a plot's treeMin, or (grown past it) size + step, at most treeMax. */
export function jobGoal(o: ElObj): number {
  if (o.kind !== 'plot') return needOf(o);
  return o.size < SP.treeMin ? SP.treeMin : Math.min(o.size + DS.step, SP.treeMax);
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
