// Controls v3 (docs/CONTROLS_V3.md §2, §3, §11.3; CORE owns src/core/drive): the driver, a pure and
// deterministic per-tick policy that turns button presses, the Gust vane and the finger state into
// ordinary InputFrame fields before step(). It reads SimState and its DriveControl, keeps its own
// small state and writes the tick's frame; it never writes SimState. Core rules: no Math.exp/log/pow,
// no wall clock, no per-tick allocation; it imports only core and config. recordFrame records the
// frame after the driver, so a recorded run replays bit for bit without one (§11.5).
//
// The C0b skeleton (§11.1): the act per leg (§0.1; a first-run lesson's button waits for the first
// full meter, §3.1), the vane's notch math (§3.5) and Cold Snap presses (§3.1: f.snap on the first
// tick snapReady holds within bufferTicks of the press; refusals, arms, jobs and the governor come
// with C0c).

import { HEROES, type DriveAct } from '../../config/heroes.ts';
import { TUNING } from '../../config/tuning.ts';
import { snapReady } from '../sim/mechanics.ts';
import type { InputFrame, SimState } from '../sim/types.ts';

const D = TUNING.drive;

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
  /** A lesson run's button has appeared (the first full meter, §3.1). */
  let shown = false;

  /** Pushes a note (at most 8 wait for the session's drain; more are dropped). */
  function note(code: number, a: number): void {
    if (noteN >= 8) return;
    notes[2 * noteN] = code;
    notes[2 * noteN + 1] = a;
    noteN++;
  }

  /** The button's act for the walking element (§0.1): no button without the snap mechanic, nor in a lesson run before its first full meter. */
  function actOf(s: SimState): DriveAct {
    if (s.phase === 'hold') return 'none';
    const a = HEROES[s.nubs.hero].act;
    if (a !== 'snap') return a;
    return !s.world.mech.snap || (s.cfg.lesson === true && !(shown ||= snapReady(s))) ? 'none' : a;
  }

  function observe(s: SimState): void {
    view.act = actOf(s);
    view.buffered = buf >= 0;
    view.vane = vaneNotch(raw);
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
      buf = -1;
      raw = 0;
      leg = s.relayIdx;
      shown = false;
      view.queue.fill(-1);
      observe(s);
    },
    interrupt(): void {
      buf = -1;
    },
    fill(s: SimState, f: InputFrame, c: Readonly<DriveControl>): void {
      if (s.phase === 'day') {
        now++;
        if (s.relayIdx !== leg) {
          // A new leg: the vane starts calm.
          leg = s.relayIdx;
          raw = 0;
        }
        if (HEROES[s.nubs.hero].drag === 'vane') {
          raw += c.vane;
          raw = raw > 2.49 ? 2.49 : raw < -2.49 ? -2.49 : raw;
          if (c.vaneUp) raw = vaneNotch(raw);
        } else raw = 0;
        if (c.act === 1) buf = now;
        // A Cold Snap press casts on the first tick it may within bufferTicks; other acts wait for C0c.
        if (buf >= 0 && (actOf(s) !== 'snap' || now - buf > D.bufferTicks)) buf = -1;
        else if (buf >= 0 && snapReady(s)) {
          f.snap = true;
          buf = -1;
          note(NOTE_PRESS, 1);
        }
      }
      observe(s);
    },
    observe,
  };
}
