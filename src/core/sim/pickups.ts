// Pickups (V1_PLAN §5.4): collection within 14 u, and time-based melting of flakes and crystals that
// are lit while at most 1.6 s of walking ahead of Nubs (1.0 s budget, ×2 in glare, never refreezes).

import { TUNING } from '../../config/tuning.ts';
import { DT } from '../clock.ts';
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
import type { SimState } from './types.ts';

const P = TUNING.pickups;
const R2 = TUNING.nubs.collectRadius * TUNING.nubs.collectRadius;
const MAX_R = TUNING.world.maxCasterRadius;

/** Lit weight of a single ground point (0 shaded, 1 lit, 2 glare) under the current sun. */
export function pointLitWeight(s: SimState, px: number, py: number): number {
  if (!s.sunUp) return 0;
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
    p.melt += wgt * DT;
    if (p.melt >= P.meltBudget) {
      p.state = PICKUP_MELTED;
      if (p.kind === 'flake') st.flakesMelted++;
      s.events.push({ e: 'flakeMelt', x: p.x, y: p.y });
    }
  }
}

function collect(s: SimState, p: Pickup): void {
  const nb = s.nubs;
  const st = s.stats;
  p.state = PICKUP_TAKEN;
  if (p.kind === 'flake') {
    // Heat Wave days pay ×1.5 (DayParams.snowMult; 1 on other days, so Snow stays an integer).
    const snow = Math.round(nb.mult * s.params.snowMult);
    st.flakes++;
    st.snow += snow;
    nb.chill = Math.min(nb.maxChill, nb.chill + P.flakeChill);
    s.events.push({ e: 'flake', mult: nb.mult, degree: (s.flakesToday + nb.mult) % 10, x: p.x, y: p.y, snow });
    s.flakesToday++;
  } else if (p.kind === 'crystal') {
    const snow = Math.round(P.crystalSnowMult * nb.mult * s.params.snowMult);
    st.crystals++;
    st.snow += snow;
    nb.chill = Math.min(nb.maxChill, nb.chill + P.crystalChill);
    s.events.push({ e: 'crystal', mult: nb.mult, x: p.x, y: p.y, snow });
  } else {
    st.flowers++;
    st.snow += P.flowerSnow;
    s.events.push({ e: 'flower', x: p.x, y: p.y, snow: P.flowerSnow });
  }
}
