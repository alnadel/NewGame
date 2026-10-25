// Layout checks (archive/TECH_SPEC §16.3): at 320×568, 360×640, 390×844 and 430×932 with a simulated 47 px
// notch, the pause button and the Results buttons sit inside the viewport and below the inset, and
// the Title's controls and the Pause card stay clear of Nubs and his halo dial; a phone held
// landscape shows the rotate overlay. Wave 3: on wide screens every control lies inside the world
// rect the game publishes (K9), short viewports keep Retry reachable, large text keeps the tray
// labels apart, a rich save's chips clear Nubs' halo, the challenge banner clears the chips, and
// a toast clears the menu header. Controls v3 (docs/CONTROLS_V3.md §1.1, §5.2, §12.2): the action
// button's hit disc lies inside the viewport and clear of the edge zones, either hand, and a point
// 340 u ahead of Nubs lies below the HUD band. Screenshots are attached, not asserted.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { button, challengeCode, drag, keepAlive, OPEN_SAVE, openGame, seedSave, waitForScreen, worldToScreen } from './helpers.ts';

const SIZES = [
  { width: 320, height: 568 },
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

/** The overlay's top edge sits below the bottom of Nubs' halo dial. */
async function expectBelowNubs(page: Page, loc: Locator, label: string): Promise<void> {
  const box = await loc.boundingBox();
  expect(box, `${label} has a box`).not.toBeNull();
  if (!box) return;
  const nubs = await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen());
  const haloR = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('ui')!).getPropertyValue('--halo-r')));
  expect(box.y, `${label} clears Nubs' halo`).toBeGreaterThanOrEqual(nubs.y + haloR);
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
    await seedSave(page, OPEN_SAVE);
    await openGame(page);
    await simulateNotch(page);
    await page.waitForTimeout(200);
    await info.attach(`title-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
    // The Title's controls sit below Nubs and his dial, inside the screen.
    await expectBelowNubs(page, page.locator('.scr-title .modes'), 'Title modes');
    await expectInside(page, page.locator('.scr-title .play-pill'), 'Play');
    await expectInside(page, page.locator('.tray button[aria-label="Settings"]'), 'Settings');

    await drag(page, Math.round(size.width / 2), Math.round(size.height * 0.55), -40);
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

// ---------------------------------------------------------------------------------------------
// Wave 3 (crossContracts: K9 world rect, short viewports, large text, rich save, challenge, K7)
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function boxOf(loc: Locator, label: string): Promise<Box> {
  const box = await loc.boundingBox();
  expect(box, `${label} has a box`).not.toBeNull();
  return box as Box;
}

async function worldRect(page: Page): Promise<{ left: number; width: number }> {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('ui')!);
    return { left: parseFloat(cs.getPropertyValue('--world-left')), width: parseFloat(cs.getPropertyValue('--world-width')) };
  });
}

async function expectInWorld(page: Page, loc: Locator, label: string): Promise<void> {
  const w = await worldRect(page);
  const b = await boxOf(loc, label);
  expect(b.x, `${label} left edge in the world rect`).toBeGreaterThanOrEqual(w.left - 0.5);
  expect(b.x + b.width, `${label} right edge in the world rect`).toBeLessThanOrEqual(w.left + w.width + 0.5);
}

async function expectInViewport(page: Page, loc: Locator, label: string): Promise<void> {
  const vp = page.viewportSize()!;
  const b = await boxOf(loc, label);
  expect(b.x, `${label} left`).toBeGreaterThanOrEqual(-0.5);
  expect(b.y, `${label} top`).toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width, `${label} right`).toBeLessThanOrEqual(vp.width + 0.5);
  expect(b.y + b.height, `${label} bottom`).toBeLessThanOrEqual(vp.height + 0.5);
}

async function startPlay(page: Page): Promise<void> {
  const vp = page.viewportSize()!;
  await drag(page, Math.round(vp.width / 2), Math.round(vp.height * 0.55), -40);
  await waitForScreen(page, 'play');
}

for (const size of [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
]) {
  test(`desktop column ${size.width}x${size.height}: controls inside the world rect`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop sizes');
    await page.setViewportSize(size);
    await openGame(page);
    await page.waitForTimeout(200);
    await expectInWorld(page, page.locator('.tray'), 'tray');
    await expectInWorld(page, page.locator('.chips'), 'title chips');
    await info.attach(`title-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });

    await page.locator('.tray button[aria-label="Settings"]').click();
    await waitForScreen(page, 'settings');
    await page.waitForTimeout(250);
    await expectInWorld(page, page.locator('.scr-settings .menu'), 'Settings content');
    await info.attach(`settings-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await waitForScreen(page, 'title');

    await startPlay(page);
    await expectInWorld(page, page.locator('button[aria-label="Pause"]'), 'pause button');
    await page.locator('button[aria-label="Pause"]').click();
    await waitForScreen(page, 'pause');
    await page.waitForTimeout(300);
    await expectInWorld(page, page.locator('.scr-pause .dialog'), 'Pause card');
    await info.attach(`pause-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('button', { name: 'Resume' }).click();
    await waitForScreen(page, 'play');

    await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
    await waitForScreen(page, 'results', 4000);
    await page.waitForTimeout(1600);
    await expectInWorld(page, page.locator('.res-sheet'), 'Results sheet');
    await info.attach(`results-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

for (const size of [
  { width: 640, height: 400 },
  { width: 911, height: 512 },
]) {
  test(`short viewport ${size.width}x${size.height}: Retry and the stats stay reachable`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'a landscape phone shows the rotate overlay instead');
    await page.setViewportSize(size);
    await openGame(page);
    await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
    await waitForScreen(page, 'results', 4000);
    await page.waitForTimeout(1600);
    await expectInViewport(page, page.getByRole('button', { name: /^Retry/ }), 'Retry');
    const roomy = await page.locator('.res-scroll').evaluate((el) => el.clientHeight >= 120);
    if (!roomy) {
      // A short sheet scrolls: the stats can be brought into view.
      await page.locator('.res-stats').scrollIntoViewIfNeeded();
      const stats = await boxOf(page.locator('.res-stats'), 'stats');
      const vp = page.viewportSize()!;
      expect(stats.y + Math.min(stats.height, 40), 'stats scrolled into view').toBeLessThanOrEqual(vp.height);
      expect(stats.y + stats.height, 'stats below the top').toBeGreaterThan(0);
    }
    await info.attach(`results-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

for (const pct of [150, 200]) {
  test(`large text ${pct}%: tray labels apart, Retry on screen`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((p) => {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${p}%`;
      });
    }, pct);
    await seedSave(page, OPEN_SAVE);
    await openGame(page);
    await page.waitForTimeout(300);
    const labels = page.locator('.tray-label');
    const n = await labels.count();
    const boxes: Box[] = [];
    for (let i = 0; i < n; i++) boxes.push(await boxOf(labels.nth(i), `tray label ${i}`));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) expect(intersects(boxes[i]!, boxes[j]!), `tray labels ${i} and ${j} overlap`).toBe(false);
    }
    await info.attach(`title-text-${pct}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
    await waitForScreen(page, 'results', 4000);
    await page.waitForTimeout(1600);
    await expectInViewport(page, page.getByRole('button', { name: /^Retry/ }), 'Retry');
    await info.attach(`results-text-${pct}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

// A menu title shrinks step by step, then ellipsizes from its first letter (UI_V2 §6.4): never a
// word clipped on both edges. The text size lands after boot here, so the titles must re-fit.
for (const pct of [150, 200]) {
  test(`large text ${pct}%: every menu title fits or ellipsizes from its first letter`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((p) => {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${p}%`;
      });
    }, pct);
    await seedSave(page, OPEN_SAVE);
    await openGame(page);
    const menus: [string, () => Promise<void>][] = [
      ['journey', () => page.locator('.scr-title .journey-pill').click()],
      ['missions', () => page.locator('.tray-btn', { hasText: 'Missions' }).click()],
      ['wardrobe', () => page.locator('.tray-btn', { hasText: 'Wardrobe' }).click()],
      ['settings', () => page.locator('.tray-btn', { hasText: 'Settings' }).click()],
      ['elementals', () => page.locator('.scr-title .elementals-btn').click()],
    ];
    for (const [id, open] of menus) {
      await open();
      await waitForScreen(page, id);
      await page.waitForTimeout(300);
      const band = await page.evaluate(() => {
        const el = document.querySelector('.scr.is-on .menu-ribbon .ribbon-band') as HTMLElement;
        const cs = getComputedStyle(el);
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return {
          fits: el.scrollWidth <= el.clientWidth + 1,
          ellipsis: cs.textOverflow === 'ellipsis' && cs.display === 'block' && cs.whiteSpace === 'nowrap',
          firstLetterIn: text.left >= box.left + parseFloat(cs.borderLeftWidth) - 1,
        };
      });
      expect(band.fits || band.ellipsis, `${id} title fits or ellipsizes`).toBe(true);
      expect(band.firstLetterIn, `${id} title starts at its first letter`).toBe(true);
      await page.getByRole('button', { name: 'Back' }).first().click();
      await waitForScreen(page, 'title');
    }
  });
}

