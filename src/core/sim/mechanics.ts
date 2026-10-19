// v1.5 core mechanics in the sim (docs/V1_5_PLAN.md §2): Sunflower buds (growth, bloom into a
// 'sunflower' caster, guide.bud), the frost meter and the Cold Snap cloud. Deep-shade detection lives
// in computeCoverage (nubs.ts), its effects in applyDaylight. Per-tick work is allocation-free; a
// bloom and a snap allocate their caster/cloud (like events, only when they happen).
//
// v1.6 economy (docs/V1_6_PLAN.md §2.2, §2.4; CORE-1): the Frost Bank (integer hundredths, income
// only from risky acts, banked under a snap, the snap's cash-in), the Frost Garden (×2 growth and a
// longer reach under the snap, blooms extend it, the cloud re-aims every 30 ticks) and guide.land.
// Economy iterations 1-2 (core README §16.4-§16.5): a red-hot Nubs (Chill under coolChill) grows no
// buds and freezes no frost; the cash-in pours the ring in full from cashFullChill, less the hotter
// Nubs is, at most cashMaxH and never past cashCapH; a red-hot snap only shades (no Chill refill);
// the v1.5 meter (Bank off) holds a snap's trick income and pays own landings, as the Bank does.

import { TUNING } from '../../config/tuning.ts';
import { dayStartTick, dayTicks, DT, TICK_HZ } from '../clock.ts';
import { angleDiff, tanD } from '../dmath.ts';
import { sunflowerParts, makeCaster } from '../gen/catalog.ts';
import { biomeAtY, noonHeatAt, worldElevation, worldYAtDayTick } from '../gen/plan.ts';
import { cloudLumps } from '../gen/placer.ts';
import { gatherScene, insertCaster, lowerBound } from '../gen/store.ts';
import { BINS, createMaskScene, litMask, markRange } from '../intervals.ts';
import { BUD_ID_BASE, RUNTIME_ID_BASE, SNAP_ID_BASE, type Bud, type Cloud } from '../objects.ts';
import { rngFor } from '../rng.ts';
import { trailX } from '../trail.ts';
import type { SimEvent } from './events.ts';
import { ringTrick } from './nubs.ts';
import type { InputFrame, SimState } from './types.ts';

const B = TUNING.buds;
const F = TUNING.frost;
const BANK = TUNING.bank;
const GARDEN = TUNING.garden;
const GROW = DT / B.growSec;
const DECAY = B.decay * DT;
/** Cold Snap length in ticks. */
export const SNAP_TICKS = Math.round(F.snapSec * TICK_HZ);
/** Hundredths of frost per charge (one snap). */
const CHARGE_H = BANK.costH;

/** A snap cloud the sim re-aims in place (v1.6 Garden): the one Cloud whose path changes after it is made. */
type MutableCloud = { -readonly [K in keyof Cloud]: Cloud[K] };

/** True when the sun at azimuth θ grows bud b (it must also be within reach and the sun up). */
export function budFacing(b: Bud, theta: number): boolean {
  return Math.abs(angleDiff(theta, b.face)) <= B.faceTol;
}

/**
 * v1.5 frost meter (the Frost Bank off): adds to the 0..1 meter (Cold Snap on); fires frostReady
 * when it fills. frostH mirrors floor(100 · frost). Under a snap the passive income ('shade', flakes)
 * pays nothing, as in v1.5, and a trick's (`held`: a bloom, a SWING, a parry, a glass cluster, an own
 * landing) is held in s.snapBankH (at most TUNING.garden.bankCapH) and paid when the snap ends, as
 * the Bank does (iteration 1, E4).
 */
export function addFrost(s: SimState, amount: number, held = false): void {
  if (!s.world.mech.snap || s.world.v16.bank) return;
  if (s.snapTicks > 0) {
    if (!held) return;
    const h = Math.min(Math.round(amount * CHARGE_H), GARDEN.bankCapH - s.snapBankH);
    if (h > 0) s.snapBankH += h;
    return;
  }
  const nb = s.nubs;
  if (nb.frost >= 1) return;
  const v = nb.frost + amount;
  nb.frost = v >= 1 ? 1 : v;
  nb.frostH = Math.floor(100 * nb.frost);
  if (v >= 1) s.events.push({ e: 'frostReady' });
}

