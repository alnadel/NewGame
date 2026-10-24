// Pure game-layer logic: guide Auto rules and ghost hints (V1_PLAN §6.2-§6.3), the fixed-step clock
// (archive/TECH_SPEC §9.10), URL params (V1_PLAN §14), view letterboxing (archive/TECH_SPEC §9.1), the input
// frame splitting/quantization (V1_PLAN §3.1), the Elementals v2 input model (docs/ELEMENTALS_V2.md
// §7.9) and the perf governor (archive/TECH_SPEC §15).
import { describe, expect, it } from 'vitest';
import { cssEaseInOut, ghostSwingX, ghostSwipe, guideAlpha, HintTracker, nearestSafe, widestArc, type HintInput } from '../../src/game/assist.ts';
import { createView, layoutView } from '../../src/game/camera.ts';
import { FixedClock } from '../../src/game/loop.ts';
import { dailyDateInBounds, isDebugRun, parseParams, startTFor } from '../../src/game/params.ts';
import { Input, type InputHost } from '../../src/game/input.ts';
import { VERB_EAST, VERB_HOLD, VERB_KEY_BURN, VERB_KEY_HOLD, VERB_RELEASE, VERB_TAP, VERB_WEST, type InputFrame, type Verb } from '../../src/core/index.ts';
import { canvasDpr, deviceClass, dprCap, Governor } from '../../src/game/perf.ts';
import { Cadence, type CadenceInput } from '../../src/game/cadence.ts';

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

describe('guide Auto alpha (V1_PLAN §6.3)', () => {
  it('honours Always/Off and profile 0', () => {
    expect(guideAlpha('always', 3, 99, 7, 0.5)).toBe(1);
    expect(guideAlpha('off', 0, 0, 1, 0)).toBe(0);
    expect(guideAlpha('auto', 0, 0, 9, 0.5)).toBe(1);
  });
  it('fades on Day 3 for runs ≤ 5', () => {
    expect(guideAlpha('auto', 3, 4, 2, 0.9)).toBe(1);
    expect(guideAlpha('auto', 3, 4, 3, 0)).toBe(1);
    expect(guideAlpha('auto', 3, 4, 3, 0.25)).toBeCloseTo(0.5);
    expect(guideAlpha('auto', 3, 4, 3, 0.5)).toBe(0);
    expect(guideAlpha('auto', 3, 4, 4, 0.1)).toBe(0);
  });
  it('fades Day 2 over runs 6-10, Day 1 only to run 20, then off', () => {
    expect(guideAlpha('auto', 3, 6, 1, 0.5)).toBe(1);
    expect(guideAlpha('auto', 3, 6, 2, 0.5)).toBeCloseTo(0.8);
    expect(guideAlpha('auto', 3, 10, 2, 0.5)).toBe(0);
    expect(guideAlpha('auto', 3, 15, 1, 0.5)).toBe(1);
    expect(guideAlpha('auto', 3, 15, 2, 0.5)).toBe(0);
    expect(guideAlpha('auto', 3, 21, 1, 0.5)).toBe(0);
  });
});

describe('ghost-thumb hints (V1_PLAN §6.2)', () => {
  const mask = (from: number, to: number): Uint8Array => {
    const m = new Uint8Array(360);
    for (let b = from; b <= to; b++) m[((b % 360) + 360) % 360] = 1;
    return m;
  };
  it('finds arcs and the short way round', () => {
    const out = new Float64Array(2);
    widestArc(mask(350, 375), out);
    expect(out[0]).toBe(26);
    expect(nearestSafe(mask(100, 120), 20)).toBe(80);
    expect(nearestSafe(mask(300, 310), 20)).toBe(-70);
  });
  const input = (over: Partial<HintInput>): HintInput => ({
    profile: 0,
    f: 1,
    sunUp: true,
    now: mask(100, 130),
    next: mask(100, 130),
    theta: 20,
    dragging: false,
    invert: false,
    lessonOn: false,
    ...over,
  });
  it('shows after 0.3 s lit, toward the shade, at most 3 times, profiles 0-1 only', () => {
    const h = new HintTracker();
    const inp = input({});
    expect(h.update(0.2, inp)).toBe(false);
    expect(h.update(0.15, inp)).toBe(true);
    expect(h.dir).toBe('left'); // +θ (counter-clockwise) needs a leftward drag
    expect(h.turn).toBe(1);
    expect(h.target).toBe(115);
    expect(h.targetW).toBe(31);
    let shown = 1;
    for (let i = 0; i < 200; i++) if (h.update(0.1, inp)) shown++;
    expect(shown).toBe(3);
    const p3 = new HintTracker();
    for (let i = 0; i < 50; i++) expect(p3.update(0.1, input({ profile: 3 }))).toBe(false);
  });
  it('aims at the arc that lasts (safe now and 0.6 s ahead) and honours invert', () => {
    const h = new HintTracker();
    // Now: a wide arc clockwise that is about to vanish, and one counter-clockwise that stays.
    const now = mask(280, 359);
    for (let b = 100; b <= 140; b++) now[b] = 1;
    const inp = input({ now, next: mask(95, 150), invert: true });
    h.update(0.31, inp);
    expect(h.turn).toBe(1);
    expect(h.dir).toBe('right'); // inverted controls: counter-clockwise is a rightward drag
  });
  it('keeps its first direction while the target sits about a half-turn away', () => {
    const h = new HintTracker();
    // Target centered at 195 with θ = 20: 175° counter-clockwise, 185° clockwise.
    h.update(0.31, input({ now: mask(185, 205), next: mask(185, 205) }));
    expect(h.turn).toBe(1);
    // The arc drifts past the half-turn (center 215: now 165° clockwise is shorter, by 30°).
    for (let c = 196; c <= 215; c++) h.update(0.05, input({ now: mask(c - 10, c + 10), next: mask(c - 10, c + 10) }));
    expect(h.turn).toBe(1);
    // Far past the hysteresis band the short way wins.
    for (let c = 216; c <= 260; c++) h.update(0.05, input({ now: mask(c - 10, c + 10), next: mask(c - 10, c + 10) }));
    expect(h.turn).toBe(-1);
  });
  it('treats small gaps inside a safe region as one target', () => {
    const h = new HintTracker();
    const m = mask(100, 130);
    for (let b = 135; b <= 160; b++) m[b] = 1; // a 4° sliver gap at 131..134
    h.update(0.31, input({ now: m, next: m }));
    expect(h.targetW).toBe(61);
  });
  it('loops lesson hints while the sim lesson is on, then plain hints (A5: the sim decides the pass)', () => {
    const h = new HintTracker();
    const lit = input({ lessonOn: true });
    expect(h.update(0.31, lit)).toBe(true);
    expect([h.lesson, h.lessonStarted]).toEqual([true, true]);
    // No timeout: still on long after a plain hint would have ended.
    for (let i = 0; i < 50; i++) h.update(0.1, lit);
    expect(h.lesson).toBe(true);
    expect(h.showing(false)).toBe(true);
    expect(h.showing(true)).toBe(false); // the thumb hides while a finger is down
    // Nubs in shade (a passing shadow, or the player's swing): the hint rests, the lesson goes on.
    for (let i = 0; i < 4; i++) h.update(0.1, input({ lessonOn: true, f: 0 }));
    expect(h.lesson).toBe(false);
    expect(h.lessonStarted).toBe(true);
    // Lit again: the lesson hint returns, and lesson hints never run out.
    for (let k = 0; k < 5; k++) {
      expect(h.update(0.31, lit)).toBe(true);
      expect(h.lesson).toBe(true);
      for (let i = 0; i < 4; i++) h.update(0.1, input({ lessonOn: true, f: 0 }));
    }
    // The sim ends the lesson (lessonDone): the playing hint stops, later hints are plain ones.
    h.update(0.31, lit);
    expect(h.lesson).toBe(true);
    h.update(0.05, input({ lessonOn: false }));
    expect(h.lesson).toBe(false);
    expect(h.update(0.31, input({ lessonOn: false }))).toBe(true);
    expect(h.lesson).toBe(false);
    expect(h.active).toBeGreaterThan(0);
  });
  it('follows the ui.css ghost keyframes', () => {
    expect(cssEaseInOut(0)).toBe(0);
    expect(cssEaseInOut(1)).toBe(1);
    expect(cssEaseInOut(0.5)).toBeCloseTo(0.5, 5);
    expect(cssEaseInOut(0.25)).toBeCloseTo(0.1291, 3);
    expect(ghostSwingX(0.04)).toBe(-1);
    expect(ghostSwingX(0.29)).toBeCloseTo(0, 5);
    expect(ghostSwingX(0.54)).toBe(1);
    expect(ghostSwingX(0.96)).toBe(-1);
    const out = new Float64Array(2);
    ghostSwipe(0.1, out);
    expect(out[0]).toBe(0);
    ghostSwipe(0.45, out);
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[1]).toBe(1);
    ghostSwipe(0.99, out);
    expect(out[0]).toBe(1);
    expect(out[1]).toBeLessThan(0.05);
  });
});

