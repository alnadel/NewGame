// Canvas HUD (V1_PLAN §9, GDD §5; the "Candy" look of docs/UI_V2.md §9.3-9.4): one row under the
// safe inset, to the right of the DOM pause button.
//
//   [pause] (L6)[★★★ ═══●══════ ⚑]  (◎ 0/1 )(×3)
//
// Left: a gold medal with the level ("L6") or the day ("D2", with the day's forecast as a sticker
// unless it is clear) whose cream plate holds the three star pips (a level) or the clock in 10-minute
// steps (Endless), then the ruler: an embossed slot that fills with the level's progress (green,
// start → a checkered finish flag, the gate or eclipse marker at its midpoint) or the day (dawn →
// noon → dusk, the noon "boss", a gold PB flag and a teal challenge flag). Right: a dark slot counting
// the goal ("flakes/target", "snow/target", a Dare's count) or plain Snow behind a coin (the goal's
// glyph on a white coin, or the Snow gem), tucked under the multiplier coin (×1 cloud, ×2-×4 violet,
// ×5 gold with a glow; pops on ×up, shakes on reset).
//
// Cost: the row is rendered into an offscreen layer and rebuilt only when what it shows changes
// (Snow, the clock's 10-minute step, the day and its forecast, noon passed, night, the flags, the
// layout, the display font arriving) — about once every 0.7 s of play. Each frame then blits that
// layer and draws the few moving parts on top: the goal coin and the multiplier coin (cached
// sprites, popped and shaken by transform), the elapsed part of the ruler (one rounded fill with a
// gradient cached at the rebuild) and its slim progress head, the Flow Ring's arc and the frost
// meter's arc. No shadowBlur, no per-frame gradients or allocations.
//
// Campaign variant (v1.2, CAMPAIGN_PLAN §4; v1.4): the star pips show what the run has earned so far
// (the goal, the flakes star, the cool run, which turns to a slashed grey star when lost; a pip pops
// when it lights, and a ring drains round the third as Nubs spends the cool run's sun budget), and a
// wind glyph rides the progress head during a gust.
//
// v1.5 frost meter (Cold Snap): an ice coin in the world rect's bottom-right corner, clear of the
// edge and home-bar zones, shown on runs that fill it. Its ring fills ice-blue around a snowflake;
// full, it glows and breathes; while a snap lasts the ring drains white. (Controls v3, docs/
// CONTROLS_V3.md §11.1: the coin is the action button's placeholder at its centre; its swipe-down
// chevron is gone with the swipe.)
//
// Elementals v2 (docs/ELEMENTALS_V2.md §7.10): on a Trial the Cold Snap's coin shows only on Nubs'
// legs (in the 3 s before a TAG it dims under a "TAG" chip: no snap then); another element's leg
// shows a non-interactive meter pill in its place (its glyph and number on its face colour, one
// cached sprite; it never sets meterShown). A wind chip under the
// row's right end shows an arrow per 15 u/s of the wind the way it blows, the breeze's share dimmed,
// while Gust walks or a wind blows.
//
// v1.6 (docs/V1_6_PLAN.md): the Flow Ring's charge runs round the multiplier coin (teal, gold as
// ×5's buffer, hot while it bleeds; a trick flashes it). The Frost Bank's two charges are two small
// coins hung under the meter that light in turn (the ring shows the next one filling; a spill shakes
// the second); during a snap they freeze and a chip shows the income banked under it; a cash-in pours
// a stream of frost from the multiplier into the meter. The ruler marks the day's kept Heat Flares
// (teal once parried, grey once missed) and Noon Heat's 11-1 band; a level's ruler marks its flares
// (a boss finale's HP on a hot coin at its start).

import type { MechView } from './renderer.ts';
import {
  dayStartTick,
  dayTicks,
  FLARE_KEPT,
  FORECAST_IDS,
  HEROES,
  hudClock,
  levelShort,
  minutesOfDay,
  tagLocked,
  worldYAtTick,
  type Flare,
  type ForecastId,
  type DriveView,
  type HeroId,
  type SimState,
  windAt,
} from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { chip as pill, coin, displayFont, FACE, fontGen, INK, onDisplayFont, outlined, plate, slot, SLOT_2, SLOT_SUB, starSprite, type Face } from './candy.ts';
import { cssa } from './color.ts';
import { drawGlyph } from './glyphs.ts';
import { ctx2d, flake, makeCanvas, radialSprite, roundRect, type Canvas2D } from './sprites.ts';

const TAU = Math.PI * 2;
const ROW_H = 48;
/** Inputs of the row layer's key (syncHud). */
const KEYS = 24;
/** The cached band reaches this far above and below the row (the drops, flags, the noon icon). */
const BAND_PAD = 8;
/** The row stops growing at this scale, so it stays matched to the 48 px DOM pause button. */
const ROW_K_MAX = 1.1;

/** Char widths for one font, indexed by char code (all HUD glyphs are < 256). */
type WidthTable = Float32Array;

export interface HudState {
  multPop: number;
  /** A star pip lighting up: seconds left of its pop, and which pip (0..2). */
  starPop: number;
  starPopI: number;
  /** The campaign star bits the layer shows (−1 none). */
  starBits: number;
  /** The pips' centres (CSS px): the first one's x and the step, and their size. */
  pipX: number;
  pipStep: number;
  pipS: number;
  multShake: number;
  snowPop: number;
  noonSparkle: number;
  /** Bottom of the HUD band (CSS px), for the sun glyph and banners. */
  bottom: number;
  /** Bottom of the wind chip under the band (CSS px; 0 none): toasts hang below it. */
  windBottom: number;

  // Cached text and the inputs the row layer was built from (−1/NaN = never).
  clockKey: number;
  clock: string;
  snowVal: number;
  /** The goal pill's target (−1: plain Snow). */
  snowTarget: number;
  snowText: string;
  /** snowText in whole seconds for a seconds goal (the tight-row fallback; else snowText). */
  snowShort: string;
  /** snowText and snowShort split at the slash: the count (big) and "/target" (small). */
  snowMain: string;
  snowSub: string;
  shortMain: string;
  shortSub: string;
  dayVal: number;
  dayText: string;
  /** The row layer's inputs (snow, goal, level and its markers, day, forecast, clock, flags, view, font, contrast) when built, and now. */
  readonly key: Float64Array;
  readonly nextKey: Float64Array;
  builtForecast: ForecastId | '';
  /** The display font's generation the width tables were measured with (candy.ts fontGen). */
  fontGen: number;

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
  subFont: string;
  multFont: string;
  dayFont: string;
  clockFont: string;
  /** v1.6: the banked chip. */
  chipFont: string;
  /** The row's scale (hudScale, capped at ROW_K_MAX) it was built at. */
  k: number;
  cy: number;
  /** The goal coin: its centre x and diameter (0: dropped from a tight Endless row). */
  iconX: number;
  iconS: number;
  /** The multiplier coin's centre x and radius; badgeW/H are its diameter. */
  badgeX: number;
  badgeW: number;
  badgeH: number;
  /** Left panel (medal, pips or clock, ruler) shown; ruler shown and its geometry. */
  leftShown: boolean;
  rulerShown: boolean;
  rulerX0: number;
  rulerX1: number;
  rulerY: number;
  rulerH: number;
  noonX: number;
  noonY: number;
  noonR: number;
  /** v1.6 Noon Heat's band on the ruler (x and width, 0 none). */
  heatX: number;
  heatW: number;

  /** The elapsed fill's gradient (made on the main canvas at the first frame after a rebuild). */
  fill: CanvasGradient | null;
  /** The coins' sprites, and what they were drawn for. */
  badge: Canvas2D | null;
  badgeKey: number;
  goal: Canvas2D | null;
  /** The goal coin's size, dpr and contrast it was drawn for (−1: redraw), and its glyph. */
  goalKey: number;
  goalFor: string | null;
  /** The row scale and dpr the coin sprites were drawn at. */
  spriteK: number;
  spriteDpr: number;

  widths: Map<string, WidthTable>;

  /** Controls v3 (docs/CONTROLS_V3.md §1.1): the action button's centre and hit radius (CSS px) as last laid out, and whether it takes presses. */
  btnX: number;
  btnY: number;
  btnR: number;
  btnShown: boolean;
  /** v1.5 frost meter: shown last frame, its centre and radius (CSS px), the ready pop (s) and whether it was full. */
  meterShown: boolean;
  meterX: number;
  meterY: number;
  meterR: number;
  meterPop: number;
  meterFull: boolean;
  /** v1.6: full charges last frame, a spill (s left), the banked chips' values, text and widths; a cash-in's pour and a trick's flash (s left). */
  meterFullN: number;
  spill: number;
  lastBankH: number;
  chipText: string;
  chipW: number;
  lastGlassH: number;
  glassText: string;
  glassW: number;
  pour: number;
  ringFlash: number;
  /** The meter's coin sprite (idle, ready, frozen) and what it was drawn for. */
  meterBase: Canvas2D | null;
  meterKey: number;
}

