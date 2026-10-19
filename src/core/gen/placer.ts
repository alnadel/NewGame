// Chunk placement (V1_PLAN §6.1, §7.1-§7.3, GDD §2.7-§2.10).
//
// Every function here draws only from streams keyed by (seed, purpose, chunk/day/id), and the job
// order is fixed (see world.ts), so the world is a pure function of its WorldConfig no matter when,
// or in how many slices, it is generated.

import {
  BIOME_KINDS,
  GATE_ARCH,
  NAME_ADJECTIVES,
  NAME_NOUNS,
  OAK,
  START_HUT,
  TREE,
  TUTORIAL,
  type CasterKind,
} from '../../config/casters.ts';
import type { DayParams } from '../../config/days.ts';
import { FORECAST_TUNING } from '../../config/forecasts.ts';
import { TUNING } from '../../config/tuning.ts';
import { cloudOffset } from '../shadows.ts';
import { dayStartTick, dayTicks, elevation, TICK_HZ, type YTime } from '../clock.ts';
import { angleDiff, atan2D, cosD, sinD, tanD, wrapDeg } from '../dmath.ts';
import { convexDistance, rectPoly } from '../geom.ts';
import { BUD_ID_BASE, FLAKE_ID_BASE, FLARE_PENDING, PICKUP_ALIVE, RUNTIME_ID_BASE, type Caster, type Cloud, type CloudKind, type Flare, type Part, type PickupKind } from '../objects.ts';
import { rngFor, type Rng } from '../rng.ts';
import { distPolyToTrail, trailX } from '../trail.ts';
import { buildParts, gateArchParts, isRotatable, makeCaster, solidHull } from './catalog.ts';
import { clusterEligible, contestStage, contestStageUnits, glassQuota, newContestRun, startContest } from './contest.ts';
import { biomeAtY, firstTownDay, paramsAt, worldDayAtY, worldDayStartY, worldPlan, worldTimeAtY, worldYAtDayTick, worldYAtTime } from './plan.ts';
import { insertBall, insertBud, insertCaster, insertPickup, lowerBound, takeId, type PickupJob, type World } from './store.ts';
import type { ValidationJob } from './validator.ts';

const WT = TUNING.world;
const CH = WT.chunkLen;
/** The validator's step (ticks). */
const WT_STEP = TUNING.validator.stepTicks;
const yt: YTime = { day: 1, dayTick: 0, night: false };

/** Casters within this distance (y) avoid sharing a name, so death lines can tell them apart. */
const NAME_SPAN = 800;

function nameTaken(w: World, name: string, y: number): boolean {
  const cs = w.casters;
  for (let i = lowerBound(cs, y - NAME_SPAN); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > y + NAME_SPAN) break;
    if (c.name === name) return true;
  }
  return false;
}

/** "the {Adj} {Noun}" from the caster's own stream, re-drawn while a nearby caster has it. */
function casterName(w: World, id: number, kind: CasterKind, y: number): string {
  const r = rngFor(w.seed, 'names', id);
  let name = '';
  for (let attempt = 0; attempt < 16; attempt++) {
    name = `the ${r.pick(NAME_ADJECTIVES)} ${r.pick(NAME_NOUNS[kind])}`;
    if (!nameTaken(w, name, y)) break;
  }
  return name;
}

// Polygons used for caster-caster spacing: the solid hull, or a canopy-sized square for trees so
// canopies don't swallow neighbouring roofs.
const overlapCache = new WeakMap<Caster, Float64Array>();

function overlapPoly(kind: CasterKind, x: number, y: number, hull: Float64Array): Float64Array {
  if (kind === 'tree') return rectPoly(x, y, TREE.canopyR, TREE.canopyR, 1, 0);
  if (kind === 'oak') return rectPoly(x, y, OAK.canopyR, OAK.canopyR, 1, 0);
  return hull;
}

function overlapOf(c: Caster): Float64Array {
  let p = overlapCache.get(c);
  if (!p) {
    p = overlapPoly(c.kind, c.x, c.y, c.hull);
    overlapCache.set(c, p);
  }
  return p;
}

/** True when `poly` keeps the overlap margin from every generated caster near y (a run's sunflowers don't count). */
function clearOfCasters(w: World, poly: Float64Array, y: number): boolean {
  const cs = w.casters;
  for (let i = lowerBound(cs, y - 160); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > y + 160) break;
    if (c.id >= RUNTIME_ID_BASE) continue;
    const o = overlapOf(c);
    if (convexDistance(poly, poly.length / 2, o, o.length / 2) < WT.overlapMargin) return false;
  }
  return true;
}

function clearOfTrail(w: World, hull: Float64Array): boolean {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < hull.length; i += 2) {
    const v = hull[i] as number;
    if (v < minY) minY = v;
    if (v > maxY) maxY = v;
  }
  return distPolyToTrail(w.trail, hull, hull.length / 2, minY - 30, maxY + 30) >= WT.clearance;
}

interface PlaceOpts {
  kind: CasterKind;
  y: number;
  side: -1 | 1;
  lat: number;
  rotIdx: number;
  chunk: number;
  rescue?: boolean;
  /** Prism height override (rescue rocks). */
  h?: number;
  ballId?: number;
  /** Fixed id/name (pedestals share their ball's name). */
  name?: string;
}

/** A free spot found by findSpot(): the caster's center x and its parts there. */
export interface Spot {
  x: number;
  parts: Part[];
}

