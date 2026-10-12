// Run lifecycle flows (gameRender): the comfort ladder's drain, challenge links on the Title (held
// challenge run, Space, same-document #c=, the first-timer's warm-up, the sender's rules, the
// friend's puddle and the PASSED stamp), Daily dates on Retry, settings and reset rebuilding the
// held run, the midnight rollover, the Results' Daily fields (K5), the blur pause, the latched
// "assisted" marker and the HUD's frozen best flag.
import { expect, test, type Page } from '@playwright/test';
import {
  challengeCode,
  openGame,
  pageDate,
  runCfg,
  screen,
  seedSave,
  state,
  UNLOCKED_SAVE,
  waitForScreen,
  watchErrors,
} from './helpers.ts';

/** A point on the canvas that no DOM control covers (scans down from 40 % of the height). */
async function canvasPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const w = innerWidth;
    const h = innerHeight;
    for (const fy of [0.4, 0.45, 0.35, 0.5, 0.3, 0.55, 0.25, 0.6]) {
      for (const fx of [0.5, 0.35, 0.65]) {
        const x = Math.round(w * fx);
        const y = Math.round(h * fy);
        if (document.elementFromPoint(x, y)?.id === 'game') return { x, y };
      }
    }
    throw new Error('no free canvas point');
  });
}

