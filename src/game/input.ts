// Pointer and keyboard input → per-tick InputFrames and DriveControls (V1_PLAN §3, §8; Controls v3,
// docs/CONTROLS_V3.md §1, §11.6).
//
// - Pointer Events with getCoalescedEvents(). Two slots: the world slot (one pointer that drags) and
//   the button slot (the action button's disc, host.buttonHit, tested before the edge zones).
// - Edge zones (§1.1): a pointerdown within EDGE_SIDE_PX of the left/right edges, or inside the
//   bottom max(safe inset, 8 px), is ignored for its whole life (OS back / home gestures, the grip).
// - The world slot (§1.2): the first pointer wins and keeps it until it lifts; a later world press
//   is ignored (never captured) for its whole life, unless the owner is still (it has not travelled
//   YIELD_PX in the last YIELD_MS of its life): then the new pointer takes the slot from its own press
//   point with zero jump and the old one is ignored until it lifts. What it drags is host.drag() at
//   touch-down: 'sun' turns the sun (Δθ = −dx / viewportWidth × 360° × sensitivity, inverted on
//   request), 'steer' slides Drip by the finger's world distance (host.uPerPx; no sensitivity or
//   invert), 'vane' moves Gust's vane by dx / VANE_PX notches and its lift snaps the vane to its notch
//   (vaneUp). A sun lift (pointerup, pointercancel, lostpointercapture) is an upEdge at 0 °/s:
//   nothing coasts.
//   - Start slop: a press that begins in the run's hold or start beat sends no turn until it is
//     START_SLOP px from its press point (then the whole displacement), so a start tap turns nothing.
//   - The finger's speed (for the TAG guards) is read over the last SPEED_MS of an 8-sample ring.
//     Swing Boost (§1.2) is cut for the bundle budget (its setting stays in the save, unread).
//   - Rest: a sun finger that has not travelled REST_PX in REST_MS rests (DriveControl.rest): aim help
//     treats it as no hand.
// - The button slot (§1.3): a touch on the disc presses in at once (buttonDown) and becomes a press
//   when it lifts within BUTTON_SLOP of its touch-down point, or stays there for BUTTON_COMMIT_MS
//   (acts++, snaps++ on a Cold Snap leg, host.onPress()); at most 2 wait for their batches, and each
//   reaches the driver on the first tick of one (DriveControl.act). A touch that moves BUTTON_SLOP
//   first is a world drag from its touch-down point (if the world slot is free, or its owner still)
//   and acts nothing; after a timed commit the same move drags from where the finger is (the act
//   stays). No drag is ever dead.
// - handoff() (every TAG, §1.5): a world finger that is down keeps its slot and takes the new leg's
//   drag kind from where it is (zero jump): into 'sun' a downEdge and a TAG_RAMP_SUN_MS ramp; into
//   'steer' motion is dropped while the finger moves faster than TAG_STEER_FAST (until the ramp is
//   done) and ramps in over TAG_RAMP_STEER_MS from its first slower sample (a back-and-forth carried
//   through the TAG steers nothing on its fast stretches); into 'vane' nothing moves the vane until
//   the finger pauses (under TAG_VANE_PAUSE px/s for TAG_VANE_PAUSE_MS). Out of 'sun' an upEdge at
//   0 °/s. Pending steer and vane deltas are dropped; held keys and waiting presses stay.
// - dTheta is quantized to 1/1024° and steer to 1/64 u so live play equals replays. Input writes
//   only dTheta, down, downEdge, upEdge, key and steer; the driver writes the rest (§1.7).
// - Keys (§1.4): ← → / A D turn on sun legs (key ±1; Shift held, ±2 = the sim's fine rate) and steer
//   Drip; on a vane leg each keydown moves the vane one notch. ↑/W is a press on every leg with an
//   act (it starts a held run on the Title and the intro card), ↓/S a press on a Cold Snap leg. Escape/
//   P/Enter/Space belong to the UI.
// - Wheel (CC-6): each wheel event is one synthetic tap frame (catch and release at 0 °/s) turning
//   −15°·sign(deltaY) per notch (line mode) or −0.35°·deltaY (pixel mode), at most ±45° per event,
//   on sun legs only and never while a world finger is down; on the Title it starts the run like a key.
// - Times are the pointer events' timeStamps and, between events, `now()` (performance.now: the same
//   clock), so a still finger's commit, rest and pause are noticed when a batch is taken.

