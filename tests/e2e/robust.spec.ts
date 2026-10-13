// The frame loop survives exceptions (frame-loop-dies-on-exception): one throwing frame is logged
// and the game plays on; a frame that keeps throwing ends in a visible crash overlay with Reload.
import { expect, test } from '@playwright/test';
import { drag, OPEN_SAVE, openGame, seedSave, state, waitForScreen } from './helpers.ts';

async function startPlay(page: import('@playwright/test').Page): Promise<void> {
  const v = page.viewportSize()!;
  await drag(page, Math.round(v.width / 2), Math.round(v.height * 0.4), -40);
  await waitForScreen(page, 'play');
}

test('one throwing frame is survived', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await seedSave(page, OPEN_SAVE);
  await openGame(page);
  await startPlay(page);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const fill = proto.fillRect;
    let thrown = false;
    proto.fillRect = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof fill>) {
      if (!thrown) {
        thrown = true;
        proto.fillRect = fill;
        throw new Error('injected fillRect failure');
      }
      return fill.apply(this, args);
    };
  });
  const m0 = (await state(page)).minutes;
  await page.waitForTimeout(2000);
  expect((await state(page)).minutes).toBeGreaterThan(m0);
  await expect(page.locator('#crash')).toHaveCount(0);
  // The failure was reported, not swallowed.
  expect(errors.some((e) => e.includes('injected fillRect failure'))).toBe(true);
});

test('a frame that keeps throwing shows the crash overlay', async ({ page }) => {
  // A letterboxed shape (still portrait), so every frame fills the bars with fillRect: on a
  // full-bleed phone view the ground is blitted from cached tiles and fillRect runs only now and then.
  await page.setViewportSize({ width: 412, height: 560 });
  await openGame(page);
  await startPlay(page);
  await page.evaluate(() => {
    CanvasRenderingContext2D.prototype.fillRect = () => {
      throw new Error('injected fillRect failure');
    };
  });
  const overlay = page.locator('#crash');
  await expect(overlay).toBeVisible({ timeout: 1000 });
  await expect(overlay).toHaveAttribute('role', 'alertdialog');
  await expect(overlay).toContainText('Something went wrong. Your progress is saved.');
  const reload = overlay.getByRole('button', { name: 'Reload' });
  const box = await reload.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await reload.click();
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'title', 10_000);
  await expect(page.locator('#crash')).toHaveCount(0);
});
