// Elementals v2 (docs/ELEMENTALS_V2.md §2-§3, §7.10): a Trial's world objects and their telegraphs.
// Every object is one cached sprite per kind and state (rebuilt only when the view's pixel scale
// changes) stamped with one drawImage:
//   ground (under the shadow layer): Drip's widened path over its stretch, gaps (a dark chasm) and
//     streams (blue water) with a vine bridge growing across from the near bank, soil plots with a
//     sapling that grows in steps (the tree is a real caster), puddles (drying: paler), hot stones
//     (two shimmer frames; spent: grey); the relay's Tag Stones;
//   walls (over the shadow layer, under the casters): brambles (thorns), gates (planks), ice
//     (crystal), burning in three flame frames at ≤ 8 fps (one under reduced motion), ice melting;
//     Ember's own fires glow;
//   air (over the clouds): rain clouds drawn 50 u over their footprint (their shade is the sim's
//     proxy cloud) with one stroke path of streaks, fog banks (a radial sprite, the trail beyond a
//     bank veiled at 0.6).
// The cues (over everything in the world, under the dial) follow the walking element: Ember's hatched
// sweet band, dashed target rings, the key's next target solid (keyboard players), a pulsing ring to
// tap now, red with a cross once too late, burn progress arcs and a douse chevron on puddles in its
// path; Sprout's rings, the hold ring filling to the site's need (a plot's: treeMin) and the glowing
// line to it; growth bars, wet drops, a check on a bridged crossing and red chevrons with "!" on one
// that will not be ready; Drip's target dot; every awake weather object's dashed arrival ghost (green
// helps, red harms with a "!", white neither; a green ghost off the trail points at it) and, above
// the view, an edge marker with its drift. Colour is never the only channel: shapes, hatching,
// dashes, crosses and marks carry it too. A walker inside a fog bank is drawn again through it.

import {
  arriveTicks,
  bridged,
  burnLeft,
  burnSweet,
  driveWeatherX,
  EL_BURNING,
  EL_GONE,
  growLeft,
  needOf,
  relayY,
  trailX,
  TUNING,
  veiled,
  walkerAt,
  weatherGood,
  windAt,
  type Cloud,
  type DriveView,
  type ElKind,
  type ElObj,
  type SimState,
  type TrialRelay,
} from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { cssa } from './color.ts';
import { drawGlyph } from './glyphs.ts';
import { art } from './heroes.ts';
import { ctx2d, makeCanvas, radialSprite, type Canvas2D } from './sprites.ts';

const E = TUNING.elements;
const O = E.objects;
const TAU = Math.PI * 2;
/** A rain cloud's body floats this far (u, up the screen) over its footprint. */
const RAIN_LIFT = 50;
/** Ember's sweet band reaches the gate's burn-walk ahead (83 ticks at 70 u/s: the tap lands a tick later, core burnSweet). */
const BAND_FAR = ((E.ember.burnTicks.gate - 1) * 70) / 60;
const AMBER = 0xffb347;
const RED = 0xff4d3d;
const GREEN = 0x5fd35a;
const LIME = 0x8bd650;
// Walls and crossings stand across the trail (§3.3: authored at dx 0), so their x is the trail's.

interface Spr {
  c: Canvas2D;
  /** The origin (u from the top-left) and the size (u). */
  x: number;
  y: number;
  w: number;
  h: number;
}
const cache = new Map<string, Spr>();
let cacheK = 0;

/** Sprite `key`, `w`×`h` u with its origin `x`, `y` u from the top-left, drawn once by `draw` in u (y down the screen). */
function spr(key: string, k: number, w: number, h: number, x: number, y: number, draw: (g: CanvasRenderingContext2D) => void): Spr {
  if (k !== cacheK) {
    cache.clear();
    cacheK = k;
  }
  let s = cache.get(key);
  if (!s) {
    const c = makeCanvas(w * k, h * k);
    const g = ctx2d(c);
    g.scale(k, k);
    g.translate(x, y);
    draw(g);
    cache.set(key, (s = { c, x, y, w, h }));
  }
  return s;
}

/** Stamps sprite `s` with its origin on the ground point (wx, wy), `lift` u up the screen. */
function blit(g: CanvasRenderingContext2D, v: View, s: Spr, wx: number, wy: number, lift = 0): void {
  const S = v.S;
  g.drawImage(s.c, v.ox + (wx - s.x) * S, v.oy - (wy + lift) * S - s.y * S, s.w * S, s.h * S);
}

/** The sprites' pixel scale: the view's at zoom 1, in quarter steps (zoom pulses stretch them). */
function scaleOf(v: View): number {
  return Math.min(4, Math.ceil(v.k * v.dpr * 4) / 4);
}

/** An ellipse sub-path. */
function ell(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  g.moveTo(x + rx, y);
  g.ellipse(x, y, rx, ry, 0, 0, TAU);
}

function isWall(k: ElKind): boolean {
  return k === 'bramble' || k === 'gate' || k === 'ice';
}
function isCross(k: ElKind): boolean {
  return k === 'gap' || k === 'stream';
}
function isWeather(k: ElKind): boolean {
  return k === 'rain' || k === 'fog';
}

/** The contact edge (§0.2): walls o.y − wallDepth/2, crossings o.y − r, circles o.y − r − touch. */
function edgeOf(o: ElObj): number {
  return isWall(o.kind) ? o.y - O.wallDepth / 2 : isCross(o.kind) ? o.y - o.r : o.y - o.r - O.touch;
}

// ---------------------------------------------------------------------------------------------
// Sprite art (u, origin on the ground point, y down the screen)
// ---------------------------------------------------------------------------------------------