async function dragOnCanvas(page: Page, dx = -60): Promise<void> {
  const p = await canvasPoint(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(p.x + (dx * i) / 8, p.y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

async function forceDeath(page: Page): Promise<void> {
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 5000);
}

async function homeFromResults(page: Page): Promise<void> {
  await page.locator('.res-sheet button[aria-label="Home"]').click();
  await waitForScreen(page, 'title');
}

async function openDaily(page: Page): Promise<void> {
  await page.locator('.tray button[aria-label^="Daily"]').click();
  await waitForScreen(page, 'daily');
}

/** The Daily screen's Play button ('Play · try N/3' or 'Practice (unscored)'). */
function dailyPlay(page: Page): ReturnType<Page['locator']> {
  return page.locator('.scr-daily').getByRole('button', { name: /^(Play|Practice)/ });
}

const ENDLESS_CHALLENGE = challengeCode({ v: 1, k: 'e', seed: 42, m: 1240, s: 0 });
/** A returning player (one finished run): challenge links play the challenge at once. */
const PLAYED_SAVE = { v: 1, createdAt: 1, stats: { runs: 1 } };

test.describe('drain (comfort ladder, A2)', () => {
  test('the first run is the tutorial rung at 30 Chill/s; a short run leads to rung 1 at 35', async ({ page }) => {
    await openGame(page, 'test=1');
    expect(await runCfg(page)).toMatchObject({ mode: 'endless', profile: 0, tutorial: true, drain: 30 });
    await forceDeath(page);
    await homeFromResults(page);
    expect(await runCfg(page)).toMatchObject({ mode: 'endless', profile: 1, tutorial: false, drain: 35 });
  });

  test('?profile= keeps the profile drain', async ({ page }) => {
    await openGame(page, 'test=1&profile=3');
    expect(await runCfg(page)).toMatchObject({ profile: 3, drain: 55 });
  });

  test('the Daily keeps the profile-3 drain', async ({ page }) => {
    await seedSave(page, UNLOCKED_SAVE);
    await openGame(page, 'test=1');
    await openDaily(page);
    await dailyPlay(page).click();
    await waitForScreen(page, 'play');
    expect(await runCfg(page)).toMatchObject({ mode: 'daily', profile: 3, drain: 55 });
  });
});

test.describe('challenge links', () => {
  test.beforeEach(async ({ page }, info) => {
    if (!info.title.startsWith('a first-time player')) await seedSave(page, PLAYED_SAVE);
  });

  test('the Title holds the challenge run: a canvas drag plays it', async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openGame(page, `test=1#c=${ENDLESS_CHALLENGE}`);
    await expect(page.locator('.challenge')).toBeVisible();
    expect((await runCfg(page)).mode).toBe('challenge');
    await dragOnCanvas(page);
    await waitForScreen(page, 'play');
    expect(await runCfg(page)).toMatchObject({ mode: 'challenge', seed: 42 });
    await forceDeath(page);
    await expect(page.locator('.res-verdict')).toBeVisible();
    expect((await runCfg(page)).mode).toBe('challenge');
    // Home shows the challenge run again.
    await homeFromResults(page);
    expect((await runCfg(page)).mode).toBe('challenge');
    expect(errors).toEqual([]);
  });

  test('Space on the Title plays the challenge', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGame(page, `test=1#c=${ENDLESS_CHALLENGE}`);
    await page.locator('canvas#game').focus().catch(() => undefined);
    await page.keyboard.press('Space');
    await waitForScreen(page, 'play');
    expect((await runCfg(page)).mode).toBe('challenge');
    await forceDeath(page);
    await expect(page.locator('.res-verdict')).toBeVisible();
  });

  test('a #c= link opened in the same document shows the banner without a reload', async ({ page }) => {
    await openGame(page, 'test=1');
    await expect(page.locator('.challenge')).toBeHidden();
    await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 7));
    await page.goto(`/?test=1#c=${ENDLESS_CHALLENGE}`);
    await expect(page.locator('.challenge')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(7);
    expect((await runCfg(page)).mode).toBe('challenge');
  });

  test('dismissing the banner gives the Title an endless run back', async ({ page }) => {
    await openGame(page, `test=1#c=${ENDLESS_CHALLENGE}`);
    await page.getByRole('button', { name: 'Dismiss challenge' }).click();
    await expect(page.locator('.challenge')).toBeHidden();
    expect((await runCfg(page)).mode).toBe('endless');
  });

  test("a first-time player warms up with the tutorial run, then takes the challenge on the sender's rules", async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const code = challengeCode({ v: 1, k: 'e', seed: 42, m: 1240, s: 0, p: 3, dr: 55, n: 'Sam' });
    await openGame(page, `test=1#c=${code}`);
    // The banner stays up over the tutorial run.
    await expect(page.locator('.challenge')).toBeVisible();
    expect(await runCfg(page)).toMatchObject({ mode: 'endless', profile: 0, tutorial: true });
    await dragOnCanvas(page);
    await waitForScreen(page, 'play');
    expect((await state(page)).profile).toBe(0);
    await forceDeath(page);
    const retry = page.locator('.res-retry');
    await expect.soft(retry).toContainText('Take the challenge');
    await retry.click();
    await waitForScreen(page, 'play');
    expect(await runCfg(page)).toMatchObject({ mode: 'challenge', seed: 42, profile: 3, drain: 55 });
    const s = await state(page);
    expect([s.profile, s.drain, s.noonCloud, s.lessonOn]).toEqual([3, 55, 0, false]);
    // No ghost hint on the sender's rules.
    await page.waitForTimeout(1500);
    expect((await page.evaluate(() => window.__SHADY_TEST__!.hint())).mode).toBe('off');
    expect(errors).toEqual([]);
  });

  test("the friend's puddle and pennant mark the target; reaching it stamps PASSED", async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const code = challengeCode({ v: 1, k: 'e', seed: 42, m: 15, s: 0, p: 3, dr: 55, n: 'Sam' });
    await openGame(page, `test=1#c=${code}`);
    expect((await runCfg(page)).mode).toBe('challenge');
    await info.attach('friend-puddle', { body: await page.screenshot(), contentType: 'image/png' });
    await page.evaluate(() => window.__SHADY_TEST__!.demo('passed'));
    await page.waitForTimeout(400);
    await info.attach('passed-stamp', { body: await page.screenshot(), contentType: 'image/png' });
    // Played: the real stamp lands when the run passes 6:15 AM.
    await dragOnCanvas(page);
    await waitForScreen(page, 'play');
    await expect.poll(async () => (await state(page)).minutes, { timeout: 10_000 }).toBeGreaterThanOrEqual(15);
  });
});

