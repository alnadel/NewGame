// Living ground (GR11): small flat decals seeded per 48 u cell of the world, so a Daily looks the
// same for everyone. Meadow cells grow clover, daisies, poppies, pebbles, mushrooms and leaf litter;
// Old Town cells get flower pots, manholes, chalk hopscotch, cracks and the odd sleeping cat; both
// get puddles, which freeze over (a frost rim and two glints) in shade and steam in the sun. A
// signpost and two lamp posts mark the boundary where the next biome begins.
//
// Layout is pure (decorIn): a cell's hash decides everything, and decals keep clear of the trail and
// of every caster footprint. The renderer caches one row of cells at a time in a ring (a row is laid
// out once, when it first shows and its casters are final) and draws each decal as one drawImage
// from a per-biome atlas built lazily at the device scale. Drawn after the trail and before the
// shadow layer, so shade darkens them like the ground.

import { biomeAtY, queryCasters, smoothstep, trailSlope, trailX, validatedY, type Caster, type SimState, type World } from '../core/index.ts';
import { pointLitWeight } from '../core/sim/pickups.ts';
import type { View } from '../game/camera.ts';
import { P_STEAM, spawn, type Particles } from './particles.ts';
import { ctx2d, makeCanvas, roundRect, sparkle, type Canvas2D } from './sprites.ts';

const TAU = Math.PI * 2;

/** Grid cell (u), and how many cells each side of the trail a row covers. */
export const DECOR_CELL = 48;
const SPAN = 12;
/** Decals keep this far (u, plus their own radius) from the trail centreline and caster footprints. */
export const TRAIL_CLEAR = 24;
export const FOOTPRINT_CLEAR = 6;
/**
 * Zoomed far out (the Melt Map of a long run shows ~2,000 cells) a decal is a few device px yet
 * still one blit: decals fade out from DECOR_FULL_S down to DECOR_MIN_S (CSS px per u) and are
 * skipped below it, which keeps the map pull inside its budget (A12).
 */
const DECOR_MIN_S = 0.3;
const DECOR_FULL_S = 0.5;

/** Atlas cells (32 u): 0-11 the biome's decals, 12 puddle, 13 its frost rim, 14 lamp post, 16-17 signpost (15 unused). */
const CELL_U = 32;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 5;
export const PUDDLE = 12;
const FROST_RIM = 13;
const LAMP = 14;
const SIGN = 16;
/** Radius (u) of each sprite, for the clearance rules: [meadow, town]. */
const RADIUS: readonly (readonly number[])[] = [
  [9, 9, 8, 8, 10, 10, 8, 8, 8, 8, 10, 10, 6],
  [9, 9, 9, 10, 10, 14, 14, 12, 12, 12, 8, 8, 6],
];

/** Decals of a y-range: position and code (biome·16 + atlas sprite). */
export interface Decals {
  n: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly k: Uint8Array;
}

/** A cell holds at most a puddle, a cat and two decals. */
const ROW_CAP = (2 * SPAN + 1) * 4;

export function createDecals(cap: number = ROW_CAP): Decals {
  return { n: 0, x: new Float32Array(cap), y: new Float32Array(cap), k: new Uint8Array(cap) };
}

function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** xorshift32 stream state for the current cell. */
let st = 1;
function rnd(): number {
  st ^= st << 13;
  st ^= st >>> 17;
  st ^= st << 5;
  return (st >>> 0) / 4294967296;
}

const casters: Caster[] = [];

/** True when (x, y) lies inside caster `c`'s footprint hull or within `m` u of it. */
function nearHull(c: Caster, x: number, y: number, m: number): boolean {
  const h = c.hull;
  const n = c.hullN;
  let inside = n >= 3;
  for (let i = 0; i < n; i++) {
    const ax = h[2 * i] as number;
    const ay = h[2 * i + 1] as number;
    const j = (i + 1) % n;
    const ex = (h[2 * j] as number) - ax;
    const ey = (h[2 * j + 1] as number) - ay;
    if (ex * (y - ay) - ey * (x - ax) < 0) inside = false;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / len2)) : 0;
    const dx = ax + t * ex - x;
    const dy = ay + t * ey - y;
    if (dx * dx + dy * dy < m * m) return true;
  }
  return inside;
}

