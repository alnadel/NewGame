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
//   touch-down: 'sun' turns the sun (Δθ = −dx / viewportWidth × 360° × sensitivity × boost, inverted
//   on request), 'steer' slides Drip by the finger's world distance (host.uPerPx; no sensitivity or
//   invert), 'vane' moves Gust's vane by dx / VANE_PX notches and its lift snaps the vane to its notch
//   (vaneUp). A sun lift (pointerup, pointercancel, lostpointercapture) is an upEdge at 0 °/s:
//   nothing coasts.
//   - Start slop: a press that begins in the run's hold or start beat sends no turn until it is
//     START_SLOP px from its press point (then the whole displacement), so a start tap turns nothing.
//   - Swing Boost (Settings, off by default): the turn grows to 1.6× from 400 to 1000 px/s of finger
//     speed (smoothstep), the speed read over the last SPEED_MS of an 8-sample ring.
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
//   'steer' motion is dropped while the finger moves faster than TAG_STEER_FAST, then ramps in over
//   TAG_RAMP_STEER_MS; into 'vane' nothing moves the vane until the finger pauses (under
//   TAG_VANE_PAUSE px/s for TAG_VANE_PAUSE_MS). Out of 'sun' an upEdge at 0 °/s. Pending steer and
//   vane deltas are dropped; held keys and waiting presses stay.
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

/** Swing Boost (§1.2): 1 + 0.6 · smoothstep(400, 1000, v) for a finger speed v (px/s). */
export function swingBoost(v: number): number {
  const t = Math.max(0, Math.min(1, (v - 400) / 600));
  return 1 + 0.6 * t * t * (3 - 2 * t);
}

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

export class Input {
  sensitivity = 1;
  invert = false;
  /** Swing Boost (§1.2, Settings; off by default). */
  swingBoost = false;
  /** The clock the pointer timestamps share (performance.now; tests replace it). */
  now: () => number = () => performance.now();
  private readonly host: InputHost;
  /** The world slot: its pointer, what it drags and whether it is down. */
  private active = -1;
  private kind: DragKind = 'sun';
  private held = false;
  /** The finger's baseline x (motion already sent), its last sample, and its press x while the start slop holds (NaN none). */
  private lastX = 0;
  private curX = 0;
  private curY = 0;
  private slopX = Number.NaN;
  /** Path (px) since the yield and rest clocks last restarted, and when they did (ms). */
  private yPath = 0;
  private yAt = 0;
  private rPath = 0;
  private rAt = 0;
  /** The world finger's last 8 samples (x, ms), for its speed. */
  private readonly ringX = new Float64Array(8);
  private readonly ringT = new Float64Array(8);
  private ringN = 0;
  /** The hand-off guard (G_*), its clock (the TAG, or the steer's first slow sample; −1 not yet) and the vane's slow start (−1 none). */
  private guard = G_NONE;
  private gAt = 0;
  private slowAt = -1;
  private pending = 0;
  private downEdge = false;
  private upEdge = false;
  /** An up happened before a later down in the same batch. */
  private upFirst = false;
  private keyL = false;
  private keyR = false;
  /** Shift is held: rotation keys turn at the fine rate. */
  private shift = false;
  /** Drip's slide and the vane's change still to send (world u, notches), and a vane lift or key. */
  private steerPending = 0;
  private vanePending = 0;
  private vaneUp = false;
  /** The button slot: its pointer (−1 free), its touch-down point (CSS px) and time, and whether it committed by time. */
  private bId = -1;
  private bX = 0;
  private bY = 0;
  private bAt = 0;
  private bDone = false;
  /** Presses waiting for their batches. */
  private waiting = 0;
  private readonly frames: InputFrame[] = [];
  private readonly out: InputFrame[] = [];
  /** The batch's first control and the batch's controls (§1.7). */
  private readonly c0: DriveControl = { act: 0, vane: 0, vaneUp: false, rest: false };
  private readonly ctl: Readonly<DriveControl>[] = [];
  private readonly listeners: [EventTarget, string, EventListener, AddEventListenerOptions | boolean][] = [];
  /** World presses accepted (debug/test). */
  presses = 0;
  /** Button and act-key presses accepted, and those on a Cold Snap leg (debug/test). */
  acts = 0;
  snaps = 0;

