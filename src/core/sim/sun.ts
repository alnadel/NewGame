// Sun control state machine (V1_PLAN §3.3): idle → dragging → chasing → coasting.
//
// - downEdge: catch (event if |ω| > 90), ω = 0, target = θ, dragging.
// - dragging: target += dTheta; θ follows the target at ≤ maxRate (600°/s; 450 while ε < 15°;
//   300 under reduced motion). The target is kept as an unwrapped lag so a fast 270° swipe never
//   takes the short way round.
// - upEdge: that tick's dTheta is applied first, then
//   ω_rel = clamp(release · smoothstep(200, 600, |release|), ±cap) is stored (cap 360°/s, 180
//   under reduced motion) and the sun keeps chasing the remaining target; once caught up it coasts
//   at ω_rel. Only genuine flicks coast (K1): a lift below 200°/s stops dead, 400°/s coasts at
//   200°/s, 600°/s and up at full speed.
// - coasting: θ += ω·DT, ω *= e^(−3.5/60); idle below 5°/s.
// - key ≠ 0: θ turns by sign(key)·rate·DT and the target snaps to θ, overriding chasing/coasting, so
//   a held key and a held finger add up instead of fighting. The rate ramps linearly from 150 to
//   330°/s over the first 15 held ticks of the same sign (a tap turns 2.5°, a held second ≈ 306°);
//   fine keys (|key| 2, Shift) turn at 90°/s.
// - Detents (every 15°) emit `detent` events; they are feedback only.
//
// Campaign concepts (CAMPAIGN_PLAN §3; SimState.mods and DayParams):
// - heavy: the follow rate is capped at DayParams.sunFollow (220°/s) and friction 0 means no coast;
// - slippery: DayParams.sunFriction e^(−0.35/60) per tick, so a flick coasts a long way;
// - clockwork: on release the finger target snaps to the nearest 30° (no coast): a detent magnet;
// - gusts: from the 8th second of each 8 s of daylight a 2 s gust turns θ at ±25°/s, its sign
//   seeded per gust (sun.gust is ±1 while it blows);
// - dazzle (Mirror Sun): every turn of the input is reversed (dTheta, release and key);
// - lock: from the 7th second of each 7 s of daylight the sun ignores every input for 1.2 s
//   (sun.locked); coasting stops.

import { HEROES } from '../../config/heroes.ts';
import { TUNING } from '../../config/tuning.ts';
import { splitmix32 } from '../../config/rng.ts';
import { angleDiff, smoothstep, wrapDeg } from '../dmath.ts';
import { DT, TICK_HZ } from '../clock.ts';
import type { InputFrame, SimState } from './types.ts';

const S = TUNING.sun;
const DETENTS = 360 / S.detentDeg;
/** 'clockwork' snap step (°). */
const CLOCKWORK_DEG = 30;
/** 'gusts': period, length (ticks) and turn rate (°/s). */
const GUST_PERIOD = 8 * TICK_HZ;
const GUST_TICKS = 2 * TICK_HZ;
const GUST_RATE = 25;
/** 'lock': period and length (ticks). */
const LOCK_PERIOD = 7 * TICK_HZ;
const LOCK_TICKS = Math.round(1.2 * TICK_HZ);

/** 'lock' concept: true when daylight tick `dayTick` is inside a lock window (the sun takes no input). */
export function sunLockedAt(dayTick: number): boolean {
  return dayTick >= LOCK_PERIOD && dayTick % LOCK_PERIOD < LOCK_TICKS;
}

/** 'gusts' concept: the gust index blowing at daylight tick `dayTick`, or −1. */
export function sunGustAt(dayTick: number): number {
  return dayTick >= GUST_PERIOD && dayTick % GUST_PERIOD < GUST_TICKS ? Math.floor(dayTick / GUST_PERIOD) : -1;
}

/** Gust g of a run's seed blows CCW (+1) or CW (−1): one hash bit, no allocation. */
function gustDir(seed: number, g: number): 1 | -1 {
  return (splitmix32((seed ^ Math.imul(g + 1, 0x9e3779b9)) >>> 0) & 1) === 1 ? 1 : -1;
}

/** Ticks of the running daylight clock: the concepts' timers (0 while holding, during the start beat and at night). */
function clockTicks(s: SimState): number {
  return s.phase === 'day' && s.ready === 0 ? s.dayTick : -1;
}

/** The frame a locked sun sees: no input at all. */
const LOCKED_INPUT: Readonly<InputFrame> = Object.freeze({ dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0 });

const mirrored: InputFrame = { ...LOCKED_INPUT };
/** `i` with every turn reversed (the 'dazzle' concept). */
function mirror(i: InputFrame): InputFrame {
  mirrored.dTheta = -i.dTheta;
  mirrored.release = -i.release;
  mirrored.key = -i.key as InputFrame['key'];
  mirrored.down = i.down;
  mirrored.downEdge = i.downEdge;
  mirrored.upEdge = i.upEdge;
  return mirrored;
}

/** Follow rate (°/s) for the current elevation and motion setting. */
export function sunMaxRate(reducedMotion: boolean, eps: number): number {
  if (reducedMotion) return S.maxRateReduced;
  return eps < S.lowSunEps ? S.maxRateLowSun : S.maxRate;
}

