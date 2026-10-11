// Nubs the snowman (GDD §10, V1_PLAN §9): a compressed sprite standing on a ground footprint disc
// that sits exactly over his 5 shade test points (frost rim when shaded, wet and dark when lit),
// tinted per sample so partial shade reads spatially. Coal eyes look toward the sun and squint in
// sunlight, the nose points the same way, a scarf with two spring-chain tails, equipped cosmetics,
// a walk bob, sweat below 60 Chill, a teardrop wobble below 30, a shiver on shade re-entry, and on
// death a melt into a puddle with the eyes and nose bobbing in it. Also the Wardrobe preview.

import { equippedLooks, type Equipped, type HatLook, type NoseLook, type ScarfLook } from '../meta/content.ts';
import { css, cssa, darken, hex, lighten, mix, type Rgb } from './color.ts';
import { ctx2d, makeCanvas, type Canvas2D } from './sprites.ts';

const TAU = Math.PI * 2;
const SNOW = 0xffffff;
const SNOW_RIM = hex('#CFE6FF');
const OUTLINE = hex('#7D8FC2');
const COAL = hex('#2B2B33');
/** Sprite scale relative to the GDD's 11 u body (the footprint disc keeps the true test area). */
export const NUBS_SCALE = 1.15;

/** Spring-chain scarf tails and short-lived expression timers. */
export interface NubsAnim {
  /** Tail nodes: 2 tails × 3 nodes × (x, y), local u relative to the knot; and velocities. */
  readonly tail: Float32Array;
  readonly tailV: Float32Array;
  lastSX: number;
  vx: number;
  /** Remaining seconds of each reaction. */
  shiver: number;
  glare: number;
  happy: number;
  phew: number;
  blink: number;
  blinkIn: number;
  walkPhase: number;
}

export function createNubsAnim(): NubsAnim {
  const a: NubsAnim = {
    tail: new Float32Array(12),
    tailV: new Float32Array(12),
    lastSX: NaN,
    vx: 0,
    shiver: 0,
    glare: 0,
    happy: 0,
    phew: 0,
    blink: 0,
    blinkIn: 2.5,
    walkPhase: 0,
  };
  resetNubsAnim(a);
  return a;
}

export function resetNubsAnim(a: NubsAnim): void {
  for (let t = 0; t < 2; t++) {
    for (let k = 0; k < 3; k++) {
      const o = (t * 3 + k) * 2;
      a.tail[o] = (t === 0 ? -1 : 1) * (1 + k * 0.6);
      a.tail[o + 1] = 2 + k * 3;
      a.tailV[o] = 0;
      a.tailV[o + 1] = 0;
    }
  }
  a.lastSX = NaN;
  a.vx = 0;
  a.shiver = 0;
  a.glare = 0;
  a.happy = 0;
  a.phew = 0;
}

/** Advances springs and timers (dt in game seconds; sx = Nubs' screen x in CSS px; S = px per u). */
export function updateNubsAnim(a: NubsAnim, dt: number, sx: number, S: number, walking: boolean, speed: number): void {
  if (dt <= 0) return;
  const svx = Number.isFinite(a.lastSX) ? (sx - a.lastSX) / S / dt : 0;
  a.lastSX = sx;
  a.vx += (svx - a.vx) * Math.min(1, dt * 10);
  a.shiver = Math.max(0, a.shiver - dt);
  a.glare = Math.max(0, a.glare - dt);
  a.happy = Math.max(0, a.happy - dt);
  a.phew = Math.max(0, a.phew - dt);
  a.blinkIn -= dt;
  if (a.blinkIn <= 0) {
    a.blink = 0.12;
    a.blinkIn = 2 + Math.random() * 3;
  }
  a.blink = Math.max(0, a.blink - dt);
  if (walking) a.walkPhase += dt * 2.2 * TAU * (speed / 70);
  // Tails: each node is pulled toward a rest point below its parent, with drag from walking
  // (tails stream back = down the screen) and lateral motion (they lag behind sideways moves).
  const steps = dt > 0.02 ? 2 : 1;
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    for (let t = 0; t < 2; t++) {
      const side = t === 0 ? -1 : 1;
      let px = side * 0.6;
      let py = 0;
      for (let k = 0; k < 3; k++) {
        const o = (t * 3 + k) * 2;
        const restX = px + side * (0.5 + 0.15 * k) - a.vx * 0.012 * (k + 1);
        const restY = py + 2.6 + (walking ? 0.2 * Math.sin(a.walkPhase + k + t) : 0);
        const fx = (restX - (a.tail[o] as number)) * 160;
        const fy = (restY - (a.tail[o + 1] as number)) * 160;
        a.tailV[o] = ((a.tailV[o] as number) + fx * h) * Math.max(0, 1 - 9 * h);
        a.tailV[o + 1] = ((a.tailV[o + 1] as number) + fy * h) * Math.max(0, 1 - 9 * h);
        a.tail[o] = (a.tail[o] as number) + (a.tailV[o] as number) * h;
        a.tail[o + 1] = (a.tail[o + 1] as number) + (a.tailV[o + 1] as number) * h;
        px = a.tail[o] as number;
        py = a.tail[o + 1] as number;
      }
    }
  }
}

export interface NubsPose {
  /** Ground point on screen (CSS px) and px per u. */
  x: number;
  y: number;
  S: number;
  /** Chill 0..1. */
  chill: number;
  /** Lit weight per sample: C, E, W, N, S (0 shaded, 1 lit, 2 glare). */
  w0: number;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  /** Mean lit weight f (0..2). */
  f: number;
  /** Unit screen direction toward the sun (x right, y down) and whether there is a sun. */
  lookX: number;
  lookY: number;
  sunUp: boolean;
  walking: boolean;
  night: number;
  time: number;
  /** Death: −1 alive, else seconds since the melt began (game time). */
  melt: number;
  /** Shade color for partial tinting. */
  shade: Rgb;
  reducedMotion: boolean;
}

export function createPose(): NubsPose {
  return {
    x: 0,
    y: 0,
    S: 1,
    chill: 1,
    w0: 0,
    w1: 0,
    w2: 0,
    w3: 0,
    w4: 0,
    f: 0,
    lookX: 1,
    lookY: 0,
    sunUp: true,
    walking: false,
    night: 0,
    time: 0,
    melt: -1,
    shade: hex('#C9D6F2'),
    reducedMotion: false,
  };
}

const sampleOf = (w: number): Rgb => (w === 0 ? 0 : w === 1 ? 1 : 2);

// ---------------------------------------------------------------------------------------------
// Ground footprint disc
// ---------------------------------------------------------------------------------------------

/**
 * The r 9 u disc over the 5 coverage samples: each quadrant of the rim shows its sample (E, N, W,
 * S) and the center dot shows C. Frost-white when shaded, wet-dark when lit, hot orange in glare.
 */
