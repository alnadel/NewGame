// Controls v3 (docs/CONTROLS_V3.md §1, §3.1, §8, §12.2): the one drag and the one button, played with
// real touch through CDP (human timing, both projects): no coast; a start tap turns nothing; the first
// pointer wins; the button snaps on a long press and refuses a press it cannot take with its reason
// (the repeat carries +16); a drag that starts on the button turns the sun and acts nothing; ↑ and ↓
// snap; ?hand=left puts the button left; the 16 px side zone; the first-run lesson has no button and
// nothing moves the sun; aim help settles a lit lift into lasting shade, never in the re-grip grace.
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

test('the button: a 500 ms hold acts nothing, a tap casts a Cold Snap; a press it cannot take is refused with its reason (busy, then charging), the repeat with +16', async ({ page }) => {
  // Level 12 starts with a full meter (the Frost Bank's start charge).
  await playLevel12(page);
  await expect.poll(async () => (await state(page)).drive.state).toBe(1);
  const b = await button(page);
  expect(b.shown).toBe(true);
  const cdp = await touchScreen(page);
  // A 500 ms hold is no tap: nothing. A 150 ms tap commits on its lift and casts.
  const before = await acts(page);
  await playTouch(cdp, [{ id: 9, pts: pressPts(b.x, b.y, 500, 4) }]);
  await page.waitForTimeout(200);
  expect(await acts(page)).toBe(before);
  expect((await mech(page)).snapLeft).toBe(0);
  await playTouch(cdp, [{ id: 1, pts: pressPts(b.x, b.y, 150, 4) }]);
  await expect.poll(() => acts(page)).toBe(before + 1);
  await expect.poll(async () => (await mech(page)).snapLeft, { timeout: 5_000 }).toBeGreaterThan(0);
  // Under the snap a press waits out the 300 ms buffer and is refused (busy: 7); the second in a row
  // is a repeat (+16): its chip still shows, silent.
  await playTouch(cdp, [{ id: 2, pts: pressPts(b.x, b.y, 100, 2) }]);
  await expect.poll(async () => (await state(page)).drive.refuseNote, { timeout: 3_000 }).toBe(7);
  await expect(page.locator('.cue')).toHaveText('The snap is on');
  await playTouch(cdp, [{ id: 3, pts: pressPts(b.x, b.y, 100, 2) }]);
  await expect.poll(async () => (await state(page)).drive.refuseNote, { timeout: 3_000 }).toBe(23);
  expect((await state(page)).drive.refuse).toBe(7);
  // The snap over (fast-forwarded), the meter charges: a press is refused for it (charging: 1), the
  // next with +16.
  await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(4));
  await expect.poll(async () => (await mech(page)).snapLeft, { timeout: 5_000 }).toBe(0);
  await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(1));
  await playTouch(cdp, [{ id: 4, pts: pressPts(b.x, b.y, 100, 2) }]);
  await expect.poll(async () => (await state(page)).drive.refuseNote, { timeout: 3_000 }).toBe(1);
  await expect(page.locator('.cue')).toContainText('Cold Snap charging');
  await playTouch(cdp, [{ id: 5, pts: pressPts(b.x, b.y, 100, 2) }]);
  await expect.poll(async () => (await state(page)).drive.refuseNote, { timeout: 3_000 }).toBe(17);
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

test("Level 1's lesson plays its ghost hand in slow time; reached with no drag it is not passed", async ({ page }) => {
  test.slow();
  await page.goto('/?test=1&level=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  const p = await worldPoint(page);
  const cdp = await touchScreen(page);
  await playTouch(cdp, [{ id: 1, pts: pressPts(p.x, p.y, 90, 2) }]);
  await waitPlaying(page);
  expect((await state(page)).lessonOn).toBe(true);
  // While Nubs is lit the ghost drags toward the shade and the game runs slow (§6.1: L1 like the first run).
  await expect.poll(async () => (await page.evaluate(() => window.__SHADY_TEST__!.hint())).mode, { timeout: 15_000 }).toMatch(/^(left|right)$/);
  await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.timeScale()), { timeout: 3_000 }).toBeLessThan(1);
  // Nobody drags: the lesson's floor keeps Nubs alive to the flag, and the level is not passed.
  await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(8));
  await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.campaign()), { timeout: 90_000, intervals: [500] }).not.toBeNull();
  const c = (await page.evaluate(() => window.__SHADY_TEST__!.campaign()))!;
  expect([c.passed, c.stars, c.goalLine]).toEqual([false, 0, 'Drag the sun to swing shade onto Nubs']);
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('shady.save') ?? '{}'));
  expect([save.campaign?.stars?.[0] ?? 0, save.flags?.tutorialDone]).toEqual([0, false]);
});

