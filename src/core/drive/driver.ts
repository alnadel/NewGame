// Controls v3 (docs/CONTROLS_V3.md §2, §3, §11.3; CORE owns src/core/drive): the driver, a pure and
// deterministic per-tick policy that turns button presses, the Gust vane and the finger state into
// ordinary InputFrame fields before step(). It reads SimState and its DriveControl, keeps its own
// small state and writes the tick's frame; it never writes SimState. Core rules: no Math.exp/log/pow,
// no wall clock, no per-tick allocation; it imports only core and config. recordFrame records the
// frame after the driver, so a recorded run replays bit for bit without one (§11.5).
//
// The C0c skeleton (§11.1): the act per leg (§0.1; a first-run lesson's button waits for the first
// full meter, §3.1); presses buffered, resolved and refused (§2.3) with the pre-TAG press; Cold Snap
// presses (§3.1); Ember's arms and ignition (§3.2: the required-first pick, the last working tick one
// tick on); Sprout's jobs with their goals, release and pre-emption (§3.3: the downwind-aware pick);
// the Gust vane and its governor (§3.5: symmetric notches, the policy's Lift floor, auto-calm). Notes
// are PRESS and REFUSE only; the magnet, the hand-over, due, Auto actions and Auto Snap come with
// CORE's branch. The shared timing and picks are drive/pick.ts's.

import { HEROES, type DriveAct } from '../../config/heroes.ts';
import { TUNING } from '../../config/tuning.ts';
import { EL_GONE, EL_IDLE, type ElObj, type ElState } from '../objects.ts';
import { burnTarget, burnTicksOf, contactTicks, growLeft, growTarget, nextTagHero, nextTagTicks, ownWall, tagLocked, veiled } from '../sim/elements.ts';
import { snapReady } from '../sim/mechanics.ts';
import { VERB_EAST, VERB_HOLD, VERB_RELEASE, VERB_TAP, VERB_WEST, type InputFrame, type SimState } from '../sim/types.ts';
import { emberDue, emberLast, emberPick, gustFloor, jobGoal, nearLast, showered, sproutPick, targetX } from './pick.ts';

