// Elementals v2 core bots (docs/ELEMENTALS_V2.md §6.3; CORE owns this file): the policy the
// reactive bot hands each element leg of a Trial to. bots.ts calls elPolicy after its Nubs play has
// filled the frame; Nubs legs keep that play. No allocation per call; stateless (the Gust pace keys
// off the leg's tick count), so one bot can play any number of runs.
//
// Skeleton (C0c): the minimal policy that exercises the object states. Ember taps each wall when
// burnSweet and dries the puddles on its path; Sprout holds the nearest unbridged crossing until its
// need, then a bare plot into a tree; Drip steers toward the nearest puddle ahead; Gust swipes the
// weather predicted on the trail away. The §6.3 policies (shower checks, urgency, lane scores, swipe
// scores, the input contract's press timing, noise by salt) are CORE's branch work.

import { TUNING } from '../../../config/tuning.ts';
import { EL_GONE, EL_IDLE, type ElObj, type ElState } from '../../objects.ts';
import { trailX } from '../../trail.ts';
import { arriveTicks, burnSweet, burnTarget, contactTicks, growTarget, needOf, weatherXAt } from '../elements.ts';
import { VERB_EAST, VERB_HOLD, VERB_RELEASE, VERB_TAP, VERB_WEST, type InputFrame, type SimState } from '../types.ts';

const E = TUNING.elements;
/** Sap a plot gets before the hold lets go (between treeMin and treeMax: a mid-size tree). */
const PLOT_SAP = 40;
/** Ember dries a puddle on its path this many ticks before reaching it. */
const DRY_TICKS = 60;
/** Gust swipes at most once per this many ticks of its leg. */
const SWIPE_EVERY = 15;

/** Ground points enter the frame on the 1/8 u grid, steers on the 1/64 u grid (§7.9). */
const q8 = (v: number): number => Math.round(v * 8) / 8;
const q64 = (v: number): number => Math.round(v * 64) / 64;

/**
 * Fills the element fields of the reactive bot's frame `f` for the walking element (Trials only);
 * `salt` will draw the §6.3 noise (unused by the skeleton). Verb frames carry no turn.
 */
export function elPolicy(s: SimState, f: InputFrame, _salt: number): void {
  const el = s.el;
  if (el === null) return;
  f.verb = 0;
  f.vx = 0;
  f.vy = 0;
  f.steer = 0;
  if (s.phase !== 'day' || s.ready > 0) return;
  const hero = s.nubs.hero;
  if (hero === 'ember') ember(s, el, f);
  else if (hero === 'sprout') sprout(s, el, f);
  else if (hero === 'drip') drip(s, el, f);
  else if (hero === 'gust') gust(s, el, f);
}

/** Ember: taps the first wall whose tap is just in time now, or dries a puddle on its path DRY_TICKS before it. */
function ember(s: SimState, el: ElState, f: InputFrame): void {
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.state !== EL_IDLE) continue;
    const wall = o.kind === 'bramble' || o.kind === 'gate' || o.kind === 'ice';
    if (wall ? !burnSweet(s, o) : o.kind !== 'puddle' || contactTicks(s, o) > DRY_TICKS) continue;
    const x = q8(wall ? trailX(s.world.trail, o.y) : o.x);
    const y = q8(o.y);
    if (burnTarget(s, x, y) !== i) continue;
    act(f, VERB_TAP, x, y);
    return;
  }
}

/** Sprout: holds the nearest unbridged crossing until its need, else the nearest bare plot to PLOT_SAP. */
function sprout(s: SimState, el: ElState, f: InputFrame): void {
  if (el.hold >= 0) {
    const o = el.objs[el.hold] as ElObj;
    f.dTheta = 0;
    if (o.size >= (o.kind === 'plot' ? PLOT_SAP : needOf(o))) f.verb = VERB_RELEASE;
    return;
  }
  let plot = -1;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.state === EL_GONE) continue;
    const cross = o.kind === 'gap' || o.kind === 'stream';
    if (cross ? o.size >= needOf(o) : o.kind !== 'plot' || o.casterId >= 0 || o.size >= PLOT_SAP) continue;
    const x = q8(cross ? trailX(s.world.trail, o.y) : o.x);
    const y = q8(o.y);
    if (growTarget(s, x, y) !== i) continue;
    if (cross) {
      act(f, VERB_HOLD, x, y);
      return;
    }
    if (plot < 0) plot = i;
  }
  if (plot >= 0) {
    const o = el.objs[plot] as ElObj;
    act(f, VERB_HOLD, q8(o.x), q8(o.y));
  }
}

/** Drip: steers toward the nearest puddle ahead (its offset from the trail), else back to the middle. */
function drip(s: SimState, el: ElState, f: InputFrame): void {
  let want = 0;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    const ahead = o.y - s.nubs.y;
    if (ahead > E.range) break;
    if (o.kind !== 'puddle' || o.state !== EL_IDLE || ahead < 0) continue;
    want = o.x - trailX(s.world.trail, o.y);
    break;
  }
  const r = E.drip.range;
  want = want > r ? r : want < -r ? -r : want;
  f.dTheta = 0;
  f.steer = q64(want - el.dxTarget);
}

/** Gust: every SWIPE_EVERY ticks, one swipe pushing the nearest weather predicted on the trail further off it. */
function gust(s: SimState, el: ElState, f: InputFrame): void {
  f.dTheta = 0;
  if (el.legTick % SWIPE_EVERY !== 0) return;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.state === EL_GONE || !o.awake || !(o.kind === 'rain' || o.kind === 'fog')) continue;
    const n = arriveTicks(s, o.y);
    if (n < 0) continue;
    const off = weatherXAt(s, o, n) - trailX(s.world.trail, o.y);
    if (Math.abs(off) >= o.r) continue;
    f.verb = off < 0 ? VERB_WEST : VERB_EAST;
    return;
  }
}

/** A verb frame at a ground point: no turn on it. */
function act(f: InputFrame, verb: typeof VERB_TAP | typeof VERB_HOLD, x: number, y: number): void {
  f.verb = verb;
  f.vx = x;
  f.vy = y;
  f.dTheta = 0;
}
