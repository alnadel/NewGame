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

import { biomeAtY, queryCasters, smoothstep, trailSlope, trailX, validatedY, worldDayAtY, worldPlan, type Caster, type SimState, type World } from '../core/index.ts';
import { pointLitWeight } from '../core/sim/pickups.ts';
import { OBLIQUE, type View } from '../game/camera.ts';
import { artOps, drawArt } from './glyphs.ts';
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
    if (i === LAMP) lampPost(g);
    else drawArt(g, artOps(i === PUDDLE ? PUDDLE_ART : i === FROST_RIM ? FROST_ART : (DECAL_ART[b]?.[i] as string)));
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

/**
 * The decal art (glyphs.ts path ops, drawn at the cell centre in u): Meadow's clover, daisies,
 * poppies, pebbles, mushrooms and leaf litter, and Old Town's flower pots, manhole covers, chalk
 * hopscotch, paving cracks and the sleeping cats, two or three variants each; then the puddle and
 * its frost rim.
 */
const DECAL_ART: readonly (readonly string[])[] = [
  [
  'Frgba(127,191,106,0.5) O0.15-0.83 2.1O-2.81 1.57 2.1O-3.41-2.19 2.1O0.55 3.28 2.1O-3.01 1.94 2.1O-0.07-0.48 2.1O5.08-4.05 2.1O3.8-0.46 2.1O1.33-3.37 2.1',
  'Frgba(127,191,106,0.5) O0.46 3.77 2.1O3.59 1.6 2.1O0.15-0.03 2.1O-0.17 1.74 2.1O1.46-1.7 2.1O-2.34-1.39 2.1',
  'F#FFFFFF O-1.98-2.89 1.5O-2.16-4.76 1.5O-0.43-5.52 1.5O0.81-4.11 1.5O-0.14-2.49 1.5|F#FFD36B O-0.78-3.95 1|F#FFFFFF O0.34-1.43 1.5O0.17-3.3 1.5O1.9-4.04 1.5O3.14-2.63 1.5O2.18-1.01 1.5|F#FFD36B O1.55-2.48 1|F#FFFFFF O2.68-3.17 1.5O2.46-1.3 1.5O0.62-0.93 1.5O-0.3-2.57 1.5O0.97-3.95 1.5|F#FFD36B O1.29-2.38 1',
  'F#FFFFFF O1.51-2.54 1.5O-0.23-3.24 1.5O-1.44-1.79 1.5O-0.43-0.2 1.5O1.39-0.66 1.5|F#FFD36B O0.16-1.69 1|F#FFFFFF O-1.14 3.41 1.5O-2.32 1.94 1.5O-4.08 2.61 1.5O-3.99 4.49 1.5O-2.17 4.98 1.5|F#FFD36B O-2.74 3.49 1',
  'S#4E9A63/0.9 M-0.88 5.08Q-0.38 2.58 0.62 0.58|F#E8475A O0.62 0.58 2|F#2B2140 O0.62 0.58 0.6|S#4E9A63/0.9 M2.03 8Q2.53 5.5 3.53 3.5|F#E8475A O3.53 3.5 2|F#2B2140 O3.53 3.5 0.6|S#4E9A63/0.9 M0.69 5.54Q1.19 3.04 2.19 1.04|F#E8475A O2.19 1.04 2|F#2B2140 O2.19 1.04 0.6|S#4E9A63/0.9 M-2.61 2.36Q-2.11-0.14-1.11-2.14|F#E8475A O-1.11-2.14 2|F#2B2140 O-1.11-2.14 0.6',
  'S#4E9A63/0.9 M0.06 7.34Q-0.44 4.84-1.44 2.84|F#E8475A O-1.44 2.84 2|F#2B2140 O-1.44 2.84 0.6|S#4E9A63/0.9 M-4.49 1.06Q-4.99-1.44-5.99-3.44|F#E8475A O-5.99-3.44 2|F#2B2140 O-5.99-3.44 0.6|S#4E9A63/0.9 M2.36 6.52Q1.86 4.02 0.86 2.02|F#E8475A O0.86 2.02 2|F#2B2140 O0.86 2.02 0.6',
  'Frgba(60,40,30,0.18) M-1.54-1.11A2.09 1.56 0 0 1-5.71-1.11A2.09 1.56 0 0 1-1.54-1.11|F#C9C3B5 M-2.04-1.81A2.09 1.56 0 0 1-6.21-1.81A2.09 1.56 0 0 1-2.04-1.81|F#E8E4DA M-3.07-2.36A1.36 0.63 0 0 1-5.78-2.36A1.36 0.63 0 0 1-3.07-2.36|Frgba(60,40,30,0.18) M2.93-0.93A3.02 2.27 0 0 1-3.12-0.93A3.02 2.27 0 0 1 2.93-0.93|F#C9C3B5 M2.43-1.63A3.02 2.27 0 0 1-3.62-1.63A3.02 2.27 0 0 1 2.43-1.63|F#E8E4DA M1.07-2.42A1.97 0.91 0 0 1-2.86-2.42A1.97 0.91 0 0 1 1.07-2.42|Frgba(60,40,30,0.18) M7.51-0.48A3.17 2.38 0 0 1 1.17-0.48A3.17 2.38 0 0 1 7.51-0.48|F#C9C3B5 M7.01-1.18A3.17 2.38 0 0 1 0.67-1.18A3.17 2.38 0 0 1 7.01-1.18|F#E8E4DA M5.6-2.02A2.06 0.95 0 0 1 1.48-2.02A2.06 0.95 0 0 1 5.6-2.02',
  'Frgba(60,40,30,0.18) M1.11 0.31A2.37 1.78 180 0 0 5.86 0.31A2.37 1.78 180 0 0 1.11 0.31|F#C9C3B5 M1.61-0.39A2.37 1.78 180 0 0 6.36-0.39A2.37 1.78 180 0 0 1.61-0.39|F#E8E4DA M2.74-1.02A1.54 0.71 180 0 0 5.83-1.02A1.54 0.71 180 0 0 2.74-1.02|Frgba(60,40,30,0.18) M-3.37 2.81A3.2 2.4 180 0 0 3.03 2.81A3.2 2.4 180 0 0-3.37 2.81|F#C9C3B5 M-2.87 2.11A3.2 2.4 180 0 0 3.53 2.11A3.2 2.4 180 0 0-2.87 2.11|F#E8E4DA M-1.45 1.27A2.08 0.96 180 0 0 2.71 1.27A2.08 0.96 180 0 0-1.45 1.27|Frgba(60,40,30,0.18) M-7.6-0.41A2.49 1.87 180 0 0-2.62-0.41A2.49 1.87 180 0 0-7.6-0.41|F#C9C3B5 M-7.1-1.11A2.49 1.87 180 0 0-2.12-1.11A2.49 1.87 180 0 0-7.1-1.11|F#E8E4DA M-5.93-1.76A1.62 0.75 180 0 0-2.69-1.76A1.62 0.75 180 0 0-5.93-1.76',
  'Frgba(60,40,30,0.18) O-1.9 1.8 3.6|F#F2E6D0 O-2.5 1 3.6|F#D9644A O-3.76 0.28 0.79O-1.42 1.9 0.65O-1.6-0.44 0.5|Frgba(60,40,30,0.18) O3.8-0.7 2.6|F#F2E6D0 O3.2-1.5 2.6|F#D9644A O2.29-2.02 0.57O3.98-0.85 0.47O3.85-2.54 0.36',
  'Frgba(60,40,30,0.18) O1.9 1.8 3.6|F#F2E6D0 O2.5 1 3.6|F#D9644A O3.76 0.28 0.79O1.42 1.9 0.65O1.6-0.44 0.5|Frgba(60,40,30,0.18) O-3.8-0.7 2.6|F#F2E6D0 O-3.2-1.5 2.6|F#D9644A O-2.29-2.02 0.57O-3.98-0.85 0.47O-3.85-2.54 0.36',
  'F#C98A4B M2.62-2.73Q5.9-4.47 8.55-1.86Q5.27-0.12 2.62-2.73|Srgba(120,70,30,0.5)/0.4 M3.01-2.67L8.16-1.91|F#D9A564 M4.76-5.66Q4.45-1.95 0.82-1.14Q1.13-4.85 4.76-5.66|Srgba(120,70,30,0.5)/0.4 M4.5-5.36L1.08-1.44|F#C98A4B M-0.5-2.49Q2.95-3.89 5.32-1.02Q1.87 0.38-0.5-2.49|Srgba(120,70,30,0.5)/0.4 M-0.11-2.39L4.93-1.12|F#D9A564 M1.47-6.14Q4.75-4.37 4.05-0.72Q0.78-2.48 1.47-6.14|Srgba(120,70,30,0.5)/0.4 M1.65-5.78L3.88-1.08',
  'F#C98A4B M6-2.43Q3.41 0.24 5.17 3.51Q7.76 0.84 6-2.43|Srgba(120,70,30,0.5)/0.4 M5.94-2.04L5.23 3.11|F#D9A564 M-7.37 3.81Q-4.57 6.26-1.39 4.32Q-4.2 1.87-7.37 3.81|Srgba(120,70,30,0.5)/0.4 M-6.97 3.84L-1.79 4.28|F#C98A4B M2.17-0.59Q5.74 0.47 7.83-2.61Q4.26-3.67 2.17-0.59|Srgba(120,70,30,0.5)/0.4 M2.55-0.73L7.45-2.48',
  ],
  [
  'Frgba(60,30,20,0.22) O0.8 1 5.4|F#D9644A O0 0 5|F#8E4A33 O0 0 3.9|F#6DBE7B M6.7 0A3.4 1.7 0 0 1-0.1 0A3.4 1.7 0 0 1 6.7 0|F#4E9A63 M4.18 5.24A3.4 1.7 51.43 0 1-0.06-0.08A3.4 1.7 51.43 0 1 4.18 5.24|F#6DBE7B M-1.49 6.53A3.4 1.7 102.86 0 1 0.02-0.1A3.4 1.7 102.86 0 1-1.49 6.53|F#4E9A63 M-6.04 2.91A3.4 1.7 154.29 0 1 0.09-0.04A3.4 1.7 154.29 0 1-6.04 2.91|F#6DBE7B M-6.04-2.91A3.4 1.7-154.29 0 1 0.09 0.04A3.4 1.7-154.29 0 1-6.04-2.91|F#4E9A63 M-1.49-6.53A3.4 1.7-102.86 0 1 0.02 0.1A3.4 1.7-102.86 0 1-1.49-6.53|F#6DBE7B M4.18-5.24A3.4 1.7-51.43 0 1-0.06 0.08A3.4 1.7-51.43 0 1 4.18-5.24',
  'Frgba(60,30,20,0.22) O0.8 1 5.4|F#D9644A O0 0 5|F#8E4A33 O0 0 3.9|F#6DBE7B M5.12 4.32A3.4 1.7 40.11 0 1-0.08-0.06A3.4 1.7 40.11 0 1 5.12 4.32|F#4E9A63 M-0.18 6.7A3.4 1.7 91.54 0 1 0-0.1A3.4 1.7 91.54 0 1-0.18 6.7|F#6DBE7B M-5.35 4.04A3.4 1.7 142.96 0 1 0.08-0.06A3.4 1.7 142.96 0 1-5.35 4.04|F#4E9A63 M-6.49-1.67A3.4 1.7-165.61 0 1 0.1 0.02A3.4 1.7-165.61 0 1-6.49-1.67|F#6DBE7B M-2.74-6.11A3.4 1.7-114.18 0 1 0.04 0.09A3.4 1.7-114.18 0 1-2.74-6.11|F#4E9A63 M3.07-5.96A3.4 1.7-62.75 0 1-0.05 0.09A3.4 1.7-62.75 0 1 3.07-5.96|F#6DBE7B M6.57-1.32A3.4 1.7-11.32 0 1-0.1 0.02A3.4 1.7-11.32 0 1 6.57-1.32|F#FFD36B O-1.6-1.2 1.3O1.8 0.4 1.3O-0.2 2 1.2|F#FFFFFF O-1.6-1.2 0.45O1.8 0.4 0.45O-0.2 2 0.45',
  'Frgba(60,30,20,0.22) O0.8 1 5.4|F#D9644A O0 0 5|F#8E4A33 O0 0 3.9|F#6DBE7B M1.14 6.6A3.4 1.7 80.21 0 1-0.02-0.1A3.4 1.7 80.21 0 1 1.14 6.6|F#4E9A63 M-4.45 5.01A3.4 1.7 131.64 0 1 0.07-0.07A3.4 1.7 131.64 0 1-4.45 5.01|F#6DBE7B M-6.69-0.36A3.4 1.7-176.93 0 1 0.1 0.01A3.4 1.7-176.93 0 1-6.69-0.36|F#4E9A63 M-3.89-5.45A3.4 1.7-125.5 0 1 0.06 0.08A3.4 1.7-125.5 0 1-3.89-5.45|F#6DBE7B M1.84-6.44A3.4 1.7-74.07 0 1-0.03 0.1A3.4 1.7-74.07 0 1 1.84-6.44|F#4E9A63 M6.18-2.58A3.4 1.7-22.64 0 1-0.09 0.04A3.4 1.7-22.64 0 1 6.18-2.58|F#6DBE7B M5.87 3.23A3.4 1.7 28.79 0 1-0.09-0.05A3.4 1.7 28.79 0 1 5.87 3.23|F#FF8FA3 O-1.6-1.2 1.3O1.8 0.4 1.3O-0.2 2 1.2|F#FFFFFF O-1.6-1.2 0.45O1.8 0.4 0.45O-0.2 2 0.45',
  'Srgba(156,143,128,0.6)/1.4 O0 0 8|Frgba(156,143,128,0.22) O0 0 7.3|Srgba(156,143,128,0.6)/0.7 M-5.2-4.69L-5.2 4.69M-4.69-5.2L4.69-5.2M-2.6-6.5L-2.6 6.5M-6.5-2.6L6.5-2.6M0-7L0 7M-7 0L7 0M2.6-6.5L2.6 6.5M-6.5 2.6L6.5 2.6M5.2-4.69L5.2 4.69M-4.69 5.2L4.69 5.2',
  'Srgba(156,143,128,0.6)/1.4 O0 0 8|Frgba(156,143,128,0.22) O0 0 7.3|Srgba(156,143,128,0.6)/0.7 M-5.2-4.69L-5.2 4.69M-2.6-6.5L-2.6 6.5M0-7L0 7M2.6-6.5L2.6 6.5M5.2-4.69L5.2 4.69',
  'Srgba(255,255,255,0.35)/0.9 M-3.16 4.45L2.01 5.08L1.38 10.24L-3.78 9.62ZM-5.11-1.02L0.05-0.4L-0.57 4.77L-5.74 4.14ZM0.05-0.4L5.21 0.23L4.59 5.39L-0.57 4.77ZM-1.91-5.87L3.25-5.25L2.63-0.09L-2.53-0.71ZM-3.87-11.34L1.29-10.72L0.67-5.56L-4.49-6.18ZM1.29-10.72L6.46-10.1L5.83-4.94L0.67-5.56Z|Frgba(255,255,255,0.35) O1.5-12.41 1.6',
  'Srgba(255,255,255,0.35)/0.9 M-1.59 5.22L3.5 4.19L4.53 9.28L-0.56 10.32ZM-2.63 0.12L2.47-0.91L3.5 4.19L-1.59 5.22ZM-6.21-4.46L-1.11-5.49L-0.08-0.39L-5.18 0.64ZM-1.11-5.49L3.98-6.52L5.02-1.43L-0.08-0.39ZM-4.69-10.07L0.4-11.1L1.44-6L-3.66-4.97Z|Frgba(255,255,255,0.35) O-2.48-12.25 1.6',
  'Srgba(110,90,72,0.25)/0.8 M-11-0.4L-7.45 1.53L-4.4 1.4L-1.32 1.15L1.1-0.49L3.28-1.86L7.37-0.21L10.29-1.07',
  'Srgba(110,90,72,0.25)/0.8 M-11-2.87L-6.66-1.69L-2.75-1.77L-0.21-1.12L2.79 0.02L7.25 0.34L10.55 1.65',
  'Srgba(110,90,72,0.25)/0.8 M-11 0.66L-8.38 1.09L-6.1 1.05L-4.1 2.62L-0.52 2.52L3.26-0.48M-0.52 2.52L1.59 1.37L4.14 2.11L8.16 0.17',
  'Frgba(60,30,20,0.2) M7.8 1.2A7 6 0 0 1-6.2 1.2A7 6 0 0 1 7.8 1.2|F#E8A15A M6.5 0A6.5 5.6 0 0 1-6.5 0A6.5 5.6 0 0 1 6.5 0|S#C27A3A/0.9 M3.5-1.48A3.8 3.8 0 0 1-0.86 3.7M-4.6-2L-2.6-0.8M-5.2 0.6L-3.2 1|F#E8A15A M6.6 2.6A3 2.6 0 0 1 0.6 2.6A3 2.6 0 0 1 6.6 2.6M2 0.6L2.4-1.5L3.6 0.2M4.4 0.3L5.6-1.3L5.9 1|S#2B2140/0.5 M2.6 2.7Q3.1 3.2 3.6 2.7M4.3 2.7Q4.8 3.2 5.3 2.7|S#E8A15A/1.8 M4.1 5.17A6.6 6.6 0 0 1-4.87 4.46',
  'Frgba(60,30,20,0.2) M7.8 1.2A7 6 0 0 1-6.2 1.2A7 6 0 0 1 7.8 1.2|F#B8B0C8 M6.5 0A6.5 5.6 0 0 1-6.5 0A6.5 5.6 0 0 1 6.5 0|S#8E86A3/0.9 M3.5-1.48A3.8 3.8 0 0 1-0.86 3.7M-4.6-2L-2.6-0.8M-5.2 0.6L-3.2 1|F#B8B0C8 M6.6 2.6A3 2.6 0 0 1 0.6 2.6A3 2.6 0 0 1 6.6 2.6M2 0.6L2.4-1.5L3.6 0.2M4.4 0.3L5.6-1.3L5.9 1|S#2B2140/0.5 M2.6 2.7Q3.1 3.2 3.6 2.7M4.3 2.7Q4.8 3.2 5.3 2.7|S#B8B0C8/1.8 M4.1 5.17A6.6 6.6 0 0 1-4.87 4.46',
  ],
];
const PUDDLE_ART = 'Frgba(154,216,255,0.55) M5 0A5 3 0 0 1-5 0A5 3 0 0 1 5 0|Srgba(255,255,255,0.85)/0.7 M-3.27-1A2.6 1.3 0 0 1 0.38-1.76';
const FROST_ART = 'Srgba(255,255,255,0.95)/1 M5 0A5 3 0 0 1-5 0A5 3 0 0 1 5 0|Frgba(234,246,255,0.35) M4.5 0A4.5 2.6 0 0 1-4.5 0A4.5 2.6 0 0 1 4.5 0';

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

