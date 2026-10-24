// Elementals v2 (docs/ELEMENTALS_V2.md §1-§4, §7.7-§7.8): the elements on Trials. Each element plays
// its own verb inside a run that stays a walk to the finish; s.el holds what a Trial adds (its
// objects, Drip's offset, Gust's wind, Sprout's hold, the leg's spending). Every rule here runs only
// on a Trial (s.el !== null). The pure reads take no allocation; createEl runs once per run.
//
// Skeleton stage (C0c): the objects live (the sun holds on Drip and Gust legs; taps burn, holds grow
// and swipes blow at no cost; Drip steers in its lane; weather wakes, drifts and is pruned with its
// rain shade proxies; fires burn out; plants grow into bridges and trees), the reads are real except
// veiled, and every walker's meter runs on Nubs' trial rule. Costs, feeds, contacts, fire spread,
// douse, veils, Sprout's safe, the guide and the element deaths land with CORE's branch.

import type { HeroId } from '../../config/heroes.ts';
import type { ElKind, TrialDef } from '../../config/trials.ts';
import { TUNING } from '../../config/tuning.ts';
import { DT, tickAtMinute } from '../clock.ts';
import { buildParts, makeCaster } from '../gen/catalog.ts';
import { biomeAtY, worldYAtDayTick, worldYAtTick } from '../gen/plan.ts';
import { cloudLumps } from '../gen/placer.ts';
import { insertCaster, lowerBound, removeCaster } from '../gen/store.ts';
import { EL_BURNING, EL_GONE, EL_ID_BASE, EL_IDLE, TREE_ID_BASE, type Caster, type Cloud, type ElObj, type ElState, type Part } from '../objects.ts';
import { casterShades, cloudAlive, cloudShades, shadowLength } from '../shadows.ts';
import { trailX } from '../trail.ts';
import { deathCause } from './deathcause.ts';
import type { DeathInfo } from './events.ts';
import { addFrost } from './mechanics.ts';
import { effectiveDrain, keepMemory } from './nubs.ts';
import { VERB_EAST, VERB_HOLD, VERB_KEY_BURN, VERB_KEY_HOLD, VERB_RELEASE, VERB_TAP, VERB_WEST, type InputFrame, type NubsState, type SimState } from './types.ts';

const E = TUNING.elements;
const O = E.objects;
const EM = E.ember;
const SP = E.sprout;
const DR = E.drip;
const G = E.gust;
const WE = E.weather;
const MAX_R = TUNING.world.maxCasterRadius;
/** The lane counts prism parts within this many u of the walker's y (§3.7). */
const LANE_DY = 8;
/** Sites refresh their light bits on guide ticks. */
const GUIDE_TICKS = TUNING.guide.everyTicks;
/** Scratch for Drip's lane. */
const lane = new Float64Array(2);
/** The sim moves a rain proxy (the v1.6 snap cloud's precedent). */
type MutableCloud = { -readonly [K in keyof Cloud]: Cloud[K] };
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
export function walkerAt(s: SimState, y: number): HeroId {
  const t = s.trial;
  if (t === null) return 'nubs';
  let h = t.cast[0] as HeroId;
  for (let i = 0; i < t.relays.length; i++) {
    if (y < relayY(s, i)) break;
    h = (t.relays[i] as { to: HeroId }).to;
  }
  return h;
}

/** Gust's wind plus the Trial's breeze (u/s, + east; 0 off Trials). */
export function windAt(s: SimState): number {
  return s.el === null || s.trial === null ? 0 : s.el.wind + s.trial.breeze;
}

/** Weather object `o`'s x after `ticks` with no new swipe (tick by tick, at most 600; no pow). */
export function weatherXAt(s: SimState, o: ElObj, ticks: number): number {
  const el = s.el;
  const t = s.trial;
  if (el === null || t === null || o.state === EL_GONE || !isWeather(o.kind)) return o.x;
  const gain = o.kind === 'rain' ? G.rainGain : G.fogGain;
  // A sleeping object waits at its place until the walker comes within `wake` of it.
  const from = o.awake ? 0 : arriveTicks(s, o.y - WE.wake);
  const n = ticks < 600 ? ticks : 600;
  let x = o.x;
  let w = el.wind;
  for (let k = 1; k <= n; k++) {
    w = decay(w);
    if (k >= from) x += (o.drift + gain * (w + t.breeze)) * DT;
  }
  return x;
}

