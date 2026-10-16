// The edge sun mascot (GDD §10, V1_PLAN §9): a decorative sun in sunglasses riding a rounded
// rectangle inset from the viewport edges, on the ray from Nubs toward θ. Its face follows Chill
// (smug ≥ 60, worried 30-60, horrified < 30), sighs on a PHEW, squashes on a catch, turns away
// guiltily when Nubs melts, sinks at sunset, and becomes the moon at night. Its top run stays
// below the HUD band. Around noon it turns boss (GR10): it swells, its rays flare and flicker over
// a second, counter-turning orange corona, and it pushes its shades up to glare and grin.

import { smoothstep } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import type { ShadesLook } from '../meta/content.ts';
import { ctx2d, radialSprite } from './sprites.ts';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export type SunMood = 'smug' | 'worried' | 'horrified' | 'relief' | 'guilty' | 'boss';

/**
 * How much of a boss the sun is (0..1): up from 11:00 to 11:30, down from 12:36 to 1:00 PM (a
 * Heat Wave widens it to 10:30-1:30).
 */
export function bossWeight(dayFrac: number, heat: boolean): number {
  return smoothstep(heat ? 0.375 : 0.417, 0.458, dayFrac) * (1 - smoothstep(0.55, heat ? 0.625 : 0.583, dayFrac));
}

export interface SunGlyph {
  x: number;
  y: number;
  /** The moon rides the opposite side of the dial (θ + 180°). */
  mx: number;
  my: number;
  /** Eased screen position (smooths jumps around corners). */
  init: boolean;
  /** Night 0..1 (moon). */
  night: number;
  squash: number;
  guilty: number;
}

export function createSunGlyph(): SunGlyph {
  return { x: 0, y: 0, mx: 0, my: 0, init: false, night: 0, squash: 0, guilty: 0 };
}

const out = new Float64Array(2);

/**
 * Where the ray from (px, py) in direction (dx, dy) leaves the rounded rect [x0, x1] × [y0, y1]
 * with corner radius r. Writes the point into `out`.
 */
export function rayRoundRect(px: number, py: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number, r: number, o: Float64Array): void {
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (x1 - px) / dx);
  if (dx < -1e-9) t = Math.min(t, (x0 - px) / dx);
  if (dy > 1e-9) t = Math.min(t, (y1 - py) / dy);
  if (dy < -1e-9) t = Math.min(t, (y0 - py) / dy);
  if (!Number.isFinite(t) || t < 0) t = 0;
  let hx = px + dx * t;
  let hy = py + dy * t;
  // Corner zones: intersect with the corner circle instead.
  const cxs = hx < x0 + r ? x0 + r : hx > x1 - r ? x1 - r : NaN;
  const cys = hy < y0 + r ? y0 + r : hy > y1 - r ? y1 - r : NaN;
  if (!Number.isNaN(cxs) && !Number.isNaN(cys)) {
    const fx = px - cxs;
    const fy = py - cys;
    const b = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - r * r;
    const disc = b * b - c;
    if (disc >= 0) {
      const tt = -b + Math.sqrt(disc);
      hx = px + dx * tt;
      hy = py + dy * tt;
    }
  }
  o[0] = hx;
  o[1] = hy;
}

/** Updates the glyph's position for screen direction (dx, dy) from Nubs' screen point. */
export function placeSun(s: SunGlyph, v: View, nx: number, ny: number, dx: number, dy: number, dt: number, hudBand: number): void {
  const inset = 26;
  const x0 = v.vx + inset + v.safe.left;
  const x1 = v.vx + v.vw - inset - v.safe.right;
  const y0 = Math.max(v.vy + inset + v.safe.top, hudBand);
  const y1 = v.vy + v.vh - inset - v.safe.bottom;
  const py = Math.min(Math.max(ny, y0 + 1), y1 - 1);
  rayRoundRect(nx, py, dx, dy, x0, y0, x1, y1, 40, out);
  const k = !s.init || dt <= 0 ? 1 : Math.min(1, dt * 30);
  s.x += ((out[0] as number) - s.x) * k;
  s.y += ((out[1] as number) - s.y) * k;
  rayRoundRect(nx, py, -dx, -dy, x0, y0, x1, y1, 40, out);
  s.mx += ((out[0] as number) - s.mx) * k;
  s.my += ((out[1] as number) - s.my) * k;
  s.init = true;
}

