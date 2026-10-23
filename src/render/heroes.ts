// The Elementals' art (docs/ELEMENTALS.md §4.9): Ember (a flame), Sprout (a seedling), Volt (a storm
// puff) and Drip (a water droplet), each a CharArt for Nubs' two-layer sprite cache (nubs.ts): the
// layers redraw only when the quantized state in their key changes (Ember's flicker frames at 8 fps,
// none under reduced motion), the spring-chain parts are the only live drawing (a fill and at most
// two strokes) and Nubs' springs, hop, blink and look drive them all. Each has idle, stress, joy, low
// and death looks:
//   Ember  calm / snuffing in shade (smaller, dull red) / feasting in glare (taller, white-hot core) /
//          guttering on a coal / BLAZE (bright); dies to a smoking coal.
//   Sprout calm / scorching (drooping leaves, brown tips) / dappled (leaves up, its bud open) /
//          starving in shade (pale) / curled; wilts.
//   Volt   calm / leaking in the light (duller) / a strike's white flash / droopy grey; fizzles.
//   Drip   tinted by its temperature in five steps (icy, frosty, clear blue when calm, warm, hot),
//          a little rain cloud during CLOUDBURST; freezes into an ice cube or boils away.
// Also the Elementals screen's preview, the death beat's tokens, the Tag Stones, the duo's Harmony
// tether, Ember's smoke, Volt's sky bolt, the relay's NEXT chip and the intro card's dial legend.

import { HEROES, relayY, trailX, type HeroId, type SimState } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import type { Equipped } from '../meta/content.ts';
import { chip, displayFont, FACE, outlined } from './candy.ts';
import { cssa } from './color.ts';
import { drawGlyph } from './glyphs.ts';
import { heroArcColor } from './halo.ts';
import { createNubsAnim, createPose, HAT_BASE_X, HAT_BASE_Y, NUBS_SCALE, renderWardrobePreview, resetNubsAnim, updateNubsAnim, type CharArt, type Motion, type NubsAnim, type NubsPose } from './nubs.ts';
import { ctx2d, radialSprite, type Canvas2D } from './sprites.ts';

const TAU = Math.PI * 2;
const SIDES = [-1, 1] as const;
/** Face moods. */
const CALM = 0;
const SAD = 1;
const JOY = 2;

/** An ellipse subpath. */
function ell(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  g.moveTo(x + rx, y);
  g.ellipse(x, y, rx, ry, 0, 0, TAU);
}

/** Fills the current path and outlines it (cached layers only). */
function paint(g: CanvasRenderingContext2D, fill: string | CanvasGradient, line: string, w: number): void {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = w;
  g.strokeStyle = line;
  g.lineJoin = 'round';
  g.stroke();
}

/** A top-to-bottom gradient (flat in high contrast). */
function vgrad(g: CanvasRenderingContext2D, p: NubsPose, y0: number, y1: number, c0: string, c1: string): string | CanvasGradient {
  if (p.hc) return c1;
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, c0);
  gr.addColorStop(1, c1);
  return gr;
}

/**
 * A hero's face: coal eyes with a glint (a blink, ^ ^ in joy, worried brows), a mouth and joy's
 * cheeks, looking along (lx, ly); `y` is the eye line, `w` half the eyes' spread (pose px).
 */
