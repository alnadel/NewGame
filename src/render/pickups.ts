// Pickups and glare spots (GDD §10): spinning snowflakes with a cool glow that shrink and drip as
// they melt, the hexagonal ice crystal, night frost flowers that bloom as Nubs approaches, and the
// gazing-ball glare spot (hot radial disc, rotating hatched ring, faint line back to its ball).

import {
  BALL_Z,
  glareActive,
  glareCenter,
  PICKUP_ALIVE,
  queryBalls,
  queryPickups,
  TUNING,
  type GazingBall,
  type Pickup,
  type World,
} from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { OBLIQUE } from '../game/camera.ts';
import { cssa } from './color.ts';
import { ctx2d, flake, makeCanvas, radialSprite, type Canvas2D } from './sprites.ts';

const TAU = Math.PI * 2;
const MELT = TUNING.pickups.meltBudget;

const buf: Pickup[] = [];

export function drawPickups(g: CanvasRenderingContext2D, v: View, world: World, time: number, nubsY: number, night: number): void {
  const n = queryPickups(world, v.y0 - 20, v.y1 + 20, buf);
  if (n === 0) return;
  const glow = radialSprite('154,216,255', 64, 0.8, 0.35, 0.35);
  const fl = flake();
  for (let i = 0; i < n; i++) {
    const p = buf[i] as Pickup;
    if (p.state !== PICKUP_ALIVE) continue;
    const sx = v.ox + p.x * v.S;
    if (p.kind === 'flower') {
      drawFlower(g, v, p, sx, nubsY, time, night);
      continue;
    }
    const melt = Math.min(1, p.melt / MELT);
    const shrink = 1 - 0.6 * melt;
    const bob = Math.sin(time * 3 + p.id) * 1.5;
    const gy = v.oy - p.y * v.S;
    const z = 8 + bob;
    const sy = v.oy - (p.y + OBLIQUE * z) * v.S;
    // Ground glow.
    const gr = (p.kind === 'crystal' ? 16 : 12) * v.S * (0.6 + 0.4 * shrink);
    g.globalAlpha = 0.75 - 0.4 * melt;
    g.drawImage(glow, sx - gr, gy - gr * 0.6, gr * 2, gr * 1.2);
    g.globalAlpha = 1;
    if (p.kind === 'crystal') {
      drawCrystal(g, v, sx, sy, time + p.id, shrink);
    } else {
      const r = 7 * v.S * shrink;
      g.setTransform(v.dpr, 0, 0, v.dpr, sx * v.dpr, sy * v.dpr);
      g.rotate(time * 1.2 + p.id);
      g.drawImage(fl, -r, -r, r * 2, r * 2);
      g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    }
    if (melt > 0.05) {
      // Drips falling off a melting flake.
      g.fillStyle = cssa(0x7fc8ff, 0.85);
      for (let k = 0; k < 2; k++) {
        const ph = (time * 1.6 + k * 0.5 + p.id * 0.13) % 1;
        const dx = (k === 0 ? -2.2 : 2) * v.S * shrink;
        const dy = ph * (sy < gy ? gy - sy : 6 * v.S);
        const rr = (0.9 + melt) * v.S * (1 - ph * 0.5);
        g.beginPath();
        g.arc(sx + dx, sy + 3 * v.S + dy, rr, 0, TAU);
        g.fill();
      }
    }
  }
}

const hexX = new Float64Array(6);
const hexY = new Float64Array(6);

function drawCrystal(g: CanvasRenderingContext2D, v: View, sx: number, sy: number, t: number, shrink: number): void {
  // A hexagonal prism 10 u tall, slowly turning.
  const r = 6 * v.S * shrink;
  const h = 10 * OBLIQUE * 4 * v.S * shrink * 0.5;
  const a0 = t * 0.8;
  const ptsX = hexX;
  const ptsY = hexY;
  for (let i = 0; i < 6; i++) {
    const a = a0 + (i * TAU) / 6;
    ptsX[i] = sx + Math.cos(a) * r;
    ptsY[i] = sy + Math.sin(a) * r * 0.55 + h / 2;
  }
  // Side faces facing the viewer (lower half of the hexagon).
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    const midY = ((ptsY[i] as number) + (ptsY[j] as number)) / 2 - (sy + h / 2);
    if (midY < -0.01) continue;
    const shade = 0.55 + 0.45 * Math.abs(Math.cos(a0 + ((i + 0.5) * TAU) / 6));
    g.fillStyle = cssa(((Math.round(150 + 60 * shade) << 16) | (Math.round(220 + 25 * shade) << 8) | 255) >>> 0, 0.95);
    g.beginPath();
    g.moveTo(ptsX[i] as number, ptsY[i] as number);
    g.lineTo(ptsX[j] as number, ptsY[j] as number);
    g.lineTo(ptsX[j] as number, (ptsY[j] as number) - h);
    g.lineTo(ptsX[i] as number, (ptsY[i] as number) - h);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#E9FCFF';
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const x = ptsX[i] as number;
    const y = (ptsY[i] as number) - h;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = Math.max(1, 0.8 * v.S);
  g.stroke();
}

let petalSprite: Canvas2D | null = null;

