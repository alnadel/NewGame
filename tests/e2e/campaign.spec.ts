// The campaign (Journey, v1.2, CAMPAIGN_PLAN §4): ?level= opens a level on its intro card and the
// first tap starts it with the level's concept; a bot run reaches the Results with stars and Next
// level starts the level after; a melted level retries without its card; the Eclipse level dims
// the world; the unlock-all setting makes every Journey tile playable (loosely, while the Journey
// screen is the UI batch's).
import { expect, test, type Page } from '@playwright/test';
import { screen, seedSave, state, waitForScreen, watchErrors } from './helpers.ts';

/** Opens the game with the test hook on a campaign level (it holds on its intro card, no Title). */
async function openLevel(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
}

/**
 * Mean brightness (0..255) of the world column (the --world-* vars; the whole canvas on a phone)
 * over a grid of points below the HUD band, so a desktop's margins outside the column don't count.
 */
async function worldBrightness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas#game') as HTMLCanvasElement;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const st = getComputedStyle(document.getElementById('ui') as HTMLElement);
    const px = (n: string): number => parseFloat(st.getPropertyValue(n)) || 0;
    const dpr = c.width / c.clientWidth;
    const left = px('--world-left');
    const top = px('--world-top');
    const w = px('--world-width') || c.clientWidth;
    const h = px('--world-height') || c.clientHeight;
    let sum = 0;
    let n = 0;
    for (let fy = 0.2; fy <= 0.9; fy += 0.1) {
      for (let fx = 0.1; fx <= 0.9; fx += 0.2) {
        const d = g.getImageData(Math.floor((left + w * fx) * dpr), Math.floor((top + h * fy) * dpr), 1, 1).data;
        sum += ((d[0] as number) + (d[1] as number) + (d[2] as number)) / 3;
        n++;
      }
    }
    return sum / n;
  });
}

/**
 * The brightest row of the world column's centre strip (60 CSS px wide, mean brightness), between
 * 10 % and 65 % of the column's height: only the intro card's paper reaches the high 230s there.
 */
async function cardBrightness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas#game') as HTMLCanvasElement;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const st = getComputedStyle(document.getElementById('ui') as HTMLElement);
    const px = (n: string): number => parseFloat(st.getPropertyValue(n)) || 0;
    const dpr = c.width / c.clientWidth;
    const left = px('--world-left');
    const top = px('--world-top');
    const w = px('--world-width') || c.clientWidth;
    const h = px('--world-height') || c.clientHeight;
    const x0 = Math.floor((left + w / 2 - 30) * dpr);
    const sw = Math.floor(60 * dpr);
    let best = 0;
    for (let fy = 0.1; fy <= 0.65; fy += 0.01) {
      const d = g.getImageData(x0, Math.floor((top + h * fy) * dpr), sw, 1).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += ((d[i] as number) + (d[i + 1] as number) + (d[i + 2] as number)) / 3;
      best = Math.max(best, sum / (d.length / 4));
    }
    return best;
  });
}

