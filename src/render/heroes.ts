// The Elementals' art (docs/ELEMENTALS.md §4.9): Ember (a flame), Sprout (a seedling), Volt (a storm
// puff) and Drip (a water droplet), each a CharArt for Nubs' two-layer sprite cache (nubs.ts). A hero
// is a state function, a palette per state and art strings (glyphs.ts ops in units of U = S·1.4 from
// the ground point, '$n' its state's colour n) for the back and front layers, with a shared face; the
// layers redraw only when the quantized state in their key changes (Ember's flicker frames, a shear
// of its flame at 8 fps, none under reduced motion), and the spring-chain parts between them are the
// only live drawing (a fill and at most two strokes). The states:
//   Ember  calm / snuffing out of the light (smaller, dull red) / feasting in glare (20 % taller,
//          white-hot) / guttering on a coal (low) / BLAZE; snuffed, it is a sleepy coal.
//   Sprout calm / scorching in full sun (drooping leaves, brown bud) / dappled (leaves up, its bud
//          open) / starving in full shade (pale) / curled (low); wilts flat.
//   Volt   calm / leaking in the light (duller) / a strike's white flash / droopy grey (low);
//          fizzles small.
//   Drip   its temperature in five tints (icy, frosty, clear blue when calm, warm, hot), a little
//          rain cloud during CLOUDBURST; freezes into an ice cube or boils away.
// Also the Elementals screen's preview, the death beat's tokens, the Tag Stones, the duo's Harmony
// tether, Ember's smoke, Volt's sky bolt, the relay's NEXT chip and the intro card's dial legend.

import { HEROES, relayY, trailX, type HeroId, type SimState, type TrialRelay } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import type { Equipped } from '../meta/content.ts';
import { chip, displayFont, FACE, outlined } from './candy.ts';
import { cssa } from './color.ts';
import { artOps, drawArt, drawGlyph, type ArtOp } from './glyphs.ts';
import { heroArcColor } from './halo.ts';
import { createNubsAnim, createPose, HAT_BASE_X, HAT_BASE_Y, NUBS_SCALE, renderWardrobePreview, updateNubsAnim, type CharArt, type Motion, type NubsAnim, type NubsPose } from './nubs.ts';
import { ctx2d, radialSprite, type Canvas2D } from './sprites.ts';

const parsed = new Map<string, ArtOp[]>();

/** Draws an art string ('@' and '$0' are pal[0]) in the current transform. */
function art(g: CanvasRenderingContext2D, src: string, pal: readonly string[]): void {
  if (!src) return;
  let ops = parsed.get(src);
  if (!ops) parsed.set(src, (ops = artOps(src)));
  drawArt(g, ops, pal[0], pal);
}

/** Eyes (open with a glint, a blink, joy's ^ ^ with cheeks) and mouths with their brows (calm, worried, joy), in U from the eye line. */
const EYES = ['F@ O-2.8 0 1.1,1.3O2.8 0 1.1,1.3|F#FFF O-2.45-.45 .4O3.15-.45 .4', 'S@/1.15 M-3.9 0h2.2M1.7 0h2.2', 'S@/1.15 M-4 .4A1.2 1.2 0 0 1-1.6 .4M1.6 .4A1.2 1.2 0 0 1 4 .4|F#FF6E8273 O-4.3 1.8 1.3,.75O4.3 1.8 1.3,.75'];
const MOUTHS = ['S@/1.15 M-1.1 2.3Q0 3.1 1.1 2.3', 'F@ O0 2.9 .8,1|S@/1.15 M-1.6-2.8L-3.8-2.1M1.6-2.8L3.8-2.1', 'S@/1.2 M-1.5 2Q0 3.6 1.5 2'];
/** Closed eyes (a fallen hero). */
const SLEEP = 'S@/1.1 M-3.9 0A1.1 1.1 0 0 0-1.7 0M1.7 0A1.1 1.1 0 0 0 3.9 0';

/**
 * A hero's face at eye line y (U), looking along the pose's look, its mood 0 calm, 1 worried, 2 joy
 * (a happy hop or a PHEW makes it joy); `under` is drawn behind open eyes (Volt's electric rims).
 */