export function drawFootprintDisc(g: CanvasRenderingContext2D, p: NubsPose, trailColor: Rgb): void {
  if (p.melt >= 0) return;
  // The disc covers the 5 test points (r 9 u); its rim is drawn a little wider so it still shows
  // around Nubs' base instead of disappearing under his body.
  const r = 13.5 * p.S;
  const wet = darken(trailColor, 0.4);
  // Fill: cool when fully shaded, damp when lit.
  const shaded = p.f === 0;
  g.fillStyle = shaded ? cssa(0xe6f4ff, 0.32) : cssa(wet, 0.22);
  g.beginPath();
  g.ellipse(p.x, p.y, r, r, 0, 0, TAU);
  g.fill();
  if (!p.sunUp) return;
  const quad = (w: number, a0: number): void => {
    const s = sampleOf(w);
    g.strokeStyle = s === 0 ? cssa(0xffffff, 0.95) : s === 1 ? cssa(wet, 0.7) : cssa(0xff6a3d, 0.95);
    g.lineWidth = Math.max(1.2, (s === 0 ? 1.7 : 1.4) * p.S);
    g.beginPath();
    g.arc(p.x, p.y, r, a0 - Math.PI / 4 + 0.08, a0 + Math.PI / 4 - 0.08);
    g.stroke();
  };
  // Screen angles: E = 0, S(screen down) = π/2, W = π, N(screen up) = −π/2.
  quad(p.w1, 0);
  quad(p.w4, Math.PI / 2);
  quad(p.w2, Math.PI);
  quad(p.w3, -Math.PI / 2);
  const c = sampleOf(p.w0);
  g.fillStyle = c === 0 ? cssa(0xffffff, 0.9) : c === 1 ? cssa(wet, 0.6) : cssa(0xff6a3d, 0.9);
  g.beginPath();
  g.arc(p.x, p.y, 1.6 * p.S, 0, TAU);
  g.fill();
}

/** Nubs' own little shadow when the sun reaches him (points away from the sun). */
export function drawOwnShadow(g: CanvasRenderingContext2D, p: NubsPose, shadowColor: Rgb, alpha: number): void {
  if (!p.sunUp || p.w0 === 0 || p.melt >= 0) return;
  const s = 0.6 + 0.4 * p.chill;
  const len = 9 * p.S * s;
  g.fillStyle = cssa(shadowColor, alpha * 0.55);
  g.beginPath();
  g.ellipse(p.x - p.lookX * len * 0.8, p.y - p.lookY * len * 0.8, len * 1.1, len * 0.6, Math.atan2(p.lookY, p.lookX), 0, TAU);
  g.fill();
}

// ---------------------------------------------------------------------------------------------
// The sprite
// ---------------------------------------------------------------------------------------------

interface Looks {
  scarf: ScarfLook;
  hat: HatLook;
  nose: NoseLook;
}

let cachedScarf = '';
let cachedHat = '';
let cachedNose = '';
let cachedLooks: Looks | null = null;

/** The looks for `e`, cached (the same object while the equipped set is unchanged). */
export function looksFor(e: Equipped): Looks {
  if (!cachedLooks || e.scarf !== cachedScarf || e.hat !== cachedHat || e.nose !== cachedNose) {
    cachedScarf = e.scarf;
    cachedHat = e.hat;
    cachedNose = e.nose;
    cachedLooks = equippedLooks(e);
  }
  return cachedLooks;
}

/**
 * Whole-sprite motion applied around the ground point: walk bob (scaleY 1 ± 0.04), shiver squash
 * (1.12 / 0.90 easing back over 140 ms) and jitter, and the teardrop's squash and wobble below 30 %
 * Chill. Kept out of the drawing itself so the cached sprite layers stay still (see NubsSprite).
 */
interface Motion {
  sx: number;
  sy: number;
  rot: number;
  /** Horizontal jitter in pose px. */
  jx: number;
}

const motion: Motion = { sx: 1, sy: 1, rot: 0, jx: 0 };

function nubsMotion(p: NubsPose, a: NubsAnim, out: Motion): Motion {
  const U = p.S * (0.6 + 0.4 * p.chill) * NUBS_SCALE;
  const low = p.chill < 0.3;
  let sx = 1;
  let sy = 1;
  if (p.walking && !p.reducedMotion) sy += 0.04 * Math.sin(a.walkPhase);
  if (a.shiver > 0) {
    const k = a.shiver / 0.14;
    sx *= 1 + 0.12 * k;
    sy *= 1 - 0.1 * k;
  }
  if (low) {
    // Teardrop: wider and shorter.
    sx *= 1.15;
    sy *= 0.85;
  }
  out.sx = sx;
  out.sy = sy;
  out.rot = low && !p.reducedMotion ? ((4 * Math.PI) / 180) * Math.sin(p.time * 9) : 0;
  out.jx = a.shiver > 0 && !p.reducedMotion ? Math.sin(p.time * 90) * 0.6 * U : 0;
  return out;
}

/** Body/head geometry in pose px, relative to the ground point. */
interface Geom {
  U: number;
  low: boolean;
  bodyY: number;
  bodyR: number;
  headY: number;
  headR: number;
}

const geom: Geom = { U: 1, low: false, bodyY: 0, bodyR: 1, headY: 0, headR: 1 };

function nubsGeom(p: NubsPose, out: Geom): Geom {
  // Visual scale 1.15 (V1_PLAN asks 0.9; at 360 u per screen width that read as a 20 px speck).
  const U = p.S * (0.6 + 0.4 * p.chill) * NUBS_SCALE;
  out.U = U;
  out.low = p.chill < 0.3;
  out.bodyY = -5 * U;
  out.bodyR = 11 * U;
  out.headY = (out.low ? -13 : -16.5) * U;
  out.headR = 7.5 * U;
  return out;
}

function tintOf(p: NubsPose, s: number): Rgb {
  return mix(SNOW, p.shade, (0.15 + 0.85 * s) * (p.sunUp ? 1 : 0.6) * (1 - p.night * 0.3));
}

/** Back layer: outline, body (per-sample tint gradient), body rim and sun-side highlight. */
function drawBackLayer(g: CanvasRenderingContext2D, p: NubsPose, G: Geom): void {
  const { U, low, bodyY, bodyR, headY, headR } = G;
  // Partial shade per sample: shaded (w 0) samples tint that side cool.
  const shadeL = p.w2 === 0 ? 1 : 0;
  const shadeR = p.w1 === 0 ? 1 : 0;
  const shadeC = p.w0 === 0 ? 1 : 0;
  const bottomS = (p.w4 === 0 ? 1 : 0) * 0.5;
  const bodyGrad = g.createLinearGradient(-bodyR, 0, bodyR, 0);
  bodyGrad.addColorStop(0, css(tintOf(p, Math.max(shadeL, bottomS))));
  bodyGrad.addColorStop(0.5, css(tintOf(p, Math.max(shadeC, bottomS))));
  bodyGrad.addColorStop(1, css(tintOf(p, Math.max(shadeR, bottomS))));
  // Outline first (readability against pale noon ground).
  const ow = Math.min(1.1 * U, 3.2);
  g.fillStyle = css(mix(OUTLINE, 0x2b2140, p.night * 0.5));
  g.beginPath();
  bodyShape(g, 0, bodyY, bodyR + ow, low);
  g.moveTo(headR + ow, headY);
  g.arc(0, headY, headR + ow, 0, TAU);
  g.fill();
  g.fillStyle = bodyGrad;
  g.beginPath();
  bodyShape(g, 0, bodyY, bodyR, low);
  g.fill();
  rimAndHighlight(g, 0, bodyY, bodyR, p.lookX, p.lookY, p.f > 0 && p.sunUp, low);
}

