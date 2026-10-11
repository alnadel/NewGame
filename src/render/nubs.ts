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
  const r = 9 * p.S;
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

let cachedEquip = '';
let cachedLooks: Looks | null = null;

export function looksFor(e: Equipped): Looks {
  const key = `${e.scarf}|${e.hat}|${e.nose}`;
  if (key !== cachedEquip || !cachedLooks) {
    cachedEquip = key;
    cachedLooks = equippedLooks(e);
  }
  return cachedLooks;
}

/** Draws Nubs at pose p. `U` is px per local unit (S × visual size × 0.9). */
export function drawNubs(g: CanvasRenderingContext2D, p: NubsPose, a: NubsAnim, looks: Looks): void {
  if (p.melt >= 0) {
    drawMelt(g, p, a, looks);
    return;
  }
  const size = 0.6 + 0.4 * p.chill;
  // Visual scale 1.15 (V1_PLAN asks 0.9; at 360 u per screen width that read as a 20 px speck).
  const U = p.S * size * NUBS_SCALE;
  const low = p.chill < 0.3;
  // Walk bob (scaleY 1 ± 0.04), shiver squash (1.12 / 0.90 easing back over 140 ms).
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
  const wob = low && !p.reducedMotion ? (4 * Math.PI) / 180 * Math.sin(p.time * 9) : 0;
  const shiverJitter = a.shiver > 0 && !p.reducedMotion ? Math.sin(p.time * 90) * 0.6 * U : 0;

  g.save();
  g.translate(p.x + shiverJitter, p.y);
  g.rotate(wob);
  g.scale(sx, sy);

  const bodyY = -5 * U;
  const bodyR = 11 * U;
  const headY = (low ? -13 : -16.5) * U;
  const headR = 7.5 * U;
  const lx = p.lookX;
  const ly = p.lookY;

  // Partial shade per sample: shaded (w 0) samples tint that side cool.
  const shadeL = p.w2 === 0 ? 1 : 0;
  const shadeR = p.w1 === 0 ? 1 : 0;
  const shadeC = p.w0 === 0 ? 1 : 0;
  const shadeN = p.w3 === 0 ? 1 : 0;
  const shadeS = p.w4 === 0 ? 1 : 0;
  const sunK = p.sunUp ? 1 : 0;
  const tintOf = (s: number): Rgb => mix(SNOW, p.shade, (0.15 + 0.85 * s) * (sunK ? 1 : 0.6) * (1 - p.night * 0.3));
  const glareFlash = a.glare > 0 ? a.glare / 0.25 : 0;

  // Body: left/center/right tint gradient, then a sun-side highlight and a cool rim away from the sun.
  const bottomS = shadeS * 0.5;
  const bodyGrad = g.createLinearGradient(-bodyR, 0, bodyR, 0);
  bodyGrad.addColorStop(0, css(tintOf(Math.max(shadeL, bottomS))));
  bodyGrad.addColorStop(0.5, css(tintOf(Math.max(shadeC, bottomS))));
  bodyGrad.addColorStop(1, css(tintOf(Math.max(shadeR, bottomS))));
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
  rimAndHighlight(g, 0, bodyY, bodyR, lx, ly, p.f > 0 && p.sunUp, low);

  // Scarf tails behind the head, below the knot.
  drawScarfTails(g, a, looks.scarf, U, headY + headR * 0.75, lx);

  // Head.
  g.fillStyle = css(tintOf(Math.max(shadeN, shadeC * 0.6)));
  g.beginPath();
  g.arc(0, headY, headR, 0, TAU);
  g.fill();
  rimAndHighlight(g, 0, headY, headR, lx, ly, p.f > 0 && p.sunUp, false);

  // Scarf band around the neck.
  drawScarfBand(g, looks.scarf, U, headY + headR * 0.78, headR * 1.1, lx);

  // Face.
  drawFace(g, p, a, U, headY, headR, looks.nose);
  drawHat(g, looks.hat, U, headY, headR, lx);

  if (glareFlash > 0) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = cssa(0xffb36b, 0.55 * glareFlash);
    g.fillRect(-bodyR * 2, headY - headR * 2, bodyR * 4, bodyR * 4);
    g.globalCompositeOperation = 'source-over';
  }
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
  g.save();
  g.translate(p.x, p.y);
  // Puddle.
  const pw = 11 * U * (1 + 0.6 * e);
  const ph = 11 * U * (1 - 0.65 * e);
  const py = -4.5 * U * (1 - e);
  g.fillStyle = css(mix(0xffffff, 0xcfe6ff, 0.35 + 0.4 * e));
  g.strokeStyle = cssa(OUTLINE, 0.9);
  g.lineWidth = Math.max(1, 1.1 * U);
  g.beginPath();
  g.ellipse(0, py, pw, ph, 0, 0, TAU);
  g.fill();
  g.stroke();
  // Puddle highlight.
  g.fillStyle = cssa(0xffffff, 0.8);
  g.beginPath();
  g.ellipse(-pw * 0.35, py - ph * 0.3, pw * 0.25, ph * 0.18 + 0.5, -0.2, 0, TAU);
  g.fill();
  // The head slides down into the puddle and shrinks away.
  const hr = 7.5 * U * (1 - 0.85 * e);
  const hy = (-16.5 + 15.5 * e) * U;
  if (hr > 0.4) {
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(0, hy, hr, 0, TAU);
    g.fill();
  }
  // Scarf left on the puddle.
  const s = looks.scarf;
  g.strokeStyle = s.pattern === 'rainbow' ? (s.stripes[0] as string) : s.main;
  g.lineWidth = 2.4 * U;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-pw * 0.6, py + ph * 0.1);
  g.quadraticCurveTo(-pw * 0.1, py + ph * 0.9, pw * 0.5, py + ph * 0.2);
  g.stroke();
  // Floating coal eyes and nose, bobbing once melted.
  const bob = t >= 1 ? Math.sin((p.melt - 0.6) * 1.2 * TAU) * 2 * U * 0.5 : 0;
  g.fillStyle = css(COAL);
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(side * (2.9 + 1.5 * e) * U, hy * (1 - e) + py * e - 0.5 * U + bob * 0.6, 1.1 * U, 0, TAU);
    g.fill();
  }
  const nose = looks.nose;
  g.save();
  g.translate(2 * U * e, py + bob - 1 * U * e);
  g.rotate(0.5 * e);
  drawNose(g, nose, U, -3 * U, 0, 1, 0);
  g.restore();
  void a;
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Offscreen sprite: Nubs is drawn into his own small canvas each frame, so effects that composite
// against him (the glare flash) only touch his pixels, and the renderer can stamp him twice (the
// depth-sorted pass, then a see-through "x-ray" pass when something in front hides him).
// ---------------------------------------------------------------------------------------------

