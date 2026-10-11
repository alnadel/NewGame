// Casters (GDD §10 materials, TECH_SPEC §9.4): prisms with sun-lit south side faces, lit tops and
// sun-facing rim highlights; gable roofs (cottage, hut), parapets (house), striped stall awnings,
// arches, columns with capitals, brick walls, bushy hedges, tapered standing stones and Shade
// Rocks, lumpy tree canopies with a sun-side highlight, and the gazing ball on its pedestal.
// Everything is drawn in CSS-px screen space through the oblique projection.

import { BALL_Z, type Caster, type Part, type PrismPart, type SlabPart, type DiscPart } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { OBLIQUE } from '../game/camera.ts';
import { css, cssa, darken, hex, lighten, mix, type Rgb } from './color.ts';
import { faceShade, tint, type Palette } from './palette.ts';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------

const MAT = {
  trunk: hex('#8A5A3C'),
  trunkSide: hex('#6E4630'),
  canopy: hex('#6DBE7B'),
  canopyShade: hex('#4E9A63'),
  oak: hex('#5AA86E'),
  oakShade: hex('#3F8A57'),
  cottage: hex('#F2E6D0'),
  cottageSide: hex('#D9C7AA'),
  cottageRoof: hex('#D9644A'),
  cottageRoofSide: hex('#B44E3A'),
  stone: hex('#C9C3B5'),
  stoneSide: hex('#A39C8E'),
  hedge: hex('#5E9E5A'),
  hedgeSide: hex('#467C45'),
  hut: hex('#C08A5B'),
  hutSide: hex('#9C6B41'),
  hutRoof: hex('#8E6B4E'),
  house: hex('#EBD8C3'),
  houseSide: hex('#CDB59C'),
  houseRoof: hex('#6E8FB8'),
  houseRoofSide: hex('#557299'),
  arch: hex('#D8C7B0'),
  archSide: hex('#B7A48C'),
  stallRed: hex('#E8475A'),
  stallCream: hex('#FFF4DC'),
  post: hex('#8A5A3C'),
  column: hex('#E4DED2'),
  columnSide: hex('#BDB5A6'),
  wall: hex('#CFB79A'),
  wallSide: hex('#AE987D'),
  ball: hex('#BFE6FF'),
  pedestal: hex('#C9C3B5'),
  pedestalSide: hex('#A39C8E'),
  rock: hex('#A7B2C6'),
  rockSide: hex('#7D88A3'),
  window: hex('#5D6F94'),
  windowLit: hex('#FFD27A'),
  door: hex('#7A4E36'),
};

/** Per-frame lighting context shared by every caster draw. */
export interface Light {
  pal: Palette;
  ux: number;
  uy: number;
  sunUp: boolean;
  /** Elevation factor 0 (dawn) .. 1 (noon): contrast of lit vs unlit faces. */
  elev: number;
  /** Nubs' ground point (for canopy fading). */
  nubsX: number;
  nubsY: number;
  /** Seconds, for the gazing-ball twinkle. */
  time: number;
  /** Draw side faces (false on the Melt Map overview is still fine; kept for completeness). */
  sides: boolean;
}

export function createLight(pal: Palette): Light {
  return { pal, ux: 1, uy: 0, sunUp: true, elev: 0, nubsX: 0, nubsY: 0, time: 0, sides: true };
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

const tmp = new Float64Array(64);
const tmp2 = new Float64Array(64);

function px(v: View, x: number): number {
  return v.ox + x * v.S;
}

function py(v: View, y: number, z: number): number {
  return v.oy - (y + OBLIQUE * z) * v.S;
}

/** Polygon center. */
function center(pts: Float64Array, n: number, out: Float64Array): void {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += pts[2 * i] as number;
    cy += pts[2 * i + 1] as number;
  }
  out[0] = cx / n;
  out[1] = cy / n;
}

const ctr = new Float64Array(2);

/** Scales a polygon about its center into `out`. */
function scaled(pts: Float64Array, n: number, s: number, out: Float64Array): void {
  center(pts, n, ctr);
  const cx = ctr[0] as number;
  const cy = ctr[1] as number;
  for (let i = 0; i < n; i++) {
    out[2 * i] = cx + ((pts[2 * i] as number) - cx) * s;
    out[2 * i + 1] = cy + ((pts[2 * i + 1] as number) - cy) * s;
  }
}

/** Grows a polygon outward by `d` u (approximately, by scaling about the center). */
function grown(pts: Float64Array, n: number, d: number, out: Float64Array): void {
  center(pts, n, ctr);
  const cx = ctr[0] as number;
  const cy = ctr[1] as number;
  for (let i = 0; i < n; i++) {
    const dx = (pts[2 * i] as number) - cx;
    const dy = (pts[2 * i + 1] as number) - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    out[2 * i] = cx + dx * (1 + d / len);
    out[2 * i + 1] = cy + dy * (1 + d / len);
  }
}

function polyPath(g: CanvasRenderingContext2D, v: View, pts: Float64Array, n: number, z: number): void {
  g.moveTo(px(v, pts[0] as number), py(v, pts[1] as number, z));
  for (let i = 1; i < n; i++) g.lineTo(px(v, pts[2 * i] as number), py(v, pts[2 * i + 1] as number, z));
  g.closePath();
}

/**
 * South-facing side faces of a (possibly tapered) prism: base polygon `a` at z0, top polygon `b`
 * at z1 (same vertex order). Faces are shaded by how much they look at the sun.
 */
