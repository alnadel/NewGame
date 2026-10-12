// v1.1 meta and UI checks (V1_1_PLAN UM2-UM10): challenge names and the warm-up note, Morning
// Snow once per date, the Sun Strip against the share strip, the Daily's forecast header, the cue
// line, and layouts of the Title, Results and the Journal at phone and desktop sizes (no overlaps,
// no sideways scroll). Screenshots are attached, not asserted.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { challengeCode, keepAlive, openGame, seedSave, waitForScreen } from './helpers.ts';

const SIZES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];
const SAM = challengeCode({ v: 1, k: 'e', seed: 42, m: 1240, s: 61, p: 3, dr: 55, nc: 0, pl: 1, n: 'Sam' });

/** 30 endless runs, the first 4 below the standard rung, and a best of Day 3. */
function richSave(): object {
  const history = Array.from({ length: 30 }, (_, i) => ({ m: 200 + ((i * 97) % 1300), s: 20, r: i < 4 ? i : 4, d: '2026-10-01' }));
  return {
    v: 2,
    createdAt: 1,
    stats: { runs: 34, bestMinutes: 1960, wallet: 230, comfort: 4, playSeconds: 4000, swings: 12 },
    history,
  };
}

async function canvasPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    for (const fy of [0.4, 0.45, 0.35, 0.5, 0.3]) {
      for (const fx of [0.5, 0.35, 0.65]) {
        const x = Math.round(innerWidth * fx);
        const y = Math.round(innerHeight * fy);
        if (document.elementFromPoint(x, y)?.id === 'game') return { x, y };
      }
    }
    throw new Error('no free canvas point');
  });
}

/** Starts the Title's run with a drag; the oracle keeps Nubs alive until the test ends it (helpers keepAlive). */
async function startRun(page: Page): Promise<void> {
  await keepAlive(page);
  const p = await canvasPoint(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x - 60, p.y, { steps: 8 });
  await page.mouse.up();
  await waitForScreen(page, 'play');
}

async function die(page: Page): Promise<void> {
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);
}

/** navigator.share records the text instead of opening a sheet. */
async function stubShare(page: Page): Promise<() => Promise<string | null>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: string | null };
    w.__shared = null;
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: ShareData) => {
        w.__shared = d.text ?? null;
      },
    });
  });
  return () => page.evaluate(() => (window as unknown as { __shared: string | null }).__shared);
}

async function noSidewaysScroll(page: Page, label: string): Promise<void> {
  // Screen-reader-only text is clipped to 1 px by design.
  const over = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.scr.is-on, .scr.is-on *:not(.sr-only)')]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && !['visible', 'clip'].includes(getComputedStyle(e).overflowX))
      .map((e) => e.className),
  );
  expect(over, `${label}: nothing scrolls sideways`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: no page scroll`).toBe(true);
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function visibleBox(loc: Locator): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return (await loc.isVisible()) ? loc.boundingBox() : null;
}

test.describe('challenges (UM2)', () => {
  test('the banner names the sender', async ({ page }) => {
    await seedSave(page, { v: 2, createdAt: 1, stats: { runs: 3 } });
    await openGame(page, `test=1#c=${SAM}`);
    await expect(page.locator('.challenge-from')).toHaveText('Sam challenges you:');
    await expect(page.locator('.challenge-from bdi')).toHaveText('Sam');
  });

  test('a fresh save plays a warm-up run first', async ({ page }) => {
    await openGame(page, `test=1#c=${SAM}`);
    await expect(page.locator('.challenge-note')).toHaveText('Warm-up run first');
  });
});