/** Distance (u) from (x, y) to the trail centreline, across the trail. */
export function trailDistance(w: World, x: number, y: number): number {
  const sl = trailSlope(w.trail, y);
  return Math.abs(x - trailX(w.trail, y)) / Math.sqrt(1 + sl * sl);
}

function place(w: World, nc: number, out: Decals, x: number, y: number, b: number, sprite: number): void {
  const r = (RADIUS[b] as readonly number[])[sprite] as number;
  if (trailDistance(w, x, y) < TRAIL_CLEAR + r) return;
  for (let i = 0; i < nc; i++) {
    const c = casters[i] as Caster;
    const m = FOOTPRINT_CLEAR + r;
    if (x + m < c.minX || x - m > c.maxX || y + m < c.minY || y - m > c.maxY) continue;
    if (nearHull(c, x, y, m)) return;
  }
  if (out.n >= out.x.length) return;
  out.x[out.n] = x;
  out.y[out.n] = y;
  out.k[out.n] = b * 16 + sprite;
  out.n++;
}

/** Meadow decal kinds by weight: clover, daisies, poppies, pebbles, mushrooms, leaf litter (2 variants each). */
const MEADOW_W = [3, 3, 2, 2, 1, 2];
/** Old Town kinds: flower pot (3 variants), manhole (2), hopscotch (2), cracks (3). */
const TOWN_W = [2, 1, 1, 3];
const TOWN_FIRST = [0, 3, 5, 7];
const TOWN_VARIANTS = [3, 2, 2, 3];

function pick(weights: readonly number[], u: number): number {
  let total = 0;
  for (const wt of weights) total += wt;
  let t = u * total;
  for (let i = 0; i < weights.length; i++) {
    t -= weights[i] as number;
    if (t < 0) return i;
  }
  return weights.length - 1;
}

/**
 * The decals of world `w` (seed `seed`) with y in [y0, y1), into `out` (reset first). Pure: the
 * same seed and range always give the same list. Needs the casters of the range to be final
 * (validated), since decals keep clear of their footprints.
 */
export function decorIn(seed: number, y0: number, y1: number, w: World, out: Decals): number {
  out.n = 0;
  const C = DECOR_CELL;
  for (let cy = Math.floor(y0 / C); cy * C < y1; cy++) {
    const rowY = cy * C;
    const nc = queryCasters(w, rowY - 30, rowY + C + 30, casters);
    const b = biomeAtY(w, rowY + C / 2) === 'oldtown' ? 1 : 0;
    const mid = Math.round(trailX(w.trail, rowY + C / 2) / C);
    const start = out.n;
    for (let cx = mid - SPAN; cx <= mid + SPAN; cx++) {
      st = hash3(cx, cy, seed) || 1;
      const x0 = cx * C;
      if (rnd() < 0.08) place(w, nc, out, x0 + 8 + rnd() * (C - 16), rowY + 8 + rnd() * (C - 16), b, PUDDLE);
      if (rnd() < 0.02 && b === 1) place(w, nc, out, x0 + 10 + rnd() * (C - 20), rowY + 10 + rnd() * (C - 20), b, 10 + (rnd() < 0.5 ? 0 : 1));
      if (rnd() >= 0.55) continue;
      const count = rnd() < 0.35 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const u = rnd();
        const v = rnd();
        const kind = pick(b === 1 ? TOWN_W : MEADOW_W, rnd());
        const sprite = b === 1 ? (TOWN_FIRST[kind] as number) + Math.floor(v * (TOWN_VARIANTS[kind] as number)) : kind * 2 + (v < 0.5 ? 0 : 1);
        place(w, nc, out, x0 + 6 + u * (C - 12), rowY + 6 + rnd() * (C - 12), b, sprite);
      }
    }
    // Keep only the range asked for (a row's decals all lie inside it).
    if (rowY < y0 || rowY + C > y1) {
      let k = start;
      for (let i = start; i < out.n; i++) {
        const y = out.y[i] as number;
        if (y < y0 || y >= y1) continue;
        out.x[k] = out.x[i] as number;
        out.y[k] = y;
        out.k[k] = out.k[i] as number;
        k++;
      }
      out.n = k;
    }
  }
  return out.n;
}

// ---------------------------------------------------------------------------------------------
// The row cache and drawing.
// ---------------------------------------------------------------------------------------------

/** Ring of laid-out rows (64 rows = 3072 u, more than the farthest Melt Map view). */
const RING = 64;