function sideFaces(
  g: CanvasRenderingContext2D,
  v: View,
  L: Light,
  a: Float64Array,
  b: Float64Array,
  n: number,
  z0: number,
  z1: number,
  side: Rgb,
  top: Rgb,
): void {
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const ax = a[2 * i] as number;
    const ay = a[2 * i + 1] as number;
    const bx = a[2 * j] as number;
    const by = a[2 * j + 1] as number;
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.sqrt(ex * ex + ey * ey) || 1;
    const nx = ey / len;
    const ny = -ex / len;
    if (ny > -0.02) continue;
    const ndu = nx * L.ux + ny * L.uy;
    g.fillStyle = css(faceShade(L.pal, side, top, ndu * (0.6 + 0.4 * (1 - L.elev)), L.sunUp));
    g.beginPath();
    g.moveTo(px(v, ax), py(v, ay, z0));
    g.lineTo(px(v, bx), py(v, by, z0));
    g.lineTo(px(v, b[2 * j] as number), py(v, b[2 * j + 1] as number, z1));
    g.lineTo(px(v, b[2 * i] as number), py(v, b[2 * i + 1] as number, z1));
    g.closePath();
    g.fill();
  }
}

/** Rim highlight on top edges facing the sun (n·u > 0.3). */
function rim(g: CanvasRenderingContext2D, v: View, L: Light, pts: Float64Array, n: number, z: number, alpha = 0.6): void {
  if (!L.sunUp) return;
  g.beginPath();
  let any = false;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const ax = pts[2 * i] as number;
    const ay = pts[2 * i + 1] as number;
    const bx = pts[2 * j] as number;
    const by = pts[2 * j + 1] as number;
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.sqrt(ex * ex + ey * ey) || 1;
    const ndu = (ey * L.ux - ex * L.uy) / len;
    if (ndu <= 0.3) continue;
    g.moveTo(px(v, ax), py(v, ay, z));
    g.lineTo(px(v, bx), py(v, by, z));
    any = true;
  }
  if (!any) return;
  g.strokeStyle = cssa(0xffffff, alpha * (1 - L.pal.night));
  g.lineWidth = Math.max(1, 1.5 * v.S);
  g.lineCap = 'round';
  g.stroke();
}

function fillTop(g: CanvasRenderingContext2D, v: View, pts: Float64Array, n: number, z: number, color: Rgb): void {
  g.fillStyle = css(color);
  g.beginPath();
  polyPath(g, v, pts, n, z);
  g.fill();
}

/** A plain prism: side faces, lit top, rim. */
function prism(g: CanvasRenderingContext2D, v: View, L: Light, p: PrismPart, side: Rgb, top: Rgb, z0 = 0, z1 = p.h): void {
  if (L.sides) sideFaces(g, v, L, p.pts, p.pts, p.n, z0, z1, side, top);
  fillTop(g, v, p.pts, p.n, z1, topColor(L, top));
  rim(g, v, L, p.pts, p.n, z1);
}

/** The top face color: tinted, and a touch brighter as the sun climbs. */
function topColor(L: Light, top: Rgb): Rgb {
  const c = tint(L.pal, top);
  return L.sunUp ? lighten(c, 0.05 + 0.08 * L.elev) : c;
}

/**
 * Windows on the south faces of a box (count per face, per floor), and optionally a door on the
 * first such face in place of its first ground-floor window. Windows never overlap, so all frames
 * go into one path and all panes into another: two fills per building instead of two per window.
 */
function windows(
  g: CanvasRenderingContext2D,
  v: View,
  L: Light,
  pts: Float64Array,
  n: number,
  floors: readonly number[],
  wh: number,
  perFace: number,
  door: boolean,
): void {
  const night = L.pal.night;
  // The door's face: the first face that gets windows.
  let doorFace = -1;
  if (door && perFace >= 2) {
    for (let i = 0; i < n && doorFace < 0; i++) if (windowFace(pts, n, i) > 0) doorFace = i;
  }
  if (doorFace >= 0) {
    const i = doorFace;
    const j = i + 1 === n ? 0 : i + 1;
    const ax = pts[2 * i] as number;
    const ay = pts[2 * i + 1] as number;
    const ex = (pts[2 * j] as number) - ax;
    const ey = (pts[2 * j + 1] as number) - ay;
    const len = windowFace(pts, n, i);
    const s = 0.5 / perFace;
    const t0 = s - 6 / len;
    const t1 = s + 6 / len;
    g.fillStyle = css(tint(L.pal, MAT.door));
    g.beginPath();
    quadPath(g, v, ax + ex * t0, ay + ey * t0, ax + ex * t1, ay + ey * t1, 0, 22);
    g.fill();
  }
  for (let pass = 0; pass < 2; pass++) {
    // Pass 0: white frames (1.2 u larger all round); pass 1: the panes (lit at night).
    const m = pass === 0 ? 1.2 : 0;
    g.fillStyle = css(pass === 0 ? tint(L.pal, 0xffffff) : mix(tint(L.pal, MAT.window), MAT.windowLit, night));
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const len = windowFace(pts, n, i);
      if (len <= 0) continue;
      const j = i + 1 === n ? 0 : i + 1;
      const ax = pts[2 * i] as number;
      const ay = pts[2 * i + 1] as number;
      const ex = (pts[2 * j] as number) - ax;
      const ey = (pts[2 * j + 1] as number) - ay;
      const ww = Math.min(9, len / (perFace * 2.4));
      for (let k = 0; k < perFace; k++) {
        const ss = (k + 0.5) / perFace;
        const t0 = ss - ww / 2 / len - m / len;
        const t1 = ss + ww / 2 / len + m / len;
        for (let f = 0; f < floors.length; f++) {
          if (i === doorFace && k === 0 && f === 0) continue;
          const z0 = floors[f] as number;
          quadPath(g, v, ax + ex * t0, ay + ey * t0, ax + ex * t1, ay + ey * t1, z0 - m, z0 + wh + m);
        }
      }
    }
    g.fill();
  }
}

/** Length of face i (edge i → i+1) if it faces south enough to carry windows, else 0. */
function windowFace(pts: Float64Array, n: number, i: number): number {
  const j = i + 1 === n ? 0 : i + 1;
  const ex = (pts[2 * j] as number) - (pts[2 * i] as number);
  const ey = (pts[2 * j + 1] as number) - (pts[2 * i + 1] as number);
  const len = Math.sqrt(ex * ex + ey * ey) || 1;
  return -ex / len > -0.25 ? 0 : len;
}