/**
 * Nubs is cool at TUNING.bank.coolChill or more (the halo's gauge is red below it): only then do buds
 * grow and blooms bank frost (Bank on), and a snap pour the ring in and refill Chill.
 */
export function coolNubs(s: SimState): boolean {
  return s.nubs.chill >= BANK.coolChill;
}

/**
 * The frost a bloom banks now (hundredths; Bank on): bloomH when Nubs is fully shaded and cool as it
 * blooms (a snap's cover counts), nothing in the Noon Heat. Greed in the sun, by a sweating Nubs or
 * at noon grows shade and pumps the ring but banks no snap.
 */
function bloomFrostH(s: SimState): number {
  if (s.nubs.f > 0 || !coolNubs(s) || noonHeatAt(s.world, s.day, s.dayTick) > 1) return 0;
  return BANK.bloomH;
}

/**
 * Economy iteration 2 (Bank on): a glass cluster saved whole banks its frost for the next snap (the
 * meter's chip shows it), paid as that snap is cast: a lucky dial-follower who never snaps never
 * collects it, and it lands on a meter a charge has just left, so it never spills.
 */
export function bankGlassH(s: SimState, amountH: number): void {
  if (!s.world.mech.snap || !s.world.v16.bank || amountH <= 0) return;
  s.glassBankH = Math.min(BANK.capH, s.glassBankH + amountH);
}

/** Frost income sources (the frostGain event's `source`). */
export type FrostSource = Extract<SimEvent, { e: 'frostGain' }>['source'];

/**
 * v1.6 Frost Bank income (docs/V1_6_PLAN.md §2.2): `amountH` hundredths from a risky act (bloom,
 * fresh SWING, saved glass cluster, own landing, flare parry). Under a snap the income is banked in
 * s.snapBankH (at most TUNING.garden.bankCapH per snap) and paid when the snap ends. No-op with the
 * Bank or the Cold Snap off. CORE-2 calls it for 'cluster' and 'parry'.
 */
export function addFrostH(s: SimState, source: FrostSource, amountH: number): void {
  if (!s.world.mech.snap || !s.world.v16.bank || amountH <= 0) return;
  const st = s.stats;
  if (s.snapTicks > 0) {
    const a = Math.min(amountH, GARDEN.bankCapH - s.snapBankH);
    if (a <= 0) return;
    s.snapBankH += a;
    st.frostEarnedH = (st.frostEarnedH as number) + a;
    return;
  }
  st.frostEarnedH = (st.frostEarnedH as number) + amountH;
  creditFrostH(s, source, amountH);
}

/**
 * Puts `amountH` on the meter now: anything above capH is lost (frostSpill); frostGain reports what
 * landed; frostReady fires on crossing each charge (100, 200).
 */
function creditFrostH(s: SimState, source: FrostSource, amountH: number): void {
  const nb = s.nubs;
  const before = nb.frostH;
  let v = before + amountH;
  if (v > BANK.capH) {
    const lostH = v - BANK.capH;
    v = BANK.capH;
    s.stats.frostSpilledH = (s.stats.frostSpilledH as number) + lostH;
    s.events.push({ e: 'frostSpill', lostH });
  }
  nb.frostH = v;
  nb.frost = v / CHARGE_H;
  if (v > before) s.events.push({ e: 'frostGain', source, amountH: v - before, charges: Math.floor(v / CHARGE_H) });
  for (let c = Math.floor(before / CHARGE_H) + 1; c <= Math.floor(v / CHARGE_H); c++) s.events.push({ e: 'frostReady', charges: c });
}