/** Flame tongues along a wall's top: frame f (1..3) sways their heights. */
function flames(g: CanvasRenderingContext2D, xs: readonly number[], y: number, f: number): void {
  for (let p = 0; p < 2; p++) {
    g.fillStyle = p ? '#FFD84A' : '#FF7A1A';
    g.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] as number;
      const h = (12 + 9 * Math.abs(Math.sin(i * 2.3 + f * 1.9))) * (p ? 0.55 : 1);
      const w = p ? 3 : 6;
      const sway = 2 * Math.sin(f * 2 + i);
      g.moveTo(x - w, y);
      g.quadraticCurveTo(x - w, y - h * 0.55, x + sway, y - h);
      g.quadraticCurveTo(x + w, y - h * 0.55, x + w, y);
      g.closePath();
    }
    g.fill();
  }
}

const BRAMBLE = 'F$0 O-31-9 13.1O-15-13 14.1O0-9 13.6O15-13 14.1O31-9 13.1O0-2 41.6,7.6|F$1 O-31-9 11.5O-15-13 12.5O0-9 12O15-13 12.5O31-9 11.5O0-2 40,6|F$2 O-34-13 4,3.2O-18-17 4,3.2O-3-13 4,3.2O12-17 4,3.2O28-13 4,3.2';
const SPIKES = 'M-39-14l-5-3M-28-20l-3-5M-13-25l-1-5M4-21l1-5M18-25l2-5M34-17l5-3M-43-5h-4M43-5h4M-22-8l-3 3M8-5l3 3M24-10l3 2';
/** The gate's eight pointed planks. */
const PLANKS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `M${-33 + i * 8.25} 0v-19l3.6-4 3.6 4v19Z`).join('');
const ICE = 'M-40 2L-38-10L-33-22L-27-11L-22-27L-15-12L-10-20L-4-9L2-25L9-11L14-19L20-8L26-24L32-10L36-17L40 2Z';
const ICE_FACETS = 'F#FFFB M-33-22L-31-8L-27-11ZM-22-27L-19-9L-15-12ZM2-25L5-9L9-11ZM26-24L28-8L32-10Z|S#8CCBF0/1 M-22-27L-21 0M2-25L3 0M26-24L25 0M-10-20L-9 0';

/** A wall (88×56 u, origin 44, 44): f 0 intact, 1..3 burning frames, 4 ice melting. */
function wallArt(g: CanvasRenderingContext2D, kind: ElKind, f: number): void {
  const burnt = f > 0 && kind !== 'ice';
  g.fillStyle = '#0003';
  g.beginPath();
  ell(g, 0, 3, 42, 6);
  g.fill();
  if (kind === 'bramble') {
    // A thorny hedge: dark lumps, lit tops, brown thorns and red berries.
    art(g, `${BRAMBLE}|S#5A3418/2 ${SPIKES}${burnt ? '' : '|F#E8463C O-22-10 2.4O-6-17 2.4O9-7 2.4O24-14 2.4'}`, burnt ? ['#2A1E16', '#4A3A2A', '#6A4A30'] : ['#2B4A1A', '#4E8A2E', '#79B547']);
  } else if (kind === 'gate') {
    // A wooden gate: two posts, pointed planks, two rails.
    art(g, `P$0/#5A3418/1.2 M-41-27h6v29h-6ZM35-27h6v29h-6Z|P$1/#5A3418/1.2 ${PLANKS}|P$2/#5A3418/1.2 M-38-17h76v4h-76ZM-38-7h76v4h-76Z`, burnt ? ['#3A2A20', '#5A3A26', '#4A3020'] : ['#7A4A26', '#E0A866', '#B87A42']);
  } else {
    // Ice: a row of crystal shards (melting: sunk, glassy and dripping over a spreading puddle).
    if (f === 4) {
      g.fillStyle = '#5EC2F299';
      g.beginPath();
      ell(g, 0, 1, 36, 6);
      g.fill();
      g.scale(1, 0.55);
    }
    art(g, `P${f === 4 ? '#BDE8FFCC' : '#CFF0FF'}/#4A9BD9/1.4 ${ICE}|${ICE_FACETS}`, []);
    if (f === 4) art(g, 'F#7FC8FF O-27 6 2,3O-4 8 2,3O20 6 2,3', []);
  }
  if (burnt) flames(g, kind === 'gate' ? [-28, -12, 4, 20, 34] : [-30, -15, 0, 15, 30], kind === 'gate' ? -18 : -14, f);
}

/** A crossing (96 × 2r+12 u, origin 48, r+6): a gap's dark chasm or a stream's water between its banks. */
function crossArt(g: CanvasRenderingContext2D, stream: boolean, r: number): void {
  g.fillStyle = stream ? '#9C7B52' : '#7A5A3E';
  g.beginPath();
  g.roundRect(-47, -r - 4, 94, 2 * r + 8, 8);
  g.fill();
  g.fillStyle = stream ? '#3FA6E0' : '#24182A';
  g.beginPath();
  g.roundRect(-44, -r, 88, 2 * r, 6);
  g.fill();
  if (stream) art(g, 'S#A8E2FF/1.5 M-40-5q4-2.5 8 0M-26 4q4-2.5 8 0M-12-5q4-2.5 8 0M2 4q4-2.5 8 0M16-5q4-2.5 8 0M30 4q4-2.5 8 0', []);
  else {
    // The far wall of the chasm catches some light; pebbles on the rim.
    g.fillStyle = '#4A3446';
    g.beginPath();
    g.roundRect(-44, -r, 88, r * 0.7, [6, 6, 0, 0]);
    g.fill();
    art(g, `F#5E4430 O-40 ${-r - 2} 2O-18 ${r + 2} 1.6O12 ${-r - 2.5} 1.8O37 ${r + 1} 2`, []);
  }
}

