// Link previews (V1_1_PLAN UM11 as cut by A10): one Open Graph card for every link, with an
// absolute image URL; the card stays out of the service worker's precache; challenge links keep
// the ${base}#c=CODE shape and open on the banner.
import { readFileSync, statSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { challengeCode, openGame } from './helpers.ts';

const ROOT = new URL('../../', import.meta.url);

test('the built page carries an absolute link-preview card', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const meta = (key: string): string | undefined => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];
  expect(meta('og:image')).toMatch(/^https:\/\/.+\/og\.png$/);
  expect(meta('twitter:image')).toBe(meta('og:image'));
  expect(meta('og:url')).toMatch(/^https:\/\/.+\/$/);
  expect(meta('twitter:card')).toBe('summary_large_image');
  expect([meta('og:image:width'), meta('og:image:height')]).toEqual(['1200', '630']);
  expect(meta('og:title')).toBe('SHADY: Don&#39;t Melt Nubs');
});

test('og.png is a 1200×630 PNG under 300 KB', () => {
  const file = new URL('public/og.png', ROOT);
  const png = readFileSync(file);
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  expect(statSync(file).size).toBeLessThanOrEqual(300 * 1024);
});

test('the service worker never precaches the card', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toContain('const ASSETS');
  expect(sw).not.toContain('og.png');
});

test('a challenge link opens on the banner', async ({ page }) => {
  await openGame(page, `test=1#c=${challengeCode({ v: 1, k: 'e', seed: 42, m: 1240, s: 0 })}`);
  await expect(page.locator('.challenge')).toBeVisible();
  await expect(page.locator('.challenge-goal')).toContainText('2:40');
});
