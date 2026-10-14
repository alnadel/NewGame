// v1.5 Sunflower buds and sunflowers (docs/V1_5_PLAN.md §2A). A bud is a closed green bulb on a
// short stem beside the trail, with a gold "light from here" mark on the ground on its sun side: a
// ±faceTol° arc with a tiny sun in it. A ring around its base fills gold as it grows and the mark
// pulses while the sun shines from inside the arc. A bloomed bud is a core caster of kind
// 'sunflower' (a thin stem prism and a big disc head): a stem with two leaves and a head that turns
// to face the sun, drawn as a disc in 3D (its face, or its green back when the sun is behind it), that
// pops up out of the bud when it blooms (registerBloom).
//
// Nothing here allocates per frame.

import { TUNING, type Bud, type Caster, type DiscPart, type Part, type PrismPart } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import type { Light } from './casters.ts';
import { css, cssa, darken, hex, mix } from './color.ts';
import { tint } from './palette.ts';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const GOLD = hex('#FFC23D');
const GOLD_DEEP = hex('#E08A00');
const LEAF = hex('#5FAE5A');
const LEAF_DARK = hex('#3F8A45');
const STEM = hex('#4E9A4A');
const PETAL = hex('#FFC93C');
const PETAL_SHADE = hex('#F2A516');
const SEEDS = hex('#7A4E2A');
const SEEDS_DARK = hex('#5A361C');
const BACK = hex('#5E8F3E');
const INK = hex('#2B2140');

/** The "light from here" mark's radius from the bud (u), the growth ring's radius (u). */
const MARK_R = 24;
const RING_R = 11;
/** The bud plant's size (× u): drawn larger than life so it reads at a glance. */
const BUD_K = 1.8;
/** A sunflower's head is drawn with this vertical lift factor for z (the world's 0.25 flattens a vertical disc to a sliver). */
const HEAD_K = 0.62;
/** A sunflower's stem is drawn this much taller than the world's 0.25 lift, so it shows under the big head. */
const STEM_LIFT = 0.42;
/** The bloom pop (s): the stem shoots up with an overshoot, the petals unfold. */
const POP_S = 0.55;

/** Recent blooms (x, y, start time), matched to their sunflower casters by position. */
const BLOOMS = 16;
const bloomX = new Float64Array(BLOOMS);
const bloomY = new Float64Array(BLOOMS);
const bloomT = new Float64Array(BLOOMS).fill(-1e9);
let bloomHead = 0;

/** A bud bloomed at (x, y) at render time `t` (s): its sunflower pops up from there. */
export function registerBloom(x: number, y: number, t: number): void {
  bloomX[bloomHead] = x;
  bloomY[bloomHead] = y;
  bloomT[bloomHead] = t;
  bloomHead = (bloomHead + 1) % BLOOMS;
}

/** Forgets every bloom pop (a new run). */
export function resetBlooms(): void {
  bloomT.fill(-1e9);
}

/** Seconds since the bloom at (x, y), or Infinity when none is known. */
function bloomAge(x: number, y: number, t: number): number {
  for (let i = 0; i < BLOOMS; i++) {
    const dx = (bloomX[i] as number) - x;
    const dy = (bloomY[i] as number) - y;
    if (dx * dx + dy * dy < 9) return t - (bloomT[i] as number);
  }
  return Infinity;
}

/** The pop's height scale: 0 → 1.18 → 1 over POP_S. */
function popScale(age: number): number {
  if (age >= POP_S) return 1;
  if (age <= 0) return 0.05;
  const u = age / POP_S;
  return u < 0.55 ? 0.05 + (1.13 * u) / 0.55 : 1.18 - 0.18 * ((u - 0.55) / 0.45);
}

/** Signed degrees from a to b in (−180, 180]. */
function angleDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** A bud's frame values, shared by its two passes (budFrame). */
const bf = { x: 0, y: 0, aim: 0, near: false, grow: 0, pulse: 0, dim: 1 };

function budFrame(v: View, L: Light, b: Bud, night: number): void {
  bf.x = v.ox + b.x * v.S;
  bf.y = v.oy - b.y * v.S;
  const tol = TUNING.buds.faceTol;
  const off = Math.abs(angleDiff(b.face, L.theta));
  bf.aim = L.sunUp ? Math.max(0, 1 - off / tol) : 0;
  bf.near = L.sunUp && off <= tol;
  bf.grow = Math.max(0, Math.min(1, b.grow));
  bf.pulse = 0.5 + 0.5 * Math.sin(L.time * TAU * (bf.near ? 3 : 1.2));
  bf.dim = 1 - 0.55 * night;
}

