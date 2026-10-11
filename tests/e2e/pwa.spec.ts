// The installable PWA on the production preview (platform-paths-untested-in-ci): the manifest is
// served, the service worker becomes ready and takes control, and an offline reload still boots
// the game to its Title.
import { expect, test } from '@playwright/test';
import { waitForScreen } from './helpers.ts';

test.skip(({ isMobile }) => isMobile, 'service worker checks: the desktop project');

test('the manifest is served', async ({ request }) => {
  const res = await request.get('./manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as { name?: string };
  expect(manifest.name).toContain('SHADY');
});

test('the service worker installs and serves the game offline', async ({ page, context }) => {
  await page.goto('/?test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'title', 10_000);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toContain('localhost');
  // No skipWaiting: the worker controls the page once clients.claim() has run, or after a reload.
  const controlled = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        if (navigator.serviceWorker.controller) return resolve(true);
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true));
        setTimeout(() => resolve(navigator.serviceWorker.controller !== null), 5000);
      }),
  );
  if (!controlled) {
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  }
  await context.setOffline(true);
  try {
    await page.reload();
    await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined, undefined, { timeout: 15_000 });
    await waitForScreen(page, 'title', 10_000);
  } finally {
    await context.setOffline(false);
  }
});