/** The arrival ghost's colour (§3.6): 1 helpful (green), −1 harmful (red), 0 neither. */
export function weatherGood(s: SimState, o: ElObj): -1 | 0 | 1 {
  if (s.el === null || o.state === EL_GONE || !isWeather(o.kind)) return 0;
  const h = walkerAt(s, o.y);
  // Rain helps Nubs, Drip and Sprout wherever it lands (a ghost off the trail asks to be pushed on).
  if (o.kind === 'rain' && (h === 'nubs' || h === 'drip' || h === 'sprout')) return 1;
  if (o.kind === 'fog' && (h === 'nubs' || h === 'drip')) return 0;
  const gx = weatherXAt(s, o, Math.max(0, arriveTicks(s, o.y)));
  return Math.abs(gx - trailX(s.world.trail, o.y)) < o.r ? -1 : 0;
}

/** Ticks until the walker reaches world y (−1 behind). */
export function arriveTicks(s: SimState, y: number): number {
  const d = y - s.nubs.y;
  return d < 0 ? -1 : Math.ceil(d / pace(s));
}

/** Ticks until the walker reaches o's contact edge (−1 once reached). */
export function contactTicks(s: SimState, o: ElObj): number {
  const d = edgeOf(o) - s.nubs.y;
  return d <= 0 ? -1 : Math.ceil(d / pace(s));
}

/** A site's full size: a crossing's 2r, a plot's treeMax. */
export function needOf(o: ElObj): number {
  return isCrossing(o.kind) ? 2 * o.r : o.kind === 'plot' ? SP.treeMax : 0;
}

/** A crossing whose bridge is complete (grown ≥ need). */
export function bridged(o: ElObj): boolean {
  return isCrossing(o.kind) && o.grown >= 2 * o.r;
}

/** Ticks left for a tap that still works (§2.2): an own bramble/gate to `near`, else to burn-out before contact. */
export function burnLeft(s: SimState, o: ElObj): number {
  if (ownWall(s, o)) return Math.floor((edgeOf(o) - E.near - s.nubs.y) / pace(s));
  return contactTicks(s, o) - burnTicksOf(o);
}

/** A tap now is just in time (an own bramble/gate in its sweet window; else 0 ≤ burnLeft ≤ nowTicks). */
export function burnSweet(s: SimState, o: ElObj): boolean {
  if (ownWall(s, o)) {
    // The fire is still burning when Ember gets there: burnTicks of walking at most, and not inside `near`.
    const d = edgeOf(o) - s.nubs.y;
    return d >= E.near && d <= burnTicksOf(o) * pace(s);
  }
  const l = burnLeft(s, o);
  return l >= 0 && l <= EM.nowTicks;
}

/** Ticks of slack at the current growth rate before contact (< 0: late). */
export function growLeft(s: SimState, o: ElObj): number {
  const left = needOf(o) - o.grown;
  return contactTicks(s, o) - (left <= 0 ? 0 : Math.ceil(left / growPerTick(o)));
}

/** Fog hides it (§3.6). Skeleton: nothing is veiled yet (veils are CORE's branch work). */
export function veiled(_s: SimState, _o: ElObj): boolean {
  return false;
}