function face(g: CanvasRenderingContext2D, p: NubsPose, a: NubsAnim, y: number, mood: number, ink: string, under = ''): void {
  const U = p.S * NUBS_SCALE;
  const m = a.happy > 0 || a.phew > 0 ? 2 : mood;
  const pal = [ink];
  g.save();
  g.translate(p.lookX * 1.1 * U, (y + p.lookY * 0.8) * U);
  g.scale(U, U);
  if (under && m < 2 && a.blink <= 0) art(g, under, pal);
  art(g, EYES[a.blink > 0 ? 1 : m === 2 ? 2 : 0] as string, pal);
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

/** Fills the current path in `fill` and outlines it in `line` (`w` U wide). */
function paint(g: CanvasRenderingContext2D, U: number, fill: string, line: string, w: number): void {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = w * U;
  g.strokeStyle = line;
  g.stroke();
}

/** A hero: its state from the pose, and per state its palette, layers, face and live parts. */
interface Def {
  st(p: NubsPose, a: NubsAnim): number;
  /** Per state: its colours, comma-joined ('$0'..; the face's ink is the last). */
  pal: readonly string[];
  /** Per state: the face's mood (digits) and the layers' vertical scale. */
  mood: string;
  k: readonly number[];
  back: readonly string[];
  front: readonly string[];
  /** The face's eye line (U) and what Volt draws behind open eyes. */
  eye: number;
  under?: string;
  /** Ember's flame shears by frame (its flicker). */
  flick?: boolean;
  live(g: CanvasRenderingContext2D, U: number, a: NubsAnim, st: number, pal: readonly string[]): void;
  /** A fallen hero, drawn whole each frame (e: 0..1 into it). */
  die(g: CanvasRenderingContext2D, U: number, e: number, p: NubsPose): void;
  motion?(p: NubsPose, a: NubsAnim, m: Motion, st: number): void;
}

const pals = new Map<string, readonly string[]>();
function palOf(d: Def, st: number): readonly string[] {
  const s = d.pal[st] as string;
  let p = pals.get(s);
  if (!p) pals.set(s, (p = s.split(',')));
  return p;
}

/** Ember's flicker: its flame sheared about the ground by frame (8 fps). */
const SHEAR = [0.07, -0.01, -0.08];
const frameOf = (p: NubsPose): number => (p.reducedMotion ? 1 : Math.floor(p.time * 8) % 3);

/** One layer of `d` at the pose's state (the face on the front layer). */
function layer(g: CanvasRenderingContext2D, d: Def, p: NubsPose, a: NubsAnim, front: boolean): void {
  const st = d.st(p, a);
  const pal = palOf(d, st);
  const U = p.S * NUBS_SCALE;
  const k = d.k[st] as number;
  g.save();
  if (d.flick) g.transform(1, 0, SHEAR[frameOf(p)] as number, 1, 0, 0);
  g.scale(U * Math.min(1, k), U * k);
  art(g, (front ? d.front : d.back)[st] as string, pal);
  g.restore();
  if (front) face(g, p, a, d.eye * (st === 3 && d.flick ? 0.6 : 1), +(d.mood[st] as string), pal[pal.length - 1] as string, d.under);
}

function make(d: Def): CharArt {
  return {
    key(p, a) {
      // The look in 16 directions (the eyes move a little), quantized in place.
      const q = ((Math.round((Math.atan2(p.lookY, p.lookX) * 8) / Math.PI) % 16) + 16) % 16;
      p.lookX = Math.cos((q * Math.PI) / 8);
      p.lookY = Math.sin((q * Math.PI) / 8);
      return ((((d.st(p, a) * 3 + (d.flick ? frameOf(p) : 0)) * 16 + q) * 2 + (a.blink > 0 ? 1 : 0)) * 2 + (a.happy > 0 || a.phew > 0 ? 1 : 0)) * 2 + (p.hc ? 1 : 0);
    },
    back: (g, p, a) => layer(g, d, p, a, false),
    front: (g, p, a) => layer(g, d, p, a, true),
    live(g, p, a) {
      const st = d.st(p, a);
      d.live(g, p.S * NUBS_SCALE, a, st, palOf(d, st));
    },
    motion(p, a, m) {
      d.motion?.(p, a, m, d.st(p, a));
    },
    death(g, p) {
      const U = p.S * NUBS_SCALE;
      g.save();
      g.translate(p.x, p.y);
      d.die(g, U, deathT(p), p);
      g.restore();
    },
  };
}

/** A fallen hero's closed eyes at eye line y (U). */
function sleep(g: CanvasRenderingContext2D, U: number, y: number, ink: string): void {
  g.save();
  g.translate(0, y * U);
  g.scale(U, U);
  art(g, SLEEP, [ink]);
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// The four heroes. Shapes in U from the ground point (y up is negative).
// ---------------------------------------------------------------------------------------------

/** Ember: 0 calm, 1 snuffing (not safe), 2 feasting (glare), 3 guttering (low), 4 blazing. */
const FLAME = 'P$0/#8A2410/1.1 M0-34.6C2.6-24.2 9.5-18.1 8.6-8.6A8.6 8.6 0 0 1-8.6-8.6C-9.9-14.6-9-19.5-6.9-24.7Q-1.7-22.9 0-34.6Z';
const CORE = 'F$1 M0-21.3C1.6-15.2 5.9-12.1 5.3-6.2A5.3 5.3 0 0 1-5.3-6.2C-6.1-9.9-5.6-12.5-4.3-15.5Q-1.1-14.5 0-21.3Z|F#FFFFFF80 O-4.3-11.2 1.4,2.4';
const HOT = `${CORE}|F#FFFFFFD9 O0-6.9 2.8,3.6`;
const COAL = 'P#5A2418/#2A100A/1.1 O0-3.8 7.6,4.6|S#FF8A3D/.7 M-4.5-2.6L-2.2-4.4-.4-3M1.5-6.4L3.2-4.2 5.2-4.8';
/** The coal under a guttering flame, drawn at the flame's 0.55 scale (so at full size here). */
const COAL_LOW = 'P#5A2418/#2A100A/2 O0-6.9 13.8,8.4|S#FF8A3D/1.3 M-8.2-4.7L-4-8-.7-5.5M2.7-11.6L5.8-7.6 9.5-8.7';
const EMBER = make({
  st: (p) => (p.power ? 4 : p.chill < 0.3 ? 3 : !p.safe ? 1 : p.c >= 6 ? 2 : 0),
  pal: ['#FF7A1A,#FFD84A,#4A1206', '#C9432B,#F29A5E,#4A1206', '#FF9A1F,#FFF6D8,#4A1206', '#D2501F,#FFB347,#FFC27A', '#FF8A1F,#FFFBEA,#4A1206'],
  mood: '01212',
  // Feasting and blazing stand 20 % taller; guttering is a small flame on its coal.
  k: [1, 1, 1.2, 0.55, 1.2],
  back: [FLAME, FLAME, FLAME, `${FLAME}|${COAL_LOW}`, FLAME],
  front: [CORE, CORE, HOT, '', HOT],
  eye: -7.4,
  flick: true,
  live(g, U, a, st, pal) {
    if (st === 3) return;
    // Two flame tongues licking up off its shoulders.
    g.beginPath();
    blade(g, a, 0, U, -6.8, -11.2, 1.4, -1.05, 2.4);
    blade(g, a, 1, U, 6.8, -11.2, 1.4, -1.05, 2.4);
    paint(g, U, pal[0] as string, '#8A2410', 0.8);
  },
  die(g, U, e) {
    // Snuffed: the flame sinks into its coal, which dozes off.
    g.scale(U, U);
    if (e < 1) {
      g.save();
      g.scale(0.5 * (1 - e), 0.5 * (1 - e));
      art(g, FLAME, ['#C9432B']);
      g.restore();
    }
    art(g, COAL, []);
    g.scale(1 / U, 1 / U);
    sleep(g, U, -4.4, '#FFC27A');
  },
  motion(_p, _a, m, st) {
    // Snuffing: 15 % smaller.
    if (st === 1) {
      m.sx *= 0.85;
      m.sy *= 0.85;
    }
  },
});

/** Sprout: 0 calm, 1 scorching (full sun or glare), 2 dappled (safe), 3 starving (full shade), 4 curled (low). */
const BULB = 'P$0/$1/1.1 O0-9.6 9,9.6|P#A0703C/#5A3A1A/.8 O-3.8-.2 2.5,1.4O3.8-.2 2.5,1.4|F#FFFFFF59 O0-6.4 5,3.6|S#3E8A2A/1.6 M0-18.4V-22.4';
const BUD = 'P$2/$1/.7 M0-26.2Q2.2-23.2 0-22.2Q-2.2-23.2 0-26.2';
const FLOWER = 'F#FFB3C6 O0-25.5 1.35O1.8-24.2 1.35O1.1-22.1 1.35O-1.1-22.1 1.35O-1.8-24.2 1.35|F#FFC23D O0-23.6 1.2';
/** Its leaves' springs per state: up and out when happy, drooping in the sun, limp in shade, curled when low. */
const LEAF_SX = [2.4, 2.2, 2.6, 2.2, 1.2];
const LEAF_SY = [-0.6, 0.75, -0.95, -0.25, 0.4];
const SPROUT = make({
  st: (p) => (p.chill < 0.3 ? 4 : p.safe ? 2 : p.c >= 5 ? 1 : p.c === 0 ? 3 : 0),
  pal: ['#8FDC54,#2F6B1E,#7CC24A,#6CC04A,#22381A', '#C6D45E,#2F6B1E,#B08A3A,#93A83A,#22381A', '#93E25A,#2F6B1E,#7CC24A,#7AD14A,#22381A', '#E6E8A6,#2F6B1E,#C3CB74,#C3CB74,#22381A', '#B8AC6E,#5A4A22,#9A8A4A,#8C8A4A,#22381A'],
  mood: '01211',
  k: [1, 1, 1, 1, 0.94],
  back: [BULB, BULB, BULB, BULB, BULB],
  front: [BUD, BUD, FLOWER, BUD, BUD],
  eye: -10.4,
  live(g, U, a, st, pal) {
    g.beginPath();
    blade(g, a, 0, U, 0, -21, LEAF_SX[st] as number, LEAF_SY[st] as number, 3.4);
    blade(g, a, 1, U, 0, -21, LEAF_SX[st] as number, LEAF_SY[st] as number, 3.4);
    paint(g, U, pal[3] as string, pal[1] as string, 0.75);
  },
  die(g, U, e) {
    // Wilted: the bulb sags flat and brown.
    g.save();
    g.scale(U * (1 + 0.2 * e), U * (1 - 0.35 * e));
    art(g, BULB, ['#A89A5C', '#5A4A22']);
    g.restore();
    sleep(g, U, -9.6 * (1 - 0.3 * e), '#22381A');
  },
});

/** Volt: 0 calm, 1 leaking in the light (not safe), 2 a strike's flash, 3 droopy (low). */
const CLOUD = 'F$1 O-5.4-9.6 7.1O5.4-9.6 7.1O0-14.6 8.7O0-7.2 10.7,5.9|F$0 O-5.4-9.6 6O5.4-9.6 6O0-14.6 7.6O0-7.2 9.6,4.8|F#FFFFFF99 O-2.6-18 2.6,1.5';
const VOLT = make({
  // The flash is a strike's first frame (none under reduced motion).
  st: (p, a) => (a.zap > 0.034 && !p.reducedMotion ? 2 : p.chill < 0.3 ? 3 : !p.safe ? 1 : 0),
  pal: ['#B9A6F0,#3E2E7A', '#A9A2C8,#3E2E7A', '#FFFDE8,#3E2E7A', '#AAA8B4,#4A4858'],
  mood: '0021',
  k: [1, 1, 1, 0.9],
  back: [CLOUD, CLOUD, CLOUD, CLOUD],
  front: ['', '', '', ''],
  eye: -11,
  // Electric eyes: yellow rims behind the pupils.
  under: 'F#FFF0964D O-2.8 0 2.6,2.8O2.8 0 2.6,2.8|P#FFE14D/@/.6 O-2.8 0 1.7,1.9O2.8 0 1.7,1.9',
  live(g, U, a) {
    // Two zigzag bolt tails hanging on the springs: ink, then electric yellow.
    g.beginPath();
    for (let t = 0; t < 2; t++) {
      const x0 = t === 0 ? -3.6 : 3.6;
      let px = x0;
      let py = -3.4;
      g.moveTo(px * U, py * U);
      for (let k = 0; k < 3; k++) {
        const x = x0 + (a.tail[t * 6 + 2 * k] as number);
        const y = -3.4 + (a.tail[t * 6 + 2 * k + 1] as number) * 0.9;
        g.lineTo(((px + x) / 2 + (k % 2 === 0 ? 1 : -1)) * U, ((py + y) / 2) * U);
        g.lineTo(x * U, y * U);
        px = x;
        py = y;
      }
    }
    g.lineWidth = 2.3 * U;
    g.strokeStyle = '#3E2E7A';
    g.stroke();
    g.lineWidth = 1.1 * U;
    g.strokeStyle = '#FFE14D';
    g.stroke();
  },
  die(g, U, e) {
    // Fizzled: the cloud puffs out, small and grey.
    const s = U * (1 - 0.55 * e);
    g.save();
    g.scale(s, s);
    art(g, CLOUD, ['#C4C2CC', '#4A4858']);
    g.restore();
    sleep(g, s, -11, '#4A4858');
  },
});

/** Drip: its tint by T (0 icy < 15, 1 frosty < 30, 2 calm ≤ 70, 3 warm ≤ 85, 4 hot), 5 a rain cloud (CLOUDBURST). */
const DROP = 'P$0/$1/1.1 M0-32C3.1-21.6 9.5-15.8 9-9A9 9 0 0 1-9-9C-9.5-15.8-3.1-21.6 0-32Z';
const SHINE = 'F#FFFFFFD9 O-4-12.5 1.5,3O-2.4-18.2 .8';
const FROSTY = `${SHINE}|S#FFF/.6 M-2.9-25h2.8M-2.2-26.2l1.4 2.4M-.8-26.2l-1.4 2.4M1.8-16h2.8M2.5-17.2l1.4 2.4M3.9-17.2l-1.4 2.4`;
const CUBE = 'P#DDF4FFCC/#7FC4F0/1.2 M-10.5-22h21v22h-21Z|S#FFF/1.2 M-8-18l4-2.5';
const DRIP = make({
  st(p) {
    const T = p.meter * 100;
    return p.power ? 5 : T < 15 ? 0 : T < 30 ? 1 : T <= 70 ? 2 : T <= 85 ? 3 : 4;
  },
  pal: ['#E8F6FF,#5A8AB8,#16325A', '#BFE3FA,#2D6FB0,#16325A', '#6CC3FA,#1F5FA8,#16325A', '#F7A58C,#B0503A,#5A1A14', '#F26A50,#A82F2A,#5A1A14', '#E2E8F6,#5A6F9A,#2A3A5A'],
  mood: '110112',
  k: [1, 1, 1, 1, 1, 1],
  back: [DROP, DROP, DROP, DROP, DROP, CLOUD],
  front: [FROSTY, FROSTY, SHINE, SHINE, SHINE, ''],
  eye: -8.6,
  live(g, U, a, st, pal) {
    if (st === 5) return;
    // Two splash droplets bobbing at its sides.
    g.beginPath();
    blade(g, a, 0, U, -9, -5, 0.8, -0.6, 1.6);
    blade(g, a, 1, U, 9, -5, 0.8, -0.6, 1.6);
    paint(g, U, pal[0] as string, pal[1] as string, 0.6);
  },
  die(g, U, e, p) {
    if (p.cause === 'freeze') {
      // Frozen solid: a pale Drip in an ice cube.
      g.save();
      g.scale(U * 0.75, U * 0.75);
      art(g, DROP, ['#CFEAFB', '#5A8AB8']);
      g.restore();
      sleep(g, U, -7, '#16325A');
      g.globalAlpha = 0.5 + 0.5 * e;
      g.scale(U, U);
      art(g, CUBE, []);
    } else {
      // Boiled away: it rises and thins into the steam (no puddle).
      g.globalAlpha = 1 - e;
      g.translate(0, -10 * U * e);
      g.scale(U * (1 - 0.5 * e), U * (1 - 0.5 * e));
      art(g, DROP, ['#F26A50', '#A82F2A']);
    }
  },
  motion(p, a, m) {
    // Jelly: a squash out of step with the walk.
    if (!p.walking || p.reducedMotion) return;
    const k = 0.05 * Math.sin(a.walkPhase * 2);
    m.sx *= 1 + k;
    m.sy *= 1 - k;
  },
});

const ARTS: Readonly<Record<HeroId, CharArt | null>> = { nubs: null, ember: EMBER, sprout: SPROUT, volt: VOLT, drip: DRIP };

/** The art of `hero` for the sprite cache (null: Nubs' own). */
export function heroArt(hero: HeroId): CharArt | null {
  return ARTS[hero];
}

// ---------------------------------------------------------------------------------------------
// Around the sprites (the renderer draws these each frame)
// ---------------------------------------------------------------------------------------------

/** Ember out of the light: three grey smoke squiggles rising (one stroke; Nubs' sizzle on a flame). */
export function drawSmoke(g: CanvasRenderingContext2D, p: NubsPose, time: number): void {
  const U = p.S * NUBS_SCALE * 0.85;
  g.lineCap = 'round';
  g.lineWidth = Math.max(1.4, 1.4 * U);
  g.strokeStyle = 'rgba(110,104,120,0.7)';
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const ph = p.reducedMotion ? 0.4 : (time * 0.9 + i / 3) % 1;
    for (let j = 0; j <= 6; j++) {
      const x = p.x + (i - 1) * 6 * U + Math.sin(j + time * 6 + i) * 1.4 * U;
      const y = p.y - (26 + ph * 10 + j * 1.6) * U;
      if (j === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  }
  g.stroke();
}

/** Volt's strike: a jagged bolt from the top of the view down to it (one stroke, its first frames). */
export function drawSkyBolt(g: CanvasRenderingContext2D, x: number, top: number, y: number, time: number): void {
  g.lineWidth = 3;
  g.strokeStyle = '#FFF6B0';
  g.beginPath();
  g.moveTo(x, top);
  for (let i = 1; i < 7; i++) g.lineTo(x + Math.sin(i * 2.7 + time * 40) * 9, top + ((y - top) * i) / 7);
  g.lineTo(x, y);
  g.stroke();
}

let tether: Canvas2D | null = null;

/** The duo's Harmony: a warm glow between the two sprites (one cached glow sprite, no stroke). */
export function drawTether(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, S: number, a: number): void {
  tether ??= radialSprite('255,214,120', 64, 0.85, 0.35, 0.3);
  g.globalAlpha = a;
  g.drawImage(tether, x0 - 8 * S, y - 11 * S, x1 - x0 + 16 * S, 22 * S);
  g.globalAlpha = 1;
}

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
const STONE = 'F#2B214040 O0 0 11,3.5|P#B9B2C4/#4E3A6E/1.4 M-8 0V-12A8 8 0 0 1 8-12V0Z';

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

/**
 * The intro card's dial legend (§5.5): the hero's glyph over a short go arc in its colour and
 * pattern (Ember's ray ticks, Sprout's leaf dashes, Drip's dots; Volt's bolt is its glyph).
 */
export function drawHeroLegend(g: CanvasRenderingContext2D, hero: HeroId, x: number, y: number, r: number): void {
  const c = cssa(heroArcColor(hero, hero !== 'drip'), 1);
  legendArc(g, x, y, r * 0.86, r * 0.36, c, hero === 'sprout' ? r * 0.4 : 0, r * 0.3);
  if (hero === 'ember') legendArc(g, x, y, r * 1.18, r * 0.24, c, r * 0.1, r * 0.3);
  if (hero === 'drip') legendArc(g, x, y, r * 0.86, r * 0.14, '#FFFFFF', 0.1, r * 0.4);
  g.setLineDash([]);
  drawGlyph(g, hero, x, y, r * 1.1);
}

function legendArc(g: CanvasRenderingContext2D, x: number, y: number, r: number, w: number, c: string, on: number, off: number): void {
  g.lineWidth = w;
  g.strokeStyle = c;
  g.setLineDash(on > 0 ? [on, off] : []);
  g.beginPath();
  g.arc(x, y, r, Math.PI * 0.8, Math.PI * 2.2);
  g.stroke();
}

/** The token that pops off a fallen hero (a spark, a leaf, a bolt, a drop), placed as nubs.ts renderHatSprite places the hat. */
export function renderTokenSprite(c: Canvas2D, hero: HeroId, pxPerU: number): void {
  c.width = c.height = Math.ceil(30 * pxPerU);
  drawGlyph(ctx2d(c), hero === 'ember' ? 'spark' : hero, HAT_BASE_X * pxPerU, (HAT_BASE_Y - 6) * pxPerU, 12 * pxPerU);
}

/** Draws a hero idling (Nubs with the equipped cosmetics), for the Elementals screen's stage and tiles. */
export function renderHeroPreview(canvas: HTMLCanvasElement, hero: HeroId, equipped: Equipped): void {
  const h = ARTS[hero];
  if (!h) {
    renderWardrobePreview(canvas, equipped);
    return;
  }
  const g = ctx2d(canvas);
  const w = canvas.width;
  const ht = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, ht);
  g.drawImage(radialSprite(cssa(heroArcColor(hero, true), 1).slice(5, -3), 64, 0.6, 0.55, 0.3), 0, ht * 0.28, w, ht);
  const p = createPose();
  Object.assign(p, { S: ht / 64, c: 3, meter: 0.5, lookX: 0.55, lookY: 0.35, reducedMotion: true });
  const a = createNubsAnim();
  a.happy = 1;
  for (let i = 0; i < 30; i++) updateNubsAnim(a, 1 / 30, 0, p.S, false, 0);
  h.key(p, a);
  g.translate(w / 2, ht * 0.8);
  h.back(g, p, a);
  h.live(g, p, a);
  h.front(g, p, a);
  g.setTransform(1, 0, 0, 1, 0, 0);
}