/**
 * Draws the sun (or moon) at the glyph position, wearing `shades`. `scale` multiplies the 20 px core
 * radius; `boss` (bossWeight) swells it. A Moonlit level (v1.2) puts the moon in the sun's place;
 * `eclipse` (0..1) slides a dark disc over the sun, leaving a thin corona.
 */
export function drawSun(
  g: CanvasRenderingContext2D,
  s: SunGlyph,
  mood: SunMood,
  time: number,
  scale: number,
  alpha: number,
  guiltDx: number,
  boss: number,
  shades: ShadesLook,
  moonlit = false,
  eclipse = 0,
): void {
  if (alpha <= 0.01) return;
  const night = s.night;
  const r = 20 * scale * (1 + 0.35 * boss);
  // Guilty: it turns away and slides 24 px toward the edge.
  const gx = s.x + guiltDx * 24 * s.guilty;
  const gy = s.y;
  if (moonlit) {
    // The moon sun: it rides where the sun would, and its light is the light.
    drawMoon(g, gx, gy, r * 0.9, alpha, time);
    return;
  }
  if (night > 0.01) drawMoon(g, s.mx, s.my, r * 0.8, alpha * night, time);
  const a = alpha * (1 - 0.8 * night);
  if (a <= 0.01) return;
  // Bloom: α 0.42, up to 0.62 as a boss.
  const bloom = radialSprite('255,181,71', 256, 0.62, 0.4, 0.236);
  g.globalAlpha = a * ((0.42 + 0.2 * boss) / 0.62);
  g.drawImage(bloom, gx - r * 3, gy - r * 3, r * 6, r * 6);
  g.globalAlpha = a;
  g.save();
  g.translate(gx, gy);
  const sq = 1 - 0.1 * Math.min(1, s.squash / 0.08);
  g.scale(1 / sq, sq);
  if (boss > 0.01) {
    // The boss corona: 12 orange rays between the main ones, turning the other way at 20°/s.
    g.rotate(-time * 20 * DEG);
    g.globalAlpha = a * 0.6 * boss;
    g.fillStyle = '#FF8A3D';
    g.beginPath();
    for (let i = 0; i < 12; i++) {
      const ang = ((i + 0.5) * TAU) / 12;
      const tip = (1.4 + 0.6 * boss) * r;
      g.moveTo(Math.cos(ang - 0.16) * r * 1.05, Math.sin(ang - 0.16) * r * 1.05);
      g.lineTo(Math.cos(ang) * tip, Math.sin(ang) * tip);
      g.lineTo(Math.cos(ang + 0.16) * r * 1.05, Math.sin(ang + 0.16) * r * 1.05);
    }
    g.fill();
    g.rotate(time * 20 * DEG);
    g.globalAlpha = a;
  }
  // Rays rotating at 10°/s; a boss's reach further and flicker.
  g.rotate(time * 10 * DEG);
  g.fillStyle = '#FFD36B';
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const ang = (i * TAU) / 12;
    const tip = (1.62 + 0.5 * boss) * r * (1 + 0.08 * boss * Math.sin(time * 14 + 1.7 * i));
    g.moveTo(Math.cos(ang - 0.19) * r * 1.1, Math.sin(ang - 0.19) * r * 1.1);
    g.lineTo(Math.cos(ang) * tip, Math.sin(ang) * tip);
    g.lineTo(Math.cos(ang + 0.19) * r * 1.1, Math.sin(ang + 0.19) * r * 1.1);
  }
  g.fill();
  g.rotate(-time * 10 * DEG);
  // Guilty turn: rotate away 35°.
  g.rotate(s.guilty * 35 * DEG * Math.sign(guiltDx || 1));
  g.fillStyle = '#FFE27A';
  g.strokeStyle = '#FFC94A';
  g.lineWidth = r * 0.1;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
  g.stroke();
  drawFace(g, r, mood, time, s.guilty, shades);
  g.restore();
  if (eclipse > 0.01) drawEclipse(g, gx, gy, r, eclipse, a, time);
  g.globalAlpha = 1;
}