interface Atlas {
  canvas: Canvas2D | null;
  /** Device px per u it was drawn at (0 = never). */
  scale: number;
}

export interface Decor {
  world: World | null;
  readonly rowY: Int32Array;
  readonly rows: Decals[];
  readonly atlas: [Atlas, Atlas];
  /** The view scale last frame: atlases are rebuilt only while the zoom holds still. */
  lastS: number;
  /** The nearest visible puddles this frame (x, y), for the freeze/steam test. */
  readonly pud: Float32Array;
  readonly pudD: Float32Array;
  /**
   * Shade of the puddles tested lately (x, y, lit): one near puddle is re-tested per frame in turn,
   * so the test costs one pointLitWeight a frame.
   */
  readonly pudLit: Float32Array;
  pudTurn: number;
  /** The boundary the signpost was placed for, its x (NaN: no room) and the lamps that fit (bit 0 west, bit 1 east). */
  seamY: number;
  signX: number;
  lamps: number;
  /** Decals drawn last frame (perf counter). */
  drawn: number;
}

const NEAR_PUDDLES = 6;

export function createDecor(): Decor {
  const rows: Decals[] = [];
  for (let i = 0; i < RING; i++) rows.push(createDecals());
  return {
    world: null,
    rowY: new Int32Array(RING).fill(0x7fffffff),
    rows,
    atlas: [
      { canvas: null, scale: 0 },
      { canvas: null, scale: 0 },
    ],
    lastS: 0,
    pud: new Float32Array(NEAR_PUDDLES * 2),
    pudD: new Float32Array(NEAR_PUDDLES),
    pudLit: new Float32Array(NEAR_PUDDLES * 3).fill(Number.NaN),
    pudTurn: 0,
    seamY: Number.NaN,
    signX: Number.NaN,
    lamps: 0,
    drawn: 0,
  };
}

/** Drops the cached atlases (context loss or a broken frame). */
export function invalidateDecor(d: Decor): void {
  d.atlas[0].scale = 0;
  d.atlas[1].scale = 0;
}

/** Whether near puddle `j` at (x, y) is in the sun: cached, re-tested when it is its turn or new. */
function puddleLit(d: Decor, s: SimState, j: number, x: number, y: number): boolean {
  const c = d.pudLit;
  const k = 3 * j;
  if (c[k] !== x || c[k + 1] !== y || d.pudTurn === j) {
    c[k] = x;
    c[k + 1] = y;
    c[k + 2] = pointLitWeight(s, x, y) > 0 ? 1 : 0;
  }
  return c[k + 2] === 1;
}

/** Biome `b`'s atlas, rebuilt for a new device scale only while the zoom holds still. */
function atlasFor(d: Decor, b: number, scale: number, stable: boolean): Atlas {
  const a = d.atlas[b] as Atlas;
  if (a.canvas && (a.scale === scale || !stable)) return a;
  a.canvas = buildAtlas(a.canvas, b, scale);
  a.scale = scale;
  return a;
}

/** Draws atlas sprite `sprite` (its central square of `half` u each way) centred on (sx, sy). */
function blit(g: CanvasRenderingContext2D, a: Atlas, sprite: number, half: number, sx: number, sy: number, S: number): void {
  if (!a.canvas) return;
  const cp = CELL_U * a.scale;
  const o = (CELL_U / 2 - half) * a.scale;
  const hs = half * S;
  g.drawImage(a.canvas, (sprite % ATLAS_COLS) * cp + o, Math.floor(sprite / ATLAS_COLS) * cp + o, 2 * half * a.scale, 2 * half * a.scale, sx - hs, sy - hs, 2 * hs, 2 * hs);
}

export interface DecorFrame {
  time: number;
  /** Game seconds this frame while a run plays, else 0 (no steam on the Title, pause or Results). */
  dt: number;
  night: number;
  /** Puddles steam and sparkle only below governor level 2. */
  effects: boolean;
}

/**
 * Draws the decals in view (and the biome signposts at `seamY`, NaN when none); lit puddles steam
 * into `particles`. Rows are laid out on first sight once the world has validated them.
 */