/** The target a tap at (x, y) would burn now (index in s.el.objs, −1 none); NaN x: the Up key's. */
export function burnTarget(s: SimState, x: number, y: number): number {
  const el = s.el;
  if (el === null || s.nubs.hero !== 'ember') return -1;
  const w = s.world;
  const tagY = s.trial !== null && s.relayIdx < s.trial.relays.length ? relayY(s, s.relayIdx) : Infinity;
  let best = -1;
  let bestRank = 2;
  let bestD = Infinity;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.state !== EL_IDLE) continue;
    const wall = isWall(o.kind);
    if (!wall && o.kind !== 'puddle') continue;
    const e = edgeOf(o);
    const ahead = e - s.nubs.y;
    if (ahead < E.near || ahead > E.range || veiled(s, o)) continue;
    // A puddle only on Ember's own path, reached before the next TAG (the rest belong to whoever walks there).
    if (!wall && (Math.abs(o.x - trailX(w.trail, o.y)) > O.puddleR + O.touch || e >= tagY)) continue;
    const rank = wall ? 0 : 1;
    const d = x !== x ? ahead : footDist(s, o, x, y);
    if (d > E.reach && x === x) continue;
    if (rank < bestRank || (rank === bestRank && d < bestD)) {
      best = i;
      bestRank = rank;
      bestD = d;
    }
  }
  return best;
}

/** The site a hold at (x, y) would grow now (index in s.el.objs, −1 none); NaN x: the Up key's. */
export function growTarget(s: SimState, x: number, y: number): number {
  const el = s.el;
  if (el === null || s.nubs.hero !== 'sprout') return -1;
  let best = -1;
  let bestRank = 2;
  let bestD = Infinity;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.state === EL_GONE) continue;
    const cross = isCrossing(o.kind);
    if (cross ? bridged(o) : o.kind !== 'plot' || o.casterId >= 0) continue;
    const ahead = edgeOf(o) - s.nubs.y;
    if (ahead < E.near || ahead > E.range || veiled(s, o)) continue;
    const rank = cross ? 0 : 1;
    const d = x !== x ? ahead : footDist(s, o, x, y);
    if (d > E.reach && x === x) continue;
    if (rank < bestRank || (rank === bestRank && d < bestD)) {
      best = i;
      bestRank = rank;
      bestD = d;
    }
  }
  return best;
}

/** Drip's lane [lo, hi] (u from the trail centre) at the walker's y, into out[0], out[1] (§3.7). */
export function laneOf(s: SimState, out: Float64Array): void {
  let lo = -DR.range;
  let hi = DR.range;
  const w = s.world;
  const y = s.nubs.y;
  const tx = trailX(w.trail, y);
  const cs = w.casters;
  for (let i = lowerBound(cs, y - LANE_DY - MAX_R); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > y + LANE_DY + MAX_R) break;
    if (c.minY > y + LANE_DY || c.maxY < y - LANE_DY) continue;
    const parts = c.parts;
    for (let k = 0; k < parts.length; k++) {
      // Only the ground-standing parts: slabs and canopy discs float, Drip passes under them.
      const p = parts[k] as Part;
      if (p.t !== 'prism' || p.minY > y + LANE_DY || p.maxY < y - LANE_DY) continue;
      const x0 = p.minX - tx;
      const x1 = p.maxX - tx;
      if (x0 > 0) hi = Math.min(hi, x0 - DR.clear);
      else if (x1 < 0) lo = Math.max(lo, x1 + DR.clear);
    }
  }
  out[0] = lo;
  out[1] = hi;
}

