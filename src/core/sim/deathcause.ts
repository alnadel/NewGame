// Death line (V1_PLAN §10): the first matching cause of glare, cloud, gap or plain.

import { TUNING } from '../../config/tuning.ts';
import { dayTicks, elevation, exactClock, TICK_HZ } from '../clock.ts';
import { tanD } from '../dmath.ts';
import { liftElevation, worldYAtDayTick } from '../gen/plan.ts';
import { lowerBound } from '../gen/store.ts';
import { BINS, markCaster, markEllipse, SAMPLE_DX, SAMPLE_DY, SAMPLES } from '../intervals.ts';
import type { Caster, Cloud } from '../objects.ts';
import { cloudAlive, cloudOffset } from '../shadows.ts';
import { trailX } from '../trail.ts';
import type { DeathInfo } from './events.ts';
import type { SimState } from './types.ts';

const D = TUNING.death;
const RECENT = D.recentTicks;
const mask = new Uint8Array(BINS);
const count = new Uint8Array(BINS);

/** Value `field` (0 θ, 1 Σw, 2 glare weight, 3 glare ball) recorded `ago` ticks back (ago ≥ 1 = last tick). */
function recent(s: SimState, ago: number, field: number): number {
  const i = (s.recentCount - ago) % RECENT;
  return s.recent[i * 4 + field] as number;
}

/** Glare made up at least half of the lit weight over the last 60 ticks. Returns the ball id or −1. */
function glareCause(s: SimState): number {
  const n = Math.min(D.glareWindowTicks, s.recentCount, RECENT);
  let lit = 0;
  let glare = 0;
  let ball = -1;
  for (let a = 1; a <= n; a++) {
    lit += recent(s, a, 1);
    glare += recent(s, a, 2);
    const b = recent(s, a, 3);
    if (ball < 0 && b >= 0) ball = b;
  }
  return lit > 0 && glare / lit >= D.glareShare && ball >= 0 ? ball : -1;
}

/**
 * One second before death, some cloud could have fully shaded Nubs at an azimuth within
 * ±min(180, cloudTurnRate × cloudTurnSec) = ±60° of the sun's azimuth then (GDD §10 row 3).
 */
function cloudCause(s: SimState): boolean {
  const back = D.cloudLookbackTicks;
  // recent(s, 1) is the death tick itself, so the tick `back` ticks earlier is ago = back + 1.
  if (s.recentCount <= back || s.dayTick - back < 0) return false;
  const dt = s.dayTick - back;
  const y = worldYAtDayTick(s.world, s.day, dt);
  const x = trailX(s.world.trail, y);
  const eps = liftElevation(s.world, s.params, s.tickAbs - back, elevation(s.params, dt / TICK_HZ));
  if (eps <= 0) return false;
  const tAbs = s.tAbs - back / TICK_HZ;
  const R = cloudOffset(TUNING.shadow.cloudZ, 1 / tanD(eps));
  const theta = recent(s, back + 1, 0);
  const reach = Math.min(180, D.cloudTurnRate * D.cloudTurnSec);
  for (const cl of s.world.clouds as readonly Cloud[]) {
    if (!cloudAlive(cl, tAbs) || cl.kind === 'snap') continue;
    const ddt = tAbs - cl.t0;
    const cx = cl.x0 + cl.vx * ddt;
    const cy = cl.y0 + cl.vy * ddt;
    count.fill(0);
    for (let k = 0; k < SAMPLES; k++) {
      mask.fill(0);
      markEllipse(mask, x + (SAMPLE_DX[k] as number), y + (SAMPLE_DY[k] as number), R, cx, cy, cl.rx, cl.ry);
      for (let b = 0; b < BINS; b++) count[b] = (count[b] as number) + (mask[b] as number);
    }
    for (let b = 0; b < BINS; b++) {
      if (count[b] !== SAMPLES) continue;
      let d = b - theta;
      d -= 360 * Math.round(d / 360);
      if (Math.abs(d) <= reach) return true;
    }
  }
  return false;
}

/** The nearest caster ahead whose shade can cover Nubs' position 0.5 s ahead at some azimuth. */
function nextCaster(s: SimState, skipId: number): Caster | null {
  const ahead = s.dayTick + Math.round(D.gapAheadSec * TICK_HZ);
  if (ahead >= dayTicks(s.day)) return null;
  const y = worldYAtDayTick(s.world, s.day, ahead);
  const x = trailX(s.world.trail, y);
  const eps = liftElevation(s.world, s.params, s.tickAbs - s.dayTick + ahead, elevation(s.params, ahead / TICK_HZ));
  const cot = 1 / tanD(eps);
  const cs = s.world.casters;
  const limit = s.nubs.y + TUNING.shadow.capLen + TUNING.world.maxCasterRadius;
  for (let i = lowerBound(cs, s.nubs.y); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > limit) break;
    if (c.id === skipId) continue;
    mask.fill(0);
    markCaster(mask, c, x, y, cot);
    for (let b = 0; b < BINS; b++) if (mask[b] === 1) return c;
  }
  return null;
}

/** Builds the DeathInfo for a run that just melted (call on the death tick). */
export function deathCause(s: SimState): DeathInfo {
  const nb = s.nubs;
  const time = exactClock(s.day, s.dayTick);
  const info: DeathInfo = {
    day: s.day,
    tDay: s.tDay,
    minutes: s.minutes,
    time,
    x: nb.x,
    y: nb.y,
    cause: 'plain',
    line: `Melted by You at ${time}.`,
  };

  const ballId = glareCause(s);
  if (ballId >= 0) {
    const ball = s.world.balls.find((b) => b.id === ballId);
    info.cause = 'glare';
    info.ballId = ballId;
    info.line = `Glared by ${ball ? ball.name : 'a Gazing Ball'} at ${time}.`;
    return info;
  }

  if (cloudCause(s)) {
    info.cause = 'cloud';
    info.line = `Melted by You at ${time}. That cloud was right there.`;
    return info;
  }

  const hasLast = nb.lastShaderId >= 0 && s.tick - nb.lastShaderTick <= D.gapLastSec * TICK_HZ;
  const next = nextCaster(s, hasLast ? nb.lastShaderId : -1);
  if (hasLast || next) {
    info.cause = 'gap';
    if (hasLast) {
      info.lastId = nb.lastShaderId;
      info.lastName = nb.lastShaderName;
    }
    if (next) {
      info.nextId = next.id;
      info.nextName = next.name;
    }
    if (hasLast && next) info.line = `Melted by You at ${time}, between ${nb.lastShaderName} and ${next.name}.`;
    else if (hasLast) info.line = `Melted by You at ${time}, just past ${nb.lastShaderName}.`;
    else if (next) info.line = `Melted by You at ${time}, right before ${next.name}.`;
  }
  return info;
}
