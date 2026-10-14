// v1.5 Sunflower buds and sunflowers (docs/V1_5_PLAN.md §2A). A closed bud stands beside the trail
// with a gold "light from here" mark on the ground on its sun side: a fan of light over its
// ±faceTol° arc with a little sun in it, brightening and pulsing while the sun shines from inside
// the arc, and a ring around its base that fills gold as it grows. A bloomed bud is the core's
// caster of kind 'sunflower' (a thin stem prism and a big disc head): a stem with two leaves and a
// head drawn as a disc facing the sun (its face, or its green back when the sun is behind it), that
// pops up out of the bud when it blooms (registerBloom). Nothing here allocates per frame.

import { TUNING, type Bud, type Caster, type DiscPart, type Part, type PrismPart } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import type { Light } from './casters.ts';
import { css, cssa, hex, mix } from './color.ts';
import { tint } from './palette.ts';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const GOLD = hex('#FFC23D');
const GOLD_DEEP = hex('#E08A00');
const LEAF = hex('#5FAE5A');
const LEAF_DARK = hex('#3F8A45');
const PETAL = hex('#FFC93C');
const PETAL_SHADE = hex('#F2A516');
const SEEDS = hex('#6A4224');
const BACK = hex('#5E8F3E');

/** The mark's radius from the bud and the growth ring's (u); the plant is drawn BUD_K× life size. */
const MARK_R = 24;
const RING_R = 11;
const BUD_K = 1.8;
/** The head's z is lifted HEAD_K for its tilt and the stem STEM_LIFT (the world's 0.25 flattens both). */
const HEAD_K = 0.62;
const STEM_LIFT = 0.42;
/** The bloom pop (s): the flower shoots up with an overshoot and its petals unfold. */
const POP_S = 0.55;

/** Recent blooms (x, y, start time), matched to their sunflower casters by position. */
const BLOOMS = 8;
const blooms = new Float64Array(BLOOMS * 3).fill(-1e9);
let bloomHead = 0;

/** A bud bloomed at (x, y) at render time `t` (s): its sunflower pops up from there. */
export function registerBloom(x: number, y: number, t: number): void {
  blooms[bloomHead * 3] = x;
  blooms[bloomHead * 3 + 1] = y;
  blooms[bloomHead * 3 + 2] = t;
  bloomHead = (bloomHead + 1) % BLOOMS;
}

/** Forgets every bloom pop (a new run). */
export function resetBlooms(): void {
  blooms.fill(-1e9);
}

/** Seconds since the bloom at (x, y), or a long time when none is known. */
function bloomAge(x: number, y: number, t: number): number {
  for (let i = 0; i < BLOOMS * 3; i += 3) {
    if (Math.abs((blooms[i] as number) - x) + Math.abs((blooms[i + 1] as number) - y) < 3) return t - (blooms[i + 2] as number);
  }
  return 1e9;
}

/** A leaf from (x, y) out to one side (dir ±1), `len` long and `w` wide. */
function leaf(g: CanvasRenderingContext2D, x: number, y: number, dir: number, len: number, w: number): void {
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + dir * len * 0.5, y - w * 1.6, x + dir * len, y - w * 0.6);
  g.quadraticCurveTo(x + dir * len * 0.5, y + w * 0.4, x, y);
  g.fill();
}

/**
 * A closed bud (drawn with the ground: it is short): the fan of light and the gold arc with its
 * little sun on the ground, the growth ring, then the plant: two leaves, a short stem and the bulb,
 * swelling as it grows, its petal tip going gold, glowing while light reaches it.
 */
export function drawBud(g: CanvasRenderingContext2D, v: View, L: Light, b: Bud, night: number): void {
  const S = v.S;
  const P = S * BUD_K;
  const x = v.ox + b.x * S;
  const y = v.oy - b.y * S;
  const grow = Math.max(0, Math.min(1, b.grow));
  const tol = TUNING.buds.faceTol;
  const off = Math.abs(((((L.theta - b.face) % 360) + 540) % 360) - 180);
  const aim = L.sunUp && off <= tol ? 1 - off / (tol + 1) : 0;
  const dim = 1 - 0.55 * night;
  const k = dim * (aim > 0 ? 0.8 + 0.2 * Math.sin(L.time * 19) : 0.6);
  const a = -b.face * DEG;
  const t = tol * DEG;
  const R = MARK_R * S;
  g.fillStyle = cssa(GOLD, 0.12 + 0.18 * aim);
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, y, R, a - t, a + t);
  g.fill();
  g.lineCap = 'round';
  g.strokeStyle = cssa(GOLD_DEEP, k);
  g.lineWidth = Math.max(1.4, 2 * S);
  g.beginPath();
  g.arc(x, y, R, a - t, a + t);
  g.stroke();
  g.fillStyle = cssa(GOLD, k + 0.2);
  g.beginPath();
  g.arc(x + Math.cos(a) * R, y + Math.sin(a) * R, (3.4 + 1.2 * aim) * S, 0, TAU);
  g.fill();
  // The growth ring: a faint track, gold filling clockwise from the top.
  g.lineWidth = Math.max(2, 3 * S);
  g.strokeStyle = cssa(0x2b2140, 0.18);
  g.beginPath();
  g.arc(x, y, RING_R * S, 0, TAU);
  g.stroke();
  // Strokes are the frame's scarcest call (render.spec budget): the gold only once it grows.
  if (grow > 0) {
    g.strokeStyle = css(GOLD);
    g.beginPath();
    g.arc(x, y, RING_R * S, -Math.PI / 2, -Math.PI / 2 + TAU * grow);
    g.stroke();
  }
  g.lineCap = 'butt';
  // The plant.
  const pal = L.pal;
  g.fillStyle = css(tint(pal, LEAF_DARK));
  g.strokeStyle = g.fillStyle;
  leaf(g, x, y - P, -1, 5.2 * P, 2.2 * P);
  g.lineWidth = Math.max(1, 1.2 * P);
  g.fillStyle = css(tint(pal, LEAF));
  leaf(g, x, y - P, 1, 5.2 * P, 2.2 * P);
  const top = y - (6.5 + 1.5 * grow) * P;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, top);
  g.stroke();
  const br = (2.6 + 0.9 * grow) * P;
  const by = top - br * 0.4;
  g.fillStyle = cssa(GOLD, (0.15 + 0.35 * Math.max(aim, grow)) * dim);
  g.beginPath();
  g.arc(x, by, br * 2.1, 0, TAU);
  g.fill();
  g.fillStyle = css(tint(pal, mix(LEAF, LEAF_DARK, 0.25)));
  g.beginPath();
  g.ellipse(x, by, br * 0.9, br * 1.25, 0, 0, TAU);
  g.fill();
  g.fillStyle = css(tint(pal, mix(PETAL_SHADE, PETAL, grow)));
  g.beginPath();
  g.moveTo(x - br * 0.45, top - br * 1.25);
  g.lineTo(x, top - br * (1.85 + 0.4 * grow));
  g.lineTo(x + br * 0.45, top - br * 1.25);
  g.fill();
}

