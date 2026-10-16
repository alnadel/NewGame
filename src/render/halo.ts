// The halo dial around Nubs (V1_PLAN §9, archive/CRITIQUE #5/#6, GR6 dial v2): the main control readout.
// A 40 u ring around his ground point carries the sun pointer (never fades), the teal shade arcs in
// three weights, red hatched glare arcs (always shown), 24 detent ticks and a curved rotation arrow
// while dragging, and an inner Chill gauge. Teal means only shade and red only glare:
//   - lasting (shaded now and in 0.6 s): thick, round caps, a white inner edge: "go here";
//   - ending (shaded now, lit in 0.6 s): thin;
//   - coming (lit now, shaded in 0.6 s): a thin dashed arc just outside the ring;
//   - when nothing lasts, the now-arcs are drawn medium-thick, so the dial is never blank.
// The Chill gauge is frost-white, hidden while Chill ≥ 99, amber below 50 and hot, dashed and
// pulsing below 25. In the sun the ring itself burns hot with a heartbeat glow (v1.3). The whole dial fades to 35 % while idle at full Chill. While a ghost-thumb hint plays
// (V1_PLAN §6.2) the dial shows where to put the sun: the target arc pulses, dots mark the way
// round, and a ghost sun glides from the sun pointer into the arc in step with the ghost thumb.
// v1.5: gold arcs just outside the ring mark the angles that grow a Sunflower bud (GuideState.bud;
// where gold meets teal, one angle does both), and deep shade darkens the ring to indigo with a
// few frost sparkles circling it.
// v1.6 layers (docs/V1_6_PLAN.md §4, drawn only when their mask has something): a darker teal band
// inside the lasting teal where shade is deep (runs ≥ 3° wide); a thin frost-white arc outside the
// ring with a glint running along it where the sun saves a glass flake; during a snap a frost band
// says "covered", the teal on it is the shade Nubs will land in when it ends, and the dashed arcs
// hide; during a Heat Flare's warning an orange rim counts down to the rise and frost-rimmed teal
// marks the shade that holds through it (the glass arc hides).

import { ghostSwipe } from '../game/assist.ts';
import type { MechView } from './renderer.ts';
import { cssa, hex } from './color.ts';
import { drawGlyph } from './glyphs.ts';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const TEAL = hex('#2EC4B6');
const RED = hex('#FF5D5D');
const FROST = hex('#EAF6FF');
const AMBER = hex('#FFA53D');
const INK = hex('#2B2140');
const HOT = hex('#FF6A3D');
const GOLD = hex('#FFC23D');
const DEEP = hex('#1F2A66');
const ICE = hex('#DDF4FF');
const DEEP_TEAL = hex('#0B5F5A');
const ICE_LINE = hex('#7FC4F0');
const FLARE = hex('#FF6A3D');
const DASH = [4, 5];
const NO_DASH: number[] = [];

export interface HaloState {
  /** Eased overall alpha (1 active, 0.35 idle at full Chill). */
  alpha: number;
  /** Detent tick flashes (24), seconds remaining. */
  readonly flash: Float32Array;
  /** Smoothed rotation direction for the arrow (+1 CCW, −1 CW) and its strength. */
  arrow: number;
  arrowA: number;
  /** A SWING: seconds left of its swept arc (0.3 s) and the signed sweep that ended at θ (°). */
  swingT: number;
  swingDeg: number;
  /** Danger (GR v1.3): eased 0..1 while Nubs stands in the sun, and its heartbeat phase (faster as Chill drops). */
  heat: number;
  beat: number;
  /** v1.5 deep shade, eased 0..1, and the sparkles' orbit phase. */
  deep: number;
  deepSpin: number;
}

export const SWING_ARC_S = 0.3;

export function createHalo(): HaloState {
  return { alpha: 1, flash: new Float32Array(24), arrow: 0, arrowA: 0, swingT: 0, swingDeg: 0, heat: 0, beat: 0, deep: 0, deepSpin: 0 };
}

