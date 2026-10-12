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

import type { InputFrame } from '../core/index.ts';

const EDGE_PX = 20;
const BOTTOM_EXTRA = 16;
const RING = 16;
const VEL_WINDOW_MS = 80;
const VEL_STALE_MS = 50;
/** Wheel turn per notch (line mode), per pixel (pixel mode), and its cap per event (degrees). */
const WHEEL_NOTCH = 15;
const WHEEL_PX = 0.35;
const WHEEL_MAX = 45;

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
  return { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0 };
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
  private readonly frames: InputFrame[] = [];
  private readonly out: InputFrame[] = [];
  private readonly listeners: [EventTarget, string, EventListener, AddEventListenerOptions | boolean][] = [];
  /** Total presses accepted (debug/test). */
  presses = 0;

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

  private onUp(e: PointerEvent, cancel: boolean): void {
    if (e.pointerId !== this.active || !this.held) return;
    this.held = false;
    this.active = -1;
    this.upEdge = true;
    this.release = cancel ? 0 : qRelease(this.velocity(e.timeStamp));
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

  /** Forgets accumulated motion and edges (the finger state is kept). */
  clearPending(): void {
    this.pending = 0;
    this.downEdge = false;
    this.upEdge = false;
    this.upFirst = false;
    this.release = 0;
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
      this.out.push(f);
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
