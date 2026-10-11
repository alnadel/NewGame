import { describe, expect, it } from 'vitest';
import { cosD, sinD, tanD } from '../../src/core/dmath.ts';
import { buildParts, makeCaster } from '../../src/core/gen/catalog.ts';
import { distPointConvex, pointInConvex } from '../../src/core/geom.ts';
import type { Cloud, GazingBall, Part } from '../../src/core/objects.ts';
import { Rng } from '../../src/core/rng.ts';
import {
  casterShades,
  cloudOffset,
  cloudShades,
  cloudShadow,
  glareCenter,
  glareOffset,
  inGlare,
  partShades,
  partShadow,
  shadowLength,
} from '../../src/core/shadows.ts';
import type { CasterKind } from '../../src/config/casters.ts';

const sun = (theta: number, eps: number) => ({ ux: cosD(theta), uy: sinD(theta), cot: 1 / tanD(eps) });

describe('shadow logic', () => {
  it('a standing stone at ε 48° casts 117 u along −u', () => {
    const [stone] = buildParts('stone', 0, 0, 0) as [Part];
    const { ux, uy, cot } = sun(0, 48); // sun in the east: shadow points west
    expect(shadowLength(130, cot)).toBeCloseTo(117.05, 1);
    expect(partShades(stone, -13 - 116, 0, ux, uy, cot)).toBe(true);
    expect(partShades(stone, -13 - 118.5, 0, ux, uy, cot)).toBe(false);
    expect(partShades(stone, 20, 0, ux, uy, cot)).toBe(false); // sun side is lit
    expect(shadowLength(130, 1 / tanD(6))).toBe(520); // capped at dawn
  });

  it('the arch hole is lit while the posts and lintel shade', () => {
    const arch = makeCaster({
      id: 1, kind: 'arch', name: 'the Old Arch', biome: 'oldtown', x: 0, y: 0, rot: 0,
      parts: buildParts('arch', 0, 0, 0), side: 1, rescue: false, gate: false, ballId: -1, chunk: 0,
    });
    const { ux, uy, cot } = sun(270, 48); // sun due south: shadows point north
    expect(casterShades(arch, 0, 30, ux, uy, cot)).toBe(false); // the hole
    expect(casterShades(arch, 0, 70, ux, uy, cot)).toBe(true); // lintel shadow
    expect(casterShades(arch, 32, 30, ux, uy, cot)).toBe(true); // post shadow
  });

  it('a tree canopy shadow is offset by 75·cot ε', () => {
    const [, canopy] = buildParts('tree', 100, 100, 0) as [Part, Part];
    const { ux, uy, cot } = sun(90, 40); // sun north: shadows fall south
    const off = 75 * cot;
    expect(partShades(canopy, 100, 100 - off, ux, uy, cot)).toBe(true);
    expect(partShades(canopy, 100, 100 - off - 29.9, ux, uy, cot)).toBe(true);
    expect(partShades(canopy, 100, 100 - off - 30.1, ux, uy, cot)).toBe(false);
  });

  it('cloud offsets cap at 900 and use the true ellipse', () => {
    expect(cloudOffset(300, 1 / tanD(6))).toBe(900);
    expect(cloudOffset(300, 1)).toBe(300);
    const cl: Cloud = {
      id: 1, kind: 'waiter', t0: 0, life: 40, x0: 0, y0: 0, vx: 0, vy: 10, rx: 70, ry: 46.2, z: 300, lumps: new Float64Array(0),
    };
    const { ux, uy, cot } = sun(90, 45); // R = 300 south of the cloud
    // At t = 2 the cloud is at y = 20; its shadow is centered at y = −280.
    expect(cloudShades(cl, 2, 0, -280, ux, uy, cot)).toBe(true);
    expect(cloudShades(cl, 2, 69, -280, ux, uy, cot)).toBe(true);
    expect(cloudShades(cl, 2, 0, -280 + 47, ux, uy, cot)).toBe(false); // ry < 47
    const out = new Float64Array(4);
    cloudShadow(cl, 2, ux, uy, cot, out);
    expect(out[0]).toBeCloseTo(0, 9);
    expect(out[1]).toBeCloseTo(-280, 9);
  });

  it('glare sits on the sun side, opposite to the shadows', () => {
    const ball: GazingBall = { id: 9, x: 0, y: 0, name: 'the Fancy Gazing Ball', casterId: 1, day: 2 };
    const { ux, uy, cot } = sun(0, 30);
    const g = new Float64Array(2);
    glareCenter(ball, ux, uy, cot, g);
    expect(g[0]).toBeGreaterThan(0); // toward the sun (east)
    expect(glareOffset(cot)).toBeCloseTo(40 * cot, 9);
    expect(glareOffset(1 / tanD(6))).toBe(160);
    expect(inGlare(ball, g[0] as number, 21.9, ux, uy, cot)).toBe(true);
    expect(inGlare(ball, g[0] as number, 22.1, ux, uy, cot)).toBe(false);
    const [ped] = buildParts('pedestal', 0, 0, 0) as [Part];
    expect(partShades(ped, -10, 0, ux, uy, cot)).toBe(true); // shadow goes west
  });
});