describe('fixed-step clock', () => {
  it('runs 60 ticks per second and caps at 5 per frame', () => {
    const c = new FixedClock();
    let n = 0;
    for (let i = 0; i < 60; i++) n += c.advance(1 / 60);
    expect(n).toBeGreaterThanOrEqual(59);
    expect(n).toBeLessThanOrEqual(60);
    expect(c.advance(0.1)).toBe(5);
    expect(c.acc).toBe(0);
  });
  it('hit-stop freezes, slow-mo scales, fast multiplies', () => {
    const c = new FixedClock();
    c.addHitStop(0.08);
    expect(c.advance(0.05)).toBe(0);
    expect(c.advance(0.02)).toBe(0);
    c.reset();
    c.slowMo(0.5, 1);
    let n = 0;
    for (let i = 0; i < 30; i++) n += c.advance(1 / 60);
    expect(n).toBeGreaterThanOrEqual(14);
    expect(n).toBeLessThanOrEqual(15);
    const f = new FixedClock();
    f.fast = 4;
    expect(f.advance(1 / 60)).toBe(4);
  });
});

describe('URL params', () => {
  it('parses debug params', () => {
    const p = parseParams('?seed=42&day=4&t=noon&bot=reactive&fast=4&guide=off&debug=1&test=1&profile=0&chill=30');
    expect(p.seed).toBe(42);
    expect(p.day).toBe(4);
    expect(p.bot).toBe('reactive');
    expect(p.fast).toBe(4);
    expect(p.guide).toBe('off');
    expect(p.debug && p.test).toBe(true);
    expect(p.profile).toBe(0);
    expect(p.chill).toBe(30);
    expect(parseParams('?bot=nope&fast=-3').bot).toBeNull();
    expect(parseParams('?mode=daily&date=2026-10-11').date).toBe('2026-10-11');
  });
  it('parses ?forecast=, ?rung= and ?plan= (v1.1 debug params)', () => {
    const p = parseParams('?forecast=heat&rung=2&plan=0');
    expect([p.forecast, p.rung, p.plan]).toEqual(['heat', 2, false]);
    expect(parseParams('?plan=1').plan).toBe(true);
    const bad = parseParams('?forecast=snow&rung=9&plan=yes');
    expect([bad.forecast, bad.rung, bad.plan]).toEqual([null, null, null]);
    expect(parseParams('?rung=0').rung).toBe(0);
  });
  it('accepts a Daily date from the epoch to tomorrow only', () => {
    const today = '2026-10-11';
    expect(parseParams('?mode=daily&date=2026-01-01', today).date).toBe('2026-01-01');
    expect(parseParams('?mode=daily&date=2026-10-12', today).date).toBe('2026-10-12');
    expect(parseParams('?mode=daily&date=2026-10-13', today).date).toBeNull();
    expect(parseParams('?mode=daily&date=2025-12-31', today).date).toBeNull();
    expect(parseParams('?mode=daily&date=2026-02-30', today).date).toBeNull();
    expect(dailyDateInBounds('2026-12-31', '2026-12-31')).toBe(true);
    expect(dailyDateInBounds('2027-01-01', '2026-12-31')).toBe(true);
    expect(dailyDateInBounds('2027-01-02', '2026-12-31')).toBe(false);
  });
  it('flags sim-altering params as unscored debug runs', () => {
    expect(isDebugRun(parseParams(''))).toBe(false);
    expect(isDebugRun(parseParams('?seed=7&test=1&mute=1&debug=1&perf=0'))).toBe(false);
    expect(isDebugRun(parseParams('?mode=daily&date=2026-10-01'))).toBe(false);
    for (const q of ['?day=7', '?t=noon', '?chill=20', '?profile=3', '?bot=oracle', '?fast=4', '?guide=always', '?forecast=breezy', '?rung=1', '?plan=0', '?on=bank']) {
      expect(isDebugRun(parseParams(q))).toBe(true);
    }
    expect(isDebugRun(parseParams('?fast=1'))).toBe(false);
    // v1.6 rules over the shipped ones: ?on= and ?off= (unknown names ignored).
    expect(parseParams('?on=bank&off=flares,noonHeat,nope').rules).toEqual({ bank: true, flares: false, noonHeat: false });
    expect(parseParams('?on=nope').rules).toBeNull();
  });

  it('maps t= to seconds after dawn', () => {
    expect(startTFor('dawn', 1)).toBe(0);
    expect(startTFor('noon', 1)).toBe(25);
    expect(startTFor('noon', 6)).toBe(22.5);
    expect(startTFor('09:00', 1)).toBeCloseTo(12.5);
    expect(startTFor('bogus', 1)).toBeNull();
  });
});