/** Appends a vertical quad on the segment (a → b) between heights z0 and z1 to the current path. */
function quadPath(g: CanvasRenderingContext2D, v: View, ax: number, ay: number, bx: number, by: number, z0: number, z1: number): void {
  g.moveTo(px(v, ax), py(v, ay, z0));
  g.lineTo(px(v, bx), py(v, by, z0));
  g.lineTo(px(v, bx), py(v, by, z1));
  g.lineTo(px(v, ax), py(v, ay, z1));
  g.closePath();
}

function quad(g: CanvasRenderingContext2D, v: View, ax: number, ay: number, bx: number, by: number, z0: number, z1: number): void {
  g.beginPath();
  quadPath(g, v, ax, ay, bx, by, z0, z1);
  g.fill();
}

// ---------------------------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------------------------

/** Gable roof over a rectangular prism top at height h: ridge along the long axis, eaves overhang. */
function gableRoof(g: CanvasRenderingContext2D, v: View, L: Light, p: PrismPart, ridgeH: number, roof: Rgb, roofSide: Rgb, wall: Rgb): void {
  const pts = tmp;
  grown(p.pts, 4, 3, pts);
  const h = p.h;
  // Long axis: edge 0→1 vs 1→2.
  const e0 = Math.hypot((pts[2] as number) - (pts[0] as number), (pts[3] as number) - (pts[1] as number));
  const e1 = Math.hypot((pts[4] as number) - (pts[2] as number), (pts[5] as number) - (pts[3] as number));
  // Rotate the corner order so that edge 0→1 is a long eave.
  const o = e0 >= e1 ? 0 : 1;
  const c0x = pts[2 * o] as number;
  const c0y = pts[2 * o + 1] as number;
  const c1x = pts[2 * ((o + 1) % 4)] as number;
  const c1y = pts[2 * ((o + 1) % 4) + 1] as number;
  const c2x = pts[2 * ((o + 2) % 4)] as number;
  const c2y = pts[2 * ((o + 2) % 4) + 1] as number;
  const c3x = pts[2 * ((o + 3) % 4)] as number;
  const c3y = pts[2 * ((o + 3) % 4) + 1] as number;
  // Ridge ends: midpoints of the short edges 1→2 and 3→0.
  const r0x = (c3x + c0x) / 2;
  const r0y = (c3y + c0y) / 2;
  const r1x = (c1x + c2x) / 2;
  const r1y = (c1y + c2y) / 2;
  const zr = h + ridgeH;
  // Gable triangles (wall color) on short edges that face south.
  const gable = (ax: number, ay: number, bx: number, by: number, mx: number, my: number): void => {
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.sqrt(ex * ex + ey * ey) || 1;
    const ny = -ex / len;
    if (ny > -0.02) return;
    const ndu = (ey * L.ux - ex * L.uy) / len;
    g.fillStyle = css(faceShade(L.pal, darken(wall, 0.04), wall, ndu, L.sunUp));
    g.beginPath();
    g.moveTo(px(v, ax), py(v, ay, h));
    g.lineTo(px(v, bx), py(v, by, h));
    g.lineTo(px(v, mx), py(v, my, zr));
    g.closePath();
    g.fill();
  };
  gable(c1x, c1y, c2x, c2y, r1x, r1y);
  gable(c3x, c3y, c0x, c0y, r0x, r0y);
  // Roof planes: A = eave c0→c1 up to the ridge, B = eave c2→c3. The one facing the sun is lighter.
  const ax = (c0x + c1x) / 2 - (r0x + r1x) / 2;
  const ay = (c0y + c1y) / 2 - (r0y + r1y) / 2;
  const alen = Math.sqrt(ax * ax + ay * ay) || 1;
  const aSun = (ax * L.ux + ay * L.uy) / alen;
  const planeA = (): void => {
    const lit = L.sunUp ? Math.max(0, aSun) : 0;
    const dark = L.sunUp ? Math.max(0, -aSun) : 0;
    g.fillStyle = css(darken(mix(tint(L.pal, roof), lighten(tint(L.pal, roof), 0.25), lit * (0.5 + 0.5 * (1 - L.elev))), dark * 0.12));
    g.beginPath();
    g.moveTo(px(v, c0x), py(v, c0y, h));
    g.lineTo(px(v, c1x), py(v, c1y, h));
    g.lineTo(px(v, r1x), py(v, r1y, zr));
    g.lineTo(px(v, r0x), py(v, r0y, zr));
    g.closePath();
    g.fill();
  };
  const planeB = (): void => {
    const lit = L.sunUp ? Math.max(0, -aSun) : 0;
    const dark = L.sunUp ? Math.max(0, aSun) : 0;
    g.fillStyle = css(darken(mix(tint(L.pal, roofSide), lighten(tint(L.pal, roof), 0.2), lit * (0.6 + 0.4 * (1 - L.elev))), dark * 0.1));
    g.beginPath();
    g.moveTo(px(v, c2x), py(v, c2y, h));
    g.lineTo(px(v, c3x), py(v, c3y, h));
    g.lineTo(px(v, r0x), py(v, r0y, zr));
    g.lineTo(px(v, r1x), py(v, r1y, zr));
    g.closePath();
    g.fill();
  };
  // Draw the more northern plane first.
  const aNorth = (c0y + c1y) / 2 > (c2y + c3y) / 2;
  if (aNorth) {
    planeA();
    planeB();
  } else {
    planeB();
    planeA();
  }
  // Chimney on cottages: a small brick stack on the ridge, two thirds along it.
  if (ridgeH >= 20) {
    const t = 0.7;
    const cx = r0x + (r1x - r0x) * t;
    const cy = r0y + (r1y - r0y) * t;
    const s2 = 3.2;
    tmp2[0] = cx - s2;
    tmp2[1] = cy - s2;
    tmp2[2] = cx + s2;
    tmp2[3] = cy - s2;
    tmp2[4] = cx + s2;
    tmp2[5] = cy + s2;
    tmp2[6] = cx - s2;
    tmp2[7] = cy + s2;
    const brick = hex('#9C5B48');
    if (L.sides) sideFaces(g, v, L, tmp2, tmp2, 4, zr - 10, zr + 9, darken(brick, 0.15), brick);
    fillTop(g, v, tmp2, 4, zr + 9, topColor(L, lighten(brick, 0.1)));
    scaled(tmp2, 4, 0.55, tmp);
    fillTop(g, v, tmp, 4, zr + 9.2, darken(brick, 0.45));
  }
  // Ridge line.
  g.strokeStyle = cssa(lighten(tint(L.pal, roof), 0.35), 0.8 * (1 - L.pal.night * 0.6));
  g.lineWidth = Math.max(1, 1.4 * v.S);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(px(v, r0x), py(v, r0y, zr));
  g.lineTo(px(v, r1x), py(v, r1y, zr));
  g.stroke();
}