/** A vine bridge (36 × 2r+10 u, origin 18, r+5): woven slats between two leafy ropes. */
function bridgeArt(g: CanvasRenderingContext2D, r: number): void {
  const h = r + 5;
  g.fillStyle = '#86B84E';
  g.strokeStyle = '#3E6B24';
  g.lineWidth = 1.1;
  g.beginPath();
  for (let y = -h + 1; y < h - 2; y += 4.5) g.rect(-12, y, 24, 3.2);
  g.fill();
  g.stroke();
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(-13, -h);
  g.lineTo(-13, h);
  g.moveTo(13, -h);
  g.lineTo(13, h);
  g.stroke();
  g.fillStyle = '#A4DA62';
  g.beginPath();
  for (let y = -h + 3; y < h; y += 7) {
    ell(g, -15.5, y, 2.6, 1.5);
    ell(g, 15.5, y + 3.5, 2.6, 1.5);
  }
  g.fill();
}

/** A soil plot (44×60 u, origin 22, 46) with its sapling at growth step s (0 bare .. 5), or burning (f 1..3). */
function plotArt(g: CanvasRenderingContext2D, s: number, f: number): void {
  art(g, 'P#6E4A30/#4A2E1A/1.3 O0 0 17,13|S#563820/1.2 M-10-5h20M-13 0h26M-9 5h18', []);
  if (s > 0) {
    // The sapling grows in steps (a bud from step 4); burning, it chars.
    g.save();
    g.scale(0.45 + 0.2 * s, 0.45 + 0.2 * s);
    art(g, `S$0/1.8 M0 0Q1.5-6 0-12|F$1 M0-7q-6-3-8 1q5 2 8-1ZM0-9q6-3 8 1q-5 2-8-1Z${s > 3 ? 'O0-13.5 2.4' : ''}`, f ? ['#3A2A20', '#4A3A2A'] : ['#4E8A2E', '#7CC24A']);
    g.restore();
  }
  if (f) flames(g, [-8, 4], -2, f);
}

/** The arrival ghosts' and edge markers' colours by weatherGood: harmful, neither, helpful. */
const GOOD_COL = [RED, 0xffffff, GREEN];
/** The cues' marks (u; edge markers in CSS px), '@' their colour. */
const DOUSE = 'F#3FAEF7 M0-11Q5-4 0-2Q-5-4 0-11ZM-5 0L0 5L5 0V3L0 8L-5 3Z';
const WET = 'F#5AB8FF M-9-3Q-6.6 0-9 2Q-11.4 0-9-3ZM0-7Q2.4-4 0-2Q-2.4-4 0-7ZM9-3Q11.4 0 9 2Q6.6 0 9-3Z';
const CHECK = 'S#3FBF3A/3.2 M-5 0L-1 4L6-5';
const CHEVRONS = 'S#FF4D3D/3 M-8 3L0-2L8 3M-8 9L0 4L8 9';
const EDGE = 'P@/#2B2140/1.5 M0 2L10 13H3.5V19H-3.5V13H-10Z';
const ARROW = 'P@/#2B2140/1.5 M13 20L21 25L13 30Z';
const DROP = 'F@ M0-7Q4.5 0 0 3Q-4.5 0 0-7Z';
const PUSH = 'F@ M0-7L11 0L0 7Z';
const MARK_COL = [''];

