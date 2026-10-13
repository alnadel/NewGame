// Screen-space moments (GDD §11): the Night card ('Night · Day N survived' by a crescent), the Day
// card (a serif 'DAY N' over a small-caps line 'MEADOW · Heat Wave · NOON 72°' with the biome's
// glyph, on biome paper with five slow rays behind it; slides in from the right in 500 ms, holds,
// leaves to the left; fades only under reduced motion), the stamps (a plate that slams in at 2.4× over 220 ms with an overshoot, tilted
// −4°, holds, then fades and rises 12 px over 300 ms; under reduced motion it only fades: 'HIGH
// NOON', 'PASSED SAM!' in teal, 'PAST YOUR RECENT BEST' in gold), and the timers of the edge
// vignettes the atmosphere layer draws (atmosphere.ts): low-Chill heat haze, the cool multiplier
// pulse and the gold ×5 pulse. Photosensitivity: no full-screen flash.

import { FORECASTS, type BiomeId, type ForecastId } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { drawGlyph } from './glyphs.ts';
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
  /** Stars earned shown under a FINISH stamp (−1 none): they pop in one by one. */
  stampStars: number;
  /** The Day card rays' fill (a radial fade, in card-centred px) and the ray length it was built for. */
  rayFill: CanvasGradient | null;
  rayLen: number;
  /** Fonts for the HUD scale they were built at. */
  fontK: number;
  dayFont: string;
  lineFont: string;
  nightFont: string;
  /**
   * The level intro card (CAMPAIGN_PLAN §4): seconds since it appeared (−1 none), seconds since it
   * was dismissed (−1 while it holds), its words, and the blurb wrapped for the width it was laid
   * out at (levelWrapW; rewrapped when that changes).
   */
  level: number;
  levelOut: number;
  levelKicker: string;
  levelTitle: string;
  levelConcept: string | null;
  levelConceptName: string;
  levelBlurb: string;
  levelGoal: string;
  /** The three star rules' short labels: the goal, the flakes, the cool run. */
  levelStars: readonly string[];
  levelBiome: BiomeId;
  levelLines: string[];
  levelWrapW: number;
  levelTitleW: number;
  kickerFont: string;
  titleFont: string;
  blurbFont: string;
  tapFont: string;
  starFont: string;
  /**
   * In-run toasts under the HUD (v1.4): a mission done ("MISSION ✓ 2/3"), a level tip. They queue
   * (at most TOAST_QUEUE) and wait while a card or stamp holds the top of the screen, so they never
   * cover those, Nubs or his dial. toastT: seconds the first one has shown (−1 none showing).
   */
  toasts: Toast[];
  toastT: number;
  toastLines: string[];
  toastWrapW: number;
  toastFont: string;
}

export type ToastKind = 'mission' | 'tip';

export interface Toast {
  kind: ToastKind;
  kicker: string;
  text: string;
  /** Glyph in the icon disc (drawGlyph id); null draws a check mark. */
  glyph: string | null;
  hold: number;
}

export type StampKind = 'noon' | 'teal' | 'gold' | 'finish' | 'miss';

/** Stamp timing (s): slam in, then fade out (the hold is per stamp). */
export const STAMP_IN = 0.22;
const STAMP_OUT = 0.3;
/** Plate, outline and ink of each stamp look. */
const STAMP_LOOK: Readonly<Record<StampKind, readonly [string, string, string]>> = {
  noon: ['#FFC23D', '#FF6A3D', '#2B2140'],
  teal: ['#2EC4B6', '#13857C', '#10302D'],
  gold: ['#FFE08A', '#D99A12', '#2B2140'],
  // The finish line: a white plate with checkered bands; the miss a rose plate.
  finish: ['#FFFFFF', '#2B2140', '#2B2140'],
  miss: ['#FFB3C1', '#B8324F', '#3A1020'],
};
/** The level card's slide-out (s). */
const LEVEL_OUT_S = 0.3;
/** The level card's slide-in (s). */
const LEVEL_IN_S = 0.32;

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
    stampStars: -1,
    rayFill: null,
    rayLen: 0,
    fontK: 0,
    dayFont: '',
    lineFont: '',
    nightFont: '',
    level: -1,
    levelOut: -1,
    levelKicker: '',
    levelTitle: '',
    levelConcept: null,
    levelConceptName: '',
    levelBlurb: '',
    levelGoal: '',
    levelStars: [],
    levelBiome: 'meadow',
    levelLines: [],
    levelWrapW: 0,
    levelTitleW: 0,
    kickerFont: '',
    titleFont: '',
    blurbFont: '',
    tapFont: '',
    starFont: '',
    toasts: [],
    toastT: -1,
    toastLines: [],
    toastWrapW: 0,
    toastFont: '',
  };
}

