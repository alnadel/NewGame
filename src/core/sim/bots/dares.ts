// v1.6 Dare-seeking bot terms (docs/V1_6_PLAN.md §2.6; CORE-2): the oracle's per-bin bonuses for
// the level's unmet verb goal (every oracle: it plays to pass) and, for the Feat-seeking oracle
// (BotOptions.feats), its unmet Dares; and humanFeat's Dare focus. Called from bots/world.ts;
// per-plan work is precomputed once per plan into module scratch (no allocation).

import { featValue, goalMet, type FeatKind, type FeatSpec, type GoalKind } from '../../../config/campaign.ts';
import { TUNING } from '../../../config/tuning.ts';
import { angleDiff } from '../../dmath.ts';
import { gatherScene, lowerBound } from '../../gen/store.ts';
import { trailX } from '../../trail.ts';
import { stepLit } from '../../gen/validator.ts';
import { ECLIPSE_SEC } from '../../gen/world.ts';
import { BINS, binOf, createMaskScene, glareMask, markCaster, markEllipse, SAMPLE_DX, SAMPLE_DY, SAMPLES } from '../../intervals.ts';
import { PICKUP_ALIVE, SNAP_ID_BASE, type Caster, type Pickup } from '../../objects.ts';
import { sunGustAt, sunLockedAt } from '../sun.ts';
import type { SimState } from '../types.ts';
import { glassValue } from './glassplan.ts';

const STEP = TUNING.validator.stepTicks;
const CLOUD_STRIDE = 6;
const SWING_DEG = TUNING.swing.minDeg;
/** Bonuses (Chill units) of the Feat-seeking oracle, and the slack each needs. */
const W = Object.freeze({
  bloom: 12, bloomReach: 90, bloomSlack: 10,
  deep: 8, deepReach: 60,
  swing: 14, swingSlack: 20, swingGapTicks: 120, swingReach: 70,
  snap: 15, snapCastSlack: 10,
  glass: 8, glassReach: 60,
  flake: 5, flakeReach: 45,
  glare: 20,
  ride: 30, rideReach: 180,
  gate: 20, gateAhead: 1.5, gateReach: 120,
  flip: 25, flipLead: 360,
  still: 20, stillLead: 120, stillReach: 120,
  ring: 6,
});

const scene = createMaskScene();
const tmp = new Uint8Array(BINS);
const shader = new Int32Array(BINS);
/** Sources (casters and clouds, the snap excluded) over Nubs' center sample at each bin, and the nearest caster's squared distance. */
const sources = new Uint8Array(BINS);
/** Ride scratch: samples a cloud covers per bin, and the pull toward full cover. */
const cover = new Uint8Array(BINS);
const pull = new Float64Array(BINS);
const shaderD = new Float64Array(BINS);
/** The same where Nubs will be when a SWING started now confirms (SW_AHEAD s on). */
const shader2 = new Int32Array(BINS);
const sources2 = new Uint8Array(BINS);
const SW_AHEAD = 0.45;
const row = new Uint8Array(BINS);
/** The per-plan bonus, split by the slack it needs: always, ≥ 8, ≥ 10, ≥ 12, ≥ 20. */
const bonus = new Float64Array(5 * BINS);
const SLACKS = [-Infinity, 8, 10, 12, 20];
let planState: SimState | null = null;
let planTick = -1;
let planFeats = false;
let planOn = false;
/** The committed SWING aim (bin), until this tick or a SWING lands (swings counted at commit). */
let swAim = -1;
let swUntil = -1;
let swCount = -1;
let swState: SimState | null = null;
/** A SWING aim stays committed this long (ticks): the turn, ≤ 20 lit ticks, and the 15-tick confirm. */
const SW_COMMIT = 40;
/** Clean: glare is looked for at Nubs' position over the next steps (s), dilated by this many bins. */
const GLARE_AHEAD = [0, 0.1, 0.2, 0.3, 0.45];
const GLARE_DILATE = 3;

function add(tier: number, b: number, v: number): void {
  const o = tier * BINS + b;
  bonus[o] = (bonus[o] as number) + v;
}

/** The Dare term that plays a verb goal (null: 'finish', or a goal the oracle plays elsewhere). */
const GOAL_TERM: Readonly<Partial<Record<GoalKind, FeatKind>>> = Object.freeze({
  deep: 'deep',
  clean: 'clean',
  swings: 'swings',
  blooms: 'blooms',
  snapSave: 'snapSave',
  gate: 'gates',
  brittle: 'brittle',
  flip: 'flip',
  flakes: 'flakes',
});

