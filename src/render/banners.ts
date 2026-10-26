// Screen-space moments (GDD §11) in the "Candy" look (docs/UI_V2.md §9.5-9.8): the Night card (a
// violet NIGHT ribbon over a plate "Day N survived" with a crescent), the Day card (a green ribbon
// for Meadow, red for Old Town, "DAY N" over a plate "MEADOW · Heat Wave · NOON 72°" with the biome's
// glyph and, on a hotter day, the Noon Heat line; five slow warm-white rays behind it; slides in from
// the right in 500 ms, holds, leaves to the left; fades only under reduced motion), the stamps (a
// candy plate on a comic burst that slams in at 2.4× over 220 ms with an overshoot, tilted −5°,
// holds, then fades and rises 12 px over 300 ms; under reduced motion it only fades: 'HIGH NOON' red
// on gold, 'PASSED SAM!' green, 'PAST YOUR RECENT BEST' gold, FINISH cream with checkered bands,
// a missed goal pink, PARRY! blue on ice), the level intro card (a framed panel with a ribbon, the
// concept chip, the goal and Dare chips, three star wells and a gold start pill hanging off its
// edge), the in-run toasts (cream pills with an icon coin), and the timers of the edge vignettes the
// atmosphere layer draws (atmosphere.ts): low-Chill heat haze, the cool multiplier pulse and the gold
// ×5 pulse. Photosensitivity: no full-screen flash.
//
// Cost: every card, stamp and toast is drawn once into a sprite when it first shows (and again on a
// resize, a contrast change or when the display font arrives); a frame blits it with a transform and
// an alpha. No shadowBlur, no per-frame gradients.

import { FORECASTS, type BiomeId, type ForecastId } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { bodyFont, burst, candyRect, chip, coin, displayFont, FACE, fontGen, INK, INK_2, onDisplayFont, outlined, panel, plate, ribbon, RIBBON, starSprite, TEXT, well, type Face, type FaceName, type RibbonTone } from './candy.ts';
import { drawGlyph } from './glyphs.ts';
import { ctx2d, makeCanvas, type Canvas2D } from './sprites.ts';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** The Day card's life (s). */
const DAY_S = 2;

/** A cached sprite and what it was drawn for (CSS px size and the anchor's offset inside it). */
interface Sprite {
  c: Canvas2D | null;
  /** Inputs it was drawn for: device scale, HUD scale, font generation, contrast, width, the thing it shows. */
  dpr: number;
  k: number;
  gen: number;
  hc: boolean;
  w: number;
  of: unknown;
  /** Its CSS size, and where the anchor (the card's top-left, a stamp's centre) sits in it. */
  cw: number;
  ch: number;
  ox: number;
  oy: number;
}

function sprite(): Sprite {
  return { c: null, dpr: 0, k: 0, gen: -1, hc: false, w: 0, of: null, cw: 0, ch: 0, ox: 0, oy: 0 };
}

function stale(s: Sprite, dpr: number, k: number, hc: boolean, w: number, of: unknown): boolean {
  return s.c === null || s.dpr !== dpr || s.k !== k || s.gen !== fontGen || s.hc !== hc || s.w !== w || s.of !== of;
}

/** Sizes sprite `s` to cw × ch CSS px at `dpr` (anchor at ox, oy) and returns its cleared context, translated to the anchor. */
function begin(s: Sprite, dpr: number, k: number, hc: boolean, w: number, of: unknown, cw: number, ch: number, ox: number, oy: number): CanvasRenderingContext2D {
  const pw = Math.max(1, Math.ceil(cw * dpr));
  const ph = Math.max(1, Math.ceil(ch * dpr));
  if (!s.c) s.c = makeCanvas(pw, ph);
  else if (s.c.width !== pw || s.c.height !== ph) {
    s.c.width = pw;
    s.c.height = ph;
  }
  s.dpr = dpr;
  s.k = k;
  s.gen = fontGen;
  s.hc = hc;
  s.w = w;
  s.of = of;
  s.cw = pw / dpr;
  s.ch = ph / dpr;
  s.ox = ox;
  s.oy = oy;
  const g = ctx2d(s.c);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.clearRect(0, 0, pw, ph);
  g.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
  return g;
}

/** Blits sprite `s` with its anchor at (x, y). */
function blit(g: CanvasRenderingContext2D, s: Sprite, x: number, y: number): void {
  if (s.c) g.drawImage(s.c, x - s.ox, y - s.oy, s.cw, s.ch);
}

/** Sprites are drawn at the device scale, up to 2. */
const spriteDpr = (v: View): number => Math.min(2, v.dpr);

export interface Banners {
  night: number;
  /** 'Day 2 survived' (the plate under the NIGHT ribbon). */
  nightText: string;
  day: number;
  dayN: number;
  dayText: string;
  /** The Day card's second line and its biome (glyph and ribbon); v1.6: its Noon Heat line ('' none). */
  dayLine: string;
  dayHeat: string;
  dayBiome: BiomeId;
  /** The Day card's words as one key (its sprite is redrawn when they change). */
  dayKey: string;
  coolPulse: number;
  goldPulse: number;
  /** Heat haze strength 0..1 (eased toward 1 while Chill < 25). */
  heat: number;
  heatPhase: number;
  /** The stamp: seconds since it appeared (−1 none), its look, text and hold time. */
  stamp: number;
  stampKind: StampKind;
  /** Elementals: a TAG! stamp's face (the incoming hero's), else null. */
  stampFace: Face | null;
  stampText: string;
  stampHold: number;
  /** Stars earned shown under a FINISH stamp (−1 none): they pop in one by one. */
  stampStars: number;
  /** The stamp's look and words as one interned key (its sprite is redrawn when it changes). */
  stampId: string;
  /** The plate's half height (CSS px) of the stamp last drawn (the stars hang under it). */
  stampHalfH: number;
  /** The Day card rays' fill (a radial fade, in card-centred px) and the ray length it was built for. */
  rayFill: CanvasGradient | null;
  rayLen: number;
  /**
   * The level intro card (CAMPAIGN_PLAN §4): seconds since it appeared (−1 none), seconds since it
   * was dismissed (−1 while it holds), and its words.
   */
  level: number;
  levelOut: number;
  levelKicker: string;
  levelTitle: string;
  levelConcept: string | null;
  levelConceptName: string;
  levelBlurb: string;
  levelGoal: string;
  /** The three star rules' short labels: the goal, the flakes (or the Dare), the cool run. */
  levelStars: readonly string[];
  /** v1.6: the Dare line ('' none) and its glyph. */
  levelDare: string;
  levelDareGlyph: string | null;
  levelBiome: BiomeId;
  /** Bumped by showLevelCard: the card's sprite is redrawn for new words. */
  levelGen: number;
  /** The last input came from a keyboard (set each frame): the start pill names the key instead of the tap. */
  levelKeys: boolean;
  /** The intro card's sprites (the card; the start pill). */
  cardSprite: Sprite;
  pillSprite: Sprite;
  stampSprite: Sprite;
  toastSprite: Sprite;
  daySprite: Sprite;
  nightSprite: Sprite;
  /**
   * In-run toasts under the HUD (v1.4): a mission done ("MISSION ✓ 2/3"), a level tip. They queue
   * (at most TOAST_QUEUE) and wait while a card or stamp holds the top of the screen, so they never
   * cover those, Nubs or his dial. toastT: seconds the first one has shown (−1 none showing). A card
   * or stamp arriving over a toast on screen (PARRY!, a Day card) hides it (toastHide, eased 0..1)
   * and holds its clock until it has gone, so no half-legible text shows through.
   */
  toasts: Toast[];
  toastT: number;
  toastHide: number;
  /** Seconds since the banners were made (updateBanners): when each toast was queued (Toast.at). */
  toastClock: number;
  /** No tip starts before this toastClock (tipRest after the last toast, holdToasts); missions and urgent tips may. */
  tipAt: number;
  /** The rest between tips (s): TIP_REST, shorter on a Trial (tipPace). */
  tipRest: number;
  /** The toast on screen's wrapped lines and the width they were wrapped for. */
  toastLines: string[];
  toastWrapW: number;
}

