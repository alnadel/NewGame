// Canvas HUD (V1_PLAN §9, GDD §5, archive/CRITIQUE #25): one compact row under the safe inset, to the right
// of the DOM pause button: a "D2" badge (with the day's forecast as a sticker unless it is clear), the clock
// in 10-minute steps, and the day ruler (dawn → noon → dusk gradient, progress, the noon "boss"
// icon, a gold PB flag and a teal challenge flag); Snow and the multiplier badge (pop on ×up, shake
// on reset) on the right.
//
// Cost: the row is rendered into an offscreen layer and rebuilt only when what it shows changes
// (Snow, the clock's 10-minute step, the day and its forecast, noon passed, night, the flags, the
// layout) — about once every 0.7 s of play. Each frame then blits that layer and draws the few
// moving parts on top from small cached sprites: the flake icon (pops), the multiplier badge (pops,
// shakes, glows at ×5), the elapsed part of the ruler and its progress head.
//
// Campaign variant (v1.2, CAMPAIGN_PLAN §4; v1.4): the badge reads "L6", three star pips take the
// clock's place (what the run has earned so far: the goal, the flakes star, the cool run, which
// greys out when lost; a pip pops when it lights), the ruler is the level's progress bar (start → a
// checkered finish, teal, with the gate or eclipse marker at the midpoint), the Snow pill counts
// "flakes/target" or "snow/target" for goal levels, and a wind glyph rides the progress head during
// a gust.
//
// The multiplier badge glows at ×5 (v1.6: the Flow Ring's charge runs round it, below).
//
// v1.5 frost meter (Cold Snap): a round gauge in the world rect's bottom-right corner, clear of the
// edge and home-bar zones, shown on runs that fill it. Its ring fills ice-blue around a snowflake;
// full, it glows and breathes with a bobbing "swipe down" chevron over it and a tap on it snaps
// (game/input.ts asks hudMeterHit); while a snap lasts the ring drains white.
//
// v1.6 (docs/V1_6_PLAN.md): the Flow Ring's charge runs round the multiplier badge (teal, gold as
// ×5's buffer, hot while it bleeds; a trick flashes it). The
// Frost Bank's meter is two pips that fill in turn (a full one glows and takes the tap); a spill
// shakes the second; during a snap the pips freeze (the first drains white
// with the snap) and a chip shows the income banked under it; a cash-in pours a stream of frost
// from the badge into the meter. The ruler marks the
// day's kept Heat Flares (teal once parried, grey once missed) and Noon Heat's 11-1 band; a level's
// progress bar marks its flares (a boss finale's HP notches).

import type { MechView } from './renderer.ts';
import { dayStartTick, dayTicks, FLARE_KEPT, FORECAST_IDS, hudClock, minutesOfDay, worldYAtTick, type Flare, type ForecastId, type SimState } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { star } from './banners.ts';
import { cssa, hex } from './color.ts';
import { drawGlyph } from './glyphs.ts';
import { ctx2d, flake, makeCanvas, radialSprite, roundRect, type Canvas2D } from './sprites.ts';

const INK = hex('#2B2140');
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const TAU = Math.PI * 2;
const ROW_H = 48;
/** Inputs of the row layer's key (syncHud). */
const KEYS = 21;
/** The cached band reaches this far above and below the row (pill shadows, flags, the noon icon). */
const BAND_PAD = 8;

/** Char widths for one font, indexed by char code (all HUD glyphs are < 256). */
type WidthTable = Float32Array;

export interface HudState {
  multPop: number;
  /** A star pip lighting up: seconds left of its pop, and which pip (0..2). */
  starPop: number;
  starPopI: number;
  /** The campaign star bits the layer shows (−1 none). */
  starBits: number;
  /** The pips' centres (CSS px): the first one's x and the step. */
  pipX: number;
  pipStep: number;
  multShake: number;
  snowPop: number;
  noonSparkle: number;
  /** Bottom of the HUD band (CSS px), for the sun glyph and banners. */
  bottom: number;

  // Cached text and the inputs the row layer was built from (−1/NaN = never).
  clockKey: number;
  clock: string;
  snowVal: number;
  /** The goal pill's target (−1: plain Snow). */
  snowTarget: number;
  snowText: string;
  /** snowText in whole seconds for a seconds goal (the tight-row fallback; else snowText). */
  snowShort: string;
  dayVal: number;
  dayText: string;
  /** The row layer's inputs (snow, goal, level and its markers, day, forecast, clock, flags, view) when built, and now. */
  readonly key: Float64Array;
  readonly nextKey: Float64Array;
  builtForecast: ForecastId | '';

  /** The row layer (device px) and where it goes (CSS px). */
  layer: Canvas2D | null;
  layerG: CanvasRenderingContext2D | null;
  layerX: number;
  layerY: number;
  layerW: number;
  layerH: number;

  // Layout of the moving parts, computed when the layer is built (CSS px).
  fontK: number;
  snowFont: string;
  multFont: string;
  dayFont: string;
  clockFont: string;
  /** v1.6: the banked chip. */
  chipFont: string;
  cy: number;
  iconX: number;
  iconS: number;
  badgeX: number;
  badgeW: number;
  badgeH: number;
  /** Left panel (D-badge, clock, ruler) shown; ruler shown and its geometry. */
  leftShown: boolean;
  rulerShown: boolean;
  rulerX0: number;
  rulerX1: number;
  rulerY: number;
  rulerH: number;
  noonX: number;
  noonY: number;
  noonR: number;

  /** The full-alpha ruler gradient bar (blitted up to the progress point each frame). */
  bar: Canvas2D | null;
  barX: number;
  barY: number;
  /** Progress head and the multiplier badge sprites. */
  head: Canvas2D | null;
  badge: Canvas2D | null;
  badgeKey: number;

  widths: Map<string, WidthTable>;

  /** v1.5 frost meter: shown last frame, its centre and radius (CSS px), the ready pop (s) and whether it was full. */
  meterShown: boolean;
  meterX: number;
  meterY: number;
  meterR: number;
  meterPop: number;
  meterFull: boolean;
  /** v1.6: the pips' half-span (the capsule a tap may hit), full pips last frame, a spill (s left), the banked chip's value and text; a cash-in's pour and a trick's flash (s left). */
  meterSpan: number;
  meterFullN: number;
  spill: number;
  lastBankH: number;
  chipText: string;
  pour: number;
  ringFlash: number;
}

