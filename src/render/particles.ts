// Pooled particle system (structure of arrays, capacity 400), expanding rings (16) and text pops
// (12) — TECH_SPEC §9.5. Particles are render-only and use Math.random; they never touch the sim.
// World-space kinds live at (x, y, z) in world units; screen-space kinds (confetti, petals) at CSS
// px. Nothing here allocates after construction.

import type { View } from '../game/camera.ts';
import { OBLIQUE } from '../game/camera.ts';
import { cssa, type Rgb } from './color.ts';
import { flake, radialSprite, sparkle, type Canvas2D } from './sprites.ts';

export const P_STEAM = 1;
export const P_DRIP = 2;
export const P_SPARKLE = 3;
export const P_FROST = 4; // ground twinkle in shade
export const P_BURST = 5; // PHEW frost burst shard
export const P_FLAKE_FLY = 6; // collected flake spiralling into Nubs
export const P_FIREFLY = 7;
export const P_CONFETTI = 8; // screen space
export const P_PETAL = 9; // screen space
export const P_PUFF = 10; // melt puff (steam, short)

const CAP = 400;

export interface Particles {
  cap: number;
  /** Governor cap (≤ CAP). */
  limit: number;
  readonly kind: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size0: Float32Array;
  readonly size1: Float32Array;
  readonly rot: Float32Array;
  readonly vrot: Float32Array;
  readonly color: Uint32Array;
  cursor: number;
  count: number;
}

export function createParticles(): Particles {
  return {
    cap: CAP,
    limit: CAP,
    kind: new Uint8Array(CAP),
    x: new Float32Array(CAP),
    y: new Float32Array(CAP),
    z: new Float32Array(CAP),
    vx: new Float32Array(CAP),
    vy: new Float32Array(CAP),
    vz: new Float32Array(CAP),
    life: new Float32Array(CAP),
    maxLife: new Float32Array(CAP),
    size0: new Float32Array(CAP),
    size1: new Float32Array(CAP),
    rot: new Float32Array(CAP),
    vrot: new Float32Array(CAP),
    color: new Uint32Array(CAP),
    cursor: 0,
    count: 0,
  };
}

/** Allocates a slot (recycling the oldest when full). Returns its index. */
export function spawn(
  p: Particles,
  kind: number,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  life: number,
  size0: number,
  size1: number,
  color: Rgb,
): number {
  let i = -1;
  const lim = p.limit;
  for (let k = 0; k < lim; k++) {
    const j = (p.cursor + k) % lim;
    if (p.life[j]! <= 0) {
      i = j;
      break;
    }
  }
  if (i < 0) i = p.cursor % lim;
  p.cursor = (i + 1) % lim;
  p.kind[i] = kind;
  p.x[i] = x;
  p.y[i] = y;
  p.z[i] = z;
  p.vx[i] = vx;
  p.vy[i] = vy;
  p.vz[i] = vz;
  p.life[i] = life;
  p.maxLife[i] = life;
  p.size0[i] = size0;
  p.size1[i] = size1;
  p.rot[i] = Math.random() * Math.PI * 2;
  p.vrot[i] = (Math.random() - 0.5) * 6;
  p.color[i] = color;
  return i;
}

export function clearParticles(p: Particles): void {
  p.life.fill(0);
  p.count = 0;
}

