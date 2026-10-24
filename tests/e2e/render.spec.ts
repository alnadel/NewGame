// Render-side checks (gameRender): the render cadence (menus draw once, the settled Results draw at
// 20 fps with the puddle ring still pulsing), the world rect published for the DOM (K9), the Melt
// Map never drawing under the Results sheet (K10), camera shake and zoom that end (and never start
// under reduced motion), the lazily painted ground tiles, the matched shadow composite (GR2) and
// the death beat with its recap tip and callouts that never overlap (GR12), the postcard (GR14),
// the Daily par computed in idle slices (GR15) and the Elementals v2 trial frames (docs/ELEMENTALS_V2.md §9.4).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { dayStartTick, dayTicks } from '../../src/core/index.ts';
import { drag, keepAlive, OPEN_SAVE, openGame, pageDate, seedSave, skipToLeg, state, waitForRunStart, waitForScreen, watchErrors } from './helpers.ts';

function center(page: Page): { x: number; y: number } {
  const v = page.viewportSize() ?? { width: 390, height: 844 };
  return { x: Math.round(v.width / 2), y: Math.round(v.height * 0.55) };
}

async function startPlay(page: Page): Promise<void> {
  const c = center(page);
  await drag(page, c.x, c.y, -40);
  await waitForScreen(page, 'play');
}

async function toResults(page: Page): Promise<void> {
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);
}

const perf = (page: Page): Promise<{ draws: number; groundPaints: number }> =>
  page.evaluate(() => window.__SHADY_TEST__!.perf());

/** renderer.draw calls per second over one second, timed in the page. */
async function drawRate(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const hook = window.__SHADY_TEST__!;
    const d0 = hook.perf().draws;
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 1000));
    return ((hook.perf().draws - d0) * 1000) / (performance.now() - t0);
  });
}

async function worldVars(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('ui')!);
    return ['--world-left', '--world-top', '--world-width', '--world-height'].map((k) => cs.getPropertyValue(k).trim());
  });
}

test.describe('render cadence', () => {
  test('a menu draws the canvas once, then stops', async ({ page }) => {
    await openGame(page);
    await page.locator('.tray button[aria-label="Settings"]').click();
    await waitForScreen(page, 'settings');
    await page.waitForTimeout(200);
    const before = (await perf(page)).draws;
    await page.waitForTimeout(1000);
    expect((await perf(page)).draws - before).toBeLessThanOrEqual(2);
    // A canvas-affecting setting redraws it once.
    await page.getByRole('switch', { name: 'High-contrast shadows' }).click();
    await page.waitForTimeout(300);
    const after = (await perf(page)).draws;
    expect(after - before).toBeGreaterThanOrEqual(1);
    expect(after - before).toBeLessThanOrEqual(3);
  });

  test('pause draws at most 30 fps', async ({ page }) => {
    await openGame(page);
    await startPlay(page);
    await page.locator('button[aria-label="Pause"]').click();
    await waitForScreen(page, 'pause');
    await page.waitForTimeout(300);
    expect(await drawRate(page)).toBeLessThanOrEqual(32);
  });

  test('settled Results draw at most 20 fps and leave the main thread free; the puddle ring still pulses', async ({ page }) => {
    await seedSave(page, OPEN_SAVE);
    const errors = watchErrors(page);
    await openGame(page);
    await startPlay(page);
    await page.waitForTimeout(600);
    await toResults(page);
    await page.waitForTimeout(3000);
    const m = await page.evaluate(async () => {
      const hook = window.__SHADY_TEST__!;
      const d0 = hook.perf().draws;
      let rafs = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 2000) {
        await new Promise((r) => requestAnimationFrame(r));
        rafs++;
      }
      return { draws: hook.perf().draws - d0, rafs };
    });
    expect(m.draws).toBeLessThanOrEqual(45);
    expect(m.draws).toBeGreaterThanOrEqual(30);
    expect(m.rafs).toBeGreaterThanOrEqual(100);
    // Two frames 0.25 s apart differ only around the puddle marker (the ring and the carrot).
    const diff = await page.evaluate(async () => {
      const canvas = document.getElementById('game') as HTMLCanvasElement;
      const g = canvas.getContext('2d')!;
      const a = g.getImageData(0, 0, canvas.width, canvas.height).data;
      await new Promise((r) => setTimeout(r, 250));
      const b = g.getImageData(0, 0, canvas.width, canvas.height).data;
      const p = window.__SHADY_TEST__!.nubsScreen();
      const dpr = canvas.width / canvas.clientWidth;
      let inside = 0;
      let outside = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
        const px = (i >> 2) % canvas.width;
        const py = Math.floor((i >> 2) / canvas.width);
        const near = Math.abs(px / dpr - p.x - 4) <= 30 && Math.abs(py / dpr - p.y + 6) <= 30;
        if (near) inside++;
        else outside++;
      }
      return { inside, outside };
    });
    expect(diff.inside).toBeGreaterThan(0);
    expect(diff.outside).toBe(0);
    expect(errors).toEqual([]);
  });
});

