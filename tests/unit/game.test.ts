// Pure game-layer logic: guide Auto rules and ghost hints (V1_PLAN §6.2-§6.3), the fixed-step clock
// (archive/TECH_SPEC §9.10), URL params (V1_PLAN §14), view letterboxing (archive/TECH_SPEC §9.1), the input
// frame splitting/quantization (V1_PLAN §3.1) and the perf governor (archive/TECH_SPEC §15).
import { describe, expect, it } from 'vitest';
import { cssEaseInOut, ghostSwingX, ghostSwipe, guideAlpha, HintTracker, nearestSafe, widestArc, type HintInput } from '../../src/game/assist.ts';
import { createView, layoutView } from '../../src/game/camera.ts';
import { FixedClock } from '../../src/game/loop.ts';
import { dailyDateInBounds, isDebugRun, parseParams, startTFor } from '../../src/game/params.ts';
import { createInput, swingBoost, type Input, type InputHost } from '../../src/game/input.ts';
import { createDriver, createRun, NOTE_REFUSE, REFUSE_CHARGING, step, type DragKind, type DriveAct, type DriveControl, type InputFrame } from '../../src/core/index.ts';
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
  it('fits 360 u across a phone and puts Nubs as high as keeps 352 u ahead below the HUD (Controls v3 §5.2)', () => {
    const v = createView();
    layoutView(v, 390, 844, 2, { ...NO_INSETS, top: 47 });
    expect(v.k).toBeCloseTo(390 / 360);
    expect(v.viewH).toBeCloseTo(844 / (390 / 360));
    expect(v.nubsFrac).toBe(0.6);
    layoutView(v, 430, 932, 2, { ...NO_INSETS, top: 47 });
    expect(v.nubsFrac).toBe(0.6);
    layoutView(v, 412, 915, 2, NO_INSETS);
    expect(v.nubsFrac).toBe(0.6);
    layoutView(v, 360, 640, 2, NO_INSETS);
    expect(v.nubsFrac).toBeCloseTo(0.65, 9);
    layoutView(v, 360, 640, 2, { ...NO_INSETS, top: 24 });
    expect(v.nubsFrac).toBeCloseTo(0.6875, 9);
    layoutView(v, 1280, 720, 1, NO_INSETS);
    expect(v.nubsFrac).toBeCloseTo(0.6756, 3);
    // Every size keeps 352 u visible between Nubs and the HUD band.
    for (const [w, hh, top] of [[390, 844, 47], [360, 640, 0], [360, 640, 24], [1280, 720, 0], [430, 932, 47]] as const) {
      layoutView(v, w, hh, 1, { ...NO_INSETS, top });
      expect(v.nubsFrac * v.viewH - (top + 64) / v.k).toBeGreaterThanOrEqual(352 - 1e-9);
    }
  });
  it('pillarboxes wide screens at 600 u tall', () => {
    const v = createView();
    layoutView(v, 1280, 720, 1, NO_INSETS);
    expect(v.viewH).toBe(600);
    expect(v.vw).toBeCloseTo(360 * 1.2);
    expect(v.vx).toBeCloseTo((1280 - 432) / 2);
  });
});

/** Dispatches a synthetic event of `type` with `props` on `t` (the input listens on the canvas and the window). */
function fire(t: EventTarget, type: string, props: Record<string, unknown>): void {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
  t.dispatchEvent(e);
}

