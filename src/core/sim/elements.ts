// Elementals v2 (docs/ELEMENTALS_V2.md §1-§4, §7.7-§7.8): the elements on Trials. Each element plays
// its own verb inside a run that stays a walk to the finish; s.el holds what a Trial adds (its
// objects, Drip's offset, Gust's wind, Sprout's hold, the leg's spending). Every rule here runs only
// on a Trial (s.el !== null). The pure reads take no allocation; createEl runs once per run.
//
// Contract stage (C0b): the reads keep their final signatures and return neutral values, createEl
// places the objects, the relay resets the meter at each TAG, and every walker's meter runs on Nubs'
// trial rule. The element rules land with CORE's branch.

import type { HeroId } from '../../config/heroes.ts';
import type { TrialDef } from '../../config/trials.ts';
import { TUNING } from '../../config/tuning.ts';
import { DT, tickAtMinute } from '../clock.ts';
import { buildParts, makeCaster } from '../gen/catalog.ts';
import { biomeAtY, worldYAtTick } from '../gen/plan.ts';
import { cloudLumps } from '../gen/placer.ts';
import { insertCaster, removeCaster } from '../gen/store.ts';
import { EL_BURNING, EL_ID_BASE, EL_IDLE, TREE_ID_BASE, type Cloud, type ElObj, type ElState } from '../objects.ts';
import { trailX } from '../trail.ts';
import { deathCause } from './deathcause.ts';
import type { DeathInfo } from './events.ts';
import { addFrost } from './mechanics.ts';
import { effectiveDrain, keepMemory } from './nubs.ts';
import type { InputFrame, NubsState, SimState } from './types.ts';

const E = TUNING.elements;
const O = E.objects;
/** TAGs fire on the validator's 0.1 s grid. */
const STEP = TUNING.validator.stepTicks;
/** The Drip mask's samples: time samples × lane points × 360 bins (§4.4). */
const MASK_SIZE = ((E.tagMask.secs * 60) / E.tagMask.step) * E.tagMask.lanes.length * 360;
const NO_MASK = new Uint8Array(0);

// ---------------------------------------------------------------------------------------------
// Kept from v1: health, start meters and the relay's schedule
// ---------------------------------------------------------------------------------------------

/** 0..100: 100·chill/maxChill (the gauge). */
export function heroHealth(nb: NubsState): number {
  return (100 * nb.chill) / nb.maxChill;
}

/** An element's meter when its leg begins (TUNING.elements.start; a Trial's tune.legStart may override per leg). */
export function heroStart(hero: HeroId): number {
  return E.start[hero];
}

/** The meter leg `leg` of trial `t` starts at: its tune.legStart, else its element's start. */
function legStart(t: TrialDef, leg: number, hero: HeroId): number {
  return t.tune.legStart[leg] || heroStart(hero);
}

/** The absolute tick relay `i` of trial `t` fires at: its minute, on the 6-tick grid. */
export function tagTick(t: TrialDef, i: number): number {
  const r = t.relays[i];
  return r ? STEP * Math.round(tickAtMinute(r.minute) / STEP) : -1;
}

/** Ticks to the next TAG (−1 none). Never allocates. */
export function nextTagTicks(s: SimState): number {
  const t = s.trial;
  if (t === null || s.relayIdx >= t.relays.length) return -1;
  return tagTick(t, s.relayIdx) - s.tickAbs;
}

/** The next TAG's incoming element (null none). */
export function nextTagHero(s: SimState): HeroId | null {
  const r = s.trial?.relays[s.relayIdx];
  return r ? r.to : null;
}

/** A TAG is due within tagSoonTicks: the Cold Snap is refused. */
export function tagLocked(s: SimState): boolean {
  const n = nextTagTicks(s);
  return n >= 0 && n <= E.tagSoonTicks;
}

