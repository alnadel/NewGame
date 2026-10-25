// Camera and view metrics (archive/TECH_SPEC §9.1, V1_PLAN §9): the 360 u world viewport fitted to the
// screen (letterboxed outside 600-860 u of height), Nubs as high as keeps the whole targeting range
// in view below the HUD (Controls v3, docs/CONTROLS_V3.md §5.2: 60-72 % of the view height), trauma
// shake and zoom pulses. Everything is drawn in CSS-pixel screen space:
//   sx = ox + x·S        sy = oy − (y + 0.25·z)·S
// so the renderer never draws under a flipped transform (text, sprites and arcs stay upright).

import type { Insets } from '../platform/safeArea.ts';

export const VIEW_WIDTH = 360;
const MIN_VIEW_H = 600;
const MAX_VIEW_H = 860;
/** §5.2: the world (u) that stays visible ahead of Nubs (the 340 u targeting range + 12), and the HUD band (CSS px under the top inset). */
const AHEAD_U = 352;
const HUD_PX = 64;
/** Oblique projection: a point at height z is drawn 0.25·z higher. */
export const OBLIQUE = 0.25;

export interface View {
  cssW: number;
  cssH: number;
  dpr: number;
  safe: Insets;
  /** World viewport rectangle in CSS px. */
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  /** CSS px per world unit at zoom 1. */
  k: number;
  /** Visible world height (u) at zoom 1. */
  viewH: number;
  /** Nubs' height in the viewport, as a fraction from the top. */
  nubsFrac: number;
  /** Current mapping: sx = ox + x·S, sy = oy − y·S. */
  S: number;
  ox: number;
  oy: number;
  /** Visible world bounds for culling (ground plane). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Screen position of Nubs' ground point. */
  nx: number;
  ny: number;
}

export function createView(): View {
  return {
    cssW: 1,
    cssH: 1,
    dpr: 1,
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    vx: 0,
    vy: 0,
    vw: 1,
    vh: 1,
    k: 1,
    viewH: 600,
    nubsFrac: 0.68,
    S: 1,
    ox: 0,
    oy: 0,
    x0: 0,
    x1: VIEW_WIDTH,
    y0: 0,
    y1: 600,
    nx: 0,
    ny: 0,
  };
}

/** Fits the world viewport to a CSS size (letterbox rules of archive/TECH_SPEC §9.1). */
export function layoutView(v: View, cssW: number, cssH: number, dpr: number, safe: Insets): void {
  v.cssW = Math.max(1, cssW);
  v.cssH = Math.max(1, cssH);
  v.dpr = dpr;
  v.safe = safe;
  let k = v.cssW / VIEW_WIDTH;
  let viewH = v.cssH / k;
  if (viewH < MIN_VIEW_H) {
    k = v.cssH / MIN_VIEW_H;
    viewH = MIN_VIEW_H;
    v.vw = VIEW_WIDTH * k;
    v.vx = (v.cssW - v.vw) / 2;
    v.vy = 0;
    v.vh = v.cssH;
  } else if (viewH > MAX_VIEW_H + safe.top / k) {
    // Very tall: the world keeps 860 u below the notch; the rest at the bottom is a bar.
    v.vx = 0;
    v.vw = v.cssW;
    v.vy = 0;
    viewH = MAX_VIEW_H + safe.top / k;
    v.vh = viewH * k;
  } else {
    v.vx = 0;
    v.vy = 0;
    v.vw = v.cssW;
    v.vh = v.cssH;
  }
  v.k = k;
  v.viewH = viewH;
  // §5.2: Nubs rides as high as keeps AHEAD_U visible below the HUD band, so the thumb's band
  // under him stays clear of the dial on tall phones.
  v.nubsFrac = Math.min(0.72, Math.max(0.6, (AHEAD_U + (safe.top + HUD_PX) / k) / viewH));
}

/** Maps world point (cx, cy) to screen (scx, scy) at scale S, then derives culling bounds. */
export function setMapping(v: View, S: number, cx: number, cy: number, scx: number, scy: number): void {
  v.S = S;
  v.ox = scx - cx * S;
  v.oy = scy + cy * S;
  v.x0 = (v.vx - v.ox) / S;
  v.x1 = (v.vx + v.vw - v.ox) / S;
  v.y1 = (v.oy - v.vy) / S;
  v.y0 = (v.oy - v.vy - v.vh) / S;
}

