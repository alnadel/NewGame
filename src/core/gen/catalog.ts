// Caster kinds → shadow parts (GDD §2.7 tables, V1_PLAN §7.2-§7.3). Generation-time only (allocates).

import { ARCH, BLOCKS, GATE_ARCH, OAK, STALL, SUNFLOWER, TREE, type CasterKind, type TreeSpec } from '../../config/casters.ts';
import type { BiomeId } from '../../config/days.ts';
import { TUNING } from '../../config/tuning.ts';
import { ROT15_COS, ROT15_SIN } from '../dmath.ts';
import { convexHull, rectPoly } from '../geom.ts';
import type { Caster, DiscPart, Part, PrismPart, SlabPart } from '../objects.ts';

function bounds(pts: Float64Array, n: number): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pts[2 * i] as number;
    const y = pts[2 * i + 1] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function makePrism(pts: Float64Array, h: number): PrismPart {
  const n = pts.length / 2;
  return { t: 'prism', pts, n, h, ...bounds(pts, n) };
}

export function makeSlab(pts: Float64Array, z0: number, z1: number): SlabPart {
  const n = pts.length / 2;
  return { t: 'slab', pts, n, z0, z1, ...bounds(pts, n) };
}

export function makeDisc(cx: number, cy: number, r: number, z: number): DiscPart {
  return { t: 'disc', cx, cy, r, z, minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
}

/** True for kinds that get a random 15° rotation (everything rectangular). */
export function isRotatable(kind: CasterKind): boolean {
  return kind !== 'tree' && kind !== 'oak' && kind !== 'rock' && kind !== 'pedestal' && kind !== 'sunflower';
}

function treeParts(spec: TreeSpec, x: number, y: number, k: number): Part[] {
  return [makePrism(rectPoly(x, y, spec.trunk, spec.trunk, 1, 0), spec.trunkH * k), makeDisc(x, y, spec.canopyR, spec.canopyZ * k)];
}

/** Arch-like: two square posts at ±postX on the local x axis, plus a lintel slab. */
function archParts(
  x: number,
  y: number,
  c: number,
  s: number,
  a: { post: number; postH: number; postX: number; lintelW: number; lintelD: number; z0: number; z1: number },
  k = 1,
): Part[] {
  return [
    makePrism(rectPoly(x - a.postX * c, y - a.postX * s, a.post, a.post, c, s), a.postH * k),
    makePrism(rectPoly(x + a.postX * c, y + a.postX * s, a.post, a.post, c, s), a.postH * k),
    makeSlab(rectPoly(x, y, a.lintelW, a.lintelD, c, s), a.z0 * k, a.z1 * k),
  ];
}

function stallParts(x: number, y: number, c: number, s: number, k: number): Part[] {
  const px = STALL.roofW / 2 - STALL.post / 2;
  const py = STALL.roofD / 2 - STALL.post / 2;
  const parts: Part[] = [];
  for (const [lx, ly] of [
    [-px, -py],
    [px, -py],
    [px, py],
    [-px, py],
  ] as const) {
    parts.push(makePrism(rectPoly(x + lx * c - ly * s, y + lx * s + ly * c, STALL.post, STALL.post, c, s), STALL.postH * k));
  }
  parts.push(makeSlab(rectPoly(x, y, STALL.roofW, STALL.roofD, c, s), STALL.z0 * k, STALL.z1 * k));
  return parts;
}

/** Rescue Shade Rock height for elevation ε: clamp(40·tan ε + 20, 60, 160). */
export function rockHeight(tanEps: number): number {
  const r = TUNING.rescue;
  const h = r.hTanK * tanEps + r.hBase;
  return h < r.hMin ? r.hMin : h > r.hMax ? r.hMax : h;
}

/**
 * Parts of a caster of `kind` centered at (x, y), rotated by rotIdx·15° (ignored for trees).
 * `h` overrides the height of single-prism kinds (rescue rocks). `scale` multiplies every height
 * (DayParams.heightScale: the 'giants'/'lowland' concepts); at 1 the parts are exactly the table's.
 */
export function buildParts(kind: CasterKind, x: number, y: number, rotIdx: number, h = 0, scale = 1): Part[] {
  const c = ROT15_COS[rotIdx % 24] as number;
  const s = ROT15_SIN[rotIdx % 24] as number;
  switch (kind) {
    case 'tree':
      return treeParts(TREE, x, y, scale);
    case 'oak':
      return treeParts(OAK, x, y, scale);
    case 'arch':
      return archParts(x, y, c, s, ARCH, scale);
    case 'finish':
      return gateArchParts(x, y);
    case 'stall':
      return stallParts(x, y, c, s, scale);
    case 'sunflower':
      return sunflowerParts(x, y, scale);
    case 'rock': {
      return [makePrism(rectPoly(x, y, TUNING.rescue.w, TUNING.rescue.d, 1, 0), h)];
    }
    default: {
      const b = BLOCKS[kind];
      return [makePrism(rectPoly(x, y, b.w, b.d, c, s), (h > 0 ? h : b.h) * scale)];
    }
  }
}

/** v1.5 sunflower at (x, y): a thin square stem prism and the flower head disc high up (heights × k). */
export function sunflowerParts(x: number, y: number, k = 1): Part[] {
  return [makePrism(rectPoly(x, y, SUNFLOWER.stem, SUNFLOWER.stem, 1, 0), SUNFLOWER.stemH * k), makeDisc(x, y, SUNFLOWER.headR, SUNFLOWER.headZ * k)];
}

/** Gate arch straddling the trail at (trailX, y): posts at ±34, lintel 82×14 (unrotated). */
export function gateArchParts(x: number, y: number): Part[] {
  return archParts(x, y, 1, 0, GATE_ARCH);
}

/** Ground footprint hull of the solid parts (prisms and slabs; tree canopies excluded). */
export function solidHull(parts: readonly Part[]): Float64Array {
  const pts: number[] = [];
  for (const p of parts) {
    if (p.t === 'disc') continue;
    for (let i = 0; i < p.n * 2; i++) pts.push(p.pts[i] as number);
  }
  return convexHull(pts, pts.length / 2);
}

export interface CasterInit {
  id: number;
  kind: CasterKind;
  name: string;
  biome: BiomeId;
  x: number;
  y: number;
  rot: number;
  parts: Part[];
  side: -1 | 0 | 1;
  rescue: boolean;
  gate: boolean;
  ballId: number;
  chunk: number;
}

/** Freezes a caster, deriving its hull, bounds and max height from its parts. */
export function makeCaster(init: CasterInit): Caster {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = 0;
  for (const p of init.parts) {
    if (p.minX < minX) minX = p.minX;
    if (p.minY < minY) minY = p.minY;
    if (p.maxX > maxX) maxX = p.maxX;
    if (p.maxY > maxY) maxY = p.maxY;
    const top = p.t === 'prism' ? p.h : p.t === 'slab' ? p.z1 : p.z;
    if (top > maxZ) maxZ = top;
  }
  const hull = solidHull(init.parts);
  return Object.freeze({
    ...init,
    parts: Object.freeze(init.parts.slice()),
    hull,
    hullN: hull.length / 2,
    minX,
    minY,
    maxX,
    maxY,
    maxZ,
  });
}