/** The Title held at absolute sim tick `tick` of `seed` (?day=&t=, reduced motion so it holds still). */
async function openAtTick(page: Page, seed: number, tick: number): Promise<void> {
  let day = 1;
  while (dayStartTick(day + 1) <= tick) day++;
  const dt = Math.min(dayTicks(day) - 1, tick - dayStartTick(day));
  const minutes = 360 + Math.floor((720 * dt) / dayTicks(day));
  const hhmm = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  await openGame(page, `test=1&seed=${seed}&day=${day}&t=${hhmm}&perf=0&plan=0`);
  await page.waitForTimeout(300);
}

/**
 * The dial around Nubs (220×220 CSS px): per ring band, how many device pixels are strong teal,
 * old-gauge blue, frost white and amber, and the longest radial run of strong teal (CSS px).
 */
async function dialPixels(page: Page): Promise<{ teal: number; tealRun: number; blue: number; frost: number; amber: number }> {
  return page.evaluate(() => {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const dpr = canvas.width / canvas.clientWidth;
    const n = window.__SHADY_TEST__!.nubsScreen();
    const R = 40 * (canvas.clientWidth / 360);
    const x0 = Math.round((n.x - 110) * dpr);
    const y0 = Math.round((n.y - 110) * dpr);
    const S = Math.round(220 * dpr);
    const d = canvas.getContext('2d')!.getImageData(x0, y0, S, S).data;
    const at = (x: number, y: number): [number, number, number] => {
      const i = (Math.round(y) * S + Math.round(x)) * 4;
      return [d[i]!, d[i + 1]!, d[i + 2]!];
    };
    const near = (c: [number, number, number], r: number, g: number, b: number, tol: number): boolean =>
      Math.abs(c[0] - r) <= tol && Math.abs(c[1] - g) <= tol && Math.abs(c[2] - b) <= tol;
    const isTeal = (c: [number, number, number]): boolean => c[1] - c[0] > 90 && c[2] - c[0] > 80;
    const out = { teal: 0, tealRun: 0, blue: 0, frost: 0, amber: 0 };
    const c = S / 2;
    for (let deg = 0; deg < 360; deg += 2) {
      const ca = Math.cos((deg * Math.PI) / 180);
      const sa = Math.sin((deg * Math.PI) / 180);
      let run = 0;
      for (let r = (R - 14) * dpr; r <= (R + 12) * dpr; r += 0.5) {
        const px = at(c + ca * r, c + sa * r);
        if (isTeal(px)) {
          out.teal++;
          run += 0.5;
          out.tealRun = Math.max(out.tealRun, run / dpr);
        } else run = 0;
        const rr = r / dpr;
        if (rr > R - 11 && rr < R - 5) {
          if (near(px, 0x5a, 0xb8, 0xff, 24)) out.blue++;
          if (near(px, 0xea, 0xf6, 0xff, 14)) out.frost++;
          if (near(px, 0xff, 0xa5, 0x3d, 30)) out.amber++;
        }
      }
    }
    return out;
  });
}

