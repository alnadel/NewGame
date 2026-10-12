// The Melt Map (V1_PLAN §9, archive/CRITIQUE #10): after death the camera pulls up (1.4 s, easeInOutCubic;
// a cut under reduced motion) to frame the last ~600 u of trail above the Results sheet. Footprint
// trail is a ribbon coloured by Chill with ticks at the hours it crossed, the lit gap gets a red
// bracket, the named casters from the death line are pinned with callout labels, the dial is frozen
// around the puddle as it stood at the melt (the sun, the lasting shade, the short way between), and
// the puddle gets a marker with a little carrot.
//
// K10: nothing of the overlay ever shows under the Results sheet. The whole overlay is clipped to
// the view above the sheet's top − 4 px; a callout that would cross the sheet's top − 6 px moves
// above its pin head, and is left out (the pin dot stays) when it still doesn't fit. The callouts
// fade in only once the camera pull has finished, so they never slide across the screen.

import { dayAtY, dayLength, historyAt, historyLength, trailX, yAtTime, type Caster, type SimState } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { setMapping } from '../game/camera.ts';
import { css, cssa, hex, mix, type Rgb } from './color.ts';
import { drawFrozenDial } from './halo.ts';
import { roundRect } from './sprites.ts';

const TAU = Math.PI * 2;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const BLUE = hex('#5AB8FF');
const GOLD = hex('#FFC23D');
const RED = hex('#FF5D5D');

/** Camera pull (s; a cut under reduced motion), overlay fade-in, then the callouts' fade-in. */
export const MAP_PULL_S = 1.4;
export const MAP_FADE_S = 0.8;
export const MAP_LABEL_FADE_S = 0.4;
/** Overlay clip and callout limit above the Results sheet's top edge (CSS px). */
const SHEET_CLIP_GAP = 4;
const SHEET_LABEL_GAP = 6;

/** Overlay and callout alphas at `mapT` seconds into the Results (into `out`). */
export function mapAlphas(mapT: number, reducedMotion: boolean, out: MapOverlay): MapOverlay {
  const pullEnd = reducedMotion ? 0 : MAP_PULL_S;
  out.a = Math.max(0, Math.min(1, mapT / MAP_FADE_S));
  out.labelA = Math.max(0, Math.min(1, (mapT - pullEnd) / MAP_LABEL_FADE_S));
  return out;
}

/** From this mapT on, the map no longer moves or fades (only the puddle ring pulses). */
export function mapSettleT(reducedMotion: boolean): number {
  return Math.max(MAP_FADE_S, (reducedMotion ? 0 : MAP_PULL_S) + MAP_LABEL_FADE_S);
}

export interface MapOverlay {
  /** Overlay alpha: wash, dots, bracket, pin heads, the puddle marker. */
  a: number;
  /** Callout alpha: labels and leader lines (0 during the pull). */
  labelA: number;
  /** The Results sheet's top edge (CSS px), or null. */
  sheetTop: number | null;
  time: number;
}

/** Clips to the view above the Results sheet (K10). Call inside save()/restore(). */
export function clipAboveSheet(g: CanvasRenderingContext2D, v: View, sheetTop: number | null): void {
  if (sheetTop === null) return;
  const bottom = Math.min(v.vy + v.vh, sheetTop - SHEET_CLIP_GAP);
  g.beginPath();
  g.rect(v.vx, v.vy, v.vw, Math.max(0, bottom - v.vy));
  g.clip();
}

export interface MapFrame {
  /** World window. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Start of the lit gap (y), or NaN. */
  gapY0: number;
  gapY1: number;
}

export function createMapFrame(): MapFrame {
  return { x0: 0, x1: 360, y0: 0, y1: 600, gapY0: NaN, gapY1: NaN };
}

const h4 = new Float64Array(4);

/** Picks the world window for a death: the last ~600 u plus the named casters. */
export function frameDeath(m: MapFrame, s: SimState): void {
  const d = s.death;
  const dy = d ? d.y : s.nubs.y;
  const dx = d ? d.x : s.nubs.x;
  let y0 = dy - 420;
  let y1 = dy + 90;
  let x0 = dx - 70;
  let x1 = dx + 70;
  const n = historyLength(s);
  for (let i = 0; i < n; i++) {
    historyAt(s, i, h4);
    const y = h4[1] as number;
    if (y < y0 || y > y1) continue;
    const x = h4[0] as number;
    if (x - 40 < x0) x0 = x - 40;
    if (x + 40 > x1) x1 = x + 40;
  }
  for (const id of [d?.lastId, d?.nextId]) {
    if (id === undefined) continue;
    const c = s.world.byId.get(id);
    if (!c) continue;
    y0 = Math.min(y0, c.minY - 30);
    y1 = Math.max(y1, c.maxY + 50);
    x0 = Math.min(x0, c.minX - 20);
    x1 = Math.max(x1, c.maxX + 20);
  }
  if (y1 - y0 > 760) y0 = y1 - 760;
  m.x0 = Math.max(-40, x0);
  m.x1 = Math.min(400, x1);
  m.y0 = y0;
  m.y1 = y1;
  // The lit gap: the run of lit footprints that ends at the puddle.
  m.gapY0 = NaN;
  m.gapY1 = NaN;
  for (let i = n - 1; i >= 0; i--) {
    historyAt(s, i, h4);
    if ((h4[3] as number) <= 0) break;
    if (Number.isNaN(m.gapY1)) m.gapY1 = h4[1] as number;
    m.gapY0 = h4[1] as number;
  }
  if (!Number.isNaN(m.gapY1)) m.gapY1 = Math.max(m.gapY1, dy);
}

