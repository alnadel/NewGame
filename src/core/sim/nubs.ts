// Nubs: shade coverage, Chill, Frost multiplier, PHEW, SWING, the first-run lesson, shade/glare/cloud
// events and the hour log (V1_PLAN §5, V1_1_PLAN CO3-CO4). Per-tick work is allocation-free (scratch
// arrays are module-level; event objects are allocated only when an event fires).

import { TUNING } from '../../config/tuning.ts';
import { DT } from '../clock.ts';
import { angleDiff } from '../dmath.ts';
import { lowerBound } from '../gen/store.ts';
import { SAMPLE_DX, SAMPLE_DY, SAMPLES } from '../intervals.ts';
import type { Caster, Cloud, GazingBall } from '../objects.ts';
import {
  casterReach,
  casterShades,
  cloudAlive,
  cloudOffset,
  cloudShades,
  distToCasterBounds,
  glareActive,
  glareOffset,
  inGlare,
  shadowLength,
} from '../shadows.ts';
import type { HourGlyph } from './events.ts';
import { addFrost } from './mechanics.ts';
import type { SimState } from './types.ts';

const N = TUNING.nubs;
const M = TUNING.mult;
const P = TUNING.phew;
const SW = TUNING.swing;
const L = TUNING.lesson;
const DEEP = TUNING.deep;
const FROST = TUNING.frost;
const MAX_R = TUNING.world.maxCasterRadius;
/** Max distance of a coverage sample from Nubs' center. */
const SAMPLE_R = N.sampleOffset * 1.5;

// Candidate scratch, reused every tick.
const cand: Caster[] = [];
const candClouds: Cloud[] = [];
const cloudHits = new Int32Array(64);
const candBalls: GazingBall[] = [];

/**
 * Computes the per-sample lit weights w, f, the glare count, the caster shading the center sample,
 * the cloud fully covering Nubs (never the Cold Snap's), the glaring ball and deep shade (v1.5:
 * fully shaded with two or more casters or clouds over the center sample), at Nubs' position.
 */
export function computeCoverage(s: SimState): void {
  const nb = s.nubs;
  const w = s.world;
  nb.shaderId = -1;
  nb.cloudId = -1;
  nb.glareBallId = -1;
  nb.deep = false;
  if (!s.sunUp || s.eclipseOn) {
    nb.w.fill(0);
    nb.f = 0;
    nb.glare = 0;
    return;
  }
  const { ux, uy, cot } = s;
  const x = nb.x;
  const y = nb.y;

  let nc = 0;
  const reach = shadowLength(w.maxZ, cot) + SAMPLE_R;
  const cs = w.casters;
  for (let i = lowerBound(cs, y - reach - MAX_R); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > y + reach + MAX_R) break;
    if (distToCasterBounds(c, x, y) > casterReach(c, cot) + SAMPLE_R) continue;
    if (nc < cand.length) cand[nc] = c;
    else cand.push(c);
    nc++;
  }

  let ncl = 0;
  const R0 = cloudOffset(TUNING.shadow.cloudZ, cot);
  for (const cl of w.clouds) {
    if (!cloudAlive(cl, s.tAbs) || ncl >= cloudHits.length) continue;
    const R = cl.z === TUNING.shadow.cloudZ ? R0 : cloudOffset(cl.z, cot);
    const dt = s.tAbs - cl.t0;
    const dx = cl.x0 + cl.vx * dt - x;
    const dy = cl.y0 + cl.vy * dt - y;
    if (Math.abs(Math.sqrt(dx * dx + dy * dy) - R) > cl.rx + SAMPLE_R) continue;
    if (ncl < candClouds.length) candClouds[ncl] = cl;
    else candClouds.push(cl);
    cloudHits[ncl] = 0;
    ncl++;
  }

  let nbl = 0;
  if (glareActive(s.eps)) {
    const g = glareOffset(cot) + TUNING.glare.radius + SAMPLE_R;
    const bs = w.balls;
    for (let i = lowerBound(bs, y - g); i < bs.length; i++) {
      const b = bs[i] as GazingBall;
      if (b.y > y + g) break;
      if (nbl < candBalls.length) candBalls[nbl] = b;
      else candBalls.push(b);
      nbl++;
    }
  }

  let sum = 0;
  let glare = 0;
  let bestShaderD = Infinity;
  /** Shadow sources (casters and clouds) over the center sample. */
  let centerSources = 0;
  for (let k = 0; k < SAMPLES; k++) {
    const px = x + (SAMPLE_DX[k] as number);
    const py = y + (SAMPLE_DY[k] as number);
    let shaded = false;
    for (let i = 0; i < nc; i++) {
      const c = cand[i] as Caster;
      if (!casterShades(c, px, py, ux, uy, cot)) continue;
      shaded = true;
      if (k !== 0) break;
      centerSources++;
      // Center sample: remember the nearest caster providing its shade (death line, Melt Map).
      const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
      if (d < bestShaderD) {
        bestShaderD = d;
        nb.shaderId = c.id;
      }
    }
    for (let i = 0; i < ncl; i++) {
      if (cloudShades(candClouds[i] as Cloud, s.tAbs, px, py, ux, uy, cot)) {
        shaded = true;
        cloudHits[i] = (cloudHits[i] as number) + 1;
        if (k === 0) centerSources++;
      }
    }
    let inG = false;
    for (let i = 0; i < nbl; i++) {
      const b = candBalls[i] as GazingBall;
      if (inGlare(b, px, py, ux, uy, cot)) {
        inG = true;
        nb.glareBallId = b.id;
        break;
      }
    }
    const wk = inG ? 2 : shaded ? 0 : 1;
    nb.w[k] = wk;
    sum += wk;
    if (inG) glare++;
  }
  nb.f = sum / SAMPLES;
  nb.glare = glare;
  nb.deep = sum === 0 && centerSources >= 2 && w.mech.deep;
  for (let i = 0; i < ncl; i++) {
    const cl = candClouds[i] as Cloud;
    if (cloudHits[i] === SAMPLES && cl.kind !== 'snap') {
      nb.cloudId = cl.id;
      break;
    }
  }
}

