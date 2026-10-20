import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Public files left out of the precache: install-time icons the browser fetches itself (the page
 * never needs them offline), the 1024 px store asset and the link-preview card (og.png, fetched by
 * link unfurlers only), so none of them changes sw.js or its VERSION.
 */
const SW_SKIP: readonly RegExp[] = [/^icons\/icon-(512|maskable-512|1024)\.png$/, /^og\.png$/];

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
// cache: 'reload' skips the HTTP cache, so a CDN's stale copy of index.html (Pages caches it for
// minutes) can never be precached next to the new version's assets.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))),
  );
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
 * the single-file build (`--mode single`, or any build into dist-single), whose inliner deletes the
 * JS files a precache list would name and whose page never registers a worker.
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
      if (config.build.ssr || config.mode === 'single' || basename(resolve(config.root, config.build.outDir)) === 'dist-single') return;
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

/** A custom property token: `--name` not glued to a word before it (so `.btn--primary` is no token). */
const CSS_VAR = /(?<![\w-])--[a-zA-Z_][\w-]*/g;

/** Files under `dir` whose names match `re`, as paths. */
function sources(dir: string, re: RegExp): string[] {
  return listFiles(dir)
    .filter((f) => re.test(f))
    .map((f) => join(dir, f));
}

/**
 * Shortens the UI's custom property names in build output (`--font-display` → `--b`): the kit
 * writes ~1,900 `var(--…)` references, about 6 KB of the single file (docs/UI_V2.md §13). Only names
 * that CSS alone reads and writes are renamed: any name the TypeScript, the HTML or a spec mentions
 * (set from JS, read with getPropertyValue, probed by an e2e test) keeps its name, and so does any
 * name that starts like a template-built one (`--prop-${kind}`). The map is built once from every
 * stylesheet under src/, most-used name first, so the same sources always give the same CSS (and
 * the same content hash). Dev servers and the UI lab never see it.
 */
function shortCssVars(): Plugin {
  let rename = new Map<string, string>();
  return {
    name: 'shady-short-css-vars',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      const read = (files: string[]): string => files.map((f) => readFileSync(f, 'utf8')).join('\n');
      const code = read([
        ...sources('src', /\.ts$/),
        ...sources('tests', /\.ts$/),
        'index.html',
      ]);
      const keep = new Set(code.match(CSS_VAR) ?? []);
      const prefixes = [...code.matchAll(/(?<![\w-])(--[\w-]*)\$\{/g)].map((m) => m[1]);
      const css = read(sources('src', /\.css$/)).replace(/\/\*[\s\S]*?\*\//g, '');
      const count = new Map<string, number>();
      for (const name of css.match(CSS_VAR) ?? []) count.set(name, (count.get(name) ?? 0) + 1);
      const free = [...count.keys()].filter((n) => !keep.has(n) && !prefixes.some((p) => n.startsWith(p)));
      free.sort((a, b) => count.get(b)! * b.length - count.get(a)! * a.length || (a < b ? -1 : 1));
      const taken = new Set([...keep, ...count.keys()]);
      const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let i = 0;
      const next = (): string => {
        for (;;) {
          let n = i++;
          let s = alphabet[n % 52];
          for (n = Math.floor(n / 52); n > 0; n = Math.floor((n - 1) / 52)) s = alphabet[(n - 1) % 52] + s;
          if (!taken.has(`--${s}`)) return `--${s}`;
        }
      };
      rename = new Map(free.map((n) => [n, next()]));
    },
    transform(code, id) {
      if (!/\.css$/.test(id) || !id.startsWith(resolve('src'))) return null;
      return { code: code.replace(CSS_VAR, (n) => rename.get(n) ?? n), map: null };
    },
  };
}

// Relative base so the same build works on GitHub Pages sub-paths, file:// WebViews and Capacitor.
export default defineConfig({
  base: './',
  plugins: [shortCssVars(), shadySW()],
  build: {
    target: 'es2020',
    // The UI's floor is CSS container queries and :has() (they lay out the Title, Results, Pause,
    // the dialogs and the menus), so the CSS targets the first browsers that have both. A target
    // derived from es2020 made lightningcss split every :focus-visible/:is() selector list into
    // separate rules and add -webkit-any/-moz-any copies for browsers that cannot lay the UI out
    // (about 5 KB). Firefox stays at 121, its first :has(): below that lightningcss wraps a
    // :has() selector list in :is(), which lifts every selector in it to the list's highest
    // specificity (the kit's dialog ribbon padding then beat the Pause card's small-phone rule).
    cssTarget: ['chrome105', 'edge105', 'firefox121', 'safari16'],
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: { host: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // One worker per core (vitest's default leaves one core idle), each reused across files (no
    // per-file module isolation: the unit tests share no mutable module state they don't reset):
    // ~19 s → ~12 s on 4 cores (CO7). The slowest files are split so the workers stay balanced.
    isolate: false,
    maxWorkers: '100%',
  },
});
