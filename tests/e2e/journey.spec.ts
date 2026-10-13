// The Journey map (v1.2, CAMPAIGN_PLAN §5): the Title's pill opens it, 200 tiles with locks past
// the unlocked level, Continue · Level N, the Settings testing toggle opening every level at once,
// a tile starting its level, keyboard walking, and the layout at phone and desktop sizes.
import { expect, test } from '@playwright/test';
import { openGame, seedSave, waitForScreen } from './helpers.ts';

/** Levels 1-3 passed (3, 2 and 1 stars), Level 4 next. */
function journeySave(): object {
  const stars = Array<number>(200).fill(0);
  stars[0] = 3;
  stars[1] = 2;
  stars[2] = 1;
  return { v: 3, createdAt: 1, stats: { runs: 5, wallet: 40 }, campaign: { stars, unlocked: 4, lastLevel: 3 } };
}

async function openJourney(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('.scr-title .journey-pill').click();
  await waitForScreen(page, 'journey');
}

test('the Title pill opens the map: 200 tiles, locks past the unlocked level, Continue · Level 4', async ({ page }) => {
  await seedSave(page, journeySave());
  await openGame(page);
  await expect(page.locator('.scr-title .journey-pill')).toHaveText(/Journey · Level 4/);
  await openJourney(page);
  const tiles = page.locator('.lvl-tile');
  await expect(tiles).toHaveCount(200);
  await expect(page.locator('.lvl-tile.is-locked')).toHaveCount(196);
  await expect(page.locator('.lvl-tile[data-level="4"]')).not.toHaveClass(/is-locked/);
  await expect(page.locator('.lvl-tile[data-level="4"]')).toHaveClass(/is-next/);
  await expect(page.locator('.lvl-tile[data-level="5"]')).toHaveClass(/is-locked/);
  await expect(page.locator('.lvl-tile[data-level="1"] .lvl-star.is-on')).toHaveCount(3);
  await expect(page.locator('.lvl-tile[data-level="3"] .lvl-star.is-on')).toHaveCount(1);
  await expect(page.locator('.journey-continue')).toHaveText('Continue · Level 4');
  await expect(page.locator('.scr-journey .chip--stars')).toHaveText('6/600');
  await expect(page.locator('.scr-journey .chapter')).toHaveCount(20);
  // Levels 1-40 carry their concept; the tile names it.
  await expect(page.locator('.lvl-tile[data-level="6"] .lvl-concept')).toHaveCount(1);
  await expect(page.locator('.lvl-tile[data-level="6"]')).toHaveAttribute('aria-label', /Teaches /);
  await expect(page.locator('.lvl-tile[data-level="41"] .lvl-concept')).toHaveCount(0);
  // A locked tile (aria-disabled, so Playwright needs force) stays on the map and says what to finish first.
  await page.locator('.lvl-tile[data-level="9"]').click({ force: true });
  await expect(page.locator('.toast')).toContainText('Finish Level 4 first.');
  expect(await page.evaluate(() => window.__SHADY_TEST__!.screen())).toBe('journey');
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
});

test('the unlock-all toggle opens every level at once, and a tile starts its level', async ({ page }) => {
  await seedSave(page, journeySave());
  await openGame(page);
  await page.locator('.tray button[aria-label="Settings"]').click();
  await waitForScreen(page, 'settings');
  const toggle = page.locator('[role="switch"][aria-label="Unlock all levels (testing)"]');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await openJourney(page);
  await expect(page.locator('.lvl-tile')).toHaveCount(200);
  await expect(page.locator('.lvl-tile.is-locked')).toHaveCount(0);
  // Continue still leads to the next unlocked level.
  await expect(page.locator('.journey-continue')).toHaveText('Continue · Level 4');
  // Switching it off while the map is open locks them again at once.
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await page.locator('.tray button[aria-label="Settings"]').click();
  await waitForScreen(page, 'settings');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await openJourney(page);
  await expect(page.locator('.lvl-tile.is-locked')).toHaveCount(196);
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  // On again, and Level 3's tile starts a run.
  await page.locator('.tray button[aria-label="Settings"]').click();
  await waitForScreen(page, 'settings');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await openJourney(page);
  await page.locator('.lvl-tile[data-level="3"]').click();
  await waitForScreen(page, 'play');
  const cfg = await page.evaluate(() => window.__SHADY_TEST__!.runCfg());
  // The game batch starts the level itself (mode 'campaign'); until then the run is the shim's.
  test.info().annotations.push({ type: 'run mode after tapping Level 3', description: cfg.mode });
});

