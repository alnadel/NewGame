// Elementals (docs/ELEMENTALS.md §4.10, §5.6): the Title's pill (under the logo, from a fresh save
// on) opens the Elementals screen, the roster and the Trial tiles show their lock states, a hero tap
// points Play at that hero's Trial, a tap on an open Trial plays it as a campaign run with its hero,
// its Results say "Trial 1", Retry keeps the Trial and "Trials" returns to the screen; the stored
// save keeps Trial stars apart from the Journey's; ?trial=6 walks Nubs with Ember beside him; ?hero=
// swaps a solo Trial's hero; every Trial's intro card says its whole sentence; the Pause card counts
// the goal and the Dare apart; the reactive bot passes Trial 1.
import { expect, test, type Page } from '@playwright/test';
import { openGame, runCfg, screen, seedSave, state, waitForScreen, watchErrors } from './helpers.ts';

/** Endless open (Level 3 passed), nothing played on the Elementals yet. */
function openSave(): object {
  const stars = Array<number>(200).fill(0);
  stars[0] = 3;
  stars[1] = 2;
  stars[2] = 1;
  return { v: 4, createdAt: 1, stats: { runs: 6, wallet: 40 }, campaign: { stars, unlocked: 4, lastLevel: 3 } };
}

async function openElementals(page: Page): Promise<void> {
  await page.locator('.scr-title .elementals-btn').click();
  await waitForScreen(page, 'elementals');
}

const stored = (page: Page): Promise<{ elementals?: { stars: number[]; seen: boolean }; campaign: { stars: number[] } }> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('shady.save') ?? '{}'));

test('the Title pill shows from a fresh save, under the logo with the heroes\' faces, and opens T1-T4', async ({ page }) => {
  await openGame(page);
  const btn = page.locator('.scr-title .title-top .elementals-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAccessibleName('Elementals');
  await expect(btn).toHaveClass(/is-new/);
  await expect(btn.locator('.el-tfaces canvas')).toHaveCount(4);
  await openElementals(page);
  for (const n of [1, 2, 3, 4]) await expect(page.locator(`.trial-tile[data-trial="${n}"]`)).not.toHaveClass(/is-locked/);
  await expect(page.locator('.trial-tile[data-trial="5"]')).toHaveClass(/is-locked/);
});

test('the Title pill: NEW until the screen is opened', async ({ page }) => {
  await seedSave(page, openSave());
  await openGame(page);
  const btn = page.locator('.scr-title .elementals-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveClass(/is-new/);
  await openElementals(page);
  await expect(page.locator('.elementals-stars')).toHaveText('0/24');
  expect((await stored(page)).elementals?.seen).toBe(true);
  // Back returns to the Title, the focus to the square; the sticker is gone.
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await expect(btn).not.toHaveClass(/is-new/);
});

test('lock states: T1-T4 open, T5-T8 locked; Nubs open, the others pass their intro', async ({ page }) => {
  await seedSave(page, openSave());
  await openGame(page);
  await openElementals(page);
  const tiles = page.locator('.scr-elementals .trial-tile');
  await expect(tiles).toHaveCount(8);
  for (const n of [1, 2, 3, 4]) await expect(tiles.nth(n - 1)).not.toHaveClass(/is-locked/);
  for (const n of [5, 6, 7, 8]) await expect(tiles.nth(n - 1)).toHaveClass(/is-locked/);
  await expect(page.locator('.trial-tile[data-trial="3"]')).toHaveAttribute('aria-label', 'Trial 3, Thunder Alley, Volt, not passed yet');
  await expect(page.locator('.trial-tile[data-trial="5"]')).toHaveAttribute('aria-label', 'Trial 5, Day Shift, Nubs, then Ember, then Nubs, locked: pass Kindling');
  await expect(page.locator('.trial-tile[data-trial="1"]')).toHaveClass(/is-next/);
  await expect(page.locator('.elementals-play')).toHaveText('Play T1 · Kindling');
  const heroes = page.locator('.scr-elementals .hero-tile');
  await expect(heroes).toHaveCount(5);
  await expect(page.locator('.hero-tile[data-hero="nubs"]')).not.toHaveClass(/is-locked/);
  await expect(page.locator('.hero-tile[data-hero="ember"]')).toHaveClass(/is-locked/);
  await expect(page.locator('.hero-tile[data-hero="ember"]')).toContainText('Pass T1');
  await expect(page.locator('.hero-tile[data-hero="ember"]')).toHaveAttribute('aria-label', 'Ember, locked: pass Kindling');
  // A locked Trial says what opens it.
  await page.locator('.trial-tile[data-trial="6"]').click({ force: true });
  await expect(page.locator('.toast').last()).toContainText('Pass Kindling first.');
  expect(await screen(page)).toBe('elementals');
  // Arrow keys walk the grid: right, then down two rows' worth.
  await page.locator('.trial-tile[data-trial="1"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.trial-tile[data-trial="2"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.trial-tile[data-trial="4"]')).toBeFocused();
  // Up from the grid's top row to the selected hero (T1's Ember), down from a hero to its first Trial.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.hero-tile[data-hero="ember"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.trial-tile[data-trial="5"]')).toBeFocused();
});

test('a hero tap points Play at that hero\'s next Trial', async ({ page }) => {
  await seedSave(page, { ...openSave(), elementals: { stars: [2, 0, 0, 0, 0, 0, 0, 0], seen: true } });
  await openGame(page);
  await openElementals(page);
  await expect(page.locator('.elementals-play')).toHaveText('Play T2 · Dappled Lane');
  await page.locator('.hero-tile[data-hero="ember"]').click();
  // Ember's first open Trial not passed yet: T5 (Nubs ▸ Ember ▸ Nubs); its tile is the selected one.
  await expect(page.locator('.elementals-play')).toHaveText('Play T5 · Day Shift');
  await expect(page.locator('.trial-tile[data-trial="5"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.trial-tile.is-selected')).toHaveClass(/is-hl/);
});

test('every Trial\'s intro card keeps its whole sentence, and the Pause card counts the goal and the Dare apart', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one project walks the sizes');
  test.slow();
  for (const [width, height] of [[1280, 800], [1280, 720], [390, 844], [360, 640]] as const) {
    await page.setViewportSize({ width, height });
    for (let n = 1; n <= 8; n++) {
      await page.goto(`/?trial=${n}&test=1`);
      await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
      await expect
        .poll(() => page.evaluate(() => { const c = window.__SHADY_TEST__!.levelCard(); return c && c.concept && c.blurb > 0 && c.blurb === c.lines; }), { message: `T${n} at ${width}x${height}` })
        .toBe(true);
    }
  }
  await page.goto('/?trial=3&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  const status = await page.evaluate(() => window.__SHADY_TEST__!.runStatus());
  expect(status!.goal).toMatch(/^Reach the finish · \d+ %$/);
  expect(status!.stars[1]).toEqual({ label: 'Chain x5 · 0/5', state: 'open' });
});

test('a tap on T1 plays Ember; the Results say Trial 1, Retry keeps it and Trials returns; the Journey is untouched', async ({ page }) => {
  const errors = watchErrors(page);
  await seedSave(page, { v: 4, createdAt: 1, settings: { unlockAll: true } });
  await openGame(page);
  await openElementals(page);
  await page.locator('.trial-tile[data-trial="1"]').click();
  await waitForScreen(page, 'play');
  expect((await runCfg(page)).mode).toBe('campaign');
  expect((await state(page)).level).toBe(1001);
  expect((await state(page)).hero).toBe('ember');
  expect((await state(page)).mate).toBeNull();
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);
  const verdict = await page.evaluate(() => window.__SHADY_TEST__!.campaign());
  expect(verdict?.id).toBe(1001);
  expect(verdict?.passed).toBe(false);
  await expect(page.locator('.res-sheet')).toContainText('Trial 1');
  // The fallen hero's recap tip.
  expect(await page.evaluate(() => window.__SHADY_TEST__!.resultsTip())).toBe('Shadows swing with you. Turn the sun so they fall away from the flame.');
  await page.getByRole('button', { name: /^Retry/ }).click();
  await expect.poll(async () => `${await screen(page)}:${(await state(page)).level}`, { timeout: 10_000 }).toBe('play:1001');
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);
  await expect(page.locator('.res-sheet').getByRole('button', { name: 'Map' })).toHaveCount(0);
  await page.locator('.res-sheet').getByRole('button', { name: 'Trials' }).click();
  await waitForScreen(page, 'elementals');
  await expect(page.locator('.trial-tile[data-trial="1"]')).toHaveClass(/is-next/);
  const save = await stored(page);
  expect(save.elementals?.stars).toHaveLength(8);
  expect(save.campaign.stars.every((n) => n === 0)).toBe(true);
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await expect(page.locator('.scr-title .play-pill')).toHaveText('Level 1');
  expect(errors).toEqual([]);
});