export function drawDecor(g: CanvasRenderingContext2D, v: View, d: Decor, s: SimState, particles: Particles, seamY: number, f: DecorFrame): void {
  const w = s.world;
  if (d.world !== w) {
    d.world = w;
    d.rowY.fill(0x7fffffff);
    d.seamY = Number.NaN;
  }
  const lod = smoothstep(DECOR_MIN_S, DECOR_FULL_S, v.S);
  if (lod === 0) {
    d.drawn = 0;
    return;
  }
  const scale = Math.min(8, Math.max(0.5, Math.round(v.S * v.dpr * 4) / 4));
  const stable = v.S === d.lastS;
  d.lastS = v.S;
  const C = DECOR_CELL;
  const cy0 = Math.floor((v.y0 - 16) / C);
  const cy1 = Math.floor((v.y1 + 16) / C);
  const ready = validatedY(w) - 100;
  const x0 = v.x0 - 16;
  const x1 = v.x1 + 16;
  const pud = d.pud;
  const pudD = d.pudD;
  pudD.fill(Infinity);
  const nx = s.nubs.x;
  const ny = s.nubs.y;
  let drawn = 0;
  let meadow: Atlas | undefined;
  let town: Atlas | undefined;
  g.globalAlpha = lod * (1 - 0.7 * f.night);
  for (let cy = cy0; cy <= cy1; cy++) {
    const slot = ((cy % RING) + RING) % RING;
    const row = d.rows[slot] as Decals;
    if (d.rowY[slot] !== cy) {
      if ((cy + 1) * C > ready) continue;
      decorIn(w.seed, cy * C, (cy + 1) * C, w, row);
      d.rowY[slot] = cy;
    }
    for (let i = 0; i < row.n; i++) {
      const x = row.x[i] as number;
      if (x < x0 || x > x1) continue;
      const y = row.y[i] as number;
      const k = row.k[i] as number;
      const b = k >> 4;
      const sprite = k & 15;
      const atlas = b === 0 ? (meadow ??= atlasFor(d, 0, scale, stable)) : (town ??= atlasFor(d, 1, scale, stable));
      blit(g, atlas, sprite, Math.min(CELL_U / 2, ((RADIUS[b] as readonly number[])[sprite] as number) + 2), v.ox + x * v.S, v.oy - y * v.S, v.S);
      drawn++;
      if (sprite === PUDDLE) {
        // Keep the nearest few for the freeze/steam test (insertion into a short sorted list).
        const dd = (x - nx) * (x - nx) + (y - ny) * (y - ny);
        let j = NEAR_PUDDLES - 1;
        if (dd >= (pudD[j] as number)) continue;
        while (j > 0 && dd < (pudD[j - 1] as number)) {
          pudD[j] = pudD[j - 1] as number;
          pud[2 * j] = pud[2 * j - 2] as number;
          pud[2 * j + 1] = pud[2 * j - 1] as number;
          j--;
        }
        pudD[j] = dd;
        pud[2 * j] = x;
        pud[2 * j + 1] = y;
      }
    }
  }
  // Puddles: frozen over in shade (and all night), steaming in the sun.
  d.pudTurn = (d.pudTurn + 1) % NEAR_PUDDLES;
  const tw = sparkle();
  for (let j = 0; j < NEAR_PUDDLES; j++) {
    if (!Number.isFinite(pudD[j] as number)) break;
    const x = pud[2 * j] as number;
    const y = pud[2 * j + 1] as number;
    const sx = v.ox + x * v.S;
    const sy = v.oy - y * v.S;
    const phase = (x * 0.37 + y * 0.11) % 1.2;
    if (!puddleLit(d, s, j, x, y)) {
      const b = biomeAtY(w, y) === 'oldtown' ? 1 : 0;
      blit(g, atlasFor(d, b, scale, stable), FROST_RIM, 7, sx, sy, v.S);
      if (!f.effects) continue;
      const a = g.globalAlpha;
      for (let q = 0; q < 2; q++) {
        g.globalAlpha = a * (0.35 + 0.65 * Math.max(0, Math.sin(f.time * 4.2 + phase * 5 + q * 2.4)));
        const r = 2.4 * v.S;
        g.drawImage(tw, sx + (q === 0 ? -2.5 : 3) * v.S - r, sy + (q === 0 ? -1.2 : 1) * v.S - r, 2 * r, 2 * r);
      }
      g.globalAlpha = a;
    } else if (f.effects && f.dt > 0 && Math.floor((f.time + phase) / 1.2) !== Math.floor((f.time - f.dt + phase) / 1.2)) {
      spawn(particles, P_STEAM, x, y, 2, 0, 0, 18, 1.1, 2, 7, 0xffffff);
    }
  }
  // The biome boundary: a signpost beside the trail and a lamp post on each side, wherever they
  // keep clear of the casters there.
  if (!Number.isNaN(seamY) && seamY > v.y0 - 40 && seamY < v.y1 + 40) {
    if (d.seamY !== seamY) placeSignpost(d, w, seamY);
    const b = biomeAtY(w, seamY + 1) === 'oldtown' ? 1 : 0;
    const atlas = atlasFor(d, b, scale, stable);
    const tx = trailX(w.trail, seamY);
    const sy = v.oy - seamY * v.S;
    for (let side = 0; side < 2; side++) {
      if (d.lamps & (1 << side)) blit(g, atlas, LAMP, 12, v.ox + (tx + (side === 0 ? -LAMP_DX : LAMP_DX)) * v.S, sy, v.S);
    }
    if (!Number.isNaN(d.signX) && atlas.canvas) {
      const cp = CELL_U * atlas.scale;
      const du = CELL_U * v.S;
      g.drawImage(atlas.canvas, 0, Math.floor(SIGN / ATLAS_COLS) * cp, 2 * cp, cp, v.ox + d.signX * v.S - du, sy - SIGN_DY * v.S - du / 2, 2 * du, du);
    }
  }
  g.globalAlpha = 1;
  d.drawn = drawn;
}