/**
 * Drain this run applies (Chill/s at f = 1): RunConfig.drain when set (the endless onboarding
 * ramp, a campaign level's drain), else the profile drain; × the day's concept drainMul (1 outside
 * the campaign). Every sim reader of the drain goes through this.
 */
export function effectiveDrain(s: SimState): number {
  return (s.cfg.drain ?? s.params.drain) * s.params.drainMul;
}

/**
 * SWING (A3): full shade handed from one source to another (caster or cloud; one id space) by a
 * ≥ 38° turn of the sun with at most 20 lit ticks between the two, confirmed once the new source has
 * kept Nubs fully shaded for 15 ticks (the event fires on that tick). `deg` is the turn between the
 * last shaded tick under the old source and the first under the new one. SWINGs within 180 ticks
 * chain (×2 … ×5) and pay the chain in Snow, never multiplied. Every full-shade tick re-anchors the
 * source, so continuous shade passing between sources can never fire.
 */
function updateSwing(s: SimState): void {
  const nb = s.nubs;
  if (s.snapTicks > 0) {
    // A Cold Snap shades every angle: no hand-off can be told from it.
    nb.swSrc = -1;
    nb.swPend = -1;
    return;
  }
  const src = nb.f === 0 ? (nb.cloudId >= 0 ? nb.cloudId : nb.shaderId) : -1;
  if (src < 0) {
    nb.swPend = -1;
    return;
  }
  const theta = s.sun.theta;
  if (nb.swPend >= 0) {
    if (src === nb.swPend) nb.swPendTicks++;
    else nb.swPend = -1;
  }
  if (nb.swPend < 0 && nb.swSrc >= 0 && src !== nb.swSrc && s.tick - nb.swTick - 1 <= SW.maxGapTicks) {
    const turn = Math.abs(angleDiff(theta, nb.swTheta));
    if (turn >= SW.minDeg) {
      nb.swPend = src;
      nb.swPendDeg = Math.round(turn);
      nb.swPendTicks = 1;
    }
  }
  nb.swSrc = src;
  nb.swTheta = theta;
  nb.swTick = s.tick;
  if (nb.swPend < 0 || nb.swPendTicks < SW.confirmTicks) return;
  nb.swPend = -1;
  const st = s.stats;
  const chain = s.tick - nb.swLastTick <= SW.chainTicks ? Math.min(SW.chainMax, nb.swChain + 1) : 1;
  nb.swChain = chain;
  nb.swLastTick = s.tick;
  st.swings++;
  st.snow += chain;
  if (chain > st.swingChainBest) st.swingChainBest = chain;
  s.events.push({ e: 'swing', deg: nb.swPendDeg, chain, snow: chain, x: nb.x, y: nb.y });
  addFrost(s, FROST.perSwing);
}