const near = new Float64Array(BINS);
const mask = new Uint8Array(BINS);

/**
 * Adds weight·(1 − d/(reach + 1)) to each bin `d` ≤ reach degrees from the nearest bin of `m` (the
 * oracle chooses within a step's reach, so a target farther away needs this pull to be walked to).
 */
function pullTo(m: Uint8Array, tier: number, weight: number, reach: number): void {
  // Circular distance transform: two passes each way.
  near.fill(Infinity);
  let d = Infinity;
  for (let k = 0; k < 2 * BINS; k++) {
    const b = k % BINS;
    d = m[b] === 1 ? 0 : d + 1;
    if (d < (near[b] as number)) near[b] = d;
  }
  d = Infinity;
  for (let k = 2 * BINS - 1; k >= 0; k--) {
    const b = k % BINS;
    d = m[b] === 1 ? 0 : d + 1;
    if (d < (near[b] as number)) near[b] = d;
  }
  for (let b = 0; b < BINS; b++) {
    const x = near[b] as number;
    if (x <= reach) add(tier, b, weight * (1 - x / (reach + 1)));
  }
}

/** The level's unmet verb goal's term (when `goal`), then its Dares not met yet (when `feats`). */
function unmet(s: SimState, out: FeatKind[], goal: boolean, feats: boolean): number {
  const lv = s.level;
  let n = 0;
  if (!lv) return 0;
  if (goal && !s.cfg.relaxedGoal) {
    const k = GOAL_TERM[lv.goal.kind];
    if (k && !goalMet(lv, s.stats)) out[n++] = k;
  }
  if (feats) for (const f of lv.feats as readonly FeatSpec[]) if (featValue(f.kind, s.stats) < f.target && (n === 0 || out[0] !== f.kind)) out[n++] = f.kind;
  return n;
}
const kinds: FeatKind[] = [];

/** Circular bin distance. */
function dist(a: number, b: number): number {
  const d = Math.abs(a - b) % BINS;
  return d > 180 ? 360 - d : d;
}

/**
 * The source Nubs' SWING reads at each bin (nubs.ts: a cloud over the center, else the nearest
 * caster shading it; −1 none) and how many sources cover the center there, from the scene at Nubs.
 */
function shadersAtCenter(s: SimState): void {
  const nb = s.nubs;
  shadersAt(s, nb.x, nb.y, s.tAbs, shader, sources);
}

/** shadersAtCenter at (x, y) and time t (the elevation and sun direction of now). */
function shadersAt(s: SimState, x: number, y: number, t: number, shader: Int32Array, sources: Uint8Array): void {
  shader.fill(-1);
  sources.fill(0);
  shaderD.fill(Infinity);
  gatherScene(s.world, scene, x, y, TUNING.nubs.sampleOffset + 1, t, s.eps, s.cot);
  for (let i = 0; i < scene.nCasters; i++) {
    const c = scene.casters[i] as Caster;
    tmp.fill(0);
    markCaster(tmp, c, x, y, scene.cot);
    const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
    for (let b = 0; b < BINS; b++) {
      if (tmp[b] !== 1) continue;
      sources[b] = (sources[b] as number) + 1;
      if (d < (shaderD[b] as number)) {
        shaderD[b] = d;
        shader[b] = c.id;
      }
    }
  }
  const cl = scene.clouds;
  for (let i = 0; i < scene.nClouds; i++) {
    const o = i * CLOUD_STRIDE;
    const id = cl[o + 4] as number;
    if (id >= SNAP_ID_BASE) continue;
    tmp.fill(0);
    markEllipse(tmp, x, y, cl[o + 5] as number, cl[o] as number, cl[o + 1] as number, cl[o + 2] as number, cl[o + 3] as number);
    for (let b = 0; b < BINS; b++) {
      if (tmp[b] !== 1) continue;
      sources[b] = (sources[b] as number) + 1;
      shader[b] = id;
      shaderD[b] = -1;
    }
  }
}

