// Elementals v2 core bots (docs/ELEMENTALS_V2.md §6.3; CORE owns this file): the element policy the
// reactive bot and humanEl hand each element leg of a Trial to, and the finger that plays it under the
// bot input contract. bots.ts fills the frame with its sun play first; the policy then plays the
// walking element's verb. Nubs legs keep the sun play (bots.ts aims at guide.tag itself during a
// telegraph into Drip).
//
// The input contract (§6.3) is the frames a single-pointer touch player makes (§7.9): a tap ends the
// sun drag (upEdge, release 0), presses for ≥ 6 ticks and sends one `verb 1` frame with its point; a
// hold ends the drag, presses for 13 ticks (HOLD_MS) and sends `verb 2`, then no turn until `verb 3`;
// after either the sun is grabbed again (downEdge) ≥ 9 ticks later. A steer is `steer` on frames
// with no turn; a swipe is one `verb 4/5` frame. Bots never use keys.
//
// Policies by element (§6.3): Ember taps each own bramble or gate in the middle of its sweet window,
// never under a shower, ice and walls past the TAG once burnLeft ≤ 30, and dries a puddle on its path
// 60 ticks before it while Flame > 30. Sprout holds the most urgent unbridged crossing until its need,
// then plots in arrival order while Sap > 25 (skipping a plot a later wall's fire would reach
// downwind). Drip picks its lane every 6 ticks (puddles, stones, shade).
// Gust scores both swipe directions every 6 ticks by the weather's predicted overlap of the trail.
// With a salt the reactive policy adds noise (tap timing ±6 ticks, steer ±3 u; the aim error is
// bots.ts'); humanEl adds human timing and errors. Variants for the gates: tap on sight (G5c), a
// one-way spam Gust (G5d) and legs with their verb switched off (G5b).

import type { HeroId } from '../../../config/heroes.ts';
import { TUNING } from '../../../config/tuning.ts';
import { DT, TICK_HZ } from '../../clock.ts';
import { worldYAtTick } from '../../gen/plan.ts';
import { EL_GONE, EL_IDLE, type ElObj, type ElState } from '../../objects.ts';
import { rngFor, type Rng } from '../../rng.ts';
import { trailX } from '../../trail.ts';
import {
  arriveTicks,
  burnLeft,
  burnTarget,
  contactTicks,
  growLeft,
  growTarget,
  inWeather,
  laneOf,
  needOf,
  nextTagTicks,
  pointLit,
  walkerAt,
  weatherXAt,
} from '../elements.ts';
import { VERB_EAST, VERB_HOLD, VERB_RELEASE, VERB_TAP, VERB_WEST, type InputFrame, type SimState } from '../types.ts';

const E = TUNING.elements;
const EM = E.ember;
const SP = E.sprout;
const DR = E.drip;
const G = E.gust;
const O = E.objects;
const FI = E.fire;

/** Ticks a tap presses before its verb frame; a hold's recognition (HOLD_MS 220); the re-grab after either. */
export const TAP_PRESS = 6;
export const HOLD_PRESS = 13;
export const REGRAB = 9;
/** Ember dries a puddle on its path this many ticks before reaching it, while Flame is above DRY_FLAME. */
const DRY_TICKS = 60;
const DRY_FLAME = 30;
/** Sprout pours into plots only while Sap stays above this. */
const PLOT_SAP = 25;
/** Gust swipes at most once per this many ticks, when a swipe saves SWIPE_GAIN more than it costs and Lift is above SWIPE_LIFT. */
const SWIPE_EVERY = 15;
const SWIPE_GAIN = 2;
const SWIPE_LIFT = 20;
/** The harm weights (meter a second) of fog that veils Ember's and Sprout's targets, and of the shade a rain cloud gives Nubs. */
const FOG_VEIL = 10;
const RAIN_SHADE = 28;
/** Drip's lane decisions in flight (humanEl's finger lags them). */
const STEER_Q = 4;