/** A bud blooms: a sunflower caster joins the world for the rest of the run, plus Snow and frost. */
export function bloom(s: SimState, b: Bud): void {
  const w = s.world;
  const id = RUNTIME_ID_BASE + (b.id - BUD_ID_BASE);
  const r = rngFor(w.seed, 'names', id);
  const c = makeCaster({
    id,
    kind: 'sunflower',
    name: `the ${r.pick(['Sunny', 'Golden', 'Tall', 'Happy', 'Brave', 'Proud'])} Sunflower`,
    biome: biomeAtY(w, b.y),
    x: b.x,
    y: b.y,
    rot: 0,
    parts: sunflowerParts(b.x, b.y, w.heightScale),
    side: b.x > trailX(w.trail, b.y) ? 1 : -1,
    rescue: false,
    gate: false,
    ballId: -1,
    chunk: Math.floor(b.y / TUNING.world.chunkLen),
  });
  insertCaster(w, c);
  b.state = 1;
  b.grow = 1;
  b.casterId = id;
  const st = s.stats;
  st.blooms = (st.blooms ?? 0) + 1;
  st.snow += B.snow;
  s.events.push({ e: 'bloom', id: b.id, x: b.x, y: b.y, snow: B.snow });
  if (w.v16.bank) addFrostH(s, 'bloom', bloomFrostH(s));
  else addFrost(s, F.perBloom, true);
  ringTrick(s, 'bloom', TUNING.ring.trick);
  if (s.snapTicks > 0 && w.v16.garden) gardenBloom(s, id);
}

/**
 * v1.6 Frost Garden: a bloom under the snap is remembered (own landings; it arms the landing) and
 * stretches the snap by extendTicks (at most extendCapTicks per snap, never past the day's last
 * daylight tick); an extension re-aims the cloud.
 */
function gardenBloom(s: SimState, casterId: number): void {
  if (s.snapBlooms < s.snapBloomIds.length) s.snapBloomIds[s.snapBlooms] = casterId;
  s.snapBlooms++;
  s.stats.gardenBlooms = (s.stats.gardenBlooms as number) + 1;
  const room = dayTicks(s.day) - s.dayTick - s.snapTicks;
  const ext = Math.min(GARDEN.extendTicks, GARDEN.extendCapTicks - s.snapExt, room);
  if (ext <= 0) return;
  s.snapTicks += ext;
  s.snapExt += ext;
  const cl = snapCloud(s);
  if (cl) {
    cl.life = (SNAP_TICKS + s.snapExt - 0.5) / TICK_HZ;
    aimSnap(s, cl);
  }
  s.events.push({ e: 'snapExtend', ticks: ext });
}

/** The running snap's cloud (null when none). */
function snapCloud(s: SimState): MutableCloud | null {
  if (s.snapCloudId < 0) return null;
  const cs = s.world.clouds;
  for (let i = cs.length - 1; i >= 0; i--) if ((cs[i] as Cloud).id === s.snapCloudId) return cs[i] as MutableCloud;
  return null;
}

/**
 * v1.6 T5: points the snap cloud at Nubs' scheduled position reaimTicks from now, keeping its path
 * continuous (its center now stays where it is; t0 never changes, so the render fade holds).
 */
function aimSnap(s: SimState, cl: MutableCloud): void {
  const w = s.world;
  const T = GARDEN.reaimTicks / TICK_HZ;
  const y1 = worldYAtDayTick(w, s.day, s.dayTick + GARDEN.reaimTicks);
  const x1 = trailX(w.trail, y1);
  const dt = s.tAbs - cl.t0;
  const cx = cl.x0 + cl.vx * dt;
  const cy = cl.y0 + cl.vy * dt;
  cl.vx = (x1 - cx) / T;
  cl.vy = (y1 - cy) / T;
  cl.x0 = cx - cl.vx * dt;
  cl.y0 = cy - cl.vy * dt;
}

/** Bud growth per tick × this: ×growMul under a Garden snap, ×budMul in a flare's rise and hold (v1.6); the larger, never the product. */
function growMul(s: SimState): number {
  const w = s.world;
  let m = 1;
  if (s.snapTicks > 0 && w.v16.garden) m = GARDEN.growMul;
  if (w.v16.flares && (s.flarePhase === 2 || s.flarePhase === 3) && TUNING.flare.budMul > m) m = TUNING.flare.budMul;
  return m;
}

/** How far ahead buds grow (and show on guide.bud): the Garden's reach under a snap. */
function budReach(s: SimState): number {
  return s.snapTicks > 0 && s.world.v16.garden ? GARDEN.reach : B.reachAhead;
}

/**
 * Daylight tick: every unbloomed bud within [Nubs − reachBehind, Nubs + reachAhead] grows while the
 * sun shines from within ±faceTol of its face (budGrow every eventTicks while growing) and blooms
 * at 1; otherwise its growth fades. Nothing grows while the sun is down or eclipsed, or (Bank on,
 * economy iteration 2) while Nubs is red-hot.
 */
