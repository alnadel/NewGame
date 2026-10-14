// v1.5 core mechanics in the sim (docs/V1_5_PLAN.md §2): Sunflower buds (growth, bloom into a
// 'sunflower' caster, guide.bud), the frost meter and the Cold Snap cloud. Deep-shade detection lives
// in computeCoverage (nubs.ts), its effects in applyDaylight. Per-tick work is allocation-free; a
// bloom and a snap allocate their caster/cloud (like events, only when they happen).

import { TUNING } from '../../config/tuning.ts';
import { DT, TICK_HZ } from '../clock.ts';
import { angleDiff } from '../dmath.ts';
import { sunflowerParts, makeCaster } from '../gen/catalog.ts';
import { biomeAtY, worldYAtDayTick } from '../gen/plan.ts';
import { cloudLumps } from '../gen/placer.ts';
import { insertCaster, lowerBound } from '../gen/store.ts';
import { markRange } from '../intervals.ts';
import { BUD_ID_BASE, RUNTIME_ID_BASE, SNAP_ID_BASE, type Bud, type Cloud } from '../objects.ts';
import { rngFor } from '../rng.ts';
import { trailX } from '../trail.ts';
import type { InputFrame, SimState } from './types.ts';

const B = TUNING.buds;
const F = TUNING.frost;
const GROW = DT / B.growSec;
const DECAY = B.decay * DT;
/** Cold Snap length in ticks. */
export const SNAP_TICKS = Math.round(F.snapSec * TICK_HZ);

/** True when the sun at azimuth θ grows bud b (it must also be within reach and the sun up). */
export function budFacing(b: Bud, theta: number): boolean {
  return Math.abs(angleDiff(theta, b.face)) <= B.faceTol;
}

/** Adds to the frost meter (Cold Snap on, no snap running); fires frostReady when it fills. */
export function addFrost(s: SimState, amount: number): void {
  if (!s.world.mech.snap || s.snapTicks > 0) return;
  const nb = s.nubs;
  if (nb.frost >= 1) return;
  const v = nb.frost + amount;
  nb.frost = v >= 1 ? 1 : v;
  if (v >= 1) s.events.push({ e: 'frostReady' });
}

/** A bud blooms: a sunflower caster joins the world for the rest of the run, plus Snow and frost. */
export function bloom(s: SimState, b: Bud): void {
  const w = s.world;
  const id = RUNTIME_ID_BASE + (b.id - BUD_ID_BASE);
  const r = rngFor(w.seed, 'names', id);
  const c = makeCaster({
    id,
    kind: 'sunflower',
    name: `the ${r.pick(['Sunny', 'Golden', 'Tall', 'Happy', 'Brave', 'Proud'])} Sunflower`,
    biome: biomeAtY(w, b.y),
    x: b.x,
    y: b.y,
    rot: 0,
    parts: sunflowerParts(b.x, b.y, w.heightScale),
    side: b.x > trailX(w.trail, b.y) ? 1 : -1,
    rescue: false,
    gate: false,
    ballId: -1,
    chunk: Math.floor(b.y / TUNING.world.chunkLen),
  });
  insertCaster(w, c);
  b.state = 1;
  b.grow = 1;
  b.casterId = id;
  const st = s.stats;
  st.blooms = (st.blooms ?? 0) + 1;
  st.snow += B.snow;
  s.events.push({ e: 'bloom', id: b.id, x: b.x, y: b.y, snow: B.snow });
  addFrost(s, F.perBloom);
}

/**
 * Daylight tick: every unbloomed bud within [Nubs − reachBehind, Nubs + reachAhead] grows while the
 * sun shines from within ±faceTol of its face (budGrow every eventTicks while growing) and blooms
 * at 1; otherwise its growth fades. Nothing grows while the sun is down or eclipsed.
 */