import type { DragKind, DriveAct, DriveControl, InputFrame } from '../core/index.ts';

/** Edge zones (CSS px): the sides, and the least bottom band (the safe inset when larger). */
export const EDGE_SIDE_PX = 16;
const EDGE_BOTTOM_PX = 8;
/** A button touch that moves this far (CSS px) before it commits is a drag; one that stays this long (ms) commits. */
export const BUTTON_SLOP = 12;
export const BUTTON_COMMIT_MS = 120;
/** A world owner within YIELD_PX for YIELD_MS yields to a new press; a sun finger within REST_PX for REST_MS rests. */
export const YIELD_PX = 4;
export const YIELD_MS = 300;
export const REST_PX = 3;
export const REST_MS = 300;
/** Start slop (CSS px): a press in the hold or start beat turns nothing until it is this far from its press point. */
const START_SLOP = 10;
/** TAG follow-through guards (§1.5): ms, px/s. */
export const TAG_RAMP_SUN_MS = 150;
export const TAG_RAMP_STEER_MS = 300;
export const TAG_STEER_FAST = 600;
export const TAG_VANE_PAUSE = 40;
export const TAG_VANE_PAUSE_MS = 120;
/** The finger's speed is read over this window (ms). */
const SPEED_MS = 50;
/** CSS px of horizontal drag per vane notch (§1.2). */
const VANE_PX = 36;
/** Presses waiting for their batches. */
const PRESS_MAX = 2;
/** Wheel turn per notch (line mode), per pixel (pixel mode), and its cap per event (degrees). */
const WHEEL_NOTCH = 15;
const WHEEL_PX = 0.35;
const WHEEL_MAX = 45;

const qTheta = (d: number): number => Math.round(d * 1024) / 1024;
const qSteer = (u: number): number => Math.round(u * 64) / 64;

export interface InputHost {
  canvas: HTMLCanvasElement;
  /** True when canvas pointers should act (UI on title or play, not paused, no overlay). */
  accepting(): boolean;
  /** Called on every accepted press (pointer, act or rotation key); the session may start a run. */
  onPress(): void;
  /** World viewport width (CSS px), for the drag mapping. */
  viewportWidth(): number;
  /** Bottom safe-area inset (CSS px). */
  safeBottom(): number;
  /** What a world drag moves now: HEROES[walker].drag on a Trial past the start beat, else 'sun'. */
  drag(): DragKind;
  /** The button's act now (driver.view.act, or view.incoming in the pre-TAG window). */
  act(): DriveAct;
  /** (x, y) is inside the button's hit disc and the button takes presses now (hudButtonHit, phase 'day'). */
  buttonHit(x: number, y: number): boolean;
  /** The run is in its hold or start beat (§1.2 start slop). */
  starting(): boolean;
  /** World units per CSS px on the last drawn frame (Drip). */
  uPerPx(): number;
}

/** Interactive elements whose own keyboard handling wins over the game's rotation keys. */
const CONTROL_SELECTOR = 'button, a, input, textarea, select, [role="radio"], [role="tab"], [role="switch"], [role="slider"]';

/** True when a key event's target is (inside) an interactive element or editable content. */
export function isControl(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target.closest(CONTROL_SELECTOR) !== null) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}