export interface HaloInput {
  cx: number;
  cy: number;
  /** Ring radius in CSS px. */
  R: number;
  theta: number;
  dragging: boolean;
  /** Signed θ change this frame (°), for the arrow. */
  dTheta: number;
  chill: number;
  sunUp: boolean;
  guideAlpha: number;
  now: Uint8Array;
  next: Uint8Array;
  glare: Uint8Array;
  /** Overall multiplier (title/dying fades). */
  fade: number;
  time: number;
  /** Ghost-hint target arc center and width (degrees); NaN center = no hint. */
  hintTarget: number;
  hintWidth: number;
  /** The way round to the target: +1 counter-clockwise, −1 clockwise. */
  hintTurn: number;
  /** Progress (0..1) through the ghost thumb's swipe loop, or −1 (no swipe on screen). */
  hintPhase: number;
  /** Hint visibility (eased 0..1). */
  hintAlpha: number;
  reducedMotion: boolean;
  /** Campaign concepts (v1.2): No Dial hides the shade arcs and the hint; Fog hides the `next` arcs; Sun Lock shows a padlock. */
  blind: boolean;
  hideNext: boolean;
  /** Sun Lock: locked now, or about to lock (the padlock blinks in 0.6 s ahead). */
  locked: boolean;
  lockSoon: boolean;
  /** v1.5: angles that grow a bud now (gold arcs), or null; Nubs in deep shade. */
  bud: Uint8Array | null;
  deep: boolean;
  /** v1.6 layers (the MechView's deepBand, glass, land, flare and the flare's phase), null on the Title. */
  mech: MechView | null;
}

/** A dial input to refill every frame. */
export function createHaloIn(): HaloInput {
  const none = new Uint8Array(360);
  return {
    cx: 0, cy: 0, R: 1, theta: 0, dragging: false, dTheta: 0, chill: 100, sunUp: false, guideAlpha: 0, now: none, next: none, glare: none, fade: 1, time: 0,
    hintTarget: Number.NaN, hintWidth: 0, hintTurn: 0, hintPhase: -1, hintAlpha: 0, reducedMotion: false, blind: false, hideNext: false, locked: false, lockSoon: false,
    bud: null, deep: false, mech: null,
  };
}

const swipe = new Float64Array(2);
const split = createShadeSplit();

export function updateHalo(h: HaloState, dt: number, dragging: boolean, chill: number, dTheta: number, lit: boolean, deep = false): void {
  const target = dragging || chill < 99 || lit || deep ? 1 : 0.35;
  h.deep += ((deep ? 1 : 0) - h.deep) * Math.min(1, dt * (deep ? 8 : 4));
  h.deepSpin = (h.deepSpin + dt * 0.35) % 1;
  // The sun on Nubs turns the ring hot at once and lets go a little slower; the heartbeat runs at
  // 1.2 Hz at full Chill and 3.4 Hz near empty.
  h.heat += ((lit ? 1 : 0) - h.heat) * Math.min(1, dt * (lit ? 14 : 5));
  h.beat = (h.beat + dt * (1.2 + 2.2 * (1 - Math.max(0, Math.min(100, chill)) / 100))) % 1;
  h.alpha += (target - h.alpha) * Math.min(1, dt * (target > h.alpha ? 12 : 3));
  for (let i = 0; i < 24; i++) if ((h.flash[i] as number) > 0) h.flash[i] = Math.max(0, (h.flash[i] as number) - dt);
  h.swingT = Math.max(0, h.swingT - dt);
  if (dragging && Math.abs(dTheta) > 0.05) {
    const dir = dTheta > 0 ? 1 : -1;
    h.arrow = dir;
    h.arrowA = Math.min(1, h.arrowA + dt * 8);
  } else {
    h.arrowA = Math.max(0, h.arrowA - dt * (dragging ? 2 : 6));
  }
}

/** Flashes the tick of detent line `index` (0..23). */
export function flashDetent(h: HaloState, index: number): void {
  const i = ((index % 24) + 24) % 24;
  h.flash[i] = 0.22;
}

/** The shade masks split by how long they last (GR6), refilled every frame. */
export interface ShadeSplit {
  readonly lasting: Uint8Array;
  readonly ending: Uint8Array;
  readonly coming: Uint8Array;
}

export function createShadeSplit(): ShadeSplit {
  return { lasting: new Uint8Array(360), ending: new Uint8Array(360), coming: new Uint8Array(360) };
}

/**
 * lasting = now ∧ next, ending = now ∧ ¬next, coming = next ∧ ¬now. Returns 'lasting' when some
 * shade lasts, 'fallback' when only short shade exists now (the dial then draws `now` medium-thick),
 * 'none' when nothing is shaded now.
 */