export type ToastKind = 'mission' | 'tip';

export interface Toast {
  kind: ToastKind;
  kicker: string;
  text: string;
  /** Glyph in the icon coin (drawGlyph id); null draws a check mark. */
  glyph: string | null;
  hold: number;
  /** Shown with `urgent` (showToast): no ordinary toast replaces it, goes ahead of it or cuts it short. */
  urgent: boolean;
  /** Banners.toastClock when it was queued. */
  at: number;
}

export type StampKind = 'noon' | 'teal' | 'gold' | 'finish' | 'miss' | 'frost' | 'tag';

/** Stamp timing (s): slam in, then fade out (the hold is per stamp). */
export const STAMP_IN = 0.22;
const STAMP_OUT = 0.3;
/** The finish plate: white to cream with a cream-3 lip (its checkered bands are drawn on it). */
const FINISH_FACE: Face = ['#FFFFFF', '#FFF8E6', '#F6E7C4', '#EBC982'];
/** Plate face and burst fill of each stamp look ('' no burst). */
const STAMP_LOOK: Readonly<Record<StampKind, readonly [Face, string]>> = {
  noon: [FACE.red, '#FFD84A'],
  teal: [FACE.green, '#FFFFFF'],
  gold: [FACE.gold, '#FFFFFF'],
  finish: [FINISH_FACE, '#FFD84A'],
  miss: [FACE.pink, ''],
  // v1.6 PARRY!: a blue plate on an ice burst.
  frost: [FACE.blue, '#CFEFFF'],
  // Elementals: TAG! on the incoming element's face (showStamp's).
  tag: [FACE.violet, '#FFFFFF'],
};
/** The level card's slide-out (s). */
const LEVEL_OUT_S = 0.3;
/** The level card's slide-in (s). */
const LEVEL_IN_S = 0.32;

export function createBanners(): Banners {
  // The display face may still be loading: its arrival bumps fontGen, which redraws the sprites.
  onDisplayFont(noop);
  return {
    night: -1,
    nightText: '',
    day: -1,
    dayN: 1,
    dayText: 'DAY 1',
    dayLine: '',
    dayHeat: '',
    dayBiome: 'meadow',
    dayKey: '',
    coolPulse: 0,
    goldPulse: 0,
    heat: 0,
    heatPhase: 0,
    stamp: -1,
    stampKind: 'noon',
    stampFace: null,
    stampText: '',
    stampHold: 0,
    stampStars: -1,
    stampId: '',
    stampHalfH: 0,
    rayFill: null,
    rayLen: 0,
    level: -1,
    levelOut: -1,
    levelKicker: '',
    levelTitle: '',
    levelConcept: null,
    levelConceptName: '',
    levelBlurb: '',
    levelGoal: '',
    levelStars: [],
    levelDare: '',
    levelDareGlyph: null,
    levelBiome: 'meadow',
    levelGen: 0,
    levelKeys: false,
    cardSprite: sprite(),
    pillSprite: sprite(),
    stampSprite: sprite(),
    toastSprite: sprite(),
    daySprite: sprite(),
    nightSprite: sprite(),
    toasts: [],
    toastT: -1,
    toastHide: 0,
    toastClock: 0,
    tipAt: 0,
    tipRest: TIP_REST,
    toastLines: [],
    toastWrapW: 0,
  };
}

function noop(): void {}

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
  /** v1.6: "Dare · Bloom 2" ('' none) and its glyph. */
  dare?: string;
  dareGlyph?: string | null;
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
  b.levelConcept = w.concept;
  b.levelConceptName = w.conceptName;
  b.levelBlurb = w.blurb;
  b.levelGoal = w.goal;
  b.levelStars = w.stars;
  b.levelDare = w.dare ?? '';
  b.levelDareGlyph = w.dareGlyph ?? null;
  b.levelBiome = biome;
  b.levelGen++;
}

/** The run started: the level card slides out. */
export function dismissLevelCard(b: Banners): void {
  if (b.level >= 0 && b.levelOut < 0) b.levelOut = 0;
}

/** Shows a stamp (it replaces any stamp still on screen); `face` names a TAG!'s candy face. */
export function showStamp(b: Banners, kind: StampKind, text: string, hold: number, face?: FaceName): void {
  b.stamp = 0;
  b.stampKind = kind;
  b.stampText = text;
  b.stampHold = hold;
  b.stampStars = -1;
  b.stampFace = face ? FACE[face] : null;
  // A new stamp of the same words and look reuses its sprite; anything else redraws it.
  b.stampId = stampId(kind, face ? `${text}|${face}` : text);
}

const stampIds = new Map<string, string>();
/** One interned key per (kind, text), so the stamp sprite's `of` compares by identity. */
function stampId(kind: StampKind, text: string): string {
  const k = `${kind}|${text}`;
  let id = stampIds.get(k);
  if (id === undefined) {
    if (stampIds.size > 64) stampIds.clear();
    id = k;
    stampIds.set(k, id);
  }
  return id;
}

/** Toasts waiting beyond this many are dropped (a burst of mission steps never backs up). */
const TOAST_QUEUE = 4;
const TOAST_IN = 0.25;
const TOAST_OUT = 0.3;

/** A tip on screen at least this long (s) steps aside for a mission. */
const TIP_YIELD_S = 1.5;
/**
 * The top band, where the path ahead comes in, stays clear this long (s) after a toast before a tip
 * shows: at most one tip in about ten seconds.
 */
const TIP_REST = 6;
/** A Trial's rest between tips (s): its moments come fast, and a tip that waits is stale. */
const TRIAL_TIP_REST = 2;