export function createHud(): HudState {
  return {
    multPop: 0,
    starPop: 0,
    starPopI: 0,
    starBits: -1,
    pipX: 0,
    pipStep: 0,
    multShake: 0,
    snowPop: 0,
    noonSparkle: 0,
    bottom: 64,
    clockKey: -1,
    clock: '',
    snowVal: -1,
    snowTarget: -1,
    snowText: '0',
    snowShort: '0',
    dayVal: NaN,
    dayText: 'D1',
    key: new Float64Array(KEYS).fill(NaN),
    nextKey: new Float64Array(KEYS),
    builtForecast: '',
    layer: null,
    layerG: null,
    layerX: 0,
    layerY: 0,
    layerW: 0,
    layerH: 0,
    fontK: -1,
    snowFont: '',
    multFont: '',
    dayFont: '',
    clockFont: '',
    chipFont: '',
    cy: 0,
    iconX: 0,
    iconS: 18,
    badgeX: 0,
    badgeW: 0,
    badgeH: 0,
    leftShown: false,
    rulerShown: false,
    rulerX0: 0,
    rulerX1: 0,
    rulerY: 0,
    rulerH: 0,
    noonX: 0,
    noonY: 0,
    noonR: 0,
    bar: null,
    barX: 0,
    barY: 0,
    head: null,
    badge: null,
    badgeKey: -1,
    widths: new Map(),
    meterShown: false,
    meterX: 0,
    meterY: 0,
    meterR: 0,
    meterPop: 0,
    meterFull: false,
    meterSpan: 0,
    meterFullN: 0,
    spill: 0,
    lastBankH: 0,
    chipText: '',
    pour: 0,
    ringFlash: 0,
  };
}

export function updateHud(h: HudState, dt: number): void {
  h.multPop = Math.max(0, h.multPop - dt);
  h.starPop = Math.max(0, h.starPop - dt);
  h.multShake = Math.max(0, h.multShake - dt);
  h.snowPop = Math.max(0, h.snowPop - dt);
  h.noonSparkle = Math.max(0, h.noonSparkle - dt);
  h.meterPop = Math.max(0, h.meterPop - dt);
  h.spill = Math.max(0, h.spill - dt);
  h.pour = Math.max(0, h.pour - dt);
  h.ringFlash = Math.max(0, h.ringFlash - dt);
}

export function hudScale(v: View): number {
  return Math.min(1.3, Math.max(0.85, v.cssW / 390));
}

function widthTable(g: CanvasRenderingContext2D, h: HudState, font: string): WidthTable {
  let t = h.widths.get(font);
  if (!t) {
    t = new Float32Array(256).fill(-1);
    h.widths.set(font, t);
  }
  g.font = font;
  return t;
}

function charW(g: CanvasRenderingContext2D, t: WidthTable, ch: string): number {
  const code = ch.charCodeAt(0) & 255;
  let w = t[code] as number;
  if (w < 0) {
    w = g.measureText(ch).width;
    t[code] = w;
  }
  return w;
}

/** Width of `s` with tabular digits (every digit advances by the width of '0'). Sets g.font. */
function tabularWidth(g: CanvasRenderingContext2D, h: HudState, font: string, s: string): number {
  const t = widthTable(g, h, font);
  const zero = charW(g, t, '0');
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    w += c >= '0' && c <= '9' ? zero : charW(g, t, c);
  }
  return w;
}

