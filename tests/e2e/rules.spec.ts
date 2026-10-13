// Run rules v1.1 (gameRender GR7): the comfort ladder and its debug overrides, the first-run lesson
// and its cues, wheel and keyboard turns, and the Title's Day Plan chip.
import { expect, test, type Page } from '@playwright/test';
import { planDay } from '../../src/core/index.ts';
import { keepAlive, OPEN_SAVE, openGame, seedSave, state, waitForScreen, watchErrors } from './helpers.ts';

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
  test('a save at rung 2 plays profile 2 at drain 38 with the noon cloud; comfort off plays the standard rules', async ({ browser }) => {
    for (const [comfort, want] of [
      [true, { profile: 2, drain: 38, noonCloud: 1, rung: 2 }],
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

  test('the first run at standard after R3 is the warm-up (drain 48, noon cloud); the next one is standard', async ({ page }) => {
    const r3 = { m: 450, s: 9, r: 3, d: '2026-10-12' };
    await seedSave(page, { v: 2, createdAt: 1, stats: { runs: 9, comfort: 4 }, history: [r3, r3] });
    await openGame(page, 'test=1&seed=42');
    let s = await state(page);
    expect({ profile: s.profile, drain: s.drain, noonCloud: s.noonCloud, rung: s.rung, warmup: s.warmup }).toEqual({ profile: 3, drain: 48, noonCloud: 1, rung: 4, warmup: true });
    await keepAlive(page);
    const v = page.viewportSize()!;
    await page.mouse.click(Math.round(v.width / 2), Math.round(v.height * 0.4));
    await waitForScreen(page, 'play');
    await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(4));
    await expect.poll(async () => (await state(page)).minutes, { timeout: 30_000 }).toBeGreaterThanOrEqual(310);
    await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
    await waitForScreen(page, 'results', 15_000);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('shady.save') ?? '{}'));
    expect(saved.history.at(-1)).toMatchObject({ r: 4, w: 1 });
    expect(saved.stats.comfort).toBe(4);
    await page.locator('.res-sheet button[aria-label="Home"]').click();
    await waitForScreen(page, 'title', 15_000);
    s = await state(page);
    expect({ drain: s.drain, noonCloud: s.noonCloud, rung: s.rung, warmup: s.warmup }).toEqual({ drain: 55, noonCloud: 0, rung: 4, warmup: false });
  });

  test('?rung= forces a rung for endless runs', async ({ page }) => {
    await openGame(page, 'test=1&seed=42&rung=3');
    const s = await state(page);
    expect({ profile: s.profile, drain: s.drain, noonCloud: s.noonCloud, rung: s.rung }).toEqual({ profile: 3, drain: 42, noonCloud: 1, rung: 3 });
    await openGame(page, 'test=1&seed=42&rung=0');
    expect((await state(page)).profile).toBe(0);
  });
});