/** Advances the sun by one tick of input. Emits catch/detent events into s.events. */
export function updateSun(s: SimState, input: InputFrame): void {
  const sun = s.sun;
  const before = sun.theta;
  const p = s.params;
  let rate = sunMaxRate(s.cfg.reducedMotion, s.eps);
  if (p.sunFollow > 0 && p.sunFollow < rate) rate = p.sunFollow;
  const maxStep = rate * DT;
  const friction = p.sunFriction;
  const mods = s.mods;
  const ct = mods.size > 0 ? clockTicks(s) : -1;

  // 'dazzle' (Mirror Sun): the finger and the keys turn the sun the other way.
  let inp = mods.has('dazzle') ? mirror(input) : input;
  // 'lock': the sun ignores every input and stops dead for LOCK_TICKS at each LOCK_PERIOD of daylight.
  // Elementals v2 (docs/ELEMENTALS_V2.md §4.1): on a Trial it holds the same way while a sun-held
  // element (Drip, Gust) walks and the clock runs.
  const locked = (ct >= 0 && mods.has('lock') && sunLockedAt(ct)) || (s.el !== null && HEROES[s.nubs.hero].sunHeld && clockTicks(s) >= 0);
  if (locked !== sun.locked) {
    sun.locked = locked;
    if (locked) {
      sun.omega = 0;
      sun.omegaRel = 0;
      sun.lag = 0;
      // A Trial's held leg ends a drag too (its lift would never reach the sun).
      if (sun.mode !== 'dragging' || s.el !== null) sun.mode = 'idle';
    } else if (sun.mode === 'dragging' && !input.down && !input.downEdge) {
      sun.mode = 'idle'; // the finger lifted during the lock
    }
  }
  if (locked) inp = LOCKED_INPUT;

  if (inp.downEdge) {
    if (Math.abs(sun.omega) > S.catchOmega) s.events.push({ e: 'catch', omega: sun.omega });
    sun.omega = 0;
    sun.lag = 0;
    sun.mode = 'dragging';
  }
  if (sun.mode === 'dragging') {
    sun.lag += inp.dTheta;
    if (inp.upEdge) {
      const cap = s.cfg.reducedMotion ? S.releaseCapReduced : S.releaseCap;
      // (+ 0 turns the −0 of a slow negative lift into 0.)
      const coast = inp.release * smoothstep(S.flickMin, S.flickFull, Math.abs(inp.release)) + 0;
      sun.omegaRel = friction === 0 ? 0 : coast > cap ? cap : coast < -cap ? -cap : coast;
      if (mods.has('clockwork')) {
        // The detent magnet: the target snaps to the nearest 30° and the sun chases it, no coast.
        const target = sun.theta + sun.lag;
        sun.lag = Math.round(target / CLOCKWORK_DEG) * CLOCKWORK_DEG - sun.theta;
        sun.omegaRel = 0;
      }
      sun.mode = 'chasing';
    }
  }

  if (sun.mode === 'dragging' || sun.mode === 'chasing') {
    const d = sun.lag > maxStep ? maxStep : sun.lag < -maxStep ? -maxStep : sun.lag;
    sun.theta = wrapDeg(sun.theta + d);
    sun.lag -= d;
    if (sun.mode === 'chasing' && Math.abs(sun.lag) < S.chaseDoneDeg) {
      sun.lag = 0;
      sun.omega = sun.omegaRel;
      sun.omegaRel = 0;
      sun.mode = Math.abs(sun.omega) < S.stopOmega ? 'idle' : 'coasting';
      if (sun.mode === 'idle') sun.omega = 0;
    }
  } else if (sun.mode === 'coasting') {
    sun.theta = wrapDeg(sun.theta + sun.omega * DT);
    sun.omega *= friction;
    sun.lag = 0;
    if (Math.abs(sun.omega) < S.stopOmega) {
      sun.omega = 0;
      sun.mode = 'idle';
    }
  }

  if (inp.key !== 0) {
    const sign = inp.key > 0 ? 1 : -1;
    if (sign !== sun.keySign) {
      sun.keySign = sign;
      sun.keyTicks = 0;
    }
    const ramp = sun.keyTicks < S.keyRampTicks ? sun.keyTicks / S.keyRampTicks : 1;
    const rate = inp.key === 2 || inp.key === -2 ? S.keyFine : S.keyRateMin + (S.keyRateMax - S.keyRateMin) * ramp;
    sun.keyTicks++;
    sun.theta = wrapDeg(sun.theta + sign * rate * DT);
    sun.lag = 0;
    sun.omega = 0;
    if (sun.mode === 'chasing' || sun.mode === 'coasting') sun.mode = 'idle';
  } else {
    sun.keySign = 0;
    sun.keyTicks = 0;
  }

  // 'gusts': the wind turns the sun (and the finger target with it) for GUST_TICKS at each GUST_PERIOD.
  const gust = ct >= 0 && mods.has('gusts') ? sunGustAt(ct) : -1;
  if (gust >= 0) {
    const dir = gustDir(s.cfg.seed, gust);
    sun.gust = dir;
    sun.theta = wrapDeg(sun.theta + dir * GUST_RATE * DT);
  } else {
    sun.gust = 0;
  }

  sun.dTheta = angleDiff(sun.theta, before);
  const d = Math.floor(sun.theta / S.detentDeg);
  if (d !== sun.detent) {
    const dir: 1 | -1 = sun.dTheta >= 0 ? 1 : -1;
    let k = sun.detent;
    for (let guard = 0; k !== d && guard < DETENTS; guard++) {
      // Crossing CCW from k to k+1 passes line k+1; CW from k to k−1 passes line k.
      const next = (k + dir + DETENTS) % DETENTS;
      s.events.push({ e: 'detent', dir, index: dir > 0 ? next : k });
      k = next;
    }
    sun.detent = d;
  }
}