/** Sprite box in world u: 80 wide, 84 tall, ground point at (40, 64). */
const BOX_W = 80;
const BOX_H = 84;
const ORIGIN_X = 40;
const ORIGIN_Y = 64;

export interface NubsSprite {
  canvas: Canvas2D;
  g: CanvasRenderingContext2D;
  /** Device px per world u the sprite was drawn at. */
  scale: number;
}

export function createNubsSprite(): NubsSprite {
  const canvas = makeCanvas(2, 2);
  return { canvas, g: ctx2d(canvas), scale: 1 };
}

const spritePose = createPose();

/** Renders the pose into the sprite at `pxPerU` device pixels per u. */
export function renderNubsSprite(sp: NubsSprite, p: NubsPose, a: NubsAnim, looks: Looks, pxPerU: number): void {
  const w = Math.ceil(BOX_W * pxPerU);
  const h = Math.ceil(BOX_H * pxPerU);
  if (sp.canvas.width !== w || sp.canvas.height !== h) {
    sp.canvas.width = w;
    sp.canvas.height = h;
  }
  sp.scale = pxPerU;
  const g = sp.g;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  Object.assign(spritePose, p);
  spritePose.x = ORIGIN_X * pxPerU;
  spritePose.y = ORIGIN_Y * pxPerU;
  spritePose.S = pxPerU;
  drawNubs(g, spritePose, a, looks);
}

/** Stamps the sprite at Nubs' ground point (CSS px) with the current globalAlpha. */
export function drawNubsSprite(g: CanvasRenderingContext2D, sp: NubsSprite, x: number, y: number, dpr: number): void {
  const k = 1 / dpr;
  g.drawImage(sp.canvas, x - ORIGIN_X * sp.scale * k, y - ORIGIN_Y * sp.scale * k, sp.canvas.width * k, sp.canvas.height * k);
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