/** Sets the rest between tips for the run (a Trial's is shorter). */
export function tipPace(b: Banners, trial: boolean): void {
  b.tipRest = trial ? TRIAL_TIP_REST : TIP_REST;
}

/**
 * Queues an in-run toast (see Banners.toasts). A mission goes ahead of waiting tips (and a tip that
 * has shown TIP_YIELD_S starts to leave); a new tip replaces the waiting one, so at most one tip waits
 * (one follow-up per moment: tips never pile up behind the one on screen).
 * An `urgent` toast (a cue about to happen, the first Heat Flare) goes next at once: whatever waits
 * is dropped and the toast on screen starts to leave now. Once queued it keeps its place: a later
 * tip is dropped instead of replacing it, a mission goes after it, and on screen it does not
 * step aside (it leaves when its hold runs out or endToast ends it).
 */
export function showToast(b: Banners, kind: ToastKind, kicker: string, text: string, glyph: string | null, hold: number, urgent = false): void {
  const t: Toast = { kind, kicker, text, glyph, hold, urgent, at: b.toastClock };
  const q = b.toasts;
  const first = b.toastT >= 0 ? 1 : 0;
  if (urgent) {
    q.length = first;
    q.push(t);
    if (first) b.toastT = Math.max(b.toastT, TOAST_IN + (q[0] as Toast).hold);
    return;
  }
  if (kind === 'tip') {
    // One tip waits at most (one follow-up per moment): a waiting urgent one is kept and the new one
    // dropped behind it; a waiting plain one is replaced by the newer.
    for (let i = q.length - 1; i >= first; i--) {
      const w = q[i] as Toast;
      if (w.kind !== 'tip') continue;
      if (w.urgent) return;
      q.splice(i, 1);
    }
    if (q.length < TOAST_QUEUE) q.push(t);
    return;
  }
  let at = first;
  while (at < q.length && ((q[at] as Toast).kind === 'mission' || (q[at] as Toast).urgent)) at++;
  if (q.length >= TOAST_QUEUE) q.pop();
  q.splice(at, 0, t);
  const shown = q[0] as Toast;
  if (first === 1 && shown.kind === 'tip' && !shown.urgent && b.toastT > TOAST_IN + TIP_YIELD_S) b.toastT = Math.max(b.toastT, TOAST_IN + shown.hold);
}

/** Ends the toast saying `text`: on screen it starts to leave now; still waiting, it is dropped. */
export function endToast(b: Banners, text: string): void {
  const q = b.toasts;
  for (let i = q.length - 1; i >= 0; i--) {
    const t = q[i] as Toast;
    if (t.text !== text) continue;
    if (i === 0 && b.toastT >= 0) b.toastT = Math.max(b.toastT, TOAST_IN + t.hold);
    else q.splice(i, 1);
  }
}

/** No tip starts for `s` seconds (a cue line is being read). */
export function holdToasts(b: Banners, s: number): void {
  b.tipAt = Math.max(b.tipAt, b.toastClock + s);
}

/** The run ended: drop what waits (the Results take over); the toast on screen fades out. */
export function endToasts(b: Banners): void {
  b.toasts.length = Math.min(b.toasts.length, b.toastT >= 0 ? 1 : 0);
  const shown = b.toasts[0];
  if (shown) b.toastT = Math.max(b.toastT, TOAST_IN + shown.hold);
}

/** A relay's TAG (under its stamp): every toast goes at once and the next tip need not wait out TIP_REST. */
export function clearToasts(b: Banners): void {
  b.toasts.length = 0;
  b.toastT = -1;
  b.tipAt = b.toastClock;
}

export function resetBanners(b: Banners): void {
  b.toasts.length = 0;
  b.toastT = -1;
  b.toastHide = 0;
  b.tipAt = 0;
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
  b.nightText = `Day ${day} survived`;
}

/** The Day card for `day`: its biome, forecast (left out when clear), noon elevation and (v1.6) a rising Noon Heat (×H; 1 none). */
export function showDayCard(b: Banners, day: number, biome: BiomeId, forecast: ForecastId, epsNoon: number, heat = 1): void {
  b.dayHeat = heat > 1 ? `NOON HEAT ×${Math.round(heat * 100) / 100} · 11 AM–1 PM` : '';
  b.day = 0;
  b.dayN = day;
  b.dayText = `DAY ${day}`;
  b.dayBiome = biome;
  const place = biome === 'oldtown' ? 'OLD TOWN' : 'MEADOW';
  const weather = forecast === 'clear' ? '' : ` · ${FORECASTS[forecast].name}`;
  b.dayLine = `${place}${weather} · NOON ${Math.round(epsNoon)}°`;
  b.dayKey = `${biome}|${b.dayText}|${b.dayLine}|${b.dayHeat}`;
}