// Elementals (docs/ELEMENTALS_V2.md §7.11): the Title's pill sits under the logo, whole and a real
// target, clear of Nubs' goal bubble and the modes (the top bar keeps the rank's name whole beside a
// waiting reward), and the screen's tiles are real targets (hero coins ≥ 64 px, Trial tiles ≥ 48 px)
// with no sideways scroll.
for (const size of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`Elementals at ${size.width}x${size.height}: the Title pill fits, tiles are targets, no sideways scroll`, async ({ page }, info) => {
    await page.setViewportSize(size);
    // Rank 1 with today's reward waiting: the tightest top bar.
    await seedSave(page, { v: 4, createdAt: 1, stats: { runs: 6, wallet: 40 }, campaign: { stars: [3, 2, 1], unlocked: 4 }, elementals2: { stars: [2, 0, 0, 0, 0, 0, 0], seen: true }, flags: { tutorialDone: true } });
    await openGame(page);
    await page.waitForTimeout(300);
    const hud = await page.evaluate(() => {
      const kids = [...document.querySelectorAll('.scr-title .title-hud > :not(.title-hud-gap)')].filter((e) => (e as HTMLElement).offsetWidth > 0);
      const boxes = kids.map((e) => e.getBoundingClientRect());
      const name = document.querySelector('.scr-title .rank-name') as HTMLElement;
      return {
        n: kids.length,
        apart: boxes.every((b, i) => i === 0 || b.left >= (boxes[i - 1] as DOMRect).right - 1),
        nameWhole: name.scrollWidth <= name.clientWidth + 1,
        right: Math.max(...boxes.map((b) => b.right)),
      };
    });
    expect(hud.n, 'rank, reward and wallet').toBe(3);
    expect(hud.apart, 'top bar items apart').toBe(true);
    expect(hud.nameWhole, "the rank's name shows whole").toBe(true);
    expect(hud.right).toBeLessThanOrEqual(size.width + 0.5);
    const pill = await page.evaluate(() => {
      const box = (q: string): DOMRect | null => {
        const e = document.querySelector(q) as HTMLElement | null;
        return e && e.offsetWidth > 0 ? e.getBoundingClientRect() : null;
      };
      const p = box('.scr-title .title-top .elementals-btn') as DOMRect;
      const label = document.querySelector('.scr-title .elementals-btn .btn-label') as HTMLElement;
      const goal = box('.scr-title .tagline-box.is-goal');
      return {
        h: p.height,
        left: p.left,
        right: p.right,
        bottom: p.bottom,
        whole: label.scrollWidth <= label.clientWidth + 1,
        // Nubs' goal bubble over him, or in the flow under the logo: never over the pill.
        apart: !goal || p.bottom <= goal.top || p.top >= goal.bottom,
        modesTop: (box('.scr-title .modes') as DOMRect).top,
      };
    });
    expect(pill.h, 'the pill is a target').toBeGreaterThanOrEqual(44);
    expect(pill.left).toBeGreaterThanOrEqual(0);
    expect(pill.right).toBeLessThanOrEqual(size.width);
    expect(pill.whole, 'its label shows whole').toBe(true);
    expect(pill.apart, "clear of Nubs' goal bubble").toBe(true);
    expect(pill.bottom, 'clear of the modes').toBeLessThan(pill.modesTop);
    await info.attach(`title-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.locator('.scr-title .elementals-btn').click();
    await waitForScreen(page, 'elementals');
    await page.waitForTimeout(400);
    const sizes = await page.evaluate(() => ({
      heroes: [...document.querySelectorAll('.scr-elementals .hero-tile > .candy')].map((e) => e.getBoundingClientRect()).map((b) => Math.min(b.width, b.height)),
      trials: [...document.querySelectorAll('.scr-elementals .trial-tile')].map((e) => e.getBoundingClientRect()).map((b) => Math.min(b.width, b.height)),
      wide: document.documentElement.scrollWidth - innerWidth,
      body: (() => {
        const b = document.querySelector('.scr-elementals .menu-body') as HTMLElement;
        return b.scrollWidth - b.clientWidth;
      })(),
    }));
    expect(sizes.heroes).toHaveLength(5);
    for (const d of sizes.heroes) expect(d, 'hero coin').toBeGreaterThanOrEqual(64);
    expect(sizes.trials).toHaveLength(7);
    for (const d of sizes.trials) expect(d, 'Trial tile').toBeGreaterThanOrEqual(48);
    expect(sizes.wide, 'no sideways page scroll').toBeLessThanOrEqual(0);
    expect(sizes.body, 'no sideways menu scroll').toBeLessThanOrEqual(0);
    await info.attach(`elementals-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

const RICH_SAVE = {
  v: 1,
  createdAt: 1,
  stats: { runs: 9, wallet: 500, bestMinutes: 1240 },
  missions: {
    cursor: 3,
    tier: 0,
    active: [
      { id: 'reach-9am', progress: 120, done: false },
      { id: 'flakes-10', progress: 4, done: false },
      { id: 'survive-noon', progress: 0, done: false },
    ],
  },
};

for (const size of [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
]) {
  test(`rich save at ${size.width}x${size.height}: the bottom cluster clears Nubs' halo`, async ({ page }, info) => {
    await seedSave(page, RICH_SAVE);
    await page.setViewportSize(size);
    await openGame(page);
    await page.waitForTimeout(300);
    // The cluster's top row is the chips; on a tiny screen the Title drops them (no-chips) so the
    // modes and the tray fit below the halo, and the modes are the top row then.
    const noChips = await page.locator('.title-bottom.no-chips').count();
    const topRow = await boxOf(page.locator(noChips ? '.scr-title .modes' : '.chips'), noChips ? 'modes' : 'chips');
    if (noChips) await expect(page.locator('.chips')).toBeHidden();
    else await expect(page.locator('.chips')).toBeVisible();
    const nubs = await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen());
    const haloR = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('ui')!).getPropertyValue('--halo-r')));
    expect(topRow.y, 'cluster top below Nubs + halo').toBeGreaterThanOrEqual(nubs.y + haloR);
    await info.attach(`rich-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

const CHALLENGE = challengeCode({ v: 1, k: 'e', seed: 42, m: 1240, s: 0 });

for (const size of [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`challenge banner at ${size.width}x${size.height} clears the chips`, async ({ page }, info) => {
    await page.setViewportSize(size);
    await openGame(page, `test=1#c=${CHALLENGE}`);
    await expect(page.locator('.challenge')).toBeVisible();
    await page.waitForTimeout(500);
    const banner = await boxOf(page.locator('.challenge'), 'banner');
    const goal = await boxOf(page.locator('.challenge-goal'), 'goal');
    const play = await boxOf(page.locator('.challenge').getByRole('button', { name: 'Play' }), 'banner Play');
    const cluster = page.locator('.scr-title .title-bottom > :visible:not(.title-gap)').first();
    expect(banner.y + banner.height, 'banner above the bottom cluster').toBeLessThanOrEqual((await boxOf(cluster, 'cluster top')).y);
    expect(intersects(goal, play), 'goal text under the Play button').toBe(false);
    await info.attach(`challenge-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('a Wardrobe toast clears the menu header', async ({ page }, info) => {
  await seedSave(page, { v: 1, createdAt: 1, stats: { runs: 3, wallet: 500 } });
  await page.setViewportSize({ width: 360, height: 640 });
  await openGame(page);
  await page.locator('.tray button[aria-label="Wardrobe"]').click();
  await waitForScreen(page, 'wardrobe');
  const tiles = page.locator('.scr-wardrobe [data-id]');
  const n = await tiles.count();
  let toasted = false;
  for (let i = 0; i < n && !toasted; i++) {
    await tiles.nth(i).click();
    const buy = page.locator('.scr-wardrobe').getByRole('button', { name: /^Buy/ });
    if ((await buy.count()) === 0 || !(await buy.first().isEnabled())) continue;
    await buy.first().click();
    toasted = true;
  }
  expect(toasted, 'something to buy').toBe(true);
  const toast = page.locator('.toast').first();
  await expect(toast).toBeVisible();
  const t = await boxOf(toast, 'toast');
  const back = await boxOf(page.locator('.scr-wardrobe .menu-back'), 'Back');
  const wallet = await boxOf(page.locator('.scr-wardrobe .menu-head .chip--snow'), 'wallet chip');
  expect(intersects(t, back), 'toast over Back').toBe(false);
  expect(intersects(t, wallet), 'toast over the wallet chip').toBe(false);
  await info.attach('wardrobe-toast', { body: await page.screenshot(), contentType: 'image/png' });
});

// The day ruler carries the day's progress, the noon boss, the recent-best flag and the next goal:
// it never drops, even on a forecast day with long Snow numbers on a narrow phone.
for (const size of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`HUD ${size.width}x${size.height}: a forecast day with 3- and 4-digit Snow keeps the day ruler`, async ({ page }, info) => {
    await page.setViewportSize(size);
    await seedSave(page, OPEN_SAVE);
    await openGame(page, 'test=1&seed=7&forecast=breezy&perf=0');
    await keepAlive(page);
    await page.mouse.click(Math.round(size.width / 2), Math.round(size.height * 0.55));
    await waitForScreen(page, 'play');
    expect((await page.evaluate(() => window.__SHADY_TEST__!.state())).forecast).toBe('breezy');
    for (const snow of [0, 999, 1234]) {
      await page.evaluate((n) => window.__SHADY_TEST__!.setSnow(n), snow);
      await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.hud()), { timeout: 3000 }).toMatchObject({ snow, left: true, ruler: true });
      const hud = await page.evaluate(() => window.__SHADY_TEST__!.hud());
      expect(hud.rulerW, `ruler width with Snow ${snow}`).toBeGreaterThanOrEqual(48);
    }
    await info.attach(`hud-${size.width}`, { body: await page.screenshot({ clip: { x: 0, y: 0, width: size.width, height: 64 } }), contentType: 'image/png' });
  });
}

// Controls v3 (§1.1, §5.2): the button's disc (hit radius 52k) clear of the 16 px side zones and the
// bottom band, on either side; Nubs rides high enough that the whole targeting range (340 u) shows
// below the HUD band (the top inset + 64 px).
for (const size of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1280, height: 720 },
]) {
  test(`Controls v3 at ${size.width}x${size.height}: the button inside the viewport and clear of the edge zones, both hands; 340 u ahead below the HUD`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'one project walks the sizes');
    await page.setViewportSize(size);
    for (const hand of ['right', 'left'] as const) {
      await page.goto(`/?level=12&test=1&hand=${hand}`);
      await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
      await waitForScreen(page, 'play');
      await keepAlive(page);
      await page.keyboard.press('Space');
      await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.state().drive.act), { timeout: 10_000 }).toBe('snap');
      await page.waitForTimeout(200);
      const b = await button(page);
      expect([b.shown, b.side]).toEqual([true, hand]);
      expect(b.x - b.r, `${hand} disc clear of the left zone`).toBeGreaterThanOrEqual(16);
      expect(b.x + b.r, `${hand} disc clear of the right zone`).toBeLessThanOrEqual(size.width - 16);
      expect(b.y + b.r, `${hand} disc above the bottom band`).toBeLessThanOrEqual(size.height - 8);
      expect(b.y - b.r, `${hand} disc on screen`).toBeGreaterThanOrEqual(0);
      const nubs = await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen());
      const a = await worldToScreen(page, 0, 0);
      const c = await worldToScreen(page, 0, 100);
      const perU = (a.y - c.y) / 100;
      const top = await page.evaluate(() => parseFloat(document.getElementById('ui')!.style.getPropertyValue('--world-top')) || 0);
      expect(nubs.y - 340 * perU, '340 u ahead below the HUD band').toBeGreaterThan(top + 64);
    }
  });
}
