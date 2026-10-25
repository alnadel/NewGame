// v1.5 core mechanics on the game side (docs/V1_5_PLAN.md): the Cold Snap input (Down/S, a tap on
// the full frost meter) and the render-only demos of buds, a bloom,
// the full meter, a snap and deep shade. Input is measured where it is made (the test hook's
// mech().snaps counts the snaps input asked for), so these hold whatever the sim does with them.
import { expect, test, type Page } from '@playwright/test';
import { keepAlive, mech, waitForScreen, watchErrors } from './helpers.ts';

/** Opens a level on its intro card, hands the run to the oracle bot and starts it past the start beat. */
async function playLevel(page: Page): Promise<{ cx: number; cy: number }> {
  await page.goto('/?level=12&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  await keepAlive(page);
  const box = (await page.locator('canvas#game').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.45;
  // A stroke down on the intro card (the hold) starts the run but never snaps.
  await swipe(page, cx, cy, 0, 90, 90, 3);
  expect((await mech(page)).snaps).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.state().phase)).toBe('day');
  // The start beat (the sim's ready count) ends before input may snap.
  await page.waitForTimeout(1600);
  return { cx, cy };
}

/** A mouse stroke by (dx, dy) over `ms`. */
async function swipe(page: Page, x: number, y: number, dx: number, dy: number, ms: number, steps = 6): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
}

// Controls v3 C0a (docs/CONTROLS_V3.md §11.1): the swipe and the coin tap are gone; the button and
// the keys come back through the driver, and these cases are rewritten when UI lands (§12.2).
test.fixme('Down and S ask for a Cold Snap during play', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard: the desktop project');
  await playLevel(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('s');
  expect((await mech(page)).snaps).toBe(2);
});

test.fixme('the frost meter shows full and a tap on it asks for a Cold Snap', async ({ page }) => {
  await playLevel(page);
  await page.evaluate(() => window.__SHADY_TEST__!.demo('snapReady'));
  await expect.poll(async () => (await mech(page)).meter).toBe(true);
  const m = await mech(page);
  expect(m.frost).toBe(1);
  await page.mouse.click(m.meterX, m.meterY);
  expect((await mech(page)).snaps).toBe(1);
});

test('the mechanics demos stage their moments without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await playLevel(page);
  const demo = (name: string) => page.evaluate((n) => window.__SHADY_TEST__!.demo(n), name);
  await demo('bud');
  await expect.poll(async () => (await mech(page)).budBins).toBeGreaterThan(30);
  expect((await mech(page)).buds).toBeGreaterThan(0);
  await demo('bloom');
  await page.waitForTimeout(600);
  await demo('snap');
  await expect.poll(async () => (await mech(page)).snapLeft).toBeGreaterThan(0);
  expect((await mech(page)).snapId).toBeGreaterThanOrEqual(0);
  await demo('deep');
  await expect.poll(async () => (await mech(page)).deep).toBe(true);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
