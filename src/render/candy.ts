// The canvas side of the "Candy" look (docs/UI_V2.md §9.1): the palette mirrored from src/ui/kit.css,
// the display font, outlined text and the candy shapes the HUD, cards, stamps and toasts draw into
// their cached layers and sprites. Nothing here draws per frame by itself (§9.10): callers render
// these into offscreen canvases and blit them.
//
// Fonts: src/ui/fonts.ts adds Lilita One to document.fonts at import time; the render layer may not
// import ui (tests/unit/architecture.test.ts), so it asks document.fonts itself. onDisplayFont() calls
// back once the face is usable and bumps `fontGen`, which text caches put in their keys so nothing
// keeps a layer built with the fallback face.

export const INK = '#2A1B45';
export const INK_2 = '#4E3A6E';
export const DISPLAY = "'Lilita One', 'Arial Rounded MT Bold', system-ui, sans-serif";
export const BODY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Lilita One at `px` (always weight 400: asking for a bold makes Chrome fake one). */
export const displayFont = (px: number): string => `400 ${Math.round(px)}px ${DISPLAY}`;
/** The body face for sentences on canvas (tips, blurbs): system UI at 700-800. */
export const bodyFont = (px: number, weight = 700): string => `${weight} ${Math.round(px)}px ${BODY}`;

/** A candy face, top to bottom: highlight, face, shade, lip (the extruded bottom band). */
export type Face = readonly [hi: string, face: string, lo: string, lip: string];
export const FACE = {
  green: ['#B4F25E', '#69D33B', '#43B226', '#2C8416'],
  blue: ['#8EDBFF', '#3FAEF7', '#2189E6', '#1660B4'],
  gold: ['#FFF07A', '#FFCB2B', '#FFA51C', '#CF6F00'],
  pink: ['#FFA3C0', '#FF6390', '#EE3D6E', '#AE2453'],
  violet: ['#D7B0FF', '#A26AF7', '#8550EC', '#5B2EB4'],
  red: ['#FF9A6E', '#FF6A45', '#F0472C', '#B0301A'],
  cloud: ['#FFFFFF', '#F4F1FB', '#DCD5EC', '#A99CC6'],
  ice: ['#E9F6FF', '#9ED8FF', '#4FA9EE', '#2D7FC8'],
} as const satisfies Record<string, Face>;
export type FaceName = keyof typeof FACE;

export const CREAM = '#FFF8E6';
export const CREAM_2 = '#FFEDC2';
export const CREAM_3 = '#EBC982';
export const SLOT_1 = '#3B2A5A';
export const SLOT_2 = '#4E3B6C';
export const SLOT_SUB = '#FFE58A';
/** Accent text on cream (each ≥ 4.5:1 on CREAM), as the --t-* tokens the canvas uses. */
export const TEXT = { green: '#136E4E', amber: '#B5560A', orange: '#C9470F', brown: '#8A4B00' } as const;

// ---------------------------------------------------------------------------------------------
// The display font
// ---------------------------------------------------------------------------------------------

/** Bumped once when Lilita One becomes usable: put it in every key of a cache that holds text. */
export let fontGen = 0;
let fontState: 'idle' | 'waiting' | 'ready' = 'idle';
const fontWaiters: (() => void)[] = [];

/**
 * Calls `cb` once the display face is loaded (at once if it already is). Never calls back where
 * document.fonts is missing (node, old browsers): the fallback faces were measured from the start.
 */
