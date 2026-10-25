// Pointer and keyboard input → per-tick InputFrames (V1_PLAN §3, §8; archive/TECH_SPEC §8).
//
// - Pointer Events with getCoalescedEvents(); a horizontal drag of one world-viewport width is one
//   full turn (Δθ = −dx / viewportWidth × 360° × sensitivity, inverted on request).
// - Pointerdowns within 20 CSS px of the left/right edges, or inside the bottom safe inset + 16 px,
//   are ignored (OS back / home gestures live there).
// - Latest pointer wins; a lift (pointerup, pointercancel, lostpointercapture) releases at 0 °/s:
//   nothing coasts (Controls v3, docs/CONTROLS_V3.md: the flick, swipe, tap and hold recognizers
//   are gone; the contract's button and driver replace them).
// - dTheta is quantized to 1/1024° so live play equals replays.
// - Keys: arrows and A/D only (key ±1; with Shift held, ±2 = the sim's fine rate). Escape/P/Enter/
//   Space belong to the UI.
// - Wheel (CC-6): each wheel event is one synthetic tap frame (catch and release at 0 °/s) turning
//   −15°·sign(deltaY) per notch (line mode) or −0.35°·deltaY (pixel mode), at most ±45° per event,
//   ignored while a pointer is down; on the Title it starts the run like a key.
// - Elementals v2 (docs/ELEMENTALS_V2.md §7.9): the host names the walking element's verb (verb()).
//   On 'steer' legs every press slides Drip with the finger (steer, world u, host.uPerPx); on 'blow'
//   legs a press moves nothing. Keys: Up/W acts (burn: VERB_KEY_BURN; grow: VERB_KEY_HOLD until up),
//   Left/Right blow one gust per press on 'blow' legs; the wheel turns the sun on 'sun', 'burn' and
//   'grow' legs only. A queued verb lands on the first frame of the next batch.

import { VERB_EAST, VERB_KEY_BURN, VERB_KEY_HOLD, VERB_RELEASE, VERB_WEST, type InputFrame, type Verb } from '../core/index.ts';

const EDGE_PX = 20;
const BOTTOM_EXTRA = 16;
/** Wheel turn per notch (line mode), per pixel (pixel mode), and its cap per event (degrees). */
const WHEEL_NOTCH = 15;
const WHEEL_PX = 0.35;
const WHEEL_MAX = 45;
/** Queued verbs waiting for their batch. */
const QUEUE = 4;

const qTheta = (d: number): number => Math.round(d * 1024) / 1024;
const qSteer = (u: number): number => Math.round(u * 64) / 64;

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
  // Elementals v2 (§7.9): optional; absent = today's behaviour.
  /** The walking element's verb now: HEROES[s.nubs.hero].verb on a Trial past the start beat, else 'sun'. */
  verb?(): Verb;
  /** World units per CSS px on the last drawn frame (Drip's finger-exact steer). */
  uPerPx?(): number;
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
  return { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0, snap: false, verb: 0, vx: 0, vy: 0, steer: 0 };
}

/** The pointer's press: a sun press (today's), a steer or a blow (§7.9). */
const SUN = 0;
const STEER = 1;
const BLOW = 2;

export class Input {
  sensitivity = 1;
  invert = false;
  private readonly host: InputHost;
  /** The pointer: its id, what it plays (SUN, STEER, BLOW) and whether it is down. */
  private active = -1;
  private kind = SUN;
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
  /** Drip's slide still to send (world u). */
  private steerPending = 0;
  /** Up/W holds a site ('grow'). */
  private keyHold = false;
  /** Verbs waiting for their batch (a ring of QUEUE codes). */
  private readonly qV = new Int8Array(QUEUE);
  private qHead = 0;
  private qN = 0;
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
    this.on(window, 'pointerup', (e) => this.onUp(e as PointerEvent), { passive: true });
    this.on(window, 'pointercancel', (e) => this.onUp(e as PointerEvent), { passive: true });
    this.on(c, 'lostpointercapture', (e) => this.onUp(e as PointerEvent), { passive: true });
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

  /** A finger (or mouse button) is down turning the sun. */
  get pointerDown(): boolean {
    return this.held && this.kind === SUN;
  }

  /** A finger is down steering Drip. */
  get steering(): boolean {
    return this.held && this.kind === STEER;
  }

  /** The walking element's verb ('sun' without a host that says). */
  private verb(): Verb {
    return this.host.verb?.() ?? 'sun';
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
    const verb = this.verb();
    this.begin(e, verb === 'steer' ? STEER : verb === 'blow' ? BLOW : SUN);
  }