export interface CameraFx {
  /** Shake amplitude (u) and its decay. */
  shake: number;
  shakeT: number;
  /** Zoom pulse: peak extra zoom, elapsed and duration (s). */
  zoomPeak: number;
  zoomT: number;
  zoomDur: number;
  /** Held zoom (the death push-in): extra zoom it eases to, time since it was asked (s), ease time. */
  holdPeak: number;
  holdT: number;
  holdDur: number;
  reducedMotion: boolean;
  /** Time accumulator for the shake noise. */
  clock: number;
}

export function createCameraFx(): CameraFx {
  return { shake: 0, shakeT: 0, zoomPeak: 0, zoomT: 0, zoomDur: 0, holdPeak: 0, holdT: 0, holdDur: 1, reducedMotion: false, clock: 0 };
}

/** Adds trauma: shake of `amp` u that decays over roughly `dur` seconds. */
export function addShake(c: CameraFx, amp: number, dur: number): void {
  if (c.reducedMotion) return;
  if (amp > c.shake) c.shake = amp;
  c.shakeT = Math.max(c.shakeT, dur);
}

/** A smooth zoom bump to 1 + peak over `dur` seconds (cloud capture: 0.04 over 0.4 s). */
export function addZoomPulse(c: CameraFx, peak: number, dur: number): void {
  if (c.reducedMotion) return;
  c.zoomPeak = peak;
  c.zoomT = 0;
  c.zoomDur = dur;
}

/**
 * A held zoom: after `delay` s the camera eases (easeOutCubic over `dur` s) to 1 + peak around
 * Nubs and stays there until the camera is reset (the death push-in; the Melt Map pull starts from
 * it). None under reduced motion.
 */
export function holdZoom(c: CameraFx, peak: number, delay: number, dur: number): void {
  if (c.reducedMotion) return;
  c.holdPeak = peak;
  c.holdT = -delay;
  c.holdDur = dur;
}

export function updateCameraFx(c: CameraFx, dt: number): void {
  c.clock += dt;
  if (c.holdPeak > 0) c.holdT += dt;
  if (c.shakeT > 0) {
    c.shakeT -= dt;
    if (c.shakeT <= 0) {
      c.shakeT = 0;
      c.shake = 0;
    }
  }
  if (c.zoomDur > 0) {
    c.zoomT += dt;
    if (c.zoomT >= c.zoomDur) c.zoomDur = 0;
  }
}

/** Current zoom factor (1 = none). */
export function zoomOf(c: CameraFx): number {
  const u = Math.max(0, Math.min(1, c.holdT / c.holdDur));
  const hold = c.holdPeak > 0 ? 1 + c.holdPeak * (1 - (1 - u) ** 3) : 1;
  if (c.zoomDur <= 0) return hold;
  return hold * (1 + c.zoomPeak * Math.sin((Math.PI * c.zoomT) / c.zoomDur));
}

/** Current shake offset in u along x (axis 0) or y (axis 1). */
export function shakeOf(c: CameraFx, axis: 0 | 1): number {
  if (c.shake <= 0 || c.reducedMotion) return 0;
  const t = c.clock * 40 + axis * 17.3;
  const n = Math.sin(t * 1.7) * 0.6 + Math.sin(t * 3.1 + 1.3) * 0.4;
  const fade = Math.min(1, c.shakeT * 8);
  return c.shake * n * fade;
}

/** The play camera: Nubs fixed at nubsFrac of the viewport height, x never pans. */
export function setPlayCamera(v: View, fx: CameraFx, nubsX: number, nubsY: number): void {
  const z = zoomOf(fx);
  const scx = v.vx + nubsX * v.k;
  const scy = v.vy + v.nubsFrac * v.vh;
  setMapping(v, v.k * z, nubsX, nubsY, scx + shakeOf(fx, 0) * v.k, scy + shakeOf(fx, 1) * v.k);
  v.nx = v.ox + nubsX * v.S;
  v.ny = v.oy - nubsY * v.S;
}
