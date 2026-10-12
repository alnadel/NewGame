// Render-side checks (gameRender): the render cadence (menus draw once, the settled Results draw at
// 20 fps with the puddle ring still pulsing), the world rect published for the DOM (K9), the Melt
// Map never drawing under the Results sheet (K10), camera shake and zoom that end (and never start
// under reduced motion), the lazily painted ground tiles, and the matched shadow composite (GR2).
import { expect, test, type Page } from '@playwright/test';
import { dayStartTick, dayTicks } from '../../src/core/index.ts';
import { drag, openGame, seedSave, waitForScreen, watchErrors } from './helpers.ts';

function center(page: Page): { x: number; y: number } {
  const v = page.viewportSize() ?? { width: 390, height: 844 };
  return { x: Math.round(v.width / 2), y: Math.round(v.height * 0.4) };
}

async function startPlay(page: Page): Promise<void> {
  const c = center(page);
  await drag(page, c.x, c.y, -40);
  await waitForScreen(page, 'play');
}

async function toResults(page: Page): Promise<void> {
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 5000);
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
  await openGame(page, `test=1&seed=${seed}&day=${day}&t=${hhmm}&perf=0`);
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

  test('thick teal for lasting shade, no gauge at full Chill, amber below 50', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'one DPR-2 run is enough');
    // Full Chill at the start: no gauge ring (and never the old blue one).
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
    // Chill 40: an amber gauge.
    await openGame(page, 'test=1&seed=42&day=1&t=9:00&perf=0&plan=0&chill=40');
    await page.mouse.click(195, 340);
    await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(0));
    await page.waitForTimeout(200);
    const low = await dialPixels(page);
    expect(low.amber).toBeGreaterThan(20);
    expect(low.blue).toBe(0);
    const n = await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen());
    await info.attach('dial-chill40', { body: await page.screenshot({ clip: { x: n.x - 110, y: n.y - 110, width: 220, height: 220 } }), contentType: 'image/png' });
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
      expect(ab!.mean, rows[rows.length - 1]).toBeLessThanOrEqual(1);
      expect(ab!.over3, rows[rows.length - 1]).toBeLessThanOrEqual(0.01);
      expect(ab!.max, rows[rows.length - 1]).toBeLessThanOrEqual(20);
    }
    await info.attach('shadow-ab', { body: rows.join('\n'), contentType: 'text/plain' });
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