export function splitShade(now: Uint8Array, next: Uint8Array, out: ShadeSplit): 'lasting' | 'fallback' | 'none' {
  let anyLasting = false;
  let anyNow = false;
  for (let b = 0; b < 360; b++) {
    const n = now[b] !== 0;
    const x = next[b] !== 0;
    out.lasting[b] = n && x ? 1 : 0;
    out.ending[b] = n && !x ? 1 : 0;
    out.coming[b] = x && !n ? 1 : 0;
    if (n) {
      anyNow = true;
      if (x) anyLasting = true;
    }
  }
  return anyLasting ? 'lasting' : anyNow ? 'fallback' : 'none';
}

/** Circular runs of set bins as [start, end] degree pairs (edges ±0.5), from the last runs() call. */
const runBuf = new Float32Array(2 * 181);

/** Collects every circular run of set bins into runBuf; returns the number of runs. */
function runs(mask: Uint8Array): number {
  let start = -1;
  // Find a gap to start from so wrap-around runs are handled once.
  let first = -1;
  for (let b = 0; b < 360; b++) {
    if (mask[b] === 0) {
      first = b;
      break;
    }
  }
  if (first < 0) {
    runBuf[0] = 0;
    runBuf[1] = 360;
    return 1;
  }
  let n = 0;
  for (let k = 1; k <= 360; k++) {
    const b = (first + k) % 360;
    const on = mask[b] !== 0;
    if (on && start < 0) start = first + k;
    if (!on && start >= 0) {
      runBuf[2 * n] = start - 0.5;
      runBuf[2 * n + 1] = first + k - 0.5;
      n++;
      start = -1;
    }
  }
  return n;
}

/** Adds every run of `mask` to the current path at radius r, each trimmed by `inset` degrees per end. */
function arcRuns(g: CanvasRenderingContext2D, mask: Uint8Array, cx: number, cy: number, r: number, inset: number): void {
  const n = runs(mask);
  for (let i = 0; i < n; i++) {
    const a0 = (runBuf[2 * i] as number) + inset;
    const a1 = (runBuf[2 * i + 1] as number) - inset;
    if (a1 > a0) arcPath(g, cx, cy, r, a0, a1);
  }
}

function arcPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number): void {
  // World angle θ maps to canvas angle −θ (screen y is down).
  g.moveTo(cx + Math.cos(-a1 * DEG) * r, cy + Math.sin(-a1 * DEG) * r);
  g.arc(cx, cy, r, -a1 * DEG, -a0 * DEG);
}