/** Art `src` stamped at screen (x, y), `k` px per unit, mirrored when `flip` < 0 ('@' is `col`). */
function mark(g: CanvasRenderingContext2D, src: string, x: number, y: number, k: number, col = '#FFFFFF', flip = 1): void {
  MARK_COL[0] = col;
  g.save();
  g.translate(x, y);
  g.scale(flip < 0 ? -k : k, k);
  art(g, src, MARK_COL);
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Drawing passes (the renderer calls them in its draw order)
// ---------------------------------------------------------------------------------------------

/** The plot's sapling step (0 bare .. 5) from its growth; the tree itself is a caster. */
function plotStep(o: ElObj): number {
  return o.casterId >= 0 || o.grown <= 0 ? 0 : 1 + Math.min(4, Math.floor((o.grown / E.sprout.treeMax) * 5));
}

/** A flame frame (1..3) at ≤ 8 fps; one still frame under reduced motion. */
function frameOf(time: number, rm: boolean, i: number): number {
  return rm ? 1 : 1 + ((Math.floor(time * 8) + i) % 3);
}

/** A relay's Tag Stones on the trail: a standing stone with the incoming element's glyph (one sprite each); passed ones fade. */
export function drawTagStones(g: CanvasRenderingContext2D, v: View, s: SimState): void {
  const r = (s.trial as { relays: readonly TrialRelay[] }).relays;
  const k = scaleOf(v);
  for (let i = 0; i < r.length; i++) {
    const wy = relayY(s, i);
    if (wy < v.y0 - 30 || wy > v.y1 + 30) continue;
    const h = (r[i] as TrialRelay).to;
    g.globalAlpha = i < s.relayIdx ? 0.45 : 1;
    blit(g, v, spr('ts' + h, k, 26, 26, 13, 22, (c) => {
      art(c, 'F#3244 O0 0 11,3.5|P#BBC/#436/1.4 M-8 0V-12A8 8 0 0 1 8-12V0Z', []);
      drawGlyph(c, h, 0, -10, 13);
    }), trailX(s.world.trail, wy), wy);
  }
  g.globalAlpha = 1;
}

/**
 * The ground layer, under the shadow layer (so shade falls on it): Drip's widened path over its
 * stretch, crossings and their bridges, plots and saplings, puddles and stones.
 */
export function drawElGround(g: CanvasRenderingContext2D, v: View, s: SimState): void {
  const el = s.el;
  const t = s.trial;
  if (el === null || t === null) return;
  const k = scaleOf(v);
  const S = v.S;
  const tr = s.world.trail;
  // Drip's stretch: the path drawn widened to ±38 u (one fill).
  for (let i = 0; i < t.relays.length; i++) {
    if ((t.relays[i] as { to: string }).to !== 'drip') continue;
    const a = Math.max(relayY(s, i), v.y0 - 40);
    const b = Math.min(i + 1 < t.relays.length ? relayY(s, i + 1) : 1e9, v.y1 + 40);
    if (b <= a) continue;
    g.beginPath();
    for (let j = -1; j < 2; j += 2) {
      for (let y = j < 0 ? a : b; j < 0 ? y < b + 24 : y > a - 24; y -= 24 * j) {
        const yy = Math.max(a, Math.min(b, y));
        g.lineTo(v.ox + (trailX(tr, yy) + j * O.wallHalf) * S, v.oy - yy * S);
      }
    }
    g.fillStyle = 'rgba(150,205,240,0.28)';
    g.fill();
  }
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.state === EL_GONE || o.y < v.y0 - 60 || o.y > v.y1 + 60) continue;
    const kd = o.kind;
    if (isCross(kd)) {
      const st = kd === 'stream';
      const r = o.r;
      const x = o.x;
      blit(g, v, spr(kd + r, k, 96, 2 * r + 12, 48, r + 6, (c) => crossArt(c, st, r)), x, o.y);
      const f = Math.min(1, o.grown / needOf(o));
      if (f > 0) {
        // The bridge grows from the near (south) bank: the bottom f of its sprite.
        const b = spr('br' + r, k, 36, 2 * r + 10, 18, r + 5, (c) => bridgeArt(c, r));
        const ch = b.c.height * f;
        g.drawImage(b.c, 0, b.c.height - ch, b.c.width, ch, v.ox + (x - b.x) * S, v.oy - o.y * S + (b.h * (1 - f) - b.y) * S, b.w * S, b.h * f * S);
      }
    } else if (kd === 'plot' && o.state !== EL_BURNING) {
      const p = plotStep(o);
      blit(g, v, spr(`pl${p}0`, k, 44, 64, 22, 50, (c) => plotArt(c, p, 0)), o.x, o.y);
    } else if (kd === 'puddle') {
      const dry = o.state === EL_BURNING;
      blit(g, v, spr(dry ? 'pd1' : 'pd0', k, 34, 28, 17, 14, (c) => {
        if (dry) c.scale(0.75, 0.75);
        art(c, `P${dry ? '#A8DCF5' : '#5CC0F2'}/#2D88C6/1.4 O0 0 15,11|F#8AD6FA O-2-2 10,6|F#FFFC O-6-4 3.5,1.6|S#FFF8/1 O4 3 6,3.2`, []);
      }), o.x, o.y);
    }
  }
}

/** The walls and hot stones, over the shadow layer and under the casters: intact, burning (three frames), ice melting; Ember's own fires glow. */
export function drawElWalls(g: CanvasRenderingContext2D, v: View, s: SimState, time: number, rm: boolean): void {
  const el = s.el;
  if (el === null) return;
  const k = scaleOf(v);
  const S = v.S;
  if (s.nubs.hero === 'ember' && s.phase === 'day') {
    // Ember's sweet band on the ground: hatched across the trail from `near` to the gate's burn-walk
    // ahead (a bramble's ends at 63 u).
    if (!hatch) {
      const hc2 = makeCanvas(10, 10);
      const hg = ctx2d(hc2);
      hg.strokeStyle = 'rgba(255,160,40,0.6)';
      hg.lineWidth = 3;
      hg.beginPath();
      hg.moveTo(-2, 12);
      hg.lineTo(12, -2);
      hg.stroke();
      hatch = g.createPattern(hc2, 'repeat');
    }
    const ny = s.nubs.y;
    const x0 = v.ox + (trailX(s.world.trail, ny + (E.near + BAND_FAR) / 2) - O.wallHalf - 4) * S;
    const y0 = v.oy - (ny + BAND_FAR) * S;
    g.save();
    g.translate(x0, y0);
    g.fillStyle = hatch as CanvasPattern;
    g.fillRect(0, 0, (2 * O.wallHalf + 8) * S, (BAND_FAR - E.near) * S);
    g.restore();
  }
  for (let i = el.objs.length - 1; i >= 0; i--) {
    const o = el.objs[i] as ElObj;
    if (o.state === EL_GONE || o.y < v.y0 - 40 || o.y > v.y1 + 80) continue;
    if (o.kind === 'stone') {
      // A hot stone glows over the shade (spent: grey).
      const f = o.hit ? 2 : rm ? 0 : Math.floor(time * 3) % 2;
      blit(g, v, spr('st' + f, k, 52, 52, 26, 28, (c) => {
        if (f < 2) c.drawImage(radialSprite('255,120,30', 64, f ? 0.8 : 0.6), -26, -27, 52, 52);
        art(c, `P$0/$1/1.4 O0-2 9.5,7.5|S$2/1.9 M-6-1L-2-3L1 0L5-4M-1-3L0-7${f < 2 ? '|S#FF9A3A/1.3 M-4-14q2-3 0-6M3-15q2-3 0-6' : ''}`, f > 1 ? ['#8C8682', '#4A4440', '#5E5854'] : ['#7A3426', '#2E1414', f ? '#FFF0A0' : '#FFB040']);
      }), o.x, o.y);
      continue;
    }
    // Fires are drawFires'.
    if (!isWall(o.kind) || (o.state === EL_BURNING && o.kind !== 'ice')) continue;
    const kd = o.kind;
    const f = o.state === EL_BURNING ? 4 : 0;
    blit(g, v, spr(kd + f, k, 88, 56, 44, 44, (c) => wallArt(c, kd, f)), o.x, o.y);
  }
  drawFires(g, v, s, k, time, rm, true);
}