function drawCottage(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster, hut: boolean): void {
  const p = c.parts[0] as PrismPart;
  const wall = hut ? MAT.hut : MAT.cottage;
  const wallSide = hut ? MAT.hutSide : MAT.cottageSide;
  if (L.sides) {
    sideFaces(g, v, L, p.pts, p.pts, p.n, 0, p.h, wallSide, wall);
    windows(g, v, L, p.pts, p.n, hut ? [] : [p.h * 0.4], 11, hut ? 1 : 2, true);
    if (hut) doorOnly(g, v, L, p);
  }
  gableRoof(g, v, L, p, hut ? 16 : 22, hut ? MAT.hutRoof : MAT.cottageRoof, hut ? darken(MAT.hutRoof, 0.2) : MAT.cottageRoofSide, wall);
}

function doorOnly(g: CanvasRenderingContext2D, v: View, L: Light, p: PrismPart): void {
  // The hut's door: on the most south-facing face.
  let best = -1;
  let bestNy = 0;
  for (let i = 0; i < p.n; i++) {
    const j = i + 1 === p.n ? 0 : i + 1;
    const ex = (p.pts[2 * j] as number) - (p.pts[2 * i] as number);
    const ey = (p.pts[2 * j + 1] as number) - (p.pts[2 * i + 1] as number);
    const ny = -ex / (Math.sqrt(ex * ex + ey * ey) || 1);
    if (ny < bestNy) {
      bestNy = ny;
      best = i;
    }
  }
  if (best < 0) return;
  const j = best + 1 === p.n ? 0 : best + 1;
  const ax = p.pts[2 * best] as number;
  const ay = p.pts[2 * best + 1] as number;
  const ex = (p.pts[2 * j] as number) - ax;
  const ey = (p.pts[2 * j + 1] as number) - ay;
  const len = Math.sqrt(ex * ex + ey * ey) || 1;
  const t0 = 0.5 - 5 / len;
  const t1 = 0.5 + 5 / len;
  g.fillStyle = css(darken(tint(L.pal, MAT.door), 0.1));
  quad(g, v, ax + ex * t0, ay + ey * t0, ax + ex * t1, ay + ey * t1, 0, 24);
  g.fillStyle = css(mix(tint(L.pal, MAT.window), MAT.windowLit, L.pal.night));
  quad(g, v, ax + ex * (t0 + 2.5 / len), ay + ey * (t0 + 2.5 / len), ax + ex * (t1 - 2.5 / len), ay + ey * (t1 - 2.5 / len), 15, 21);
}

function drawHouse(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster): void {
  const p = c.parts[0] as PrismPart;
  if (L.sides) {
    sideFaces(g, v, L, p.pts, p.pts, p.n, 0, p.h, MAT.houseSide, MAT.house);
    windows(g, v, L, p.pts, p.n, [16, 48, 78], 13, 2, true);
    // A cornice band just under the parapet.
    g.globalAlpha = 0.18;
    sideFaces(g, v, L, p.pts, p.pts, p.n, p.h - 7, p.h - 4, 0x2b2140, 0x2b2140);
    g.globalAlpha = 1;
  }
  // Flat roof: parapet ring (wall color) around a darker blue roof deck.
  fillTop(g, v, p.pts, p.n, p.h, topColor(L, MAT.house));
  scaled(p.pts, p.n, 0.86, tmp);
  fillTop(g, v, tmp, p.n, p.h, tint(L.pal, MAT.houseRoofSide));
  scaled(p.pts, p.n, 0.8, tmp2);
  fillTop(g, v, tmp2, p.n, p.h - 1, topColor(L, MAT.houseRoof));
  // A little chimney/vent block for silhouette.
  rim(g, v, L, p.pts, p.n, p.h);
}

/** A menhir: the square footprint with its corners cut, tapering to a rounded crown. */
function drawStone(g: CanvasRenderingContext2D, v: View, L: Light, p: PrismPart, top: Rgb, side: Rgb, taper: number, id: number): void {
  // Octagon from the rotated square: each corner cut at 28 % of the edge.
  const n = 8;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const ax = p.pts[2 * i] as number;
    const ay = p.pts[2 * i + 1] as number;
    const bx = p.pts[2 * j] as number;
    const by = p.pts[2 * j + 1] as number;
    tmp[4 * i] = ax + (bx - ax) * 0.28;
    tmp[4 * i + 1] = ay + (by - ay) * 0.28;
    tmp[4 * i + 2] = ax + (bx - ax) * 0.72;
    tmp[4 * i + 3] = ay + (by - ay) * 0.72;
  }
  scaled(tmp, n, taper, tmp2);
  // Lean the crown a touch (seeded) so a row of stones doesn't look stamped.
  const lean = ((id * 37) % 7) - 3;
  for (let i = 0; i < n; i++) tmp2[2 * i] = (tmp2[2 * i] as number) + lean * 0.6;
  if (L.sides) sideFaces(g, v, L, tmp, tmp2, n, 0, p.h, side, top);
  fillTop(g, v, tmp2, n, p.h, topColor(L, top));
  scaled(tmp2, n, 0.62, tmp);
  fillTop(g, v, tmp, n, p.h + 4, lighten(topColor(L, top), 0.07));
  rim(g, v, L, tmp2, n, p.h);
  // Lichen speckles on the front.
  center(tmp2, n, ctr);
  g.fillStyle = cssa(tint(L.pal, 0x9fb48a), 0.55);
  g.beginPath();
  for (let k = 0; k < 3; k++) {
    const sx = px(v, (ctr[0] as number) + ((id >> k) % 5) - 2);
    const sy = py(v, (ctr[1] as number) - 8, p.h * (0.25 + 0.2 * k));
    const r = (1.6 + (k % 2)) * v.S;
    g.moveTo(sx + r, sy);
    g.arc(sx, sy, r, 0, TAU);
  }
  g.fill();
}

