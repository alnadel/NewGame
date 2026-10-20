// Turns a Vite build into one self-contained index.html (handy for sharing, embedding, or dropping
// into a WebView):
//   1. inlines every <script src> and stylesheet <link> it can find on disk, and drops
//      modulepreload links;
//   2. removes what a lone file cannot use: the PWA manifest and apple-touch-icon links;
//   3. inlines the SVG favicon as a data:image/svg+xml URI, escaped only where a URL needs it;
//   4. validates: the page must not reference assets/, a <script src> or a stylesheet <link>.
// On any problem it prints what is wrong and exits 1 without touching the build, so a broken
// single-file build fails CI instead of shipping a page that 404s offline. On success it rewrites
// index.html and deletes the inlined JS/CSS from assets/.
//
//   node scripts/inline-build.mjs [dir = dist-single]
// (`npm run build:single` runs it after `vite build [--mode single] --outDir dist-single`.)
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist-single';
const htmlPath = join(dir, 'index.html');
if (!existsSync(htmlPath)) {
  console.error(`inline-build: ${htmlPath} not found (run vite build --outDir ${dir} first)`);
  process.exit(1);
}
const source = readFileSync(htmlPath, 'utf8');
/** Problems that make the output not self-contained; any of them fails the build. */
const problems = [];
/** Built files that were inlined and can be deleted afterwards. */
const inlined = new Set();

/** Value of attribute `name` in an HTML start tag, or null. */
function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/** Reads a file the page references by a relative URL ("./assets/x.js", "/x.css"); null if absent. */
function readLocal(url) {
  if (/^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith('data:')) return null;
  const path = join(dir, url.replace(/^\.?\//, '').replace(/[?#].*$/, ''));
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return { path, text: readFileSync(path, 'utf8') };
}

/**
 * An SVG as a data: URI with only the escapes a URL in an attribute needs (%, #, <, >, &, the quote,
 * whitespace runs, anything outside ASCII): about 30% smaller than encodeURIComponent's output for the same icon.
 * Double quotes become single ones, so the URI can sit in a double-quoted attribute.
 */
function svgDataUri(svg) {
  const text = svg.trim().replace(/\s+/g, ' ').replace(/> </g, '><').replace(/"/g, "'");
  return `data:image/svg+xml,${text.replace(/[%#<>&]|[^\0-\x7F]/gu, encodeURIComponent)}`;
}

let html = source;

// <link>: stylesheets inline, modulepreload/manifest/apple-touch-icon go, the favicon becomes data:.
html = html.replace(/<link\b[^>]*>/gi, (tag) => {
  const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
  const href = attr(tag, 'href');
  if (rel.includes('stylesheet')) {
    const f = href ? readLocal(href) : null;
    if (!f) {
      problems.push(`cannot inline the stylesheet ${href ?? '(no href)'}: file not found in ${dir}`);
      return tag;
    }
    inlined.add(f.path);
    return `<style>${f.text.replace(/<\/style/gi, '<\\/style')}</style>`;
  }
  if (rel.includes('modulepreload') || rel.includes('manifest') || rel.includes('apple-touch-icon')) return '';
  if (rel.includes('icon') && href !== null && !href.startsWith('data:')) {
    const f = readLocal(href);
    if (!f || !/\.svg$/i.test(f.path)) {
      problems.push(`cannot inline the favicon ${href}: ${f ? 'only SVG favicons are supported' : `file not found in ${dir}`}`);
      return tag;
    }
    return `<link rel="icon" type="image/svg+xml" href="${svgDataUri(f.text)}" />`;
  }
  return tag;
});

// <script src>: inline the code (keeping type="module"), escaping any "</script" inside it.
html = html.replace(/<script\b[^>]*>\s*<\/script\s*>/gi, (tag) => {
  const src = attr(tag, 'src');
  if (src === null) return tag;
  const f = readLocal(src);
  if (!f) {
    problems.push(`cannot inline the script ${src}: file not found in ${dir}`);
    return tag;
  }
  inlined.add(f.path);
  const type = attr(tag, 'type');
  return `<script${type ? ` type="${type}"` : ''}>${f.text.replace(/<\/script/gi, '<\\/script')}</script>`;
});

// Validation: nothing may still point at a separate file.
if (/assets\//.test(html)) problems.push("the page still references 'assets/'");
if (/<script\b[^>]*\bsrc\s*=/i.test(html)) problems.push('the page still has a <script src>');
if (/<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(html)) problems.push('the page still has a stylesheet <link>');
if (/manifest\.webmanifest|apple-touch-icon/i.test(html)) problems.push('the page still links the manifest or apple-touch-icon');

if (problems.length) {
  console.error(`inline-build: ${htmlPath} is not self-contained:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('inline-build: left the build untouched.');
  process.exit(1);
}

writeFileSync(htmlPath, html);
for (const p of inlined) rmSync(p);
const assets = join(dir, 'assets');
if (existsSync(assets) && statSync(assets).isDirectory() && readdirSync(assets).length === 0) rmdirSync(assets);
console.log(`inlined -> ${htmlPath} (${(html.length / 1024).toFixed(1)} KiB, ${inlined.size} file(s) inlined)`);