/** Ground points enter the frame on the 1/8 u grid, steers on the 1/64 u grid (§7.9). */
const q8 = (v: number): number => Math.round(v * 8) / 8;
const q64 = (v: number): number => Math.round(v * 64) / 64;
const msTicks = (ms: number): number => Math.round((ms * TICK_HZ) / 1000);

function gaussian(r: Rng): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += r.next();
  return sum - 6;
}

// ---------------------------------------------------------------------------------------------
// The finger (the bot input contract)
// ---------------------------------------------------------------------------------------------

/** The finger: 0 on the sun, 1 pressing for a tap or hold, 2 holding, 3 waiting to re-grab the sun. */
export interface ElHand {
  mode: 0 | 1 | 2 | 3;
  /** Ticks left in modes 1 and 3. */
  wait: number;
  /** The pending verb (VERB_TAP or VERB_HOLD; VERB_RELEASE once a hold lets go), its point and its object. */
  v: number;
  x: number;
  y: number;
  obj: number;
  /** The next sun frame touches down (after a re-grab, or after a held leg). */
  grab: boolean;
  /** The last frame had the finger down. */
  down: boolean;
  /** Re-grab ticks after a tap or hold. */
  regrab: number;
}

export function createHand(): ElHand {
  return { mode: 0, wait: 0, v: 0, x: 0, y: 0, obj: -1, grab: false, down: false, regrab: REGRAB };
}

/** Starts a tap or a hold at (x, y) on object `obj`: the drag ends now and the verb lands `press` ticks later. */
export function handPress(h: ElHand, v: number, x: number, y: number, obj: number, press: number): void {
  h.mode = 1;
  h.wait = press;
  h.v = v;
  h.x = q8(x);
  h.y = q8(y);
  h.obj = obj;
}

/** Ends a hold: verb 3 on the next frame, then the re-grab wait. */
export function handRelease(h: ElHand): void {
  if (h.mode === 2) h.v = VERB_RELEASE;
}

/** Drops whatever the finger was doing (a TAG): a press is lost, a hold is released, then the re-grab. */
export function handCut(h: ElHand): void {
  if (h.mode === 1) {
    h.mode = 3;
    h.wait = h.regrab;
  } else handRelease(h);
  h.grab = true;
}

/**
 * Applies the finger to frame `f` (which holds the sun play): on the sun it passes, touching down
 * after a re-grab; otherwise the frame is the press, the verb or the hold, with no turn.
 */
export function handFrame(h: ElHand, f: InputFrame): void {
  if (h.mode === 0) {
    if (h.grab && f.down) {
      f.downEdge = true;
      h.grab = false;
    } else if (f.downEdge) h.grab = false;
    h.down = f.down;
    return;
  }
  const was = h.down;
  f.dTheta = 0;
  f.down = false;
  f.downEdge = false;
  f.upEdge = false;
  f.release = 0;
  f.key = 0;
  f.snap = false;
  if (h.mode === 1) {
    if (h.wait-- <= 0) {
      f.verb = h.v as InputFrame['verb'];
      f.vx = h.x;
      f.vy = h.y;
      h.mode = h.v === VERB_HOLD ? 2 : 3;
      h.wait = h.regrab;
    } else f.upEdge = was; // the drag ends as the press begins (released at 0 °/s)
  } else if (h.mode === 2) {
    if (h.v === VERB_RELEASE) {
      f.verb = VERB_RELEASE;
      h.mode = 3;
      h.wait = h.regrab;
    }
  } else if (--h.wait <= 0) {
    h.mode = 0;
    h.grab = true;
  }
  h.down = false;
}

// ---------------------------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------------------------

export interface ElPolicyOpts {
  /** The noise stream: salt > 0 adds the reactive policy's noise. */
  readonly salt?: number;
  /** humanEl: human timing and errors (drawn on salt's stream). */
  readonly human?: boolean;
  /** G5(c): Ember taps each wall as soon as it is a target. */
  readonly tapOnSight?: boolean;
  /** G5(d): Gust swipes only this way every `every` ticks of its leg, nothing else. */
  readonly spam?: { readonly dir: -1 | 1; readonly every: number };
  /** G5(b): leg indices whose verb is switched off. */
  readonly off?: readonly number[];
}

