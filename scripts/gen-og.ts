// Renders the link-preview image public/og.png (1200×630, ≤ 300 KB; V1_1_PLAN UM11 as cut by A10):
// the logo and tagline on the left, and on the right the built game at a curated afternoon moment,
// captured on a phone-shaped screen and cropped to Nubs and what is coming at him.
// The PNG is committed; re-run after visual changes:
//   npx vite build && node scripts/gen-og.ts
// Needs a Playwright Chromium (npx playwright install chromium).

import { chromium } from '@playwright/test';
import { statSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { preview } from 'vite';
import { logoSvg } from '../src/ui/art.ts';

const OUT = new URL('../public/og.png', import.meta.url);
const W = 1200;
const H = 630;
const MAX_BYTES = 300 * 1024;
/** A seed whose Day 2 afternoon in Old Town shows long shadows, market stalls and Nubs by a wall. */
const SCENE = '?seed=20261014&day=2&t=16:30&perf=0&mute=1';
const TAGLINE = 'You are the sun. Keep Nubs cool.';
/** Width of the game scene on the card's right. */
const SHOT_W = 640;

// ---------------------------------------------------------------------------------------------
// A 256-colour PNG (median cut over a 5-bit histogram): the flat art keeps its look at a third of
// the truecolour size, so the card stays under the 300 KB that link unfurlers accept.
// ---------------------------------------------------------------------------------------------

type Box = { keys: number[]; count: number };

/** Up to 256 palette colours (r, g, b triplets) for RGBA pixels, by median cut. */
function palette(rgba: Uint8Array): { colors: number[][]; bucket: Int32Array } {
  const hist = new Float64Array(32768 * 4); // count, Σr, Σg, Σb per 15-bit colour
  for (let i = 0; i < rgba.length; i += 4) {
    const k = (((rgba[i] as number) >> 3) << 10) | (((rgba[i + 1] as number) >> 3) << 5) | ((rgba[i + 2] as number) >> 3);
    hist[k * 4] += 1;
    hist[k * 4 + 1] += rgba[i] as number;
    hist[k * 4 + 2] += rgba[i + 1] as number;
    hist[k * 4 + 3] += rgba[i + 2] as number;
  }
  const used: number[] = [];
  for (let k = 0; k < 32768; k++) if ((hist[k * 4] as number) > 0) used.push(k);
  const chan = (k: number, c: number): number => (k >> (10 - 5 * c)) & 31;
  const boxes: Box[] = [{ keys: used, count: used.reduce((n, k) => n + (hist[k * 4] as number), 0) }];
  while (boxes.length < 256) {
    // Split the most populated box with room along its widest channel, at the pixel median.
    const box = boxes.filter((b) => b.keys.length > 1).sort((a, b) => b.count - a.count)[0];
    if (!box) break;
    const span = [0, 1, 2].map((c) => Math.max(...box.keys.map((k) => chan(k, c))) - Math.min(...box.keys.map((k) => chan(k, c))));
    const c = span.indexOf(Math.max(...span));
    box.keys.sort((a, b) => chan(a, c) - chan(b, c));
    let acc = 0;
    let cut = 1;
    for (; cut < box.keys.length - 1 && acc + (hist[(box.keys[cut - 1] as number) * 4] as number) < box.count / 2; cut++) acc += hist[(box.keys[cut - 1] as number) * 4] as number;
    const a = box.keys.slice(0, cut);
    const b = box.keys.slice(cut);
    const sum = (ks: number[]): number => ks.reduce((n, k) => n + (hist[k * 4] as number), 0);
    boxes.splice(boxes.indexOf(box), 1, { keys: a, count: sum(a) }, { keys: b, count: sum(b) });
  }
  const bucket = new Int32Array(32768);
  const colors = boxes.map((box, i) => {
    const t = [0, 0, 0, 0];
    for (const k of box.keys) {
      bucket[k] = i;
      for (let j = 0; j < 4; j++) (t[j] as number) += hist[k * 4 + j] as number;
    }
    return [1, 2, 3].map((j) => Math.round((t[j] as number) / (t[0] as number)));
  });
  return { colors, bucket };
}

/** An indexed (colour type 3) PNG of RGBA pixels. */
function indexedPng(rgba: Uint8Array, w: number, h: number): Buffer {
  const { colors, bucket } = palette(rgba);
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[y * (w + 1) + 1 + x] = bucket[(((rgba[i] as number) >> 3) << 10) | (((rgba[i + 1] as number) >> 3) << 5) | ((rgba[i + 2] as number) >> 3)] as number;
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 3, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(colors.flat())),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const server = await preview({ preview: { port: 4398, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch();
try {
  // 1. The game on a phone-shaped screen (the world fills it), cropped to Nubs and what is ahead.
  const phone = await browser.newPage({ viewport: { width: SHOT_W, height: 1136 }, deviceScaleFactor: 1 });
  await phone.goto(`http://localhost:4398/${SCENE}`);
  await phone.waitForFunction(() => (document.getElementById('ui') as HTMLElement).style.getPropertyValue('--nubs-y') !== '');
  await phone.waitForTimeout(2500);
  await phone.evaluate(() => {
    (document.getElementById('ui') as HTMLElement).style.visibility = 'hidden';
  });
  const nubsY = await phone.evaluate(() => parseFloat((document.getElementById('ui') as HTMLElement).style.getPropertyValue('--nubs-y')));
  const top = Math.max(0, Math.min(1136 - H, Math.round(nubsY - H * 0.72)));
  const scene = await phone.screenshot({ type: 'png', clip: { x: 0, y: top, width: SHOT_W, height: H } });

  // 2. The card: the logo and the tagline on the left, the scene on the right.
  const card = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await card.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;
    background:linear-gradient(160deg,#ffd9a8,#f6b07c 55%,#e98f6a);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
    <img src="data:image/png;base64,${scene.toString('base64')}" style="position:absolute;right:0;top:0;width:${SHOT_W}px;height:${H}px;
      -webkit-mask-image:linear-gradient(90deg,transparent,#000 90px);mask-image:linear-gradient(90deg,transparent,#000 90px)">
    <div style="position:absolute;left:0;top:0;bottom:0;width:${W - SHOT_W + 60}px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:26px">
      <div style="width:470px;filter:drop-shadow(0 8px 14px rgba(43,33,64,.3))">${logoSvg()}</div>
      <p style="margin:0;padding:12px 26px;border-radius:999px;background:#fff8ee;color:#2b2140;font:800 30px/1.2 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
        box-shadow:0 6px 16px rgba(43,33,64,.22)">${TAGLINE}</p>
    </div></body></html>`);
  await card.waitForTimeout(100);
  const shot = (await card.screenshot({ type: 'png' })).toString('base64');
  const rgba = await card.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, c.width, c.height).data);
  }, shot);
  writeFileSync(OUT, indexedPng(Uint8Array.from(rgba), W, H));
  const bytes = statSync(OUT).size;
  console.log(`og.png ${W}×${H}, ${(bytes / 1024).toFixed(1)} KiB`);
  if (bytes > MAX_BYTES) throw new Error(`og.png is over ${MAX_BYTES / 1024} KiB: pick a calmer scene`);
} finally {
  await browser.close();
  await new Promise<void>((done) => server.httpServer.close(() => done()));
}
