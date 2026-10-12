// Pure render helpers: the Melt Map's fade timing (callouts only after the camera pull, K10), when
// the map counts as settled (the 20 fps Results cadence), the cached rgba() strings, Nubs' shade tint
// shared by the palette and the cached sprite (quantized night, G15), the shadow path's winding
// (GR1) and the matched shadow composite (GR2).
import { describe, expect, it } from 'vitest';
import { createBot, createRun, dayTicks, headlessConfig, step, type SimState } from '../../src/core/index.ts';
import { createCameraFx, createView, layoutView, setPlayCamera } from '../../src/game/camera.ts';
import { createBanners, showDayCard } from '../../src/render/banners.ts';
import { cssa, hex } from '../../src/render/color.ts';
import { createShadeSplit, splitShade } from '../../src/render/halo.ts';
import { addHeadline, addPlus, addSwing, createPops, POP_PHEW, updatePops, type Pops } from '../../src/render/particles.ts';
import { MAP_FADE_S, MAP_LABEL_FADE_S, MAP_PULL_S, mapAlphas, mapSettleT, type MapOverlay } from '../../src/render/meltMap.ts';
import { createPalette, nubsShadeAt, updatePalette } from '../../src/render/palette.ts';
import { matchShadow, traceShadows } from '../../src/render/shadowLayer.ts';
import { bossWeight } from '../../src/render/sun.ts';

const overlay = (): MapOverlay => ({ a: 0, labelA: 0, sheetTop: null, time: 0 });

describe('Melt Map timing', () => {
  it('keeps the callouts hidden until the camera pull has finished', () => {
    const o = overlay();
    for (const t of [0, 0.3, 0.8, 1.2, MAP_PULL_S]) expect(mapAlphas(t, false, o).labelA).toBe(0);
    expect(mapAlphas(MAP_PULL_S + MAP_LABEL_FADE_S / 2, false, o).labelA).toBeCloseTo(0.5);
    expect(mapAlphas(MAP_PULL_S + MAP_LABEL_FADE_S, false, o).labelA).toBeCloseTo(1, 9);
    // The rest of the overlay fades in from the start.
    expect(mapAlphas(MAP_FADE_S / 2, false, o).a).toBeCloseTo(0.5);
    expect(mapAlphas(3, false, o).a).toBe(1);
  });

  it('cuts under reduced motion: the callouts fade in at once', () => {
    const o = overlay();
    expect(mapAlphas(MAP_LABEL_FADE_S, true, o).labelA).toBe(1);
    expect(mapSettleT(true)).toBe(MAP_FADE_S);
  });

  it('settles once the pull and every fade are done', () => {
    expect(mapSettleT(false)).toBe(MAP_PULL_S + MAP_LABEL_FADE_S);
    const o = mapAlphas(mapSettleT(false), false, overlay());
    expect(o.a).toBe(1);
    expect(o.labelA).toBeCloseTo(1, 9);
  });
});

describe('colors', () => {
  it('caches rgba() strings by color and alpha step', () => {
    const a = cssa(0x2b2140, 0.5);
    expect(a).toBe('rgba(43,33,64,0.5)');
    expect(cssa(0x2b2140, 0.501)).toBe(a);
    expect(cssa(0xffffff, 1)).toBe('rgba(255,255,255,1)');
    expect(cssa(0xffffff, -1)).toBe('rgba(255,255,255,0)');
  });

  it("gives the palette and Nubs' cached sprite the same shade at matching night values", () => {
    const p = createPalette();
    for (let k = 0; k <= 16; k++) {
      updatePalette(p, 0.5, k / 16, 0, false);
      expect(p.nubsShade).toBe(nubsShadeAt(k / 16));
    }
    expect(nubsShadeAt(0)).toBe(hex('#C9D6F2'));
  });
});