/** Advances every particle by dt game-seconds; flying flakes home in on (nx, ny). */
export function updateParticles(p: Particles, dt: number, nx: number, ny: number, screenH: number): void {
  let count = 0;
  for (let i = 0; i < p.cap; i++) {
    let life = p.life[i]!;
    if (life <= 0) continue;
    life -= dt;
    p.life[i] = life;
    if (life <= 0) continue;
    count++;
    const k = p.kind[i]!;
    if (k === P_FLAKE_FLY) {
      // Spiral in: shrink the offset to Nubs and rotate it.
      const t = 1 - life / p.maxLife[i]!;
      const dx = p.x[i]! - nx;
      const dy = p.y[i]! - ny;
      const a = 9 * dt;
      const keep = Math.max(0, 1 - dt * 7.5);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      p.x[i] = nx + (dx * ca - dy * sa) * keep;
      p.y[i] = ny + (dx * sa + dy * ca) * keep;
      p.z[i] = 10 + 8 * (1 - t);
      p.rot[i] = p.rot[i]! + dt * 12;
      continue;
    }
    p.x[i] = p.x[i]! + p.vx[i]! * dt;
    p.y[i] = p.y[i]! + p.vy[i]! * dt;
    p.z[i] = p.z[i]! + p.vz[i]! * dt;
    p.rot[i] = p.rot[i]! + p.vrot[i]! * dt;
    switch (k) {
      case P_DRIP:
        p.vz[i] = p.vz[i]! - 160 * dt;
        if (p.z[i]! < 0) {
          p.z[i] = 0;
          p.vz[i] = 0;
          p.vx[i] = 0;
          p.vy[i] = 0;
        }
        break;
      case P_BURST:
      case P_SPARKLE: {
        const drag = Math.max(0, 1 - dt * 3.5);
        p.vx[i] = p.vx[i]! * drag;
        p.vy[i] = p.vy[i]! * drag;
        p.vz[i] = p.vz[i]! * drag;
        break;
      }
      case P_FIREFLY:
        p.vx[i] = p.vx[i]! + (Math.random() - 0.5) * 40 * dt;
        p.vy[i] = p.vy[i]! + (Math.random() - 0.5) * 40 * dt;
        p.vz[i] = p.vz[i]! + (Math.random() - 0.5) * 20 * dt;
        if (p.z[i]! < 4) p.vz[i] = Math.abs(p.vz[i]!);
        break;
      case P_CONFETTI:
      case P_PETAL:
        p.vy[i] = p.vy[i]! + (k === P_CONFETTI ? 260 : 60) * dt;
        p.vx[i] = p.vx[i]! * Math.max(0, 1 - dt * 0.8) + Math.sin(life * 5 + i) * (k === P_PETAL ? 40 : 10) * dt;
        if (p.y[i]! > screenH + 40) p.life[i] = 0;
        break;
      default:
        break;
    }
  }
  p.count = count;
}

const TAU = Math.PI * 2;

/** Ground-level particles (frost twinkles, settled drips, bursts), drawn above the shadow layer. */
export function drawGroundParticles(g: CanvasRenderingContext2D, p: Particles, v: View): void {
  const S = v.S;
  const sp = sparkle();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < p.cap; i++) {
    const life = p.life[i]!;
    if (life <= 0) continue;
    const k = p.kind[i]!;
    if (k !== P_FROST && k !== P_BURST) continue;
    const t = 1 - life / p.maxLife[i]!;
    const sx = v.ox + p.x[i]! * S;
    const sy = v.oy - (p.y[i]! + OBLIQUE * p.z[i]!) * S;
    if (k === P_FROST) {
      // Twinkle: grow in, shrink out.
      const a = Math.sin(Math.PI * t);
      const size = (p.size0[i]! * (0.4 + 0.6 * a)) * S;
      g.globalAlpha = 0.9 * a;
      g.drawImage(sp, sx - size, sy - size, size * 2, size * 2);
    } else {
      const size = (p.size0[i]! + (p.size1[i]! - p.size0[i]!) * t) * S;
      g.globalAlpha = (1 - t) * 0.95;
      g.drawImage(sp, sx - size, sy - size, size * 2, size * 2);
    }
  }
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
}

let steamSprite: Canvas2D | null = null;
let fireflySprite: Canvas2D | null = null;

/** Air particles (steam, drips, sparkles, flying flakes, fireflies), drawn above the objects. */
export function drawAirParticles(g: CanvasRenderingContext2D, p: Particles, v: View): void {
  const S = v.S;
  steamSprite ??= radialSprite('255,255,255', 64, 0.85, 0.5, 0.35);
  fireflySprite ??= radialSprite('255,236,150', 64, 1, 0.18, 0.4);
  const fl = flake();
  const sp = sparkle();
  for (let i = 0; i < p.cap; i++) {
    const life = p.life[i]!;
    if (life <= 0) continue;
    const k = p.kind[i]!;
    if (k === P_FROST || k === P_BURST || k === P_CONFETTI || k === P_PETAL) continue;
    const t = 1 - life / p.maxLife[i]!;
    const sx = v.ox + p.x[i]! * S;
    const sy = v.oy - (p.y[i]! + OBLIQUE * p.z[i]!) * S;
    const size = (p.size0[i]! + (p.size1[i]! - p.size0[i]!) * t) * S;
    switch (k) {
      case P_STEAM:
      case P_PUFF: {
        g.globalAlpha = (k === P_PUFF ? 0.8 : 0.55) * (1 - t) * Math.min(1, t * 6);
        g.drawImage(steamSprite, sx - size, sy - size, size * 2, size * 2);
        break;
      }
      case P_DRIP: {
        g.globalAlpha = Math.min(1, life * 3) * 0.9;
        g.fillStyle = cssa(p.color[i]!, 1);
        const r = Math.max(0.8, size);
        g.beginPath();
        if (p.z[i]! > 0) {
          // A falling teardrop.
          g.moveTo(sx, sy - r * 2.2);
          g.quadraticCurveTo(sx + r * 1.1, sy - r * 0.2, sx, sy + r);
          g.quadraticCurveTo(sx - r * 1.1, sy - r * 0.2, sx, sy - r * 2.2);
        } else {
          g.ellipse(sx, sy, r * 1.6, r * 0.8, 0, 0, TAU);
        }
        g.fill();
        break;
      }
      case P_SPARKLE: {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = (1 - t) * 0.95;
        g.drawImage(sp, sx - size, sy - size, size * 2, size * 2);
        g.globalCompositeOperation = 'source-over';
        break;
      }
      case P_FLAKE_FLY: {
        g.globalAlpha = 1 - t * 0.6;
        const s2 = size * (1 - 0.5 * t);
        g.setTransform(v.dpr, 0, 0, v.dpr, sx * v.dpr, sy * v.dpr);
        g.rotate(p.rot[i]!);
        g.drawImage(fl, -s2, -s2, s2 * 2, s2 * 2);
        g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
        break;
      }
      case P_FIREFLY: {
        const blink = 0.5 + 0.5 * Math.sin(life * 4.5 + i * 1.7);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = Math.min(1, life * 0.8, (p.maxLife[i]! - life) * 0.8) * blink * 0.9;
        g.drawImage(fireflySprite, sx - size, sy - size, size * 2, size * 2);
        g.globalCompositeOperation = 'source-over';
        break;
      }
      default:
        break;
    }
  }
  g.globalAlpha = 1;
}

