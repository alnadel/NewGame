// Keyboard affordances on desktop (keyboard-desktop-affordances): rotation keys aimed at a focused
// control stay with it, Escape from a menu returns focus to the tray button that opened it, and
// Enter on a Wardrobe tile keeps the focus on that tile.
import { expect, test } from '@playwright/test';
import { openGame, screen, seedSave, waitForScreen } from './helpers.ts';

test.skip(({ isMobile }) => isMobile, 'keyboard: the desktop project');

test('an arrow key on a focused tray button does not start a run', async ({ page }) => {
  await openGame(page);
  const missions = page.locator('.tray button[aria-label="Missions"]');
  // Tab until the Missions tray button has focus.
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    if (await missions.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(missions).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  expect(await screen(page)).toBe('title');
  expect(await page.evaluate(() => window.__SHADY_TEST__!.presses())).toBe(0);
});

test('an arrow key with nothing focused still starts a run', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down('ArrowRight');
  await waitForScreen(page, 'play');
  await page.keyboard.up('ArrowRight');
});

test('Escape from Missions returns focus to its tray button', async ({ page }) => {
  await openGame(page);
  const missions = page.locator('.tray button[aria-label="Missions"]');
  await missions.focus();
  await page.keyboard.press('Enter');
  await waitForScreen(page, 'missions');
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await expect(missions).toBeFocused();
});

test('Enter on a Wardrobe tile keeps the focus on that tile', async ({ page }) => {
  await seedSave(page, { v: 1, createdAt: 1, stats: { runs: 3, wallet: 500 } });
  await openGame(page);
  await page.locator('.tray button[aria-label="Wardrobe"]').click();
  await waitForScreen(page, 'wardrobe');
  const tile = page.locator('.scr-wardrobe [data-id]').nth(1);
  const id = await tile.getAttribute('data-id');
  await tile.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-id') ?? null)).toBe(id);
  expect(await screen(page)).toBe('wardrobe');
});

// Reduced motion only fades opacity, never the visibility of buttons: a keyboard player's focus lands
// on Pause's Resume and on Results' Retry with or without it.
for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`keyboard focus moves into Pause and Results (reduced motion: ${reducedMotion})`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion });
    const page = await ctx.newPage();
    await seedSave(page, { v: 2, createdAt: 1, stats: { runs: 5, comfort: 4 } });
    await openGame(page, 'test=1&seed=7&plan=0');
    await page.evaluate(() => window.__SHADY_TEST__!.bot('oracle'));
    await page.keyboard.press('Space');
    await waitForScreen(page, 'play');
    await page.keyboard.press('Escape');
    await waitForScreen(page, 'pause');
    await expect(page.locator('.scr-pause').getByRole('button', { name: 'Resume' })).toBeFocused();
    await page.keyboard.press('Escape');
    await waitForScreen(page, 'play');
    await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
    await waitForScreen(page, 'results', 15_000);
    await expect(page.locator('.res-retry')).toBeFocused();
    await ctx.close();
  });
}
