// Controls v3 (docs/CONTROLS_V3.md §1, §3.1, §8, §12.2): the one drag and the one button, played with
// real touch through CDP (human timing, both projects): no coast; a start tap turns nothing; the first
// pointer wins; the button snaps on a long press and refuses a press it cannot take with its reason
// (the repeat carries +16); a drag that starts on the button turns the sun and acts nothing; ↑ and ↓
// snap; ?hand=left puts the button left; the 16 px side zone; the first-run lesson has no button and
// nothing moves the sun. Aim help's cases wait for CORE's magnet.
import { expect, test, type Page } from '@playwright/test';
import {
  acts,
  angleDiff,
  button,
  mech,
  openGame,
  playTouch,
  pressPts,
  seedSave,
  state,
  waitPlaying,
  strokePts,
  touchScreen,
  viewWidth,
  waitForScreen,
} from './helpers.ts';

/** Endless open, the first-run lesson passed. */
const SAVE = { v: 4, createdAt: 1, settings: { unlockAll: true }, stats: { runs: 6 }, flags: { tutorialDone: true } };

/** Opens an Endless run (standard rules, seed 42, `query` added) and walks it past its start beat. */
async function playEndless(page: Page, query = ''): Promise<void> {
  await seedSave(page, SAVE);
  await openGame(page, `test=1&seed=42&profile=3${query}`);
  await page.keyboard.press('ArrowUp');
  await waitForScreen(page, 'play');
  await waitPlaying(page);
  await expect.poll(async () => (await state(page)).drive.act).toBe('snap');
}

/** Opens Level 12 (the Cold Snap's level, its meter charging) past its start beat. */
async function playLevel12(page: Page): Promise<void> {
  await page.goto('/?level=12&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  await page.keyboard.press('Space');
  await waitPlaying(page);
  await expect.poll(async () => (await state(page)).drive.act).toBe('snap');
}

/** A point in the world's middle band (below Nubs, clear of the button and the edge zones). */
async function worldPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.locator('canvas#game').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.45 };
}

test('no coast: a fast 150 px stroke lifted moving leaves the sun at the finger\'s target, and it stays', async ({ page }) => {
  await playEndless(page, '&aim=off');
  const vw = await viewWidth(page);
  const p = await worldPoint(page);
  const th0 = (await state(page)).theta;
  const cdp = await touchScreen(page);
  await playTouch(cdp, [{ id: 1, pts: strokePts(p.x - 75, p.y, 150, 0, 120) }]);
  const want = th0 - (150 / vw) * 360;
  await expect.poll(async () => Math.abs(angleDiff((await state(page)).theta, want)), { timeout: 3_000 }).toBeLessThan(1);
  const th1 = (await state(page)).theta;
  await page.waitForTimeout(500);
  expect(Math.abs(angleDiff((await state(page)).theta, th1))).toBeLessThan(0.01);
  expect((await state(page)).sunMode).not.toBe('coasting');
});

test('a start tap with a 6 px wobble starts the run and turns nothing', async ({ page }) => {
  await seedSave(page, SAVE);
  await openGame(page, 'test=1&seed=42&profile=3');
  const th0 = (await state(page)).theta;
  const p = await worldPoint(page);
  const cdp = await touchScreen(page);
  await playTouch(cdp, [{ id: 1, pts: pressPts(p.x, p.y, 110, 6) }]);
  await waitForScreen(page, 'play');
  await expect.poll(async () => (await state(page)).phase, { timeout: 5_000 }).toBe('day');
  await page.waitForTimeout(300);
  expect(Math.abs(angleDiff((await state(page)).theta, th0))).toBeLessThan(0.01);
});

test('the first pointer wins: a second finger landing mid-drag turns nothing', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'two fingers: the mobile project');
  await playEndless(page, '&aim=off');
  const vw = await viewWidth(page);
  const p = await worldPoint(page);
  const th0 = (await state(page)).theta;
  const cdp = await touchScreen(page);
  // The thumb drags 80 px right over 400 ms; a second finger lands 150 ms in and drags 120 px left.
  await playTouch(cdp, [
    { id: 1, pts: strokePts(p.x - 40, p.y, 80, 0, 400) },
    { id: 2, pts: strokePts(p.x + 60, p.y + 60, -120, 0, 200, 150) },
  ]);
  const want = th0 - (80 / vw) * 360;
  await expect.poll(async () => Math.abs(angleDiff((await state(page)).theta, want)), { timeout: 3_000 }).toBeLessThan(1);
});

test('the button: a 500 ms press casts a Cold Snap; a press it cannot take is refused with its reason, the repeat with +16', async ({ page }) => {
  // Level 12 starts with a full meter (the Frost Bank's start charge).
  await playLevel12(page);
  await expect.poll(async () => (await state(page)).drive.state).toBe(1);
  const b = await button(page);
  expect(b.shown).toBe(true);
  const cdp = await touchScreen(page);
  // A 500 ms press commits at 120 ms and casts.
  const before = await acts(page);
  await playTouch(cdp, [{ id: 1, pts: pressPts(b.x, b.y, 500, 4) }]);
  expect(await acts(page)).toBe(before + 1);
  await expect.poll(async () => (await mech(page)).snapLeft, { timeout: 5_000 }).toBeGreaterThan(0);
  // Under the snap a press waits out the 300 ms buffer and is refused (busy: 7); the second in a row
  // is a repeat (+16): its chip still shows, silent.
  await playTouch(cdp, [{ id: 2, pts: pressPts(b.x, b.y, 100, 2) }]);
  await expect.poll(async () => (await state(page)).drive.refuseNote, { timeout: 3_000 }).toBe(7);
  await expect(page.locator('.cue')).toHaveText('The snap is on');
  await playTouch(cdp, [{ id: 3, pts: pressPts(b.x, b.y, 100, 2) }]);
  await expect.poll(async () => (await state(page)).drive.refuseNote, { timeout: 3_000 }).toBe(23);
  expect((await state(page)).drive.refuse).toBe(7);
});

