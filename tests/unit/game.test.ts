// Pure game-layer logic: guide Auto rules and ghost hints (V1_PLAN §6.2-§6.3), the fixed-step clock
// (TECH_SPEC §9.10), URL params (V1_PLAN §14), view letterboxing (TECH_SPEC §9.1) and the input
// frame splitting/quantization (V1_PLAN §3.1).
import { describe, expect, it } from 'vitest';
import { guideAlpha, HintTracker, nearestSafe, widestArc } from '../../src/game/assist.ts';
import { createView, layoutView } from '../../src/game/camera.ts';
import { FixedClock } from '../../src/game/loop.ts';
import { parseParams, startTFor } from '../../src/game/params.ts';
import { Input, type InputHost } from '../../src/game/input.ts';

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
  it('shows after 0.3 s lit, toward the shade, at most 3 times, profiles 0-1 only', () => {
    const h = new HintTracker();
    const now = mask(100, 130);
    expect(h.update(0.2, 0, 1, true, now, 20, false)).toBe(false);
    expect(h.update(0.15, 0, 1, true, now, 20, false)).toBe(true);
    expect(h.dir).toBe('left'); // +θ (counter-clockwise) needs a leftward drag
    let shown = 1;
    for (let i = 0; i < 200; i++) if (h.update(0.1, 0, 1, true, now, 20, false)) shown++;
    expect(shown).toBe(3);
    const p3 = new HintTracker();
    for (let i = 0; i < 50; i++) expect(p3.update(0.1, 3, 1, true, now, 20, false)).toBe(false);
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
  it('maps t= to seconds after dawn', () => {
    expect(startTFor('dawn', 1)).toBe(0);
    expect(startTFor('noon', 1)).toBe(25);
    expect(startTFor('noon', 6)).toBe(22.5);
    expect(startTFor('09:00', 1)).toBeCloseTo(12.5);
    expect(startTFor('bogus', 1)).toBeNull();
  });
});

describe('view letterboxing (TECH_SPEC §9.1)', () => {
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