describe('view letterboxing (archive/TECH_SPEC §9.1)', () => {
  it('fits 360 u across a phone and puts Nubs at 68-70 %', () => {
    const v = createView();
    layoutView(v, 390, 844, 2, NO_INSETS);
    expect(v.k).toBeCloseTo(390 / 360);
    expect(v.viewH).toBeCloseTo(844 / (390 / 360));
    expect(v.nubsFrac).toBe(0.7);
    layoutView(v, 360, 640, 2, NO_INSETS);
    expect(v.nubsFrac).toBe(0.68);
  });
  it('pillarboxes wide screens at 600 u tall', () => {
    const v = createView();
    layoutView(v, 1280, 720, 1, NO_INSETS);
    expect(v.viewH).toBe(600);
    expect(v.vw).toBeCloseTo(360 * 1.2);
    expect(v.vx).toBeCloseTo((1280 - 432) / 2);
  });
});

describe('input frames (V1_PLAN §3.1)', () => {
  // A minimal DOM stand-in: Input only needs addEventListener on the canvas and on window.
  const g = globalThis as unknown as { window?: EventTarget & { innerWidth: number; innerHeight: number } };
  const made = !g.window;
  if (made) g.window = Object.assign(new EventTarget(), { innerWidth: 360, innerHeight: 640 });
  const canvas = new EventTarget() as unknown as HTMLCanvasElement;
  const host: InputHost = { canvas, accepting: () => true, onPress: () => {}, viewportWidth: () => 360, safeBottom: () => 0 };

  const ev = (x: number, t: number): PointerEvent => ({ pointerId: 1, clientX: x, clientY: 300, timeStamp: t, pointerType: 'touch', button: 0 }) as unknown as PointerEvent;

  it('quantizes, splits rotation across ticks and puts edges first/last', () => {
    const inp = new Input(host);
    inp.begin(ev(200, 0));
    (inp as unknown as { moveTo(x: number, t: number): void }).moveTo(190, 16);
    const f = inp.takeFrames(2);
    expect(f.length).toBe(2);
    expect(f[0]!.downEdge).toBe(true);
    expect(f[1]!.downEdge).toBe(false);
    // −dx / 360 px × 360° = +10° over two ticks, each quantized to 1/1024°.
    expect(f[0]!.dTheta).toBe(5);
    expect(f[0]!.dTheta * 1024).toBe(Math.round(f[0]!.dTheta * 1024));
    expect(f[0]!.down && f[1]!.down).toBe(true);
    inp.dispose();
  });

  it('a fast swipe releases with a quantized velocity; a still finger releases at 0', () => {
    const inp = new Input(host);
    const mv = inp as unknown as { moveTo(x: number, t: number): void; onUp(e: PointerEvent, c: boolean): void };
    inp.begin(ev(300, 0));
    for (let i = 1; i <= 5; i++) mv.moveTo(300 - i * 10, i * 10);
    mv.onUp(ev(250, 52), false);
    const f = inp.takeFrames(3);
    expect(f[2]!.upEdge).toBe(true);
    expect(f[2]!.down).toBe(false);
    expect(f[2]!.release).toBeGreaterThan(900);
    expect(f[2]!.release * 64).toBe(Math.round(f[2]!.release * 64));

    inp.begin(ev(300, 1000));
    mv.moveTo(280, 1010);
    mv.onUp(ev(280, 1100), false);
    const g2 = inp.takeFrames(1);
    expect(g2[0]!.release).toBe(0);
    inp.dispose();
  });

  it('a tap in one tick is downEdge + upEdge with the finger up', () => {
    const inp = new Input(host);
    inp.tap();
    const f = inp.takeFrames(1);
    expect(f[0]!.downEdge && f[0]!.upEdge).toBe(true);
    expect(f[0]!.down).toBe(false);
    inp.dispose();
  });

  it('a wheel event is one tap frame turning 15° per notch or 0.35° per pixel, capped at 45° (CC-6)', () => {
    const inp = new Input(host);
    const wheel = (deltaY: number, deltaMode: number): void =>
      (inp as unknown as { onWheel(e: WheelEvent): void }).onWheel({ deltaY, deltaMode, target: null, preventDefault: () => {} } as unknown as WheelEvent);
    wheel(3, 1);
    let f = inp.takeFrames(1);
    expect(f[0]!.downEdge && f[0]!.upEdge).toBe(true);
    expect([f[0]!.dTheta, f[0]!.release, f[0]!.down]).toEqual([-15, 0, false]);
    wheel(-40, 0);
    expect(inp.takeFrames(1)[0]!.dTheta).toBe(14);
    wheel(1000, 0);
    f = inp.takeFrames(3);
    expect(f[0]!.downEdge && f[2]!.upEdge).toBe(true);
    expect(f[0]!.dTheta + f[1]!.dTheta + f[2]!.dTheta).toBe(-45);
    // Ignored while a finger is down.
    inp.begin(ev(200, 0));
    inp.takeFrames(1);
    wheel(3, 1);
    expect(inp.takeFrames(1)[0]!.dTheta).toBe(0);
    inp.dispose();
  });

  it('Shift turns the rotation keys to the fine rate (key ±2)', () => {
    const inp = new Input(host);
    const key = (k: string, down: boolean, shiftKey: boolean): void =>
      (inp as unknown as { onKey(e: KeyboardEvent, d: boolean): void }).onKey({ key: k, shiftKey, repeat: false, target: null, preventDefault: () => {} } as unknown as KeyboardEvent, down);
    key('ArrowLeft', true, false);
    expect(inp.takeFrames(1)[0]!.key).toBe(1);
    key('ArrowLeft', true, true);
    expect(inp.takeFrames(1)[0]!.key).toBe(2);
    key('ArrowLeft', false, true);
    key('d', true, true);
    expect(inp.takeFrames(1)[0]!.key).toBe(-2);
    inp.dispose();
  });

  it('pointercancel releases at 0 °/s', () => {
    const inp = new Input(host);
    const mv = inp as unknown as { moveTo(x: number, t: number): void; onUp(e: PointerEvent, c: boolean): void };
    inp.begin(ev(300, 0));
    for (let i = 1; i <= 5; i++) mv.moveTo(300 - i * 10, i * 10);
    mv.onUp(ev(250, 50), true);
    const f = inp.takeFrames(1);
    expect(f[0]!.upEdge).toBe(true);
    expect(f[0]!.release).toBe(0);
    inp.dispose();
  });

  it('holds input through hit-stop (n = 0)', () => {
    const inp = new Input(host);
    inp.begin(ev(200, 0));
    expect(inp.takeFrames(0).length).toBe(0);
    expect(inp.takeFrames(1)[0]!.downEdge).toBe(true);
    inp.dispose();
  });
});

