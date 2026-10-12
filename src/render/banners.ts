// Screen-space moments (GDD §11): the Night card ('Night · Day N survived' by a crescent), the Day
// card (a serif 'DAY N' over a small-caps line 'MEADOW · Heat Wave · NOON 72°' with the biome's
// glyph, on biome paper with five slow rays behind it; slides in from the right in 500 ms, holds,
// leaves to the left; fades only under reduced motion), the stamps (a plate that slams in at 2.4× over 220 ms with an overshoot, tilted
// −4°, holds, then fades and rises 12 px over 300 ms; under reduced motion it only fades: 'HIGH
// NOON', 'PASSED SAM!' in teal, 'PAST YOUR RECENT BEST' in gold), and the timers of the edge
// vignettes the atmosphere layer draws (atmosphere.ts): low-Chill heat haze, the cool multiplier
// pulse and the gold ×5 pulse. Photosensitivity: no full-screen flash.

import type { BiomeId } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { drawBiomeGlyph } from './glyphs.ts';
import { FORECASTS, type ForecastId } from './shims.ts';
import { roundRect } from './sprites.ts';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
/** The Day card's life (s). */
const DAY_S = 2;

export interface Banners {
  night: number;
  /** 'Night · Day 2 survived'. */
  nightText: string;
  day: number;
  dayN: number;
  dayText: string;
  /** The Day card's second line and its biome (glyph and paper). */
  dayLine: string;
  dayBiome: BiomeId;
  /** Measured widths of the Day card's title and line and of the night line (0 = not yet). */
  dayTitleW: number;
  dayLineW: number;
  nightW: number;
  coolPulse: number;
  goldPulse: number;
  /** Heat haze strength 0..1 (eased toward 1 while Chill < 25). */
  heat: number;
  heatPhase: number;
  /** The stamp: seconds since it appeared (−1 none), its look, text, hold time, fitted font and text width. */
  stamp: number;
  stampKind: StampKind;
  stampText: string;
  stampHold: number;
  stampFont: string;
  stampSize: number;
  stampW: number;
  /** Fonts for the HUD scale they were built at. */
  fontK: number;
  dayFont: string;
  lineFont: string;
  nightFont: string;
}

export type StampKind = 'noon' | 'teal' | 'gold';

/** Stamp timing (s): slam in, then fade out (the hold is per stamp). */
export const STAMP_IN = 0.22;
const STAMP_OUT = 0.3;
/** Plate, outline and ink of each stamp look. */
const STAMP_LOOK: Readonly<Record<StampKind, readonly [string, string, string]>> = {
  noon: ['#FFC23D', '#FF6A3D', '#2B2140'],
  teal: ['#2EC4B6', '#13857C', '#10302D'],
  gold: ['#FFE08A', '#D99A12', '#2B2140'],
};

export function createBanners(): Banners {
  return {
    night: -1,
    nightText: 'Night',
    day: -1,
    dayN: 1,
    dayText: 'DAY 1',
    dayLine: '',
    dayBiome: 'meadow',
    dayTitleW: 0,
    dayLineW: 0,
    nightW: 0,
    coolPulse: 0,
    goldPulse: 0,
    heat: 0,
    heatPhase: 0,
    stamp: -1,
    stampKind: 'noon',
    stampText: '',
    stampHold: 0,
    stampFont: '',
    stampSize: 0,
    stampW: 0,
    fontK: 0,
    dayFont: '',
    lineFont: '',
    nightFont: '',
  };
}

/** Shows a stamp (it replaces any stamp still on screen). */
export function showStamp(b: Banners, kind: StampKind, text: string, hold: number): void {
  b.stamp = 0;
  b.stampKind = kind;
  b.stampText = text;
  b.stampHold = hold;
  b.stampW = 0;
}

export function resetBanners(b: Banners): void {
  b.night = -1;
  b.day = -1;
  b.coolPulse = 0;
  b.goldPulse = 0;
  b.heat = 0;
  b.stamp = -1;
}

/** The night card after surviving day `day`. */
export function showNightCard(b: Banners, day: number): void {
  b.night = 0;
  b.nightText = `Night · Day ${day} survived`;
  b.nightW = 0;
}

/** The Day card for `day`: its biome, forecast (left out when clear) and noon elevation. */
export function showDayCard(b: Banners, day: number, biome: BiomeId, forecast: ForecastId, epsNoon: number): void {
  b.day = 0;
  b.dayN = day;
  b.dayText = `DAY ${day}`;
  b.dayBiome = biome;
  const place = biome === 'oldtown' ? 'OLD TOWN' : 'MEADOW';
  const weather = forecast === 'clear' ? '' : ` · ${FORECASTS[forecast].name}`;
  b.dayLine = `${place}${weather} · NOON ${Math.round(epsNoon)}°`;
  b.dayTitleW = 0;
}

