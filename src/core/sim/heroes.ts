// Elementals (docs/ELEMENTALS.md §1, §4.7): what every reader shares about the heroes: a body's
// health, a hero's start meter and rate table, who casts the ability, and the relay's TAG schedule.
// Pure reads of the state; nothing here allocates per tick (rate tables are built once per hero,
// drain and regen).

import type { HeroId } from '../../config/heroes.ts';
import type { TrialDef } from '../../config/trials.ts';
import { TUNING } from '../../config/tuning.ts';
import { tickAtMinute } from '../clock.ts';
import { worldYAtTick } from '../gen/plan.ts';
import type { NubsState, SimState } from './types.ts';

const H = TUNING.heroes;
/** TAGs fire on the validator's 0.1 s grid. */
const STEP = TUNING.validator.stepTicks;

/** 0..100: 100·chill/maxChill, or Drip's 2·min(T, 100 − T). */
export function heroHealth(nb: NubsState): number {
  return nb.hero === 'drip' ? 2 * Math.min(nb.chill, 100 - nb.chill) : (100 * nb.chill) / nb.maxChill;
}

/** A hero's start meter (Drip TUNING.heroes.drip.start; else maxChill). */
export function heroStart(hero: HeroId, maxChill: number): number {
  return hero === 'drip' ? H.drip.start : maxChill;
}

/** The per-second meter rate of a table hero at lit sum c (§1.1-§1.3). */
function rateAt(hero: HeroId, c: number, drain: number, regen: number): number {
  if (hero === 'ember') {
    const E = H.ember;
    const fs = Math.min(c, 5) / 5;
    const fg = Math.max(0, c - 5) / 5;
    return -E.fade * drain * (1 - fs) + E.gain * regen * fs + E.glare * regen * fg;
  }
  if (hero === 'sprout') {
    const S = H.sprout;
    if (c < S.bandLo) return -S.starve * drain;
    if (c <= S.bandHi) return S.grow * regen;
    if (c <= 5) return -S.scorch * drain;
    return -drain * (1 + (S.glare * (c - 5)) / 5);
  }
  // Nubs: the same float expression as the validator's chillDeltaTable.
  const f = c / 5;
  return -drain * f + regen * Math.max(0, 1 - f);
}

interface RateMemo {
  readonly hero: HeroId;
  readonly drain: number;
  readonly regen: number;
  readonly t: Float64Array;
}
const rateMemo: RateMemo[] = [];

/** Per-second rate table for c = 0..10 (memoized per hero/D/R); null for Volt and Drip. Shared by the sim and scripts' audit. */
export function heroRates(hero: HeroId, drain: number, regen: number): Float64Array | null {
  if (hero === 'volt' || hero === 'drip') return null;
  for (let i = 0; i < rateMemo.length; i++) {
    const m = rateMemo[i] as RateMemo;
    if (m.hero === hero && m.drain === drain && m.regen === regen) return m.t;
  }
  const t = new Float64Array(11);
  for (let c = 0; c <= 10; c++) t[c] = rateAt(hero, c, drain, regen);
  rateMemo.push({ hero, drain, regen, t });
  return t;
}

/** The hero whose ability a swipe casts now (duo: trial.duo.ability; else s.nubs.hero). */
export function abilityHero(s: SimState): HeroId {
  const t = s.trial;
  return t !== null && t.duo !== null ? t.duo.ability : s.nubs.hero;
}

/** The absolute tick relay `i` of trial `t` fires at: its minute, on the 6-tick grid (§2.1). */
export function tagTick(t: TrialDef, i: number): number {
  const r = t.relays[i];
  return r ? STEP * Math.round(tickAtMinute(r.minute) / STEP) : -1;
}

/** Ticks to the next TAG (−1 none) and its incoming hero (null none). Never allocate. */
export function nextTagTicks(s: SimState): number {
  const t = s.trial;
  if (t === null || s.relayIdx >= t.relays.length) return -1;
  return tagTick(t, s.relayIdx) - s.tickAbs;
}

export function nextTagHero(s: SimState): HeroId | null {
  const r = s.trial?.relays[s.relayIdx];
  return r ? r.to : null;
}

/** A TAG is due within TUNING.heroes.tagSoonTicks: casting is refused. */
export function tagLocked(s: SimState): boolean {
  const n = nextTagTicks(s);
  return n >= 0 && n <= H.tagSoonTicks;
}

/** World y of relay i's Tag Stone (−1e9 when the trial has no relay i). */
export function relayY(s: SimState, i: number): number {
  const t = s.trial;
  return t !== null && i >= 0 && i < t.relays.length ? worldYAtTick(s.world, tagTick(t, i)) : -1e9;
}
