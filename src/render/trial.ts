// Elementals v2 (docs/ELEMENTALS_V2.md §2-§3, §7.10): a Trial's world objects and their telegraphs.
// Every object is one cached sprite per kind and state (rebuilt only when the view's pixel scale
// changes) stamped with one drawImage:
//   ground (under the shadow layer): Drip's widened path over its stretch, gaps (a dark chasm) and
//     streams (blue water) with a vine bridge growing across from the near bank, soil plots with a
//     sapling that grows in steps (the tree is a real caster), puddles (drying: paler), hot stones
//     (two shimmer frames; spent: grey);
//   walls (over the shadow layer, under the casters): brambles (thorns), gates (planks), ice
//     (crystal), burning in three flame frames at ≤ 8 fps (one under reduced motion), ice melting;
//     Ember's own fires glow;
//   air (over the clouds): rain clouds drawn 50 u over their footprint (their shade is the sim's
//     proxy cloud) with one stroke path of streaks, fog banks (a radial sprite, the trail beyond a
//     bank veiled at 0.6).
// The cues (over everything in the world, under the dial) follow the walking element: Ember's hatched
// sweet band, dashed target rings, the key's next target solid, a pulsing ring to tap now, red with a
// cross once too late, burn progress arcs and a douse chevron on puddles in its path; Sprout's rings,
// the hold ring filling to the site's need and the glowing line to it; growth bars, wet drops, a
// check on a bridged crossing and red chevrons with "!" on one that will not be ready; Drip's target
// dot; every awake weather object's dashed arrival ghost (green helps, red harms with a "!", white
// neither; a green ghost off the trail points at it) and, above the view, an edge marker with its
// drift. Colour is never the only channel: shapes, hatching, dashes, crosses and marks carry it too.

import {
  arriveTicks,
  bridged,
  burnLeft,
  burnSweet,
  burnTarget,
  EL_BURNING,
  EL_GONE,
  growLeft,
  growTarget,
  needOf,
  relayY,
  trailX,
  TUNING,
  veiled,
  walkerAt,
  weatherGood,
  weatherXAt,
  windAt,
  type Cloud,
  type ElKind,
  type ElObj,
  type SimState,
} from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { cssa } from './color.ts';
import { art } from './heroes.ts';
import { ctx2d, makeCanvas, radialSprite, type Canvas2D } from './sprites.ts';

const E = TUNING.elements;
const O = E.objects;
const TAU = Math.PI * 2;
/** A rain cloud's body floats this far (u, up the screen) over its footprint. */
const RAIN_LIFT = 50;
/** Ember's sweet band reaches the gate's burn-walk ahead (84 ticks at 70 u/s); the bramble's ends at 63. */
const BAND_FAR = (E.ember.burnTicks.gate * 70) / 60;
const BAND_MID = (E.ember.burnTicks.bramble * 70) / 60;
const INK = '#2B2140';
const AMBER = 0xffb347;
const RED = 0xff4d3d;
const GREEN = 0x5fd35a;
const LIME = 0x8bd650;

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