/**
 * Finds a spot beside the trail: the caster's nearest ground footprint point `lat` u from
 * trailX(y) on `side`, pushed outward 4 u at a time (≤ maxPush times) until it clears the trail by
 * 20 u and its neighbours by the overlap margin. Returns null when there is no such spot.
 */
export function findSpot(
  w: World,
  kind: CasterKind,
  y: number,
  side: -1 | 1,
  lat: number,
  rotIdx: number,
  h: number,
  maxPush: number,
  scale = 1,
): Spot | null {
  const local = buildParts(kind, 0, 0, rotIdx, h, scale);
  const lh = solidHull(local);
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < lh.length; i += 2) {
    const v = lh[i] as number;
    if (v < minX) minX = v;
    if (v > maxX) maxX = v;
  }
  const near = side > 0 ? -minX : maxX;
  const tx = trailX(w.trail, y);
  for (let k = 0; k <= maxPush; k++) {
    const x = tx + side * (lat + near + k * WT.pushStep);
    const parts = buildParts(kind, x, y, rotIdx, h, scale);
    const hull = solidHull(parts);
    if (!clearOfTrail(w, hull)) continue;
    if (!clearOfCasters(w, overlapPoly(kind, x, y, hull), y)) continue;
    return { x, parts };
  }
  return null;
}

/** Places a caster beside the trail (see findSpot); null when no spot is found. Heights follow World.heightScale. */
export function placeBeside(w: World, o: PlaceOpts): Caster | null {
  const rot = isRotatable(o.kind) ? o.rotIdx : 0;
  const spot = findSpot(w, o.kind, o.y, o.side, o.lat, rot, o.h ?? 0, WT.pushMax, w.heightScale);
  if (!spot) return null;
  return commit(w, o.kind, spot.x, o.y, rot, spot.parts, o.side, o.chunk, o.rescue ?? false, false, o.ballId ?? -1, o.name);
}

/** Inserts a validator rescue rock at a spot found by findSpot(). */
export function commitRescue(w: World, spot: Spot, y: number, side: -1 | 1, chunk: number): Caster {
  return commit(w, 'rock', spot.x, y, 0, spot.parts, side, chunk, true, false, -1);
}

function commit(
  w: World,
  kind: CasterKind,
  x: number,
  y: number,
  rotIdx: number,
  parts: Part[],
  side: -1 | 0 | 1,
  chunk: number,
  rescue: boolean,
  gate: boolean,
  ballId: number,
  name?: string,
): Caster {
  const id = takeId(w);
  const c = makeCaster({
    id,
    kind,
    name: name ?? casterName(w, id, kind, y),
    biome: biomeAtY(w, y),
    x,
    y,
    rot: rotIdx * WT.rotStep,
    parts,
    side,
    rescue,
    gate,
    ballId,
    chunk,
  });
  insertCaster(w, c);
  return c;
}

/** A gate arch straddling the trail at y (exempt from clearance). Null if it would hit a neighbour. */
function placeGate(w: World, y: number, chunk: number): Caster | null {
  const x = trailX(w.trail, y);
  const parts = gateArchParts(x, y);
  const hull = solidHull(parts);
  if (!clearOfCasters(w, hull, y)) return null;
  return commit(w, 'arch', x, y, 0, parts, 0, chunk, false, true, -1);
}

/** Offsets tried along the trail for a level's finish banner or gate when its exact y hits a neighbour (u). */
const LANDMARK_DY = [0, 8, -8, 16, -16, 24, -24, 40, -40, 56, -56, 80, -80, 120, -120];

/**
 * A campaign landmark on the trail near y: the finish banner (kind 'finish', not a gate: crossing
 * World.finishY wins, whatever the banner's exact spot) or the 'gate' concept's arch (a real gate
 * arch, gateArch events and the Snow bonus). It keeps the trail clearance rule's exemption of gate
 * arches and takes the first spot along the trail that clears its neighbours (the exact y when it
 * can); as a last resort it stands at y regardless.
 */
function placeLandmark(w: World, kind: 'finish' | 'arch', y0: number, chunk: number): Caster {
  const name = kind === 'finish' ? 'the Finish Line' : undefined;
  for (const dy of LANDMARK_DY) {
    const y = y0 + dy;
    const x = trailX(w.trail, y);
    const parts = gateArchParts(x, y);
    if (!clearOfCasters(w, solidHull(parts), y)) continue;
    return commit(w, kind, x, y, 0, parts, 0, chunk, false, kind === 'arch', -1, name);
  }
  const x = trailX(w.trail, y0);
  return commit(w, kind, x, y0, 0, gateArchParts(x, y0), 0, chunk, false, kind === 'arch', -1, name);
}

/**
 * Adds a pickup on the centerline at y (crystals and flowers: generated ids, no cluster: −1, 0, 1).
 */
function addPickup(w: World, kind: PickupKind, y: number): void {
  insertPickup(w, { id: takeId(w), kind, x: trailX(w.trail, y), y, day: worldDayAtY(w, y), melt: 0, state: PICKUP_ALIVE, cluster: -1, ci: 0, cn: 1, brittle: false });
}

/**
 * A cluster of n flakes from y, flakeSpacing apart on the centerline. v1.6 (§2.3, T7): flake ids
 * come from FLAKE_ID_BASE (flakes are placed two chunks behind the casters, so they never shift a
 * caster's id or name); each flake carries the cluster (its first flake's id), its index and the
 * cluster's size, and whether the cluster is glass.
 */
