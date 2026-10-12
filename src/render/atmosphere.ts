// Atmosphere (GR5, A12): every full-screen tint of the world in ONE small offscreen layer (at most
// 128×256 px, the world rect's aspect) stretched over the world rect with a single drawImage, so the
// look costs one full-screen pass whatever is on:
//   - the sun side: a linear gradient along the screen sun direction d = (ux, −uy), warm light on
//     the sun's side (peach before 9 AM, rose after 3 PM, pale gold between) fading to a cool blue
//     on the far side, stronger when the sun is low;
//   - the noon bleach: a pale rim while the sun is above 75% of its noon elevation;
//   - the night pool: moonlight around Nubs, dark edges;
//   - the edge vignettes: low-Chill heat (pulsing at 1.1 Hz), the cool multiplier pulse, the gold ×5
//     pulse, and the cool wash of the death beat.
// Forecasts tint it (Heat Wave: warmer sun side; Overcast: everything ×0.7). At governor level 3 only
// the vignettes stay. The layer is redrawn only when a quantized input changes (a drag, the clock's
// 1/96-day steps, a pulse), and drawn only when something in it is visible.

import type { ForecastId } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { cssa, hex, mix, type Rgb } from './color.ts';
import { ctx2d, makeCanvas, vignette, type Canvas2D } from './sprites.ts';

const WARM_AM = hex('#FFAA6E');
const WARM_MID = hex('#FFECBE');
const WARM_PM = hex('#FF9678');
const COOL = hex('#4650AA');
const BLEACH = hex('#FFFAE1');
const MOON = hex('#AABEFF');
const DARK = hex('#06081E');
const ICE = hex('#5AB8FF');
const MAX_W = 128;
const MAX_H = 256;
const TAU = Math.PI * 2;

/** What the layer shows this frame (filled by the renderer). */
export interface AtmosphereIn {
  /** Sun direction in world space (toward the sun). */
  ux: number;
  uy: number;
  /** Sun height 0 (dawn/dusk) .. 1 (noon elevation). */
  elev: number;
  /** 0 = 6 AM .. 1 = 6 PM. */
  dayFrac: number;
  /** 0 day .. 1 full night. */
  night: number;
  /** Nubs on screen (CSS px). */
  nubsX: number;
  nubsY: number;
  /** Low-Chill heat strength 0..1 and its pulse clock (s). */
  heat: number;
  heatPhase: number;
  /** Multiplier pulses: seconds left of the cool (0.25 s) and gold (0.45 s) pulses. */
  cool: number;
  gold: number;
  /** The death beat's cool wash alpha. */
  wash: number;
  forecast: ForecastId;
  /** Governor below level 3: the sun-side gradient, the noon bleach and the night pool. */
  full: boolean;
}

export interface Atmosphere {
  canvas: Canvas2D | null;
  g: CanvasRenderingContext2D | null;
  /** Quantized inputs the layer was last drawn with. */
  readonly key: Float64Array;
  readonly next: Float64Array;
  /** The last layer had anything visible in it. */
  visible: boolean;
}

export function createAtmosphere(): Atmosphere {
  return { canvas: null, g: null, key: new Float64Array(16).fill(Number.NaN), next: new Float64Array(16), visible: false };
}