/** Lamp posts stand this far either side of the trail; the signpost a little north of the line. */
const LAMP_DX = 54;
const SIGN_DY = 16;
const SIGN_X = [92, -92, 136, -136];

function clearOfCasters(nc: number, x: number, y: number, r: number): boolean {
  for (let i = 0; i < nc; i++) if (nearHull(casters[i] as Caster, x, y, r)) return false;
  return true;
}

/** Picks the signpost's spot (NaN when nothing fits) and the lamps that fit, for the boundary at `yb`. */
function placeSignpost(d: Decor, w: World, yb: number): void {
  d.seamY = yb;
  const nc = queryCasters(w, yb - 60, yb + 60, casters);
  const tx = trailX(w.trail, yb);
  d.signX = Number.NaN;
  for (const dx of SIGN_X) {
    if (clearOfCasters(nc, tx + dx, yb + SIGN_DY, 30)) {
      d.signX = tx + dx;
      break;
    }
  }
  d.lamps = (clearOfCasters(nc, tx - LAMP_DX, yb, 8) ? 1 : 0) | (clearOfCasters(nc, tx + LAMP_DX, yb, 8) ? 2 : 0);
}

/** The boundary signpost's word for the biome it welcomes you to. */
const SIGN_TEXT = ['MEADOW', 'OLD TOWN'];

function buildAtlas(prev: Canvas2D | null, b: number, scale: number): Canvas2D {
  const c = prev ?? makeCanvas(1, 1);
  c.width = Math.ceil(ATLAS_COLS * CELL_U * scale);
  c.height = Math.ceil(ATLAS_ROWS * CELL_U * scale);
  const g = ctx2d(c);
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let i = 0; i < 15; i++) {
    g.save();
    g.translate((i % ATLAS_COLS) * CELL_U + CELL_U / 2, Math.floor(i / ATLAS_COLS) * CELL_U + CELL_U / 2);
    if (i === PUDDLE) puddle(g);
    else if (i === FROST_RIM) frostRim(g);
    else if (i === LAMP) lampPost(g);
    else if (b === 0) meadowDecal(g, i);
    else townDecal(g, i);
    g.restore();
  }
  g.save();
  g.translate(CELL_U, (SIGN / ATLAS_COLS) * CELL_U + CELL_U / 2);
  signpost(g, SIGN_TEXT[b] as string);
  g.restore();
  return c;
}

function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.moveTo(x + r, y);
  g.arc(x, y, r, 0, TAU);
}

/** A tiny deterministic stream for the art (the same atlas every time). */
let art = 7;
function ar(): number {
  art = (Math.imul(art, 1664525) + 1013904223) >>> 0;
  return art / 4294967296;
}