test.describe('dial v2 (GR6)', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test('thick teal for lasting shade, no gauge at full Chill, amber below the white line (50)', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'one DPR-2 run is enough');
    // Full Chill at the start: no gauge ring (and never the old blue one).
    await seedSave(page, OPEN_SAVE);
    await openGame(page, 'test=1&seed=42&day=1&t=9:00&perf=0&plan=0');
    await page.mouse.click(195, 340);
    await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(0));
    await page.waitForTimeout(200);
    const full = await dialPixels(page);
    expect(full.blue).toBe(0);
    expect(full.frost).toBe(0);
    // The human bot plays: some frame shows a thick (≥ 6 px) lasting arc.
    await page.goto('/?test=1&seed=42&day=1&t=9:00&perf=0&plan=0&bot=human');
    await waitForScreen(page, 'play', 10_000);
    let thick = 0;
    for (let i = 0; i < 30 && thick < 6; i++) {
      await page.waitForTimeout(150);
      thick = Math.max(thick, (await dialPixels(page)).tealRun);
    }
    expect(thick).toBeGreaterThanOrEqual(6);
    // Chill 35, between the red line and the full pour (TUNING.bank.coolChill 25, cashFullChill 50): an amber gauge.
    await openGame(page, 'test=1&seed=42&day=1&t=9:00&perf=0&plan=0&chill=35');
    await page.mouse.click(195, 340);
    await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(0));
    await page.waitForTimeout(200);
    const low = await dialPixels(page);
    expect(low.amber).toBeGreaterThan(20);
    expect(low.blue).toBe(0);
    const n = await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen());
    await info.attach('dial-chill35', { body: await page.screenshot({ clip: { x: n.x - 110, y: n.y - 110, width: 220, height: 220 } }), contentType: 'image/png' });
  });
});

test.describe('shadow composite (GR2)', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test('matched source-over matches the multiply composite within a level', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'one DPR-2 run is enough');
    await seedSave(page, { v: 1, createdAt: 1, settings: { reducedMotion: 'on' } });
    const rows: string[] = [];
    for (const [seed, tick] of [
      [42, 1200],
      [42, 3000],
      [42, 20000],
      [7, 9000],
      [7, 26000],
      [99, 14000],
    ] as const) {
      await openAtTick(page, seed, tick);
      const ab = await page.evaluate(() => window.__SHADY_TEST__!.pixelAB({ multiplyShadows: true }, {}));
      expect(ab).not.toBeNull();
      rows.push(`seed ${seed} tick ${tick}: mean ${ab!.mean.toFixed(3)} >3 ${(ab!.over3 * 100).toFixed(2)}% max ${ab!.max}`);
      // Exact on the ground. Under the v1.1 colour script's bluer shadows (GR5 keys) the shaded trail
      // is up to ~20 levels off in blue (≤ 3.1 % of pixels > 3 at 14:00) and white pickups up to ~30
      // (A12 re-run with AO, documented in shadowLayer.ts).
      expect(ab!.mean, rows[rows.length - 1]).toBeLessThanOrEqual(1);
      expect(ab!.over3, rows[rows.length - 1]).toBeLessThanOrEqual(0.04);
      expect(ab!.max, rows[rows.length - 1]).toBeLessThanOrEqual(40);
    }
    await info.attach('shadow-ab', { body: rows.join('\n'), contentType: 'text/plain' });
  });
});

/** Counts the game canvas's drawImage, fill and stroke calls (installed before the page's scripts). */
async function countCalls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const c: Record<string, number> = { drawImage: 0, fill: 0, stroke: 0 };
    (window as unknown as { __calls: Record<string, number> }).__calls = c;
    const P = CanvasRenderingContext2D.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const k of Object.keys(c)) {
      const orig = P[k] as (...a: unknown[]) => unknown;
      P[k] = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
        if (this.canvas instanceof HTMLCanvasElement && this.canvas.id === 'game') c[k] = (c[k] as number) + 1;
        return orig.apply(this, a);
      };
    }
  });
}

/** The counted calls per drawn frame over one second (and the frames drawn). */
async function callsPerFrame(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const w = window as unknown as { __calls: Record<string, number> };
    const d0 = window.__SHADY_TEST__!.perf().draws;
    const c0 = { ...w.__calls };
    await new Promise((r) => setTimeout(r, 1000));
    const n = window.__SHADY_TEST__!.perf().draws - d0;
    const out: Record<string, number> = { frames: n };
    for (const k of Object.keys(c0)) out[k] = ((w.__calls[k] as number) - (c0[k] as number)) / Math.max(1, n);
    return out;
  });
}

