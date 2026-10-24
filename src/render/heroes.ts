// The Elementals' art: Ember (a flame), Sprout (a seedling) and Drip (a water droplet), each a
// CharArt for Nubs' two-layer sprite cache (nubs.ts). An element is a state function, a palette per
// state and art strings (glyphs.ts ops in units of U = S·1.4 from the ground point, '$n' its state's
// colour n) for the back and front layers, with a shared face; the layers redraw only when the
// quantized state in their key changes, and the spring-chain parts between them are the only live
// drawing (a fill and at most two strokes). The states:
//   Ember  calm / snuffing out of the light (smaller, dull red) / feasting in glare (20 % taller,
//          white-hot) / guttering (low: small and dull); snuffed, it sinks to a sleepy ember.
//   Sprout calm / scorching in full sun (drooping leaves, brown bud) / dappled (leaves up, its bud
//          open) / starving in full shade (pale) / curled (low); wilts flat.
//   Drip   a clear blue droplet; it dries away.
// Also the Elementals screen's preview, the death beat's tokens, the Tag Stones and the relay's NEXT
// chip.

import { HEROES, relayY, trailX, type HeroId, type SimState, type TrialRelay } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import type { Equipped } from '../meta/content.ts';
import { chip, displayFont, FACE, outlined } from './candy.ts';
import { artOps, drawArt, drawGlyph, type ArtOp } from './glyphs.ts';
import { createNubsAnim, createPose, HAT_BASE_X, HAT_BASE_Y, NUBS_SCALE, renderWardrobePreview, updateNubsAnim, type CharArt, type Motion, type NubsAnim, type NubsPose } from './nubs.ts';
import { ctx2d, type Canvas2D } from './sprites.ts';

const parsed = new Map<string, ArtOp[]>();