/** Scarf tails (between the layers: in front of the body, behind the head). */
function drawTailsLayer(g: CanvasRenderingContext2D, p: NubsPose, a: NubsAnim, looks: Looks, G: Geom): void {
  drawScarfTails(g, a, looks.scarf, G.U, G.headY + G.headR * 0.75, p.lookX);
}

/** Front layer: head, its rim, the scarf band, face and hat. */
function drawFrontLayer(g: CanvasRenderingContext2D, p: NubsPose, a: NubsAnim, looks: Looks, G: Geom): void {
  const { U, headY, headR } = G;
  const lx = p.lookX;
  const shadeC = p.w0 === 0 ? 1 : 0;
  const shadeN = p.w3 === 0 ? 1 : 0;
  g.fillStyle = css(tintOf(p, Math.max(shadeN, shadeC * 0.6)));
  g.beginPath();
  g.arc(0, headY, headR, 0, TAU);
  g.fill();
  rimAndHighlight(g, 0, headY, headR, lx, p.lookY, p.f > 0 && p.sunUp, false);
  drawScarfBand(g, looks.scarf, U, headY + headR * 0.78, headR * 1.1, lx);
  drawFace(g, p, a, U, headY, headR, looks.nose);
  drawHat(g, looks.hat, U, headY, headR, lx);
}

/** The orange glare flash over everything already drawn in `g` (Nubs-only canvases). */
function drawGlareFlash(g: CanvasRenderingContext2D, a: NubsAnim, G: Geom): void {
  if (a.glare <= 0) return;
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = cssa(0xffb36b, 0.55 * (a.glare / 0.25));
  g.fillRect(-G.bodyR * 2, G.headY - G.headR * 2, G.bodyR * 4, G.bodyR * 4);
  g.globalCompositeOperation = 'source-over';
}

/** Draws Nubs at pose p straight into `g` (used for the melt and the Wardrobe preview). */
export function drawNubs(g: CanvasRenderingContext2D, p: NubsPose, a: NubsAnim, looks: Looks): void {
  if (p.melt >= 0) {
    drawMelt(g, p, a, looks);
    return;
  }
  const m = nubsMotion(p, a, motion);
  const G = nubsGeom(p, geom);
  g.save();
  g.translate(p.x + m.jx, p.y);
  g.rotate(m.rot);
  g.scale(m.sx, m.sy);
  drawBackLayer(g, p, G);
  drawTailsLayer(g, p, a, looks, G);
  drawFrontLayer(g, p, a, looks, G);
  drawGlareFlash(g, a, G);
  g.restore();
}

function bodyShape(g: CanvasRenderingContext2D, x: number, y: number, r: number, tear: boolean): void {
  if (!tear) {
    g.moveTo(x + r, y);
    g.arc(x, y, r, 0, TAU);
    return;
  }
  // A sagging teardrop: round bottom, narrower pinched top.
  g.moveTo(x + r, y + r * 0.1);
  g.bezierCurveTo(x + r, y + r * 1.15, x - r, y + r * 1.15, x - r, y + r * 0.1);
  g.bezierCurveTo(x - r, y - r * 0.75, x - r * 0.25, y - r * 1.05, x, y - r * 1.05);
  g.bezierCurveTo(x + r * 0.25, y - r * 1.05, x + r, y - r * 0.75, x + r, y + r * 0.1);
  g.closePath();
}

function rimAndHighlight(g: CanvasRenderingContext2D, x: number, y: number, r: number, lx: number, ly: number, lit: boolean, tear: boolean): void {
  // Cool rim on the side away from the sun.
  g.save();
  g.beginPath();
  bodyShape(g, x, y, r, tear);
  g.clip();
  g.fillStyle = cssa(SNOW_RIM, 0.75);
  g.beginPath();
  g.arc(x, y, r * 1.02, 0, TAU);
  g.arc(x + lx * r * 0.28, y + ly * r * 0.28, r * 0.95, 0, TAU, true);
  g.fill('evenodd');
  // Sun-side highlight.
  g.fillStyle = cssa(0xffffff, lit ? 0.9 : 0.55);
  g.beginPath();
  g.ellipse(x + lx * r * 0.42, y + ly * r * 0.42 - r * 0.15, r * 0.32, r * 0.22, Math.atan2(ly, lx), 0, TAU);
  g.fill();
  g.restore();
}

function drawFace(g: CanvasRenderingContext2D, p: NubsPose, a: NubsAnim, U: number, headY: number, _headR: number, nose: NoseLook): void {
  const lx = p.lookX;
  const ly = p.lookY;
  // Eyes shift 1.5 u toward the sun (less vertically so they stay on the face).
  const ex = lx * 1.5 * U;
  const ey = ly * 1.1 * U - 0.8 * U;
  const lit = p.f > 0 && p.sunUp;
  const glare = p.w0 === 2 || p.w1 === 2 || p.w2 === 2 || p.w3 === 2 || p.w4 === 2;
  const happy = a.happy > 0 || a.phew > 0;
  const worried = p.chill < 0.3;
  const eyeDX = 2.9 * U;
  g.fillStyle = css(COAL);
  g.strokeStyle = css(COAL);
  g.lineCap = 'round';
  g.lineWidth = Math.max(1, 1.25 * U);
  for (const side of [-1, 1]) {
    const x = side * eyeDX + ex;
    const y = headY + ey;
    if (a.blink > 0 && !lit) {
      g.beginPath();
      g.moveTo(x - 1.2 * U, y);
      g.lineTo(x + 1.2 * U, y);
      g.stroke();
    } else if (happy && !lit) {
      // ^ ^
      g.beginPath();
      g.arc(x, y + 0.6 * U, 1.3 * U, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    } else if (glare) {
      // > < squeeze.
      g.beginPath();
      g.moveTo(x - side * 1.3 * U, y - 1.1 * U);
      g.lineTo(x + side * 0.6 * U, y);
      g.lineTo(x - side * 1.3 * U, y + 1.1 * U);
      g.stroke();
    } else if (lit) {
      // Squint: flat lids.
      g.beginPath();
      g.moveTo(x - 1.4 * U, y - (worried ? side * 0.4 * U : 0));
      g.lineTo(x + 1.4 * U, y + (worried ? side * 0.4 * U : 0));
      g.stroke();
    } else {
      g.beginPath();
      g.ellipse(x, y, 1.15 * U, 1.35 * U, 0, 0, TAU);
      g.fill();
      g.fillStyle = cssa(0xffffff, 0.9);
      g.beginPath();
      g.arc(x + 0.4 * U + lx * 0.2 * U, y - 0.5 * U, 0.42 * U, 0, TAU);
      g.fill();
      g.fillStyle = css(COAL);
    }
  }
  // Mouth: coal dots.
  const my = headY + ey + 3.6 * U;
  const mx = ex * 0.7;
  g.fillStyle = css(COAL);
  if (worried || glare) {
    g.beginPath();
    g.ellipse(mx, my + 0.3 * U, 1.1 * U, (worried ? 1.4 : 0.9) * U, 0, 0, TAU);
    g.fill();
  } else {
    const smile = happy ? 1.2 : lit ? -0.3 : 0.6;
    for (let i = -2; i <= 2; i++) {
      const t = i / 2;
      g.beginPath();
      g.arc(mx + t * 2.4 * U, my + (1 - t * t) * smile * U, 0.5 * U, 0, TAU);
      g.fill();
    }
  }
  // Cheeks when happy.
  if (happy && !lit) {
    g.fillStyle = cssa(0xff9eb0, 0.5);
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(side * 4.6 * U + ex * 0.5, headY + ey + 2.2 * U, 1.4 * U, 0.8 * U, 0, 0, TAU);
      g.fill();
    }
  }
  drawNose(g, nose, U, ex * 0.8, headY + ey + 1.5 * U, lx, ly);
}

