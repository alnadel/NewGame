// Canvas HUD (V1_PLAN §9, GDD §5, CRITIQUE #25): one compact row under the safe inset, to the right
// of the DOM pause button: a "D2" badge, the clock in 10-minute steps, and the day ruler (dawn →
// noon → dusk gradient, progress, the noon "boss" icon, a gold PB flag and a teal challenge flag);
// Snow and the multiplier badge (pop on ×up, shake on reset) on the right.

import { dayTicks, hudClock, minutesOfDay, type SimState } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { cssa, hex } from './color.ts';
import { flake, roundRect } from './sprites.ts';

const INK = hex('#2B2140');
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const TAU = Math.PI * 2;

export interface HudState {
  multPop: number;
  multShake: number;
  snowPop: number;
  noonSparkle: number;
  /** Cached strings. */
  clockKey: number;
  clock: string;
  snowVal: number;
  snowText: string;
  multVal: number;
  multText: string;
  dayVal: number;
  dayText: string;
  rulerX0: number;
  rulerX1: number;
  rulerGrad: CanvasGradient | null;
  /** Measured char widths per font. */
  widths: Map<string, number>;
  /** Bottom of the HUD band (CSS px), for the sun glyph and banners. */
  bottom: number;
}

export function createHud(): HudState {
  return {
    multPop: 0,
    multShake: 0,
    snowPop: 0,
    noonSparkle: 0,
    clockKey: -1,
    clock: '',
    snowVal: -1,
    snowText: '0',
    multVal: -1,
    multText: '×1',
    dayVal: -1,
    dayText: 'D1',
    rulerX0: 0,
    rulerX1: 0,
    rulerGrad: null,
    widths: new Map(),
    bottom: 64,
  };
}

export function updateHud(h: HudState, dt: number): void {
  h.multPop = Math.max(0, h.multPop - dt);
  h.multShake = Math.max(0, h.multShake - dt);
  h.snowPop = Math.max(0, h.snowPop - dt);
  h.noonSparkle = Math.max(0, h.noonSparkle - dt);
}

export function hudScale(v: View): number {
  return Math.min(1.3, Math.max(0.85, v.cssW / 390));
}

function charW(g: CanvasRenderingContext2D, h: HudState, font: string, ch: string): number {
  const key = font + ch;
  let w = h.widths.get(key);
  if (w === undefined) {
    g.font = font;
    w = g.measureText(ch).width;
    h.widths.set(key, w);
  }
  return w;
}

/** Text with tabular digits: every digit advances by the width of '0'. Returns the total width. */
function tabularWidth(g: CanvasRenderingContext2D, h: HudState, font: string, s: string): number {
  const zero = charW(g, h, font, '0');
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    w += c >= '0' && c <= '9' ? zero : charW(g, h, font, c);
  }
  return w;
}

function drawTabular(g: CanvasRenderingContext2D, h: HudState, font: string, s: string, x: number, y: number): void {
  const zero = charW(g, h, font, '0');
  g.font = font;
  g.textAlign = 'left';
  let cx = x;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c >= '0' && c <= '9') {
      const cw = charW(g, h, font, c);
      g.fillText(c, cx + (zero - cw) / 2, y);
      cx += zero;
    } else {
      g.fillText(c, cx, y);
      cx += charW(g, h, font, c);
    }
  }
}

function pill(g: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, fill: string, shadow: boolean): void {
  if (shadow) {
    g.fillStyle = cssa(INK, 0.14);
    roundRect(g, x, y + 2, w, hgt, hgt / 2);
    g.fill();
  }
  g.fillStyle = fill;
  roundRect(g, x, y, w, hgt, hgt / 2);
  g.fill();
}

export interface HudInput {
  s: SimState;
  /** Absolute target minutes (or −1): personal best and challenge. */
  pbMinutes: number;
  challengeMinutes: number;
  alpha: number;
  time: number;
}