/** Draws `s` with tabular digits (only when the row layer is rebuilt). */
function drawTabular(g: CanvasRenderingContext2D, h: HudState, font: string, s: string, x: number, y: number): void {
  const t = widthTable(g, h, font);
  const zero = charW(g, t, '0');
  g.textAlign = 'left';
  let cx = x;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c >= '0' && c <= '9') {
      g.fillText(c, cx + (zero - charW(g, t, c)) / 2, y);
      cx += zero;
    } else {
      g.fillText(c, cx, y);
      cx += charW(g, t, c);
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

/** A canvas of at least w × h device px, reusing `c` when it is big enough. */
function sized(c: Canvas2D | null, w: number, h: number): Canvas2D {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (c && c.width === cw && c.height === ch) return c;
  if (!c) return makeCanvas(cw, ch);
  c.width = cw;
  c.height = ch;
  return c;
}

/** The campaign row (renderer.ts CampaignView): the level, its progress, the goal pill and the gust. */
export interface HudCampaign {
  id: number;
  /** 0..1 to the finish line. */
  progress: number;
  goalValue: number;
  /** −1: the pill shows plain Snow. */
  goalTarget: number;
  goalFlakes: boolean;
  /** Marker positions (0..1) on the progress bar, −1 none. */
  markGate: number;
  markEclipse: number;
  /** The gust turning the sun now (−1 clockwise, +1 counter-clockwise, 0 none). */
  gust: number;
  /** The stars so far (game/campaign.ts starState bits: 1 goal met, 2 flakes star, 4 cool run lost). */
  stars: number;
  /** The cool run's sun budget left, 1..0 (a ring drains around the third pip as Nubs spends it). */
  coolLeft: number;
  /**
   * v1.6: the pill counts a Dare or a verb goal (its glyph replaces the flake; null: flakes or Snow),
   * in seconds when `goalSec` (the count and target are ticks).
   */
  goalGlyph: string | null;
  goalSec: boolean;
}

export interface HudInput {
  s: SimState;
  /** Absolute target minutes (or −1): the recent best (gold flag), the challenge (teal flag) and the next milestone (a white tick). */
  pbMinutes: number;
  challengeMinutes: number;
  goalMinutes: number;
  alpha: number;
  time: number;
  campaign: HudCampaign | null;
  /** v1.5: the mechanics (the frost meter's fill and an active snap), null on the Title's prebuild. */
  mech: MechView | null;
  reducedMotion: boolean;
}

/**
 * Brings the cached row layer and the multiplier badge up to date for `inp` (text, flags, layout)
 * without drawing anything. drawHud calls it every frame; the Title calls it on idle frames, so
 * the first play frame finds the layer, its width tables and the ruler already built.
 */
export function syncHud(h: HudState, v: View, inp: HudInput): void {
  const s = inp.s;
  const c = inp.campaign;

  // Text that changes with the run (cached strings; no per-frame allocation).
  const target = c ? c.goalTarget : -1;
  const sec = c !== null && c.goalSec;
  // Seconds show in tenths under 10 s, else whole (a count of ticks changes the text 10× a second at most).
  const snowNow = c && target >= 0 ? (sec ? Math.floor(c.goalValue / (target < 600 ? 6 : 60)) : c.goalValue) : s.stats.snow;
  if (snowNow !== h.snowVal || target !== h.snowTarget) {
    if (h.snowVal >= 0 && snowNow > h.snowVal && target === h.snowTarget) h.snowPop = 0.18;
    h.snowVal = snowNow;
    h.snowTarget = target;
    h.snowText = target < 0 ? String(Math.floor(snowNow)) : sec ? `${target < 600 ? (snowNow / 10).toFixed(1) : snowNow}/${target < 600 ? (target / 60).toFixed(1) : Math.round(target / 60)}s` : `${Math.floor(snowNow)}/${target}`;
    h.snowShort = sec && target < 600 ? `${Math.floor(snowNow / 10)}/${Math.round(target / 60)}s` : h.snowText;
  }
  const dayKey = c ? -c.id : s.day;
  if (dayKey !== h.dayVal) {
    h.dayVal = dayKey;
    h.dayText = c ? `L${c.id}` : `D${s.day}`;
  }
  const dl = dayTicks(s.day);
  const key = s.day * 1000 + Math.floor(minutesOfDay(s.day, s.dayTick) / 10);
  if (key !== h.clockKey) {
    h.clockKey = key;
    h.clock = hudClock(s.day, Math.min(s.dayTick, dl));
  }
  const night = s.dayTick >= dl ? 1 : 0;
  const passed = s.dayTick > dl * 0.6 ? 1 : 0;

  const marks = c ? (c.markGate >= 0 ? 1 : 0) + (c.markEclipse >= 0 ? 2 : 0) : 0;
  const stars = c ? c.stars : -1;
  if (stars !== h.starBits) {
    // A pip that lights up (the goal met, the flakes star) pops; the cool run greys out quietly.
    const lit = h.starBits >= 0 && stars >= 0 ? stars & ~h.starBits & 3 : 0;
    if (lit) {
      h.starPop = STAR_POP_S;
      h.starPopI = lit & 1 ? 0 : 1;
    }
    h.starBits = stars;
  }
  const n = h.nextKey;
  n[0] = h.snowVal;
  n[1] = h.snowTarget;
  n[2] = c ? c.id : -1;
  n[3] = marks;
  n[4] = h.dayVal;
  n[5] = FORECAST_IDS.indexOf(s.params.forecast);
  n[6] = h.clockKey;
  n[7] = passed;
  n[8] = night;
  n[9] = inp.pbMinutes;
  n[10] = inp.challengeMinutes;
  n[11] = inp.goalMinutes;
  n[12] = v.vx;
  n[13] = v.vw;
  n[14] = v.safe.top;
  n[15] = v.safe.left;
  n[16] = v.safe.right;
  n[17] = v.dpr;
  n[18] = stars;
  n[19] = inp.mech ? inp.mech.flareSig : 0;
  n[20] = inp.mech ? Math.round(inp.mech.noonHeat * 100) : 100;
  let same = h.layer !== null;
  for (let i = 0; i < KEYS && same; i++) same = n[i] === h.key[i];
  if (!same) {
    h.key.set(n);
    buildLayer(h, v, inp, passed, night);
  }
  const mult = inp.mech ? inp.mech.mult : s.nubs.mult;
  if (h.badgeKey !== mult) renderBadge(h, v, mult);
}

/** Draws the HUD row. Updates h.bottom (bottom edge of the band in CSS px). */
export function drawHud(g: CanvasRenderingContext2D, h: HudState, v: View, inp: HudInput): void {
  const top = v.safe.top + 8;
  h.bottom = top + ROW_H + 8;
  if (inp.alpha <= 0.01) {
    h.meterShown = false;
    return;
  }
  const s = inp.s;
  syncHud(h, v, inp);
  const dl = dayTicks(s.day);
  const night = s.dayTick >= dl ? 1 : 0;

  g.globalAlpha = inp.alpha;
  const layer = h.layer as Canvas2D;
  g.drawImage(layer, h.layerX, h.layerY, h.layerW, h.layerH);
  const cy = h.cy;

  // Snow flake icon (pops on +Snow; a Dare's or verb goal's glyph instead); a tight row drops it (buildLayer).
  if (h.iconS > 0) {
    const pop = h.snowPop > 0 ? 1 + 0.18 * Math.sin((Math.PI * h.snowPop) / 0.18) : 1;
    const iz = h.iconS * pop;
    const glyph = inp.campaign?.goalGlyph;
    if (glyph) drawGlyph(g, glyph, h.iconX + h.iconS / 2, cy, iz);
    else g.drawImage(flake(), h.iconX + h.iconS / 2 - iz / 2, cy - iz / 2, iz, iz);
  }

  // Multiplier badge: pops 1 → 1.4 → 1 on ×up (elastic), shakes ±4 px on reset; gold from ×2.
  const m = inp.mech ? inp.mech.mult : s.nubs.mult;
  let bs = 1;
  if (h.multPop > 0) {
    const t = 1 - h.multPop / 0.3;
    bs = 1 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 1.3)) * Math.exp(-t * 2);
  }
  // Under reduced motion the badge never shakes (the hot ring is the cue).
  const shake = h.multShake > 0 && !inp.reducedMotion ? Math.sin(h.multShake * 90) * 4 * (h.multShake / 0.2) : 0;
  const bx = h.badgeX + shake;
  const bw = h.badgeW * bs;
  const bh = h.badgeH * bs;
  const badge = h.badge as Canvas2D;
  const bp = BADGE_PAD * bs;
  g.drawImage(badge, bx - bw / 2 - bp, cy - bh / 2 - bp, bw + 2 * bp, bh + 2 * bp);
  const mech = inp.mech;
  if (mech?.ring) {
    // v1.6 Flow Ring: the charge runs clockwise round the badge from its top (×5: the buffer).
    const k = hudScale(v);
    const fl = h.ringFlash / RING_FLASH_S;
    const rw = bw + 6 * k;
    const rh = bh + 6 * k;
    g.lineWidth = 2.5 * k;
    g.strokeStyle = cssa(INK, 0.16);
    roundRect(g, bx - rw / 2, cy - rh / 2, rw, rh, rh / 2);
    g.stroke();
    // A trick flashes the charge it has (thicker and brighter), never a full ring: full reads "about to level up".
    g.lineWidth = (2.5 + 2.5 * fl) * k;
    g.strokeStyle = fl > 0 ? '#13C4B0' : mech.bleed ? '#FF6A3D' : m >= 5 ? '#E8A21F' : '#2EC4B6';
    const fill = fl > 0 ? Math.max(0.04, mech.ringFill) : mech.ringFill;
    ringDash(g, bx, cy, rw, rh, fill);
    if (fill > 0) g.stroke();
    g.setLineDash(noDash);
    g.lineDashOffset = 0;
  } else if (m >= 5) {
    g.strokeStyle = cssa(0xffffff, 0.6 + 0.4 * Math.sin(inp.time * 8));
    g.lineWidth = 2;
    roundRect(g, bx - bw / 2 + 1, cy - bh / 2 + 1, bw - 2, bh - 2, bh / 2 - 1);
    g.stroke();
  }

  // The cool run's sun budget: a ring around the third pip that drains with every second lit.
  const c = inp.campaign;
  if (c && h.leftShown && (c.stars & 4) === 0 && c.coolLeft < 1) {
    const k = hudScale(v);
    const px = h.pipX + 2 * h.pipStep;
    g.strokeStyle = c.coolLeft > 0.35 ? '#2EC4B6' : '#FF6A3D';
    g.lineWidth = 2 * k;
    g.beginPath();
    g.arc(px, cy + 1, (PIP_R + 2.5) * k, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, c.coolLeft));
    g.stroke();
  }

  // A star pip lighting up: a gold star swelling out of it and settling.
  if (h.starPop > 0 && h.leftShown && inp.campaign) {
    const u = 1 - h.starPop / STAR_POP_S;
    const k = hudScale(v);
    const r = PIP_R * k * (1 + 0.9 * Math.sin(Math.PI * Math.min(1, u * 1.4)) * (1 - u));
    star(g, h.pipX + h.starPopI * h.pipStep, cy + 1, r, '#FFC23D', '#B87A0A');
    g.strokeStyle = cssa(0xffc23d, 1 - u);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(h.pipX + h.starPopI * h.pipStep, cy + 1, PIP_R * k * (1 + 2 * u), 0, TAU);
    g.stroke();
  }

  // Ruler: elapsed part and the progress head (a moon at night is part of the layer). On a campaign
  // level the bar is the level's progress and the head always shows; a gust blows a wind glyph past it.
  if (h.leftShown && h.rulerShown) {
    const x0 = h.rulerX0;
    const x1 = h.rulerX1;
    const c = inp.campaign;
    const frac = c ? Math.min(1, Math.max(0, c.progress)) : Math.min(1, s.dayTick / dl);
    const px = x0 + (x1 - x0) * frac;
    const bar = h.bar as Canvas2D;
    const dpr = v.dpr;
    const sw = Math.min(bar.width, Math.max(0, Math.round((px - h.barX) * dpr)));
    if (sw > 0) g.drawImage(bar, 0, 0, sw, bar.height, h.barX, h.barY, sw / dpr, bar.height / dpr);
    if (!night || c) {
      const head = h.head as Canvas2D;
      const hw = head.width / dpr;
      g.drawImage(head, px - hw / 2, cy + 1 - hw / 2, hw, hw);
      // v1.6 Noon Heat: the head covers the hot band from 11 to 1, so while it bites the head glows hot.
      const m = inp.mech;
      if (!c && m && m.noonHeat > 1 && 12 * s.dayTick >= 5 * dl && 12 * s.dayTick < 7 * dl) {
        g.strokeStyle = cssa(0xff3d2b, 0.9);
        g.lineWidth = 2;
        g.beginPath();
        g.arc(px, cy + 1, hw / 2 + 1.5, 0, TAU);
        g.stroke();
      }
    }
    if (c && c.gust !== 0) {
      const k = hudScale(v);
      // The gust: a wind mark drifting past the head the way the sun is pushed (+1 CCW = leftward drag).
      const dir = c.gust > 0 ? -1 : 1;
      const drift = ((inp.time * 1.6) % 1) * 10 * k;
      const wx = Math.min(x1 + 6 * k, Math.max(x0 - 6 * k, px + dir * (14 * k + drift)));
      const wy = cy - 10 * k;
      g.fillStyle = cssa(0xffffff, 0.92);
      g.beginPath();
      g.arc(wx, wy, 8.5 * k, 0, TAU);
      g.fill();
      drawGlyph(g, 'gusts', wx, wy, 13 * k, undefined, dir < 0);
    }
    if (h.noonSparkle > 0) {
      const t = 1 - h.noonSparkle / 1.2;
      g.strokeStyle = cssa(0xffffff, 1 - t);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(h.noonX, h.noonY, h.noonR * (1.4 + t * 2.5), 0, TAU);
      g.stroke();
    }
  }
  h.meterShown = inp.mech?.meter === true;
  if (inp.mech?.meter) drawFrostMeter(g, h, v, inp, inp.mech);
  g.globalAlpha = 1;
}