// GR1: every subpath of the shadow path winds the same way on screen, so the nonzero fill unions
// them (a canopy disc or cloud ellipse wound the other way punched a lit hole where it overlapped).
describe('shadow path winding', () => {
  /** Records the subpaths traceShadows appends: polygons as vertex lists, arcs/ellipses as flags. */
  function recorder(): { g: CanvasRenderingContext2D; polys: number[][]; curves: boolean[] } {
    const polys: number[][] = [];
    const curves: boolean[] = [];
    let cur: number[] | null = null;
    const curve = (ccw: boolean | undefined): void => {
      curves.push(ccw === true);
      cur = null;
    };
    const g = {
      moveTo: (x: number, y: number) => (cur = [x, y]),
      lineTo: (x: number, y: number) => cur?.push(x, y),
      closePath: () => {
        if (cur && cur.length >= 6) polys.push(cur);
        cur = null;
      },
      arc: (_x: number, _y: number, _r: number, _a0: number, _a1: number, ccw?: boolean) => curve(ccw),
      ellipse: (_x: number, _y: number, _rx: number, _ry: number, _r: number, _a0: number, _a1: number, ccw?: boolean) => curve(ccw),
    } as unknown as CanvasRenderingContext2D;
    return { g, polys, curves };
  }

  /** Shoelace area in y-down screen space: < 0 means counter-clockwise on screen. */
  function signedArea(p: number[]): number {
    let a = 0;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += (p[2 * i] as number) * (p[2 * j + 1] as number) - (p[2 * j] as number) * (p[2 * i + 1] as number);
    }
    return a / 2;
  }

  it('traces every polygon, disc and ellipse counter-clockwise on screen (dawn, 10 AM, noon, Old Town)', () => {
    const v = createView();
    layoutView(v, 390, 844, 1, { top: 0, right: 0, bottom: 0, left: 0 });
    const cam = createCameraFx();
    let polys = 0;
    let curves = 0;
    const check = (s: SimState): void => {
      setPlayCamera(v, cam, s.nubs.x, s.nubs.y);
      for (let th = 0; th < 360; th += 30) {
        const r = recorder();
        const a = (th * Math.PI) / 180;
        traceShadows(r.g, v, s.world, Math.cos(a), Math.sin(a), Math.max(0.3, s.cot), s.tAbs);
        for (const p of r.polys) expect(signedArea(p)).toBeLessThan(0);
        for (const c of r.curves) expect(c).toBe(true);
        polys += r.polys.length;
        curves += r.curves.length;
      }
    };
    const s = createRun(headlessConfig(42, 3));
    const bot = createBot('oracle');
    for (const mark of [30, Math.round(dayTicks(1) / 3), Math.round(dayTicks(1) / 2)]) {
      while (s.dayTick < mark && s.phase !== 'dead') step(s, bot.next(s));
      check(s);
    }
    const town = createRun({ ...headlessConfig(7, 3), startDay: 2, startT: 20 });
    const b2 = createBot('oracle');
    for (let i = 0; i < 600 && town.phase !== 'dead'; i++) step(town, b2.next(town));
    check(town);
    // The scenes contain both kinds of subpath.
    expect(polys).toBeGreaterThan(100);
    expect(curves).toBeGreaterThan(10);
  });
});

