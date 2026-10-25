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
/** Comments and quoted strings in CSS: renaming and compaction never reach inside them. */
const CSS_OPAQUE = /(\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/;

/** Files under `dir` whose names match `re`, as paths. */
function sources(dir: string, re: RegExp): string[] {
  return listFiles(dir)
    .filter((f) => re.test(f))
    .map((f) => join(dir, f));
}

const read = (files: string[]): string => files.map((f) => readFileSync(f, 'utf8')).join('\n');
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
/** `name` as a whole token: no word character or hyphen glued to either side. */
const tokenRe = (names: readonly string[], flags = 'g'): RegExp =>
  new RegExp(`(?<![\\w-])(?:${names.map(escapeRe).join('|')})(?![\\w-])`, flags);

/** Short names, most used first: a, b, … Z, aa, ab, … (each skipped while `taken` holds it). */
function namer(taken: (s: string) => boolean): () => string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let i = 0;
  return () => {
    for (;;) {
      let n = i++;
      let s = '';
      do {
        s = alphabet[n % 52] + s;
        n = Math.floor(n / 52) - 1;
      } while (n >= 0);
      if (!taken(s)) return s;
    }
  };
}

/**
 * Shortens the UI's names in build output (docs/UI_V2.md §13): the kit's ~1,900 `var(--…)`
 * references (`--font-display` → `--c`) and its hyphenated class names (`.res-goal-rule` →
 * `._x`), plus the spaces after commas that minifiers keep in
 * values holding var() (and a linear-gradient's default 180deg). Nothing is renamed that could be
 * read by name from outside the stylesheets and the UI code: a name any e2e spec or index.html
 * mentions keeps it, and so does a name that starts like a template-built one (`btn--${variant}`,
 * `--prop-${kind}`), a custom property the TypeScript mentions at all (set from JS, read with
 * getPropertyValue), a class the game, meta, core, config, audio or platform code mentions (cue
 * ids, saved keys), and a class that is also a keyframe, container, id or other bare name in the
 * CSS. Classes are renamed in the CSS and as whole tokens in the JS chunks (class lists, selectors,
 * the SVG markup strings), the same map for both. The maps are built once from the sources, most
 * used first, so the same sources always give the same output. Dev servers and the UI lab never
 * see any of it. Measured on the UI v2 sources: CSS 104.6 -> 94.3 kB, JS -2.1 kB.
 */