/** Precomputes the oracle's bonus for the level's unmet verb goal and (with `feats`) Dares. */
function plan(s: SimState, feats: boolean): void {
  planState = s;
  planTick = s.tick;
  planFeats = feats;
  planOn = false;
  bonus.fill(0);
  const n = unmet(s, kinds, true, feats);
  if (n === 0 || !s.sunUp) return;
  planOn = true;
  const g = s.guide;
  const nb = s.nubs;
  const theta = binOf(s.sun.theta + s.sun.lag);
  for (let i = 0; i < n; i++) {
    switch (kinds[i]) {
      case 'blooms':
        // Gold within reach, scaled down with the turn to it.
        for (let b = 0; b < BINS; b++) {
          if (g.bud[b] !== 1) continue;
          for (let k = -W.bloomReach; k <= W.bloomReach; k++) add(2, (b + k + BINS) % BINS, (W.bloom * (1 - Math.abs(k) / W.bloomReach)) / 8);
        }
        break;
      case 'deep':
        pullTo(g.deep, 3, W.deep, W.deepReach);
        break;
      case 'swings': {
        // A now-safe arc ≥ 38° away under another source, 2 s after the last SWING: re-aimed every
        // plan while Nubs is still in the old shade; once he is lit on the way, the aim is held
        // (SW_COMMIT ticks); under the new source with the hand-off pending, hold still.
        if (swState !== s || s.tick >= swUntil || s.stats.swings !== swCount) swAim = -1;
        const src = nb.f === 0 ? (nb.cloudId >= 0 ? nb.cloudId : nb.shaderId) : -1;
        if (nb.swPend >= 0 && src === nb.swPend) {
          for (let k = -3; k <= 3; k++) add(0, (theta + k + BINS) % BINS, W.swing);
          break;
        }
        if (src >= 0 && s.tick - nb.swLastTick >= W.swingGapTicks) {
          shadersAtCenter(s);
          const ya = nb.y + s.params.v * SW_AHEAD;
          shadersAt(s, trailX(s.world.trail, ya), ya, s.tAbs + SW_AHEAD, shader2, sources2);
          const best = swingAim(s, theta);
          if (best >= 0) {
            swAim = best;
            swUntil = s.tick + SW_COMMIT;
            swCount = s.stats.swings;
            swState = s;
          } else if (swAim >= 0 && dist(swAim, theta) < SWING_DEG) swAim = -1;
        }
        if (swAim < 0) break;
        for (let b = 0; b < BINS; b++) {
          const d = dist(b, swAim);
          if (d < W.swingReach) add(4, b, W.swing * (1 - d / W.swingReach));
        }
        break;
      }
      case 'snapSave': {
        // Under its own snap, the bins where no other source covers Nubs' center (feats.ts snapAlone),
        // a little ahead; before one is ready, income: the gold (blooms bank frost).
        if (s.snapTicks > 0) {
          const ya = nb.y + s.params.v * 0.1;
          shadersAt(s, trailX(s.world.trail, ya), ya, s.tAbs + 0.1, shader2, sources2);
          for (let b = 0; b < BINS; b++) mask[b] = sources2[b] === 0 ? 1 : 0;
          pullTo(mask, 0, W.snap, 180);
        } else if (!snapCharged(s)) {
          for (let b = 0; b < BINS; b++) {
            if (g.bud[b] !== 1) continue;
            for (let k = -W.bloomReach; k <= W.bloomReach; k++) add(2, (b + k + BINS) % BINS, (W.bloom * (1 - Math.abs(k) / W.bloomReach)) / 8);
          }
        }
        break;
      }
      case 'brittle': {
        const gv = glassValue(s);
        if (gv) for (let b = 0; b < BINS; b++) add(3, b, W.glass * (gv[b] as number));
        break;
      }
      case 'flakes':
        flakeShade(s);
        break;
      case 'clean':
        glareAhead(s);
        break;
      case 'ride':
        cloudShade(s);
        break;
      case 'gates':
        archDeep(s);
        break;
      case 'flip':
        flipAim(s);
        break;
      case 'still':
        windowHold(s);
        break;
      case 'ring':
        // Lasting shade fills the ring; deep shade fills it twice as fast (the Dare asks for more than steady shade gives).
        for (let b = 0; b < BINS; b++) if (g.now[b] === 1 && g.next[b] === 1) add(1, b, W.ring);
        pullTo(g.deep, 3, W.deep, W.deepReach);
        break;
      default:
        break;
    }
  }
}

/** A SWING needs a lit gap of this many degrees at most (≤ 20 lit ticks at the oracle's turn, with its ramp). */
const SW_GAP_MAX = 60;
/** …and this many degrees of the new shade (safe now and 0.6 s ahead) to hold its 15-tick confirm. */
const SW_ARC = 4;