/**
 * A closed bud's marks on the ground (drawn with the ground, under every caster): the gold "light
 * from here" arc on its sun side with a little sun in it and a dotted beam toward the bud, and the
 * growth ring around its base filling gold. They brighten and pulse while the sun shines from
 * inside the arc.
 */
export function drawBudGround(g: CanvasRenderingContext2D, v: View, L: Light, b: Bud, night: number): void {
  budFrame(v, L, b, night);
  const S = v.S;
  const { x, y, aim, near, grow, pulse, dim } = bf;
  const tol = TUNING.buds.faceTol;

  // A soft fan of light from the arc in to the bud, then the "light from here" arc on the ground with
  // a tiny sun in its middle.
  const a0 = -(b.face + tol) * DEG;
  const a1 = -(b.face - tol) * DEG;
  g.fillStyle = cssa(GOLD, (near ? 0.2 + 0.12 * pulse : 0.1) * dim);
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, y, MARK_R * S, a0, a1);
  g.closePath();
  g.fill();
  g.lineCap = 'round';
  g.lineWidth = 6 * S;
  g.strokeStyle = cssa(GOLD, (near ? 0.35 + 0.3 * pulse : 0.22) * dim);
  g.beginPath();
  g.arc(x, y, MARK_R * S, a0, a1);
  g.stroke();
  g.lineWidth = Math.max(1.4, 2 * S);
  g.strokeStyle = cssa(GOLD_DEEP, (near ? 1 : 0.8) * dim);
  g.beginPath();
  g.arc(x, y, MARK_R * S, a0, a1);
  g.stroke();
  const fa = -b.face * DEG;
  const mx = x + Math.cos(fa) * MARK_R * S;
  const my = y + Math.sin(fa) * MARK_R * S;
  const sr = (3.2 + (near ? 0.7 * pulse : 0)) * S;
  g.fillStyle = cssa(GOLD, dim);
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const ra = (i * TAU) / 8 + L.time * 0.8;
    g.moveTo(mx + Math.cos(ra - 0.3) * sr * 1.05, my + Math.sin(ra - 0.3) * sr * 1.05);
    g.lineTo(mx + Math.cos(ra) * sr * 1.75, my + Math.sin(ra) * sr * 1.75);
    g.lineTo(mx + Math.cos(ra + 0.3) * sr * 1.05, my + Math.sin(ra + 0.3) * sr * 1.05);
  }
  g.fill();
  g.beginPath();
  g.arc(mx, my, sr, 0, TAU);
  g.fill();
  g.strokeStyle = cssa(GOLD_DEEP, dim);
  g.lineWidth = Math.max(1, 0.8 * S);
  g.stroke();
  // A dotted beam from the little sun to the bud: light comes from there.
  g.fillStyle = cssa(GOLD_DEEP, (0.35 + 0.5 * aim) * dim);
  g.beginPath();
  for (let k = 1; k <= 3; k++) {
    const r = MARK_R - 3.4 * k - 1;
    const dx = x + Math.cos(fa) * r * S;
    const dy = y + Math.sin(fa) * r * S;
    g.moveTo(dx + 0.9 * S, dy);
    g.arc(dx, dy, 0.9 * S, 0, TAU);
  }
  g.fill();

  // The growth ring around the base: a faint track, gold filling clockwise from the top.
  g.lineWidth = Math.max(1.5, 2 * S);
  g.strokeStyle = cssa(INK, 0.16 * dim);
  g.beginPath();
  g.arc(x, y, RING_R * S, 0, TAU);
  g.stroke();
  if (grow > 0.01) {
    g.lineWidth = Math.max(2, 2.6 * S);
    g.strokeStyle = cssa(GOLD, dim);
    g.beginPath();
    g.arc(x, y, RING_R * S, -Math.PI / 2, -Math.PI / 2 + TAU * grow);
    g.stroke();
  }
  g.lineCap = 'butt';
}

/**
 * A closed bud's plant (in the depth sort): two leaves, a short stem and the bulb, swelling as it
 * grows, its petal tips going gold, glowing while light reaches it.
 */
