// Elementals on Trials: the shared reads (a walker's health, an element's start meter, the relay's
// TAG schedule) and the rules step() runs on a Trial only (s.trial !== null): the walker's meter on
// Nubs' trial rule, the relay's telegraph and TAGs, and the death line. The v1 sun-variant heroes
// are gone (docs/ELEMENTALS_V2.md §8): until the element rules land every walker plays Nubs' rule.
// Nothing here allocates per tick.

import type { HeroId } from '../../config/heroes.ts';
import type { TrialDef } from '../../config/trials.ts';
import { TUNING } from '../../config/tuning.ts';
import { DT, tickAtMinute } from '../clock.ts';
import { worldYAtTick } from '../gen/plan.ts';
import { deathCause } from './deathcause.ts';
import type { DeathInfo } from './events.ts';
import { addFrost } from './mechanics.ts';
import { effectiveDrain, keepMemory } from './nubs.ts';
import type { NubsState, SimState } from './types.ts';

const H = TUNING.heroes;
/** TAGs fire on the validator's 0.1 s grid. */
const STEP = TUNING.validator.stepTicks;

/** 0..100: 100·chill/maxChill (the gauge). */
export function heroHealth(nb: NubsState): number {
  return (100 * nb.chill) / nb.maxChill;
}

/** An element's start meter: the tank. */
export function heroStart(_hero: HeroId, maxChill: number): number {
  return maxChill;
}

/** The absolute tick relay `i` of trial `t` fires at: its minute, on the 6-tick grid. */
export function tagTick(t: TrialDef, i: number): number {
  const r = t.relays[i];
  return r ? STEP * Math.round(tickAtMinute(r.minute) / STEP) : -1;
}

/** Ticks to the next TAG (−1 none) and its incoming element (null none). Never allocate. */
export function nextTagTicks(s: SimState): number {
  const t = s.trial;
  if (t === null || s.relayIdx >= t.relays.length) return -1;
  return tagTick(t, s.relayIdx) - s.tickAbs;
}

export function nextTagHero(s: SimState): HeroId | null {
  const r = s.trial?.relays[s.relayIdx];
  return r ? r.to : null;
}

/** A TAG is due within TUNING.heroes.tagSoonTicks: the Cold Snap is refused. */
export function tagLocked(s: SimState): boolean {
  const n = nextTagTicks(s);
  return n >= 0 && n <= H.tagSoonTicks;
}

/** World y of relay i's Tag Stone (−1e9 when the trial has no relay i). */
export function relayY(s: SimState, i: number): number {
  const t = s.trial;
  return t !== null && i >= 0 && i < t.relays.length ? worldYAtTick(s.world, tagTick(t, i)) : -1e9;
}

/**
 * A Trial's daylight tick, in place of applyDaylight: the walker's rate on Nubs' trial rule
 * (−D·f + R·max(0, 1 − f), f = c/5: the validator's chillDeltaTable expression) with the TAG grace,
 * safe (strict shade), health into stats.minChill and lowChill, the shade, glare and cloud memory,
 * the Cold Snap's income on Nubs legs, the clean-TAG watch and the lit totals.
 */
export function applyHeroDaylight(s: SimState): void {
  const nb = s.nubs;
  const st = s.stats;
  const D = effectiveDrain(s);
  const R = s.params.regen;
  const c = nb.c;
  const hp0 = heroHealth(nb);
  const f = c / 5;
  let rate = -D * f + R * Math.max(0, 1 - f);
  let d = rate * DT;
  // After a TAG the incoming meter cannot fall for tagGraceTicks.
  if (s.tagGrace > 0) {
    s.tagGrace--;
    if (d < 0) d = rate = 0;
  }
  nb.rate = rate;
  nb.safe = c === 0;
  nb.chill = Math.max(0, Math.min(nb.maxChill, nb.chill + d));
  const hp = heroHealth(nb);
  if (hp < st.minChill) st.minChill = hp;
  if (hp < H.lowHealth) {
    if (hp0 >= H.lowHealth) s.events.push({ e: 'lowChill' });
    s.hourHot = true;
  }
  keepMemory(s, nb);
  if (nb.hero === 'nubs' && c === 0) addFrost(s, H.nubs.income * DT);
  if (s.tagWatch > 0) {
    if (nb.safe) {
      s.tagWatch = 0;
      st.cleanTags = (st.cleanTags as number) + 1;
      s.events.push({ e: 'tagClean', to: nb.hero });
    } else {
      s.tagWatch--;
    }
  }
  st.litTotal += nb.f * DT;
  s.hourLit += nb.f * DT;
}

/**
 * The relay, right after syncTime: tagSoon tagSoonTicks before a TAG; at its tick the walker becomes
 * the incoming element at its start meter, the grace and the clean-TAG watch start, and `tag`
 * fires. The Cold Snap charge carries over.
 */
export function updateRelay(s: SimState): void {
  const t = s.trial as TrialDef;
  const i = s.relayIdx;
  const r = t.relays[i];
  if (!r) return;
  const n = tagTick(t, i) - s.tickAbs;
  if (n === H.tagSoonTicks) s.events.push({ e: 'tagSoon', to: r.to, ticks: n });
  if (n > 0) return;
  const nb = s.nubs;
  const from = nb.hero;
  nb.hero = r.to;
  nb.chill = heroStart(r.to, nb.maxChill);
  s.tagGrace = H.tagGraceTicks;
  s.tagWatch = H.tagCleanTicks;
  s.relayIdx = i + 1;
  s.stats.tags = (s.stats.tags as number) + 1;
  s.events.push({ e: 'tag', from, to: r.to, index: i });
}

/** The DeathInfo of a Trial: today's deathCause line, with the walker (`who`) and how (`heroCause`). */
export function heroDeath(s: SimState): DeathInfo {
  const info = deathCause(s);
  info.heroCause = 'melt';
  info.who = s.nubs.hero;
  return info;
}
