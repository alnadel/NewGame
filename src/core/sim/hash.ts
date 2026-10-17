// State hash for determinism tests and golden files (archive/TECH_SPEC §2.5, archive/CRITIQUE #17).
//
// Only tick-determined state is hashed: the clock, Nubs, the sun, Snow and pickup counters, the v1.5
// mechanics (frost, deep shade, the snap, blooms), plus the casters (sunflowers included), pickups
// and buds less than HASH_AHEAD in front of Nubs (sorted by id). Generation progress
// is excluded on purpose: how far idle-time generation ran depends on frame timing, and objects are
// only created far enough ahead that they can't affect play yet.

import { CASTER_KINDS } from '../../config/casters.ts';
import { TUNING } from '../../config/tuning.ts';
import { worldYAtTick } from '../gen/plan.ts';
import { FLARE_KEPT, type Bud, type Caster, type Pickup } from '../objects.ts';
import type { SimState } from './types.ts';

/** Casters and pickups up to this far ahead of Nubs are hashed (well inside the validated horizon). */
export const HASH_AHEAD = TUNING.world.hardAhead - 600;
/** Buds up to this far ahead of Nubs are hashed (past their reach; inside any run's generated world). */
const BUD_HASH_AHEAD = 600;
/** v1.6 (T7): pickups up to this far ahead (flakes stand two chunks behind the casters, like buds). */
const PICKUP_HASH_AHEAD = 600;
/** v1.6: kept flares whose warning starts up to this far ahead. */
const FLARE_HASH_AHEAD = 600;

const PHASES = ['hold', 'day', 'night', 'dead', 'won'];
const MODES = ['idle', 'dragging', 'chasing', 'coasting'];

const dv = new DataView(new ArrayBuffer(8));
let laneA = 0;
let laneB = 0;

function feed(v: number): void {
  dv.setFloat64(0, v);
  for (let i = 0; i < 8; i++) {
    const byte = dv.getUint8(i);
    laneA = Math.imul(laneA ^ byte, 16777619);
    laneB = Math.imul(laneB ^ byte, 0x5bd1e995);
    laneB ^= laneB >>> 15;
  }
}

function hex(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0');
}