export function createAtmosphereIn(): AtmosphereIn {
  return {
    ux: 1,
    uy: 0,
    elev: 0,
    dayFrac: 0,
    night: 0,
    nubsX: 0,
    nubsY: 0,
    heat: 0,
    heatPhase: 0,
    cool: 0,
    gold: 0,
    wash: 0,
    forecast: 'clear',
    full: true,
  };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/** The sun-side color: peach before 9 AM, pale gold midday, rose after 3 PM (eased over ±30 min). */
export function warmAt(dayFrac: number): Rgb {
  return mix(mix(WARM_AM, WARM_MID, smoothstep(0.21, 0.29, dayFrac)), WARM_PM, smoothstep(0.71, 0.79, dayFrac));
}

/**
 * Draws the layer over the world rect (call inside the world clip). Returns true when it drew (one
 * full-screen pass).
 */
export function drawAtmosphere(g: CanvasRenderingContext2D, at: Atmosphere, v: View, a: AtmosphereIn): boolean {
  const oc = a.forecast === 'overcast' ? 0.7 : 1;
  const day = a.full ? 1 - a.night : 0;
  const low = 1 - a.elev;
  const warmA = (0.16 + 0.14 * low + (a.forecast === 'heat' ? 0.05 : 0)) * day * oc;
  const coolA = (0.06 + 0.1 * low) * day * oc;
  const bleachA = a.elev > 0.75 ? 0.22 * ((a.elev - 0.75) / 0.25) * day * oc : 0;
  const nightA = a.full ? a.night * oc : 0;
  const heatA = a.heat > 0.01 ? 0.25 * (0.25 + 0.75 * (0.5 - 0.5 * Math.cos(a.heatPhase * TAU * 1.1))) * a.heat * oc : 0;
  const coolP = a.cool > 0 ? 0.18 * Math.sin((Math.PI * a.cool) / 0.25) * oc : 0;
  const goldP = a.gold > 0 ? 0.2 * Math.sin((Math.PI * a.gold) / 0.45) * oc : 0;
  const washA = a.wash;
  if (warmA < 0.005 && nightA < 0.005 && heatA < 0.005 && coolP < 0.005 && goldP < 0.005 && washA < 0.005) {
    at.visible = false;
    return false;
  }
  // Layer size: the world rect's aspect within MAX_W × MAX_H (uniform scale k).
  const k = Math.min(MAX_W / v.vw, MAX_H / v.vh);
  const W = Math.max(2, Math.round(v.vw * k));
  const H = Math.max(2, Math.round(v.vh * k));
  const n = at.next;
  n[0] = W;
  n[1] = H;
  n[2] = warmA > 0.005 ? Math.round(Math.atan2(a.uy, a.ux) * (180 / Math.PI)) : 0;
  n[3] = Math.round(warmA * 200);
  n[4] = Math.round(coolA * 200);
  n[5] = Math.round(bleachA * 200);
  n[6] = Math.round(a.dayFrac * 96);
  n[7] = Math.round(nightA * 128);
  n[8] = nightA > 0.005 ? Math.round((a.nubsX - v.vx) * k) : 0;
  n[9] = nightA > 0.005 ? Math.round((a.nubsY - v.vy) * k) : 0;
  n[10] = Math.round(heatA * 200);
  n[11] = Math.round(coolP * 200);
  n[12] = Math.round(goldP * 200);
  n[13] = Math.round(washA * 200);
  let same = true;
  for (let i = 0; i < 14; i++) {
    if (n[i] !== at.key[i]) {
      same = false;
      break;
    }
  }
  if (!same || !at.canvas) {
    at.key.set(n);
    paint(at, W, H, a, warmA, coolA, bleachA, nightA, heatA, coolP, goldP, washA);
  }
  at.visible = true;
  g.imageSmoothingEnabled = true;
  g.drawImage(at.canvas as Canvas2D, 0, 0, W, H, v.vx, v.vy, v.vw, v.vh);
  return true;
}

function paint(
  at: Atmosphere,
  W: number,
  H: number,
  a: AtmosphereIn,
  warmA: number,
  coolA: number,
  bleachA: number,
  nightA: number,
  heatA: number,
  coolP: number,
  goldP: number,
  washA: number,
): void {
  if (!at.canvas) {
    at.canvas = makeCanvas(MAX_W, MAX_H);
    at.g = ctx2d(at.canvas);
  }
  const g = at.g as CanvasRenderingContext2D;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, W + 1, H + 1);
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.sqrt(W * W + H * H) / 2;
  if (warmA > 0.005) {
    // Screen sun direction d = (ux, −uy): warm on the sun's side, cool on the far side.
    const len = Math.hypot(a.ux, a.uy) || 1;
    const dx = a.ux / len;
    const dy = -a.uy / len;
    const warm = warmAt(a.dayFrac);
    const lg = g.createLinearGradient(cx + dx * R, cy + dy * R, cx - dx * R, cy - dy * R);
    lg.addColorStop(0, cssa(warm, warmA));
    lg.addColorStop(0.5, cssa(warm, 0));
    lg.addColorStop(0.5, cssa(COOL, 0));
    lg.addColorStop(1, cssa(COOL, coolA));
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
  }
  if (bleachA > 0.005) {
    const rg = g.createRadialGradient(cx, cy, 0.35 * R, cx, cy, R);
    rg.addColorStop(0, cssa(BLEACH, 0));
    rg.addColorStop(1, cssa(BLEACH, bleachA));
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  }
  if (nightA > 0.005) {
    const nx = at.key[8] as number;
    const ny = at.key[9] as number;
    const rg = g.createRadialGradient(nx, ny, 0, nx, ny, 1.1 * R);
    rg.addColorStop(0, cssa(MOON, 0.1 * nightA));
    rg.addColorStop(0.15 / 1.1, cssa(MOON, 0.1 * nightA));
    rg.addColorStop(0.5 / 1.1, cssa(MOON, 0));
    rg.addColorStop(0.5 / 1.1, cssa(DARK, 0));
    rg.addColorStop(1, cssa(DARK, 0.45 * nightA));
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  }
  if (heatA > 0.005) {
    g.globalAlpha = heatA;
    g.drawImage(vignette('255,106,61'), 0, 0, W, H);
  }
  if (coolP > 0.005) {
    g.globalAlpha = coolP;
    g.drawImage(vignette('90,184,255'), 0, 0, W, H);
  }
  if (goldP > 0.005) {
    g.globalAlpha = goldP;
    g.drawImage(vignette('255,194,61'), 0, 0, W, H);
  }
  g.globalAlpha = 1;
  if (washA > 0.005) {
    g.fillStyle = cssa(ICE, washA);
    g.fillRect(0, 0, W, H);
  }
}