function addCluster(w: World, y: number, n: number, brittle: boolean): void {
  const cluster = FLAKE_ID_BASE + w.flakeCount;
  for (let i = 0; i < n; i++) {
    const fy = y + i * TUNING.pickups.flakeSpacing;
    insertPickup(w, { id: FLAKE_ID_BASE + w.flakeCount++, kind: 'flake', x: trailX(w.trail, fy), y: fy, day: worldDayAtY(w, fy), melt: 0, state: PICKUP_ALIVE, cluster, ci: i, cn: n, brittle });
  }
  w.lastClusterY = y + (n - 1) * TUNING.pickups.flakeSpacing;
}

/** Render-only cloud lumps (dx, dy, r) from their own stream, so they never shift gameplay draws. */
export function cloudLumps(seed: number, id: number, rx: number, ry: number): Float64Array {
  const r = rngFor(seed, 'lumps', id);
  const n = r.int(TUNING.cloud.lumpsMin, TUNING.cloud.lumpsMax);
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = (360 * i) / n + r.range(-20, 20);
    const d = r.range(0.25, 0.55);
    out[3 * i] = cosD(a) * rx * d;
    out[3 * i + 1] = sinD(a) * ry * d;
    out[3 * i + 2] = ry * r.range(0.45, 0.7);
  }
  return out;
}

export function addCloud(
  w: World,
  kind: CloudKind,
  t0: number,
  life: number,
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  rx: number,
): Cloud {
  const id = takeId(w);
  const ry = rx * TUNING.cloud.ryRatio;
  const cl: Cloud = Object.freeze({
    id,
    kind,
    t0,
    life,
    x0,
    y0,
    vx,
    vy,
    rx,
    ry,
    z: TUNING.shadow.cloudZ,
    lumps: cloudLumps(w.seed, id, rx, ry),
  });
  w.clouds.push(cl);
  return cl;
}

/**
 * Start hut (always the first caster, 10 u past the run's start y (0, or a campaign level's start),
 * nearest edge 20 u from the centerline; on the right in the tutorial, random side otherwise) and,
 * for the tutorial, the authored chunk-0 layout. θ0 = direction from Nubs at the start
 * (trailX(startY), startY) to the hut center. Generated casters keep off the hut's side until
 * startY + START_HUT.clearAhead (see placeCasters).
 */
export function placeStart(w: World): void {
  const side: -1 | 1 = w.tutorial ? 1 : rngFor(w.seed, 'start').chance(0.5) ? 1 : -1;
  const y0 = w.startY;
  const hut = placeBeside(w, { kind: 'hut', y: y0 + START_HUT.y, side, lat: START_HUT.lat, rotIdx: 0, chunk: Math.floor((y0 + START_HUT.y) / CH) });
  // The first caster always fits: nothing else exists yet and the push loop clears the trail.
  if (!hut) throw new Error('start hut could not be placed');
  w.startHutId = hut.id;
  w.startSide = side;
  w.theta0 = atan2D(hut.y - y0, hut.x - trailX(w.trail, y0));
  if (!w.tutorial) return;
  for (const a of TUTORIAL.casters) {
    placeBeside(w, { kind: a.kind, y: a.y, side: a.side, lat: a.lat, rotIdx: a.rot, chunk: 0 });
  }
  // The authored flakes: one plain cluster of the tutorial's own spacing.
  const tc = FLAKE_ID_BASE + w.flakeCount;
  TUTORIAL.flakes.forEach((y, i) => {
    insertPickup(w, { id: FLAKE_ID_BASE + w.flakeCount++, kind: 'flake', x: trailX(w.trail, y), y, day: worldDayAtY(w, y), melt: 0, state: PICKUP_ALIVE, cluster: tc, ci: i, cn: TUTORIAL.flakes.length, brittle: false });
  });
  const last = TUTORIAL.casters[TUTORIAL.casters.length - 1];
  w.cursorY = last ? last.y : CH;
  w.cursorSide = last ? last.side : 1;
  w.flakeY = CH;
}

/**
 * Day-level objects for day N, generated when the chunk holding its dawn is placed (before any
 * chunk of that day): clouds, the Day-1 parked noon cloud, the noon gate arch of the first Old Town
 * day ≥ 2, gazing balls, the ice crystal and the night's frost flowers.
 */
