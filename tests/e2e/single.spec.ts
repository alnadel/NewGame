// The single-file build opened straight from disk (platform-paths-untested-in-ci): it boots from
// file://, plays a run to Results without console errors, requests no service worker, manifest or
// ./assets/ file, and its share text links to the hosted game (VITE_SHARE_URL in .env), never file:.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { waitForScreen, watchErrors } from './helpers.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const html = `${root}dist-single/index.html`;

/** VITE_SHARE_URL from the repo's committed .env. */
function shareUrlFromEnv(): string {
  const env = readFileSync(`${root}.env`, 'utf8');
  const m = /^VITE_SHARE_URL=(.*)$/m.exec(env);
  if (!m || !m[1]) throw new Error('.env has no VITE_SHARE_URL');
  return m[1].trim();
}

test.skip(({ isMobile }) => isMobile, 'one browser is enough for a file:// build (and one build:single at a time)');

/** The newest modification time (ms) of a file under `dir`. */
function newest(dir: string): number {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

test.beforeAll(() => {
  // Rebuilt whenever a source is newer than the build, so file:// coverage plays the code under test
  // (a build left from an earlier commit was played before).
  const src = Math.max(newest(`${root}src`), ...['index.html', 'vite.config.ts', '.env', 'scripts/inline-build.mjs'].map((f) => statSync(`${root}${f}`).mtimeMs));
  if (!existsSync(html) || statSync(html).mtimeMs < src) execSync('npm run build:single', { cwd: root, stdio: 'inherit' });
});

test('the single-file build plays from file:// and shares the hosted link', async ({ page }) => {
  const errors = watchErrors(page);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
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
  await page.goto(`file://${html}?test=1`);
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'title', 10_000);

  const v = page.viewportSize()!;
  const x = Math.round(v.width / 2);
  const y = Math.round(v.height * 0.4);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y, { steps: 6 });
  await page.mouse.up();
  await waitForScreen(page, 'play');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);

  await page.locator('.res-sheet button[aria-label="Share"]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: string | null }).__shared)).not.toBeNull();
  const text = (await page.evaluate(() => (window as unknown as { __shared: string | null }).__shared)) as string;
  expect(text).not.toContain('file:');
  const link = /https?:\/\/\S+/.exec(text)?.[0];
  expect(link, `a link in:\n${text}`).toBeDefined();
  expect(link!.startsWith(shareUrlFromEnv()), `${link} starts with the .env VITE_SHARE_URL`).toBe(true);

  expect(errors).toEqual([]);
  const bad = requests.filter((u) => /sw\.js|manifest\.webmanifest|\/assets\//.test(u));
  expect(bad).toEqual([]);
});
