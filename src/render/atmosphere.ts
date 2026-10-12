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
// Each forecast grades the whole frame from this same layer (no pass of its own): Heat Wave a hot
// orange wash that peaks at noon and a hotter sun side; Overcast a cool, desaturated sky tone with
// the sun's warmth and the noon bleach muted; Long Shadows an amber low-sun grade all day; Dazzle a
// bright glare; Breezy a fresh, airy tone. Breezy (leaves), Dazzle (glints) and Market (bunting)
// add small sprites elsewhere.
// The morning's warm sun side is capped so the shade stays cool on the saturated dawn ground. From
// governor level 2 only the forecast grade and the vignettes stay, at level 3 only the vignettes.
// The layer is redrawn only when a quantized input changes (a drag, the clock's 1/96-day steps, a
// pulse), and drawn only when something is visible.

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

/** A forecast's full-frame grade: its colour and alpha at dawn/dusk (lo) and at noon (hi). */
interface Grade {
  readonly color: Rgb;
  readonly lo: number;
  readonly hi: number;
  /** Multipliers on the sun-side warmth, the far-side cool and the noon bleach; a floor on "low sun". */
  readonly warm: number;
  readonly cool: number;
  readonly bleach: number;
  readonly lowMin: number;
}

const PLAIN: Grade = { color: 0, lo: 0, hi: 0, warm: 1, cool: 1, bleach: 1, lowMin: 0 };
const GRADES: Readonly<Partial<Record<ForecastId, Grade>>> = {
  breezy: { color: hex('#E2FBF0'), lo: 0.06, hi: 0.07, warm: 0.85, cool: 1.2, bleach: 1, lowMin: 0 },
  heat: { color: hex('#FF5A2E'), lo: 0.07, hi: 0.16, warm: 1.35, cool: 0.6, bleach: 1.2, lowMin: 0 },
  overcast: { color: hex('#7F8DAE'), lo: 0.2, hi: 0.24, warm: 0.3, cool: 1.3, bleach: 0.3, lowMin: 0 },
  long: { color: hex('#FFC24A'), lo: 0.12, hi: 0.12, warm: 1.2, cool: 1.1, bleach: 0.2, lowMin: 0.75 },
  dazzle: { color: hex('#FFFDF0'), lo: 0.05, hi: 0.1, warm: 0.9, cool: 1, bleach: 1.4, lowMin: 0 },
};
const FORECAST_KEY: Readonly<Record<ForecastId, number>> = { clear: 0, breezy: 1, overcast: 2, heat: 3, long: 4, dazzle: 5, market: 6 };
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
  /** Governor below level 2: the sun-side gradient, the noon bleach and the night pool. */
  full: boolean;
  /** Governor below level 3: the forecast's grade. */
  grade: boolean;
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
    grade: true,
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
  const gr = GRADES[a.forecast] ?? PLAIN;
  const day = a.full ? 1 - a.night : 0;
  const low = Math.max(gr.lowMin, 1 - a.elev);
  // The sun side warms less before 9 AM (the colour script's dawn ground is already warm: more would
  // turn the shade brown); the far side's cool is what keeps the shade reading cold.
  const morning = 1 - 0.35 * (1 - smoothstep(0.15, 0.3, a.dayFrac));
  const warmA = (0.13 + 0.1 * low) * morning * gr.warm * day;
  const coolA = (0.07 + 0.1 * low) * gr.cool * day;
  const bleachA = a.elev > 0.75 ? 0.22 * ((a.elev - 0.75) / 0.25) * gr.bleach * day : 0;
  const gradeA = a.grade ? (gr.lo + (gr.hi - gr.lo) * a.elev) * (1 - a.night) : 0;
  const nightA = a.full ? a.night : 0;
  const heatA = a.heat > 0.01 ? 0.25 * (0.25 + 0.75 * (0.5 - 0.5 * Math.cos(a.heatPhase * TAU * 1.1))) * a.heat : 0;
  const coolP = a.cool > 0 ? 0.18 * Math.sin((Math.PI * a.cool) / 0.25) : 0;
  const goldP = a.gold > 0 ? 0.2 * Math.sin((Math.PI * a.gold) / 0.45) : 0;
  const washA = a.wash;
  if (warmA < 0.005 && gradeA < 0.005 && nightA < 0.005 && heatA < 0.005 && coolP < 0.005 && goldP < 0.005 && washA < 0.005) {
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
  n[14] = FORECAST_KEY[a.forecast];
  n[15] = Math.round(gradeA * 200);
  let same = true;
  for (let i = 0; i < 16; i++) {
    if (n[i] !== at.key[i]) {
      same = false;
      break;
    }
  }
  if (!same || !at.canvas) {
    at.key.set(n);
    paint(at, W, H, a, gr, gradeA, warmA, coolA, bleachA, nightA, heatA, coolP, goldP, washA);
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
  gr: Grade,
  gradeA: number,
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
  if (gradeA > 0.005) {
    // The forecast's grade under everything else in the layer.
    g.fillStyle = cssa(gr.color, gradeA);
    g.fillRect(0, 0, W, H);
  }
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
