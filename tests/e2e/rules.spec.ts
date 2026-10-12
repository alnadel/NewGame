// Run rules v1.1 (gameRender GR7): the comfort ladder and its debug overrides, the first-run lesson
// and its cues, wheel and keyboard turns, and the Title's Day Plan chip.
import { expect, test, type Page } from '@playwright/test';
import { openGame, seedSave, state, waitForScreen, watchErrors } from './helpers.ts';

/** Records every text the cue line shows (a MutationObserver installed before the page's scripts). */
async function recordCues(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cues: string[] };
    w.__cues = [];
    new MutationObserver(() => {
      const t = document.querySelector('.cue')?.textContent?.trim() ?? '';
      if (t && w.__cues[w.__cues.length - 1] !== t) w.__cues.push(t);
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

const cues = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __cues: string[] }).__cues);

test.describe('comfort ladder (A2)', () => {
  test('a save at rung 2 plays profile 3 at drain 44 with the noon cloud; comfort off plays the standard rules', async ({ browser }) => {
    for (const [comfort, want] of [
      [true, { profile: 3, drain: 44, noonCloud: 1, rung: 2 }],
      [false, { profile: 3, drain: 55, noonCloud: 0, rung: 4 }],
    ] as const) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await seedSave(page, { v: 2, createdAt: 1, settings: { comfort }, stats: { runs: 5, comfort: 2 } });
      await openGame(page);
      const s = await state(page);
      expect({ profile: s.profile, drain: s.drain, noonCloud: s.noonCloud, rung: s.rung }).toEqual(want);
      await ctx.close();
    }
  });

  test('?rung= forces a rung for endless runs', async ({ page }) => {
    await openGame(page, 'test=1&seed=42&rung=3');
    const s = await state(page);
    expect({ profile: s.profile, drain: s.drain, noonCloud: s.noonCloud, rung: s.rung }).toEqual({ profile: 3, drain: 50, noonCloud: 2, rung: 3 });
    await openGame(page, 'test=1&seed=42&rung=0');
    expect((await state(page)).profile).toBe(0);
  });
});

test.describe('first-run lesson (A5)', () => {
  test('a fresh first run cannot melt inside the lesson; the cues say keep shade, then drag', async ({ page }) => {
    const errors = watchErrors(page);
    await recordCues(page);
    await openGame(page, 'test=1&seed=5');
    const v = page.viewportSize()!;
    await page.mouse.click(Math.round(v.width / 2), Math.round(v.height * 0.4));
    await waitForScreen(page, 'play');
    await page.waitForTimeout(15_000);
    expect(await page.evaluate(() => window.__SHADY_TEST__!.screen())).toBe('play');
    const seen = await cues(page);
    expect(seen[0]).toMatch(/Keep Nubs in the shade/);
    expect(seen.some((t) => /Drag/.test(t))).toBe(true);
    expect(errors).toEqual([]);
  });

  test('a swing into shade passes it: the shade-found cue, normal time, and Chill can reach 0 again', async ({ page }) => {
    await recordCues(page);
    await openGame(page, 'test=1&seed=5');
    const v = page.viewportSize()!;
    const c = { x: Math.round(v.width / 2), y: Math.round(v.height * 0.4) };
    await page.mouse.click(c.x, c.y);
    await waitForScreen(page, 'play');
    const hint = (): Promise<{ mode: string; lesson: boolean }> => page.evaluate(() => window.__SHADY_TEST__!.hint());
    await expect.poll(async () => (await hint()).mode, { timeout: 10_000 }).toMatch(/^(left|right)$/);
    expect((await state(page)).lessonOn).toBe(true);
    const sgn = (await hint()).mode === 'left' ? -1 : 1;
    let x = sgn < 0 ? c.x + 150 : c.x - 150;
    await page.mouse.move(x, c.y);
    await page.mouse.down();
    // Drag the hinted way into full shade and hold the sun there (no release flick); if Nubs walks
    // out of that shade first, keep dragging.
    for (let i = 0; i < 200 && (await state(page)).lessonOn; i++) {
      if ((await state(page)).f > 0 && x > 30 && x < v.width - 30) {
        x += sgn * 3;
        await page.mouse.move(x, c.y);
      }
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).lessonOn, { timeout: 4000 }).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.timeScale()), { timeout: 3000 }).toBe(1);
    await expect.poll(() => cues(page)).toContainEqual(expect.stringMatching(/Shade!/));
    await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
    await waitForScreen(page, 'results', 5000);
  });
});

test.describe('wheel and keys (CC-6)', () => {
  test('a wheel event starts the run like a key; one notch then turns the sun 15°', async ({ page }) => {
    await openGame(page, 'test=1&seed=42');
    const wheel = (): Promise<void> => page.evaluate(() => void window.dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, cancelable: true })));
    await wheel();
    await waitForScreen(page, 'play');
    await page.waitForTimeout(400);
    const theta0 = (await state(page)).theta;
    await wheel();
    await page.waitForTimeout(400);
    let d = (await state(page)).theta - theta0;
    d -= Math.round(d / 360) * 360;
    expect(Math.abs(d + 15)).toBeLessThanOrEqual(1);
  });

  test('holding ArrowLeft for 1 s turns at least 250°', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard: the desktop project');
    await openGame(page, 'test=1&seed=42');
    await page.keyboard.down('ArrowLeft');
    await waitForScreen(page, 'play');
    // Unwrapped turn while the key is held (θ is sampled every frame).
    const turned = await page.evaluate(async () => {
      const hook = window.__SHADY_TEST__!;
      let last = hook.state().theta;
      let sum = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 1000) {
        await new Promise((r) => requestAnimationFrame(r));
        const th = hook.state().theta;
        let d = th - last;
        d -= Math.round(d / 360) * 360;
        sum += d;
        last = th;
      }
      return sum;
    });
    await page.keyboard.up('ArrowLeft');
    expect(turned).toBeGreaterThanOrEqual(250);
  });
});

test('the Title shows the forecast chip for a seed whose Day 1 is not clear', async ({ page }) => {
  // V11-SHIM: CC-3 — import { planDay } from '../../src/core/index.ts' (core's Day Plan).
  const core = (await import('../../src/core/index.ts')) as unknown as { planDay?: (seed: number, day: number) => { forecast: string } };
  const planDay = core.planDay;
  expect(planDay, 'core planDay').toBeDefined();
  let seed = 1;
  while (planDay!(seed, 1).forecast === 'clear') seed++;
  await seedSave(page, { v: 2, createdAt: 1, stats: { runs: 9, comfort: 4 } });
  await openGame(page, `test=1&seed=${seed}`);
  await expect(page.getByText(/Forecast:/)).toBeVisible();
});