describe('Elementals v2 input (docs/ELEMENTALS_V2.md §7.9)', () => {
  const g = globalThis as unknown as { window?: EventTarget & { innerWidth: number; innerHeight: number } };
  if (!g.window) g.window = Object.assign(new EventTarget(), { innerWidth: 360, innerHeight: 640 });
  const canvas = new EventTarget() as unknown as HTMLCanvasElement;
  type Priv = {
    onDown(e: PointerEvent): void;
    onMove(e: PointerEvent): void;
    onUp(e: PointerEvent, cancel: boolean): void;
    onKey(e: KeyboardEvent, down: boolean): void;
    onWheel(e: WheelEvent): void;
  };
  /** An Input on a host whose verb, targets and scale the test sets; the ground point is (x / 2, (640 − y) / 2) + a 1/32 u offset (quantized away). */
  const mk = (verb: Verb, extra: Partial<InputHost> = {}) => {
    const h = { verb, target: true, uPer: 0.5, snap: true, asked: [] as number[] };
    const host: InputHost = {
      canvas,
      accepting: () => true,
      onPress: () => {},
      viewportWidth: () => 360,
      safeBottom: () => 0,
      canSnap: () => h.snap,
      verb: () => h.verb,
      toWorld: (x, y, out) => {
        out[0] = x / 2 + 1 / 32;
        out[1] = (640 - y) / 2;
        return true;
      },
      uPerPx: () => h.uPer,
      canTarget: (wx, wy) => {
        h.asked.push(wx, wy);
        return h.target;
      },
      ...extra,
    };
    const inp = new Input(host);
    return { h, inp, p: inp as unknown as Priv };
  };
  const pe = (id: number, x: number, y: number, t: number): PointerEvent =>
    ({ pointerId: id, clientX: x, clientY: y, timeStamp: t, pointerType: 'touch', button: 0, preventDefault: () => {} }) as unknown as PointerEvent;
  const ke = (key: string, repeat = false, shiftKey = false): KeyboardEvent =>
    ({ key, shiftKey, repeat, altKey: false, ctrlKey: false, metaKey: false, target: null, preventDefault: () => {} }) as unknown as KeyboardEvent;
  const wheel = (deltaY: number, deltaMode: number): WheelEvent => ({ deltaY, deltaMode, target: null, preventDefault: () => {} }) as unknown as WheelEvent;
  /** Sums a batch: total turn and steer, edges, the verbs with their points, any frame down. */
  const sum = (f: readonly InputFrame[]) => ({
    dTheta: f.reduce((a, x) => a + x.dTheta, 0),
    steer: f.reduce((a, x) => a + (x.steer ?? 0), 0),
    downEdge: f.some((x) => x.downEdge),
    upEdge: f.some((x) => x.upEdge),
    down: f.some((x) => x.down),
    verbs: f.filter((x) => x.verb).map((x) => [x.verb, x.vx, x.vy]),
  });

  it("'sun' plays a scripted pointer, key and wheel sequence exactly as before v2 (the original seven fields)", () => {
    // Recorded from the pre-v2 input.ts (C0c) on the same script.
    const want = [[[0, 1, 1, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, 0]], [[18, 1, 0, 0, 0, 0, 0], [18, 1, 0, 0, 0, 0, 0], [18, 1, 0, 0, 0, 0, 0]], [[0, 1, 0, 0, 0, 0, 0], [0, 0, 0, 1, 1125, 0, 0]], [[-3, 0, 1, 1, -300, 0, 0]], [[0, 0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 1, 0]], [[0, 0, 0, 0, 0, 2, 0]], [[0, 0, 0, 0, 0, -1, 0]], [[0, 0, 0, 0, 0, 0, 0]], [[-7.5, 1, 1, 0, 0, 0, 0], [-7.5, 0, 0, 1, 0, 0, 0]], [[14, 0, 1, 1, 0, 0, 0]], [[0, 1, 1, 0, 0, 0, 1], [0, 1, 0, 0, 0, 0, 0]], [[0, 0, 0, 1, 0, 0, 1]], [[0, 1, 1, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, 0]], [[0, 0, 0, 1, 0, 0, 0]]];
    // With every v2 host member present (and every press on a target), and with none.
    for (const extra of [{}, { verb: undefined, toWorld: undefined, uPerPx: undefined, canTarget: undefined }] as Partial<InputHost>[]) {
      const { inp, p } = mk('sun', extra);
      const got: number[][][] = [];
      const take = (n: number, now: number): void => {
        const fs = inp.takeFrames(n, now);
        for (const f of fs) expect([f.verb, f.vx, f.vy, f.steer]).toEqual([0, 0, 0, 0]);
        got.push(fs.map((f) => [f.dTheta, +f.down, +f.downEdge, +f.upEdge, f.release, f.key, +(f.snap ?? false)]));
      };
      p.onDown(pe(1, 200, 300, 0));
      take(2, 5);
      for (let i = 1; i <= 6; i++) p.onMove(pe(1, 200 - i * 9, 302, i * 8));
      take(3, 50);
      p.onUp(pe(1, 146, 302, 52), false);
      take(2, 60);
      p.onDown(pe(2, 100, 200, 100));
      p.onMove(pe(2, 103, 203, 110));
      p.onUp(pe(2, 103, 203, 130), false);
      take(1, 140);
      p.onKey(ke('ArrowLeft'), true);
      take(2, 150);
      p.onKey(ke('ArrowLeft', false, true), true);
      take(1, 160);
      p.onKey(ke('ArrowLeft', false, true), false);
      p.onKey(ke('d'), true);
      take(1, 170);
      p.onKey(ke('d'), false);
      p.onKey(ke('ArrowUp'), true);
      p.onKey(ke('w'), true);
      take(1, 180);
      p.onKey(ke('ArrowUp'), false);
      p.onWheel(wheel(3, 1));
      take(2, 190);
      p.onWheel(wheel(-40, 0));
      take(1, 200);
      p.onDown(pe(3, 250, 300, 300));
      p.onMove(pe(3, 251, 360, 330));
      take(2, 340);
      p.onUp(pe(3, 251, 360, 350), false);
      p.onKey(ke('ArrowDown'), true);
      take(1, 360);
      p.onDown(pe(4, 120, 300, 400));
      p.onMove(pe(4, 140, 300, 420));
      p.onDown(pe(5, 300, 300, 430));
      p.onMove(pe(5, 280, 300, 440));
      p.onMove(pe(4, 160, 300, 445));
      p.onUp(pe(4, 160, 300, 450), true);
      take(2, 455);
      p.onUp(pe(5, 280, 300, 460), true);
      take(1, 465);
      expect(got).toEqual(want);
      inp.dispose();
    }
  });

  it("'burn': a tap on a target burns at its quantized ground point and leaves the sun alone", () => {
    const { h, inp, p } = mk('burn');
    p.onDown(pe(1, 101, 200, 0));
    // The press is held back: nothing reaches the sun.
    expect(sum(inp.takeFrames(2, 100))).toMatchObject({ dTheta: 0, downEdge: false, down: false, verbs: [] });
    p.onMove(pe(1, 105, 203, 150));
    p.onUp(pe(1, 105, 203, 280), false);
    const f = inp.takeFrames(3, 290);
    // No catch, no turn, no release: a coasting sun keeps coasting. The point is the press's, on the 1/8 u grid.
    expect(sum(f)).toEqual({ dTheta: 0, steer: 0, downEdge: false, upEdge: false, down: false, verbs: [[VERB_TAP, 50.5, 220]] });
    expect(f[0]!.verb).toBe(VERB_TAP);
    expect(h.asked).toEqual([50.5, 220]);
    // Frames are reset every batch.
    expect(sum(inp.takeFrames(2, 300)).verbs).toEqual([]);
    inp.dispose();
  });

  it("'burn'/'grow': a held-back press that moves 12 px becomes a sun press with its turn; a burn press held past 300 ms turns the sun", () => {
    for (const verb of ['burn', 'grow'] as const) {
      const { inp, p } = mk(verb);
      p.onDown(pe(1, 200, 300, 0));
      p.onMove(pe(1, 192, 300, 40));
      expect(sum(inp.takeFrames(1, 50))).toMatchObject({ downEdge: false, dTheta: 0 });
      p.onMove(pe(1, 188, 300, 60));
      // 12 px left: −12/360 of a turn the other way (Δθ = −dx / width × 360°), caught now.
      expect(sum(inp.takeFrames(2, 70))).toMatchObject({ downEdge: true, down: true, dTheta: 12, verbs: [] });
      p.onMove(pe(1, 178, 300, 80));
      expect(sum(inp.takeFrames(1, 90)).dTheta).toBe(10);
      p.onUp(pe(1, 178, 300, 400), false);
      expect(sum(inp.takeFrames(1, 410))).toMatchObject({ upEdge: true, verbs: [] });
      inp.dispose();
    }
    const { inp, p } = mk('burn');
    p.onDown(pe(1, 200, 300, 0));
    expect(sum(inp.takeFrames(1, 300)).downEdge).toBe(false);
    expect(sum(inp.takeFrames(1, 301))).toMatchObject({ downEdge: true, down: true, verbs: [] });
    p.onUp(pe(1, 200, 300, 320), false);
    expect(sum(inp.takeFrames(1, 330))).toMatchObject({ upEdge: true, verbs: [] });
    inp.dispose();
  });

  it("'burn'/'grow': a press off every target is today's sun press", () => {
    for (const verb of ['burn', 'grow'] as const) {
      const { h, inp, p } = mk(verb);
      h.target = false;
      p.onDown(pe(1, 200, 300, 0));
      p.onMove(pe(1, 190, 300, 10));
      expect(sum(inp.takeFrames(1, 20))).toMatchObject({ downEdge: true, down: true, dTheta: 10, verbs: [] });
      p.onUp(pe(1, 190, 300, 30), false);
      expect(sum(inp.takeFrames(1, 40))).toMatchObject({ upEdge: true, verbs: [] });
      inp.dispose();
    }
  });

  it("'grow': still for 220 ms is a hold until it lifts; a shorter press does nothing", () => {
    const { inp, p } = mk('grow');
    p.onDown(pe(1, 100, 400, 0));
    p.onMove(pe(1, 104, 404, 100));
    expect(sum(inp.takeFrames(1, 219)).verbs).toEqual([]);
    expect(sum(inp.takeFrames(2, 220))).toMatchObject({ verbs: [[VERB_HOLD, 50, 120]], downEdge: false, dTheta: 0, down: false });
    p.onMove(pe(1, 120, 404, 400));
    expect(sum(inp.takeFrames(1, 410))).toMatchObject({ verbs: [], dTheta: 0 });
    p.onUp(pe(1, 120, 404, 1000), false);
    expect(sum(inp.takeFrames(1, 1010))).toMatchObject({ verbs: [[VERB_RELEASE, 0, 0]], upEdge: false });
    p.onDown(pe(2, 100, 400, 2000));
    p.onUp(pe(2, 100, 400, 2200), false);
    expect(sum(inp.takeFrames(1, 2210))).toMatchObject({ verbs: [], downEdge: false, upEdge: false });
    inp.dispose();
  });

  it("'grow': a hold that moves 24 px lets go and becomes a sun press", () => {
    const { inp, p } = mk('grow');
    p.onDown(pe(1, 100, 400, 0));
    inp.takeFrames(1, 230);
    p.onMove(pe(1, 110, 400, 300));
    expect(sum(inp.takeFrames(1, 310)).verbs).toEqual([]);
    p.onMove(pe(1, 124, 400, 320));
    const f = sum(inp.takeFrames(2, 330));
    expect(f).toMatchObject({ verbs: [[VERB_RELEASE, 0, 0]], downEdge: true, down: true, dTheta: -24 });
    inp.dispose();
  });

  it("'grow': a second finger turns the sun during a hold, and the first finger's lift still lets go", () => {
    const { inp, p } = mk('grow');
    p.onDown(pe(1, 100, 400, 0));
    inp.takeFrames(1, 230);
    // The second press on a target goes to the sun slot (the verb slot is busy).
    p.onDown(pe(2, 250, 300, 300));
    p.onMove(pe(2, 230, 300, 320));
    expect(sum(inp.takeFrames(2, 330))).toMatchObject({ downEdge: true, down: true, dTheta: 20, verbs: [] });
    p.onUp(pe(1, 100, 400, 400), false);
    expect(sum(inp.takeFrames(1, 410))).toMatchObject({ verbs: [[VERB_RELEASE, 0, 0]], down: true, upEdge: false });
    p.onUp(pe(2, 230, 300, 500), false);
    expect(sum(inp.takeFrames(1, 510))).toMatchObject({ upEdge: true, verbs: [] });
    inp.dispose();
  });

  it("'steer': every drag slides Drip by the finger's world distance (invert ignored), split and quantized; the sun gets nothing", () => {
    const { h, inp, p } = mk('steer');
    inp.invert = true;
    inp.sensitivity = 2;
    h.uPer = 0.37;
    p.onDown(pe(1, 200, 300, 0));
    p.onMove(pe(1, 230, 310, 10));
    p.onMove(pe(1, 240, 280, 20));
    const f = inp.takeFrames(3, 30);
    expect(f.every((x) => x.steer! * 64 === Math.round(x.steer! * 64))).toBe(true);
    const first = sum(f);
    expect(first).toMatchObject({ dTheta: 0, downEdge: false, down: false, upEdge: false, verbs: [] });
    // 40 px × 0.37 u/px = 14.8 u on the 1/64 u grid, the rounding remainder carried to later batches.
    expect(Math.abs(first.steer - 14.8)).toBeLessThan(1 / 64);
    p.onMove(pe(1, 200, 300, 50));
    p.onUp(pe(1, 200, 300, 60), false);
    const back = sum(inp.takeFrames(2, 70));
    expect(back).toMatchObject({ upEdge: false, down: false, dTheta: 0 });
    expect(Math.abs(first.steer + back.steer)).toBeLessThan(1 / 64);
    inp.dispose();
  });

  it("'blow': a quick sideways swipe blows one gust that way; slow, steep or second moves do nothing", () => {
    const { inp, p } = mk('blow');
    p.onDown(pe(1, 200, 300, 0));
    p.onMove(pe(1, 185, 302, 50));
    p.onMove(pe(1, 175, 305, 100));
    p.onMove(pe(1, 100, 305, 150));
    expect(sum(inp.takeFrames(2, 160))).toMatchObject({ verbs: [[VERB_WEST, 0, 0]], dTheta: 0, downEdge: false, down: false });
    p.onUp(pe(1, 100, 305, 170), false);
    p.onDown(pe(2, 100, 300, 200));
    p.onMove(pe(2, 130, 300, 280));
    expect(sum(inp.takeFrames(1, 290)).verbs).toEqual([[VERB_EAST, 0, 0]]);
    p.onUp(pe(2, 130, 300, 300), false);
    // Too slow (past 300 ms), too steep (|dx| < 1.5·|dy|), too short.
    p.onDown(pe(3, 100, 300, 1000));
    p.onMove(pe(3, 160, 300, 1301));
    p.onUp(pe(3, 160, 300, 1310), false);
    p.onDown(pe(4, 100, 300, 2000));
    p.onMove(pe(4, 130, 321, 2100));
    p.onUp(pe(4, 130, 321, 2110), false);
    p.onDown(pe(5, 100, 300, 3000));
    p.onMove(pe(5, 123, 300, 3050));
    p.onUp(pe(5, 123, 300, 3060), false);
    expect(sum(inp.takeFrames(2, 3100))).toMatchObject({ verbs: [], dTheta: 0, upEdge: false });
    inp.dispose();
  });

  it('keys per verb: Up/W burns (6) or holds (7, up 3), Left/Right blow one gust per press, steer with key; Down snaps only on the sun', () => {
    const burn = mk('burn');
    burn.p.onKey(ke('ArrowUp'), true);
    burn.p.onKey(ke('ArrowUp', true), true);
    burn.p.onKey(ke('ArrowUp'), false);
    expect(sum(burn.inp.takeFrames(1, 0)).verbs).toEqual([[VERB_KEY_BURN, 0, 0]]);
    expect(sum(burn.inp.takeFrames(1, 0)).verbs).toEqual([]);
    burn.p.onKey(ke('ArrowLeft'), true);
    expect(burn.inp.takeFrames(1, 0)[0]!.key).toBe(1);
    burn.inp.dispose();

    const grow = mk('grow');
    grow.p.onKey(ke('w'), true);
    grow.p.onKey(ke('w', true), true);
    expect(sum(grow.inp.takeFrames(1, 0)).verbs).toEqual([[VERB_KEY_HOLD, 0, 0]]);
    grow.p.onKey(ke('w'), false);
    expect(sum(grow.inp.takeFrames(1, 0)).verbs).toEqual([[VERB_RELEASE, 0, 0]]);
    grow.inp.dispose();

    const blow = mk('blow');
    blow.p.onKey(ke('ArrowLeft'), true);
    blow.p.onKey(ke('ArrowLeft', true), true);
    let f = blow.inp.takeFrames(1, 0);
    expect([f[0]!.verb, f[0]!.key]).toEqual([VERB_WEST, 0]);
    blow.p.onKey(ke('ArrowLeft'), false);
    blow.p.onKey(ke('d'), true);
    f = blow.inp.takeFrames(1, 0);
    expect([f[0]!.verb, f[0]!.key]).toEqual([VERB_EAST, 0]);
    blow.inp.dispose();

    const steer = mk('steer');
    steer.p.onKey(ke('ArrowLeft', false, true), true);
    f = steer.inp.takeFrames(1, 0);
    expect([f[0]!.verb, f[0]!.key, f[0]!.steer]).toEqual([0, 2, 0]);
    steer.p.onKey(ke('ArrowUp'), true);
    expect(steer.inp.takeFrames(1, 0)[0]!.verb).toBe(0);
    steer.inp.dispose();

    for (const verb of ['sun', 'burn', 'grow', 'steer', 'blow'] as const) {
      const { inp, p } = mk(verb);
      p.onKey(ke('ArrowDown'), true);
      expect(inp.takeFrames(1, 0)[0]!.snap).toBe(verb === 'sun');
      inp.dispose();
    }
  });

  it("the wheel turns the sun on 'sun', 'burn' and 'grow', steers 6 u a notch (0.15 u/px, ±18 u) on 'steer', and does nothing on 'blow'", () => {
    for (const verb of ['sun', 'burn', 'grow'] as const) {
      const { inp, p } = mk(verb);
      p.onWheel(wheel(3, 1));
      expect(sum(inp.takeFrames(1, 0))).toMatchObject({ dTheta: -15, steer: 0 });
      inp.dispose();
    }
    const steer = mk('steer');
    steer.p.onWheel(wheel(3, 1));
    expect(sum(steer.inp.takeFrames(1, 0))).toMatchObject({ dTheta: 0, steer: 6, downEdge: false });
    steer.p.onWheel(wheel(-40, 0));
    expect(sum(steer.inp.takeFrames(1, 0)).steer).toBe(-6);
    steer.p.onWheel(wheel(1000, 0));
    expect(sum(steer.inp.takeFrames(2, 0)).steer).toBe(18);
    steer.inp.dispose();
    const blow = mk('blow');
    blow.p.onWheel(wheel(3, 1));
    expect(sum(blow.inp.takeFrames(1, 0))).toMatchObject({ dTheta: 0, steer: 0, downEdge: false, upEdge: false, verbs: [] });
    blow.inp.dispose();
  });

  it('cut(false) keeps a sun drag and drops the verb slot; cut(true) ends both; cut and releaseAll() let a hold go', () => {
    // A burn press held back at the TAG is dropped: its lift is no tap.
    const a = mk('burn');
    a.h.target = false;
    a.p.onDown(pe(1, 300, 300, 0));
    a.h.target = true;
    a.p.onDown(pe(2, 100, 300, 10));
    a.inp.takeFrames(1, 20);
    a.inp.cut(false);
    a.p.onUp(pe(2, 100, 300, 100), false);
    a.p.onMove(pe(1, 290, 300, 110));
    // The sun drag carries on.
    expect(sum(a.inp.takeFrames(1, 120))).toMatchObject({ verbs: [], dTheta: 10, down: true, upEdge: false });
    a.inp.cut(true);
    expect(sum(a.inp.takeFrames(1, 130))).toMatchObject({ upEdge: true, down: false });
    expect(a.inp.takeFrames(1, 130)[0]!.release).toBe(0);
    a.inp.dispose();

    for (const end of ['cut', 'release'] as const) {
      const b = mk('grow');
      b.p.onDown(pe(1, 100, 400, 0));
      b.inp.takeFrames(1, 230);
      if (end === 'cut') b.inp.cut(false);
      else b.inp.releaseAll();
      expect(sum(b.inp.takeFrames(1, 240)).verbs).toEqual([[VERB_RELEASE, 0, 0]]);
      // The finger is no longer the hold's: its lift sends nothing more.
      b.p.onUp(pe(1, 100, 400, 300), false);
      expect(sum(b.inp.takeFrames(1, 310)).verbs).toEqual([]);
      b.inp.dispose();
    }

    // A steer press ends on cut(true) (no edges: it never held the sun).
    const c = mk('steer');
    c.p.onDown(pe(1, 100, 300, 0));
    c.p.onMove(pe(1, 120, 300, 10));
    c.inp.cut(true);
    c.p.onMove(pe(1, 160, 300, 20));
    expect(sum(c.inp.takeFrames(1, 30))).toMatchObject({ steer: 0, upEdge: false });
    expect(c.inp.touching).toBe(false);
    c.inp.dispose();
  });

  it('queues one verb per batch (a second waits for the next batch) and quantizes points to 1/8 u', () => {
    const { inp, p } = mk('burn');
    p.onDown(pe(1, 101.3, 200.7, 0));
    p.onUp(pe(1, 101.3, 200.7, 50), false);
    p.onKey(ke('ArrowUp'), true);
    const f = inp.takeFrames(4, 60);
    expect(sum(f).verbs).toEqual([[VERB_TAP, 50.625, 219.625]]);
    expect(f[0]!.vx! * 8).toBe(Math.round(f[0]!.vx! * 8));
    expect(sum(inp.takeFrames(4, 70)).verbs).toEqual([[VERB_KEY_BURN, 0, 0]]);
    expect(sum(inp.takeFrames(4, 80)).verbs).toEqual([]);
    inp.dispose();
  });
});