test('?trial=6 walks Nubs with Ember beside him; Back from its Results leads to the Elementals', async ({ page }) => {
  await page.goto('/?trial=6&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  const s = await state(page);
  expect(s.level).toBe(1006);
  expect(s.hero).toBe('nubs');
  expect(s.mate).toBe('ember');
  expect(s.meters).toHaveLength(2);
  expect((await runCfg(page)).hero).toBeNull();
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'elementals');
  await expect(page.locator('.trial-tile[data-trial="6"]')).toHaveClass(/is-next/);
});

test('?hero= swaps a solo Trial\'s hero (QA); a relay ignores it', async ({ page }) => {
  await page.goto('/?trial=3&hero=drip&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  expect((await state(page)).level).toBe(1003);
  expect((await state(page)).hero).toBe('drip');
  expect((await runCfg(page)).hero).toBe('drip');
  await page.goto('/?trial=5&hero=drip&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  expect((await state(page)).hero).toBe('nubs');
  expect((await state(page)).relay).toBe(0);
  expect((await runCfg(page)).hero).toBeNull();
});

test('?trial=1 with the reactive bot passes, and the pass is kept apart from the Journey', async ({ page }) => {
  test.slow();
  const errors = watchErrors(page);
  await page.goto('/?trial=1&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  await page.evaluate(() => {
    window.__SHADY_TEST__!.bot('reactive');
    window.__SHADY_TEST__!.setTimeScale(4);
  });
  await waitForScreen(page, 'results', 120_000);
  const verdict = await page.evaluate(() => window.__SHADY_TEST__!.campaign());
  expect(verdict?.id).toBe(1001);
  expect(verdict?.passed).toBe(true);
  await expect(page.locator('.res-sheet .res-ribbon')).toHaveText('Trial 1 Passed!');
  const save = await stored(page);
  expect(save.elementals?.stars[0]).toBe(verdict?.stars);
  expect(save.campaign.stars.every((n) => n === 0)).toBe(true);
  expect(errors).toEqual([]);
});