/** The controls of every tick after a batch's first (nothing lands there but `rest`). */
const IDLE: Readonly<DriveControl> = { act: 0, vane: 0, vaneUp: false, rest: false };
const IDLE_REST: Readonly<DriveControl> = { act: 0, vane: 0, vaneUp: false, rest: true };

function newFrame(): InputFrame {
  return { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0, snap: false, verb: 0, vx: 0, vy: 0, steer: 0 };
}

/** The follow-through guard a hand-off left on the world finger (§1.5). */
const G_NONE = 0;
const G_SUN = 1;
const G_STEER = 2;
const G_VANE = 3;

/** The input layer (§11.6): the session's settings, the finger and key state it reads, the frames it takes. */
export interface Input {
  sensitivity: number;
  invert: boolean;
  /** The clock the pointer timestamps share (performance.now; tests replace it). */
  now: () => number;
  /** A world finger (or mouse button) is down turning the sun. */
  readonly pointerDown: boolean;
  /** A world finger is down steering Drip. */
  readonly steering: boolean;
  /** A world finger is down on Gust's vane. */
  readonly vaning: boolean;
  /** A pointer is down on the action button. */
  readonly buttonDown: boolean;
  /** A rotation key is held. */
  readonly keyDown: boolean;
  /** World presses accepted (debug/test). */
  presses: number;
  /** Button and act-key presses accepted, and those on a Cold Snap leg (debug/test). */
  acts: number;
  snaps: number;
  /** Takes the world slot for a pointer (also the Title tray's drag handoff), dragging what host.drag() names. */
  begin(e: PointerEvent): void;
  /** Every TAG (§1.5). */
  handoff(): void;
  /** Drops any finger, keys, presses and pending motion (pause, resume, new run, blur). */
  releaseAll(): void;
  /** Forgets accumulated motion, edges and waiting presses (the finger state is kept). */
  clearPending(): void;
  /** A synthetic tap (Space/Enter start or retry): downEdge + upEdge in one batch. */
  tap(): void;
  takeFrames(n: number): readonly InputFrame[];
  /** The DriveControls of the last takeFrames batch (§1.7). */
  controls(): readonly Readonly<DriveControl>[];
  /** True when this pointerdown position is in an ignored edge zone. */
  isEdge(x: number, y: number): boolean;
  dispose(): void;
}

/**
 * The input layer, listening on the host's canvas and the window. Its state lives in closures (the
 * minifier shortens them; class fields keep their names).
 */
