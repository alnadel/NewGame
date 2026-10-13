// v1.4 gamification (docs/V1_4_PLAN.md): save v4 and XP from runs, the Profile, Snow Globes in the
// reward reveal (tap to skip, keyboard, reduced motion), the daily streak claim, and the testing
// bypass that opens every feature. Screenshots are attached, not asserted.
import { expect, test, type Page } from '@playwright/test';
import { keepAlive, openGame, seedSave, waitForScreen } from './helpers.ts';

const FEATURES = ['endless', 'missions', 'wardrobe', 'daily', 'profile'];

/** A v4 save past onboarding (the Title's best chip opens the Profile) with `gamify` fields over it. */
function v4(gamify: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): object {
  return {
    v: 4,
    createdAt: 1_700_000_000_000,
    stats: { runs: 12, bestMinutes: 900, wallet: 40, lifetimeSnow: 400 },
    history: Array.from({ length: 6 }, (_, i) => ({ m: 300 + i * 60, s: 10, r: 4, d: '2026-10-01' })),
    gamify: { xp: 500, features: FEATURES, seenFeatures: FEATURES, ...gamify },
    ...extra,
  };
}

async function stored(page: Page): Promise<{ v: number; gamify: Record<string, any>; stats: Record<string, number>; unlocks: { cosmetics: string[] } }> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('shady.save') ?? 'null'));
}

/** Yesterday's local date ('YYYY-MM-DD'; the browser shares this machine's time zone). */
function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Starts the Title's run with a drag on a free canvas point, the oracle keeping Nubs alive. */
async function startRun(page: Page): Promise<void> {
  await keepAlive(page);
  const p = await page.evaluate(() => {
    for (const fy of [0.4, 0.45, 0.35, 0.5, 0.3]) {
      for (const fx of [0.5, 0.35, 0.65]) {
        const x = Math.round(innerWidth * fx);
        const y = Math.round(innerHeight * fy);
        if (document.elementFromPoint(x, y)?.id === 'game') return { x, y };
      }
    }
    throw new Error('no free canvas point');
  });
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x - 60, p.y, { steps: 8 });
  await page.mouse.up();
  await waitForScreen(page, 'play');
}

/**
 * Clicks Open on the Profile's globes and, in the same task as the shake starts, acts on the
 * overlay (`act`), so a slow test machine can't let the 1.5 s animation finish first. Returns the
 * overlay's classes before and after.
 */
async function openAnd(page: Page, act: 'click' | 'Escape'): Promise<[string, string]> {
  return page.evaluate(async (how) => {
    (document.querySelector('.pf-open') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    const rv = document.querySelector('.rv') as HTMLElement;
    const before = rv.className;
    if (how === 'click') rv.click();
    // As a real key press: targeted at the focused element (or the body), bubbling to the window.
    else (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return [before, rv.className];
  }, act);
}

async function openProfile(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Profile, best/ }).click();
  await waitForScreen(page, 'profile');
}

test('a v3 save upgrades to v4 with its XP back-filled, and a run adds XP', async ({ page }) => {
  await seedSave(page, { v: 3, createdAt: 1, stats: { runs: 3, daysSurvived: 2 } });
  await openGame(page);
  await startRun(page);
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);
  // Written at the run's end: v4, every v1.3 feature kept, and the back-filled XP (10 per run,
  // 12 per night survived) plus at least the run's 10.
  await expect.poll(async () => (await stored(page))?.v).toBe(4);
  const s = await stored(page);
  expect(s.gamify.features).toEqual(FEATURES);
  expect(s.gamify.xp).toBeGreaterThanOrEqual(3 * 10 + 2 * 12 + 10);
  expect(s.stats.runs).toBe(4);
});