/** Draws the HUD row; returns nothing. Updates h.bottom (bottom edge of the band in CSS px). */
export function drawHud(g: CanvasRenderingContext2D, h: HudState, v: View, inp: HudInput): void {
  const k = hudScale(v);
  const top = v.safe.top + 8;
  const rowH = 48;
  const cy = top + rowH / 2;
  h.bottom = top + rowH + 8;
  if (inp.alpha <= 0.01) return;
  const s = inp.s;
  g.globalAlpha = inp.alpha;
  g.textBaseline = 'middle';

  // --- Right: Snow + multiplier ---------------------------------------------------------------
  if (s.stats.snow !== h.snowVal) {
    if (h.snowVal >= 0 && s.stats.snow > h.snowVal) h.snowPop = 0.18;
    h.snowVal = s.stats.snow;
    h.snowText = String(Math.floor(s.stats.snow));
  }
  if (s.nubs.mult !== h.multVal) {
    h.multVal = s.nubs.mult;
    h.multText = `×${s.nubs.mult}`;
  }
  const snowFont = `800 ${Math.round(18 * k)}px ${FONT}`;
  const multFont = `800 ${Math.round(14 * k)}px ${FONT}`;
  const snowW = tabularWidth(g, h, snowFont, h.snowText);
  const multW = charW(g, h, multFont, '×') + tabularWidth(g, h, multFont, String(s.nubs.mult));
  const iconS = 18 * k;
  const badgeW = multW + 14 * k;
  const badgeH = 24 * k;
  const rightW = 10 * k + iconS + 6 * k + snowW + 8 * k + badgeW + 6 * k;
  const rx1 = v.vx + v.vw - v.safe.right - 8;
  const rx0 = rx1 - rightW;
  const panelH = 40 * k > rowH ? rowH : 40 * k;
  pill(g, rx0, cy - panelH / 2, rightW, panelH, cssa(0xffffff, 0.9), true);
  let x = rx0 + 10 * k;
  const pop = h.snowPop > 0 ? 1 + 0.18 * Math.sin((Math.PI * h.snowPop) / 0.18) : 1;
  g.save();
  g.translate(x + iconS / 2, cy);
  g.scale(pop, pop);
  g.drawImage(flake(), -iconS / 2, -iconS / 2, iconS, iconS);
  g.restore();
  x += iconS + 6 * k;
  g.fillStyle = '#2B5A8A';
  drawTabular(g, h, snowFont, h.snowText, x, cy + 1);
  x += snowW + 8 * k;
  // Multiplier badge: pops 1 → 1.4 → 1 on ×up (elastic), shakes ±4 px on reset; gold from ×2.
  const m = s.nubs.mult;
  let bs = 1;
  if (h.multPop > 0) {
    const t = 1 - h.multPop / 0.3;
    bs = 1 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 1.3)) * Math.exp(-t * 2);
  }
  const shake = h.multShake > 0 ? Math.sin(h.multShake * 90) * 4 * (h.multShake / 0.2) : 0;
  const bx = x + badgeW / 2 + shake;
  g.save();
  g.translate(bx, cy);
  g.scale(bs, bs);
  const gold = m >= 2;
  const max = m >= 5;
  pill(g, -badgeW / 2, -badgeH / 2, badgeW, badgeH, gold ? (max ? '#FF9F1C' : '#FFC23D') : '#E9E4F2', false);
  if (max) {
    g.strokeStyle = cssa(0xffffff, 0.6 + 0.4 * Math.sin(inp.time * 8));
    g.lineWidth = 2;
    roundRect(g, -badgeW / 2 + 1, -badgeH / 2 + 1, badgeW - 2, badgeH - 2, badgeH / 2 - 1);
    g.stroke();
  }
  g.fillStyle = gold ? '#2B2140' : '#5B5070';
  g.font = multFont;
  g.textAlign = 'center';
  g.fillText(h.multText, 0, 1);
  g.restore();

  // --- Left: D-badge, clock, ruler --------------------------------------------------------------
  const lx0 = v.vx + v.safe.left + 8 + 48 + 8;
  const lx1 = rx0 - 8;
  if (lx1 - lx0 < 120) {
    g.globalAlpha = 1;
    return;
  }
  pill(g, lx0, cy - panelH / 2, lx1 - lx0, panelH, cssa(0xffffff, 0.9), true);
  if (s.day !== h.dayVal) {
    h.dayVal = s.day;
    h.dayText = `D${s.day}`;
  }
  const dayFont = `800 ${Math.round(13 * k)}px ${FONT}`;
  const dW = tabularWidth(g, h, dayFont, h.dayText) + 12 * k;
  const dH = 22 * k;
  let lx = lx0 + 8 * k;
  pill(g, lx, cy - dH / 2, dW, dH, '#2B2140', false);
  g.fillStyle = '#FFF8EE';
  drawTabular(g, h, dayFont, h.dayText, lx + 6 * k, cy + 1);
  lx += dW + 7 * k;
  // Clock (10-minute steps; flicker-free).
  const ticks = dayTicks(s.day);
  const key = s.day * 1000 + Math.floor(minutesOfDay(s.day, s.dayTick) / 10);
  if (key !== h.clockKey) {
    h.clockKey = key;
    h.clock = hudClock(s.day, Math.min(s.dayTick, ticks));
  }
  const clockFont = `800 ${Math.round(19 * k)}px ${FONT}`;
  g.fillStyle = '#2B2140';
  drawTabular(g, h, clockFont, h.clock, lx, cy + 1);
  // Reserve the width of the widest clock so the ruler doesn't jump.
  lx += tabularWidth(g, h, clockFont, '12:00 PM') + 10 * k;
  const r0 = lx;
  const r1 = lx1 - 12 * k;
  if (r1 - r0 > 24) drawRuler(g, h, s, r0, r1, cy, k, inp);
  g.globalAlpha = 1;
}