export function generateDay(w: World, day: number): void {
  const p = paramsAt(w, day);
  const sk = p.sky;
  const parked = day === 1 && w.noonCloud > 0;
  const tDay0 = dayStartTick(day) / TICK_HZ;
  const C = TUNING.cloud;
  const chunk = Math.floor(worldDayStartY(w, day) / CH);

  const sky = rngFor(w.seed, 'sky', day);
  p.clouds.forEach((t, i) => {
    const roll = sky.next();
    const overtake = (parked && i === 0) || (!p.waitersOnly && roll < C.overtakerChance);
    const rx = sky.range(sk.rxMin, sk.rxMax);
    const speed = overtake ? sky.range(sk.overtakeMin, sk.overtakeMax) : sky.range(sk.waitMin, sk.waitMax);
    const vx = sky.range(-sk.drift, sk.drift);
    const x0 = sky.range(C.x0Min, C.x0Max);
    const yN = worldYAtTime(w, day, t);
    const y0 = overtake ? yN - C.overtakeBehind : yN + C.waitAhead;
    addCloud(w, overtake ? 'overtaker' : 'waiter', tDay0 + t, C.life, x0, y0, vx, speed * p.v, rx);
  });

  if (parked) addParkedNoonCloud(w, day);

  if (day === firstTownDay(w)) placeGate(w, worldYAtTime(w, day, p.dayLen / 2), chunk);

  if (p.ballEvery > 0) {
    const br = rngFor(w.seed, 'balls', day);
    let side: -1 | 1 = br.chance(0.5) ? 1 : -1;
    for (let t = p.ballStart; t < p.dayLen; t += p.ballEvery) {
      const lat = br.range(TUNING.ball.latMin, TUNING.ball.latMax);
      const y = worldYAtTime(w, day, t);
      const ballId = takeId(w);
      const name = casterName(w, ballId, 'pedestal', y);
      // The ball sits on its pedestal: `lat` is the distance from the centerline to its center.
      const ped = placeBeside(w, { kind: 'pedestal', y, side, lat: lat - 5, rotIdx: 0, chunk, ballId, name });
      if (ped) insertBall(w, Object.freeze({ id: ballId, x: ped.x, y: ped.y, name, casterId: ped.id, day }));
      side = side > 0 ? -1 : 1;
    }
  }

  const cr = rngFor(w.seed, 'crystal', day);
  addPickup(w, 'crystal', worldYAtTime(w, day, cr.range(TUNING.pickups.crystalTMin, TUNING.pickups.crystalTMax) * p.dayLen));

  const nightY0 = worldDayStartY(w, day) + p.v * p.dayLen;
  const nightY1 = worldDayStartY(w, day + 1);
  const sp = TUNING.pickups.flowerSpacing;
  for (let y = nightY0 + sp / 2; y < nightY1; y += sp) addPickup(w, 'flower', y);

  addDayFlares(w, day, p);
}

const FL = TUNING.flare;
const STEP = TUNING.validator.stepTicks;

/**
 * A flare whose rise is at absolute tick `riseTick` (on the validator's 0.1 s grid), `warn` ticks
 * of warning before it, then TUNING.flare's rise, hold and fall; pending until the keep test.
 */
export function makeFlare(id: number, day: number, d: number, riseTick: number, warn: number): Flare {
  const holdTick = riseTick + FL.riseTicks;
  const fallTick = holdTick + FL.holdTicks;
  return { id, day, d, warnTick: riseTick - warn, riseTick, holdTick, fallTick, endTick: fallTick + FL.fallTicks, state: FLARE_PENDING };
}

/**
 * v1.6 Heat Flares of an Endless day (docs/V1_6_PLAN.md §2.5; World.v16.flares, never on a campaign
 * level, whose bosses bring their own): DayParams.flareCount rises (2: one in each of
 * TUNING.flare.windows, 1: the afternoon one, or the morning one on Day 1), each at t/Dl drawn from (seed, 'flares', day) and
 * snapped to the validator's step grid, lift DayParams.flareD. They wait, pending, for the keep test
 * of the validation job that reaches them.
 */
function addDayFlares(w: World, day: number, p: DayParams): void {
  if (!w.v16.flares || w.level !== null || p.flareCount <= 0) return;
  const r = rngFor(w.seed, 'flares', day);
  const dl = dayTicks(day);
  const t0 = dayStartTick(day);
  const am = r.range(FL.windows[0][0], FL.windows[0][1]);
  const pm = r.range(FL.windows[1][0], FL.windows[1][1]);
  // One flare: Day 1's in the morning (the standard rung's runs end on Day 1), a later day's in the afternoon.
  const at = p.flareCount >= 2 ? [am, pm] : day === 1 ? [am] : [pm];
  for (const u of at) {
    const rise = t0 + STEP * Math.round((u * dl) / STEP);
    w.flares.push(makeFlare(w.flares.length + 1, day, p.flareD, rise, FL.warnTicks));
  }
}

/**
 * The Day-1 training cloud (World.noonCloud > 0): it rides with Nubs over its parkedWindows clock
 * window (11:00 AM-1:00 PM, or 11:30 AM-12:30 PM) so that its shadow covers him with the sun roughly
 * north. Its center stays R(ε) ahead of Nubs and tracks the trail linearly across the window.
 */
function addParkedNoonCloud(w: World, day: number): void {
  const p = paramsAt(w, day);
  const C = TUNING.cloud;
  const win = C.parkedWindows[w.noonCloud] as readonly number[];
  const t1 = ((win[0] as number) / 720) * p.dayLen;
  const t2 = ((win[1] as number) / 720) * p.dayLen;
  const y1 = worldYAtTime(w, day, t1);
  const y2 = worldYAtTime(w, day, t2);
  const r = cloudOffset(TUNING.shadow.cloudZ, 1 / tanD(elevation(p, t1)));
  const x1 = trailX(w.trail, y1);
  const x2 = trailX(w.trail, y2);
  const vx = (x2 - x1) / (t2 - t1);
  const lead = C.parkedLead;
  const t0 = dayStartTick(day) / TICK_HZ + t1 - lead;
  addCloud(w, 'parked', t0, t2 - t1 + 2 * lead, x1 - vx * lead, y1 + r - p.v * lead, vx, p.v, C.rxMax);
}

/**
 * Places the casters and flake clusters of chunk k (k ≥ −1). Day objects are generated first, then
 * a campaign level's landmarks that fall in the chunk (the finish banner, the 'gate' arch), so the
 * chunk's casters keep clear of them.
 */