function drawRock(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster): void {
  const p = c.parts[0] as PrismPart;
  // A chunky boulder: an irregular octagon tapering to a smaller cap.
  const cx = c.x;
  const cy = c.y;
  const hw = ((p.maxX - p.minX) / 2) * 1.02;
  const hd = ((p.maxY - p.minY) / 2) * 1.02;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + Math.PI / 8;
    const wob = 0.86 + 0.14 * Math.abs(Math.sin(c.id * 7.1 + i * 2.3));
    tmp[2 * i] = cx + Math.cos(a) * hw * wob;
    tmp[2 * i + 1] = cy + Math.sin(a) * hd * wob;
  }
  scaled(tmp, n, 0.62, tmp2);
  if (L.sides) sideFaces(g, v, L, tmp, tmp2, n, 0, p.h, MAT.rockSide, MAT.rock);
  fillTop(g, v, tmp2, n, p.h, topColor(L, MAT.rock));
  rim(g, v, L, tmp2, n, p.h, 0.7);
  // A frosty cap: this is the rock that saves Nubs.
  scaled(tmp2, n, 0.55, tmp);
  g.fillStyle = cssa(0xffffff, 0.35 * (1 - L.pal.night * 0.5));
  g.beginPath();
  polyPath(g, v, tmp, n, p.h);
  g.fill();
}

function drawHedge(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster): void {
  const p = c.parts[0] as PrismPart;
  if (L.sides) sideFaces(g, v, L, p.pts, p.pts, p.n, 0, p.h, MAT.hedgeSide, MAT.hedge);
  const top = topColor(L, MAT.hedge);
  fillTop(g, v, p.pts, p.n, p.h, top);
  // Bushy bumps along the long axis.
  const e0 = Math.hypot((p.pts[2] as number) - (p.pts[0] as number), (p.pts[3] as number) - (p.pts[1] as number));
  const e1 = Math.hypot((p.pts[4] as number) - (p.pts[2] as number), (p.pts[5] as number) - (p.pts[3] as number));
  const o = e0 >= e1 ? 0 : 1;
  const ax = ((p.pts[2 * o] as number) + (p.pts[2 * ((o + 3) % 4)] as number)) / 2;
  const ay = ((p.pts[2 * o + 1] as number) + (p.pts[2 * ((o + 3) % 4) + 1] as number)) / 2;
  const bx = ((p.pts[2 * ((o + 1) % 4)] as number) + (p.pts[2 * ((o + 2) % 4)] as number)) / 2;
  const by = ((p.pts[2 * ((o + 1) % 4) + 1] as number) + (p.pts[2 * ((o + 2) % 4) + 1] as number)) / 2;
  const len = Math.hypot(bx - ax, by - ay);
  const halfW = Math.min(e0, e1) / 2;
  const count = Math.max(3, Math.round(len / 11));
  const r = halfW * 1.05;
  const lit = lighten(top, 0.12);
  const dark = darken(tint(L.pal, MAT.hedgeSide), 0.05);
  // Underside lumps peek out on the south edge, then the lit lumps on top.
  for (let pass = 0; pass < 2; pass++) {
    g.fillStyle = css(pass === 0 ? dark : top);
    g.beginPath();
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const wob = Math.sin(c.id * 3.7 + i * 1.9) * 1.5;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t + (pass === 0 ? -2 : 0);
      const sx = px(v, x);
      const sy = py(v, y, p.h + (pass === 0 ? 0 : 2));
      const rr = (r + wob) * v.S;
      g.moveTo(sx + rr, sy);
      g.arc(sx, sy, rr, 0, TAU);
    }
    g.fill();
  }
  if (L.sunUp) {
    g.fillStyle = cssa(lit, 0.9);
    g.beginPath();
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const x = ax + (bx - ax) * t + L.ux * r * 0.35;
      const y = ay + (by - ay) * t + L.uy * r * 0.35;
      const sx = px(v, x);
      const sy = py(v, y, p.h + 3);
      const rr = r * 0.5 * v.S;
      g.moveTo(sx + rr, sy);
      g.arc(sx, sy, rr, 0, TAU);
    }
    g.fill();
  }
}

