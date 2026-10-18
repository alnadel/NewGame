// Pickups (V1_PLAN §5.4): collection within 14 u, and time-based melting of flakes and crystals that
// are lit while at most 1.6 s of walking ahead of Nubs (1.0 s budget, ×2 in glare, never refreezes).

import { TUNING } from '../../config/tuning.ts';
import { DT, TICK_HZ } from '../clock.ts';
import { flareMeltMul } from './flares.ts';
import { lowerBound } from '../gen/store.ts';
import { PICKUP_ALIVE, PICKUP_MELTED, PICKUP_TAKEN, type Caster, type Cloud, type GazingBall, type Pickup } from '../objects.ts';
import {
  casterReach,
  casterShades,
  cloudAlive,
  cloudShades,
  distToCasterBounds,
  glareActive,
  glareOffset,
  inGlare,
  shadowLength,
} from '../shadows.ts';
import { addFrost, addFrostH } from './mechanics.ts';
import { ringTrick } from './nubs.ts';
import type { SimState } from './types.ts';

const P = TUNING.pickups;
const R2 = TUNING.nubs.collectRadius * TUNING.nubs.collectRadius;
const MAX_R = TUNING.world.maxCasterRadius;
const RING = TUNING.ring;

/** Lit weight of a single ground point (0 shaded, 1 lit, 2 glare) under the current sun. */
export function pointLitWeight(s: SimState, px: number, py: number): number {
  if (!s.sunUp || s.eclipseOn) return 0;
  const w = s.world;
  const { ux, uy, cot } = s;
  if (glareActive(s.eps)) {
    const g = glareOffset(cot) + TUNING.glare.radius;
    const bs = w.balls;
    for (let i = lowerBound(bs, py - g); i < bs.length; i++) {
      const b = bs[i] as GazingBall;
      if (b.y > py + g) break;
      if (inGlare(b, px, py, ux, uy, cot)) return 2;
    }
  }
  const reach = shadowLength(w.maxZ, cot);
  const cs = w.casters;
  for (let i = lowerBound(cs, py - reach - MAX_R); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > py + reach + MAX_R) break;
    if (distToCasterBounds(c, px, py) > casterReach(c, cot)) continue;
    if (casterShades(c, px, py, ux, uy, cot)) return 0;
  }
  for (const cl of w.clouds as readonly Cloud[]) {
    if (cloudAlive(cl, s.tAbs) && cloudShades(cl, s.tAbs, px, py, ux, uy, cot)) return 0;
  }
  return 1;
}

/**
 * Lit seconds until pickup `p` melts: the day's meltBudget, or TUNING.brittle.meltBudget for a
 * v1.6 glass flake (docs/V1_6_PLAN.md §2.3; glass is only placed where the day's budget is above it).
 * The budget never changes during a flare: the melt *rate* doubles in its rise and hold instead
 * (updatePickups, §2.5), so a half-melted flake is not lost the tick the rise starts.
 */
export function meltBudgetOf(s: SimState, p: Pickup): number {
  return p.brittle ? TUNING.brittle.meltBudget : s.params.meltBudget;
}

/** Collects pickups within reach and melts lit flakes/crystals ahead. */
export function updatePickups(s: SimState, daylight: boolean): void {
  const nb = s.nubs;
  const st = s.stats;
  const ps = s.world.pickups;
  const ahead = P.meltAheadSec * s.params.v;
  const radius = TUNING.nubs.collectRadius;
  for (let i = lowerBound(ps, nb.y - radius); i < ps.length; i++) {
    const p = ps[i] as Pickup;
    const dy = p.y - nb.y;
    if (dy > ahead) break;
    if (p.state !== PICKUP_ALIVE) continue;
    const dx = p.x - nb.x;
    if (dx * dx + dy * dy <= R2) {
      collect(s, p);
      continue;
    }
    if (!daylight || dy <= 0 || p.kind === 'flower') continue;
    const wgt = pointLitWeight(s, p.x, p.y);
    if (wgt === 0) continue;
    // Flakes melt × TUNING.flare.meltMul in a flare's rise and hold (§2.5).
    p.melt += wgt * DT * flareMeltMul(s);
    // Compared in whole weighted lit ticks (p.melt is a sum of k/60 s): a flake lit exactly its
    // budget melts whatever order its plain, glare and flare ticks came in (the contest and
    // guide.flake count the same way: gen/contest.ts meltTicksOf).
    if (Math.round(p.melt * TICK_HZ) >= Math.round(meltBudgetOf(s, p) * TICK_HZ)) {
      p.state = PICKUP_MELTED;
      if (p.kind === 'flake') st.flakesMelted++;
      // v1.6 ring: a melt breaks the pickup streak.
      nb.streak = 0;
      s.events.push({ e: 'flakeMelt', x: p.x, y: p.y });
    }
  }
}

/**
 * The multiplier flake and crystal Snow pays: v1.6 (T2, the ring on) caps it at TUNING.ring.snowCap,
 * as ×4 and ×5 pay through the snap's cash-in instead (with the Frost Bank on or, fix round 2, on
 * the shipped v1.5 meter: mechanics.ts castSnap). With the ring off, the v1.5 multiplier pays.
 */
function snowMult(s: SimState): number {
  return s.world.v16.ring ? Math.min(s.nubs.mult, RING.snowCap) : s.nubs.mult;
}

/** v1.6 ring: every streakEvery-th flake or crystal taken in a row without a melt pays a streak trick. */
function streak(s: SimState): void {
  const nb = s.nubs;
  nb.streak++;
  if (nb.streak % RING.streakEvery === 0) ringTrick(s, 'streak', RING.streakTrick);
}

function collect(s: SimState, p: Pickup): void {
  const nb = s.nubs;
  const st = s.stats;
  p.state = PICKUP_TAKEN;
  if (p.kind === 'flake') {
    // Heat Wave days pay ×1.5 (DayParams.snowMult; 1 on other days, so Snow stays an integer).
    const snow = Math.round(snowMult(s) * s.params.snowMult);
    st.flakes++;
    st.snow += snow;
    nb.chill = Math.min(nb.maxChill - s.flareScorch, nb.chill + P.flakeChill);
    s.events.push({ e: 'flake', mult: nb.mult, degree: (s.flakesToday + nb.mult) % 10, x: p.x, y: p.y, snow });
    s.flakesToday++;
    addFrost(s, TUNING.frost.perFlake);
    // Iteration 1 (E3): every glass flake caught pays a little frost (the Bank), so a partial save of
    // the white arc pays too; a whole cluster pays clusterH on top (sim/glass.ts).
    if (p.brittle) addFrostH(s, 'cluster', TUNING.bank.glassFlakeH);
    streak(s);
  } else if (p.kind === 'crystal') {
    const snow = Math.round(P.crystalSnowMult * snowMult(s) * s.params.snowMult);
    st.crystals++;
    st.snow += snow;
    nb.chill = Math.min(nb.maxChill - s.flareScorch, nb.chill + P.crystalChill);
    s.events.push({ e: 'crystal', mult: nb.mult, x: p.x, y: p.y, snow });
    addFrost(s, TUNING.frost.perFlake);
    streak(s);
  } else {
    st.flowers++;
    st.snow += P.flowerSnow;
    s.events.push({ e: 'flower', x: p.x, y: p.y, snow: P.flowerSnow });
  }
}