export function drawBudPlant(g: CanvasRenderingContext2D, v: View, L: Light, b: Bud, night: number): void {
  budFrame(v, L, b, night);
  const S = v.S;
  const { x, y, aim, near, grow, pulse, dim } = bf;
  const pal = L.pal;
  const leaf = css(tint(pal, LEAF));
  const leafDark = css(tint(pal, LEAF_DARK));
  const P = S * BUD_K;
  g.fillStyle = leafDark;
  leafShape(g, x, y - 1 * P, -1, 5.2 * P, 2.2 * P);
  g.fillStyle = leaf;
  leafShape(g, x, y - 1 * P, 1, 5.2 * P, 2.2 * P);
  const top = y - (6.5 + 1.5 * grow) * P;
  g.strokeStyle = css(tint(pal, STEM));
  g.lineWidth = Math.max(1, 1.2 * P);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, top);
  g.stroke();
  const br = (2.6 + 0.9 * grow) * P;
  if (near || grow > 0.05) {
    // The bulb glows while light reaches it.
    g.fillStyle = cssa(GOLD, (0.18 + 0.3 * Math.max(aim, grow)) * dim * (near ? 0.7 + 0.3 * pulse : 0.6));
    g.beginPath();
    g.arc(x, top - br * 0.4, br * 2.1, 0, TAU);
    g.fill();
  }
  g.fillStyle = css(tint(pal, mix(LEAF, LEAF_DARK, 0.25)));
  g.beginPath();
  g.ellipse(x, top - br * 0.4, br * 0.9, br * 1.25, 0, 0, TAU);
  g.fill();
  // Petal tips peeking out of the bulb, more of them gold as it grows.
  g.fillStyle = css(tint(pal, mix(PETAL_SHADE, PETAL, grow)));
  g.beginPath();
  g.moveTo(x - br * 0.45, top - br * 1.25);
  g.lineTo(x, top - br * (1.85 + 0.4 * grow));
  g.lineTo(x + br * 0.45, top - br * 1.25);
  g.closePath();
  g.fill();
  // The bulb's sun-side highlight.
  if (L.sunUp) {
    g.fillStyle = cssa(0xffffff, 0.35 * dim);
    g.beginPath();
    g.arc(x + L.ux * br * 0.4, top - br * 0.4 - L.uy * br * 0.5, br * 0.35, 0, TAU);
    g.fill();
  }
}

/** A leaf from (x, y) out to one side (dir ±1), `len` long and `w` wide. */
function leafShape(g: CanvasRenderingContext2D, x: number, y: number, dir: number, len: number, w: number): void {
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + dir * len * 0.5, y - w * 1.6, x + dir * len, y - w * 0.6);
  g.quadraticCurveTo(x + dir * len * 0.5, y + w * 0.4, x, y);
  g.fill();
}

/**
 * A sunflower caster (core kind 'sunflower': a stem prism and a disc head at height z): a stem
 * with two leaves, and the head as a disc facing the sun (azimuth θ, raised with the sun's
 * elevation), its yellow face and seed disc toward us when the sun is on our side, its green back
 * otherwise. A fresh bloom pops up out of the bud. Missing parts fall back to the caster's bounds.
 */