/** Map camera mapping for a frame inside [top, bottom] of the screen. */
export function mapTarget(v: View, m: MapFrame, top: number, bottom: number, out: Float64Array): void {
  const H = Math.max(80, bottom - top - 24);
  const W = v.vw - 32;
  const S = Math.min(v.k * 0.75, H / (m.y1 - m.y0), W / (m.x1 - m.x0));
  out[0] = S;
  out[1] = (m.x0 + m.x1) / 2;
  out[2] = (m.y0 + m.y1) / 2;
  out[3] = v.vx + v.vw / 2;
  out[4] = (top + bottom) / 2;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

/** Blends the play mapping (a) into the map mapping (b) by t (0..1) and applies it. */
export function applyPull(v: View, a: Float64Array, b: Float64Array, t: number): void {
  const e = easeInOutCubic(Math.max(0, Math.min(1, t)));
  // Interpolate scale geometrically so the zoom feels even.
  const S = (a[0] as number) * ((b[0] as number) / (a[0] as number)) ** e;
  const lerp = (i: number): number => (a[i] as number) + ((b[i] as number) - (a[i] as number)) * e;
  setMapping(v, S, lerp(1), lerp(2), lerp(3), lerp(4));
}

/** Chill colour bands of the ribbon (one stroke each). */
const BANDS = 6;

function drawRibbon(g: CanvasRenderingContext2D, v: View, s: SimState, m: MapFrame): void {
  const n = historyLength(s);
  const S = v.S;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let pass = -1; pass < BANDS; pass++) {
    // Pass −1 is the ink outline under the whole ribbon; then one path per Chill band.
    let any = false;
    let px = 0;
    let py = 0;
    let have = false;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      historyAt(s, i, h4);
      const y = h4[1] as number;
      if (y < m.y0 - 20 || y > m.y1 + 20) {
        have = false;
        continue;
      }
      const sx = v.ox + (h4[0] as number) * S;
      const sy = v.oy - y * S;
      const band = Math.min(BANDS - 1, Math.floor(((h4[2] as number) / 100) * BANDS));
      if (have && (pass < 0 || band === pass)) {
        g.moveTo(px, py);
        g.lineTo(sx, sy);
        any = true;
      }
      px = sx;
      py = sy;
      have = true;
    }
    if (!any) continue;
    if (pass < 0) {
      g.strokeStyle = cssa(0x2b2140, 0.35);
      g.lineWidth = 3 * S + 2.4;
    } else {
      g.strokeStyle = css(chillColor(((pass + 0.5) / BANDS) * 100));
      g.lineWidth = 3 * S;
    }
    g.stroke();
  }
}