function meadowDecal(g: CanvasRenderingContext2D, i: number): void {
  art = 101 + i * 7919;
  const kind = i >> 1;
  const flip = i & 1 ? -1 : 1;
  g.scale(flip, 1);
  switch (kind) {
    case 0: {
      // Clover: trefoils of three soft green leaves.
      g.fillStyle = 'rgba(127,191,106,0.5)';
      g.beginPath();
      const n = i & 1 ? 2 : 3;
      for (let t = 0; t < n; t++) {
        const cx = (ar() - 0.5) * 9;
        const cy = (ar() - 0.5) * 8;
        const rot = ar() * TAU;
        for (let l = 0; l < 3; l++) dot(g, cx + Math.cos(rot + (l * TAU) / 3) * 2.2, cy + Math.sin(rot + (l * TAU) / 3) * 2.2, 2.1);
      }
      g.fill();
      break;
    }
    case 1: {
      // Daisies: five white petal dots around a yellow eye.
      const n = i & 1 ? 2 : 3;
      for (let t = 0; t < n; t++) {
        const cx = (ar() - 0.5) * 9;
        const cy = (ar() - 0.5) * 8;
        const rot = ar() * TAU;
        g.fillStyle = '#FFFFFF';
        g.beginPath();
        for (let p = 0; p < 5; p++) dot(g, cx + Math.cos(rot + (p * TAU) / 5) * 1.6, cy + Math.sin(rot + (p * TAU) / 5) * 1.6, 1.5);
        g.fill();
        g.fillStyle = '#FFD36B';
        g.beginPath();
        dot(g, cx, cy, 1);
        g.fill();
      }
      break;
    }
    case 2: {
      // Poppies: red heads on short green stems.
      const n = i & 1 ? 3 : 4;
      g.strokeStyle = '#4E9A63';
      g.lineWidth = 0.9;
      g.fillStyle = '#E8475A';
      for (let t = 0; t < n; t++) {
        const cx = (ar() - 0.5) * 12;
        const cy = (ar() - 0.5) * 8;
        g.beginPath();
        g.moveTo(cx - 1.5, cy + 4.5);
        g.quadraticCurveTo(cx - 1, cy + 2, cx, cy);
        g.stroke();
        g.beginPath();
        dot(g, cx, cy, 2);
        g.fill();
        g.fillStyle = '#2B2140';
        g.beginPath();
        dot(g, cx, cy, 0.6);
        g.fill();
        g.fillStyle = '#E8475A';
      }
      break;
    }
    case 3: {
      // Pebble trio, each with a lighter crescent on top.
      for (let t = 0; t < 3; t++) {
        const cx = (t - 1) * 4.5 + (ar() - 0.5) * 2;
        const cy = (ar() - 0.5) * 5;
        const rx = 1.8 + ar() * 1.4;
        const ry = rx * 0.75;
        g.fillStyle = 'rgba(60,40,30,0.18)';
        g.beginPath();
        g.ellipse(cx + 0.5, cy + 0.7, rx, ry, 0, 0, TAU);
        g.fill();
        g.fillStyle = '#C9C3B5';
        g.beginPath();
        g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
        g.fill();
        g.fillStyle = '#E8E4DA';
        g.beginPath();
        g.ellipse(cx - 0.3, cy - ry * 0.35, rx * 0.65, ry * 0.4, 0, 0, TAU);
        g.fill();
      }
      break;
    }
    case 4: {
      // A pair of mushrooms: cream caps with red-brown spots.
      const caps = [
        [-2.5, 1, 3.6],
        [3.2, -1.5, 2.6],
      ] as const;
      for (const [cx, cy, r] of caps) {
        g.fillStyle = 'rgba(60,40,30,0.18)';
        g.beginPath();
        dot(g, cx + 0.6, cy + 0.8, r);
        g.fill();
        g.fillStyle = '#F2E6D0';
        g.beginPath();
        dot(g, cx, cy, r);
        g.fill();
        g.fillStyle = '#D9644A';
        g.beginPath();
        dot(g, cx - r * 0.35, cy - r * 0.2, r * 0.22);
        dot(g, cx + r * 0.3, cy + r * 0.25, r * 0.18);
        dot(g, cx + r * 0.25, cy - r * 0.4, r * 0.14);
        g.fill();
      }
      break;
    }
    default: {
      // Leaf litter: a few almond leaves with a midrib.
      const n = i & 1 ? 3 : 4;
      for (let t = 0; t < n; t++) {
        const cx = (ar() - 0.5) * 12;
        const cy = (ar() - 0.5) * 10;
        g.save();
        g.translate(cx, cy);
        g.rotate(ar() * TAU);
        g.fillStyle = t % 2 ? '#D9A564' : '#C98A4B';
        g.beginPath();
        g.moveTo(-3, 0);
        g.quadraticCurveTo(0, -2.2, 3, 0);
        g.quadraticCurveTo(0, 2.2, -3, 0);
        g.fill();
        g.strokeStyle = 'rgba(120,70,30,0.5)';
        g.lineWidth = 0.4;
        g.beginPath();
        g.moveTo(-2.6, 0);
        g.lineTo(2.6, 0);
        g.stroke();
        g.restore();
      }
      break;
    }
  }
}

