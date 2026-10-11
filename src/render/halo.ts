// The halo dial around Nubs (V1_PLAN §9, CRITIQUE #5/#6): the main control readout. A 40 u ring
// around his ground point carries the sun pointer (never fades), teal safe arcs (solid = shaded
// now, dashed = in 0.6 s), red hatched glare arcs (always shown), 24 detent ticks and a curved
// rotation arrow while dragging, and an inner Chill gauge whose color follows the GDD bands. The
// whole dial fades to 35 % while idle at full Chill. While a ghost-thumb hint plays (V1_PLAN §6.2)
// the dial shows where to put the sun: the target arc pulses, dots mark the way round, and a ghost
// sun glides from the sun pointer into the arc in step with the ghost thumb's swipe.

import { ghostSwipe } from '../game/assist.ts';
import { cssa, hex, type Rgb } from './color.ts';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const TEAL = hex('#2EC4B6');
const RED = hex('#FF5D5D');
const GOLD = hex('#FFC23D');
const BLUE = hex('#5AB8FF');
const INK = hex('#2B2140');

export interface HaloState {
  /** Eased overall alpha (1 active, 0.35 idle at full Chill). */
  alpha: number;
  /** Detent tick flashes (24), seconds remaining. */
  readonly flash: Float32Array;
  /** Smoothed rotation direction for the arrow (+1 CCW, −1 CW) and its strength. */
  arrow: number;
  arrowA: number;
}

export function createHalo(): HaloState {
  return { alpha: 1, flash: new Float32Array(24), arrow: 0, arrowA: 0 };
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
}

const swipe = new Float64Array(2);

export function updateHalo(h: HaloState, dt: number, dragging: boolean, chill: number, dTheta: number): void {
  const target = dragging || chill < 99 ? 1 : 0.35;
  h.alpha += (target - h.alpha) * Math.min(1, dt * (target > h.alpha ? 12 : 3));
  for (let i = 0; i < 24; i++) if ((h.flash[i] as number) > 0) h.flash[i] = Math.max(0, (h.flash[i] as number) - dt);
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

/** Calls fn(startDeg, endDeg) for every circular run of set bins (degrees, inclusive edges ±0.5). */
function runs(mask: Uint8Array, fn: (a0: number, a1: number) => void): void {
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
    fn(0, 360);
    return;
  }
  for (let k = 1; k <= 360; k++) {
    const b = (first + k) % 360;
    const on = mask[b] !== 0;
    if (on && start < 0) start = first + k;
    if (!on && start >= 0) {
      fn(start - 0.5, first + k - 0.5);
      start = -1;
    }
  }
}

function arcPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number): void {
  // World angle θ maps to canvas angle −θ (screen y is down).
  g.moveTo(cx + Math.cos(-a1 * DEG) * r, cy + Math.sin(-a1 * DEG) * r);
  g.arc(cx, cy, r, -a1 * DEG, -a0 * DEG);
}

export function chillColor(chill: number): Rgb {
  return chill >= 50 ? BLUE : chill >= 25 ? GOLD : RED;
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

  if (inp.sunUp) {
    // Safe arcs: lookahead dashed (under), now solid.
    const ga = inp.guideAlpha * A;
    if (ga > 0.01) {
      g.setLineDash([5, 4]);
      g.lineWidth = 3;
      g.strokeStyle = cssa(TEAL, 0.55 * ga);
      g.beginPath();
      runs(inp.next, (a0, a1) => arcPath(g, cx, cy, R + 6, a0, a1));
      g.stroke();
      g.setLineDash([]);
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.strokeStyle = cssa(TEAL, 0.85 * ga);
      g.beginPath();
      runs(inp.now, (a0, a1) => arcPath(g, cx, cy, R, a0 + 0.5, a1 - 0.5));
      g.stroke();
      g.lineCap = 'butt';
    }
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
      runs(inp.glare, (a0, a1) => arcPath(g, cx, cy, R, a0, a1));
      g.stroke();
      g.lineWidth = 1.6;
      g.strokeStyle = cssa(RED, 0.95 * Math.max(0.6, A));
      g.beginPath();
      runs(inp.glare, (a0, a1) => {
        for (let a = a0 + 2; a < a1; a += 6) {
          const c0 = Math.cos(-a * DEG);
          const s0 = Math.sin(-a * DEG);
          const c1 = Math.cos(-(a + 4) * DEG);
          const s1 = Math.sin(-(a + 4) * DEG);
          g.moveTo(cx + c0 * (R - 4), cy + s0 * (R - 4));
          g.lineTo(cx + c1 * (R + 4), cy + s1 * (R + 4));
        }
      });
      g.stroke();
    }
  }

  if (inp.sunUp) drawHint(g, inp, A);

  // Chill gauge inside the ring: clockwise from the top, dashed red when low.
  const chill = Math.max(0, Math.min(100, inp.chill));
  const col = chillColor(chill);
  const gR = R - 7;
  g.lineWidth = 3;
  g.strokeStyle = cssa(INK, 0.1 * A);
  g.beginPath();
  g.arc(cx, cy, gR, 0, TAU);
  g.stroke();
  if (chill > 0.5) {
    if (chill < 25) g.setLineDash([4, 3]);
    g.lineCap = 'round';
    const pulse = chill < 25 ? 0.75 + 0.25 * Math.sin(inp.time * TAU * 1.1) : 1;
    // Quiet while Chill is high (the teal safe arcs lead), loud as it drains.
    const urgency = 0.45 + 0.55 * (1 - chill / 100);
    g.lineWidth = chill < 50 ? 3.5 : 2.5;
    g.strokeStyle = cssa(col, Math.min(1, urgency * 1.1) * Math.max(A, chill < 99 ? 0.9 : A) * pulse);
    g.beginPath();
    g.arc(cx, cy, gR, -Math.PI / 2, -Math.PI / 2 + (TAU * chill) / 100);
    g.stroke();
    g.setLineDash([]);
    g.lineCap = 'butt';
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