export function updateBuds(s: SimState): void {
  const w = s.world;
  if (!w.mech.buds) return;
  const bs = w.buds;
  const y = s.nubs.y;
  const lit = s.sunUp && !s.eclipseOn;
  const theta = s.sun.theta;
  const emit = s.tick % B.eventTicks === 0;
  for (let i = lowerBound(bs, y - B.reachBehind); i < bs.length; i++) {
    const b = bs[i] as Bud;
    if (b.y > y + B.reachAhead) break;
    if (b.state !== 0) continue;
    if (lit && budFacing(b, theta)) {
      b.grow += GROW;
      if (b.grow >= 1) bloom(s, b);
      else if (emit) s.events.push({ e: 'budGrow', id: b.id, x: b.x, y: b.y, grow: b.grow });
    } else if (b.grow > 0) {
      b.grow = b.grow > DECAY ? b.grow - DECAY : 0;
    }
  }
}

/** guide.bud: 1 on every bin within ±faceTol of an unbloomed bud within reach (all 0 while the sun is down). */
export function updateBudGuide(s: SimState): void {
  const g = s.guide.bud;
  g.fill(0);
  const w = s.world;
  if (!w.mech.buds || !s.sunUp || s.eclipseOn) return;
  const bs = w.buds;
  const y = s.nubs.y;
  for (let i = lowerBound(bs, y - B.reachBehind); i < bs.length; i++) {
    const b = bs[i] as Bud;
    if (b.y > y + B.reachAhead) break;
    if (b.state === 0) markRange(g, b.face - B.faceTol, b.face + B.faceTol);
  }
}

/**
 * Casts a Cold Snap now: a frosty cloud at z 0 (its shadow lies right under it whatever θ is) that
 * starts on Nubs and rides with him for snapSec (it follows the trail's chord over that time). The
 * meter empties. Returns false when no snap can be cast (meter not full, a snap on, no sun).
 */
export function castSnap(s: SimState): boolean {
  const nb = s.nubs;
  const w = s.world;
  if (!w.mech.snap || nb.frost < 1 || s.snapTicks > 0 || s.phase !== 'day' || !s.sunUp) return false;
  const T = SNAP_TICKS / TICK_HZ;
  const y1 = worldYAtDayTick(w, s.day, s.dayTick + SNAP_TICKS);
  const x1 = trailX(w.trail, y1);
  const st = s.stats;
  const n = st.snaps ?? 0;
  const id = SNAP_ID_BASE + n;
  const rx = F.snapRx;
  const ry = rx * TUNING.cloud.ryRatio;
  const cl: Cloud = Object.freeze({
    id,
    kind: 'snap',
    t0: s.tAbs,
    // Alive on exactly SNAP_TICKS ticks (half a tick short of the last, so float rounding can't add one).
    life: (SNAP_TICKS - 0.5) / TICK_HZ,
    x0: nb.x,
    y0: nb.y,
    vx: (x1 - nb.x) / T,
    vy: (y1 - nb.y) / T,
    rx,
    ry,
    z: 0,
    lumps: cloudLumps(w.seed, id, rx, ry),
  });
  w.clouds.push(cl);
  s.snapTicks = SNAP_TICKS;
  s.snapCloudId = id;
  nb.frost = 0;
  st.snaps = n + 1;
  s.events.push({ e: 'snap', x: nb.x, y: nb.y, cloudId: id });
  return true;
}

/**
 * Cold Snap bookkeeping before coverage on a running tick: the snap counts down (snapEnd when it
 * runs out), then a snap input casts a new one when the meter is full.
 */
export function updateSnap(s: SimState, inp: InputFrame): void {
  if (s.snapTicks > 0 && --s.snapTicks === 0) {
    s.snapCloudId = -1;
    s.events.push({ e: 'snapEnd' });
  }
  if (inp.snap === true) castSnap(s);
}

/**
 * Debug and screenshot hook (never called by the game loop): blooms bud `id`, or the nearest
 * unbloomed bud ahead of Nubs, at once (bloom event in s.events until the next step). Returns the
 * bud, or null when there is none.
 */
export function debugBloom(s: SimState, id?: number): Bud | null {
  const bs = s.world.buds;
  let pick: Bud | null = null;
  for (let i = lowerBound(bs, s.nubs.y - B.reachBehind); i < bs.length; i++) {
    const b = bs[i] as Bud;
    if (b.state !== 0) continue;
    if (id === undefined || b.id === id) {
      pick = b;
      break;
    }
  }
  if (pick) bloom(s, pick);
  return pick;
}