/** World y of relay i's Tag Stone (−1e9 when the trial has no relay i). */
export function relayY(s: SimState, i: number): number {
  const t = s.trial;
  return t !== null && i >= 0 && i < t.relays.length ? worldYAtTick(s.world, tagTick(t, i)) : -1e9;
}

// ---------------------------------------------------------------------------------------------
// The pure reads (§7.7). All countdowns are to the contact edge (§0.2).
// ---------------------------------------------------------------------------------------------

/** Steady health (§1.2): 100·min(maxChill, chill + el.spent)/maxChill; heroHealth off Trials. */
export function elHealth(s: SimState): number {
  const nb = s.nubs;
  const el = s.el;
  return el === null ? heroHealth(nb) : (100 * Math.min(nb.maxChill, nb.chill + el.spent)) / nb.maxChill;
}

/** The element that walks at world y (the relay schedule). */
export function walkerAt(_s: SimState, _y: number): HeroId {
  return 'nubs';
}

/** Gust's wind plus the Trial's breeze (u/s, + east; 0 off Trials). */
export function windAt(_s: SimState): number {
  return 0;
}

/** Weather object `o`'s x after `ticks` with no new swipe. */
export function weatherXAt(_s: SimState, o: ElObj, _ticks: number): number {
  return o.x;
}

/** The arrival ghost's colour (§3.6): 1 helpful (green), −1 harmful (red), 0 neither. */
export function weatherGood(_s: SimState, _o: ElObj): -1 | 0 | 1 {
  return 0;
}

/** Ticks until the walker reaches world y (−1 behind). */
export function arriveTicks(_s: SimState, _y: number): number {
  return -1;
}

/** Ticks until the walker reaches o's contact edge (−1 once reached). */
export function contactTicks(_s: SimState, _o: ElObj): number {
  return -1;
}

/** A site's full size: a crossing's 2r, a plot's treeMax. */
export function needOf(_o: ElObj): number {
  return 0;
}

/** A crossing whose bridge is complete (grown ≥ need). */
export function bridged(_o: ElObj): boolean {
  return false;
}

/** Ticks left for a tap that still works (§2.2): an own bramble/gate to `near`, else to burn-out before contact. */
export function burnLeft(_s: SimState, _o: ElObj): number {
  return -1;
}

/** A tap now is just in time (an own bramble/gate in its sweet window; else 0 ≤ burnLeft ≤ nowTicks). */
export function burnSweet(_s: SimState, _o: ElObj): boolean {
  return false;
}

/** Ticks of slack at the current growth rate before contact (< 0: late). */
export function growLeft(_s: SimState, _o: ElObj): number {
  return -1;
}

/** Fog hides it (§3.6). */
export function veiled(_s: SimState, _o: ElObj): boolean {
  return false;
}

/** The target a tap at (x, y) would burn now (index in s.el.objs, −1 none); NaN x: the Up key's. */
export function burnTarget(_s: SimState, _x: number, _y: number): number {
  return -1;
}

/** The site a hold at (x, y) would grow now (index in s.el.objs, −1 none); NaN x: the Up key's. */
export function growTarget(_s: SimState, _x: number, _y: number): number {
  return -1;
}

/** Drip's lane [lo, hi] (u from the trail centre) at the walker's y, into out[0], out[1]. */
export function laneOf(_s: SimState, out: Float64Array): void {
  out[0] = -E.drip.range;
  out[1] = E.drip.range;
}

/** The ground point (x, y) is lit now (not shaded by any caster or cloud, sun up). */
export function pointLit(_s: SimState, _x: number, _y: number): boolean {
  return false;
}

// ---------------------------------------------------------------------------------------------
// Internal to core: the trial pass, the step's element rules, the death line
// ---------------------------------------------------------------------------------------------

/** A placed object's radius when its authored r is omitted. */
function radiusOf(k: ElObj['kind']): number {
  return k === 'puddle' ? O.puddleR : k === 'stone' ? O.stoneR : k === 'plot' ? O.plotR : 0;
}