test.describe('draw-call budget', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

  // A load-independent perf guard (fix round 1): the canvas calls one full-quality play frame issues
  // (time frozen, seed 42 at 9:00 AM). v1.0 issued ~40 drawImage, ~150 fill and ~60 stroke calls
  // there; v1.1 adds about 85 decal blits, a contact-AO sprite per caster and the atmosphere layer.
  test('a full-quality play frame stays within its canvas-call budget', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'one run is enough');
    await seedSave(page, OPEN_SAVE);
    await countCalls(page);
    await openGame(page, 'test=1&perf=0&seed=42&day=1&t=9:00&plan=0');
    await keepAlive(page);
    // Frozen on one sim tick, not after a wall-clock wait: under CPU load a fixed wait froze an
    // earlier scene (86 strokes against 74), and freezing on the first frame past a game minute
    // froze a few ticks later, with Nubs half in the sun (f 0.2 against 0: 86 strokes again). The
    // run plays at a third of its speed, and at a twentieth over its last two minutes, so no frame
    // runs more than one tick there: the freeze lands on the first tick of 9:12 AM.
    const T = 192;
    await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(0.3));
    await page.mouse.click(195, 380);
    await waitForScreen(page, 'play');
    const m0 = await page.evaluate(() => window.__SHADY_TEST__!.state().minutes);
    expect(m0, 'the run starts at 9:00 AM').toBeLessThanOrEqual(T - 4);
    await page.waitForFunction((t) => {
      const h = window.__SHADY_TEST__!;
      const m = h.state().minutes;
      if (m >= t) {
        h.setTimeScale(0);
        return true;
      }
      if (m >= t - 2) h.setTimeScale(0.05);
      return false;
    }, T, { polling: 'raf', timeout: 30_000 });
    const frozenAt = await page.evaluate(() => window.__SHADY_TEST__!.state().minutes);
    expect(frozenAt).toBe(T);
    await page.waitForTimeout(300);
    const per = await callsPerFrame(page);
    await info.attach('calls-per-frame', { body: JSON.stringify(per), contentType: 'application/json' });
    expect(per.frames).toBeGreaterThan(10);
    expect(per.drawImage, JSON.stringify(per)).toBeLessThanOrEqual(190);
    // 190 and 77: the frame shows the first bud tip, whose icon disc now draws its glyph (v1.6 fix
    // round 1; it was blank): +3 fills and +1 stroke over the 185 and 75 measured before. On the
    // exact tick (review of economy iteration 2) it measures 148-150 / 175 / 71, loaded or not.
    expect(per.fill, JSON.stringify(per)).toBeLessThanOrEqual(190);
    expect(per.stroke, JSON.stringify(per)).toBeLessThanOrEqual(77);
  });
});

