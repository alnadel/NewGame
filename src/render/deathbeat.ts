// The death beat (GR12): after the hit-stop the camera pushes in on the puddle (camera.ts holdZoom),
// the world drains to grey outside a ring of colour around the puddle (one 'saturation' fill, only
// at governor level 0 and DPR ≤ 2, A12) under a faint cool wash (the atmosphere layer), and Nubs'
// hat (or his scarf's knot) pops off and lands beside the puddle, where it stays on the Melt Map.
// During the map pull the grey fades back out, so the settled map is in full colour.

import type { View } from '../game/camera.ts';
import { HAT_BASE_X, HAT_BASE_Y, renderHatSprite, type Looks } from './nubs.ts';
import { makeCanvas, type Canvas2D } from './sprites.ts';

/** Hit-stop before the beat, and how long the grey takes to come in (s). */
const BEAT_DELAY = 0.08;
const GREY_IN = 0.5;
/** The hat's flight: 0.5 s from the top of the head, rising 14 u, landing 10 u aside; a 2 u bounce. */
const HAT_FLY = 0.5;
const HAT_BOUNCE = 0.18;
const HAT_FROM = 30;
const HAT_RISE = 14;
const HAT_ASIDE = 10;
/** The hat at 0.8 of Nubs' full size (he is small and melting by now). */
const HAT_SIZE = 0.8;

export interface DeathBeat {
  /** Real seconds since the death (−1: no death this run). */
  t: number;
  /** The puddle (world u) and the side the hat lands on (−1 west, +1 east). */
  x: number;
  y: number;
  side: number;
  hat: Canvas2D | null;
  /** Device px per u the hat sprite was drawn at. */
  hatScale: number;
  /** The grey ring's gradient (built once per context, in u around the origin). */
  grad: CanvasGradient | null;
}

export function createDeathBeat(): DeathBeat {
  return { t: -1, x: 0, y: 0, side: 1, hat: null, hatScale: 0, grad: null };
}

/** Starts the beat for a death at (x, y): the hat flies away from the sun (`ux` its x direction). */
export function startDeathBeat(d: DeathBeat, x: number, y: number, ux: number, looks: Looks, pxPerU: number): void {
  d.t = 0;
  d.x = x;
  d.y = y;
  d.side = ux > 0 ? -1 : 1;
  d.hat ??= makeCanvas(1, 1);
  renderHatSprite(d.hat, looks, pxPerU);
  d.hatScale = pxPerU;
}

export function resetDeathBeat(d: DeathBeat): void {
  d.t = -1;
}

/**
 * How grey the world is (0..1): in over 0.5 s after the hit-stop while dying, back out over the
 * Melt Map pull (`pull` 0..1, −1 before the Results).
 */
export function greyOf(d: DeathBeat, pull: number): number {
  if (d.t < 0) return 0;
  const k = Math.max(0, Math.min(1, (d.t - BEAT_DELAY) / GREY_IN));
  return pull < 0 ? k : k * (1 - Math.max(0, Math.min(1, pull)));
}

/**
 * Drains the world rect toward grey by `k` outside a ring around the puddle's screen point (full
 * colour within 36 u, grey from 70 u). One full-screen fill.
 */
export function drawGrey(g: CanvasRenderingContext2D, v: View, d: DeathBeat, k: number): void {
  if (k <= 0.005) return;
  if (!d.grad) {
    const grad = g.createRadialGradient(0, 0, 36, 0, 0, 70);
    grad.addColorStop(0, 'rgba(128,128,128,0)');
    grad.addColorStop(1, 'rgba(128,128,128,0.75)');
    d.grad = grad;
  }
  const cx = v.ox + d.x * v.S;
  const cy = v.oy - d.y * v.S;
  g.save();
  g.globalCompositeOperation = 'saturation';
  g.globalAlpha = k;
  g.fillStyle = d.grad;
  g.translate(cx, cy);
  g.scale(v.S, v.S);
  g.fillRect((v.vx - cx) / v.S, (v.vy - cy) / v.S, v.vw / v.S, v.vh / v.S);
  g.restore();
}

/** The popped hat: in flight, bouncing, or lying beside the puddle (reduced motion: it just lands). */
export function drawHatPop(g: CanvasRenderingContext2D, v: View, d: DeathBeat, reducedMotion: boolean): void {
  if (d.t < 0 || !d.hat) return;
  const t = d.t - BEAT_DELAY;
  if (t < 0) return;
  let u = Math.min(1, t / HAT_FLY);
  let lift = 0;
  let a = 1;
  if (reducedMotion) {
    u = 1;
    a = Math.min(1, t / 0.3);
  } else if (t < HAT_FLY) {
    // A parabola from the head (HAT_FROM up) through a peak HAT_RISE higher, down to the ground.
    lift = HAT_FROM * (1 - u) + 4 * (HAT_RISE + HAT_FROM / 4) * u * (1 - u);
  } else if (t < HAT_FLY + HAT_BOUNCE) {
    const b = (t - HAT_FLY) / HAT_BOUNCE;
    lift = 2 * 4 * b * (1 - b);
  }
  const S = v.S;
  const sx = v.ox + (d.x + d.side * HAT_ASIDE * u) * S;
  const sy = v.oy - d.y * S - lift * S;
  // A tumble in flight, settling at a slight tilt.
  const rot = d.side * (reducedMotion ? 0.3 : t < HAT_FLY ? 2.2 * Math.PI * u + 0.3 * u : 0.3 + 2.2 * Math.PI);
  const k = (HAT_SIZE * S) / d.hatScale;
  g.save();
  g.globalAlpha = a;
  g.translate(sx, sy);
  g.rotate(rot);
  g.drawImage(d.hat, -HAT_BASE_X * HAT_SIZE * S, -HAT_BASE_Y * HAT_SIZE * S, d.hat.width * k, d.hat.height * k);
  g.restore();
}