export function createInput(host: InputHost): Input {
  /** The world slot: its pointer, what it drags and whether it is down. */
  let active = -1;
  let kind: DragKind = 'sun';
  let held = false;
  /** The finger's baseline x (motion already sent), its last sample, and its press x while the start slop holds (NaN none). */
  let lastX = 0;
  let curX = 0;
  let curY = 0;
  let slopX = Number.NaN;
  /** Path (px) since the yield and rest clocks last restarted, and when they did (ms). */
  let yPath = 0;
  let yAt = 0;
  let rPath = 0;
  let rAt = 0;
  /** The world finger's last 8 samples (x, ms), for its speed. */
  const ringX = new Float64Array(8);
  const ringT = new Float64Array(8);
  let ringN = 0;
  /** The hand-off guard (G_*), its clock (the TAG, or the steer's first slow sample; −1 not yet) and the vane's slow start (−1 none). */
  let guard = G_NONE;
  let gAt = 0;
  let slowAt = -1;
  let pending = 0;
  let downEdge = false;
  let upEdge = false;
  /** An up happened before a later down in the same batch. */
  let upFirst = false;
  let keyL = false;
  let keyR = false;
  /** Shift is held: rotation keys turn at the fine rate. */
  let shift = false;
  /** Drip's slide and the vane's change still to send (world u, notches), and a vane lift or key. */
  let steerPending = 0;
  let vanePending = 0;
  let vaneUp = false;
  /** The button slot: its pointer (−1 free), its touch-down point (CSS px) and time, and whether it committed by time. */
  let bId = -1;
  let bX = 0;
  let bY = 0;
  let bAt = 0;
  let bDone = false;
  /** Presses waiting for their batches. */
  let waiting = 0;
  const frames: InputFrame[] = [];
  for (let i = 0; i < 8; i++) frames.push(newFrame());
  const out: InputFrame[] = [];
  /** The batch's first control and the batch's controls (§1.7). */
  const c0: DriveControl = { act: 0, vane: 0, vaneUp: false, rest: false };
  const ctl: Readonly<DriveControl>[] = [];
  const listeners: [EventTarget, string, EventListener, AddEventListenerOptions | boolean][] = [];
  const canvas = host.canvas;

  /** The world slot can take a new pointer at time t: it is free, or its owner has been still (§1.2). */
  const free = (t: number): boolean => !held || t - yAt >= YIELD_MS;

  /** A sun touch-down on the next batch (after an up of the same batch: the up first). */
  const touch = (): void => {
    if (upEdge && !downEdge) upFirst = true;
    downEdge = true;
  };

  /** Records a world sample (x, ms) in the speed ring. */
  const push = (x: number, t: number): void => {
    const i = ringN++ & 7;
    ringX[i] = x;
    ringT[i] = t;
  };

  /** The world finger's horizontal speed (px/s) at time t, over the last SPEED_MS of its samples. */
  const speed = (t: number): number => {
    const n = ringN;
    // The newest sample at least SPEED_MS old (the oldest kept if none is): where the finger was
    // SPEED_MS ago, as a finger stays where its last sample put it.
    let k = n - 1;
    while (k > Math.max(0, n - 8) && (ringT[k & 7] as number) > t - SPEED_MS) k--;
    const dt = Math.min(SPEED_MS, t - (ringT[k & 7] as number));
    return n > 0 && dt > 0 ? (Math.abs((ringX[(n - 1) & 7] as number) - (ringX[k & 7] as number)) * 1000) / dt : 0;
  };

  /** A guarded vane finger's pause (§1.5): under TAG_VANE_PAUSE for TAG_VANE_PAUSE_MS ends the guard. */
  const pause = (t: number): void => {
    if (guard !== G_VANE) return;
    if (speed(t) >= TAG_VANE_PAUSE) slowAt = -1;
    else if (slowAt < 0) slowAt = t;
    else if (t - slowAt >= TAG_VANE_PAUSE_MS) guard = G_NONE;
  };

  /** Pointer `id` owns the world slot from (x, y) at time t (a still owner it replaces is ignored until it lifts). */
  const take = (id: number, x: number, y: number, t: number): void => {
    const wasSun = held && kind === 'sun';
    active = id;
    kind = host.drag();
    held = true;
    lastX = curX = x;
    curY = y;
    slopX = host.starting() ? x : Number.NaN;
    yPath = rPath = ringN = 0;
    yAt = rAt = t;
    push(x, t);
    guard = G_NONE;
    if (kind === 'sun') touch();
    else if (wasSun) upEdge = true;
    self.presses++;
    host.onPress();
  };

  const moveTo = (x: number, y: number, t: number): void => {
    const d = Math.hypot(x - curX, y - curY);
    curX = x;
    curY = y;
    push(x, t);
    // The still clocks restart whenever the finger has travelled their distance.
    if ((yPath += d) >= YIELD_PX) {
      yPath = 0;
      yAt = t;
    }
    if ((rPath += d) >= REST_PX) {
      rPath = 0;
      rAt = t;
    }
    if (slopX === slopX) {
      // Start slop: nothing until START_SLOP px from the press point, then the whole displacement.
      if (Math.abs(x - slopX) < START_SLOP) return;
      slopX = Number.NaN;
    }
    let k = 1;
    if (guard === G_SUN) k = Math.min(1, (t - gAt) / TAG_RAMP_SUN_MS);
    else if (guard === G_STEER) {
      // Dropped while the swing is fast (all through the guard); from its first slow sample, a ramp.
      const fast = speed(t) > TAG_STEER_FAST;
      if (gAt < 0 && !fast) gAt = t;
      k = gAt < 0 || fast ? 0 : Math.min(1, (t - gAt) / TAG_RAMP_STEER_MS);
    } else if (guard === G_VANE) {
      pause(t);
      k = guard === G_VANE ? 0 : 1;
    }
    if (k >= 1) guard = G_NONE;
    const dx = (x - lastX) * k;
    lastX = x;
    if (dx === 0) return;
    if (kind === 'steer') steerPending += dx * host.uPerPx();
    else if (kind === 'vane') vanePending += dx / VANE_PX;
    else pending += (-dx / Math.max(1, host.viewportWidth())) * 360 * self.sensitivity * (self.invert ? -1 : 1);
  };

  /** One (coalesced) sample of pointer `id`. */
  const sample = (id: number, x: number, y: number, t: number): void => {
    if (id === bId) {
      if (Math.hypot(x - bX, y - bY) < BUTTON_SLOP) return;
      // A drag after all (§1.3): the press-in springs back and the world slot takes it, from its
      // touch-down point (or from here after a timed commit); with the slot busy it is ignored until it lifts.
      bId = -1;
      if (!free(t)) return;
      if (bDone) take(id, x, y, t);
      else take(id, bX, bY, bAt);
    }
    if (id === active && held) moveTo(x, y, t);
  };

  /** A committed press of the act now: queued for the driver (a third waiting one is dropped). */
  const press = (): void => {
    const a = host.act();
    if (a === 'none' || waiting >= PRESS_MAX) return;
    waiting++;
    self.acts++;
    if (a === 'snap') self.snaps++;
    host.onPress();
  };

  const onDown = (e: PointerEvent): void => {
    if (!host.accepting()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const x = e.clientX;
    const y = e.clientY;
    const t = e.timeStamp;
    const button = bId < 0 && host.buttonHit(x, y);
    // The button first; then the world slot (a later press is ignored unless the owner is still).
    if (!button && (!free(t) || self.isEdge(x, y))) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort; window listeners still follow the pointer.
    }
    if (!button) return take(e.pointerId, x, y, t);
    bId = e.pointerId;
    bX = x;
    bY = y;
    bAt = t;
    bDone = false;
  };

  const onMove = (e: PointerEvent): void => {
    const id = e.pointerId;
    if (id !== bId && (id !== active || !held)) return;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    if (list && list.length > 0) {
      for (const ce of list) sample(id, ce.clientX, ce.clientY, ce.timeStamp);
    } else {
      sample(id, e.clientX, e.clientY, e.timeStamp);
    }
  };

  const onUp = (e: PointerEvent, cancel: boolean): void => {
    if (e.pointerId === bId) {
      bId = -1;
      // A still touch is a press on its lift (not a cancelled one, nor one that committed by time).
      if (!bDone && !cancel) press();
      return;
    }
    if (e.pointerId !== active || !held) return;
    held = false;
    active = -1;
    if (kind === 'sun') upEdge = true;
    else if (kind === 'vane') vaneUp = true;
  };

  const onKey = (e: KeyboardEvent, down: boolean): void => {
    const k = e.key;
    shift = e.shiftKey;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const up = k === 'ArrowUp' || k === 'w' || k === 'W';
    if (up || k === 'ArrowDown' || k === 's' || k === 'S') {
      // §1.4: ↑/W is a press on every leg with an act, ↓/S on a Cold Snap leg; one per keydown.
      if (!down || e.repeat || isControl(e.target) || !host.accepting()) return;
      const a = host.act();
      if (a === 'snap' || (up && a !== 'none')) press();
      else if (up && host.starting()) {
        // On the Title and a level's card ↑ starts the run as a turn key does.
        host.onPress();
        self.tap();
      } else return;
      e.preventDefault();
      return;
    }
    let left = false;
    let right = false;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') left = true;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') right = true;
    else return;
    // Keys aimed at a control (a focused button, a slider, a radio group…) belong to it: an arrow on
    // the focused Missions button must not start a run. Key-ups always release.
    if (down && isControl(e.target)) return;
    if (down) {
      if (!host.accepting()) return;
      e.preventDefault();
      if (host.drag() === 'vane') {
        // Gust: one notch per keydown (← west, → east), snapped at once.
        if (e.repeat) return;
        vanePending += left ? -1 : 1;
        vaneUp = true;
        host.onPress();
        return;
      }
      const was = keyL || keyR;
      if (left) keyL = true;
      if (right) keyR = true;
      if (!was && !e.repeat) host.onPress();
    } else {
      if (left) keyL = false;
      if (right) keyR = false;
    }
  };

  /** A wheel turn: one synthetic tap frame with the event's (capped) turn, on sun legs only. */
  const onWheel = (e: WheelEvent): void => {
    if (held || e.deltaY === 0 || isControl(e.target) || !host.accepting() || host.drag() !== 'sun') return;
    e.preventDefault();
    const d = e.deltaMode === 1 ? -WHEEL_NOTCH * Math.sign(e.deltaY) : -WHEEL_PX * e.deltaY;
    pending += Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, d));
    self.presses++;
    host.onPress();
    self.tap();
  };

  const self: Input = {
    sensitivity: 1,
    invert: false,
    now: () => performance.now(),
    presses: 0,
    acts: 0,
    snaps: 0,
    get pointerDown() {
      return held && kind === 'sun';
    },
    get steering() {
      return held && kind === 'steer';
    },
    get vaning() {
      return held && kind === 'vane';
    },
    get buttonDown() {
      return bId >= 0;
    },
    get keyDown() {
      return keyL !== keyR;
    },
    isEdge: (x, y) => x < EDGE_SIDE_PX || x > window.innerWidth - EDGE_SIDE_PX || y > window.innerHeight - Math.max(host.safeBottom(), EDGE_BOTTOM_PX),
    begin(e) {
      take(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    },

    /**
     * Every TAG (§1.5): a world finger that is down keeps its slot with the new leg's drag kind, from
     * where it is (zero jump), guarded against the swing's follow-through. Into 'sun' it touches down
     * on the next batch; out of 'sun' it lifts at 0 °/s. Pending steer and vane deltas are dropped;
     * held keys and waiting presses stay.
     */
    handoff() {
      steerPending = vanePending = 0;
      if (!held) return;
      const k = host.drag();
      if (k === kind) return;
      if (kind === 'sun') upEdge = true;
      else if (k === 'sun') touch();
      kind = k;
      lastX = curX;
      slopX = Number.NaN;
      guard = k === 'sun' ? G_SUN : k === 'steer' ? G_STEER : G_VANE;
      gAt = k === 'sun' ? self.now() : -1;
      slowAt = -1;
    },

    releaseAll() {
      for (const id of [held ? active : -1, bId]) {
        try {
          if (id >= 0 && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
        } catch {
          // ignore
        }
      }
      held = keyL = keyR = shift = false;
      active = bId = -1;
      self.clearPending();
    },

    clearPending() {
      pending = steerPending = vanePending = waiting = 0;
      downEdge = upEdge = upFirst = vaneUp = false;
    },

    tap() {
      downEdge = upEdge = true;
      upFirst = false;
    },

    /**
     * Builds `n` InputFrames for this frame's ticks (and their DriveControls, for controls()). Pending
     * rotation (and Drip's slide) is split evenly (quantized, remainder carried); a touch-down lands
     * on the first frame and a lift on the last; a waiting press, the vane's change and its lift on the
     * first control, `rest` on each. First a still button touch commits once it has waited
     * BUTTON_COMMIT_MS, and a guarded vane finger's pause is noticed. With n = 0 (hit-stop) everything
     * keeps accumulating.
     */
    takeFrames(n) {
      out.length = 0;
      ctl.length = 0;
      if (n <= 0) return out;
      const t = self.now();
      if (bId >= 0 && !bDone && t - bAt >= BUTTON_COMMIT_MS) {
        bDone = true;
        press();
      }
      if (held) pause(t);
      while (frames.length < n) frames.push(newFrame());
      // Left/A turns counter-clockwise (+); Shift held is the fine rate (±2). On vane legs the keys move the vane instead.
      const key: InputFrame['key'] = keyL === keyR || host.drag() === 'vane' ? 0 : keyL ? (shift ? 2 : 1) : shift ? -2 : -1;
      const per = qTheta(pending / n);
      pending -= per * n;
      if (Math.abs(pending) < 1e-9) pending = 0;
      const steer = qSteer(steerPending / n);
      steerPending -= steer * n;
      if (Math.abs(steerPending) < 1e-9) steerPending = 0;
      const down = held && kind === 'sun';
      // §1.2: rest only while the sun finger has been still through the whole batch.
      const rest = down && !downEdge && t - rAt >= REST_MS;
      for (let i = 0; i < n; i++) {
        const f = frames[i] as InputFrame;
        f.dTheta = per;
        f.downEdge = f.upEdge = f.snap = false;
        f.release = f.verb = f.vx = f.vy = 0;
        f.key = key;
        f.down = down;
        f.steer = steer;
        out.push(f);
        ctl.push(i === 0 ? c0 : rest ? IDLE_REST : IDLE);
      }
      c0.act = waiting > 0 ? 1 : 0;
      if (waiting > 0) waiting--;
      c0.vane = vanePending;
      c0.vaneUp = vaneUp;
      c0.rest = rest;
      vanePending = 0;
      vaneUp = false;
      const first = frames[0] as InputFrame;
      const last = frames[n - 1] as InputFrame;
      if (upFirst && downEdge) {
        if (n >= 2) {
          first.upEdge = true;
          first.down = false;
          (frames[1] as InputFrame).downEdge = true;
        } else {
          first.downEdge = true;
          first.down = held;
        }
      } else {
        if (downEdge) first.downEdge = true;
        if (upEdge) {
          last.upEdge = true;
          // Frames before the release tick still had the finger down.
          for (let i = 0; i < n - 1; i++) (frames[i] as InputFrame).down = true;
          last.down = false;
        }
      }
      downEdge = upEdge = upFirst = false;
      return out;
    },

    controls: () => ctl,

    dispose() {
      for (const [t, type, fn, opts] of listeners) t.removeEventListener(type, fn, opts);
      listeners.length = 0;
    },
  };

  const on = (t: EventTarget, type: string, fn: EventListener, opts: AddEventListenerOptions | boolean): void => {
    t.addEventListener(type, fn, opts);
    listeners.push([t, type, fn, opts]);
  };
  on(canvas, 'pointerdown', (e) => onDown(e as PointerEvent), { passive: false });
  on(window, 'pointermove', (e) => onMove(e as PointerEvent), { passive: true });
  on(window, 'pointerup', (e) => onUp(e as PointerEvent, false), { passive: true });
  on(window, 'pointercancel', (e) => onUp(e as PointerEvent, true), { passive: true });
  on(canvas, 'lostpointercapture', (e) => onUp(e as PointerEvent, false), { passive: true });
  on(canvas, 'contextmenu', (e) => e.preventDefault(), { passive: false });
  on(window, 'keydown', (e) => onKey(e as KeyboardEvent, true), false);
  on(window, 'keyup', (e) => onKey(e as KeyboardEvent, false), false);
  on(window, 'wheel', (e) => onWheel(e as WheelEvent), { passive: false });
  on(window, 'blur', () => self.releaseAll(), false);
  return self;
}