/** The intro card's words (game/campaign.ts introCard). */
export interface LevelCardWords {
  kicker: string;
  title: string;
  concept: string | null;
  conceptName: string;
  blurb: string;
  goal: string;
  /** The three star rules' short labels: "Finish", "6 flakes", "≤ 4 s in sun". */
  stars: readonly string[];
}

/**
 * Shows the level's intro card: "LEVEL 6", its name, the concept it teaches (glyph, name, blurb),
 * the goal and the three star rules. It holds until dismissLevelCard (the first tap).
 */
export function showLevelCard(b: Banners, w: LevelCardWords, biome: BiomeId): void {
  b.level = 0;
  b.levelOut = -1;
  b.levelKicker = w.kicker;
  b.levelTitle = w.title;
  // The Dazzle forecast keeps its sparkle; the concept with that id is Mirror Sun.
  b.levelConcept = w.concept === 'dazzle' ? 'mirror' : w.concept;
  b.levelConceptName = noLigatures(w.conceptName);
  b.levelBlurb = w.blurb;
  b.levelGoal = noLigatures(w.goal);
  b.levelStars = w.stars;
  b.levelBiome = biome;
  b.levelLines.length = 0;
  b.levelWrapW = 0;
  b.levelTitleW = 0;
}

/** Small caps draw "fl" and "fi" as full-size ligatures ("SnowfLAkes"): a zero-width non-joiner keeps them apart. */
function noLigatures(text: string): string {
  return text.replace(/f([il])/g, 'f\u200c$1');
}

/** The run started: the level card slides out. */
export function dismissLevelCard(b: Banners): void {
  if (b.level >= 0 && b.levelOut < 0) b.levelOut = 0;
}

/** Shows a stamp (it replaces any stamp still on screen). */
export function showStamp(b: Banners, kind: StampKind, text: string, hold: number): void {
  b.stamp = 0;
  b.stampKind = kind;
  b.stampText = text;
  b.stampHold = hold;
  b.stampW = 0;
  b.stampStars = -1;
}

/** Toasts waiting beyond this many are dropped (a burst of mission steps never backs up). */
const TOAST_QUEUE = 4;
const TOAST_IN = 0.25;
const TOAST_OUT = 0.3;

/** Queues an in-run toast (see Banners.toasts). */
export function showToast(b: Banners, kind: ToastKind, kicker: string, text: string, glyph: string | null, hold: number): void {
  if (b.toasts.length < TOAST_QUEUE) b.toasts.push({ kind, kicker: noLigatures(kicker), text, glyph, hold });
}