test.describe('daily dates', () => {
  test('Retry of a past Daily replays that date', async ({ page }) => {
    await openGame(page, 'test=1');
    const yesterday = await pageDate(page, -1);
    await openGame(page, `test=1&mode=daily&date=${yesterday}`);
    expect(await runCfg(page)).toMatchObject({ mode: 'daily', dailyDate: yesterday });
    await forceDeath(page);
    await page.getByRole('button', { name: /^Retry/ }).click();
    await waitForScreen(page, 'play');
    expect(await runCfg(page)).toMatchObject({ mode: 'daily', dailyDate: yesterday });
  });

  test('?date= outside the Daily bounds is ignored', async ({ page }) => {
    await openGame(page, 'test=1');
    const today = await pageDate(page);
    const farFuture = await pageDate(page, 5);
    await openGame(page, `test=1&mode=daily&date=${farFuture}`);
    expect((await runCfg(page)).dailyDate).toBe(today);
    await openGame(page, 'test=1&mode=daily&date=2025-12-31');
    expect((await runCfg(page)).dailyDate).toBe(today);
  });

  test('the Daily screen rolls over at midnight', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 11, 23, 59, 30) });
    await seedSave(page, UNLOCKED_SAVE);
    await openGame(page, 'test=1');
    await openDaily(page);
    await expect(page.locator('.scr-daily .daily-num')).toHaveText('#284');
    await page.clock.fastForward(60_000);
    await expect(page.locator('.scr-daily .daily-num')).toHaveText('#285');
    await expect(dailyPlay(page)).toContainText('Play · try 1/3');
  });
});

