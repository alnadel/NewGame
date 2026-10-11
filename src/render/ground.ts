// Ground fill, biome detail tiles, the trail ribbon and footprint decals (GDD §10, TECH_SPEC §9.2
// steps 3-6). The ground scrolls with the world: tiles are anchored to multiples of 256 u.

import { biomeAtY, trailX, type World } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { css, cssa, darken, lighten, mix, type Rgb } from './color.ts';
import type { Palette } from './palette.ts';
import { exactGroundTile, groundTiles, makeCanvas, TILE_U, type Canvas2D } from './sprites.ts';

/**
 * Letterbox bars (TECH_SPEC §9.1): the ground color darkened 35 % with the detail tiles continuing
 * faintly, so the world reads as extending beyond the playfield instead of ending in flat paint.
 */
export function drawBars(g: CanvasRenderingContext2D, v: View, pal: Palette, detail: boolean): void {
  // No bars when the world viewport fills the canvas (the ground covers every pixel anyway).
  if (v.vx <= 0.5 && v.vy <= 0.5 && v.vw >= v.cssW - 0.5 && v.vh >= v.cssH - 0.5) return;
  g.fillStyle = css(pal.bar);
  g.fillRect(0, 0, v.cssW, v.cssH);
  if (v.vx <= 0.5 && v.vy + v.vh >= v.cssH - 0.5) return;
  if (!detail) return;
  const tiles = groundTiles(v.k * v.dpr);
  const x0 = (0 - v.ox) / v.S;
  const x1 = (v.cssW - v.ox) / v.S;
  const y1 = v.oy / v.S;
  const y0 = (v.oy - v.cssH) / v.S;
  g.globalAlpha = 0.5 * (1 - pal.night * 0.6);
  for (let ty = Math.floor(y0 / TILE_U) * TILE_U; ty < y1; ty += TILE_U) {
    const tile = biomeAtY(ty + TILE_U / 2) === 'oldtown' ? tiles.town : tiles.meadow;
    const sy = Math.floor(v.oy - (ty + TILE_U) * v.S);
    const h = Math.ceil(v.oy - ty * v.S) - sy;
    for (let tx = Math.floor(x0 / TILE_U) * TILE_U; tx < x1; tx += TILE_U) {
      const sx = Math.floor(v.ox + tx * v.S);
      const w = Math.ceil(v.ox + (tx + TILE_U) * v.S) - sx;
      g.drawImage(tile, sx, sy, w + 0.5, h + 0.5);
    }
  }
  g.globalAlpha = 1;
  // A soft inner shadow along the playfield's edges.
  const shade = darken(pal.bar, 0.25);
  if (v.vx > 0.5) {
    const lg = g.createLinearGradient(v.vx - 24, 0, v.vx, 0);
    lg.addColorStop(0, cssa(shade, 0));
    lg.addColorStop(1, cssa(shade, 0.6));
    g.fillStyle = lg;
    g.fillRect(v.vx - 24, 0, 24, v.cssH);
    const rg = g.createLinearGradient(v.vx + v.vw, 0, v.vx + v.vw + 24, 0);
    rg.addColorStop(0, cssa(shade, 0.6));
    rg.addColorStop(1, cssa(shade, 0));
    g.fillStyle = rg;
    g.fillRect(v.vx + v.vw, 0, 24, v.cssH);
  }
}

// Ground paint (TECH_SPEC §15 raster budget). The detail tiles are transparent marks over the ground
// color; drawing them that way costs a full-screen fill plus ~8 scaled, blended images every frame.
// Instead each biome's tile is pre-composited once (ground color + marks at the night alpha) into an
// opaque canvas of a whole number of device pixels, and the tiles are blitted 1:1 at whole-pixel
// positions anchored to the world, which the rasterizer does as a plain copy. A tile is repainted
// only when the ground color, the night fade or the zoom changes (the renderer quantizes the ground
// palette to 1/64 of the day, so about once a second); while the zoom is moving (cloud-capture pulse,
// Melt Map pull) the existing tiles are drawn scaled.