export function placeChunk(w: World, k: number): void {
  placeChunkCasters(w, k);
  const pj = beginPickups(w, k);
  if (pj) while (!pj.done) stepPickups(w, pj, Infinity, true);
}

/**
 * The casters of chunk k (placeChunk without its pickups): the days it reaches, a campaign level's
 * landmarks and the casters. Generation (world.ts) runs the pickups of chunk k − 2 next as their own
 * resumable job (beginPickups, stepPickups), so the glass contest is sliced like validation.
 */
export function placeChunkCasters(w: World, k: number): void {
  const y0 = k * CH;
  const y1 = y0 + CH;
  while (worldDayStartY(w, w.daysGenerated + 1) < y1) {
    w.daysGenerated++;
    generateDay(w, w.daysGenerated);
  }
  if (w.gateY >= y0 && w.gateY < y1) placeLandmark(w, 'arch', w.gateY, k);
  if (w.finishY >= y0 && w.finishY < y1) placeLandmark(w, 'finish', w.finishY, k);
  if (!(w.tutorial && k === 0)) placeCasters(w, k, y1);
  w.stats.chunksPlaced++;
}

/**
 * Starts the pickups that follow placing chunk k: the flakes and buds of chunk k − 2 (none before
 * chunk 2). Flakes (v1.6, T7) and buds trail two chunks behind: by now the casters and rescue rocks
 * around them stand, and chunk k − 2's finished validation job (w.lastJob) holds the rows the glass
 * contest reads.
 */
export function beginPickups(w: World, k: number): PickupJob | null {
  if (k < 2) return null;
  const c = k - 2;
  const flakes = !(w.tutorial && k === 2);
  return {
    k: c,
    y1: (c + 1) * CH,
    rng: flakes ? rngFor(w.seed, 'flakes', c) : null,
    phase: flakes ? 0 : 1,
    guard: 0,
    y: 0,
    n: 0,
    day: 0,
    p: null,
    nextY: 0,
    shift: -1,
    best: null,
    bestD: Infinity,
    run: (w.contestRun ??= newContestRun()),
    contestOn: false,
    done: false,
  };
}

/**
 * Advances pickup job `pj` by about `budget` work units (one lit row ≈ 1; a contest stage reports its
 * own): clusters are drawn exactly as before (the same stream and order), a glass contest runs one
 * stage at a time and, unless `fresh` (the slice's first work), only when its estimate fits the
 * budget left (otherwise it yields the rest of the budget); the buds come last. Returns the units used.
 */
export function stepPickups(w: World, pj: PickupJob, budget: number, fresh: boolean): number {
  let used = 0;
  while (!pj.done) {
    if (pj.contestOn) {
      // A glass contest stage: never two in one slice unless they fit the budget.
      const est = contestStageUnits(pj.run);
      if (!(fresh && used === 0) && used + est > budget) return Math.max(used, budget);
      used += contestStage(w, w.lastJob as ValidationJob, pj.run);
      if (pj.run.done) {
        pj.contestOn = false;
        glassResult(pj);
      }
      continue;
    }
    if (used >= budget) return used;
    if (pj.phase === 0) {
      if (pj.p !== null) {
        // The cluster drawn last: its next glass candidate, or its placement.
        if (!glassNext(w, pj)) finishCluster(w, pj);
        continue;
      }
      used += 1;
      if (!drawCluster(w, pj)) pj.phase = 1;
      continue;
    }
    placeBuds(w, pj.k);
    used += 1;
    pj.done = true;
  }
  return used;
}

/** Bud footprint used for spacing (u, a square). */
const BUD_SIZE = 10;

/**
 * v1.5 Sunflower buds of chunk k (World.mech.buds; never in the tutorial's authored chunk): one every
 * U(gapMin, gapMax) s of walking while t/Dl ∈ [tMin, tMax], more on later days (the gap ÷ min(maxMore,
 * 1 + perDay·(day − 1))), lat u from the centerline on a random side (pushed out until clear of the
 * trail and of every caster), facing a whole-degree azimuth at least faceTol + avoidTheta0 from θ0.
 * The bud cursor carries across chunks; every value is drawn from the chunk's own stream.
 */