// ---------------------------------------------------------------------------------------------
// Market days: bunting strung across the street every BUNTING_GAP u (render-only, no shadow).
// ---------------------------------------------------------------------------------------------

const BUNTING_GAP = 150;
/** Half the span across the street (u), the string's height (u) and its sag at the middle (u). */
const BUNTING_HALF = 66;
const BUNTING_Z = 30;
const BUNTING_SAG = 7;
const PENNANTS = 9;
const BUNTING_COLORS = ['#E8504A', '#FFC23D', '#2EC4B6', '#5A8FE0', '#F28DB2'] as const;

/**
 * Bunting over the street on Market days (the forecast's signature): strings of pennants every
 * 150 u, one path per colour for the whole view. `fade` scales it (night, the far zoom).
 */
export function drawBunting(g: CanvasRenderingContext2D, v: View, w: World, fade: number): void {
  if (fade <= 0.02 || !w.planOn) return;
  const S = v.S;
  const k0 = Math.floor((v.y0 - 40) / BUNTING_GAP);
  const k1 = Math.ceil((v.y1 + 80) / BUNTING_GAP);
  let any = false;
  for (let k = k0; k <= k1 && !any; k++) any = worldPlan(w, worldDayAtY(w, k * BUNTING_GAP)).forecast === 'market';
  if (!any) return;
  g.globalAlpha = fade;
  // Strings first (thin ink), then the pennants batched by colour.
  g.strokeStyle = 'rgba(43,33,64,0.55)';
  g.lineWidth = Math.max(0.8, 0.7 * S);
  g.beginPath();
  for (let k = k0; k <= k1; k++) {
    const y = k * BUNTING_GAP;
    if (worldPlan(w, worldDayAtY(w, y)).forecast !== 'market') continue;
    const cx = trailX(w.trail, y);
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const [sx, sy] = buntingPoint(v, cx, y, t);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
  }
  g.stroke();
  for (let c = 0; c < BUNTING_COLORS.length; c++) {
    g.fillStyle = BUNTING_COLORS[c] as string;
    g.beginPath();
    for (let k = k0; k <= k1; k++) {
      const y = k * BUNTING_GAP;
      if (worldPlan(w, worldDayAtY(w, y)).forecast !== 'market') continue;
      const cx = trailX(w.trail, y);
      for (let i = 0; i < PENNANTS; i++) {
        if ((i + k) % BUNTING_COLORS.length !== c) continue;
        const ta = (i + 0.15) / PENNANTS;
        const tb = (i + 0.85) / PENNANTS;
        const [ax, ay] = buntingPoint(v, cx, y, ta);
        const [bx, by] = buntingPoint(v, cx, y, tb);
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.lineTo((ax + bx) / 2, (ay + by) / 2 + 9 * S);
        g.closePath();
      }
    }
    g.fill();
  }
  g.globalAlpha = 1;
}

const bp: [number, number] = [0, 0];

/** Screen point at t ∈ [0, 1] along a string across the street at y (sagging, slightly skewed). */
function buntingPoint(v: View, cx: number, y: number, t: number): [number, number] {
  const x = cx - BUNTING_HALF + 2 * BUNTING_HALF * t;
  const wy = y + 8 * (t - 0.5);
  const z = BUNTING_Z - BUNTING_SAG * 4 * t * (1 - t);
  bp[0] = v.ox + x * v.S;
  bp[1] = v.oy - (wy + OBLIQUE * z) * v.S;
  return bp;
}