describe('input frames (V1_PLAN §3.1)', () => {
  // A minimal DOM stand-in: the input only needs addEventListener on the canvas and on window.
  const g = globalThis as unknown as { window?: EventTarget & { innerWidth: number; innerHeight: number } };
  if (!g.window) g.window = Object.assign(new EventTarget(), { innerWidth: 360, innerHeight: 640 });
  const win = g.window;
  const canvas = new EventTarget() as unknown as HTMLCanvasElement;
  const host: InputHost = {
    canvas,
    accepting: () => true,
    onPress: () => {},
    viewportWidth: () => 360,
    safeBottom: () => 0,
    drag: () => 'sun',
    act: () => 'none',
    buttonHit: () => false,
    starting: () => false,
    uPerPx: () => 1,
  };

  const ev = (x: number, t: number): PointerEvent => ({ pointerId: 1, clientX: x, clientY: 300, timeStamp: t, pointerType: 'touch', button: 0 }) as unknown as PointerEvent;
  const pointer = (type: string, x: number): void => fire(win, type, { pointerId: 1, clientX: x, clientY: 300, timeStamp: 0, pointerType: 'touch', button: 0 });
  const wheel = (deltaY: number, deltaMode: number): void => fire(win, 'wheel', { deltaY, deltaMode });
  const key = (k: string, down: boolean, shiftKey: boolean): void => fire(win, down ? 'keydown' : 'keyup', { key: k, shiftKey, repeat: false });

  it('quantizes, splits rotation across ticks and puts edges first/last', () => {
    const inp = createInput(host);
    inp.begin(ev(200, 0));
    pointer('pointermove', 190);
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

  it('a tap in one tick is downEdge + upEdge with the finger up', () => {
    const inp = createInput(host);
    inp.tap();
    const f = inp.takeFrames(1);
    expect(f[0]!.downEdge && f[0]!.upEdge).toBe(true);
    expect(f[0]!.down).toBe(false);
    inp.dispose();
  });

  it('a wheel event is one tap frame turning 15° per notch or 0.35° per pixel, capped at 45° (CC-6)', () => {
    const inp = createInput(host);
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
    const inp = createInput(host);
    key('ArrowLeft', true, false);
    expect(inp.takeFrames(1)[0]!.key).toBe(1);
    key('ArrowLeft', true, true);
    expect(inp.takeFrames(1)[0]!.key).toBe(2);
    key('ArrowLeft', false, true);
    key('d', true, true);
    expect(inp.takeFrames(1)[0]!.key).toBe(-2);
    key('d', false, false);
    inp.dispose();
  });

  it('a lift releases at 0 °/s however fast the finger moved (Controls v3: nothing coasts)', () => {
    const inp = createInput(host);
    inp.begin(ev(300, 0));
    for (let i = 1; i <= 5; i++) pointer('pointermove', 300 - i * 10);
    pointer('pointerup', 250);
    const f = inp.takeFrames(3);
    expect(f[2]!.upEdge).toBe(true);
    expect(f[2]!.down).toBe(false);
    expect(f.every((x) => x.release === 0)).toBe(true);
    inp.dispose();
  });

  it('holds input through hit-stop (n = 0)', () => {
    const inp = createInput(host);
    inp.begin(ev(200, 0));
    expect(inp.takeFrames(0).length).toBe(0);
    expect(inp.takeFrames(1)[0]!.downEdge).toBe(true);
    inp.dispose();
  });
});

describe('Controls v3 input (docs/CONTROLS_V3.md §1, §12.1)', () => {
  const g = globalThis as unknown as { window?: EventTarget & { innerWidth: number; innerHeight: number } };
  if (!g.window) g.window = Object.assign(new EventTarget(), { innerWidth: 360, innerHeight: 640 });
  const win = g.window;
  const canvas = new EventTarget() as unknown as HTMLCanvasElement;
  /** An Input whose leg (drag kind, act, start beat) and clock the test sets; the button's disc is x ≥ 280, 500 ≤ y ≤ 600. */
  const mk = () => {
    const h = { drag: 'sun' as DragKind, act: 'snap' as DriveAct, starting: false, pressed: 0, safe: 0, t: 0 };
    const host: InputHost = {
      canvas,
      accepting: () => true,
      onPress: () => void h.pressed++,
      viewportWidth: () => 360,
      safeBottom: () => h.safe,
      drag: () => h.drag,
      act: () => h.act,
      buttonHit: (x, y) => h.act !== 'none' && x >= 280 && y >= 500 && y <= 600,
      starting: () => h.starting,
      uPerPx: () => 0.5,
    };
    const inp = createInput(host);
    inp.now = () => h.t;
    /** Pointer `id` at (x, y) at the test clock: down, a move, up (or a cancel). */
    const pe = (id: number, x: number, y: number) => ({ pointerId: id, clientX: x, clientY: y, timeStamp: h.t, pointerType: 'touch', button: 0 });
    const down = (id: number, x: number, y = 300): void => fire(canvas, 'pointerdown', pe(id, x, y));
    const move = (id: number, x: number, y = 300): void => fire(win, 'pointermove', pe(id, x, y));
    const up = (id: number, x: number, y = 300, cancel = false): void => fire(win, cancel ? 'pointercancel' : 'pointerup', pe(id, x, y));
    const key = (k: string, isDown = true, repeat = false): void => fire(win, isDown ? 'keydown' : 'keyup', { key: k, shiftKey: false, repeat });
    const wheel = (): void => fire(win, 'wheel', { deltaY: 3, deltaMode: 1 });
    return { h, host, inp, down, move, up, key, wheel };
  };
  const take = (inp: Input, n: number) => ({ f: inp.takeFrames(n), c: inp.controls() });
  const sum = (f: readonly InputFrame[], k: 'dTheta' | 'steer'): number => f.reduce((a, x) => a + (x[k] ?? 0), 0);

  it('the world slot: 1:1 from the first pixel; start slop holds a hold or start-beat press under 10 px, then sends it all; release 0 on every lift', () => {
    const { h, inp, down, move, up } = mk();
    down(1, 200);
    move(1, 198);
    expect(sum(take(inp, 1).f, 'dTheta')).toBe(2);
    up(1, 198);
    expect(take(inp, 1).f[0]!.release).toBe(0);
    h.starting = true;
    down(2, 200);
    move(2, 206);
    move(2, 192);
    let t = take(inp, 2);
    expect([t.f[0]!.downEdge, sum(t.f, 'dTheta')]).toEqual([true, 0]);
    // 10 px from the press point: the whole displacement at once.
    move(2, 190);
    h.starting = false;
    move(2, 189);
    expect(sum(take(inp, 1).f, 'dTheta')).toBe(11);
    up(2, 189);
    t = take(inp, 3);
    expect(t.f.every((x) => x.release === 0) && t.f[2]!.upEdge).toBe(true);
    inp.dispose();
  });

  it('Swing Boost: off by default; 1 + 0.6 · smoothstep(400, 1000, v) of the finger speed over 50 ms', () => {
    expect([swingBoost(0), swingBoost(400), swingBoost(700), swingBoost(1000), swingBoost(5000)]).toEqual([1, 1, 1.3, 1.6, 1.6]);
    const { h, inp, down, move } = mk();
    expect(inp.swingBoost).toBe(false);
    // 1000 px/s: 10 px every 10 ms.
    const swing = (): number => {
      down(1, 300);
      for (let i = 1; i <= 8; i++) {
        h.t += 10;
        move(1, 300 - 10 * i);
      }
      const d = sum(take(inp, 1).f, 'dTheta');
      inp.releaseAll();
      return d;
    };
    expect(swing()).toBe(80);
    inp.swingBoost = true;
    // The first sample reads 1000 px/s too (its 10 ms since the press): every step boosted 1.6×.
    expect(swing()).toBeCloseTo(128, 2);
    inp.dispose();
  });

  it('first pointer wins; a still owner (< 4 px in 300 ms) yields to a new press with zero jump; a moving owner keeps the slot', () => {
    const { h, inp, down, move } = mk();
    down(1, 100);
    // A moving owner: a later press is ignored for its whole life.
    for (let i = 1; i <= 10; i++) {
      h.t += 30;
      move(1, 100 + 5 * i);
    }
    take(inp, 1);
    down(2, 200);
    move(2, 260);
    h.t += 16;
    move(1, 140);
    let t = take(inp, 1);
    expect([sum(t.f, 'dTheta'), inp.presses]).toEqual([10, 1]);
    // Still for 300 ms (3 px of jitter): the next press takes the slot from its own press point.
    move(1, 142);
    h.t += 300;
    move(1, 141);
    down(3, 200);
    t = take(inp, 1);
    expect([t.f[0]!.downEdge, t.f[0]!.dTheta, inp.presses]).toEqual([true, -1, 2]);
    move(3, 190);
    move(1, 0);
    expect(sum(take(inp, 1).f, 'dTheta')).toBe(10);
    inp.dispose();
  });

  it('rest: a sun finger still for 300 ms (< 3 px) rests on every control of the batch; a move ends it', () => {
    const { h, inp, down, move } = mk();
    down(1, 100);
    expect(take(inp, 2).c.some((c) => c.rest)).toBe(false);
    h.t = 200;
    move(1, 102);
    expect(take(inp, 2).c.some((c) => c.rest)).toBe(false);
    h.t = 300;
    let t = take(inp, 3);
    expect(t.c.map((c) => c.rest)).toEqual([true, true, true]);
    h.t = 310;
    move(1, 104);
    t = take(inp, 2);
    expect(t.c.map((c) => c.rest)).toEqual([false, false]);
    // A steer finger never rests (aim help is a sun matter).
    h.drag = 'steer';
    inp.releaseAll();
    down(2, 100);
    h.t = 1000;
    expect(take(inp, 1).c[0]!.rest).toBe(false);
    inp.dispose();
  });

  it('the button: a still tap commits on its lift; a still press commits at 120 ms; presses queue two, one per batch, never touching the sun', () => {
    const { h, inp, down, move, up } = mk();
    down(1, 300, 560);
    expect(inp.buttonDown).toBe(true);
    move(1, 305, 562);
    h.t = 100;
    expect(take(inp, 2).c.every((c) => c.act === 0)).toBe(true);
    up(1, 305, 562);
    expect([inp.acts, inp.snaps, h.pressed, inp.buttonDown]).toEqual([1, 1, 1, false]);
    let t = take(inp, 2);
    expect(t.c.map((x) => x.act)).toEqual([1, 0]);
    expect(t.f.some((x) => x.downEdge || x.upEdge || x.down || x.dTheta !== 0)).toBe(false);
    // Held still: it commits on the first batch 120 ms after it went down (the lift then adds nothing).
    down(2, 300, 560);
    h.t = 219;
    expect(take(inp, 1).c[0]!.act).toBe(0);
    h.t = 220;
    expect(take(inp, 1).c[0]!.act).toBe(1);
    expect(inp.buttonDown).toBe(true);
    h.t = 900;
    up(2, 300, 560);
    expect(inp.acts).toBe(2);
    // A cancel acts nothing; three presses: two wait (one per batch), the third is dropped; a Burn press is no snap.
    down(3, 300, 560);
    up(3, 300, 560, true);
    h.act = 'burn';
    for (let i = 0; i < 3; i++) {
      down(4 + i, 300, 560);
      up(4 + i, 300, 560);
    }
    expect([inp.acts, inp.snaps]).toEqual([4, 2]);
    expect([take(inp, 1).c[0]!.act, take(inp, 1).c[0]!.act, take(inp, 1).c[0]!.act]).toEqual([1, 1, 0]);
    inp.dispose();
  });

  it('drag-through: a touch that moves 12 px first is a world drag from its touch-down point and acts nothing; after a timed commit it drags from there and the act stays', () => {
    const { h, inp, down, move, up } = mk();
    down(1, 300, 560);
    move(1, 294, 560);
    let t = take(inp, 1);
    expect([t.f[0]!.downEdge, t.f[0]!.dTheta, inp.buttonDown]).toEqual([false, 0, true]);
    // The move that crosses 12 px lands as a touch-down carrying the whole displacement.
    move(1, 287, 560);
    expect(inp.buttonDown).toBe(false);
    t = take(inp, 1);
    expect([t.f[0]!.downEdge, t.f[0]!.dTheta, inp.pointerDown, inp.acts]).toEqual([true, 13, true, 0]);
    move(1, 280, 560);
    up(1, 280, 560);
    t = take(inp, 1);
    expect([t.f[0]!.upEdge, t.f[0]!.dTheta, inp.acts, h.pressed]).toEqual([true, 7, 0, 1]);
    // A timed commit, then 12 px: the press stays and the drag starts where the finger is.
    down(2, 300, 560);
    h.t = 130;
    expect(take(inp, 1).c[0]!.act).toBe(1);
    move(2, 300, 572);
    move(2, 290, 572);
    t = take(inp, 1);
    expect([t.f[0]!.downEdge, t.f[0]!.dTheta, inp.acts]).toEqual([true, 10, 1]);
    inp.dispose();
  });

  it('drag-through with the world slot busy is ignored until it lifts; a busy still owner yields to it', () => {
    const { h, inp, down, move, up } = mk();
    down(1, 100);
    h.t = 10;
    move(1, 110);
    take(inp, 1);
    down(2, 300, 560);
    move(2, 280, 560);
    expect([inp.buttonDown, inp.presses]).toEqual([false, 1]);
    move(2, 250, 560);
    move(1, 120);
    expect(sum(take(inp, 1).f, 'dTheta')).toBe(-10);
    up(2, 250, 560);
    expect(inp.acts).toBe(0);
    // Still for 300 ms: a drag from the disc takes the slot.
    h.t = 400;
    down(3, 300, 560);
    move(3, 288, 560);
    const t = take(inp, 1);
    expect([t.f[0]!.downEdge, t.f[0]!.dTheta, inp.presses]).toEqual([true, 12, 2]);
    inp.dispose();
  });

  it('no button on a Drip leg or in the hold: the corner is world; the button is tested before the edge zones', () => {
    const { h, host, inp, down } = mk();
    h.act = 'none';
    h.drag = 'steer';
    down(1, 300, 560);
    expect([inp.buttonDown, inp.steering, inp.presses]).toEqual([false, true, 1]);
    inp.releaseAll();
    // A disc reaching into the side zone still takes its touches there.
    h.act = 'snap';
    const hit = host.buttonHit;
    host.buttonHit = (x, y) => x >= 340 && y >= 500;
    down(2, 350, 560);
    expect(inp.buttonDown).toBe(true);
    host.buttonHit = hit;
    inp.dispose();
  });

  it('edge zones: 16 px at the sides, max(safe inset, 8 px) at the bottom; a press there is ignored for its whole life', () => {
    const { h, inp, down, move } = mk();
    expect([inp.isEdge(15.9, 300), inp.isEdge(16, 300), inp.isEdge(344, 300), inp.isEdge(344.1, 300)]).toEqual([true, false, false, true]);
    expect([inp.isEdge(100, 632), inp.isEdge(100, 632.1)]).toEqual([false, true]);
    h.safe = 34;
    expect([inp.isEdge(100, 606), inp.isEdge(100, 606.1)]).toEqual([false, true]);
    down(1, 12);
    move(1, 100);
    expect([inp.pointerDown, inp.presses]).toEqual([false, 0]);
    down(2, 20);
    move(2, 30);
    expect([inp.pointerDown, sum(take(inp, 1).f, 'dTheta')]).toEqual([true, -10]);
    inp.dispose();
  });

  it('keys per leg: ↑ presses any act, ↓ only the Cold Snap; ← → move the vane one notch on Gust (no repeat); ↑ starts a held run; act keys never move the sun', () => {
    const { h, inp, key } = mk();
    key('ArrowDown');
    key('w');
    expect([inp.acts, inp.snaps]).toEqual([2, 2]);
    expect(take(inp, 1).f[0]!.dTheta).toBe(0);
    take(inp, 1);
    h.act = 'burn';
    key('s');
    key('ArrowUp');
    key('ArrowUp', true, true);
    expect([inp.acts, inp.snaps]).toEqual([3, 2]);
    expect(take(inp, 1).c[0]!.act).toBe(1);
    h.act = 'calm';
    h.drag = 'vane';
    key('ArrowRight');
    key('ArrowRight', true, true);
    key('ArrowRight', false);
    key('ArrowLeft');
    key('ArrowLeft', false);
    key('ArrowLeft');
    const t = take(inp, 1);
    expect([t.c[0]!.vane, t.c[0]!.vaneUp, t.f[0]!.key]).toEqual([-1, true, 0]);
    key('ArrowLeft', false);
    h.act = 'none';
    h.drag = 'steer';
    key('ArrowUp');
    expect(inp.acts).toBe(3);
    h.drag = 'sun';
    h.starting = true;
    const before = h.pressed;
    key('ArrowUp');
    const s = take(inp, 1);
    expect([h.pressed - before, s.f[0]!.downEdge, s.f[0]!.upEdge, inp.acts]).toEqual([1, true, true, 3]);
    inp.dispose();
  });

  it('the wheel turns the sun on sun legs only', () => {
    const { h, inp, wheel } = mk();
    wheel();
    expect(take(inp, 1).f[0]!.dTheta).toBe(-15);
    h.drag = 'vane';
    wheel();
    h.drag = 'steer';
    wheel();
    const f = take(inp, 1).f[0]!;
    expect([f.dTheta, f.downEdge, f.steer]).toEqual([0, false, 0]);
    inp.dispose();
  });

  it('handoff: zero jump, the kind changes with its edges; into sun a 150 ms ramp', () => {
    const { h, inp, down, move } = mk();
    down(1, 100);
    move(1, 110);
    take(inp, 1);
    h.drag = 'steer';
    inp.handoff();
    let t = take(inp, 1);
    expect([t.f[0]!.upEdge, t.f[0]!.down, t.f[0]!.dTheta, inp.steering]).toEqual([true, false, 0, true]);
    // The steer pending at the TAG is dropped.
    h.t = 1000;
    move(1, 130);
    h.drag = 'sun';
    h.t = 2000;
    inp.handoff();
    t = take(inp, 1);
    expect([t.f[0]!.downEdge, t.f[0]!.steer, t.f[0]!.dTheta, inp.pointerDown]).toEqual([true, 0, 0, true]);
    // The ramp: 75 ms in, a 20 px move counts half; past 150 ms, 1:1.
    h.t = 2075;
    move(1, 110);
    h.t = 2200;
    move(1, 100);
    expect(sum(take(inp, 1).f, 'dTheta')).toBe(20);
    inp.dispose();
  });

  it('handoff into steer: motion over 600 px/s is dropped, then ramps in over 300 ms from the first slow sample', () => {
    const { h, inp, down, move } = mk();
    down(1, 200);
    for (let i = 1; i <= 5; i++) {
      h.t = 10 * i;
      move(1, 200 + 10 * i);
    }
    take(inp, 1);
    h.drag = 'steer';
    inp.handoff();
    // Still 1000 px/s: dropped.
    for (let i = 6; i <= 10; i++) {
      h.t = 10 * i;
      move(1, 200 + 10 * i);
    }
    expect(sum(take(inp, 1).f, 'steer')).toBe(0);
    // Slow (100 px/s): the ramp starts at 0 on the first slow sample; 150 ms on, half; then whole.
    h.t = 200;
    move(1, 310);
    h.t = 350;
    move(1, 330);
    h.t = 650;
    move(1, 350);
    // 20 px × 0.5 + 20 px × 1, at 0.5 u/px.
    expect(sum(take(inp, 1).f, 'steer')).toBe(15);
    inp.dispose();
  });

  it('handoff into vane: nothing moves the vane until a 120 ms pause under 40 px/s, then from where the finger is; a new press is unguarded', () => {
    const { h, inp, down, move, up } = mk();
    down(1, 200);
    h.t = 10;
    move(1, 210);
    take(inp, 1);
    h.drag = 'vane';
    inp.handoff();
    for (let i = 2; i <= 10; i++) {
      h.t = 10 * i;
      move(1, 200 + 10 * i);
    }
    expect(take(inp, 1).c[0]!.vane).toBe(0);
    // Still: the pause is noticed at a batch, and 119 ms of it is not enough (a 1 px creep is still a pause).
    h.t = 200;
    take(inp, 1);
    h.t = 319;
    take(inp, 1);
    move(1, 301);
    expect(take(inp, 1).c[0]!.vane).toBe(0);
    h.t = 320;
    take(inp, 1);
    move(1, 337);
    expect(take(inp, 1).c[0]!.vane).toBe(1);
    move(1, 372);
    up(1, 372);
    expect(take(inp, 1).c[0]!.vaneUp).toBe(true);
    down(2, 100);
    move(2, 136);
    expect(take(inp, 1).c[0]!.vane).toBe(1);
    inp.dispose();
  });

  it('a single-pointer drag and key script past the start beat matches the v2 frames on dTheta, down, downEdge, upEdge and key (only release is new: 0)', () => {
    // The v2 rule: −dx / 360 px × 360° per px, the turn split evenly per batch (quantized, remainder
    // carried), a touch-down on a batch's first frame and a lift on its last.
    const { h, inp, down, move, up, key } = mk();
    const script: [string, number][] = [['d', 200], ['m', 190], ['b', 3], ['m', 171], ['m', 172.5], ['b', 2], ['u', 160], ['b', 2], ['kL', 0], ['b', 2], ['kl', 0], ['d', 220], ['b', 1], ['m', 260], ['u', 260], ['b', 3]];
    const got: [number, boolean, boolean, boolean, number][] = [];
    let x = 0;
    let pend = 0;
    let dn = false;
    let up0 = false;
    let held = false;
    let keyL = false;
    const want: [number, boolean, boolean, boolean, number][] = [];
    for (const [op, v] of script) {
      h.t += 16;
      if (op === 'd') {
        down(1, v);
        x = v;
        dn = held = true;
      } else if (op === 'm') {
        move(1, v);
        pend += -(v - x);
        x = v;
      } else if (op === 'u') {
        // A lift sends no motion of its own (v2 and v3 alike).
        up(1, v);
        up0 = true;
        held = false;
      } else if (op === 'kL' || op === 'kl') {
        key('ArrowLeft', op === 'kL');
        keyL = op === 'kL';
      } else {
        for (const f of inp.takeFrames(v)) got.push([f.dTheta + 0, f.down, f.downEdge, f.upEdge, f.key]);
        const per = Math.round((pend / v) * 1024) / 1024;
        pend -= per * v;
        for (let i = 0; i < v; i++) want.push([per + 0, up0 ? i < v - 1 : held, dn && i === 0, up0 && i === v - 1, keyL ? 1 : 0]);
        dn = up0 = false;
      }
    }
    expect(got).toEqual(want);
    inp.dispose();
  });

  it('repeat refusals carry a ≥ 16: two button presses on a charging meter, through the driver', () => {
    const { h, inp, down, up } = mk();
    const s = createRun({ seed: 7, mode: 'endless', profile: 3, tutorial: false, reducedMotion: false });
    const d = createDriver();
    d.begin(s, { aimDeg: 0, track: false, nowOnly: false, autoSnap: false, autoAct: false, reducedMotion: false });
    const run = (n: number): void => {
      for (let i = 0; i < n; i++) {
        const f = inp.takeFrames(1)[0] as InputFrame;
        d.fill(s, f, inp.controls()[0] as DriveControl);
        step(s, f);
      }
    };
    inp.tap();
    run(1);
    while (s.ready > 0) run(1);
    // A meter well short of full: both presses wait out the buffer and are refused.
    s.nubs.frost = 0.2;
    const refusals: number[] = [];
    for (let k = 0; k < 2; k++) {
      down(10 + k, 300, 560);
      up(10 + k, 300, 560);
      run(30);
      for (let i = 0; i < d.noteN; i++) if (d.notes[2 * i] === NOTE_REFUSE) refusals.push(d.notes[2 * i + 1] as number);
      d.clearNotes();
    }
    expect(s.nubs.frost).toBeLessThan(1);
    expect(refusals).toEqual([REFUSE_CHARGING, REFUSE_CHARGING + 16]);
    expect(h.pressed).toBeGreaterThan(0);
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
