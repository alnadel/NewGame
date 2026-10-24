// Pointer and keyboard input → per-tick InputFrames (V1_PLAN §3, §8; archive/TECH_SPEC §8).
//
// - Pointer Events with getCoalescedEvents(); a horizontal drag of one world-viewport width is one
//   full turn (Δθ = −dx / viewportWidth × 360° × sensitivity, inverted on request).
// - Pointerdowns within 20 CSS px of the left/right edges, or inside the bottom safe inset + 16 px,
//   are ignored (OS back / home gestures live there).
// - Latest pointer wins (a new pointerdown is a fresh catch); pointercancel is a release at 0°/s;
//   lostpointercapture counts as pointerup.
// - Release velocity: requested-angle samples of the last 80 ms; 0 if the newest is > 50 ms old.
// - dTheta is quantized to 1/1024° and release to 1/64 °/s so live play equals replays.
// - Keys: arrows and A/D only (key ±1; with Shift held, ±2 = the sim's fine rate). Escape/P/Enter/
//   Space belong to the UI.
// - Wheel (CC-6): each wheel event is one synthetic tap frame (catch and release at 0 °/s) turning
//   −15°·sign(deltaY) per notch (line mode) or −0.35°·deltaY (pixel mode), at most ±45° per event,
//   ignored while a pointer is down; on the Title it starts the run like a key.
// - Cold Snap (v1.5): a quick swipe down anywhere (≥ SNAP_MIN_PX, at least SNAP_RATIO× more down than
//   sideways, within SNAP_MS of the press, before the press moved SNAP_LOCK_PX sideways: a
//   horizontal drag or flick never snaps), Down/S, or a tap on the frost meter (host.meterHit)
//   sets InputFrame.snap on the next tick; only while host.canSnap() (a run in play, not the hold,
//   the intro card or a menu). A swipe that snaps takes back the turn its press made and releases
//   at 0 °/s, so it never coasts the sun.
// - Elementals v2 (docs/ELEMENTALS_V2.md §7.9): the host names the walking element's verb (verb()),
//   maps CSS px to the ground (toWorld, uPerPx) and says whether a press starts on a target
//   (canTarget); until the verb slots land every verb is played as 'sun' (today's press). cut() ends
//   the presses a TAG hands over.

import type { InputFrame, Verb } from '../core/index.ts';

const EDGE_PX = 20;
const BOTTOM_EXTRA = 16;
const RING = 16;
const VEL_WINDOW_MS = 80;
const VEL_STALE_MS = 50;
/** Wheel turn per notch (line mode), per pixel (pixel mode), and its cap per event (degrees). */
const WHEEL_NOTCH = 15;
const WHEEL_PX = 0.35;
const WHEEL_MAX = 45;
/** Cold Snap swipe: at least this far down (CSS px, or SNAP_MIN_VH of the viewport height if more), this
 * many times more down than sideways, within this long of the press; a press that first moves this
 * far sideways is a drag and never snaps. A meter tap: released within METER_TAP_MS, moved < METER_TAP_PX. */
const SNAP_MIN_PX = 40;
const SNAP_MIN_VH = 0.05;
const SNAP_RATIO = 2.2;
const SNAP_MS = 450;
const SNAP_LOCK_PX = 14;
const METER_TAP_MS = 350;
const METER_TAP_PX = 12;

const qTheta = (d: number): number => Math.round(d * 1024) / 1024;
const qRelease = (w: number): number => Math.round(w * 64) / 64;