/** One biome's painted tile and what it was painted with (T 0 = never). */
interface BiomeTile {
  canvas: Canvas2D | null;
  T: number;
  ground: number;
  marksAlpha: number;
}

export interface GroundPaint {
  meadow: BiomeTile;
  town: BiomeTile;
  /** Tile size in device px of the current zoom (0 before the first stable frame). */
  T: number;
  /** The view's S on the previous frame (whole-pixel blits only while the zoom holds still). */
  lastS: number;
  /** Tile repaints so far, one per biome tile painted (perf counter). */
  paints: number;
}

export function createGroundPaint(): GroundPaint {
  const tile = (): BiomeTile => ({ canvas: null, T: 0, ground: -1, marksAlpha: -1 });
  return { meadow: tile(), town: tile(), T: 0, lastS: 0, paints: 0 };
}

/** Paints `bt` for the current tile size, ground color and marks alpha if it is stale. */
function freshen(gp: GroundPaint, bt: BiomeTile, town: boolean, T: number, ground: Rgb, alpha: number): void {
  if (bt.canvas && bt.T === T && bt.ground === ground && bt.marksAlpha === alpha) return;
  bt.canvas = paintTile(bt.canvas, T, ground, exactGroundTile(T, town), alpha);
  bt.T = T;
  bt.ground = ground;
  bt.marksAlpha = alpha;
  gp.paints++;
}

function paintTile(c: Canvas2D | null, T: number, ground: Rgb, marks: Canvas2D, alpha: number): Canvas2D {
  const cv = c ?? makeCanvas(T, T);
  if (cv.width !== T) cv.width = T;
  if (cv.height !== T) cv.height = T;
  const g = cv.getContext('2d', { alpha: false });
  if (!g) return cv;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.fillStyle = css(ground);
  g.fillRect(0, 0, T, T);
  g.globalAlpha = alpha;
  // The marks are drawn at exactly T px (sprites.ts exactGroundTile): an unscaled blend.
  g.drawImage(marks, 0, 0);
  g.globalAlpha = 1;
  return cv;
}

