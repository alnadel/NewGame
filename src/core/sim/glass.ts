// v1.6 glass clusters in the sim (docs/V1_6_PLAN.md §2.3; CORE-2): which flake cluster Nubs is
// walking through (SimState.clusterId, clusterTaken, clusterBroken), clusterSaved when every flake
// of it was taken and none melted, the glass counters and the saved glass cluster's payoff (frost and
// a ring trick, sim/tricks.ts). Glass flakes melt after TUNING.brittle.meltBudget (pickups.ts
// meltBudgetOf). Called by updateFeats every running tick, after updatePickups. Allocation-free.

import { TUNING } from '../../config/tuning.ts';
import { lowerBound } from '../gen/store.ts';
import { PICKUP_MELTED, PICKUP_TAKEN, type Pickup } from '../objects.ts';
import { payTrick } from './tricks.ts';
import type { SimState } from './types.ts';

const COLLECT = TUNING.nubs.collectRadius;
/** Farthest a cluster's first flake can lie behind its last (u): flurry's 7 flakes, with room. */
const SPAN = 8 * TUNING.pickups.flakeSpacing;

/** Counts the tracked cluster's taken and melted flakes; returns taken + 100 × melted, or −1 when it is not found in reach. */
function countCluster(s: SimState, id: number, cn: number): number {
  const ps = s.world.pickups;
  const y = s.nubs.y;
  let taken = 0;
  let melted = 0;
  let seen = 0;
  for (let i = lowerBound(ps, y - COLLECT - SPAN); i < ps.length && seen < cn; i++) {
    const p = ps[i] as Pickup;
    if (p.y > y + SPAN + TUNING.pickups.meltAheadSec * s.params.v) break;
    if (p.cluster !== id) continue;
    seen++;
    if (p.state === PICKUP_TAKEN) taken++;
    else if (p.state === PICKUP_MELTED) melted++;
  }
  return seen === 0 ? -1 : taken + 100 * melted;
}

/** The first flake ahead (from just behind Nubs to the melt window's far end) of a cluster after `after`, or null. */
function nextCluster(s: SimState, after: number): Pickup | null {
  const ps = s.world.pickups;
  const y = s.nubs.y;
  const ahead = TUNING.pickups.meltAheadSec * s.params.v;
  for (let i = lowerBound(ps, y - COLLECT); i < ps.length; i++) {
    const p = ps[i] as Pickup;
    if (p.y - y > ahead) break;
    if (p.kind === 'flake' && p.cluster > after) return p;
  }
  return null;
}

/**
 * Tracks the cluster Nubs is walking through: it starts when a cluster's first flake comes within
 * the melt window ahead (brittleSeen counts the glass ones) and settles once every flake is taken or
 * melted (clusterTaken becomes −1): saved whole (clustersSaved; a glass one also brittleSaved and the
 * glass payoff) emits clusterSaved.
 */
export function updateClusters(s: SimState): void {
  const ps = s.world.pickups;
  if (ps.length === 0) return;
  if (s.clusterId < 0 || s.clusterTaken < 0) {
    const p = nextCluster(s, s.clusterId);
    if (!p) return;
    s.clusterId = p.cluster;
    s.clusterTaken = 0;
    s.clusterBroken = false;
    if (p.brittle) s.stats.brittleSeen = (s.stats.brittleSeen ?? 0) + 1;
  }
  // The tracked cluster's size and kind: any of its flakes carries them.
  let first: Pickup | null = null;
  for (let i = lowerBound(ps, s.nubs.y - COLLECT - SPAN); i < ps.length; i++) {
    const p = ps[i] as Pickup;
    if (p.cluster === s.clusterId) {
      first = p;
      break;
    }
    if (p.y > s.nubs.y + SPAN + TUNING.pickups.meltAheadSec * s.params.v) break;
  }
  if (!first) {
    s.clusterTaken = -1;
    return;
  }
  const c = countCluster(s, s.clusterId, first.cn);
  if (c < 0) return;
  const taken = c % 100;
  const melted = Math.floor(c / 100);
  s.clusterTaken = taken;
  s.clusterBroken = melted > 0;
  if (taken + melted < first.cn) return;
  s.clusterTaken = -1;
  if (melted > 0) return;
  const st = s.stats;
  st.clustersSaved = (st.clustersSaved ?? 0) + 1;
  if (first.brittle) {
    st.brittleSaved = (st.brittleSaved ?? 0) + 1;
    payTrick(s, 'cluster');
    // A saved glass cluster cools Nubs at once (TUNING.brittle.saveChill).
    const nb = s.nubs;
    nb.chill = Math.min(nb.maxChill - s.flareScorch, nb.chill + TUNING.brittle.saveChill);
  }
  s.events.push({ e: 'clusterSaved', cluster: s.clusterId, brittle: first.brittle, n: first.cn, x: s.nubs.x, y: s.nubs.y });
}