/**
 * First-run lesson pass rule (A5): from the first lit tick after `go`, θ is recorded each time Nubs
 * becomes lit; once θ has turned ≥ 15° from it (any input), 15 consecutive full-shade ticks pass the
 * lesson. A shadow passing over a still sun never passes it.
 */
function updateLesson(s: SimState, lit: boolean, wasLit: boolean): void {
  const theta = s.sun.theta;
  if (lit && (!wasLit || s.lessonFrom < 0)) {
    s.lessonFrom = theta;
    s.lessonSwung = false;
    s.lessonShade = 0;
  }
  if (s.lessonFrom >= 0) {
    if (!s.lessonSwung && Math.abs(angleDiff(theta, s.lessonFrom)) >= L.swingDeg) s.lessonSwung = true;
    if (s.lessonSwung) s.lessonShade = lit ? 0 : s.lessonShade + 1;
    if (s.lessonShade >= L.shadeTicks) {
      endLesson(s);
      s.events.push({ e: 'lessonDone' });
      return;
    }
  }
  if (++s.lessonTicks >= L.maxDaylightTicks) endLesson(s);
}

/** The lesson ends in daylight: its floor holds until holdTicks of daylight, then fades over fadeTicks. */
function endLesson(s: SimState): void {
  s.lessonOn = false;
  s.lessonGrace = Math.max(0, L.holdTicks - s.lessonTicks) + L.fadeTicks;
}

/** The lesson's Chill floor this daylight tick: full while it is on, then the fading grace. */
function lessonFloor(s: SimState): number {
  if (s.lessonOn) return L.floor;
  if (s.lessonGrace <= 0) return 0;
  const g = s.lessonGrace--;
  return g >= L.fadeTicks ? L.floor : (L.floor * g) / L.fadeTicks;
}