test.describe('the Profile', () => {
  for (const size of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    test(`shows the rank, road, trophies, collection and records at ${size.width}x${size.height}`, async ({ page }, info) => {
      await seedSave(page, v4({ globes: 1 }, { unlocks: { achievements: ['first-light', 'night-owl'] } }));
      await page.setViewportSize(size);
      await openGame(page);
      await openProfile(page);
      await expect(page.locator('.pf-hero .rank-name')).toHaveText('Flurry');
      await expect(page.locator('.pf-road li')).toHaveCount(6);
      await expect(page.locator('.scr-profile .badges li')).toHaveCount(6);
      await expect(page.locator('.scr-profile .badge.is-on')).toHaveCount(2);
      await page.getByRole('button', { name: /^Show all/ }).click();
      await expect(page.locator('.scr-profile .badges li')).toHaveCount(24);
      await expect(page.locator('.pf-globes')).toBeVisible();
      await expect(page.locator('.scr-profile .jbar')).toHaveCount(6);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      expect(wide).toBe(true);
      await info.attach(`profile-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
      // Opening it marked the trophies seen.
      await expect.poll(async () => (await stored(page)).gamify.seenTrophies).toBe(2);
      await page.keyboard.press('Escape');
      await waitForScreen(page, 'title');
    });
  }
});

test.describe('Snow Globes', () => {
  test('open in the reveal: the globe shakes, a tap skips to the prize, the item lands in the Wardrobe', async ({ page }, info) => {
    await seedSave(page, v4({ globes: 2 }));
    await openGame(page);
    await openProfile(page);
    const [before, after] = await openAnd(page, 'click');
    expect(before).toMatch(/is-shake/);
    expect(after).toMatch(/is-open/);
    expect(after).not.toMatch(/is-shake/);
    const rv = page.locator('.rv');
    await expect(rv.locator('.rv-kicker')).toHaveText('Snow Globe');
    await expect(rv.locator('.rv-count')).toHaveText('1 of 2');
    await expect(rv.locator('.rv-name')).not.toHaveText('');
    await info.attach('globe-open', { body: await page.screenshot(), contentType: 'image/png' });
    // Opened as it showed: saved at once.
    let s = await stored(page);
    expect([s.gamify.globes, s.gamify.opened]).toEqual([1, 1]);
    await rv.click();
    await expect(rv.locator('.rv-count')).toHaveText('2 of 2');
    await info.attach('globe-2', { body: await page.screenshot(), contentType: 'image/png' });
    // The animation finishes by itself too.
    await expect(rv).toHaveClass(/is-open/, { timeout: 4000 });
    await page.getByRole('button', { name: 'Collect' }).click();
    await expect(rv).toHaveCount(0);
    s = await stored(page);
    expect([s.gamify.globes, s.gamify.opened]).toEqual([0, 2]);
    expect(s.unlocks.cosmetics.length).toBe(6);
    await expect(page.locator('.pf-globes')).toBeHidden();
    expect(await page.evaluate(() => window.__SHADY_TEST__!.screen())).toBe('profile');
  });

  test('keyboard: Escape skips or dismisses, Enter moves on, and the screen under it stays', async ({ page }) => {
    await seedSave(page, v4({ globes: 2 }));
    await openGame(page);
    await openProfile(page);
    const [before, after] = await openAnd(page, 'Escape');
    expect(before).toMatch(/is-shake/);
    expect(after).toMatch(/is-open/);
    const rv = page.locator('.rv');
    await page.keyboard.press('Enter');
    await expect(rv.locator('.rv-count')).toHaveText('2 of 2');
    await expect(rv).toHaveClass(/is-open/, { timeout: 4000 });
    await page.keyboard.press('Escape');
    await expect(rv).toHaveCount(0);
    expect(await page.evaluate(() => window.__SHADY_TEST__!.screen())).toBe('profile');
  });

  test('reduced motion shows the prize at once', async ({ page }) => {
    await seedSave(page, v4({ globes: 1 }, { settings: { reducedMotion: 'on' } }));
    await openGame(page);
    await openProfile(page);
    await page.locator('.pf-open').click();
    await expect(page.locator('.rv')).toHaveClass(/is-open/);
    await expect(page.locator('.rv')).not.toHaveClass(/is-shake/);
  });
});

test('the daily streak: Day 7 claims a Snow Globe on Missions, once a day', async ({ page }, info) => {
  await seedSave(page, v4({ streak: { last: yesterday(), days: 6, best: 6, freezeUsed: false } }));
  await openGame(page);
  await page.locator('.tray button[aria-label="Missions"]').click();
  await waitForScreen(page, 'missions');
  const card = page.locator('.scr-missions .streak-card');
  await expect(card.locator('.streak-day')).toHaveCount(7);
  await expect(card.locator('.streak-day.is-claimed')).toHaveCount(6);
  await expect(card.locator('.streak-day.is-today')).toHaveCount(1);
  await info.attach('streak', { body: await page.screenshot(), contentType: 'image/png' });
  await card.getByRole('button', { name: 'Claim' }).click();
  const rv = page.locator('.rv');
  await expect(rv.locator('.rv-kicker')).toHaveText('Week streak!');
  await rv.click();
  await page.getByRole('button', { name: 'Collect' }).click();
  await expect(rv).toHaveCount(0);
  const s = await stored(page);
  expect(s.gamify.streak).toMatchObject({ days: 7, best: 7 });
  expect([s.gamify.globes, s.gamify.opened]).toEqual([0, 1]);
  await expect(card.getByRole('button', { name: 'Claim' })).toBeHidden();
  await expect(card.locator('.streak-day.is-claimed')).toHaveCount(7);
});

test('Settings > Unlock all levels (testing) opens every feature for a new player', async ({ page }) => {
  await openGame(page);
  await page.locator('.tray button[aria-label="Missions"]').click();
  await waitForScreen(page, 'missions');
  // A new player has no Profile yet: no Trophies link.
  await expect(page.locator('.scr-missions').getByRole('button', { name: 'Trophies' })).toBeHidden();
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await page.locator('.tray button[aria-label="Settings"]').click();
  await waitForScreen(page, 'settings');
  await page.locator('[role="switch"][aria-label="Unlock all levels (testing)"]').click();
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await page.locator('.tray button[aria-label="Missions"]').click();
  await waitForScreen(page, 'missions');
  await expect(page.locator('.scr-missions').getByRole('button', { name: 'Trophies' })).toBeVisible();
});

test('Results: the stars, then the XP meter settles, then the reveal, then the actions arm', async ({ page }) => {
  // 5 XP short of Rank 5, whose reward is a Snow Globe.
  await seedSave(page, v4({ xp: 695 }));
  await openGame(page);
  // Records, when the reveal appears, whether the meter had rolled over and finished filling.
  await page.evaluate(() => {
    const w = window as unknown as { revealSeen?: { rankup: boolean; count: string; retry: boolean } };
    new MutationObserver((_, obs) => {
      const rv = document.querySelector('.rv');
      if (!rv) return;
      const xp = document.querySelector('.scr-results .xp-meter') as HTMLElement;
      const retry = document.querySelector('.scr-results .res-retry') as HTMLButtonElement;
      w.revealSeen = { rankup: xp.classList.contains('is-rankup'), count: xp.querySelector('.xp-foot .num')?.textContent ?? '', retry: retry.getAttribute('aria-disabled') === 'true' || retry.disabled };
      obs.disconnect();
    }).observe(document.body, { childList: true, subtree: true });
  });
  await startRun(page);
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);
  const rv = page.locator('.rv');
  await expect(rv.locator('.rv-kicker')).toHaveText('Rank 5!', { timeout: 10_000 });
  const seen = await page.evaluate(() => (window as unknown as { revealSeen: { rankup: boolean; count: string; retry: boolean } }).revealSeen);
  expect(seen.rankup).toBe(true);
  expect(seen.retry).toBe(true);
  const xp = (await stored(page)).gamify.xp as number;
  expect(seen.count).toBe(`${xp - 700} / 300 XP`);
  await rv.click();
  await page.getByRole('button', { name: 'Collect' }).click();
  await expect(rv).toHaveCount(0);
  await expect(page.locator('.scr-results .res-retry')).toHaveClass(/is-ready/);
});
