// Controls v3 (docs/CONTROLS_V3.md §2, §3, §4, §11.3; CORE owns src/core/drive): the driver, a pure
// and deterministic per-tick policy that turns button presses, the Gust vane and the finger state
// into ordinary InputFrame fields before step(). It reads SimState and its DriveControl, keeps its own
// small state and writes the tick's frame; it never writes SimState. Core rules: no Math.exp/log/pow,
// no wall clock, no per-tick allocation; it imports only core and config. recordFrame records the
// frame after the driver, so a recorded run replays bit for bit without one (§11.5).
//
// Per tick (§2.2): the act per leg (§0.1; a first-run lesson's button waits for the first full
// meter, §3.1); presses buffered, resolved and refused (§2.3) with the pre-TAG press; Cold Snap
// presses (§3.1; Auto Snap is CORE's cut list 3, §12.3); Ember's arms and ignition (§3.2: the required-first pick, the last
// working tick one tick on); Sprout's jobs with their goals, release and pre-emption (§3.3: the
// downwind-aware pick); the Gust vane and its governor (§3.5: symmetric notches, the policy's Lift
// floor, auto-calm); Auto actions (§3.6); aim help (§4: the magnet with its engagement window, the
// lesson rule and the re-grip grace, carry and undo; the hand-over before Drip); due prompts and the
// notes (§2.4). The shared timing and picks are drive/pick.ts's, the magnet's targets aim.ts's.

import { HEROES, type DriveAct } from '../../config/heroes.ts';
import { TUNING } from '../../config/tuning.ts';
import { angleDiff, wrapDeg } from '../dmath.ts';
import { EL_GONE, EL_IDLE, type ElObj, type ElState } from '../objects.ts';
import { burnTarget, burnTicksOf, contactTicks, growLeft, growTarget, isCrossing, isWall, nextTagHero, nextTagTicks, ownWall, tagLocked, veiled } from '../sim/elements.ts';
import { snapReady } from '../sim/mechanics.ts';
import { VERB_EAST, VERB_HOLD, VERB_RELEASE, VERB_TAP, VERB_WEST, type InputFrame, type SimState } from '../sim/types.ts';
import { aimOut, aimPlan, glideStep, glideTicks, handPlan, q1024 } from './aim.ts';
import { downwind, emberDue, emberLast, emberPick, gustFloor, jobGoal, nearLast, showered, sproutPick, targetX } from './pick.ts';

const D = TUNING.drive;
const DS = D.sprout;
const A = D.aim;
const EM = TUNING.elements.ember;
const SP = TUNING.elements.sprout;
const WE = TUNING.elements.weather;
const EG = TUNING.elements.gust;

export type AimSetting = 'standard' | 'strong' | 'light' | 'off';

/** Per tick, from the input (or a touch bot). */
export interface DriveControl {
  /** 1 when a press lands on this tick. */
  act: 0 | 1;
  /** Gust: the vane's change this tick (notches; drag px / 36, keys ±1). */
  vane: number;
  /** Gust: the vane's finger lifted, or a key set it: the raw value snaps to its notch. */
  vaneUp: boolean;
  /** The world sun finger is down and has moved < 3 px over the last 300 ms (§1.2): aim help treats it as no hand. */
  rest: boolean;
}

export interface DriveOpts {
  /** Magnet capture radius (°; 0 off) and whether it tracks (§4.3). */
  readonly aimDeg: number;
  readonly track: boolean;
  /** 'fog' level: the magnet reads guide.now only. */
  readonly nowOnly: boolean;
  /** Endless rungs R0-R1: Auto Snap (§3.1). Cut (CORE's cut list 3, §12.3): the driver ignores it. */
  readonly autoSnap: boolean;
  /** Settings → Auto actions (§3.6). */
  readonly autoAct: boolean;
  /** Glides at rateReduced. */
  readonly reducedMotion: boolean;
}