/**
 * The SWING aim from θ: walking either way, the first fully shaded arc whose lit gap from the last
 * full shade before it is ≥ 38° + 4 (and ≤ SW_GAP_MAX) under a different source; aimed SW_ARC/2
 * inside it. Shade passing continuously between sources re-anchors the SWING (nubs.ts), hence the
 * gap. −1 when no direction offers one within reach.
 */
function swingAim(s: SimState, theta: number): number {
  const g = s.guide;
  let best = -1;
  let bestD = Infinity;
  for (let dir = -1; dir <= 1; dir += 2) {
    let last = theta;
    let gap = 0;
    for (let k = 1; k <= W.swingReach + SW_GAP_MAX; k++) {
      const b = (theta + dir * k + 2 * BINS) % BINS;
      if (g.now[b] !== 1) {
        gap++;
        if (gap > SW_GAP_MAX) break;
        continue;
      }
      if (gap >= SWING_DEG + 4 && shader[b] >= 0 && shader[b] !== shader[last]) {
        // The new arc: SW_ARC bins under the same source, safe now and next; one source over the
        // center (the source cannot change under Nubs in the confirm) unless no direction has that.
        let ok = true;
        let alone = true;
        for (let j = 0; j < SW_ARC && ok; j++) {
          const c = (b + dir * j + 2 * BINS) % BINS;
          if (g.now[c] !== 1 || g.next[c] !== 1 || shader[c] !== shader[b] || shader2[c] !== shader[b]) ok = false;
          if (sources[c] !== 1 || sources2[c] !== 1) alone = false;
        }
        const v = k + (alone ? 0 : 1000);
        if (ok && v < bestD) {
          bestD = v;
          best = (b + dir * (SW_ARC >> 1) + 2 * BINS) % BINS;
        }
        break;
      }
      last = b;
      gap = 0;
    }
  }
  return best;
}

/** Clean: −W.glare on every bin that puts Nubs' center in a ball's glare over the next steps (dilated). */
function glareAhead(s: SimState): void {
  const nb = s.nubs;
  const v = s.params.v;
  row.fill(0);
  for (const dt of GLARE_AHEAD) {
    const y = nb.y + v * dt;
    const x = dt === 0 ? nb.x : trailX(s.world.trail, y);
    gatherScene(s.world, scene, x, y, TUNING.nubs.sampleOffset + 1, s.tAbs, s.eps, s.cot);
    glareMask(scene, x, y, tmp);
    for (let b = 0; b < BINS; b++) if (tmp[b] === 1) row[b] = 1;
  }
  for (let b = 0; b < BINS; b++) {
    if (row[b] !== 1) continue;
    for (let k = -GLARE_DILATE; k <= GLARE_DILATE; k++) {
      const o = (b + k + BINS) % BINS;
      if ((bonus[o] as number) > -W.glare) add(0, o, -W.glare);
    }
  }
}

/** Flakes Dare: the bins that shade the next alive flakes in their melt window. */
function flakeShade(s: SimState): void {
  const ps = s.world.pickups;
  const y = s.nubs.y;
  const ahead = TUNING.pickups.meltAheadSec * s.params.v;
  let n = 0;
  for (let i = lowerBound(ps, y + TUNING.nubs.collectRadius); i < ps.length && n < 2; i++) {
    const p = ps[i] as Pickup;
    if (p.y - y > ahead) break;
    if (p.kind !== 'flake' || p.state !== PICKUP_ALIVE) continue;
    n++;
    gatherScene(s.world, scene, p.x, p.y, 1, s.tAbs, s.eps, s.cot);
    tmp.fill(0);
    for (let k = 0; k < scene.nCasters; k++) markCaster(tmp, scene.casters[k] as Caster, p.x, p.y, scene.cot);
    pullTo(tmp, 3, W.flake, W.flakeReach);
  }
}

/**
 * Ride Dare: the bins where one cloud covers all five of Nubs' samples (a ride, nubs.ts), plus a
 * fading pull toward them from up to W.rideReach° away (clouds drift; the oracle tracks them).
 */