export function resetBanners(b: Banners): void {
  b.toasts.length = 0;
  b.toastT = -1;
  b.night = -1;
  b.day = -1;
  b.coolPulse = 0;
  b.goldPulse = 0;
  b.heat = 0;
  b.stamp = -1;
  b.level = -1;
  b.levelOut = -1;
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
  if (b.level >= 0) {
    b.level += dt;
    if (b.levelOut >= 0) {
      b.levelOut += dt;
      if (b.levelOut > LEVEL_OUT_S) {
        b.level = -1;
        b.levelOut = -1;
      }
    }
  }
  if (b.toastT >= 0) {
    b.toastT += dt;
    if (b.toastT > TOAST_IN + (b.toasts[0]?.hold ?? 0) + TOAST_OUT) {
      b.toasts.shift();
      b.toastT = -1;
    }
  }
  if (b.toastT < 0 && b.toasts.length > 0 && b.stamp < 0 && b.day < 0 && b.level < 0 && b.night < 0) {
    b.toastT = 0;
    b.toastWrapW = 0;
  }
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
  b.kickerFont = `small-caps 800 ${Math.round(13 * scale)}px ${SANS}`;
  b.titleFont = `italic 700 ${Math.round(32 * scale)}px ${SERIF}`;
  b.blurbFont = `500 ${Math.round(14 * scale)}px ${SANS}`;
  b.tapFont = `small-caps 700 ${Math.round(11 * scale)}px ${SANS}`;
  b.starFont = `700 ${Math.round(12 * scale)}px ${SANS}`;
  b.toastFont = `600 ${Math.round(13 * scale)}px ${SANS}`;
  b.toastWrapW = 0;
  b.stampW = 0;
  b.dayTitleW = 0;
  b.nightW = 0;
  b.levelWrapW = 0;
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
  const toast = b.toastT >= 0 ? b.toasts[0] : undefined;
  if (toast) drawToast(g, b, toast, v, cx, top, scale, reducedMotion);
  if (b.level >= 0) {
    const t = b.level;
    let x = cx;
    let a = 1;
    if (reducedMotion) {
      a = Math.min(1, t / 0.3);
      if (b.levelOut >= 0) a *= Math.max(0, 1 - b.levelOut / LEVEL_OUT_S);
    } else if (b.levelOut >= 0) {
      x = cx - v.vw * 0.9 * (b.levelOut / LEVEL_OUT_S) ** 2;
    } else if (t < LEVEL_IN_S) {
      x = cx + v.vw * 0.7 * (1 - easeOutBack(t / LEVEL_IN_S));
    }
    // Centred in the space between the HUD band and Nubs' dial (the ghost hand swipes below him).
    levelCard(g, b, v, x, top, scale, a, t);
  }
  g.globalAlpha = 1;
}

/** Toast looks: card, edge, icon disc and kicker ink. */
const TOAST_LOOK: Readonly<Record<ToastKind, readonly [string, string, string, string]>> = {
  mission: ['rgba(232,251,248,0.97)', '#2EC4B6', '#2EC4B6', '#13857C'],
  tip: ['rgba(255,248,238,0.97)', '#FFC23D', '#FFFFFF', '#A86F0A'],
};

/**
 * A toast card just under the HUD band, clear of the pause button's column: an icon disc (a check
 * or the tip's glyph), a small-caps kicker and up to three lines of text. Drops in, holds, fades up.
 */