export function createHud(): HudState {
  // The display face may still be loading: its arrival bumps fontGen, which rebuilds the row.
  onDisplayFont(noop);
  return {
    multPop: 0,
    starPop: 0,
    starPopI: 0,
    starBits: -1,
    pipX: 0,
    pipStep: 0,
    pipS: 0,
    multShake: 0,
    snowPop: 0,
    noonSparkle: 0,
    bottom: 64,
    windBottom: 0,
    clockKey: -1,
    clock: '',
    snowVal: -1,
    snowTarget: -1,
    snowText: '0',
    snowShort: '0',
    snowMain: '0',
    snowSub: '',
    shortMain: '0',
    shortSub: '',
    dayVal: NaN,
    dayText: 'D1',
    key: new Float64Array(KEYS).fill(NaN),
    nextKey: new Float64Array(KEYS),
    builtForecast: '',
    fontGen: -1,
    layer: null,
    layerG: null,
    layerX: 0,
    layerY: 0,
    layerW: 0,
    layerH: 0,
    fontK: -1,
    snowFont: '',
    subFont: '',
    multFont: '',
    dayFont: '',
    clockFont: '',
    chipFont: '',
    k: 1,
    cy: 0,
    iconX: 0,
    iconS: 32,
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
    heatX: 0,
    heatW: 0,
    fill: null,
    badge: null,
    badgeKey: -1,
    goal: null,
    goalKey: -1,
    goalFor: null,
    spriteK: -1,
    spriteDpr: -1,
    widths: new Map(),
    btnX: 0,
    btnY: 0,
    btnR: 0,
    btnShown: false,
    meterShown: false,
    meterX: 0,
    meterY: 0,
    meterR: 0,
    meterPop: 0,
    meterFull: false,
    meterFullN: 0,
    spill: 0,
    lastBankH: 0,
    chipText: '',
    chipW: 0,
    lastGlassH: 0,
    glassText: '',
    glassW: 0,
    pour: 0,
    ringFlash: 0,
    meterBase: null,
    meterKey: -1,
  };
}

function noop(): void {}

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

/** Controls v3 action button (§1.1, × hudScale): centre this far from the world rect's handed side and above the bottom inset; hit radius. */
const BTN_SIDE = 70;
const BTN_BOTTOM = 88;
const BTN_HIT = 52;

/** Lays the action button out for this frame: it takes presses while the run is in its day and the driver shows an act (or the incoming one). */
function layoutButton(h: HudState, v: View, inp: HudInput): void {
  const k = hudScale(v);
  const d = inp.drive;
  h.btnX = inp.hand === 'left' ? v.vx + v.safe.left + BTN_SIDE * k : v.vx + v.vw - v.safe.right - BTN_SIDE * k;
  h.btnY = v.vy + v.vh - v.safe.bottom - BTN_BOTTOM * k;
  h.btnR = BTN_HIT * k;
  h.btnShown = d !== null && inp.s.phase === 'day' && (d.act !== 'none' || d.incoming !== 'none');
}

/** True inside the button's hit disc (§1.1) while it is shown. */
export function hudButtonHit(h: HudState, x: number, y: number): boolean {
  return h.btnShown && (x - h.btnX) * (x - h.btnX) + (y - h.btnY) * (y - h.btnY) <= h.btnR * h.btnR;
}

