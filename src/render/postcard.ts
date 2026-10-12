// The postcard (GR14, A11): a 1080×1350 (4:5) PNG of the run on paper. Its map panel is a cover-crop
// of the main canvas once the Melt Map has settled (no second renderer), under the guilty sun in the
// equipped shades; then the score, the death line, the last two days as vector hour tiles (never
// emoji) with each day's forecast glyph, and a footer with the wordmark and the full challenge link.
// It is built in stages, one per idle callback (crop, header, tiles and footer, encode), so no stage
// holds the main thread for long.

import type { HourGlyph } from '../core/index.ts';
import { drawForecastGlyph } from './glyphs.ts';
import type { ForecastId, ShadesLook } from './shims.ts';
import { ctx2d, flake, makeCanvas, roundRect, type Canvas2D } from './sprites.ts';
import { createSunGlyph, drawSun } from './sun.ts';

export const POSTCARD_W = 1080;
export const POSTCARD_H = 1350;
const PAPER = '#FFF8EE';
const INK = '#2B2140';
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
/** The map panel: full width, as tall as the source's shape asks within 440-820 px (little upscaling). */
const MAP_X = 40;
const MAP_Y = 40;
const MAP_W = 1000;
const SUN_R = 70;
const FOOTER_TOP = 1236;
const TILE = 60;
const GAP = 8;

export interface PostcardInput {
  /** The main canvas and the settled map's region in it (device px). */
  source: CanvasImageSource;
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  /** The puddle's x in the source (device px): the crop centres on it. */
  focusX: number;
  /** The Melt Map's callout boxes in the source (device px, x y w h each): the sun keeps off them. */
  callouts: readonly number[];
  day: number;
  /** "2:40 PM". */
  time: string;
  deathLine: string;
  /** Hour glyphs and forecast of the last one or two days, oldest first; complete days get a moon. */
  days: readonly (readonly HourGlyph[])[];
  forecasts: readonly ForecastId[];
  /** 'Daily #12' for a Daily, else ''. */
  daily: string;
  /** The challenge link ('' when there is no web address). */
  url: string;
  shades: ShadesLook;
  /** The wordmark's layers (shadow, word), drawn in order when they have loaded. */
  logo: readonly HTMLImageElement[];
}

export interface PostcardJob {
  readonly inp: PostcardInput;
  readonly canvas: Canvas2D;
  readonly g: CanvasRenderingContext2D;
  /** The map panel's height, the crop (source device px) it shows, and where the text block starts. */
  readonly mapH: number;
  readonly crop: Float64Array;
  readonly textTop: number;
  /** Next stage (0 crop, 1 header, 2 tiles and footer, 3 encode, 4 done). */
  stage: number;
  /** Milliseconds each stage took. */
  readonly stageMs: number[];
}

export function createPostcardJob(inp: PostcardInput): PostcardJob {
  const canvas = makeCanvas(POSTCARD_W, POSTCARD_H);
  const mapH = Math.round(Math.max(440, Math.min(820, (MAP_W * inp.srcH) / inp.srcW)));
  // Cover-crop: fill the panel, centred on the puddle as far as the source allows.
  const k = Math.max(MAP_W / inp.srcW, mapH / inp.srcH);
  const cw = MAP_W / k;
  const ch = mapH / k;
  const cx = Math.max(inp.srcX, Math.min(inp.srcX + inp.srcW - cw, inp.focusX - cw / 2));
  const cy = inp.srcY + (inp.srcH - ch) / 2;
  // The text block (score, death line, tile rows) takes a third of the spare room above it.
  const block = 292 + inp.days.length * (TILE + GAP) - GAP;
  const textTop = MAP_Y + mapH + Math.max(0, (FOOTER_TOP - MAP_Y - mapH - block) / 3);
  return { inp, canvas, g: ctx2d(canvas), mapH, crop: Float64Array.of(cx, cy, cw, ch), textTop, stage: 0, stageMs: [] };
}

/** Runs the next drawing stage; true once only the encode is left (stage 3). */
export function stepPostcard(job: PostcardJob): boolean {
  const t0 = performance.now();
  const g = job.g;
  if (job.stage === 0) drawMapPanel(g, job);
  else if (job.stage === 1) drawHeader(g, job);
  else if (job.stage === 2) drawTilesAndFooter(g, job);
  if (job.stage < 3) {
    job.stageMs.push(performance.now() - t0);
    job.stage++;
  }
  return job.stage >= 3;
}