function drawToast(g: CanvasRenderingContext2D, b: Banners, t: Toast, v: View, cx: number, top: number, scale: number, reducedMotion: boolean): void {
  const u = b.toastT;
  const outT = u - TOAST_IN - t.hold;
  let a = Math.min(1, u / TOAST_IN);
  let dy = reducedMotion ? 0 : -14 * (1 - easeOutBack(Math.min(1, u / TOAST_IN)));
  if (outT > 0) {
    const k = Math.min(1, outT / TOAST_OUT);
    a *= 1 - k;
    if (!reducedMotion) dy -= 10 * k;
  }
  if (a <= 0.01) return;
  const w = Math.min(v.vw - 112, 340 * scale);
  const pad = 10 * scale;
  const r = 14 * scale;
  const textW = w - 2 * pad - 2 * r - 10 * scale;
  if (b.toastWrapW !== textW) {
    b.toastWrapW = textW;
    g.font = b.toastFont;
    wrap(g, t.text, textW, b.toastLines);
    if (b.toastLines.length > 3) {
      b.toastLines.length = 3;
      b.toastLines[2] = `${(b.toastLines[2] as string).replace(/[ ,.;:!?]+$/, '')}…`;
    }
  }
  const lineH = 17 * scale;
  const h = Math.max(2 * r + 2 * pad, 2 * pad + 15 * scale + b.toastLines.length * lineH);
  const x0 = cx - w / 2;
  const y0 = top + 2 + dy;
  const [card, edge, disc, ink] = TOAST_LOOK[t.kind];
  g.globalAlpha = a;
  g.fillStyle = 'rgba(43,33,64,0.18)';
  roundRect(g, x0, y0 + 3, w, h, 14 * scale);
  g.fill();
  g.fillStyle = card;
  roundRect(g, x0, y0, w, h, 14 * scale);
  g.fill();
  g.strokeStyle = edge;
  g.lineWidth = 2;
  roundRect(g, x0 + 1, y0 + 1, w - 2, h - 2, 13 * scale);
  g.stroke();
  // The icon disc: a white check on teal (a mission), or the tip's glyph on white.
  const ix = x0 + pad + r;
  const iy = y0 + h / 2;
  g.fillStyle = disc;
  g.beginPath();
  g.arc(ix, iy, r, 0, TAU);
  g.fill();
  if (t.glyph) {
    g.strokeStyle = edge;
    g.lineWidth = 1.5;
    g.stroke();
    drawGlyph(g, t.glyph, ix, iy, 18 * scale);
  } else {
    g.strokeStyle = '#FFFFFF';
    g.lineWidth = 3 * scale;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(ix - 6 * scale, iy + 0.5 * scale);
    g.lineTo(ix - 1.5 * scale, iy + 5 * scale);
    g.lineTo(ix + 6.5 * scale, iy - 4.5 * scale);
    g.stroke();
    g.lineCap = 'butt';
  }
  const tx = ix + r + 10 * scale;
  let ty = y0 + pad + 7 * scale;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = ink;
  g.font = b.kickerFont;
  g.fillText(t.kicker, tx, ty);
  ty += 8 * scale + lineH / 2;
  g.fillStyle = '#2B2140';
  g.font = b.toastFont;
  for (const line of b.toastLines) {
    g.fillText(line, tx, ty);
    ty += lineH;
  }
  g.globalAlpha = 1;
}

/** Greedy word wrap of `text` into lines no wider than maxW (g.font set by the caller). */
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, out: string[]): void {
  out.length = 0;
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && g.measureText(next).width > maxW) {
      out.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
}

/**
 * The level intro card: kicker, serif name, a rule, the concept row (glyph + small-caps name), the
 * blurb (wrapped, up to 3 lines), the goal line and a pulsing "tap to start".
 */