export function onDisplayFont(cb: () => void): void {
  if (fontState === 'ready') {
    cb();
    return;
  }
  fontWaiters.push(cb);
  if (fontState === 'waiting' || typeof document === 'undefined' || !document.fonts) return;
  fontState = 'waiting';
  const fonts = document.fonts;
  const settle = (faces: readonly FontFace[]): void => {
    if (faces.length === 0) {
      // The face isn't in the set yet (the UI adds it as it loads): try again when loading ends.
      fontState = 'idle';
      fonts.addEventListener('loadingdone', () => onDisplayFont(() => {}), { once: true });
      return;
    }
    fontState = 'ready';
    fontGen += 1;
    for (const w of fontWaiters.splice(0)) w();
  };
  fonts.load(displayFont(20)).then(settle, () => {
    fontState = 'idle';
  });
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

/**
 * White (or `fill`) display text with an ink halo and a hard ink drop (§4.2 on canvas); set
 * textAlign and textBaseline before calling. `px` is the font size in canvas units.
 */
export function outlined(g: CanvasRenderingContext2D, t: string, x: number, y: number, px: number, fill = '#fff', maxW?: number, halo = 0.24): void {
  g.font = displayFont(px);
  // The halo eats into Lilita's word gaps: 0.12em more keeps "TAP OR DRAG" three words.
  g.wordSpacing = `${(px * 0.12).toFixed(1)}px`;
  g.lineJoin = 'round';
  g.miterLimit = 2;
  g.lineWidth = px * halo;
  g.strokeStyle = INK;
  g.fillStyle = INK;
  const dy = Math.max(1, px * 0.1);
  // An undefined maxWidth is the same as none (WebIDL optional argument).
  g.strokeText(t, x, y + dy, maxW);
  g.fillText(t, x, y + dy, maxW);
  g.strokeText(t, x, y, maxW);
  g.fillStyle = fill;
  g.fillText(t, x, y, maxW);
  g.wordSpacing = '0px';
}

/** Plain display text in `fill` (ink by default): panel titles and labels on cream, no halo. */
export function inkText(g: CanvasRenderingContext2D, t: string, x: number, y: number, px: number, fill = INK, maxW?: number): void {
  g.font = displayFont(px);
  g.fillStyle = fill;
  g.fillText(t, x, y, maxW);
}

// ---------------------------------------------------------------------------------------------
// Shapes (k = the HUD scale: line widths and offsets follow it)
// ---------------------------------------------------------------------------------------------

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

export interface CandyOptions {
  /** Height of the lip band at the bottom (default 6k). */
  lip?: number;
  /** The hard ink drop under the shape (default 4k). */
  drop?: number;
  /** The ink outline width (default 3k). */
  line?: number;
  /** The gloss cap on the top half (default true; off for chips, plates and small things). */
  gloss?: boolean;
  /** Flat face, no gloss (high contrast). */
  flat?: boolean;
}

/** A candy face (§5): ink drop, face gradient, lip band, top light, gloss cap, ink outline. */
export function candyRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, face: Face, k = 1, o: CandyOptions = {}): void {
  const lip = o.lip ?? 6 * k;
  const drop = o.drop ?? 4 * k;
  const line = o.line ?? 3 * k;
  if (drop > 0) {
    g.fillStyle = INK;
    rr(g, x, y + drop, w, h, r);
    g.fill();
  }
  g.save();
  rr(g, x, y, w, h, r);
  if (o.flat) g.fillStyle = face[1];
  else {
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, face[0]);
    grad.addColorStop(0.46, face[1]);
    grad.addColorStop(1, face[2]);
    g.fillStyle = grad;
  }
  g.fill();
  g.clip();
  if (lip > 0) {
    g.fillStyle = face[3];
    g.fillRect(x, y + h - lip, w, lip);
  }
  // The top light.
  g.fillStyle = 'rgba(255,255,255,0.65)';
  g.fillRect(x, y, w, 2 * k);
  if (o.gloss !== false && !o.flat) {
    const gx = x + 7 * k;
    const gw = w - 14 * k;
    const gh = (h - lip) * 0.42;
    const cap = g.createLinearGradient(0, y + 4 * k, 0, y + 4 * k + gh);
    cap.addColorStop(0, 'rgba(255,255,255,0.75)');
    cap.addColorStop(1, 'rgba(255,255,255,0.12)');
    g.fillStyle = cap;
    rr(g, gx, y + 4 * k, gw, gh, Math.max(0, r - 6 * k));
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(gx + 6 * k, y + 8 * k, 3.4 * k, 2.2 * k, -0.4, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  g.lineWidth = line;
  g.strokeStyle = INK;
  rr(g, x, y, w, h, r);
  g.stroke();
}

/** A cream plate (§6.3): white → cream face, a cream-3 bottom bevel, ink outline (`line`, 3k; 4k in high contrast) and a hard drop. */
export function plate(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, k = 1, line = 3 * k): void {
  candyRect(g, x, y, w, h, r, PLATE, k, { lip: 4 * k, drop: 3 * k, line, gloss: false });
}
const PLATE: Face = ['#FFFFFF', '#FFFBF0', CREAM, CREAM_3];

/** A flat chip or pill (§6.7): `fill` face (a colour or a gradient), an ink outline (2.5k) and a small ink drop (2k). */
export function chip(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient, k = 1, line = 2.5 * k): void {
  g.fillStyle = INK;
  rr(g, x, y + 2 * k, w, h, r);
  g.fill();
  g.fillStyle = fill;
  rr(g, x, y, w, h, r);
  g.fill();
  g.lineWidth = line;
  g.strokeStyle = INK;
  g.stroke();
}

/** A sunk cream well (§6.3) for things nested in a panel: cream-2, a cream-3 top bevel and a faint ink ring. */
export function well(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, k = 1): void {
  g.save();
  rr(g, x, y, w, h, r);
  g.fillStyle = CREAM_2;
  g.fill();
  g.clip();
  g.fillStyle = CREAM_3;
  g.fillRect(x, y, w, 3 * k);
  g.restore();
  g.lineWidth = 2 * k;
  g.strokeStyle = 'rgba(42,27,69,0.12)';
  rr(g, x + k, y + k, w - 2 * k, h - 2 * k, Math.max(0, r - k));
  g.stroke();
}

/**
 * A framed cream panel (§6.3) as one shape: the ink drop (and a faint second drop for the soft
 * shadow), a 4k ink border, the coloured frame band (8k), the
 * 3k inner ink line and the cream face with its top shade. Returns the cream's inset from the edge.
 */
export function panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, frame: Face, k = 1, flat = false): number {
  g.fillStyle = 'rgba(42,27,69,0.22)';
  rr(g, x, y + 12 * k, w, h, r);
  g.fill();
  g.fillStyle = INK;
  rr(g, x, y + 6 * k, w, h, r);
  g.fill();
  rr(g, x, y, w, h, r);
  g.fill();
  const b = 4 * k;
  rr(g, x + b, y + b, w - 2 * b, h - 2 * b, r - b);
  if (flat) g.fillStyle = frame[1];
  else {
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, frame[0]);
    grad.addColorStop(0.3, frame[1]);
    grad.addColorStop(1, frame[2]);
    g.fillStyle = grad;
  }
  g.fill();
  const f = b + 8 * k;
  g.fillStyle = INK;
  rr(g, x + f, y + f, w - 2 * f, h - 2 * f, r - f);
  g.fill();
  const c = f + 3 * k;
  g.save();
  rr(g, x + c, y + c, w - 2 * c, h - 2 * c, r - c);
  g.fillStyle = CREAM;
  g.fill();
  g.clip();
  g.fillStyle = 'rgba(42,27,69,0.10)';
  g.fillRect(x + c, y + c, w - 2 * c, 5 * k);
  g.restore();
  return c;
}

