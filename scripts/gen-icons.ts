// Rasterizes the app icon (src/ui/art.ts appIconSvg) into public/icons with Playwright Chromium and
// writes favicon.svg. Outputs are committed; re-run after changing the art:
//   node scripts/gen-icons.ts
// Needs a Playwright Chromium (npx playwright install chromium).

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { appIconSvg, type IconVariant } from '../src/ui/art.ts';

const OUT = new URL('../public/icons/', import.meta.url);

const TARGETS: { file: string; size: number; variant: IconVariant }[] = [
  { file: 'icon-192.png', size: 192, variant: 'any' },
  { file: 'icon-512.png', size: 512, variant: 'any' },
  { file: 'icon-maskable-512.png', size: 512, variant: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, variant: 'apple' },
  // Store / Capacitor source asset (full bleed; `npx @capacitor/assets generate` crops it).
  { file: 'icon-1024.png', size: 1024, variant: 'apple' },
];

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('favicon.svg', OUT), `${appIconSvg('any', 64).trim()}\n`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const t of TARGETS) {
    await page.setViewportSize({ width: t.size, height: t.size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${appIconSvg(t.variant, t.size)}</body></html>`);
    const png = await page.locator('svg').screenshot({ omitBackground: true });
    writeFileSync(new URL(t.file, OUT), png);
    console.log(`icons/${t.file} (${t.size}px, ${t.variant}, ${(png.length / 1024).toFixed(1)} KiB)`);
  }
} finally {
  await browser.close();
}