export interface ElPolicy {
  /** The finger is pressing, holding or waiting to re-grab: the sun play must leave it alone. */
  busy(): boolean;
  /** Fills the element fields of `f` (which holds the sun play) for the walking element. */
  fill(s: SimState, f: InputFrame): void;
}

export function createElPolicy(opts: ElPolicyOpts = {}): ElPolicy {
  const salt = opts.salt ?? 0;
  const human = opts.human === true;
  const hand = createHand();
  const lane = new Float64Array(2);
  let run: SimState | null = null;
  let rng: Rng = rngFor(0, 'bot');
  let relay = 0;
  /** Per object: the tick humanEl first saw it as a target (−1 not yet) and its reaction delay; tap timing noise. */
  let seenAt = new Int32Array(0);
  let delay = new Int32Array(0);
  let jitter = new Int8Array(0);
  /** Per element: the tick from which humanEl, having met its first object, acts at all (−1 not met yet). */
  const wake = new Map<HeroId, number>();
  let holdGoal = 0;
  let releaseAt = -1;
  let lastSwipe = -1e9;
  /** Drip's lane decisions waiting for the finger: when each lands and where to. */
  const steerAt = new Int32Array(STEER_Q).fill(-1);
  const steerTo = new Float64Array(STEER_Q);
  let steerN = 0;
  let lateSwipe = 0;

  function reset(s: SimState): void {
    run = s;
    rng = rngFor(s.cfg.seed, 'bot', human ? 'humanEl' : 'el', salt);
    const n = (s.el as ElState).objs.length;
    seenAt = new Int32Array(n).fill(-1);
    delay = new Int32Array(n);
    jitter = new Int8Array(n);
    if (salt > 0 || human) for (let i = 0; i < n; i++) jitter[i] = rng.int(-6, 6);
    Object.assign(hand, createHand());
    hand.regrab = human ? msTicks(150) : REGRAB;
    wake.clear();
    relay = s.relayIdx;
    holdGoal = 0;
    releaseAt = -1;
    lastSwipe = -1e9;
    steerAt.fill(-1);
    lateSwipe = 0;
  }

  /**
   * humanEl acts on object i only once it has seen it for its reaction delay, and not within 1.2 s of
   * first meeting the walking element's first object (the first exposure covers whatever it meets meanwhile).
   */
  function ready(s: SimState, i: number): boolean {
    if (!human) return true;
    const h = s.nubs.hero;
    if (!wake.has(h)) wake.set(h, s.tick + msTicks(1200));
    if ((seenAt[i] as number) < 0) {
      seenAt[i] = s.tick;
      const d = msTicks(250 + 80 * gaussian(rng));
      delay[i] = d < 3 ? 3 : d;
    }
    return s.tick - (seenAt[i] as number) >= (delay[i] as number) && s.tick >= (wake.get(h) as number);
  }

  return {
    busy: () => hand.mode !== 0,
    fill(s: SimState, f: InputFrame): void {
      const el = s.el;
      f.verb = 0;
      f.vx = 0;
      f.vy = 0;
      f.steer = 0;
      if (el === null) return;
      if (s !== run) reset(s);
      if (s.relayIdx !== relay) {
        relay = s.relayIdx;
        handCut(hand);
      }
      const hero = s.nubs.hero;
      const on = s.phase === 'day' && s.ready === 0 && !(opts.off?.includes(relay) ?? false);
      // humanEl starts a press only with the finger off the sun (between its drags).
      if (on && hand.mode === 0 && !(human && f.down)) {
        if (hero === 'ember') ember(s, el);
        else if (hero === 'sprout') sprout(s, el);
      } else if (hand.mode === 2) holding(s, el);
      if (hero === 'drip' || hero === 'gust') f.dTheta = 0;
      if (on && hero === 'drip') drip(s, el, f);
      else if (on && hero === 'gust') gust(s, el, f);
      handFrame(hand, f);
    },
  };

  /** Ember (§6.3): the most urgent tap whose time has come starts its press now. */
  function ember(s: SimState, el: ElState): void {
    const pace = paceOf(s);
    const tr = s.world.trail;
    let best = -1;
    let bestDue = Infinity;
    for (let i = 0; i < el.objs.length; i++) {
      const o = el.objs[i] as ElObj;
      if (o.state !== EL_IDLE) continue;
      const wall = o.kind === 'bramble' || o.kind === 'gate' || o.kind === 'ice';
      if (!wall && o.kind !== 'puddle') continue;
      if (burnTarget(s, wall ? trailX(tr, o.y) : o.x, o.y) !== i) continue;
      // The verb lands TAP_PRESS ticks from now (the jitter moves the moment): has it come?
      const lead = TAP_PRESS + (jitter[i] as number);
      const own = wall && ownWall(s, o);
      let due: number;
      if (opts.tapOnSight && wall) due = 0;
      else if (!wall) {
        const c = contactTicks(s, o);
        if (s.nubs.chill <= DRY_FLAME || c - lead > DRY_TICKS) continue;
        due = c;
      } else if (own) {
        // The middle of the sweet window: from burnTicks of walking ahead down to `near`.
        const d = o.y - O.wallDepth / 2 - s.nubs.y;
        if (d - lead * pace > (burnTicksOf(o) * pace + E.near) / 2 || d - TAP_PRESS * pace < E.near) continue;
        due = (d - E.near) / pace;
      } else {
        // Ice, or a wall past the TAG: burnt out before its walker gets there, tapped while Ember still walks.
        const n = nextTagTicks(s);
        const l = Math.min(burnLeft(s, o), n < 0 ? Infinity : n - 2 * TAP_PRESS);
        if (l - lead > EM.nowTicks || l - TAP_PRESS < 0) continue;
        due = l;
      }
      // Never under a shower: rain over it while it burns would put it out.
      if (!opts.tapOnSight && showered(s, el, o, TAP_PRESS, own ? contactTicks(s, o) : TAP_PRESS + burnTicksOf(o))) continue;
      if (s.nubs.chill <= costOf(s, o) || !ready(s, i)) continue;
      if (due < bestDue) {
        bestDue = due;
        best = i;
      }
    }
    if (best < 0) return;
    const o = el.objs[best] as ElObj;
    let x = o.kind === 'puddle' ? o.x : trailX(tr, o.y);
    let y = o.y;
    let press = TAP_PRESS;
    if (human) {
      press = rng.int(msTicks(100), msTicks(300));
      x += 10 * gaussian(rng);
      y += 10 * gaussian(rng);
    }
    handPress(hand, VERB_TAP, x, y, best, press);
  }

  /** Sprout (§6.3): the most urgent unbridged crossing, else the next plot it can afford. */
  function sprout(s: SimState, el: ElState): void {
    const tr = s.world.trail;
    let best = -1;
    let bestLeft = Infinity;
    for (let i = 0; i < el.objs.length; i++) {
      const o = el.objs[i] as ElObj;
      if ((o.kind !== 'gap' && o.kind !== 'stream') || o.state === EL_GONE || o.size >= needOf(o)) continue;
      if (growTarget(s, trailX(tr, o.y), o.y) !== i || !ready(s, i)) continue;
      const l = growLeft(s, o);
      if (l < bestLeft) {
        bestLeft = l;
        best = i;
      }
    }
    let goal = 0;
    if (best >= 0) goal = needOf(el.objs[best] as ElObj);
    else {
      const spare = s.nubs.chill - PLOT_SAP;
      for (let i = 0; i < el.objs.length && spare > 0; i++) {
        const o = el.objs[i] as ElObj;
        if (o.kind !== 'plot' || o.state === EL_GONE || o.casterId >= 0 || o.size >= SP.treeMax) continue;
        if (o.size + spare < SP.treeMin || downwind(s, el, o)) continue;
        if (growTarget(s, o.x, o.y) !== i || !ready(s, i)) continue;
        best = i;
        goal = Math.min(SP.treeMax, o.size + spare);
        break;
      }
    }
    if (best < 0) return;
    const o = el.objs[best] as ElObj;
    let x = o.kind === 'plot' ? o.x : trailX(tr, o.y);
    let y = o.y;
    if (human) {
      x += 10 * gaussian(rng);
      y += 10 * gaussian(rng);
    }
    holdGoal = goal;
    releaseAt = -1;
    handPress(hand, VERB_HOLD, x, y, best, HOLD_PRESS);
  }

  /**
   * A hold lets go once its site has its goal, or once the sim ended it. humanEl lets go when it
   * expects the goal, up to 150 ms early or late (an early one leaves a crossing short, to be held again).
   */
  function holding(s: SimState, el: ElState): void {
    const o = el.objs[hand.obj];
    if (el.hold !== hand.obj || o === undefined) {
      handRelease(hand);
      return;
    }
    if (human && releaseAt < 0) releaseAt = s.tick + Math.ceil((holdGoal - o.size) / (SP.invest * DT)) + rng.int(-msTicks(150), msTicks(150));
    if (human ? s.tick >= releaseAt : o.size >= holdGoal - 1e-9) handRelease(hand);
  }

  /** Drip (§6.3): every 6 ticks the lane in lo..hi (4 u apart) with the most puddles, the fewest stones and the most shade ahead. */
  function drip(s: SimState, el: ElState, f: InputFrame): void {
    if (el.legTick % 6 === 0) {
      laneOf(s, lane);
      const lo = Math.ceil(lane[0] as number);
      const hi = Math.floor(lane[1] as number);
      let best = el.dxTarget;
      let bestV = -Infinity;
      for (let L = lo; L <= hi; L += 4) {
        const v = laneScore(s, el, L) - 0.001 * Math.abs(L - el.dx);
        if (v > bestV) {
          bestV = v;
          best = L;
        }
      }
      // humanEl's finger follows its decision 200 ms late with N(0, 4 u) error; the reactive policy's at once (±3 u with a salt).
      const k = steerN++ % STEER_Q;
      steerAt[k] = s.tick + (human ? msTicks(200) : 0);
      steerTo[k] = best + (human ? 4 * gaussian(rng) : salt > 0 ? rng.range(-3, 3) : 0);
    }
    for (let k = 0; k < STEER_Q; k++) {
      if ((steerAt[k] as number) < 0 || s.tick < (steerAt[k] as number)) continue;
      steerAt[k] = -1;
      const to = steerTo[k] as number;
      const t = to > DR.range ? DR.range : to < -DR.range ? -DR.range : to;
      f.steer = q64(t - el.dxTarget);
    }
  }

  /** Gust (§6.3): every 6 ticks, a swipe the way that cuts the predicted overlap of harmful weather most. */
  function gust(s: SimState, el: ElState, f: InputFrame): void {
    const sp = opts.spam;
    if (sp) {
      if (el.legTick % sp.every === 0) f.verb = sp.dir > 0 ? VERB_EAST : VERB_WEST;
      return;
    }
    if (lateSwipe !== 0 && s.tick >= lastSwipe) {
      f.verb = lateSwipe > 0 ? VERB_EAST : VERB_WEST;
      lateSwipe = 0;
      return;
    }
    if (el.legTick % 6 !== 0 || s.tick - lastSwipe < SWIPE_EVERY || s.nubs.chill <= SWIPE_LIFT) return;
    const now = harm(s, el, 0);
    const kick = G.kick * (inWeather(el, 'fog', s.nubs.x, s.nubs.y) ? G.fogMuffle : 1);
    const east = harm(s, el, kick);
    const west = harm(s, el, -kick);
    // A swipe must save more than it costs (its Lift, and a little more).
    const bar = G.swipe * (s.trial?.tune.costMul ?? 1) + SWIPE_GAIN;
    let dir = 0;
    if (east <= west && now - east >= bar) dir = 1;
    else if (west < east && now - west >= bar) dir = -1;
    if (dir === 0) return;
    lastSwipe = s.tick;
    if (human) {
      if (rng.chance(0.05)) dir = -dir;
      if (rng.chance(0.1)) {
        // One swipe late.
        lateSwipe = dir;
        lastSwipe = s.tick + SWIPE_EVERY;
        return;
      }
    }
    f.verb = dir > 0 ? VERB_EAST : VERB_WEST;
  }
}