/** The frost meter's radius and its margins from the world rect's right edge and the bottom inset (× the HUD scale, CSS px); a tap this far outside it still counts. */
const METER_R = 24;
/** v1.6: each of the Frost Bank's two pips is this big, this far apart (× the HUD scale). */
const BANK_R = 20;
const METER_SIDE = 24;
const METER_BOTTOM = 34;
const METER_SLOP = 10;
/** v1.6 timings (s): a spill's shake, a cash-in's pour, a trick's flash. */
export const SPILL_S = 0.6;
export const POUR_S = 0.8;
export const RING_FLASH_S = 0.35;
let meterGlow: Canvas2D | null = null;
const dash2 = [0, 0];
const noDash: number[] = [];

/** (x, y) in CSS px is on the frost meter drawn ready last frame (a tap there snaps): its pips' capsule. */
export function hudMeterHit(h: HudState, x: number, y: number): boolean {
  return h.meterShown && h.meterFull && Math.hypot(Math.max(0, Math.abs(x - h.meterX) - h.meterSpan), y - h.meterY) <= h.meterR + METER_SLOP;
}

/**
 * The frost meter (see the header): one round gauge, or the Frost Bank's two pips. A pip fills
 * ice-blue; full, it turns deep blue and glows. While a snap lasts the pips freeze (the first drains
 * white with the snap) and the income banked under it waits in a chip over them.
 */
