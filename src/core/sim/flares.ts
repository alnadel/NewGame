// v1.6 Heat Flares in the sim (docs/V1_6_PLAN.md §2.5; CORE-2 owns this file): the flare state
// machine (warning, rise, hold, fall), parry and miss (in Endless a miss scorches the tank until
// nightfall: s.flareScorch, fix round 3), the flare's melt multiplier and the debug
// hook (the buds' ×TUNING.flare.budMul in the rise and hold is CORE-1's updateBuds). The schedule
// and the keep test live in generation (world.flares, gen/placer.ts and the validator); the sun's
// lift in gen/plan.ts (worldElevation, liftElevation). Per-tick work is allocation-free (events
// excepted).

import { TUNING } from '../../config/tuning.ts';
import { FLARE_KEPT, type Flare } from '../objects.ts';
import { snapshotFeats } from './feats.ts';
import { payTrick } from './tricks.ts';
import type { SimState } from './types.ts';

const FL = TUNING.flare;

/** The phase of flare f at absolute tick t: 0 none, 1 warning, 2 rise, 3 hold, 4 fall. */
export function flarePhaseAt(f: Flare, t: number): 0 | 1 | 2 | 3 | 4 {
  if (t < f.warnTick || t >= f.endTick) return 0;
  if (t < f.riseTick) return 1;
  if (t < f.holdTick) return 2;
  if (t < f.fallTick) return 3;
  return 4;
}

/** Index of the first kept flare at or after index i, or −1. */
function nextKept(fl: readonly Flare[], i: number): number {
  for (let k = i; k < fl.length; k++) if ((fl[k] as Flare).state === FLARE_KEPT) return k;
  return -1;
}

/** Ends the current flare (flareEnd) and points flareIdx past it. */
function endFlare(s: SimState): void {
  s.events.push({ e: 'flareEnd', id: s.flareId });
  s.flareIdx++;
  s.flareId = -1;
  s.flarePhase = 0;
  s.flareTicks = -1;
}

/** The hold just ended (the tick after its last hold tick): parry (≤ parryMaxLit lit ticks) or miss. */
function settle(s: SimState, f: Flare): void {
  const st = s.stats;
  if (s.flareLit <= FL.parryMaxLit) {
    st.parries = (st.parries ?? 0) + 1;
    st.snow += FL.snow;
    s.events.push({ e: 'flareParry', id: f.id, snap: s.snapTicks > 0, snow: FL.snow });
    payTrick(s, 'parry');
  } else {
    s.events.push({ e: 'flareMiss', id: f.id, lit: s.flareLit });
    // Scorch (Endless): the flash scorches the tank, the more the longer Nubs stood in it, until
    // nightfall or a Cold Snap. The validator never needs it: its DP's path parries every kept flare.
    if (s.world.level === null && FL.scorchPerLitTick > 0) {
      // Day 1's flare (profile 3) is the first a player meets: its scorch stays small.
      const max = s.day === 1 ? FL.scorchMaxDay1 : FL.scorchMax;
      s.flareScorch = Math.min(max, s.flareScorch + FL.scorchPerLitTick * (s.flareLit - FL.parryMaxLit));
      clampScorch(s);
    }
  }
}

/** Keeps Chill within the scorched tank (maxChill − s.flareScorch). */
function clampScorch(s: SimState): void {
  const cap = s.nubs.maxChill - s.flareScorch;
  if (s.nubs.chill > cap) s.nubs.chill = cap;
}

/** Moves the current flare's phase to `ph`, firing every transition passed on the way. */
function advance(s: SimState, f: Flare, ph: 0 | 1 | 2 | 3 | 4, t: number): void {
  while (s.flarePhase < ph) {
    const next = (s.flarePhase + 1) as 1 | 2 | 3 | 4;
    s.flarePhase = next;
    if (next === 1) s.events.push({ e: 'flareWarn', id: f.id, ticks: f.riseTick - t, d: f.d });
    else if (next === 2) s.events.push({ e: 'flareRise', id: f.id });
    else if (next === 3) {
      s.flareLit = 0;
      s.stats.flaresSeen = (s.stats.flaresSeen ?? 0) + 1;
    } else settle(s, f);
  }
}