describe('perf governor (archive/TECH_SPEC §15)', () => {
  /** Feeds `seconds` of frames: intervals from `interval(i)` (ms), JS work `work` (ms). */
  function feed(g: Governor, seconds: number, interval: (i: number) => number, work: number): void {
    let t = 0;
    for (let i = 0; t < seconds; i++) {
      const ms = interval(i);
      g.sample(ms, work, ms / 1000);
      t += ms / 1000;
    }
  }

  it('keeps full quality on a steady 30 Hz display with light frames', () => {
    const g = new Governor();
    feed(g, 40, (i) => 33.3 + (i % 3) * 0.2, 2.1);
    expect(g.level).toBe(0);
    expect(g.capped).toBe(true);
    expect(g.dprScale).toBe(1);
  });

  it('steps down on a 30 Hz cadence when the JS work itself is heavy', () => {
    const g = new Governor();
    feed(g, 8, () => 33.3, 24);
    expect(g.level).toBeGreaterThanOrEqual(1);
  });

  it('steps down one notch per 3 s over the 4-level ladder on a 60 Hz display that keeps missing frames', () => {
    const g = new Governor();
    // Every other frame misses vsync: 16.7 / 33.3 ms (mean 25), light JS (the cost is raster).
    feed(g, 6.5, (i) => (i % 2 ? 33.3 : 16.7), 3);
    // First the soft shadow layer goes (its full-screen scaled blit), resolution untouched.
    expect(g.level).toBe(1);
    expect([g.softShadows, g.dprScale]).toEqual([false, 1]);
    feed(g, 3.2, (i) => (i % 2 ? 33.3 : 16.7), 3);
    expect(g.level).toBe(2);
    expect(g.dprScale).toBe(0.75);
    expect(g.particleCap).toBe(400);
    feed(g, 3.2, (i) => (i % 2 ? 33.3 : 16.7), 3);
    expect(g.level).toBe(3);
    expect([g.softShadows, g.dprScale, g.particleCap]).toEqual([false, 0.625, 200]);
    // Level 3 is the floor of the ladder.
    feed(g, 30, (i) => (i % 2 ? 33.3 : 16.7), 3);
    expect(g.level).toBe(3);
  });

  it('starts low-end devices at crisp shadows and never steps back above that', () => {
    const g = new Governor();
    g.startAt(1);
    expect([g.level, g.softShadows, g.dprScale]).toEqual([1, false, 1]);
    feed(g, 30, () => 16.7, 3);
    expect(g.level).toBe(1);
  });

  it('never scales the canvas below 1 device px per CSS px', () => {
    expect(canvasDpr(3, 2, 1)).toBe(2);
    expect(canvasDpr(2, 2, 0.625)).toBe(1.25);
    expect(canvasDpr(2, 1.5, 0.625)).toBe(1);
    expect(canvasDpr(1, 2, 0.75)).toBe(1);
    expect(canvasDpr(0.8, 2, 0.75)).toBe(0.8);
  });

  it('classes ≤ 4 GB or ≤ 4 cores as low-end (not iOS), capped at DPR 1.5', () => {
    expect(deviceClass({ memory: 4, cores: 8, ios: false })).toBe('low');
    expect(deviceClass({ memory: 8, cores: 4, ios: false })).toBe('low');
    expect(deviceClass({ memory: undefined, cores: 4, ios: false })).toBe('low');
    expect(deviceClass({ memory: 8, cores: 8, ios: false })).toBe('normal');
    expect(deviceClass({ memory: undefined, cores: undefined, ios: false })).toBe('normal');
    expect(deviceClass({ memory: undefined, cores: 4, ios: true })).toBe('normal');
    expect(dprCap('low')).toBe(1.5);
    expect(dprCap('normal')).toBe(2);
  });

  it('treats a steady but very slow cadence as slow frames, not a display rate', () => {
    const g = new Governor();
    feed(g, 30, () => 120, 14);
    expect(g.level).toBeGreaterThanOrEqual(2);
  });

  it('ignores the first 2 s after boot and after a reset', () => {
    const g = new Governor();
    feed(g, 1.9, (i) => (i % 2 ? 50 : 16.7), 3);
    expect(g.level).toBe(0);
    g.reset();
    feed(g, 1.9, (i) => (i % 2 ? 50 : 16.7), 3);
    expect(g.level).toBe(0);
  });

  it('steps back up once after 10 s of clean frames, and stays down if that fails', () => {
    const g = new Governor();
    feed(g, 6.5, (i) => (i % 2 ? 33.3 : 16.7), 3);
    expect(g.level).toBe(1);
    feed(g, 15, () => 16.7, 3);
    expect(g.level).toBe(0);
    feed(g, 6.5, (i) => (i % 2 ? 33.3 : 16.7), 3);
    const down = g.level;
    expect(down).toBeGreaterThanOrEqual(1);
    feed(g, 30, () => 16.7, 3);
    expect(g.level).toBe(down);
  });
});