/**
 * The burning brambles, gates and plots (three flame frames); Ember's own fires glow. Over the
 * casters (so a canopy never hides a fire), except the ones just ahead of the walker (`near`), which
 * stand behind it with the walls.
 */
function drawFires(g: CanvasRenderingContext2D, v: View, s: SimState, k: number, time: number, rm: boolean, near: boolean): void {
  const objs = (s.el as { objs: ElObj[] }).objs;
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i] as ElObj;
    const d = o.y - s.nubs.y;
    if (o.state !== EL_BURNING || o.kind === 'ice' || o.kind === 'puddle' || o.y < v.y0 - 40 || o.y > v.y1 + 80 || (d > 0 && d < 70) !== near) continue;
    const kd = o.kind;
    const f = frameOf(time, rm, i);
    if (o.paid > 0 && walkerAt(s, edgeOf(o)) === 'ember') {
      // Ember's own fire glows: it will take the flame back when it walks through.
      const r = 62 * v.S;
      g.globalCompositeOperation = 'lighter';
      g.drawImage(radialSprite('255,140,50', 64, 0.6), v.ox + o.x * v.S - r, v.oy - o.y * v.S - r * 0.7, 2 * r, r);
      g.globalCompositeOperation = 'source-over';
    }
    if (kd === 'plot') {
      const p = plotStep(o);
      blit(g, v, spr(`pl${p}${f}`, k, 44, 64, 22, 50, (c) => plotArt(c, p, f)), o.x, o.y);
    } else blit(g, v, spr(kd + f, k, 88, 56, 44, 44, (c) => wallArt(c, kd, f)), o.x, o.y);
  }
}


/** A rain cloud's dark body from its proxy cloud's lumps (u, centre at the origin). */
function rainArt(g: CanvasRenderingContext2D, cl: Cloud): void {
  const l = cl.lumps;
  for (let p = 0; p < 3; p++) {
    g.fillStyle = ['#5D6A85', '#8492AD', '#A9B6CE'][p] as string;
    g.beginPath();
    for (let i = 0; i + 2 < l.length; i += 3) {
      const r = (l[i + 2] as number) + (p === 0 ? 3 : p === 2 ? -0.3 * cl.ry : 0);
      if (r > 0) ell(g, (l[i] as number) - p, -(l[i + 1] as number) + (p === 0 ? 4 : -2 * p), r, r);
    }
    g.fill();
  }
}

/**
 * The air, over the clouds: rain clouds (a body 50 u over the footprint and one path of streaks),
 * fog banks, and the trail veiled beyond a bank that covers it (until the walker leaves its far edge).
 */
export function drawElAir(g: CanvasRenderingContext2D, v: View, s: SimState, time: number, rm: boolean): void {
  const el = s.el;
  if (el === null) return;
  const k = scaleOf(v);
  drawFires(g, v, s, k, time, rm, false);
  const S = v.S;
  const tr = s.world.trail;
  const ny = s.nubs.y;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.state === EL_GONE || !isWeather(o.kind) || o.y + o.r < v.y0 - 40 || o.y - o.r > v.y1 + RAIN_LIFT + 40) continue;
    const ry = E.weather.ryRatio * o.r;
    if (o.kind === 'rain') {
      let cl: Cloud | null = null;
      const cs = s.world.clouds;
      for (let j = cs.length - 1; j >= 0; j--) if ((cs[j] as Cloud).id === o.id) cl = cs[j] as Cloud;
      if (cl === null) continue;
      const c = cl;
      // Streaks fall from the body to the footprint (one path; still under reduced motion).
      g.strokeStyle = 'rgba(120,180,255,0.9)';
      g.lineWidth = Math.max(1.2, 1.8 * S);
      g.beginPath();
      for (let j = 0; j < 9; j++) {
        const fx = ((j * 0.618) % 1) * 2 - 1;
        const fy = ((j * 0.37 + (rm ? 0 : time * 2.2)) % 1) * 2 - 1;
        const x = v.ox + (o.x + fx * 0.8 * o.r) * S;
        const y = v.oy - (o.y + fy * ry * 0.8 + RAIN_LIFT * (1 - (fy + 1) / 2)) * S;
        g.moveTo(x, y);
        g.lineTo(x - 2.5 * S, y + 12 * S);
      }
      g.stroke();
      // The body fades to 0.3 over the walker (as clouds do), so it never hides who walks under it.
      const d = Math.hypot(o.x - s.nubs.x, o.y + RAIN_LIFT - ny - 24) - 0.8 * o.r;
      g.globalAlpha = 0.92 * (0.3 + 0.7 * Math.max(0, Math.min(1, d / 50)));
      // The body (its lumps stay within rx + ry of its centre).
      const b = c.rx + c.ry + 6;
      blit(g, v, spr('rn' + o.id, k, 2 * b, 2 * b, b, b, (cg) => rainArt(cg, c)), o.x, o.y, RAIN_LIFT);
      g.globalAlpha = 1;
    } else {
      const fogS = radialSprite('236,240,246', 128, 0.95, 0.6, 0.85);
      const fx = v.ox + o.x * S;
      const fy = v.oy - o.y * S;
      const tx = trailX(tr, o.y);
      if (Math.abs(o.x - tx) < o.r && ny < o.y + ry) {
        // The trail beyond the bank is veiled while it covers the trail: a soft 0.6 haze over it.
        const top = v.oy - (o.y + 330) * S;
        g.drawImage(radialSprite('236,240,246', 64, 0.6, 0.7, 0.6), v.ox + (tx - 80) * S, top, 160 * S, fy + ry * S - top);
      }
      g.drawImage(fogS, fx - o.r * 1.25 * S, fy - ry * 1.25 * S, o.r * 2.5 * S, ry * 2.5 * S);
      if (!rm) {
        // Two wisps drifting through the bank.
        for (let j = 0; j < 2; j++) {
          const w = Math.sin(time * 0.7 + j * 2.5 + i);
          g.drawImage(fogS, fx + (w * 0.5 - 0.6 + j * 0.6) * o.r * S, fy - (0.5 + 0.3 * j) * ry * S, o.r * 0.9 * S, ry * 0.9 * S);
        }
      }
    }
  }
}

