// The Elementals' art (docs/ELEMENTALS_V2.md §7.10): Ember (a flame), Sprout (a seedling), Drip (a
// water droplet) and Gust (a kite spirit), each a CharArt for Nubs' two-layer sprite cache (nubs.ts).
// An element is a state function, a palette per state and art strings (glyphs.ts ops in units of
// U = S·1.4 from the ground point, '$n' its state's colour n) for the back and front layers, with a
// shared face; the layers redraw only when the quantized state in their key changes, and the
// spring-chain parts between them are the only live drawing (a fill and at most two strokes). The
// states (the pose's act and lean come from s.el, render/renderer.ts heroPose):
//   Ember  calm / snuffing out of the light (smaller, dull red) / feasting in full light (20 %
//          taller, white-hot) / guttering (low) / doused (in a puddle or rain: dull, steaming);
//          snuffed, it sinks to a sleepy ember (doused: a grey one under its steam).
//   Sprout calm / holding (leaves up like arms, joyful) / low Sap (drooping, pale); wilts flat.
//   Drip   a clear blue droplet scaled 0.85 + 0.25·size (the contacts keep a fixed radius), leaning
//          the way it slides, bulging as it drinks, flashing orange on a hot stone, worried when
//          low; it dries away (or sizzles away) into the air.
//   Gust   a diamond kite on its spars in the cloud face's colours, a ribbon tail on the springs,
//          leaning with the wind and bobbing on the air; soaked (dark, dripping), fogged
//          (squinting, grey), low (sagging); grounded, it falls flat on the trail.
// A fall into a gap or a stream sweeping the walker away is drawn by the renderer on the living
// sprite. Also the Elementals screen's preview, the death beat's tokens, the Tag Stones and the
// relay's NEXT chip (with its SUN HOLDS badge into Drip or Gust).

import { HEROES, type HeroId } from '../core/index.ts';
import type { Equipped } from '../meta/content.ts';
import { chip, displayFont, FACE, INK as INK_C, outlined } from './candy.ts';
import { artOps, drawArt, drawGlyph, type ArtOp } from './glyphs.ts';
import { createNubsAnim, createPose, HAT_BASE_X, HAT_BASE_Y, NUBS_SCALE, renderWardrobePreview, updateNubsAnim, type CharArt, type Motion, type NubsAnim, type NubsPose } from './nubs.ts';
import { ctx2d, type Canvas2D } from './sprites.ts';

const parsed = new Map<string, ArtOp[]>();

/** Draws an art string ('@' and '$0' are pal[0]) in the current transform (`flat`: high contrast, no shines). */
export function art(g: CanvasRenderingContext2D, src: string, pal: readonly string[], flat = false): void {
  if (!src) return;
  let ops = parsed.get(src);
  if (!ops) parsed.set(src, (ops = artOps(src)));
  drawArt(g, ops, pal[0], pal, flat);
}

/** Eyes (open with a glint, a blink, joy's ^ ^ with cheeks) and mouths with their brows (calm, worried, joy), in U from the eye line. */
const EYES = ['F@ O-2.8 0 1.1,1.3O2.8 0 1.1,1.3|F#FFF O-2.45-.45 .4O3.15-.45 .4', 'S@/1.15 M-3.9 0h2.2M1.7 0h2.2', 'S@/1.15 M-4 .4A1.2 1.2 0 0 1-1.6 .4M1.6 .4A1.2 1.2 0 0 1 4 .4|F#F784 O-4.3 1.8 1.3,.75O4.3 1.8 1.3,.75'];
const MOUTHS = ['S@/1.15 M-1.1 2.3Q0 3.1 1.1 2.3', 'F@ O0 2.9 .8,1|S@/1.15 M-1.6-2.8L-3.8-2.1M1.6-2.8L3.8-2.1', 'S@/1.2 M-1.5 2Q0 3.6 1.5 2'];
/** Closed eyes (a fallen hero, in its death palette's ink '$2'). */
const SLEEP = 'S$2/1.1 M-3.9 0A1.1 1.1 0 0 0-1.7 0M1.7 0A1.1 1.1 0 0 0 3.9 0';
/** The face's one-colour palette (refilled per draw: no allocation). */
const INK = [''];