test('two runs on one date pay Morning Snow once (UM5)', async ({ page }) => {
  await seedSave(page, { v: 2, createdAt: 1, stats: { runs: 3 } });
  await openGame(page);
  await startRun(page);
  await die(page);
  await expect(page.locator('.res-awards')).toContainText('Morning Snow +15');
  await expect(page.locator('.res-retry')).toHaveAttribute('aria-disabled', 'false');
  await page.locator('.res-retry').click();
  await waitForScreen(page, 'play');
  await die(page);
  await page.waitForTimeout(400);
  await expect(page.locator('.res-awards')).not.toContainText('Morning Snow');
});

test.describe('the Sun Strip (UM8)', () => {
  test("its rows hold the share strip's hours", async ({ page }) => {
    const shared = await stubShare(page);
    await seedSave(page, { v: 2, createdAt: 1, stats: { runs: 3 } });
    await openGame(page);
    await startRun(page);
    await page.evaluate(() => {
      window.__SHADY_TEST__!.bot('oracle');
      window.__SHADY_TEST__!.setTimeScale(4);
    });
    await expect.poll(async () => (await page.evaluate(() => window.__SHADY_TEST__!.state())).minutes, { timeout: 20_000 }).toBeGreaterThanOrEqual(150);
    await die(page);
    const rows = page.locator('.strip-row');
    const n = await rows.count();
    expect(n).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < n; i++) expect(await rows.nth(i).locator('.st').count()).toBe(12);
    await page.locator('.res-sheet button[aria-label="Share"]').click();
    await expect.poll(shared).not.toBeNull();
    const strip = ((await shared()) as string).split('\n')[1] as string;
    const glyphs = [...strip.matchAll(/❄️|\u{1F7E8}|\u{1F525}|\u{1F4A7}/gu)].length;
    expect(await rows.last().locator('.st:not(.st--ghost)').count()).toBe(glyphs);
  });

  test('a run started on Day 3 labels its row Day 3', async ({ page }) => {
    await openGame(page, 'test=1&seed=42&day=3&t=15:00');
    await startRun(page);
    await die(page);
    await expect(page.locator('.strip')).toHaveAttribute('aria-label', /Day 3/);
  });
});

test('the Daily header names its forecast and place (UM9)', async ({ page }) => {
  await seedSave(page, { v: 2, createdAt: 1, stats: { runs: 3 } });
  await openGame(page);
  await page.locator('.tray button[aria-label^="Daily"]').click();
  await waitForScreen(page, 'daily');
  await expect(page.locator('.scr-daily .daily-plan')).toHaveText(/^\S+ (Clear|Breezy|Overcast|Heat Wave|Long Shadows|Dazzle|Market Day) · (Meadow|Old Town)$/u);
  await expect(page.locator('.scr-daily .daily-par')).toContainText('Snowbot');
});

test('the cue line is a polite live region (UM9)', async ({ page }) => {
  await openGame(page);
  await expect(page.locator('.cue')).toHaveCount(1);
  await expect(page.locator('.cue')).toHaveAttribute('aria-live', 'polite');
});

for (const size of SIZES) {
  test(`Title at ${size.width}x${size.height}: tagline, forecast, banner and chips apart (UM9)`, async ({ page }, info) => {
    await seedSave(page, richSave());
    await page.setViewportSize(size);
    await openGame(page, `test=1#c=${SAM}`);
    await expect(page.locator('.challenge')).toBeVisible();
    await page.waitForTimeout(400);
    const boxes = await Promise.all(['.tagline', '.forecast-chip', '.challenge', '.chips'].map((s) => visibleBox(page.locator(`.scr-title ${s}`))));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a && b) expect(intersects(a, b), `Title elements ${i} and ${j} overlap`).toBe(false);
      }
    }
    await noSidewaysScroll(page, 'Title');
    await info.attach(`title-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
  });

  test(`Journal at ${size.width}x${size.height}: 30 runs, no sideways scroll, back to the Title (UM10)`, async ({ page }, info) => {
    await seedSave(page, richSave());
    await page.setViewportSize(size);
    await openGame(page);
    await page.getByRole('button', { name: /^Journal, best/ }).click();
    await waitForScreen(page, 'journal');
    await expect(page.locator('.jbar')).toHaveCount(30);
    await expect(page.locator('.scr-journal .sr-only').first()).toHaveText(/^Last 30 runs\. Best: /);
    await noSidewaysScroll(page, 'Journal');
    await info.attach(`journal-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await waitForScreen(page, 'title');
  });
}