const D = TUNING.drive;
const DS = D.sprout;
const EM = TUNING.elements.ember;
const SP = TUNING.elements.sprout;
const WE = TUNING.elements.weather;

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
  /** Endless rungs R0-R1: Auto Snap (§3.1). */
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
  /** The glide's target θ while one runs (NaN none), and whether it is the hand-over. */
  glide: number;
  handover: boolean;
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
    glide: NaN,
    handover: false,
    refuse: 0,
    refuseTick: 0,
  };
  const notes = new Int16Array(16);
  let noteN = 0;
  /** The driver's tick (fills since begin), the buffered press's tick (−1 none), the vane's raw value and its leg. */
  let now = 0;
  let buf = -1;
  let raw = 0;
  let leg = -1;
  /** The pre-TAG press (§2.3): the incoming element's act it waits for ('none' none). */
  let pre: DriveAct = 'none';
  /** A lesson run's button has appeared (the first full meter, §3.1); the reasons refused this leg (bits). */
  let shown = false;
  let refused = 0;
  /** Ember's arms (object indices, −1 empty; §3.2). */
  const arms = new Int16Array(2);
  /** Sprout's jobs (§3.3): the running one and the queued one (object, −1 none) with their goals, and whether the running one has poured. */
  const jobs = new Int16Array(2);
  const goals = new Float64Array(2);
  let poured = false;
  /** The governor's last gust (driver tick). */
  let gustAt = 0;

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

  /** The button's act for the walking element (§0.1): no button without the snap mechanic, nor in a lesson run before its first full meter. */
  function actOf(s: SimState): DriveAct {
    if (s.phase === 'hold') return 'none';
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
      // Calming a calm vane does nothing and refuses nothing.
      if (raw === 0) return true;
      raw = 0;
    } else if (el === null) return true;
    else if (a === 'burn') {
      // Arming is free; Flame is checked at ignition.
      const k = arms[0] < 0 ? 0 : arms[1] < 0 ? 1 : -1;
      const p = k < 0 ? -1 : emberPick(s, arms);
      if (p >= 0) arms[k] = p;
      else reason = k < 0 ? REFUSE_FULL : REFUSE_NOTHING;
    } else reason = grow(s, el);
    if (reason === 0) note(NOTE_PRESS, DRIVE_ACTS.indexOf(a));
    else if (last) {
      const bit = 1 << reason;
      note(NOTE_REFUSE, reason + ((refused & bit) !== 0 ? 16 : 0));
      refused |= bit;
      view.refuse = reason;
      view.refuseTick = now;
    } else return false;
    return true;
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
   * Ember (§3.2): arms whose target can no longer burn in time drop; of the rest, the one with the
   * earliest last working tick whose moment has come, unveiled, with Flame above its cost and no rain
   * due over its fire (never past its last working tick), is tapped at its point.
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
        continue;
      }
      if (last >= bestLast || veiled(s, o) || emberDue(s, i, 0) > 0 || s.nubs.chill <= costOf(s, o)) continue;
      if (last >= 1 && showered(s, el, o, 0, ownWall(s, o) ? contactTicks(s, o) : burnTicksOf(o))) continue;
      if (burnTarget(s, targetX(s, o), o.y) !== i) continue;
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
   * start and a plot whose tree already stands (a pre-empted job) drop the job; a queued crossing with growLeft under `urgent` pre-empts a running plot,
   * which takes the queue place with its goal. Any hold that is not the running job's is let go
   * (VERB_RELEASE) first, so the next job starts the tick after.
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

  /**
   * The governor (§3.5): with the vane set and weather in play it keeps the wind in the notch's band
   * with ordinary gusts, at most one per `every` ticks, while Lift is above the policy's floor; at the
   * floor the vane calms.
   */
  function gust(s: SimState, el: ElState, f: InputFrame): void {
    const n = vaneNotch(raw);
    if (n === 0 || !inPlay(s, el)) return;
    if (s.nubs.chill <= gustFloor(s, el)) {
      raw = 0;
      return;
    }
    const sg = n > 0 ? 1 : -1;
    if (sg * el.wind >= (D.gust.band[sg * n] as number) || now - gustAt < D.gust.every) return;
    f.verb = sg > 0 ? VERB_EAST : VERB_WEST;
    gustAt = now;
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
    view.vaneResting = false;
    view.vaneCost = 0;
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
        view.cost = costOf(s, el.objs[p] as ElObj);
        view.state = s.nubs.chill <= view.cost ? 3 : 1;
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
      }
      if (r >= 0) {
        view.fill = (el.objs[r] as ElObj).size / (goals[0] as number);
        if (el.hold === r) view.state = 4;
      }
    } else if (act === 'calm' && n !== 0) {
      view.state = 1;
      view.vaneResting = !inPlay(s, el);
      view.vaneCost = view.vaneResting ? 0 : (D.gust.cost[n < 0 ? -n : n] as number) * (s.trial?.tune.costMul ?? 1);
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
    begin(s: SimState): void {
      now = 0;
      pre = 'none';
      shown = false;
      newLeg(s);
      view.refuse = 0;
      view.refuseTick = 0;
      observe(s);
    },
    interrupt(): void {
      buf = -1;
    },
    fill(s: SimState, f: InputFrame, c: Readonly<DriveControl>): void {
      if (s.phase === 'day') {
        now++;
        if (s.relayIdx !== leg) newLeg(s);
        const el = s.el;
        const hero = s.nubs.hero;
        if (HEROES[hero].drag === 'vane') {
          raw += c.vane;
          raw = raw > 2.49 ? 2.49 : raw < -2.49 ? -2.49 : raw;
          if (c.vaneUp) raw = vaneNotch(raw);
        } else raw = 0;
        // A press joins the buffer; in the pre-TAG window it waits for the incoming element's first tick.
        const act = actOf(s);
        if (c.act === 1) {
          const inc = incoming(s);
          if (inc !== 'none') pre = inc;
          else buf = now;
        }
        if (pre !== 'none' && pre === act) {
          pre = 'none';
          buf = now;
        }
        if (buf >= 0 && (act === 'none' || press(s, f, act, now - buf >= D.bufferTicks))) buf = -1;
        // The walking element's verb (one per tick; a verb sent in the start beat would be lost).
        if (el !== null && s.ready === 0) {
          if (hero === 'ember') ember(s, el, f);
          else if (hero === 'sprout') sprout(s, el, f);
          else if (hero === 'gust') gust(s, el, f);
        }
      }
      observe(s);
    },
    observe,
  };
}