describe('render cadence (K8, render-at-full-display-rate)', () => {
  /** Simulated rAF: `seconds` of frames `ms` apart; returns the draws per second. */
  function run(c: Cadence, seconds: number, ms: number, over: Partial<CadenceInput> = {}, jitter = 0): number {
    let draws = 0;
    const frames = Math.round((seconds * 1000) / ms);
    for (let i = 1; i <= frames; i++) {
      const now = 1000 + i * ms + (jitter ? Math.sin(i * 12.9898) * jitter : 0);
      const inp: CadenceInput = { now, screen: 'play', inputActive: false, timeScale: 1, reducedMotion: false, settled: false, ...over };
      if (c.shouldDraw(inp)) {
        c.drawn(now);
        draws++;
      }
    }
    return draws / seconds;
  }

  it('caps play at 60 fps on 120 Hz (8.33 ms frames) without input', () => {
    const r = run(new Cadence(), 4, 1000 / 120);
    expect(r).toBeGreaterThanOrEqual(58);
    expect(r).toBeLessThanOrEqual(62);
  });

  it('draws every frame of a 60 Hz display, jitter or not', () => {
    expect(run(new Cadence(), 4, 1000 / 60)).toBeGreaterThanOrEqual(59);
    expect(run(new Cadence(), 4, 1000 / 60, {}, 1.5)).toBeGreaterThanOrEqual(58);
  });

  it('gives 60 (not 45) on a 90 Hz display, and about 60 on 144 Hz', () => {
    const r90 = run(new Cadence(), 4, 1000 / 90);
    expect(r90).toBeGreaterThanOrEqual(58);
    expect(r90).toBeLessThanOrEqual(62);
    const r144 = run(new Cadence(), 4, 1000 / 144);
    expect(r144).toBeGreaterThanOrEqual(56);
    expect(r144).toBeLessThanOrEqual(62);
  });

  it('draws every rAF while a pointer or key is down, or the clock runs at another rate', () => {
    expect(run(new Cadence(), 2, 1000 / 120, { inputActive: true })).toBeGreaterThanOrEqual(118);
    expect(run(new Cadence(), 2, 1000 / 120, { timeScale: 0.3 })).toBeGreaterThanOrEqual(118);
    expect(run(new Cadence(), 2, 1000 / 120, { timeScale: 0 })).toBeGreaterThanOrEqual(118);
  });

  it('keeps drawing at 60 fps the moment a long hold or slow-mo ends on a 90-144 Hz display', () => {
    for (const hz of [60, 90, 120, 144]) {
      for (const over of [{ inputActive: true }, { timeScale: 0.3 }]) {
        const c = new Cadence();
        const ms = 1000 / hz;
        let i = 0;
        let last = 0;
        const gaps: number[] = [];
        const span = (seconds: number, active: Partial<CadenceInput>): number => {
          let draws = 0;
          for (const end = i + Math.round((seconds * 1000) / ms); i < end; i++) {
            // rAF timestamps jitter by a fraction of a ms.
            const now = 1000 + i * ms + Math.sin(i * 12.9898) * 1.5;
            if (c.shouldDraw({ now, screen: 'play', inputActive: false, timeScale: 1, reducedMotion: false, settled: false, ...active })) {
              c.drawn(now);
              draws++;
              gaps.push(now - last);
              last = now;
            }
          }
          return draws / seconds;
        };
        span(1, {});
        // A 10 s hold (or slow-mo) draws every rAF; once it ends, play draws at 60 fps straight away.
        expect(span(10, over)).toBeGreaterThanOrEqual(hz - 2);
        gaps.length = 0;
        const label = `${hz} Hz after ${JSON.stringify(over)}`;
        expect(span(2, {}), label).toBeGreaterThanOrEqual(56);
        expect(Math.max(...gaps), label).toBeLessThanOrEqual(25);
        // And evenly: on 60 and 120 Hz every interval is one 16.7 ms slot, not a judder of 8.3 and 25.
        if (hz % 60 === 0) expect(gaps.filter((g) => g < 12.5 || g > 21).length, label).toBe(0);
      }
    }
  });

  it('draws the frame after an invalidation whatever the cap (a resize clears the canvas)', () => {
    for (const screen of ['play', 'pause', 'title', 'results'] as const) {
      const c = new Cadence();
      const inp: CadenceInput = { now: 1000, screen, inputActive: false, timeScale: 1, reducedMotion: true, settled: true };
      expect(c.shouldDraw(inp)).toBe(true);
      c.drawn(inp.now);
      inp.now += 1000 / 120;
      expect(c.shouldDraw(inp), screen).toBe(false);
      c.invalidate();
      expect(c.shouldDraw(inp), screen).toBe(true);
      c.drawn(inp.now);
      inp.now += 1000 / 120;
      expect(c.shouldDraw(inp), screen).toBe(false);
    }
  });

  it('pauses at 30 fps and the reduced-motion Title at 10 fps', () => {
    const pause = run(new Cadence(), 4, 16.7, { screen: 'pause' });
    expect(pause).toBeGreaterThanOrEqual(28);
    expect(pause).toBeLessThanOrEqual(32);
    // Input never lifts the pause cap.
    expect(run(new Cadence(), 2, 1000 / 120, { screen: 'pause', inputActive: true })).toBeLessThanOrEqual(32);
    const title = run(new Cadence(), 4, 16.7, { screen: 'title', reducedMotion: true });
    expect(title).toBeGreaterThanOrEqual(9);
    expect(title).toBeLessThanOrEqual(11);
    expect(run(new Cadence(), 4, 16.7, { screen: 'title' })).toBeGreaterThanOrEqual(59);
  });

  it('draws the settled Results at 20 fps (GR4), and at full rate until they settle', () => {
    const settled = run(new Cadence(), 4, 1000 / 60, { screen: 'results', settled: true });
    expect(settled).toBeGreaterThanOrEqual(19);
    expect(settled).toBeLessThanOrEqual(21);
    expect(run(new Cadence(), 4, 1000 / 120, { screen: 'results', settled: true })).toBeLessThanOrEqual(21);
    expect(run(new Cadence(), 4, 1000 / 60, { screen: 'results' })).toBeGreaterThanOrEqual(59);
    // The flag only applies to the Results.
    expect(run(new Cadence(), 4, 1000 / 60, { screen: 'play', settled: true })).toBeGreaterThanOrEqual(59);
  });

  it('draws a menu once, and again only when invalidated or the screen changes', () => {
    const c = new Cadence();
    expect(run(c, 2, 16.7, { screen: 'menu' }) * 2).toBe(1);
    c.invalidate();
    expect(run(c, 1, 16.7, { screen: 'menu' })).toBe(1);
    expect(run(c, 1, 16.7, { screen: 'menu' })).toBe(0);
    // Back on the Title it draws at once, then at its own rate.
    expect(run(c, 1, 16.7, { screen: 'title' })).toBeGreaterThanOrEqual(59);
    expect(c.draws).toBeGreaterThanOrEqual(61);
  });
});
