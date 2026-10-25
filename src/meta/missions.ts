// Pure mission logic: tiered goals, skill gates, labels, run measurement, dealing with a deferred
// queue, stale swaps and view models (V1_PLAN §11.1, V1_1_PLAN UM4).
//
// Slot ids encode the tier so a mixed set (e.g. two tier-I and one tier-II mission after the pool
// wraps) needs no extra save fields: 'flakes-10' is tier I, 'flakes-10@2' is tier II.

import { formatScore, formatTimeOfDay, MINUTES_PER_DAY } from '../core/format.ts';
import type { MissionSlot } from './saveTypes.ts';
import type { RunResult } from '../core/index.ts';
import { ACTIVE_MISSIONS, MISSIONS, type MissionDef, type MissionId } from './content.ts';

/** Keeps "3 s" together when a label wraps. */
const NBSP = '\u00a0';
const MAX_MULT = 5;
const MAX_TIER = 99;
const TIER_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** A tier ≥ 2 Day goal is dealt once the recent best is within this many minutes of it. */
const REACH_GATE_LEAD = 330;
/** Finished runs without progress before a slot offers Swap. */
export const STALE_SWAP = 5;

const DEF_BY_ID = new Map<string, MissionDef>(MISSIONS.map((m) => [m.id, m]));

export interface ParsedMission {
  def: MissionDef;
  tier: number;
}

/** Slot id for a mission at a tier. */
export function missionSlotId(id: MissionId, tier: number): string {
  return tier <= 1 ? id : `${id}@${tier}`;
}

/** Parses a slot id; null for anything not in the pool. */
export function parseMissionId(slotId: string): ParsedMission | null {
  const at = slotId.indexOf('@');
  const base = at < 0 ? slotId : slotId.slice(0, at);
  const def = DEF_BY_ID.get(base);
  if (!def) return null;
  if (at < 0) return { def, tier: 1 };
  const tierText = slotId.slice(at + 1);
  if (!/^[0-9]{1,2}$/.test(tierText)) return null;
  const tier = Number(tierText);
  return tier >= 2 && tier <= MAX_TIER ? { def, tier } : null;
}

/** Goal for a mission at a tier, in the unit of its metric. */
export function missionTarget(def: MissionDef, tier: number): number {
  switch (def.scale) {
    case 'reach':
      return def.base + (tier - 1) * MINUTES_PER_DAY;
    case 'count':
    case 'seconds':
      return def.base * tier;
    case 'mult':
      return Math.min(MAX_MULT, def.base * tier);
    case 'flag':
      return 1;
  }
}

/** The recent best a player needs before this mission is dealt. */
export function missionGate(def: MissionDef, tier: number): number {
  return def.scale === 'reach' && tier >= 2 ? missionTarget(def, tier) - REACH_GATE_LEAD : def.gate;
}

export function missionReward(def: MissionDef, tier: number): number {
  return def.reward * tier;
}

export function tierNumeral(tier: number): string {
  return TIER_NUMERALS[tier] ?? String(tier);
}

/** Player-facing goal text, e.g. "Collect 20 flakes in one run". */
export function missionLabel(def: MissionDef, tier: number): string {
  const t = missionTarget(def, tier);
  const day = Math.floor(t / MINUTES_PER_DAY) + 1;
  switch (def.id) {
    case 'reach-9am':
      return tier === 1 ? 'Reach 9:00 AM' : `Reach ${formatScore(t)}`;
    case 'survive-noon':
      return tier === 1 ? 'Survive a noon (reach 12:30 PM)' : `Survive Day ${day}'s noon (reach 12:30 PM)`;
    case 'reach-day-2':
    case 'reach-day-3':
      return `Reach Day ${day}`;
    case 'flakes-10':
      return `Collect ${t} flakes in one run`;
    case 'mult-3':
      return `Reach a ×${t} multiplier`;
    case 'cloud-ride':
      return `Ride a cloud's shadow for ${t}${NBSP}s straight`;
    case 'two-phews':
      return t === 2 ? 'Two PHEWs in one run' : `${t} PHEWs in one run`;
    case 'ice-crystal':
      return t === 1 ? 'Collect an Ice Crystal' : `Collect ${t} Ice Crystals in one run`;
    case 'hold-x5':
      // The id predates the "Reach ×5" goal; saves keep it (see save.ts for the progress migration).
      return `Reach a ×${t} multiplier`;
    case 'gate-arch':
      return 'Walk under a gate arch between 11 AM and 1 PM';
    case 'clean-balls':
      return `Pass ${t} gazing balls in one run with no glare contact`;
    case 'swings-3':
      return `Land ${t} SWINGs in one run`;
    case 'blooms-2':
      return `Bloom ${t} sunflowers in one run`;
    case 'snaps-2':
      return t === 1 ? 'Cast a Cold Snap' : `Cast ${t} Cold Snaps in one run`;
    case 'deep-8':
      return `Spend ${t}${NBSP}s in deep shade in one run`;
  }
}