/** Draws an art string ('@' and '$0' are pal[0]) in the current transform (`flat`: high contrast, no shines). */
function art(g: CanvasRenderingContext2D, src: string, pal: readonly string[], flat = false): void {
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
  art(g, EYES[a.blink > 0 ? 1 : m === 2 ? 2 : 0] as string, pal, p.hc);
  art(g, MOUTHS[m] as string, pal);
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
      const [body, pal, sx, sy, fade, rise, eye, over] = d.die;
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

/** Ember: 0 calm, 1 snuffing (not safe), 2 feasting (glare), 3 guttering (low). */
const FLAME = 'P$0/$1/1.1 M0-34.6C2.6-24.2 9.5-18.1 8.6-8.6A8.6 8.6 0 0 1-8.6-8.6C-9.9-14.6-9-19.5-6.9-24.7Q-1.7-22.9 0-34.6Z';
const CORE = 'F$2 M0-21.3C1.6-15.2 5.9-12.1 5.3-6.2A5.3 5.3 0 0 1-5.3-6.2C-6.1-9.9-5.6-12.5-4.3-15.5Q-1.1-14.5 0-21.3Z|F#FFF8 O-4.3-11.2 1.4,2.4';
const HOT = `${CORE}|F#FFFD O0-6.9 2.8,3.6`;
const TONGUES = [6.8, -11.2, 1.4, -1.05, 2.4, 0, 0.8];
const EMBER = make({
  st: (p) => (p.chill < 0.3 ? 3 : !p.safe ? 1 : p.c >= 6 ? 2 : 0),
  pal: ['#F71,#821,#FD4,#410', '#C42,#821,#F95,#410', '#F92,#821,#FFE,#410', '#D52,#821,#FB4,#FC7'],
  mood: '0121',
  // Feasting stands 20 % taller; guttering is a small dull flame.
  k: [1, 1, 1.2, 0.55],
  back: [FLAME, FLAME, FLAME, FLAME],
  front: [CORE, CORE, HOT, ''],
  eye: -7.4,
  bl: [TONGUES, TONGUES, TONGUES, null],
  // Snuffed: the flame sinks to nothing, dozing off.
  die: [FLAME, '#C42,#821,#FC7', 0.2, 0.2, 1, 0, -4.4, ''],
  motion(_p, _a, m, st) {
    // Snuffing: 15 % smaller.
    if (st === 1) {
      m.sx *= 0.85;
      m.sy *= 0.85;
    }
  },
});

/** Sprout: 0 calm, 1 scorching (full sun or glare), 2 dappled (safe), 3 starving (full shade), 4 curled (low). */
const BULB = 'P$0/$1/1.1 O0-9.6 9,9.6|P#A74/#532/.8 O-3.8-.2 2.5,1.4O3.8-.2 2.5,1.4|F#FFF6 O0-6.4 5,3.6|S#383/1.6 M0-18.4V-22.4';
const BUD = 'P$2/$1/.7 M0-26.2Q2.2-23.2 0-22.2Q-2.2-23.2 0-26.2';
/** Its leaves per state: up and out when happy, drooping in the sun, limp in shade, curled when low. */
const leaves = (sx: number, sy: number): readonly number[] => [0, -21, sx, sy, 3.4, 3, 0.75];
const SPROUT = make({
  st: (p) => (p.chill < 0.3 ? 4 : p.safe ? 2 : p.c >= 5 ? 1 : p.c === 0 ? 3 : 0),
  pal: ['#9D5,#362,#7C4,#6B4,#232', '#CD6,#362,#B83,#9A3,#232', '#9E5,#362,#7C4,#7D4,#232', '#EEA,#362,#CC7,#CC7,#232', '#BA6,#542,#984,#884,#232'],
  mood: '01211',
  k: [1, 1, 1, 1, 0.94],
  back: [BULB, BULB, BULB, BULB, BULB],
  front: [BUD, BUD, 'F#FBC O0-25.5 1.35O1.8-24.2 1.35O1.1-22.1 1.35O-1.1-22.1 1.35O-1.8-24.2 1.35|F#FC4 O0-23.6 1.2', BUD, BUD],
  eye: -10.4,
  bl: [leaves(2.4, -0.6), leaves(2.2, 0.75), leaves(2.6, -0.95), leaves(2.2, -0.25), leaves(1.2, 0.4)],
  // Wilted: the bulb sags flat and brown.
  die: [BULB, '#A95,#542,#232', 1.2, 0.65, 1, 0, -9.6, ''],
});

/** Drip: one state, a clear blue droplet. */
const DROP = 'P$0/$1/1.1 M0-32C3.1-21.6 9.5-15.8 9-9A9 9 0 0 1-9-9C-9.5-15.8-3.1-21.6 0-32Z';
const SHINE = 'F#FFFD O-4-12.5 1.5,3O-2.4-18.2 .8';
const SPLASH = [9, -5, 0.8, -0.6, 1.6, 0, 0.6];
const DRIP = make({
  st: () => 0,
  pal: ['#6CF,#15A,#135'],
  mood: '0',
  k: [1],
  back: [DROP],
  front: [SHINE],
  eye: -8.6,
  bl: [SPLASH],
  // Dried away: rising and thinning into the steam (no puddle).
  die: [DROP, '#6CF,#15A,#135', 0.5, 0.5, 0, 10, -8.6, ''],
  motion(p, a, m) {
    // Jelly: a squash out of step with the walk.
    if (!p.walking || p.reducedMotion) return;
    const k = 0.05 * Math.sin(a.walkPhase * 2);
    m.sx *= 1 + k;
    m.sy *= 1 - k;
  },
});

const ARTS: Readonly<Record<HeroId, CharArt | null>> = { nubs: null, ember: EMBER, drip: DRIP, sprout: SPROUT, gust: null };

/** The art of `hero` for the sprite cache (null: Nubs' own). */
export function heroArt(hero: HeroId): CharArt | null {
  return ARTS[hero];
}

// ---------------------------------------------------------------------------------------------
// Around the sprites (the renderer draws these each frame)
// ---------------------------------------------------------------------------------------------

/** A relay's Tag Stones on the trail (render only): a standing stone with the next hero's glyph; passed ones fade. */
export function drawTagStones(g: CanvasRenderingContext2D, v: View, s: SimState): void {
  const r = (s.trial as { relays: readonly TrialRelay[] }).relays;
  const S = v.S;
  for (let i = 0; i < r.length; i++) {
    const wy = relayY(s, i);
    if (wy < v.y0 - 30 || wy > v.y1 + 30) continue;
    const x = v.ox + trailX(s.world.trail, wy) * S;
    const y = v.oy - wy * S;
    g.globalAlpha = i < s.relayIdx ? 0.45 : 1;
    g.save();
    g.translate(x, y);
    g.scale(S, S);
    art(g, STONE, []);
    g.restore();
    drawGlyph(g, (r[i] as TrialRelay).to, x, y - 10 * S, 13 * S);
  }
  g.globalAlpha = 1;
}
const STONE = 'F#3244 O0 0 11,3.5|P#BBC/#436/1.4 M-8 0V-12A8 8 0 0 1 8-12V0Z';

let nextText = '';
let nextKey = '';

/** A relay's telegraph chip, "NEXT ▸ EMBER 3", counting whole seconds down on the incoming hero's face colour. */
export function drawNextChip(g: CanvasRenderingContext2D, hero: HeroId, ticks: number, cx: number, y: number, k: number): void {
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