/** 64-bit hex digest (two 32-bit FNV-style lanes) of the tick-determined state. */
export function hashState(s: SimState): string {
  laneA = 0x811c9dc5;
  laneB = 0x2545f491;
  const nb = s.nubs;
  const sun = s.sun;
  const st = s.stats;
  for (const v of [
    s.tick,
    s.ready,
    PHASES.indexOf(s.phase),
    s.day,
    s.dayTick,
    nb.x,
    nb.y,
    nb.chill,
    nb.f,
    nb.mult,
    nb.shadeTicks,
    nb.litTicks,
    sun.theta,
    sun.lag,
    sun.omega,
    sun.omegaRel,
    MODES.indexOf(sun.mode),
    st.snow,
    st.flakes,
    st.flakesMelted,
    st.crystals,
    st.flowers,
    st.phews,
    st.maxMult,
    st.swings,
    // v1.5 core mechanics.
    nb.frost,
    nb.deep ? 1 : 0,
    s.snapTicks,
    s.snapCloudId,
    st.blooms ?? 0,
    st.snaps ?? 0,
    st.deepSeconds ?? 0,
  ]) {
    feed(v);
  }
  // v1.6 economy (CORE-1): the Flow Ring, the Frost Bank, the Garden and the landing.
  feed(nb.ringCharge);
  feed(nb.litStartMult);
  feed(nb.streak);
  feed(nb.swFreshN);
  for (let i = 0; i < nb.swFresh.length; i++) feed(nb.swFresh[i] as number);
  feed(nb.frostH);
  feed(nb.swingFrostTick);
  feed(s.snapBankH);
  feed(s.snapExt);
  feed(s.snapBlooms);
  feed(s.landTicks);
  feed(s.landHold);
  feed(s.landSrc);
  feed(st.multTicks ?? 0);
  feed(st.ringTricks ?? 0);
  feed(st.frostEarnedH ?? 0);
  feed(st.snapLands ?? 0);
  // State that steers the next ticks: the bleed exemption after a bud grew, the endpoint a pending
  // hand-off will record, this snap's own sunflowers (the landing) and the snap cloud's re-aimed path.
  feed(nb.budGrewTick);
  feed(nb.swPendFrom);
  const nOwn = Math.min(s.snapBlooms, s.snapBloomIds.length);
  for (let i = 0; i < nOwn; i++) feed(s.snapBloomIds[i] as number);
  if (s.snapCloudId >= 0) {
    for (const cl of s.world.clouds) {
      if (cl.id !== s.snapCloudId) continue;
      feed(cl.x0);
      feed(cl.y0);
      feed(cl.vx);
      feed(cl.vy);
      feed(cl.life);
      break;
    }
  }
  // Campaign state (only hashed when concepts are active, so every pre-campaign hash still holds).
  if (s.mods.size > 0) {
    feed(s.eclipse);
    feed(s.eclipseOn ? 1 : 0);
    feed(sun.gust);
    feed(sun.locked ? 1 : 0);
    feed(st.minChill);
  }
  // v1.6 world and Journey state (CORE-2): the flare in progress, the glass cluster being walked
  // through, the glass/flare/Dare counters, and the kept flares whose warning starts within
  // FLARE_HASH_AHEAD (decided long before: the validator decides a flare once its chunk is reached).
  for (const v of [
    s.flareIdx,
    s.flareId,
    s.flarePhase,
    s.flareLit,
    s.flareTicks,
    s.flareScorch,
    s.clusterId,
    s.clusterTaken,
    s.clusterBroken ? 1 : 0,
    st.brittleSeen ?? 0,
    st.brittleSaved ?? 0,
    st.clustersSaved ?? 0,
    st.flaresSeen ?? 0,
    st.parries ?? 0,
    st.deepTicks ?? 0,
    st.earnedSnapSavedTicks ?? 0,
    st.snapSavedTicks ?? 0,
    st.cloudsRidden ?? 0,
    st.gateDeep ?? 0,
    st.gateShaded ?? 0,
    st.flipTicks ?? 0,
    st.lockHeld ?? 0,
    st.lockWindows ?? 0,
    st.gustHeld ?? 0,
    st.gustWindows ?? 0,
  ]) {
    feed(v);
  }
  const flareLimit = nb.y + FLARE_HASH_AHEAD;
  for (const f of s.world.flares) {
    if (f.state !== FLARE_KEPT || worldYAtTick(s.world, f.warnTick) >= flareLimit || f.endTick < s.tickAbs) continue;
    feed(f.id);
    feed(f.riseTick);
    feed(f.d);
  }
  const limit = nb.y + HASH_AHEAD;
  const casters: Caster[] = s.world.casters.filter((c) => c.y < limit);
  casters.sort((a, b) => a.id - b.id);
  for (const c of casters) {
    feed(c.id);
    feed(c.x);
    feed(c.y);
    feed(CASTER_KINDS.indexOf(c.kind));
    feed(c.rescue ? 1 : 0);
  }
  // T7: pickups only to PICKUP_HASH_AHEAD (flakes are placed two chunks behind the casters, like buds).
  const pickupLimit = nb.y + PICKUP_HASH_AHEAD;
  const pickups: Pickup[] = s.world.pickups.filter((p) => p.y < pickupLimit);
  pickups.sort((a, b) => a.id - b.id);
  for (const p of pickups) {
    feed(p.id);
    feed(p.state);
    feed(p.melt);
    feed(p.brittle ? 1 : 0);
  }
  // Buds (generated sorted by y with rising ids, so world order is id order) up to BUD_HASH_AHEAD:
  // only buds within reach can change, and a Title run built with less lookahead has fewer beyond.
  const bs = s.world.buds;
  const budLimit = nb.y + BUD_HASH_AHEAD;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i] as Bud;
    if (b.y >= budLimit) break;
    feed(b.id);
    feed(b.x);
    feed(b.face);
    feed(b.grow);
    feed(b.state);
  }
  return hex(laneA) + hex(laneB);
}