/**
 * The eclipse over the sun: a dark disc slides in from the right (fully over the sun at e = 1)
 * behind a soft white corona that brightens as the disc covers the face.
 */
function drawEclipse(g: CanvasRenderingContext2D, x: number, y: number, r: number, e: number, a: number, time: number): void {
  const cover = smoothstep(0, 1, e);
  const corona = radialSprite('236,240,255', 128, 0.55, 0.45, 0.2);
  const cr = r * (1.9 + 0.12 * Math.sin(time * 3));
  g.globalAlpha = a * cover * 0.9;
  g.drawImage(corona, x - cr, y - cr, 2 * cr, 2 * cr);
  g.globalAlpha = a;
  g.fillStyle = '#1A1633';
  g.beginPath();
  g.arc(x + (1 - cover) * r * 2.3, y, r * 1.06, 0, TAU);
  g.fill();
  // A thin bright rim once it is centred.
  if (cover > 0.85) {
    g.strokeStyle = `rgba(255,246,214,${(cover - 0.85) / 0.15})`;
    g.lineWidth = Math.max(1, r * 0.08);
    g.beginPath();
    g.arc(x, y, r * 1.08, 0, TAU);
    g.stroke();
  }
}

function drawFace(g: CanvasRenderingContext2D, r: number, mood: SunMood, time: number, guilty: number, shades: ShadesLook): void {
  const u = r;
  // Glasses slip down when horrified, go up on the forehead for the boss; look aside when guilty.
  const boss = mood === 'boss';
  const slip = mood === 'horrified' ? 0.14 + 0.03 * Math.sin(time * 14) : boss ? -0.5 : 0;
  const look = guilty * 0.32;
  // Cheeks.
  g.fillStyle = 'rgba(255,158,107,0.5)';
  for (let sd = -1; sd <= 1; sd += 2) {
    g.beginPath();
    g.ellipse(sd * 0.52 * u + look * u, 0.3 * u, 0.17 * u, 0.1 * u, 0, 0, TAU);
    g.fill();
  }
  if (boss) {
    // Glaring eyes under two angry brows slanting inward (0.5 r, 3 px).
    g.fillStyle = '#2B2140';
    g.beginPath();
    g.ellipse(-0.36 * u, 0.02 * u, 0.1 * u, 0.13 * u, 0, 0, TAU);
    g.moveTo(0.46 * u, 0.02 * u);
    g.ellipse(0.36 * u, 0.02 * u, 0.1 * u, 0.13 * u, 0, 0, TAU);
    g.fill();
    g.strokeStyle = '#7A3B00';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-0.6 * u, -0.27 * u);
    g.lineTo(-0.13 * u, -0.12 * u);
    g.moveTo(0.6 * u, -0.27 * u);
    g.lineTo(0.13 * u, -0.12 * u);
    g.stroke();
  }
  // The shades (any of the five shapes) ride the slip, the boss push-up and the look-aside.
  g.save();
  g.translate(look * u, slip * u);
  if (boss) g.scale(0.9, 0.9);
  drawShades(g, u, shades);
  if (slip > 0) {
    // Wide eyes peeking over the slipped glasses.
    g.fillStyle = '#FFFFFF';
    for (let sd = -1; sd <= 1; sd += 2) {
      g.beginPath();
      g.arc(sd * 0.4 * u, -0.32 * u - slip * u, 0.13 * u, 0, TAU);
      g.fill();
      g.fillStyle = '#1E1E28';
      g.beginPath();
      g.arc(sd * 0.4 * u, -0.32 * u - slip * u, 0.06 * u, 0, TAU);
      g.fill();
      g.fillStyle = '#FFFFFF';
    }
  }
  g.restore();
  // Mouth.
  g.strokeStyle = '#7A3B00';
  g.fillStyle = '#7A3B00';
  g.lineWidth = 0.085 * u;
  g.lineCap = 'round';
  const mx = look * u;
  g.beginPath();
  switch (mood) {
    case 'smug':
      g.moveTo(mx - 0.3 * u, 0.4 * u);
      g.quadraticCurveTo(mx + 0.02 * u, 0.6 * u, mx + 0.32 * u, 0.36 * u);
      g.quadraticCurveTo(mx + 0.38 * u, 0.31 * u, mx + 0.41 * u, 0.25 * u);
      g.stroke();
      break;
    case 'worried':
      g.moveTo(mx - 0.26 * u, 0.46 * u);
      g.quadraticCurveTo(mx, 0.4 * u, mx + 0.26 * u, 0.46 * u);
      g.stroke();
      sweatDrop(g, u, time);
      break;
    case 'horrified':
      g.ellipse(mx, 0.48 * u, 0.15 * u, 0.2 * u, 0, 0, TAU);
      g.fill();
      break;
    case 'relief':
      g.moveTo(mx - 0.28 * u, 0.42 * u);
      g.quadraticCurveTo(mx, 0.56 * u, mx + 0.28 * u, 0.42 * u);
      g.stroke();
      // A little "phew" puff.
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.beginPath();
      g.arc(mx + 0.55 * u, 0.5 * u, 0.1 * u, 0, TAU);
      g.arc(mx + 0.72 * u, 0.44 * u, 0.07 * u, 0, TAU);
      g.fill();
      break;
    case 'guilty':
      g.moveTo(mx - 0.22 * u, 0.5 * u);
      g.quadraticCurveTo(mx, 0.38 * u, mx + 0.22 * u, 0.5 * u);
      g.stroke();
      sweatDrop(g, u, time);
      break;
    case 'boss':
      // A wide grin with a row of white teeth.
      g.moveTo(mx - 0.38 * u, 0.3 * u);
      g.quadraticCurveTo(mx, 0.8 * u, mx + 0.38 * u, 0.3 * u);
      g.closePath();
      g.fill();
      g.fillStyle = '#FFFFFF';
      g.fillRect(mx - 0.27 * u, 0.32 * u, 0.54 * u, 0.1 * u);
      break;
  }
}

