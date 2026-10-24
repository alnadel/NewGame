// Elementals (docs/ELEMENTALS.md §1-§2, §4.7-§4.8): the heroes on Trials. The shared reads (a
// body's health, a hero's start meter and rate table, who casts the ability, the relay's TAG
// schedule) and the rules step() runs on a Trial only (s.trial !== null): each body's meter and safe
// set, Volt's strikes, Harmony, the ability charge's income, the green thumb, the four abilities on
// the snap bit, relay TAGs, flakes per hero and the death lines. Nothing here allocates per tick
// (rate tables are built once per hero, drain and regen; events and a SEED's caster only when they
// happen); the hero-aware guide masks are guide.ts heroGuide over heroMask.

import { HEROES, type HeroDeath, type HeroId } from '../../config/heroes.ts';
import type { TrialDef } from '../../config/trials.ts';
import { TUNING } from '../../config/tuning.ts';
import { DT, exactClock, tickAtMinute, TICK_HZ } from '../clock.ts';
import { angleDiff } from '../dmath.ts';
import { makeCaster, sunflowerParts } from '../gen/catalog.ts';
import { biomeAtY, worldYAtDayTick, worldYAtTick } from '../gen/plan.ts';
import { insertCaster, lowerBound } from '../gen/store.ts';
import { BINS } from '../intervals.ts';
import { SEED_ID_BASE, type Bud, type Pickup } from '../objects.ts';
import { trailX } from '../trail.ts';
import { deathCause } from './deathcause.ts';
import type { DeathCause, DeathInfo } from './events.ts';
import { addFrost, bloom, castSnap } from './mechanics.ts';
import { effectiveDrain, keepMemory } from './nubs.ts';
import type { NubsState, SimState } from './types.ts';

const H = TUNING.heroes;
const EM = H.ember;
const SP = H.sprout;
const V = H.volt;
const DR = H.drip;
const P = TUNING.pickups;
/** TAGs fire on the validator's 0.1 s grid. */
const STEP = TUNING.validator.stepTicks;

/** 0..100: 100·chill/maxChill, or Drip's 2·min(T, 100 − T). */
export function heroHealth(nb: NubsState): number {
  return nb.hero === 'drip' ? 2 * Math.min(nb.chill, 100 - nb.chill) : (100 * nb.chill) / nb.maxChill;
}

/** A hero's start meter (Drip TUNING.heroes.drip.start; else maxChill). */
export function heroStart(hero: HeroId, maxChill: number): number {
  return hero === 'drip' ? DR.start : maxChill;
}