function placeBuds(w: World, k: number): void {
  if (!w.mech.buds) return;
  const B = TUNING.buds;
  const rng = rngFor(w.seed, 'buds', k);
  const y1 = (k + 1) * CH;
  const avoid = B.faceTol + B.avoidTheta0;
  for (let guard = 0; guard < 64; guard++) {
    worldTimeAtY(w, w.budY, yt);
    const day = yt.day;
    const p = paramsAt(w, day);
    const dl = dayTicks(day);
    if (yt.night || yt.dayTick > B.tMax * dl) {
      w.budY = worldYAtDayTick(w, day + 1, B.tMin * dayTicks(day + 1)) + rng.range(0, 2) * paramsAt(w, day + 1).v;
      continue;
    }
    if (yt.dayTick < B.tMin * dl) {
      w.budY = worldYAtDayTick(w, day, B.tMin * dl) + rng.range(0, 2) * p.v;
      continue;
    }
    if (w.budY >= y1) break;
    const y = gapNear(w, w.budY, B.gapSeek * p.v);
    const side: -1 | 1 = rng.chance(0.5) ? 1 : -1;
    const lat = rng.range(B.latMin, B.latMax);
    const aimBack = rng.range(B.aimBackMin, B.aimBackMax);
    const jitter = rng.range(-B.aimJitter, B.aimJitter);
    const more = Math.min(B.maxMore, 1 + B.perDay * (day - 1));
    w.budY += (rng.range(B.gapMin, B.gapMax) * p.v) / more;
    if (w.tutorial && y < CH) continue;
    // Legible planning: the sun that grows the bud stands across the trail from it, so the bloom's
    // shadow falls back across the trail Nubs is about to walk (aimBack u before the bud). Never
    // θ0 (± faceTol + avoidTheta0: an idle sun can't grow a bud): then the other side of the trail.
    const yT = y - aimBack;
    const tx = trailX(w.trail, yT);
    for (let t = 0; t < 2; t++) {
      const x = budSpot(w, y, (t === 0 ? side : -side) as -1 | 1, lat, false);
      if (x === null) continue;
      let face = Math.round(wrapDeg(atan2D(y - yT, x - tx) + jitter));
      if (face === 360) face = 0;
      if (Math.abs(angleDiff(face, w.theta0)) < avoid) continue;
      // The Sunflowers lesson: a face inside the safe teal, so following the dial grows it.
      if (w.level?.introduces === 'bloom' && w.lastJob && w.lastJob.k === k) face = tealFace(w, w.lastJob, y, face, avoid) ?? face;
      insertBud(w, { id: BUD_ID_BASE + w.budCount++, x, y, face, grow: 0, state: 0, casterId: -1 });
      break;
    }
  }
}

/** Bins either side of a lesson bud's face that must be safe on a step for it to count (the bud grows within ±faceTol). */
const TEACH_FACE_HALF = 8;
const faceSafe = new Uint8Array(360);
const faceScore = new Int32Array(360);

/**
 * The Sunflowers lesson (L8; fix round 2: the dial-following human models grew no bud there): the
 * whole-degree face whose ±TEACH_FACE_HALF bins are all safe (the validator's rows, 3-step rule)
 * on the most steps while the bud at y is in reach (Nubs within [y − reachAhead, y + reachBehind]),
 * at least growSec of them, ties to the drawn face, never within `avoid` of θ0; null when none.
 */
function tealFace(w: World, job: ValidationJob, y: number, drawn: number, avoid: number): number | null {
  const B = TUNING.buds;
  const lit = job.lit;
  faceScore.fill(0);
  for (let s = 1; s <= job.pre + job.n; s++) {
    const sy = job.sy[s] as number;
    if (sy < y - B.reachAhead || sy > y + B.reachBehind || (job.sEps[s] as number) <= 0) continue;
    for (let b = 0; b < 360; b++) faceSafe[b] = lit[(s - 1) * 360 + b] === 0 && lit[s * 360 + b] === 0 && lit[(s + 1) * 360 + b] === 0 ? 1 : 0;
    for (let f = 0; f < 360; f++) {
      let ok = 1;
      for (let d = -TEACH_FACE_HALF; d <= TEACH_FACE_HALF && ok; d++) ok = faceSafe[(f + d + 360) % 360] as number;
      faceScore[f] = (faceScore[f] as number) + ok;
    }
  }
  const need = Math.round((B.growSec * TICK_HZ) / WT_STEP);
  let best: number | null = null;
  let bestV = need - 1;
  for (let f = 0; f < 360; f++) {
    const v = faceScore[f] as number;
    if (v < need || Math.abs(angleDiff(f, w.theta0)) < avoid) continue;
    if (v > bestV || (v === bestV && best !== null && Math.abs(angleDiff(f, drawn)) < Math.abs(angleDiff(best, drawn)))) {
      bestV = v;
      best = f;
    }
  }
  return best;
}

/**
 * The y within ±reach of y0 (20 u steps) farthest from every generated caster's center: buds stand
 * in the gaps between casters, where a sunflower's shade is worth the most.
 */
function gapNear(w: World, y0: number, reach: number): number {
  const cs = w.casters;
  let best = y0;
  let bestD = -1;
  const n = Math.floor(reach / 20);
  for (let k = -n; k <= n; k++) {
    const y = y0 + k * 20;
    let d = Infinity;
    for (let i = lowerBound(cs, y - 200); i < cs.length; i++) {
      const c = cs[i] as Caster;
      if (c.y > y + 200) break;
      if (c.id >= RUNTIME_ID_BASE) continue;
      const dy = Math.abs(c.y - y);
      if (dy < d) d = dy;
    }
    // Ties keep the cursor's own spot (k = 0 is tried in order, nearer first wins).
    if (d > bestD + 1e-9 || (Math.abs(d - bestD) <= 1e-9 && Math.abs(k * 20) < Math.abs(best - y0))) {
      bestD = d;
      best = y;
    }
  }
  return best;
}

/**
 * x of a free bud spot at y: lat u from the centerline on `side` (then the other side when `both`), pushed
 * outward 4 u at a time (≤ 8 times) until it clears the trail and every generated caster's solid
 * footprint (a bud may stand under a canopy). Null when there is none.
 */
function budSpot(w: World, y: number, side: -1 | 1, lat: number, both = true): number | null {
  const tx = trailX(w.trail, y);
  for (let s = 0; s < (both ? 2 : 1); s++) {
    const sd = s === 0 ? side : -side;
    for (let push = 0; push <= 8; push++) {
      const x = tx + sd * (lat + push * WT.pushStep);
      const poly = rectPoly(x, y, BUD_SIZE, BUD_SIZE, 1, 0);
      if (clearOfTrail(w, poly) && clearOfHulls(w, poly, y)) return x;
    }
  }
  return null;
}