test.describe('Elementals v2 trial frames (docs/ELEMENTALS_V2.md §9.4)', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

  /**
   * Opens Trial n, starts it with a tap, fast-forwards to leg 1 (testSkipToLeg; ?elfix=1 stays on
   * leg 0 with every object state just ahead) and lets it run untouched; returns the sprite layer
   * redraws per second over that time, then freezes time and counts one second of frames.
   */
  async function trialFrame(page: Page, n: number, query = '', secs = 3): Promise<{ per: Record<string, number>; layers: number; passes: number }> {
    await page.goto(`/?test=1&perf=0&trial=${n}${query}`);
    await waitForScreen(page, 'play');
    await page.mouse.click(195, 380);
    await waitForRunStart(page);
    if (!query.includes('elfix')) await skipToLeg(page, 1);
    // The core bot that fast-forwarded may leave the sun mid-drag (no lift reaches the sim, so the
    // dial would show its detent ticks): a tap far from every target ends that drag.
    await page.mouse.click(60, 760);
    const layers = await page.evaluate(async (ms) => {
      const hook = window.__SHADY_TEST__!;
      const l0 = hook.perf().nubsLayerDraws;
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, ms));
      const rate = ((hook.perf().nubsLayerDraws - l0) * 1000) / (performance.now() - t0);
      hook.setTimeScale(0);
      return rate;
    }, secs * 1000);
    await page.waitForTimeout(300);
    const per = await callsPerFrame(page);
    const passes = await page.evaluate(() => window.__SHADY_TEST__!.perf().fullScreenPasses);
    return { per, layers, passes };
  }

  // Steam's world (five cottages in view) and its chapter's snow (Flurry Fields: ~24 flakes) issue
  // 200 fills at that moment before any trial art (measured at C0c); the trial's objects, cues and
  // meter pill add about 6: its fill ceiling allows the world (measured 206-207).
  const FILL: Record<number, number> = { 5: 216 };

  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    test(`Trial ${n}, 3 s into leg 1: the Nubs frame's ceilings, ≤ 3 passes and ≤ 12 sprite layer redraws a second`, async ({ page }, info) => {
      test.skip(info.project.name !== 'mobile', 'one run is enough');
      const errors = watchErrors(page);
      await seedSave(page, OPEN_SAVE);
      await countCalls(page);
      const { per, layers, passes } = await trialFrame(page, n);
      const row = JSON.stringify({ ...per, layers, passes });
      await info.attach(`trial-${n}`, { body: row, contentType: 'application/json' });
      expect(per.frames, row).toBeGreaterThan(10);
      expect(per.drawImage, row).toBeLessThanOrEqual(190);
      expect(per.fill, row).toBeLessThanOrEqual(FILL[n] ?? 190);
      expect(per.stroke, row).toBeLessThanOrEqual(77);
      expect(passes, row).toBeLessThanOrEqual(3);
      expect(layers, row).toBeLessThanOrEqual(12);
      expect(errors).toEqual([]);
    });
  }

  test('?elfix=1: every object kind and state in one frame, within the ceilings', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'one run is enough');
    const errors = watchErrors(page);
    await seedSave(page, OPEN_SAVE);
    await countCalls(page);
    const { per, passes } = await trialFrame(page, 1, '&elfix=1', 0.4);
    const row = JSON.stringify({ ...per, passes });
    await info.attach('elfix', { body: await page.screenshot(), contentType: 'image/png' });
    const el = (await state(page)).el!;
    // The fixture's kinds, and the states the art draws: burning, half-grown, wet.
    expect(new Set(el.objs.map((o) => o.k))).toEqual(new Set(['bramble', 'gate', 'ice', 'gap', 'stream', 'puddle', 'stone', 'plot', 'rain', 'fog']));
    expect(el.objs.some((o) => o.state === 1)).toBe(true);
    expect(el.objs.some((o) => o.grown > 0 && o.grown < o.size)).toBe(true);
    expect(per.drawImage, row).toBeLessThanOrEqual(190);
    expect(per.fill, row).toBeLessThanOrEqual(190);
    expect(per.stroke, row).toBeLessThanOrEqual(77);
    expect(passes, row).toBeLessThanOrEqual(3);
    expect(errors).toEqual([]);
  });

  // Reduced motion and high contrast together: one still flame frame, no wisps, no hop, no shake;
  // high contrast outlines the objects and thickens the cues, within the same ceilings.
  for (const n of [2, 4]) {
    test(`Trial ${n} in reduced motion and high contrast: a still frame within the ceilings`, async ({ page }, info) => {
      test.skip(info.project.name !== 'mobile', 'one run is enough');
      const errors = watchErrors(page);
      await seedSave(page, { ...OPEN_SAVE, settings: { unlockAll: true, reducedMotion: 'on', highContrast: true } });
      await countCalls(page);
      const { per, layers, passes } = await trialFrame(page, n);
      const row = JSON.stringify({ ...per, layers, passes });
      await info.attach(`trial-${n}-rm-hc`, { body: await page.screenshot(), contentType: 'image/png' });
      expect(per.drawImage, row).toBeLessThanOrEqual(190);
      expect(per.fill, row).toBeLessThanOrEqual(190);
      expect(per.stroke, row).toBeLessThanOrEqual(77);
      expect(passes, row).toBeLessThanOrEqual(3);
      // No flicker: the walker redraws only for its look and state.
      expect(layers, row).toBeLessThanOrEqual(6);
      const fx = await page.evaluate(() => window.__SHADY_TEST__!.cameraFx());
      expect(Math.abs(fx.shakeX) + Math.abs(fx.shakeY)).toBe(0);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('forecast signatures', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

  test('each forecast grades the whole frame unmistakably, within three full-screen passes', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'one run is enough');
    await seedSave(page, OPEN_SAVE);
    /** Mean colour of the world below the HUD at Day 1 11:20 AM under a forced forecast (time frozen). */
    const frame = async (forecast: string): Promise<{ rgb: number[]; passes: number }> => {
      await openGame(page, `test=1&perf=0&seed=11&day=1&t=11:20&forecast=${forecast}`);
      await keepAlive(page);
      await page.mouse.click(195, 380);
      await waitForScreen(page, 'play');
      await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(0));
      await page.waitForTimeout(600);
      return page.evaluate(() => {
        const c = document.getElementById('game') as HTMLCanvasElement;
        const g = c.getContext('2d')!;
        const y0 = Math.round(c.height * 0.15);
        const d = g.getImageData(0, y0, c.width, Math.round(c.height * 0.7)).data;
        const sum = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4 * 7) for (let k = 0; k < 3; k++) sum[k]! += d[i + k]!;
        const n = d.length / (4 * 7);
        return { rgb: sum.map((v) => v / n), passes: window.__SHADY_TEST__!.perf().fullScreenPasses };
      });
    };
    const clear = await frame('clear');
    const rows: string[] = [`clear ${clear.rgb.map((v) => v.toFixed(0)).join(',')}`];
    for (const f of ['heat', 'overcast', 'long']) {
      const r = await frame(f);
      const dist = Math.hypot(...r.rgb.map((v, k) => v - clear.rgb[k]!));
      rows.push(`${f} ${r.rgb.map((v) => v.toFixed(0)).join(',')} Δ ${dist.toFixed(1)} passes ${r.passes}`);
      expect(dist, rows.join(' | ')).toBeGreaterThanOrEqual(10);
      expect(r.passes).toBeLessThanOrEqual(3);
    }
    await info.attach('forecast-means', { body: rows.join('\n'), contentType: 'text/plain' });
  });
});