/** Each look's lens fill: lens at the top to lens2 at the bottom, in lens units (built once). */
const lensFills = new Map<ShadesLook, CanvasGradient>();

function lensFill(g: CanvasRenderingContext2D, k: ShadesLook): CanvasGradient {
  let f = lensFills.get(k);
  if (!f) {
    f = g.createLinearGradient(0, -0.2, 0, 0.3);
    f.addColorStop(0, k.lens);
    f.addColorStop(1, k.lens2);
    lensFills.set(k, f);
  }
  return f;
}

/** One lens in lens units (centre at the origin, +x away from the nose). */
function lensPath(g: CanvasRenderingContext2D, shape: ShadesLook['shape']): void {
  g.beginPath();
  switch (shape) {
    case 'round':
      g.arc(0, 0.02, 0.27, 0, TAU);
      break;
    case 'aviator':
      // A teardrop drooping toward the nose.
      g.moveTo(-0.34, -0.15);
      g.quadraticCurveTo(0, -0.21, 0.33, -0.15);
      g.quadraticCurveTo(0.38, 0.14, 0.02, 0.28);
      g.quadraticCurveTo(-0.3, 0.3, -0.34, -0.15);
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? 0.34 : 0.15;
        if (i === 0) g.moveTo(Math.cos(a) * rr, 0.04 + Math.sin(a) * rr);
        else g.lineTo(Math.cos(a) * rr, 0.04 + Math.sin(a) * rr);
      }
      break;
    case 'heart':
      g.moveTo(0, 0.29);
      g.bezierCurveTo(-0.44, 0.03, -0.27, -0.32, 0, -0.1);
      g.bezierCurveTo(0.27, -0.32, 0.44, 0.03, 0, 0.29);
      break;
    default:
      // Classic wayfarers (the v1.0 lenses).
      g.moveTo(-0.34, -0.15);
      g.lineTo(0.3, -0.15);
      g.quadraticCurveTo(0.37, -0.15, 0.35, -0.05);
      g.quadraticCurveTo(0.3, 0.21, 0.03, 0.22);
      g.quadraticCurveTo(-0.29, 0.22, -0.35, -0.02);
      g.quadraticCurveTo(-0.37, -0.15, -0.34, -0.15);
      break;
  }
  g.closePath();
}