const BRAMBLE = [-31, -9, 11.5, -15, -13, 12.5, 0, -9, 12, 15, -13, 12.5, 31, -9, 11.5];
const SPIKES = 'M-39-14l-5-3M-28-20l-3-5M-13-25l-1-5M4-21l1-5M18-25l2-5M34-17l5-3M-43-5h-4M43-5h4M-22-8l-3 3M8-5l3 3M24-10l3 2';
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
    const cols = burnt ? ['#2A1E16', '#4A3A2A', '#6A4A30'] : ['#2B4A1A', '#4E8A2E', '#79B547'];
    for (let p = 0; p < 3; p++) {
      g.fillStyle = cols[p] as string;
      g.beginPath();
      for (let i = 0; i < BRAMBLE.length; i += 3) {
        const r = BRAMBLE[i + 2] as number;
        if (p < 2) ell(g, BRAMBLE[i] as number, BRAMBLE[i + 1] as number, r + (p ? 0 : 1.6), r + (p ? 0 : 1.6));
        else ell(g, (BRAMBLE[i] as number) - 3, (BRAMBLE[i + 1] as number) - 4, 4, 3.2);
      }
      if (p < 2) ell(g, 0, -2, 40 + (p ? 0 : 1.6), 6 + (p ? 0 : 1.6));
      g.fill();
    }
    art(g, `S#5A3418/2 ${SPIKES}${burnt ? '' : '|F#E8463C O-22-10 2.4O-6-17 2.4O9-7 2.4O24-14 2.4'}`, []);
  } else if (kind === 'gate') {
    // A wooden gate: two posts, pointed planks, two rails and a brace.
    g.lineWidth = 1.2;
    g.strokeStyle = '#5A3418';
    g.fillStyle = burnt ? '#3A2A20' : '#7A4A26';
    g.beginPath();
    g.rect(-41, -27, 6, 29);
    g.rect(35, -27, 6, 29);
    g.fill();
    g.stroke();
    g.fillStyle = burnt ? '#5A3A26' : '#E0A866';
    g.beginPath();
    for (let x = -33; x < 33; x += 8.25) {
      g.moveTo(x, 0);
      g.lineTo(x, -19);
      g.lineTo(x + 3.6, -23);
      g.lineTo(x + 7.2, -19);
      g.lineTo(x + 7.2, 0);
      g.closePath();
    }
    g.fill();
    g.stroke();
    g.fillStyle = burnt ? '#4A3020' : '#B87A42';
    g.beginPath();
    g.rect(-38, -17, 76, 4);
    g.rect(-38, -7, 76, 4);
    g.fill();
    g.stroke();
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
  if (stream) {
    // Ripples running across.
    g.strokeStyle = '#A8E2FF';
    g.lineWidth = 1.5;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const x = -36 + i * 14;
      const y = -r * 0.5 + (i % 2) * r * 0.8;
      g.moveTo(x - 4, y);
      g.quadraticCurveTo(x, y - 2.5, x + 4, y);
    }
    g.stroke();
  } else {
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
    const h = 4 + 5 * s;
    const l = 2 + 1.3 * s;
    g.strokeStyle = f ? '#3A2A20' : '#4E8A2E';
    g.lineWidth = 1.6 + 0.3 * s;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, -1);
    g.quadraticCurveTo(1.5, -h / 2, 0, -h);
    g.stroke();
    g.fillStyle = f ? '#4A3A2A' : '#7CC24A';
    g.beginPath();
    g.ellipse(-l, -h * 0.65, l, l * 0.5, -0.5, 0, TAU);
    g.ellipse(l, -h * 0.8, l, l * 0.5, 0.5, 0, TAU);
    if (s > 3) ell(g, 0, -h - 1.5, 2.4, 2.4);
    g.fill();
  }
  if (f) flames(g, [-8, 4], -2, f);
}

/** The arrival ghosts' and edge markers' colours by weatherGood: harmful, neither, helpful. */
const GOOD_COL = [RED, 0xffffff, GREEN];

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

/**
 * The ground layer, under the shadow layer (so shade falls on it): Drip's widened path over its
 * stretch, crossings and their bridges, plots and saplings, puddles and stones.
 */