test('a 100 px drag that starts on the button turns the sun 1:1 and acts nothing', async ({ page }) => {
  await playEndless(page, '&aim=off');
  await page.evaluate(() => window.__SHADY_TEST__!.demo('snapReady'));
  const vw = await viewWidth(page);
  const b = await button(page);
  const th0 = (await state(page)).theta;
  const a0 = await acts(page);
  const cdp = await touchScreen(page);
  await playTouch(cdp, [{ id: 1, pts: strokePts(b.x, b.y, -100, 0, 250) }]);
  const want = th0 + (100 / vw) * 360;
  await expect.poll(async () => Math.abs(angleDiff((await state(page)).theta, want)), { timeout: 3_000 }).toBeLessThan(1);
  expect(await acts(page)).toBe(a0);
  expect((await mech(page)).snaps).toBe(0);
});

test('↑ and ↓ ask for a Cold Snap', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard: the desktop project');
  await playEndless(page);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  expect((await mech(page)).snaps).toBe(2);
  expect(await acts(page)).toBe(2);
});

test('?hand=left puts the button left of centre, its hit disc inside the viewport', async ({ page }) => {
  await playEndless(page, '&hand=left');
  const b = await button(page);
  const vp = page.viewportSize()!;
  expect(b.side).toBe('left');
  expect(b.x).toBeLessThan(vp.width / 2);
  expect(b.x - b.r).toBeGreaterThanOrEqual(16);
  expect(b.y + b.r).toBeLessThanOrEqual(vp.height - 8);
});

test('the 16 px side zone: a press at x = 12 px is ignored, one at x = 20 px turns the sun', async ({ page }) => {
  await playEndless(page, '&aim=off');
  const p = await worldPoint(page);
  const cdp = await touchScreen(page);
  const th0 = (await state(page)).theta;
  await playTouch(cdp, [{ id: 1, pts: strokePts(12, p.y, 60, 0, 200) }]);
  await page.waitForTimeout(300);
  expect(Math.abs(angleDiff((await state(page)).theta, th0))).toBeLessThan(0.01);
  await playTouch(cdp, [{ id: 2, pts: strokePts(20, p.y, 60, 0, 200) }]);
  await expect.poll(async () => Math.abs(angleDiff((await state(page)).theta, th0)), { timeout: 3_000 }).toBeGreaterThan(10);
});

test('the first-run lesson (a fresh save) shows no button, and nothing moves the sun without a drag', async ({ page }) => {
  await openGame(page, 'test=1');
  const p = await worldPoint(page);
  const cdp = await touchScreen(page);
  // A fresh Title's press opens Level 1 on its card; the next starts its lesson.
  await playTouch(cdp, [{ id: 1, pts: pressPts(p.x, p.y, 90, 2) }]);
  await waitForScreen(page, 'play');
  await playTouch(cdp, [{ id: 2, pts: pressPts(p.x, p.y, 90, 2) }]);
  await expect.poll(async () => (await state(page)).lessonOn, { timeout: 5_000 }).toBe(true);
  const s = await state(page);
  expect([s.drive.act, (await button(page)).shown]).toEqual(['none', false]);
  const th0 = s.theta;
  await page.waitForTimeout(2_000);
  const t = await state(page);
  expect(t.lessonOn).toBe(true);
  expect(Math.abs(angleDiff(t.theta, th0))).toBeLessThan(0.01);
});

// Aim help (§4): CORE's magnet lands with controls3/core (C0c's settleTarget is NaN and the driver
// plans no glides, §11.9); these run once it is merged.
test.describe('aim help (needs the magnet from controls3/core)', () => {
  test.fixme(true, 'the C0c driver has no magnet yet (docs/CONTROLS_V3.md §11.9)');
  test('?aim=strong: a lift 8° outside a lasting arc settles inside it within 0.5 s, nothing moving in the first 200 ms', async ({ page }) => {
    await playEndless(page, '&aim=strong');
    const g = await page.evaluate(() => window.__SHADY_TEST__!.testGuide());
    expect(g.lasting.length).toBeGreaterThan(0);
    const vw = await viewWidth(page);
    const p = await worldPoint(page);
    const th0 = (await state(page)).theta;
    // Aim at 8° past the arc's first bin, away from it.
    const edge = g.lasting[0]! - 0.5;
    const target = edge - 8;
    const cdp = await touchScreen(page);
    await playTouch(cdp, [{ id: 1, pts: strokePts(p.x, p.y, (-angleDiff(target, th0) / 360) * vw, 0, 300) }]);
    const lifted = (await state(page)).theta;
    await page.waitForTimeout(200);
    expect(Math.abs(angleDiff((await state(page)).theta, lifted))).toBeLessThan(0.5);
    await expect.poll(async () => g.lasting.includes(Math.round((await state(page)).theta) % 360), { timeout: 1_000 }).toBe(true);
  });
  test('no glide 6 s after the last drag', async ({ page }) => {
    await playEndless(page, '&aim=strong');
    const p = await worldPoint(page);
    const cdp = await touchScreen(page);
    await playTouch(cdp, [{ id: 1, pts: strokePts(p.x, p.y, 30, 0, 200) }]);
    await page.waitForTimeout(6_000);
    const th = (await state(page)).theta;
    await page.waitForTimeout(1_500);
    expect(Math.abs(angleDiff((await state(page)).theta, th))).toBeLessThan(0.01);
    expect((await state(page)).drive.glide).toBeNull();
  });
});