/** The postcard's file name: 'shady-day2-240pm.png'. */
export function postcardName(day: number, time: string): string {
  return `shady-day${day}-${time.toLowerCase().replace(/[^0-9apm]/g, '')}.png`;
}

function drawMapPanel(g: CanvasRenderingContext2D, job: PostcardJob): void {
  const h = job.mapH;
  const c = job.crop;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, POSTCARD_W, POSTCARD_H);
  g.save();
  g.fillStyle = 'rgba(43,33,64,0.14)';
  roundRect(g, MAP_X, MAP_Y + 8, MAP_W, h, 36);
  g.fill();
  roundRect(g, MAP_X, MAP_Y, MAP_W, h, 36);
  g.clip();
  g.drawImage(job.inp.source, c[0] as number, c[1] as number, c[2] as number, c[3] as number, MAP_X, MAP_Y, MAP_W, h);
  g.restore();
  g.strokeStyle = 'rgba(43,33,64,0.18)';
  g.lineWidth = 3;
  roundRect(g, MAP_X + 1.5, MAP_Y + 1.5, MAP_W - 3, h - 3, 35);
  g.stroke();
}

/** Whether a sun at (x, y) on the card would cover one of the map's callouts. */
function coversCallout(job: PostcardJob, x: number, y: number): boolean {
  const c = job.crop;
  const k = MAP_W / (c[2] as number);
  const b = job.inp.callouts;
  const r = SUN_R * 1.7;
  for (let i = 0; i + 3 < b.length; i += 4) {
    const bx = MAP_X + ((b[i] as number) - (c[0] as number)) * k;
    const by = MAP_Y + ((b[i + 1] as number) - (c[1] as number)) * k;
    const bw = (b[i + 2] as number) * k;
    const bh = (b[i + 3] as number) * k;
    if (x + r > bx && x - r < bx + bw && y + r > by && y - r < by + bh) return true;
  }
  return false;
}

function drawHeader(g: CanvasRenderingContext2D, job: PostcardJob): void {
  const inp = job.inp;
  const top = job.textTop;
  // The guilty sun over a top corner of the map (the right one unless a callout sits there).
  const sun = createSunGlyph();
  sun.x = MAP_X + MAP_W - SUN_R;
  sun.y = MAP_Y + 62;
  if (coversCallout(job, sun.x, sun.y) && !coversCallout(job, MAP_X + SUN_R, sun.y)) sun.x = MAP_X + SUN_R;
  sun.init = true;
  sun.guilty = 1;
  drawSun(g, sun, 'guilty', 0.4, SUN_R / 20, 1, 0, 0, inp.shades);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillStyle = '#6B6280';
  g.font = `800 30px ${SANS}`;
  spaced(g, 'NUBS MADE IT TO', MAP_X + 8, top + 62, 3.6);
  // The day pill and the time.
  g.font = `800 56px ${SANS}`;
  const day = `Day ${inp.day}`;
  const pw = g.measureText(day).width + 44;
  g.fillStyle = INK;
  roundRect(g, MAP_X + 8, top + 88, pw, 76, 38);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.textBaseline = 'middle';
  g.fillText(day, MAP_X + 30, top + 128);
  g.fillStyle = INK;
  g.font = `900 104px ${SANS}`;
  g.fillText(inp.time, MAP_X + 8 + pw + 22, top + 130);
  // The death line: two lines at most, the second ending in an ellipsis when it runs over.
  g.font = `600 32px ${SANS}`;
  g.fillStyle = '#4A4060';
  g.textBaseline = 'alphabetic';
  const lines = wrap(g, inp.deathLine, MAP_W - 16, 2);
  for (let i = 0; i < lines.length; i++) g.fillText(lines[i] as string, MAP_X + 8, top + 214 + i * 40);
}

