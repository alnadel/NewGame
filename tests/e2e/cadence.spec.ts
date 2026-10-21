// The render cadence on a high-refresh display (game/cadence.ts): play draws at most 60 fps, but
// every rAF while a finger is down. On a 90-144 Hz display that uncapped stretch once drew faster
// than the 60 Hz timeline advanced, so after a long hold the canvas froze (at 120 Hz about as long
// again as the hold) while the run went on underneath. Each test drives a 120 or 144 Hz rAF stream,
// holds a drag for 4 s, lifts it and checks the canvas goes on drawing at 60 fps at once.
import { expect, test, type Page } from '@playwright/test';
import { keepAlive, state, waitForScreen, watchErrors } from './helpers.ts';

/**
 * A high-refresh display in a headless browser: requestAnimationFrame queues its callbacks and a
 * timer runs them every 1000/hz ms (on the next slot after a slow frame, as vsync does; timers take
 * whole ms, so rounded up), passing performance.now(); a callback queued inside one runs on the next.
 */
async function emulateRefresh(page: Page, hz: number): Promise<void> {
  await page.addInitScript((rate) => {
    const period = 1000 / rate;
    const t0 = performance.now();
    let queue = new Map<number, FrameRequestCallback>();
    let ids = 0;
    const vsync = (): void => {
      const run = queue;
      queue = new Map();
      const now = performance.now();
      for (const cb of run.values()) {
        try {
          cb(now);
        } catch (e) {
          reportError(e);
        }
      }
      setTimeout(vsync, Math.ceil(period - ((performance.now() - t0) % period)));
    };
    setTimeout(vsync, Math.ceil(period));
    window.requestAnimationFrame = (cb) => {
      queue.set(++ids, cb);
      return ids;
    };
    window.cancelAnimationFrame = (id) => {
      queue.delete(id);
    };
  }, hz);
}

/** renderer.draw calls so far and the page's clock (ms). */
const draws = (page: Page): Promise<{ draws: number; t: number }> =>
  page.evaluate(() => ({ draws: window.__SHADY_TEST__!.perf().draws, t: performance.now() }));

for (const hz of [120, 144]) {
  test(`${hz} Hz: the canvas goes on drawing at 60 fps the moment a 4 s hold ends`, async ({ page }) => {
    const errors = watchErrors(page);
    await emulateRefresh(page, hz);
    // A level's intro card holds until the first tap; the oracle bot keeps the run alive.
    await page.goto('/?level=12&test=1');
    await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
    await waitForScreen(page, 'play');
    await keepAlive(page);
    const box = (await page.locator('canvas#game').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.45;
    await page.mouse.click(cx, cy);
    await expect.poll(async () => (await state(page)).phase).toBe('day');
    // Past the start beat, at normal speed: only the finger lifts the 60 fps cap.
    await page.waitForTimeout(1600);
    await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.timeScale())).toBe(1);

    // A slow horizontal drag held for 4 s: every rAF draws.
    await page.mouse.move(cx - 80, cy);
    await page.mouse.down();
    const held = await draws(page);
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(cx - 80 + 4 * (i <= 20 ? i : 40 - i), cy);
      await page.waitForTimeout(100);
    }
    const lift = await draws(page);
    await page.mouse.up();

    // From the lift on: every rAF for 600 ms (the draws since, the time scale, the screen) and how
    // far the run's clock went.
    const after = await page.evaluate(async () => {
      const hook = window.__SHADY_TEST__!;
      const t0 = performance.now();
      const d0 = hook.perf().draws;
      const m0 = hook.state().minutes;
      const frames: { t: number; draws: number; scale: number; screen: string }[] = [];
      while (performance.now() - t0 < 600) {
        await new Promise((r) => requestAnimationFrame(r));
        frames.push({ t: performance.now() - t0, draws: hook.perf().draws - d0, scale: hook.timeScale(), screen: hook.screen() });
      }
      return { frames, minutes: hook.state().minutes - m0 };
    });
    let gap = 0;
    let last = 0;
    let total = 0;
    for (const f of after.frames) {
      if (f.draws === total) continue;
      gap = Math.max(gap, f.t - last);
      last = f.t;
      total = f.draws;
    }
    gap = Math.max(gap, 600 - last);
    const first300 = after.frames.filter((f) => f.t <= 300).at(-1)?.draws ?? 0;
    const report = JSON.stringify({
      holdFps: Math.round(((lift.draws - held.draws) * 1000) / (lift.t - held.t)),
      first300,
      total,
      gap: Math.round(gap),
      rafs: after.frames.length,
      minutes: after.minutes,
      scales: [...new Set(after.frames.map((f) => f.scale))],
    });
    test.info().annotations.push({ type: `${hz} Hz after the lift`, description: report });

    // Within 300 ms of the lift the canvas has drawn at about 60 fps, and it never stalls since...
    expect(first300, report).toBeGreaterThanOrEqual(10);
    expect(gap, report).toBeLessThanOrEqual(60);
    // ...nor runs at the display's rate (that is for a finger down or another time scale only).
    if (after.frames.every((f) => f.scale === 1)) expect(total, report).toBeLessThanOrEqual(42);
    // The run is still in play and its clock kept going.
    expect(after.frames.every((f) => f.screen === 'play'), report).toBe(true);
    expect(after.minutes, report).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}
