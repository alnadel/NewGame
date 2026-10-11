// Pure mission logic: tiered goals, labels, run measurement, dealing and view models.
//
// Slot ids encode the tier so a mixed set (e.g. two tier-I and one tier-II mission after the pool
// wraps) needs no extra save fields: 'flakes-10' is tier I, 'flakes-10@2' is tier II.

import type { RunResult } from '../core/sim/events.ts';
import { formatScore, formatTimeOfDay, MINUTES_PER_DAY } from '../core/format.ts';
import type { MissionSlot } from './saveTypes.ts';
import { ACTIVE_MISSIONS, MISSIONS, type MissionDef, type MissionId } from './content.ts';

/** Keeps "3 s" together when a label wraps. */
const NBSP = ' ';
const MAX_MULT = 5;
const MAX_TIER = 99;
const TIER_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

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
      return `Hold ×5 for ${t}${NBSP}s`;
    case 'gate-arch':
      return 'Walk under a gate arch between 11 AM and 1 PM';
    case 'clean-balls':
      return `Pass ${t} gazing balls in one run with no glare contact`;
    case 'play-daily':
      return "Play today's Daily";
  }
}

/** Measures one finished run against a mission's metric. */
export function missionValue(def: MissionDef, result: RunResult, today: string): number {
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
    case 'x5Hold':
      return s.x5HoldBest;
    case 'gateNoon':
      return s.gateNoon ? 1 : 0;
    case 'cleanBalls':
      // "with no glare contact": a single glare in the run voids it.
      return s.ballGlared ? 0 : s.ballsPassedClean;
    case 'dailyToday':
      return result.mode === 'daily' && result.dailyDate === today ? 1 : 0;
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
  };
}

export interface MissionState {
  cursor: number;
  tier: number;
  active: MissionSlot[];
}

/** Deals the next mission from the pool, advancing the cursor (and the tier when the pool wraps). */
function dealNext(state: MissionState): MissionSlot {
  const def = MISSIONS[state.cursor] as MissionDef;
  const slot: MissionSlot = { id: missionSlotId(def.id, state.tier), progress: 0, done: false };
  state.cursor += 1;
  if (state.cursor >= MISSIONS.length) {
    state.cursor = 0;
    state.tier = Math.min(MAX_TIER, state.tier + 1);
  }
  return slot;
}

/**
 * Replaces completed slots in place (unless `replaceDone` is false) and tops the list up to 3.
 * Mutates `state`; returns the newly dealt slots. Never deals an id that is already active.
 */
export function refillMissions(state: MissionState, replaceDone = true): MissionSlot[] {
  const dealt: MissionSlot[] = [];
  const nextFresh = (): MissionSlot => {
    // The pool is far larger than the active set, so this terminates within one lap.
    for (let guard = 0; guard <= MISSIONS.length; guard++) {
      const slot = dealNext(state);
      if (!state.active.some((s) => s.id === slot.id)) return slot;
    }
    return dealNext(state);
  };
  for (let i = 0; replaceDone && i < state.active.length; i++) {
    if ((state.active[i] as MissionSlot).done) {
      const slot = nextFresh();
      state.active[i] = slot;
      dealt.push(slot);
    }
  }
  while (state.active.length < ACTIVE_MISSIONS) {
    const slot = nextFresh();
    state.active.push(slot);
    dealt.push(slot);
  }
  return dealt;
}