function face(g: CanvasRenderingContext2D, U: number, y: number, w: number, p: NubsPose, mood: number, blink: boolean, ink: string): void {
  const ex = p.lookX * 1.1 * U;
  const ey = y + p.lookY * 0.8 * U;
  g.lineCap = 'round';
  g.lineWidth = Math.max(1, 1.15 * U);
  g.strokeStyle = ink;
  for (const s of SIDES) {
    const x = s * w + ex;
    g.fillStyle = ink;
    g.beginPath();
    if (blink) {
      g.moveTo(x - 1.1 * U, ey);
      g.lineTo(x + 1.1 * U, ey);
      g.stroke();
      continue;
    }
    if (mood === JOY) {
      g.arc(x, ey + 0.6 * U, 1.2 * U, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
      g.fillStyle = 'rgba(255,110,130,0.45)';
      g.beginPath();
      ell(g, s * (w + 1.5 * U) + ex * 0.5, ey + 1.7 * U, 1.3 * U, 0.75 * U);
      g.fill();
      continue;
    }
    ell(g, x, ey, 1.05 * U, 1.3 * U);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(x + 0.35 * U, ey - 0.45 * U, 0.4 * U, 0, TAU);
    g.fill();
    if (mood === SAD) {
      g.beginPath();
      g.moveTo(x + s * 1.3 * U, ey - 1.9 * U);
      g.lineTo(x - s * 0.9 * U, ey - 2.6 * U);
      g.stroke();
    }
  }
  const mx = ex * 0.7;
  const my = ey + 2.5 * U;
  g.fillStyle = ink;
  g.beginPath();
  if (mood === SAD) {
    ell(g, mx, my + 0.4 * U, 0.8 * U, 1 * U);
    g.fill();
  } else {
    const r = mood === JOY ? 1.7 * U : 1.25 * U;
    g.arc(mx, my - r * 0.55, r, Math.PI * 0.2, Math.PI * 0.8);
    g.stroke();
  }
}

/** The face's mood from the hero's look and Nubs' reactions (a happy hop, a PHEW). */
const moodOf = (base: number, a: NubsAnim): number => (a.happy > 0 || a.phew > 0 ? JOY : base);

/** The flicker frame now (0..n−1 at 8 fps; 0 under reduced motion). */
const frameOf = (p: NubsPose, n: number): number => (p.reducedMotion ? 0 : Math.floor(p.time * 8) % n);

/**
 * Quantizes the look to 16 directions in place (the eyes move a little) and returns the key of what
 * every hero's layers share: the look, a blink, a happy face and high contrast.
 */
function baseKey(p: NubsPose, a: NubsAnim): number {
  const q = ((Math.round((Math.atan2(p.lookY, p.lookX) * 16) / TAU) % 16) + 16) % 16;
  p.lookX = Math.cos((q * TAU) / 16);
  p.lookY = Math.sin((q * TAU) / 16);
  return ((q * 2 + (a.blink > 0 ? 1 : 0)) * 2 + (a.happy > 0 || a.phew > 0 ? 1 : 0)) * 2 + (p.hc ? 1 : 0);
}

/** easeInOut 0..1 of a death `melt` seconds in (0.6 s). */
function deathT(p: NubsPose): number {
  const t = Math.min(1, p.melt / 0.6);
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

/** A three-lump cloud (Volt, Drip's CLOUDBURST) grown by `o` (its outline pass), `sag` lower. */
function lumps(g: CanvasRenderingContext2D, U: number, o: number, sag: number): void {
  ell(g, -5.4 * U, -9.6 * U + sag, 6 * U + o, 6 * U + o);
  ell(g, 5.4 * U, -9.6 * U + sag, 6 * U + o, 6 * U + o);
  ell(g, 0, -14.6 * U + sag * 1.4, 7.6 * U + o, 7.6 * U + o);
  ell(g, 0, -7.2 * U + sag * 0.5, 9.6 * U + o, 4.8 * U + o);
}

function cloudBody(g: CanvasRenderingContext2D, p: NubsPose, U: number, sag: number, c0: string, c1: string, line: string): void {
  g.fillStyle = line;
  g.beginPath();
  lumps(g, U, 1.1 * U, sag);
  g.fill();
  g.fillStyle = vgrad(g, p, -22 * U, -3 * U, c0, c1);
  g.beginPath();
  lumps(g, U, 0, sag);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.beginPath();
  ell(g, -2.6 * U, -18 * U + sag * 1.4, 2.6 * U, 1.5 * U);
  g.fill();
}

/** Spring node k (0..2) of tail t as a pose-px point: x scaled by `sx`, y by `sy` (negative: rising). */
function node(a: NubsAnim, t: number, k: number, U: number, sx: number, sy: number, out: Float64Array): void {
  const o = (t * 3 + k) * 2;
  out[0] = (a.tail[o] as number) * U * sx;
  out[1] = (a.tail[o + 1] as number) * U * sy;
}
const n1 = new Float64Array(2);
const n2 = new Float64Array(2);

/**
 * A tapered blade from (x0, y0) along tail t's springs (scaled by sx, sy), `w` wide at its base: the
 * flame tongues, the leaves and the drops all use it, both in one path.
 */
function blade(g: CanvasRenderingContext2D, a: NubsAnim, t: number, U: number, x0: number, y0: number, sx: number, sy: number, w: number): void {
  node(a, t, 1, U, sx, sy, n1);
  node(a, t, 2, U, sx, sy, n2);
  const tx = x0 + (n2[0] as number);
  const ty = y0 + (n2[1] as number);
  const mx = x0 + (n1[0] as number);
  const my = y0 + (n1[1] as number);
  const dx = tx - x0;
  const dy = ty - y0;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * w;
  const ny = (dx / l) * w;
  g.moveTo(x0 - nx * 0.5, y0 - ny * 0.5);
  g.quadraticCurveTo(mx - nx, my - ny, tx, ty);
  g.quadraticCurveTo(mx + nx, my + ny, x0 + nx * 0.5, y0 + ny * 0.5);
  g.closePath();
}

// ---------------------------------------------------------------------------------------------
// Ember (Fire)
// ---------------------------------------------------------------------------------------------

/** 0 calm, 1 snuffing (not safe), 2 feasting (glare), 3 guttering (low), 4 blazing. */
const emberState = (p: NubsPose): number => (p.power ? 4 : p.chill < 0.3 ? 3 : !p.safe ? 1 : p.c >= 6 ? 2 : 0);
const EMBER_OUT = ['#FF7A1A', '#C9432B', '#FF9A1F', '#D2501F', '#FF8A1F'];
const EMBER_CORE = ['#FFD84A', '#F29A5E', '#FFF6D8', '#FFB347', '#FFFBEA'];
/** Flame height (u at scale 1): feasting is 20 % taller; guttering is a small flame on its coal. */
const EMBER_H = [30, 28, 36, 15, 36];
const SWAY = [-2.2, 0.6, 2.4];
const EMBER_LINE = '#8A2410';

/** A flame on a round base of radius r at (0, cy), `h` tall, its tip at x `tx`, a side lick shifted by `lick`. */
function flame(g: CanvasRenderingContext2D, r: number, cy: number, h: number, tx: number, lick: number): void {
  g.moveTo(tx, cy - h);
  g.bezierCurveTo(tx + r * 0.3, cy - h * 0.6, r * 1.1, cy - r * 1.1, r, cy);
  g.arc(0, cy, r, 0, Math.PI);
  g.bezierCurveTo(-r * 1.15, cy - r * 0.7, -r * 1.05, cy - h * 0.42, -r * 0.8 + lick, cy - h * 0.62);
  g.quadraticCurveTo(-r * 0.2, cy - h * 0.55, tx, cy - h);
}

/** The guttering coal (and the snuffed one). */
function coal(g: CanvasRenderingContext2D, U: number): void {
  g.beginPath();
  ell(g, 0, -3.8 * U, 7.6 * U, 4.6 * U);
  paint(g, '#5A2418', '#2A100A', 1.1 * U);
  g.strokeStyle = '#FF8A3D';
  g.lineWidth = 0.7 * U;
  g.beginPath();
  g.moveTo(-4.5 * U, -2.6 * U);
  g.lineTo(-2.2 * U, -4.4 * U);
  g.lineTo(-0.4 * U, -3 * U);
  g.moveTo(1.5 * U, -6.4 * U);
  g.lineTo(3.2 * U, -4.2 * U);
  g.lineTo(5.2 * U, -4.8 * U);
  g.stroke();
}

function emberGeom(p: NubsPose, st: number): [U: number, r: number, cy: number, h: number, tx: number, lick: number] {
  const U = p.S * NUBS_SCALE;
  const fr = frameOf(p, 3);
  const small = st === 3 ? 0.55 : 1;
  return [U, 8.6 * U * small, (st === 3 ? -6.2 : -8.6) * U, (EMBER_H[st] as number) * U, (SWAY[fr] as number) * U * small, (fr - 1) * 1.2 * U];
}

const EMBER: CharArt = {
  key: (p, a) => (emberState(p) * 3 + frameOf(p, 3)) * 64 + baseKey(p, a),
  back(g, p) {
    const st = emberState(p);
    const [U, r, cy, h, tx, lick] = emberGeom(p, st);
    if (st === 3) coal(g, U);
    g.beginPath();
    flame(g, r, cy, h, tx, lick);
    paint(g, vgrad(g, p, cy - h, cy + r, st === 1 ? '#E0784A' : '#FFC83D', EMBER_OUT[st] as string), EMBER_LINE, 1.1 * U);
  },
  live(g, p, a) {
    const st = emberState(p);
    const [U, r, cy] = emberGeom(p, st);
    if (st === 3) return;
    // Two flame tongues licking up off the shoulders on the spring chain.
    g.beginPath();
    for (let t = 0; t < 2; t++) blade(g, a, t, U, (t === 0 ? -0.8 : 0.8) * r, cy - 0.3 * r, 1.4, -1.05, 2.4 * U);
    g.fillStyle = EMBER_OUT[st] as string;
    g.fill();
    g.lineWidth = 0.8 * U;
    g.strokeStyle = EMBER_LINE;
    g.stroke();
  },
  front(g, p, a) {
    const st = emberState(p);
    const [U, r, cy, h, tx, lick] = emberGeom(p, st);
    g.beginPath();
    flame(g, r * 0.62, cy + r * 0.28, h * 0.58, tx * 0.6, lick * 0.5);
    g.fillStyle = EMBER_CORE[st] as string;
    g.fill();
    if (st === 2 || st === 4) {
      // White-hot.
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      ell(g, 0, cy + r * 0.2, r * 0.32, r * 0.42);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    ell(g, -r * 0.5, cy - r * 0.3, r * 0.16, r * 0.28);
    g.fill();
    if (st === 3) face(g, U, -4.4 * U, 2.3 * U, p, moodOf(SAD, a), a.blink > 0, '#FFC27A');
    else face(g, U, cy + 0.2 * U, 2.6 * U, p, moodOf(st === 1 ? SAD : st >= 2 ? JOY : CALM, a), a.blink > 0, '#4A1206');
  },
  motion(p, _a, m) {
    // Snuffing: 15 % smaller (around the ground point).
    if (emberState(p) === 1) {
      m.sx *= 0.85;
      m.sy *= 0.85;
    }
  },
  death(g, p) {
    // Snuffed: the flame sinks into its coal, which goes dark with sleepy eyes.
    const U = p.S * NUBS_SCALE;
    const e = deathT(p);
    g.save();
    g.translate(p.x, p.y);
    coal(g, U);
    if (e < 1) {
      g.globalAlpha = 1 - e;
      g.beginPath();
      flame(g, 6 * U * (1 - 0.5 * e), -6 * U, 24 * U * (1 - e), 0, 0);
      paint(g, '#C9432B', EMBER_LINE, U);
      g.globalAlpha = 1;
    }
    sleepy(g, U, -4.4 * U, 2.3 * U, '#FFC27A');
    g.restore();
  },
};

/** Closed eyes (a death): two little arcs. */
function sleepy(g: CanvasRenderingContext2D, U: number, y: number, w: number, ink: string): void {
  g.strokeStyle = ink;
  g.lineWidth = Math.max(1, 1.1 * U);
  g.lineCap = 'round';
  g.beginPath();
  for (const s of SIDES) {
    g.moveTo(s * w + 1.1 * U, y);
    g.arc(s * w, y, 1.1 * U, 0, Math.PI);
  }
  g.stroke();
}

// ---------------------------------------------------------------------------------------------
// Sprout (Leaf)
// ---------------------------------------------------------------------------------------------

/** 0 calm, 1 scorching (full sun or glare), 2 dappled (safe), 3 starving (full shade), 4 curled (low). */
const sproutState = (p: NubsPose): number => (p.chill < 0.3 ? 4 : p.safe ? 2 : p.c >= 5 ? 1 : p.c === 0 ? 3 : 0);
const SPROUT_HI = ['#B4F07A', '#DDE27A', '#C6F58C', '#F4F2BE', '#CDBE80'];
const SPROUT_LO = ['#5DB531', '#9DB03A', '#5FC232', '#C9CF7A', '#8C8A4A'];
const LEAF = ['#6CC04A', '#93A83A', '#7AD14A', '#C3CB74', '#8C8A4A'];
/** Leaf springs' x and y scales per state: up and out when happy, drooping in the sun, limp in shade, curled when low. */
const LEAF_SX = [2.4, 2.2, 2.6, 2.2, 1.2];
const LEAF_SY = [-0.6, 0.75, -0.95, -0.25, 0.4];
const SPROUT_LINE = '#2F6B1E';

const SPROUT: CharArt = {
  key: (p, a) => sproutState(p) * 64 + baseKey(p, a),
  back(g, p) {
    const st = sproutState(p);
    const U = p.S * NUBS_SCALE;
    // The seed bulb and its root feet.
    g.beginPath();
    ell(g, 0, -9.6 * U, 9 * U, 9.6 * U);
    paint(g, vgrad(g, p, -19 * U, 0, SPROUT_HI[st] as string, SPROUT_LO[st] as string), st === 4 ? '#5A4A22' : SPROUT_LINE, 1.1 * U);
    g.beginPath();
    for (const s of SIDES) ell(g, s * 3.8 * U, -0.2 * U, 2.5 * U, 1.4 * U);
    paint(g, '#A0703C', '#5A3A1A', 0.8 * U);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    ell(g, 0, -6.4 * U, 5 * U, 3.6 * U);
    g.fill();
    // The stem, under the leaves.
    g.strokeStyle = '#3E8A2A';
    g.lineWidth = 1.6 * U;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, -18.4 * U);
    g.lineTo(st === 1 || st === 4 ? 1.2 * U : 0, -22.4 * U);
    g.stroke();
  },
  live(g, p, a) {
    const st = sproutState(p);
    const U = p.S * NUBS_SCALE;
    const x0 = st === 1 || st === 4 ? 1 * U : 0;
    g.beginPath();
    for (let t = 0; t < 2; t++) blade(g, a, t, U, x0, -21 * U, LEAF_SX[st] as number, LEAF_SY[st] as number, 3.4 * U);
    g.fillStyle = LEAF[st] as string;
    g.fill();
    g.lineWidth = 0.75 * U;
    g.strokeStyle = SPROUT_LINE;
    g.stroke();
  },
  front(g, p, a) {
    const st = sproutState(p);
    const U = p.S * NUBS_SCALE;
    const bx = st === 1 || st === 4 ? 1.4 * U : 0;
    const by = -23.6 * U;
    if (st === 2) {
      // The bud opens: five pink petals round a gold heart.
      g.fillStyle = '#FFB3C6';
      g.beginPath();
      for (let i = 0; i < 5; i++) ell(g, bx + Math.cos((i * TAU) / 5 - 1.57) * 1.9 * U, by + Math.sin((i * TAU) / 5 - 1.57) * 1.9 * U, 1.35 * U, 1.35 * U);
      g.fill();
      g.fillStyle = '#FFC23D';
      g.beginPath();
      ell(g, bx, by, 1.2 * U, 1.2 * U);
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(bx, by - 2.6 * U);
      g.quadraticCurveTo(bx + 2.2 * U, by + 0.4 * U, bx, by + 1.4 * U);
      g.quadraticCurveTo(bx - 2.2 * U, by + 0.4 * U, bx, by - 2.6 * U);
      paint(g, st === 1 ? '#B08A3A' : '#7CC24A', SPROUT_LINE, 0.7 * U);
    }
    face(g, U, -10.4 * U, 2.9 * U, p, moodOf(st === 2 ? JOY : st === 0 ? CALM : SAD, a), a.blink > 0, '#22381A');
  },
  motion(p, _a, m) {
    // Scorching or curled: a little slumped.
    const st = sproutState(p);
    if (st === 1 || st === 4) m.sy *= 0.94;
  },
  death(g, p) {
    // Wilted: the bulb sags brown and the stem flops over.
    const U = p.S * NUBS_SCALE;
    const e = deathT(p);
    g.save();
    g.translate(p.x, p.y);
    g.beginPath();
    ell(g, 0, -9.6 * U * (1 - 0.35 * e), 9 * U * (1 + 0.2 * e), 9.6 * U * (1 - 0.35 * e));
    paint(g, e > 0.5 ? '#A08A50' : '#B5B060', '#5A4A22', 1.1 * U);
    g.strokeStyle = '#6A6A2A';
    g.lineWidth = 1.6 * U;
    g.lineCap = 'round';
    g.beginPath();
    const top = -18.4 * U * (1 - 0.35 * e);
    g.moveTo(0, top);
    g.quadraticCurveTo(3 * U * e, top - 4 * U, 5 * U * e, top - 2 * U + 4 * U * e);
    g.stroke();
    sleepy(g, U, -9.6 * U * (1 - 0.3 * e), 2.9 * U, '#22381A');
    g.restore();
  },
};

// ---------------------------------------------------------------------------------------------
// Volt (Storm)
// ---------------------------------------------------------------------------------------------

/** 0 calm, 1 leaking in the light (not safe), 2 a strike's flash, 3 droopy (low). */
const voltState = (p: NubsPose, a: NubsAnim): number => (a.zap > 0 && !p.reducedMotion ? 2 : p.chill < 0.3 ? 3 : !p.safe ? 1 : 0);
const VOLT_HI = ['#E2D6FF', '#D2CCE8', '#FFFFFF', '#CFCED8'];
const VOLT_LO = ['#8F78E0', '#8378B0', '#FFF2A0', '#88868F'];
const VOLT_LINE = '#3E2E7A';

const VOLT: CharArt = {
  key: (p, a) => voltState(p, a) * 64 + baseKey(p, a),
  back(g, p, a) {
    const st = voltState(p, a);
    const U = p.S * NUBS_SCALE;
    cloudBody(g, p, U, st === 3 ? 1.6 * U : 0, VOLT_HI[st] as string, VOLT_LO[st] as string, st === 3 ? '#4A4858' : VOLT_LINE);
  },
  live(g, p, a) {
    // Two zigzag bolt tails hanging on the springs: ink, then electric yellow.
    const U = p.S * NUBS_SCALE;
    g.beginPath();
    for (let t = 0; t < 2; t++) {
      const x0 = (t === 0 ? -3.6 : 3.6) * U;
      const y0 = -3.4 * U;
      g.moveTo(x0, y0);
      let px = x0;
      let py = y0;
      for (let k = 0; k < 3; k++) {
        node(a, t, k, U, 1, 0.9, n1);
        const x = x0 + (n1[0] as number);
        const y = y0 + (n1[1] as number);
        g.lineTo((px + x) / 2 + (k % 2 === 0 ? 1 : -1) * U, (py + y) / 2);
        g.lineTo(x, y);
        px = x;
        py = y;
      }
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 2.3 * U;
    g.strokeStyle = VOLT_LINE;
    g.stroke();
    g.lineWidth = 1.1 * U;
    g.strokeStyle = '#FFE14D';
    g.stroke();
  },
  front(g, p, a) {
    const st = voltState(p, a);
    const U = p.S * NUBS_SCALE;
    const sag = st === 3 ? 1.6 * U : 0;
    const ey = -11 * U + sag + p.lookY * 0.8 * U;
    const ex = p.lookX * 1.1 * U;
    if (!p.hc && st !== 3) {
      // The eyes glow.
      g.fillStyle = 'rgba(255,240,150,0.45)';
      g.beginPath();
      for (const s of SIDES) ell(g, s * 2.9 * U + ex, ey, 2.6 * U, 2.8 * U);
      g.fill();
    }
    const mood = moodOf(st === 2 ? JOY : st === 3 ? SAD : CALM, a);
    if (mood === JOY || a.blink > 0) face(g, U, -11 * U + sag, 2.9 * U, p, mood, a.blink > 0, VOLT_LINE);
    else {
      // Electric eyes: yellow with ink pupils (half shut when droopy).
      for (const s of SIDES) {
        const x = s * 2.9 * U + ex;
        g.beginPath();
        ell(g, x, ey, 1.6 * U, (st === 3 ? 1 : 1.8) * U);
        paint(g, '#FFE14D', VOLT_LINE, 0.6 * U);
        g.fillStyle = VOLT_LINE;
        g.beginPath();
        ell(g, x + p.lookX * 0.4 * U, ey + 0.2 * U, 0.75 * U, 0.95 * U);
        g.fill();
      }
      // A jagged little grin.
      g.beginPath();
      const my = ey + 2.7 * U;
      g.moveTo(ex - 1.8 * U, my);
      for (let i = 1; i <= 4; i++) g.lineTo(ex - 1.8 * U + i * 0.9 * U, my + (i % 2 === 1 ? 0.8 : 0) * U * (st === 3 ? -1 : 1));
      g.lineWidth = 0.9 * U;
      g.strokeStyle = VOLT_LINE;
      g.stroke();
    }
  },
  motion() {},
  death(g, p) {
    // Fizzled: the cloud puffs out, shrinking grey.
    const U = p.S * NUBS_SCALE * (1 - 0.55 * deathT(p));
    g.save();
    g.translate(p.x, p.y);
    cloudBody(g, p, U, 1.6 * U, '#D8D6DE', '#9A98A3', '#4A4858');
    sleepy(g, U, -10 * U, 2.9 * U, '#4A4858');
    g.restore();
  },
};

// ---------------------------------------------------------------------------------------------
// Drip (Water)
// ---------------------------------------------------------------------------------------------

/** T's tint step: 0 icy (< 15), 1 frosty (< 30), 2 calm (≤ 70), 3 warm (≤ 85), 4 hot; 5 a cloud (CLOUDBURST). */
function dripState(p: NubsPose): number {
  if (p.power) return 5;
  const T = p.meter * 100;
  return T < 15 ? 0 : T < 30 ? 1 : T <= 70 ? 2 : T <= 85 ? 3 : 4;
}
const DRIP_HI = ['#F6FCFF', '#E2F4FF', '#C4ECFF', '#FFD2C2', '#FFB8A2', '#F6F8FF'];
const DRIP_LO = ['#B9DDF2', '#86C6EE', '#3FAEF7', '#F08A6A', '#E8432F', '#AFC0DA'];
const DRIP_LINE = ['#5A8AB8', '#2D6FB0', '#1F5FA8', '#B0503A', '#A82F2A', '#5A6F9A'];

/** The droplet: a round base of radius r at (0, cy), `h` tall. */
function drop(g: CanvasRenderingContext2D, r: number, cy: number, h: number): void {
  g.moveTo(0, cy - h);
  g.bezierCurveTo(r * 0.35, cy - h * 0.55, r * 1.05, cy - r * 0.75, r, cy);
  g.arc(0, cy, r, 0, Math.PI);
  g.bezierCurveTo(-r * 1.05, cy - r * 0.75, -r * 0.35, cy - h * 0.55, 0, cy - h);
}

const DRIP: CharArt = {
  key: (p, a) => dripState(p) * 64 + baseKey(p, a),
  back(g, p) {
    const st = dripState(p);
    const U = p.S * NUBS_SCALE;
    if (st === 5) {
      cloudBody(g, p, U, 0, DRIP_HI[5] as string, DRIP_LO[5] as string, DRIP_LINE[5] as string);
      return;
    }
    g.beginPath();
    drop(g, 9 * U, -9 * U, 29 * U);
    paint(g, vgrad(g, p, -30 * U, 0, DRIP_HI[st] as string, DRIP_LO[st] as string), DRIP_LINE[st] as string, 1.1 * U);
  },
  live(g, p, a) {
    if (dripState(p) === 5) return;
    // Two splash droplets bobbing at the sides on the springs.
    const U = p.S * NUBS_SCALE;
    g.beginPath();
    for (let t = 0; t < 2; t++) {
      node(a, t, 2, U, 1.2, -0.5, n1);
      const x = (t === 0 ? -9 : 9) * U + (n1[0] as number);
      const y = -6 * U + (n1[1] as number);
      g.moveTo(x, y - 2.6 * U);
      g.quadraticCurveTo(x + 1.6 * U, y, x, y + 1.2 * U);
      g.quadraticCurveTo(x - 1.6 * U, y, x, y - 2.6 * U);
    }
    const st = dripState(p);
    g.fillStyle = DRIP_LO[st] as string;
    g.fill();
    g.lineWidth = 0.6 * U;
    g.strokeStyle = DRIP_LINE[st] as string;
    g.stroke();
  },
  front(g, p, a) {
    const st = dripState(p);
    const U = p.S * NUBS_SCALE;
    if (st === 5) {
      face(g, U, -11 * U, 2.9 * U, p, JOY, a.blink > 0, '#2A3A5A');
      return;
    }
    // The shine.
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.ellipse(-4 * U, -12.5 * U, 1.5 * U, 3 * U, 0.35, 0, TAU);
    ell(g, -2.4 * U, -18.2 * U, 0.8 * U, 0.8 * U);
    g.fill();
    if (st <= 1) {
      // Frost on the cold end: three little crystals.
      g.strokeStyle = '#FFFFFF';
      g.lineWidth = 0.6 * U;
      g.beginPath();
      for (const [x, y] of FROST_AT) {
        for (let i = 0; i < 3; i++) {
          const c = Math.cos((i * Math.PI) / 3) * 1.4 * U;
          const s = Math.sin((i * Math.PI) / 3) * 1.4 * U;
          g.moveTo(x * U - c, y * U - s);
          g.lineTo(x * U + c, y * U + s);
        }
      }
      g.stroke();
    }
    face(g, U, -8.6 * U, 2.8 * U, p, moodOf(st === 2 ? CALM : SAD, a), a.blink > 0, st >= 3 ? '#5A1A14' : '#16325A');
  },
  motion(p, a, m) {
    // Jelly: a squash out of step with the walk.
    if (!p.walking || p.reducedMotion) return;
    const k = 0.05 * Math.sin(a.walkPhase * 2);
    m.sx *= 1 + k;
    m.sy *= 1 - k;
  },
  death(g, p) {
    const U = p.S * NUBS_SCALE;
    const e = deathT(p);
    g.save();
    g.translate(p.x, p.y);
    if (p.cause === 'freeze') {
      // Frozen solid: an ice cube round a pale Drip.
      g.globalAlpha = 0.5 + 0.5 * e;
      g.beginPath();
      g.roundRect(-10.5 * U, -22 * U, 21 * U, 22 * U, 3 * U);
      paint(g, 'rgba(221,244,255,0.9)', '#7FC4F0', 1.2 * U);
      g.globalAlpha = 1;
      g.beginPath();
      drop(g, 7 * U, -8 * U, 20 * U);
      paint(g, '#CFEAFB', '#5A8AB8', 0.9 * U);
      g.strokeStyle = '#FFFFFF';
      g.lineWidth = 1.2 * U;
      g.beginPath();
      g.moveTo(-8 * U, -18 * U);
      g.lineTo(-4 * U, -20.5 * U);
      g.stroke();
      sleepy(g, U, -8 * U, 2.4 * U, '#16325A');
    } else {
      // Boiled away: Drip rises and thins into the steam (no puddle).
      g.globalAlpha = 1 - e;
      g.translate(0, -10 * U * e);
      g.scale(1 - 0.5 * e, 1 - 0.5 * e);
      g.beginPath();
      drop(g, 9 * U, -9 * U, 29 * U);
      paint(g, '#FFB8A2', '#A82F2A', 1.1 * U);
      sleepy(g, U, -8.6 * U, 2.8 * U, '#5A1A14');
    }
    g.restore();
  },
};
const FROST_AT: readonly (readonly [number, number])[] = [
  [-1.5, -22],
  [3.2, -16],
  [-5.5, -6],
];

const ARTS: Readonly<Record<HeroId, CharArt | null>> = { nubs: null, ember: EMBER, sprout: SPROUT, volt: VOLT, drip: DRIP };

/** The art of `hero` for the sprite cache (null: Nubs' own). */
export function heroArt(hero: HeroId): CharArt | null {
  return ARTS[hero];
}

// ---------------------------------------------------------------------------------------------
// Around the sprites (the renderer draws these each frame)
// ---------------------------------------------------------------------------------------------

/** Ember snuffing in the shade: three grey smoke squiggles rising (one stroke; replaces Nubs' sizzle). */
export function drawSmoke(g: CanvasRenderingContext2D, p: NubsPose, time: number): void {
  const U = p.S * NUBS_SCALE * 0.85;
  g.lineCap = 'round';
  g.lineWidth = Math.max(1.4, 1.4 * U);
  g.strokeStyle = 'rgba(110,104,120,0.7)';
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const ph = p.reducedMotion ? 0.4 : (time * 0.9 + i / 3) % 1;
    const x = p.x + (i - 1) * 6 * U;
    const y0 = p.y - (26 + ph * 10) * U;
    for (let j = 0; j <= 6; j++) {
      const xx = x + Math.sin(j + time * 6 + i) * 1.4 * U;
      const yy = y0 - j * 1.6 * U;
      if (j === 0) g.moveTo(xx, yy);
      else g.lineTo(xx, yy);
    }
  }
  g.stroke();
}

/** Volt's strike: a jagged bolt from the top of the view down to it (one stroke, its first frames). */
export function drawSkyBolt(g: CanvasRenderingContext2D, x: number, top: number, y: number, time: number): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = '#FFF6B0';
  g.beginPath();
  g.moveTo(x, top);
  const n = 7;
  for (let i = 1; i < n; i++) g.lineTo(x + Math.sin(i * 2.7 + time * 40) * 9, top + ((y - top) * i) / n);
  g.lineTo(x, y);
  g.stroke();
}

let tether: Canvas2D | null = null;

/** The duo's Harmony: a warm glow between the two sprites (one cached glow sprite, no stroke). */
export function drawTether(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, S: number, a: number): void {
  tether ??= radialSprite('255,214,120', 64, 0.85, 0.35, 0.3);
  const h = 22 * S;
  g.globalAlpha = a;
  g.drawImage(tether, x0 - 8 * S, y - h / 2, x1 - x0 + 16 * S, h);
  g.globalAlpha = 1;
}

/** The relay's Tag Stones on the trail (render only): the next hero's glyph on a standing stone; passed ones fade. */
export function drawTagStones(g: CanvasRenderingContext2D, v: View, s: SimState): void {
  const t = s.trial;
  if (t === null) return;
  const S = v.S;
  for (let i = 0; i < t.relays.length; i++) {
    const wy = relayY(s, i);
    if (wy < v.y0 - 30 || wy > v.y1 + 30) continue;
    const x = v.ox + trailX(s.world.trail, wy) * S;
    const y = v.oy - wy * S;
    g.globalAlpha = i < s.relayIdx ? 0.45 : 1;
    g.fillStyle = 'rgba(43,33,64,0.25)';
    g.beginPath();
    ell(g, x, y, 11 * S, 3.5 * S);
    g.fill();
    g.beginPath();
    g.roundRect(x - 8 * S, y - 20 * S, 16 * S, 21 * S, [8 * S, 8 * S, 2 * S, 2 * S]);
    g.fillStyle = '#B9B2C4';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = '#4E3A6E';
    g.stroke();
    drawGlyph(g, (t.relays[i] as { to: HeroId }).to, x, y - 10 * S, 13 * S);
  }
  g.globalAlpha = 1;
}

let nextText = '';
let nextKey = -1;

/**
 * The relay telegraph's chip under the dial, "NEXT ▸ EMBER 3", counting whole seconds down, on the
 * incoming hero's face colour (its words rebuilt once a second).
 */
export function drawNextChip(g: CanvasRenderingContext2D, hero: HeroId, ticks: number, cx: number, y: number, k: number): void {
  const sec = Math.max(1, Math.ceil(ticks / 60));
  const key = HERO_KEYS.indexOf(hero) * 100 + sec;
  if (key !== nextKey) {
    nextKey = key;
    nextText = `NEXT ▸ ${HEROES[hero].name.toUpperCase()} ${sec}`;
  }
  g.font = displayFont(15 * k);
  const w = g.measureText(nextText).width + 22 * k;
  const h = 26 * k;
  chip(g, cx - w / 2, y - h / 2, w, h, h / 2, FACE[HEROES[hero].face][1], k);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  outlined(g, nextText, cx, y, 15 * k);
}
const HERO_KEYS: readonly HeroId[] = ['nubs', 'ember', 'sprout', 'volt', 'drip'];

/**
 * The intro card's dial legend (§5.5): the hero's glyph on a white coin ringed by a short go arc in
 * the hero's colour and pattern (Ember's rays, Sprout's leaf dashes, Volt's bolt notch, Drip's dots).
 */
export function drawHeroLegend(g: CanvasRenderingContext2D, hero: HeroId, x: number, y: number, r: number): void {
  const col = heroArcColor(hero, hero !== 'drip');
  g.lineCap = 'round';
  g.lineWidth = r * 0.36;
  g.strokeStyle = cssa(col, 1);
  g.setLineDash(hero === 'sprout' ? [r * 0.4, r * 0.3] : []);
  g.beginPath();
  g.arc(x, y, r * 0.86, Math.PI * 0.8, Math.PI * 2.2);
  g.stroke();
  g.setLineDash([]);
  if (hero === 'ember' || hero === 'drip') {
    g.lineWidth = r * 0.12;
    g.strokeStyle = hero === 'drip' ? '#FFFFFF' : cssa(col, 1);
    g.beginPath();
    for (let a = Math.PI * 0.95; a < Math.PI * 2.1; a += 0.42) {
      const r0 = hero === 'drip' ? r * 0.86 : r * 1.08;
      g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      g.lineTo(x + Math.cos(a) * (r0 + (hero === 'drip' ? 0.01 : r * 0.22)), y + Math.sin(a) * (r0 + (hero === 'drip' ? 0.01 : r * 0.22)));
    }
    g.stroke();
  }
  drawGlyph(g, hero, x, y + r * 0.08, r * 1.1);
}

// ---------------------------------------------------------------------------------------------
// The death beat's token (a hero's "hat") and the Elementals screen's preview
// ---------------------------------------------------------------------------------------------

/** The token that pops off a fallen hero (a spark, a leaf, a bolt, a drop), drawn like nubs.ts renderHatSprite. */
export function renderTokenSprite(c: Canvas2D, hero: HeroId, pxPerU: number): void {
  const n = Math.ceil(30 * pxPerU);
  c.width = n;
  c.height = n;
  const g = ctx2d(c);
  g.setTransform(1, 0, 0, 1, HAT_BASE_X * pxPerU, HAT_BASE_Y * pxPerU);
  drawGlyph(g, hero === 'ember' ? 'spark' : hero, 0, -6 * pxPerU, 12 * pxPerU);
}

const previewAnim = createNubsAnim();
const previewPose = createPose();

/** Draws a hero idling (Nubs with the equipped cosmetics), for the Elementals screen's stage and tiles. */
export function renderHeroPreview(canvas: HTMLCanvasElement, hero: HeroId, equipped: Equipped): void {
  const art = ARTS[hero];
  if (!art) {
    renderWardrobePreview(canvas, equipped);
    return;
  }
  const g = ctx2d(canvas);
  const w = canvas.width;
  const h = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  const glow = g.createRadialGradient(w / 2, h * 0.78, 0, w / 2, h * 0.78, w * 0.5);
  const c = heroArcColor(hero, true);
  glow.addColorStop(0, cssa(c, 0.5));
  glow.addColorStop(1, cssa(c, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(52,48,107,0.12)';
  g.beginPath();
  ell(g, w / 2, h * 0.8, w * 0.22, h * 0.05);
  g.fill();
  const p = previewPose;
  p.S = h / 64;
  p.x = p.y = 0;
  p.chill = 1;
  p.c = 3;
  p.safe = true;
  p.meter = 0.5;
  p.lookX = 0.55;
  p.lookY = 0.35;
  p.time = 0;
  p.reducedMotion = true;
  resetNubsAnim(previewAnim);
  previewAnim.happy = 1;
  for (let i = 0; i < 30; i++) updateNubsAnim(previewAnim, 1 / 30, 0, p.S, false, 0);
  const m: Motion = { sx: 1, sy: 1, rot: 0, jx: 0, dy: 0 };
  art.key(p, previewAnim);
  art.motion(p, previewAnim, m);
  g.setTransform(m.sx, 0, 0, m.sy, w / 2, h * 0.8);
  art.back(g, p, previewAnim);
  art.live(g, p, previewAnim);
  art.front(g, p, previewAnim);
  g.setTransform(1, 0, 0, 1, 0, 0);
}
