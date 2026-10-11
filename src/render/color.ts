// Small color toolkit for the renderer: packed 0xRRGGBB ints, mixing, and a bounded cache of CSS
// strings so per-frame palette work does not allocate a fresh string for every fill.

export type Rgb = number; // 0xRRGGBB

export function hex(s: string): Rgb {
  const h = s.charAt(0) === '#' ? s.slice(1) : s;
  return parseInt(h, 16) & 0xffffff;
}

export function rgb(r: number, g: number, b: number): Rgb {
  return (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
}

function clampByte(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

export const red = (c: Rgb): number => (c >> 16) & 255;
export const green = (c: Rgb): number => (c >> 8) & 255;
export const blue = (c: Rgb): number => c & 255;

/** Linear RGB mix: t = 0 → a, t = 1 → b. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return rgb(red(a) + (red(b) - red(a)) * t, green(a) + (green(b) - green(a)) * t, blue(a) + (blue(b) - blue(a)) * t);
}

/** Per-channel multiply (c × m / 255), like a multiply blend with an opaque layer. */
export function multiply(c: Rgb, m: Rgb): Rgb {
  return rgb((red(c) * red(m)) / 255, (green(c) * green(m)) / 255, (blue(c) * blue(m)) / 255);
}

/** Darken toward black by t (0..1). */
export function darken(c: Rgb, t: number): Rgb {
  return mix(c, 0x000000, t);
}

/** Lighten toward white by t (0..1). */
export function lighten(c: Rgb, t: number): Rgb {
  return mix(c, 0xffffff, t);
}

/** Relative luminance-ish (0..1), good enough for contrast decisions. */
export function luma(c: Rgb): number {
  return (0.2126 * red(c) + 0.7152 * green(c) + 0.0722 * blue(c)) / 255;
}

const cssCache = new Map<number, string>();

/** '#rrggbb' for a packed color (cached; the cache is cleared when it grows large). */
export function css(c: Rgb): string {
  let s = cssCache.get(c);
  if (s === undefined) {
    if (cssCache.size > 4096) cssCache.clear();
    s = '#' + (0x1000000 + c).toString(16).slice(1);
    cssCache.set(c, s);
  }
  return s;
}

const cssaCache = new Map<number, string>();

/** 'rgba(r,g,b,a)' with alpha quantized to 1/100 (cached). */
export function cssa(c: Rgb, a: number): string {
  const q = a <= 0 ? 0 : a >= 1 ? 100 : Math.round(a * 100);
  const key = c * 128 + q;
  let s = cssaCache.get(key);
  if (s === undefined) {
    if (cssaCache.size > 4096) cssaCache.clear();
    s = `rgba(${red(c)},${green(c)},${blue(c)},${q / 100})`;
    cssaCache.set(key, s);
  }
  return s;
}
