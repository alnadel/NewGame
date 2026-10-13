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

/** This device has seen only Missions unlocked: the other open features are new. */
async function seenOnly(page: import('@playwright/test').Page, ids: string): Promise<void> {
  await page.addInitScript((v) => {
    if (!sessionStorage.getItem('shady.seen-seeded')) {
      localStorage.setItem('shady.ui.seen.features', v);
      sessionStorage.setItem('shady.seen-seeded', '1');
    }
  }, ids);
}

test('the Title top bar holds the wallet; a newly unlocked feature wears NEW until opened', async ({ page }) => {
  await seedSave(page, chapterSave());
  await seenOnly(page, 'missions');
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
  // The mark is kept per device: a reload still knows the Wardrobe was opened.
  await page.reload();
  await waitForScreen(page, 'title');
  await expect(wardrobe).not.toHaveClass(/is-new/);
  await expect(page.locator('.scr-title .endless-pill')).toHaveClass(/is-new/);
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