/** The ground point (x, y) is lit now (not shaded by any caster or cloud, sun up). */
export function pointLit(s: SimState, x: number, y: number): boolean {
  if (!s.sunUp || s.eclipseOn) return false;
  const w = s.world;
  const { ux, uy, cot } = s;
  const reach = shadowLength(w.maxZ, cot);
  const cs = w.casters;
  for (let i = lowerBound(cs, y - reach - MAX_R); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > y + reach + MAX_R) break;
    if (casterShades(c, x, y, ux, uy, cot)) return false;
  }
  const cl = w.clouds;
  for (let i = 0; i < cl.length; i++) {
    const c = cl[i] as Cloud;
    if (cloudAlive(c, s.tAbs) && cloudShades(c, s.tAbs, x, y, ux, uy, cot)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Small helpers (no allocation)
// ---------------------------------------------------------------------------------------------

function isWall(k: ElKind): boolean {
  return k === 'bramble' || k === 'gate' || k === 'ice';
}

function isCrossing(k: ElKind): boolean {
  return k === 'gap' || k === 'stream';
}

function isWeather(k: ElKind): boolean {
  return k === 'rain' || k === 'fog';
}

/** The contact edge (§0.2): walls o.y − wallDepth/2, crossings o.y − r, weather its near rim, circles o.y − r − touch. */
function edgeOf(o: ElObj): number {
  const k = o.kind;
  if (isWall(k)) return o.y - O.wallDepth / 2;
  if (isCrossing(k)) return o.y - o.r;
  if (isWeather(k)) return o.y - WE.ryRatio * o.r;
  return o.y - o.r - O.touch;
}

/** The walker's pace now (u per tick of the day's schedule). */
function pace(s: SimState): number {
  return worldYAtDayTick(s.world, s.day, s.dayTick + 1) - s.nubs.y;
}

/** Ticks a fire on `o` burns (bramble, gate, ice, puddle, plot; 0 for the rest). */
function burnTicksOf(o: ElObj): number {
  const b = EM.burnTicks as Partial<Record<ElKind, number>>;
  return b[o.kind] ?? 0;
}

/** A bramble or gate Ember itself will reach (its fire can feed Ember, §2.2). */
function ownWall(s: SimState, o: ElObj): boolean {
  return (o.kind === 'bramble' || o.kind === 'gate') && walkerAt(s, edgeOf(o)) === 'ember';
}

/** A site's growth per tick from its light bits (§3.5): ×2 lit or wet, ×1.5 more wet. */
function growPerTick(o: ElObj): number {
  return SP.grow * DT * (o.light !== 0 ? SP.litMul : 1) * ((o.light & 2) !== 0 ? SP.rainMul : 1);
}

/** Distance from (x, y) to o's footprint (§1.4): walls and crossings their rectangle, circles centre distance − r. */
function footDist(s: SimState, o: ElObj, x: number, y: number): number {
  if (isWall(o.kind) || isCrossing(o.kind)) {
    const tx = trailX(s.world.trail, o.y);
    const hy = isWall(o.kind) ? O.wallDepth / 2 : o.r;
    const dx = Math.max(0, Math.abs(x - tx) - O.wallHalf);
    const dy = Math.max(0, Math.abs(y - o.y) - hy);
    return Math.sqrt(dx * dx + dy * dy);
  }
  const dx = x - o.x;
  const dy = y - o.y;
  return Math.sqrt(dx * dx + dy * dy) - o.r;
}

/** Wind after one tick's decay (to 0 below 0.01 u/s). */
function decay(w: number): number {
  const v = w * G.keep;
  return v < 0.01 && v > -0.01 ? 0 : v;
}

/** (x, y) inside a rain cloud's footprint (any rain object still there). */
function inRain(el: ElState, x: number, y: number): boolean {
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.kind !== 'rain' || o.state === EL_GONE) continue;
    const ex = (x - o.x) / o.r;
    const ey = (y - o.y) / (WE.ryRatio * o.r);
    if (ex * ex + ey * ey <= 1) return true;
  }
  return false;
}