function cloudShade(s: SimState): void {
  const nb = s.nubs;
  gatherScene(s.world, scene, nb.x, nb.y, TUNING.nubs.sampleOffset + 1, s.tAbs, s.eps, s.cot);
  const cl = scene.clouds;
  for (let i = 0; i < scene.nClouds; i++) {
    const o = i * CLOUD_STRIDE;
    if ((cl[o + 4] as number) >= SNAP_ID_BASE) continue;
    cover.fill(0);
    for (let k = 0; k < SAMPLES; k++) {
      tmp.fill(0);
      markEllipse(tmp, nb.x + (SAMPLE_DX[k] as number), nb.y + (SAMPLE_DY[k] as number), cl[o + 5] as number, cl[o] as number, cl[o + 1] as number, cl[o + 2] as number, cl[o + 3] as number);
      for (let b = 0; b < BINS; b++) cover[b] = (cover[b] as number) + (tmp[b] as number);
    }
    for (let b = 0; b < BINS; b++) {
      if (cover[b] !== SAMPLES || s.guide.glare[b] === 1) continue;
      for (let k = -W.rideReach; k <= W.rideReach; k++) {
        const c = (b + k + BINS) % BINS;
        const v = W.ride * (1 - Math.abs(k) / (W.rideReach + 1));
        if (v > (pull[c] as number)) pull[c] = v;
      }
    }
  }
  for (let b = 0; b < BINS; b++) if ((pull[b] as number) > 0) add(1, b, pull[b] as number);
  pull.fill(0);
}

/**
 * Gates Dare: when a gate arch stands within W.gateAhead s of walking ahead, the bins that will be
 * deep there as Nubs walks under it (fully shaded on the validator's row of that step, two sources
 * over the center), pulled toward from up to W.gateReach°.
 */
function archDeep(s: SimState): void {
  const cs = s.world.casters;
  const nb = s.nubs;
  const y = nb.y;
  const v = s.params.v;
  const ahead = W.gateAhead * v;
  for (let i = lowerBound(cs, y - 10); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > y + ahead + TUNING.world.maxCasterRadius) break;
    if (!c.gate || c.y < y || c.y > y + ahead) continue;
    const dt = (c.y - y) / v;
    stepLit(s.world, Math.round((s.tickAbs + dt * 60) / STEP), row);
    shadersAt(s, trailX(s.world.trail, c.y), c.y, s.tAbs + dt, shader2, sources2);
    let any = false;
    for (let b = 0; b < BINS; b++) {
      mask[b] = row[b] === 0 && (sources2[b] as number) >= 2 ? 1 : 0;
      if (mask[b] === 1) any = true;
    }
    // No deep shade there: plain full shade at the arch at least (the gate goal).
    if (!any) for (let b = 0; b < BINS; b++) mask[b] = row[b] === 0 ? 1 : 0;
    pullTo(mask, 0, W.gate, W.gateReach);
    return;
  }
}

/** Flip Dare: in the eclipse's last second, the bins whose opposite (θ + 180 after the flip) is shaded then. */
function flipAim(s: SimState): void {
  const w = s.world;
  if (w.eclipseTick < 0) return;
  const flip = w.eclipseTick + ECLIPSE_SEC * 60;
  const left = flip - s.tickAbs;
  if (left < 0 || left > W.flipLead) return;
  stepLit(w, Math.ceil(flip / STEP) + 1, row);
  for (let b = 0; b < BINS; b++) mask[b] = row[(b + 180) % BINS] === 0 ? 1 : 0;
  pullTo(mask, 0, W.flip, 180);
}

/**
 * Still Dare: from W.stillLead ticks before a lock or gust window until it ends, the bins fully
 * shaded on every validator row of the window (a gust's drift is countered by the oracle's hold;
 * the edges are eroded by STILL_EDGE° for it), pulled toward from up to W.stillReach°.
 */
function windowHold(s: SimState): void {
  const lock = s.mods.has('lock');
  const gust = s.mods.has('gusts');
  if (!lock && !gust) return;
  const d = s.dayTick;
  let a = -1;
  for (let k = 0; k <= W.stillLead && a < 0; k++) if ((lock && sunLockedAt(d + k)) || (gust && sunGustAt(d + k) >= 0)) a = k;
  if (a < 0) return;
  let e = a;
  while (e < a + 200 && ((lock && sunLockedAt(d + e)) || (gust && sunGustAt(d + e) >= 0))) e++;
  mask.fill(1);
  for (let j = Math.floor((s.tickAbs + a) / STEP); j <= Math.ceil((s.tickAbs + e) / STEP); j++) {
    stepLit(s.world, j, row);
    for (let b = 0; b < BINS; b++) if (row[b] !== 0) mask[b] = 0;
  }
  if (gust) {
    tmp.set(mask);
    for (let b = 0; b < BINS; b++) {
      if (tmp[b] !== 1) continue;
      for (let k = -STILL_EDGE; k <= STILL_EDGE; k++) if (tmp[(b + k + BINS) % BINS] !== 1) mask[b] = 0;
    }
  }
  pullTo(mask, 0, W.still, W.stillReach);
}
const STILL_EDGE = 4;

