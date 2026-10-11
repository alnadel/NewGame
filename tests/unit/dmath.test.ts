import { describe, expect, it } from 'vitest';
import {
  acosD,
  angleDiff,
  atan2D,
  cosD,
  dacos,
  datan,
  datan2,
  dcos,
  dsin,
  dtan,
  ROT15_COS,
  sinD,
  SUN_COS,
  SUN_SIN,
  tanD,
  wrapDeg,
} from '../../src/core/dmath.ts';
import { Rng } from '../../src/core/rng.ts';

const dv = new DataView(new ArrayBuffer(8));
function hex(v: number): string {
  dv.setFloat64(0, v);
  let s = '';
  for (let i = 0; i < 8; i++) s += dv.getUint8(i).toString(16).padStart(2, '0');
  return s;
}

describe('dmath accuracy', () => {
  const rng = new Rng(12345);

  it('dsin/dcos match Math.sin/cos within 1e-15·max(1,|x|) on [−1e4, 1e4]', () => {
    for (let i = 0; i < 20000; i++) {
      const x = rng.range(-1e4, 1e4);
      const tol = 1e-15 * Math.max(1, Math.abs(x));
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThanOrEqual(tol);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThanOrEqual(tol);
    }
  });

  it('datan2 matches Math.atan2 within 2e-16 relative', () => {
    for (let i = 0; i < 20000; i++) {
      const y = rng.range(-500, 500);
      const x = rng.range(-500, 500);
      const ref = Math.atan2(y, x);
      expect(Math.abs(datan2(y, x) - ref)).toBeLessThanOrEqual(2.3e-16 * Math.max(1e-300, Math.abs(ref)));
    }
  });

  it('datan and dacos are accurate', () => {
    for (let i = 0; i < 5000; i++) {
      const x = rng.range(-50, 50);
      expect(Math.abs(datan(x) - Math.atan(x))).toBeLessThanOrEqual(2.3e-16 * Math.abs(Math.atan(x)) + 1e-300);
      const c = rng.range(-1, 1);
      expect(Math.abs(dacos(c) - Math.acos(c))).toBeLessThanOrEqual(1e-14);
    }
  });

  it('degree helpers are accurate and exact at quadrant angles', () => {
    for (let i = 0; i < 5000; i++) {
      const d = rng.range(-2000, 2000);
      expect(Math.abs(sinD(d) - Math.sin((d * Math.PI) / 180))).toBeLessThan(1e-14);
      expect(Math.abs(cosD(d) - Math.cos((d * Math.PI) / 180))).toBeLessThan(1e-14);
    }
    expect(sinD(90)).toBe(1);
    expect(sinD(180)).toBe(0);
    expect(sinD(-90)).toBe(-1);
    expect(cosD(90)).toBe(0);
    expect(cosD(0)).toBe(1);
    expect(cosD(180)).toBe(-1);
    expect(sinD(450)).toBe(1);
    expect(Math.abs(tanD(45) - 1)).toBeLessThan(1e-15);
    expect(Math.abs(dtan(0.3) - Math.tan(0.3))).toBeLessThan(1e-15);
  });

  it('atan2D lies in [0, 360) and inverts the sun vector', () => {
    expect(atan2D(0, 1)).toBe(0);
    expect(atan2D(1, 0)).toBe(90);
    expect(atan2D(0, -1)).toBe(180);
    expect(atan2D(-1, 0)).toBe(270);
    expect(Object.is(atan2D(-0, 1), 0)).toBe(true);
    expect(atan2D(-1e-300, 1)).toBeLessThan(360);
    for (let b = 0; b < 360; b++) {
      expect(Math.abs(atan2D(SUN_SIN[b] as number, SUN_COS[b] as number) - b) % 360).toBeLessThan(1e-12);
    }
    expect(Math.abs(acosD(0.5) - 60)).toBeLessThan(1e-12);
  });

  it('wrapDeg and angleDiff', () => {
    expect(wrapDeg(370)).toBe(10);
    expect(wrapDeg(-10)).toBe(350);
    expect(wrapDeg(720)).toBe(0);
    expect(wrapDeg(-1e-20)).toBe(0);
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(-20);
    expect(angleDiff(180, 0)).toBe(180);
    expect(angleDiff(0, 180)).toBe(180);
    for (let i = 0; i < 2000; i++) {
      const a = rng.range(-1000, 1000);
      const b = rng.range(-1000, 1000);
      const d = angleDiff(a, b);
      expect(d).toBeGreaterThan(-180);
      expect(d).toBeLessThanOrEqual(180);
    }
  });

  it('tables are built from the degree helpers', () => {
    expect(SUN_COS[0]).toBe(1);
    expect(SUN_SIN[90]).toBe(1);
    expect(SUN_COS[90]).toBe(0);
    expect(ROT15_COS[6]).toBe(0);
  });
});

describe('dmath bit-exact snapshots', () => {
  const cases: [string, number, string][] = [
    ['dsin(0.5)', dsin(0.5), '3fdeaee8744b05f0'],
    ['dsin(3)', dsin(3), '3fc210386db6d55b'],
    ['dsin(-1234.5678)', dsin(-1234.5678), 'bfb3fa00084ee3dd'],
    ['dsin(9999.25)', dsin(9999.25), '3fdb39f08f8ba7d7'],
    ['dcos(0.5)', dcos(0.5), '3fec1528065b7d50'],
    ['dcos(2.5)', dcos(2.5), 'bfe9a2f7ef858b7d'],
    ['dcos(-777.125)', dcos(-777.125), 'bfda0c81113b6624'],
    ['dcos(1e4)', dcos(1e4), 'bfee780e88ec4409'],
    ['datan2(1,2)', datan2(1, 2), '3fddac670561bb4f'],
    ['datan2(-3,-4)', datan2(-3, -4), 'c003fc176b7a8560'],
    ['datan2(5,-0.25)', datan2(5, -0.25), '3ff9ee9c8100c212'],
    ['datan(0.7)', datan(0.7), '3fe38b112d7bd4ad'],
    ['sinD(33.3)', sinD(33.3), '3fe191984d01e95b'],
    ['cosD(123.456)', cosD(123.456), 'bfe1a43870d371f9'],
    ['atan2D(-1,0.3)', atan2D(-1, 0.3), '4071eb301ab8ceb5'],
    ['dacos(0.3)', dacos(0.3), '3ff441f5ecbeef58'],
  ];
  for (const [name, v, h] of cases) {
    it(name, () => expect(hex(v)).toBe(h));
  }
});