export function updateBanners(b: Banners, dt: number, lowChill: boolean): void {
  b.toastClock += dt;
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
  const covered = b.stamp >= 0 || b.day >= 0 || b.level >= 0 || b.night >= 0;
  b.toastHide += ((covered ? 1 : 0) - b.toastHide) * Math.min(1, dt * 12);
  if (b.toastT >= 0 && !covered) {
    b.toastT += dt;
    if (b.toastT > TOAST_IN + (b.toasts[0]?.hold ?? 0) + TOAST_OUT) {
      b.toasts.shift();
      b.toastT = -1;
      holdToasts(b, b.tipRest);
    }
  }
  const next = b.toasts[0];
  if (b.toastT < 0 && next && !covered && (next.kind === 'mission' || next.urgent || b.toastClock >= b.tipAt)) {
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

/**
 * Banners and cards, below the HUD band (`top` CSS px); `hc`: high contrast (no bursts, flat faces);
 * `toastTop`: where toasts hang (below the wind chip on a Trial).
 */
export function drawBanners(g: CanvasRenderingContext2D, b: Banners, v: View, top: number, scale: number, reducedMotion: boolean, hc = false, toastTop = top): void {
  const cx = v.vx + v.vw / 2;
  // A toast already showing fades away under a card or stamp that arrives after it (PARRY!, a Day card).
  const toast = b.toastT >= 0 && b.toastHide < 0.99 ? b.toasts[0] : undefined;
  if (toast) drawToast(g, b, toast, v, toastTop, scale, reducedMotion, hc);
  if (b.night >= 0) {
    const t = b.night;
    const a = Math.min(1, t / 0.5, (2.4 - t) / 0.6);
    nightCard(g, b, v, cx, top + 58 * scale, scale, a, hc);
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
    dayCard(g, b, v, x, top + 78 * scale, scale, a, reducedMotion ? 0 : t, hc);
  }
  if (b.stamp >= 0) drawStamp(g, b, v, cx, top + 52 * scale, scale, reducedMotion, hc);
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
    levelCard(g, b, v, x, top, scale, a, t, reducedMotion, hc);
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// Toasts (§9.5)
// ---------------------------------------------------------------------------------------------

/** Kicker ink by look: a mission, a tip, an urgent tip (a warning). */
const KICKER_INK = { mission: TEXT.green, tip: TEXT.amber, warn: TEXT.orange } as const;

/**
 * A toast just under the HUD band, clear of the pause button's column: a cream pill with an icon
 * coin (a white check on green for a mission, the tip's glyph on a cloud coin, gold when urgent), a
 * display-face kicker in its colour and its text (fitToast). Drops in, holds, fades.
 */
function drawToast(g: CanvasRenderingContext2D, b: Banners, t: Toast, v: View, top: number, k: number, reducedMotion: boolean, hc: boolean): void {
  const u = b.toastT;
  const outT = u - TOAST_IN - t.hold;
  let a = Math.min(1, u / TOAST_IN) * (1 - b.toastHide);
  let dy = reducedMotion ? 0 : -14 * (1 - easeOutBack(Math.min(1, u / TOAST_IN)));
  if (outT > 0) {
    const q = Math.min(1, outT / TOAST_OUT);
    a *= 1 - q;
    if (!reducedMotion) dy -= 10 * q;
  }
  if (a <= 0.01) return;
  const [x, w] = toastBox(v.vx, v.vw, v.safe.left, v.safe.right, k);
  const s = b.toastSprite;
  const dpr = spriteDpr(v);
  if (stale(s, dpr, k, hc, w, t) || b.toastWrapW === 0) renderToast(b, t, s, dpr, k, hc, w);
  g.globalAlpha = a;
  blit(g, s, x, top + 4 + dy);
  g.globalAlpha = 1;
}

/**
 * The toast's left edge and width (CSS px) in a column at `vx`, `vw` wide: it hangs under the HUD
 * row's span, from the pause square's column (8 + 48 + 8, clear of the muted coin under it) to the
 * row's right end, centred there once it reaches 360k.
 */
export function toastBox(vx: number, vw: number, safeL: number, safeR: number, k: number): [x: number, w: number] {
  const x0 = vx + safeL + 64;
  const x1 = vx + vw - safeR - 8;
  const w = Math.round(Math.min(x1 - x0, 360 * k));
  return [(x0 + x1 - w) / 2, w];
}

/** What a toast's text looks like once fitted: its lines, face and size (canvas units), and whether it was cut. */
export interface ToastFit {
  lines: string[];
  font: string;
  px: number;
  cut: boolean;
}

/** The text column of a toast `w` wide (CSS px) at HUD scale `k`: right of the icon coin, 14k short of the end. */
export const toastTextW = (w: number, k: number): number => w - (7 + 2 * 15 + 10) * k - 14 * k;

/**
 * Wraps a toast's text (g.font is set here). A mission's line is Lilita 16k, up to three lines. A
 * tip is a sentence the player needs whole: BODY 800 15k on up to four lines, then 14k, then 13k,
 * and only past that its fourth line ends in an ellipsis (tests/unit/toastfit.test.ts keeps every
 * tip clear of that at 320, 360 and 390 px).
 */
export function fitToast(g: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>, text: string, mission: boolean, textW: number, k: number, out: string[] = []): ToastFit {
  const max = mission ? 3 : 4;
  let px = mission ? 16 : 15;
  let font = '';
  for (;;) {
    font = mission ? displayFont(px * k) : bodyFont(px * k, 800);
    g.font = font;
    wrap(g, text, textW, out);
    if (out.length <= max || mission || px <= 13) break;
    px -= 1;
  }
  const cut = out.length > max;
  if (cut) {
    out.length = max;
    out[max - 1] = ellipsize(g, `${(out[max - 1] as string).replace(/[ ,.;:!?]+$/, '')}…`, textW);
  }
  return { lines: out, font, px, cut };
}

function renderToast(b: Banners, t: Toast, s: Sprite, dpr: number, k: number, hc: boolean, w: number): void {
  const mission = t.kind === 'mission';
  const kickFont = displayFont(15 * k);
  const ir = 15 * k;
  const tx = 7 * k + 2 * ir + 10 * k;
  const textW = toastTextW(w, k);
  const fit = fitToast(measureCtx(), t.text, mission, textW, k, b.toastLines);
  const textFont = fit.font;
  b.toastWrapW = textW;
  const lineH = fit.px * (mission ? 19 / 16 : 18.5 / 15) * k;
  const h = Math.max(44 * k, 9 * k + 16 * k + 3 * k + b.toastLines.length * lineH + 8 * k);
  const g = begin(s, dpr, k, hc, w, t, w + 4, h + 6 * k, 2, 1);
  plate(g, 0, 0, w, h, Math.min(22 * k, h / 2), k, hc ? 4 * k : 3 * k);
  // The icon coin.
  const ix = 7 * k + ir;
  const iy = h / 2;
  const face = mission ? FACE.green : t.urgent ? FACE.gold : FACE.cloud;
  coin(g, ix, iy - 1 * k, ir, face, k * 0.85, hc);
  if (t.glyph) {
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(ix, iy - 1 * k, ir - 4 * k, 0, TAU);
    g.fill();
    drawGlyph(g, t.glyph, ix, iy - 1 * k, 17 * k);
  } else check(g, ix, iy - 1 * k, k);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  let ty = 9 * k + 8 * k;
  g.font = kickFont;
  g.fillStyle = mission ? KICKER_INK.mission : t.urgent ? KICKER_INK.warn : KICKER_INK.tip;
  g.fillText(t.kicker, tx, ty, textW);
  ty += 8 * k + 3 * k + lineH / 2;
  g.font = textFont;
  g.fillStyle = INK;
  for (const line of b.toastLines) {
    g.fillText(line, tx, ty);
    ty += lineH;
  }
}

/** A white check mark with an ink outline centred on (x, y). */
function check(g: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let p = 0; p < 2; p++) {
    g.strokeStyle = p === 0 ? INK : '#FFFFFF';
    g.lineWidth = (p === 0 ? 6.5 : 3) * k;
    g.beginPath();
    g.moveTo(x - 6 * k, y + 0.5 * k);
    g.lineTo(x - 1.5 * k, y + 5 * k);
    g.lineTo(x + 6.5 * k, y - 4.5 * k);
    g.stroke();
  }
  g.lineCap = 'butt';
}

let measureC: CanvasRenderingContext2D | null = null;
/** A 1 × 1 context for measuring text before a sprite is sized. */
function measureCtx(): CanvasRenderingContext2D {
  measureC ??= ctx2d(makeCanvas(1, 1));
  return measureC;
}

/** Greedy word wrap of `text` into lines no wider than maxW (g.font set by the caller). */
function wrap(g: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, maxW: number, out: string[]): void {
  out.length = 0;
  if (!text) return;
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

/** `text` cut to fit maxW with an ellipsis (g.font set by the caller). */
function ellipsize(g: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let t = text.replace(/…$/, '');
  while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.replace(/[ ,.;:!?·]+$/, '')}…`;
}

// ---------------------------------------------------------------------------------------------
// The level intro card (§9.7)
// ---------------------------------------------------------------------------------------------

// The card's measured pieces for one width and scale, and the fit it was laid out with (module
// state: the game shows one card at a time; `cOwner` is the Banners it was measured for).
let cOwner: Banners | null = null;
/** Measured for: the words' generation, width, scale, font generation; fitted for: the HUD scale, the column, the room. */
let cGen = -1;
let cW = 0;
let cK = 0;
let cFont = -1;
let cScale = 0;
let cVw = 0;
let cRoom = 0;
let cTitlePx = 0;
let cRibW = 0;
let cConcept = '';
let cConceptW = 0;
const cLines: string[] = [];
let cGoalW = 0;
let cDare = '';
let cDareW = 0;
/** The star wells' labels as fitted (one or two lines each), their font size, and whether any takes two lines. */
const cLabels: string[][] = [[], [], []];
const cLabelPx = [0, 0, 0];
let cTwoLine = false;
let cPillW = 0;
let cPillTW = 0;
/** The fit: blurb lines shown, compact wells, the chips (0 stacked, 1 one row, 2 the goal chip hidden), concept shown; the height. */
let cBlurbN = 0;
let cCompact = false;
let cChips = 0;
let cShowConcept = true;
let cH = 0;

const CARD_INSET = 15;
const CARD_PAD = 14;
const RIBBON_PX = 26;
const RIBBON_BAND = 44;
const PILL_H = 40;
const START_TEXT = 'TAP OR DRAG TO START';
/** The start pill for a keyboard player (the arrows start the run too, steering as they go). */
const START_KEYS = 'PRESS SPACE TO START';
let cKeys = false;
/** The glyph beside each star rule: the goal, a flake, the sun (a cool run). */
const STAR_GLYPHS = ['goal', 'frosty', 'clear'];
/** A star well's label line (12k text): the wells grow by one when a label takes two. */
const WELL_LINE = 13;
/** The drag mark on the start pill (↔), in a 14-unit box. */
let dragP: Path2D | null = null;

/** Measures the card's pieces for width w at scale k (the words' text, wrapped and fitted). */
function measureCard(b: Banners, w: number, k: number): void {
  const g = measureCtx();
  const iw = w - 2 * (CARD_INSET + CARD_PAD) * k;
  cOwner = b;
  cGen = b.levelGen;
  cW = w;
  cK = k;
  cFont = fontGen;
  g.font = displayFont(RIBBON_PX * k);
  cRibW = g.measureText(b.levelKicker).width;
  g.font = displayFont(32 * k);
  const tw = g.measureText(b.levelTitle).width;
  cTitlePx = tw > iw ? Math.max(18 * k, 32 * k * (iw / tw)) : 32 * k;
  cConcept = b.levelConceptName.toUpperCase();
  g.font = displayFont(15 * k);
  cConceptW = Math.min(iw, g.measureText(cConcept).width + (b.levelConcept ? 22 * k : 0) + 26 * k);
  cGoalW = Math.min(iw, g.measureText(b.levelGoal).width + 44 * k);
  cDare = b.levelDare.replace(/^Dare · /, '');
  const dw = g.measureText(cDare).width;
  g.font = displayFont(13 * k);
  // The chip: 6k, the DARE sticker (its word + 12k), 8k, the Dare, 10k.
  cDareW = cDare ? Math.min(iw, dw + g.measureText('DARE').width + 36 * k) : 0;
  g.font = bodyFont(15 * k, 700);
  wrap(g, b.levelBlurb, iw, cLines);
  if (cLines.length > 3) {
    cLines.length = 3;
    cLines[2] = ellipsize(g, `${(cLines[2] as string).replace(/[ ,.;:!?]+$/, '')}…`, iw);
  }
  // A rule's label: one line at 13.5k, else at 12k, else two lines at 12k ("1.3 s snap / shade"),
  // and only a word too long for a whole line ellipsizes.
  const wellW = (iw - 16 * k) / 3 - 8 * k;
  cTwoLine = false;
  for (let i = 0; i < 3; i++) {
    const label = b.levelStars[i] ?? '';
    const out = cLabels[i] as string[];
    let px = 13.5 * k;
    g.font = bodyFont(px, 800);
    if (g.measureText(label).width > wellW) {
      px = 12 * k;
      g.font = bodyFont(px, 800);
    }
    wrap(g, label, wellW, out);
    if (out.length > 2) out[1] = out.slice(1).join(' ');
    out.length = Math.min(out.length, 2);
    for (let j = 0; j < out.length; j++) out[j] = ellipsize(g, out[j] as string, wellW);
    if (out.length > 1) cTwoLine = true;
    cLabelPx[i] = px;
  }
  cKeys = b.levelKeys;
  g.font = displayFont(17 * k);
  cPillTW = g.measureText(cKeys ? START_KEYS : START_TEXT).width;
  cPillW = cPillTW + 64 * k;
}

/**
 * Picks the first fit that keeps the card inside `room` (CSS px), §9.7's ladder: the blurb to two
 * lines, compact wells, the goal and Dare chips in one row (or the goal chip goes), the goal chip
 * gone (the first well says the goal), then, unless `keepBlurb`, no blurb and no concept chip.
 */
function fitCard(b: Banners, k: number, room: number, keepBlurb: boolean, whole = false): boolean {
  const iw = cW - 2 * (CARD_INSET + CARD_PAD) * k;
  const n = cLines.length;
  const dare = cDare !== '';
  const row = !dare ? 0 : cGoalW + 8 * k + cDareW <= iw ? 1 : 2;
  const two = Math.min(2, n);
  const steps = keepBlurb ? 5 : 7;
  for (let step = 0; step < steps; step++) {
    // `whole`: no line of the blurb goes (the ladder skips its first rung).
    if (whole && step === 1) continue;
    cBlurbN = step === 0 || whole ? n : step < 5 ? two : 0;
    cCompact = step >= 2;
    cChips = step >= 4 ? 2 : step === 3 ? row : 0;
    cShowConcept = step < 6;
    let h = (CARD_INSET + RIBBON_BAND / 2 + 8 + 38) * k;
    if (cShowConcept && b.levelConceptName) h += 40 * k;
    if (cBlurbN > 0) h += cBlurbN * 20 * k + 10 * k;
    h += (cChips === 0 && dare ? 68 : cChips === 2 && !dare ? 0 : 34) * k;
    if (b.levelStars.length === 3) h += ((cCompact ? 50 : 64) + (cTwoLine ? WELL_LINE : 0)) * k;
    // The start pill hangs off the bottom edge (its centre on it): 8k clear of what is above it.
    cH = h + (8 + PILL_H / 2) * k;
    if (cH <= room) return true;
  }
  return false;
}

/** The intro card's fit as last sized (the test hook): blurb lines shown of all, the scale, the height. */
export function levelCardFit(): { blurb: number; lines: number; compact: boolean; chips: number; concept: boolean; k: number; h: number } {
  return { blurb: cBlurbN, lines: cLines.length, compact: cCompact, chips: cChips, concept: cShowConcept, k: cK, h: cH };
}

/**
 * Sizes the card for `room`. A teaching level (a concept) keeps its blurb: the card shrinks to .85
 * first, and on a wide column (k above 1, a desktop) on to a phone's size and then .9 of it, before
 * the blurb may go.
 */
function sizeCard(b: Banners, v: View, scale: number, room: number): void {
  const at = (f: number, keepBlurb: boolean, whole = false): boolean => {
    measureCard(b, Math.round(Math.min(v.vw - 32, 352 * scale) * f), scale * f);
    return fitCard(b, scale * f, room, keepBlurb, whole);
  };
  if (b.levelConcept && b.levelBlurb) {
    const fs = [1, 0.9, 0.85, 1 / scale, 0.9 / scale].filter((f) => (f >= 0.85 || scale > 1) && f <= 1);
    // Every teaching card (a Journey concept, a Trial's element) says its whole sentence before a line
    // goes: the card shrinks first (a cut blurb loses the instruction it ends on).
    for (const f of [...fs, 0.8 / Math.max(1, scale)]) if (at(f, true, true)) return;
    for (const f of fs) if (at(f, true)) return;
  }
  // Too tall even at the last fit: the whole card scales down, not below 0.8.
  for (let f = 1; f >= 0.8 - 1e-6; f -= 0.1) if (at(f, false)) return;
}

/**
 * The level intro card: a blue framed panel with a green ribbon ("LEVEL 6") over its top edge, the
 * level's name, the concept chip, the blurb (wrapped, up to 3 lines), the goal and Dare chips, the
 * three star wells and a gold start pill hanging off its bottom edge, breathing.
 */
function levelCard(g: CanvasRenderingContext2D, b: Banners, v: View, cx: number, top: number, scale: number, a: number, t: number, rm: boolean, hc: boolean): void {
  if (a <= 0) return;
  // The card sits between the HUD band (and its ribbon's upper half) and the dial (and the pill's
  // lower half): centred in that space, never over Nubs.
  const dialTop = v.ny - 60 * v.S;
  const lo = top + 8 + (RIBBON_BAND / 2) * scale;
  const hi = dialTop - 8 - (PILL_H / 2) * scale;
  const room = Math.round(hi - lo);
  if (cOwner !== b || cGen !== b.levelGen || cFont !== fontGen || cScale !== scale || cVw !== v.vw || cKeys !== b.levelKeys || Math.abs(cRoom - room) > 2) {
    cScale = scale;
    cVw = v.vw;
    cRoom = room;
    sizeCard(b, v, scale, room);
  }
  const k = cK;
  const h = cH;
  const y = Math.max(lo, Math.min((lo + hi) / 2 - h / 2, hi - h));
  const dpr = spriteDpr(v);
  const fit = cBlurbN * 1000 + (cCompact ? 100 : 0) + cChips * 10 + (cShowConcept ? 1 : 0) + b.levelGen * 10000;
  const cs = b.cardSprite;
  if (stale(cs, dpr, k, hc, cW, fit)) renderCard(b, cs, dpr, k, hc, fit);
  const ps = b.pillSprite;
  if (stale(ps, dpr, k, hc, cPillW, cKeys)) renderPill(ps, dpr, k, hc);
  g.globalAlpha = a;
  blit(g, cs, cx - cW / 2, y);
  // The start pill breathes (static under reduced motion, gone as the card leaves).
  g.globalAlpha = a * (rm || b.levelOut >= 0 ? 1 : 0.875 + 0.125 * Math.sin((t * TAU) / 1.4));
  blit(g, ps, cx, y + h);
  g.globalAlpha = 1;
}

/** Draws the card (frame, ribbon, words, chips, wells) into its sprite, anchored at its top-left. */
function renderCard(b: Banners, s: Sprite, dpr: number, k: number, hc: boolean, fit: number): void {
  const w = cW;
  const h = cH;
  const over = (RIBBON_BAND / 2 + 6) * k;
  const padX = Math.max(4, (cRibW + 104 * (RIBBON_BAND / 52) * k - w) / 2 + 4);
  const g = begin(s, dpr, k, hc, w, fit, w + 2 * padX, h + over + 16 * k, padX, over);
  const cin = panel(g, 0, 0, w, h, 30 * k, FACE.blue, k, hc);
  const iw = w - 2 * (CARD_INSET + CARD_PAD) * k;
  const cx = w / 2;
  ribbon(g, cx, 0, b.levelKicker, cRibW, RIBBON_PX * k, RIBBON.green, hc, RIBBON_BAND * k);
  // Under the ribbon's lower half: the name.
  let y = cin + (RIBBON_BAND / 2 + 8) * k;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = displayFont(cTitlePx);
  g.fillStyle = INK;
  g.fillText(b.levelTitle, cx, y + 19 * k, iw);
  y += 38 * k;
  if (cShowConcept && b.levelConceptName) {
    // The concept chip: a light blue pill with the concept's glyph on a white coin and its name.
    const ch = 32 * k;
    const x = cx - cConceptW / 2;
    const grad = g.createLinearGradient(0, y, 0, y + ch);
    grad.addColorStop(0, '#E9F6FF');
    grad.addColorStop(1, '#BFE6FF');
    chip(g, x, y, cConceptW, ch, ch / 2, hc ? '#D6EEFF' : grad, k);
    let tx = x + 13 * k;
    if (b.levelConcept) {
      chip(g, x + 5 * k, y + 5 * k, 22 * k, 22 * k, 11 * k, '#FFFFFF', k, 2 * k);
      drawGlyph(g, b.levelConcept, x + 16 * k, y + 16 * k, 15 * k);
      tx = x + 35 * k;
    }
    g.textAlign = 'left';
    g.font = displayFont(15 * k);
    g.fillStyle = '#124A86';
    g.fillText(cConcept, tx, y + ch / 2 + 1 * k, x + cConceptW - 12 * k - tx);
    g.textAlign = 'center';
    y += ch + 8 * k;
  }
  if (cBlurbN > 0) {
    g.font = bodyFont(15 * k, 700);
    g.fillStyle = INK_2;
    for (let i = 0; i < cBlurbN; i++) {
      let line = cLines[i] as string;
      if (i === cBlurbN - 1 && cBlurbN < cLines.length) line = ellipsize(g, `${line.replace(/[ ,.;:!?]+$/, '')}…`, iw);
      g.fillText(line, cx, y + 10 * k, iw);
      y += 20 * k;
    }
    y += 10 * k;
  }
  // The goal and Dare chips: stacked, side by side, or the Dare alone (the first well says the goal).
  const dare = cDare !== '';
  if (cChips === 1) {
    const x = cx - (cGoalW + 8 * k + cDareW) / 2;
    wordChip(g, x, y, cGoalW, k, hc, false, b.levelGoal);
    wordChip(g, x + cGoalW + 8 * k, y, cDareW, k, hc, true, cDare);
    y += 34 * k;
  } else {
    if (cChips === 0) {
      wordChip(g, cx - cGoalW / 2, y, cGoalW, k, hc, false, b.levelGoal);
      y += 34 * k;
    }
    if (dare) {
      wordChip(g, cx - cDareW / 2, y, cDareW, k, hc, true, cDare);
      y += 34 * k;
    }
  }
  if (b.levelStars.length === 3) starWells(g, b, cx - iw / 2, y + 4 * k, iw, k, dpr);
}

/**
 * A goal or Dare chip: a tinted pill, then the goal ring (a goal) or a pink DARE sticker (a Dare),
 * then the words in the display face.
 */
function wordChip(g: CanvasRenderingContext2D, x: number, y: number, w: number, k: number, hc: boolean, dare: boolean, text: string): void {
  const h = 28 * k;
  chip(g, x, y, w, h, h / 2, dare ? '#FFF1C9' : '#E5F8D8', k, hc ? 3 * k : 2.5 * k);
  g.textBaseline = 'middle';
  let tx = x + 33 * k;
  if (dare) {
    g.font = displayFont(13 * k);
    const sw = g.measureText('DARE').width + 12 * k;
    g.save();
    g.translate(x + 6 * k + sw / 2, y + h / 2);
    g.rotate(-4 * DEG);
    chip(g, -sw / 2, -9.5 * k, sw, 19 * k, 6 * k, '#B8285A', k, 2 * k);
    g.fillStyle = '#FFFFFF';
    g.textAlign = 'center';
    g.fillText('DARE', 0, 1 * k);
    g.restore();
    tx = x + 14 * k + sw;
  } else drawGlyph(g, 'goal', x + 19 * k, y + h / 2, 14 * k);
  g.textAlign = 'left';
  g.font = displayFont(15 * k);
  g.fillStyle = dare ? TEXT.brown : TEXT.green;
  g.fillText(text, tx, y + h / 2 + 1 * k, x + w - 10 * k - tx);
  g.textAlign = 'center';
}

/** The three star wells: a gold star at the top, the rule's glyph at its lower right, the rule's label. */
function starWells(g: CanvasRenderingContext2D, b: Banners, x0: number, y: number, w: number, k: number, dpr: number): void {
  const gap = 8 * k;
  const ww = (w - 2 * gap) / 3;
  const h = ((cCompact ? 46 : 60) + (cTwoLine ? WELL_LINE : 0)) * k;
  const sp = Math.round((cCompact ? 22 : 28) * k);
  const star = starSprite(sp, dpr, 'on');
  for (let i = 0; i < 3; i++) {
    const x = x0 + i * (ww + gap);
    well(g, x, y, ww, h, 14 * k, k);
    const scx = x + ww / 2;
    const sy = y + (cCompact ? 4 : 6) * k;
    g.drawImage(star, scx - sp / 2 - 2, sy - 2, sp + 4, sp + 4);
    if (!cCompact) {
      const gx = scx + sp * 0.5;
      const gy = sy + sp * 0.78;
      chip(g, gx - 9 * k, gy - 9 * k, 18 * k, 18 * k, 9 * k, '#FFFFFF', 0, 1.5 * k);
      drawGlyph(g, (i === 1 && b.levelDareGlyph) || (STAR_GLYPHS[i] as string), gx, gy, 13 * k);
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = bodyFont(cLabelPx[i] as number, 800);
    g.fillStyle = INK;
    const lines = cLabels[i] as string[];
    for (let j = 0; j < lines.length; j++) g.fillText(lines[j] as string, scx, y + h - (11 + (lines.length - 1 - j) * WELL_LINE) * k);
  }
}

/** The start pill: a gold candy pill with a white drag coin (↔) and "TAP OR DRAG TO START", anchored at its centre. */
function renderPill(s: Sprite, dpr: number, k: number, hc: boolean): void {
  const w = cPillW;
  const h = PILL_H * k;
  const g = begin(s, dpr, k, hc, w, cKeys, w + 8, h + 10 * k, w / 2 + 4, h / 2 + 2);
  candyRect(g, -w / 2, -h / 2, w, h, h / 2, FACE.gold, k, { lip: 5 * k, drop: 4 * k, flat: hc });
  // The coin and the words centred together.
  const ccx = -(30 * k + cPillTW) / 2 + 12 * k;
  chip(g, ccx - 12 * k, -13 * k, 24 * k, 24 * k, 12 * k, '#FFFFFF', 0);
  g.save();
  g.translate(ccx, -1 * k);
  g.scale(k, k);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 2.4;
  g.stroke((dragP ??= new Path2D('M-6 0H6M-3-3.5L-6.5 0L-3 3.5M3-3.5L6.5 0L3 3.5')));
  g.restore();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  outlined(g, cKeys ? START_KEYS : START_TEXT, ccx + 18 * k + cPillTW / 2, -1.5 * k, 17 * k);
}

// ---------------------------------------------------------------------------------------------
// Stamps (§9.6)
// ---------------------------------------------------------------------------------------------

/** The stamp plate on its burst, fitted to the column, slammed in and tilted. */
function drawStamp(g: CanvasRenderingContext2D, b: Banners, v: View, cx: number, y: number, k: number, reducedMotion: boolean, hc: boolean): void {
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
  const maxW = Math.round(v.vw - 24);
  const sp = b.stampSprite;
  const dpr = spriteDpr(v);
  const id = b.stampId;
  if (stale(sp, dpr, k, hc, maxW, id)) renderStamp(b, sp, dpr, k, hc, maxW, id);
  g.save();
  g.globalAlpha = a;
  g.translate(cx, y + rise);
  g.rotate(-5 * DEG);
  g.scale(s, s);
  blit(g, sp, 0, 0);
  g.restore();
  // The level's stars under the plate, popping in one by one (earned gold, missed sockets).
  if (b.stampStars < 0) return;
  const r = 15 * k;
  const ss = Math.round(30 * k);
  for (let i = 0; i < 3; i++) {
    const u = reducedMotion ? 1 : Math.min(1, Math.max(0, (t - STAMP_IN - 0.1 - 0.16 * i) / 0.24));
    if (u <= 0) continue;
    const e = reducedMotion ? 1 : easeOutBack(u);
    const on = i < b.stampStars;
    const st = starSprite(ss, dpr, on ? 'on' : 'off');
    const d = (ss + 4) * e;
    g.globalAlpha = a;
    g.drawImage(st, cx + (i - 1) * 2.4 * r - d / 2, y + rise + b.stampHalfH + 14 * k + r - d / 2, d, d);
  }
  g.globalAlpha = 1;
}

function renderStamp(b: Banners, sp: Sprite, dpr: number, k: number, hc: boolean, maxW: number, id: string): void {
  const [face0, burstFill] = STAMP_LOOK[b.stampKind];
  const face = b.stampFace ?? face0;
  const pad = 20 * k;
  const mg = measureCtx();
  // Fit once per stamp: too wide shrinks the type (the plate and its burst keep their padding).
  let size = 40 * k;
  mg.font = displayFont(size);
  let tw = mg.measureText(b.stampText).width;
  const room = maxW - 2 * pad - (burstFill && !hc ? 30 * k : 0);
  if (tw > room) {
    size *= room / tw;
    tw = room;
  }
  const lip = 6 * k;
  const w = tw + 2 * pad;
  // The finish plate is taller: its checkered bands run along the top and bottom edges.
  const h = size * 1.25 + lip + (b.stampKind === 'finish' ? 14 : 6) * k;
  b.stampHalfH = h / 2;
  const burstOn = burstFill !== '' && !hc;
  const rx = w / 2 + 18 * k;
  const ry = h / 2 + 22 * k;
  const hw = (burstOn ? rx : w / 2) + 8 * k;
  const hh = (burstOn ? ry : h / 2) + 10 * k;
  const g = begin(sp, dpr, k, hc, maxW, id, hw * 2, hh * 2, hw, hh);
  if (burstOn) burst(g, 0, 0, rx, ry, burstFill, k, 14, 0.2);
  candyRect(g, -w / 2, -h / 2, w, h, 18 * k, face, k, { lip, drop: 5 * k, line: 4 * k, flat: hc });
  if (b.stampKind === 'finish') {
    // Checkered bands along the top and bottom edges: the finish flag.
    const sq = Math.max(4, Math.round(7 * k));
    g.save();
    g.beginPath();
    g.roundRect(-w / 2 + 2 * k, -h / 2 + 2 * k, w - 4 * k, h - 4 * k - lip, 15 * k);
    g.clip();
    g.fillStyle = INK;
    for (let x = -w / 2, i = 0; x < w / 2; x += sq, i++) {
      if (i % 2 === 0) g.fillRect(x, -h / 2 + 2 * k, sq, sq);
      else g.fillRect(x, h / 2 - lip - 2 * k - sq, sq, sq);
    }
    g.restore();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  outlined(g, b.stampText, 0, -lip / 2 + size * 0.02, size, '#FFFFFF', undefined, (8 * k) / size);
}

// ---------------------------------------------------------------------------------------------
// Day and night cards (§9.8)
// ---------------------------------------------------------------------------------------------

function nightCard(g: CanvasRenderingContext2D, b: Banners, v: View, cx: number, y: number, k: number, a: number, hc: boolean): void {
  if (a <= 0) return;
  const s = b.nightSprite;
  const dpr = spriteDpr(v);
  if (stale(s, dpr, k, hc, 0, b.nightText)) ribbonCard(s, dpr, k, hc, b.nightText, 'NIGHT', 26, 42, RIBBON.violet, b.nightText, null, '');
  g.globalAlpha = a;
  blit(g, s, cx, y);
}

/** The Day card at (cx, y); `t` turns the rays (0 holds them still). */
function dayCard(g: CanvasRenderingContext2D, b: Banners, v: View, cx: number, y: number, k: number, a: number, t: number, hc: boolean): void {
  if (a <= 0) return;
  const s = b.daySprite;
  const dpr = spriteDpr(v);
  if (stale(s, dpr, k, hc, 0, b.dayKey)) ribbonCard(s, dpr, k, hc, b.dayKey, b.dayText, 34, 56, b.dayBiome === 'oldtown' ? RIBBON.red : RIBBON.green, b.dayLine, b.dayBiome, b.dayHeat);
  // Five warm-white rays behind the card, turning at 6 deg/s and fading out toward their tips.
  const len = Math.round(s.cw * 0.62);
  if (!hc) {
    if (b.rayLen !== len || !b.rayFill) {
      const f = g.createRadialGradient(0, 0, 0, 0, 0, len);
      f.addColorStop(0, 'rgba(255,250,232,0.95)');
      f.addColorStop(0.55, 'rgba(255,246,220,0.7)');
      f.addColorStop(1, 'rgba(255,246,220,0)');
      b.rayFill = f;
      b.rayLen = len;
    }
    g.save();
    g.translate(cx, y);
    g.globalAlpha = a * 0.55;
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
  }
  g.globalAlpha = a;
  blit(g, s, cx, y);
}

/**
 * A Day or Night card's sprite, anchored at its centre: a ribbon (`title` in the display face of
 * `px`k, band `bh`k) over a plate holding `line` behind `glyph` (null: the crescent) and, when
 * given, `line2` in orange under it (Noon Heat).
 */
function ribbonCard(s: Sprite, dpr: number, k: number, hc: boolean, key: string, title: string, px: number, bh: number, tone: RibbonTone, line: string, glyph: string | null, line2: string): void {
  const mg = measureCtx();
  mg.font = displayFont(px * k);
  const ribW = mg.measureText(title).width;
  mg.font = displayFont(15 * k);
  const lineW = mg.measureText(line).width;
  mg.font = displayFont(13 * k);
  const l2W = line2 ? mg.measureText(line2).width : 0;
  const icon = 16 * k;
  const pw = Math.max(lineW + icon + 6 * k, l2W) + 36 * k;
  const l2H = line2 ? 18 * k : 0;
  const ph = 36 * k + l2H;
  const band = bh * k;
  const half = Math.max(pw, ribW + 104 * (band / 52)) / 2 + 8;
  // The ribbon's centre, so the ribbon and the plate under it are centred on the anchor together.
  const top = -ph / 2;
  const g = begin(s, dpr, k, hc, 0, key, half * 2, band + ph + 20 * k, half, -top + band / 2 + 4 * k);
  const py = top + band / 2 - 8 * k;
  plate(g, -pw / 2, py, pw, ph + 8 * k, 16 * k, k, hc ? 4 * k : 3 * k);
  const ly = py + 28 * k;
  const lx = -(icon + 6 * k + lineW) / 2;
  if (glyph) drawGlyph(g, glyph, lx + icon / 2, ly, icon);
  else {
    const m = icon / 2;
    g.fillStyle = '#4B3F8F';
    g.beginPath();
    g.arc(lx + m, ly, m, 0, TAU);
    g.arc(lx + m * 1.55, ly - m * 0.35, m * 0.85, 0, TAU, true);
    g.fill('evenodd');
  }
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = displayFont(15 * k);
  g.fillStyle = INK;
  g.fillText(line, lx + icon + 6 * k, ly + 1 * k);
  if (line2) {
    g.textAlign = 'center';
    g.font = displayFont(13 * k);
    g.fillStyle = TEXT.orange;
    g.fillText(line2, 0, ly + l2H + 1 * k);
  }
  ribbon(g, 0, top, title, ribW, px * k, tone, hc, band);
}