describe('cool-shade colour script (GR5)', () => {
  /** WCAG relative luminance of a packed color. */
  function lum(c: number): number {
    const ch = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch((c >> 16) & 255) + 0.7152 * ch((c >> 8) & 255) + 0.0722 * ch(c & 255);
  }
  /** Contrast of the ground against itself under the shadow color at alpha a (multiply). */
  function contrast(ground: number, shadow: number, a: number): number {
    let shaded = 0;
    for (const ch of [16, 8, 0]) {
      const G = (ground >> ch) & 255;
      const C = (shadow >> ch) & 255;
      shaded |= Math.round(G * (1 - a * (1 - C / 255))) << ch;
    }
    return (lum(ground) + 0.05) / (lum(shaded) + 0.05);
  }
  // v1.0 shadow keys (6, 9, 12, 15, 18 o'clock).
  const V10: [number, number][] = [
    [hex('#5B4A8A'), 0.42],
    [hex('#4F5C8E'), 0.5],
    [hex('#4B5A73'), 0.58],
    [hex('#4A4F8C'), 0.5],
    [hex('#34306B'), 0.45],
  ];

  it('keeps every key at least as legible as v1.0, in both biomes and in high contrast', () => {
    const p = createPalette();
    for (const hc of [false, true]) {
      for (const town of [0, 1]) {
        for (let k = 0; k < 5; k++) {
          updatePalette(p, k / 4, 0, town, hc);
          const [old, oldA] = V10[k] as [number, number];
          expect(contrast(p.ground, p.shadow, p.shadowAlpha)).toBeGreaterThanOrEqual(contrast(p.ground, old, oldA + (hc ? 0.17 : 0)));
        }
      }
    }
  });

  it('turns noon shade blue on the cream ground', () => {
    const p = createPalette();
    updatePalette(p, 0.5, 0, 0, false);
    const G = p.ground;
    const shaded = [16, 8, 0].map((ch) => Math.round(((G >> ch) & 255) * (1 - p.shadowAlpha * (1 - ((p.shadow >> ch) & 255) / 255))));
    // About #829ABD: blue clearly above red.
    expect((shaded[2] as number) - (shaded[0] as number)).toBeGreaterThan(40);
  });
});

describe('dial v2 shade split (GR6)', () => {
  const mask = (...ranges: [number, number][]): Uint8Array => {
    const m = new Uint8Array(360);
    for (const [a, b] of ranges) for (let i = a; i < b; i++) m[i % 360] = 1;
    return m;
  };

  it('splits now/next into lasting = now ∧ next, ending and coming', () => {
    const out = createShadeSplit();
    const now = mask([10, 50], [350, 370]);
    const next = mask([30, 80]);
    expect(splitShade(now, next, out)).toBe('lasting');
    for (let b = 0; b < 360; b++) {
      expect(out.lasting[b]).toBe(now[b]! & next[b]!);
      expect(out.ending[b]).toBe(now[b]! & (1 - next[b]!));
      expect(out.coming[b]).toBe(next[b]! & (1 - now[b]!));
    }
    expect(out.lasting[40]).toBe(1);
    expect(out.ending[355]).toBe(1);
    expect(out.coming[60]).toBe(1);
  });

  it('falls back to the now arcs when nothing lasts, and to nothing when nothing is shaded now', () => {
    const out = createShadeSplit();
    expect(splitShade(mask([10, 30]), mask([40, 60]), out)).toBe('fallback');
    expect(out.lasting.every((x) => x === 0)).toBe(true);
    expect(splitShade(mask(), mask([40, 60]), out)).toBe('none');
    expect(out.coming[50]).toBe(1);
  });
});

describe('matched shadow composite (GR2)', () => {
  it('gives the multiplied ground color with a plain source-over fill, at every hour and in high contrast', () => {
    const p = createPalette();
    const layer = { fill: 0 };
    for (const hc of [false, true]) {
      for (let k = 0; k <= 48; k++) {
        updatePalette(p, k / 48, 0, k % 2, hc);
        for (const a of [p.shadowAlpha, p.shadowAlpha * 0.72]) {
          const beta = matchShadow(layer, p.shadow, p.ground, a);
          expect(beta).toBeGreaterThan(0);
          for (const ch of [16, 8, 0]) {
            const G = (p.ground >> ch) & 255;
            const C = (p.shadow >> ch) & 255;
            const K = (layer.fill >> ch) & 255;
            const multiplied = G * (1 - a * (1 - C / 255));
            expect(Math.abs(beta * K + (1 - beta) * G - multiplied)).toBeLessThanOrEqual(0.5);
          }
        }
      }
    }
    // Nothing to draw at (almost) zero alpha.
    expect(matchShadow(layer, p.shadow, p.ground, 0.001)).toBe(0);
  });
});