function drawTilesAndFooter(g: CanvasRenderingContext2D, job: PostcardJob): void {
  const inp = job.inp;
  const rows = inp.days.length;
  const top = job.textTop + 292;
  for (let r = 0; r < rows; r++) {
    const y = top + r * (TILE + GAP);
    const hours = inp.days[r] as readonly HourGlyph[];
    let x = MAP_X + 8;
    const fc = inp.forecasts[r] ?? 'clear';
    if (fc !== 'clear') {
      drawForecastGlyph(g, fc, x + TILE / 2, y + TILE / 2, 44);
      x += TILE + GAP;
    }
    for (const h of hours) {
      hourTile(g, h, x, y);
      x += TILE + GAP;
    }
    if (hours.length === 12) moonTile(g, x, y);
  }
  // Footer: the wordmark, the Daily's number and the full link.
  const fy = 1262;
  for (const img of inp.logo) {
    if (img.complete && img.naturalWidth > 0) g.drawImage(img, MAP_X - 4, POSTCARD_H - 34 - 84, (84 * img.naturalWidth) / img.naturalHeight, 84);
  }
  g.textAlign = 'right';
  g.textBaseline = 'alphabetic';
  const right = MAP_X + MAP_W;
  if (inp.daily) {
    g.fillStyle = INK;
    g.font = `800 26px ${SANS}`;
    g.fillText(inp.daily, right, fy + 22);
  }
  if (inp.url) {
    g.fillStyle = '#6B6280';
    g.font = `600 19px ${SANS}`;
    const lines = breakAnywhere(g, `Beat it → ${inp.url}`, MAP_W - 260, inp.daily ? 2 : 3);
    const y0 = inp.daily ? fy + 50 : fy + 22;
    for (let i = 0; i < lines.length; i++) g.fillText(lines[i] as string, right, y0 + i * 24);
  }
  g.textAlign = 'left';
}

/** Text with `sp` px of extra space after each glyph. */
function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, sp: number): void {
  let cx = x;
  for (const ch of text) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + sp;
  }
}

/** Word-wraps `text` to `max` px in at most `n` lines (the last one ellipsized). */
function wrap(g: CanvasRenderingContext2D, text: string, max: number, n: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : (words[i] as string);
    if (g.measureText(next).width <= max || !line) {
      line = next;
      continue;
    }
    if (out.length === n - 1) {
      out.push(ellipsize(g, `${line} ${words.slice(i).join(' ')}`, max));
      return out;
    }
    out.push(line);
    line = words[i] as string;
  }
  if (line) out.push(out.length === n - 1 ? ellipsize(g, line, max) : line);
  return out;
}

function ellipsize(g: CanvasRenderingContext2D, s: string, max: number): string {
  if (g.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Breaks a link anywhere so it all shows, in at most `n` lines of `max` px. */
function breakAnywhere(g: CanvasRenderingContext2D, s: string, max: number, n: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest && out.length < n) {
    let k = rest.length;
    while (k > 1 && g.measureText(rest.slice(0, k)).width > max) k--;
    out.push(rest.slice(0, k));
    rest = rest.slice(k);
  }
  return out;
}

function hourTile(g: CanvasRenderingContext2D, h: HourGlyph, x: number, y: number): void {
  const fill = h === 'cool' ? '#9AD8FF' : h === 'warm' ? '#FFD36B' : h === 'hot' ? '#FF6A3D' : '#2EC4B6';
  g.fillStyle = fill;
  roundRect(g, x, y, TILE, TILE, 14);
  g.fill();
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;
  if (h === 'cool') {
    g.drawImage(flake(), cx - 20, cy - 20, 40, 40);
  } else if (h === 'hot') {
    // A flame.
    g.fillStyle = '#FFE27A';
    g.beginPath();
    g.moveTo(cx, cy - 20);
    g.bezierCurveTo(cx + 18, cy - 4, cx + 14, cy + 18, cx, cy + 18);
    g.bezierCurveTo(cx - 14, cy + 18, cx - 18, cy - 2, cx - 4, cy - 10);
    g.bezierCurveTo(cx - 4, cy - 2, cx, cy, cx, cy - 20);
    g.fill();
  } else if (h === 'melt') {
    // A drop.
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.moveTo(cx, cy - 19);
    g.bezierCurveTo(cx + 6, cy - 8, cx + 15, cy + 2, cx + 15, cy + 8);
    g.arc(cx, cy + 8, 15, 0, Math.PI);
    g.bezierCurveTo(cx - 15, cy + 2, cx - 6, cy - 8, cx, cy - 19);
    g.fill();
  }
}

function moonTile(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.fillStyle = '#1D2247';
  roundRect(g, x, y, TILE, TILE, 14);
  g.fill();
  g.fillStyle = '#E8ECFF';
  g.beginPath();
  g.arc(x + 30, y + 30, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1D2247';
  g.beginPath();
  g.arc(x + 38, y + 24, 14, 0, Math.PI * 2);
  g.fill();
}