export function drawSunflower(g: CanvasRenderingContext2D, v: View, L: Light, c: Caster): void {
  let stem: PrismPart | null = null;
  let head: DiscPart | null = null;
  for (const p of c.parts as readonly Part[]) {
    if (p.t === 'prism' && !stem) stem = p;
    else if (p.t === 'disc' && !head) head = p;
  }
  const hx = head ? head.cx : c.x;
  const hy = head ? head.cy : c.y;
  const hz = head ? head.z : c.maxZ;
  const hr = head ? head.r : Math.max(6, (c.maxX - c.minX) / 2);
  const age = bloomAge(c.x, c.y, L.time);
  const k = popScale(age);
  const unfold = age >= POP_S ? 1 : Math.max(0, Math.min(1, (age - POP_S * 0.35) / (POP_S * 0.65)));
  const S = v.S;
  const pal = L.pal;
  const gx = v.ox + c.x * S;
  const gy = v.oy - c.y * S;
  const top = v.oy - (hy + STEM_LIFT * hz * k) * S;
  const hxS = v.ox + hx * S;

  // The stem (as wide as the core's stem prism) and two leaves.
  const sw = stem ? Math.max(1.4, Math.min(4, stem.maxX - stem.minX)) : 2.4;
  g.strokeStyle = css(tint(pal, STEM));
  g.lineCap = 'round';
  g.lineWidth = sw * S;
  g.beginPath();
  g.moveTo(gx, gy);
  g.quadraticCurveTo(gx + 1.5 * S, (gy + top) / 2, hxS, top);
  g.stroke();
  g.lineCap = 'butt';
  const ly = gy + (top - gy) * 0.45;
  g.fillStyle = css(tint(pal, LEAF_DARK));
  leafShape(g, gx + 0.4 * S, ly, -1, 9 * S * k, 3.4 * S * k);
  g.fillStyle = css(tint(pal, LEAF));
  leafShape(g, gx + 0.8 * S, ly + 3 * S, 1, 8 * S * k, 3 * S * k);

  // The head: a disc whose normal points at the sun (azimuth θ, raised by the elevation).
  const elevRad = (8 + 52 * L.elev) * DEG;
  const ch = L.sunUp ? Math.cos(elevRad) : 0.6;
  const sh = L.sunUp ? Math.sin(elevRad) : 0.8;
  const ux = L.ux;
  const uy = L.uy;
  // In-plane axes: a1 horizontal (−uy, ux, 0), a2 = n × a1 = (−sh·ux, −sh·uy, ch); onto the screen
  // as (x, −(y + K·z)).
  const r = hr * S * (0.25 + 0.75 * Math.min(1, k));
  const a1x = -uy * r;
  const a1y = -ux * r;
  const a2x = -sh * ux * r;
  const a2y = (sh * uy - HEAD_K * ch) * r;
  // Facing us when the normal has a positive share along the view ray (0, −K, 1).
  const facing = -HEAD_K * uy * ch + sh;
  const dpr = v.dpr;
  g.setTransform(a1x * dpr, a1y * dpr, a2x * dpr, a2y * dpr, hxS * dpr, top * dpr);
  // Petals: two rings, the back ring darker; they unfold from the bud.
  const pl = 0.55 + 0.75 * unfold;
  g.fillStyle = css(tint(pal, facing >= 0 ? PETAL_SHADE : darken(PETAL_SHADE, 0.12)));
  petalRing(g, 12, pl, 0.26, 0.13);
  g.fillStyle = css(tint(pal, facing >= 0 ? PETAL : PETAL_SHADE));
  petalRing(g, 12, pl * 0.94, 0.24, 0);
  if (facing >= 0) {
    // The seed disc with a darker rim and a few seeds; the light catches its sun side.
    g.fillStyle = css(tint(pal, SEEDS_DARK));
    g.beginPath();
    g.arc(0, 0, 0.5, 0, TAU);
    g.fill();
    g.fillStyle = css(tint(pal, SEEDS));
    g.beginPath();
    g.arc(0, 0, 0.42, 0, TAU);
    g.fill();
    g.fillStyle = cssa(0xffc23d, 0.55);
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4;
      const rr = 0.12 + 0.035 * i;
      g.moveTo(Math.cos(a) * rr + 0.04, Math.sin(a) * rr);
      g.arc(Math.cos(a) * rr, Math.sin(a) * rr, 0.04, 0, TAU);
    }
    g.fill();
  } else {
    // Seen from behind: the green back of the head.
    g.fillStyle = css(tint(pal, BACK));
    g.beginPath();
    g.arc(0, 0, 0.55, 0, TAU);
    g.fill();
    g.strokeStyle = css(tint(pal, darken(BACK, 0.2)));
    g.lineWidth = 0.06;
    g.beginPath();
    g.arc(0, 0, 0.3, 0, TAU);
    g.stroke();
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** n petals (ellipses along the radius) of length `len` and half-width `w`, turned by `turn` rad. */
function petalRing(g: CanvasRenderingContext2D, n: number, len: number, w: number, turn: number): void {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i * TAU) / n + turn;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const mx = c * (0.42 + len * 0.5);
    const my = s * (0.42 + len * 0.5);
    g.moveTo(mx + c * len * 0.5, my + s * len * 0.5);
    g.ellipse(mx, my, len * 0.5, w, a, 0, TAU);
  }
  g.fill();
}