export function drawHalo(g: CanvasRenderingContext2D, h: HaloState, inp: HaloInput): void {
  const { cx, cy, R } = inp;
  const A = h.alpha * inp.fade;
  if (inp.fade <= 0.01) return;
  g.lineCap = 'butt';

  // Track ring with a soft dark backing so it reads on pale ground.
  g.lineWidth = 4;
  g.strokeStyle = cssa(INK, 0.12 * A);
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.stroke();
  g.lineWidth = 1.5;
  g.strokeStyle = cssa(0xffffff, 0.6 * A);
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.stroke();
  const heat = h.heat * inp.fade;
  if (heat > 0.01) {
    // In the sun the ring burns: a hot rim with a glow that beats like a heart (steady under
    // reduced motion), so "Nubs is melting" reads at a glance, before any number does.
    const k = inp.reducedMotion ? 0.6 : Math.max(0, Math.sin(h.beat * TAU)) ** 3;
    g.lineWidth = 12 + 6 * k;
    g.strokeStyle = cssa(HOT, (0.14 + 0.2 * k) * heat);
    g.stroke();
    g.lineWidth = 2.5;
    g.strokeStyle = cssa(HOT, 0.9 * heat);
    g.stroke();
  }

  const deep = h.deep * inp.fade;
  if (deep > 0.01) {
    // Deep shade: the ring sinks to indigo under the teal.
    g.lineWidth = 11;
    g.strokeStyle = cssa(DEEP, 0.38 * deep);
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.stroke();
  }

  if (inp.sunUp && !inp.blind) {
    // Shade arcs by how long the shade lasts (in fog the dial only knows the shade it has now).
    const ga = inp.guideAlpha * A;
    // The v1.6 rule layers (landing, deep band) read a rule, not the teal guide: like the other v1.6
    // rims they stay at max(0.7, A) when Guide Auto has faded the teal away.
    const va = Math.max(0.7, A) * inp.fade;
    const land = inp.mech?.land;
    if (land) {
      // v1.6 landing: a frost band says "covered"; the teal on it is the shade at the snap's end.
      const la = Math.max(ga, va);
      g.lineWidth = 12;
      g.strokeStyle = cssa(ICE, 0.7 * la);
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.stroke();
      g.lineWidth = 2;
      g.strokeStyle = cssa(ICE_LINE, 0.9 * la);
      g.beginPath();
      g.arc(cx, cy, R - 6, 0, TAU);
      g.stroke();
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.strokeStyle = cssa(TEAL, 0.95 * la);
      g.beginPath();
      arcRuns(g, land, cx, cy, R, 1);
      g.stroke();
      g.lineCap = 'butt';
      g.lineWidth = 2;
      g.strokeStyle = cssa(ICE_LINE, 0.9 * la);
      g.beginPath();
      g.arc(cx, cy, R + 6, 0, TAU);
      g.stroke();
    } else {
      const kind = ga > 0.01 ? splitShade(inp.now, inp.hideNext ? inp.now : inp.next, split) : 'none';
      if (ga > 0.01) {
        g.setLineDash(DASH);
        g.lineWidth = 2;
        g.strokeStyle = cssa(TEAL, 0.35 * ga);
        g.beginPath();
        arcRuns(g, split.coming, cx, cy, R + 6, 0);
        g.stroke();
        g.setLineDash(NO_DASH);
        if (kind === 'fallback') {
          g.lineWidth = 5;
          g.lineCap = 'round';
          g.strokeStyle = cssa(TEAL, 0.75 * ga);
          g.beginPath();
          arcRuns(g, inp.now, cx, cy, R, 0.5);
          g.stroke();
        } else if (kind === 'lasting') {
          g.lineWidth = 3;
          g.strokeStyle = cssa(TEAL, 0.45 * ga);
          g.beginPath();
          arcRuns(g, split.ending, cx, cy, R, 0);
          g.stroke();
          g.lineWidth = 8;
          g.lineCap = 'round';
          g.strokeStyle = cssa(TEAL, 0.95 * ga);
          g.beginPath();
          arcRuns(g, split.lasting, cx, cy, R, 1);
          g.stroke();
          // The white inner edge: "go here".
          g.lineWidth = 1;
          g.strokeStyle = cssa(0xffffff, 0.85 * ga);
          g.beginPath();
          arcRuns(g, split.lasting, cx, cy, R - 4.5, 1);
          g.stroke();
        }
      }
      const deepBand = inp.mech?.deepBand;
      if (deepBand) {
        // v1.6 deep shade: a darker band inside the teal, only where it is at least 3° wide; with the
        // teal faded (Guide Auto) it keeps its own thin teal track, so the deep goal stays readable.
        const n = runs(deepBand);
        g.lineCap = 'round';
        if (kind === 'none') {
          g.lineWidth = 7;
          g.strokeStyle = cssa(TEAL, 0.55 * va);
          g.beginPath();
          for (let i = 0; i < n; i++) {
            const a0 = (runBuf[2 * i] as number) + 1;
            const a1 = (runBuf[2 * i + 1] as number) - 1;
            if (a1 - a0 >= 1) arcPath(g, cx, cy, R, a0, a1);
          }
          g.stroke();
        }
        g.lineWidth = 3.5;
        g.strokeStyle = cssa(DEEP_TEAL, 0.95 * Math.max(ga, va));
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const a0 = (runBuf[2 * i] as number) + 1;
          const a1 = (runBuf[2 * i + 1] as number) - 1;
          if (a1 - a0 >= 1) arcPath(g, cx, cy, R, a0, a1);
        }
        g.stroke();
      }
      g.lineCap = 'butt';
    }
  }
  if (inp.sunUp) {
    // Glare arcs: red with hatching, always shown.
    let anyGlare = false;
    for (let b = 0; b < 360; b++) {
      if (inp.glare[b] !== 0) {
        anyGlare = true;
        break;
      }
    }
    if (anyGlare) {
      g.lineWidth = 7;
      g.strokeStyle = cssa(RED, 0.35 * Math.max(0.6, A));
      g.beginPath();
      arcRuns(g, inp.glare, cx, cy, R, 0);
      g.stroke();
      g.lineWidth = 1.6;
      g.strokeStyle = cssa(RED, 0.95 * Math.max(0.6, A));
      g.beginPath();
      const n = runs(inp.glare);
      for (let i = 0; i < n; i++) {
        const a1 = runBuf[2 * i + 1] as number;
        for (let a = (runBuf[2 * i] as number) + 2; a < a1; a += 6) {
          const c0 = Math.cos(-a * DEG);
          const s0 = Math.sin(-a * DEG);
          const c1 = Math.cos(-(a + 4) * DEG);
          const s1 = Math.sin(-(a + 4) * DEG);
          g.moveTo(cx + c0 * (R - 4), cy + s0 * (R - 4));
          g.lineTo(cx + c1 * (R + 4), cy + s1 * (R + 4));
        }
      }
      g.stroke();
    }
  }

  if (inp.sunUp && inp.bud !== null) {
    // Bud arcs: gold just outside the ring, a soft glow under a bright line.
    if (inp.bud.includes(1)) {
      const ba = Math.max(0.7, A) * inp.fade;
      g.lineCap = 'round';
      g.beginPath();
      arcRuns(g, inp.bud, cx, cy, R + 11, 0.5);
      g.lineWidth = 9;
      g.strokeStyle = cssa(GOLD, 0.28 * ba);
      g.stroke();
      g.lineWidth = 3.5;
      g.strokeStyle = cssa(GOLD, 0.95 * ba);
      g.stroke();
      g.lineCap = 'butt';
    }
  }

  if (inp.sunUp && inp.mech) drawV16(g, inp, inp.mech, A, h);

  if (inp.sunUp && !inp.blind) drawHint(g, inp, A);

  if (deep > 0.01) {
    // Three frost glints circling the deep ring, twinkling (still under reduced motion).
    g.fillStyle = cssa(ICE, 0.9 * deep);
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = ((inp.reducedMotion ? 0 : h.deepSpin) + i / 3) * TAU;
      const r = inp.reducedMotion ? 2.6 : 1.8 + Math.sin(inp.time * 7 + i * 2.1) + 1;
      g.moveTo(cx + Math.cos(a) * R + r, cy + Math.sin(a) * R);
      g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, r, 0, TAU);
    }
    g.fill();
  }

  // A SWING: the arc the sun swept to hand the shade over, flashing teal and fading out.
  if (h.swingT > 0 && h.swingDeg !== 0) {
    const a1 = inp.theta;
    const a0 = a1 - h.swingDeg;
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.strokeStyle = cssa(TEAL, 0.6 * (h.swingT / SWING_ARC_S) * inp.fade);
    g.beginPath();
    arcPath(g, cx, cy, R + 3, Math.min(a0, a1), Math.max(a0, a1));
    g.stroke();
    g.lineCap = 'butt';
  }

  // Chill gauge inside the ring, clockwise from the top: frost-white, amber below 50, dashed and
  // pulsing below 25; hidden while Chill is full (the teal arcs lead then).
  const chill = Math.max(0, Math.min(100, inp.chill));
  if (chill < 99) {
    const gR = R - 8;
    const gA = Math.max(A, 0.9);
    g.lineWidth = 3;
    g.strokeStyle = cssa(INK, 0.15 * gA);
    g.beginPath();
    g.arc(cx, cy, gR, 0, TAU);
    g.stroke();
    if (chill > 0.5) {
      if (chill < 25) g.setLineDash([4, 3]);
      g.lineCap = 'round';
      const pulse = chill < 25 ? 0.7 + 0.3 * Math.sin(inp.time * TAU * 1.1) : 1;
      g.strokeStyle = cssa(chill < 25 ? HOT : chill < 50 ? AMBER : FROST, gA * pulse);
      g.beginPath();
      g.arc(cx, cy, gR, -Math.PI / 2, -Math.PI / 2 + (TAU * chill) / 100);
      g.stroke();
      g.setLineDash([]);
      g.lineCap = 'butt';
    }
  }

  // Detent ticks and the rotation arrow while dragging.
  if (inp.dragging || h.arrowA > 0.01) {
    const ta = inp.dragging ? 1 : h.arrowA;
    g.lineWidth = 1.5;
    for (let i = 0; i < 24; i++) {
      const a = -(i * 15) * DEG;
      const fl = (h.flash[i] as number) / 0.22;
      const r0 = R + 9;
      const r1 = R + 13 + 5 * fl;
      g.strokeStyle = cssa(fl > 0 ? 0xffffff : INK, (0.35 + 0.65 * fl) * ta);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
    if (h.arrowA > 0.01 && h.arrow !== 0) {
      // A curved arrow trailing the sun pointer, pointing the way it turns.
      const dir = h.arrow;
      const rr = R + 18;
      const end = inp.theta;
      const start = end - dir * 38;
      g.strokeStyle = cssa(0xffffff, 0.9 * h.arrowA);
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      if (dir > 0) arcPath(g, cx, cy, rr, start, end - 6);
      else arcPath(g, cx, cy, rr, end + 6, start);
      g.stroke();
      // Arrowhead at the leading end.
      const tip = (end - dir * 2) * DEG;
      const tx = cx + Math.cos(-tip) * rr;
      const ty = cy + Math.sin(-tip) * rr;
      // Tangent in the direction of motion on screen.
      const tanX = -Math.sin(-tip) * -dir;
      const tanY = Math.cos(-tip) * -dir;
      const nX = Math.cos(-tip);
      const nY = Math.sin(-tip);
      g.fillStyle = cssa(0xffffff, 0.95 * h.arrowA);
      g.beginPath();
      g.moveTo(tx + tanX * 7, ty + tanY * 7);
      g.lineTo(tx - tanX * 3 + nX * 5, ty - tanY * 3 + nY * 5);
      g.lineTo(tx - tanX * 3 - nX * 5, ty - tanY * 3 - nY * 5);
      g.closePath();
      g.fill();
      g.lineCap = 'butt';
    }
  }

  // The sun pointer: never fades (the fallback when a thumb covers everything else).
  const a = -inp.theta * DEG;
  const sx = cx + Math.cos(a) * R;
  const sy = cy + Math.sin(a) * R;
  const f = inp.fade;
  if (inp.sunUp) {
    sunPointer(g, cx, cy, R, inp.theta, f, inp.time, false);
  } else {
    g.fillStyle = cssa(0xe8ecff, 0.5 * f);
    g.beginPath();
    g.arc(sx, sy, 5, 0, TAU);
    g.fill();
  }
  if (inp.locked || inp.lockSoon) {
    // Sun Lock: a padlock just outside the pointer, on an ink plate; the ring greys over. It
    // blinks in just before the lock (steady under reduced motion), so the lock never surprises.
    const la = inp.locked ? f : f * (inp.reducedMotion ? 0.6 : 0.35 + 0.65 * Math.abs(Math.sin(inp.time * TAU * 2.5)));
    g.strokeStyle = cssa(INK, 0.35 * la);
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.stroke();
    const lx = cx + Math.cos(a) * (R + 20);
    const ly = cy + Math.sin(a) * (R + 20);
    g.fillStyle = cssa(INK, 0.9 * la);
    g.beginPath();
    g.arc(lx, ly, 11, 0, TAU);
    g.fill();
    g.globalAlpha = la;
    drawGlyph(g, 'lock', lx, ly, 15, '#FFFFFF');
    g.globalAlpha = 1;
  }
}

