// Smoke test of the real build (TECH_SPEC §16.3, CRITIQUE #2/#19): boot, Title, a drag starts
// play, death → Results → Retry, pause and visibility, the Daily screen, engine determinism, the
// edge-ignore zone, the Back trap, and audio unlocking on the first gesture.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { drag, openGame, screen, state, UNLOCKED_SAVE, waitForScreen, watchErrors } from './helpers.ts';

const golden = JSON.parse(readFileSync(new URL('../golden/hashes.json', import.meta.url), 'utf8')) as Record<string, unknown>;

function center(page: import('@playwright/test').Page): { x: number; y: number } {
  const v = page.viewportSize() ?? { width: 390, height: 844 };
  return { x: Math.round(v.width / 2), y: Math.round(v.height * 0.55) };
}

test.describe('smoke', () => {
  test('title renders and animates without errors', async ({ page }) => {
    const errors = watchErrors(page);
    await openGame(page);
    const box = await page.locator('canvas#game').boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(100);
    expect(box?.height ?? 0).toBeGreaterThan(100);
    expect(await screen(page)).toBe('title');
    await expect(page.locator('#boot')).toHaveCount(0);
    const a = await page.locator('canvas#game').screenshot();
    await page.waitForTimeout(300);
    const b = await page.locator('canvas#game').screenshot();
    expect(a.equals(b)).toBe(false);
    expect(errors).toEqual([]);
  });

  test('a drag starts play, minutes advance, audio unlocks', async ({ page }) => {
    const errors = watchErrors(page);
    await openGame(page);
    const c = center(page);
    await drag(page, c.x, c.y, -60);
    await waitForScreen(page, 'play');
    await page.waitForTimeout(1500);
    const s = await state(page);
    expect(s.phase).toBe('day');
    expect(s.minutes).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.audioState())).toBe('running');
    expect(errors).toEqual([]);
  });

  test('death shows Results with the death line; Retry plays again', async ({ page }) => {
    const errors = watchErrors(page);
    await openGame(page);
    const c = center(page);
    await drag(page, c.x, c.y, 40);
    await waitForScreen(page, 'play');
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
    await waitForScreen(page, 'results', 3000);
    await expect(page.locator('.res-sheet')).toContainText(/Melted by You|Glared by/);
    const retry = page.locator('.res-retry');
    await expect(retry).toBeEnabled();
    await retry.click();
    await waitForScreen(page, 'play');
    await page.waitForTimeout(600);
    const s = await state(page);
    expect(s.phase).toBe('day');
    expect(errors).toEqual([]);
  });

  test('pause button pauses; hiding the page keeps it paused', async ({ page }) => {
    await openGame(page);
    const c = center(page);
    await drag(page, c.x, c.y, 30);
    await waitForScreen(page, 'play');
    await page.locator('button[aria-label="Pause"]').click();
    await waitForScreen(page, 'pause');
    const before = (await state(page)).minutes;
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(600);
    expect(await screen(page)).toBe('pause');
    expect((await state(page)).minutes).toBe(before);
  });

  test('visibility hidden during play pauses and never auto-resumes', async ({ page }) => {
    await openGame(page);
    const c = center(page);
    await drag(page, c.x, c.y, 30);
    await waitForScreen(page, 'play');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitForScreen(page, 'pause');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    expect(await screen(page)).toBe('pause');
  });

  test('daily screen shows the number and try 1/3', async ({ page }) => {
    await page.addInitScript((save) => localStorage.setItem('shady.save', save), UNLOCKED_SAVE);
    await openGame(page);
    const expected = await page.evaluate(() => {
      const d = new Date();
      const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
      return Math.round((today - Date.UTC(2026, 0, 1)) / 86_400_000) + 1;
    });
    await page.locator('.tray button[aria-label^="Daily"]').click();
    await waitForScreen(page, 'daily');
    await expect(page.locator('.scr-daily .daily-num')).toHaveText(`#${expected}`);
    await expect(page.locator('.scr-daily .btn--primary')).toContainText('try 1/3');
  });

  test('browser determinism matches Node (golden headless hash)', async ({ page }) => {
    await openGame(page);
    const hash = await page.evaluate(() => window.__SHADY_TEST__!.runHeadless(7, 3600, 'reactive'));
    expect(hash).toBe(golden.headless_7_3600_reactive);
  });

  test('a drag starting at the screen edge is ignored', async ({ page }) => {
    await openGame(page);
    const c = center(page);
    await drag(page, 5, c.y, 120);
    await page.waitForTimeout(400);
    expect(await screen(page)).toBe('title');
    expect(await page.evaluate(() => window.__SHADY_TEST__!.presses())).toBe(0);
  });

  test('Back during play pauses (history trap)', async ({ page }) => {
    await openGame(page);
    const c = center(page);
    await drag(page, c.x, c.y, -30);
    await waitForScreen(page, 'play');
    await page.waitForTimeout(300);
    await page.evaluate(() => history.back());
    await waitForScreen(page, 'pause');
    // The trap re-arms: the page is still the game.
    expect(page.url()).toContain('test=1');
  });
});