/** The rain proxy cloud of object id `id` (null once removed). */
function proxyOf(w: SimState['world'], id: number): MutableCloud | null {
  const cs = w.clouds;
  for (let i = cs.length - 1; i >= 0; i--) if ((cs[i] as Cloud).id === id) return cs[i] as MutableCloud;
  return null;
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
  for (const o of objs) if (o.kind === 'rain') addRainProxy(s, o);
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

/**
 * The walking element's verbs, steering, weather, fire and plants (§7.8), after the snap: verbs →
 * steer, lane, dx → the walker's x → wind decay → weather wake, drift, prune and rain proxies →
 * burn-out → holds, growth, bridges and trees.
 *
 * Skeleton (C0c): verbs cost nothing (a tap burns, a hold pours without spending Sap, a swipe adds
 * wind); no contacts, fire spread, douse or veils yet (CORE's branch work).
 */
export function updateElements(s: SimState, inp: InputFrame): void {
  const el = s.el as ElState;
  const nb = s.nubs;
  const w = s.world;
  const objs = el.objs;
  const v = inp.verb ?? 0;
  if (v !== 0) verb(s, el, v, inp);

  // Drip steers its target (finger-exact, or the keys: key > 0 moves west); any other leg recentres.
  if (nb.hero === 'drip') {
    let t = el.dxTarget + (inp.steer ?? 0);
    const k = inp.key;
    if (k !== 0) t -= (k > 0 ? 1 : -1) * (k === 2 || k === -2 ? DR.keyFine : DR.keyRate) * DT;
    el.dxTarget = t > DR.range ? DR.range : t < -DR.range ? -DR.range : t;
  } else el.dxTarget = 0;
  const slide = DR.slide * DT;
  const d = el.dxTarget - el.dx;
  el.dx += d > slide ? slide : d < -slide ? -slide : d;
  if (el.dx !== 0) {
    // Trunks push Drip aside; it returns to the finger's target once they pass.
    laneOf(s, lane);
    const lo = lane[0] as number;
    const hi = lane[1] as number;
    if (el.dx < lo) el.dx = lo;
    if (el.dx > hi) el.dx = hi;
  }
  nb.x = trailX(w.trail, nb.y) + el.dx;
  el.wind = decay(el.wind);

  // Weather: wakes as the walker comes within `wake`, drifts with its own drift and the wind, is gone
  // `prune` off the trail or `behind` behind the walker; a rain cloud's proxy follows it.
  const wind = windAt(s);
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i] as ElObj;
    if (o.state === EL_GONE || !isWeather(o.kind)) continue;
    if (!o.awake && nb.y >= o.y - WE.wake) o.awake = true;
    if (!o.awake) continue;
    o.x += (o.drift + (o.kind === 'rain' ? G.rainGain : G.fogGain) * wind) * DT;
    const gone = Math.abs(o.x - trailX(w.trail, o.y)) > WE.prune || nb.y > o.y + WE.behind;
    if (gone) o.state = EL_GONE;
    if (o.kind !== 'rain') continue;
    const cl = proxyOf(w, o.id);
    if (cl === null) continue;
    if (gone) w.clouds.splice(w.clouds.indexOf(cl), 1);
    else cl.x0 = o.x;
  }

  // Fire: every burning (melting, drying) object counts down and burns out (§3.4).
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i] as ElObj;
    if (o.state !== EL_BURNING) continue;
    o.t--;
    if (o.t <= 0) burnOut(s, i, o);
  }

  // Plants (§3.5): the hold pours, every site grows toward its size, bridges complete and trees stand.
  const fresh = s.tickAbs % GUIDE_TICKS === 0;
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i] as ElObj;
    if (o.state === EL_GONE || !(isCrossing(o.kind) || o.kind === 'plot')) continue;
    const need = needOf(o);
    if (el.hold === i) {
      if (edgeOf(o) - nb.y < E.near) endHold(s, el);
      else o.size = Math.min(need, o.size + SP.invest * DT);
    }
    if (o.grown < o.size) {
      if (fresh) o.light = (pointLit(s, o.x, o.y) ? 1 : 0) | (inRain(el, o.x, o.y) ? 2 : 0);
      const before = o.grown;
      o.grown = Math.min(o.size, o.grown + growPerTick(o));
      if (isCrossing(o.kind) && before < need && o.grown >= need) s.events.push({ e: 'grown', obj: i, tree: false, x: o.x, y: o.y });
    }
    if (o.kind === 'plot' && o.casterId < 0 && o.size >= SP.treeMin && o.grown >= o.size && el.hold !== i) {
      standTree(s, i);
      s.stats.trees = (s.stats.trees as number) + 1;
      s.events.push({ e: 'grown', obj: i, tree: true, x: o.x, y: o.y });
    }
  }
}