/** What the HUD, the dial, the tips and the test hook read (updated by fill). */
export interface DriveView {
  /** The button's act on this leg ('none': no button). */
  act: DriveAct;
  /** 0 idle, 1 ready, 2 locked, 3 low, 4 working, 5 charging. */
  state: number;
  /** 0..1: the frost meter (snap), the running job's size / goal (grow); 0 otherwise. */
  fill: number;
  /** Ticks to the TAG while locked, else −1. */
  lockTicks: number;
  /** The next act's cost (Flame or Sap, costMul applied); 0 none. */
  cost: number;
  /** The object the next press acts on (index in s.el.objs; −1 none). */
  pick: number;
  /** Ember: armed objects in ignition order; Sprout: the running job's object, then the queued one (−1 empty). */
  readonly queue: Int16Array; // length 2
  /** 0 none, 1 amber, 2 red (§3.2, §3.3). */
  due: number;
  /** A press is buffered. */
  buffered: boolean;
  /** The act the button shows for the incoming element in the pre-TAG window ('none' otherwise). */
  incoming: DriveAct;
  /** Gust: the notch −2..2, resting (no weather in play), and the steady Lift/s it costs (costMul applied; 0 calm or resting). */
  vane: number;
  vaneResting: boolean;
  vaneCost: number;
  /**
   * Gust, a set vane with weather in play: 0 the notch's full wind, 1 a weaker wind (Lift at the
   * policy's floor), 2 waiting for Lift (one gust's price + gain or less). Low Lift never calms the vane.
   */
  vaneLow: number;
  /** The glide's target θ while one runs (NaN none), and whether it is the hand-over. */
  glide: number;
  handover: boolean;
  /**
   * The last fill wrote a glide's motion (its last tick included): the session drops that tick's
   * `detent` events from haptics and audio (§4.5), deciding per tick rather than per drawn frame.
   */
  glideTick: boolean;
  /** The last refusal's reason (§2.4 codes; 0 none) and its tick (the driver's, counted from begin). */
  refuse: number;
  refuseTick: number;
}

export interface Driver {
  /** A new run, or a resumed one (retry from the Tag Stone, after testSkipToLeg): drops arms, jobs, presses, glide; vane 0. */
  begin(s: SimState, opts: DriveOpts): void;
  /** Pause, blur, releaseAll, every TAG: closes an open glide on the next fill; drops buffered presses (not the pre-TAG press). */
  interrupt(): void;
  /** One tick: after the input fills f, before step(s, f). */
  fill(s: SimState, f: InputFrame, c: Readonly<DriveControl>): void;
  /** Refreshes `view` from the state without acting or writing a frame (bot runs, frames with no tick). */
  observe(s: SimState): void;
  readonly view: DriveView;
  /** Notes since the last clear: pairs (code, a) in notes[0 .. 2·noteN). */
  readonly notes: Int16Array; // length 16
  readonly noteN: number;
  clearNotes(): void;
}

/** Note codes (§2.4): `a` is the act, the refusal reason (+16 a repeat this leg), the glide kind, the notch, the object or the bin. */
export const NOTE_PRESS = 1;
export const NOTE_REFUSE = 2;
export const NOTE_BUFFER = 3;
export const NOTE_SETTLE = 4;
export const NOTE_NOTCH = 5;
export const NOTE_CALM = 6;
export const NOTE_WAIT_LOW = 7;
export const NOTE_EXPIRE = 8;
export const NOTE_HANDOVER = 9;
export const NOTE_AUTO = 10;
/** Refusal reasons (§2.3, §2.4). */
export const REFUSE_CHARGING = 1;
export const REFUSE_LOCKED = 2;
export const REFUSE_NOTHING = 3;
export const REFUSE_LOW = 4;
export const REFUSE_FULL = 5;
export const REFUSE_WAIT = 6;
export const REFUSE_BUSY = 7;
/** A note's `a` for an act: its index here. */
export const DRIVE_ACTS: readonly DriveAct[] = ['none', 'snap', 'burn', 'grow', 'calm'];

/** The vane's notch for raw value `raw` (§3.5): symmetric rounding, so ±0.5 is ±1 (JS Math.round would give −0 for −0.5). */
export function vaneNotch(raw: number): number {
  const n = Math.floor(Math.abs(raw) + 0.5);
  return raw < 0 ? -n : n;
}

/** Options before the first begin(): no aim help, no automation. */
const NEUTRAL: DriveOpts = { aimDeg: 0, track: false, nowOnly: false, autoSnap: false, autoAct: false, reducedMotion: false };
/** "Long ago" for the driver's tick clocks. */
const NEVER = -1e9;