export function drawGround(g: CanvasRenderingContext2D, v: View, pal: Palette, detail: boolean, gp: GroundPaint | null = null): void {
  if (!detail) {
    g.fillStyle = css(pal.ground);
    g.fillRect(v.vx, v.vy, v.vw, v.vh);
    return;
  }
  // Night hides the detail a little (it stays as texture, not noise).
  const alpha = 1 - pal.night * 0.72;
  const tx0 = Math.floor(v.x0 / TILE_U) * TILE_U;
  const ty0 = Math.floor(v.y0 / TILE_U) * TILE_U;
  // Repaint only while the zoom holds still (or for the very first tiles).
  const stable = gp !== null && (v.S === gp.lastS || gp.T === 0);
  if (gp) gp.lastS = v.S;
  if (gp) {
    // A biome's tile is built and kept fresh only while one of its rows is on screen or within one
    // screen ahead (Day 1 never paints the Old Town tile); a stale one is repainted when it is next
    // needed. (The scaled path below fills a never-painted tile's rows with the plain ground color.)
    if (stable) {
      const T = Math.max(8, Math.round(TILE_U * v.S * v.dpr));
      gp.T = T;
      let needMeadow = false;
      let needTown = false;
      const ahead = v.y1 + (v.y1 - v.y0);
      for (let ty = ty0 - TILE_U; ty < ahead && !(needMeadow && needTown); ty += TILE_U) {
        if (biomeAtY(ty + TILE_U / 2) === 'oldtown') needTown = true;
        else needMeadow = true;
      }
      if (needMeadow) freshen(gp, gp.meadow, false, T, pal.ground, alpha);
      if (needTown) freshen(gp, gp.town, true, T, pal.ground, alpha);
    }
    const meadow = gp.meadow.canvas;
    const town = gp.town.canvas;
    const dpr = v.dpr;
    if (stable) {
      // Whole-pixel grid anchored at the world tile (tx0, ty0): one copy per tile.
      const T = gp.T;
      const ax = Math.round((v.ox + tx0 * v.S) * dpr);
      const ay = Math.round((v.oy - (ty0 + TILE_U) * v.S) * dpr);
      const left = Math.floor(v.vx * dpr);
      const right = Math.ceil((v.vx + v.vw) * dpr);
      const top = Math.floor(v.vy * dpr);
      g.setTransform(1, 0, 0, 1, 0, 0);
      // One row and column of slack on the near edges: rounding must never leave a seam.
      for (let k = -1, ty = ty0 - TILE_U; ay - k * T + T > top; k++, ty += TILE_U) {
        const tile = biomeAtY(ty + TILE_U / 2) === 'oldtown' ? town : meadow;
        const sy = ay - k * T;
        if (!tile) continue;
        for (let x = ax > left ? ax - T : ax; x < right; x += T) g.drawImage(tile, x, sy);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return;
    }
    // Zoom in motion: the painted tiles, scaled.
    for (let ty = ty0; ty < v.y1; ty += TILE_U) {
      const tile = biomeAtY(ty + TILE_U / 2) === 'oldtown' ? town : meadow;
      const sy = Math.floor(v.oy - (ty + TILE_U) * v.S);
      const h = Math.ceil(v.oy - ty * v.S) - sy;
      if (!tile) g.fillStyle = css(pal.ground);
      for (let tx = tx0; tx < v.x1; tx += TILE_U) {
        const sx = Math.floor(v.ox + tx * v.S);
        const w = Math.ceil(v.ox + (tx + TILE_U) * v.S) - sx;
        if (tile) g.drawImage(tile, sx, sy, w + 0.5, h + 0.5);
        else g.fillRect(sx, sy, w + 0.5, h + 0.5);
      }
    }
    return;
  }
  const tiles = groundTiles(v.k * v.dpr);
  g.fillStyle = css(pal.ground);
  g.fillRect(v.vx, v.vy, v.vw, v.vh);
  g.globalAlpha = alpha;
  for (let ty = ty0; ty < v.y1; ty += TILE_U) {
    const tile = biomeAtY(ty + TILE_U / 2) === 'oldtown' ? tiles.town : tiles.meadow;
    const sy = Math.floor(v.oy - (ty + TILE_U) * v.S);
    const h = Math.ceil(v.oy - ty * v.S) - sy;
    for (let tx = tx0; tx < v.x1; tx += TILE_U) {
      const sx = Math.floor(v.ox + tx * v.S);
      const w = Math.ceil(v.ox + (tx + TILE_U) * v.S) - sx;
      g.drawImage(tile, sx, sy, w + 0.5, h + 0.5);
    }
  }
  g.globalAlpha = 1;
}

const STEP = 8;

/** The trail: a darker 34 u edge under a 30 u ribbon, plus a faint worn center line. */
export function drawTrail(g: CanvasRenderingContext2D, v: View, w: World, pal: Palette): void {
  const yA = Math.floor((v.y0 - 60) / STEP) * STEP;
  const yB = v.y1 + 60;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  for (let y = yA; y <= yB; y += STEP) {
    const sx = v.ox + trailX(w.trail, y) * v.S;
    const sy = v.oy - y * v.S;
    if (y === yA) g.moveTo(sx, sy);
    else g.lineTo(sx, sy);
  }
  g.strokeStyle = css(pal.trailEdge);
  g.lineWidth = 34 * v.S;
  g.stroke();
  g.strokeStyle = css(pal.trail);
  g.lineWidth = 30 * v.S;
  g.stroke();
  // Worn center: a lighter band where feet go.
  g.strokeStyle = cssa(lighten(pal.trail, 0.5), 0.16 * (1 - pal.night));
  g.lineWidth = 12 * v.S;
  g.stroke();
}

// ---------------------------------------------------------------------------------------------
// Footprints: paired 3×5 u ellipses every 14 u; frosty white in shade, dark and wet in sun.
// ---------------------------------------------------------------------------------------------

const FP_CAP = 64;
const FROST_LIFE = 4;
const WET_LIFE = 1.5;

export interface Footprints {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly age: Float32Array;
  /** 1 frosty (shaded), 0 wet (lit). */
  readonly frost: Uint8Array;
  readonly angle: Float32Array;
  cursor: number;
  nextY: number;
  side: number;
}

export function createFootprints(): Footprints {
  return {
    x: new Float32Array(FP_CAP),
    y: new Float32Array(FP_CAP),
    age: new Float32Array(FP_CAP).fill(99),
    frost: new Uint8Array(FP_CAP),
    angle: new Float32Array(FP_CAP),
    cursor: 0,
    nextY: -Infinity,
    side: 1,
  };
}

export function resetFootprints(f: Footprints, y: number): void {
  f.age.fill(99);
  f.nextY = y + 14;
  f.side = 1;
}

/** Leaves prints as Nubs walks (call every frame with his position and shade state). */
export function stepFootprints(f: Footprints, x: number, y: number, slope: number, shaded: boolean, dt: number): void {
  for (let i = 0; i < FP_CAP; i++) f.age[i] = f.age[i]! + dt;
  if (!Number.isFinite(f.nextY) || y < f.nextY - 40) f.nextY = y;
  while (y >= f.nextY) {
    const i = f.cursor;
    f.cursor = (i + 1) % FP_CAP;
    // Offset sideways from the walking direction (slope = dx/dy).
    const len = Math.sqrt(1 + slope * slope);
    const px = 1 / len;
    const py = -slope / len;
    f.x[i] = x + px * 3.6 * f.side;
    f.y[i] = f.nextY + py * 3.6 * f.side;
    f.age[i] = 0;
    f.frost[i] = shaded ? 1 : 0;
    f.angle[i] = Math.atan2(1, slope);
    f.side = -f.side;
    f.nextY += 7;
  }
}

/** Prints fade in this many alpha steps, so prints of a step share one path and one fill. */
const FADE_STEPS = 8;

export function drawFootprints(g: CanvasRenderingContext2D, f: Footprints, v: View, pal: Palette): void {
  const wet: Rgb = darken(pal.trail, 0.35);
  const frost: Rgb = mix(0xffffff, 0xdff1ff, 0.4);
  for (let kind = 0; kind < 2; kind++) {
    const isFrost = kind === 1;
    const life = isFrost ? FROST_LIFE : WET_LIFE;
    for (let step = 1; step <= FADE_STEPS; step++) {
      let any = false;
      for (let i = 0; i < FP_CAP; i++) {
        if (f.frost[i] !== kind) continue;
        const age = f.age[i]!;
        if (age >= life) continue;
        if (Math.ceil((1 - age / life) * FADE_STEPS) !== step) continue;
        const y = f.y[i]!;
        if (y < v.y0 - 10 || y > v.y1 + 10) continue;
        if (!any) {
          any = true;
          g.beginPath();
        }
        const sx = v.ox + f.x[i]! * v.S;
        const sy = v.oy - y * v.S;
        const rot = Math.PI / 2 - f.angle[i]!;
        g.moveTo(sx + Math.cos(rot) * 1.6 * v.S, sy + Math.sin(rot) * 1.6 * v.S);
        g.ellipse(sx, sy, 1.6 * v.S, 2.6 * v.S, rot, 0, Math.PI * 2);
      }
      if (!any) continue;
      const fade = step / FADE_STEPS;
      g.fillStyle = isFrost ? cssa(frost, 0.75 * fade) : cssa(wet, 0.45 * fade);
      g.fill();
    }
  }
}
