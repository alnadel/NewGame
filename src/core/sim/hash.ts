// State hash for determinism tests and golden files (TECH_SPEC §2.5, critique #17).
//
// Only tick-determined state is hashed: the clock, Nubs, the sun, Snow and pickup counters, plus
// the casters and pickups less than HASH_AHEAD in front of Nubs (sorted by id). Generation progress
// is excluded on purpose: how far idle-time generation ran depends on frame timing, and objects are
// only created far enough ahead that they can't affect play yet.

import { CASTER_KINDS } from '../../config/casters.ts';
import { TUNING } from '../../config/tuning.ts';
import type { Caster, Pickup } from '../objects.ts';
import type { SimState } from './types.ts';

/** Casters and pickups up to this far ahead of Nubs are hashed (well inside the validated horizon). */
export const HASH_AHEAD = TUNING.world.hardAhead - 600;

const PHASES = ['hold', 'day', 'night', 'dead'];
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
  ]) {
    feed(v);
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
  const pickups: Pickup[] = s.world.pickups.filter((p) => p.y < limit);
  pickups.sort((a, b) => a.id - b.id);
  for (const p of pickups) {
    feed(p.id);
    feed(p.state);
    feed(p.melt);
  }
  return hex(laneA) + hex(laneB);
}