/**
 * An element's face at eye line y (U), looking along the pose's look, its mood 0 calm, 1 worried, 2
 * joy (a happy hop or a PHEW makes it joy).
 */
function face(g: CanvasRenderingContext2D, p: NubsPose, a: NubsAnim, y: number, mood: number, ink: string): void {
  const U = p.S * NUBS_SCALE;
  const m = a.happy > 0 || a.phew > 0 ? 2 : mood;
  const pal = INK;
  INK[0] = ink;
  g.save();
  g.translate(p.lookX * 1.1 * U, (y + p.lookY * 0.8) * U);
  g.scale(U, U);
  // Mood 3 squints (Gust lost in fog): closed eyes, a worried mouth.
  art(g, EYES[a.blink > 0 || m === 3 ? 1 : m === 2 ? 2 : 0] as string, pal, p.hc);
  art(g, MOUTHS[m === 3 ? 1 : m] as string, pal);
  g.restore();
}

/** easeInOut 0..1 of a death `melt` seconds in (0.6 s). */
function deathT(p: NubsPose): number {
  const t = Math.min(1, p.melt / 0.6);
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

/**
 * A tapered blade along tail t's springs from (x0, y0), their offsets scaled by (sx, sy), `w` wide
 * (U; added to the current path): Ember's tongues, Sprout's leaves and Drip's splashes.
 */
function blade(g: CanvasRenderingContext2D, a: NubsAnim, t: number, U: number, x0: number, y0: number, sx: number, sy: number, w: number): void {
  const o = t * 6;
  const tx = x0 + (a.tail[o + 4] as number) * sx;
  const ty = y0 + (a.tail[o + 5] as number) * sy;
  const mx = x0 + (a.tail[o + 2] as number) * sx;
  const my = y0 + (a.tail[o + 3] as number) * sy;
  const l = Math.hypot(tx - x0, ty - y0) || 1;
  const nx = ((y0 - ty) / l) * w;
  const ny = ((tx - x0) / l) * w;
  g.moveTo((x0 - nx * 0.5) * U, (y0 - ny * 0.5) * U);
  g.quadraticCurveTo((mx - nx) * U, (my - ny) * U, tx * U, ty * U);
  g.quadraticCurveTo((mx + nx) * U, (my + ny) * U, (x0 + nx * 0.5) * U, (y0 + ny * 0.5) * U);
  g.closePath();
}

/**
 * A hero: its state from the pose, and per state its palette, layers, face and live parts. Palettes
 * read '$0' its body, '$1' its line, and its face's ink last.
 */
type Death = readonly [string, string, number, number, number, number, number, string];

interface Def {
  st(p: NubsPose, a: NubsAnim): number;
  /** Per state: its colours, comma-joined. */
  pal: readonly string[];
  /** Per state: the face's mood (digits: 0 calm, 1 worried, 2 joy) and the layers' vertical scale. */
  mood: string;
  k: readonly number[];
  back: readonly string[];
  front: readonly string[];
  /** The face's eye line (U). */
  eye: number;
  /**
   * Per state, the two live blades on the springs (null: none): [x (±), y, spring x scale, spring y
   * scale, width, fill's palette slot, line width].
   */
  bl: readonly (readonly number[] | null)[];
  /** A fallen element (drawn whole each frame): [its back layer, palette (ink third), end scale x, y, end alpha, rise (U), eye line, art over it]. */
  die: Death;
  /** Another fall for these causes (space-separated): doused, soaked, sizzled. */
  alt?: readonly [string, Death];
  motion?(p: NubsPose, a: NubsAnim, m: Motion, st: number): void;
}

const pals = new Map<string, readonly string[]>();
function palOf(src: string): readonly string[] {
  let p = pals.get(src);
  if (!p) pals.set(src, (p = src.split(',')));
  return p;
}


/** One layer of `d` at the pose's state (the face on the front layer). */
function layer(g: CanvasRenderingContext2D, d: Def, p: NubsPose, a: NubsAnim, front: boolean): void {
  const st = d.st(p, a);
  const pal = palOf(d.pal[st] as string);
  const U = p.S * NUBS_SCALE;
  const k = d.k[st] as number;
  g.save();
  g.scale(U * Math.min(1, k), U * k);
  art(g, (front ? d.front : d.back)[st] as string, pal, p.hc);
  g.restore();
  // A small flame (Ember guttering) carries its face down with it.
  if (front) face(g, p, a, d.eye * (k < 0.6 ? 0.6 : 1), +(d.mood[st] as string), pal[pal.length - 1] as string);
}

function make(d: Def): CharArt {
  return {
    key(p, a) {
      // The look in 16 directions (the eyes move a little), quantized in place.
      const q = ((Math.round((Math.atan2(p.lookY, p.lookX) * 8) / Math.PI) % 16) + 16) % 16;
      p.lookX = Math.cos((q * Math.PI) / 8);
      p.lookY = Math.sin((q * Math.PI) / 8);
      return (((d.st(p, a) * 16 + q) * 2 + (a.blink > 0 ? 1 : 0)) * 2 + (a.happy > 0 || a.phew > 0 ? 1 : 0)) * 2 + (p.hc ? 1 : 0);
    },
    back: (g, p, a) => layer(g, d, p, a, false),
    front: (g, p, a) => layer(g, d, p, a, true),
    live(g, p, a) {
      const st = d.st(p, a);
      const b = d.bl[st];
      const U = p.S * NUBS_SCALE;
      const pal = palOf(d.pal[st] as string);
      if (!b) return;
      g.beginPath();
      blade(g, a, 0, U, -(b[0] as number), b[1] as number, b[2] as number, b[3] as number, b[4] as number);
      blade(g, a, 1, U, b[0] as number, b[1] as number, b[2] as number, b[3] as number, b[4] as number);
      g.fillStyle = pal[b[5] as number] as string;
      g.fill();
      g.lineWidth = (b[6] as number) * U;
      g.strokeStyle = pal[1] as string;
      g.stroke();
    },
    motion(p, a, m) {
      d.motion?.(p, a, m, d.st(p, a));
    },
    death(g, p) {
      // It shrinks (or flattens), fades or rises, then dozes off.
      const [body, pal, sx, sy, fade, rise, eye, over] = d.alt && p.cause && d.alt[0].includes(p.cause) ? d.alt[1] : d.die;
      const U = p.S * NUBS_SCALE;
      const e = deathT(p);
      const ky = 1 + (sy - 1) * e;
      g.save();
      g.translate(p.x, p.y - rise * U * e);
      g.globalAlpha = 1 + (fade - 1) * e;
      g.save();
      g.scale(U * (1 + (sx - 1) * e), U * ky);
      art(g, body, palOf(pal));
      g.restore();
      g.scale(U, U);
      art(g, over, INK);
      const ks = over ? 1 : Math.min(1, ky);
      g.translate(0, eye * ks);
      g.scale(ks, ks);
      art(g, SLEEP, palOf(pal));
      g.restore();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The elements. Shapes in U from the ground point (y up is negative).
// ---------------------------------------------------------------------------------------------

/** Ember: 0 calm, 1 snuffing (out of the light), 2 feasting (full light), 3 guttering (low), 4 doused (in water: steaming). */
const FLAME = 'P$0/$1/1.1 M0-34.6C2.6-24.2 9.5-18.1 8.6-8.6A8.6 8.6 0 0 1-8.6-8.6C-9.9-14.6-9-19.5-6.9-24.7Q-1.7-22.9 0-34.6Z';
const CORE = 'F$2 M0-21.3C1.6-15.2 5.9-12.1 5.3-6.2A5.3 5.3 0 0 1-5.3-6.2C-6.1-9.9-5.6-12.5-4.3-15.5Q-1.1-14.5 0-21.3Z|F#FFF8 O-4.3-11.2 1.4,2.4';
const HOT = `${CORE}|F#FFFD O0-6.9 2.8,3.6`;
/** Steam puffs rising off a doused flame. */
const STEAM = 'F#FFFE O-7-37 3.4O-1-41 4.2O6-36 3|F#FFF9 O-4-45 2.6O4-44 2.2';
const TONGUES = [6.8, -11.2, 1.4, -1.05, 2.4, 0, 0.8];
const EMBER = make({
  st: (p) => (p.chill < 0.3 ? 3 : p.act ? 4 : !p.safe ? 1 : p.c >= 5 ? 2 : 0),
  pal: ['#F71,#821,#FD4,#410', '#C42,#821,#F95,#410', '#F92,#821,#FFE,#410', '#D52,#821,#FB4,#FC7', '#B66,#634,#DBA,#410'],
  mood: '01211',
  // Feasting stands 20 % taller; guttering is a small dull flame; doused hunches.
  k: [1, 1, 1.2, 0.55, 0.85],
  back: [FLAME, FLAME, FLAME, FLAME, FLAME],
  front: [CORE, CORE, HOT, '', `${CORE}|${STEAM}`],
  eye: -7.4,
  bl: [TONGUES, TONGUES, TONGUES, null, null],
  // Snuffed: the flame sinks to nothing, dozing off; doused or swept: a grey ember under its steam.
  die: [FLAME, '#C42,#821,#FC7', 0.2, 0.2, 1, 0, -4.4, ''],
  alt: ['douse rain swept', [FLAME, '#999,#555,#FFF', 0.35, 0.3, 1, 0, -4.4, 'F#FFFD O-5-15 3O1-19 3.6O6-14 2.6']],
  motion(_p, _a, m, st) {
    // Snuffing: 15 % smaller.
    if (st === 1) {
      m.sx *= 0.85;
      m.sy *= 0.85;
    }
  },
});

/** Sprout: 0 calm, 1 holding (leaves up like arms, joyful), 2 low Sap (drooping, pale). */
const BULB = 'P$0/$1/1.1 O0-9.6 9,9.6|P#A74/#532/.8 O-3.8-.2 2.5,1.4O3.8-.2 2.5,1.4|F#FFF6 O0-6.4 5,3.6|S#383/1.6 M0-18.4V-22.4';
const BUD = 'P$2/$1/.7 M0-26.2Q2.2-23.2 0-22.2Q-2.2-23.2 0-26.2';
/** Its leaves per state: up and out when calm, raised high while it pours, limp when low. */
const leaves = (sx: number, sy: number): readonly number[] => [0, -21, sx, sy, 3.4, 3, 0.75];
const SPROUT = make({
  st: (p) => (p.act ? 1 : p.meter < 0.25 ? 2 : 0),
  pal: ['#9D5,#362,#7C4,#6B4,#232', '#AE6,#362,#FC4,#7D4,#232', '#CC8,#542,#984,#AA6,#232'],
  mood: '021',
  k: [1, 1.05, 0.94],
  back: [BULB, BULB, BULB],
  front: [BUD, 'F#FBC O0-25.5 1.35O1.8-24.2 1.35O1.1-22.1 1.35O-1.1-22.1 1.35O-1.8-24.2 1.35|F#FC4 O0-23.6 1.2', BUD],
  eye: -10.4,
  bl: [leaves(2.4, -0.6), leaves(1.6, -1.6), leaves(1.4, 0.45)],
  // Wilted: the bulb sags flat and brown.
  die: [BULB, '#A95,#542,#232', 1.2, 0.65, 1, 0, -9.6, ''],
});

/** Drip: 0 a clear blue droplet, 1 sizzling (a hot stone's flash), 2 low (worried, pale). */
const DROP = 'P$0/$1/1.1 M0-32C3.1-21.6 9.5-15.8 9-9A9 9 0 0 1-9-9C-9.5-15.8-3.1-21.6 0-32Z';
const SHINE = 'F#FFFD O-4-12.5 1.5,3O-2.4-18.2 .8';
const SPLASH = [9, -5, 0.8, -0.6, 1.6, 0, 0.6];
const DRIP = make({
  st: (p, a) => (a.glare > 0 ? 1 : p.meter < 0.3 ? 2 : 0),
  pal: ['#6CF,#15A,#135', '#FB8,#C42,#410', '#9CE,#48A,#135'],
  mood: '011',
  k: [1, 1, 1],
  back: [DROP, DROP, DROP],
  front: [SHINE, SHINE, SHINE],
  eye: -8.6,
  bl: [SPLASH, SPLASH, SPLASH],
  // Dried away: rising and thinning into the steam (no puddle); sizzled: the same, scorched.
  die: [DROP, '#6CF,#15A,#135', 0.5, 0.5, 0, 10, -8.6, ''],
  alt: ['sizzle', [DROP, '#FB8,#C42,#410', 0.4, 0.4, 0, 12, -8.6, '']],
  motion(p, a, m) {
    // Its size scales the drawing (the contacts keep a fixed radius); it leans the way it slides and
    // bulges for a moment when it drinks; jelly: a squash out of step with the walk.
    const k = 0.85 + 0.25 * p.meter;
    m.sx *= k * (a.happy > 0 ? 1.12 : 1);
    m.sy *= k * (a.happy > 0 ? 0.92 : 1);
    m.rot += 0.22 * p.lean;
    if (!p.walking || p.reducedMotion) return;
    const j = 0.05 * Math.sin(a.walkPhase * 2);
    m.sx *= 1 + j;
    m.sy *= 1 - j;
  },
});

/**
 * Gust: a kite spirit (a diamond on its spars in the cloud face's colours, a ribbon tail on the
 * springs) floating over the trail. 0 calm, 1 soaked (dark, dripping), 2 fogged (squinting, grey),
 * 3 low (sagging).
 */
const KITE = 'P$0/$1/1.6 M0-43L12.5-29L0-14L-12.5-29Z|F#FFF8 M0-43L-12.5-29L0-29Z|F$3 M0-14L12.5-29L0-29Z|S$1/.8 M0-42V-15M-11.5-29H11.5|F#F9B7 O-6.4-24.6 1.8,1.1O6.4-24.6 1.8,1.1';
const RIBBON = [1, -14.5, 1.3, 1.4, 2, 4, 0.7];
const GUST = make({
  st: (p) => (p.act === 1 ? 1 : p.act === 2 ? 2 : p.meter < 0.3 ? 3 : 0),
  // Body, line, (the fallen kite's ink), shade facet, ribbon, face ink.
  pal: ['#F4F1FB,#6A5A9C,#000,#DCD5EC,#FF9EB0,#2B2140', '#B7C1D6,#4E5A7A,#000,#97A3BC,#8FA0C8,#1E2434', '#E2E2E8,#8A8A9A,#000,#C8C8D2,#C9B8C0,#2B2140', '#E8E2F2,#7E6FA8,#000,#CFC6E2,#E89AAA,#2B2140'],
  mood: '0131',
  k: [1, 0.95, 1, 0.9],
  back: [KITE, KITE, KITE, KITE],
  front: ['', 'F#7FB8FF O-8-12 1.4,2.2O3-9 1.4,2.2O9-14 1.2,2', '', ''],
  eye: -28,
  bl: [RIBBON, RIBBON, RIBBON, RIBBON],
  // Grounded: the kite falls flat on the trail (soaked: dark).
  die: [KITE, '#E8E2F2,#7E6FA8,#2B2140,#CFC6E2', 1.25, 0.22, 1, 0, -7, ''],
  alt: ['soak', [KITE, '#9AA6C0,#4E5A7A,#1E2434,#7A86A0', 1.25, 0.22, 1, 0, -7, '']],
  motion(p, _a, m) {
    // It leans with the wind and bobs on the air (still under reduced motion).
    m.rot += 0.3 * p.lean;
    if (!p.reducedMotion) m.dy += 1.5 * p.S * Math.sin(p.time * 3);
  },
});

const ARTS: Readonly<Record<HeroId, CharArt | null>> = { nubs: null, ember: EMBER, drip: DRIP, sprout: SPROUT, gust: GUST };

/** The art of `hero` for the sprite cache (null: Nubs' own). */
export function heroArt(hero: HeroId): CharArt | null {
  return ARTS[hero];
}

// ---------------------------------------------------------------------------------------------
// Around the sprites (the renderer draws these each frame)
// ---------------------------------------------------------------------------------------------

let nextText = '';
let nextKey = '';

/**
 * A relay's telegraph chip, "NEXT ▸ EMBER 3", counting whole seconds down on the incoming hero's face
 * colour; into Drip or Gust a "SUN HOLDS" badge with the padlock sits beyond it (`side` +1 below the
 * dial, −1 above).
 */
export function drawNextChip(g: CanvasRenderingContext2D, hero: HeroId, ticks: number, cx: number, y: number, k: number, side = 1): void {
  const sec = Math.max(1, Math.ceil(ticks / 60));
  if (nextKey !== hero + sec) {
    nextKey = hero + sec;
    nextText = `NEXT ▸ ${HEROES[hero].name.toUpperCase()} ${sec}`;
  }
  g.font = displayFont(15 * k);
  const w = g.measureText(nextText).width + 22 * k;
  chip(g, cx - w / 2, y - 13 * k, w, 26 * k, 13 * k, FACE[HEROES[hero].face][1], k);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  outlined(g, nextText, cx, y, 15 * k);
  if (!HEROES[hero].sunHeld) return;
  const by = y + side * 27 * k;
  g.font = displayFont(13 * k);
  const bw = g.measureText('SUN HOLDS').width + 34 * k;
  chip(g, cx - bw / 2, by - 11 * k, bw, 22 * k, 11 * k, INK_C, k);
  drawGlyph(g, 'lock', cx - bw / 2 + 13 * k, by, 13 * k, '#FFC23D');
  g.textAlign = 'center';
  outlined(g, 'SUN HOLDS', cx + 8 * k, by, 13 * k);
}

/** The token that pops off a fallen element (its glyph: a spark of flame, a leaf, a drop), placed as nubs.ts renderHatSprite places the hat. */
export function renderTokenSprite(c: Canvas2D, hero: HeroId, pxPerU: number): void {
  c.width = c.height = Math.ceil(30 * pxPerU);
  drawGlyph(ctx2d(c), hero, HAT_BASE_X * pxPerU, (HAT_BASE_Y - 6) * pxPerU, 12 * pxPerU);
}

/** Draws an element idling (Nubs with the equipped cosmetics), for the Elementals screen's stage and tiles. */
export function renderHeroPreview(canvas: HTMLCanvasElement, hero: HeroId, equipped: Equipped): void {
  const h = ARTS[hero];
  if (!h) {
    renderWardrobePreview(canvas, equipped);
    return;
  }
  const g = ctx2d(canvas);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  const p = createPose();
  Object.assign(p, { S: canvas.height / 64, c: 3, meter: 0.5, lookX: 0.55, lookY: 0.35, reducedMotion: true });
  const a = createNubsAnim();
  a.happy = 1;
  for (let i = 0; i < 30; i++) updateNubsAnim(a, 1 / 30, 0, p.S, false, 0);
  h.key(p, a);
  g.translate(canvas.width / 2, canvas.height * 0.8);
  h.back(g, p, a);
  h.live(g, p, a);
  h.front(g, p, a);
  g.setTransform(1, 0, 0, 1, 0, 0);
}