/** The nose points the way the face looks (toward the sun), with a downward bias. */
function drawNose(g: CanvasRenderingContext2D, n: NoseLook, U: number, x: number, y: number, lx: number, ly: number): void {
  let dx = lx;
  let dy = ly * 0.55 + 0.35;
  const len0 = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= len0;
  dy /= len0;
  const L = 7.5 * U * n.length;
  const w = 1.9 * U;
  const nx = -dy;
  const ny = dx;
  g.save();
  switch (n.shape) {
    case 'pinecone': {
      const cx = x + dx * L * 0.45;
      const cy = y + dy * L * 0.45;
      g.fillStyle = n.shade;
      g.beginPath();
      g.ellipse(cx, cy, L * 0.62, w * 1.25, Math.atan2(dy, dx), 0, TAU);
      g.fill();
      g.fillStyle = n.main;
      for (let i = 0; i < 4; i++) {
        const t = i / 3 - 0.5;
        for (const s of [-1, 1]) {
          g.beginPath();
          g.ellipse(cx + dx * t * L * 0.8 + nx * s * w * 0.45, cy + dy * t * L * 0.8 + ny * s * w * 0.45, w * 0.55, w * 0.45, Math.atan2(dy, dx), 0, TAU);
          g.fill();
        }
      }
      g.fillStyle = n.accent;
      g.beginPath();
      g.arc(cx + dx * L * 0.5, cy + dy * L * 0.5, w * 0.35, 0, TAU);
      g.fill();
      break;
    }
    case 'candyCane': {
      g.lineCap = 'round';
      g.lineWidth = w * 1.1;
      const tipX = x + dx * L * 0.75;
      const tipY = y + dy * L * 0.75;
      g.strokeStyle = n.main;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(tipX, tipY);
      g.arc(tipX + nx * w * 1.1, tipY + ny * w * 1.1, w * 1.1, Math.atan2(-ny, -nx), Math.atan2(-ny, -nx) + Math.PI, dx * ny - dy * nx < 0);
      g.stroke();
      g.strokeStyle = n.accent;
      g.lineWidth = w * 0.45;
      g.lineCap = 'butt';
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const t = 0.15 + i * 0.28;
        const cx = x + dx * L * 0.75 * t;
        const cy = y + dy * L * 0.75 * t;
        g.moveTo(cx - nx * w * 0.5 - dx * w * 0.25, cy - ny * w * 0.5 - dy * w * 0.25);
        g.lineTo(cx + nx * w * 0.5 + dx * w * 0.25, cy + ny * w * 0.5 + dy * w * 0.25);
      }
      g.stroke();
      break;
    }
    default: {
      // Carrot / parsnip: a tapered cone with a shaded underside and ridges.
      const tipX = x + dx * L;
      const tipY = y + dy * L;
      g.fillStyle = n.main;
      g.beginPath();
      g.moveTo(x + nx * w, y + ny * w);
      g.quadraticCurveTo(x + dx * L * 0.5 + nx * w * 0.7, y + dy * L * 0.5 + ny * w * 0.7, tipX, tipY);
      g.quadraticCurveTo(x + dx * L * 0.5 - nx * w * 0.7, y + dy * L * 0.5 - ny * w * 0.7, x - nx * w, y - ny * w);
      g.closePath();
      g.fill();
      // Underside shade (the half facing screen-down).
      const sideSign = ny > 0 ? 1 : -1;
      g.fillStyle = n.shade;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + nx * w * sideSign, y + ny * w * sideSign);
      g.quadraticCurveTo(x + dx * L * 0.5 + nx * w * 0.7 * sideSign, y + dy * L * 0.5 + ny * w * 0.7 * sideSign, tipX, tipY);
      g.closePath();
      g.fill();
      g.strokeStyle = n.accent;
      g.lineWidth = Math.max(0.6, 0.45 * U);
      g.lineCap = 'round';
      g.beginPath();
      for (let i = 1; i <= 2; i++) {
        const t = i * 0.3;
        const ww = w * (1 - t) * 0.7;
        const cx = x + dx * L * t;
        const cy = y + dy * L * t;
        g.moveTo(cx - nx * ww, cy - ny * ww);
        g.lineTo(cx + nx * ww * 0.2, cy + ny * ww * 0.2);
      }
      g.stroke();
      if (n.shape === 'parsnip') {
        g.fillStyle = n.accent;
        g.beginPath();
        g.ellipse(x - dx * w * 0.6 + nx * w * 0.8, y - dy * w * 0.6 + ny * w * 0.8 - w, w * 0.5, w * 1.1, Math.atan2(dy, dx) + 0.6, 0, TAU);
        g.fill();
      }
      break;
    }
  }
  g.restore();
}

function scarfColorAt(s: ScarfLook, t: number): string {
  if (s.pattern === 'rainbow' && s.stripes.length > 0) {
    const i = Math.min(s.stripes.length - 1, Math.floor(t * s.stripes.length));
    return s.stripes[i] as string;
  }
  return s.main;
}

