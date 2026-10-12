// Two tabs of the game in one browser (save-clobbered-by-second-instance, multi-tab-save-lost-update):
// each tab adopts the save the other one writes, so neither overwrites the other's runs, purchases
// or Daily tries with an older copy. Pages that lose focus may pause (blur pause); forceDeath
// resumes a paused run, and bringToFront hands the focus over.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { keepAlive, state, waitForScreen } from './helpers.ts';

interface SavedStats {
  runs: number;
  bestMinutes: number;
}

async function openTab(context: BrowserContext, save: object | null, query = 'test=1'): Promise<Page> {
  const page = await context.newPage();
  if (save) {
    await page.addInitScript((raw) => {
      if (!localStorage.getItem('shady.save')) localStorage.setItem('shady.save', raw);
    }, JSON.stringify(save));
  }
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'title', 10_000);
  return page;
}

/**
 * One endless run in `page`: start it, let it live a little, melt Nubs, then Home. Returns its
 * minutes. Two game tabs share the CPU (one may be starved), so the oracle keeps Nubs alive from the
 * first tick (the run is still going when forceDeath ends it) and the screen waits are generous.
 */
async function playRun(page: Page, liveMs: number): Promise<number> {
  await page.bringToFront();
  await keepAlive(page);
  const v = page.viewportSize()!;
  await page.mouse.click(Math.round(v.width / 2), Math.round(v.height * 0.4));
  await waitForScreen(page, 'play', 15_000);
  await page.waitForTimeout(liveMs);
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);
  const minutes = (await state(page)).minutes;
  await page.locator('.res-sheet button[aria-label="Home"]').click();
  await waitForScreen(page, 'title', 15_000);
  return minutes;
}

async function saved(page: Page): Promise<{ stats: SavedStats; owned: string[]; daily: Record<string, { tries: number }> }> {
  const raw = await page.evaluate(() => JSON.parse(localStorage.getItem('shady.save') ?? '{}'));
  return { ...raw, owned: raw.unlocks?.cosmetics ?? [] };
}

test('runs from two tabs all count', async ({ context }) => {
  test.setTimeout(90_000);
  // Bests count from lifetime run 3 (UM3).
  const seed = { v: 1, createdAt: 1, stats: { runs: 3 } };
  const a = await openTab(context, seed);
  const b = await openTab(context, seed);
  const m1 = await playRun(b, 700);
  const m2 = await playRun(b, 1200);
  const m3 = await playRun(a, 400);
  const s = await saved(a);
  expect(s.stats.runs).toBe(6);
  expect(s.stats.bestMinutes).toBe(Math.max(m1, m2, m3));
});

test('a purchase in one tab survives a run finishing in the other', async ({ context }) => {
  const seed = { v: 1, createdAt: 1, stats: { runs: 3, wallet: 500 } };
  const a = await openTab(context, seed);
  const b = await openTab(context, seed);
  await b.bringToFront();
  await b.locator('.tray button[aria-label="Wardrobe"]').click();
  await waitForScreen(b, 'wardrobe');
  // Buy the first affordable item that isn't owned yet.
  const before = (await saved(b)).owned ?? [];
  const tiles = b.locator('.scr-wardrobe [data-id]');
  const n = await tiles.count();
  let bought: string | null = null;
  for (let i = 0; i < n && !bought; i++) {
    const id = await tiles.nth(i).getAttribute('data-id');
    if (!id || before.includes(id)) continue;
    await tiles.nth(i).click();
    const buy = b.locator('.scr-wardrobe').getByRole('button', { name: /^Buy/ });
    if ((await buy.count()) === 0 || !(await buy.first().isEnabled())) continue;
    await buy.first().click();
    await expect.poll(async () => (await saved(b)).owned ?? []).toContain(id);
    bought = id;
  }
  expect(bought).not.toBeNull();
  await playRun(a, 400);
  expect((await saved(a)).owned).toContain(bought);
  expect((await saved(a)).stats.runs).toBe(4);
});

test("a Daily try counted in one tab shows on the other's Daily screen", async ({ context }) => {
  test.setTimeout(90_000);
  const seed = { v: 1, createdAt: 1, stats: { runs: 3 } };
  const a = await openTab(context, seed);
  const b = await openTab(context, seed);
  await a.bringToFront();
  await a.locator('.tray button[aria-label^="Daily"]').click();
  await waitForScreen(a, 'daily');
  const aPlay = a.locator('.scr-daily').getByRole('button', { name: /^(Play|Practice)/ });
  await expect(aPlay).toContainText('try 1/3');

  await b.bringToFront();
  await b.locator('.tray button[aria-label^="Daily"]').click();
  await waitForScreen(b, 'daily');
  await b.locator('.scr-daily').getByRole('button', { name: /^(Play|Practice)/ }).click();
  await waitForScreen(b, 'play');
  await b.evaluate(() => window.__SHADY_TEST__!.bot('oracle'));
  const v = b.viewportSize()!;
  await b.mouse.click(Math.round(v.width / 2), Math.round(v.height * 0.4));
  await b.evaluate(() => window.__SHADY_TEST__!.setTimeScale(3));
  await expect.poll(async () => (await state(b)).minutes, { timeout: 20_000 }).toBeGreaterThanOrEqual(31);
  await b.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(b, 'results', 15_000);

  // No reload of A: its Daily screen picks up the try from B's save.
  await a.bringToFront();
  await expect(aPlay).toContainText('try 2/3');
});
