// Sun control state machine (V1_PLAN §3.3): idle → dragging → chasing → coasting.
//
// - downEdge: catch (event if |ω| > 90), ω = 0, target = θ, dragging.
// - dragging: target += dTheta; θ follows the target at ≤ maxRate (600°/s; 450 while ε < 15°;
//   300 under reduced motion). The target is kept as an unwrapped lag so a fast 270° swipe never
//   takes the short way round.
// - upEdge: that tick's dTheta is applied first, then ω_rel = clamp(release, ±cap) is stored and
//   the sun keeps chasing the remaining target; once caught up it coasts at ω_rel.
// - coasting: θ += ω·DT, ω *= e^(−3.5/60); idle below 5°/s.
// - key ≠ 0: θ += key·180·DT and the target snaps to θ, overriding chasing/coasting, so a held key
//   and a held finger add up instead of fighting.
// - Detents (every 15°) emit `detent` events; they are feedback only.

import { TUNING } from '../../config/tuning.ts';
import { angleDiff, wrapDeg } from '../dmath.ts';
import { DT } from '../clock.ts';
import type { InputFrame, SimState } from './types.ts';

const S = TUNING.sun;
const DETENTS = 360 / S.detentDeg;

/** Follow rate (°/s) for the current elevation and motion setting. */
export function sunMaxRate(reducedMotion: boolean, eps: number): number {
  if (reducedMotion) return S.maxRateReduced;
  return eps < S.lowSunEps ? S.maxRateLowSun : S.maxRate;
}

/** Advances the sun by one tick of input. Emits catch/detent events into s.events. */
export function updateSun(s: SimState, inp: InputFrame): void {
  const sun = s.sun;
  const before = sun.theta;
  const maxStep = sunMaxRate(s.cfg.reducedMotion, s.eps) * DT;

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
      sun.omegaRel = inp.release > cap ? cap : inp.release < -cap ? -cap : inp.release;
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
    sun.omega *= S.friction;
    sun.lag = 0;
    if (Math.abs(sun.omega) < S.stopOmega) {
      sun.omega = 0;
      sun.mode = 'idle';
    }
  }

  if (inp.key !== 0) {
    sun.theta = wrapDeg(sun.theta + inp.key * S.keyRate * DT);
    sun.lag = 0;
    sun.omega = 0;
    if (sun.mode === 'chasing' || sun.mode === 'coasting') sun.mode = 'idle';
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