/**
 * The trial pass (§3.2), once in createRun after the world is generated through finishY +
 * hardAhead: s.el with the Trial's objects at their places (y-sorted, ties in list order), every
 * field at its default, and Drip's mask buffer when a leg is Drip's.
 */
export function createEl(s: SimState): ElState {
  const t = s.trial as TrialDef;
  const w = s.world;
  const placed = t.objects.map((p, i) => ({ p, i, y: worldYAtTick(w, tickAtMinute(p.m)) }));
  placed.sort((a, b) => a.y - b.y || a.i - b.i);
  const objs = placed.map(({ p, y }, i): ElObj => ({
    id: EL_ID_BASE + i,
    kind: p.k,
    x: trailX(w.trail, y) + p.dx,
    y,
    r: p.r ?? radiusOf(p.k),
    drift: p.drift ?? 0,
    state: EL_IDLE,
    t: 0,
    paid: 0,
    size: 0,
    grown: 0,
    light: 0,
    casterId: -1,
    hit: false,
    awake: false,
  }));
  const drip = t.cast.includes('drip');
  return { objs, dx: 0, dxTarget: 0, wind: 0, hold: -1, spent: 0, touch: 0, legTick: 0, fell: false, cause: null, causeObj: -1, tagMask: drip ? new Uint8Array(MASK_SIZE) : NO_MASK };
}

/** A rain object's shade proxy (§3.6): a z-0 cloud under it, its x written by the sim as the cloud drifts. */
export function addRainProxy(s: SimState, o: ElObj): void {
  const w = s.world;
  const ry = E.weather.ryRatio * o.r;
  const cl: Cloud = { id: o.id, kind: 'rain', t0: s.tAbs, life: 1e6, x0: o.x, y0: o.y, vx: 0, vy: 0, rx: o.r, ry, z: 0, lumps: cloudLumps(w.seed, o.id, o.r, ry) };
  w.clouds.push(cl);
}

/** A plot's tree (§3.5): a real caster, TREE_ID_BASE + i, scaled by the Sap poured in. */
export function standTree(s: SimState, i: number): void {
  const w = s.world;
  const o = (s.el as ElState).objs[i] as ElObj;
  const id = TREE_ID_BASE + i;
  const dx = o.x - trailX(w.trail, o.y);
  insertCaster(
    w,
    makeCaster({
      id,
      kind: 'tree',
      name: "Sprout's Tree",
      biome: biomeAtY(w, o.y),
      x: o.x,
      y: o.y,
      rot: 0,
      parts: buildParts('tree', o.x, o.y, 0, 0, 0.5 + o.size / 100),
      side: dx < 0 ? -1 : 1,
      rescue: false,
      gate: false,
      ballId: -1,
      chunk: Math.floor(o.y / TUNING.world.chunkLen),
    }),
  );
  o.casterId = id;
}

/** The walker's meter at go: its leg-0 start. */
export function elStart(t: TrialDef): number {
  return legStart(t, 0, t.cast[0] as HeroId);
}

/**
 * The relay (§4.1), right after syncTime: tagSoon tagSoonTicks before a TAG; at its tick the walker
 * becomes the incoming element at its leg's start meter, the leg's spending, hold and tick count
 * reset, Drip's target recentres unless Drip comes in, the grace and the clean-TAG watch start, and
 * `tag` fires. The Cold Snap charge carries over.
 */
export function updateRelay(s: SimState): void {
  const t = s.trial as TrialDef;
  const el = s.el as ElState;
  const i = s.relayIdx;
  const r = t.relays[i];
  if (!r) return;
  const n = tagTick(t, i) - s.tickAbs;
  if (n === E.tagSoonTicks) s.events.push({ e: 'tagSoon', to: r.to, ticks: n });
  if (n > 0) return;
  const nb = s.nubs;
  const from = nb.hero;
  nb.hero = r.to;
  nb.chill = legStart(t, i + 1, r.to);
  el.spent = 0;
  el.hold = -1;
  el.legTick = 0;
  if (r.to !== 'drip') el.dxTarget = 0;
  s.tagGrace = E.tagGraceTicks;
  s.tagWatch = E.tagCleanTicks;
  s.relayIdx = i + 1;
  s.stats.tags = (s.stats.tags as number) + 1;
  s.events.push({ e: 'tag', from, to: r.to, index: i });
}