/** The glass arc's rim (px outside R, clear of the bud glow at R + 11) and the narrowest run it draws (°). */
const GLASS_R = 21;
const GLASS_MIN_DEG = 4;

/**
 * The v1.6 rims outside the ring (see the header): a flare's countdown and its shade (they take the
 * glass arc's place), else the glass arc and its glint.
 */
function drawV16(g: CanvasRenderingContext2D, inp: HaloInput, m: MechView, A: number, h: HaloState): void {
  const { cx, cy, R } = inp;
  const f = Math.max(0.7, A) * inp.fade;
  g.lineCap = 'round';
  const ph = m.flarePhase;
  if (ph === 1) {
    // The flare's shade arc names the angles that parry it; when every angle does (a snap covers the
    // hold) there is no decision to draw, and the landing's teal leads (§4 priority): rim only.
    const n = m.flare && !inp.blind ? runs(m.flare) : 0;
    if (m.flare && n > 0 && !(n === 1 && (runBuf[1] as number) - (runBuf[0] as number) >= 360)) {
      g.beginPath();
      arcRuns(g, m.flare, cx, cy, R + 17, 0.5);
      g.lineWidth = 7;
      g.strokeStyle = cssa(0xffffff, 0.95 * f);
      g.stroke();
      g.lineWidth = 3.5;
      g.strokeStyle = cssa(TEAL, f);
      g.stroke();
    }
    g.lineWidth = 2;
    g.strokeStyle = cssa(FLARE, 0.2 * f);
    g.beginPath();
    g.arc(cx, cy, R + 25, 0, TAU);
    g.stroke();
    g.lineWidth = 3.5;
    g.strokeStyle = cssa(FLARE, 0.95 * f);
    g.beginPath();
    g.arc(cx, cy, R + 25, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.005, m.flareLeft));
    g.stroke();
  } else if (m.glass && !inp.blind) {
    const n = runs(m.glass);
    // A thin frost-white arc on its own rim (R + GLASS_R, clear of the gold bud glow), without the
    // slivers under GLASS_MIN_DEG, and one glint: on the run nearest the sun pointer.
    let near = -1;
    let nearD = Infinity;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const b0 = runBuf[2 * i] as number;
      const b1 = runBuf[2 * i + 1] as number;
      if (b1 - b0 < GLASS_MIN_DEG) continue;
      arcPath(g, cx, cy, R + GLASS_R, b0 + 0.5, b1 - 0.5);
      const mid = (b0 + b1) / 2;
      const d = Math.abs(((((mid - inp.theta) % 360) + 540) % 360) - 180);
      if (d < nearD) {
        nearD = d;
        near = i;
      }
    }
    if (near >= 0) {
      g.lineWidth = 6.5;
      g.strokeStyle = cssa(INK, 0.35 * f);
      g.stroke();
      g.lineWidth = 3;
      g.strokeStyle = cssa(0xffffff, f);
      g.stroke();
      // The glint runs along that arc (resting at its middle under reduced motion).
      const u = inp.reducedMotion ? 0.5 : (h.deepSpin * 3) % 1;
      const b0 = runBuf[2 * near] as number;
      const a = -(b0 + ((runBuf[2 * near + 1] as number) - b0) * u) * DEG;
      const x = cx + Math.cos(a) * (R + GLASS_R);
      const y = cy + Math.sin(a) * (R + GLASS_R);
      g.fillStyle = cssa(0xffffff, f);
      g.strokeStyle = cssa(INK, 0.4 * f);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, 3.5, 0, TAU);
      g.stroke();
      g.fill();
    }
  }
  g.lineCap = 'butt';
}