/** The walker's pace now (u per tick). */
function paceOf(s: SimState): number {
  return worldYAtTick(s.world, s.tickAbs + 1) - s.nubs.y;
}

function burnTicksOf(o: ElObj): number {
  return (EM.burnTicks as Partial<Record<string, number>>)[o.kind] ?? 0;
}

function costOf(s: SimState, o: ElObj): number {
  return ((EM.cost as Partial<Record<string, number>>)[o.kind] ?? 0) * (s.trial?.tune.costMul ?? 1);
}

/** A bramble or gate Ember itself will reach (its own fire feeds it). */
function ownWall(s: SimState, o: ElObj): boolean {
  return (o.kind === 'bramble' || o.kind === 'gate') && walkerAt(s, o.y - O.wallDepth / 2) === 'ember';
}

/** Rain predicted over object o at some tick `from`..`to` ticks from now (no new swipe), every 3 ticks. */
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
function downwind(s: SimState, el: ElState, p: ElObj): boolean {
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

/** Drip's score of lane L: +30 a puddle it can reach within 60 ticks, −20 a stone it would touch, +0.2 per shaded tick of the next 30 (tested every 5). */
function laneScore(s: SimState, el: ElState, L: number): number {
  const tr = s.world.trail;
  const slide = DR.slide * DT;
  let v = 0;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.state === EL_GONE || (o.kind !== 'puddle' && (o.kind !== 'stone' || o.hit))) continue;
    const n = arriveTicks(s, o.y);
    if (n < 0 || n > 60 || Math.abs(L - (o.x - trailX(tr, o.y))) > o.r + O.touch) continue;
    if (o.kind === 'stone') v -= 20;
    else if (Math.abs(L - el.dx) <= slide * n + o.r) v += 30;
  }
  for (let k = 0; k <= 30; k += 5) {
    const y = worldYAtTick(s.world, s.tickAbs + k);
    if (!pointLit(s, trailX(tr, y) + L, y)) v += 0.2 * 5;
  }
  return v;
}