/** The sun's shades at face size `u`: frame bar or bridge and temples, two lenses, two glints. */
function drawShades(g: CanvasRenderingContext2D, u: number, k: ShadesLook): void {
  const bar = k.shape === 'classic' || k.shape === 'aviator';
  g.strokeStyle = k.frame;
  g.lineCap = 'round';
  g.lineWidth = 0.09 * u;
  g.beginPath();
  if (bar) {
    g.moveTo(-0.88 * u, -0.25 * u);
    g.quadraticCurveTo(0, -0.33 * u, 0.88 * u, -0.25 * u);
  } else {
    // A small bridge over the nose and the temple arms.
    g.moveTo(-0.16 * u, -0.1 * u);
    g.quadraticCurveTo(0, -0.2 * u, 0.16 * u, -0.1 * u);
    g.moveTo(-0.68 * u, -0.12 * u);
    g.lineTo(-0.9 * u, -0.22 * u);
    g.moveTo(0.68 * u, -0.12 * u);
    g.lineTo(0.9 * u, -0.22 * u);
  }
  g.stroke();
  for (let sd = -1; sd <= 1; sd += 2) {
    g.save();
    g.translate(sd * 0.41 * u, -0.1 * u);
    g.scale(sd * u, u);
    lensPath(g, k.shape);
    g.fillStyle = lensFill(g, k);
    g.fill();
    g.lineWidth = 0.055;
    g.lineJoin = 'round';
    g.stroke();
    // Two glints across the lens.
    g.strokeStyle = k.shine;
    g.globalAlpha *= 0.7;
    g.lineWidth = 0.05;
    g.beginPath();
    g.moveTo(-0.19, 0.02);
    g.lineTo(-0.09, -0.09);
    g.moveTo(-0.08, 0.06);
    g.lineTo(0.0, -0.03);
    g.stroke();
    g.restore();
  }
}

/** A sweat bead at the temple, bobbing. */
function sweatDrop(g: CanvasRenderingContext2D, u: number, time: number): void {
  g.fillStyle = '#9AD8FF';
  g.beginPath();
  g.moveTo(0.78 * u, -0.5 * u + Math.sin(time * 3) * 0.05 * u);
  g.quadraticCurveTo(0.9 * u, -0.3 * u, 0.78 * u, -0.24 * u);
  g.quadraticCurveTo(0.66 * u, -0.3 * u, 0.78 * u, -0.5 * u);
  g.fill();
}

/**
 * v1.6 Heat Flare on the sun (unlike the noon boss it never swells, and never flashes): through the
 * warning a ring of twelve white-hot ticks counts down around it (one goes out every twelfth of
 * the warning; it turns slowly) while a white glow gathers; through the rise and hold a steady white-hot
 * ring, fading over the fall. Reduced motion: the ring only.
 */
let flareGlow: CanvasImageSource | null = null;