/** The little sun on the ring at θ (rays, disc, an inward notch). `ghost` draws a pale copy. */
function sunPointer(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, theta: number, f: number, time: number, ghost: boolean): void {
  const a = -theta * DEG;
  const sx = cx + Math.cos(a) * R;
  const sy = cy + Math.sin(a) * R;
  g.fillStyle = cssa(ghost ? 0xfff1c2 : 0xffd36b, f);
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const ra = (i * TAU) / 8 + time * 0.6;
    g.moveTo(sx + Math.cos(ra - 0.25) * 6.5, sy + Math.sin(ra - 0.25) * 6.5);
    g.lineTo(sx + Math.cos(ra) * 10.5, sy + Math.sin(ra) * 10.5);
    g.lineTo(sx + Math.cos(ra + 0.25) * 6.5, sy + Math.sin(ra + 0.25) * 6.5);
  }
  g.fill();
  g.fillStyle = cssa(ghost ? 0xffefb0 : 0xffe27a, f);
  g.strokeStyle = cssa(ghost ? 0xffffff : 0xe8a21f, f);
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(sx, sy, 6.5, 0, TAU);
  g.fill();
  g.stroke();
  if (ghost) return;
  // A tiny inward notch so it reads as a pointer.
  g.fillStyle = cssa(0xe8a21f, f);
  g.beginPath();
  const ix = cx + Math.cos(a) * (R - 9);
  const iy = cy + Math.sin(a) * (R - 9);
  g.moveTo(ix, iy);
  g.lineTo(sx + Math.cos(a + 1.9) * 6, sy + Math.sin(a + 1.9) * 6);
  g.lineTo(sx + Math.cos(a - 1.9) * 6, sy + Math.sin(a - 1.9) * 6);
  g.closePath();
  g.fill();
}