/** Screen-space confetti and petals (dawn card, new best). */
export function drawScreenParticles(g: CanvasRenderingContext2D, p: Particles): void {
  for (let i = 0; i < p.cap; i++) {
    const life = p.life[i]!;
    if (life <= 0) continue;
    const k = p.kind[i]!;
    if (k !== P_CONFETTI && k !== P_PETAL) continue;
    const t = 1 - life / p.maxLife[i]!;
    const x = p.x[i]!;
    const y = p.y[i]!;
    const s = p.size0[i]!;
    const rot = p.rot[i]!;
    g.globalAlpha = Math.min(1, life * 2) * (t < 0.05 ? t * 20 : 1);
    g.fillStyle = cssa(p.color[i]!, 1);
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    if (k === P_CONFETTI) {
      // A spinning paper rectangle: its apparent width flips with rot.
      const w = s * Math.abs(Math.cos(rot * 1.7));
      g.setTransform(c, sn, -sn, c, x, y);
      g.fillRect(-w / 2, -s * 0.35, w, s * 0.7);
    } else {
      g.setTransform(c, sn, -sn, c, x, y);
      g.beginPath();
      g.ellipse(0, 0, s, s * 0.55, 0, 0, TAU);
      g.fill();
    }
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// Rings (16) and text pops (12)
// ---------------------------------------------------------------------------------------------

const RING_CAP = 16;

export interface Rings {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly r0: Float32Array;
  readonly r1: Float32Array;
  readonly t: Float32Array;
  readonly dur: Float32Array;
  readonly width: Float32Array;
  readonly a0: Float32Array;
  readonly color: Uint32Array;
  cursor: number;
}

export function createRings(): Rings {
  return {
    x: new Float32Array(RING_CAP),
    y: new Float32Array(RING_CAP),
    r0: new Float32Array(RING_CAP),
    r1: new Float32Array(RING_CAP),
    t: new Float32Array(RING_CAP),
    dur: new Float32Array(RING_CAP),
    width: new Float32Array(RING_CAP),
    a0: new Float32Array(RING_CAP),
    color: new Uint32Array(RING_CAP),
    cursor: 0,
  };
}

export function addRing(r: Rings, x: number, y: number, r0: number, r1: number, dur: number, width: number, a0: number, color: Rgb): void {
  const i = r.cursor;
  r.cursor = (i + 1) % RING_CAP;
  r.x[i] = x;
  r.y[i] = y;
  r.r0[i] = r0;
  r.r1[i] = r1;
  r.t[i] = 0;
  r.dur[i] = dur;
  r.width[i] = width;
  r.a0[i] = a0;
  r.color[i] = color;
}

export function clearRings(r: Rings): void {
  r.dur.fill(0);
}

export function updateRings(r: Rings, dt: number): void {
  for (let i = 0; i < RING_CAP; i++) {
    if (r.dur[i]! <= 0) continue;
    r.t[i] = r.t[i]! + dt;
    if (r.t[i]! >= r.dur[i]!) r.dur[i] = 0;
  }
}

/** Ground rings (frost ring, ripples), drawn as flat circles. */
export function drawRings(g: CanvasRenderingContext2D, r: Rings, v: View): void {
  for (let i = 0; i < RING_CAP; i++) {
    const dur = r.dur[i]!;
    if (dur <= 0) continue;
    const t = r.t[i]! / dur;
    const e = 1 - (1 - t) * (1 - t);
    const rad = (r.r0[i]! + (r.r1[i]! - r.r0[i]!) * e) * v.S;
    g.strokeStyle = cssa(r.color[i]!, r.a0[i]! * (1 - t));
    g.lineWidth = Math.max(1, r.width[i]! * v.S * (1 - 0.5 * t));
    g.beginPath();
    g.ellipse(v.ox + r.x[i]! * v.S, v.oy - r.y[i]! * v.S, rad, rad, 0, 0, TAU);
    g.stroke();
  }
}

const POP_CAP = 12;

export const POP_PLUS = 0;
export const POP_PHEW = 1;
export const POP_MULT = 2;
export const POP_BANG = 3;

export interface Pops {
  readonly text: string[];
  readonly style: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly t: Float32Array;
  readonly dur: Float32Array;
  cursor: number;
}

export function createPops(): Pops {
  return {
    text: new Array<string>(POP_CAP).fill(''),
    style: new Uint8Array(POP_CAP),
    x: new Float32Array(POP_CAP),
    y: new Float32Array(POP_CAP),
    z: new Float32Array(POP_CAP),
    t: new Float32Array(POP_CAP),
    dur: new Float32Array(POP_CAP),
    cursor: 0,
  };
}

export function addPop(p: Pops, text: string, style: number, x: number, y: number, z: number, dur: number): void {
  const i = p.cursor;
  p.cursor = (i + 1) % POP_CAP;
  p.text[i] = text;
  p.style[i] = style;
  p.x[i] = x;
  p.y[i] = y;
  p.z[i] = z;
  p.t[i] = 0;
  p.dur[i] = dur;
}

export function clearPops(p: Pops): void {
  p.dur.fill(0);
}

export function updatePops(p: Pops, dt: number): void {
  for (let i = 0; i < POP_CAP; i++) {
    if (p.dur[i]! <= 0) continue;
    p.t[i] = p.t[i]! + dt;
    if (p.t[i]! >= p.dur[i]!) p.dur[i] = 0;
  }
}

/** easeOutBack-style overshoot: 0 → peak → 1 over the first `inDur` seconds. */
function popScale(t: number, inDur: number, peak: number): number {
  if (t >= inDur) return 1;
  const u = t / inDur;
  if (u < 0.6) return (u / 0.6) * peak;
  return peak + (1 - peak) * ((u - 0.6) / 0.4);
}

const POP_FONT = "800 20px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Text pops in screen space, anchored to world points (they rise as they fade). */
export function drawPops(g: CanvasRenderingContext2D, p: Pops, v: View, uiScale: number): void {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  for (let i = 0; i < POP_CAP; i++) {
    const dur = p.dur[i]!;
    if (dur <= 0) continue;
    const t = p.t[i]!;
    const u = t / dur;
    const style = p.style[i]!;
    const rise = style === POP_PHEW ? 10 : 20;
    const sx = v.ox + p.x[i]! * v.S;
    const sy = v.oy - (p.y[i]! + OBLIQUE * p.z[i]!) * v.S - rise * Math.min(1, u * 1.4) * v.S * 0.9;
    let scale: number;
    let size: number;
    let fill: string;
    let stroke: string;
    switch (style) {
      case POP_PHEW:
        scale = popScale(t, 0.25, 1.3);
        size = 30;
        fill = '#FFFFFF';
        stroke = '#1B9A8E';
        break;
      case POP_MULT:
        scale = popScale(t, 0.2, 1.35);
        size = 22;
        fill = '#FFE27A';
        stroke = '#2B2140';
        break;
      case POP_BANG:
        scale = popScale(t, 0.15, 1.4);
        size = 26;
        fill = '#FF5D5D';
        stroke = '#FFFFFF';
        break;
      default:
        scale = popScale(t, 0.2, 1.2);
        size = 17;
        fill = '#FFFFFF';
        stroke = '#2B5A8A';
        break;
    }
    const a = u > 0.7 ? (1 - u) / 0.3 : 1;
    g.globalAlpha = a;
    const s = scale * uiScale;
    g.setTransform(v.dpr * s, 0, 0, v.dpr * s, sx * v.dpr, sy * v.dpr);
    g.font = POP_FONT;
    const fs = size / 20;
    g.scale(fs, fs);
    g.lineWidth = 5;
    g.strokeStyle = stroke;
    g.strokeText(p.text[i]!, 0, 0);
    g.fillStyle = fill;
    g.fillText(p.text[i]!, 0, 0);
  }
  g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  g.globalAlpha = 1;
}