function drawScarfBand(g: CanvasRenderingContext2D, s: ScarfLook, U: number, y: number, halfW: number, lx: number): void {
  const h = 3.4 * U;
  g.save();
  // Band: a curved strip (smile-shaped, wrapping the neck).
  const path = (): void => {
    g.beginPath();
    g.moveTo(-halfW, y - h * 0.5);
    g.quadraticCurveTo(0, y + h * 0.9, halfW, y - h * 0.5);
    g.lineTo(halfW, y + h * 0.4);
    g.quadraticCurveTo(0, y + h * 1.9, -halfW, y + h * 0.4);
    g.closePath();
  };
  path();
  g.clip();
  if (s.pattern === 'rainbow') {
    const n = s.stripes.length;
    for (let i = 0; i < n; i++) {
      g.fillStyle = s.stripes[i] as string;
      g.fillRect(-halfW + ((2 * halfW) / n) * i, y - h * 2, (2 * halfW) / n + 0.5, h * 4);
    }
  } else {
    g.fillStyle = s.main;
    g.fillRect(-halfW, y - h * 2, 2 * halfW, h * 4);
    if (s.pattern === 'stripes') {
      g.fillStyle = s.stripes[0] ?? '#FFFFFF';
      for (let xx = -halfW + 1.5 * U; xx < halfW; xx += 3.2 * U) g.fillRect(xx, y - h * 2, 1.1 * U, h * 4);
    } else if (s.pattern === 'plaid') {
      g.fillStyle = s.stripes[0] ?? '#2F5D50';
      g.globalAlpha = 0.7;
      g.fillRect(-halfW, y + h * 0.1, 2 * halfW, 0.9 * U);
      g.fillStyle = s.stripes[1] ?? '#F2CF5B';
      for (let xx = -halfW + 1.2 * U; xx < halfW; xx += 3.4 * U) g.fillRect(xx, y - h * 2, 0.8 * U, h * 4);
      g.globalAlpha = 1;
    } else if (s.pattern === 'metallic') {
      g.fillStyle = s.shine ?? '#FFF3C4';
      g.globalAlpha = 0.8;
      g.fillRect(lx * halfW * 0.4 - 1.2 * U, y - h * 2, 2.4 * U, h * 4);
      g.globalAlpha = 1;
    }
  }
  // Fold shade along the lower edge.
  g.fillStyle = s.shade;
  g.globalAlpha = 0.55;
  g.beginPath();
  g.moveTo(-halfW, y + h * 0.4);
  g.quadraticCurveTo(0, y + h * 1.9, halfW, y + h * 0.4);
  g.lineTo(halfW, y + h * 0.05);
  g.quadraticCurveTo(0, y + h * 1.4, -halfW, y + h * 0.05);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
  g.restore();
  // Knot on the side away from the look direction.
  const kx = (lx >= 0 ? -1 : 1) * halfW * 0.55;
  g.fillStyle = s.pattern === 'rainbow' ? (s.stripes[0] as string) : s.main;
  g.beginPath();
  g.arc(kx, y + h * 0.75, 1.7 * U, 0, TAU);
  g.fill();
}

function drawScarfTails(g: CanvasRenderingContext2D, a: NubsAnim, s: ScarfLook, U: number, y: number, lx: number): void {
  const kx = (lx >= 0 ? -1 : 1) * 4.5 * U;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let t = 0; t < 2; t++) {
    const pts: number[] = [kx, y + 2 * U];
    for (let k = 0; k < 3; k++) {
      const o = (t * 3 + k) * 2;
      pts.push(kx + (a.tail[o] as number) * U, y + 2 * U + (a.tail[o + 1] as number) * U);
    }
    // Shade underlay then the main color, then pattern ticks.
    g.lineWidth = 3.3 * U;
    g.strokeStyle = s.shade;
    g.beginPath();
    g.moveTo(pts[0] as number, (pts[1] as number) + 0.4 * U);
    for (let i = 1; i < 4; i++) g.lineTo(pts[2 * i] as number, (pts[2 * i + 1] as number) + 0.4 * U);
    g.stroke();
    g.lineWidth = 2.6 * U;
    g.strokeStyle = scarfColorAt(s, t === 0 ? 0.2 : 0.8);
    g.beginPath();
    g.moveTo(pts[0] as number, pts[1] as number);
    for (let i = 1; i < 4; i++) g.lineTo(pts[2 * i] as number, pts[2 * i + 1] as number);
    g.stroke();
    if (s.pattern !== 'solid' && s.pattern !== 'metallic') {
      g.lineWidth = 0.9 * U;
      for (let i = 1; i < 4; i++) {
        const x0 = pts[2 * i - 2] as number;
        const y0 = pts[2 * i - 1] as number;
        const x1 = pts[2 * i] as number;
        const y1 = pts[2 * i + 1] as number;
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        g.strokeStyle = s.pattern === 'rainbow' ? (s.stripes[(i + t * 3) % s.stripes.length] as string) : (s.stripes[0] ?? '#FFFFFF');
        g.beginPath();
        g.moveTo(mx - (dy / len) * 1.3 * U, my + (dx / len) * 1.3 * U);
        g.lineTo(mx + (dy / len) * 1.3 * U, my - (dx / len) * 1.3 * U);
        g.stroke();
      }
    }
    // Fringe at the end.
    const ex = pts[6] as number;
    const ey = pts[7] as number;
    g.strokeStyle = s.shade;
    g.lineWidth = 0.6 * U;
    g.beginPath();
    for (let f = -1; f <= 1; f++) {
      g.moveTo(ex + f * 0.9 * U, ey);
      g.lineTo(ex + f * 1.1 * U, ey + 1.6 * U);
    }
    g.stroke();
  }
}