export function updateBuds(s: SimState): void {
  const w = s.world;
  if (!w.mech.buds) return;
  const bs = w.buds;
  const y = s.nubs.y;
  // Iteration 2: a red-hot Nubs grows no buds (Bank on).
  const grows = s.sunUp && !s.eclipseOn && (!w.v16.bank || coolNubs(s));
  const theta = s.sun.theta;
  const emit = s.tick % B.eventTicks === 0;
  const reach = budReach(s);
  const grow = GROW * growMul(s);
  for (let i = lowerBound(bs, y - B.reachBehind); i < bs.length; i++) {
    const b = bs[i] as Bud;
    if (b.y > y + reach) break;
    if (b.state !== 0) continue;
    if (grows && budFacing(b, theta)) {
      b.grow += grow;
      // v1.6 ring: the next tick's bleed spares this purposeful exposure.
      s.nubs.budGrewTick = s.tick;
      if (b.grow >= 1) bloom(s, b);
      else if (emit) s.events.push({ e: 'budGrow', id: b.id, x: b.x, y: b.y, grow: b.grow });
    } else if (b.grow > 0) {
      b.grow = b.grow > DECAY ? b.grow - DECAY : 0;
    }
  }
}

/** guide.bud: 1 on every bin within ±faceTol of an unbloomed bud within reach (all 0 while the sun is down). */
export function updateBudGuide(s: SimState): void {
  const g = s.guide.bud;
  g.fill(0);
  const w = s.world;
  if (!w.mech.buds || !s.sunUp || s.eclipseOn) return;
  const bs = w.buds;
  const y = s.nubs.y;
  const reach = budReach(s);
  for (let i = lowerBound(bs, y - B.reachBehind); i < bs.length; i++) {
    const b = bs[i] as Bud;
    if (b.y > y + reach) break;
    if (b.state === 0) markRange(g, b.face - B.faceTol, b.face + B.faceTol);
  }
}

const landScene = createMaskScene();
const landLit = new Uint8Array(BINS);
/** guide.land's cache: the end tick it shows (−1: none) and the bloom count and world it was computed with. */
let landFor = -1;
let landBlooms = -1;
let landWorld: object | null = null;
const LAND_MARGIN = TUNING.nubs.sampleOffset + 1;

/**
 * v1.6 guide.land (Garden on, during a snap only; refreshed with the other masks): 1 where the sun at
 * b° fully shades Nubs (all 5 samples, no glare) at the snap's end (dayTick + snapTicks): his
 * scheduled position, the elevation and the clouds then. The snap cloud is gone by that tick, so it
 * never counts; this run's sunflowers do. All 0 otherwise.
 */
export function updateLandGuide(s: SimState): void {
  const g = s.guide.land;
  const w = s.world;
  if (!w.v16.garden || s.snapTicks <= 0 || !s.sunUp) {
    g.fill(0);
    landFor = -1;
    return;
  }
  const t = s.dayTick + s.snapTicks;
  const tickAbs = dayStartTick(s.day) + t;
  // The snap's end tick only moves when a bloom extends it, and the scene then is fixed but for this
  // run's sunflowers: computed once per (end tick, blooms).
  const blooms = s.stats.blooms ?? 0;
  if (tickAbs === landFor && blooms === landBlooms && w === landWorld) return;
  landFor = tickAbs;
  landBlooms = blooms;
  landWorld = w;
  g.fill(0);
  if (t >= dayTicks(s.day)) return;
  const eps = worldElevation(w, tickAbs);
  if (eps <= 0) return;
  const y = worldYAtDayTick(w, s.day, t);
  const x = trailX(w.trail, y);
  gatherScene(w, landScene, x, y, LAND_MARGIN, tickAbs / TICK_HZ, eps, 1 / tanD(eps));
  litMask(landScene, x, y, false, landLit, null);
  for (let b = 0; b < BINS; b++) g[b] = landLit[b] === 0 ? 1 : 0;
}

/**
 * Economy iteration 2, the Chill gauge sets what a snap does (0..1): 1 from cashFullChill (the gauge's
 * white), falling across the amber to 0 at coolChill and below (red-hot).
 */