describe('logic vs render polygons (property test)', () => {
  const kinds: CasterKind[] = ['hut', 'tree', 'oak', 'cottage', 'stone', 'hedge', 'house', 'arch', 'stall', 'column', 'wall', 'pedestal', 'rock'];

  it('partShades(p) === p inside partShadow polygon/circle, except within 1e-6 of edges', () => {
    const r = new Rng(31337);
    const poly = new Float64Array(32);
    let agree = 0;
    let edge = 0;
    for (let t = 0; t < 10000; t++) {
      const kind = kinds[r.int(0, kinds.length - 1)] as CasterKind;
      const parts = buildParts(kind, r.range(-40, 40), r.range(-40, 40), r.int(0, 11), kind === 'rock' ? r.range(60, 160) : 0);
      const part = parts[r.int(0, parts.length - 1)] as Part;
      const theta = r.range(0, 360);
      const eps = r.range(3, 85);
      const { ux, uy, cot } = sun(theta, eps);
      const reach = Math.min(520, 160 * cot) + 60;
      const px = r.range(-reach, reach);
      const py = r.range(-reach, reach);
      const logic = partShades(part, px, py, ux, uy, cot);
      const n = partShadow(part, ux, uy, cot, poly);
      let render: boolean;
      let dEdge: number;
      if (n < 0) {
        const d = Math.hypot(px - (poly[0] as number), py - (poly[1] as number));
        render = d <= (poly[2] as number);
        dEdge = Math.abs(d - (poly[2] as number));
      } else {
        render = pointInConvex(px, py, poly, n);
        dEdge = render ? 1 : distPointConvex(px, py, poly, n);
        if (render) {
          // Distance to the boundary from inside: min over edges.
          let m = Infinity;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const ax = poly[2 * i] as number;
            const ay = poly[2 * i + 1] as number;
            const ex = (poly[2 * j] as number) - ax;
            const ey = (poly[2 * j + 1] as number) - ay;
            const len = Math.hypot(ex, ey);
            if (len > 0) m = Math.min(m, Math.abs((px - ax) * ey - (py - ay) * ex) / len);
          }
          dEdge = m;
        }
      }
      if (logic === render) agree++;
      else {
        expect(dEdge, `${kind} ${part.t} θ=${theta} ε=${eps}`).toBeLessThan(1e-6);
        edge++;
      }
    }
    expect(agree).toBeGreaterThan(9990);
    expect(edge).toBeLessThan(10);
  });

  it('sampling a shadow polygon interior always hits shade', () => {
    const r = new Rng(5);
    const poly = new Float64Array(32);
    for (let t = 0; t < 500; t++) {
      const parts = buildParts('cottage', 0, 0, r.int(0, 11));
      const part = parts[0] as Part;
      const { ux, uy, cot } = sun(r.range(0, 360), r.range(5, 80));
      const n = partShadow(part, ux, uy, cot, poly);
      // Centroid of the shadow polygon is strictly inside it.
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < n; i++) {
        cx += poly[2 * i] as number;
        cy += poly[2 * i + 1] as number;
      }
      expect(partShades(part, cx / n, cy / n, ux, uy, cot)).toBe(true);
    }
  });
});