/**
 * How deep the ground point (x, y) lies in an awake fog bank's sprite (0 clear .. 1 well inside): the
 * renderer redraws the walker through the bank at this weight, since fog veils what lies beyond it,
 * never who walks in it.
 */
export function fogOver(s: SimState, x: number, y: number): number {
  const el = s.el;
  if (el === null) return 0;
  let a = 0;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.kind !== 'fog' || o.state === EL_GONE) continue;
    const d = Math.hypot((x - o.x) / o.r, (y - o.y) / (E.weather.ryRatio * o.r));
    a = Math.max(a, Math.min(1, (1.25 - d) / 0.65));
  }
  return a;
}

/** Per object, the ring its cue wears this frame: 0 none, 1 dashed (a target), 3 tap now, 4 too late (2 unused: the button's pick is ringed apart). */
const ring = new Uint8Array(64);
/** The ring passes: an ink underlay, the white dashes, the key's next target, tap now (pulsing), too late. */
const RING_W = [4.5, 2.2, 0, 3, 3.2];
const RING_C = [0x2b2140, 0xffffff, 0, AMBER, RED];
const RING_A = [0.35, 1, 0, 1, 0.95];
const DASHES = [7, 6];
/** Per object, its arrival ghost's x and colour class (−1 none; weatherGood + 1, + 3 above the view). */
const gxs = new Float64Array(64);
const gcs = new Int8Array(64);
/** Per object, its calm-now ghost's x (NaN none). */
const cxs = new Float64Array(64);
/** The pick ring's dashes: Ember's short ones, Sprout's leaf dashes (the dial's). */
const PICK_DASH = [3, 4];
const LEAF_DASH = [8, 6];
const EMBER = 0xff8a1f;
let hatch: CanvasPattern | null = null;

/** The ring around o (screen px): walls and crossings an ellipse across the trail, circles r + 6. */
function ringPath(g: CanvasRenderingContext2D, v: View, o: ElObj, grow: number): void {
  const S = v.S;
  const wide = isWall(o.kind) || isCross(o.kind);
  const x = v.ox + o.x * S;
  const y = v.oy - (o.y + (isWall(o.kind) ? 6 : 0)) * S;
  ell(g, x, y, ((wide ? 48 : o.r + 6) + grow) * S, ((isWall(o.kind) ? 15 : o.r + 6) + grow) * S);
}

/**
 * The telegraphs (§2, §3.6, §7.10), over the world and under the dial: drawn above casters'
 * canopies and clouds so a target under a canopy is still marked. `top` is the play area's top
 * (CSS px, under the HUD band): weather above it gets an edge marker there. Controls v3: `d` is the
 * driver's view (the pick, the arms and jobs, the vane) and (bx, by, br) the button's centre and rim.
 */