function drawHat(g: CanvasRenderingContext2D, h: HatLook, U: number, headY: number, headR: number, lx: number): void {
  if (h.shape === 'none') return;
  const top = headY - headR;
  g.save();
  g.lineJoin = 'round';
  switch (h.shape) {
    case 'beanie': {
      g.fillStyle = h.main;
      g.beginPath();
      g.ellipse(0, top + 2.2 * U, headR * 0.98, headR * 0.82, 0, Math.PI, 0);
      g.closePath();
      g.fill();
      g.fillStyle = h.shade;
      roundBand(g, -headR * 1.02, top + 1.3 * U, headR * 2.04, 2.6 * U, 1.3 * U);
      g.fill();
      g.fillStyle = h.accent;
      g.beginPath();
      g.arc(0, top - 4.2 * U, 1.9 * U, 0, TAU);
      g.fill();
      break;
    }
    case 'topHat': {
      g.fillStyle = h.shade;
      g.beginPath();
      g.ellipse(0, top + 1.6 * U, headR * 1.25, 1.6 * U, 0, 0, TAU);
      g.fill();
      g.fillStyle = h.main;
      g.fillRect(-headR * 0.7, top - 8.5 * U, headR * 1.4, 10 * U);
      g.beginPath();
      g.ellipse(0, top - 8.5 * U, headR * 0.7, 1.2 * U, 0, 0, TAU);
      g.fill();
      g.fillStyle = h.accent;
      g.fillRect(-headR * 0.7, top - 1.6 * U, headR * 1.4, 1.8 * U);
      g.fillStyle = cssa(0xffffff, 0.18);
      g.fillRect(lx >= 0 ? headR * 0.25 : -headR * 0.55, top - 8 * U, headR * 0.3, 9 * U);
      break;
    }
    case 'partyCone': {
      g.translate(0, top + 1.5 * U);
      g.rotate(lx >= 0 ? -0.21 : 0.21);
      g.fillStyle = h.main;
      g.beginPath();
      g.moveTo(-headR * 0.75, 0);
      g.lineTo(0, -12 * U);
      g.lineTo(headR * 0.75, 0);
      g.closePath();
      g.fill();
      g.fillStyle = h.detail;
      for (const [dx, dy] of [
        [-1.8, -2],
        [1.6, -3.4],
        [-0.4, -6.2],
        [0.6, -9],
      ] as const) {
        g.beginPath();
        g.arc(dx * U, dy * U, 0.85 * U, 0, TAU);
        g.fill();
      }
      g.fillStyle = h.accent;
      g.beginPath();
      g.arc(0, -12.5 * U, 1.7 * U, 0, TAU);
      g.fill();
      break;
    }
    case 'sunVisor': {
      g.strokeStyle = h.accent;
      g.lineWidth = 1.8 * U;
      g.beginPath();
      g.ellipse(0, top + 2.6 * U, headR * 0.98, 2.4 * U, 0, Math.PI * 1.05, Math.PI * 1.95);
      g.stroke();
      // Brim forward (toward the viewer).
      g.fillStyle = h.shade;
      g.beginPath();
      g.ellipse(lx * 1.5 * U, top + 3.6 * U, headR * 1.05, 2.4 * U, 0, 0, Math.PI);
      g.fill();
      g.fillStyle = h.main;
      g.beginPath();
      g.ellipse(lx * 1.5 * U, top + 3.2 * U, headR * 1.05, 2.1 * U, 0, 0, Math.PI);
      g.fill();
      g.fillStyle = h.detail;
      g.beginPath();
      g.arc(lx * 1.5 * U, top + 4.1 * U, 0.9 * U, 0, TAU);
      g.fill();
      break;
    }
    case 'crown': {
      const w = headR * 0.95;
      const base = top + 2 * U;
      g.fillStyle = h.shade;
      g.fillRect(-w, base - 2.2 * U, w * 2, 2.6 * U);
      g.fillStyle = h.main;
      g.beginPath();
      g.moveTo(-w, base);
      g.lineTo(-w, base - 6 * U);
      for (let i = 0; i < 5; i++) {
        const x0 = -w + (i * 2 * w) / 5;
        g.lineTo(x0 + w / 5, base - 3 * U);
        g.lineTo(x0 + (2 * w) / 5, base - 6 * U);
      }
      g.lineTo(w, base);
      g.closePath();
      g.fill();
      for (let i = 0; i < 3; i++) {
        g.fillStyle = i % 2 === 0 ? h.accent : h.detail;
        g.beginPath();
        g.arc(-w * 0.6 + i * w * 0.6, base - 1.2 * U, 0.8 * U, 0, TAU);
        g.fill();
      }
      break;
    }
    default:
      break;
  }
  g.restore();
}

function roundBand(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------------------------------------------------------------------------------------------
// Death: the melt (600 ms), then the puddle with floating eyes and nose (carrot bobs 1.2 Hz, 2 u).
// ---------------------------------------------------------------------------------------------

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2;
}

function drawMelt(g: CanvasRenderingContext2D, p: NubsPose, a: NubsAnim, looks: Looks): void {
  const U = p.S * NUBS_SCALE;
  const t = Math.min(1, p.melt / 0.6);
  const e = easeInOut(t);
  const lerp = (x: number, y: number): number => x + (y - x) * e;
  g.save();
  g.translate(p.x, p.y);
  // The body slumps from a ball (r 11 at −5) into a 1.6 × 0.35 puddle.
  const bx = 11 * U * (1 + 0.6 * e);
  const by = 11 * U * (1 - 0.65 * e);
  const bodyY = lerp(-5 * U, 1 * U);
  const snow = mix(0xffffff, 0xcfe6ff, 0.25 + 0.45 * e);
  g.fillStyle = css(mix(OUTLINE, 0x2b2140, p.night * 0.5));
  g.beginPath();
  g.ellipse(0, bodyY, bx + 1.1 * U, by + 1.1 * U, 0, 0, TAU);
  g.fill();
  g.fillStyle = css(snow);
  g.beginPath();
  g.ellipse(0, bodyY, bx, by, 0, 0, TAU);
  g.fill();
  // Wet sheen.
  g.fillStyle = cssa(0xffffff, 0.55 + 0.3 * e);
  g.beginPath();
  g.ellipse(-bx * 0.35, bodyY - by * 0.35, bx * 0.28, Math.max(0.6, by * 0.22), -0.2, 0, TAU);
  g.fill();
  // The head sinks into it and shrinks away.
  const hr = 7.5 * U * (1 - 0.8 * e);
  const hy = lerp(-16.5 * U, bodyY - 1 * U);
  if (e < 0.95) {
    g.globalAlpha = 1 - e * e;
    g.fillStyle = css(mix(OUTLINE, 0x2b2140, p.night * 0.5));
    g.beginPath();
    g.arc(0, hy, hr + 1.1 * U, 0, TAU);
    g.fill();
    g.fillStyle = css(snow);
    g.beginPath();
    g.arc(0, hy, hr, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
  }
  // The scarf: a band under the head that slides down and settles across the puddle.
  const s = looks.scarf;
  const scarfColor = s.pattern === 'rainbow' ? (s.stripes[0] as string) : s.main;
  g.strokeStyle = scarfColor;
  g.lineCap = 'round';
  g.lineWidth = 2.6 * U;
  g.beginPath();
  const sy = lerp(hy + hr * 0.9, bodyY + by * 0.25);
  const sw = lerp(hr * 1.05, bx * 0.55);
  g.moveTo(-sw, sy - 0.6 * U);
  g.quadraticCurveTo(0, sy + lerp(1.6 * U, 2.6 * U), sw, sy - 0.6 * U + 1.2 * U * e);
  g.stroke();
  // One tail flops out onto the puddle.
  g.lineWidth = 2.2 * U;
  g.beginPath();
  g.moveTo(sw * 0.6, sy);
  g.quadraticCurveTo(sw * 0.9 + 2 * U * e, sy + 3 * U, sw * 1.15 + 3 * U * e, sy + 2 * U + 1.5 * U * e);
  g.stroke();
  // Coal eyes and nose ride the head down, then float and bob (1.2 Hz, 2 u).
  const bob = t >= 1 ? Math.sin((p.melt - 0.6) * 1.2 * TAU) * 2 * U * 0.5 : 0;
  const ey = lerp(hy - 0.8 * U, bodyY - 1.4 * U) + bob * 0.6;
  g.fillStyle = css(COAL);
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(side * lerp(2.9 * U, 5.5 * U), ey, 1.1 * U, 0, TAU);
    g.fill();
  }
  g.save();
  g.translate(lerp(0, 1.5 * U), lerp(hy + 1.5 * U, bodyY + 0.5 * U) + bob);
  g.rotate(0.45 * e);
  drawNose(g, looks.nose, U, lerp(0, -3 * U), 0, 1, lerp(0.3, 0));
  g.restore();
  void a;
  g.restore();
}

