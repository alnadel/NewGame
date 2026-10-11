// Pre-rendered sprites (TECH_SPEC §9.9): glows, the sun bloom, flakes, sparkles, edge vignettes and
// the two ground detail tiles. Built lazily and cached; tiles are rebuilt when the pixel scale
// changes. All procedural: no image files.

export type Canvas2D = HTMLCanvasElement;

export function makeCanvas(w: number, h: number): Canvas2D {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: Canvas2D): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return g;
}

/** Tiny deterministic PRNG so tiles look the same every session. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const radialCache = new Map<string, Canvas2D>();

/**
 * A radial glow sprite: `color` (css rgb triplet "r,g,b") from alpha a0 at the center to 0 at the
 * edge, `size` px square. Optional mid stop shapes the falloff.
 */
export function radialSprite(rgbTriplet: string, size: number, a0: number, mid = 0.45, aMid = -1): Canvas2D {
  const key = `${rgbTriplet}|${size}|${a0}|${mid}|${aMid}`;
  let c = radialCache.get(key);
  if (c) return c;
  c = makeCanvas(size, size);
  const g = ctx2d(c);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${rgbTriplet},${a0})`);
  grad.addColorStop(mid, `rgba(${rgbTriplet},${aMid >= 0 ? aMid : a0 * 0.45})`);
  grad.addColorStop(1, `rgba(${rgbTriplet},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  radialCache.set(key, c);
  return c;
}

let flakeSprite: Canvas2D | null = null;

/** A 6-arm snowflake star, white with a soft blue edge (64 px). */
export function flake(): Canvas2D {
  if (flakeSprite) return flakeSprite;
  const s = 64;
  const c = makeCanvas(s, s);
  const g = ctx2d(c);
  g.translate(s / 2, s / 2);
  g.lineCap = 'round';
  const arms = (width: number, color: string): void => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      g.moveTo(0, 0);
      g.lineTo(ca * 24, sa * 24);
      // Barbs.
      const bx = ca * 14;
      const by = sa * 14;
      for (const side of [-1, 1]) {
        const b = a + side * 0.8;
        g.moveTo(bx, by);
        g.lineTo(bx + Math.cos(b) * 8, by + Math.sin(b) * 8);
      }
    }
    g.stroke();
  };
  arms(9, 'rgba(110,190,255,0.55)');
  arms(5, '#FFFFFF');
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(0, 0, 5, 0, Math.PI * 2);
  g.fill();
  flakeSprite = c;
  return c;
}

let sparkleSprite: Canvas2D | null = null;

/** A 4-point twinkle (32 px), white. */
export function sparkle(): Canvas2D {
  if (sparkleSprite) return sparkleSprite;
  const s = 32;
  const c = makeCanvas(s, s);
  const g = ctx2d(c);
  const m = s / 2;
  const glow = g.createRadialGradient(m, m, 0, m, m, m);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.moveTo(m, 1);
  g.quadraticCurveTo(m + 2, m - 2, s - 1, m);
  g.quadraticCurveTo(m + 2, m + 2, m, s - 1);
  g.quadraticCurveTo(m - 2, m + 2, 1, m);
  g.quadraticCurveTo(m - 2, m - 2, m, 1);
  g.fill();
  sparkleSprite = c;
  return c;
}

const vignetteCache = new Map<string, Canvas2D>();