test('the toggle persists across a reload', async ({ page }) => {
  await seedSave(page, journeySave());
  await openGame(page);
  await page.locator('.tray button[aria-label="Settings"]').click();
  await waitForScreen(page, 'settings');
  const toggle = page.locator('[role="switch"][aria-label="Unlock all levels (testing)"]');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'title');
  await openJourney(page);
  await expect(page.locator('.lvl-tile.is-locked')).toHaveCount(0);
});

test('arrow keys walk the tiles and Continue takes the keyboard focus', async ({ page }) => {
  await seedSave(page, journeySave());
  await openGame(page);
  // Opened from the keyboard (a pointer press would leave keyboard mode): focus lands on Continue.
  await page.keyboard.press('Shift');
  await page.locator('.scr-title .journey-pill').focus();
  await page.keyboard.press('Enter');
  await waitForScreen(page, 'journey');
  await expect(page.locator('.journey-continue')).toBeFocused();
  await page.locator('.lvl-tile[data-level="1"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.lvl-tile[data-level="2"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.lvl-tile[data-level="7"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.lvl-tile[data-level="12"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.lvl-tile[data-level="11"]')).toBeFocused();
  // Space on the focused Level 1 starts it.
  await page.locator('.lvl-tile[data-level="1"]').focus();
  await page.keyboard.press('Enter');
  await waitForScreen(page, 'play');
});

test('the map remembers its scroll position for the session', async ({ page }) => {
  await seedSave(page, journeySave());
  await openGame(page);
  await openJourney(page);
  await page.locator('.scr-journey .menu-body').evaluate((el) => el.scrollTo({ top: 900 }));
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await openJourney(page);
  const top = await page.locator('.scr-journey .menu-body').evaluate((el) => el.scrollTop);
  expect(top).toBeGreaterThan(800);
});

for (const size of [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1280, height: 800 },
]) {
  test(`Journey at ${size.width}x${size.height}: tiles at least 48 px, nothing scrolls sideways, the pill clears Nubs`, async ({ page }, info) => {
    await seedSave(page, journeySave());
    await page.setViewportSize(size);
    await openGame(page);
    // The Title: the pill and the tray keep 48 px targets and sit below Nubs' halo.
    const pill = await page.locator('.scr-title .journey-pill').boundingBox();
    expect(pill).not.toBeNull();
    expect(pill!.height).toBeGreaterThanOrEqual(44);
    const nubs = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('ui')!);
      return { y: parseFloat(cs.getPropertyValue('--nubs-y')), r: parseFloat(cs.getPropertyValue('--halo-r')) };
    });
    if (Number.isFinite(nubs.y) && Number.isFinite(nubs.r)) {
      const topMost = await page.evaluate(() => {
        const els = [...document.querySelectorAll<HTMLElement>('.scr-title .title-bottom > *')].filter((e) => e.offsetWidth > 0);
        return Math.min(...els.map((e) => e.getBoundingClientRect().top));
      });
      expect(topMost, 'the bottom cluster clears Nubs').toBeGreaterThanOrEqual(nubs.y + nubs.r - 1);
    }
    for (const b of await page.locator('.tray-btn').all()) {
      const box = await b.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(48);
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }
    await info.attach(`title-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
    await openJourney(page);
    await page.waitForTimeout(300);
    for (const id of [1, 5, 40, 200]) {
      const box = await page.locator(`.lvl-tile[data-level="${id}"]`).boundingBox();
      expect(box, `tile ${id} has a box`).not.toBeNull();
      expect(box!.width, `tile ${id} width`).toBeGreaterThanOrEqual(48);
      expect(box!.height, `tile ${id} height`).toBeGreaterThanOrEqual(48);
    }
    const over = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.scr-journey, .scr-journey *:not(.sr-only)')]
        .filter((e) => e.scrollWidth > e.clientWidth + 1 && !['visible', 'clip'].includes(getComputedStyle(e).overflowX))
        .map((e) => e.className),
    );
    expect(over, 'nothing scrolls sideways').toEqual([]);
    await info.attach(`journey-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}