export interface InputHost {
  canvas: HTMLCanvasElement;
  /** True when canvas pointers should act (UI on title or play, not paused, no overlay). */
  accepting(): boolean;
  /** Called on every accepted press (pointer or rotation key); the session may start a run. */
  onPress(): void;
  /** World viewport width (CSS px), for the drag mapping. */
  viewportWidth(): number;
  /** Bottom safe-area inset (CSS px). */
  safeBottom(): number;
  /** v1.5: a Cold Snap may be asked for now (a run in play past its hold; no menu, card or pause). */
  canSnap?(): boolean;
  /** v1.5: (x, y) in CSS px is on the HUD's frost meter. */
  meterHit?(x: number, y: number): boolean;
  // Elementals v2 (§7.9): all optional; absent = today's behaviour.
  /** The walking element's verb now: HEROES[s.nubs.hero].verb on a Trial past the start beat, else 'sun'. */
  verb?(): Verb;
  /** CSS px → ground point (u) on the last drawn frame (§1.4); false outside the world viewport. */
  toWorld?(x: number, y: number, out: Float64Array): boolean;
  /** World units per CSS px on the last drawn frame (Drip's finger-exact steer). */
  uPerPx?(): number;
  /** True when a press at this ground point starts on a target now (core burnTarget/growTarget ≥ 0 for the verb). */
  canTarget?(wx: number, wy: number): boolean;
}

/** Interactive elements whose own keyboard handling wins over the game's rotation keys. */
const CONTROL_SELECTOR = 'button, a, input, textarea, select, [role="radio"], [role="tab"], [role="switch"], [role="slider"]';

/** True when a key event's target is (inside) an interactive element or editable content. */
export function isControl(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target.closest(CONTROL_SELECTOR) !== null) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}

function newFrame(): InputFrame {
  return { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0, snap: false };
}

export class Input {
  sensitivity = 1;
  invert = false;
  private readonly host: InputHost;
  private active = -1;
  private lastX = 0;
  private held = false;
  private pending = 0;
  private cum = 0;
  private downEdge = false;
  private upEdge = false;
  /** An up happened before a later down in the same batch. */
  private upFirst = false;
  private release = 0;
  private keyL = false;
  private keyR = false;
  /** Shift is held: rotation keys turn at the fine rate. */
  private shift = false;
  private readonly sT = new Float64Array(RING);
  private readonly sA = new Float64Array(RING);
  private sN = 0;
  private sHead = 0;
  /** The press: where and when it began (CSS px, ms), and its gesture so far (0 open, 1 drag, 2 snapped). */
  private pressX = 0;
  private pressY = 0;
  private pressT = 0;
  private gesture = 0;
  /** The press began on the frost meter. */
  private onMeter = false;
  /** A Cold Snap waits for the next tick. */
  private snapReq = false;
  private readonly frames: InputFrame[] = [];
  private readonly out: InputFrame[] = [];
  private readonly listeners: [EventTarget, string, EventListener, AddEventListenerOptions | boolean][] = [];
  /** Total presses accepted (debug/test). */
  presses = 0;
  /** Cold Snaps asked for (debug/test). */
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

  /** A finger (or mouse button) is down. */
  get pointerDown(): boolean {
    return this.held;
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
    if (this.isEdge(e.clientX, e.clientY)) return;
    e.preventDefault();
    try {
      this.host.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort; window listeners still follow the pointer.
    }
    this.begin(e);
  }

  /** Starts following a pointer (also used for the Title tray drag handoff). */
  begin(e: PointerEvent): void {
    if (this.upEdge && !this.downEdge) this.upFirst = true;
    this.active = e.pointerId;
    this.lastX = e.clientX;
    this.pressX = e.clientX;
    this.pressY = e.clientY;
    this.pressT = e.timeStamp;
    // A press that began before a snap was allowed (the one that starts the run, the start beat) is
    // a drag for good: late-delivered moves of the same stroke never snap.
    this.gesture = this.host.canSnap?.() === true ? 0 : 1;
    this.onMeter = this.host.meterHit?.(e.clientX, e.clientY) === true;
    this.held = true;
    this.downEdge = true;
    this.cum = 0;
    this.sN = 0;
    this.sHead = 0;
    this.pushSample(e.timeStamp, 0);
    this.presses++;
    this.host.onPress();
  }

