// Chunk placement (V1_PLAN §6.1, §7.1-§7.3, GDD §2.7-§2.10).
//
// Every function here draws only from streams keyed by (seed, purpose, chunk/day/id), and the job
// order is fixed (see world.ts), so the world is a pure function of (seed, profile, tutorial) no
// matter when, or in how many slices, it is generated.

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
import { dayParams, PROFILES, type BiomeId, type ProfileParams } from '../../config/days.ts';
import { TUNING } from '../../config/tuning.ts';
import { cloudOffset } from '../shadows.ts';
import {
  dayStartTick,
  dayStartY,
  dayTicks,
  elevation,
  timeAtY,
  TICK_HZ,
  yAtDayTick,
  yAtTime,
  type YTime,
} from '../clock.ts';
import { atan2D, cosD, sinD, tanD } from '../dmath.ts';
import { convexDistance, rectPoly } from '../geom.ts';
import { PICKUP_ALIVE, type Caster, type Cloud, type CloudKind, type Part, type PickupKind } from '../objects.ts';
import { rngFor } from '../rng.ts';
import { distPolyToTrail, trailX } from '../trail.ts';
import { buildParts, gateArchParts, isRotatable, makeCaster, solidHull } from './catalog.ts';
import { insertBall, insertCaster, insertPickup, lowerBound, takeId, type World } from './store.ts';

const WT = TUNING.world;
const CH = WT.chunkLen;
const yt: YTime = { day: 1, dayTick: 0, night: false };

/** Day whose daylight or night contains y (Day 1 for y < 0). */
export function dayAtY(y: number): number {
  return timeAtY(y, yt).day;
}

/** Biome of the ground at y: odd days Meadow, even days Old Town (the night keeps its day's biome). */
export function biomeAtY(y: number): BiomeId {
  return dayAtY(y) % 2 === 0 ? 'oldtown' : 'meadow';
}

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

/** True when `poly` keeps the overlap margin from every caster near y. */
function clearOfCasters(w: World, poly: Float64Array, y: number): boolean {
  const cs = w.casters;
  for (let i = lowerBound(cs, y - 160); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > y + 160) break;
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
): Spot | null {
  const local = buildParts(kind, 0, 0, rotIdx, h);
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
    const parts = buildParts(kind, x, y, rotIdx, h);
    const hull = solidHull(parts);
    if (!clearOfTrail(w, hull)) continue;
    if (!clearOfCasters(w, overlapPoly(kind, x, y, hull), y)) continue;
    return { x, parts };
  }
  return null;
}