function flowerSprite(): Canvas2D {
  if (petalSprite) return petalSprite;
  const s = 64;
  const c = makeCanvas(s, s);
  const g = ctx2d(c);
  g.translate(s / 2, s / 2);
  for (let i = 0; i < 6; i++) {
    g.save();
    g.rotate((i * TAU) / 6);
    g.fillStyle = '#E6F7FF';
    g.beginPath();
    g.ellipse(0, -13, 7, 13, 0, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(154,216,255,0.8)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -4);
    g.lineTo(0, -20);
    g.stroke();
    g.restore();
  }
  g.fillStyle = '#9AD8FF';
  g.beginPath();
  g.arc(0, 0, 7, 0, TAU);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(-2, -2, 2.5, 0, TAU);
  g.fill();
  petalSprite = c;
  return c;
}

function drawFlower(g: CanvasRenderingContext2D, v: View, p: Pickup, sx: number, nubsY: number, time: number, night: number): void {
  const dy = p.y - nubsY;
  // Three-frame bloom as Nubs approaches.
  const raw = Math.max(0, Math.min(1, (300 - dy) / 160));
  const bloom = raw < 0.33 ? 0.35 : raw < 0.66 ? 0.7 : 1;
  const sy = v.oy - (p.y + 1) * v.S;
  const glow = radialSprite('154,216,255', 64, 0.9, 0.3, 0.3);
  const gr = 20 * v.S * bloom;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.75 * Math.max(0.4, night);
  g.drawImage(glow, sx - gr, sy - gr, gr * 2, gr * 2);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  const r = 10 * v.S * bloom;
  g.setTransform(v.dpr, 0, 0, v.dpr, sx * v.dpr, sy * v.dpr);
  g.rotate(Math.sin(time * 0.8 + p.id) * 0.15 + p.id);
  g.drawImage(flowerSprite(), -r, -r * 0.8, r * 2, r * 1.6);
  g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
}

// ---------------------------------------------------------------------------------------------
// Glare
// ---------------------------------------------------------------------------------------------

let glareSprite: Canvas2D | null = null;

function glareDisc(): Canvas2D {
  if (glareSprite) return glareSprite;
  const s = 128;
  const c = makeCanvas(s, s);
  const g = ctx2d(c);
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,247,194,0.85)');
  grad.addColorStop(0.45, 'rgba(255,214,90,0.62)');
  grad.addColorStop(0.85, 'rgba(255,176,0,0.5)');
  grad.addColorStop(1, 'rgba(255,176,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  glareSprite = c;
  return c;
}

const balls: GazingBall[] = [];
const gc = new Float64Array(2);

export function drawGlare(
  g: CanvasRenderingContext2D,
  v: View,
  world: World,
  ux: number,
  uy: number,
  cot: number,
  eps: number,
  time: number,
): void {
  if (!glareActive(eps) || cot <= 0) return;
  const reach = TUNING.glare.cap + TUNING.glare.radius;
  const n = queryBalls(world, v.y0 - reach, v.y1 + reach, balls);
  if (n === 0) return;
  const R = TUNING.glare.radius;
  const disc = glareDisc();
  for (let i = 0; i < n; i++) {
    const b = balls[i] as GazingBall;
    glareCenter(b, ux, uy, cot, gc);
    const gx = gc[0] as number;
    const gy = gc[1] as number;
    if (gx + R < v.x0 || gx - R > v.x1 || gy + R < v.y0 || gy - R > v.y1) continue;
    const sx = v.ox + gx * v.S;
    const sy = v.oy - gy * v.S;
    const r = R * v.S;
    // Faint beam back to the mirror.
    g.strokeStyle = 'rgba(255,214,90,0.2)';
    g.lineWidth = Math.max(1, 5 * v.S);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(v.ox + b.x * v.S, v.oy - (b.y + OBLIQUE * BALL_Z) * v.S);
    g.lineTo(sx, sy);
    g.stroke();
    const pulse = 1 + 0.06 * Math.sin(time * 9 + b.id);
    g.drawImage(disc, sx - r * pulse * 1.15, sy - r * pulse * 1.15, r * 2.3 * pulse, r * 2.3 * pulse);
    // Hatched ring of 8 dashes rotating at 45°/s: readable without color.
    const rot = (time * Math.PI) / 4;
    g.strokeStyle = '#FF6A3D';
    g.lineWidth = Math.max(1.5, 2.6 * v.S);
    g.lineCap = 'butt';
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = rot + (k * TAU) / 8;
      g.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
      g.arc(sx, sy, r, a, a + TAU / 16);
    }
    g.stroke();
    // Inner hatching: short diagonal strokes.
    g.strokeStyle = 'rgba(255,106,61,0.45)';
    g.lineWidth = Math.max(1, 1.2 * v.S);
    g.beginPath();
    for (let k = -2; k <= 2; k++) {
      const o = k * r * 0.32;
      const half = Math.sqrt(Math.max(0, r * r * 0.55 - o * o));
      g.moveTo(sx + o - half * 0.7, sy - half * 0.7);
      g.lineTo(sx + o + half * 0.7, sy + half * 0.7);
    }
    g.stroke();
  }
}