test('Level 1 passed shows the Elementals on the Title, whatever the lesson state', async ({ page }) => {
  const stars = Array.from({ length: 200 }, (_, i) => (i === 0 ? 1 : 0));
  await seedSave(page, { v: 4, createdAt: 1, settings: {}, stats: { runs: 3 }, flags: { tutorialDone: false }, campaign: { stars, unlocked: 2, lastLevel: 1 } });
  await openGame(page, 'test=1');
  await waitForScreen(page, 'title');
  await expect(page.locator('.elementals-btn')).toBeVisible();
});

// Aim help (§4): CORE's magnet.
test.describe('aim help', () => {
  test('?aim=strong: a lift 8° outside a lasting arc settles inside it within 0.5 s, nothing moving in the first 200 ms', async ({ page }) => {
    await playEndless(page, '&aim=strong');
    const vw = await viewWidth(page);
    const p = await worldPoint(page);
    const bin = (t: number): number => ((Math.round(t) % 360) + 360) % 360;
    // The morning's arcs drift and break up within a second as Nubs walks, so the sim stands still while
    // the target is chosen and the stroke is played, and the case starts again from where the sun is
    // when the world moved under the lift (an arc gone, or shade spread over it).
    for (let attempt = 1; ; attempt++) {
      await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(0));
      await page.waitForTimeout(100);
      const g = await page.evaluate(() => window.__SHADY_TEST__!.testGuide());
      const th0 = (await state(page)).theta;
      // Stop 8° short of the nearest lasting arc edge, moving toward it, on a lit bin: the glide then
      // carries on the stroke's way (one back against it waits againstTicks, 0.5 s, by design: §4.2),
      // and a lit sun is rescued at once (CORE's cut 2 left no rescue for shade that is ending: §16).
      let d = NaN;
      for (const b of g.lasting) {
        for (const dir of [1, -1]) {
          if (g.lasting.includes((b - dir + 360) % 360)) continue;
          const dd = angleDiff(b - dir * 8.5, th0);
          if (dd * dir >= 5 && !g.now.includes(bin(b - dir * 8.5)) && !(Math.abs(dd) >= Math.abs(d))) d = dd;
        }
      }
      expect(Number.isFinite(d)).toBe(true);
      const dx = (-d / 360) * vw;
      const cdp = await touchScreen(page);
      await playTouch(cdp, [{ id: 1, pts: strokePts(p.x - dx / 2, p.y, dx, 0, 300) }]);
      // An eighth of the speed from the lift on, so the hook's polling stays well inside the re-grip
      // grace (15 ticks, 2 s of real time here): the lift's own chase ends in about 5 ticks, then 300 ms
      // of real time is about 2 more.
      await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(0.125));
      await expect
        .poll(async () => { const s = await state(page); return s.sunMode === 'idle' && Math.abs(angleDiff(s.theta, th0)) > Math.abs(d) / 2; }, { timeout: 5_000, intervals: [16] })
        .toBe(true);
      const lifted = (await state(page)).theta;
      const at = await page.evaluate(() => window.__SHADY_TEST__!.testGuide());
      const ready = !at.now.includes(bin(lifted)) && at.lasting.some((b) => Math.abs(angleDiff(b, lifted)) <= 12);
      if (!ready && attempt < 4) continue;
      expect(ready).toBe(true);
      expect(Math.abs(angleDiff(lifted, th0 + d))).toBeLessThan(1);
      await page.waitForTimeout(300);
      expect(Math.abs(angleDiff((await state(page)).theta, lifted))).toBeLessThan(0.5);
      // Then it glides into the shade (8.5° to the arc's edge, plus the inset).
      await expect
        .poll(
          async () => {
            const th = (await state(page)).theta;
            const now = await page.evaluate(() => window.__SHADY_TEST__!.testGuide());
            return Math.abs(angleDiff(th, lifted)) >= 4 && now.lasting.includes(bin(th));
          },
          { timeout: 8_000, intervals: [50] },
        )
        .toBe(true);
      break;
    }
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