function townDecal(g: CanvasRenderingContext2D, i: number): void {
  art = 211 + i * 104729;
  if (i <= 2) {
    // A terracotta flower pot seen from above: a thin rim with a leafy plant spilling over it (and
    // flowers on two of them).
    g.fillStyle = 'rgba(60,30,20,0.22)';
    g.beginPath();
    dot(g, 0.8, 1, 5.4);
    g.fill();
    g.fillStyle = '#D9644A';
    g.beginPath();
    dot(g, 0, 0, 5);
    g.fill();
    g.fillStyle = '#8E4A33';
    g.beginPath();
    dot(g, 0, 0, 3.9);
    g.fill();
    for (let l = 0; l < 7; l++) {
      const a = (l * TAU) / 7 + i * 0.7;
      g.fillStyle = l % 2 ? '#4E9A63' : '#6DBE7B';
      g.save();
      g.rotate(a);
      g.beginPath();
      g.ellipse(3.3, 0, 3.4, 1.7, 0, 0, TAU);
      g.fill();
      g.restore();
    }
    if (i > 0) {
      g.fillStyle = i === 1 ? '#FFD36B' : '#FF8FA3';
      g.beginPath();
      dot(g, -1.6, -1.2, 1.3);
      dot(g, 1.8, 0.4, 1.3);
      dot(g, -0.2, 2, 1.2);
      g.fill();
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      dot(g, -1.6, -1.2, 0.45);
      dot(g, 1.8, 0.4, 0.45);
      dot(g, -0.2, 2, 0.45);
      g.fill();
    }
    return;
  }
  if (i <= 4) {
    // A manhole cover: a ring with a grid (or bars) inside.
    g.strokeStyle = 'rgba(156,143,128,0.6)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(0, 0, 8, 0, TAU);
    g.stroke();
    g.fillStyle = 'rgba(156,143,128,0.22)';
    g.beginPath();
    dot(g, 0, 0, 7.3);
    g.fill();
    g.lineWidth = 0.7;
    g.beginPath();
    for (let k = -2; k <= 2; k++) {
      const o = k * 2.6;
      const h = Math.sqrt(Math.max(0, 49 - o * o));
      g.moveTo(o, -h);
      g.lineTo(o, h);
      if (i === 3) {
        g.moveTo(-h, o);
        g.lineTo(h, o);
      }
    }
    g.stroke();
    return;
  }
  if (i <= 6) {
    // Chalk hopscotch: 1-2-1-2 boxes (and a number scribble).
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 0.9;
    const s = 5.2;
    const rows = i === 5 ? [1, 2, 1, 2] : [1, 1, 2, 1];
    g.save();
    g.rotate(i === 5 ? 0.12 : -0.2);
    g.beginPath();
    for (let r = 0; r < rows.length; r++) {
      const y = 10 - (r + 1) * s;
      const n = rows[r] as number;
      for (let k = 0; k < n; k++) g.rect(-(n * s) / 2 + k * s, y, s, s);
    }
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    dot(g, 0, -12.5, 1.6);
    g.fill();
    g.restore();
    return;
  }
  if (i <= 9) {
    // Cracks in the paving: a jagged line with a branch or two.
    g.strokeStyle = 'rgba(110,90,72,0.25)';
    g.lineWidth = 0.8;
    g.beginPath();
    let x = -11;
    let y = (ar() - 0.5) * 6;
    g.moveTo(x, y);
    while (x < 8) {
      x += 2 + ar() * 2.5;
      y += (ar() - 0.5) * 4;
      g.lineTo(x, y);
      if (ar() < 0.25) {
        g.lineTo(x + 2 + ar() * 2, y + (ar() < 0.5 ? -3 : 3));
        g.moveTo(x, y);
      }
    }
    g.stroke();
    return;
  }
  // A sleeping cat curled up: ginger with darker stripes, the tail wrapped round.
  const ginger = i === 10;
  const body = ginger ? '#E8A15A' : '#B8B0C8';
  const dark = ginger ? '#C27A3A' : '#8E86A3';
  g.fillStyle = 'rgba(60,30,20,0.2)';
  g.beginPath();
  g.ellipse(0.8, 1.2, 7, 6, 0, 0, TAU);
  g.fill();
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(0, 0, 6.5, 5.6, 0, 0, TAU);
  g.fill();
  g.strokeStyle = dark;
  g.lineWidth = 0.9;
  g.beginPath();
  g.arc(0, 0, 3.8, -0.4, 1.8);
  g.moveTo(-4.6, -2);
  g.lineTo(-2.6, -0.8);
  g.moveTo(-5.2, 0.6);
  g.lineTo(-3.2, 1);
  g.stroke();
  // Head tucked in at the front, ears up.
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(3.6, 2.6, 3, 2.6, 0, 0, TAU);
  g.moveTo(2, 0.6);
  g.lineTo(2.4, -1.5);
  g.lineTo(3.6, 0.2);
  g.moveTo(4.4, 0.3);
  g.lineTo(5.6, -1.3);
  g.lineTo(5.9, 1);
  g.fill();
  g.strokeStyle = '#2B2140';
  g.lineWidth = 0.5;
  g.beginPath();
  g.moveTo(2.6, 2.7);
  g.quadraticCurveTo(3.1, 3.2, 3.6, 2.7);
  g.moveTo(4.3, 2.7);
  g.quadraticCurveTo(4.8, 3.2, 5.3, 2.7);
  g.stroke();
  // Tail round the front.
  g.strokeStyle = body;
  g.lineWidth = 1.8;
  g.beginPath();
  g.arc(0, 0, 6.6, 0.9, 2.4);
  g.stroke();
}