/** The per-second meter rate of a table hero at lit sum c (§1.1-§1.3). */
function rateAt(hero: HeroId, c: number, drain: number, regen: number): number {
  if (hero === 'ember') {
    const fs = Math.min(c, 5) / 5;
    const fg = Math.max(0, c - 5) / 5;
    return -EM.fade * drain * (1 - fs) + EM.gain * regen * fs + EM.glare * regen * fg;
  }
  if (hero === 'sprout') {
    if (c < SP.bandLo) return -SP.starve * drain;
    if (c <= SP.bandHi) return SP.grow * regen;
    if (c <= 5) return -SP.scorch * drain;
    return -drain * (1 + (SP.glare * (c - 5)) / 5);
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

/**
 * True when hero `h` is safe at lit sum `c` (§1.1-§1.4): Nubs fully shaded, Sprout in the dappled
 * band, Ember where its Heat rises, Volt in shade (c ≤ shadeAt: the dial's live shade, before the
 * dead zone). Drip reads its centre sample instead (heroMask).
 */
export function safeAt(h: HeroId, c: number, drain: number, regen: number): boolean {
  if (h === 'ember') return ((heroRates(h, drain, regen) as Float64Array)[c] as number) > 0;
  if (h === 'nubs') return c === 0;
  if (h === 'sprout') return c >= SP.bandLo && c <= SP.bandHi;
  return c <= V.shadeAt;
}

/** The hero whose ability a swipe casts now (duo: trial.duo.ability; else s.nubs.hero). */
export function abilityHero(s: SimState): HeroId {
  const t = s.trial;
  return t !== null && t.duo !== null ? t.duo.ability : s.nubs.hero;
}

/** The body of the ability hero (a duo's mate when the trial's ability is its hero; else the lead). */
export function abilityBody(s: SimState): NubsState {
  const m = s.mate;
  return m !== null && m.hero === abilityHero(s) ? m : s.nubs;
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

const okC = new Uint8Array(11);

/**
 * Hero `h`'s safe mask (§1, the dial's go arcs) from per-bin lit sums `lit`, or for Drip from its
 * centre sample's weights `w0` (0 shade, 1 lit, 2 glare) and side `cool`; Volt's leaves out its dead
 * zone (±deadDeg around `vTheta`, −1 none). The single source of "safe" for the dial, the ghost hint
 * and the bots (guide.ts heroGuide).
 */
export function heroMask(s: SimState, h: HeroId, lit: Uint8Array, w0: Uint8Array, out: Uint8Array, vTheta: number, cool: boolean): void {
  const D = effectiveDrain(s);
  for (let c = 0; c <= 10; c++) okC[c] = safeAt(h, c, D, s.params.regen) ? 1 : 0;
  for (let b = 0; b < BINS; b++) {
    const w = w0[b] as number;
    out[b] =
      h === 'drip'
        ? (cool ? w === 0 : w === 1)
          ? 1
          : 0
        : (okC[lit[b] as number] as number) & (h !== 'volt' || vTheta < 0 || Math.abs(angleDiff(b, vTheta)) >= V.deadDeg ? 1 : 0);
  }
}

/** The Volt body whose lit-to-shaded edge fell on this tick (the strike test runs once the bodies are done), or null. */
let voltEdge: NubsState | null = null;

/**
 * One body's daylight tick (§4.8 steps 1-5): its hero's rule gives the rate (per s), the safe set and
 * the meter; the lead's TAG grace; Drip's boil and side; health into stats.minChill and lowChill;
 * the shade, glare and cloud memory.
 */
function bodyTick(s: SimState, nb: NubsState, D: number, R: number, lead: boolean): void {
  const h = nb.hero;
  const c = nb.c;
  const T = nb.chill;
  const hp0 = heroHealth(nb);
  // A Cloudburst eases T toward 50 by rainEase of the gap each tick, whatever the light.
  const rain = h === 'drip' && s.heroAbility === 'rain';
  let rate: number;
  let safe: boolean;
  if (h === 'volt') {
    // Hysteresis: lit once c ≥ litAt, shaded once c ≤ shadeAt; grounded shade leaks least, glare most.
    const was = s.voltLit;
    s.voltLit = c >= V.litAt || (was && c > V.shadeAt);
    if (was && !s.voltLit) voltEdge = nb;
    safe = !s.voltLit;
    rate = -D * (c > 5 ? V.leakGlare : safe ? V.leakShade : V.leakLit);
  } else if (h === 'drip') {
    // The centre sample only: shade cools, sun warms, glare is a stove.
    const w0 = nb.w[0] as number;
    safe = rain || (s.dripCool ? w0 === 0 : w0 === 1);
    rate = rain ? (DR.start - T) * DR.rainEase * TICK_HZ : D * DR.k * (w0 === 0 ? -1 : w0 === 1 ? 1 : DR.glareMul);
  } else {
    // Table heroes; a Blaze lights Ember from within (its c counts as at least blazeFloor).
    const ce = h === 'ember' && s.heroAbility === 'blaze' && c < EM.blazeFloor ? EM.blazeFloor : c;
    rate = (heroRates(h, D, R) as Float64Array)[ce] as number;
    safe = safeAt(h, ce, D, R);
  }
  let d = rain ? (DR.start - T) * DR.rainEase : rate * DT;
  // After a TAG the incoming meter cannot fall for tagGraceTicks.
  if (lead && s.tagGrace > 0) {
    s.tagGrace--;
    if (d < 0) d = rate = 0;
  }
  nb.rate = rate;
  nb.safe = safe;
  let v = T + d;
  if (v < 0) v = 0;
  if (h === 'drip') {
    // Boiling is a failure, not a cap: the meter drops to 0 so the death check fires.
    if (v >= nb.maxChill) {
      v = 0;
      s.heroCause = 'boil';
    }
    if (v >= DR.coolAt) s.dripCool = true;
    else if (v <= DR.warmAt) s.dripCool = false;
  } else if (v > nb.maxChill) {
    v = nb.maxChill;
  }
  nb.chill = v;
  const hp = heroHealth(nb);
  if (hp < s.stats.minChill) s.stats.minChill = hp;
  if (hp < H.lowHealth) {
    if (hp0 >= H.lowHealth) s.events.push({ e: 'lowChill' });
    s.hourHot = true;
  }
  keepMemory(s, nb);
}

/**
 * Volt's strike (§1.4), `mul` 1, or a Thunderclap's thunderMul: chains within chainTicks of the last
 * (up to chainCap), pays strike·R·(1 + chainStep·(chain − 1)) × mul at once, moves the dead zone to
 * θ, and pays income from chain incomeAt.
 */
function strike(s: SimState, nb: NubsState, mul: number): void {
  const st = s.stats;
  const chain = s.voltTheta >= 0 && s.tick - s.voltTick <= V.chainTicks ? Math.min(s.voltChain + 1, V.chainCap) : 1;
  const gain = mul * V.strike * s.params.regen * (1 + V.chainStep * (chain - 1));
  nb.chill = Math.min(nb.maxChill, nb.chill + gain);
  s.voltChain = chain;
  s.voltTheta = s.sun.theta;
  s.voltTick = s.tick;
  st.strikes = (st.strikes as number) + 1;
  if (chain > (st.bestChain as number)) st.bestChain = chain;
  s.events.push({ e: 'strike', chain, gain, thunder: mul > 1, x: nb.x, y: nb.y });
  if (chain >= V.incomeAt) addFrost(s, V.income);
}

/** The green thumb (§1.3): a safe Sprout blooms every unbloomed bud within thumbReach of its y. */
function greenThumb(s: SimState, nb: NubsState): void {
  if (nb.hero !== 'sprout' || !nb.safe) return;
  const bs = s.world.buds;
  for (let i = lowerBound(bs, nb.y - SP.thumbReach); i < bs.length; i++) {
    const b = bs[i] as Bud;
    if (b.y > nb.y + SP.thumbReach) break;
    if (b.state === 0) bloom(s, b);
  }
}

/**
 * A Trial's daylight tick (§4.8), in place of applyDaylight: each body (lead first), then Volt's
 * strike, Harmony, the ability hero's income (× harmonyMul in Harmony, through addFrost: nothing
 * while a Cold Snap rides), the Blaze and calm counters, the green thumb, the timed ability's
 * countdown, the clean-TAG watch and the lit totals.
 */
export function applyHeroDaylight(s: SimState): void {
  const D = effectiveDrain(s);
  const R = s.params.regen;
  const nb = s.nubs;
  const m = s.mate;
  const st = s.stats;
  s.heroCause = null;
  voltEdge = null;
  bodyTick(s, nb, D, R, true);
  // A duo's Cold Snap cloud smothers the mate at snapSmother of the drain (§2.2).
  if (m !== null) bodyTick(s, m, s.snapTicks > 0 ? D * H.snapSmother : D, R, false);
  const ve = voltEdge as NubsState | null;
  if (ve !== null && (s.voltTheta < 0 || Math.abs(angleDiff(s.sun.theta, s.voltTheta)) >= V.deadDeg) && s.tick - s.voltTick >= V.gapTicks) strike(s, ve, 1);
  if (m !== null) {
    s.harmony = nb.safe && m.safe;
    if (s.harmony) st.harmonyTicks = (st.harmonyTicks as number) + 1;
  }
  const ab = abilityBody(s);
  const h = ab.hero;
  const c = ab.c;
  const calm = h === 'drip' && ab.chill >= DR.calmLo && ab.chill <= DR.calmHi;
  if (calm) st.calmTicks = (st.calmTicks as number) + 1;
  const inc =
    h === 'nubs' ? (c === 0 ? H.nubs.income : 0)
    : h === 'ember' ? (c === 5 ? EM.incomeSun : c > 5 ? EM.incomeGlare : 0)
    : h === 'sprout' ? (ab.safe ? SP.income : 0)
    : calm ? DR.income : 0;
  if (inc > 0) addFrost(s, inc * DT * (s.harmony ? H.harmonyMul : 1));
  if (s.heroAbility === 'blaze' && !safeAt('ember', c, D, R)) st.blazeTicks = (st.blazeTicks as number) + 1;
  if (s.world.mech.buds) {
    greenThumb(s, nb);
    if (m !== null) greenThumb(s, m);
  }
  if (s.heroTicks > 0 && --s.heroTicks === 0) {
    s.events.push({ e: 'abilityEnd', kind: s.heroAbility as 'blaze' | 'rain' });
    s.heroAbility = null;
  }
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
 * The swipe on a Trial (§1.0): refused while the charge is below 1, a timed ability or a Cold Snap
 * runs, the sun is down, the start beat is on or a TAG is within tagSoonTicks. Nubs' ability is the
 * Cold Snap (castSnap); the others spend the whole charge and push `ability` (a SEED's x, y is its
 * sunflower's): BLAZE and CLOUDBURST run for their ticks, SEED plants a sunflower seedAheadTicks of
 * walking ahead on the sun's side, THUNDERCLAP strikes at θ (dead zone and refractory ignored).
 */
export function castHero(s: SimState): boolean {
  const nb = s.nubs;
  if (nb.frost < 1 || s.heroAbility !== null || s.snapTicks > 0 || !s.sunUp || s.phase !== 'day' || s.ready > 0 || tagLocked(s)) return false;
  const hero = abilityHero(s);
  const kind = HEROES[hero].ability;
  if (kind === 'snap') return castSnap(s);
  nb.frost = 0;
  nb.frostH = 0;
  const b = abilityBody(s);
  let x = b.x;
  let y = b.y;
  if (kind === 'seed') {
    const w = s.world;
    const st = s.stats;
    const n = st.seeds as number;
    const side = s.ux >= 0 ? 1 : -1;
    y = worldYAtDayTick(w, s.day, s.dayTick + SP.seedAheadTicks);
    x = trailX(w.trail, y) + side * SP.seedLat;
    insertCaster(
      w,
      makeCaster({
        id: SEED_ID_BASE + n,
        kind: 'sunflower',
        name: "Sprout's Sunflower",
        biome: biomeAtY(w, y),
        x,
        y,
        rot: 0,
        parts: sunflowerParts(x, y, w.heightScale),
        side,
        rescue: false,
        gate: false,
        ballId: -1,
        chunk: Math.floor(y / TUNING.world.chunkLen),
      }),
    );
    st.seeds = n + 1;
  }
  s.events.push({ e: 'ability', hero, kind, x, y });
  if (kind === 'thunder') strike(s, b, V.thunderMul);
  else if (kind !== 'seed') {
    s.heroAbility = kind;
    s.heroTicks = kind === 'blaze' ? EM.blazeTicks : DR.rainTicks;
  }
  return true;
}

/**
 * The relay (§2.1), right after syncTime: tagSoon tagSoonTicks before a TAG; at its tick the lead
 * becomes the incoming hero at its start meter with the hero state reset, the grace and the
 * clean-TAG watch start, and `tag` fires. The ability charge carries over.
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
  s.voltLit = true;
  s.voltTheta = -1;
  s.voltChain = 0;
  s.voltTick = -1e9;
  s.dripCool = true;
  s.heroAbility = null;
  s.heroTicks = 0;
  s.tagGrace = H.tagGraceTicks;
  s.tagWatch = H.tagCleanTicks;
  s.relayIdx = i + 1;
  s.stats.tags = (s.stats.tags as number) + 1;
  s.events.push({ e: 'tag', from, to: r.to, index: i });
}

/**
 * A flake (`k` 1) or crystal (`k` 2) the lead took on a Trial (§1.1-§1.5): Nubs +flakeChill (a
 * crystal +crystalChill) as today; Ember hisses (steam for 0 during a Blaze), Sprout sips, Drip gets
 * an ice cube, Volt gets Snow only; heroPickup reports a non-Nubs meter change. A hiss that takes the
 * last Heat is the death line's 'hiss', an ice cube that takes Drip's last warmth its 'freeze'.
 */
export function heroFlake(s: SimState, p: Pickup, k: number): void {
  const nb = s.nubs;
  const h = nb.hero;
  const T = nb.chill;
  if (h === 'nubs') {
    nb.chill = Math.min(nb.maxChill, T + (k > 1 ? P.crystalChill : P.flakeChill));
    return;
  }
  const d = k * (h === 'ember' ? (s.heroAbility === 'blaze' ? 0 : EM.flake) : h === 'sprout' ? SP.flake : h === 'drip' ? DR.flake : 0);
  let v = Math.min(nb.maxChill, T + d);
  if (v <= 0) {
    v = 0;
    // Only a flake that took the last of the meter is the death line's (a body already out stays out).
    if (T > 0) s.heroCause = h === 'ember' ? 'hiss' : h === 'drip' ? 'freeze' : s.heroCause;
  }
  nb.chill = v;
  s.events.push({ e: 'heroPickup', hero: h, delta: v - T, x: p.x, y: p.y });
}

/**
 * The DeathInfo of a Trial (§4.8, §6.4): the body that failed (the lead wins a same-tick tie), its
 * hero (`who`) and how (`heroCause`). Nubs keeps today's deathCause lines; the others get their own
 * (glare lines → cause 'glare', the cloud line → 'cloud', named shade → 'gap', the rest 'plain'). A
 * duo's line ends with the partner who cannot go on alone.
 */
export function heroDeath(s: SimState): DeathInfo {
  const lead = s.nubs;
  const m = s.mate;
  const nb = m === null || lead.chill <= 0 ? lead : m;
  const h = nb.hero;
  let info: DeathInfo;
  if (h === 'nubs') {
    info = deathCause(s);
    info.heroCause = 'melt';
  } else {
    const time = exactClock(s.day, s.dayTick);
    const at = ` at ${time}`;
    const named = nb.lastShaderId >= 0 && s.tick - nb.lastShaderTick <= TUNING.death.gapLastSec * TICK_HZ;
    const name = named ? nb.lastShaderName : '';
    const inShade = named ? ` in the shade of ${name}` : ' in the shade';
    const ballId = nb.glareBallId;
    const ball = ballId >= 0 ? (s.world.balls.find((b) => b.id === ballId)?.name ?? 'a Gazing Ball') : '';
    // Shade lines name their caster ('gap') when one shaded the body within gapLastSec.
    const shade: DeathCause = named ? 'gap' : 'plain';
    let cause: DeathCause = 'plain';
    let hc: HeroDeath;
    let line: string;
    if (h === 'ember') {
      if (s.heroCause === 'hiss') {
        hc = 'hiss';
        line = `Hissed out by a snowflake${at}.`;
      } else if (s.snapTicks > 0) {
        // Nubs' Cold Snap cloud rides over both bodies (§2.2): it, not a caster, took the Heat.
        hc = 'smother';
        line = `Smothered by the Cold Snap${at}.`;
        cause = 'cloud';
      } else if (nb.cloudId >= 0) {
        hc = 'douse';
        line = `Doused by a passing cloud${at}.`;
        cause = 'cloud';
      } else {
        hc = 'snuff';
        line = named ? `Snuffed${inShade}${at}.` : `Snuffed out${at}.`;
        cause = shade;
      }
    } else if (ball && h !== 'drip') {
      // Glare scorches Sprout and overloads Volt.
      hc = h === 'sprout' ? 'scorch' : 'overload';
      line = `${h === 'sprout' ? 'Scorched' : 'Overloaded'} by ${ball}${at}.`;
      cause = 'glare';
    } else if (h === 'sprout') {
      hc = nb.c === 0 ? 'starve' : 'wilt';
      line = nb.c === 0 ? `Starved${inShade}${at}.` : `Wilted in full sun${at}.`;
      if (nb.c === 0) cause = shade;
    } else if (h === 'volt') {
      hc = 'fizzle';
      // From the last strike, else from this turn's start: its TAG on a relay, else go.
      const from = s.voltTick >= 0 ? s.voltTick : s.relayIdx > 0 ? s.tick - (s.tickAbs - tagTick(s.trial as TrialDef, s.relayIdx - 1)) : TUNING.start.readyTicks;
      line = `Fizzled out${at}: no new shade for ${Math.round((s.tick - from) / TICK_HZ)} s.`;
    } else if (s.heroCause === 'boil') {
      hc = 'boil';
      line = nb.w[0] === 2 ? `Boiled away in the glare of ${ball}${at}.` : `Boiled away in full sun${at}.`;
      if (nb.w[0] === 2) cause = 'glare';
    } else if (s.heroCause === 'freeze') {
      // An ice cube (a flake) took the last of Drip's warmth, wherever the light was.
      hc = 'freeze';
      line = `Froze solid on an ice cube${at}.`;
    } else {
      hc = 'freeze';
      line = `Froze solid${inShade}${at}.`;
      cause = shade;
    }
    info = { day: s.day, tDay: s.tDay, minutes: s.minutes, time, x: nb.x, y: nb.y, cause, line, heroCause: hc };
    if (cause === 'glare') info.ballId = ballId;
    if (cause === 'gap') {
      info.lastId = nb.lastShaderId;
      info.lastName = name;
    }
  }
  info.who = h;
  if (m !== null) info.line += ` ${HEROES[nb === lead ? m.hero : lead.hero].name} can't go on alone.`;
  return info;
}