test.describe('first-run lesson (A5)', () => {
  test('a fresh first run cannot melt inside the lesson; the cues say keep shade, then drag, always the hint\'s way', async ({ page }) => {
    const errors = watchErrors(page);
    await recordCues(page);
    await seedSave(page, OPEN_SAVE);
    await openGame(page, 'test=1&seed=5');
    const v = page.viewportSize()!;
    await page.mouse.click(Math.round(v.width / 2), Math.round(v.height * 0.4));
    await waitForScreen(page, 'play');
    // A passive player for 15 s: Nubs is lit, melts to the lesson's floor, drifts in and out of
    // shade and the hint changes sides. Each sample reads the cue line, the ghost hint and the sim in
    // one go (they are set in the same frame): an arrowed cue points the ghost's way, and
    // "Melting!" shows only while Nubs is lit with Chill low.
    const samples: { cue: string; mode: string; f: number; chill: number }[] = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 15_000) {
      samples.push(
        await page.evaluate(() => {
          const T = window.__SHADY_TEST__!;
          const el = document.querySelector('.cue');
          const s = T.state();
          return { cue: el?.classList.contains('is-on') ? (el.textContent ?? '') : '', mode: T.hint().mode, f: s.f, chill: s.chill };
        }),
      );
      await page.waitForTimeout(150);
    }
    expect(await page.evaluate(() => window.__SHADY_TEST__!.screen())).toBe('play');
    const arrowOf = (t: string): string | null => (t.includes('←') ? 'left' : t.includes('→') ? 'right' : null);
    const wrongWay = samples.filter((x) => arrowOf(x.cue) !== null && (x.mode === 'left' || x.mode === 'right') && arrowOf(x.cue) !== x.mode);
    expect(wrongWay).toEqual([]);
    expect(samples.filter((x) => x.cue.startsWith('Melting') && (x.f === 0 || x.chill >= 25))).toEqual([]);
    // The hint showed (and the cue followed) at least once.
    expect(samples.some((x) => arrowOf(x.cue) !== null && arrowOf(x.cue) === x.mode)).toBe(true);
    const seen = await cues(page);
    expect(seen[0]).toMatch(/Keep Nubs in the shade/);
    expect(seen.some((t) => /Drag/.test(t))).toBe(true);
    expect(errors).toEqual([]);
  });

  test('a swing into shade passes it: the shade-found cue, normal time, and a floor that fades', async ({ page }) => {
    await recordCues(page);
    await seedSave(page, OPEN_SAVE);
    await openGame(page, 'test=1&seed=5');
    const v = page.viewportSize()!;
    const c = { x: Math.round(v.width / 2), y: Math.round(v.height * 0.4) };
    await page.mouse.click(c.x, c.y);
    await waitForScreen(page, 'play');
    const hint = (): Promise<{ mode: string; lesson: boolean }> => page.evaluate(() => window.__SHADY_TEST__!.hint());
    await expect.poll(async () => (await hint()).mode, { timeout: 10_000 }).toMatch(/^(left|right)$/);
    expect((await state(page)).lessonOn).toBe(true);
    const sgn = (await hint()).mode === 'left' ? -1 : 1;
    // The drag is stepped by angle, not by poll: each move turns the sun 10° (Δθ = −dx/width·360°),
    // so a lit stretch turns well past A5's 15° however slowly the page answers. One state read
    // per step. Lit: drag on the hinted way. In shade: hold the sun there; a shade reached less than
    // 15° after Nubs was last lit can't pass the lesson (A5), so after 1.5 s in it, drag on. Out of
    // room at the edge: stop, lift (no flick) and take a new grip on the far side.
    const stepPx = Math.max(6, Math.round(v.width / 36));
    const x0 = sgn > 0 ? 40 : v.width - 40;
    let x = x0;
    await page.mouse.move(x, c.y);
    await page.mouse.down();
    let shadedSince = -1;
    const t0 = Date.now();
    while (Date.now() - t0 < 45_000) {
      const st = await state(page);
      if (!st.lessonOn) break;
      const now = Date.now();
      if (st.f > 0) shadedSince = -1;
      else if (shadedSince < 0) shadedSince = now;
      if (shadedSince < 0 || now - shadedSince > 1500) {
        if (sgn * (x + sgn * stepPx - x0) > v.width - 80) {
          await page.waitForTimeout(150);
          await page.mouse.up();
          x = x0;
          await page.mouse.move(x, c.y);
          await page.mouse.down();
        } else {
          x += sgn * stepPx;
          await page.mouse.move(x, c.y);
        }
        if (shadedSince >= 0) shadedSince = -1;
      }
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).lessonOn, { timeout: 4000 }).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.timeScale()), { timeout: 3000 }).toBe(1);
    await expect.poll(() => cues(page)).toContainEqual(expect.stringMatching(/Shade!/));
    await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
    await waitForScreen(page, 'results', 15_000);
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
  let seed = 1;
  while (planDay(seed, 1).forecast === 'clear') seed++;
  await seedSave(page, { v: 2, createdAt: 1, stats: { runs: 9, comfort: 4 } });
  await openGame(page, `test=1&seed=${seed}`);
  await expect(page.getByText(/Forecast:/)).toBeVisible();
});