/**
 * A sunflower caster (core kind 'sunflower': a stem prism and a disc head at height z): a stem
 * with two leaves, and the head as a disc whose normal points at the sun (azimuth θ, raised with
 * its elevation): petals and seeds when it faces us, its green back otherwise. A fresh bloom pops
 * up out of the bud. Missing parts fall back to the caster's bounds.
 */
export function drawSunflower(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster): void {
  let stem: PrismPart | null = null;
  let head: DiscPart | null = null;
  for (const p of c.parts as readonly Part[]) {
    if (p.t === 'prism') stem ??= p;
    else if (p.t === 'disc') head ??= p;
  }
  // The pop: height 0 → 1.18 → 1 and the petals unfolding over POP_S.
  const u = Math.max(0, bloomAge(c.x, c.y, L.time) / POP_S);
  const k = u >= 1 ? 1 : u < 0.55 ? 0.05 + 2 * u : 1.18 - 0.4 * (u - 0.55);
  const unfold = Math.min(1, Math.max(0, (u - 0.35) / 0.65));
  const S = v.S;
  const pal = L.pal;
  const gx = v.ox + c.x * S;
  const gy = v.oy - c.y * S;
  const hx = v.ox + (head ? head.cx : c.x) * S;
  const top = v.oy - ((head ? head.cy : c.y) + STEM_LIFT * (head ? head.z : c.maxZ) * k) * S;
  g.strokeStyle = css(tint(pal, LEAF_DARK));
  g.lineCap = 'round';
  g.lineWidth = (stem ? Math.max(1.4, Math.min(4, stem.maxX - stem.minX)) : 2.4) * S;
  g.beginPath();
  g.moveTo(gx, gy);
  g.quadraticCurveTo(gx + 1.5 * S, (gy + top) / 2, hx, top);
  g.stroke();
  g.lineCap = 'butt';
  const ly = gy + (top - gy) * 0.45;
  g.fillStyle = g.strokeStyle;
  leaf(g, gx, ly, -1, 9 * S * k, 3.4 * S * k);
  g.fillStyle = css(tint(pal, LEAF));
  leaf(g, gx + S, ly + 3 * S, 1, 8 * S * k, 3 * S * k);

  // The head: in-plane axes a1 = (−uy, ux, 0) and a2 = n × a1 = (−sh·ux, −sh·uy, ch) onto the screen
  // as (x, −(y + K·z)); it faces us when n has a positive share along the view ray (0, −K, 1).
  const e = (8 + 52 * L.elev) * DEG;
  const ch = L.sunUp ? Math.cos(e) : 0.6;
  const sh = L.sunUp ? Math.sin(e) : 0.8;
  // The petals' tips sit at 1.72 head units (m + len/2 unfolded): scaled so the open flower is a
  // little wider than the head disc that casts its shadow (the full 1.72 swamped Nubs).
  const r = ((head ? head.r : Math.max(6, (c.maxX - c.minX) / 2)) / 1.35) * S * (0.25 + 0.75 * Math.min(1, k)) * v.dpr;
  const facing = sh - HEAD_K * L.uy * ch >= 0;
  g.setTransform(-L.uy * r, -L.ux * r, -sh * L.ux * r, (sh * L.uy - HEAD_K * ch) * r, hx * v.dpr, top * v.dpr);
  const len = 0.55 + 0.75 * unfold;
  const m = 0.42 + len * 0.5;
  g.fillStyle = css(tint(pal, facing ? PETAL : PETAL_SHADE));
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12;
    g.moveTo(Math.cos(a) * (m + len * 0.5), Math.sin(a) * (m + len * 0.5));
    g.ellipse(Math.cos(a) * m, Math.sin(a) * m, len * 0.5, 0.25, a, 0, TAU);
  }
  g.fill();
  g.fillStyle = css(tint(pal, facing ? SEEDS : BACK));
  g.beginPath();
  g.arc(0, 0, 0.5, 0, TAU);
  g.fill();
  g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
}