for (const width of [360, 390, 430]) {
  test(`Results at ${width} px wide: no sideways scroll (UM8)`, async ({ page }, info) => {
    await seedSave(page, richSave());
    await page.setViewportSize({ width, height: 800 });
    await openGame(page);
    await startRun(page);
    await die(page);
    await page.waitForTimeout(800);
    await noSidewaysScroll(page, 'Results');
    await info.attach(`results-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

// A run that completes a mission and unlocks things: the stamps and chips land without moving the
// score. Auto-scroll only moves the stats/missions list, only downward, and never the body that
// holds the score (one-scroll mode on short screens).
for (const size of [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`Results at ${size.width}x${size.height}: the score stays in the sheet while stamps and chips land (UM8)`, async ({ page }, info) => {
    await seedSave(page, { v: 2, createdAt: 1, settings: { name: 'Sam' }, stats: { runs: 12, comfort: 3, bestMinutes: 800, wallet: 300 } });
    await page.setViewportSize(size);
    await openGame(page, 'test=1&seed=20261014');
    await startRun(page);
    await page.evaluate(() => {
      window.__SHADY_TEST__!.bot('oracle');
      window.__SHADY_TEST__!.setTimeScale(4);
    });
    // Past 9:00 AM ('Reach 9:00 AM' completes), however slowly the page runs.
    await expect.poll(async () => (await page.evaluate(() => window.__SHADY_TEST__!.state())).minutes, { timeout: 30_000 }).toBeGreaterThanOrEqual(200);
    await page.evaluate(() => {
      window.__SHADY_TEST__!.setTimeScale(1);
      window.__SHADY_TEST__!.bot(null);
    });
    await die(page);
    const probe = (): Promise<{ score: number[]; sheet: number[]; body: number; list: number; stamped: number }> =>
      page.evaluate(() => {
        const r = (sel: string): number[] => {
          const b = document.querySelector(sel)!.getBoundingClientRect();
          return [b.top, b.bottom];
        };
        return {
          score: r('.scr-results .res-score'),
          sheet: r('.scr-results .res-sheet'),
          body: document.querySelector('.scr-results .res-body')!.scrollTop,
          list: document.querySelector('.scr-results .res-scroll')!.scrollTop,
          stamped: document.querySelectorAll('.scr-results .mrow.is-new').length,
        };
      });
    let lastList = 0;
    for (const ms of [600, 900, 1500, 1500]) {
      await page.waitForTimeout(ms);
      const p = await probe();
      expect(p.body, 'the body holding the score never scrolls').toBe(0);
      expect(p.list, 'the list only scrolls down').toBeGreaterThanOrEqual(lastList - 1);
      lastList = p.list;
      expect(p.score[0], 'score top inside the sheet').toBeGreaterThanOrEqual(p.sheet[0]! - 1);
      expect(p.score[1], 'score bottom inside the sheet').toBeLessThanOrEqual(p.sheet[1]! + 1);
    }
    expect((await probe()).stamped, 'a mission stamp landed').toBeGreaterThan(0);
    await info.attach(`results-stamps-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('Missions reach the Journal and come back (UM10)', async ({ page }) => {
  await seedSave(page, richSave());
  await openGame(page);
  await page.locator('.tray button[aria-label="Missions"]').click();
  await waitForScreen(page, 'missions');
  await expect(page.locator('.week-days li')).toHaveCount(7);
  await page.locator('.scr-missions').getByRole('button', { name: 'Journal' }).click();
  await waitForScreen(page, 'journal');
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'missions');
});