describe('pops (GR9)', () => {
  const live = (p: Pops): string[] => {
    const out: string[] = [];
    for (let i = 0; i < p.dur.length; i++) if ((p.dur[i] as number) > 0) out.push(p.text[i] as string);
    return out;
  };

  it('three flakes 0.3 s apart leave one +3 pop', () => {
    const p = createPops();
    addPlus(p, 1);
    updatePops(p, 0.3);
    addPlus(p, 1);
    updatePops(p, 0.3);
    addPlus(p, 1);
    expect(live(p)).toEqual(['+3']);
    // It lives 0.75 s from the last flake; after that a new +1 starts a new pop.
    updatePops(p, 0.7);
    expect(live(p)).toEqual(['+3']);
    updatePops(p, 0.1);
    addPlus(p, 1);
    expect(live(p)).toEqual(['+1']);
  });

  it('shows at most one SWING pop a second; a chain updates it', () => {
    const p = createPops();
    addSwing(p, 1);
    updatePops(p, 0.5);
    addSwing(p, 2);
    expect(live(p)).toEqual(['SWING! ×2']);
    updatePops(p, 0.6);
    addSwing(p, 3);
    expect(live(p).sort()).toEqual(['SWING! ×2', 'SWING! ×3']);
  });

  it('a headline clears small pops that have risen toward its row, but not fresh ones', () => {
    const p = createPops();
    addPlus(p, 1);
    updatePops(p, 0.3);
    addHeadline(p, 'PHEW!', POP_PHEW, 1.1);
    addPlus(p, 3);
    // The risen +1 takes no more values and is gone 0.12 s later; PHEW's +3 is a pop of its own.
    expect(live(p).sort()).toEqual(['+1', '+3', 'PHEW!']);
    updatePops(p, 0.13);
    expect(live(p).sort()).toEqual(['+3', 'PHEW!']);
    // A +1 only 0.1 s old stays and absorbs the +3.
    const q = createPops();
    addPlus(q, 1);
    updatePops(q, 0.1);
    addHeadline(q, 'PHEW!', POP_PHEW, 1.1);
    addPlus(q, 3);
    expect(live(q).sort()).toEqual(['+4', 'PHEW!']);
  });
});

describe('noon boss and Day card (GR10)', () => {
  const at = (h: number, m: number): number => (h * 60 + m - 360) / 720;

  it('ramps the boss up from 11:00 to 11:30 and down from 12:36 to 1:00 PM; a Heat Wave widens it', () => {
    expect(bossWeight(at(10, 59), false)).toBe(0);
    expect(bossWeight(at(11, 15), false)).toBeGreaterThan(0.3);
    expect(bossWeight(at(11, 31), false)).toBe(1);
    expect(bossWeight(at(12, 30), false)).toBe(1);
    expect(bossWeight(at(12, 50), false)).toBeGreaterThan(0);
    expect(bossWeight(at(13, 1), false)).toBe(0);
    expect(bossWeight(at(10, 45), true)).toBeGreaterThan(0.1);
    expect(bossWeight(at(13, 15), true)).toBeGreaterThan(0.1);
    expect(bossWeight(at(13, 31), true)).toBe(0);
  });

  it("writes the Day card's second line from the plan, leaving out a clear forecast", () => {
    const b = createBanners();
    showDayCard(b, 4, 'oldtown', 'heat', 71.6);
    expect(b.dayText).toBe('DAY 4');
    expect(b.dayLine).toBe('OLD TOWN · Heat Wave · NOON 72°');
    showDayCard(b, 5, 'meadow', 'clear', 58);
    expect(b.dayLine).toBe('MEADOW · NOON 58°');
  });
});