export function drawElCues(g: CanvasRenderingContext2D, v: View, s: SimState, time: number, rm: boolean, hc: boolean, dragging: boolean, top: number, d: Readonly<DriveView>, bx: number, by: number, br: number): void {
  const el = s.el;
  if (el === null || s.phase !== 'day') return;
  const S = v.S;
  const tr = s.world.trail;
  const hero = s.nubs.hero;
  const ny = s.nubs.y;
  const objs = el.objs;
  const n = Math.min(objs.length, ring.length);
  const lw = hc ? 1.5 : 1;
  const pulse = rm ? 1 : 0.5 + 0.5 * Math.sin(time * TAU * 2.2);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Each object's ring this frame.
  const tagY = s.trial !== null && s.relayIdx < s.trial.relays.length ? relayY(s, s.relayIdx) : 1e9;
  for (let i = 0; i < n; i++) {
    const o = objs[i] as ElObj;
    ring[i] = 0;
    if (o.state !== 0 || veiled(s, o)) continue;
    const ahead = edgeOf(o) - ny;
    if (ahead > E.range || ahead <= 0) continue;
    if (hero === 'ember') {
      // Walls and Ember's puddles alike: too late (red, crossed), tap now (pulsing), the key's next, a target.
      if (isWall(o.kind) || (o.kind === 'puddle' && ahead >= E.near && edgeOf(o) < tagY && Math.abs(o.x - trailX(tr, o.y)) <= O.puddleR + O.touch)) {
        ring[i] = burnLeft(s, o) < 0 ? 4 : burnSweet(s, o) ? 3 : 1;
      }
    } else if (hero === 'sprout' && ahead >= E.near && (isCross(o.kind) ? !bridged(o) : o.kind === 'plot' && o.casterId < 0)) {
      ring[i] = 1;
    }
  }
  if (hc) {
    // High contrast outlines every object on the ground in ink.
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const o = objs[i] as ElObj;
      if (o.state !== EL_GONE && !isWeather(o.kind) && o.y > v.y0 && o.y < v.y1) ringPath(g, v, o, -4);
    }
    g.lineWidth = 2;
    g.strokeStyle = '#2B2140';
    g.stroke();
  }
  // Dashed rings on an ink underlay; tap now pulsing amber; too late red with a cross.
  for (let p = 0; p < 5; p++) {
    const want = p < 2 ? 1 : p;
    if (p === 2) continue;
    let any = false;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      if (ring[i] !== want) continue;
      any = true;
      const o = objs[i] as ElObj;
      ringPath(g, v, o, p === 3 ? 2 * pulse : 0);
      if (want === 4) {
        const x = v.ox + o.x * S;
        const y = v.oy - (o.y + 6) * S;
        const d = 7 * S;
        g.moveTo(x - d, y - d);
        g.lineTo(x + d, y + d);
        g.moveTo(x + d, y - d);
        g.lineTo(x - d, y + d);
      }
    }
    if (!any) continue;
    if (p === 1) g.setLineDash(DASHES);
    g.lineWidth = ((RING_W[p] as number) + (p === 3 ? 2 * pulse : 0)) * lw;
    g.strokeStyle = cssa(RING_C[p] as number, p === 3 ? 0.75 + 0.25 * pulse : (RING_A[p] as number));
    g.stroke();
    g.setLineDash([]);
  }

  // Controls v3 (§7.2): the button's pick, ringed outside its cue (Ember short dashes, Sprout leaf
  // dashes; amber or red while it is due) with a thin line from the button's rim, every frame before
  // the press; armed walls and queued sites carry a pip in the element's colour.
  const pk = d.pick;
  const burn = d.act === 'burn';
  if (pk >= 0 && pk < n) {
    const o = objs[pk] as ElObj;
    const x = v.ox + o.x * S;
    const y = v.oy - (o.y + (isWall(o.kind) ? 6 : 0)) * S;
    const ang = Math.atan2(y - by, x - bx);
    const col = d.due > 1 ? RED : d.due ? AMBER : burn ? EMBER : LIME;
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(43,33,64,.5)';
    g.beginPath();
    g.moveTo(bx + Math.cos(ang) * br, by + Math.sin(ang) * br);
    g.lineTo(x, y);
    g.stroke();
    for (let p = hc ? 0 : 1; p < 2; p++) {
      g.beginPath();
      ringPath(g, v, o, 6 + (rm ? 0 : 1.5 * pulse));
      if (p) g.setLineDash(burn ? PICK_DASH : LEAF_DASH);
      g.lineWidth = (p ? 3.5 : 7) * lw;
      g.strokeStyle = p ? cssa(col, 1) : '#2B2140';
      g.stroke();
    }
    g.setLineDash([]);
  }
  for (let j = 0; j < 2; j++) {
    const i = d.queue[j] as number;
    if (i < 0 || i >= n) continue;
    const o = objs[i] as ElObj;
    const x = v.ox + o.x * S + 34 * S;
    const y = v.oy - o.y * S - 14 * S;
    g.fillStyle = burn ? '#FF6A45' : '#69D33B';
    g.strokeStyle = '#2B2140';
    g.lineWidth = 2;
    g.beginPath();
    ell(g, x, y, 8 * S, 8 * S);
    g.fill();
    g.stroke();
    drawGlyph(g, burn ? 'ember' : 'sprout', x, y, 11 * S, '#FFFFFF');
  }

  // Fires: a shrinking arc over each burning object (its time left, on a dark track).
  for (let p = 0; p < 2; p++) {
    let any = false;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const o = objs[i] as ElObj;
      if (o.state !== EL_BURNING) continue;
      const x = v.ox + o.x * S;
      const y = v.oy - (o.y + (isWall(o.kind) ? 38 : 22)) * S;
      g.moveTo(x, y - 6 * S);
      g.arc(x, y, 6 * S, -Math.PI / 2, -Math.PI / 2 + (p ? (TAU * o.t) / ((E.ember.burnTicks as Readonly<Record<string, number>>)[o.kind] ?? 60) : TAU));
      any = true;
    }
    if (!any) break;
    g.lineWidth = (p ? 3 : 6) * lw;
    g.strokeStyle = p ? '#FFE7B0' : cssa(0x2b2140, 0.55);
    g.stroke();
  }

  // Sites: the hold's ring filling to its need and the glowing line to it.
  const hold = hero === 'sprout' ? el.hold : -1;
  if (hold >= 0 && hold < n) {
    const o = objs[hold] as ElObj;
    const x = v.ox + o.x * S;
    const y = v.oy - o.y * S;
    g.lineWidth = 3 * lw;
    g.strokeStyle = cssa(LIME, 0.85);
    g.beginPath();
    g.moveTo(v.nx, v.ny - 14 * S);
    g.lineTo(x, y);
    const R = (o.r + 9) * S;
    // A plot's ring closes at treeMin (the Sap that stands a tree); a crossing's at its need.
    const full = o.kind === 'plot' ? E.sprout.treeMin : needOf(o);
    g.moveTo(x, y - R);
    g.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, o.size / full));
    g.stroke();
  }

  // Marks: a douse chevron on Ember's puddles; growth bars and wet drops on growing sites; a check on
  // a bridged crossing ahead, red chevrons and "!" on one that will not be ready.
  g.font = `900 ${Math.round(14 * S)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const k = S * lw;
  for (let i = 0; i < n; i++) {
    const o = objs[i] as ElObj;
    if (o.state === EL_GONE || o.y < v.y0 - 20 || o.y > v.y1 + 20) continue;
    const x = v.ox + o.x * S;
    const y = v.oy - o.y * S;
    if (ring[i] && o.kind === 'puddle') mark(g, DOUSE, x, y - 18 * S, k);
    if (!(isCross(o.kind) || o.kind === 'plot')) continue;
    const need = needOf(o);
    if (o.size > 0 && o.grown < need && o.casterId < 0) {
      // The growth bar: poured (pale) and grown (green) against the site's need; wet: drops over it.
      const w = 26 * S;
      const by = y + (o.r + 6) * S;
      g.fillStyle = cssa(0x2b2140, 0.7);
      g.fillRect(x - w / 2 - 1.5, by - 1.5, w + 3, 5 * S + 3);
      g.fillStyle = '#D8F5B8';
      g.fillRect(x - w / 2, by, w * Math.min(1, o.size / need), 5 * S);
      g.fillStyle = '#5FC33A';
      g.fillRect(x - w / 2, by, w * Math.min(1, o.grown / need), 5 * S);
      if ((o.light & 2) !== 0) mark(g, WET, x, y - (rm ? 14 : 12 + ((time * 1.5) % 1) * 4) * S, k);
    }
    if (!isCross(o.kind) || o.y < ny) continue;
    if (bridged(o)) mark(g, CHECK, x + 30 * S, y, k);
    else if (growLeft(s, o) < 0 && walkerAt(s, o.y) !== 'gust') {
      mark(g, CHEVRONS, x, y + (o.r + 9) * S, k);
      g.fillStyle = cssa(RED, 1);
      g.fillText('!', x - 32 * S, y);
    }
  }

  // Drip: a ghost dot where the finger holds its target.
  if (hero === 'drip' && (dragging || Math.abs(el.dxTarget - el.dx) > 0.5)) {
    g.fillStyle = cssa(0xffffff, 0.75);
    g.beginPath();
    ell(g, v.ox + (trailX(tr, ny) + el.dxTarget) * S, v.ny, 4 * S, 4 * S);
    g.fill();
  }

  // Weather: dashed arrival ghosts in their colours (an ink underlay, then one path per colour), their
  // marks, and edge markers for weather above the play area's top.
  const topY = (v.oy - top) / S;
  for (let i = 0; i < n; i++) {
    const o = objs[i] as ElObj;
    gcs[i] = -1;
    if (o.state === EL_GONE || !o.awake || !isWeather(o.kind) || o.y + E.weather.ryRatio * o.r < ny) continue;
    const t = Math.max(0, arriveTicks(s, o.y));
    gxs[i] = driveWeatherX(s, o, t, d.vane);
    // Controls v3 (§3.5): while the vane is set, where the cloud lands if you calm now.
    cxs[i] = d.vane !== 0 ? driveWeatherX(s, o, t, 0) : NaN;
    gcs[i] = weatherGood(s, o) + 1 + (o.y - E.weather.ryRatio * o.r > topY ? 3 : 0);
  }
  g.setLineDash([3, 6]);
  g.lineWidth = 2 * lw;
  g.strokeStyle = cssa(0xffffff, 0.38);
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const c = cxs[i] as number;
    if ((gcs[i] as number) >= 0 && (gcs[i] as number) < 3 && Number.isFinite(c)) ell(g, v.ox + c * S, v.oy - (objs[i] as ElObj).y * S, (objs[i] as ElObj).r * S, E.weather.ryRatio * (objs[i] as ElObj).r * S);
  }
  g.stroke();
  g.setLineDash([6, 5]);
  for (let c = -1; c < 3; c++) {
    let any = false;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const gc = gcs[i] as number;
      // The ink pass (c −1) underlays the on-screen ghosts (0..2); each colour pass draws its own.
      if (c < 0 ? !(gc >= 0 && gc < 3) : gc !== c) continue;
      const o = objs[i] as ElObj;
      any = true;
      ell(g, v.ox + (gxs[i] as number) * S, v.oy - o.y * S, o.r * S, E.weather.ryRatio * o.r * S);
    }
    if (!any) continue;
    g.lineWidth = (c < 0 ? 4.5 : 2.2) * lw;
    g.strokeStyle = c < 0 ? cssa(0x2b2140, 0.3) : cssa(GOOD_COL[c] as number, 0.95);
    g.stroke();
  }
  g.setLineDash([]);
  for (let i = 0; i < n; i++) {
    const c = gcs[i] as number;
    if (c < 0) continue;
    const o = objs[i] as ElObj;
    const gx = gxs[i] as number;
    const tx = trailX(tr, o.y);
    const col = cssa(GOOD_COL[c % 3] as number, 1);
    const y = v.oy - o.y * S;
    if (c > 2) {
      // Above the view: a chevron at its x on the play area's top, with its drift's arrow.
      const ex = Math.max(v.vx + 26, Math.min(v.vx + v.vw - 26, v.ox + o.x * S));
      const dir = o.drift + (o.kind === 'rain' ? E.gust.rainGain : E.gust.fogGain) * windAt(s);
      mark(g, EDGE, ex, top, 1, col);
      if (Math.abs(dir) > 1) mark(g, ARROW, ex, top, 1, col, dir);
    } else if (c === 0 && Math.abs(gx - tx) < o.r) {
      g.fillStyle = col;
      g.fillText('!', v.ox + tx * S, y);
    } else if (c === 2) {
      // Helpful: a drop mark; off the trail, an arrow toward it ("push me here").
      const x = v.ox + gx * S;
      mark(g, DROP, x, y, k, col);
      if (Math.abs(gx - tx) >= o.r) mark(g, PUSH, x + (tx > gx ? 1 : -1) * (o.r + 4) * S, y, k, col, tx - gx);
    }
  }
  g.lineCap = 'butt';
}