function drawFrostMeter(g: CanvasRenderingContext2D, h: HudState, v: View, inp: HudInput, m: MechView): void {
  const k = hudScale(v);
  const n = m.pips > 1 ? 2 : 1;
  const r = (n > 1 ? BANK_R : METER_R) * k;
  const step = 2 * r + 6 * k;
  const xl = v.vx + v.vw - v.safe.right - METER_SIDE * k - r - (n - 1) * step;
  const y = v.vy + v.vh - v.safe.bottom - METER_BOTTOM * k - r;
  const x = (h.meterX = xl + (h.meterSpan = ((n - 1) * step) / 2));
  h.meterY = y;
  h.meterR = r;
  const snapping = m.snapLeft > 0;
  const fullN = snapping ? 0 : Math.floor(Math.min(n, m.frost) + 0.001);
  if (fullN > h.meterFullN) h.meterPop = 0.45;
  h.meterFullN = fullN;
  const full = (h.meterFull = fullN > 0);
  const rm = inp.reducedMotion;
  const a = inp.alpha;
  // A full pip breathes, and pops (1 → 1.25 → 1) when it fills; a spill shakes the last.
  const breathe = full ? (rm ? 1 : 0.5 + 0.5 * Math.sin(inp.time * 8.8)) : 0;
  for (let i = 0; i < n; i++) {
    const fill = Math.max(0, Math.min(1, m.frost - i));
    const on = i < fullN;
    const px = xl + i * step + (i === n - 1 && !rm ? Math.sin(h.spill * 70) * 3 * k * (h.spill / SPILL_S) : 0);
    const R = r * (1 + (i === fullN - 1 ? 0.25 * Math.sin((Math.PI * h.meterPop) / 0.45) : 0) + (on && !rm ? 0.04 * breathe : 0));
    if (on) {
      meterGlow ??= radialSprite('90,184,255', 96, 0.7, 0.42, 0.3);
      const gr = R * (2.1 + 0.25 * breathe);
      g.globalAlpha = a * (0.55 + 0.45 * breathe);
      g.drawImage(meterGlow, px - gr, y - gr, gr * 2, gr * 2);
      g.globalAlpha = a;
    }
    // The plate (frozen ice during a snap), the track and the fill (pip 1: the snap draining white).
    g.fillStyle = on ? '#2B7FD0' : snapping ? '#E4F3FF' : cssa(0xffffff, 0.92);
    g.beginPath();
    g.arc(px, y, R, 0, TAU);
    g.fill();
    if (snapping) {
      g.lineWidth = 1.5 * k;
      g.strokeStyle = '#9FD3F5';
      g.stroke();
    }
    g.lineWidth = 5 * k;
    g.strokeStyle = cssa(on ? 0xffffff : INK, 0.15);
    g.beginPath();
    g.arc(px, y, R - 5 * k, 0, TAU);
    g.stroke();
    const f = snapping && i === 0 ? m.snapLeft : fill;
    g.lineCap = 'round';
    g.strokeStyle = on || snapping ? '#FFFFFF' : '#5AB8FF';
    g.beginPath();
    g.arc(px, y, R - 5 * k, -Math.PI / 2, -Math.PI / 2 + TAU * f);
    if (f > 0) g.stroke();
    // The snowflake, pale until the pip is full.
    g.globalAlpha = a * (on ? 1 : 0.45 + 0.4 * fill);
    g.drawImage(flake(), px - R / 2, y - R / 2, R, R);
    g.globalAlpha = a;
  }
  const top = y - r - 12 * k;
  if (snapping && m.bankH > 0) {
    // The frost banked under the snap, paid when it ends: a chip with a snowflake ("+0.3").
    if (m.bankH !== h.lastBankH) h.chipText = snapsText(m.bankH);
    g.font = h.chipFont;
    const w = g.measureText(h.chipText).width + 24 * k;
    pill(g, x - w / 2, top - 11 * k, w, 18 * k, '#FFFFFF', true);
    g.drawImage(flake(), x - w / 2 + 4 * k, top - 8 * k, 12 * k, 12 * k);
    g.fillStyle = '#2B7FD0';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(h.chipText, x - w / 2 + 18 * k, top - 1.5 * k);
  }
  h.lastBankH = m.bankH;
  if (full) {
    // "Swipe down": a chevron bobbing down over the meter.
    const cy = top + (rm ? 0 : ((inp.time * 1.6) % 1) * 6 * k);
    const w = 8 * k;
    g.strokeStyle = '#2B7FD0';
    g.lineWidth = 3.5 * k;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(x - w, cy - w / 2);
    g.lineTo(x, cy + w / 2);
    g.lineTo(x + w, cy - w / 2);
    g.stroke();
  }
  if (h.pour > 0 && !rm) {
    // A cash-in: a stream of frost from the multiplier badge down into the meter.
    const u = 1 - h.pour / POUR_S;
    g.fillStyle = '#5AB8FF';
    g.strokeStyle = '#FFFFFF';
    g.lineWidth = 1.5;
    for (let j = 0; j < 9; j++) {
      const t = (u - j * 0.05) / 0.55;
      if (t <= 0 || t >= 1) continue;
      const q = 1 - t;
      g.beginPath();
      g.arc(q * q * h.badgeX + 2 * q * t * (h.badgeX + 30 * k) + t * t * x, q * q * h.cy + 2 * q * t * (y - 30 * k) + t * t * y, (5 - 2 * t) * k, 0, TAU);
      g.fill();
      g.stroke();
    }
  }
  g.lineCap = 'butt';
}

/** Adds the outline of the badge's charge ring (a pill) with the first `f` of it dashed on, from its top centre clockwise. */
function ringDash(g: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, f: number): void {
  const p = 2 * (w - hgt) + Math.PI * hgt;
  dash2[0] = f * p;
  dash2[1] = p;
  g.setLineDash(dash2);
  g.lineDashOffset = -(w - hgt) / 2;
  roundRect(g, x - w / 2, y - hgt / 2, w, hgt, hgt / 2);
}

/** "+0.3": frost hundredths as snaps (cash-ins, gains, the banked chip). */
export function snapsText(h: number): string {
  return `+${Math.round(h) / 100}`;
}

/** A lit star pip's pop (s) and the pips' outer radius (× the HUD scale). */
const STAR_POP_S = 0.5;
const PIP_R = 8;

/** Transparent margin around the badge sprite (CSS px), so its antialiased edge isn't cut. */
const BADGE_PAD = 2;
const BADGE_FILL = ['', '#E9E4F2', '#FFD36B', '#FFC23D', '#FFAE2B', '#FF9F1C'];
const MULT_TEXT = ['×0', '×1', '×2', '×3', '×4', '×5', '×6', '×7', '×8', '×9'];

/** The multiplier badge sprite (pill + "×N"), drawn at the current device scale. */
function renderBadge(h: HudState, v: View, m: number): void {
  const dpr = v.dpr;
  const c = sized(h.badge, (h.badgeW + BADGE_PAD * 2) * dpr, (h.badgeH + BADGE_PAD * 2) * dpr);
  h.badge = c;
  h.badgeKey = m;
  const g = ctx2d(c);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const gold = m >= 2;
  // Warmer with every level: pale gold at ×2 to deep orange at ×5.
  pill(g, BADGE_PAD, BADGE_PAD, h.badgeW, h.badgeH, BADGE_FILL[Math.max(1, Math.min(5, m))] as string, false);
  g.fillStyle = gold ? '#2B2140' : '#5B5070';
  g.font = h.multFont;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(m >= 0 && m <= 9 ? (MULT_TEXT[m] as string) : `×${m}`, BADGE_PAD + h.badgeW / 2, BADGE_PAD + h.badgeH / 2 + 1);
}