export function updateBanners(b: Banners, dt: number, lowChill: boolean): void {
  if (b.night >= 0) b.night = b.night + dt > 2.4 ? -1 : b.night + dt;
  if (b.day >= 0) b.day = b.day + dt > DAY_S ? -1 : b.day + dt;
  if (b.stamp >= 0) b.stamp = b.stamp + dt > STAMP_IN + b.stampHold + STAMP_OUT ? -1 : b.stamp + dt;
  b.coolPulse = Math.max(0, b.coolPulse - dt);
  b.goldPulse = Math.max(0, b.goldPulse - dt);
  b.heat += ((lowChill ? 1 : 0) - b.heat) * Math.min(1, dt * 3);
  b.heatPhase += dt;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function fonts(b: Banners, scale: number): void {
  if (b.fontK === scale) return;
  b.fontK = scale;
  b.dayFont = `italic 700 ${Math.round(34 * 1.25 * scale)}px ${SERIF}`;
  b.lineFont = `small-caps 700 ${Math.round(12 * scale)}px ${SANS}`;
  b.nightFont = `italic 700 ${Math.round(26 * scale)}px ${SERIF}`;
  b.stampW = 0;
  b.dayTitleW = 0;
  b.nightW = 0;
}

/** Banners and cards, below the HUD band (`top` CSS px). */
export function drawBanners(g: CanvasRenderingContext2D, b: Banners, v: View, top: number, scale: number, reducedMotion: boolean): void {
  const cx = v.vx + v.vw / 2;
  fonts(b, scale);
  if (b.night >= 0) {
    const t = b.night;
    const a = Math.min(1, t / 0.5, (2.4 - t) / 0.6);
    nightCard(g, b, cx, top + 40 * scale, scale, a);
  }
  if (b.day >= 0) {
    const t = b.day;
    let x = cx;
    let a = 1;
    if (reducedMotion) {
      a = Math.min(1, t / 0.3, (DAY_S - t) / 0.3);
    } else if (t < 0.5) {
      x = cx + v.vw * 0.7 * (1 - easeOutBack(t / 0.5));
    } else if (t > 1.5) {
      x = cx - v.vw * 0.8 * ((t - 1.5) / 0.5) ** 2;
    }
    dayCard(g, b, x, top + 74 * scale, scale, a, reducedMotion ? 0 : t);
  }
  if (b.stamp >= 0) drawStamp(g, b, cx, top + 40 * scale, scale, v.vw - 40, reducedMotion);
  g.globalAlpha = 1;
}

/** The stamp plate and text, fitted to `maxW` CSS px. */
function drawStamp(g: CanvasRenderingContext2D, b: Banners, cx: number, y: number, scale: number, maxW: number, reducedMotion: boolean): void {
  const t = b.stamp;
  const outT = t - STAMP_IN - b.stampHold;
  let a = 1;
  let s = 1;
  let rise = 0;
  if (reducedMotion) a = Math.min(1, t / 0.15);
  else if (t < STAMP_IN) {
    s = 2.4 - 1.4 * easeOutBack(t / STAMP_IN);
    a = Math.min(1, t / 0.08);
  }
  if (outT > 0) {
    const u = Math.min(1, outT / STAMP_OUT);
    a *= 1 - u;
    rise = -12 * u;
  }
  if (a <= 0.01) return;
  const pad = 18 * scale;
  if (b.stampW === 0) {
    // Fit once per stamp: too wide shrinks the type (the plate keeps its padding).
    let size = 44 * scale;
    g.font = `italic 900 ${Math.round(size)}px ${SANS}`;
    let tw = g.measureText(b.stampText).width;
    if (tw + 2 * pad > maxW) {
      const k = (maxW - 2 * pad) / tw;
      size *= k;
      tw *= k;
      g.font = `italic 900 ${Math.round(size)}px ${SANS}`;
    }
    b.stampFont = g.font;
    b.stampSize = size;
    b.stampW = tw;
  }
  const size = b.stampSize;
  const w = b.stampW + 2 * pad;
  const h = size * 1.3;
  const [plate, line, ink] = STAMP_LOOK[b.stampKind];
  g.save();
  g.globalAlpha = a;
  g.translate(cx, y + rise);
  g.rotate(-4 * DEG);
  g.scale(s, s);
  g.fillStyle = 'rgba(43,33,64,0.22)';
  roundRect(g, -w / 2, -h / 2 + 5, w, h, 12 * scale);
  g.fill();
  g.fillStyle = plate;
  roundRect(g, -w / 2, -h / 2, w, h, 12 * scale);
  g.fill();
  g.strokeStyle = line;
  g.lineWidth = 4;
  roundRect(g, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 10 * scale);
  g.stroke();
  g.fillStyle = ink;
  g.font = b.stampFont;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(b.stampText, 0, size * 0.04);
  g.restore();
}

function nightCard(g: CanvasRenderingContext2D, b: Banners, cx: number, y: number, scale: number, a: number): void {
  if (a <= 0) return;
  const s = scale * 0.85;
  g.globalAlpha = a;
  g.font = b.nightFont;
  if (b.nightW === 0) b.nightW = g.measureText(b.nightText).width;
  const moon = 13 * s;
  const w = b.nightW + moon * 2 + 52 * s;
  const h = 54 * s;
  g.fillStyle = 'rgba(43,33,64,0.16)';
  roundRect(g, cx - w / 2, y - h / 2 + 4, w, h, 14 * s);
  g.fill();
  g.fillStyle = 'rgba(29,34,71,0.72)';
  roundRect(g, cx - w / 2, y - h / 2, w, h, 14 * s);
  g.fill();
  // A crescent, then the words.
  const mx = cx - w / 2 + 22 * s + moon;
  g.fillStyle = '#E8ECFF';
  g.beginPath();
  g.arc(mx, y, moon, 0, TAU);
  g.arc(mx + moon * 0.55, y - moon * 0.35, moon * 0.85, 0, TAU, true);
  g.fill('evenodd');
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(b.nightText, mx + moon + 10 * s, y + 2 * s);
}

/** The Day card at (cx, y); `t` turns the rays (0 holds them still). */
function dayCard(g: CanvasRenderingContext2D, b: Banners, cx: number, y: number, scale: number, a: number, t: number): void {
  if (a <= 0) return;
  const s = scale * 1.25;
  if (b.dayTitleW === 0) {
    g.font = b.dayFont;
    b.dayTitleW = g.measureText(b.dayText).width;
    g.font = b.lineFont;
    b.dayLineW = g.measureText(b.dayLine).width;
  }
  const titleW = b.dayTitleW;
  const lineW = b.dayLineW;
  const glyph = 14 * scale;
  const gap = 5 * scale;
  const w = Math.max(titleW, glyph + gap + lineW) + 40 * scale;
  const h = 54 * s + 6 * scale;
  // Five warm rays behind the card, turning at 6°/s.
  g.globalAlpha = a * 0.5;
  g.fillStyle = '#FFD36B';
  g.beginPath();
  const len = w * 0.62;
  for (let i = 0; i < 5; i++) {
    const ang = (i * TAU) / 5 + t * 6 * DEG - Math.PI / 2;
    g.moveTo(cx, y);
    g.lineTo(cx + Math.cos(ang - 0.17) * len, y + Math.sin(ang - 0.17) * len);
    g.lineTo(cx + Math.cos(ang + 0.17) * len, y + Math.sin(ang + 0.17) * len);
    g.closePath();
  }
  g.fill();
  g.globalAlpha = a;
  g.fillStyle = 'rgba(43,33,64,0.16)';
  roundRect(g, cx - w / 2, y - h / 2 + 4, w, h, 14 * s);
  g.fill();
  g.fillStyle = b.dayBiome === 'oldtown' ? 'rgba(255,241,230,0.97)' : 'rgba(255,248,238,0.97)';
  roundRect(g, cx - w / 2, y - h / 2, w, h, 14 * s);
  g.fill();
  g.textBaseline = 'middle';
  g.fillStyle = '#2B2140';
  g.textAlign = 'center';
  g.font = b.dayFont;
  g.fillText(b.dayText, cx, y - 8 * scale);
  // The line: the biome glyph, then the plan in small caps.
  const ly = y + h / 2 - 15 * scale;
  const lx = cx - (glyph + gap + lineW) / 2;
  drawBiomeGlyph(g, b.dayBiome, lx + glyph / 2, ly, glyph);
  g.fillStyle = '#6B5A7A';
  g.textAlign = 'left';
  g.font = b.lineFont;
  g.fillText(b.dayLine, lx + glyph + gap, ly + 0.5 * scale);
}
