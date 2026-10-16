// v1.6 on the game side (docs/V1_6_PLAN.md §4, §9 GAME): the render-only demos of every new layer
// (the ring round the badge, the Frost Bank's pips, the banked chip, the landing, deep, glass and
// flare layers, the parry, Noon Heat), the two-pip meter's tap, a level's Dare on its card, pill
// and Pause card, and the soft-fail's eased goal from the save. The rules themselves are CORE's;
// these hold whatever the sim does, because the demos stand in for its state while they last.
import { expect, test, type Page } from '@playwright/test';
import { TUNING } from '../../src/core/index.ts';
import { keepAlive, mech, OPEN_SAVE, seedSave, waitForScreen, watchErrors } from './helpers.ts';

const demo = (page: Page, name: string) => page.evaluate((n) => window.__SHADY_TEST__!.demo(n), name);

/** An endless run at profile 3 (a debug run: nothing is saved), the oracle playing, past its start beat. */
async function playEndless(page: Page): Promise<void> {
  await seedSave(page, OPEN_SAVE);
  await page.goto('/?test=1&seed=42&profile=3&t=08:30');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'title');
  await keepAlive(page);
  const box = (await page.locator('canvas#game').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
  await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.state().phase)).toBe('day');
  await page.waitForTimeout(1600);
}

test('the ring, the pips and the dial layers show their demos without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await playEndless(page);
  const m0 = await mech(page);
  expect(m0.pips).toBe(2);
  expect(m0.ring).toBe(true);
  await demo(page, 'ring');
  await expect.poll(async () => (await mech(page)).ringFill).toBeCloseTo(2 / 3, 2);
  await demo(page, 'bleed');
  await expect.poll(async () => (await mech(page)).bleed).toBe(true);
  await demo(page, 'pips');
  await expect.poll(async () => (await mech(page)).frost).toBeCloseTo(1.6, 5);
  for (const d of ['trick', 'spill', 'cash', 'landing']) await demo(page, d);
  await demo(page, 'bank');
  // The demo banks one bloom's frost under its snap (TUNING.bank.bloomH; CORE-1 set it to 25).
  await expect.poll(async () => (await mech(page)).bankH).toBe(TUNING.bank.bloomH);
  expect((await mech(page)).snapLeft).toBeGreaterThan(0);
  await page.waitForTimeout(3300);
  await demo(page, 'land');
  await expect.poll(async () => (await mech(page)).landBins).toBeGreaterThan(0);
  await demo(page, 'deepBand');
  await expect.poll(async () => (await mech(page)).deepBins).toBeGreaterThan(0);
  await demo(page, 'glass');
  await expect.poll(async () => (await mech(page)).glassBins).toBeGreaterThan(0);
  await demo(page, 'noonHeat');
  await expect.poll(async () => (await mech(page)).noonHeat).toBe(1.25);
  expect(errors).toEqual([]);
});

test('a Heat Flare counts down on the dial and a parry marks it on the ruler', async ({ page }) => {
  const errors = watchErrors(page);
  await playEndless(page);
  await demo(page, 'flare');
  await expect.poll(async () => (await mech(page)).flarePhase).toBe(1);
  const m1 = await mech(page);
  expect(m1.flareBins).toBeGreaterThan(0);
  await expect.poll(async () => (await mech(page)).flareLeft).toBeLessThan(m1.flareLeft);
  await demo(page, 'parry');
  await expect.poll(async () => (await mech(page)).flareOut).toEqual([1]);
  // The warning runs out into the rise and hold (the sun's white-hot ring), then it is over.
  await expect.poll(async () => (await mech(page)).flarePhase, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('a tap on the two-pip meter asks for a Cold Snap while a pip is full', async ({ page }) => {
  await playEndless(page);
  await demo(page, 'pips');
  await expect.poll(async () => (await mech(page)).frost).toBeCloseTo(1.6, 5);
  const m = await mech(page);
  const before = m.snaps;
  // The capsule round both pips takes the tap, the second pip's centre included.
  await page.mouse.click(m.meterX + 20, m.meterY);
  expect((await mech(page)).snaps).toBe(before + 1);
});

test("a level's Dare: on its card, counted on the Pause card", async ({ page }) => {
  await page.goto('/?level=12&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  await keepAlive(page);
  await demo(page, 'dare');
  const status = await page.evaluate(() => window.__SHADY_TEST__!.runStatus());
  expect(status!.stars[1]).toEqual({ label: 'Bloom 2 · 1/2', state: 'open' });
  const box = (await page.locator('canvas#game').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
  await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.state().phase)).toBe('day');
  // The HUD pill counts the Dare (the level's goal is the finish).
  await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.hud().snow)).toBe(1);
});

test('two missed goals ease a level to the finish, and its tip says so', async ({ page }) => {
  await seedSave(page, { v: 4, createdAt: 1, settings: { unlockAll: true }, campaign: { stars: [1], unlocked: 3, lastLevel: 2, misses: [0, 2] } });
  await page.goto('/?level=2&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  await keepAlive(page);
  const status = await page.evaluate(() => window.__SHADY_TEST__!.runStatus());
  expect(status!.goal).toMatch(/^Reach the finish · /);
  expect(status!.stars[0]!.label).toBe('Finish');
  const box = (await page.locator('canvas#game').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
  await expect
    .poll(() => page.evaluate(() => window.__SHADY_TEST__!.toasts().map((t) => t.text)), { timeout: 10_000 })
    .toContain('Goal eased: just reach the finish. The Dare still earns its star.');
});