/** Daylight tick: Chill, multiplier, PHEW, SWING, lesson, shade/glare/cloud events and timers, hour log. */
export function applyDaylight(s: SimState): void {
  const nb = s.nubs;
  const st = s.stats;
  const f = nb.f;
  const lit = f > 0;
  const wasLit = nb.litSince >= 0;
  const prevChill = nb.chill;

  const deep = nb.deep;
  const regen = deep ? s.params.regen * DEEP.regenMul : s.params.regen;
  let c = nb.chill + (-effectiveDrain(s) * f + regen * Math.max(0, 1 - f)) * DT;
  if (c > nb.maxChill) c = nb.maxChill;
  // The first-run lesson's floor: Nubs is small and sweating, but alive.
  if (s.lessonOn || s.lessonGrace > 0) {
    const floor = lessonFloor(s);
    if (c < floor) c = floor;
  }
  nb.chill = c;
  if (c < st.minChill) st.minChill = c;

  // Shade transitions.
  if (lit && !wasLit) {
    nb.litSince = s.tick;
    s.events.push({ e: 'shadeExit' });
  } else if (!lit && wasLit) {
    const litFor = (s.tick - nb.litSince) * DT;
    nb.litSince = -1;
    s.events.push({ e: 'shadeEnter', litFor });
    // PHEW (V1_PLAN §5.3): Chill was below T when shade was found, Chill was ≥ 40 within the last
    // 3 s, and the latch is open.
    if (prevChill < s.params.phewT && nb.phewOpen && s.tick - nb.highChillTick <= P.armWindowTicks) {
      nb.phewOpen = false;
      st.phews++;
      st.snow += P.snow;
      if (prevChill < st.phewMinChill) st.phewMinChill = prevChill;
      s.events.push({ e: 'phew' });
    }
  }
  if (c >= P.armChill) nb.highChillTick = s.tick;
  if (!nb.phewOpen && c > P.relatchChill) nb.phewOpen = true;
  if (c < N.lowChill && prevChill >= N.lowChill) s.events.push({ e: 'lowChill' });
  if (c < N.lowChill) s.hourHot = true;

  // Frost multiplier.
  if (!lit) {
    nb.litTicks = 0;
    addFrost(s, FROST.perShadeSec * DT * (deep ? DEEP.frostMul : 1));
    if (nb.mult < M.max) {
      nb.shadeTicks += deep ? DEEP.multMul : 1;
      if (nb.shadeTicks >= M.stepTicks) {
        nb.shadeTicks = 0;
        nb.mult++;
        if (nb.mult > st.maxMult) st.maxMult = nb.mult;
        s.events.push({ e: 'multUp', level: nb.mult });
      }
    }
  } else {
    // Frost grace: a lit stretch in which θ turned ≥ 30° (a swing on its way to new shade) resets
    // only after 21 lit ticks instead of 9.
    if (nb.litTicks === 0) nb.litTheta = s.sun.theta;
    nb.litTicks++;
    const reset = Math.abs(angleDiff(s.sun.theta, nb.litTheta)) < M.graceDeg ? M.resetLitTicks : M.graceLitTicks;
    if (nb.litTicks >= reset && (nb.mult > 1 || nb.shadeTicks > 0)) {
      if (nb.mult > 1) s.events.push({ e: 'multReset', from: nb.mult });
      nb.mult = 1;
      nb.shadeTicks = 0;
    }
  }
  nb.x5Ticks = nb.mult === M.max ? nb.x5Ticks + 1 : 0;
  if (nb.x5Ticks * DT > st.x5HoldBest) st.x5HoldBest = nb.x5Ticks * DT;

  // Glare touch and the death line's memory of who shaded Nubs.
  if (nb.glareBallId >= 0) {
    s.glaredBalls.add(nb.glareBallId);
    if (nb.prevGlareBallId < 0) s.events.push({ e: 'glareTouch', ballId: nb.glareBallId });
    st.ballGlared = true;
  }
  nb.prevGlareBallId = nb.glareBallId;
  if (nb.shaderId >= 0) {
    nb.lastShaderId = nb.shaderId;
    nb.lastShaderTick = s.tick;
    nb.lastShaderName = s.world.byId.get(nb.shaderId)?.name ?? '';
  }

  // Cloud rides.
  if (nb.cloudId >= 0) {
    if (!s.captured.has(nb.cloudId)) {
      s.captured.add(nb.cloudId);
      s.events.push({ e: 'cloudCapture', id: nb.cloudId });
    }
    nb.rideTicks = nb.cloudId === nb.rideId ? nb.rideTicks + 1 : 1;
    if (!lit) st.cloudSeconds += DT;
  } else {
    nb.rideTicks = 0;
  }
  nb.rideId = nb.cloudId;
  if (nb.rideTicks * DT > st.cloudRideBest) st.cloudRideBest = nb.rideTicks * DT;

  // Deep shade: deepEnter on entry after reenterTicks out of it; seconds in it.
  if (deep) {
    if (s.tick - nb.deepTick > DEEP.reenterTicks) s.events.push({ e: 'deepEnter' });
    nb.deepTick = s.tick;
    st.deepSeconds = (st.deepSeconds ?? 0) + DT;
  }

  s.hourLit += f * DT;
  st.litTotal += f * DT;
  updateSwing(s);
  if (s.lessonOn) updateLesson(s, lit, wasLit);
}

/** Night tick: Chill refills at +30/s; the multiplier is frozen. */
export function applyNight(s: SimState): void {
  const nb = s.nubs;
  nb.chill = Math.min(nb.maxChill, nb.chill + N.nightRegen * DT);
  nb.litSince = -1;
  nb.rideTicks = 0;
  nb.rideId = -1;
  nb.prevGlareBallId = -1;
  // Nightfall ends the lesson and any shade hand-off.
  nb.swSrc = -1;
  nb.swPend = -1;
  s.lessonOn = false;
  s.lessonGrace = 0;
}

/** Glyph of a finished in-game hour from its lit share (0..1) and the low-Chill flag. */
export function hourGlyph(litShare: number, hot: boolean): HourGlyph {
  if (hot || litShare > TUNING.glyph.hotMin) return 'hot';
  return litShare <= TUNING.glyph.coolMax ? 'cool' : 'warm';
}