export function snapGauge(chill: number): number {
  if (chill >= BANK.cashFullChill) return 1;
  if (chill <= BANK.coolChill) return 0;
  return (chill - BANK.coolChill) / (BANK.cashFullChill - BANK.coolChill);
}

/**
 * The cash-in a snap cast at ring level `m` pays (hundredths): cashPerLevelH per level above x1, at
 * most cashMaxH (a snap never refunds itself), × snapGauge (all of it from the white, less in the
 * amber, nothing red-hot), nothing in the Noon Heat (Bank on), never past `capH` in the meter
 * (iterations 1-2).
 */
function cashInH(s: SimState, m: number, capH: number): number {
  const k = snapGauge(s.nubs.chill);
  if (k <= 0 || noonPour(s)) return 0;
  const h = Math.round(k * Math.min(BANK.cashMaxH, BANK.cashPerLevelH * (m - 1)));
  return Math.max(0, Math.min(h, capH - s.nubs.frostH));
}

/** Iteration 2: frost does not freeze in the Noon Heat (Bank on): a snap cast there pours nothing. */
function noonPour(s: SimState): boolean {
  return s.world.v16.bank && noonHeatAt(s.world, s.day, s.dayTick) > 1;
}

/**
 * The snap's cash-in resets the ring to x1 at 0. A PHEW on the snap's own tick (the snap cloud is the
 * shade a panic snap finds) restores only up to this, never the ring just cashed (E4: the stretch's
 * first level is the cashed ring's now).
 */
function resetRing(s: SimState): void {
  const nb = s.nubs;
  nb.mult = 1;
  nb.ringCharge = 0;
  nb.shadeTicks = 0;
  nb.litStartMult = 1;
}

/**
 * Casts a Cold Snap now: a frosty cloud at z 0 (its shadow lies right under it whatever θ is) that
 * starts on Nubs and rides with him for snapSec (it follows the trail's chord over that time). The
 * Bank pays one charge and pours the ring in (cashInH); cast red-hot, the snap only shades (Chill
 * refills no higher than it was cast). The v1.5 meter (Bank off) empties. Returns false when no snap
 * can be cast (meter not full, a snap on, no sun).
 */
