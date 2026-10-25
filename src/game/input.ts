// Pointer and keyboard input → per-tick InputFrames and DriveControls (V1_PLAN §3, §8; Controls v3,
// docs/CONTROLS_V3.md §1, §11.6).
//
// - Pointer Events with getCoalescedEvents(). Two slots: the world slot (one pointer that drags) and
//   the button slot (the action button's disc, host.buttonHit, tested before the edge zones).
// - The world slot: the first pointer wins and keeps it until it lifts (a later world press is
//   ignored, never captured). What it drags is host.drag() at touch-down: 'sun' turns the sun
//   (Δθ = −dx / viewportWidth × 360° × sensitivity, inverted on request), 'steer' slides Drip by the
//   finger's world distance (host.uPerPx; no sensitivity or invert), 'vane' moves Gust's vane by
//   dx / VANE_PX notches and its lift snaps the vane to its notch (vaneUp). A sun lift (pointerup,
//   pointercancel, lostpointercapture) is an upEdge at 0 °/s: nothing coasts.
// - The button slot: a touch on the disc that lifts within BUTTON_SLOP of its touch-down point is a
//   press (acts++, snaps++ on a Cold Snap leg, host.onPress()); at most 2 wait for their batches, and
//   each reaches the driver on the first tick of one (DriveControl.act). The C0b skeleton: a press
//   commits on its lift; a touch that moves BUTTON_SLOP first acts nothing.
// - Pointerdowns within 20 CSS px of the left/right edges, or inside the bottom safe inset + 16 px,
//   are ignored (OS back / home gestures live there).
// - handoff() (every TAG): a world finger that is down keeps its slot and takes the new leg's drag
//   kind from where it is (zero jump): into 'sun' a downEdge, out of 'sun' an upEdge at 0 °/s;
//   pending steer and vane deltas are dropped, held keys and waiting presses stay.
// - dTheta is quantized to 1/1024° and steer to 1/64 u so live play equals replays. Input writes
//   only dTheta, down, downEdge, upEdge, key and steer; the driver writes the rest (§1.7).
// - Keys (§1.4): ← → / A D turn on sun legs (key ±1; Shift held, ±2 = the sim's fine rate) and steer
//   Drip; on a vane leg each keydown moves the vane one notch. ↑/W is a press on every leg with an
//   act (it starts a held run on the Title and the intro card), ↓/S a press on a Cold Snap leg. Escape/
//   P/Enter/Space belong to the UI.
// - Wheel (CC-6): each wheel event is one synthetic tap frame (catch and release at 0 °/s) turning
//   −15°·sign(deltaY) per notch (line mode) or −0.35°·deltaY (pixel mode), at most ±45° per event,
//   on sun legs only and never while a world finger is down; on the Title it starts the run like a key.

import type { DragKind, DriveAct, DriveControl, InputFrame } from '../core/index.ts';

const EDGE_PX = 20;
const BOTTOM_EXTRA = 16;
/** A button touch that moves this far (CSS px) before it lifts is not a press. */
const BUTTON_SLOP = 12;
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

/** The control of every tick after a batch's first (nothing lands there). */
const IDLE: Readonly<DriveControl> = { act: 0, vane: 0, vaneUp: false, rest: false };

function newFrame(): InputFrame {
  return { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0, snap: false, verb: 0, vx: 0, vy: 0, steer: 0 };
}

export class Input {
  sensitivity = 1;
  invert = false;
  /** Swing Boost (§1.2; UI's branch adds the curve). */
  swingBoost = false;
  private readonly host: InputHost;
  /** The world slot: its pointer, what it drags and whether it is down. */
  private active = -1;
  private kind: DragKind = 'sun';
  private lastX = 0;
  private held = false;
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
  /** The button slot: its pointer (−1 free), its touch-down point (CSS px) and whether it moved BUTTON_SLOP. */
  private bId = -1;
  private bX = 0;
  private bY = 0;
  private bFar = false;
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
    const w = window.innerWidth;
    const h = window.innerHeight;
    return x < EDGE_PX || x > w - EDGE_PX || y > h - (this.host.safeBottom() + BOTTOM_EXTRA);
  }

  private onDown(e: PointerEvent): void {
    if (!this.host.accepting()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const x = e.clientX;
    const y = e.clientY;
    const button = this.bId < 0 && this.host.buttonHit(x, y);
    // The button first; then the world slot, whose first pointer wins (a later press is ignored).
    if (!button && (this.held || this.isEdge(x, y))) return;
    e.preventDefault();
    try {
      this.host.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort; window listeners still follow the pointer.
    }
    if (!button) return this.begin(e);
    this.bId = e.pointerId;
    this.bX = x;
    this.bY = y;
    this.bFar = false;
  }

  /** Takes the world slot for a pointer (also the Title tray's drag handoff), dragging what host.drag() names. */
  begin(e: PointerEvent): void {
    this.active = e.pointerId;
    this.kind = this.host.drag();
    this.held = true;
    this.lastX = e.clientX;
    if (this.kind === 'sun') this.touch();
    this.presses++;
    this.host.onPress();
  }

  /** A sun touch-down on the next batch (after an up of the same batch: the up first). */
  private touch(): void {
    if (this.upEdge && !this.downEdge) this.upFirst = true;
    this.downEdge = true;
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId === this.bId) {
      this.bFar ||= Math.hypot(e.clientX - this.bX, e.clientY - this.bY) >= BUTTON_SLOP;
      return;
    }
    if (e.pointerId !== this.active || !this.held) return;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    if (list && list.length > 0) {
      for (const ce of list) this.moveTo(ce.clientX);
    } else {
      this.moveTo(e.clientX);
    }
  }

  private moveTo(x: number): void {
    const dx = x - this.lastX;
    this.lastX = x;
    if (dx === 0) return;
    if (this.kind === 'steer') this.steerPending += dx * this.host.uPerPx();
    else if (this.kind === 'vane') this.vanePending += dx / VANE_PX;
    else this.pending += (-dx / Math.max(1, this.host.viewportWidth())) * 360 * this.sensitivity * (this.invert ? -1 : 1);
  }

  private onUp(e: PointerEvent, cancel: boolean): void {
    if (e.pointerId === this.bId) {
      this.bId = -1;
      // A still touch is a press (a cancelled one is not).
      if (!this.bFar && !cancel) this.press();
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
   * where it is (zero jump). Into 'sun' it touches down on the next batch; out of 'sun' it lifts at
   * 0 °/s. Pending steer and vane deltas are dropped; held keys and waiting presses stay.
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
   * first control. With n = 0 (hit-stop) everything keeps accumulating.
   */
  takeFrames(n: number): readonly InputFrame[] {
    this.out.length = 0;
    this.ctl.length = 0;
    if (n <= 0) return this.out;
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
      this.ctl.push(i === 0 ? this.c0 : IDLE);
    }
    const c0 = this.c0;
    c0.act = this.waiting > 0 ? 1 : 0;
    if (this.waiting > 0) this.waiting--;
    c0.vane = this.vanePending;
    c0.vaneUp = this.vaneUp;
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

  /** The DriveControls of the last takeFrames batch (§1.7; `rest` is always false in this skeleton). */
  controls(): readonly Readonly<DriveControl>[] {
    return this.ctl;
  }
}
