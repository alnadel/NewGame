// Layout checks (TECH_SPEC §16.3): at 360×640, 390×844 and 430×932 with a simulated 47 px notch,
// the pause button and the Results buttons sit inside the viewport and below the inset, and the
// Title's ghost hint and the Pause card stay clear of Nubs and his halo dial; a phone held
// landscape shows the rotate overlay. Screenshots are attached, not asserted.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { drag, openGame, waitForScreen } from './helpers.ts';

const SIZES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const INSET = 47;

async function simulateNotch(page: Page): Promise<void> {
  await page.evaluate((top) => {
    document.documentElement.style.setProperty('--safe-top', `${top}px`);
    window.dispatchEvent(new Event('resize'));
  }, INSET);
}

/** The overlay's bottom edge stays above the top of Nubs' halo dial (his ground point − ring radius). */
async function expectAboveNubs(page: Page, loc: Locator, label: string): Promise<void> {
  const box = await loc.boundingBox();
  expect(box, `${label} has a box`).not.toBeNull();
  if (!box) return;
  const nubs = await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen());
  const haloR = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('ui')!).getPropertyValue('--halo-r')));
  expect(haloR, 'halo radius published').toBeGreaterThan(20);
  expect(box.y + box.height, `${label} clears Nubs' halo`).toBeLessThanOrEqual(nubs.y - haloR);
}

async function expectInside(page: Page, loc: Locator, label: string): Promise<void> {
  const box = await loc.boundingBox();
  const vp = page.viewportSize();
  expect(box, `${label} has a box`).not.toBeNull();
  if (!box || !vp) return;
  expect(box.x, `${label} left`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label} below the inset`).toBeGreaterThanOrEqual(INSET);
  expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height, `${label} bottom`).toBeLessThanOrEqual(vp.height + 0.5);
}

for (const size of SIZES) {
  test(`layout ${size.width}x${size.height} with a 47 px notch`, async ({ page }, info) => {
    await page.setViewportSize(size);
    await openGame(page);
    await simulateNotch(page);
    await page.waitForTimeout(200);
    await info.attach(`title-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
    await expectAboveNubs(page, page.locator('.ghost-hand'), 'Title ghost hand');
    await expectAboveNubs(page, page.locator('.ghost-word'), 'Title "drag" word');

    await drag(page, Math.round(size.width / 2), Math.round(size.height * 0.4), -40);
    await waitForScreen(page, 'play');
    await page.waitForTimeout(800);
    await expectInside(page, page.locator('button[aria-label="Pause"]'), 'pause button');
    await info.attach(`play-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });

    await page.locator('button[aria-label="Pause"]').click();
    await waitForScreen(page, 'pause');
    await page.waitForTimeout(300);
    await expectAboveNubs(page, page.locator('.scr-pause .dialog'), 'Pause card');
    await info.attach(`pause-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('button', { name: 'Resume' }).click();
    await waitForScreen(page, 'play');

    await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
    await waitForScreen(page, 'results', 4000);
    await page.waitForTimeout(1600);
    await expectInside(page, page.locator('.res-retry'), 'retry');
    await expectInside(page, page.locator('.res-sheet button[aria-label="Share"]'), 'share');
    await expectInside(page, page.locator('.res-sheet button[aria-label="Home"]'), 'home');
    await info.attach(`results-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('rotate overlay in landscape on phones', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'touch devices only');
  await openGame(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.rotate.is-on')).toBeVisible();
  await info.attach('rotate', { body: await page.screenshot(), contentType: 'image/png' });
});