/**
 * The ghost hint on the dial: "put the little sun here". The target arc glows and pulses as the ghost
 * sun arrives; dots mark the way round from the sun pointer; the ghost sun glides along them in
 * step with the ghost thumb (or waits in the arc under reduced motion).
 */
function drawHint(g: CanvasRenderingContext2D, inp: HaloInput, A: number): void {
  const ha = inp.hintAlpha * Math.max(0.6, A) * inp.fade;
  if (ha < 0.01 || Number.isNaN(inp.hintTarget) || inp.hintTurn === 0) return;
  const { cx, cy, R } = inp;
  const c = inp.hintTarget;
  const half = Math.max(5, inp.hintWidth / 2);
  const turn = inp.hintTurn > 0 ? 1 : -1;
  // Degrees from the sun pointer to the target center the hinted way round.
  const route = ((((c - inp.theta) * turn) % 360) + 360) % 360;
  let travel = -1;
  let ghostA = 0;
  let pulse: number;
  if (inp.hintPhase >= 0 && !inp.reducedMotion) {
    ghostSwipe(inp.hintPhase, swipe);
    travel = swipe[0] as number;
    ghostA = swipe[1] as number;
    // The arc lights up as the ghost sun arrives in it.
    pulse = Math.max(0, Math.min(1, (travel - 0.6) / 0.4)) * ghostA;
  } else {
    pulse = 0.5 + 0.5 * Math.sin(inp.time * TAU * 0.8);
  }

  // Target arc: a soft wide glow and a bright bracket just outside the ring.
  g.lineCap = 'round';
  g.lineWidth = 16;
  g.strokeStyle = cssa(TEAL, ha * (0.16 + 0.3 * pulse));
  g.beginPath();
  arcPath(g, cx, cy, R, c - half, c + half);
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = cssa(0xffffff, ha * (0.55 + 0.45 * pulse));
  g.beginPath();
  arcPath(g, cx, cy, R + 9, c - half, c + half);
  g.stroke();
  g.lineCap = 'butt';

  // The way round: dots from just past the sun pointer to the arc's near edge.
  const end = route - half;
  if (end > 14) {
    g.fillStyle = cssa(0xffffff, ha * 0.7);
    g.beginPath();
    for (let d = 14; d <= end; d += 10) {
      const t = -(inp.theta + turn * d) * DEG;
      const x = cx + Math.cos(t) * R;
      const y = cy + Math.sin(t) * R;
      g.moveTo(x + 1.7, y);
      g.arc(x, y, 1.7, 0, TAU);
    }
    g.fill();
  }

  // The ghost sun, with a short fading trail so the way it goes reads at a glance.
  if (travel >= 0) {
    if (ghostA > 0.01) {
      const at = inp.theta + turn * route * travel;
      const tail = Math.min(36, route * travel);
      if (tail > 2) {
        g.lineCap = 'round';
        for (let k = 0; k < 3; k++) {
          const a0 = at - turn * tail * ((k + 1) / 3);
          const a1 = at - turn * tail * (k / 3);
          g.lineWidth = 5 - k * 1.3;
          g.strokeStyle = cssa(0xffffff, ha * ghostA * (0.55 - k * 0.16));
          g.beginPath();
          if (turn > 0) arcPath(g, cx, cy, R, a0, a1);
          else arcPath(g, cx, cy, R, a1, a0);
          g.stroke();
        }
        g.lineCap = 'butt';
      }
      sunPointer(g, cx, cy, R, at, ha * ghostA * 0.9, inp.time, true);
    }
  } else if (inp.reducedMotion) {
    sunPointer(g, cx, cy, R, c, ha * (0.45 + 0.35 * pulse), 0, true);
  }
}