/** True when `poly` keeps the overlap margin from the solid footprint of every generated caster near y. */
function clearOfHulls(w: World, poly: Float64Array, y: number): boolean {
  const cs = w.casters;
  for (let i = lowerBound(cs, y - 160); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > y + 160) break;
    if (c.id >= RUNTIME_ID_BASE) continue;
    if (convexDistance(poly, poly.length / 2, c.hull, c.hullN) < WT.overlapMargin) return false;
  }
  return true;
}

/**
 * Day-1 difficulty wave (days.ts waveA/waveB): the gap factor after a caster at daylight time t is
 * waveA + waveB·sin⁴(180°·t/Dl), t clamped to [0, Dl] (so ground behind the start counts as dawn);
 * night positions use 1. dmath only, so it is deterministic.
 */
function spacingWave(p: DayParams, at: YTime): number {
  if (at.night) return 1;
  let t = at.dayTick / TICK_HZ;
  if (t < 0) t = 0;
  else if (t > p.dayLen) t = p.dayLen;
  const sn = sinD((180 * t) / p.dayLen);
  const s2 = sn * sn;
  return p.waveA + p.waveB * s2 * s2;
}

const waveAt: YTime = { day: 1, dayTick: 0, night: false };

const stallMixes = new Map<number, readonly number[]>();

/** Old Town kind weights with stalls × `stalls` (market days). */
function townWeights(stalls: number): readonly number[] {
  let wts = stallMixes.get(stalls);
  if (!wts) {
    const m = BIOME_KINDS.oldtown;
    wts = m.weights.map((wt, i) => (m.kinds[i] === 'stall' ? wt * stalls : wt));
    stallMixes.set(stalls, wts);
  }
  return wts;
}

function placeCasters(w: World, k: number, y1: number): void {
  const rng = rngFor(w.seed, 'chunk', k);
  const startY = w.startY;
  const clearAhead = startY + START_HUT.clearAhead[worldPlan(w, 1).biome];
  for (;;) {
    worldTimeAtY(w, w.cursorY, waveAt);
    const p0 = paramsAt(w, waveAt.day);
    // Draw every value up front so the stream advances identically whatever gets placed. The
    // authored tutorial chunk never reaches here (placeChunk skips it), so it keeps its layout.
    const gap = p0.spacing * spacingWave(p0, waveAt) * rng.range(WT.gapMin, WT.gapMax);
    const flip = rng.next() < WT.sideFlip;
    const kindRoll = rng.next();
    const latRoll = rng.next();
    const rotIdx = rng.int(0, WT.rotSteps - 1);
    const gateRoll = rng.next();
    const y = w.cursorY + gap;
    if (y >= y1) break;
    w.cursorY = y;
    if (flip) w.cursorSide = w.cursorSide > 0 ? -1 : 1;
    const p = paramsAt(w, worldDayAtY(w, y));
    const ft = FORECAST_TUNING[p.forecast];
    const mix = BIOME_KINDS[p.biome];
    const kind = pickWeighted(mix.kinds, ft.stalls !== undefined && p.biome === 'oldtown' ? townWeights(ft.stalls) : mix.weights, kindRoll);
    const lat = p.latMin + (p.latMax - p.latMin) * latRoll;
    // Just past the start hut its side of the trail stays open, and no gate arch spans the trail
    // there (non-tutorial runs; the tutorial's chunk 0 is authored): holding θ0 must stop working
    // soon after the hut's shade ends.
    const gate = kind === 'arch' && p.biome === 'oldtown' && y >= clearAhead && gateRoll < (ft.gateChance ?? GATE_ARCH.chance);
    if (gate && placeGate(w, y, k)) continue;
    const side = y > startY && y < clearAhead && w.cursorSide === w.startSide ? (w.startSide > 0 ? -1 : 1) : w.cursorSide;
    if (!placeBeside(w, { kind, y, side, lat, rotIdx, chunk: k })) w.stats.dropped++;
  }
}

function pickWeighted(kinds: readonly CasterKind[], weights: readonly number[], roll: number): CasterKind {
  let total = 0;
  for (const wt of weights) total += wt;
  let r = roll * total;
  for (let i = 0; i < kinds.length; i++) {
    r -= weights[i] as number;
    if (r < 0) return kinds[i] as CasterKind;
  }
  return kinds[kinds.length - 1] as CasterKind;
}

/**
 * Flake clusters: one every U(5, 8) s of walking while t/Dl ∈ [0.08, 0.92], 24 u apart on the
 * centerline. The cursor (next cluster start) carries across chunks; a day's first cluster comes
 * 0-2 s after 0.08·Dl. drawCluster draws the next cluster of pickup job `pj` (its chunk's stream,
 * in order) into pj (y, n, day, p, nextY) and starts its glass search; false when the chunk has no
 * more clusters.
 */