export function drawElGround(g: CanvasRenderingContext2D, v: View, s: SimState, time: number, rm: boolean): void {
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
    for (let y = a; ; y += 24) {
      const yy = Math.min(y, b);
      g.lineTo(v.ox + (trailX(tr, yy) - O.wallHalf) * S, v.oy - yy * S);
      if (yy >= b) break;
    }
    for (let y = b; ; y -= 24) {
      const yy = Math.max(y, a);
      g.lineTo(v.ox + (trailX(tr, yy) + O.wallHalf) * S, v.oy - yy * S);
      if (yy <= a) break;
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
      const x = trailX(tr, o.y);
      blit(g, v, spr(kd + r, k, 96, 2 * r + 12, 48, r + 6, (c) => crossArt(c, st, r)), x, o.y);
      const f = Math.min(1, o.grown / needOf(o));
      if (f > 0) {
        // The bridge grows from the near (south) bank: the bottom f of its sprite.
        const b = spr('br' + r, k, 36, 2 * r + 10, 18, r + 5, (c) => bridgeArt(c, r));
        const ch = b.c.height * f;
        g.drawImage(b.c, 0, b.c.height - ch, b.c.width, ch, v.ox + (x - b.x) * S, v.oy - o.y * S + (b.h * (1 - f) - b.y) * S, b.w * S, b.h * f * S);
      }
    } else if (kd === 'plot') {
      const p = plotStep(o);
      const f = o.state === EL_BURNING ? frameOf(time, rm, i) : 0;
      blit(g, v, spr(`pl${p}${f}`, k, 44, 64, 22, 50, (c) => plotArt(c, p, f)), o.x, o.y);
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
  for (let i = el.objs.length - 1; i >= 0; i--) {
    const o = el.objs[i] as ElObj;
    if (o.state === EL_GONE || o.y < v.y0 - 40 || o.y > v.y1 + 80) continue;
    if (o.kind === 'stone') {
      // A hot stone glows over the shade (spent: grey).
      const f = o.hit ? 2 : rm ? 0 : Math.floor(time * 3) % 2;
      blit(g, v, spr('st' + f, k, 52, 52, 26, 28, (c) => {
        if (f < 2) {
          const gr = c.createRadialGradient(0, -1, 3, 0, -1, 25);
          gr.addColorStop(0, `rgba(255,120,30,${f ? 0.8 : 0.6})`);
          gr.addColorStop(1, 'rgba(255,120,30,0)');
          c.fillStyle = gr;
          c.fillRect(-26, -27, 52, 52);
        }
        art(c, f < 2 ? `P#7A3426/#2E1414/1.4 O0-2 9.5,7.5|F#A04A32 O-2-5 5,3|S${f ? '#FFF0A0' : '#FFB040'}/1.9 M-6-1L-2-3L1 0L5-4M-1-3L0-7|S#FF9A3A/1.3 M-4-14q2-3 0-6M3-15q2-3 0-6` : 'P#8C8682/#4A4440/1.3 O0-2 9.5,7.5|S#5E5854/1.4 M-6-1L-2-3L1 0L5-4', []);
      }), o.x, o.y);
      continue;
    }
    if (!isWall(o.kind)) continue;
    const burning = o.state === EL_BURNING;
    const x = trailX(s.world.trail, o.y);
    if (burning && o.paid > 0 && o.kind !== 'ice' && walkerAt(s, edgeOf(o)) === 'ember') {
      // Ember's own fire glows: it will take the flame back when it walks through.
      const r = 62 * v.S;
      g.globalCompositeOperation = 'lighter';
      g.drawImage(radialSprite('255,140,50', 64, 0.6), v.ox + x * v.S - r, v.oy - o.y * v.S - r * 0.7, 2 * r, r);
      g.globalCompositeOperation = 'source-over';
    }
    const f = burning ? (o.kind === 'ice' ? 4 : frameOf(time, rm, i)) : 0;
    const kd = o.kind;
    blit(g, v, spr(kd + f, k, 88, 56, 44, 44, (c) => wallArt(c, kd, f)), x, o.y);
  }
}

let veilBand: Canvas2D | null = null;
const lumpBox = new Float64Array(4);

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
      // The body: its bounds from the lumps.
      lumpBox[0] = lumpBox[1] = 1e9;
      lumpBox[2] = lumpBox[3] = -1e9;
      const l = c.lumps;
      for (let j = 0; j + 2 < l.length; j += 3) {
        const r = (l[j + 2] as number) + 4;
        lumpBox[0] = Math.min(lumpBox[0] as number, (l[j] as number) - r);
        lumpBox[1] = Math.min(lumpBox[1] as number, -(l[j + 1] as number) - r);
        lumpBox[2] = Math.max(lumpBox[2] as number, (l[j] as number) + r);
        lumpBox[3] = Math.max(lumpBox[3] as number, -(l[j + 1] as number) + r + 4);
      }
      const x0 = lumpBox[0] as number;
      const y0 = lumpBox[1] as number;
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
      blit(g, v, spr('rn' + o.id, k, (lumpBox[2] as number) - x0, (lumpBox[3] as number) - y0, -x0, -y0, (cg) => rainArt(cg, c)), o.x, o.y, RAIN_LIFT);
      g.globalAlpha = 1;
    } else {
      const fogS = radialSprite('236,240,246', 128, 0.95, 0.6, 0.85);
      const fx = v.ox + o.x * S;
      const fy = v.oy - o.y * S;
      const tx = trailX(tr, o.y);
      if (Math.abs(o.x - tx) < o.r && ny < o.y + ry) {
        // The trail beyond the bank is veiled while it covers the trail.
        if (!veilBand) {
          // Soft at its sides and its far end, 0.6 over the trail.
          veilBand = makeCanvas(32, 64);
          const vg = ctx2d(veilBand);
          const lg = vg.createLinearGradient(0, 64, 0, 0);
          lg.addColorStop(0, 'rgba(236,240,246,0)');
          lg.addColorStop(0.25, 'rgba(236,240,246,0.6)');
          lg.addColorStop(0.7, 'rgba(236,240,246,0.6)');
          lg.addColorStop(1, 'rgba(236,240,246,0)');
          vg.fillStyle = lg;
          vg.fillRect(0, 0, 32, 64);
          const sg = vg.createLinearGradient(0, 0, 32, 0);
          sg.addColorStop(0, '#0000');
          sg.addColorStop(0.3, '#000');
          sg.addColorStop(0.7, '#000');
          sg.addColorStop(1, '#0000');
          vg.globalCompositeOperation = 'destination-in';
          vg.fillStyle = sg;
          vg.fillRect(0, 0, 32, 64);
        }
        const top = v.oy - (o.y + 330) * S;
        g.drawImage(veilBand, v.ox + (tx - 70) * S, top, 140 * S, fy + ry * S - top);
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

/** Per object, the ring its cue wears this frame (0 none). */
const R_DASH = 1;
const R_NEXT = 2;
const R_NOW = 3;
const R_LATE = 4;
const ring = new Uint8Array(64);
/** Per object, its arrival ghost's x and colour class (−1 none; weatherGood + 1, + 3 above the view). */
const gxs = new Float64Array(64);
const gcs = new Int8Array(64);
let hatch: CanvasPattern | null = null;

/** The ring around o (screen px): walls and crossings an ellipse across the trail, circles r + 6. */
function ringPath(g: CanvasRenderingContext2D, v: View, s: SimState, o: ElObj, grow: number): void {
  const S = v.S;
  const wide = isWall(o.kind) || isCross(o.kind);
  const x = v.ox + (wide ? trailX(s.world.trail, o.y) : o.x) * S;
  const y = v.oy - (o.y + (isWall(o.kind) ? 6 : 0)) * S;
  const ry = (isWall(o.kind) ? 15 : isCross(o.kind) ? o.r + 6 : o.r + 6) + grow;
  ell(g, x, y, (wide ? 48 : o.r + 6) * S + grow * S, ry * S);
}

/**
 * The telegraphs (§2, §3.6, §7.10), over the world and under the dial: drawn above casters'
 * canopies and clouds so a target under a canopy is still marked. `top` is the play area's top
 * (CSS px, under the HUD band): weather above it gets an edge marker there.
 */
export function drawElCues(g: CanvasRenderingContext2D, v: View, s: SimState, time: number, rm: boolean, hc: boolean, dragging: boolean, top: number): void {
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

  if (hero === 'ember') {
    // The sweet band: hatched across the trail from `near` to the gate's burn-walk ahead (a line at the bramble's).
    if (!hatch) {
      const hc2 = makeCanvas(10, 10);
      const hg = ctx2d(hc2);
      hg.strokeStyle = 'rgba(255,170,60,0.55)';
      hg.lineWidth = 3;
      hg.beginPath();
      hg.moveTo(-2, 12);
      hg.lineTo(12, -2);
      hg.stroke();
      hatch = g.createPattern(hc2, 'repeat');
    }
    const by = ny + (E.near + BAND_FAR) / 2;
    const x0 = v.ox + (trailX(tr, by) - O.wallHalf - 4) * S;
    const y0 = v.oy - (ny + BAND_FAR) * S;
    g.save();
    g.translate(x0, y0);
    g.fillStyle = hatch as CanvasPattern;
    g.fillRect(0, 0, (2 * O.wallHalf + 8) * S, (BAND_FAR - E.near) * S);
    g.fillStyle = 'rgba(255,170,60,0.7)';
    g.fillRect(0, (BAND_FAR - BAND_MID) * S - 1, (2 * O.wallHalf + 8) * S, 2);
    g.restore();
  }

  // Each object's ring this frame.
  const keyT = hero === 'ember' ? burnTarget(s, NaN, NaN) : hero === 'sprout' ? growTarget(s, NaN, NaN) : -1;
  const tagY = s.trial !== null && s.relayIdx < s.trial.relays.length ? relayY(s, s.relayIdx) : 1e9;
  for (let i = 0; i < n; i++) {
    const o = objs[i] as ElObj;
    ring[i] = 0;
    if (o.state !== 0 || veiled(s, o)) continue;
    const ahead = edgeOf(o) - ny;
    if (ahead > E.range || ahead <= 0) continue;
    if (hero === 'ember') {
      if (isWall(o.kind)) ring[i] = burnLeft(s, o) < 0 ? R_LATE : burnSweet(s, o) ? R_NOW : i === keyT ? R_NEXT : R_DASH;
      else if (o.kind === 'puddle' && ahead >= E.near && edgeOf(o) < tagY && Math.abs(o.x - trailX(tr, o.y)) <= O.puddleR + O.touch) ring[i] = i === keyT ? R_NEXT : R_DASH;
    } else if (hero === 'sprout' && ahead >= E.near && (isCross(o.kind) ? !bridged(o) : o.kind === 'plot' && o.casterId < 0)) {
      ring[i] = i === keyT ? R_NEXT : R_DASH;
    }
  }
  // Dashed rings on an ink underlay; the key's next target solid white; tap now pulsing amber; too late red with a cross.
  for (let p = 0; p < 5; p++) {
    const want = p < 2 ? R_DASH : p - 0;
    let any = false;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      if (ring[i] !== want) continue;
      any = true;
      const o = objs[i] as ElObj;
      ringPath(g, v, s, o, p === 3 ? 2 * pulse : 0);
      if (want === R_LATE) {
        const x = v.ox + (isWall(o.kind) ? trailX(tr, o.y) : o.x) * S;
        const y = v.oy - (o.y + 6) * S;
        const d = 7 * S;
        g.moveTo(x - d, y - d);
        g.lineTo(x + d, y + d);
        g.moveTo(x + d, y - d);
        g.lineTo(x - d, y + d);
      }
    }
    if (!any) continue;
    if (p === 0) {
      g.lineWidth = 4.5 * lw;
      g.strokeStyle = cssa(0x2b2140, 0.35);
    } else if (p === 1) {
      g.setLineDash([7, 6]);
      g.lineWidth = 2.2 * lw;
      g.strokeStyle = '#FFFFFF';
    } else if (p === 2) {
      g.lineWidth = 3 * lw;
      g.strokeStyle = cssa(0xffffff, 0.95);
    } else if (p === 3) {
      g.lineWidth = (3 + 2 * pulse) * lw;
      g.strokeStyle = cssa(AMBER, 0.75 + 0.25 * pulse);
    } else {
      g.lineWidth = 3.2 * lw;
      g.strokeStyle = cssa(RED, 0.95);
    }
    g.stroke();
    g.setLineDash([]);
  }

  // Fires: a shrinking arc over each burning object (its time left, on a dark track); a douse chevron on Ember's puddles.
  for (let p = 0; p < 2; p++) {
    g.beginPath();
    let arcs = false;
    for (let i = 0; i < n; i++) {
      const o = objs[i] as ElObj;
      if (o.state !== EL_BURNING || o.y < v.y0 || o.y > v.y1) continue;
      const tot = (E.ember.burnTicks as Readonly<Record<string, number>>)[o.kind] ?? 60;
      const x = v.ox + (isWall(o.kind) ? trailX(tr, o.y) : o.x) * S;
      const y = v.oy - (o.y + (isWall(o.kind) ? 38 : 22)) * S;
      g.moveTo(x, y - 6 * S);
      g.arc(x, y, 6 * S, -Math.PI / 2, -Math.PI / 2 + (p ? (TAU * o.t) / tot : TAU));
      arcs = true;
    }
    if (!arcs) break;
    g.lineWidth = (p ? 3 : 6) * lw;
    g.strokeStyle = p ? '#FFE7B0' : cssa(0x2b2140, 0.55);
    g.stroke();
  }
  g.fillStyle = '#3FAEF7';
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const o = objs[i] as ElObj;
    if (hero !== 'ember' || o.kind !== 'puddle' || ring[i] === 0) continue;
    const x = v.ox + o.x * S;
    const y = v.oy - (o.y + 20) * S;
    const d = 5 * S;
    // A drop over a down chevron: "this douses Ember".
    g.moveTo(x, y - 2.2 * d);
    g.quadraticCurveTo(x + d, y - 0.8 * d, x, y - 0.4 * d);
    g.quadraticCurveTo(x - d, y - 0.8 * d, x, y - 2.2 * d);
    g.moveTo(x - d, y);
    g.lineTo(x, y + d);
    g.lineTo(x + d, y);
    g.lineTo(x + d, y + 0.6 * d);
    g.lineTo(x, y + 1.6 * d);
    g.lineTo(x - d, y + 0.6 * d);
    g.closePath();
  }
  g.fill();

  // Sites: the hold's ring filling to its need and the glowing line to it; growth bars and wet drops;
  // a check on a bridged crossing, red chevrons and "!" on one that will not be ready.
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
    const R = (isCross(o.kind) ? o.r + 10 : o.r + 9) * S;
    g.moveTo(x, y - R);
    g.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + (TAU * Math.min(1, o.size / needOf(o))));
    g.stroke();
  }
  g.font = `900 ${Math.round(13 * S)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let checks = false;
  let late = false;
  for (let i = 0; i < n; i++) {
    const o = objs[i] as ElObj;
    if (o.state === EL_GONE || !(isCross(o.kind) || o.kind === 'plot') || o.y < v.y0 - 20 || o.y > v.y1 + 20) continue;
    const need = needOf(o);
    const x = v.ox + o.x * S;
    const y = v.oy - o.y * S;
    if (o.size > 0 && o.grown < need && !(o.kind === 'plot' && o.casterId >= 0)) {
      // The growth bar: poured (pale) and grown (green) against the site's need.
      const w = 26 * S;
      const by = y + (isCross(o.kind) ? o.r + 8 : o.r + 5) * S;
      g.fillStyle = cssa(0x2b2140, 0.7);
      g.beginPath();
      g.roundRect(x - w / 2 - 1.5, by - 1.5, w + 3, 5 * S + 3, 3 * S);
      g.fill();
      g.fillStyle = '#D8F5B8';
      g.fillRect(x - w / 2, by, (w * Math.min(1, o.size / need)), 5 * S);
      g.fillStyle = '#5FC33A';
      g.fillRect(x - w / 2, by, (w * Math.min(1, o.grown / need)), 5 * S);
      if ((o.light & 2) !== 0) {
        // Wet: drops over the site.
        g.fillStyle = '#5AB8FF';
        g.beginPath();
        for (let j = -1; j <= 1; j++) {
          const dx = x + j * 9 * S;
          const dy = y - (14 + (j & 1) * 4 + (rm ? 0 : ((time * 1.5 + j * 0.3) % 1) * 4)) * S;
          g.moveTo(dx, dy - 3.5 * S);
          g.quadraticCurveTo(dx + 2.4 * S, dy, dx, dy + 1.5 * S);
          g.quadraticCurveTo(dx - 2.4 * S, dy, dx, dy - 3.5 * S);
        }
        g.fill();
      }
    }
    if (!isCross(o.kind) || o.y < ny) continue;
    if (bridged(o)) checks = true;
    else if (growLeft(s, o) < 0 && walkerAt(s, o.y) !== 'gust') late = true;
  }
  for (let p = 0; p < 2; p++) {
    if (p === 0 ? !checks : !late) continue;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const o = objs[i] as ElObj;
      if (o.state === EL_GONE || !isCross(o.kind) || o.y < ny || o.y > v.y1 + 20 || bridged(o) !== (p === 0)) continue;
      if (p === 1 && (growLeft(s, o) >= 0 || walkerAt(s, o.y) === 'gust')) continue;
      const x = v.ox + (trailX(tr, o.y) + 30) * S;
      const y = v.oy - o.y * S;
      const d = 5 * S;
      if (p === 0) {
        g.moveTo(x - d, y);
        g.lineTo(x - d * 0.2, y + d * 0.8);
        g.lineTo(x + d * 1.2, y - d);
      } else {
        // Red chevrons pointing at the gap from the near side, and a "!".
        for (let j = 0; j < 2; j++) {
          const cy = y + (o.r + 9 + j * 6) * S;
          const cx = v.ox + trailX(tr, o.y) * S;
          g.moveTo(cx - 8 * S, cy + 3 * S);
          g.lineTo(cx, cy - 2 * S);
          g.lineTo(cx + 8 * S, cy + 3 * S);
        }
        g.fillStyle = cssa(RED, 1);
        g.fillText('!', x - 60 * S, y);
      }
    }
    g.lineWidth = 3.2 * lw;
    g.strokeStyle = p === 0 ? '#3FBF3A' : cssa(RED, 1);
    g.stroke();
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
    gxs[i] = weatherXAt(s, o, Math.max(0, arriveTicks(s, o.y)));
    gcs[i] = weatherGood(s, o) + 1 + (o.y - E.weather.ryRatio * o.r > topY ? 3 : 0);
  }
  g.setLineDash([6, 5]);
  for (let c = -1; c < 3; c++) {
    let any = false;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const o = objs[i] as ElObj;
      if (gcs[i] !== c && !(c < 0 && (gcs[i] as number) >= 0 && (gcs[i] as number) < 3)) continue;
      any = true;
      ell(g, v.ox + (gxs[i] as number) * S, v.oy - o.y * S, o.r * S, E.weather.ryRatio * o.r * S);
    }
    if (!any) continue;
    g.lineWidth = (c < 0 ? 4.5 : 2.2) * lw;
    g.strokeStyle = c < 0 ? cssa(0x2b2140, 0.3) : cssa(GOOD_COL[c] as number, 0.95);
    g.stroke();
  }
  g.setLineDash([]);
  g.strokeStyle = INK;
  g.lineWidth = 1.5;
  for (let c = 0; c < 6; c++) {
    let any = false;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      if (gcs[i] !== c) continue;
      const o = objs[i] as ElObj;
      const gx = gxs[i] as number;
      const tx = trailX(tr, o.y);
      const x = v.ox + gx * S;
      const y = v.oy - o.y * S;
      if (c > 2) {
        // Above the view: a chevron at its x on the play area's top, with its drift's arrow.
        const ex = Math.max(v.vx + 14, Math.min(v.vx + v.vw - 14, v.ox + o.x * S));
        const dir = o.drift + (o.kind === 'rain' ? E.gust.rainGain : E.gust.fogGain) * windAt(s);
        g.moveTo(ex, top + 2);
        g.lineTo(ex + 10, top + 13);
        g.lineTo(ex + 3.5, top + 13);
        g.lineTo(ex + 3.5, top + 19);
        g.lineTo(ex - 3.5, top + 19);
        g.lineTo(ex - 3.5, top + 13);
        g.lineTo(ex - 10, top + 13);
        g.closePath();
        if (Math.abs(dir) > 1) {
          const d = dir > 0 ? 1 : -1;
          g.moveTo(ex + d * 13, top + 20);
          g.lineTo(ex + d * 21, top + 25);
          g.lineTo(ex + d * 13, top + 30);
          g.closePath();
        }
        any = true;
      } else if (c === 0 && Math.abs(gx - tx) < o.r) {
        g.fillStyle = cssa(RED, 1);
        g.fillText('!', v.ox + tx * S, y);
      } else if (c === 2) {
        // Helpful: a drop mark; off the trail, an arrow toward it ("push me here").
        g.moveTo(x, y - 7 * S);
        g.quadraticCurveTo(x + 4.5 * S, y, x, y + 3 * S);
        g.quadraticCurveTo(x - 4.5 * S, y, x, y - 7 * S);
        if (Math.abs(gx - tx) >= o.r) {
          const d = tx > gx ? 1 : -1;
          const ax = x + d * (o.r + 4) * S;
          g.moveTo(ax, y - 7 * S);
          g.lineTo(ax + d * 11 * S, y);
          g.lineTo(ax, y + 7 * S);
          g.closePath();
        }
        any = true;
      }
    }
    if (!any) continue;
    g.fillStyle = cssa(GOOD_COL[c % 3] as number, 1);
    g.fill();
    if (c > 2) g.stroke();
  }
  g.lineCap = 'butt';
}