const frozen = createShadeSplit();

/**
 * The dial frozen at the melt (the Melt Map's 'frozen' mode): a faint ring, the thick teal shade that
 * lasted (or the shade there was), a dotted short way from the sun pointer to its nearest bin, and
 * the sun pointer at θ.
 */
export function drawFrozenDial(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, theta: number, now: Uint8Array, next: Uint8Array, a: number): void {
  const mode = splitShade(now, next, frozen);
  const mask = mode === 'lasting' ? frozen.lasting : now;
  g.globalAlpha = a;
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.stroke();
  if (mode === 'none') {
    sunPointer(g, cx, cy, R, theta, a, 0, false);
    return;
  }
  g.lineCap = 'round';
  g.strokeStyle = cssa(0x2ec4b6, 0.95 * a);
  g.lineWidth = 6;
  g.beginPath();
  arcRuns(g, mask, cx, cy, R, 1);
  g.stroke();
  g.strokeStyle = cssa(0xffffff, 0.9 * a);
  g.lineWidth = 1;
  g.beginPath();
  arcRuns(g, mask, cx, cy, R - 3, 1);
  g.stroke();
  // The short way from θ to the nearest set bin, in dots.
  let best = 999;
  for (let b = 0; b < 360; b++) {
    if (mask[b] === 0) continue;
    const d = ((b - theta + 540) % 360) - 180;
    if (Math.abs(d) < Math.abs(best)) best = d;
  }
  if (Math.abs(best) >= 6) {
    g.fillStyle = cssa(0xffffff, 0.95 * a);
    const steps = Math.floor(Math.abs(best) / 8);
    for (let k = 1; k <= steps; k++) {
      const ang = -(theta + Math.sign(best) * k * 8) * DEG;
      g.beginPath();
      g.arc(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, 1.8, 0, TAU);
      g.fill();
    }
  }
  sunPointer(g, cx, cy, R, theta, a, 0, false);
}