function drawCluster(w: World, pj: PickupJob): boolean {
  const rng = pj.rng as Rng;
  const P = TUNING.pickups;
  for (; pj.guard < 64; pj.guard++) {
    worldTimeAtY(w, w.flakeY, yt);
    const day = yt.day;
    const p = paramsAt(w, day);
    const dl = dayTicks(day);
    if (yt.night || yt.dayTick > P.clusterTMax * dl) {
      // Jump to the next day's window.
      w.flakeY = worldYAtDayTick(w, day + 1, P.clusterTMin * dayTicks(day + 1)) + rng.range(0, 2) * paramsAt(w, day + 1).v;
      continue;
    }
    if (yt.dayTick < P.clusterTMin * dl) {
      w.flakeY = worldYAtDayTick(w, day, P.clusterTMin * dl) + rng.range(0, 2) * p.v;
      continue;
    }
    if (w.flakeY >= pj.y1) return false;
    pj.guard++;
    pj.y = w.flakeY;
    pj.n = p.flakesPerCluster;
    pj.day = day;
    pj.p = p;
    w.flakeY += rng.range(P.clusterGapMin, P.clusterGapMax) * p.clusterGap * p.v;
    pj.nextY = w.flakeY;
    pj.best = null;
    pj.bestD = Infinity;
    pj.shift = glassOpen(w, pj) ? 0 : GLASS_DONE;
    return true;
  }
  return false;
}

const BR = TUNING.brittle;
/** Glass shifts as y offsets per u/s of walk speed: s of walking. */
const GLASS_SHIFTS: readonly number[] = BR.shiftsSec;
/** A contested shift whose cost is within this of costAim ends the search (Chill). */
const GLASS_AIM_TOL = 4;
/** pj.shift past the shifts: the Glass Flakes lesson's savable fallback, then done. */
const GLASS_FALLBACK = GLASS_SHIFTS.length;
const GLASS_DONE = GLASS_SHIFTS.length + 1;

/** The span (u) of the drawn cluster's flakes and the gap (u) it keeps to its neighbours. */
function clusterSpan(pj: PickupJob): number {
  return (pj.n - 1) * TUNING.pickups.flakeSpacing;
}

/**
 * v1.6 glass (§2.3): whether the cluster drawn into pj may turn glass. The running share of glass
 * among eligible clusters (a cluster is eligible when its drawn spot's melt window plus tail lies
 * inside chunk k's finished job and it keeps minGapSec of walking to its neighbours) must be below
 * glassQuota; then glassNext tries the shifts, and the contested one whose detour cost is nearest
 * costAim wins.
 */
function glassOpen(w: World, pj: PickupJob): boolean {
  const p = pj.p as DayParams;
  const q = glassQuota(w, pj.day, p);
  const job = w.lastJob;
  if (q <= 0 || !job || job.k !== pj.k) return false;
  const span = clusterSpan(pj);
  const gap = BR.minGapSec * p.v;
  // Eligible where drawn (cheap: no masks), then the quota, then the contest of each shift.
  if (pj.y - w.lastClusterY < gap || pj.nextY - (pj.y + span) < gap || !clusterEligible(w, job, pj.y + span)) return false;
  w.glassEligible++;
  return w.glassMade < q * w.glassEligible;
}

/** Starts the drawn cluster's next glass contest (the next shift that keeps its gaps, else the lesson's fallback); false when the search is over. */
function glassNext(w: World, pj: PickupJob): boolean {
  const p = pj.p as DayParams;
  const span = clusterSpan(pj);
  const gap = BR.minGapSec * p.v;
  while (pj.shift < GLASS_FALLBACK) {
    const y0 = pj.y + (GLASS_SHIFTS[pj.shift] as number) * p.v;
    if (y0 - w.lastClusterY < gap || pj.nextY - (y0 + span) < gap) {
      pj.shift++;
      continue;
    }
    startContest(pj.run, trailX(w.trail, y0), y0, trailX(w.trail, y0 + span), y0 + span, pj.n);
    pj.contestOn = true;
    return true;
  }
  // The Glass Flakes lesson (its own level) must offer glass: without a contested shift, a cluster a
  // perfect player can save where it was drawn.
  if (pj.shift === GLASS_FALLBACK && pj.best === null && w.level?.introduces === 'brittle') {
    startContest(pj.run, trailX(w.trail, pj.y), pj.y, trailX(w.trail, pj.y + span), pj.y + span, pj.n, true);
    pj.contestOn = true;
    return true;
  }
  return false;
}

/** Folds a finished glass contest into the drawn cluster's search. */
function glassResult(pj: PickupJob): void {
  const r = pj.run;
  if (pj.shift === GLASS_FALLBACK) {
    if (r.contested) pj.best = pj.y;
    pj.shift = GLASS_DONE;
    return;
  }
  if (r.contested) {
    const d = Math.abs(r.cost - BR.costAim);
    if (d < pj.bestD) {
      pj.bestD = d;
      pj.best = pj.y + (GLASS_SHIFTS[pj.shift] as number) * (pj.p as DayParams).v;
    }
    // Close enough to the aim: the remaining shifts are not worth their DPs.
    if (d <= GLASS_AIM_TOL) {
      pj.shift = GLASS_FALLBACK;
      return;
    }
  }
  pj.shift++;
}

/** Places the drawn cluster: glass at its best shift, else plain where drawn. */
function finishCluster(w: World, pj: PickupJob): void {
  if (pj.best !== null) w.glassMade++;
  addCluster(w, pj.best === null ? pj.y : pj.best, pj.n, pj.best !== null);
  pj.p = null;
}

/** Sanity helper for tests/tools: the clearance of a caster (min distance hull → centerline). */
export function casterClearance(w: World, c: Caster): number {
  return distPolyToTrail(w.trail, c.hull, c.hullN, c.minY - 30, c.maxY + 30);
}