/** Measures one finished run against a mission's metric. */
export function missionValue(def: MissionDef, result: RunResult): number {
  const s = result.stats;
  switch (def.metric) {
    case 'minutes':
      return result.minutes;
    case 'flakes':
      return s.flakes;
    case 'maxMult':
      return s.maxMult;
    case 'cloudRide':
      return s.cloudRideBest;
    case 'phews':
      return s.phews;
    case 'crystals':
      return s.crystals;
    case 'gateNoon':
      return s.gateNoon ? 1 : 0;
    case 'cleanBalls':
      // "with no glare contact": a single glare in the run voids it.
      return s.ballGlared ? 0 : s.ballsPassedClean;
    case 'swings':
      return s.swings;
    // v1.5 (absent in older results = 0).
    case 'blooms':
      return s.blooms ?? 0;
    case 'snaps':
      return s.snaps ?? 0;
    case 'deepSeconds':
      return s.deepSeconds ?? 0;
  }
}

/** Short progress readout for a slot, e.g. "7/10", "2.4/3 s", "8:20 AM". */
export function missionProgressText(def: MissionDef, tier: number, progress: number, done: boolean): string {
  const t = missionTarget(def, tier);
  switch (def.scale) {
    case 'reach': {
      const best = Math.min(progress, t);
      if (best <= 0) return '–';
      return t < MINUTES_PER_DAY ? formatTimeOfDay(best) : formatScore(best);
    }
    case 'count':
      return `${Math.min(Math.floor(progress), t)}/${t}`;
    case 'seconds':
      return `${(Math.floor(Math.min(progress, t) * 10) / 10).toFixed(1)}/${t}${NBSP}s`;
    case 'mult':
      return `×${Math.max(1, Math.min(Math.floor(progress), t))}/×${t}`;
    case 'flag':
      return done ? 'Done' : 'Not yet';
  }
}

export interface MissionView {
  /** Slot id (with tier suffix). */
  id: string;
  label: string;
  tier: number;
  /** "II" for tier 2; empty for tier 1. */
  tierLabel: string;
  reward: number;
  /** Progress toward the goal in [0, 1]. */
  fraction: number;
  progressText: string;
  done: boolean;
  /** Completed by the run whose outcome this view belongs to. */
  justCompleted: boolean;
  /** Unfinished and stale for STALE_SWAP runs: offer Swap. */
  swappable: boolean;
  /** How to do it, for goals the game never explains elsewhere (null for the self-evident ones). */
  hint: string | null;
}

/** One line of how-to for missions whose goal is a mechanic, not a time or a count of pickups. */
export function missionHint(def: MissionDef): string | null {
  switch (def.id) {
    case 'swings-3':
      return 'A SWING: turn the sun so Nubs steps from one shadow straight into another.';
    case 'cloud-ride':
      return "Keep the sun behind a cloud so its shadow rides along with Nubs.";
    case 'blooms-2':
      return 'Shine the sun from a bud’s gold mark (gold on the dial) until it blooms.';
    case 'snaps-2':
      return 'Grow sunflowers from cool shade to fill the frost; when a pip glows, tap the frost button.';
    case 'deep-8':
      return 'Deep shade: Nubs under two shadows at once (the dial’s ring turns dark).';
    default:
      return null;
  }
}

