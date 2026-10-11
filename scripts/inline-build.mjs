// Inlines the built JS/CSS into index.html so the game ships as one self-contained file
// (handy for sharing, embedding, or dropping into a WebView).
import { readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist-single';
const htmlPath = join(dir, 'index.html');
let html = readFileSync(htmlPath, 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\.?\/?([^"]+\.css)"[^>]*>/g, (_m, href) => {
  const css = readFileSync(join(dir, href), 'utf8');
  return `<style>${css}</style>`;
});
html = html.replace(/<script type="module"[^>]*src="\.?\/?([^"]+\.js)"[^>]*><\/script>/g, (_m, src) => {
  const js = readFileSync(join(dir, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
writeFileSync(htmlPath, html);

const assets = join(dir, 'assets');
try {
  if (statSync(assets).isDirectory()) {
    for (const f of readdirSync(assets)) if (/\.(js|css)$/.test(f)) rmSync(join(assets, f));
  }
} catch {}
console.log(`inlined -> ${htmlPath} (${(html.length / 1024).toFixed(1)} KiB)`);