/** The walking element's verbs, steering, weather, fire and plants (§7.8). Contract stage: nothing yet. */
export function updateElements(_s: SimState, _inp: InputFrame): void {}

/**
 * A Trial's daylight tick (§7.8), in place of applyDaylight: the walker's rate on Nubs' trial rule
 * (−D·f + R·max(0, 1 − f), f = c/5: the validator's chillDeltaTable expression) with the TAG grace's
 * floor, the meter, safe (strict shade), the steady health into stats.minChill and lowChill, the
 * Cold Snap's income on Nubs legs, the clean-TAG watch, the shade, glare and cloud memory, the lit
 * totals and the leg's tick count.
 */
export function applyElDaylight(s: SimState): void {
  const nb = s.nubs;
  const st = s.stats;
  const el = s.el as ElState;
  const D = effectiveDrain(s);
  const R = s.params.regen;
  const c = nb.c;
  const hp0 = elHealth(s);
  const f = c / 5;
  let rate = -D * f + R * Math.max(0, 1 - f);
  // After a TAG the incoming meter's continuous rate cannot be negative for tagGraceTicks.
  if (s.tagGrace > 0) {
    s.tagGrace--;
    if (rate < 0) rate = 0;
  }
  nb.rate = rate;
  nb.safe = c === 0;
  nb.chill = Math.max(0, Math.min(nb.maxChill, nb.chill + rate * DT));
  const hp = elHealth(s);
  if (hp < st.minChill) st.minChill = hp;
  if (hp < E.lowHealth) {
    if (hp0 >= E.lowHealth) s.events.push({ e: 'lowChill' });
    s.hourHot = true;
  }
  if (nb.hero === 'nubs' && c === 0) addFrost(s, E.nubs.income * DT);
  if (s.tagWatch > 0) {
    if (nb.safe) {
      s.tagWatch = 0;
      st.cleanTags = (st.cleanTags as number) + 1;
      s.events.push({ e: 'tagClean', to: nb.hero });
    } else {
      s.tagWatch--;
    }
  }
  keepMemory(s, nb);
  st.litTotal += nb.f * DT;
  s.hourLit += nb.f * DT;
  el.legTick++;
}

/** The run ends on a Trial (§7.8): a fall, or a life meter (all but Sprout's Sap) at 0. */
export function elDead(s: SimState): boolean {
  const el = s.el as ElState;
  return el.fell || (s.nubs.hero !== 'sprout' && s.nubs.chill <= 0);
}

/** The DeathInfo of a Trial (§10.4): today's deathCause line, with the walker (`who`) and how (`heroCause`). */
export function elDeath(s: SimState): DeathInfo {
  const info = deathCause(s);
  info.heroCause = 'melt';
  info.who = s.nubs.hero;
  return info;
}

