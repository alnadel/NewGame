// v1.5 core mechanics on the game side (docs/V1_5_PLAN.md): the Cold Snap input and the render-only
// demos of buds, a bloom, the full meter, a snap and deep shade. Controls v3 (docs/CONTROLS_V3.md
// §3.1, §12.2): the action button snaps (real touch through CDP: a still press on its disc, human
// timing), Down/S snap, and a swipe down never snaps and turns nothing. Input is measured where it is
// made (the test hook's mech().snaps counts the snap presses input accepted) and the cast in the sim.
import { expect, test, type Page } from '@playwright/test';
import { button, keepAlive, mech, playTouch, pressPts, state, strokePts, touchScreen, waitForScreen, watchErrors } from './helpers.ts';

/** Opens a level on its intro card and starts it past the start beat (`bot`: the oracle plays it). */
async function playLevel(page: Page, bot = true): Promise<{ cx: number; cy: number }> {
  await page.goto('/?level=12&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  if (bot) await keepAlive(page);
  const box = (await page.locator('canvas#game').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.45;
  // A key starts the run (Space on the intro card); the start beat ends before input may snap.
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.state().phase)).toBe('day');
  await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.state().drive.act), { timeout: 5_000 }).toBe('snap');
  return { cx, cy };
}

test('Down and S ask for a Cold Snap during play', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard: the desktop project');
  await playLevel(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('s');
  expect((await mech(page)).snaps).toBe(2);
});

test('the frost button: a still press on its disc casts a Cold Snap on a full meter (real touch)', async ({ page }) => {
  const errors = watchErrors(page);
  await playLevel(page, false);
  await page.evaluate(() => window.__SHADY_TEST__!.demo('snapReady'));
  await expect.poll(async () => (await state(page)).drive.state).toBe(1);
  const b = await button(page);
  expect(b.shown).toBe(true);
  const m = await mech(page);
  // The test hook's meter centre is the button's.
  expect([Math.round(m.meterX), Math.round(m.meterY)]).toEqual([Math.round(b.x), Math.round(b.y)]);
  const theta = (await state(page)).theta;
  const cdp = await touchScreen(page);
  // A 90 ms tap with 3 px of wobble.
  await playTouch(cdp, [{ id: 1, pts: pressPts(b.x, b.y, 90, 3) }]);
  await expect.poll(async () => (await mech(page)).snaps).toBe(1);
  await expect.poll(async () => (await mech(page)).snapLeft, { timeout: 5_000 }).toBeGreaterThan(0);
  // The press never turned the sun.
  expect(Math.abs((await state(page)).theta - theta)).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

test('a swipe down never snaps and turns nothing (real touch)', async ({ page }) => {
  const { cx, cy } = await playLevel(page, false);
  await page.evaluate(() => window.__SHADY_TEST__!.demo('snapReady'));
  const theta = (await state(page)).theta;
  const cdp = await touchScreen(page);
  // 140 px straight down in 150 ms: the old swipe-down Cold Snap.
  await playTouch(cdp, [{ id: 1, pts: strokePts(cx, cy, 0, 140, 150) }]);
  await page.waitForTimeout(300);
  expect((await mech(page)).snaps).toBe(0);
  expect((await mech(page)).snapLeft).toBe(0);
  expect(Math.abs((await state(page)).theta - theta)).toBeLessThan(0.01);
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
