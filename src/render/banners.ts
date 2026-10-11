// Screen-space moments (GDD §11): the NOON banner (drops from the top over 600 ms, holds 1.2 s),
// the NIGHT card, the "DAY N" serif card (slides in from the right in 500 ms, holds 1 s; fades
// under reduced motion), and edge vignettes: low-Chill heat haze (≤ 0.25 α pulsing at 1.1 Hz),
// the cool multiplier pulse and the gold ×5 pulse. Photosensitivity: no full-screen flash.

import type { View } from '../game/camera.ts';
import { roundRect, vignette } from './sprites.ts';

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
}

export function createBanners(): Banners {
  return { noon: -1, night: -1, day: -1, dayN: 1, dayText: 'DAY 1', coolPulse: 0, goldPulse: 0, heat: 0, heatPhase: 0 };
}

export function resetBanners(b: Banners): void {
  b.noon = -1;
  b.night = -1;
  b.day = -1;
  b.coolPulse = 0;
  b.goldPulse = 0;
  b.heat = 0;
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

/** Vignettes over the world viewport (call after the world, before the HUD). */
export function drawVignettes(g: CanvasRenderingContext2D, b: Banners, v: View): void {
  if (b.heat > 0.01) {
    const pulse = 0.5 - 0.5 * Math.cos(b.heatPhase * TAU * 1.1);
    g.globalAlpha = 0.25 * pulse * b.heat;
    g.drawImage(vignette('255,106,61'), v.vx, v.vy, v.vw, v.vh);
  }
  if (b.coolPulse > 0) {
    g.globalAlpha = 0.18 * Math.sin((Math.PI * b.coolPulse) / 0.25);
    g.drawImage(vignette('90,184,255'), v.vx, v.vy, v.vw, v.vh);
  }
  if (b.goldPulse > 0) {
    g.globalAlpha = 0.2 * Math.sin((Math.PI * b.goldPulse) / 0.45);
    g.drawImage(vignette('255,194,61'), v.vx, v.vy, v.vw, v.vh);
  }
  g.globalAlpha = 1;
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
    serifCard(g, cx, top + 40 * scale, 'night', scale * 0.8, a, '#E8ECFF', 'rgba(29,34,71,0.72)');
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
  g.globalAlpha = 1;
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
