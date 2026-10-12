// The shadow layer (TECH_SPEC §9.3, V1_PLAN §9): every visible part shadow, canopy disc and cloud
// ellipse is appended to ONE path and filled once with an opaque color, so overlapping shadows union
// without darkening. Soft mode fills a half-resolution offscreen layer and blits it (bilinear
// upscaling gives a soft penumbra for free); crisp mode (perf governor level ≥ 1 and low-end
// devices, game/perf.ts) fills the same path straight onto the world.
//
// Composite (GR2): the look is a multiply of the LUT shadow color C at the LUT alpha a, but a
// multiply blend costs about twice a plain source-over in software raster. So the fill is the
// source-over color K at alpha β that gives exactly the multiplied result over the ground color G
// the tiles were painted with (matchShadow); over other colors (trail, decals) it differs by a level
// or so.
//
// Winding: subpaths must all wind the same way on screen, or the nonzero rule punches holes where
// they overlap. Core polygons are CCW in world space (y up); projected to screen space (y down) they
// are counter-clockwise on screen too (negative shoelace area in y-down coordinates, measured in
// tests/unit/render.test.ts). Canopy discs and cloud ellipses are therefore drawn with
// anticlockwise = true, after a moveTo to their start point (no joining segment).

import { cloudShadow, partShadow, queryCasters, queryClouds, type Caster, type Cloud, type Part, type World } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { blue, css, green, red, rgb, type Rgb } from './color.ts';
import type { Palette } from './palette.ts';
import { ctx2d, makeCanvas, type Canvas2D } from './sprites.ts';

const TAU = Math.PI * 2;
/** Shadows reach 520 u; clouds up to 900 u but they are queried separately. */
const REACH = 540;

export interface ShadowLayer {
  canvas: Canvas2D;
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Eased composite alpha (photosensitivity: eases during fast sweeps). */
  alpha: number;
  /** This frame's matched fill color K (matchShadow). */
  fill: Rgb;
}

export function createShadowLayer(): ShadowLayer {
  const canvas = makeCanvas(2, 2);
  return { canvas, g: ctx2d(canvas), w: 2, h: 2, alpha: 0, fill: 0 };
}

const casterBuf: Caster[] = [];
const cloudBuf: Cloud[] = [];
const poly = new Float64Array(32);
const ell = new Float64Array(4);

/** Appends all shadow subpaths of the frame to the current path of `g` (CSS-px screen space). */
export function traceShadows(
  g: CanvasRenderingContext2D,
  v: View,
  world: World,
  ux: number,
  uy: number,
  cot: number,
  tAbs: number,
): void {
  const S = v.S;
  const n = queryCasters(world, v.y0 - REACH, v.y1 + REACH, casterBuf);
  for (let i = 0; i < n; i++) {
    const c = casterBuf[i] as Caster;
    const parts = c.parts;
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j] as Part;
      const cnt = partShadow(part, ux, uy, cot, poly);
      if (cnt < 0) {
        const sx = v.ox + (poly[0] as number) * S;
        const sy = v.oy - (poly[1] as number) * S;
        const r = (poly[2] as number) * S;
        g.moveTo(sx + r, sy);
        g.arc(sx, sy, r, 0, TAU, true);
        continue;
      }
      // Cull polygons whose bounds miss the view.
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < cnt; k++) {
        const x = poly[2 * k] as number;
        const y = poly[2 * k + 1] as number;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (maxX < v.x0 || minX > v.x1 || maxY < v.y0 || minY > v.y1) continue;
      g.moveTo(v.ox + (poly[0] as number) * S, v.oy - (poly[1] as number) * S);
      for (let k = 1; k < cnt; k++) g.lineTo(v.ox + (poly[2 * k] as number) * S, v.oy - (poly[2 * k + 1] as number) * S);
      g.closePath();
    }
  }
  const m = queryClouds(world, tAbs, cloudBuf);
  for (let i = 0; i < m; i++) {
    cloudShadow(cloudBuf[i] as Cloud, tAbs, ux, uy, cot, ell);
    const cx = ell[0] as number;
    const cy = ell[1] as number;
    const rx = ell[2] as number;
    const ry = ell[3] as number;
    if (cx + rx < v.x0 || cx - rx > v.x1 || cy + ry < v.y0 || cy - ry > v.y1) continue;
    const sx = v.ox + cx * S;
    const sy = v.oy - cy * S;
    g.moveTo(sx + rx * S, sy);
    g.ellipse(sx, sy, rx * S, ry * S, 0, 0, TAU, true);
  }
}

/**
 * The source-over fill that matches a multiply of the shadow color `shadow` at alpha `a` over the
 * ground color `ground` (GR2): M_c = 1 − a·(1 − C_c/255), β = 1 − min(M), K_c = G_c·(M_c − 1 + β)/β.
 * Writes K into out.fill and returns β (0 when there is nothing to draw).
 */
export function matchShadow(out: { fill: Rgb }, shadow: Rgb, ground: Rgb, a: number): number {
  const mr = 1 - a * (1 - red(shadow) / 255);
  const mg = 1 - a * (1 - green(shadow) / 255);
  const mb = 1 - a * (1 - blue(shadow) / 255);
  const beta = 1 - Math.min(mr, mg, mb);
  if (beta < 0.002) return 0;
  out.fill = rgb((red(ground) * (mr - 1 + beta)) / beta, (green(ground) * (mg - 1 + beta)) / beta, (blue(ground) * (mb - 1 + beta)) / beta);
  return beta;
}

/**
 * Renders and composites the shadow layer onto the world (call with the world clip active): the
 * matched source-over fill (GR2), or a multiply of the shadow color when `multiply` is set (the
 * test hook's A/B reference). Returns true when it blitted the soft layer (a full-screen pass).
 */
export function drawShadowLayer(
  g: CanvasRenderingContext2D,
  layer: ShadowLayer,
  v: View,
  world: World,
  pal: Palette,
  ground: Rgb,
  ux: number,
  uy: number,
  cot: number,
  tAbs: number,
  alpha: number,
  soft: boolean,
  multiply: boolean,
): boolean {
  if (cot <= 0) return false;
  const a = multiply ? alpha : matchShadow(layer, pal.shadow, ground, alpha);
  if (a <= 0.002) return false;
  const color = css(multiply ? pal.shadow : layer.fill);
  const op = multiply ? 'multiply' : 'source-over';
  if (!soft) {
    g.globalCompositeOperation = op;
    g.globalAlpha = a;
    g.fillStyle = color;
    g.beginPath();
    traceShadows(g, v, world, ux, uy, cot, tAbs);
    g.fill('nonzero');
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    return false;
  }
  const w = Math.max(2, Math.ceil(v.vw / 2));
  const h = Math.max(2, Math.ceil(v.vh / 2));
  if (layer.w !== w || layer.h !== h) {
    layer.canvas.width = w;
    layer.canvas.height = h;
    layer.w = w;
    layer.h = h;
  }
  const s = layer.g;
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, w, h);
  s.setTransform(0.5, 0, 0, 0.5, -v.vx * 0.5, -v.vy * 0.5);
  s.fillStyle = color;
  s.beginPath();
  traceShadows(s, v, world, ux, uy, cot, tAbs);
  s.fill('nonzero');

  g.globalCompositeOperation = op;
  g.globalAlpha = a;
  g.imageSmoothingEnabled = true;
  g.drawImage(layer.canvas, 0, 0, w, h, v.vx, v.vy, w * 2, h * 2);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return true;
}
