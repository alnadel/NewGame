// Screen-space moments (GDD §11): the NOON banner (drops from the top over 600 ms, holds 1.2 s),
// the NIGHT card, the "DAY N" serif card (slides in from the right in 500 ms, holds 1 s; fades
// under reduced motion), the stamps (a plate that slams in at 2.4× over 220 ms with an overshoot,
// tilted −4°, holds, then fades and rises 12 px over 300 ms; under reduced motion it only fades:
// 'PASSED SAM!' in teal, 'PAST YOUR RECENT BEST' in gold), and the timers of the edge vignettes
// the atmosphere layer draws (atmosphere.ts): low-Chill heat haze, the cool multiplier pulse and
// the gold ×5 pulse. Photosensitivity: no full-screen flash.

import type { View } from '../game/camera.ts';
import { roundRect } from './sprites.ts';

const TAU = Math.PI * 2;
const SERIF = "italic 700 {S}px Georgia, 'Times New Roman', serif";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export interface Banners {
  noon: number;
  night: number;
  day: number;
  dayN: number;
  dayText: string;
  coolPulse: number;
  goldPulse: number;
  /** Heat haze strength 0..1 (eased toward 1 while Chill < 25). */
  heat: number;
  heatPhase: number;
  /** The stamp: seconds since it appeared (−1 none), its look, text, hold time and text width. */
  stamp: number;
  stampKind: StampKind;
  stampText: string;
  stampHold: number;
  stampW: number;
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
    noon: -1,
    night: -1,
    day: -1,
    dayN: 1,
    dayText: 'DAY 1',
    coolPulse: 0,
    goldPulse: 0,
    heat: 0,
    heatPhase: 0,
    stamp: -1,
    stampKind: 'noon',
    stampText: '',
    stampHold: 0,
    stampW: 0,
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
  b.noon = -1;
  b.night = -1;
  b.day = -1;
  b.coolPulse = 0;
  b.goldPulse = 0;
  b.heat = 0;
  b.stamp = -1;
}

export function showDayCard(b: Banners, day: number): void {
  b.day = 0;
  if (b.dayN !== day || b.dayText === '') {
    b.dayN = day;
    b.dayText = `DAY ${day}`;
  }
}