function drawWall(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster): void {
  const p = c.parts[0] as PrismPart;
  if (L.sides) {
    sideFaces(g, v, L, p.pts, p.pts, p.n, 0, p.h, MAT.wallSide, MAT.wall);
    // Brick courses on the south faces.
    g.strokeStyle = cssa(0x2b2140, 0.1);
    g.lineWidth = Math.max(0.6, 0.7 * v.S);
    g.beginPath();
    for (let i = 0; i < p.n; i++) {
      const j = i + 1 === p.n ? 0 : i + 1;
      const ax = p.pts[2 * i] as number;
      const ay = p.pts[2 * i + 1] as number;
      const bx = p.pts[2 * j] as number;
      const by = p.pts[2 * j + 1] as number;
      const ex = bx - ax;
      const ey = by - ay;
      const len = Math.sqrt(ex * ex + ey * ey) || 1;
      if (-ex / len > -0.02) continue;
      for (let z = 10; z < p.h; z += 10) {
        g.moveTo(px(v, ax), py(v, ay, z));
        g.lineTo(px(v, bx), py(v, by, z));
      }
      // Staggered vertical joints.
      for (let z = 0, row = 0; z < p.h - 2; z += 10, row++) {
        for (let s = row % 2 === 0 ? 10 : 5; s < len; s += 10) {
          const x = ax + (ex * s) / len;
          const y = ay + (ey * s) / len;
          g.moveTo(px(v, x), py(v, y, z));
          g.lineTo(px(v, x), py(v, y, Math.min(p.h, z + 10)));
        }
      }
    }
    g.stroke();
  }
  // Coping stones: a slightly wider, lighter cap.
  grown(p.pts, p.n, 1.5, tmp);
  if (L.sides) sideFaces(g, v, L, tmp, tmp, p.n, p.h - 4, p.h, MAT.wall, lighten(MAT.wall, 0.2));
  fillTop(g, v, tmp, p.n, p.h, topColor(L, lighten(MAT.wall, 0.12)));
  rim(g, v, L, tmp, p.n, p.h);
}

function drawColumn(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster): void {
  const p = c.parts[0] as PrismPart;
  // Plinth, fluted shaft, capital.
  grown(p.pts, p.n, 4, tmp);
  if (L.sides) sideFaces(g, v, L, tmp, tmp, p.n, 0, 7, MAT.columnSide, MAT.column);
  fillTop(g, v, tmp, p.n, 7, topColor(L, MAT.column));
  if (L.sides) {
    sideFaces(g, v, L, p.pts, p.pts, p.n, 7, p.h - 9, MAT.columnSide, MAT.column);
    // Flutes.
    g.strokeStyle = cssa(0x2b2140, 0.08);
    g.lineWidth = Math.max(0.6, 0.8 * v.S);
    g.beginPath();
    for (let i = 0; i < p.n; i++) {
      const j = i + 1 === p.n ? 0 : i + 1;
      const ax = p.pts[2 * i] as number;
      const ay = p.pts[2 * i + 1] as number;
      const ex = (p.pts[2 * j] as number) - ax;
      const ey = (p.pts[2 * j + 1] as number) - ay;
      const len = Math.sqrt(ex * ex + ey * ey) || 1;
      if (-ex / len > -0.02) continue;
      for (let k = 1; k < 4; k++) {
        const x = ax + (ex * k) / 4;
        const y = ay + (ey * k) / 4;
        g.moveTo(px(v, x), py(v, y, 9));
        g.lineTo(px(v, x), py(v, y, p.h - 11));
      }
    }
    g.stroke();
  }
  grown(p.pts, p.n, 4, tmp);
  if (L.sides) sideFaces(g, v, L, tmp, tmp, p.n, p.h - 9, p.h, MAT.columnSide, MAT.column);
  fillTop(g, v, tmp, p.n, p.h, topColor(L, MAT.column));
  rim(g, v, L, tmp, p.n, p.h);
}

function drawSlab(g: CanvasRenderingContext2D, v: View, L: Light, s: SlabPart, side: Rgb, top: Rgb): void {
  if (L.sides) sideFaces(g, v, L, s.pts, s.pts, s.n, s.z0, s.z1, side, top);
  fillTop(g, v, s.pts, s.n, s.z1, topColor(L, top));
  rim(g, v, L, s.pts, s.n, s.z1);
}

function drawArch(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster): void {
  // Posts north to south, then the lintel.
  const a = c.parts[0] as PrismPart;
  const b = c.parts[1] as PrismPart;
  const lintel = c.parts[2] as SlabPart;
  const first = (a.minY + a.maxY) >= (b.minY + b.maxY) ? a : b;
  const second = first === a ? b : a;
  prism(g, v, L, first, MAT.archSide, MAT.arch, 0, first.h);
  prism(g, v, L, second, MAT.archSide, MAT.arch, 0, second.h);
  drawSlab(g, v, L, lintel, MAT.archSide, MAT.arch);
  // Keystone.
  center(lintel.pts, lintel.n, ctr);
  scaled(lintel.pts, lintel.n, 0.16, tmp);
  for (let i = 0; i < lintel.n; i++) tmp[2 * i + 1] = (tmp[2 * i + 1] as number) + 0;
  fillTop(g, v, tmp, lintel.n, lintel.z1 + 0.5, lighten(topColor(L, MAT.arch), 0.08));
}