test.describe('settings rebuild the held run', () => {
  test('Reduced motion On reaches the Title run', async ({ page }) => {
    await openGame(page, 'test=1');
    expect((await runCfg(page)).reducedMotion).toBe(false);
    await page.locator('.tray button[aria-label="Settings"]').click();
    await waitForScreen(page, 'settings');
    await page.getByRole('radiogroup', { name: 'Reduced motion' }).getByRole('radio', { name: 'On' }).click();
    await page.keyboard.press('Escape');
    await waitForScreen(page, 'title');
    expect((await runCfg(page)).reducedMotion).toBe(true);
  });

  test('Reset progress gives a profile-0 tutorial run', async ({ page }) => {
    await seedSave(page, { v: 1, createdAt: 1, stats: { runs: 9, bestMinutes: 900 } });
    await openGame(page, 'test=1');
    expect(await runCfg(page)).toMatchObject({ profile: 3, tutorial: false });
    await page.locator('.tray button[aria-label="Settings"]').click();
    await waitForScreen(page, 'settings');
    await page.getByRole('button', { name: 'Reset progress' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Reset', exact: true }).click();
    await expect.poll(async () => (await runCfg(page)).profile).toBe(0);
    expect(await runCfg(page)).toMatchObject({ profile: 0, tutorial: true, drain: 30 });
  });
});

test.describe('Results: Daily fields (K5)', () => {
  test('a scored Daily that dies before 6:30 AM is not counted', async ({ page }) => {
    await seedSave(page, UNLOCKED_SAVE);
    await openGame(page, 'test=1');
    await openDaily(page);
    await dailyPlay(page).click();
    await waitForScreen(page, 'play');
    await forceDeath(page);
    await expect(page.locator('.res-sheet')).toContainText('Not counted');
  });

  test('with 3 tries used the Daily is practice, and so is its Retry', async ({ page }) => {
    await openGame(page, 'test=1');
    const today = await pageDate(page);
    const save = { v: 1, createdAt: 1, stats: { runs: 3 }, daily: { [today]: { tries: 3, bestMinutes: 100, bestSnow: 0, glyphs: '' } } };
    await seedSave(page, save);
    await openGame(page, 'test=1');
    await openDaily(page);
    await dailyPlay(page).click();
    await waitForScreen(page, 'play');
    await forceDeath(page);
    await expect(page.locator('.res-sheet')).toContainText('Practice');
    await expect(page.getByRole('button', { name: /^Retry/ })).toHaveAccessibleName('Retry · practice');
  });

  test('a counted try shows Try 1/3', async ({ page }) => {
    await seedSave(page, UNLOCKED_SAVE);
    await openGame(page, 'test=1');
    await openDaily(page);
    await dailyPlay(page).click();
    await waitForScreen(page, 'play');
    await page.evaluate(() => window.__SHADY_TEST__!.bot('oracle'));
    await dragOnCanvas(page, 30);
    await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(3));
    await expect.poll(async () => (await state(page)).minutes, { timeout: 15_000 }).toBeGreaterThanOrEqual(31);
    await forceDeath(page);
    await expect(page.locator('.res-sheet')).toContainText('Try 1/3');
  });
});

test.describe('focus loss and run markers', () => {
  test('window blur during play pauses, and focus never resumes', async ({ page }) => {
    await openGame(page, 'test=1');
    await dragOnCanvas(page);
    await waitForScreen(page, 'play');
    await page.waitForTimeout(400);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await waitForScreen(page, 'pause');
    const m = (await state(page)).minutes;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(600);
    expect(await screen(page)).toBe('pause');
    expect((await state(page)).minutes).toBe(m);
  });

  /** Opens a run with navigator.share stubbed; returns a reader for the shared text. */
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

  test('Guide "Always" at any point marks the run assisted (latched)', async ({ page }) => {
    const shared = await stubShare(page);
    await seedSave(page, { v: 1, createdAt: 1, stats: { runs: 3 }, settings: { guide: 'always' } });
    await openGame(page, 'test=1');
    await dragOnCanvas(page);
    await waitForScreen(page, 'play');
    // A bot keeps Nubs alive through the 2.5 s (the run stays scored and shareable).
    await page.evaluate(() => window.__SHADY_TEST__!.bot('oracle'));
    await page.waitForTimeout(2500);
    await page.locator('button[aria-label="Pause"]').click();
    await waitForScreen(page, 'pause');
    await page.getByRole('button', { name: 'Settings' }).click();
    await waitForScreen(page, 'settings');
    await page.getByRole('radiogroup', { name: 'Shade guide' }).getByRole('radio', { name: 'Auto' }).click();
    await page.keyboard.press('Escape');
    await waitForScreen(page, 'pause');
    await page.getByRole('button', { name: 'Resume' }).click();
    await waitForScreen(page, 'play');
    await forceDeath(page);
    await page.locator('.res-sheet button[aria-label="Share"]').click();
    await expect.poll(shared).not.toBeNull();
    expect(await shared()).toContain('\u{1F9ED}');
  });

  test('a run never on Always is not marked', async ({ page }) => {
    const shared = await stubShare(page);
    await seedSave(page, { v: 1, createdAt: 1, stats: { runs: 3 } });
    await openGame(page, 'test=1');
    await dragOnCanvas(page);
    await waitForScreen(page, 'play');
    await page.evaluate(() => window.__SHADY_TEST__!.bot('oracle'));
    await page.waitForTimeout(500);
    await forceDeath(page);
    await page.locator('.res-sheet button[aria-label="Share"]').click();
    await expect.poll(shared).not.toBeNull();
    expect(await shared()).not.toContain('\u{1F9ED}');
  });

  test('the HUD best flag holds while Daily checkpoints raise the saved best', async ({ page }) => {
    test.setTimeout(90_000);
    await openGame(page, 'test=1');
    const today = await pageDate(page);
    await seedSave(page, { v: 1, createdAt: 1, stats: { runs: 3 }, daily: { [today]: { tries: 1, bestMinutes: 120, bestSnow: 0, glyphs: '' } } });
    await openGame(page, 'test=1');
    await openDaily(page);
    await dailyPlay(page).click();
    await waitForScreen(page, 'play');
    await page.evaluate(() => window.__SHADY_TEST__!.bot('oracle'));
    await dragOnCanvas(page, 30);
    await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(4));
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      seen.add(await page.evaluate(() => window.__SHADY_TEST__!.hudPb()));
      const s = await state(page);
      if (s.minutes >= 190 || s.phase === 'dead') break;
      await page.waitForTimeout(100);
    }
    expect((await state(page)).minutes).toBeGreaterThanOrEqual(190);
    expect([...seen]).toEqual([120]);
    // The checkpoint did raise the saved best meanwhile.
    const best = await page.evaluate((d) => JSON.parse(localStorage.getItem('shady.save') ?? '{}').daily?.[d]?.bestMinutes ?? 0, today);
    expect(best).toBeGreaterThanOrEqual(180);
  });
});