/** Rebuilds the row layer and the layout of the moving parts. */
function buildLayer(h: HudState, v: View, inp: HudInput, passed: number, night: number): void {
  const s = inp.s;
  const c = inp.campaign;
  const dpr = v.dpr;
  const k = hudScale(v);
  const top = v.safe.top + 8;
  const cy = top + ROW_H / 2;
  h.cy = cy;
  h.builtForecast = s.params.forecast;

  // The layer covers the viewport's width and the HUD band, aligned to device pixels.
  const lx = Math.floor(v.vx * dpr) / dpr;
  const ly = Math.floor((top - BAND_PAD) * dpr) / dpr;
  const lw = Math.ceil((v.vx + v.vw - lx) * dpr) / dpr;
  const lh = Math.ceil((ROW_H + 2 * BAND_PAD) * dpr) / dpr;
  const layer = sized(h.layer, lw * dpr, lh * dpr);
  h.layer = layer;
  h.layerX = lx;
  h.layerY = ly;
  h.layerW = layer.width / dpr;
  h.layerH = layer.height / dpr;
  if (!h.layerG || h.layerG.canvas !== layer) h.layerG = ctx2d(layer);
  const g = h.layerG;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.clearRect(0, 0, layer.width, layer.height);
  g.setTransform(dpr, 0, 0, dpr, -lx * dpr, -ly * dpr);
  g.textBaseline = 'middle';

  if (h.fontK !== k) {
    h.fontK = k;
    h.snowFont = `800 ${Math.round(18 * k)}px ${FONT}`;
    h.multFont = `800 ${Math.round(14 * k)}px ${FONT}`;
    h.dayFont = `800 ${Math.round(13 * k)}px ${FONT}`;
    h.clockFont = `800 ${Math.round(19 * k)}px ${FONT}`;
    h.chipFont = `800 ${Math.round(13 * k)}px ${FONT}`;
    h.badgeKey = -1;
  }

  // --- Layout: the ruler never drops ---------------------------------------------------------
  // The ruler carries the day's progress, the noon boss, the recent-best flag and the next goal, so
  // it keeps at least RULER_MIN px: the forecast glyph rides on the D-badge (no width of its own),
  // the clock reserves the widest clock of a day, and when the row is still tight the clock font
  // shrinks a little (to 90 %), then the Snow pill drops its flake icon and the clock may shrink to 70 %.
  let snowText = h.snowText;
  let snowW = tabularWidth(g, h, h.snowFont, snowText);
  // The badge is sized for one digit ("×5"), as the multiplier never exceeds 5.
  const multW = tabularWidth(g, h, h.multFont, '×5');
  const iconS = 18 * k;
  const badgeW = multW + 14 * k;
  const badgeH = 24 * k;
  if (badgeW !== h.badgeW || badgeH !== h.badgeH) h.badgeKey = -1;
  const rx1 = v.vx + v.vw - v.safe.right - 8;
  const lx0 = v.vx + v.safe.left + 8 + 48 + 8;
  // A forecast sticker sits on the badge's right cap: the badge grows so it clears the digits.
  const dW = tabularWidth(g, h, h.dayFont, h.dayText) + 12 * k + (h.builtForecast !== 'clear' ? 5 * k : 0);
  const rightOf = (icon: boolean): number => 10 * k + (icon ? iconS + 6 * k : 0) + snowW + 8 * k + badgeW + 6 * k;
  const rulerOf = (rightW: number, clockW: number): number => rx1 - rightW - 8 - 12 * k - (lx0 + 8 * k + dW + 7 * k + clockW + 10 * k);
  let icon = true;
  let clockFont = h.clockFont;
  // A level shows its three star pips where an endless run shows the clock (the score).
  let pipStep = PIP_STEP;
  let clockW = c ? 3 * pipStep * k : widestClock(g, h, clockFont);
  const fit = (fMin: number): void => {
    for (let f = 0.95; !c && f >= fMin - 0.001 && rulerOf(rightOf(icon), clockW) < RULER_MIN; f -= 0.05) {
      clockFont = `800 ${Math.round(19 * k * f)}px ${FONT}`;
      clockW = widestClock(g, h, clockFont);
    }
  };
  fit(0.9);
  if (rulerOf(rightOf(true), clockW) < RULER_MIN) {
    icon = false;
    clockFont = h.clockFont;
    if (!c) clockW = widestClock(g, h, clockFont);
    fit(0.7);
  }
  // A level keeps its progress bar too: a seconds goal drops its tenths, then the star pips close up.
  if (c && rulerOf(rightOf(icon), clockW) < RULER_MIN && h.snowShort !== snowText) {
    snowText = h.snowShort;
    snowW = tabularWidth(g, h, h.snowFont, snowText);
  }
  if (c && rulerOf(rightOf(icon), clockW) < RULER_MIN) {
    pipStep = PIP_STEP_TIGHT;
    clockW = 3 * pipStep * k;
  }

  // --- Right: Snow + multiplier ---------------------------------------------------------------
  const rightW = rightOf(icon);
  const rx0 = rx1 - rightW;
  const panelH = 40 * k > ROW_H ? ROW_H : 40 * k;
  pill(g, rx0, cy - panelH / 2, rightW, panelH, cssa(0xffffff, 0.9), true);
  let x = rx0 + 10 * k;
  h.iconX = x;
  h.iconS = icon ? iconS : 0;
  if (icon) x += iconS + 6 * k;
  // A met goal turns its count teal ("4/4").
  g.fillStyle = c && h.snowTarget >= 0 && c.goalValue >= h.snowTarget ? '#13857C' : '#2B5A8A';
  drawTabular(g, h, h.snowFont, snowText, x, cy + 1);
  x += snowW + 8 * k;
  h.badgeX = x + badgeW / 2;
  h.badgeW = badgeW;
  h.badgeH = badgeH;

  // --- Left: D-badge (with the forecast sticker), clock, ruler ----------------------------------
  const lx1 = rx0 - 8;
  h.leftShown = lx1 - lx0 >= 120;
  h.rulerShown = false;
  h.rulerX0 = h.rulerX1 = 0;
  if (!h.leftShown) return;
  pill(g, lx0, cy - panelH / 2, lx1 - lx0, panelH, cssa(0xffffff, 0.9), true);
  const dH = 22 * k;
  let cx = lx0 + 8 * k;
  pill(g, cx, cy - dH / 2, dW, dH, c ? '#13857C' : '#2B2140', false);
  g.fillStyle = '#FFF8EE';
  drawTabular(g, h, h.dayFont, h.dayText, cx + 6 * k, cy + 1);
  if (h.builtForecast !== 'clear') {
    // A round sticker on the badge's top-right corner: "Day 3, breezy".
    const sr = 8 * k;
    const sx = cx + dW - 2 * k;
    const sy = cy - dH / 2 + 1 * k;
    g.fillStyle = cssa(INK, 0.18);
    g.beginPath();
    g.arc(sx, sy + 1, sr, 0, TAU);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(sx, sy, sr, 0, TAU);
    g.fill();
    drawGlyph(g, h.builtForecast, sx, sy, 12 * k);
  }
  cx += dW + 7 * k;
  if (c) {
    // Gold: earned; white: still to play for; grey: the cool run lost.
    h.pipStep = pipStep * k;
    h.pipX = cx + h.pipStep / 2;
    for (let i = 0; i < 3; i++) {
      const on = i === 0 ? c.stars & 1 : i === 1 ? c.stars & 2 : 0;
      const lost = i === 2 && (c.stars & 4) !== 0;
      star(g, h.pipX + i * h.pipStep, cy + 1, PIP_R * k, on ? '#FFC23D' : lost ? '#D9D3E2' : '#FFFFFF', on ? '#B87A0A' : lost ? '#B5ABC4' : '#8A7FA0');
    }
  } else {
    g.fillStyle = '#2B2140';
    drawTabular(g, h, clockFont, h.clock, cx, cy + 1);
  }
  // Reserve the width of the widest clock so the ruler doesn't jump.
  cx += clockW + 10 * k;
  const r0 = cx;
  const r1 = lx1 - 12 * k;
  if (r1 - r0 <= 24) return;
  h.rulerShown = true;
  if (c) drawProgressStatic(g, h, c, r0, r1, cy, k, dpr, s, inp.mech);
  else drawRulerStatic(g, h, s, r0, r1, cy, k, inp, passed === 1, night === 1, dpr);
}