/** The button's centre and hit radius (CSS px) as last laid out, and whether it is shown. */
export function hudButton(h: HudState): { x: number; y: number; r: number; shown: boolean } {
  return { x: h.btnX, y: h.btnY, r: h.btnR, shown: h.btnShown };
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

/**
 * Draws `s` with tabular digits from x (only when the row layer is rebuilt). With `halo` > 0 it is
 * outlined display text (§4.2): every char's ink drop, then every char's halo, then every fill, so
 * no halo eats into its neighbour's fill. Returns the width.
 */
function drawTabular(g: CanvasRenderingContext2D, h: HudState, font: string, s: string, x: number, y: number, fill: string, halo = 0, px = 0): number {
  const t = widthTable(g, h, font);
  const zero = charW(g, t, '0');
  g.textAlign = 'left';
  g.lineJoin = 'round';
  g.miterLimit = 2;
  const passes = halo > 0 ? 3 : 1;
  let cx = x;
  for (let p = 0; p < passes; p++) {
    const last = p === passes - 1;
    const dy = p === 0 && passes === 3 ? Math.max(1, px * 0.1) : 0;
    g.fillStyle = last ? fill : INK;
    g.strokeStyle = INK;
    g.lineWidth = halo;
    cx = x;
    for (let i = 0; i < s.length; i++) {
      const c = s.charAt(i);
      const w = charW(g, t, c);
      const adv = c >= '0' && c <= '9' ? zero : w;
      const ox = cx + (adv - w) / 2;
      if (!last) g.strokeText(c, ox, y + dy);
      if (last || p === 0) g.fillText(c, ox, y + dy);
      cx += adv;
    }
  }
  return cx - x;
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

/** A cleared context for sprite `c`, scaled to CSS px at `dpr`. */
function fresh(c: Canvas2D, dpr: number): CanvasRenderingContext2D {
  const g = ctx2d(c);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.clearRect(0, 0, c.width, c.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
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
  /** High contrast (§8.5): flat faces, 4 px plate outlines, no glows. */
  hc: boolean;
  /** Controls v3: the driver's view (the button's act) and the button's side. */
  drive: Readonly<DriveView> | null;
  hand: 'right' | 'left';
}

/** Splits "4/6" into "4" and "/6" (the count and its target), into out[0..1]. */
function splitCount(s: string, out: [string, string]): void {
  const i = s.indexOf('/');
  out[0] = i < 0 ? s : s.slice(0, i);
  out[1] = i < 0 ? '' : s.slice(i);
}
const parts: [string, string] = ['', ''];

/**
 * Brings the cached row layer and the multiplier coin up to date for `inp` (text, flags, layout)
 * without drawing anything. drawHud calls it every frame; the Title calls it on idle frames, so
 * the first play frame finds the layer, its width tables and the ruler already built.
 */
export function syncHud(h: HudState, v: View, inp: HudInput): void {
  const s = inp.s;
  const c = inp.campaign;
  if (h.fontGen !== fontGen) {
    // Lilita One arrived (or this is the first build): every width and text sprite is remeasured.
    h.fontGen = fontGen;
    h.widths.clear();
    h.fontK = -1;
    h.badgeKey = -1;
    h.goalKey = -1;
  }

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
    splitCount(h.snowText, parts);
    h.snowMain = parts[0];
    h.snowSub = parts[1];
    splitCount(h.snowShort, parts);
    h.shortMain = parts[0];
    h.shortSub = parts[1];
  }
  const dayKey = c ? -c.id : s.day;
  if (dayKey !== h.dayVal) {
    h.dayVal = dayKey;
    h.dayText = c ? levelShort(c.id) : `D${s.day}`;
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
  n[21] = fontGen;
  n[22] = inp.hc ? 1 : 0;
  n[23] = inp.mech?.ring ? 1 : 0;
  let same = h.layer !== null;
  for (let i = 0; i < KEYS && same; i++) same = n[i] === h.key[i];
  if (!same) {
    h.key.set(n);
    buildLayer(h, v, inp, passed, night);
  }
  const mult = inp.mech ? inp.mech.mult : s.nubs.mult;
  const bk = mult * 4 + (inp.mech?.ring ? 2 : 0) + (inp.hc ? 1 : 0);
  if (s.trial === null && h.badgeKey !== bk) renderBadge(h, v, mult, inp.mech?.ring === true, inp.hc, bk);
  const glyph = c?.goalGlyph ?? null;
  const gk = h.iconS + (inp.hc ? 1e6 : 0);
  if (h.iconS > 0 && (h.goal === null || h.goalFor !== glyph || h.goalKey !== gk)) renderGoal(h, v, glyph, inp.hc, gk);
}

/** Draws the HUD row. Updates h.bottom (bottom edge of the band in CSS px). */
export function drawHud(g: CanvasRenderingContext2D, h: HudState, v: View, inp: HudInput): void {
  const top = v.safe.top + 8;
  h.bottom = top + ROW_H + 8;
  if (inp.alpha <= 0.01) {
    h.meterShown = h.btnShown = false;
    return;
  }
  const s = inp.s;
  syncHud(h, v, inp);
  layoutButton(h, v, inp);
  const dl = dayTicks(s.day);
  const night = s.dayTick >= dl ? 1 : 0;
  const k = h.k;
  const rm = inp.reducedMotion;
  const hc = inp.hc;

  g.globalAlpha = inp.alpha;
  const layer = h.layer as Canvas2D;
  g.drawImage(layer, h.layerX, h.layerY, h.layerW, h.layerH);
  const cy = h.cy;

  // The goal coin (pops on +Snow; a Dare's or verb goal's glyph); a tight Endless row drops it (buildLayer).
  if (h.iconS > 0 && h.goal) {
    const pop = h.snowPop > 0 && !rm ? 1 + 0.18 * Math.sin((Math.PI * h.snowPop) / 0.18) : 1;
    const gs = (h.goal.width / v.dpr) * pop;
    g.drawImage(h.goal, h.iconX - gs / 2, cy - gs / 2, gs, gs);
  }

  // The multiplier coin: none on a Trial (buildLayer gives its room to the goal slot).
  if (s.trial === null) {
    // It pops 1 → 1.4 → 1 on ×up (elastic), shakes ±4 px on reset.
    const m = inp.mech ? inp.mech.mult : s.nubs.mult;
    let bs = 1;
    if (h.multPop > 0) {
      const t = 1 - h.multPop / 0.3;
      bs = 1 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 1.3)) * Math.exp(-t * 2);
    }
    // Under reduced motion the coin never shakes (the hot ring is the cue).
    const shake = h.multShake > 0 && !rm ? Math.sin(h.multShake * 90) * 4 * (h.multShake / 0.2) : 0;
    const bx = h.badgeX + shake;
    const R = (h.badgeW / 2) * bs;
    if (m >= 5 && !hc) {
      // ×5 glows gold under its coin (a breathing sprite).
      goldGlow ??= radialSprite('255,200,60', 128, 0.85, 0.45, 0.35);
      const gr = R * (2 + (rm ? 0 : 0.18 * Math.sin(inp.time * 8)));
      g.drawImage(goldGlow, bx - gr, cy - gr, gr * 2, gr * 2);
    }
    const badge = h.badge as Canvas2D;
    const bw = (badge.width / v.dpr) * bs;
    g.drawImage(badge, bx - bw / 2, cy - bw / 2, bw, bw);
    const mech = inp.mech;
    if (mech?.ring) {
      // v1.6 Flow Ring: the charge runs clockwise round the coin from its top (×5: the buffer), on the
      // slot track baked into the coin's sprite. A trick flashes the charge it has (thicker and
      // brighter), never a full ring: full reads "about to level up".
      const fl = h.ringFlash / RING_FLASH_S;
      const fill = fl > 0 ? Math.max(0.04, mech.ringFill) : mech.ringFill;
      if (fill > 0) {
        g.lineCap = 'round';
        g.lineWidth = (RING_W + 2 * fl) * k * bs;
        g.strokeStyle = fl > 0 ? '#5FF2DF' : mech.bleed ? '#FF6A3D' : m >= 5 ? '#FFC23D' : '#2EE0C8';
        g.beginPath();
        g.arc(bx, cy, (h.badgeW / 2 + RING_GAP * k) * bs, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, fill));
        g.stroke();
        g.lineCap = 'butt';
      }
    }
  }

  const c = inp.campaign;
  // The cool run's sun budget: a ring around the third pip that drains with every second lit.
  if (c && h.leftShown && (c.stars & 4) === 0 && c.coolLeft < 1) {
    const px = h.pipX + 2 * h.pipStep;
    g.strokeStyle = c.coolLeft > 0.35 ? '#2EC4B6' : '#FF6A3D';
    g.lineWidth = 2.2 * k;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(px, cy, h.pipS * 0.6, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, c.coolLeft));
    g.stroke();
    g.lineCap = 'butt';
  }

  // A star pip lighting up: a gold star swelling out of it on a gold glow and settling (still under reduced motion).
  if (h.starPop > 0 && h.leftShown && c) {
    const u = 1 - h.starPop / STAR_POP_S;
    const px = h.pipX + h.starPopI * h.pipStep;
    const sw = rm ? 1 : 1 + 0.35 * Math.sin(Math.PI * Math.min(1, u * 1.4)) * (1 - u) * 2.6;
    const size = POP_STAR * k * Math.min(1.6, sw);
    if (!hc) {
      starGlow ??= radialSprite('255,214,90', 96, 0.9, 0.4, 0.4);
      const gr = size * (1.1 + 0.6 * u);
      g.globalAlpha = inp.alpha * (1 - u);
      g.drawImage(starGlow, px - gr, cy - gr, gr * 2, gr * 2);
      g.globalAlpha = inp.alpha;
    }
    if (!rm || u < 0.5) {
      const sp = starSprite(Math.round(POP_STAR * k), v.dpr, 'on');
      const d = size + 4 * (size / (POP_STAR * k));
      g.drawImage(sp, px - d / 2, cy - d / 2, d, d);
    }
  }

  // Ruler: the elapsed fill and the progress head (a moon at night is part of the layer). On a
  // campaign level the ruler is the level's progress and the head always shows; a gust blows a wind
  // glyph past it.
  if (h.leftShown && h.rulerShown) {
    const x0 = h.rulerX0;
    const x1 = h.rulerX1;
    const frac = c ? Math.min(1, Math.max(0, c.progress)) : Math.min(1, s.dayTick / dl);
    // The head rides inside the slot's rounded ends (at 0 it sits in the left cap, clear of the pips).
    const px = x0 + h.rulerH / 2 + (x1 - x0 - h.rulerH) * frac;
    const ins = 2 * k;
    const fh = h.rulerH - 2 * ins;
    const fy = h.rulerY + ins;
    const fw = px - x0 - ins;
    if (fw > 0.5) {
      h.fill ??= fillGradient(g, h, c !== null);
      g.fillStyle = h.fill;
      roundRect(g, x0 + ins, fy, Math.max(fw, fh), fh, fh / 2);
      g.fill();
      if (h.heatW > 0 && px > h.heatX) {
        // Noon Heat's band stays on the elapsed part too.
        g.fillStyle = HEAT_BAND;
        g.fillRect(h.heatX, fy, Math.min(px, h.heatX + h.heatW) - h.heatX, fh);
      }
      // The gloss line along the fill's top.
      if (fw > fh) {
        g.fillStyle = GLOSS;
        g.fillRect(x0 + ins + fh / 2, fy + 0.9 * k, fw - fh, 1.6 * k);
      }
    }
    if (!night || c) {
      // The slim head: a white disc with an ink ring and a small ink drop (three path ops).
      const hr = HEAD_R * k;
      g.fillStyle = INK;
      g.beginPath();
      g.arc(px, cy + 1.5 * k, hr, 0, TAU);
      g.fill();
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      g.arc(px, cy, hr, 0, TAU);
      g.fill();
      g.lineWidth = 2.5 * k;
      g.strokeStyle = INK;
      g.stroke();
      // v1.6 Noon Heat: the head covers the hot band from 11 to 1, so while it bites its ring turns
      // hot (hugging it, clear of the band's underline below the ruler).
      const mh = inp.mech;
      if (!c && mh && mh.noonHeat > 1 && 12 * s.dayTick >= 5 * dl && 12 * s.dayTick < 7 * dl) {
        g.strokeStyle = HEAT_RING;
        g.lineWidth = 2.5 * k;
        g.beginPath();
        g.arc(px, cy, HEAD_R * k + 2.5 * k, 0, TAU);
        g.stroke();
      }
    }
    if (c && c.gust !== 0) {
      // The gust: a wind mark drifting past the head the way the sun is pushed (+1 CCW = leftward drag).
      const dir = c.gust > 0 ? -1 : 1;
      const drift = rm ? 4 * k : ((inp.time * 1.6) % 1) * 10 * k;
      const wx = Math.min(x1 + 6 * k, Math.max(x0 - 6 * k, px + dir * (14 * k + drift)));
      const wy = cy - 12 * k;
      g.fillStyle = '#FFFFFF';
      g.strokeStyle = INK;
      g.lineWidth = 2 * k;
      g.beginPath();
      g.arc(wx, wy, 8.5 * k, 0, TAU);
      g.fill();
      g.stroke();
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
  // The Cold Snap's coin shows on Nubs' legs; another element's leg shows its meter pill there.
  const hero = s.nubs.hero;
  h.meterShown = inp.mech?.meter === true && hero === 'nubs';
  if (h.meterShown) drawFrostMeter(g, h, v, inp, inp.mech as MechView);
  else if (s.el !== null && hero !== 'nubs') meterPill(g, v, inp, hero);
  h.windBottom = 0;
  if (s.el !== null) windChip(g, h, v, inp);
  g.globalAlpha = 1;
}

/**
 * Elementals v2: the walking element's meter pill in the coin slot (its glyph and number on its
 * face colour). It never sets meterShown.
 */
function meterPill(g: CanvasRenderingContext2D, v: View, inp: HudInput, hero: HeroId): void {
  const k = hudScale(v);
  const r = 20 * k;
  const w = 92 * k;
  const x = v.vx + v.vw - v.safe.right - METER_SIDE * k + 3 * k - w;
  const y = v.vy + v.vh - v.safe.bottom - METER_BOTTOM * k - METER_R * k;
  // The pill and its glyph are one sprite per element and scale; the number is drawn over it.
  const c = cached(0, hero + k, v, w + 6 * k, 2 * r + 6 * k, (pg) => {
    pill(pg, 2 * k, 2 * k, w, 2 * r, r, FACE[HEROES[hero].face][1], k, 3 * k);
    pg.fillStyle = '#FFFFFF';
    pg.beginPath();
    pg.arc(2 * k + r, 2 * k + r, r - 5 * k, 0, TAU);
    pg.fill();
    drawGlyph(pg, hero, 2 * k + r, 2 * k + r, 24 * k);
  });
  g.globalAlpha = inp.alpha;
  g.drawImage(c, x - 2 * k, y - r - 2 * k, c.width / v.dpr, c.height / v.dpr);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  outlined(g, String(Math.round(inp.s.nubs.chill)), x + w / 2 + r, y + k, 24 * k);
}

/** HUD sprite `i` (0 the meter pill, 1 the wind chip), redrawn only when its key or the dpr changes. */
function cached(i: number, key: string, v: View, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Canvas2D {
  let c = sprC[i];
  if (!c || sprK[i] !== key + v.dpr) {
    sprK[i] = key + v.dpr;
    c = sprC[i] = sized(c, w * v.dpr, h * v.dpr);
    draw(fresh(c, v.dpr));
  }
  return c;
}
const sprC: (Canvas2D | null)[] = [];
const sprK: string[] = [];

/**
 * Elementals v2: the wind chip under the row's right end while Gust walks or a wind blows: an
 * arrow per 15 u/s of windAt the way it blows, the breeze's share dimmed (one cached sprite).
 */
function windChip(g: CanvasRenderingContext2D, h: HudState, v: View, inp: HudInput): void {
  const s = inp.s;
  const w = windAt(s);
  if (s.nubs.hero !== 'gust' && Math.abs(w) < 1) return;
  const k = hudScale(v);
  const n = Math.abs(w) < 1 ? 0 : Math.max(1, Math.min(4, Math.round(Math.abs(w) / 15)));
  const b = (s.trial as { breeze: number }).breeze;
  const nb = b * w > 0 ? Math.min(n, Math.round(Math.abs(b) / 15)) : 0;
  const cw = 30 * k + n * 12 * k;
  const d = w < 0 ? -1 : 1;
  const c = cached(1, `${n}${nb}${d}${k}`, v, cw + 4 * k, 30 * k, (cg) => {
    pill(cg, 2 * k, 2 * k, cw, 24 * k, 12 * k, INK, k, 2 * k);
    drawGlyph(cg, 'gusts', 16 * k, 14 * k, 15 * k, undefined, d < 0);
    cg.fillStyle = '#FFFFFF';
    for (let i = 0; i < n; i++) {
      // Arrows from the trailing end, the breeze's first and dimmed.
      const cx = 36 * k + (d > 0 ? i : n - 1 - i) * 12 * k;
      cg.globalAlpha = i < nb ? 0.45 : 1;
      cg.beginPath();
      cg.moveTo(cx - d * 4 * k, 8 * k);
      cg.lineTo(cx + d * 4 * k, 14 * k);
      cg.lineTo(cx - d * 4 * k, 20 * k);
      cg.lineTo(cx - d * k, 14 * k);
      cg.fill();
    }
  });
  g.globalAlpha = inp.alpha;
  g.drawImage(c, v.vx + v.vw - v.safe.right - 12 * k - cw, h.bottom - 4 * k, c.width / v.dpr, c.height / v.dpr);
  h.windBottom = h.bottom + 22 * k;
}

const HEAT_BAND = 'rgba(255,61,43,0.6)';
const HEAT_RING = 'rgba(255,61,43,0.95)';
const GLOSS = 'rgba(255,255,255,0.55)';
let goldGlow: Canvas2D | null = null;
let starGlow: Canvas2D | null = null;
let iceGlow: Canvas2D | null = null;

/** The elapsed fill: a level's green (top to bottom), or the day's dawn → noon → dusk across the ruler. */
function fillGradient(g: CanvasRenderingContext2D, h: HudState, level: boolean): CanvasGradient {
  const gr = level ? g.createLinearGradient(0, h.rulerY, 0, h.rulerY + h.rulerH) : g.createLinearGradient(h.rulerX0, 0, h.rulerX1, 0);
  const stops = level ? LEVEL_FILL : DAY_FILL;
  for (let i = 0; i < stops.length; i += 2) gr.addColorStop(stops[i] as number, stops[i + 1] as string);
  return gr;
}
const LEVEL_FILL = [0, '#B6F56A', 0.5, '#7FDB45', 1, '#3FB52A'];
const DAY_FILL = [0, '#FF9E6B', 0.22, '#FFD27A', 0.5, '#FFF2B0', 0.78, '#FFC23D', 1, '#E3829E'];

/** The frost meter's coin and ring radii, the ring's width and its margins from the world rect's right edge and the bottom inset (× the HUD scale, CSS px). */
const METER_R = 28;
const METER_RING = 34;
const METER_RING_W = 6;
const METER_SIDE = 34;
const METER_BOTTOM = 44;
/** v1.6: the Frost Bank's two charge coins hung under the meter: radius and spacing (× the HUD scale). */
const BANK_R = 9;
const BANK_DX = 11;
/** v1.6 timings (s): a spill's shake, a cash-in's pour, a trick's flash. */
export const SPILL_S = 0.6;
export const POUR_S = 0.8;
export const RING_FLASH_S = 0.35;

/**
 * The frost meter (see the header): an ice coin whose ring fills with frost, and with the Frost
 * Bank its two charge coins under it. Full, the coin turns deep blue and glows; while a snap lasts
 * the coin freezes and the ring drains white with it, and the income banked under it waits in a chip
 * over the meter.
 */
function drawFrostMeter(g: CanvasRenderingContext2D, h: HudState, v: View, inp: HudInput, m: MechView): void {
  const k = hudScale(v);
  const n = m.pips > 1 ? 2 : 1;
  const st = inp.s;
  const locked = st.trial !== null && tagLocked(st);
  const snapLeft = m.snapLeft;
  const r = METER_R * k;
  // Controls v3 C0b: the coin is the action button's placeholder, drawn at its centre.
  const x = (h.meterX = h.btnX);
  const y = h.btnY;
  h.meterY = y;
  h.meterR = METER_RING * k;
  const snapping = snapLeft > 0;
  const fullN = snapping ? 0 : Math.floor(Math.min(n, m.frost) + 0.001);
  if (fullN > h.meterFullN) h.meterPop = 0.45;
  h.meterFullN = fullN;
  const full = (h.meterFull = fullN > 0);
  const rm = inp.reducedMotion;
  const a = inp.alpha * (locked ? 0.45 : 1);
  g.globalAlpha = a;
  // A full meter breathes, and pops (1 → 1.25 → 1) when a charge fills.
  const breathe = full ? (rm ? 1 : 0.5 + 0.5 * Math.sin(inp.time * 8.8)) : 0;
  const s = 1 + (rm ? 0 : 0.18 * Math.sin((Math.PI * h.meterPop) / 0.45)) + (full && !rm ? 0.03 * breathe : 0);
  if (full && !inp.hc) {
    const glow = (iceGlow ??= radialSprite('120,200,255', 128, 0.8, 0.42, 0.32));
    const gr = r * (2.2 + 0.25 * breathe);
    g.globalAlpha = a * (0.55 + 0.45 * breathe);
    g.drawImage(glow, x - gr, y - gr, gr * 2, gr * 2);
    g.globalAlpha = a;
  }
  // The coin and its track (one sprite per look), then the fill: the charge in progress (all of it
  // once both are full), or the snap draining white.
  const look = snapping ? 2 : full ? 1 : 0;
  const mk = look * 2 + (inp.hc ? 1 : 0) + k * 10 + v.dpr * 1000;
  if (h.meterKey !== mk || !h.meterBase) renderMeter(h, v, k, look, inp.hc, mk);
  const base = h.meterBase as Canvas2D;
  const bw = (base.width / v.dpr) * s;
  g.drawImage(base, x - bw / 2, y - bw / 2, bw, bw);
  const f = snapping ? snapLeft : fullN >= n ? 1 : Math.max(0, Math.min(1, m.frost - fullN));
  if (f > 0) {
    g.lineCap = 'round';
    g.lineWidth = METER_RING_W * k * s;
    g.strokeStyle = snapping ? '#FFFFFF' : full ? '#9FE6FF' : '#5AB8FF';
    g.beginPath();
    g.arc(x, y, METER_RING * k * s, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, f));
    g.stroke();
    g.lineCap = 'butt';
  }
  if (n > 1) {
    // The bank's two charges, hung under the ring: lit in turn; a spill shakes the second.
    bankLit ??= bankSprite(true);
    bankOff ??= bankSprite(false);
    const br = BANK_R * k;
    for (let i = 0; i < 2; i++) {
      const lit = !snapping && m.frost >= i + 1 - 0.001;
      const px = x + (i === 0 ? -BANK_DX : BANK_DX) * k + (i === 1 && !rm ? Math.sin(h.spill * 70) * 3 * k * (h.spill / SPILL_S) : 0);
      const py = y + (METER_RING + 2) * k;
      const d = br * 2 * (BANK_SPRITE / (BANK_SPRITE - 2 * BANK_PAD));
      g.drawImage(lit ? bankLit : bankOff, px - d / 2, py - d / 2, d, d);
    }
  }
  const top = y - METER_RING * k - 10 * k;
  const maxX = v.vx + v.vw - v.safe.right - 4 * k;
  let cy = top;
  if (m.bankH > 0) {
    // The frost banked under the snap, paid when it ends: a chip with a snowflake ("+0.3").
    if (m.bankH !== h.lastBankH) {
      h.chipText = snapsText(m.bankH);
      h.chipW = chipWidth(g, h, h.chipText, k);
    }
    chip(g, h, x, cy, k, h.chipText, h.chipW, 1, maxX);
    cy -= 24 * k;
  }
  h.lastBankH = m.bankH;
  if (m.glassH > 0) {
    // Economy iteration 2: a saved glass cluster's frost waits for the next snap ("+0.8 next snap"),
    // a ghost chip (dimmed while no snap is ready to pour it), stacked over the snap's own chip.
    if (m.glassH !== h.lastGlassH) {
      h.glassText = `${snapsText(m.glassH)} next snap`;
      h.glassW = chipWidth(g, h, h.glassText, k);
    }
    chip(g, h, x, cy, k, h.glassText, h.glassW, fullN > 0 || snapping ? 0.95 : 0.55, maxX);
  }
  h.lastGlassH = m.glassH;
  if (locked) {
    // No ability inside a TAG's telegraph: a "TAG" chip over the dimmed coin.
    g.globalAlpha = inp.alpha;
    g.font = h.chipFont;
    const tw = g.measureText('TAG').width + 14 * k;
    g.fillStyle = INK;
    roundRect(g, x - tw / 2, top - 10 * k, tw, 20 * k, 10 * k);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('TAG', x, top + 0.5 * k);
  }
  if (h.pour > 0 && !rm) {
    // A cash-in: a stream of frost from the multiplier coin down into the meter.
    const u = 1 - h.pour / POUR_S;
    g.fillStyle = '#5AB8FF';
    g.strokeStyle = INK;
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

/**
 * The meter's coin sprite: the slot track of its ring and an ice coin with a snowflake (ready: deep
 * blue; frozen during a snap); a hero's coin is its candy face with its glyph in white (frozen while
 * its timed ability runs).
 */
function renderMeter(h: HudState, v: View, k: number, look: number, hc: boolean, key: number): void {
  const dpr = v.dpr;
  const half = (METER_RING + METER_RING_W / 2 + 3) * k;
  const size = Math.ceil(half * 2 * dpr);
  const c = sized(h.meterBase, size, size);
  h.meterBase = c;
  h.meterKey = key;
  const g = fresh(c, dpr);
  const o = size / dpr / 2;
  ring(g, o, METER_RING * k, METER_RING_W * k, k);
  coin(g, o, o, METER_R * k, look === 1 ? METER_READY : look === 2 ? METER_FROZEN : FACE.ice, k, hc);
  const f = 30 * k;
  g.drawImage(flake(), o - f / 2, o - f / 2, f, f);
}

/** A ring track centred on (o, o): an ink band with the slot's colour inside it. */
function ring(g: CanvasRenderingContext2D, o: number, r: number, w: number, k: number): void {
  g.lineWidth = w + 3 * k;
  g.strokeStyle = INK;
  g.beginPath();
  g.arc(o, o, r, 0, TAU);
  g.stroke();
  g.lineWidth = w;
  g.strokeStyle = SLOT_2;
  g.stroke();
}

const METER_READY: Face = ['#7CC4FF', '#2B7FD0', '#1F62B0', '#164A8A'];
const SOCKET: Face = [SLOT_2, SLOT_2, SLOT_2, '#3B2A5A'];
const METER_FROZEN: Face = ['#FFFFFF', '#E4F3FF', '#C6E6FB', '#9FD3F5'];

/** The Frost Bank charge coins (lit: blue with a white flake; off: a slot socket), 48 px. */
const BANK_SPRITE = 48;
const BANK_PAD = 6;
let bankLit: Canvas2D | null = null;
let bankOff: Canvas2D | null = null;
function bankSprite(lit: boolean): Canvas2D {
  const c = makeCanvas(BANK_SPRITE, BANK_SPRITE);
  const g = ctx2d(c);
  const o = BANK_SPRITE / 2;
  const r = o - BANK_PAD;
  const k = r / BANK_R;
  coin(g, o, o - k, r, lit ? FACE.blue : SOCKET, k, true);
  if (lit) g.drawImage(flake(), o - r * 0.75, o - k - r * 0.75, r * 1.5, r * 1.5);
  return c;
}

/** A chip's width for `text` (its snowflake and padding included). */
function chipWidth(g: CanvasRenderingContext2D, h: HudState, text: string, k: number): number {
  g.font = h.chipFont;
  return g.measureText(text).width + 28 * k;
}

/** A dark chip over the frost meter centred on x (a snowflake and `text` on the slot) at `alpha` × the HUD's. */
function chip(g: CanvasRenderingContext2D, h: HudState, x: number, cy: number, k: number, text: string, w: number, alpha: number, maxX: number): void {
  const a0 = g.globalAlpha;
  g.globalAlpha = a0 * alpha;
  // Kept on screen: the meter sits at the right edge, a wide chip shifts left.
  const cx = Math.min(x, maxX - w / 2);
  const ch = 22 * k;
  g.fillStyle = INK;
  roundRect(g, cx - w / 2, cy - ch / 2 + 2 * k, w, ch, ch / 2);
  g.fill();
  g.fillStyle = SLOT_2;
  roundRect(g, cx - w / 2, cy - ch / 2, w, ch, ch / 2);
  g.fill();
  g.lineWidth = 2 * k;
  g.strokeStyle = INK;
  g.stroke();
  g.drawImage(flake(), cx - w / 2 + 5 * k, cy - 7 * k, 14 * k, 14 * k);
  g.fillStyle = '#FFFFFF';
  g.font = h.chipFont;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, cx - w / 2 + 21 * k, cy + 0.5 * k);
  g.globalAlpha = a0;
}

/** "+0.3": frost hundredths as snaps, to a tenth (cash-ins, gains, the chips). */
export function snapsText(h: number): string {
  return `+${Math.round(h / 10) / 10}`;
}

/** A lit star pip's pop (s) and the popped star's size (× the HUD scale). */
const STAR_POP_S = 0.5;
const POP_STAR = 23;
/** The multiplier coin's radius (a little smaller inside the Flow Ring), the ring's gap off it (its arc's centre line) and its width (× the HUD scale). */
const MULT_R = 22;
const MULT_R_RING = 20;
const RING_GAP = 4.5;
const RING_W = 5;
/** The goal coin's radius, and in a tight row (× the HUD scale). */
const COIN_R = 16;
const COIN_R_TIGHT = 12;
/** Spacing (and size) of the campaign star pips (× the HUD scale), and in a tight row. */
const PIP_STEP = 17;
const PIP_STEP_TIGHT = 14;
/** The ruler stops this far short of the plate's end (its finish flag flies there), × the HUD scale. */
const FLAG_IN = 9;
/** The ruler's height and the progress head's radius (× the HUD scale). */
const RULER_H = 12;
const HEAD_R = 6;

const MULT_TEXT = ['×0', '×1', '×2', '×3', '×4', '×5', '×6', '×7', '×8', '×9'];

/** The multiplier coin sprite (and the Flow Ring's track when the ring is on), drawn at the current device scale. */
function renderBadge(h: HudState, v: View, m: number, ring: boolean, hc: boolean, key: number): void {
  const dpr = v.dpr;
  const k = h.k;
  const r = h.badgeW / 2;
  const half = r + (ring ? RING_GAP + RING_W / 2 + 1 : 4) * k;
  const size = Math.ceil(half * 2 * dpr);
  const c = sized(h.badge, size, size);
  h.badge = c;
  h.badgeKey = key;
  const g = fresh(c, dpr);
  const o = size / dpr / 2;
  if (ring) {
    // The ring's track, in the slot's colour (on the left it runs on into the goal slot).
    g.lineWidth = RING_W * k;
    g.strokeStyle = SLOT_2;
    g.beginPath();
    g.arc(o, o, r + RING_GAP * k, 0, TAU);
    g.stroke();
  }
  // ×1 is a quiet cloud coin, ×2-×4 violet, ×5 gold.
  const face = m >= 5 ? FACE.gold : m >= 2 ? FACE.violet : FACE.cloud;
  coin(g, o, o, r, face, k, hc);
  const t = m >= 0 && m <= 9 ? (MULT_TEXT[m] as string) : `×${m}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const px = 19 * k;
  if (m < 2) {
    g.font = h.multFont;
    g.fillStyle = INK;
    g.fillText(t, o, o + 0.5 * k);
  } else outlined(g, t, o, o, px);
}

/** The goal coin sprite: the goal's glyph on a white coin, or the Snow gem. */
function renderGoal(h: HudState, v: View, glyph: string | null, hc: boolean, key: number): void {
  const dpr = v.dpr;
  const k = h.k;
  const r = h.iconS / 2;
  const half = r + 3 * k;
  const size = Math.ceil(half * 2 * dpr);
  const c = sized(h.goal, size, size);
  h.goal = c;
  h.goalFor = glyph;
  h.goalKey = key;
  const g = fresh(c, dpr);
  const o = size / dpr / 2;
  const lk = r / COIN_R;
  if (glyph) {
    g.fillStyle = INK;
    g.beginPath();
    g.arc(o, o + 2 * lk, r, 0, TAU);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(o, o, r, 0, TAU);
    g.fill();
    g.lineWidth = 2.5 * lk;
    g.strokeStyle = INK;
    g.stroke();
    drawGlyph(g, glyph, o, o, r * 1.15);
  } else {
    // The Snow gem: an ice coin with the flake.
    coin(g, o, o, r, FACE.ice, lk, hc);
    g.drawImage(flake(), o - r * 0.8, o - r * 0.8, r * 1.6, r * 1.6);
  }
}

/** Rebuilds the row layer and the layout of the moving parts. */
function buildLayer(h: HudState, v: View, inp: HudInput, passed: number, night: number): void {
  const s = inp.s;
  const c = inp.campaign;
  const dpr = v.dpr;
  const k = Math.min(ROW_K_MAX, hudScale(v));
  const hc = inp.hc;
  const top = v.safe.top + 8;
  const cy = top + ROW_H / 2;
  h.k = k;
  h.cy = cy;
  h.builtForecast = s.params.forecast;
  h.fill = null;
  if (h.spriteK !== k || h.spriteDpr !== dpr) {
    h.spriteK = k;
    h.spriteDpr = dpr;
    h.badgeKey = -1;
    h.goalKey = -1;
  }

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
    h.snowFont = displayFont(20 * k);
    h.subFont = displayFont(15 * k);
    h.multFont = displayFont(19 * k);
    h.dayFont = displayFont(19 * k);
    h.clockFont = displayFont(18 * k);
    h.chipFont = displayFont(13 * k);
    h.badgeKey = -1;
  }

  // --- Layout: the ruler never drops -------------------------------------------------------------
  // The ruler carries the day's progress, the noon boss, the recent-best flag and the next goal, so
  // it keeps at least RULER_MIN px, and it is never shorter than v1.6's for the same state. First
  // the cosmetic steps, while it is under RULER_COMFY: the medal shrinks, the plate's inner gaps
  // close, the goal coin tucks over the plate's end, the count steps down to 18k ("/target" to
  // 14k: plain fill on the slot, no halo under 15 px) and an Endless clock to 17k. Then, while it is
  // under RULER_MIN (an Endless row: RULER_MIN_ENDLESS), the
  // information steps (v1.6's order): a level's seconds goal drops its tenths, its star pips close
  // up, then its goal glyph shrinks (never dropped: on a verb goal or a Dare it is the only label of
  // the count); an Endless clock shrinks a little (to 90 %), then the Snow coin drops and the clock
  // may shrink to 70 %.
  let main = h.snowMain;
  let sub = h.snowSub;
  let countPx = 20 * k;
  let countFont = h.snowFont;
  let subFont = h.subFont;
  const countW = (): number => tabularWidth(g, h, countFont, main) + (sub ? tabularWidth(g, h, subFont, sub) + 1 * k : 0);
  let textW = countW();
  const rx1 = v.vx + v.vw - v.safe.right - 8;
  // With the Flow Ring on (the shipped rules) the coin is a little smaller and steps in, so the
  // ring keeps 6k off the edge; the count stops 2k short of the ring (6k short of a bare coin).
  const ring = inp.mech?.ring === true;
  // Elementals: a Trial has no multiplier (docs/ELEMENTALS.md §1.1), so no coin: the slot runs to the edge.
  const noMult = s.trial !== null;
  const mr = noMult ? 0 : (ring ? MULT_R_RING : MULT_R) * k;
  const mx = noMult ? rx1 : rx1 - (ring ? MULT_R_RING + 1 : MULT_R) * k;
  const textEnd = noMult ? rx1 - 14 * k : ring ? mx - mr - (RING_GAP + RING_W / 2 + 2) * k : mx - mr - 6 * k;
  const lx0 = v.vx + v.safe.left + 8 + 48 + 8;
  let medalR = 23 * k;
  let gap = 5 * k;
  let tuck = 4 * k;
  let coinR = COIN_R * k;
  let icon = true;
  let pipStep = PIP_STEP;
  let clockFont = h.clockFont;
  let clockW = c ? 3 * pipStep * k : widestClock(g, h, clockFont);
  // The count sits from the goal coin's right to 6k short of the multiplier coin; the slot's left end
  // is 2k left of the coin's centre (the coin overlaps it), its right end under the multiplier coin.
  const slotLOf = (): number => textEnd - textW - (icon ? 3 * k + coinR + 2 * k : 12 * k);
  const plateROf = (): number => slotLOf() + (icon ? 2 * k - coinR : 0) - tuck;
  // An Endless clock keeps at least 6k before the ruler's cap (the pips carry their own air).
  const clockGap = (): number => (c ? gap : Math.max(gap, 6 * k));
  const rulerOf = (): number => plateROf() - FLAG_IN * k - (lx0 + 2 * medalR + gap + clockW + clockGap());
  if (rulerOf() < RULER_COMFY) medalR = 19 * k;
  if (rulerOf() < RULER_COMFY) gap = 3 * k;
  if (rulerOf() < RULER_COMFY) tuck = 0;
  if (rulerOf() < RULER_COMFY) {
    countPx = 18 * k;
    countFont = displayFont(countPx);
    subFont = displayFont(14 * k);
    textW = countW();
  }
  // An Endless clock is ink on cream (no halo): it may step down to 17k as well.
  let clockPx = 18 * k;
  if (!c && rulerOf() < RULER_COMFY) {
    clockPx = 17 * k;
    clockFont = displayFont(clockPx);
    clockW = widestClock(g, h, clockFont);
  }
  if (c) {
    if (rulerOf() < RULER_MIN && h.shortMain + h.shortSub !== main + sub) {
      main = h.shortMain;
      sub = h.shortSub;
      textW = countW();
    }
    if (rulerOf() < RULER_MIN) {
      pipStep = PIP_STEP_TIGHT;
      clockW = 3 * pipStep * k;
    }
    if (rulerOf() < RULER_MIN) coinR = COIN_R_TIGHT * k;
  } else {
    const fit = (fMin: number): void => {
      for (let f = 0.95; f >= fMin - 0.001 && rulerOf() < RULER_MIN_ENDLESS; f -= 0.05) {
        clockFont = displayFont(clockPx * f);
        clockW = widestClock(g, h, clockFont);
      }
    };
    fit(0.9);
    if (rulerOf() < RULER_MIN_ENDLESS) {
      icon = false;
      clockFont = displayFont(clockPx);
      clockW = widestClock(g, h, clockFont);
      fit(0.7);
    }
  }

  // --- Right: the goal slot (under the multiplier coin) ----------------------------------------------
  const slotL = slotLOf();
  const slotH = 34 * k;
  slot(g, slotL, cy - slotH / 2, mx - slotL, slotH, slotH / 2, k);
  h.iconS = icon ? coinR * 2 : 0;
  h.iconX = slotL + 2 * k;
  let x = icon ? slotL + 2 * k + coinR + 3 * k : slotL + 12 * k;
  // A met goal turns its count green ("4/4").
  const met = c !== null && h.snowTarget >= 0 && c.goalValue >= h.snowTarget;
  g.textBaseline = 'alphabetic';
  const base = cy + 7 * k;
  x += drawTabular(g, h, countFont, main, x, base, met ? '#9BEA4F' : '#FFFFFF', countPx * 0.24, countPx);
  if (sub) drawTabular(g, h, subFont, sub, x + 1 * k, base, SLOT_SUB);
  g.textBaseline = 'middle';
  h.badgeX = mx;
  h.badgeW = 2 * mr;
  h.badgeH = 2 * mr;

  // --- Left: the medal, its plate (pips or the clock), the ruler -------------------------------------
  const plateR = icon ? slotL + 2 * k - coinR - tuck : slotL - tuck;
  h.leftShown = plateR - lx0 >= 120;
  h.rulerShown = false;
  h.rulerX0 = h.rulerX1 = 0;
  h.heatW = 0;
  if (!h.leftShown) return;
  const mcx = lx0 + medalR;
  const plateH = 38 * k;
  plate(g, mcx, cy - plateH / 2, plateR - mcx, plateH, 14 * k, k, hc ? 4 * k : 3 * k);
  medal(g, h, mcx, cy, medalR, k, hc, c === null && h.builtForecast !== 'clear' ? h.builtForecast : null);
  let cx = lx0 + 2 * medalR + gap;
  if (c) {
    // Earned: gold; still to play for: a socket; the cool run lost: a slashed grey star.
    h.pipStep = pipStep * k;
    h.pipS = pipStep * k;
    h.pipX = cx + h.pipStep / 2;
    const ps = Math.round(pipStep * k);
    for (let i = 0; i < 3; i++) {
      const on = i === 0 ? c.stars & 1 : i === 1 ? c.stars & 2 : 0;
      const lost = i === 2 && (c.stars & 4) !== 0;
      const sp = starSprite(ps, dpr, on ? 'on' : lost ? 'lost' : 'off');
      g.drawImage(sp, h.pipX + i * h.pipStep - ps / 2 - 2, cy - ps / 2 - 2, ps + 4, ps + 4);
    }
  } else {
    g.textBaseline = 'alphabetic';
    drawTabular(g, h, clockFont, h.clock, cx, cy + 6.5 * k, INK);
    g.textBaseline = 'middle';
  }
  // Reserve the width of the widest clock so the ruler doesn't jump.
  cx += clockW + clockGap();
  const r0 = cx;
  const r1 = plateR - FLAG_IN * k;
  if (r1 - r0 <= 24) return;
  h.rulerShown = true;
  const rh = RULER_H * k;
  const ry = cy - rh / 2;
  h.rulerX0 = r0;
  h.rulerX1 = r1;
  h.rulerY = ry;
  h.rulerH = rh;
  slot(g, r0, ry, r1 - r0, rh, rh / 2, k);
  if (c) drawProgressStatic(g, c, r0, r1, ry, rh, k, s, inp.mech, plateH, cy);
  else drawRulerStatic(g, h, s, r0, r1, ry, rh, cy, k, inp, passed === 1, night === 1);
}

/** The gold medal with the level or the day, and the day's forecast as a sticker on its shoulder. */
function medal(g: CanvasRenderingContext2D, h: HudState, x: number, y: number, r: number, k: number, hc: boolean, forecast: ForecastId | null): void {
  coin(g, x, y, r, FACE.gold, k, hc);
  if (!hc) {
    g.strokeStyle = 'rgba(170,90,0,0.45)';
    g.lineWidth = 1.8 * k;
    g.setLineDash(medalDash(k));
    g.beginPath();
    g.arc(x, y, r - 5.5 * k, 0, TAU);
    g.stroke();
    g.setLineDash(noDash);
  }
  // "L6" at 19k; longer labels ("L200") shrink to fit inside the dashed ring.
  g.font = h.dayFont;
  const w = g.measureText(h.dayText).width;
  const maxW = 2 * r - 9 * k;
  const px = w > maxW ? Math.max(12 * k, 19 * k * (maxW / w)) : 19 * k;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  outlined(g, h.dayText, x, y + 0.5 * k, px);
  if (forecast) {
    // A round sticker on the medal's top-right shoulder: "Day 3, breezy".
    const sr = 8 * k;
    const sx = x + r * 0.74;
    const sy = y - r * 0.74;
    g.fillStyle = INK;
    g.beginPath();
    g.arc(sx, sy + 1.5 * k, sr, 0, TAU);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(sx, sy, sr, 0, TAU);
    g.fill();
    g.lineWidth = 2 * k;
    g.strokeStyle = INK;
    g.stroke();
    drawGlyph(g, forecast, sx, sy, 12 * k);
  }
}

const dash2 = [0, 0];
const noDash: number[] = [];
function medalDash(k: number): number[] {
  dash2[0] = 3 * k;
  dash2[1] = 3 * k;
  return dash2;
}

/** A tick across the ruler (3k wide, ink-outlined, 3k past the slot above and below) at x. */
function tick(g: CanvasRenderingContext2D, x: number, y: number, rh: number, k: number, fill: string): void {
  g.fillStyle = INK;
  g.fillRect(x - 2.5 * k, y - 4 * k, 5 * k, rh + 8 * k);
  g.fillStyle = fill;
  g.fillRect(x - 1.5 * k, y - 3 * k, 3 * k, rh + 6 * k);
}

/** A small white marker coin with a glyph, sitting on the ruler's top edge at x. */
function markCoin(g: CanvasRenderingContext2D, x: number, y: number, k: number, id: string): void {
  const r = 7 * k;
  const my = y - 6 * k;
  g.fillStyle = INK;
  g.beginPath();
  g.arc(x, my + 1.5 * k, r, 0, TAU);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(x, my, r, 0, TAU);
  g.fill();
  g.lineWidth = 2 * k;
  g.strokeStyle = INK;
  g.stroke();
  drawGlyph(g, id, x, my, 10 * k);
}

/**
 * A level's ruler's still parts: the gate or eclipse marker at the midpoint, the level's kept
 * flares, and the checkered finish flag on its post at the end.
 */
function drawProgressStatic(g: CanvasRenderingContext2D, c: HudCampaign, x0: number, x1: number, y: number, rh: number, k: number, s: SimState, m: MechView | null, plateH: number, cy: number): void {
  // Positions map onto the head's travel (inside the slot's rounded ends).
  const m0 = x0 + rh / 2;
  const m1 = x1 - rh / 2;
  // v1.6: the level's kept flares where Nubs will meet them (a boss finale's HP).
  flareMarks(g, s, m, true, m0, m1, y, rh, k);
  // Markers on the ruler: the gate arch, the eclipse disc.
  if (c.markGate >= 0) markCoin(g, m0 + (m1 - m0) * c.markGate, y, k, 'gate');
  if (c.markEclipse >= 0) markCoin(g, m0 + (m1 - m0) * c.markEclipse, y, k, 'eclipse');
  // The finish: a checkered flag on an ink post rising from where the head ends to above the plate.
  finishFlag(g, m1, y + rh, cy - plateH / 2 - 9 * k, k);
}

/** A 14k × 10k checkered flag with an ink outline on a 2k post from y1 (bottom) up to yTop. */
function finishFlag(g: CanvasRenderingContext2D, x: number, y1: number, yTop: number, k: number): void {
  g.fillStyle = INK;
  g.fillRect(x - 1 * k, yTop, 2 * k, y1 - yTop);
  const fw = 14 * k;
  const fh = 10 * k;
  const fx = x + 0.5 * k;
  g.fillStyle = INK;
  g.fillRect(fx - 1 * k, yTop - 1 * k, fw + 2 * k, fh + 2 * k);
  const sq = fw / 4;
  const rows = 3;
  const sh = fh / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 4; col++) {
      g.fillStyle = (row + col) % 2 === 0 ? '#FFFFFF' : INK;
      g.fillRect(fx + col * sq, yTop + row * sh, sq, sh);
    }
  }
}

/**
 * The kept Heat Flares over the ruler from x0 to x1 (top at y), at their rise: on a level's progress
 * (`level`), else on today's ruler. On the ruler each is white-hot in an orange ring while it waits
 * (the noon boss is solid orange), teal once parried, grey once missed, its ring clear of the
 * progress head. On a level: a tick through the ruler, orange while it waits, teal once parried, a
 * red ✕ once missed; and the boss's HP, the flares not parried yet (a miss does not hurt the boss),
 * on a hot coin at the ruler's start.
 */
function flareMarks(g: CanvasRenderingContext2D, s: SimState, m: MechView | null, level: boolean, x0: number, x1: number, y: number, rh: number, k: number): void {
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
      // A level's ruler can be short (48 px) with up to 8 flares: a 3k tick each, a ✕ for a miss.
      if (out !== 1) left++;
      if (out === 2) {
        const my = y - 7 * k;
        for (let p2 = 0; p2 < 2; p2++) {
          g.strokeStyle = p2 === 0 ? INK : '#FF4A3D';
          g.lineWidth = (p2 === 0 ? 4 : 2) * k;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(x - 3 * k, my - 3 * k);
          g.lineTo(x + 3 * k, my + 3 * k);
          g.moveTo(x + 3 * k, my - 3 * k);
          g.lineTo(x - 3 * k, my + 3 * k);
          g.stroke();
        }
        g.lineCap = 'butt';
      } else tick(g, x, y, rh, k, out === 0 ? '#FF6A3D' : '#2EE0C8');
      continue;
    }
    // The ring sits 9k over the ruler, on a short ink stem; within the noon boss's reach (the
    // ruler's middle) it hangs 9k under the ruler instead, clear of the glyph.
    const under = Math.abs(x - (x0 + x1) / 2) < 13 * k;
    g.fillStyle = INK;
    g.fillRect(x - 1 * k, under ? y + rh : y - 6 * k, 2 * k, 6 * k);
    g.fillStyle = out === 0 ? '#FFF4D6' : out === 1 ? '#2EC4B6' : '#B5ABC4';
    g.beginPath();
    g.arc(x, under ? y + rh + 9 * k : y - 9 * k, 4 * k, 0, TAU);
    g.fill();
    g.lineWidth = 1.8 * k;
    g.strokeStyle = out === 0 ? '#FF6A3D' : INK;
    g.stroke();
  }
  if (level && left > 0) {
    // The boss's HP (the flares not parried yet): a hot coin with the count at the ruler's start.
    const hx = x0 + 2 * k;
    const hy = y - 8 * k;
    coin(g, hx, hy, 7.5 * k, FACE.red, k * 0.6);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // A world-label-style count: under 15 px it keeps a full stroke (it sits on the busy HUD).
    outlined(g, String(left), hx, hy + 0.5 * k, 12 * k, '#FFFFFF', undefined, 0.3);
  }
}

/** The ruler keeps at least this width (CSS px) whenever the left panel shows; under RULER_COMFY the cosmetic steps start. */
const RULER_MIN = 48;
/** An Endless row's information steps aim 4 px over the floor (where v1.6's coarser clock steps landed). */
const RULER_MIN_ENDLESS = 52;
const RULER_COMFY = 72;

/** The widest clock a day can show ('10:00 AM' or '12:00 PM', with tabular digits). */
function widestClock(g: CanvasRenderingContext2D, h: HudState, font: string): number {
  return Math.max(tabularWidth(g, h, font, '10:00 AM'), tabularWidth(g, h, font, '12:00 PM'));
}

/** The day ruler's still parts into the layer: the day's light faded on the track, Noon Heat, the noon boss, flags, flares and the milestone tick, and the moon at night. */
function drawRulerStatic(
  g: CanvasRenderingContext2D,
  h: HudState,
  s: SimState,
  x0: number,
  x1: number,
  y: number,
  rh: number,
  cy: number,
  k: number,
  inp: HudInput,
  passed: boolean,
  night: boolean,
): void {
  // The day's light, faded on the track (the elapsed part is filled at full strength per frame).
  const ins = 2 * k;
  // Positions map onto the head's travel (inside the slot's rounded ends).
  const m0 = x0 + rh / 2;
  const m1 = x1 - rh / 2;
  g.globalAlpha = 0.32;
  g.fillStyle = fillGradient(g, h, false);
  roundRect(g, x0 + ins, y + ins, x1 - x0 - 2 * ins, rh - 2 * ins, (rh - 2 * ins) / 2);
  g.fill();
  g.globalAlpha = 1;
  const m = inp.mech;
  if (m && m.noonHeat > 1) {
    // v1.6 Noon Heat: 11 AM-1 PM bites harder (a hot band on the track, kept on the elapsed fill),
    // and an underline below the ruler too: the band is narrower than the head, which hides it at noon.
    const hx = m0 + ((m1 - m0) * 5) / 12;
    const hw = (m1 - m0) / 6;
    h.heatX = hx;
    h.heatW = hw;
    g.fillStyle = HEAT_BAND;
    g.fillRect(hx, y + ins, hw, rh - 2 * ins);
    g.fillStyle = INK;
    g.fillRect(hx - 1 * k, y + rh + 1.5 * k, hw + 2 * k, 3.6 * k);
    g.fillStyle = '#FF4A3D';
    g.fillRect(hx, y + rh + 2.4 * k, hw, 1.8 * k);
  }

  // The noon boss, sitting on the ruler's top edge.
  const nx = (x0 + x1) / 2;
  const nr = 5.5 * k;
  const ny = y - nr + 1 * k;
  h.noonX = nx;
  h.noonY = ny;
  h.noonR = nr;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * TAU) / 8;
    g.moveTo(nx + Math.cos(a - 0.3) * nr, ny + Math.sin(a - 0.3) * nr);
    g.lineTo(nx + Math.cos(a) * nr * 1.55, ny + Math.sin(a) * nr * 1.55);
    g.lineTo(nx + Math.cos(a + 0.3) * nr, ny + Math.sin(a + 0.3) * nr);
  }
  g.moveTo(nx + nr, ny);
  g.arc(nx, ny, nr, 0, TAU);
  g.lineJoin = 'round';
  g.lineWidth = 3 * k;
  g.strokeStyle = INK;
  g.stroke();
  g.fillStyle = passed ? '#FFD27A' : '#FF8A2B';
  g.fill();
  // Angry brows (it's the boss).
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1, 1.2 * k);
  g.beginPath();
  g.moveTo(nx - nr * 0.6, ny - nr * 0.35);
  g.lineTo(nx - nr * 0.1, ny - nr * 0.05);
  g.moveTo(nx + nr * 0.6, ny - nr * 0.35);
  g.lineTo(nx + nr * 0.1, ny - nr * 0.05);
  g.stroke();

  // Flags: PB (gold) and challenge (teal), when they fall inside today, ink-outlined on ink posts.
  const dayStart = (s.day - 1) * 720;
  const flag = (minutes: number, color: string): void => {
    if (minutes < 0) return;
    const mm = minutes - dayStart;
    if (mm < 0 || mm > 720) return;
    const fx = m0 + ((m1 - m0) * mm) / 720;
    g.fillStyle = INK;
    g.fillRect(fx - 1 * k, y - 11 * k, 2 * k, rh + 13 * k);
    g.beginPath();
    g.moveTo(fx, y - 11 * k);
    g.lineTo(fx + 8 * k, y - 8 * k);
    g.lineTo(fx, y - 5 * k);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 1.5 * k;
    g.strokeStyle = INK;
    g.stroke();
  };
  flag(inp.pbMinutes, '#FFC23D');
  flag(inp.challengeMinutes, '#2EC4B6');
  // v1.6: today's kept Heat Flares at their rise, as soon as they are decided.
  flareMarks(g, s, m, false, m0, m1, y, rh, k);
  // The next milestone: a white tick across the ruler.
  const gm = inp.goalMinutes - dayStart;
  if (inp.goalMinutes >= 0 && gm >= 0 && gm <= 720) tick(g, m0 + ((m1 - m0) * gm) / 720, y, rh, k, '#FFFFFF');

  // At night the head is a moon at the end of the (full) ruler: part of the layer.
  if (night) {
    g.fillStyle = INK;
    g.beginPath();
    g.arc(m1, cy, 7 * k, 0, TAU);
    g.fill();
    g.fillStyle = '#E8ECFF';
    g.beginPath();
    g.arc(m1, cy, 5.5 * k, 0, TAU);
    g.fill();
    g.fillStyle = '#34306B';
    g.beginPath();
    g.arc(m1 + 2.2 * k, cy - 1.5 * k, 4.6 * k, 0, TAU);
    g.fill();
  }
}