test.describe('campaign levels', () => {
  test('?level=6 holds on the intro card; the first tap starts play with the concept', async ({ page }) => {
    const errors = watchErrors(page);
    await openLevel(page, 'level=6&test=1');
    const held = await state(page);
    expect(held.phase).toBe('hold');
    expect(held.level).toBe(6);
    expect(held.mods).toContain('glare');
    expect(held.levelProgress).toBe(0);
    // The card is a pale sheet across the upper half of the world (after its slide-in).
    await page.waitForTimeout(700);
    await expect.poll(() => cardBrightness(page)).toBeGreaterThan(236);
    const v = page.viewportSize() ?? { width: 390, height: 844 };
    await page.mouse.click(Math.round(v.width / 2), Math.round(v.height * 0.6));
    await expect.poll(async () => (await state(page)).phase, { timeout: 10_000 }).toBe('day');
    expect((await state(page)).level).toBe(6);
    expect(errors).toEqual([]);
  });

  test('a bot run reaches the Results with stars, and Next level starts level 3', async ({ page }) => {
    test.slow();
    const errors = watchErrors(page);
    // The hook's oracle plays the held level (unlike ?bot=, no autoplay carries on past the
    // Results, so the test's own Next level is what starts level 3).
    await openLevel(page, 'level=2&fast=8&test=1');
    await page.evaluate(() => window.__SHADY_TEST__!.bot('oracle'));
    await waitForScreen(page, 'results', 180_000);
    const verdict = await page.evaluate(() => window.__SHADY_TEST__!.campaign());
    expect(verdict).not.toBeNull();
    expect(verdict!.id).toBe(2);
    expect(verdict!.passed).toBe(true);
    expect(verdict!.stars).toBeGreaterThanOrEqual(1);
    expect(verdict!.nextId).toBe(3);
    expect(verdict!.goalLine).toMatch(/^Collected \d+\/\d+ flakes$/);
    // Next level: the Results' primary button.
    await page.locator('.res-sheet .res-next').click();
    await expect
      .poll(async () => `${await screen(page)}:${(await state(page)).level}`, { timeout: 15_000 })
      .toBe('play:3');
    expect(errors).toEqual([]);
  });

  test('a melted level retries at once: Retry plays it again without its intro card', async ({ page }) => {
    const errors = watchErrors(page);
    await openLevel(page, 'level=4&test=1');
    await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
    await waitForScreen(page, 'results', 15_000);
    expect((await page.evaluate(() => window.__SHADY_TEST__!.campaign()))!.passed).toBe(false);
    await page.getByRole('button', { name: /^Retry/ }).click();
    // No card to tap through: the level is under way at once (its start beat, then the day).
    await expect.poll(async () => `${await screen(page)}:${(await state(page)).level}:${(await state(page)).phase}`, { timeout: 10_000 }).toBe('play:4:day');
    expect(errors).toEqual([]);
  });

  test('?level=36 shows the eclipse: the world dims while it lasts', async ({ page }) => {
    test.slow();
    const errors = watchErrors(page);
    // The hook's oracle plays the level at 2×: the 6 s eclipse at the midpoint then lasts 3 s of
    // real time, long enough to spot it and freeze inside it (at ?fast=8 it is over in 0.75 s and
    // the freeze can land after it). Read the world in the eclipse, then let it pass and read the
    // daylight of the second half; the sim state vouches for both samples.
    await openLevel(page, 'level=36&test=1');
    expect((await state(page)).mods).toContain('eclipse');
    await page.evaluate(() => {
      window.__SHADY_TEST__!.bot('oracle');
      window.__SHADY_TEST__!.setTimeScale(2);
    });
    await expect.poll(async () => (await state(page)).eclipse, { timeout: 120_000 }).toBeGreaterThanOrEqual(0.99);
    await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(0));
    await page.waitForTimeout(250);
    const dark = await worldBrightness(page);
    expect((await state(page)).eclipse).toBeGreaterThanOrEqual(0.99);
    await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(2));
    await expect.poll(async () => `${(await state(page)).phase}:${(await state(page)).eclipse}`, { timeout: 60_000 }).toBe('day:0');
    await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(0));
    await page.waitForTimeout(250);
    const day = await worldBrightness(page);
    const after = await state(page);
    expect(after.phase).toBe('day');
    expect(after.eclipse).toBe(0);
    // Lit ground is never that dark (Old Town's cobbles read darker than the Meadow's grass); the
    // eclipse takes the world to well under the daylight reading.
    expect(day).toBeGreaterThan(70);
    expect(dark).toBeLessThan(day * 0.6);
    expect(errors).toEqual([]);
  });

  test('the unlock-all setting makes every Journey tile playable', async ({ page }) => {
    // A v3 save: the testing toggle is not carried over from older saves (save.ts migration).
    await seedSave(page, { v: 3, createdAt: 1, stats: { runs: 3 }, settings: { unlockAll: true }, campaign: { stars: Array<number>(200).fill(0), unlocked: 1, lastLevel: 0 } });
    await page.goto('/?test=1');
    await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
    await waitForScreen(page, 'title');
    // The Journey entry: the Title's pill.
    const entry = page.locator('.scr-title .journey-pill');
    await entry.click();
    await waitForScreen(page, 'journey');
    const tiles = page.locator('.lvl-tile[data-level]');
    expect(await tiles.count()).toBe(200);
    expect(await page.locator('.lvl-tile.is-locked').count()).toBe(0);
  });
});