/**
 * The campaign progress bar's still parts (teal track, the checkered finish, the gate or eclipse
 * marker at the midpoint) into the layer, plus the bar and head sprites.
 */
function drawProgressStatic(g: CanvasRenderingContext2D, h: HudState, c: HudCampaign, x0: number, x1: number, cy: number, k: number, dpr: number, s: SimState, m: MechView | null): void {
  const hgt = 7 * k;
  const y = cy - hgt / 2 + 1;
  h.rulerX0 = x0;
  h.rulerX1 = x1;
  h.rulerY = y;
  h.rulerH = hgt;
  const grad = (gg: CanvasRenderingContext2D): CanvasGradient => {
    const gr = gg.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, '#7FE3D9');
    gr.addColorStop(0.5, '#2EC4B6');
    gr.addColorStop(1, '#13857C');
    return gr;
  };
  g.fillStyle = cssa(INK, 0.1);
  roundRect(g, x0 - 1, y - 1, x1 - x0 + 2, hgt + 2, (hgt + 2) / 2);
  g.fill();
  g.globalAlpha = 0.35;
  g.fillStyle = grad(g);
  roundRect(g, x0, y, x1 - x0, hgt, hgt / 2);
  g.fill();
  g.globalAlpha = 1;

  const bx = Math.floor((x0 - 1) * dpr) / dpr;
  const byy = Math.floor((y - 2) * dpr) / dpr;
  const bar = sized(h.bar, (x1 - bx + 1) * dpr, (hgt + 4) * dpr + 1);
  h.bar = bar;
  h.barX = bx;
  h.barY = byy;
  const bg = ctx2d(bar);
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.clearRect(0, 0, bar.width, bar.height);
  bg.setTransform(dpr, 0, 0, dpr, -bx * dpr, -byy * dpr);
  bg.fillStyle = grad(bg);
  roundRect(bg, x0, y, x1 - x0, hgt, hgt / 2);
  bg.fill();

  const hr = 5 * k;
  const hs = Math.ceil((hr * 2 + 4) * dpr);
  const head = sized(h.head, hs, hs);
  h.head = head;
  const hg = ctx2d(head);
  hg.setTransform(1, 0, 0, 1, 0, 0);
  hg.clearRect(0, 0, hs, hs);
  hg.setTransform(dpr, 0, 0, dpr, 0, 0);
  hg.fillStyle = '#FFFFFF';
  hg.strokeStyle = '#13857C';
  hg.lineWidth = 2;
  hg.beginPath();
  hg.arc(hs / dpr / 2, hs / dpr / 2, hr, 0, TAU);
  hg.fill();
  hg.stroke();

  // No noon boss on a level (the clock still says when it is).
  h.noonX = (x0 + x1) / 2;
  h.noonY = y - 6 * k;
  h.noonR = 0;

  // Markers on the bar: the gate arch, the eclipse disc.
  const mark = (p: number, id: string): void => {
    if (p < 0) return;
    const mx = x0 + (x1 - x0) * p;
    const my = y - 8 * k;
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(mx, my, 7 * k, 0, TAU);
    g.fill();
    g.strokeStyle = cssa(INK, 0.25);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(mx, my + 7 * k);
    g.lineTo(mx, y + hgt);
    g.stroke();
    drawGlyph(g, id, mx, my, 10 * k);
  };
  mark(c.markGate, 'gate');
  mark(c.markEclipse, 'eclipse');
  // v1.6: the level's kept flares where Nubs will meet them (a boss finale's HP notches).
  flareMarks(g, s, m, true, x0, x1, y, k);

  // The finish: a small checkered flag on a pole at the bar's end.
  const fx = x1;
  const fy = y - 1;
  g.strokeStyle = '#2B2140';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(fx, y + hgt + 1);
  g.lineTo(fx, fy - 11 * k);
  g.stroke();
  const sq = 2.6 * k;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      g.fillStyle = (row + col) % 2 === 0 ? '#2B2140' : '#FFFFFF';
      g.fillRect(fx + 1 + col * sq, fy - 11 * k + row * sq, sq, sq);
    }
  }
  g.strokeStyle = cssa(INK, 0.5);
  g.lineWidth = 0.8;
  g.strokeRect(fx + 1, fy - 11 * k, 3 * sq, 3 * sq);
}

/**
 * The kept Heat Flares over the bar from x0 to x1 (top at y), at their rise: on a level's progress
 * (`level`), else on today's ruler. Each is white-hot in an orange ring while it waits (the noon
 * boss is solid orange), teal once parried, grey once missed.
 */