function shortCss(): Plugin {
  let vars = new Map<string, string>();
  let classes = new Map<string, string>();
  let classRe: RegExp | null = null;
  const restOf = (css: string, fn: (s: string) => string): string =>
    css
      .split(CSS_OPAQUE)
      .map((part, i) => (i % 2 === 1 ? part : fn(part)))
      .join('');
  return {
    name: 'shady-short-css',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      // The UI and audio labs are dev pages with their own markup and styles: never part of a build.
      const ts = (dir: string): string[] => sources(dir, /\.ts$/).filter((f) => !f.endsWith('/lab.ts'));
      const ui = read([...ts('src/ui'), ...ts('src/render')]);
      const rest = read(['src/core', 'src/meta', 'src/config', 'src/audio', 'src/platform', 'src/game'].flatMap(ts).concat(sources('src', /^[^/]+\.ts$/)));
      const outside = read([...sources('tests/e2e', /\.ts$/), 'index.html']);
      const code = `${ui}\n${rest}\n${outside}`;
      // A template can build a name from a literal start (`btn--${variant}`, `jbar--d${n}`): every name
      // with that start stays as it is. A start followed by a conditional that adds its own spaced
      // class (`mrow${done ? ' is-done' : ''}`) builds no name from it, nor does a lone letter
      // (debug text like `p${profile}`).
      const prefixes = [...code.matchAll(/(?<![\w-])(-?-?[a-zA-Z][\w-]*)\$\{([^}]*)/g)]
        .filter((m) => (m[1] as string).length > 1 && !/^[^?`'"]*\?\s*['"`] /.test(m[2] as string))
        .map((m) => m[1] as string);
      const cssAll = read(sources('src', /\.css$/));
      const css = cssAll.split(CSS_OPAQUE).filter((_, i) => i % 2 === 0).join(' ');

      // Custom properties.
      const keepVars = new Set(code.match(CSS_VAR) ?? []);
      const varCount = new Map<string, number>();
      for (const name of css.match(CSS_VAR) ?? []) varCount.set(name, (varCount.get(name) ?? 0) + 1);
      const freeVars = [...varCount.keys()].filter((n) => !keepVars.has(n) && !prefixes.some((p) => n.startsWith(p)));
      freeVars.sort((a, b) => varCount.get(b)! * b.length - varCount.get(a)! * a.length || (a < b ? -1 : 1));
      const takenVars = new Set([...keepVars, ...varCount.keys()]);
      const nextVar = namer((s) => takenVars.has(`--${s}`));
      vars = new Map(freeVars.map((n) => [n, `--${nextVar()}`]));

      // Hyphenated class names.
      const classCount = new Map<string, number>();
      for (const m of css.matchAll(/\.([a-zA-Z_][\w-]*-[\w-]*)/g)) classCount.set(m[1], (classCount.get(m[1]) ?? 0) + 1);
      const bare = new Set(css.replace(/\.[a-zA-Z_][\w-]*/g, ' ').match(/(?<![\w-])[a-zA-Z_][\w-]*/g) ?? []);
      const hits = (text: string, names: string[]): Set<string> => new Set(names.length ? (text.match(tokenRe(names)) ?? []) : []);
      const all = [...classCount.keys()];
      const fixed = new Set([...hits(`${rest}\n${outside}`, all), ...all.filter((n) => bare.has(n) || prefixes.some((p) => n.startsWith(p)))]);
      const free = all.filter((n) => !fixed.has(n));
      const uiCount = new Map<string, number>();
      for (const m of free.length ? (ui.match(tokenRe(free)) ?? []) : []) uiCount.set(m, (uiCount.get(m) ?? 0) + 1);
      const uses = (n: string): number => (classCount.get(n) ?? 0) + (uiCount.get(n) ?? 0);
      free.sort((a, b) => uses(b) * b.length - uses(a) * a.length || (a < b ? -1 : 1));
      const nextClass = namer(() => false);
      classes = new Map(free.map((n) => [n, `_${nextClass()}`]));
      classRe = free.length ? tokenRe([...free].sort((a, b) => b.length - a.length)) : null;
    },
    transform(code, id) {
      if (!/\.css$/.test(id) || !id.startsWith(resolve('src'))) return null;
      const out = restOf(code.replace(CSS_VAR, (n) => vars.get(n) ?? n), (part) =>
        part
          .replace(/\.([a-zA-Z_][\w-]*)/g, (m, n: string) => (classes.has(n) ? `.${classes.get(n)}` : m))
          .replace(/\blinear-gradient\(\s*180deg\s*,\s*/g, 'linear-gradient(')
          .replace(/\s*,\s+/g, ','),
      );
      return { code: out, map: null };
    },
    renderChunk(code) {
      if (!classRe) return null;
      return { code: code.replace(classRe, (n) => classes.get(n) ?? n), map: null };
    },
  };
}

// Relative base so the same build works on GitHub Pages sub-paths, file:// WebViews and Capacitor.
export default defineConfig({
  base: './',
  plugins: [shortCss(), shadySW()],
  build: {
    // The script targets the same floor as the CSS below (Controls v3 integration): a page that cannot
    // lay out its UI below these browsers gains nothing from es2020 output. Native class fields and
    // `#private` members then ship as they are, so the minifier shortens every `#name` (the session,
    // fx, audio, perf and haptics classes keep their internals private this way, about 8.4 KB).
    target: ['chrome105', 'edge105', 'firefox121', 'safari16'],
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