/** White ticks across the ribbon where the walk passed an hour, labelled 7 … 12 … 5. */
function drawHourTicks(g: CanvasRenderingContext2D, v: View, s: SimState, m: MapFrame): void {
  if (historyLength(s) === 0) return;
  historyAt(s, 0, h4);
  const from = Math.max(m.y0, h4[1] as number);
  const top = Math.min(m.y1, s.nubs.y);
  const d1 = dayAtY(Math.max(0, top));
  g.font = `800 9px ${FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.lineCap = 'round';
  for (let day = dayAtY(Math.max(0, m.y0)); day <= d1; day++) {
    const len = dayLength(day);
    for (let h = 1; h < 12; h++) {
      const y = yAtTime(day, (h / 12) * len);
      if (y < from || y > top) continue;
      const sx = v.ox + trailX(s.world.trail, y) * v.S;
      const sy = v.oy - y * v.S;
      const w = 5 * v.S + 2;
      g.strokeStyle = '#FFFFFF';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(sx - w, sy);
      g.lineTo(sx + w, sy);
      g.stroke();
      const label = HOUR_LABELS[h] as string;
      g.strokeStyle = cssa(0x2b2140, 0.7);
      g.lineWidth = 2.5;
      g.strokeText(label, sx + w + 3, sy);
      g.fillStyle = '#FFFFFF';
      g.fillText(label, sx + w + 3, sy);
    }
  }
}

/** Clock labels of the hour boundaries after 6 AM. */
const HOUR_LABELS = ['6', '7', '8', '9', '10', '11', '12', '1', '2', '3', '4', '5'];

function chillColor(c: number): Rgb {
  return c >= 50 ? mix(GOLD, BLUE, (c - 50) / 50) : mix(RED, GOLD, c / 50);
}

/**
 * Overlays on the world once the map is up (`o.a` fades them in), clipped above the sheet. Returns
 * true when it drew (its paper wash is a full-screen pass).
 */
export function drawMeltMap(g: CanvasRenderingContext2D, v: View, s: SimState, m: MapFrame, o: MapOverlay): boolean {
  const a = o.a;
  if (a <= 0.01) return false;
  g.save();
  clipAboveSheet(g, v, o.sheetTop);
  const S = v.S;
  // Paper wash so the overlays pop.
  g.globalAlpha = 0.22 * a;
  g.fillStyle = '#FFF8EE';
  g.fillRect(v.vx, v.vy, v.vw, v.vh);
  g.globalAlpha = a;
  // The walk as a 3 u ribbon coloured by Chill (one stroke per colour band over an ink outline),
  // with white ticks and small labels where it crossed an hour.
  drawRibbon(g, v, s, m);
  drawHourTicks(g, v, s, m);
  // The lit gap: a red bracket beside the trail.
  if (!Number.isNaN(m.gapY0) && !Number.isNaN(m.gapY1)) {
    const d = s.death;
    let gy0 = m.gapY0;
    let gy1 = m.gapY1;
    if (gy1 - gy0 < 24) {
      const mid = (gy0 + gy1) / 2;
      gy0 = mid - 12;
      gy1 = mid + 12;
    }
    const tx = (d ? d.x : s.nubs.x) + 26;
    const bx = v.ox + tx * S;
    const by0 = v.oy - gy0 * S;
    const by1 = v.oy - gy1 * S;
    g.strokeStyle = css(RED);
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(bx - 7, by0);
    g.lineTo(bx, by0);
    g.lineTo(bx, by1);
    g.lineTo(bx - 7, by1);
    g.stroke();
    // A tiny sun badge on the bracket.
    const my = (by0 + by1) / 2;
    g.fillStyle = css(RED);
    g.beginPath();
    g.arc(bx + 9, my, 6, 0, TAU);
    g.fill();
    g.strokeStyle = '#FFFFFF';
    g.lineWidth = 1.4;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (i * TAU) / 6;
      g.moveTo(bx + 9 + Math.cos(ang) * 2, my + Math.sin(ang) * 2);
      g.lineTo(bx + 9 + Math.cos(ang) * 4.4, my + Math.sin(ang) * 4.4);
    }
    g.stroke();
  }
  // Pins for the named casters.
  const d = s.death;
  calloutCount = 0;
  if (d) {
    const limit = o.sheetTop === null ? Number.POSITIVE_INFINITY : o.sheetTop - SHEET_LABEL_GAP;
    const top = v.vy + v.safe.top + 4;
    const pins: [number | undefined, string | undefined][] = [
      [d.lastId, d.lastName],
      [d.nextId, d.nextName],
    ];
    for (const [id, name] of pins) {
      if (id === undefined || !name) continue;
      const c = s.world.byId.get(id);
      if (c) pin(g, v, c, name, s.nubs.x, a, o.labelA, top, limit);
    }
    if (d.ballId !== undefined) {
      const ball = s.world.balls.find((b) => b.id === d.ballId);
      const c = ball ? s.world.byId.get(ball.casterId) : undefined;
      if (c) pin(g, v, c, c.name, s.nubs.x, a, o.labelA, top, limit);
    }
    // The dial as it stood when Nubs melted: the sun, the shade that lasted, the short way between.
    drawFrozenDial(g, v.ox + d.x * v.S, v.oy - d.y * v.S, 40 * v.S, s.sun.theta, s.guide.now, s.guide.next, a);
    drawPuddle(g, v, s, a, o.time);
  }
  g.globalAlpha = 1;
  g.restore();
  return true;
}

/** The puddle marker: a pulsing ring and a carrot (the only part of a settled map that moves). */
function drawPuddle(g: CanvasRenderingContext2D, v: View, s: SimState, a: number, time: number): void {
  const d = s.death;
  if (!d) return;
  const px = v.ox + d.x * v.S;
  const py = v.oy - d.y * v.S;
  const pr = 14 + 3 * Math.sin(time * 4);
  g.globalAlpha = a;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = cssa(0xffffff, 0.9 * a);
  g.lineWidth = 3;
  g.beginPath();
  g.arc(px, py, pr, 0, TAU);
  g.stroke();
  g.strokeStyle = cssa(0x2b2140, 0.5 * a);
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(px, py, pr + 2, 0, TAU);
  g.stroke();
  carrotIcon(g, px + 16, py - 18, a);
  g.globalAlpha = 1;
}

/** Callout boxes drawn on this map frame (x, y, w, h each; for the overlap rule and the test hook). */
export const calloutBoxes = new Float64Array(12);
let calloutCount = 0;

/** Number of callout boxes in calloutBoxes from the last map frame. */
export function calloutsDrawn(): number {
  return calloutCount;
}

/** A callout's left edge `x` kept 6 px inside the view. */
function calloutX(v: View, x: number, w: number): number {
  return Math.max(v.vx + 6, Math.min(v.vx + v.vw - 6 - w, x));
}

function overlapsDrawn(x: number, y: number, w: number, h: number): boolean {
  for (let i = 0; i < calloutCount; i++) {
    const bx = calloutBoxes[4 * i] as number;
    const by = calloutBoxes[4 * i + 1] as number;
    if (x < bx + (calloutBoxes[4 * i + 2] as number) && bx < x + w && y < by + (calloutBoxes[4 * i + 3] as number) && by < y + h) return true;
  }
  return false;
}

function pin(
  g: CanvasRenderingContext2D,
  v: View,
  c: Caster,
  name: string,
  trailX: number,
  a: number,
  labelA: number,
  top: number,
  limit: number,
): void {
  const S = v.S;
  const sx = v.ox + c.x * S;
  const sy = v.oy - (c.y + 0.25 * Math.min(c.maxZ, 90)) * S;
  // The callout: beside the pin (its bottom 4 px above the head), or straight above the head when
  // that would reach under the sheet; left out when neither fits (or the head itself is hidden).
  // When it would cover an earlier callout it goes to the other side of its pin.
  if (labelA > 0.01 && sy <= limit) {
    let right = c.x >= trailX;
    g.font = `800 13px ${FONT}`;
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    const tw = g.measureText(label).width;
    const w = tw + 18;
    const h = 26;
    const ly0 = sy - 30;
    const above = ly0 + h > limit;
    let lx = calloutX(v, above ? sx - w / 2 : right ? sx + 18 : sx - 18 - w, w);
    const ly = above ? Math.min(sy - 12, limit) - h : ly0;
    if (!above && overlapsDrawn(lx, ly, w, h)) {
      right = !right;
      lx = calloutX(v, right ? sx + 18 : sx - 18 - w, w);
    }
    // Leader end: the box's near side, or its bottom edge over the head.
    const ax = above ? Math.max(lx + 13, Math.min(lx + w - 13, sx)) : right ? lx : lx + w;
    const ay = above ? ly + h : ly + h / 2;
    if (ly >= top) {
      g.strokeStyle = cssa(0x2b2140, 0.75 * a * labelA);
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(ax, ay);
      g.stroke();
      g.fillStyle = cssa(0x2b2140, 0.18 * a * labelA);
      roundRect(g, lx, ly + 2, w, h, 13);
      g.fill();
      g.fillStyle = cssa(0xffffff, 0.96 * a * labelA);
      roundRect(g, lx, ly, w, h, 13);
      g.fill();
      g.fillStyle = cssa(0x2b2140, a * labelA);
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(label, lx + 9, ly + h / 2 + 1);
      if (calloutCount < 3) {
        calloutBoxes[4 * calloutCount] = lx;
        calloutBoxes[4 * calloutCount + 1] = ly;
        calloutBoxes[4 * calloutCount + 2] = w;
        calloutBoxes[4 * calloutCount + 3] = h;
        calloutCount++;
      }
    }
  }
  // Pin head.
  g.fillStyle = cssa(0x2b2140, a);
  g.beginPath();
  g.arc(sx, sy, 4.5, 0, TAU);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(sx, sy, 2, 0, TAU);
  g.fill();
}

function carrotIcon(g: CanvasRenderingContext2D, x: number, y: number, a: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(-0.5);
  g.globalAlpha = a;
  g.fillStyle = '#FF8A2B';
  g.beginPath();
  g.moveTo(-3.5, -2);
  g.lineTo(9, 0);
  g.lineTo(-3.5, 2.5);
  g.closePath();
  g.fill();
  g.fillStyle = '#6DBE7B';
  g.beginPath();
  g.ellipse(-5, -2, 2.5, 1.2, -0.6, 0, TAU);
  g.ellipse(-5, 2, 2.5, 1.2, 0.6, 0, TAU);
  g.fill();
  g.restore();
}
