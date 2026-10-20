// Every in-run tip fits its canvas toast whole (docs/UI_V2.md §9.5): wrapped with the toast's own
// fitToast() at the toast's own width, no tip ends in an ellipsis on a 320, 360 or 390 px phone.
// The widths are the body face's (system-ui at weight 800) as Chromium measures it on the e2e machine,
// per 100 px; summing advances (no kerning) reads 0.2-0.5% wider than measureText, so this errs long.
import { describe, expect, it } from 'vitest';
import { hudScale } from '../../src/render/hud.ts';
import { fitToast, toastBox, toastTextW } from '../../src/render/banners.ts';
import { FIRST_TIPS, LEVEL_TIPS, MECH_TIPS, SOFT_FAIL_TIP } from '../../src/game/moments.ts';
import { createView } from '../../src/game/camera.ts';

const W100: Readonly<Record<string, number>> = {
  ' ': 21.9, '!': 35.8, '"': 58.6, '#': 65.5, $: 66, '%': 102.9, '&': 68.3, "'": 35.4, '(': 38.2, ')': 38.2, '*': 58.3, '+': 68.6,
  ',': 35.3, '-': 47.1, '.': 35.3, '/': 40, ':': 35.3, ';': 36, '<': 68.6, '=': 68.6, '>': 68.6, '?': 57.9, '@': 103.6,
  0: 69.2, 1: 44.1, 2: 63.8, 3: 65.7, 4: 68.8, 5: 65.2, 6: 66.2, 7: 58.8, 8: 66.4, 9: 66.2,
  A: 77, B: 66.5, C: 74.4, D: 72.3, E: 61, F: 58.5, G: 75.2, H: 74.9, I: 28.6, J: 59, K: 73.8, L: 56.5, M: 94.3, N: 76.6,
  O: 77.3, P: 65.2, Q: 78.2, R: 66.2, S: 66, T: 67.7, U: 72.7, V: 77, W: 105.9, X: 76.1, Y: 75.2, Z: 67.9,
  a: 58.8, b: 63.8, c: 59.5, d: 63.8, e: 60.1, f: 41, g: 63.9, h: 63.5, i: 28.3, j: 28.3, k: 59.3, l: 28.3, m: 92.7, n: 63.5,
  o: 61.9, p: 63.8, q: 63.8, r: 42, s: 57.3, t: 38.2, u: 63.5, v: 61.5, w: 86.3, x: 59.4, y: 61.8, z: 58.1,
  '×': 68.6, '·': 35.3, '…': 105.8, '’': 33.1, '‘': 33.1, '“': 58.1, '”': 56.9, '–': 50, '—': 100, '↓': 93.4, '←': 95.4, '→': 95.4, '°': 46.1,
};

/** A canvas stand-in that measures with W100 at the size its font string names. */
function measurer(): Pick<CanvasRenderingContext2D, 'font' | 'measureText'> {
  let font = '';
  let px = 15;
  return {
    get font() {
      return font;
    },
    set font(f: string) {
      font = f;
      px = Number(/(\d+(?:\.\d+)?)px/.exec(f)?.[1] ?? 15);
    },
    measureText(s: string) {
      let w = 0;
      for (const ch of s) {
        const a = W100[ch];
        if (a === undefined) throw new Error(`no width for ${JSON.stringify(ch)} in ${JSON.stringify(s)}`);
        w += a;
      }
      return { width: (w * px) / 100 } as TextMetrics;
    },
  };
}

/** Every tip a run can show: the Journey's (with a two-digit Dare count), each mechanic's, a new player's, the soft-fail's. */
const TIPS: readonly string[] = [
  ...Object.values(LEVEL_TIPS).flatMap((l) => l.map((t) => t[1].replace('{n}', '12'))),
  ...Object.values(MECH_TIPS).flatMap((l) => l.map((t) => t[1])),
  ...FIRST_TIPS.map((t) => t[1]),
  SOFT_FAIL_TIP,
];

describe('canvas tip toasts', () => {
  it('lists the tips it checks', () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(25);
  });

  for (const vw of [320, 360, 390]) {
    it(`never cut a tip at ${vw} px`, () => {
      const v = createView();
      v.cssW = vw;
      const k = hudScale(v);
      const [x, w] = toastBox(0, vw, 0, 0, k);
      // Clear of the pause square's column and the screen's right edge.
      expect(x).toBeGreaterThanOrEqual(64);
      expect(x + w).toBeLessThanOrEqual(vw - 8);
      const g = measurer();
      const cut = TIPS.filter((t) => fitToast(g, t, false, toastTextW(w, k), k).cut);
      expect(cut).toEqual([]);
    });
  }

  it('keeps every tip to two lines at the full 15k face on a 390 px phone (the band it covers stays small)', () => {
    const v = createView();
    v.cssW = 390;
    const k = hudScale(v);
    const [, w] = toastBox(0, 390, 0, 0, k);
    const g = measurer();
    const long = TIPS.filter((t) => {
      const fit = fitToast(g, t, false, toastTextW(w, k), k);
      return fit.px !== 15 || fit.lines.length > 2;
    });
    expect(long).toEqual([]);
  });

  it('keeps a tip that fits in three lines at the full 15k face', () => {
    const g = measurer();
    const fit = fitToast(g, 'Bloomed! Shade for the rest of the run.', false, toastTextW(318, 1), 1);
    expect(fit.px).toBe(15);
    expect(fit.lines.length).toBeLessThanOrEqual(2);
  });
});