/** The walking element's verb this tick (§7.8; one that does not match the walker is ignored). */
function verb(s: SimState, el: ElState, v: number, inp: InputFrame): void {
  const hero = s.nubs.hero;
  if (v === VERB_RELEASE) {
    if (el.hold >= 0) endHold(s, el);
    return;
  }
  if (hero === 'ember' && (v === VERB_TAP || v === VERB_KEY_BURN)) {
    const i = burnTarget(s, v === VERB_TAP ? (inp.vx ?? 0) : NaN, inp.vy ?? 0);
    if (i < 0) return;
    const o = el.objs[i] as ElObj;
    // Skeleton: the fire costs nothing yet (CORE's branch pays Flame here, or refuses with fizz 'low').
    o.state = EL_BURNING;
    o.t = burnTicksOf(o);
    o.paid = 0;
    s.events.push({ e: 'burn', obj: i, kind: o.kind, x: o.x, y: o.y, cost: 0, spread: false });
  } else if (hero === 'sprout' && (v === VERB_HOLD || v === VERB_KEY_HOLD)) {
    const i = growTarget(s, v === VERB_HOLD ? (inp.vx ?? 0) : NaN, inp.vy ?? 0);
    if (i < 0 || i === el.hold) return;
    if (el.hold >= 0) endHold(s, el);
    el.hold = i;
    const o = el.objs[i] as ElObj;
    s.events.push({ e: 'grow', obj: i, on: true, x: o.x, y: o.y });
  } else if (hero === 'gust' && (v === VERB_WEST || v === VERB_EAST)) {
    // Skeleton: a swipe costs no Lift yet.
    const dir = v === VERB_EAST ? 1 : -1;
    const wind = el.wind + dir * G.kick;
    el.wind = wind > G.windMax ? G.windMax : wind < -G.windMax ? -G.windMax : wind;
    s.stats.gusts = (s.stats.gusts as number) + 1;
    s.events.push({ e: 'gust', dir, wind: el.wind, cost: 0 });
  }
}

/** The hold lets go (lifted, replaced, or its site came within `near` of Sprout). */
function endHold(s: SimState, el: ElState): void {
  const o = el.objs[el.hold] as ElObj;
  s.events.push({ e: 'grow', obj: el.hold, on: false, x: o.x, y: o.y });
  el.hold = -1;
}

/** A fire's end (§3.4): a bramble or gate is gone, ice is a puddle where it stood, a puddle dries up, a plot and its tree are gone. */
function burnOut(s: SimState, i: number, o: ElObj): void {
  // stats.burns: every bramble, gate or plot cleared and every ice wall melted (a dried puddle is not).
  if (o.kind !== 'puddle') s.stats.burns = (s.stats.burns as number) + 1;
  o.t = 0;
  o.paid = 0;
  if (o.kind === 'ice') {
    o.kind = 'puddle';
    o.r = O.puddleR;
    o.state = EL_IDLE;
  } else {
    o.state = EL_GONE;
    if (o.casterId >= 0) {
      removeCaster(s.world, o.casterId);
      o.casterId = -1;
    }
  }
  s.events.push({ e: 'burnOut', obj: i, kind: o.kind, x: o.x, y: o.y });
}

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

/**
 * The run ends on a Trial (§7.8): a fall, or Nubs' Chill at 0. Skeleton (C0c): the other life meters
 * (Flame, Size, Lift) bottom out at 0 without ending the run, so the bots walk every leg on Nubs'
 * rule (the held sun would end most Drip and Gust legs); CORE's branch ends the run on every life
 * meter at 0 (all but Sprout's Sap) with the element rates.
 */
export function elDead(s: SimState): boolean {
  const el = s.el as ElState;
  return el.fell || (s.nubs.hero === 'nubs' && s.nubs.chill <= 0);
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
  for (const o of (s.el as ElState).objs) if (o.kind === 'plot' && o.state !== EL_GONE && o.casterId >= 0) n++;
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
