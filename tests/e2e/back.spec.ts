// The app-wide history sentinel (V1_PLAN §8.2, android-back-exits-from-menus): Back on any screen
// but the Title does the screen's own back action and stays in the game; a modal closes first;
// play pauses and pause stays paused; on the Title with nothing open, Back leaves the game.
import { expect, test, type Page } from '@playwright/test';
import { drag, OPEN_SAVE, screen, seedSave, UNLOCKED_SAVE, waitForScreen } from './helpers.ts';

test.skip(({ isMobile }) => !isMobile, 'Android Back: the mobile project');

/** Opens about:blank, then the game (so a Back that leaves the game has somewhere to go). */
async function openFromBlank(page: Page, query = 'test=1&seed=42'): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'title', 10_000);
}

async function back(page: Page): Promise<void> {
  await page.goBack();
  await page.waitForTimeout(150);
}

async function expectStillInGame(page: Page): Promise<void> {
  expect(page.url()).toContain('test=1');
  await page.waitForTimeout(200);
  expect(page.url()).toContain('test=1');
}

for (const [label, trayLabel, id] of [
  ['Settings', 'Settings', 'settings'],
  ['Wardrobe', 'Wardrobe', 'wardrobe'],
  ['Missions', 'Missions', 'missions'],
  ['Daily', 'Daily', 'daily'],
] as const) {
  test(`Back from ${label} returns to the Title`, async ({ page }) => {
    await seedSave(page, UNLOCKED_SAVE);
    await openFromBlank(page);
    await page.locator(`.tray button[aria-label^="${trayLabel}"]`).click();
    await waitForScreen(page, id);
    await page.waitForTimeout(100);
    await back(page);
    await waitForScreen(page, 'title');
    await expectStillInGame(page);
  });
}

test('Back from Results goes Home', async ({ page }) => {
  await openFromBlank(page);
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);
  await page.waitForTimeout(200);
  await back(page);
  await waitForScreen(page, 'title');
  await expectStillInGame(page);
});

test('Back closes the reset confirmation first', async ({ page }) => {
  await openFromBlank(page);
  await page.locator('.tray button[aria-label="Settings"]').click();
  await waitForScreen(page, 'settings');
  await page.getByRole('button', { name: 'Reset progress' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(100);
  await back(page);
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await screen(page)).toBe('settings');
  await expectStillInGame(page);
  // And the next Back leaves Settings.
  await back(page);
  await waitForScreen(page, 'title');
  await expectStillInGame(page);
});

test('Back on the Title leaves the game', async ({ page }) => {
  await seedSave(page, OPEN_SAVE);
  await openFromBlank(page);
  // A trip through a menu leaves no stray history entry behind.
  await page.locator('.tray button[aria-label="Missions"]').click();
  await waitForScreen(page, 'missions');
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await page.waitForTimeout(800);
  await page.goBack();
  await expect.poll(() => page.url()).toBe('about:blank');
});

test('Back in play pauses; Back in pause stays paused', async ({ page }) => {
  await openFromBlank(page);
  const v = page.viewportSize()!;
  await drag(page, Math.round(v.width / 2), Math.round(v.height * 0.4), -40);
  await waitForScreen(page, 'play');
  await page.waitForTimeout(300);
  await back(page);
  await waitForScreen(page, 'pause');
  await back(page);
  await page.waitForTimeout(300);
  expect(await screen(page)).toBe('pause');
  await expectStillInGame(page);
});