/** A ribbon's band and tail colours (§6.4): hi, face, lo, tail. */
export type RibbonTone = readonly [hi: string, face: string, lo: string, tail: string];
export const RIBBON = {
  red: ['#FF9B6A', '#FF6A45', '#E2401F', '#C5381C'],
  green: ['#B4F25E', '#69D33B', '#43B226', '#2E8C1A'],
  violet: ['#D7B0FF', '#A26AF7', '#8550EC', '#5B2EB4'],
} as const satisfies Record<string, RibbonTone>;

/** The band's height for display text of `px` (the DOM ribbon: 52 at 26 px). */
export const ribbonH = (px: number): number => px * 2;

let tailP: Path2D | null = null;
let foldP: Path2D | null = null;

/**
 * A ribbon (§6.4) centred on (cx, cy) holding `text` (outlined display text of `px`), with
 * swallowtails tucked under its ends; `textW` is the text's measured width, `bh` the band's height.
 * Returns the whole width (tails included). Draw it into a cached sprite: it is a dozen fills.
 */
export function ribbon(g: CanvasRenderingContext2D, cx: number, cy: number, text: string, textW: number, px: number, tone: RibbonTone, flat = false, bh = ribbonH(px)): number {
  const u = bh / 52;
  const bw = textW + 44 * u;
  const x0 = cx - bw / 2;
  const y0 = cy - bh / 2;
  tailP ??= new Path2D('M2 2H48V44H2L15 23Z');
  foldP ??= new Path2D('M30 2V44');
  g.lineJoin = 'round';
  for (const side of [-1, 1]) {
    g.save();
    // The left tail's box starts 30u outside the band and tucks 20u under it; the right one mirrors it.
    g.translate(side < 0 ? x0 - 30 * u : x0 + bw + 30 * u, y0 + 16 * u);
    g.scale(side * -u, u);
    g.save();
    g.translate(0, 3);
    g.fillStyle = INK;
    g.fill(tailP);
    g.lineWidth = 4;
    g.strokeStyle = INK;
    g.stroke(tailP);
    g.restore();
    g.fillStyle = tone[3];
    g.fill(tailP);
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 5;
    g.stroke(foldP);
    g.strokeStyle = INK;
    g.lineWidth = 4;
    g.stroke(tailP);
    g.restore();
  }
  g.fillStyle = INK;
  rr(g, x0, y0 + 4 * u, bw, bh, 10 * u);
  g.fill();
  g.save();
  rr(g, x0, y0, bw, bh, 10 * u);
  if (flat) g.fillStyle = tone[1];
  else {
    const grad = g.createLinearGradient(0, y0, 0, y0 + bh);
    grad.addColorStop(0, tone[0]);
    grad.addColorStop(0.45, tone[1]);
    grad.addColorStop(1, tone[2]);
    g.fillStyle = grad;
  }
  g.fill();
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(x0, y0, bw, 3 * u);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(x0, y0 + bh - 5 * u, bw, 5 * u);
  g.restore();
  g.lineWidth = 4 * u;
  g.strokeStyle = INK;
  rr(g, x0, y0, bw, bh, 10 * u);
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  outlined(g, text, cx, cy - 1.5 * u, px);
  return bw + 60 * u;
}