/**
 * Heat squiggles above a lit Nubs: three wavy strokes rising and fading in a loop. Shape-coded (no
 * hue needed) and readable on the palest noon ground, where white steam disappears.
 */
export function drawSizzle(g: CanvasRenderingContext2D, p: NubsPose, time: number, glare: boolean): void {
  if (!p.sunUp || p.f <= 0 || p.melt >= 0) return;
  const size = 0.6 + 0.4 * p.chill;
  const U = p.S * size * NUBS_SCALE;
  const k = Math.min(1, p.f);
  g.lineCap = 'round';
  g.lineWidth = Math.max(1.6, 1.7 * U);
  g.strokeStyle = glare ? '#FF3D3D' : '#FF7A1A';
  for (let i = 0; i < 3; i++) {
    const ph = (time * 1.3 + i / 3) % 1;
    const x = p.x + (i - 1) * 7.5 * U;
    const y0 = p.y - (25 + ph * 10 + (i === 1 ? 3 : 0)) * U;
    const h = 10 * U;
    g.globalAlpha = 0.95 * k * Math.sin(Math.PI * Math.min(1, ph * 1.15));
    g.beginPath();
    for (let j = 0; j <= 8; j++) {
      const t = j / 8;
      const xx = x + Math.sin(t * Math.PI * 2 + time * 9 + i) * 1.6 * U;
      const yy = y0 - t * h;
      if (j === 0) g.moveTo(xx, yy);
      else g.lineTo(xx, yy);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// Offscreen sprite. Nubs is built from two cached layers — back (outline, body, rim) and front
// (head, scarf band, face, hat) — redrawn only when what they show changes: Chill-driven size in
// 1/40 steps, the look direction in 5° steps, per-sample shade tints, lit/night, the face's
// expression, the cosmetics, the scale. Each frame the renderer stamps back layer → scarf tails
// (live spring physics, a few strokes) → front layer, under one transform carrying the walk bob,
// shiver and teardrop wobble; walking alone redraws nothing offscreen.
//
// Some effects need Nubs as one image: the see-through "x-ray" stamp when something in front hides
// him (layers stamped at partial alpha would show his outline through his head) and the glare
// flash (source-atop must touch only his pixels). For those, and for the melt, the layers and tails
// are composed into `canvas` once that frame and it is stamped instead.
// ---------------------------------------------------------------------------------------------

/** Sprite box in world u: 80 wide, 84 tall, ground point at (40, 64). */
const BOX_W = 80;
const BOX_H = 84;
const ORIGIN_X = 40;
const ORIGIN_Y = 64;
/** Quantization of the cached layers' inputs. */
const CHILL_STEPS = 40;
const LOOK_STEP_DEG = 5;
const NIGHT_STEPS = 32;

export interface NubsSprite {
  /** The composed image (x-ray, glare flash, melt). */
  canvas: Canvas2D;
  g: CanvasRenderingContext2D;
  /** Device px per world u the sprite was drawn at. */
  scale: number;
  /** Cached layers and what they were drawn for. */
  back: Canvas2D;
  backG: CanvasRenderingContext2D;
  front: Canvas2D;
  frontG: CanvasRenderingContext2D;
  key: number;
  keyShade: number;
  keyLooks: Looks | null;
  /** This frame: draw from the composed canvas (melt, glare flash), and whether it is up to date. */
  whole: boolean;
  composed: boolean;
  /** This frame's inputs for the tails (layer space, device px). */
  anim: NubsAnim | null;
  looks: Looks | null;
  readonly geom: Geom;
  /** Whole-sprite motion for stamping: scale, rotation (rad) and x jitter (CSS px). */
  sx: number;
  sy: number;
  rot: number;
  jx: number;
  /** Layer redraws and compositions so far (perf checks). */
  layerDraws: number;
  composes: number;
}

export function createNubsSprite(): NubsSprite {
  const canvas = makeCanvas(2, 2);
  const back = makeCanvas(2, 2);
  const front = makeCanvas(2, 2);
  return {
    canvas,
    g: ctx2d(canvas),
    scale: 1,
    back,
    backG: ctx2d(back),
    front,
    frontG: ctx2d(front),
    key: NaN,
    keyShade: -1,
    keyLooks: null,
    whole: false,
    composed: false,
    anim: null,
    looks: null,
    geom: { U: 1, low: false, bodyY: 0, bodyR: 1, headY: 0, headR: 1 },
    sx: 1,
    sy: 1,
    rot: 0,
    jx: 0,
    layerDraws: 0,
    composes: 0,
  };
}

const spritePose = createPose();

function prepare(c: Canvas2D, g: CanvasRenderingContext2D, w: number, h: number, ox: number, oy: number): void {
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  g.setTransform(1, 0, 0, 1, ox, oy);
}

/**
 * Prepares this frame's sprite for the pose at `pxPerU` device px per u: refreshes the cached
 * layers if needed (see the note above) and, for the melt or a glare flash, composes the image.
 */
export function renderNubsSprite(sp: NubsSprite, p: NubsPose, a: NubsAnim, looks: Looks, pxPerU: number): void {
  const w = Math.ceil(BOX_W * pxPerU);
  const h = Math.ceil(BOX_H * pxPerU);
  const ox = ORIGIN_X * pxPerU;
  const oy = ORIGIN_Y * pxPerU;
  const resized = sp.back.width !== w || sp.back.height !== h || sp.scale !== pxPerU;
  sp.scale = pxPerU;
  sp.anim = a;
  sp.looks = looks;
  sp.composed = false;

  if (p.melt >= 0) {
    // The melt animates every frame: draw it whole, with no stamping transform.
    prepare(sp.canvas, sp.g, w, h, 0, 0);
    Object.assign(spritePose, p);
    spritePose.x = ox;
    spritePose.y = oy;
    spritePose.S = pxPerU;
    drawNubs(sp.g, spritePose, a, looks);
    sp.sx = sp.sy = 1;
    sp.rot = sp.jx = 0;
    sp.key = NaN;
    sp.whole = true;
    sp.composed = true;
    return;
  }

  const m = nubsMotion(p, a, motion);
  sp.sx = m.sx;
  sp.sy = m.sy;
  sp.rot = m.rot;
  sp.jx = m.jx;

  // The pose the layers are drawn for, with its continuous inputs quantized.
  Object.assign(spritePose, p);
  spritePose.x = 0;
  spritePose.y = 0;
  spritePose.S = pxPerU;
  const chillQ = Math.round(Math.max(0, Math.min(1, p.chill)) * CHILL_STEPS);
  spritePose.chill = chillQ / CHILL_STEPS;
  // Keep the teardrop switch exact (it changes the body shape).
  if (p.chill < 0.3 !== spritePose.chill < 0.3) spritePose.chill = p.chill < 0.3 ? 0.299 : 0.3;
  const steps = 360 / LOOK_STEP_DEG;
  const lookQ = ((Math.round((Math.atan2(p.lookY, p.lookX) * steps) / TAU) % steps) + steps) % steps;
  const la = (lookQ * TAU) / steps;
  spritePose.lookX = Math.cos(la);
  spritePose.lookY = Math.sin(la);
  const nightQ = Math.round(Math.max(0, Math.min(1, p.night)) * NIGHT_STEPS);
  spritePose.night = nightQ / NIGHT_STEPS;
  const lit = p.f > 0 && p.sunUp ? 1 : 0;
  const glare = p.w0 === 2 || p.w1 === 2 || p.w2 === 2 || p.w3 === 2 || p.w4 === 2 ? 1 : 0;
  const tints = (p.w0 === 0 ? 1 : 0) | (p.w1 === 0 ? 2 : 0) | (p.w2 === 0 ? 4 : 0) | (p.w3 === 0 ? 8 : 0) | (p.w4 === 0 ? 16 : 0);
  const blink = a.blink > 0 ? 1 : 0;
  const happy = a.happy > 0 || a.phew > 0 ? 1 : 0;
  const low = spritePose.chill < 0.3 ? 1 : 0;
  const key =
    ((((((((chillQ * 72 + lookQ) * 32 + tints) * 33 + nightQ) * 2 + lit) * 2 + glare) * 2 + blink) * 2 + happy) * 2 + low) * 2 +
    (p.sunUp ? 1 : 0);

  const G = nubsGeom(spritePose, sp.geom);
  if (resized || key !== sp.key || p.shade !== sp.keyShade || looks !== sp.keyLooks) {
    sp.key = key;
    sp.keyShade = p.shade;
    sp.keyLooks = looks;
    prepare(sp.back, sp.backG, w, h, ox, oy);
    drawBackLayer(sp.backG, spritePose, G);
    prepare(sp.front, sp.frontG, w, h, ox, oy);
    drawFrontLayer(sp.frontG, spritePose, a, looks, G);
    sp.layerDraws++;
  }
  // The glare flash must touch only Nubs' pixels: compose him whole while it shows.
  sp.whole = a.glare > 0;
  if (sp.whole) compose(sp);
}

/** Composes back layer, tails, front layer (and the glare flash) into sp.canvas, once per frame. */
function compose(sp: NubsSprite): void {
  if (sp.composed) return;
  const back = sp.back;
  const ox = ORIGIN_X * sp.scale;
  const oy = ORIGIN_Y * sp.scale;
  prepare(sp.canvas, sp.g, back.width, back.height, 0, 0);
  const g = sp.g;
  g.drawImage(back, 0, 0);
  g.setTransform(1, 0, 0, 1, ox, oy);
  drawTailsLayer(g, spritePose, sp.anim as NubsAnim, sp.looks as Looks, sp.geom);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(sp.front, 0, 0);
  g.setTransform(1, 0, 0, 1, ox, oy);
  drawGlareFlash(g, sp.anim as NubsAnim, sp.geom);
  sp.composed = true;
  sp.composes++;
}

/**
 * Stamps Nubs at his ground point (CSS px) with the current globalAlpha: the layers and tails
 * directly, or the composed image for the melt, the glare flash and see-through (alpha < 1) stamps.
 */
export function drawNubsSprite(g: CanvasRenderingContext2D, sp: NubsSprite, x: number, y: number, dpr: number): void {
  const k = 1 / dpr;
  const whole = sp.whole || g.globalAlpha < 1;
  if (whole) compose(sp);
  const src = whole ? sp.canvas : sp.back;
  const w = src.width;
  const h = src.height;
  const ox = ORIGIN_X * sp.scale;
  const oy = ORIGIN_Y * sp.scale;
  g.save();
  g.translate(x + sp.jx, y);
  if (sp.rot !== 0) g.rotate(sp.rot);
  // Device px from here on, like the layers.
  g.scale(sp.sx * k, sp.sy * k);
  g.drawImage(src, -ox, -oy, w, h);
  if (!whole) {
    drawTailsLayer(g, spritePose, sp.anim as NubsAnim, sp.looks as Looks, sp.geom);
    g.drawImage(sp.front, -ox, -oy, w, h);
  }
  g.restore();
}

/** Nubs' screen-space box (CSS px) around a ground point, for occlusion tests. */
export function nubsBox(x: number, y: number, S: number, out: Float64Array): void {
  out[0] = x - 16 * S;
  out[1] = y - 34 * S;
  out[2] = x + 16 * S;
  out[3] = y + 8 * S;
}

// ---------------------------------------------------------------------------------------------
// Wardrobe preview
// ---------------------------------------------------------------------------------------------

const previewAnim = createNubsAnim();
const previewPose = createPose();

/** Draws Nubs wearing `equipped` into a preview canvas (backing store already CSS × DPR). */
export function renderWardrobePreview(canvas: HTMLCanvasElement, equipped: Equipped): void {
  const g = ctx2d(canvas);
  const w = canvas.width;
  const h = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  // Soft snowy spotlight.
  const grad = g.createRadialGradient(w / 2, h * 0.78, 0, w / 2, h * 0.78, w * 0.5);
  grad.addColorStop(0, 'rgba(201,214,242,0.75)');
  grad.addColorStop(1, 'rgba(201,214,242,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(52,48,107,0.12)';
  g.beginPath();
  g.ellipse(w / 2, h * 0.8, w * 0.22, h * 0.05, 0, 0, TAU);
  g.fill();
  const pose = previewPose;
  pose.x = w / 2;
  pose.y = h * 0.8;
  pose.S = h / 64;
  pose.chill = 1;
  pose.w0 = 0;
  pose.w1 = 0;
  pose.w2 = 0;
  pose.w3 = 0;
  pose.w4 = 0;
  pose.f = 0;
  pose.lookX = 0.55;
  pose.lookY = 0.35;
  pose.sunUp = true;
  pose.walking = false;
  pose.melt = -1;
  pose.night = 0;
  pose.shade = hex('#E8EEFA');
  resetNubsAnim(previewAnim);
  previewAnim.happy = 1;
  for (let i = 0; i < 30; i++) updateNubsAnim(previewAnim, 1 / 30, pose.x, pose.S, false, 0);
  drawNubs(g, pose, previewAnim, looksFor(equipped));
}

/** Lightens/darkens helper kept for callers that tint Nubs-adjacent props. */
export function snowTint(t: number): Rgb {
  return t >= 0 ? lighten(SNOW_RIM, t) : darken(SNOW_RIM, -t);
}
