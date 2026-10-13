// v1.4 menus (docs/V1_4_PLAN.md §4 UX): the Title's top bar, NEW marks on features unlocked since
// this device last saw the Title (cleared once opened), the Journey's chapter banners with their
// Snow Globe, the Wardrobe's collection count, rarity and NEW marks, and the shorter Settings.
import { expect, test } from '@playwright/test';
import { openGame, seedSave, waitForScreen } from './helpers.ts';

/** Chapter 1 passed (all ten levels), Level 11 next; 120 Snow. */
function chapterSave(): object {
  const stars = Array<number>(200).fill(0);
  for (let i = 0; i < 10; i++) stars[i] = i < 5 ? 3 : 1;
  return { v: 3, createdAt: 1, stats: { runs: 12, wallet: 120 }, campaign: { stars, unlocked: 11, lastLevel: 10 } };
}

const FEATURES = ['endless', 'missions', 'wardrobe', 'daily', 'profile'];

/** Chapter 1 passed as a v4 save: every feature unlocked, only `seen` opened since; `items` seen in the Wardrobe. */
function seenSave(seen: string[], items: string[] = []): object {
  return { ...chapterSave(), v: 4, gamify: { xp: 500, features: FEATURES, seenFeatures: seen, seenItems: items } };
}

async function stored(page: import('@playwright/test').Page): Promise<{ gamify: { seenFeatures: string[]; seenItems: string[] } }> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('shady.save') ?? 'null'));
}

test('the Title top bar holds the wallet; a newly unlocked feature wears NEW until opened', async ({ page }) => {
  await seedSave(page, seenSave(['missions', 'daily', 'profile']));
  await openGame(page);
  await expect(page.locator('.scr-title .title-hud .chip--snow')).toHaveText('120');
  const wardrobe = page.locator('.tray button[aria-label="Wardrobe"]');
  await expect(wardrobe).toHaveClass(/is-new/);
  await expect(wardrobe).toHaveAttribute('aria-description', 'New');
  await expect(page.locator('.tray button[aria-label="Missions"]')).not.toHaveClass(/is-new/);
  await expect(page.locator('.scr-title .endless-pill')).toHaveClass(/is-new/);
  await wardrobe.click();
  await waitForScreen(page, 'wardrobe');
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await expect(wardrobe).not.toHaveClass(/is-new/);
  await expect(wardrobe).not.toHaveAttribute('aria-description', 'New');
  // The mark is kept in the save: a reload still knows the Wardrobe was opened.
  expect((await stored(page)).gamify.seenFeatures).toContain('wardrobe');
  await page.reload();
  await waitForScreen(page, 'title');
  await expect(wardrobe).not.toHaveClass(/is-new/);
  await expect(page.locator('.scr-title .endless-pill')).toHaveClass(/is-new/);
});

test('Wardrobe NEW marks stay while browsing and clear when it closes; the tray dot counts them', async ({ page }) => {
  await seedSave(page, seenSave(FEATURES));
  await openGame(page);
  const disc = page.locator('.tray button[aria-label="Wardrobe"] .tray-disc');
  await expect(disc).toHaveAttribute('data-dot', /^[1-9]/);
  await page.locator('.tray button[aria-label="Wardrobe"]').click();
  await waitForScreen(page, 'wardrobe');
  const marked = page.locator('.scr-wardrobe .tile.is-new');
  const n = await marked.count();
  expect(n).toBeGreaterThan(0);
  // Another tab and back: the marks are still there.
  await page.getByRole('tab', { name: 'Hat' }).click();
  await page.getByRole('tab', { name: 'Scarf' }).click();
  await expect(marked).toHaveCount(n);
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await expect(disc).not.toHaveAttribute('data-dot', /./);
  expect((await stored(page)).gamify.seenItems.length).toBeGreaterThan(0);
  await disc.click();
  await waitForScreen(page, 'wardrobe');
  await expect(page.locator('.scr-wardrobe .tile.is-new')).toHaveCount(0);
});

test('the first visit marks nothing new', async ({ page }) => {
  await seedSave(page, chapterSave());
  await openGame(page);
  await expect(page.locator('.scr-title .is-new')).toHaveCount(0);
});

test('chapter banners: a passed chapter has earned its Snow Globe', async ({ page }) => {
  await seedSave(page, chapterSave());
  await openGame(page);
  await page.locator('.scr-title .journey-pill').click();
  await waitForScreen(page, 'journey');
  const first = page.locator('.scr-journey .chapter[data-chapter="1"]');
  await expect(first).toHaveClass(/is-complete/);
  await expect(first).not.toHaveClass(/is-perfect/);
  await expect(first.locator('.chapter-prize')).toHaveAttribute('aria-label', 'Chapter complete: Snow Globe earned');
  await expect(first.locator('.chapter-name')).toHaveText('First Light');
  await expect(page.locator('.scr-journey .chapter.is-complete')).toHaveCount(1);
  await expect(page.locator('.scr-journey .chip--stars')).toHaveText('20/600');
});

test('the Wardrobe counts the collection and marks rarity', async ({ page }) => {
  await seedSave(page, chapterSave());
  await openGame(page);
  await page.locator('.tray button[aria-label="Wardrobe"]').click();
  await waitForScreen(page, 'wardrobe');
  await expect(page.locator('.scr-wardrobe .collection .num')).toHaveText(/^\d+\/\d+$/);
  await expect(page.locator('.scr-wardrobe [data-id="scarf-plaid"]')).toHaveAttribute('data-rarity', 'rare');
  await expect(page.locator('.scr-wardrobe [data-id="scarf-plaid"]')).toHaveAttribute('aria-label', /Rare/);
  await expect(page.locator('.scr-wardrobe .preview-name + .rarity')).toBeVisible();
});

test('Settings: the restore box opens on demand', async ({ page }) => {
  await openGame(page);
  await page.locator('.tray button[aria-label="Settings"]').click();
  await waitForScreen(page, 'settings');
  const box = page.getByRole('textbox', { name: 'Backup code to restore' });
  await expect(box).toBeHidden();
  await page.getByRole('button', { name: 'Restore from a code' }).click();
  await expect(box).toBeVisible();
  await expect(box).toBeFocused();
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
});

test("the Title's Reward claims the daily streak in place; the streak cards agree", async ({ page }) => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const p = (x: number): string => String(x).padStart(2, '0');
  const last = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  await seedSave(page, { ...(seenSave(FEATURES) as Record<string, any>), gamify: { xp: 500, features: FEATURES, seenFeatures: FEATURES, streak: { last, days: 2, best: 2 } } });
  await openGame(page);
  const reward = page.locator('.scr-title .title-reward');
  await expect(reward).toBeVisible();
  await reward.click();
  const rv = page.locator('.rv');
  await expect(rv.locator('.rv-name')).toHaveText(/Snow/);
  await expect(rv).toHaveClass(/is-open/, { timeout: 4000 });
  await page.getByRole('button', { name: 'Collect' }).click();
  await expect(rv).toHaveCount(0);
  expect(await page.evaluate(() => window.__SHADY_TEST__!.screen())).toBe('title');
  await expect(reward).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shady.save') ?? '{}').gamify.streak.days)).toBe(3);
  await page.locator('.tray button[aria-label="Missions"]').click();
  await waitForScreen(page, 'missions');
  const card = page.locator('.scr-missions .streak-card');
  await expect(card.locator('.streak-day.is-claimed')).toHaveCount(3);
  await expect(card.getByRole('button', { name: 'Claim' })).toBeHidden();
});