/** Edge vignette: transparent center, `rgbTriplet` at the edges (stretched over the viewport). */
export function vignette(rgbTriplet: string): Canvas2D {
  let c = vignetteCache.get(rgbTriplet);
  if (c) return c;
  const s = 128;
  c = makeCanvas(s, s);
  const g = ctx2d(c);
  const grad = g.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s * 0.72);
  grad.addColorStop(0, `rgba(${rgbTriplet},0)`);
  grad.addColorStop(0.6, `rgba(${rgbTriplet},0.45)`);
  grad.addColorStop(1, `rgba(${rgbTriplet},1)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  vignetteCache.set(rgbTriplet, c);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Ground detail tiles (GDD §10): neutral black/white marks at low alpha over the LUT ground.
// ---------------------------------------------------------------------------------------------

export const TILE_U = 256;

interface TileSet {
  scale: number;
  meadow: Canvas2D;
  town: Canvas2D;
}

let tiles: TileSet | null = null;

/** Tiles for `pxPerU` device pixels per world unit (capped at 512 px per tile). */
export function groundTiles(pxPerU: number): TileSet {
  const scale = Math.min(512 / TILE_U, Math.max(0.5, Math.round(pxPerU * 4) / 4));
  if (tiles && tiles.scale === scale) return tiles;
  tiles = { scale, meadow: meadowTile(scale), town: townTile(scale) };
  return tiles;
}

/** Draws `fn` at (x, y) and its wrapped copies so the tile repeats seamlessly. */
function wrapped(x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (const dx of [-TILE_U, 0, TILE_U]) {
    for (const dy of [-TILE_U, 0, TILE_U]) {
      const px = x + dx;
      const py = y + dy;
      if (px < -r || py < -r || px > TILE_U + r || py > TILE_U + r) continue;
      fn(px, py);
    }
  }
}

function meadowTile(scale: number): Canvas2D {
  const c = makeCanvas(TILE_U * scale, TILE_U * scale);
  const g = ctx2d(c);
  g.scale(scale, scale);
  const rnd = lcg(7);
  g.lineCap = 'round';
  // Soft mottling: big faint blotches so the ground is never flat.
  for (let i = 0; i < 9; i++) {
    const x = rnd() * TILE_U;
    const y = rnd() * TILE_U;
    const r = 26 + rnd() * 40;
    const dark = rnd() < 0.5;
    wrapped(x, y, r, (px, py) => {
      const grad = g.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, dark ? 'rgba(60,80,20,0.07)' : 'rgba(255,255,255,0.08)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  // Grass tufts: three-stroke V shapes.
  for (let i = 0; i < 70; i++) {
    const x = rnd() * TILE_U;
    const y = rnd() * TILE_U;
    const s = 2.6 + rnd() * 2.4;
    const light = rnd() < 0.3;
    g.strokeStyle = light ? 'rgba(255,255,255,0.16)' : 'rgba(40,60,20,0.13)';
    g.lineWidth = 1.1;
    wrapped(x, y, 8, (px, py) => {
      g.beginPath();
      g.moveTo(px - s * 0.7, py - s);
      g.lineTo(px - s * 0.1, py + s * 0.3);
      g.moveTo(px, py - s * 1.25);
      g.lineTo(px, py + s * 0.3);
      g.moveTo(px + s * 0.7, py - s);
      g.lineTo(px + s * 0.1, py + s * 0.3);
      g.stroke();
    });
  }
  // Tiny flower dots in small clusters.
  for (let i = 0; i < 14; i++) {
    const cx = rnd() * TILE_U;
    const cy = rnd() * TILE_U;
    const n = 2 + Math.floor(rnd() * 3);
    const white = rnd() < 0.6;
    g.fillStyle = white ? 'rgba(255,255,255,0.32)' : 'rgba(120,40,90,0.14)';
    for (let j = 0; j < n; j++) {
      const x = cx + (rnd() - 0.5) * 12;
      const y = cy + (rnd() - 0.5) * 12;
      wrapped(x, y, 4, (px, py) => {
        g.beginPath();
        g.arc(px, py, 1.3, 0, Math.PI * 2);
        g.fill();
      });
    }
  }
  return c;
}

function townTile(scale: number): Canvas2D {
  const c = makeCanvas(TILE_U * scale, TILE_U * scale);
  const g = ctx2d(c);
  g.scale(scale, scale);
  const rnd = lcg(11);
  // Irregular cobbles in loose rows: a light face and a soft darker lower lip, no hard joints.
  const rowH = 12.8;
  const rows = TILE_U / rowH;
  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    let x = -rnd() * 10;
    while (x < TILE_U) {
      const w = 9 + rnd() * 9;
      const jy = (rnd() - 0.5) * 1.6;
      const bx = x + 1.4;
      const by = y + 1.4 + jy;
      const bw = w - 2.8;
      const bh = rowH - 2.8;
      const light = 0.05 + rnd() * 0.06;
      for (const dx of [0, TILE_U]) {
        if (dx > 0 && x + w <= TILE_U) continue;
        g.fillStyle = `rgba(255,255,255,${light.toFixed(3)})`;
        roundRect(g, bx - dx, by, bw, bh, 4.2);
        g.fill();
        g.fillStyle = 'rgba(60,30,10,0.045)';
        roundRect(g, bx - dx + 1, by + bh * 0.6, bw - 2, bh * 0.4, 3);
        g.fill();
      }
      x += w;
    }
  }
  // A few worn flagstones and scattered pebbles break up the rows.
  for (let i = 0; i < 6; i++) {
    const x = rnd() * TILE_U;
    const y = rnd() * TILE_U;
    const w = 20 + rnd() * 14;
    const h = 14 + rnd() * 8;
    wrapped(x, y, 40, (px, py) => {
      g.fillStyle = 'rgba(255,255,255,0.06)';
      roundRect(g, px, py, w, h, 3);
      g.fill();
    });
  }
  return c;
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}