export function createDriver(): Driver {
  const view: DriveView = {
    act: 'none',
    state: 0,
    fill: 0,
    lockTicks: -1,
    cost: 0,
    pick: -1,
    queue: new Int16Array(2).fill(-1),
    due: 0,
    buffered: false,
    incoming: 'none',
    vane: 0,
    vaneResting: false,
    vaneCost: 0,
    vaneLow: 0,
    glide: NaN,
    handover: false,
    glideTick: false,
    refuse: 0,
    refuseTick: 0,
  };
  const notes = new Int16Array(16);
  let noteN = 0;
  let opts = NEUTRAL;
  /** The driver's tick (day fills since begin), the buffered press's tick (−1 none), the vane's raw value and its leg. */
  let now = 0;
  let buf = -1;
  let raw = 0;
  let leg = -1;
  /** The pre-TAG press (§2.3): the incoming element's act it waits for ('none' none). */
  let pre: DriveAct = 'none';
  /** A lesson run's button has appeared (the first full meter, §3.1); the reasons refused this leg (bits). */
  let shown = false;
  let refused = 0;
  /** Ember's arms (object indices, −1 empty; §3.2) and whether each has noted WAIT_LOW. */
  const arms = new Int16Array(2);
  const low = new Uint8Array(2);
  /** Sprout's jobs (§3.3): the running one and the queued one (object, −1 none) with their goals, and whether the running one has poured. */
  const jobs = new Int16Array(2);
  const goals = new Float64Array(2);
  let poured = false;
  /** The governor's last gust (driver tick); the player set a new, non-calm notch this tick. */
  let gustAt = 0;
  let turned = false;
  // Aim help (§4): the last sun move (the engagement clock), the last hand and real lift, the last stroke's
  // net direction (±1, 0 under 1°) and the one in progress, the guide refresh last planned on.
  let moveAt = NEVER;
  let handAt = NEVER;
  let liftAt = NEVER;
  let strokeDir = 0;
  let stroke = 0;
  /** The key turn on the last day tick (its release is a lift, §4.1). */
  let keyWas = 0;
  let seen = -1;
  // The glide (§4.5): its ticks (0 none) and ticks sent, its turn and that turn quantized, the steps
  // sent, its target θ, under a resting finger (no edges), its kind (0 track, 1 rescue, 2 hand-over),
  // and when the last one started and θ then (the re-grip undo); an interrupt closes it on the next fill.
  let gN = 0;
  let gK = 0;
  let gD = 0;
  let gQ = 0;
  let gSent = 0;
  let gTo = NaN;
  let gRest = false;
  let gKind = 0;
  let gAt = NEVER;
  let gFrom = 0;
  let closing = false;

  /** Pushes a note (at most 8 wait for the session's drain; more are dropped). */
  function note(code: number, a: number): void {
    if (noteN >= 8) return;
    notes[2 * noteN] = code;
    notes[2 * noteN + 1] = a;
    noteN++;
  }

  /** A new leg (or run): no buffered press (the pre-TAG press stays), arms or jobs, a calm vane, every refusal reason new again. */
  function newLeg(s: SimState): void {
    leg = s.relayIdx;
    buf = -1;
    raw = 0;
    refused = 0;
    arms.fill(-1);
    jobs.fill(-1);
    poured = false;
    gustAt = -D.gust.every;
  }

  /**
   * The button's act for the walking element (§0.1): no button outside 'day' (the hold, the night, the
   * end: nothing there can be pressed, so the input queues no press), without the snap mechanic, nor in
   * a lesson run before its first full meter.
   */
  function actOf(s: SimState): DriveAct {
    if (s.phase !== 'day') return 'none';
    const a = HEROES[s.nubs.hero].act;
    if (a !== 'snap') return a;
    return !s.world.mech.snap || (s.cfg.lesson === true && !(shown ||= snapReady(s))) ? 'none' : a;
  }

  /** The incoming element's act in the last preTagTicks before a TAG into Ember or Sprout (§2.3), else 'none'. */
  function incoming(s: SimState): DriveAct {
    const h = nextTagHero(s);
    const a = h === null ? 'none' : HEROES[h].act;
    const n = nextTagTicks(s);
    return (a === 'burn' || a === 'grow') && n >= 0 && n <= D.preTagTicks ? a : 'none';
  }

  /** Flame object o's burn costs now (costMul applied). */
  function costOf(s: SimState, o: ElObj): number {
    return ((EM.cost as Partial<Record<string, number>>)[o.kind] ?? 0) * (s.trial?.tune.costMul ?? 1);
  }

  /**
   * The buffered press of act `a` (§2.3): true once it acted, or was refused on its `last` buffered
   * tick with the first reason that applies (a repeat this leg adds 16); false while it waits.
   */
  function press(s: SimState, f: InputFrame, a: DriveAct, last: boolean): boolean {
    let reason = 0;
    const el = s.el;
    if (a === 'snap') {
      if (snapReady(s)) f.snap = true;
      else reason = tagLocked(s) ? REFUSE_LOCKED : s.ready > 0 ? REFUSE_WAIT : s.snapTicks > 0 ? REFUSE_BUSY : s.nubs.frost < 1 ? REFUSE_CHARGING : REFUSE_WAIT;
    } else if (a === 'calm') {
      // Calming a calm vane does nothing and refuses nothing (a soft cue): the notch, not the raw
      // value, is what the player sees (a drag still under half a notch shows a calm vane).
      if (vaneNotch(raw) === 0) {
        raw = 0;
        note(NOTE_CALM, 2);
        return true;
      }
      raw = 0;
    } else if (el === null) return true;
    else if (a === 'burn') {
      // Arming is free; Flame is checked at ignition.
      const k = arms[0] < 0 ? 0 : arms[1] < 0 ? 1 : -1;
      const p = k < 0 ? -1 : emberPick(s, arms);
      if (p >= 0) arm(k, p);
      else reason = k < 0 ? REFUSE_FULL : REFUSE_NOTHING;
    } else reason = grow(s, el);
    if (reason === 0) {
      note(NOTE_PRESS, DRIVE_ACTS.indexOf(a));
      if (a === 'calm') note(NOTE_CALM, 0);
    } else if (last) {
      const bit = 1 << reason;
      note(NOTE_REFUSE, reason + ((refused & bit) !== 0 ? 16 : 0));
      refused |= bit;
      view.refuse = reason;
      view.refuseTick = now;
    } else return false;
    return true;
  }

  /** Arm slot k on object p (it will note WAIT_LOW afresh). */
  function arm(k: number, p: number): void {
    arms[k] = p;
    low[k] = 0;
  }

  /**
   * A grow press (§3.3): a running plot job (the pick a plot, or none) takes `step` more Sap up to
   * treeMax; else the pick's job starts, or queues behind the running one. 0, or the refusal reason.
   */
  function grow(s: SimState, el: ElState): number {
    const p = sproutPick(s, jobs);
    const o = p < 0 ? null : (el.objs[p] as ElObj);
    const r = jobs[0] as number;
    const g = goals[0] as number;
    if (r >= 0 && (el.objs[r] as ElObj).kind === 'plot' && (o === null || o.kind === 'plot') && g < SP.treeMax) {
      goals[0] = Math.min(g + DS.step, SP.treeMax);
      return 0;
    }
    const k = r < 0 ? 0 : 1;
    if ((jobs[k] as number) >= 0) return REFUSE_FULL;
    if (o === null) return REFUSE_NOTHING;
    // Crossings never wait on Sap for a press; a new plot job needs some to spare.
    if (o.kind === 'plot' && s.nubs.chill <= DS.plotSap + DS.plotMin) return REFUSE_LOW;
    jobs[k] = p;
    goals[k] = jobGoal(o);
    return 0;
  }

  /**
   * Auto actions (§3.6), the reactive policy (the touch bots' presses): Ember arms every pick while
   * an arm is free; Sprout gives every crossing a job when it is picked, and a plot short of treeMin,
   * not downwind, a job to treeMin when no plot job runs and Sap covers the tree above plotSap.
   */
  function auto(s: SimState, el: ElState): void {
    if (s.nubs.hero === 'ember') {
      const k = arms[0] < 0 ? 0 : arms[1] < 0 ? 1 : -1;
      const p = k < 0 ? -1 : emberPick(s, arms);
      if (p < 0) return;
      arm(k, p);
      note(NOTE_AUTO, 2);
    } else if (s.nubs.hero === 'sprout') {
      const k = jobs[0] < 0 ? 0 : jobs[1] < 0 ? 1 : -1;
      const p = k < 0 ? -1 : sproutPick(s, jobs);
      if (p < 0) return;
      const o = el.objs[p] as ElObj;
      if (o.kind === 'plot' && (o.size >= SP.treeMin || downwind(s, el, o) || s.nubs.chill <= SP.treeMin + DS.plotSap || (k > 0 && (el.objs[jobs[0] as number] as ElObj).kind === 'plot'))) return;
      jobs[k] = p;
      goals[k] = jobGoal(o);
      note(NOTE_AUTO, 3);
    }
  }

  /**
   * Ember (§3.2): arms whose target can no longer burn in time drop (EXPIRE); of the rest, the one
   * with the earliest last working tick whose moment has come, unveiled, with no rain due over its
   * fire (never past its last working tick) and Flame above its cost (else WAIT_LOW, once per arm),
   * is tapped at its point.
   */
  function ember(s: SimState, el: ElState, f: InputFrame): void {
    let best = -1;
    let bestLast = Infinity;
    for (let k = 0; k < 2; k++) {
      const i = arms[k] as number;
      if (i < 0) continue;
      const o = el.objs[i] as ElObj;
      const last = o.state === EL_IDLE ? emberLast(s, i) : -1;
      if (last < 0) {
        arms[k] = -1;
        note(NOTE_EXPIRE, i);
        continue;
      }
      if (last >= bestLast || veiled(s, o) || emberDue(s, i, 0) > 0) continue;
      if (last >= 1 && showered(s, el, o, 0, ownWall(s, o) ? contactTicks(s, o) : burnTicksOf(o))) continue;
      if (burnTarget(s, targetX(s, o), o.y) !== i) continue;
      if (s.nubs.chill <= costOf(s, o)) {
        if (low[k] === 0) note(NOTE_WAIT_LOW, i);
        low[k] = 1;
        continue;
      }
      best = k;
      bestLast = last;
    }
    if (best < 0) return;
    const o = el.objs[arms[best] as number] as ElObj;
    f.verb = VERB_TAP;
    f.vx = targetX(s, o);
    f.vy = o.y;
    arms[best] = -1;
  }

  /**
   * Sprout (§3.3): the running job pours (VERB_HOLD at its point) until its site reaches the goal, or
   * Sap is down to plotSap on a plot; a hold the core ended (near, a TAG), one that can no longer
   * start and a plot whose tree already stands (a pre-empted job) drop the job; a queued crossing
   * with growLeft under `urgent` pre-empts a running plot, which takes the queue place with its goal.
   * Any hold that is not the running job's is let go (VERB_RELEASE) first, so the next job starts the tick after.
   */
  function sprout(s: SimState, el: ElState, f: InputFrame): void {
    const r = jobs[0] as number;
    if (r >= 0) {
      const o = el.objs[r] as ElObj;
      if (el.hold === r) poured = true;
      const q = jobs[1] as number;
      const done = o.state === EL_GONE || o.casterId >= 0 || o.size >= (goals[0] as number) || (o.kind === 'plot' && s.nubs.chill <= DS.plotSap);
      const urgent = !done && q >= 0 && o.kind === 'plot' && (el.objs[q] as ElObj).kind !== 'plot' && growLeft(s, el.objs[q] as ElObj) < DS.urgent;
      if (done || urgent || (poured ? el.hold !== r : nearLast(s, o) < 0)) {
        const g = goals[0] as number;
        jobs[0] = q;
        goals[0] = goals[1] as number;
        jobs[1] = urgent ? r : -1;
        goals[1] = g;
        poured = false;
      }
    }
    const n = jobs[0] as number;
    if (el.hold >= 0 && el.hold !== n) f.verb = VERB_RELEASE;
    else if (n >= 0 && el.hold !== n) {
      const o = el.objs[n] as ElObj;
      const x = targetX(s, o);
      if (growTarget(s, x, o.y) !== n) return;
      f.verb = VERB_HOLD;
      f.vx = x;
      f.vy = o.y;
    }
  }

  /** Weather in play (§3.5): an awake rain or fog object, not gone, whose far edge is not behind the walker. */
  function inPlay(s: SimState, el: ElState): boolean {
    for (let i = 0; i < el.objs.length; i++) {
      const o = el.objs[i] as ElObj;
      if ((o.kind === 'rain' || o.kind === 'fog') && o.awake && o.state !== EL_GONE && o.y + WE.ryRatio * o.r >= s.nubs.y) return true;
    }
    return false;
  }

  /** How low Lift holds a set vane back (view.vaneLow): 0 full wind, 1 the weaker band (at or below the policy's floor), 2 waiting (one gust's price + gain or less). */
  function lowOf(s: SimState, el: ElState): number {
    const lift = s.nubs.chill;
    return lift <= EG.swipe * (s.trial?.tune.costMul ?? 1) + D.gust.gain ? 2 : lift <= gustFloor(s, el) ? 1 : 0;
  }

  /**
   * The governor (§3.5, fix round 3): with the vane set and weather in play it keeps the wind in the
   * notch's band with ordinary gusts, at most one per `every` ticks. Low Lift weakens the wind and
   * never calms the vane: at or below the policy's floor it keeps the weaker band `low`; at one gust's
   * price + `gain` it waits for Lift (air restores it). The tick the player sets a new notch it may
   * blow at once (the spacing waived), down to one gust's price: a drag always moves the wind while
   * Gust can pay for a gust.
   */
  function gust(s: SimState, el: ElState, f: InputFrame): void {
    const n = vaneNotch(raw);
    if (n === 0 || !inPlay(s, el)) return;
    const low = lowOf(s, el);
    if (low === 2 && !(turned && s.nubs.chill > EG.swipe * (s.trial?.tune.costMul ?? 1))) return;
    const sg = n > 0 ? 1 : -1;
    if (sg * el.wind >= ((low > 0 ? D.gust.low : D.gust.band)[sg * n] as number) || (!turned && now - gustAt < D.gust.every)) return;
    f.verb = sg > 0 ? VERB_EAST : VERB_WEST;
    gustAt = now;
  }

  /** Aim help may act now (§4.1, the state's part): the sun up, past the start beat, unlocked, no eclipse, no lesson. */
  function aimOn(s: SimState): boolean {
    return s.phase === 'day' && s.ready === 0 && s.sunUp && !s.sun.locked && !s.eclipseOn && !s.lessonOn;
  }

  /** Ends the glide; one with its edges open gets the upEdge at 0 °/s on frame f unless f touches down (an interrupt, a cancel). */
  function stopGlide(f: InputFrame): void {
    if (gN > 0 && !gRest && gK > 0 && !f.downEdge) {
      f.upEdge = true;
      f.down = false;
      f.release = 0;
    }
    gN = 0;
  }

  /** Sends the glide's next tick (§4.5): eased steps summing to q1024(Δ) exactly; edges unless it rests under the finger. */
  function glide(f: InputFrame): void {
    view.glideTick = true;
    gK++;
    const end = gK === gN;
    const d = end ? gQ - gSent : glideStep(gD, gN, gK);
    gSent += d;
    f.dTheta = d;
    if (!gRest) {
      f.downEdge = gK === 1;
      f.down = !end;
      f.upEdge = end;
      f.release = 0;
    }
    if (!end) return;
    gN = 0;
    if (gKind < 2) note(NOTE_SETTLE, gKind);
  }

  /**
   * §4: the re-grip carry and undo on a real downEdge; a hand (or the state) ends a glide; a glide
   * runs on; or, on a guide refresh while engaged, past the re-grip grace and gapTicks after the last
   * glide, with no hand and the sun settled, a new one starts toward the hand-over's target (the last
   * handTicks before a TAG into Drip) or the magnet's (§4.2).
   */
  function aim(s: SimState, f: InputFrame, c: Readonly<DriveControl>, hand: boolean): void {
    if (gN > 0) {
      if (!hand && aimOn(s)) return glide(f);
      stopGlide(f);
    }
    const g = s.guide;
    if (hand || opts.aimDeg <= 0 || g.tick === seen) return;
    seen = g.tick;
    const sun = s.sun;
    const rest = c.rest && f.down;
    if (!aimOn(s) || now - moveAt > A.engageTicks || now - liftAt < A.regripTicks || now - gAt < A.gapTicks) return;
    if (sun.mode !== 'idle' && !(rest && sun.mode === 'dragging' && (sun.lag < 0 ? -sun.lag : sun.lag) < 0.01)) return;
    const theta = sun.theta;
    const n = nextTagTicks(s);
    let to = NaN;
    let kind = 2;
    if (nextTagHero(s) === 'drip' && n >= 0 && n <= A.handTicks && g.tag.indexOf(1) >= 0) to = handPlan(s, theta);
    else {
      to = aimPlan(s, theta, opts.aimDeg, opts.nowOnly, opts.track, now - handAt >= A.endingTicks);
      kind = aimOut.kind;
    }
    if (to !== to) return;
    const d = angleDiff(to, theta);
    // Never against the stroke just made (until againstTicks after the lift), never a nudge.
    if ((d < 0 ? -d : d) < 0.5 || (kind < 2 && now - liftAt < A.againstTicks && d * strokeDir < -A.againstDeg)) return;
    gN = glideTicks(d, opts.reducedMotion ? A.rateReduced : A.rate);
    gK = 0;
    gD = d;
    gQ = q1024(d);
    gSent = 0;
    gTo = wrapDeg(to);
    gRest = rest;
    gKind = kind;
    gAt = now;
    gFrom = theta;
    if (kind === 2) note(NOTE_HANDOVER, aimOut.bin);
    glide(f);
  }

  function observe(s: SimState): void {
    const act = actOf(s);
    const el = s.el;
    const n = vaneNotch(raw);
    const q = view.queue;
    view.act = act;
    view.incoming = incoming(s);
    view.buffered = buf >= 0 || pre !== 'none';
    view.vane = n;
    view.state = 0;
    view.fill = 0;
    view.lockTicks = -1;
    view.cost = 0;
    view.pick = -1;
    view.due = 0;
    view.vaneResting = false;
    view.vaneCost = 0;
    view.vaneLow = 0;
    view.glide = gN > 0 ? gTo : NaN;
    view.handover = gN > 0 && gKind === 2;
    q.fill(-1);
    if (act === 'snap') {
      const fr = s.nubs.frost;
      view.fill = fr < 1 ? fr : 1;
      if (tagLocked(s)) {
        view.state = 2;
        view.lockTicks = nextTagTicks(s);
      } else view.state = snapReady(s) ? 1 : fr < 1 ? 5 : 0;
    } else if (el === null) return;
    else if (act === 'burn') {
      // The arms in ignition order (the earliest last working tick first); the pick while an arm is free.
      const a = arms[0] as number;
      const b = arms[1] as number;
      const swap = a < 0 || (b >= 0 && emberLast(s, b) < emberLast(s, a));
      q[0] = swap ? b : a;
      q[1] = swap ? a : b;
      const p = b < 0 || a < 0 ? emberPick(s, arms) : -1;
      view.pick = p;
      if (p >= 0) {
        const o = el.objs[p] as ElObj;
        view.cost = costOf(s, o);
        view.state = s.nubs.chill <= view.cost ? 3 : 1;
        // Due (§3.2): the pick, when it is a required wall, close to its last working tick.
        const l = isWall(o.kind) ? emberLast(s, p) : Infinity;
        view.due = l <= D.urgentTicks ? 2 : l <= D.dueTicks ? 1 : 0;
      }
    } else if (act === 'grow') {
      const r = jobs[0] as number;
      q[0] = r;
      q[1] = jobs[1] as number;
      const p = sproutPick(s, jobs);
      view.pick = p;
      if (p >= 0) {
        const o = el.objs[p] as ElObj;
        view.cost = jobGoal(o) - o.size;
        view.state = o.kind === 'plot' && s.nubs.chill <= DS.plotSap + DS.plotMin ? 3 : 1;
        // Due (§3.3): the pick, when it is a crossing, short of growLeft.
        const l = isCrossing(o.kind) ? growLeft(s, o) : Infinity;
        view.due = l < DS.urgentGrowLeft ? 2 : l < DS.dueGrowLeft ? 1 : 0;
      }
      if (r >= 0) {
        view.fill = (el.objs[r] as ElObj).size / (goals[0] as number);
        if (el.hold === r) view.state = 4;
      }
    } else if (act === 'calm' && n !== 0) {
      view.state = 1;
      view.vaneResting = !inPlay(s, el);
      view.vaneLow = view.vaneResting ? 0 : lowOf(s, el);
      const k = n < 0 ? -n : n;
      view.vaneCost = view.vaneResting || view.vaneLow === 2 ? 0 : ((view.vaneLow === 1 ? D.gust.lowCost : D.gust.cost)[k] as number) * (s.trial?.tune.costMul ?? 1);
    }
  }

  return {
    view,
    notes,
    get noteN() {
      return noteN;
    },
    clearNotes(): void {
      noteN = 0;
    },
    begin(s: SimState, o: DriveOpts): void {
      opts = o;
      now = 0;
      pre = 'none';
      shown = false;
      newLeg(s);
      moveAt = handAt = liftAt = gAt = NEVER;
      strokeDir = 0;
      stroke = 0;
      keyWas = 0;
      seen = -1;
      gN = 0;
      closing = false;
      view.refuse = 0;
      view.refuseTick = 0;
      view.glideTick = false;
      observe(s);
    },
    interrupt(): void {
      buf = -1;
      closing = gN > 0;
    },
    fill(s: SimState, f: InputFrame, c: Readonly<DriveControl>): void {
      view.glideTick = false;
      if (s.phase === 'day') {
        now++;
        const el = s.el;
        const hero = s.nubs.hero;
        const drag = HEROES[hero].drag;
        // 2 (read first). The hand and the sun move, from the frame as the input filled it, before the
        // driver writes anything: step 1's closing upEdge is the driver's own, neither a move nor a lift.
        const dn = f.downEdge;
        const up = f.upEdge;
        const dt = f.dTheta;
        const held = f.down;
        const key = f.key;
        const hand = (held && !c.rest) || dn || up || dt !== 0 || f.key !== 0;
        if (hand) handAt = now;
        // 1. An interrupted glide, or one whose leg ended, closes on this frame (no new plan on it).
        const shut = (closing || s.relayIdx !== leg) && gN > 0;
        if (closing || s.relayIdx !== leg) stopGlide(f);
        closing = false;
        if (s.relayIdx !== leg) newLeg(s);
        if (drag === 'sun') {
          if (s.ready === 0 && (dn || up || dt !== 0 || f.key !== 0)) moveAt = now;
          // The stroke's net turn, from its downEdge to its upEdge.
          if (dn) stroke = 0;
          if (held || dn || up) stroke += dt;
          if (dn) {
            // The re-grip carry (an unfinished chase goes on) and undo (a glide since a lift ≤ 0.5 s old,
            // or one that started ≤ raceTicks before this touch: the player reached for the same sun).
            let add = s.sun.mode === 'chasing' ? q1024(s.sun.lag) : 0;
            if (gAt > liftAt && (now - liftAt <= A.againstTicks || now - gAt <= A.raceTicks)) add += q1024(-angleDiff(s.sun.theta, gFrom));
            f.dTheta += add;
          }
          if (up) {
            liftAt = now;
            strokeDir = stroke >= 1 ? 1 : stroke <= -1 ? -1 : 0;
          }
          // A key turn's release is a lift too (fix round 3): the re-grip grace and the against-the-stroke
          // rule protect a keyboard nudge as they protect a drag.
          if (keyWas !== 0 && key === 0) {
            liftAt = now;
            strokeDir = keyWas > 0 ? 1 : -1;
          }
        }
        keyWas = key;
        // 3. The vane (Gust legs; 0 elsewhere).
        turned = false;
        if (drag === 'vane') {
          const n0 = vaneNotch(raw);
          raw += c.vane;
          raw = raw > 2.49 ? 2.49 : raw < -2.49 ? -2.49 : raw;
          if (c.vaneUp) raw = vaneNotch(raw);
          const n1 = vaneNotch(raw);
          if (n1 !== n0) {
            note(NOTE_NOTCH, n1);
            turned = n1 !== 0;
          }
        } else raw = 0;
        // 4-5. A press joins the buffer (in the pre-TAG window it waits for the incoming element's first tick) and resolves.
        const act = actOf(s);
        if (c.act === 1) {
          const inc = incoming(s);
          if (inc !== 'none') {
            pre = inc;
            note(NOTE_BUFFER, DRIVE_ACTS.indexOf(inc));
          } else if (buf < 0) buf = now;
          // A press while one waits joins it: mashing never restarts the wait, so an illegal press is
          // still refused when the first one's wait runs out (§2.3; later ones are repeats, +16).
        }
        if (pre !== 'none' && pre === act) {
          pre = 'none';
          buf = now;
        }
        if (buf >= 0) {
          if (act === 'none' || press(s, f, act, now - buf >= D.bufferTicks)) buf = -1;
          else if (c.act === 1) note(NOTE_BUFFER, DRIVE_ACTS.indexOf(act));
        }
        // 6. The walking element's verb (one per tick; a verb sent in the start beat would be lost).
        if (el !== null && s.ready === 0) {
          if (opts.autoAct) auto(s, el);
          if (hero === 'ember') ember(s, el, f);
          else if (hero === 'sprout') sprout(s, el, f);
          else if (hero === 'gust') gust(s, el, f);
        }
        // 7. Aim help (§4), on sun legs only.
        if (drag === 'sun') aim(s, f, c, hand || shut);
        else stopGlide(f);
      } else {
        // §2.1: nothing is written outside 'day'. A press still waiting when night falls is refused at
        // once with its reason (its wait never outlives the day, §2.3); the end drops it; the pre-TAG
        // press goes too.
        if (buf >= 0 && s.phase === 'night' && view.act !== 'none') press(s, f, view.act, true);
        buf = -1;
        pre = 'none';
      }
      observe(s);
    },
    observe,
  };
}