  /**
   * Starts following a pointer (also used for the Title tray drag handoff): a sun press, or on a
   * held-sun leg a steer or blow press that never touches the sun.
   */
  begin(e: PointerEvent, kind = SUN): void {
    this.active = e.pointerId;
    this.kind = kind;
    this.held = true;
    this.lastX = e.clientX;
    if (kind === SUN) {
      if (this.upEdge && !this.downEdge) this.upFirst = true;
      this.downEdge = true;
    }
    this.presses++;
    this.host.onPress();
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.active || !this.held) return;
    if (this.kind === STEER) {
      // Drip follows the finger exactly: CSS px → world u on the last drawn frame (no sensitivity, no invert).
      this.steerPending += (e.clientX - this.lastX) * (this.host.uPerPx?.() ?? 1);
      this.lastX = e.clientX;
      return;
    }
    if (this.kind === BLOW) return;
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
    const w = Math.max(1, this.host.viewportWidth());
    this.pending += (-dx / w) * 360 * this.sensitivity * (this.invert ? -1 : 1);
  }

  /** Queues a verb for the next batch (a full queue drops it). */
  private queue(v: number): void {
    if (this.qN >= QUEUE) return;
    this.qV[(this.qHead + this.qN) % QUEUE] = v;
    this.qN++;
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.active || !this.held) return;
    this.held = false;
    this.active = -1;
    if (this.kind === SUN) this.upEdge = true;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.key;
    this.shift = e.shiftKey;
    const verb = this.verb();
    if (k === 'ArrowUp' || k === 'w' || k === 'W') {
      // Elementals v2: Up/W is the act key of 'burn' (one burn per press) and 'grow' (a hold until up).
      if (!down) {
        if (this.keyHold) this.queue(VERB_RELEASE);
        this.keyHold = false;
        return;
      }
      if ((verb !== 'burn' && verb !== 'grow') || e.altKey || e.ctrlKey || e.metaKey || isControl(e.target) || !this.host.accepting()) return;
      e.preventDefault();
      if (e.repeat || this.keyHold) return;
      this.queue(verb === 'burn' ? VERB_KEY_BURN : VERB_KEY_HOLD);
      this.keyHold = verb === 'grow';
      this.host.onPress();
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
    if (down && verb === 'blow') {
      // Gust: one gust per press of Left or Right (the key never turns or steers).
      if (!this.host.accepting()) return;
      e.preventDefault();
      if (e.repeat) return;
      this.queue(left ? VERB_WEST : VERB_EAST);
      this.host.onPress();
      return;
    }
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

  /**
   * A wheel turn: one synthetic tap frame with the event's (capped) turn. Nothing on held-sun legs
   * (Drip's wheel steering is cut for the bundle budget, docs/ELEMENTALS_V2.md §9.3: its keys steer).
   */
  private onWheel(e: WheelEvent): void {
    if (this.held || e.deltaY === 0 || isControl(e.target) || !this.host.accepting()) return;
    const verb = this.verb();
    if (verb === 'steer' || verb === 'blow') return;
    e.preventDefault();
    const d = e.deltaMode === 1 ? -WHEEL_NOTCH * Math.sign(e.deltaY) : -WHEEL_PX * e.deltaY;
    this.pending += Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, d));
    this.presses++;
    this.host.onPress();
    this.tap();
  }

  /** Drops any finger, keys and pending motion (pause, resume, new run, blur); a key hold lets go (VERB_RELEASE). */
  releaseAll(): void {
    try {
      if (this.held && this.host.canvas.hasPointerCapture(this.active)) this.host.canvas.releasePointerCapture(this.active);
    } catch {
      // ignore
    }
    this.held = false;
    this.active = -1;
    this.keyL = false;
    this.keyR = false;
    this.shift = false;
    this.clearPending();
    if (this.keyHold) this.queue(VERB_RELEASE);
    this.keyHold = false;
  }

  /**
   * Forgets accumulated motion, edges and queued verbs (the finger state is kept); a queued release
   * stays, so a hold let go before a pause still lets go after the resume.
   */
  clearPending(): void {
    this.pending = 0;
    this.downEdge = false;
    this.upEdge = false;
    this.upFirst = false;
    this.steerPending = 0;
    let rel = false;
    for (let k = 0; k < this.qN; k++) rel ||= this.qV[(this.qHead + k) % QUEUE] === VERB_RELEASE;
    this.qN = 0;
    if (rel) this.queue(VERB_RELEASE);
  }

  /** A synthetic tap (Space/Enter start or retry): downEdge + upEdge in one batch. */
  tap(): void {
    this.downEdge = true;
    this.upEdge = true;
    this.upFirst = false;
  }

  /**
   * Builds `n` InputFrames for this frame's ticks. Pending rotation (and Drip's slide) is split evenly
   * (quantized, remainder carried); a press lands on the first frame and a release on the last; a
   * queued verb lands on the first frame. With n = 0 (hit-stop) everything keeps accumulating.
   */
  takeFrames(n: number): readonly InputFrame[] {
    this.out.length = 0;
    if (n <= 0) return this.out;
    while (this.frames.length < n) this.frames.push(newFrame());
    // Left/A turns counter-clockwise (+); Shift held is the fine rate (±2). On 'blow' legs the keys blow instead.
    const fine = this.shift;
    const key: InputFrame['key'] = this.keyL === this.keyR || this.verb() === 'blow' ? 0 : this.keyL ? (fine ? 2 : 1) : fine ? -2 : -1;
    const per = qTheta(this.pending / n);
    this.pending -= per * n;
    if (Math.abs(this.pending) < 1e-9) this.pending = 0;
    const steer = qSteer(this.steerPending / n);
    this.steerPending -= steer * n;
    if (Math.abs(this.steerPending) < 1e-9) this.steerPending = 0;
    const down = this.held && this.kind === SUN;
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
    }
    // One queued verb per batch, on its first tick (the next waits for the following batch).
    if (this.qN > 0) {
      (this.frames[0] as InputFrame).verb = this.qV[this.qHead] as InputFrame['verb'] & number;
      this.qHead = (this.qHead + 1) % QUEUE;
      this.qN--;
    }
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
}