function drawStall(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster): void {
  const roof = c.parts[4] as SlabPart;
  // Crates under the awning (render-only), then posts, then the striped roof.
  center(roof.pts, roof.n, ctr);
  scaled(roof.pts, roof.n, 0.55, tmp);
  const crate = tint(L.pal, hex('#C9A06A'));
  if (L.sides) sideFaces(g, v, L, tmp, tmp, roof.n, 0, 12, darken(crate, 0.15), crate);
  fillTop(g, v, tmp, roof.n, 12, crate);
  // Fruit dots on the crates.
  g.fillStyle = css(tint(L.pal, (c.id & 1) === 0 ? hex('#FF8A2B') : hex('#E8475A')));
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.5) / 6;
    const x = (tmp[0] as number) + ((tmp[2] as number) - (tmp[0] as number)) * t;
    const y = (tmp[1] as number) + ((tmp[5] as number) - (tmp[1] as number)) * 0.5 + ((tmp[3] as number) - (tmp[1] as number)) * t;
    const sx = px(v, x);
    const sy = py(v, y, 13);
    g.moveTo(sx + 1.8 * v.S, sy);
    g.arc(sx, sy, 1.8 * v.S, 0, TAU);
  }
  g.fill();
  // The four posts share a rotation, so face k has the same normal (and color) on each: one fill
  // per face direction. Thin posts never overlap on screen, so the draw order between them is moot.
  if (L.sides) {
    const p0 = c.parts[0] as PrismPart;
    for (let k = 0; k < p0.n; k++) {
      const k1 = k + 1 === p0.n ? 0 : k + 1;
      const ex = (p0.pts[2 * k1] as number) - (p0.pts[2 * k] as number);
      const ey = (p0.pts[2 * k1 + 1] as number) - (p0.pts[2 * k + 1] as number);
      const len = Math.sqrt(ex * ex + ey * ey) || 1;
      const ny = -ex / len;
      if (ny > -0.02) continue;
      const ndu = (ey / len) * L.ux + ny * L.uy;
      g.fillStyle = css(faceShade(L.pal, darken(MAT.post, 0.15), MAT.post, ndu * (0.6 + 0.4 * (1 - L.elev)), L.sunUp));
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const post = c.parts[i] as PrismPart;
        quadPath(g, v, post.pts[2 * k] as number, post.pts[2 * k + 1] as number, post.pts[2 * k1] as number, post.pts[2 * k1 + 1] as number, 0, post.h);
      }
      g.fill();
    }
  }
  // Awning sides (red), then stripes on top.
  if (L.sides) sideFaces(g, v, L, roof.pts, roof.pts, roof.n, roof.z0 - 3, roof.z1, MAT.stallRed, MAT.stallRed);
  fillTop(g, v, roof.pts, roof.n, roof.z1, topColor(L, MAT.stallCream));
  // Stripes along the short axis.
  const e0 = Math.hypot((roof.pts[2] as number) - (roof.pts[0] as number), (roof.pts[3] as number) - (roof.pts[1] as number));
  const e1 = Math.hypot((roof.pts[4] as number) - (roof.pts[2] as number), (roof.pts[5] as number) - (roof.pts[3] as number));
  const o = e0 >= e1 ? 0 : 1;
  const p0x = roof.pts[2 * o] as number;
  const p0y = roof.pts[2 * o + 1] as number;
  const p1x = roof.pts[2 * ((o + 1) % 4)] as number;
  const p1y = roof.pts[2 * ((o + 1) % 4) + 1] as number;
  const p3x = roof.pts[2 * ((o + 3) % 4)] as number;
  const p3y = roof.pts[2 * ((o + 3) % 4) + 1] as number;
  const stripes = 6;
  g.fillStyle = css(topColor(L, MAT.stallRed));
  g.beginPath();
  for (let i = 0; i < stripes; i += 2) {
    const t0 = i / stripes;
    const t1 = (i + 1) / stripes;
    const ax = p0x + (p1x - p0x) * t0;
    const ay = p0y + (p1y - p0y) * t0;
    const bx = p0x + (p1x - p0x) * t1;
    const by = p0y + (p1y - p0y) * t1;
    const dx = p3x - p0x;
    const dy = p3y - p0y;
    g.moveTo(px(v, ax), py(v, ay, roof.z1));
    g.lineTo(px(v, bx), py(v, by, roof.z1));
    g.lineTo(px(v, bx + dx), py(v, by + dy, roof.z1));
    g.lineTo(px(v, ax + dx), py(v, ay + dy, roof.z1));
    g.closePath();
  }
  g.fill();
  rim(g, v, L, roof.pts, roof.n, roof.z1);
}