function puddle(g: CanvasRenderingContext2D): void {
  g.fillStyle = 'rgba(154,216,255,0.55)';
  g.beginPath();
  g.ellipse(0, 0, 5, 3, 0, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 0.7;
  g.beginPath();
  g.ellipse(-0.8, -0.6, 2.6, 1.3, 0, Math.PI * 1.1, Math.PI * 1.65);
  g.stroke();
}

function frostRim(g: CanvasRenderingContext2D): void {
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(0, 0, 5, 3, 0, 0, TAU);
  g.stroke();
  g.fillStyle = 'rgba(234,246,255,0.35)';
  g.beginPath();
  g.ellipse(0, 0, 4.5, 2.6, 0, 0, TAU);
  g.fill();
}

function lampPost(g: CanvasRenderingContext2D): void {
  // A lamp post from above: a warm pool of light, the lamp's dark cap and its glass.
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, 11);
  glow.addColorStop(0, 'rgba(255,231,168,0.45)');
  glow.addColorStop(1, 'rgba(255,231,168,0)');
  g.fillStyle = glow;
  g.beginPath();
  dot(g, 0, 0, 11);
  g.fill();
  g.fillStyle = 'rgba(43,33,64,0.2)';
  g.beginPath();
  dot(g, 1.2, 1.2, 4.6);
  g.fill();
  g.fillStyle = '#4A4560';
  g.beginPath();
  dot(g, 0, 0, 4.4);
  g.fill();
  g.fillStyle = '#FFE7A8';
  g.beginPath();
  dot(g, 0, 0, 2.6);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  dot(g, -0.8, -0.8, 0.9);
  g.fill();
}

function signpost(g: CanvasRenderingContext2D, text: string): void {
  // The plank (seen from above, lying flat) and its post.
  g.fillStyle = 'rgba(43,33,64,0.2)';
  roundRect(g, -25, -5, 52, 13, 3);
  g.fill();
  g.fillStyle = '#C98A5B';
  roundRect(g, -26, -6.5, 52, 12, 3);
  g.fill();
  g.strokeStyle = '#8A5A3C';
  g.lineWidth = 1;
  roundRect(g, -25.5, -6, 51, 11, 2.6);
  g.stroke();
  g.fillStyle = '#3B2A20';
  g.font = '800 7px system-ui, -apple-system, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 0, 0, 46);
  g.fillStyle = '#8A5A3C';
  g.beginPath();
  dot(g, -22, 9, 2);
  g.fill();
}