function drawRuler(g: CanvasRenderingContext2D, h: HudState, s: SimState, x0: number, x1: number, cy: number, k: number, inp: HudInput): void {
  const hgt = 7 * k;
  const y = cy - hgt / 2 + 1;
  if (!h.rulerGrad || h.rulerX0 !== x0 || h.rulerX1 !== x1) {
    const grad = g.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, '#FF9E6B');
    grad.addColorStop(0.22, '#FFD27A');
    grad.addColorStop(0.5, '#FFF2B0');
    grad.addColorStop(0.78, '#FFC23D');
    grad.addColorStop(1, '#E3829E');
    h.rulerGrad = grad;
    h.rulerX0 = x0;
    h.rulerX1 = x1;
  }
  const dl = dayTicks(s.day);
  const night = s.dayTick >= dl;
  const frac = Math.min(1, s.dayTick / dl);
  const px = x0 + (x1 - x0) * frac;
  // Track (faded) then elapsed (full).
  g.fillStyle = cssa(INK, 0.1);
  roundRect(g, x0 - 1, y - 1, x1 - x0 + 2, hgt + 2, (hgt + 2) / 2);
  g.fill();
  g.globalAlpha = inp.alpha * 0.45;
  g.fillStyle = h.rulerGrad;
  roundRect(g, x0, y, x1 - x0, hgt, hgt / 2);
  g.fill();
  g.globalAlpha = inp.alpha;
  g.save();
  g.beginPath();
  g.rect(x0 - 1, y - 2, px - x0 + 1, hgt + 4);
  g.clip();
  roundRect(g, x0, y, x1 - x0, hgt, hgt / 2);
  g.fill();
  g.restore();
  // Noon boss icon.
  const nx = (x0 + x1) / 2;
  const nr = 5.5 * k;
  const ny = y - nr - 1;
  const passed = s.dayTick > dl * 0.6;
  g.fillStyle = passed ? '#FFD27A' : '#FF8A2B';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * TAU) / 8;
    g.moveTo(nx + Math.cos(a - 0.3) * nr, ny + Math.sin(a - 0.3) * nr);
    g.lineTo(nx + Math.cos(a) * nr * 1.55, ny + Math.sin(a) * nr * 1.55);
    g.lineTo(nx + Math.cos(a + 0.3) * nr, ny + Math.sin(a + 0.3) * nr);
  }
  g.fill();
  g.beginPath();
  g.arc(nx, ny, nr, 0, TAU);
  g.fill();
  // Angry brows (it's the boss).
  g.strokeStyle = '#7A3B00';
  g.lineWidth = Math.max(1, 1.1 * k);
  g.beginPath();
  g.moveTo(nx - nr * 0.6, ny - nr * 0.35);
  g.lineTo(nx - nr * 0.1, ny - nr * 0.05);
  g.moveTo(nx + nr * 0.6, ny - nr * 0.35);
  g.lineTo(nx + nr * 0.1, ny - nr * 0.05);
  g.stroke();
  if (h.noonSparkle > 0) {
    const t = 1 - h.noonSparkle / 1.2;
    g.strokeStyle = cssa(0xffffff, 1 - t);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(nx, ny, nr * (1.4 + t * 2.5), 0, TAU);
    g.stroke();
  }
  // Flags: PB (gold) and challenge (teal), when they fall inside today.
  const dayStart = (s.day - 1) * 720;
  const flag = (minutes: number, color: string): void => {
    if (minutes < 0) return;
    const m = minutes - dayStart;
    if (m < 0 || m > 720) return;
    const fx = x0 + ((x1 - x0) * m) / 720;
    g.strokeStyle = '#2B2140';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(fx, y + hgt + 1);
    g.lineTo(fx, y - 9 * k);
    g.stroke();
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(fx, y - 9 * k);
    g.lineTo(fx + 7 * k, y - 6.5 * k);
    g.lineTo(fx, y - 4 * k);
    g.closePath();
    g.fill();
  };
  flag(inp.pbMinutes, '#FFC23D');
  flag(inp.challengeMinutes, '#2EC4B6');
  // Progress head (a moon at night).
  if (night) {
    g.fillStyle = '#E8ECFF';
    g.beginPath();
    g.arc(x1, cy + 1, 5.5 * k, 0, TAU);
    g.fill();
    g.fillStyle = '#34306B';
    g.beginPath();
    g.arc(x1 + 2.2 * k, cy - 0.5, 4.6 * k, 0, TAU);
    g.fill();
  } else {
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = '#2B2140';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px, cy + 1, 5 * k, 0, TAU);
    g.fill();
    g.stroke();
  }
}