/**
 * What a weather object costs (+) or gives (−) whoever walks at its y, per u of trail it covers, in
 * meter units: about the meter a second inside it costs or gives (§2), over the 70 u/s walk.
 */
function weightOf(s: SimState, o: ElObj): number {
  const h = walkerAt(s, o.y);
  const rain = o.kind === 'rain';
  if (h === 'gust') return (rain ? G.soak + G.air : G.fog + G.air) / 70;
  if (h === 'ember') return rain ? (EM.rain + EM.refill) / 70 : FOG_VEIL / 70;
  if (h === 'sprout') return rain ? -SP.rain / 70 : FOG_VEIL / 70;
  return rain ? -(h === 'nubs' ? RAIN_SHADE : DR.rain + DR.evap) / 70 : 0;
}

/**
 * The weather's predicted cost to the walkers ahead with `kick` more wind now (no later swipe): per
 * object not yet passed, its weight times the length of trail its ellipse covers when the walker
 * reaches it (weatherXAt; a sleeping object starts drifting when it wakes).
 */
function harm(s: SimState, el: ElState, kick: number): number {
  const w0 = el.wind;
  const w = w0 + kick;
  el.wind = w > G.windMax ? G.windMax : w < -G.windMax ? -G.windMax : w;
  let sum = 0;
  const tr = s.world.trail;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.state === EL_GONE || (o.kind !== 'rain' && o.kind !== 'fog')) continue;
    const ry = E.weather.ryRatio * o.r;
    if (o.y + ry < s.nubs.y) continue;
    const n = arriveTicks(s, o.y);
    const dx = (weatherXAt(s, o, n < 0 ? 0 : n) - trailX(tr, o.y)) / o.r;
    const q = 1 - dx * dx;
    if (q > 0) sum += weightOf(s, o) * 2 * ry * Math.sqrt(q);
  }
  el.wind = w0;
  return sum;
}