export function updateBanners(b: Banners, dt: number, lowChill: boolean): void {
  if (b.noon >= 0) b.noon = b.noon + dt > 2.4 ? -1 : b.noon + dt;
  if (b.night >= 0) b.night = b.night + dt > 2.4 ? -1 : b.night + dt;
  if (b.day >= 0) b.day = b.day + dt > 2.0 ? -1 : b.day + dt;
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

/** Banners and cards, below the HUD band (`top` CSS px). */
export function drawBanners(g: CanvasRenderingContext2D, b: Banners, v: View, top: number, scale: number, reducedMotion: boolean): void {
  const cx = v.vx + v.vw / 2;
  if (b.noon >= 0) {
    const t = b.noon;
    // Slide from the top over 0.6 s, hold 1.2 s, then slide back up over 0.6 s.
    let k: number;
    if (t < 0.6) k = easeOutBack(t / 0.6);
    else if (t < 1.8) k = 1;
    else k = 1 - (t - 1.8) / 0.6;
    const a = reducedMotion ? Math.min(1, t / 0.3, (2.4 - t) / 0.3) : 1;
    const y = reducedMotion ? top + 34 * scale : top - 60 * scale + (94 * scale) * k;
    noonBanner(g, cx, y, scale, a, t);
  }
  if (b.night >= 0) {
    const t = b.night;
    const a = Math.min(1, t / 0.5, (2.4 - t) / 0.6);
    serifCard(g, cx, top + 40 * scale, 'Night', scale * 0.85, a, '#E8ECFF', 'rgba(29,34,71,0.72)');
  }
  if (b.day >= 0) {
    const t = b.day;
    let x = cx;
    let a = 1;
    if (reducedMotion) {
      a = Math.min(1, t / 0.3, (2 - t) / 0.3);
    } else if (t < 0.5) {
      x = cx + (v.vw * 0.7) * (1 - easeOutBack(t / 0.5));
    } else if (t > 1.5) {
      x = cx - v.vw * 0.8 * ((t - 1.5) / 0.5) ** 2;
    }
    serifCard(g, x, top + 70 * scale, b.dayText, scale * 1.25, a, '#2B2140', 'rgba(255,248,238,0.94)');
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
  let size = 44 * scale;
  g.font = `italic 900 ${Math.round(size)}px ${SANS}`;
  if (b.stampW === 0) b.stampW = g.measureText(b.stampText).width;
  let tw = b.stampW;
  const pad = 18 * scale;
  if (tw + 2 * pad > maxW) {
    // Too wide: shrink the type to fit (the plate keeps its padding).
    const k = (maxW - 2 * pad) / tw;
    size *= k;
    tw *= k;
    g.font = `italic 900 ${Math.round(size)}px ${SANS}`;
  }
  const w = tw + 2 * pad;
  const h = size * 1.3;
  const [plate, line, ink] = STAMP_LOOK[b.stampKind];
  g.save();
  g.globalAlpha = a;
  g.translate(cx, y + rise);
  g.rotate((-4 * Math.PI) / 180);
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
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(b.stampText, 0, size * 0.04);
  g.restore();
}

function noonBanner(g: CanvasRenderingContext2D, cx: number, y: number, s: number, a: number, t: number): void {
  if (a <= 0) return;
  g.globalAlpha = a;
  const w = 168 * s;
  const h = 46 * s;
  g.fillStyle = 'rgba(43,33,64,0.18)';
  roundRect(g, cx - w / 2, y - h / 2 + 3, w, h, h / 2);
  g.fill();
  g.fillStyle = '#FFF8EE';
  roundRect(g, cx - w / 2, y - h / 2, w, h, h / 2);
  g.fill();
  g.strokeStyle = '#FF8A2B';
  g.lineWidth = 3 * s;
  roundRect(g, cx - w / 2 + 1.5 * s, y - h / 2 + 1.5 * s, w - 3 * s, h - 3 * s, h / 2 - 1.5 * s);
  g.stroke();
  // Suns on both sides.
  for (const side of [-1, 1]) {
    const sx = cx + side * (w / 2 - 22 * s);
    g.fillStyle = '#FFB547';
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (i * TAU) / 8 + t * 2 * side;
      g.moveTo(sx + Math.cos(ang - 0.3) * 7 * s, y + Math.sin(ang - 0.3) * 7 * s);
      g.lineTo(sx + Math.cos(ang) * 12 * s, y + Math.sin(ang) * 12 * s);
      g.lineTo(sx + Math.cos(ang + 0.3) * 7 * s, y + Math.sin(ang + 0.3) * 7 * s);
    }
    g.fill();
    g.fillStyle = '#FF8A2B';
    g.beginPath();
    g.arc(sx, y, 7 * s, 0, TAU);
    g.fill();
  }
  g.fillStyle = '#E8541E';
  g.font = `900 ${Math.round(27 * s)}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('NOON', cx, y + 1.5 * s);
}

function serifCard(g: CanvasRenderingContext2D, cx: number, y: number, text: string, s: number, a: number, ink: string, paper: string): void {
  if (a <= 0) return;
  g.globalAlpha = a;
  const font = SERIF.replace('{S}', String(Math.round(34 * s)));
  g.font = font;
  const tw = g.measureText(text).width;
  const w = tw + 44 * s;
  const h = 54 * s;
  g.fillStyle = 'rgba(43,33,64,0.16)';
  roundRect(g, cx - w / 2, y - h / 2 + 4, w, h, 14 * s);
  g.fill();
  g.fillStyle = paper;
  roundRect(g, cx - w / 2, y - h / 2, w, h, 14 * s);
  g.fill();
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, cx, y + 2 * s);
}
