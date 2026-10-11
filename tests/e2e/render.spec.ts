// Render-side checks (wave 3, gameRender): the render cadence (menus draw once, the settled
// Results repaint only the puddle ring and match a full redraw), the world rect published for the
// DOM (K9), the Melt Map never drawing under the Results sheet (K10), camera shake and zoom that
// end (and never start under reduced motion), and the lazily painted ground tiles.
import { expect, test, type Page } from '@playwright/test';
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

const perf = (page: Page): Promise<{ draws: number; ringDraws: number; groundPaints: number }> =>
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

  test('settled Results repaint only the puddle ring, pixel-identical to a full redraw', async ({ page }) => {
    const errors = watchErrors(page);
    await openGame(page);
    await startPlay(page);
    await page.waitForTimeout(600);
    await toResults(page);
    await page.waitForTimeout(3000);
    const a = await perf(page);
    await page.waitForTimeout(1000);
    const b = await perf(page);
    // Every drawn frame of the second is a ring-only repaint.
    expect(b.draws - a.draws).toBeGreaterThan(10);
    expect(b.ringDraws - a.ringDraws).toBe(b.draws - a.draws);
    const ab = await page.evaluate(() => window.__SHADY_TEST__!.resultsAB());
    expect(ab).not.toBeNull();
    expect(ab!.ringPath).toBe(true);
    expect(ab!.diff).toBe(0);
    expect(errors).toEqual([]);
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
