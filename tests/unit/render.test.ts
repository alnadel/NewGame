// Pure render helpers (wave 3): the Melt Map's fade timing (callouts only after the camera pull,
// K10), when the map counts as settled (the Results backdrop cache), the cached rgba() strings, and
// Nubs' shade tint shared by the palette and the cached sprite (quantized night, G15).
import { describe, expect, it } from 'vitest';
import { cssa, hex } from '../../src/render/color.ts';
import { MAP_FADE_S, MAP_LABEL_FADE_S, MAP_PULL_S, mapAlphas, mapSettleT, type MapOverlay } from '../../src/render/meltMap.ts';
import { createPalette, nubsShadeAt, updatePalette } from '../../src/render/palette.ts';

const overlay = (): MapOverlay => ({ a: 0, labelA: 0, sheetTop: null, time: 0, puddle: true });

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
