// The display face (docs/UI_V2.md §2): Lilita One, Google Fonts' latin subset, unmodified (SIL OFL
// 1.1, see fonts/LICENSE-LilitaOne.txt). The ?inline import is a data: URL in every build (Vite
// inlines it even with assetsInlineLimit 0), so the PWA and the single-file build share one path:
// the font rides inside the JS chunk, the service worker precaches it with the chunk, and neither
// vite.config.ts nor scripts/inline-build.mjs needs a font rule. Loading it through FontFace (not an
// @font-face rule) gives the canvas a promise to rebuild its text caches on.
import lilita from './fonts/lilita-one-latin.woff2?inline';

/** The display stack for CSS and canvas (`400 ${px}px ${DISPLAY_FONT}`). */
export const DISPLAY_FONT = "'Lilita One', 'Arial Rounded MT Bold', system-ui, sans-serif";

/**
 * Resolves true once Lilita One is usable, false if the browser refused it (the fallbacks fit).
 * Starts at import time; touches `document`/`FontFace` only inside the async body, so a node unit
 * test that imports a UI module never crashes.
 */
export const fontsReady: Promise<boolean> = (async () => {
  try {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false;
    const face = new FontFace('Lilita One', `url("${lilita}") format('woff2')`, { weight: '400', style: 'normal', display: 'swap' });
    // In the set before it loads, so document.fonts.load() and .ready (the canvas) wait for it.
    document.fonts.add(face);
    await face.load();
    return true;
  } catch {
    return false;
  }
})();

/** Settles when the font is ready or after `ms`, whichever comes first (the boot splash). */
export function fontsReadyWithin(ms: number): Promise<void> {
  return Promise.race([fontsReady.then(() => undefined), new Promise<void>((done) => setTimeout(done, ms))]);
}
