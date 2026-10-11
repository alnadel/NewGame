import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Public files left out of the precache: install-time icons the browser fetches itself (the page
 * never needs them offline) and the 1024 px store asset.
 */
const SW_SKIP: readonly RegExp[] = [/^icons\/icon-(512|maskable-512|1024)\.png$/];

/** Files under `dir`, as '/'-separated paths relative to it. */
function listFiles(dir: string, prefix = ''): string[] {
  let out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out = out.concat(listFiles(join(dir, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** The hand-rolled service worker (TECH_SPEC §14 with the CRITIQUE #37 fixes). */
function swSource(version: string, assets: readonly string[]): string {
  return `// SHADY service worker. Generated at build time by shadySW() in vite.config.ts; do not edit.
const VERSION = '${version}';
const CACHE = 'shady-' + VERSION;
const ASSETS = ${JSON.stringify(assets)};
const NAV_TIMEOUT_MS = 3000;

// No skipWaiting(): a new version takes over on the next cold start, so a running game never reloads.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shady-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Stores a copy of a successful same-origin response (never errors, redirects or opaque responses). */
function remember(key, response) {
  if (!response || !response.ok || response.type !== 'basic') return;
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(key, copy)).catch(() => {});
}

/** Pages: network first; after 3 s or offline, the cached app shell. */
async function navigate(request) {
  const network = fetch(request).then((response) => {
    remember('./index.html', response);
    return response;
  });
  network.catch(() => {});
  const timeout = new Promise((done) => setTimeout(done, NAV_TIMEOUT_MS, 'timeout'));
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== 'timeout') return first;
  } catch {
    // Offline: use the cached shell below.
  }
  return (await caches.match('./index.html')) || network;
}

/** Everything else: cache first, filling the cache on a miss. */
async function asset(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  remember(request, response);
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? navigate(request) : asset(request));
});
`;
}

/**
 * Emits sw.js into client builds. VERSION hashes the contents of every precached file, so any
 * change (even a same-size edit of a public file) ships a new worker. Skipped for SSR builds and for
 * build:single (dist-single), whose inliner deletes the JS files a precache list would name.
 */
function shadySW(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'shady-sw',
    apply: 'build',
    enforce: 'post',
    configResolved(resolved) {
      config = resolved;
    },
    generateBundle(_options, bundle) {
      if (config.build.ssr || basename(resolve(config.root, config.build.outDir)) === 'dist-single') return;
      const hash = createHash('sha1');
      const files: string[] = [];
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name];
        if (!item || name.endsWith('.map') || name === 'sw.js') continue;
        files.push(name);
        hash.update(name);
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      const publicDir = config.publicDir;
      for (const rel of publicDir ? listFiles(publicDir).sort() : []) {
        if (SW_SKIP.some((re) => re.test(rel)) || files.includes(rel)) continue;
        files.push(rel);
        hash.update(rel);
        hash.update(readFileSync(join(publicDir, rel)));
      }
      const version = hash.digest('hex').slice(0, 16);
      const assets = ['./', ...files.map((f) => `./${f}`)];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: swSource(version, assets) });
    },
  };
}

// Relative base so the same build works on GitHub Pages sub-paths, file:// WebViews and Capacitor.
export default defineConfig({
  base: './',
  plugins: [shadySW()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: { host: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