/**
 * Called by step() every running tick before the eclipse sync: advances s.flarePhase/flareIdx/
 * flareTicks/flareLit through the kept flares (flareWarn, flareRise, flareParry or flareMiss at the
 * end of the hold, flareEnd). The hold's lit ticks are read from the coverage of the tick before
 * (this hook runs before computeCoverage), so all hold ticks [holdTick, fallTick) count. A warning
 * that starts during the previous flare's fall (Journey bosses) ends that flare first. It also
 * snapshots the Dare values for updateFeats (sim/feats.ts).
 */
export function updateFlare(s: SimState): void {
  snapshotFeats(s);
  if (s.flareScorch > 0) {
    // The scorch heals at nightfall or under a Cold Snap; until then Chill stays under the scorched
    // cap (the Chill line, flakes and saved glass clamp to it too: nubs.ts, pickups.ts, glass.ts).
    if (s.phase === 'night' || s.snapTicks > 0) s.flareScorch = 0;
    else clampScorch(s);
  }
  const fl = s.world.flares;
  if (fl.length === 0) return;
  const t = s.tickAbs;
  if (s.flarePhase > 0) {
    const f = fl[s.flareIdx] as Flare;
    // Lit ticks of the hold: the tick before was a hold tick. Each burns TUNING.flare.burnPerLitTick
    // Chill (the validator charges it on the steps (holdTick, fallTick]: validator.ts slotDeltaAt).
    if (t > f.holdTick && t <= f.fallTick && s.nubs.f > 0) {
      s.flareLit++;
      s.nubs.chill = Math.max(0, s.nubs.chill - FL.burnPerLitTick);
    }
    const nk = nextKept(fl, s.flareIdx + 1);
    const nx = nk >= 0 ? (fl[nk] as Flare) : null;
    if (t >= f.endTick || (nx !== null && t >= nx.warnTick)) {
      if (s.flarePhase < 4) advance(s, f, 4, t);
      endFlare(s);
    } else {
      advance(s, f, flarePhaseAt(f, t), t);
    }
  }
  if (s.flarePhase === 0) {
    // Skip what has ended or was not kept; a pending flare ahead waits (the validator decides it
    // long before its warning: the world is validated ≥ 1600 u ahead).
    let i = s.flareIdx;
    while (i < fl.length) {
      const f = fl[i] as Flare;
      if (f.endTick <= t || (f.state !== FLARE_KEPT && t >= f.warnTick)) i++;
      else break;
    }
    s.flareIdx = i;
    const f = fl[i];
    if (f && f.state === FLARE_KEPT && t >= f.warnTick) {
      s.flareId = f.id;
      advance(s, f, flarePhaseAt(f, t), t);
    }
  }
  if (s.flarePhase > 0) {
    const f = fl[s.flareIdx] as Flare;
    s.flareTicks = s.flarePhase === 1 ? f.riseTick - t : -1;
  }
}

/** Flakes and crystals melt × this (TUNING.flare.meltMul) during a flare's rise and hold, else 1. */
export function flareMeltMul(s: SimState): number {
  return s.flarePhase === 2 || s.flarePhase === 3 ? FL.meltMul : 1;
}

/**
 * Debug and screenshot hook (never called by the game loop): adds a kept flare of lift `d` (°)
 * whose warning starts `inTicks` ticks from now, skipping the keep test, and returns it. Its ticks
 * follow TUNING.flare (the Journey's shorter warning on a campaign level).
 */
export function debugFlare(s: SimState, inTicks: number, d: number): Flare {
  const w = s.world;
  const warnTick = s.tickAbs + Math.max(0, Math.round(inTicks));
  const riseTick = warnTick + (w.level ? FL.warnTicksJourney : FL.warnTicks);
  const holdTick = riseTick + FL.riseTicks;
  const fallTick = holdTick + FL.holdTicks;
  let id = 1;
  for (const f of w.flares) if (f.id >= id) id = f.id + 1;
  const flare: Flare = { id, day: s.day, d, warnTick, riseTick, holdTick, fallTick, endTick: fallTick + FL.fallTicks, state: FLARE_KEPT };
  let i = w.flares.length;
  while (i > 0 && (w.flares[i - 1] as Flare).riseTick > riseTick) i--;
  w.flares.splice(i, 0, flare);
  // Indices into w.flares that the insert moved: the validator's flare under test and the sim's
  // active flare (a pending or running one must stay the one being decided or played).
  if (w.job && w.job.flareQ >= i) w.job.flareQ++;
  if (s.flarePhase > 0 && s.flareIdx >= i) s.flareIdx++;
  return flare;
}