function flareMarks(g: CanvasRenderingContext2D, s: SimState, m: MechView | null, level: boolean, x0: number, x1: number, y: number, k: number): void {
  const w = s.world;
  const dl = dayTicks(s.day);
  let left = 0;
  for (let i = 0; m && i < w.flares.length; i++) {
    const f = w.flares[i] as Flare;
    const p = level ? (worldYAtTick(w, f.riseTick) - w.startY) / (w.finishY - w.startY) : (f.riseTick - dayStartTick(s.day)) / dl;
    if (f.state !== FLARE_KEPT || p < 0 || p > 1) continue;
    const x = x0 + (x1 - x0) * p;
    const out = m.flareOut.get(f.id) ?? 0;
    if (level) {
      // A level's bar can be short (48 px) with up to 8 flares: a 2 px tick each, coloured by outcome.
      if (out === 0) left++;
      g.fillStyle = out === 0 ? '#FF6A3D' : out === 1 ? '#13857C' : '#B5ABC4';
      g.fillRect(x - k, y - 7 * k, 2 * k, 7 * k);
      continue;
    }
    g.strokeStyle = cssa(INK, 0.3);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y - 6 * k);
    g.lineTo(x, y);
    g.stroke();
    g.fillStyle = out === 0 ? '#FFF4D6' : out === 1 ? '#2EC4B6' : '#B5ABC4';
    g.strokeStyle = out === 0 ? '#FF6A3D' : '#FFFFFF';
    g.lineWidth = 2 * k;
    g.beginPath();
    g.arc(x, y - 6 * k, 3.6 * k, 0, TAU);
    g.fill();
    g.stroke();
  }
  if (level && left > 0) {
    // The flares still to come (a boss finale's HP): a hot disc with the count at the bar's start.
    const hx = x0 + 2 * k;
    const hy = y - 8 * k;
    g.fillStyle = '#FF6A3D';
    g.strokeStyle = '#FFFFFF';
    g.lineWidth = 1.5 * k;
    g.beginPath();
    g.arc(hx, hy, 6.5 * k, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = '#FFFFFF';
    g.font = `800 ${Math.round(10 * k)}px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(String(left), hx, hy + 0.5 * k);
    g.textAlign = 'left';
  }
}

/** Spacing of the campaign star pips (× the HUD scale), and in a tight row. */
const PIP_STEP = 19;
const PIP_STEP_TIGHT = 15;

/** The ruler keeps at least this width (CSS px) whenever the left panel shows. */
const RULER_MIN = 48;

/** The widest clock a day can show ('10:00 AM' or '12:00 PM', with tabular digits). */
function widestClock(g: CanvasRenderingContext2D, h: HudState, font: string): number {
  return Math.max(tabularWidth(g, h, font, '10:00 AM'), tabularWidth(g, h, font, '12:00 PM'));
}

/** The ruler's still parts into the layer, plus the bar and head sprites for the moving parts. */
function drawRulerStatic(
  g: CanvasRenderingContext2D,
  h: HudState,
  s: SimState,
  x0: number,
  x1: number,
  cy: number,
  k: number,
  inp: HudInput,
  passed: boolean,
  night: boolean,
  dpr: number,
): void {
  const hgt = 7 * k;
  const y = cy - hgt / 2 + 1;
  h.rulerX0 = x0;
  h.rulerX1 = x1;
  h.rulerY = y;
  h.rulerH = hgt;
  const grad = (gg: CanvasRenderingContext2D, ox: number): CanvasGradient => {
    const gr = gg.createLinearGradient(x0 - ox, 0, x1 - ox, 0);
    gr.addColorStop(0, '#FF9E6B');
    gr.addColorStop(0.22, '#FFD27A');
    gr.addColorStop(0.5, '#FFF2B0');
    gr.addColorStop(0.78, '#FFC23D');
    gr.addColorStop(1, '#E3829E');
    return gr;
  };
  // Track (faded) and the whole gradient at 45 %; the elapsed part is blitted on top per frame.
  g.fillStyle = cssa(INK, 0.1);
  roundRect(g, x0 - 1, y - 1, x1 - x0 + 2, hgt + 2, (hgt + 2) / 2);
  g.fill();
  g.globalAlpha = 0.45;
  g.fillStyle = grad(g, 0);
  roundRect(g, x0, y, x1 - x0, hgt, hgt / 2);
  g.fill();
  g.globalAlpha = 1;

  // Full-alpha bar sprite (device px), drawn from x0 − 1 so the clip matches the old one.
  const bx = Math.floor((x0 - 1) * dpr) / dpr;
  const byy = Math.floor((y - 2) * dpr) / dpr;
  const bar = sized(h.bar, (x1 - bx + 1) * dpr, (hgt + 4) * dpr + 1);
  h.bar = bar;
  h.barX = bx;
  h.barY = byy;
  const bg = ctx2d(bar);
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.clearRect(0, 0, bar.width, bar.height);
  bg.setTransform(dpr, 0, 0, dpr, -bx * dpr, -byy * dpr);
  bg.fillStyle = grad(bg, 0);
  roundRect(bg, x0, y, x1 - x0, hgt, hgt / 2);
  bg.fill();
  const m = inp.mech;
  if (m && m.noonHeat > 1) {
    // v1.6 Noon Heat: 11 AM-1 PM bites harder (a hot band on the track and the elapsed bar).
    const hx = x0 + ((x1 - x0) * 5) / 12;
    const hw = (x1 - x0) / 6;
    g.fillStyle = bg.fillStyle = cssa(0xff3d2b, 0.6);
    g.fillRect(hx, y, hw, hgt);
    bg.fillRect(hx, y, hw, hgt);
  }

  // Progress head sprite (a white dot with an ink ring).
  const hr = 5 * k;
  const hs = Math.ceil((hr * 2 + 4) * dpr);
  const head = sized(h.head, hs, hs);
  h.head = head;
  const hg = ctx2d(head);
  hg.setTransform(1, 0, 0, 1, 0, 0);
  hg.clearRect(0, 0, hs, hs);
  hg.setTransform(dpr, 0, 0, dpr, 0, 0);
  hg.fillStyle = '#FFFFFF';
  hg.strokeStyle = '#2B2140';
  hg.lineWidth = 2;
  hg.beginPath();
  hg.arc(hs / dpr / 2, hs / dpr / 2, hr, 0, TAU);
  hg.fill();
  hg.stroke();

  // Noon boss icon.
  const nx = (x0 + x1) / 2;
  const nr = 5.5 * k;
  const ny = y - nr - 1;
  h.noonX = nx;
  h.noonY = ny;
  h.noonR = nr;
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
  // v1.6: today's kept Heat Flares at their rise, as soon as they are decided.
  flareMarks(g, s, m, false, x0, x1, y, k);
  // The next milestone: a small white tick across the ruler.
  const gm = inp.goalMinutes - dayStart;
  if (inp.goalMinutes >= 0 && gm >= 0 && gm <= 720) {
    const gx = x0 + ((x1 - x0) * gm) / 720;
    g.fillStyle = '#2B2140';
    g.fillRect(gx - 2, y - 3, 4, hgt + 6);
    g.fillStyle = '#FFFFFF';
    g.fillRect(gx - 1, y - 2, 2, hgt + 4);
  }

  // At night the head is a moon at the end of the (full) ruler: part of the layer.
  if (night) {
    g.fillStyle = '#E8ECFF';
    g.beginPath();
    g.arc(x1, cy + 1, 5.5 * k, 0, TAU);
    g.fill();
    g.fillStyle = '#34306B';
    g.beginPath();
    g.arc(x1 + 2.2 * k, cy - 0.5, 4.6 * k, 0, TAU);
    g.fill();
  }
}