export function drawFlareCue(g: CanvasRenderingContext2D, s: SunGlyph, scale: number, phase: number, left: number, t: number, time: number, rm: boolean): void {
  const a = 1 - s.night;
  if (a <= 0.05) return;
  const r = 20 * scale;
  g.beginPath();
  if (phase === 1) {
    if (!rm) {
      g.globalAlpha = a * 0.7 * (1 - left);
      const gr = r * 2.6;
      flareGlow ??= radialSprite('255,247,224', 128, 0.9, 0.3, 0.35);
      g.drawImage(flareGlow, s.x - gr, s.y - gr, gr * 2, gr * 2);
    }
    const rot = rm ? 0 : time * 0.5;
    for (let i = 0; i < left * 12; i++) {
      const ang = rot + (i * TAU) / 12 - Math.PI / 2;
      g.moveTo(s.x + Math.cos(ang) * r * 1.75, s.y + Math.sin(ang) * r * 1.75);
      g.lineTo(s.x + Math.cos(ang) * r * 2.1, s.y + Math.sin(ang) * r * 2.1);
    }
  } else g.arc(s.x, s.y, r * 1.85, 0, TAU);
  g.globalAlpha = a * (phase === 2 ? t : phase === 4 ? 1 - t : 1);
  g.lineCap = 'round';
  g.lineWidth = 5 * scale;
  g.strokeStyle = '#FF6A3D';
  g.stroke();
  g.lineWidth = 2.5 * scale;
  g.strokeStyle = '#FFF4D6';
  g.stroke();
  g.globalAlpha = 1;
  g.lineCap = 'butt';
}

function drawMoon(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, time: number): void {
  const glow = radialSprite('232,236,255', 128, 0.4, 0.4, 0.12);
  g.globalAlpha = a;
  g.drawImage(glow, x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2);
  g.fillStyle = '#E8ECFF';
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  // Craters and a sleepy face.
  g.fillStyle = 'rgba(160,170,220,0.45)';
  g.beginPath();
  g.arc(x - r * 0.35, y - r * 0.35, r * 0.18, 0, TAU);
  g.arc(x + r * 0.42, y + r * 0.3, r * 0.12, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(52,48,107,0.75)';
  g.lineWidth = Math.max(1, r * 0.08);
  g.lineCap = 'round';
  g.beginPath();
  for (let sd = -1; sd <= 1; sd += 2) {
    g.moveTo(x + sd * r * 0.32 - r * 0.12, y - r * 0.02);
    g.quadraticCurveTo(x + sd * r * 0.32, y + r * 0.08, x + sd * r * 0.32 + r * 0.12, y - r * 0.02);
  }
  g.stroke();
  // A tiny "z" every few seconds.
  const zt = (time * 0.4) % 1;
  if (zt < 0.6) {
    g.fillStyle = `rgba(232,236,255,${(0.6 - zt) * 1.5 * a})`;
    g.font = `800 ${Math.round(r * 0.55)}px system-ui, sans-serif`;
    g.fillText('z', x + r * 0.9, y - r * (0.7 + zt));
  }
  g.globalAlpha = 1;
}

const previewGlyph = createSunGlyph();

/**
 * The Wardrobe's Shades preview: the smug sun at 0.8 of the canvas wearing `shades` (backing store
 * already CSS × DPR).
 */
export function renderSunPreview(canvas: HTMLCanvasElement, shades: ShadesLook): void {
  const g = ctx2d(canvas);
  const w = canvas.width;
  const h = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  const s = previewGlyph;
  s.x = w / 2;
  s.y = h / 2;
  s.init = true;
  // The rays reach 1.62 r: fit them in 0.8 of the smaller side.
  const m = Math.min(w, h);
  drawSun(g, s, 'smug', 0, (0.8 * m) / 2 / (1.62 * 20), 1, 1, 0, shades);
  // The bloom reaches 3 r, past the canvas: fade it out beyond the rays so no square edge shows.
  const fade = g.createRadialGradient(w / 2, h / 2, 0.41 * m, w / 2, h / 2, 0.5 * m);
  fade.addColorStop(0, '#000');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = fade;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}