/** Plots whose tree still stands (stats.grove at the finish). */
export function groveCount(s: SimState): number {
  let n = 0;
  for (const o of (s.el as ElState).objs) if (o.kind === 'plot' && o.casterId >= 0) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------
// Debug (§7.1 C0b item 5): behind the session's makeBot build flag, so build:single drops it
// ---------------------------------------------------------------------------------------------

/**
 * Replaces a Trial's objects with one of each kind in each of its states just ahead of the walker,
 * so the art can draw every state: walls intact, burning (three frames, an own and a spread fire)
 * and ice melting; gaps and streams unbridged, half-bridged and bridged; puddles still and drying;
 * stones fresh and spent; plots empty, a sapling, a tree, a wet one and one under a fog bank; awake
 * rain clouds whose ghosts land on and off the trail.
 */
export function elFixture(s: SimState): void {
  const el = s.el as ElState;
  const w = s.world;
  for (let i = w.clouds.length - 1; i >= 0; i--) if ((w.clouds[i] as Cloud).id >= EL_ID_BASE && (w.clouds[i] as Cloud).id < TREE_ID_BASE) w.clouds.splice(i, 1);
  for (const o of el.objs) if (o.casterId >= 0) removeCaster(w, o.casterId);
  // [dy ahead, kind, dx, r, state, t, paid, size, grown, light, hit, awake, drift]
  const rows: [number, ElObj['kind'], number, number, 0 | 1 | 2, number, number, number, number, number, boolean, boolean, number][] = [
    [60, 'bramble', 0, 0, 0, 0, 0, 0, 0, 0, false, false, 0],
    [95, 'bramble', 0, 0, 1, 50, 12, 0, 0, 0, false, false, 0],
    [130, 'gate', 0, 0, 1, 42, 0, 0, 0, 0, false, false, 0],
    [165, 'bramble', 0, 0, 1, 8, 12, 0, 0, 0, false, false, 0],
    [200, 'ice', 0, 0, 0, 0, 0, 0, 0, 0, false, false, 0],
    [235, 'ice', 0, 0, 1, 30, 18, 0, 0, 0, false, false, 0],
    [270, 'gap', 0, 12, 0, 0, 0, 0, 0, 0, false, false, 0],
    [305, 'gap', 0, 14, 0, 0, 0, 28, 14, 1, false, false, 0],
    [340, 'stream', 0, 16, 0, 0, 0, 32, 32, 0, false, false, 0],
    [375, 'stream', 0, 12, 0, 0, 0, 0, 0, 0, false, false, 0],
    [410, 'gate', 0, 0, 0, 0, 0, 0, 0, 0, false, false, 0],
    [60, 'puddle', -80, O.puddleR, 0, 0, 0, 0, 0, 0, false, false, 0],
    [95, 'puddle', 80, O.puddleR, 1, 15, 8, 0, 0, 0, false, false, 0],
    [130, 'stone', -80, O.stoneR, 0, 0, 0, 0, 0, 0, false, false, 0],
    [165, 'stone', 80, O.stoneR, 0, 0, 0, 0, 0, 0, true, false, 0],
    [200, 'plot', -60, O.plotR, 0, 0, 0, 0, 0, 0, false, false, 0],
    [235, 'plot', 60, O.plotR, 0, 0, 0, 15, 10, 1, false, false, 0],
    [270, 'plot', -60, O.plotR, 0, 0, 0, 40, 40, 0, false, false, 0],
    [305, 'plot', 60, O.plotR, 0, 0, 0, 30, 12, 2, false, false, 0],
    [340, 'plot', -60, O.plotR, 0, 0, 0, 0, 0, 0, false, false, 0],
    [340, 'fog', -60, 50, 0, 0, 0, 0, 0, 0, false, true, 4],
    [250, 'rain', 110, 45, 0, 0, 0, 0, 0, 0, false, true, -10],
    [380, 'rain', 150, 40, 0, 0, 0, 0, 0, 0, false, true, 10],
  ];
  rows.sort((a, b) => a[0] - b[0]);
  const y0 = s.nubs.y;
  el.objs.length = 0;
  rows.forEach(([dy, kind, dx, r, state, t, paid, size, grown, light, hit, awake, drift], i) => {
    const y = y0 + dy;
    el.objs.push({ id: EL_ID_BASE + i, kind, x: trailX(w.trail, y) + dx, y, r, drift, state: state === 1 ? EL_BURNING : state, t, paid, size, grown, light, casterId: -1, hit, awake });
  });
  el.objs.forEach((o, i) => {
    if (o.kind === 'rain') addRainProxy(s, o);
    if (o.kind === 'plot' && o.size === 40) standTree(s, i);
  });
}