  constructor(host: InputHost) {
    this.host = host;
    for (let i = 0; i < 8; i++) this.frames.push(newFrame());
    const c = host.canvas;
    this.on(c, 'pointerdown', (e) => this.onDown(e as PointerEvent), { passive: false });
    this.on(window, 'pointermove', (e) => this.onMove(e as PointerEvent), { passive: true });
    this.on(window, 'pointerup', (e) => this.onUp(e as PointerEvent, false), { passive: true });
    this.on(window, 'pointercancel', (e) => this.onUp(e as PointerEvent, true), { passive: true });
    this.on(c, 'lostpointercapture', (e) => this.onUp(e as PointerEvent, false), { passive: true });
    this.on(c, 'contextmenu', (e) => e.preventDefault(), { passive: false });
    this.on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true), false);
    this.on(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false), false);
    this.on(window, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    this.on(window, 'blur', () => this.releaseAll(), false);
  }

  private on(t: EventTarget, type: string, fn: EventListener, opts: AddEventListenerOptions | boolean): void {
    t.addEventListener(type, fn, opts);
    this.listeners.push([t, type, fn, opts]);
  }

  dispose(): void {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners.length = 0;
  }

  /** A world finger (or mouse button) is down turning the sun. */
  get pointerDown(): boolean {
    return this.held && this.kind === 'sun';
  }

  /** A world finger is down steering Drip. */
  get steering(): boolean {
    return this.held && this.kind === 'steer';
  }

  /** A world finger is down on Gust's vane. */
  get vaning(): boolean {
    return this.held && this.kind === 'vane';
  }

  /** A pointer is down on the action button. */
  get buttonDown(): boolean {
    return this.bId >= 0;
  }

  /** A rotation key is held. */
  get keyDown(): boolean {
    return this.keyL !== this.keyR;
  }

  /** True when this pointerdown position is in an ignored edge zone. */
  isEdge(x: number, y: number): boolean {
    return x < EDGE_SIDE_PX || x > window.innerWidth - EDGE_SIDE_PX || y > window.innerHeight - Math.max(this.host.safeBottom(), EDGE_BOTTOM_PX);
  }

  /** The world slot can take a new pointer at time t: it is free, or its owner has been still (§1.2). */
  private free(t: number): boolean {
    return !this.held || t - this.yAt >= YIELD_MS;
  }

  private onDown(e: PointerEvent): void {
    if (!this.host.accepting()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const x = e.clientX;
    const y = e.clientY;
    const t = e.timeStamp;
    const button = this.bId < 0 && this.host.buttonHit(x, y);
    // The button first; then the world slot (a later press is ignored unless the owner is still).
    if (!button && (!this.free(t) || this.isEdge(x, y))) return;
    e.preventDefault();
    try {
      this.host.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort; window listeners still follow the pointer.
    }
    if (!button) return this.take(e.pointerId, x, y, t);
    this.bId = e.pointerId;
    this.bX = x;
    this.bY = y;
    this.bAt = t;
    this.bDone = false;
  }

  /** Takes the world slot for a pointer (also the Title tray's drag handoff), dragging what host.drag() names. */
  begin(e: PointerEvent): void {
    this.take(e.pointerId, e.clientX, e.clientY, e.timeStamp);
  }

  /** Pointer `id` owns the world slot from (x, y) at time t (a still owner it replaces is ignored until it lifts). */
  private take(id: number, x: number, y: number, t: number): void {
    const wasSun = this.held && this.kind === 'sun';
    this.active = id;
    this.kind = this.host.drag();
    this.held = true;
    this.lastX = this.curX = x;
    this.curY = y;
    this.slopX = this.host.starting() ? x : Number.NaN;
    this.yPath = this.rPath = this.ringN = 0;
    this.yAt = this.rAt = t;
    this.push(x, t);
    this.guard = G_NONE;
    if (this.kind === 'sun') this.touch();
    else if (wasSun) this.upEdge = true;
    this.presses++;
    this.host.onPress();
  }

  /** A sun touch-down on the next batch (after an up of the same batch: the up first). */
  private touch(): void {
    if (this.upEdge && !this.downEdge) this.upFirst = true;
    this.downEdge = true;
  }

  private onMove(e: PointerEvent): void {
    const id = e.pointerId;
    if (id !== this.bId && (id !== this.active || !this.held)) return;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    if (list && list.length > 0) {
      for (const ce of list) this.sample(id, ce.clientX, ce.clientY, ce.timeStamp);
    } else {
      this.sample(id, e.clientX, e.clientY, e.timeStamp);
    }
  }

  /** One (coalesced) sample of pointer `id`. */
  private sample(id: number, x: number, y: number, t: number): void {
    if (id === this.bId) {
      if (Math.hypot(x - this.bX, y - this.bY) < BUTTON_SLOP) return;
      // A drag after all (§1.3): the press-in springs back and the world slot takes it, from its
      // touch-down point (or from here after a timed commit); with the slot busy it is ignored until it lifts.
      this.bId = -1;
      if (!this.free(t)) return;
      if (this.bDone) this.take(id, x, y, t);
      else this.take(id, this.bX, this.bY, this.bAt);
    }
    if (id === this.active && this.held) this.moveTo(x, y, t);
  }

  /** Records a world sample (x, ms) in the speed ring. */
  private push(x: number, t: number): void {
    const i = this.ringN++ & 7;
    this.ringX[i] = x;
    this.ringT[i] = t;
  }

  /** The world finger's horizontal speed (px/s) at time t, over the last SPEED_MS of its samples. */
  private speed(t: number): number {
    const n = this.ringN;
    const x = this.ringX[(n - 1) & 7] as number;
    // The newest sample at least SPEED_MS old (the oldest kept if none is).
    let k = n - 1;
    while (k > Math.max(0, n - 8) && (this.ringT[k & 7] as number) > t - SPEED_MS) k--;
    const dt = t - (this.ringT[k & 7] as number);
    return n > 0 && dt > 0 ? (Math.abs(x - (this.ringX[k & 7] as number)) * 1000) / dt : 0;
  }

  /** A guarded vane finger's pause (§1.5): under TAG_VANE_PAUSE for TAG_VANE_PAUSE_MS ends the guard. */
  private pause(t: number): void {
    if (this.guard !== G_VANE) return;
    if (this.speed(t) >= TAG_VANE_PAUSE) this.slowAt = -1;
    else if (this.slowAt < 0) this.slowAt = t;
    else if (t - this.slowAt >= TAG_VANE_PAUSE_MS) this.guard = G_NONE;
  }

  private moveTo(x: number, y: number, t: number): void {
    const d = Math.hypot(x - this.curX, y - this.curY);
    this.curX = x;
    this.curY = y;
    this.push(x, t);
    // The still clocks restart whenever the finger has travelled their distance.
    if ((this.yPath += d) >= YIELD_PX) {
      this.yPath = 0;
      this.yAt = t;
    }
    if ((this.rPath += d) >= REST_PX) {
      this.rPath = 0;
      this.rAt = t;
    }
    if (this.slopX === this.slopX) {
      // Start slop: nothing until START_SLOP px from the press point, then the whole displacement.
      if (Math.abs(x - this.slopX) < START_SLOP) return;
      this.slopX = Number.NaN;
    }
    let k = 1;
    const g = this.guard;
    if (g === G_SUN) k = Math.min(1, (t - this.gAt) / TAG_RAMP_SUN_MS);
    else if (g === G_STEER) {
      // Dropped while the swing is fast; from its first slow sample, a ramp.
      if (this.gAt < 0 && this.speed(t) <= TAG_STEER_FAST) this.gAt = t;
      k = this.gAt < 0 ? 0 : Math.min(1, (t - this.gAt) / TAG_RAMP_STEER_MS);
    } else if (g === G_VANE) {
      this.pause(t);
      k = this.guard === G_VANE ? 0 : 1;
    }
    if (k >= 1) this.guard = G_NONE;
    const dx = (x - this.lastX) * k;
    this.lastX = x;
    if (dx === 0) return;
    if (this.kind === 'steer') this.steerPending += dx * this.host.uPerPx();
    else if (this.kind === 'vane') this.vanePending += dx / VANE_PX;
    else {
      const boost = this.swingBoost ? swingBoost(this.speed(t)) : 1;
      this.pending += (-dx / Math.max(1, this.host.viewportWidth())) * 360 * this.sensitivity * (this.invert ? -1 : 1) * boost;
    }
  }

  private onUp(e: PointerEvent, cancel: boolean): void {
    if (e.pointerId === this.bId) {
      this.bId = -1;
      // A still touch is a press on its lift (not a cancelled one, nor one that committed by time).
      if (!this.bDone && !cancel) this.press();
      return;
    }
    if (e.pointerId !== this.active || !this.held) return;
    this.held = false;
    this.active = -1;
    if (this.kind === 'sun') this.upEdge = true;
    else if (this.kind === 'vane') this.vaneUp = true;
  }

  /** A committed press of the act now: queued for the driver (a third waiting one is dropped). */
  private press(): void {
    const a = this.host.act();
    if (a === 'none' || this.waiting >= PRESS_MAX) return;
    this.waiting++;
    this.acts++;
    if (a === 'snap') this.snaps++;
    this.host.onPress();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.key;
    this.shift = e.shiftKey;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const up = k === 'ArrowUp' || k === 'w' || k === 'W';
    if (up || k === 'ArrowDown' || k === 's' || k === 'S') {
      // §1.4: ↑/W is a press on every leg with an act, ↓/S on a Cold Snap leg; one per keydown.
      if (!down || e.repeat || isControl(e.target) || !this.host.accepting()) return;
      const a = this.host.act();
      if (a === 'snap' || (up && a !== 'none')) this.press();
      else if (up && this.host.starting()) {
        // On the Title and a level's card ↑ starts the run as a turn key does.
        this.host.onPress();
        this.tap();
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
      if (!this.host.accepting()) return;
      e.preventDefault();
      if (this.host.drag() === 'vane') {
        // Gust: one notch per keydown (← west, → east), snapped at once.
        if (e.repeat) return;
        this.vanePending += left ? -1 : 1;
        this.vaneUp = true;
        this.host.onPress();
        return;
      }
      const was = this.keyL || this.keyR;
      if (left) this.keyL = true;
      if (right) this.keyR = true;
      if (!was && !e.repeat) this.host.onPress();
    } else {
      if (left) this.keyL = false;
      if (right) this.keyR = false;
    }
  }

  /** A wheel turn: one synthetic tap frame with the event's (capped) turn, on sun legs only. */
  private onWheel(e: WheelEvent): void {
    if (this.held || e.deltaY === 0 || isControl(e.target) || !this.host.accepting() || this.host.drag() !== 'sun') return;
    e.preventDefault();
    const d = e.deltaMode === 1 ? -WHEEL_NOTCH * Math.sign(e.deltaY) : -WHEEL_PX * e.deltaY;
    this.pending += Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, d));
    this.presses++;
    this.host.onPress();
    this.tap();
  }

  /**
   * Every TAG (§1.5): a world finger that is down keeps its slot with the new leg's drag kind, from
   * where it is (zero jump), guarded against the swing's follow-through. Into 'sun' it touches down on
   * the next batch; out of 'sun' it lifts at 0 °/s. Pending steer and vane deltas are dropped; held
   * keys and waiting presses stay.
   */
  handoff(): void {
    this.steerPending = 0;
    this.vanePending = 0;
    if (!this.held) return;
    const k = this.host.drag();
    if (k === this.kind) return;
    if (this.kind === 'sun') this.upEdge = true;
    else if (k === 'sun') this.touch();
    this.kind = k;
    this.lastX = this.curX;
    this.slopX = Number.NaN;
    this.guard = k === 'sun' ? G_SUN : k === 'steer' ? G_STEER : G_VANE;
    this.gAt = k === 'sun' ? this.now() : -1;
    this.slowAt = -1;
  }

  /** Drops any finger, keys, presses and pending motion (pause, resume, new run, blur). */
  releaseAll(): void {
    for (const id of [this.held ? this.active : -1, this.bId]) {
      try {
        if (id >= 0 && this.host.canvas.hasPointerCapture(id)) this.host.canvas.releasePointerCapture(id);
      } catch {
        // ignore
      }
    }
    this.held = false;
    this.active = -1;
    this.bId = -1;
    this.keyL = false;
    this.keyR = false;
    this.shift = false;
    this.clearPending();
  }

  /** Forgets accumulated motion, edges and waiting presses (the finger state is kept). */
  clearPending(): void {
    this.pending = 0;
    this.downEdge = false;
    this.upEdge = false;
    this.upFirst = false;
    this.steerPending = 0;
    this.vanePending = 0;
    this.vaneUp = false;
    this.waiting = 0;
  }

  /** A synthetic tap (Space/Enter start or retry): downEdge + upEdge in one batch. */
  tap(): void {
    this.downEdge = true;
    this.upEdge = true;
    this.upFirst = false;
  }

  /**
   * Builds `n` InputFrames for this frame's ticks (and their DriveControls, for controls()). Pending
   * rotation (and Drip's slide) is split evenly (quantized, remainder carried); a touch-down lands on
   * the first frame and a lift on the last; a waiting press, the vane's change and its lift on the
   * first control, `rest` on each. First a still button touch commits once it has waited
   * BUTTON_COMMIT_MS, and a guarded vane finger's pause is noticed. With n = 0 (hit-stop) everything
   * keeps accumulating.
   */
  takeFrames(n: number): readonly InputFrame[] {
    this.out.length = 0;
    this.ctl.length = 0;
    if (n <= 0) return this.out;
    const t = this.now();
    if (this.bId >= 0 && !this.bDone && t - this.bAt >= BUTTON_COMMIT_MS) {
      this.bDone = true;
      this.press();
    }
    if (this.held) this.pause(t);
    while (this.frames.length < n) this.frames.push(newFrame());
    // Left/A turns counter-clockwise (+); Shift held is the fine rate (±2). On vane legs the keys move the vane instead.
    const fine = this.shift;
    const key: InputFrame['key'] = this.keyL === this.keyR || this.host.drag() === 'vane' ? 0 : this.keyL ? (fine ? 2 : 1) : fine ? -2 : -1;
    const per = qTheta(this.pending / n);
    this.pending -= per * n;
    if (Math.abs(this.pending) < 1e-9) this.pending = 0;
    const steer = qSteer(this.steerPending / n);
    this.steerPending -= steer * n;
    if (Math.abs(this.steerPending) < 1e-9) this.steerPending = 0;
    const down = this.held && this.kind === 'sun';
    // §1.2: rest only while the sun finger has been still through the whole batch.
    const rest = down && !this.downEdge && t - this.rAt >= REST_MS;
    for (let i = 0; i < n; i++) {
      const f = this.frames[i] as InputFrame;
      f.dTheta = per;
      f.downEdge = false;
      f.upEdge = false;
      f.release = 0;
      f.key = key;
      f.down = down;
      f.snap = false;
      f.verb = 0;
      f.vx = 0;
      f.vy = 0;
      f.steer = steer;
      this.out.push(f);
      this.ctl.push(i === 0 ? this.c0 : rest ? IDLE_REST : IDLE);
    }
    const c0 = this.c0;
    c0.act = this.waiting > 0 ? 1 : 0;
    if (this.waiting > 0) this.waiting--;
    c0.vane = this.vanePending;
    c0.vaneUp = this.vaneUp;
    c0.rest = rest;
    this.vanePending = 0;
    this.vaneUp = false;
    const first = this.frames[0] as InputFrame;
    const last = this.frames[n - 1] as InputFrame;
    if (this.upFirst && this.downEdge) {
      if (n >= 2) {
        first.upEdge = true;
        first.down = false;
        const second = this.frames[1] as InputFrame;
        second.downEdge = true;
      } else {
        first.downEdge = true;
        first.down = this.held;
      }
    } else {
      if (this.downEdge) first.downEdge = true;
      if (this.upEdge) {
        last.upEdge = true;
        // Frames before the release tick still had the finger down.
        for (let i = 0; i < n - 1; i++) (this.frames[i] as InputFrame).down = true;
        last.down = false;
      }
    }
    this.downEdge = false;
    this.upEdge = false;
    this.upFirst = false;
    return this.out;
  }

  /** The DriveControls of the last takeFrames batch (§1.7). */
  controls(): readonly Readonly<DriveControl>[] {
    return this.ctl;
  }
}