function drawPedestal(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster): void {
  const p = c.parts[0] as PrismPart;
  grown(p.pts, p.n, 2, tmp);
  if (L.sides) sideFaces(g, v, L, tmp, tmp, p.n, 0, 4, MAT.pedestalSide, MAT.pedestal);
  prism(g, v, L, p, MAT.pedestalSide, MAT.pedestal, 0, p.h);
  // Cup under the ball.
  grown(p.pts, p.n, 2.5, tmp);
  fillTop(g, v, tmp, p.n, p.h + 1, topColor(L, MAT.pedestal));
  // The mirrored sphere.
  const r = 9;
  const sx = px(v, c.x);
  const sy = py(v, c.y, BALL_Z);
  const R = r * v.S;
  const sunX = L.ux;
  const sunY = -L.uy;
  const base = tint(L.pal, MAT.ball);
  const grad = g.createRadialGradient(sx + sunX * R * 0.35, sy + sunY * R * 0.35 - R * 0.25, R * 0.1, sx, sy, R);
  grad.addColorStop(0, css(lighten(base, 0.6)));
  grad.addColorStop(0.55, css(base));
  grad.addColorStop(1, css(darken(base, 0.35)));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(sx, sy, R, 0, TAU);
  g.fill();
  // Horizon band reflection.
  g.strokeStyle = cssa(darken(base, 0.25), 0.5);
  g.lineWidth = Math.max(0.8, R * 0.18);
  g.beginPath();
  g.ellipse(sx, sy + R * 0.25, R * 0.82, R * 0.32, 0, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  // Specular dot toward the sun, twinkling while it can glare.
  if (L.sunUp) {
    const tw = 0.75 + 0.25 * Math.sin(L.time * 6 + c.id);
    g.fillStyle = cssa(0xffffff, 0.95);
    g.beginPath();
    g.arc(sx + sunX * R * 0.45, sy + sunY * R * 0.45 - R * 0.2, R * 0.22 * tw, 0, TAU);
    g.fill();
  }
}

// ---------------------------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------------------------

const lumpCache = new Map<number, Float32Array>();

/** 5 seeded lumps (dx, dy, r) as fractions of the canopy radius. */
function lumps(id: number): Float32Array {
  let l = lumpCache.get(id);
  if (l) return l;
  if (lumpCache.size > 600) lumpCache.clear();
  let s = (id * 2654435761) >>> 0;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  l = new Float32Array(18);
  // A center lump plus 5 around it.
  l[0] = 0;
  l[1] = 0;
  l[2] = 0.72;
  const a0 = rnd() * TAU;
  for (let i = 0; i < 5; i++) {
    const a = a0 + (i / 5) * TAU + (rnd() - 0.5) * 0.6;
    const d = 0.42 + rnd() * 0.12;
    l[3 + 3 * i] = Math.cos(a) * d;
    l[4 + 3 * i] = Math.sin(a) * d;
    l[5 + 3 * i] = 0.48 + rnd() * 0.14;
  }
  lumpCache.set(id, l);
  return l;
}

/** Canopy lump paths per tree in unit space (lump radius × 1, 0.86, 0.42), built once per tree. */
const lumpPaths = new Map<number, Path2D[]>();
const LUMP_SCALES = [1, 0.86, 0.42];

function lumpPathsFor(id: number, l: Float32Array): Path2D[] {
  let ps = lumpPaths.get(id);
  if (ps) return ps;
  if (lumpPaths.size > 600) lumpPaths.clear();
  ps = [];
  for (const scale of LUMP_SCALES) {
    const p = new Path2D();
    for (let i = 0; i < 6; i++) {
      const x = l[3 * i] as number;
      const y = -(l[3 * i + 1] as number);
      const r = (l[3 * i + 2] as number) * scale;
      p.moveTo(x + r, y);
      p.arc(x, y, r, 0, TAU);
    }
    ps.push(p);
  }
  lumpPaths.set(id, ps);
  return ps;
}

/** Fills the canopy lumps centered at (cx, cy) with radius R, offset by (ox, oy)·R. */
function fillLumps(g: CanvasRenderingContext2D, paths: Path2D[], cx: number, cy: number, R: number, ox: number, oy: number, which: number): void {
  g.save();
  g.translate(cx + ox * R, cy + oy * R);
  g.scale(R, R);
  g.fill(paths[which] as Path2D);
  g.restore();
}

function drawTree(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster, oak: boolean): void {
  const trunk = c.parts[0] as PrismPart;
  const canopy = c.parts[1] as DiscPart;
  if (L.sides) sideFaces(g, v, L, trunk.pts, trunk.pts, trunk.n, 0, trunk.h, MAT.trunkSide, MAT.trunk);
  const cx = px(v, canopy.cx);
  const cy = py(v, canopy.cy, canopy.z);
  const R = canopy.r * v.S;
  // Fade the canopy when it would hide Nubs.
  const nsx = px(v, L.nubsX);
  const nsy = py(v, L.nubsY, 48);
  const d = Math.hypot(nsx - cx, nsy - cy) / v.S;
  // Canopies in front of (south of) Nubs that overlap his sprite turn see-through.
  const near = canopy.cy < L.nubsY + 30 && d < canopy.r + 26;
  const alpha = near ? 0.62 + 0.38 * Math.min(1, Math.max(0, (d - canopy.r + 6) / 32)) : 1;
  g.globalAlpha = alpha;
  const l = lumps(c.id);
  // Seeded variation so a meadow of trees isn't stamped from one mould.
  const vary = (((c.id * 2654435761) >>> 0) % 1000) / 1000;
  const shift = vary < 0.33 ? hex('#8FC36A') : vary < 0.66 ? hex('#4FA88A') : 0;
  const amt = shift === 0 ? 0 : 0.18;
  const base = tint(L.pal, mix(oak ? MAT.oak : MAT.canopy, shift, amt));
  const shade = tint(L.pal, mix(oak ? MAT.oakShade : MAT.canopyShade, shift, amt * 0.8));
  // Underside (gives the canopy thickness), then the shaded mass, then the lit mass toward the sun.
  const paths = lumpPathsFor(c.id, l);
  g.fillStyle = css(darken(shade, 0.12));
  fillLumps(g, paths, cx, cy + 4 * v.S, R, 0, 0, 0);
  g.fillStyle = css(shade);
  fillLumps(g, paths, cx, cy, R, 0, 0, 0);
  const off = L.sunUp ? 0.16 + 0.08 * (1 - L.elev) : 0.05;
  g.fillStyle = css(base);
  fillLumps(g, paths, cx, cy, R, L.ux * off, L.uy * off - 0.05, 1);
  if (L.sunUp) {
    g.fillStyle = css(lighten(base, 0.22));
    fillLumps(g, paths, cx, cy, R, L.ux * (off + 0.2), L.uy * (off + 0.2), 2);
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------------------------

/** Draws one caster with its full 3D treatment. */
export function drawCaster(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster): void {
  switch (c.kind) {
    case 'tree':
      drawTree(g, v, L, c, false);
      return;
    case 'oak':
      drawTree(g, v, L, c, true);
      return;
    case 'cottage':
      drawCottage(g, v, L, c, false);
      return;
    case 'hut':
      drawCottage(g, v, L, c, true);
      return;
    case 'house':
      drawHouse(g, v, L, c);
      return;
    case 'stone':
      drawStone(g, v, L, c.parts[0] as PrismPart, MAT.stone, MAT.stoneSide, 0.74, c.id);
      return;
    case 'rock':
      drawRock(g, v, L, c);
      return;
    case 'hedge':
      drawHedge(g, v, L, c);
      return;
    case 'wall':
      drawWall(g, v, L, c);
      return;
    case 'column':
      drawColumn(g, v, L, c);
      return;
    case 'arch':
      drawArch(g, v, L, c);
      return;
    case 'stall':
      drawStall(g, v, L, c);
      return;
    case 'pedestal':
      drawPedestal(g, v, L, c);
      return;
    default: {
      for (const part of c.parts as readonly Part[]) {
        if (part.t === 'prism') prism(g, v, L, part, MAT.stoneSide, MAT.stone);
        else if (part.t === 'slab') drawSlab(g, v, L, part, MAT.archSide, MAT.arch);
      }
    }
  }
}

/** Screen-space top of a caster (for culling and callouts): the highest projected point. */
export function casterTopY(v: View, c: Caster): number {
  return py(v, c.maxY, c.maxZ + 24);
}