export function missionView(slot: MissionSlot, justCompleted = false): MissionView | null {
  const parsed = parseMissionId(slot.id);
  if (!parsed) return null;
  const { def, tier } = parsed;
  const target = missionTarget(def, tier);
  const fraction = slot.done ? 1 : Math.max(0, Math.min(1, slot.progress / target));
  return {
    id: slot.id,
    label: missionLabel(def, tier),
    tier,
    tierLabel: tier > 1 ? tierNumeral(tier) : '',
    reward: missionReward(def, tier),
    fraction,
    progressText: missionProgressText(def, tier, slot.progress, slot.done),
    done: slot.done,
    justCompleted,
    swappable: !slot.done && slot.stale >= STALE_SWAP,
    hint: missionHint(def),
  };
}

// ---------------------------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------------------------

export interface MissionState {
  cursor: number;
  tier: number;
  active: MissionSlot[];
  /** Gated or swapped slot ids waiting for their turn (one per mission, the lowest tier kept). */
  deferred: string[];
}

/** Queues a slot id, keeping one entry per mission (the lower tier wins). */
function defer(state: MissionState, id: string): void {
  const p = parseMissionId(id);
  if (!p) return;
  const i = state.deferred.findIndex((d) => parseMissionId(d)?.def.id === p.def.id);
  if (i < 0) state.deferred.push(id);
  else if ((parseMissionId(state.deferred[i] as string)?.tier ?? 1) > p.tier) state.deferred[i] = id;
}

/** The pool mission at the cursor; advances the cursor (and the tier when the pool wraps). */
function nextFromPool(state: MissionState): string {
  const def = MISSIONS[state.cursor] as MissionDef;
  const id = missionSlotId(def.id, state.tier);
  state.cursor += 1;
  if (state.cursor >= MISSIONS.length) {
    state.cursor = 0;
    state.tier = Math.min(MAX_TIER, state.tier + 1);
  }
  return id;
}

/**
 * Deals one mission for a player whose recent best is `best`: the first eligible deferred one,
 * else the next eligible one from the pool (gated ones it passes join the deferred queue). Never a
 * mission that holds an active slot at any tier, the slot being replaced included.
 */
function dealOne(state: MissionState, best: number): MissionSlot {
  const free = (id: string): boolean => {
    const def = parseMissionId(id)?.def.id;
    return !state.active.some((s) => parseMissionId(s.id)?.def.id === def);
  };
  const eligible = (id: string): boolean => {
    const p = parseMissionId(id);
    return p !== null && missionGate(p.def, p.tier) <= best;
  };
  const queued = state.deferred.findIndex((id) => free(id) && eligible(id));
  let id = queued >= 0 ? (state.deferred.splice(queued, 1)[0] as string) : null;
  // Gate-0 missions exist at every tier, so one lap always finds one; the bound is a safety net.
  for (let guard = 0; id === null && guard < 2 * MISSIONS.length; guard++) {
    const next = nextFromPool(state);
    if (!free(next) || state.deferred.includes(next)) continue;
    if (eligible(next)) id = next;
    else defer(state, next);
  }
  return { id: id ?? nextFromPool(state), progress: 0, done: false, stale: 0 };
}

/**
 * Replaces completed slots in place (unless `replaceDone` is false) and tops the list up to 3, for
 * a player whose recent best is `best`. Mutates `state`; returns the newly dealt slots.
 */
export function refillMissions(state: MissionState, best: number, replaceDone = true): MissionSlot[] {
  const dealt: MissionSlot[] = [];
  for (let i = 0; replaceDone && i < state.active.length; i++) {
    if ((state.active[i] as MissionSlot).done) {
      const slot = dealOne(state, best);
      state.active[i] = slot;
      dealt.push(slot);
    }
  }
  while (state.active.length < ACTIVE_MISSIONS) {
    const slot = dealOne(state, best);
    state.active.push(slot);
    dealt.push(slot);
  }
  return dealt;
}

/** Swap: the slot's mission joins the deferred queue and the next eligible one takes its place. */
export function swapSlot(state: MissionState, slotId: string, best: number): MissionSlot | null {
  const i = state.active.findIndex((s) => s.id === slotId && !s.done);
  if (i < 0) return null;
  const slot = dealOne(state, best);
  state.active[i] = slot;
  defer(state, slotId);
  return slot;
}