/** The embossed dark slot (§6.5): counters, the ruler track, the goal pill. Opaque. */
export function slot(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, k = 1): void {
  g.save();
  rr(g, x, y, w, h, r);
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, SLOT_1);
  grad.addColorStop(1, SLOT_2);
  g.fillStyle = grad;
  g.fill();
  g.clip();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(x, y, w, 3 * k);
  g.restore();
  g.lineWidth = 2.5 * k;
  g.strokeStyle = INK;
  rr(g, x, y, w, h, r);
  g.stroke();
}

/** A round candy coin (medals, the multiplier, the frost meter): drop, radial face, lip arc, ring. */
export function coin(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, face: Face, k = 1, flat = false): void {
  g.fillStyle = INK;
  g.beginPath();
  g.arc(cx, cy + 3 * k, r, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  if (flat) g.fillStyle = face[1];
  else {
    const grad = g.createRadialGradient(cx, cy - r * 0.24, 0, cx, cy - r * 0.24, r * 1.25);
    grad.addColorStop(0, face[0]);
    grad.addColorStop(0.3, face[0]);
    grad.addColorStop(0.62, face[1]);
    grad.addColorStop(1, face[2]);
    g.fillStyle = grad;
  }
  g.fill();
  g.clip();
  // The lip: the bottom of the coin in the lip colour, under a lifted copy of the face edge.
  g.strokeStyle = face[3];
  g.lineWidth = 4 * k;
  g.beginPath();
  g.arc(cx, cy - 2 * k, r, Math.PI * 0.15, Math.PI * 0.85);
  g.stroke();
  g.restore();
  g.lineWidth = 3 * k;
  g.strokeStyle = INK;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
}

/**
 * The comic burst outline (§6.18): 2n spikes around an ellipse, alternate spikes `depth` shorter and
 * every fourth 8 % shorter still, deterministic. Returns the points as a closed path on `g`.
 */
export function burstPath(g: CanvasRenderingContext2D | Path2D, cx: number, cy: number, rx: number, ry: number, n = 14, depth = 0.18): void {
  for (let i = 0; i < 2 * n; i++) {
    const a = (i * Math.PI) / n - Math.PI / 2;
    const r = (i % 2 === 0 ? 1 : 1 - depth) * (i % 4 === 2 ? 0.92 : 1);
    const x = cx + rx * r * Math.cos(a);
    const y = cy + ry * r * Math.sin(a);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

/** A filled comic burst: an ink copy at +4k, then the fill with a 3.5k ink outline, round joins. */
export function burst(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, fill: string, k = 1, n = 14, depth = 0.18): void {
  g.lineJoin = 'round';
  g.fillStyle = INK;
  g.beginPath();
  burstPath(g, cx, cy + 4 * k, rx, ry, n, depth);
  g.fill();
  g.beginPath();
  burstPath(g, cx, cy, rx, ry, n, depth);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 3.5 * k;
  g.strokeStyle = INK;
  g.stroke();
}

// ---------------------------------------------------------------------------------------------
// Stars (§6.12): one path in a 48 × 48 box, shared with the DOM art icons
// ---------------------------------------------------------------------------------------------

export const STAR_D = 'M24 4 L29.88 16.91 L43.97 18.51 L33.51 28.09 L36.34 41.99 L24 35 L11.66 41.99 L14.49 28.09 L4.03 18.51 L18.12 16.91 Z';
const STAR_SHADE = 'M24 9.5 L28.3 19 L38.6 20.2';

let starP: Path2D | null = null;
let shadeP: Path2D | null = null;

/** The star as a Path2D in its 48 × 48 box (created on first use: unit tests run in node). */
export function starPath(): Path2D {
  if (!starP) starP = new Path2D(STAR_D);
  return starP;
}

export type StarState = 'on' | 'off' | 'lost';

/** Draws a star of `px` size with its top-left at (x, y): earned, an empty socket, or lost. */
export function drawStar(g: CanvasRenderingContext2D, x: number, y: number, px: number, state: StarState): void {
  const s = px / 48;
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.lineJoin = 'round';
  g.lineWidth = 3.5;
  const p = starPath();
  if (state === 'on') {
    const grad = g.createLinearGradient(0, 4, 0, 42);
    grad.addColorStop(0, '#FFF27A');
    grad.addColorStop(0.55, '#FFC81F');
    grad.addColorStop(1, '#FF9A0A');
    g.fillStyle = grad;
    g.fill(p);
    g.globalAlpha = 0.85;
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(18.5, 20.5, 2.6, 5.2, (38 * Math.PI) / 180, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = INK;
    g.stroke(p);
  } else if (state === 'off') {
    g.fillStyle = '#4A3768';
    g.fill(p);
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 2.5;
    g.stroke((shadeP ??= new Path2D(STAR_SHADE)));
    g.lineWidth = 3.5;
    g.strokeStyle = INK;
    g.stroke(p);
  } else {
    g.fillStyle = '#CFC6DD';
    g.fill(p);
    g.globalAlpha = 0.55;
    g.strokeStyle = INK;
    g.stroke(p);
    g.globalAlpha = 1;
    g.lineWidth = 2 / s;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(12, 38);
    g.lineTo(36, 10);
    g.stroke();
  }
  g.restore();
}

const starSprites = new Map<number, HTMLCanvasElement>();

/**
 * A cached star sprite, `px` CSS px square drawn at `dpr` (with 2 px of margin for the outline).
 * Draw it with drawImage(sprite, x - 2, y - 2, px + 4, px + 4).
 */
export function starSprite(px: number, dpr: number, state: StarState): HTMLCanvasElement {
  // A numeric key (no string per call: the pops and the FINISH stars ask every frame).
  const key = (Math.round(px * 4) * 64 + Math.round(dpr * 8)) * 4 + (state === 'on' ? 0 : state === 'off' ? 1 : 2);
  let c = starSprites.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  const size = Math.ceil((px + 4) * dpr);
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (g) {
    g.scale(dpr, dpr);
    drawStar(g, 2, 2, px, state);
  }
  starSprites.set(key, c);
  return c;
}

/** Drops cached sprites (resize, a dpr change). */
export function clearCandySprites(): void {
  starSprites.clear();
}