function levelCard(g: CanvasRenderingContext2D, b: Banners, v: View, cx: number, top: number, scale: number, a: number, t: number): void {
  if (a <= 0) return;
  const w = Math.min(v.vw - 32, 352 * scale);
  const pad = 18 * scale;
  const innerW = w - 2 * pad;
  if (b.levelWrapW !== innerW) {
    b.levelWrapW = innerW;
    g.font = b.blurbFont;
    wrap(g, b.levelBlurb, innerW, b.levelLines);
    if (b.levelLines.length > 3) {
      b.levelLines.length = 3;
      b.levelLines[2] = `${(b.levelLines[2] as string).replace(/[ ,.;:!?]+$/, '')}…`;
    }
    g.font = b.titleFont;
    b.levelTitleW = g.measureText(b.levelTitle).width;
  }
  const lineH = 18 * scale;
  const hasConcept = b.levelConceptName !== '';
  const blurbH = b.levelLines.length * lineH;
  // The same run of increments as the layout below, plus the tap line and the bottom margin.
  const starsH = b.levelStars.length === 3 ? STAR_ROW_H * scale : 0;
  const h = (24 + 26 + 22 + 18) * scale + (hasConcept ? 26 * scale : 0) + blurbH + (blurbH > 0 ? 8 * scale : 0) + (22 + 12 + 14 + 14) * scale + starsH;
  // The card sits between the HUD band and the dial: centred in that space, never over Nubs.
  const dialTop = v.ny - 60 * v.S;
  const y = Math.max(top + 8, Math.min((top + dialTop) / 2, dialTop - h / 2 - 8)) - h / 2;
  const x0 = cx - w / 2;
  g.globalAlpha = a;
  g.fillStyle = 'rgba(43,33,64,0.18)';
  roundRect(g, x0, y + 5, w, h, 16 * scale);
  g.fill();
  g.fillStyle = b.levelBiome === 'oldtown' ? 'rgba(255,241,230,0.97)' : 'rgba(255,248,238,0.97)';
  roundRect(g, x0, y, w, h, 16 * scale);
  g.fill();
  // A thin teal band along the top edge (the campaign's colour).
  g.save();
  roundRect(g, x0, y, w, h, 16 * scale);
  g.clip();
  g.fillStyle = '#2EC4B6';
  g.fillRect(x0, y, w, 5 * scale);
  g.restore();
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  let ly = y + 14 * scale + 10 * scale;
  g.fillStyle = '#13857C';
  g.font = b.kickerFont;
  g.fillText(b.levelKicker, cx, ly);
  ly += 16 * scale + 10 * scale;
  g.fillStyle = '#2B2140';
  g.font = b.levelTitleW > innerW ? `italic 700 ${Math.round(32 * scale * (innerW / b.levelTitleW))}px ${SERIF}` : b.titleFont;
  g.fillText(b.levelTitle, cx, ly);
  ly += 22 * scale;
  // Rule.
  g.strokeStyle = 'rgba(43,33,64,0.14)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x0 + pad, ly + 6 * scale);
  g.lineTo(x0 + w - pad, ly + 6 * scale);
  g.stroke();
  ly += 18 * scale;
  if (hasConcept) {
    const glyph = 18 * scale;
    g.font = b.lineFont;
    const nameW = g.measureText(b.levelConceptName).width;
    const rowW = (b.levelConcept ? glyph + 7 * scale : 0) + nameW;
    let rx = cx - rowW / 2;
    if (b.levelConcept) {
      drawGlyph(g, b.levelConcept, rx + glyph / 2, ly + 1, glyph);
      rx += glyph + 7 * scale;
    }
    g.fillStyle = '#2B2140';
    g.textAlign = 'left';
    g.font = b.lineFont;
    g.fillText(b.levelConceptName, rx, ly + 1);
    g.textAlign = 'center';
    ly += 26 * scale;
  }
  if (blurbH > 0) {
    g.fillStyle = '#5B5070';
    g.font = b.blurbFont;
    for (const line of b.levelLines) {
      g.fillText(line, cx, ly + lineH / 2);
      ly += lineH;
    }
    ly += 8 * scale;
  }
  // The goal, as a small pill.
  g.font = b.lineFont;
  const gw = g.measureText(b.levelGoal).width + 34 * scale;
  const gh = 22 * scale;
  g.fillStyle = 'rgba(46,196,182,0.16)';
  roundRect(g, cx - gw / 2, ly, gw, gh, gh / 2);
  g.fill();
  drawGlyph(g, 'goal', cx - gw / 2 + 12 * scale, ly + gh / 2, 11 * scale);
  g.fillStyle = '#13857C';
  g.textAlign = 'left';
  g.fillText(b.levelGoal, cx - gw / 2 + 22 * scale, ly + gh / 2 + 0.5);
  g.textAlign = 'center';
  ly += gh + 12 * scale;
  if (starsH > 0) {
    starRules(g, b, x0 + pad, innerW, ly, scale);
    ly += starsH;
  }
  // "tap to start", breathing.
  const pulse = b.levelOut >= 0 ? 0 : 0.55 + 0.45 * Math.sin(t * TAU * 0.9);
  g.fillStyle = `rgba(107,90,122,${0.45 + 0.55 * pulse})`;
  g.font = b.tapFont;
  g.fillText('tap or drag to start', cx, ly + 6 * scale);
}

/** Height of the intro card's star-rules row (× the HUD scale). */
const STAR_ROW_H = 50;
/** The glyph beside each star rule: the goal, a flake, the sun (a cool run). */
const STAR_GLYPHS = ['goal', 'frosty', 'clear'];

/**
 * The three star rules in three columns, each a gold star carrying the rule's glyph over its short
 * label: "★ Finish", "★ 6 flakes", "★ ≤ 4 s in sun".
 */