/** Places a caster beside the trail (see findSpot); null when no spot is found. */
export function placeBeside(w: World, o: PlaceOpts): Caster | null {
  const rot = isRotatable(o.kind) ? o.rotIdx : 0;
  const spot = findSpot(w, o.kind, o.y, o.side, o.lat, rot, o.h ?? 0, WT.pushMax);
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
    biome: biomeAtY(y),
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

function addPickup(w: World, kind: PickupKind, y: number): void {
  insertPickup(w, {
    id: takeId(w),
    kind,
    x: trailX(w.trail, y),
    y,
    day: dayAtY(y),
    melt: 0,
    state: PICKUP_ALIVE,
  });
}

/** Render-only cloud lumps (dx, dy, r) from their own stream, so they never shift gameplay draws. */
function cloudLumps(seed: number, id: number, rx: number, ry: number): Float64Array {
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
 * Start hut (always the first caster, y = 10, nearest edge 20 u from the centerline; on the right
 * in the tutorial, random side otherwise) and, for the tutorial, the authored chunk-0 layout.
 * θ0 = direction from Nubs (trailX(0), 0) to the hut center. Generated casters keep off the hut's
 * side until y = START_HUT.clearAhead (see placeCasters).
 */
export function placeStart(w: World): void {
  const side: -1 | 1 = w.tutorial ? 1 : rngFor(w.seed, 'start').chance(0.5) ? 1 : -1;
  const hut = placeBeside(w, { kind: 'hut', y: START_HUT.y, side, lat: START_HUT.lat, rotIdx: 0, chunk: 0 });
  // The first caster always fits: nothing else exists yet and the push loop clears the trail.
  if (!hut) throw new Error('start hut could not be placed');
  w.startHutId = hut.id;
  w.startSide = side;
  w.theta0 = atan2D(hut.y, hut.x - trailX(w.trail, 0));
  if (!w.tutorial) return;
  for (const a of TUTORIAL.casters) {
    placeBeside(w, { kind: a.kind, y: a.y, side: a.side, lat: a.lat, rotIdx: a.rot, chunk: 0 });
  }
  for (const y of TUTORIAL.flakes) addPickup(w, 'flake', y);
  const last = TUTORIAL.casters[TUTORIAL.casters.length - 1];
  w.cursorY = last ? last.y : CH;
  w.cursorSide = last ? last.side : 1;
  w.flakeY = CH;
}

/**
 * Day-level objects for day N, generated when the chunk holding its dawn is placed (before any
 * chunk of that day): clouds, the profile-0 parked noon cloud, the Day-2 gate arch, gazing balls,
 * the ice crystal and the night's frost flowers.
 */
export function generateDay(w: World, day: number): void {
  const p = dayParams(day, w.profile);
  const pp = PROFILES[w.profile] as ProfileParams;
  const prof = { overtakeFirst: pp.firstCloudOvertakes && day === 1, parked: pp.parkedNoonCloud && day === 1 };
  const tDay0 = dayStartTick(day) / TICK_HZ;
  const C = TUNING.cloud;
  const chunk = Math.floor(dayStartY(day) / CH);

  const sky = rngFor(w.seed, 'sky', day);
  p.clouds.forEach((t, i) => {
    const roll = sky.next();
    const overtake = (prof.overtakeFirst && i === 0) || roll < C.overtakerChance;
    const rx = sky.range(C.rxMin, C.rxMax);
    const speed = overtake ? sky.range(C.overtakeSpeedMin, C.overtakeSpeedMax) : sky.range(C.waitSpeedMin, C.waitSpeedMax);
    const vx = sky.range(-C.driftMax, C.driftMax);
    const x0 = sky.range(C.x0Min, C.x0Max);
    const yN = yAtTime(day, t);
    const y0 = overtake ? yN - C.overtakeBehind : yN + C.waitAhead;
    addCloud(w, overtake ? 'overtaker' : 'waiter', tDay0 + t, C.life, x0, y0, vx, speed * p.v, rx);
  });

  if (prof.parked) addParkedNoonCloud(w, day);

  if (p.gateAtNoon) placeGate(w, yAtTime(day, p.dayLen / 2), chunk);

  if (p.ballEvery > 0) {
    const br = rngFor(w.seed, 'balls', day);
    let side: -1 | 1 = br.chance(0.5) ? 1 : -1;
    for (let t = p.ballStart; t < p.dayLen; t += p.ballEvery) {
      const lat = br.range(TUNING.ball.latMin, TUNING.ball.latMax);
      const y = yAtTime(day, t);
      const ballId = takeId(w);
      const name = casterName(w, ballId, 'pedestal', y);
      // The ball sits on its pedestal: `lat` is the distance from the centerline to its center.
      const ped = placeBeside(w, { kind: 'pedestal', y, side, lat: lat - 5, rotIdx: 0, chunk, ballId, name });
      if (ped) insertBall(w, Object.freeze({ id: ballId, x: ped.x, y: ped.y, name, casterId: ped.id, day }));
      side = side > 0 ? -1 : 1;
    }
  }

  const cr = rngFor(w.seed, 'crystal', day);
  addPickup(w, 'crystal', yAtTime(day, cr.range(TUNING.pickups.crystalTMin, TUNING.pickups.crystalTMax) * p.dayLen));

  const nightY0 = dayStartY(day) + p.v * p.dayLen;
  const nightY1 = dayStartY(day + 1);
  const sp = TUNING.pickups.flowerSpacing;
  for (let y = nightY0 + sp / 2; y < nightY1; y += sp) addPickup(w, 'flower', y);
}

/**
 * Profile 0: a cloud rides with Nubs from 11:00 AM to 1:00 PM on Day 1 so that its shadow covers
 * him with the sun roughly north (V1_PLAN §6). Its center stays R(ε) ahead of Nubs and tracks the
 * trail linearly across the window.
 */
function addParkedNoonCloud(w: World, day: number): void {
  const p = dayParams(day, w.profile);
  const C = TUNING.cloud;
  const t1 = (C.parkedFromMin / 720) * p.dayLen;
  const t2 = (C.parkedToMin / 720) * p.dayLen;
  const y1 = yAtTime(day, t1);
  const y2 = yAtTime(day, t2);
  const r = cloudOffset(TUNING.shadow.cloudZ, 1 / tanD(elevation(p, t1)));
  const x1 = trailX(w.trail, y1);
  const x2 = trailX(w.trail, y2);
  const vx = (x2 - x1) / (t2 - t1);
  const lead = C.parkedLead;
  const t0 = dayStartTick(day) / TICK_HZ + t1 - lead;
  addCloud(w, 'parked', t0, t2 - t1 + 2 * lead, x1 - vx * lead, y1 + r - p.v * lead, vx, p.v, C.rxMax);
}

/** Places the casters and flake clusters of chunk k (k ≥ −1). Day objects are generated first. */
export function placeChunk(w: World, k: number): void {
  const y0 = k * CH;
  const y1 = y0 + CH;
  while (dayStartY(w.daysGenerated + 1) < y1) {
    w.daysGenerated++;
    generateDay(w, w.daysGenerated);
  }
  if (!(w.tutorial && k === 0)) placeCasters(w, k, y1);
  if (k >= 0 && !(w.tutorial && k === 0)) placeFlakes(w, k, y1);
  w.stats.chunksPlaced++;
}

function placeCasters(w: World, k: number, y1: number): void {
  const rng = rngFor(w.seed, 'chunk', k);
  for (;;) {
    const p0 = dayParams(dayAtY(w.cursorY), w.profile);
    // Draw every value up front so the stream advances identically whatever gets placed.
    const gap = p0.spacing * rng.range(WT.gapMin, WT.gapMax);
    const flip = rng.next() < WT.sideFlip;
    const kindRoll = rng.next();
    const latRoll = rng.next();
    const rotIdx = rng.int(0, WT.rotSteps - 1);
    const gateRoll = rng.next();
    const y = w.cursorY + gap;
    if (y >= y1) break;
    w.cursorY = y;
    if (flip) w.cursorSide = w.cursorSide > 0 ? -1 : 1;
    const p = dayParams(dayAtY(y), w.profile);
    const mix = BIOME_KINDS[p.biome];
    const kind = pickWeighted(mix.kinds, mix.weights, kindRoll);
    const lat = p.latMin + (p.latMax - p.latMin) * latRoll;
    if (kind === 'arch' && p.biome === 'oldtown' && gateRoll < GATE_ARCH.chance && placeGate(w, y, k)) continue;
    // Just past the start hut its side of the trail stays open (non-tutorial runs; the tutorial's
    // chunk 0 is authored): holding θ0 must stop working soon after the hut's shade ends.
    const side = y > 0 && y < START_HUT.clearAhead && w.cursorSide === w.startSide ? (w.startSide > 0 ? -1 : 1) : w.cursorSide;
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
 * 0-2 s after 0.08·Dl.
 */
function placeFlakes(w: World, k: number, y1: number): void {
  const rng = rngFor(w.seed, 'flakes', k);
  const P = TUNING.pickups;
  for (let guard = 0; guard < 64; guard++) {
    timeAtY(w.flakeY, yt);
    const day = yt.day;
    const p = dayParams(day, w.profile);
    const dl = dayTicks(day);
    if (yt.night || yt.dayTick > P.clusterTMax * dl) {
      // Jump to the next day's window.
      w.flakeY = yAtDayTick(day + 1, P.clusterTMin * dayTicks(day + 1)) + rng.range(0, 2) * dayParams(day + 1, w.profile).v;
      continue;
    }
    if (yt.dayTick < P.clusterTMin * dl) {
      w.flakeY = yAtDayTick(day, P.clusterTMin * dl) + rng.range(0, 2) * p.v;
      continue;
    }
    if (w.flakeY >= y1) break;
    for (let i = 0; i < p.flakesPerCluster; i++) addPickup(w, 'flake', w.flakeY + i * P.flakeSpacing);
    w.flakeY += rng.range(P.clusterGapMin, P.clusterGapMax) * p.v;
  }
}

/** Sanity helper for tests/tools: the clearance of a caster (min distance hull → centerline). */
export function casterClearance(w: World, c: Caster): number {
  return distPolyToTrail(w.trail, c.hull, c.hullN, c.minY - 30, c.maxY + 30);
}
