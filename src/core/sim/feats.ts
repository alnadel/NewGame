// v1.6 Dares in the sim (docs/V1_6_PLAN.md §2.6; CORE-2 owns this file): the RunStats Dare and
// verb-goal counters (deepTicks, snapSavedTicks and earnedSnapSavedTicks, cloudsRidden, gateShaded
// and gateDeep, flipTicks, lock windows; the retired Gusts' gustHeld/gustWindows stay 0), the glass cluster tracking (sim/glass.ts) and the
// `feat` / `featMet` events of a campaign level's Dares (LevelDef.feats, counted by featValue in
// config/campaign.ts). Counters are integer ticks or counts, so the HUD's live count and the verdict
// agree. Per-tick work is allocation-free (events excepted).

import { featValue, type FeatSpec } from '../../config/campaign.ts';
import { TUNING } from '../../config/tuning.ts';
import { TICK_HZ } from '../clock.ts';
import { ECLIPSE_SEC } from '../gen/world.ts';
import type { Cloud } from '../objects.ts';
import { cloudAlive, cloudShades } from '../shadows.ts';
import { updateClusters } from './glass.ts';
import { sunLockedAt } from './sun.ts';
import type { SimState } from './types.ts';

const RIDE_TICKS = Math.round(0.5 * TICK_HZ);
const ECLIPSE_TICKS = ECLIPSE_SEC * TICK_HZ;
/** flipTicks stops counting this long after the flip (ticks). */
const FLIP_WINDOW = 10 * TICK_HZ;
const LOCK_TICKS = Math.round(1.2 * TICK_HZ);
const RECENT = TUNING.death.recentTicks;

/** The Dare values at the start of the tick (snapshotFeats), for the level's feats in order. */
const before = new Float64Array(2);
let beforeState: SimState | null = null;
let beforeTick = -1;

/** Called by updateFlare at the start of every running tick: remembers the Dare values before the tick. */
export function snapshotFeats(s: SimState): void {
  const lv = s.level;
  beforeState = s;
  beforeTick = s.tick;
  if (!lv) return;
  for (let i = 0; i < lv.feats.length && i < 2; i++) before[i] = featValue((lv.feats[i] as FeatSpec).kind, s.stats);
}

/**
 * True when the Cold Snap's cloud is the only source of shade over Nubs' center sample this tick.
 * Never during an eclipse: it shades every angle already (computeCoverage clears the shader), so a
 * snap cast into it saves nothing (fix round 3: L192/L199/L200's snapSave Dare was free there).
 */
function snapAlone(s: SimState): boolean {
  const nb = s.nubs;
  if (s.snapTicks <= 0 || s.eclipseOn || nb.shaderId >= 0 || nb.w[0] !== 0) return false;
  const x = nb.x;
  const y = nb.y;
  let snap = false;
  for (const cl of s.world.clouds as readonly Cloud[]) {
    if (!cloudAlive(cl, s.tAbs) || !cloudShades(cl, s.tAbs, x, y, s.ux, s.uy, s.cot)) continue;
    if (cl.id !== s.snapCloudId) return false;
    snap = true;
  }
  return snap;
}

/** True when every one of the last `n` ticks (s.recent, before this tick) had Nubs fully shaded. */
function heldFor(s: SimState, n: number): boolean {
  if (s.recentCount < n || n > RECENT) return false;
  for (let a = 1; a <= n; a++) {
    const i = (s.recentCount - a) % RECENT;
    if ((s.recent[i * 4 + 1] as number) !== 0) return false;
  }
  return true;
}

/** Lock windows of the level's daylight: counted when they end, held when Nubs stayed fully shaded through them. */
function updateWindows(s: SimState): void {
  const st = s.stats;
  const d = s.dayTick;
  if (s.mods.has('lock') && !sunLockedAt(d) && sunLockedAt(d - 1)) {
    st.lockWindows = (st.lockWindows ?? 0) + 1;
    if (heldFor(s, LOCK_TICKS)) st.lockHeld = (st.lockHeld ?? 0) + 1;
  }
}

/** Called by step() every running tick after passObjects: the counters, then the level's Dare events. */
export function updateFeats(s: SimState): void {
  updateClusters(s);
  const nb = s.nubs;
  const st = s.stats;
  if (s.phase === 'day') {
    if (nb.deep) st.deepTicks = (st.deepTicks ?? 0) + 1;
    if (snapAlone(s)) {
      st.snapSavedTicks = (st.snapSavedTicks ?? 0) + 1;
      // Earned: a snap beyond the charges the run started with (the meter actually played, Bank or v1.5).
      if ((st.snaps ?? 0) > Math.floor(s.startFrostH / TUNING.bank.costH)) st.earnedSnapSavedTicks = (st.earnedSnapSavedTicks ?? 0) + 1;
    }
    if (nb.cloudId >= 0 && nb.rideTicks === RIDE_TICKS) st.cloudsRidden = (st.cloudsRidden ?? 0) + 1;
    for (const e of s.events) {
      if (e.e !== 'gateArch') continue;
      if (nb.f === 0) st.gateShaded = (st.gateShaded ?? 0) + 1;
      if (nb.deep) st.gateDeep = (st.gateDeep ?? 0) + 1;
    }
    const w = s.world;
    if (w.eclipseTick >= 0 && (st.flipTicks ?? 0) === 0) {
      const k = s.tickAbs - (w.eclipseTick + ECLIPSE_TICKS) + 1;
      if (k >= 1 && k <= FLIP_WINDOW && nb.f === 0) st.flipTicks = k;
    }
    if (s.mods.size > 0) updateWindows(s);
  }
  const lv = s.level;
  if (!lv || lv.feats.length === 0 || beforeState !== s || beforeTick !== s.tick) return;
  for (let i = 0; i < lv.feats.length && i < 2; i++) {
    const f = lv.feats[i] as FeatSpec;
    const v = featValue(f.kind, st);
    const was = before[i] as number;
    if (v === was) continue;
    const met = was < f.target && v >= f.target;
    // Tick counters change every tick: their live count fires every 6 ticks (and when met).
    const ticky = f.kind === 'deep' || f.kind === 'snapSave';
    if (!ticky || met || v % 6 === 0) s.events.push({ e: 'feat', kind: f.kind, value: v, target: f.target });
    if (met) s.events.push({ e: 'featMet', kind: f.kind });
  }
}