function starRules(g: CanvasRenderingContext2D, b: Banners, x0: number, w: number, y: number, scale: number): void {
  const colW = w / 3;
  const r = 10 * scale;
  g.fillStyle = 'rgba(255,194,61,0.12)';
  roundRect(g, x0, y - 4 * scale, w, (STAR_ROW_H - 4) * scale, 12 * scale);
  g.fill();
  g.font = b.starFont;
  g.textAlign = 'center';
  for (let i = 0; i < 3; i++) {
    const cx = x0 + colW * (i + 0.5);
    const cy = y + r + 2 * scale;
    star(g, cx - 7 * scale, cy, r, '#FFC23D', '#B87A0A');
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(cx + 9 * scale, cy + 2 * scale, 8.5 * scale, 0, TAU);
    g.fill();
    drawGlyph(g, STAR_GLYPHS[i] as string, cx + 9 * scale, cy + 2 * scale, 12 * scale);
    g.fillStyle = '#5B4A2A';
    g.fillText(b.levelStars[i] as string, cx, y + 31 * scale);
  }
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
  if (b.stampKind === 'finish') {
    // Checkered bands along the top and bottom edges: the finish flag.
    const sq = Math.max(4, Math.round(7 * scale));
    g.save();
    roundRect(g, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 8 * scale);
    g.clip();
    g.fillStyle = ink;
    for (let row = 0; row < 2; row++) {
      for (let x = -w / 2 + 4 + (row % 2) * sq; x < w / 2; x += sq * 2) {
        g.fillRect(x, -h / 2 + 4 + row * sq, sq, sq);
        g.fillRect(x + (row % 2 === 0 ? sq : -sq), h / 2 - 4 - (row + 1) * sq, sq, sq);
      }
    }
    g.restore();
  }
  g.fillStyle = ink;
  g.font = b.stampFont;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(b.stampText, 0, size * 0.04);
  g.restore();
  // The level's stars under the plate, popping in one by one (earned gold, missed pale).
  if (b.stampStars < 0) return;
  const r = 13 * scale;
  for (let i = 0; i < 3; i++) {
    const u = reducedMotion ? 1 : Math.min(1, Math.max(0, (t - STAMP_IN - 0.1 - 0.16 * i) / 0.24));
    if (u <= 0) continue;
    const k = reducedMotion ? 1 : easeOutBack(u);
    const on = i < b.stampStars;
    g.globalAlpha = a;
    star(g, cx + (i - 1) * 2.6 * r, y + rise + h / 2 + 1.6 * r, r * k, on ? '#FFC23D' : 'rgba(255,255,255,0.75)', on ? '#B87A0A' : 'rgba(43,33,64,0.35)');
  }
  g.globalAlpha = 1;
}

/** A five-point star of outer radius r at (x, y). */
function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, line: string): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = Math.max(1.5, r * 0.16);
  g.lineJoin = 'round';
  g.strokeStyle = line;
  g.stroke();
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
  // Five warm rays behind the card, turning at 6°/s and fading out toward their tips.
  const len = Math.round(w * 0.62);
  if (b.rayLen !== len || !b.rayFill) {
    const f = g.createRadialGradient(0, 0, 0, 0, 0, len);
    f.addColorStop(0, '#FFD36B');
    f.addColorStop(0.55, 'rgba(255,211,107,0.8)');
    f.addColorStop(1, 'rgba(255,211,107,0)');
    b.rayFill = f;
    b.rayLen = len;
  }
  g.save();
  g.translate(cx, y);
  g.globalAlpha = a * 0.5;
  g.fillStyle = b.rayFill;
  g.beginPath();
  for (let i = 0; i < 5; i++) {
    const ang = (i * TAU) / 5 + t * 6 * DEG - Math.PI / 2;
    g.moveTo(0, 0);
    g.lineTo(Math.cos(ang - 0.17) * len, Math.sin(ang - 0.17) * len);
    g.lineTo(Math.cos(ang + 0.17) * len, Math.sin(ang + 0.17) * len);
    g.closePath();
  }
  g.fill();
  g.restore();
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
  drawGlyph(g, b.dayBiome, lx + glyph / 2, ly, glyph);
  g.fillStyle = '#6B5A7A';
  g.textAlign = 'left';
  g.font = b.lineFont;
  g.fillText(b.dayLine, lx + glyph + gap, ly + 0.5 * scale);
}