/** True when a Cold Snap is charged (the Frost Bank's cost in hundredths). */
function snapCharged(s: SimState): boolean {
  return s.nubs.frostH >= TUNING.bank.costH;
}

/**
 * The Feat-seeking oracle's Cold Snap for an unmet snapSave Dare: cast a charged snap once the plan
 * has W.snapCastSlack of slack (the free snaps first, so that the next one is earned), then stand
 * where nothing else shades (the plan's snapSave term). `snap` is the oracle's own decision.
 */
export function dareSnap(s: SimState, snap: boolean, slack: number, feats: boolean): boolean {
  if (!feats || snap || !s.level || !s.world.mech.snap) return snap;
  if (s.snapTicks !== 0 || s.phase !== 'day' || !s.sunUp || s.ready !== 0 || !snapCharged(s)) return snap;
  const n = unmet(s, kinds, false, true);
  let want = false;
  for (let i = 0; i < n; i++) if (kinds[i] === 'snapSave') want = true;
  return want && slack >= W.snapCastSlack;
}

/**
 * The oracle's bonus for bin `b` at this slack: its level's unmet verb goal, and with `feats` (the
 * Feat-seeking oracle) its unmet Dares (0 when nothing is left to seek).
 */
export function dareBonus(s: SimState, b: number, slack: number, feats: boolean): number {
  if (s !== planState || s.tick !== planTick || feats !== planFeats) plan(s, feats);
  if (!planOn) return 0;
  let v = 0;
  for (let t = 0; t < SLACKS.length; t++) if (slack >= (SLACKS[t] as number)) v += bonus[t * BINS + b] as number;
  return v;
}

/** humanFeat's focus target for the level's first unmet Dare, or −1 (keep humanDial's pick). */
export function dareTarget(s: SimState, theta: number): number {
  if (unmet(s, kinds, false, true) === 0) return -1;
  const g = s.guide;
  let mask: Uint8Array | null = null;
  switch (kinds[0]) {
    case 'blooms':
      if (s.nubs.chill >= 50) mask = g.bud;
      break;
    case 'deep':
    case 'gates':
      mask = g.deep;
      break;
    case 'brittle':
      mask = g.flake;
      break;
    case 'parry':
      // Aim at the telegraphed angle during the warning, then hold it through the rise and hold.
      if (s.flarePhase === 1) mask = g.flare;
      else if ((s.flarePhase === 2 || s.flarePhase === 3) && parryFor === s && parryFlare === s.flareId) return parryBin;
      break;
    case 'swings': {
      // Any lasting shade at least a SWING's turn away.
      let best = -1;
      let bestD = Infinity;
      for (let b = 0; b < BINS; b++) {
        if (g.now[b] !== 1 || g.next[b] !== 1) continue;
        const d = Math.abs(angleDiff(b, theta));
        if (d >= SWING_DEG + 4 && d < bestD) {
          bestD = d;
          best = b;
        }
      }
      return best;
    }
    default:
      return -1;
  }
  if (!mask) return -1;
  let best = -1;
  let bestD = Infinity;
  for (let b = 0; b < BINS; b++) {
    if (mask[b] !== 1) continue;
    const d = Math.abs(angleDiff(b, theta));
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (kinds[0] === 'parry' && best >= 0) {
    parryFor = s;
    parryFlare = s.flareId;
    parryBin = best;
  }
  return best;
}

/** humanFeat's parry aim: the angle it picked from the warning's telegraph, held through that flare. */
let parryFor: SimState | null = null;
let parryFlare = -1;
let parryBin = -1;

/**
 * The Dare terms as one value, for `BotOptions.dares`: the oracle plays the level's verb goal (and,
 * with `feats`, its Dares) and humanFeat aims at a Dare only when given these. Tooling passes them
 * (scripts/sim.ts --campaign, the tests); the game never does, so this module stays out of its bundle.
 */
export const DARE_TERMS = Object.freeze({ bonus: dareBonus, snap: dareSnap, target: dareTarget });
export type DareTerms = typeof DARE_TERMS;