test.describe('world rect (K9)', () => {
  test('--world-* follow the letterboxed view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openGame(page);
    await expect.poll(() => worldVars(page)).toEqual(['400px', '0px', '480px', '800px']);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => worldVars(page)).toEqual(['0px', '0px', '390px', '844px']);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect.poll(() => worldVars(page)).toEqual(['282px', '0px', '461px', '768px']);
  });
});

test.describe('Melt Map under the sheet (K10)', () => {
  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    test(`nothing of the overlay below the sheet at ${size.width}x${size.height}`, async ({ page }, info) => {
      await page.setViewportSize(size);
      await openGame(page);
      await startPlay(page);
      await page.waitForTimeout(1500);
      await toResults(page);
      await page.waitForTimeout(800);
      // A see-through sheet for the attached screenshots (the probe reads the canvas itself).
      await page.addStyleTag({ content: '.res-sheet, .res-sheet * { background: transparent !important; box-shadow: none !important; }' });
      for (const t of [0.3, 0.8, 1.5, 3]) {
        const p = await page.evaluate((mapT) => window.__SHADY_TEST__!.mapProbe(mapT), t);
        expect(p, `probe at ${t}`).not.toBeNull();
        expect(p!.above, `overlay drawn above the sheet at mapT ${t}`).toBeGreaterThan(0);
        expect(p!.below, `overlay pixels below the sheet at mapT ${t} (sheet top ${p!.sheetTop}, box ${JSON.stringify(p!.belowBox)})`).toBe(0);
        await info.attach(`map-${size.width}x${size.height}-${t}s`, { body: Buffer.from(p!.png.split(',')[1]!, 'base64'), contentType: 'image/png' });
      }
      await info.attach(`results-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
});

test.describe('camera effects', () => {
  test('the death shake ends: the Title camera is back after Home', async ({ page }) => {
    await seedSave(page, OPEN_SAVE);
    await openGame(page);
    const y0 = (await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen())).y;
    await startPlay(page);
    await toResults(page);
    await page.locator('.res-sheet button[aria-label="Home"]').click();
    await waitForScreen(page, 'title');
    await page.waitForTimeout(300);
    const y1 = (await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen())).y;
    expect(Math.abs(y1 - y0)).toBeLessThanOrEqual(0.5);
    expect(await page.evaluate(() => window.__SHADY_TEST__!.cameraFx())).toEqual({ zoom: 1, shakeX: 0, shakeY: 0 });
  });

  test('a cloud capture zooms for about 0.4 s, then exactly 1', async ({ page }) => {
    await openGame(page);
    await startPlay(page);
    const samples = await page.evaluate(async () => {
      const hook = window.__SHADY_TEST__!;
      hook.demo('cloud');
      const out: { t: number; zoom: number }[] = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 900) {
        await new Promise((r) => requestAnimationFrame(r));
        out.push({ t: performance.now() - t0, zoom: hook.cameraFx().zoom });
      }
      return out;
    });
    const zoomed = samples.filter((s) => s.zoom > 1);
    expect(zoomed.length).toBeGreaterThan(5);
    const last = zoomed[zoomed.length - 1]!.t;
    expect(last).toBeGreaterThan(250);
    expect(last).toBeLessThan(600);
    expect(samples[samples.length - 1]!.zoom).toBe(1);
  });

  test('reduced motion: no zoom and no shake', async ({ page }) => {
    await seedSave(page, { v: 1, createdAt: 1, settings: { reducedMotion: 'on' } });
    await openGame(page);
    await startPlay(page);
    const worst = await page.evaluate(async () => {
      const hook = window.__SHADY_TEST__!;
      hook.demo('cloud');
      hook.demo('glare');
      hook.forceDeath();
      let zoom = 1;
      let shake = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 800) {
        await new Promise((r) => requestAnimationFrame(r));
        const c = hook.cameraFx();
        zoom = Math.max(zoom, c.zoom);
        shake = Math.max(shake, Math.abs(c.shakeX), Math.abs(c.shakeY));
      }
      return { zoom, shake };
    });
    expect(worst).toEqual({ zoom: 1, shake: 0 });
  });
});

test.describe('ground tiles', () => {
  test('Day 1 paints only the meadow tile', async ({ page }) => {
    await openGame(page);
    await page.waitForTimeout(500);
    expect((await perf(page)).groundPaints).toBe(1);
  });
});

test.describe('death beat (GR12)', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test('the camera pushes in on the puddle and the world greys outside a ring of colour', async ({ page }, info) => {
    await seedSave(page, OPEN_SAVE);
    await openGame(page, 'test=1&seed=42&day=1&t=13:00&perf=0&plan=0&profile=3');
    // Slow sim time: at 1 PM Nubs would melt on his own before the forced death (the beat runs on
    // real time).
    await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(0.05));
    await startPlay(page);
    await page.waitForTimeout(500);
    const r = await page.evaluate(async () => {
      const hook = window.__SHADY_TEST__!;
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      const n = hook.nubsScreen();
      // Mean saturation (max − min channel) inside 25 px of the puddle and beyond 150 px of it.
      const sat = (): { near: number; far: number } => {
        const g = c.getContext('2d')!;
        const k = c.width / innerWidth;
        const img = g.getImageData(0, 0, c.width, c.height).data;
        let near = 0;
        let nn = 0;
        let far = 0;
        let nf = 0;
        for (let y = 0; y < c.height; y += 6) {
          for (let x = 0; x < c.width; x += 6) {
            const d = Math.hypot(x / k - n.x, y / k - n.y);
            if (d > 25 && d < 150) continue;
            const i = (y * c.width + x) * 4;
            const s = Math.max(img[i]!, img[i + 1]!, img[i + 2]!) - Math.min(img[i]!, img[i + 1]!, img[i + 2]!);
            if (d <= 25) {
              near += s;
              nn++;
            } else {
              far += s;
              nf++;
            }
          }
        }
        return { near: near / nn, far: far / nf };
      };
      const before = sat();
      hook.setTimeScale(1);
      hook.forceDeath();
      // The melt lands on the next daylight tick (after the start beat): time the beat from there.
      const w0 = performance.now();
      while (hook.state().phase !== 'dead' && performance.now() - w0 < 4000) await new Promise((res) => requestAnimationFrame(res));
      let zoom = 1;
      let passes = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 650) {
        await new Promise((res) => requestAnimationFrame(res));
        zoom = Math.max(zoom, hook.cameraFx().zoom);
        passes = Math.max(passes, hook.perf().fullScreenPasses);
      }
      return { before, after: sat(), zoom, passes, png: c.toDataURL('image/png') };
    });
    await info.attach('death-650ms', { body: Buffer.from(r.png.split(',')[1]!, 'base64'), contentType: 'image/png' });
    expect(r.zoom).toBeGreaterThan(1.15);
    expect(r.zoom).toBeLessThanOrEqual(1.18 + 1e-9);
    expect(r.passes).toBeLessThanOrEqual(3);
    // The far world loses most of its colour; the puddle's surroundings keep theirs.
    expect(r.after.far).toBeLessThan(r.before.far * 0.6);
    expect(r.after.near).toBeGreaterThan(r.after.far);
  });

  test('seed 11: the Results carry a recap tip and the callouts keep apart', async ({ page }) => {
    await seedSave(page, OPEN_SAVE);
    // At noon the recap always has a line (the noon one, unless an earlier rule fits).
    await openGame(page, 'test=1&seed=11&day=1&t=12:00&profile=3');
    // At noon on profile 3 a slow drag can outlast Nubs: the oracle keeps him alive until the forced melt.
    await keepAlive(page);
    await startPlay(page);
    await page.waitForTimeout(800);
    await toResults(page);
    await page.waitForTimeout(3000);
    const tip = await page.evaluate(() => window.__SHADY_TEST__!.resultsTip());
    // One of core deathTip's lines (their wording rotates run to run): a direction, a count of the
    // seconds walked in the sun, the noon line or the glare line; never a screen side.
    expect(tip).toMatch(/\d+° away.*Drag [←→]|Drag [←→]: .*\d+° away|\d+ of the last \d+ s|[Nn]oon|[Gg]lare/);
    expect(tip).not.toMatch(/\b(left|right)\b/);
    const boxes = await page.evaluate(() => window.__SHADY_TEST__!.mapCallouts());
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [ax, ay, aw, ah] = boxes[i]!;
        const [bx, by, bw, bh] = boxes[j]!;
        expect(ax! < bx! + bw! && bx! < ax! + aw! && ay! < by! + bh! && by! < ay! + ah!, JSON.stringify(boxes)).toBe(false);
      }
    }
    // The Results sheet shows it (uiMeta renders ResultsView.tip).
    await expect(page.locator('#ui')).toContainText(tip!);
  });
});

test.describe('postcard (GR14)', () => {
  async function toPostcard(page: Page): Promise<number[]> {
    await openGame(page);
    await startPlay(page);
    await page.waitForTimeout(1200);
    await toResults(page);
    await page.waitForFunction(() => window.__SHADY_TEST__!.postcard().ready, undefined, { timeout: 15_000 });
    return (await page.evaluate(() => window.__SHADY_TEST__!.postcard())).stageMs;
  }

  test('built in short idle stages; without a share sheet the Postcard pill downloads a 1080×1350 PNG', async ({ page }) => {
    const stages = await toPostcard(page);
    expect(stages.length).toBeGreaterThanOrEqual(3);
    for (const ms of stages) expect(ms).toBeLessThan(50);
    const download = page.waitForEvent('download');
    await page.evaluate(() => window.__SHADY_TEST__!.demo('postcard'));
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/^shady-day\d+-\d{3,4}(am|pm)\.png$/);
    const png = readFileSync((await d.path())!);
    expect(png.length).toBeLessThan(1.2 * 1024 * 1024);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350]);
  });

  test('the map panel is one fixed 1000×720 frame whatever the screen shape (no dead band above the footer)', async ({ page }) => {
    await toPostcard(page);
    await expect(page.locator('.res-postcard-img')).toHaveAttribute('src', /^blob:/);
    // The panel's bottom edge (with its 8 px drop shadow): the lowest row above the text that is not paper.
    const bottom = await page.evaluate(async () => {
      const img = document.querySelector<HTMLImageElement>('.res-postcard-img')!;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const paper = [0xff, 0xf8, 0xee];
      for (let y = 800; y > 40; y--) {
        for (const x of [300, 540, 780]) {
          const d = g.getImageData(x, y, 1, 1).data;
          if (Math.abs(d[0]! - paper[0]!) + Math.abs(d[1]! - paper[1]!) + Math.abs(d[2]! - paper[2]!) > 12) return { y, size: [c.width, c.height] };
        }
      }
      return { y: -1, size: [c.width, c.height] };
    });
    expect(bottom.size).toEqual([1080, 1350]);
    expect(bottom.y).toBeGreaterThanOrEqual(758);
    expect(bottom.y).toBeLessThanOrEqual(769);
  });

  test('with a share sheet that takes files, the pill hands it one PNG and the text in the same task', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as Window & { shared?: { files: number; name: string; text: string } | null };
      w.shared = null;
      Object.defineProperty(navigator, 'canShare', { value: (d: ShareData) => Array.isArray(d.files) && d.files.length > 0, configurable: true });
      Object.defineProperty(navigator, 'share', {
        value: (d: ShareData) => {
          w.shared = { files: d.files?.length ?? 0, name: d.files?.[0]?.name ?? '', text: d.text ?? '' };
          return Promise.resolve();
        },
        configurable: true,
      });
    });
    await toPostcard(page);
    const shared = await page.evaluate(() => {
      window.__SHADY_TEST__!.demo('postcard');
      return (window as Window & { shared?: { files: number; name: string; text: string } | null }).shared;
    });
    expect(shared).not.toBeNull();
    expect(shared!.files).toBe(1);
    expect(shared!.name).toMatch(/\.png$/);
    expect(shared!.text).toContain('SHADY');
  });
});

test.describe('Daily par (GR15)', () => {
  test('Snowbot plays today\'s Daily on the Title and the par lands in the save', async ({ page }) => {
    await seedSave(page, { v: 1, createdAt: 1, stats: { runs: 5 } });
    await openGame(page);
    const today = await pageDate(page);
    await expect
      .poll(() => page.evaluate((d) => (JSON.parse(localStorage.getItem('shady.save') ?? '{}') as { pars?: Record<string, number> }).pars?.[d] ?? null, today), { timeout: 15_000 })
      .toBeGreaterThan(0);
  });
});