export function castSnap(s: SimState): boolean {
  const nb = s.nubs;
  const w = s.world;
  const bank = w.v16.bank;
  if (!w.mech.snap || (bank ? nb.frostH < BANK.costH : nb.frost < 1) || s.snapTicks > 0 || s.phase !== 'day' || !s.sunUp) return false;
  // v1.5: one chord over the whole snap; v1.6 Garden (T5): aimed reaimTicks ahead, then re-aimed.
  const aheadTicks = w.v16.garden ? GARDEN.reaimTicks : SNAP_TICKS;
  const T = aheadTicks / TICK_HZ;
  const y1 = worldYAtDayTick(w, s.day, s.dayTick + aheadTicks);
  const x1 = trailX(w.trail, y1);
  const st = s.stats;
  const n = st.snaps ?? 0;
  const id = SNAP_ID_BASE + n;
  const rx = F.snapRx;
  const ry = rx * TUNING.cloud.ryRatio;
  const cl: Cloud = {
    id,
    kind: 'snap',
    t0: s.tAbs,
    // Alive on exactly SNAP_TICKS ticks (half a tick short of the last, so float rounding can't add one).
    life: (SNAP_TICKS - 0.5) / TICK_HZ,
    x0: nb.x,
    y0: nb.y,
    vx: (x1 - nb.x) / T,
    vy: (y1 - nb.y) / T,
    rx,
    ry,
    z: 0,
    lumps: cloudLumps(w.seed, id, rx, ry),
  };
  w.clouds.push(w.v16.garden ? cl : Object.freeze(cl));
  st.snaps = n + 1;
  s.events.push({ e: 'snap', x: nb.x, y: nb.y, cloudId: id });
  s.snapExt = 0;
  s.snapBlooms = 0;
  s.snapBankH = 0;
  s.landTicks = -1;
  s.landHold = 0;
  s.landSrc = -1;
  if (bank) {
    // v1.6 Frost Bank: one charge, then the cash-in pours the ring into the frost (cashInH), never past
    // cashCapH. Iteration 2: the snap cools Nubs × snapGauge of the way to full (all of it from the
    // white, less in the amber); red-hot it only shades: Chill stays where it was cast.
    const hot = !coolNubs(s);
    s.snapChillCap = nb.chill + (nb.maxChill - nb.chill) * snapGauge(nb.chill);
    nb.frostH -= BANK.costH;
    nb.frost = nb.frostH / CHARGE_H;
    const m = nb.mult;
    const refundH = cashInH(s, m, BANK.cashCapH);
    if (m > 1) {
      st.multDowns = (st.multDowns as number) + 1;
      s.events.push({ e: 'multDown', from: m, to: 1, cause: 'snap' });
    }
    resetRing(s);
    const ev: Extract<SimEvent, { e: 'snapCash' }> = { e: 'snapCash', level: m, refundH };
    if (hot) ev.hot = true;
    else if (noonPour(s)) ev.noon = true;
    s.events.push(ev);
    if (refundH > 0) {
      st.snapCashH = (st.snapCashH as number) + refundH;
      creditFrostH(s, 'cash', refundH);
    }
    // Iteration 2: the glass banked since the last snap lands now (income when it lands).
    if (s.glassBankH > 0) {
      const g = s.glassBankH;
      s.glassBankH = 0;
      st.frostEarnedH = (st.frostEarnedH as number) + g;
      creditFrostH(s, 'cluster', g);
    }
  } else {
    nb.frost = 0;
    nb.frostH = 0;
    if (w.v16.ring) {
      // Fix round 2: with the Bank off the snap still cashes the ring in, on the v1.5 meter
      // (cashPerLevelH hundredths of a meter per level above x1, the ring back to x1), so precision
      // feeds snaps and so survival (§0's frost story; without it the ring paid only Snow).
      const m = nb.mult;
      const refundH = cashInH(s, m, CHARGE_H);
      if (m > 1) {
        st.multDowns = (st.multDowns as number) + 1;
        s.events.push({ e: 'multDown', from: m, to: 1, cause: 'snap' });
      }
      resetRing(s);
      s.events.push({ e: 'snapCash', level: m, refundH });
      if (refundH > 0) {
        st.snapCashH = (st.snapCashH as number) + refundH;
        nb.frostH = refundH;
        nb.frost = refundH / CHARGE_H;
        s.events.push({ e: 'frostGain', source: 'cash', amountH: refundH, charges: 0 });
      }
    }
  }
  s.snapTicks = SNAP_TICKS;
  s.snapCloudId = id;
  return true;
}

/**
 * Cold Snap bookkeeping before coverage on a running tick: the snap counts down (snapEnd when it
 * runs out), then a snap input casts a new one when the meter is full.
 */
export function updateSnap(s: SimState, inp: InputFrame): void {
  if (s.snapTicks > 0 && --s.snapTicks === 0) {
    s.snapCloudId = -1;
    s.events.push({ e: 'snapEnd' });
    // v1.6: the banked income is paid now; a Garden snap that bloomed arms the landing.
    if (s.snapBankH > 0) {
      const h = s.snapBankH;
      s.snapBankH = 0;
      if (s.world.v16.bank) creditFrostH(s, 'garden', h);
      else addFrost(s, h / CHARGE_H);
    }
    if (s.world.v16.garden && s.snapBlooms > 0) {
      s.landTicks = GARDEN.landWindowTicks;
      s.landHold = 0;
      s.landSrc = -1;
    }
  } else if (s.snapTicks > 0 && s.world.v16.garden && (SNAP_TICKS + s.snapExt - s.snapTicks) % GARDEN.reaimTicks === 0) {
    const cl = snapCloud(s);
    if (cl) aimSnap(s, cl);
  }
  if (inp.snap === true) castSnap(s);
}

/**
 * Debug and screenshot hook (never called by the game loop): blooms bud `id`, or the nearest
 * unbloomed bud ahead of Nubs, at once (bloom event in s.events until the next step). Returns the
 * bud, or null when there is none.
 */
export function debugBloom(s: SimState, id?: number): Bud | null {
  const bs = s.world.buds;
  let pick: Bud | null = null;
  for (let i = lowerBound(bs, s.nubs.y - B.reachBehind); i < bs.length; i++) {
    const b = bs[i] as Bud;
    if (b.state !== 0) continue;
    if (id === undefined || b.id === id) {
      pick = b;
      break;
    }
  }
  if (pick) bloom(s, pick);
  return pick;
}