  private pushSample(t: number, a: number): void {
    this.sT[this.sHead] = t;
    this.sA[this.sHead] = a;
    this.sHead = (this.sHead + 1) % RING;
    if (this.sN < RING) this.sN++;
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.active || !this.held) return;
    // A press that snapped no longer turns the sun.
    if (this.gesture === 2) return;
    if (this.gesture === 0) this.classify(e.clientX, e.clientY, e.timeStamp);
    if (this.gesture === 2) return;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    if (list && list.length > 0) {
      for (const ce of list) this.moveTo(ce.clientX, ce.timeStamp);
    } else {
      this.moveTo(e.clientX, e.timeStamp);
    }
  }

  private moveTo(x: number, t: number): void {
    const dx = x - this.lastX;
    this.lastX = x;
    if (dx === 0) return;
    const w = Math.max(1, this.host.viewportWidth());
    const d = (-dx / w) * 360 * this.sensitivity * (this.invert ? -1 : 1);
    this.pending += d;
    this.cum += d;
    this.pushSample(t, this.cum);
  }

  /**
   * Sorts the press out while it is open: SNAP_LOCK_PX sideways makes it a drag for good; a quick,
   * steep swipe down (see the header) snaps, taking back whatever turn the press had made so far.
   */
  private classify(x: number, y: number, t: number): void {
    const dx = x - this.pressX;
    const dy = y - this.pressY;
    if (Math.abs(dx) >= SNAP_LOCK_PX || t - this.pressT > SNAP_MS || dy < -SNAP_LOCK_PX) {
      this.gesture = 1;
      return;
    }
    const min = Math.max(SNAP_MIN_PX, SNAP_MIN_VH * window.innerHeight);
    if (dy >= min && dy >= SNAP_RATIO * Math.abs(dx) && this.requestSnap()) {
      this.gesture = 2;
      this.pending -= this.cum;
      this.cum = 0;
    }
  }

  /** Asks for a Cold Snap on the next tick (when the host allows one now). */
  requestSnap(): boolean {
    if (this.host.canSnap?.() !== true) return false;
    this.snapReq = true;
    this.snaps++;
    return true;
  }

  private onUp(e: PointerEvent, cancel: boolean): void {
    if (e.pointerId !== this.active || !this.held) return;
    this.held = false;
    this.active = -1;
    this.upEdge = true;
    const snapped = this.gesture === 2;
    // A tap on the frost meter (short, nearly still) snaps.
    if (!snapped && !cancel && this.onMeter && e.timeStamp - this.pressT <= METER_TAP_MS && Math.hypot(e.clientX - this.pressX, e.clientY - this.pressY) < METER_TAP_PX) {
      this.requestSnap();
    }
    this.onMeter = false;
    this.release = cancel || snapped ? 0 : qRelease(this.velocity(e.timeStamp));
  }

  /** Release angular velocity (°/s) from the requested-angle samples of the last 80 ms. */
  private velocity(now: number): number {
    if (this.sN < 2) return 0;
    const newest = (this.sHead - 1 + RING) % RING;
    const tN = this.sT[newest] as number;
    if (now - tN > VEL_STALE_MS) return 0;
    let first = newest;
    for (let k = 1; k < this.sN; k++) {
      const i = (newest - k + RING) % RING;
      if (now - (this.sT[i] as number) > VEL_WINDOW_MS) break;
      first = i;
    }
    const dt = tN - (this.sT[first] as number);
    if (dt < 4) return 0;
    return (((this.sA[newest] as number) - (this.sA[first] as number)) / dt) * 1000;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.key;
    this.shift = e.shiftKey;
    if (k === 'ArrowDown' || k === 's' || k === 'S') {
      // Cold Snap (v1.5): Down or S, once per press of the key.
      if (!down || e.repeat || e.altKey || e.ctrlKey || e.metaKey || isControl(e.target) || !this.host.accepting()) return;
      if (this.requestSnap()) e.preventDefault();
      return;
    }
    let left = false;
    let right = false;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') left = true;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') right = true;
    else return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // Keys aimed at a control (a focused button, a slider, a radio group…) belong to it: an arrow on
    // the focused Missions button must not start a run. Key-ups always release.
    if (down && isControl(e.target)) return;
    if (down) {
      if (!this.host.accepting()) return;
      e.preventDefault();
      const was = this.keyL || this.keyR;
      if (left) this.keyL = true;
      if (right) this.keyR = true;
      if (!was && !e.repeat) this.host.onPress();
    } else {
      if (left) this.keyL = false;
      if (right) this.keyR = false;
    }
  }

  /** A wheel turn: one synthetic tap frame with the event's (capped) turn. */
  private onWheel(e: WheelEvent): void {
    if (this.held || e.deltaY === 0 || isControl(e.target) || !this.host.accepting()) return;
    e.preventDefault();
    const d = e.deltaMode === 1 ? -WHEEL_NOTCH * Math.sign(e.deltaY) : -WHEEL_PX * e.deltaY;
    this.pending += Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, d));
    this.presses++;
    this.host.onPress();
    this.tap();
  }

  /** Drops any finger, keys and pending motion (pause, resume, new run, blur). */
  releaseAll(): void {
    if (this.held && this.active >= 0) {
      try {
        if (this.host.canvas.hasPointerCapture(this.active)) this.host.canvas.releasePointerCapture(this.active);
      } catch {
        // ignore
      }
    }
    this.held = false;
    this.active = -1;
    this.keyL = false;
    this.keyR = false;
    this.shift = false;
    this.clearPending();
  }

  /**
   * Called on every 'tag' (§4.1): ends the verb slot (none yet: every press is a sun press); with
   * `all` (a TAG to or from a steer or blow leg) also ends the sun press, released at 0 °/s.
   */
  cut(all: boolean): void {
    if (!all || !this.held) return;
    try {
      if (this.host.canvas.hasPointerCapture(this.active)) this.host.canvas.releasePointerCapture(this.active);
    } catch {
      // ignore
    }
    this.held = false;
    this.active = -1;
    this.upEdge = true;
    this.release = 0;
  }

  /** Forgets accumulated motion and edges (the finger state is kept). */
  clearPending(): void {
    this.pending = 0;
    this.downEdge = false;
    this.upEdge = false;
    this.upFirst = false;
    this.release = 0;
    this.snapReq = false;
  }

  /** A synthetic tap (Space/Enter start or retry): downEdge + upEdge in one batch. */
  tap(): void {
    this.downEdge = true;
    this.upEdge = true;
    this.upFirst = false;
    this.release = 0;
  }

  /**
   * Builds `n` InputFrames for this frame's ticks. Pending rotation is split evenly (quantized,
   * remainder carried); a press lands on the first frame and a release on the last. With n = 0
   * (hit-stop) everything keeps accumulating.
   */
  takeFrames(n: number): readonly InputFrame[] {
    this.out.length = 0;
    if (n <= 0) return this.out;
    while (this.frames.length < n) this.frames.push(newFrame());
    // Left/A turns counter-clockwise (+); Shift held is the fine rate (±2).
    const fine = this.shift;
    const key: InputFrame['key'] = this.keyL && !this.keyR ? (fine ? 2 : 1) : this.keyR && !this.keyL ? (fine ? -2 : -1) : 0;
    const per = qTheta(this.pending / n);
    this.pending -= per * n;
    if (Math.abs(this.pending) < 1e-9) this.pending = 0;
    for (let i = 0; i < n; i++) {
      const f = this.frames[i] as InputFrame;
      f.dTheta = per;
      f.downEdge = false;
      f.upEdge = false;
      f.release = 0;
      f.key = key;
      f.down = this.held;
      f.snap = false;
      this.out.push(f);
    }
    // A Cold Snap lands on the first tick of the batch.
    if (this.snapReq) {
      (this.frames[0] as InputFrame).snap = true;
      this.snapReq = false;
    }
    const first = this.frames[0] as InputFrame;
    const last = this.frames[n - 1] as InputFrame;
    if (this.upFirst && this.downEdge) {
      if (n >= 2) {
        first.upEdge = true;
        first.release = this.release;
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
        last.release = this.release;
        // Frames before the release tick still had the finger down.
        for (let i = 0; i < n - 1; i++) (this.frames[i] as InputFrame).down = true;
        last.down = false;
      }
    }
    this.downEdge = false;
    this.upEdge = false;
    this.upFirst = false;
    this.release = 0;
    return this.out;
  }
}
