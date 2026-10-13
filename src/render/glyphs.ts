// Small vector art stored as path ops and parsed once into Path2D objects: the glyphs (GR10: the
// forecast marks of the HUD sticker and the postcard rows, the biome marks of the Day card, the
// goal ring, the padlock and wind marks, one mark per campaign concept for the intro card and the
// HUD) on a 14-unit grid centred on 0, and the ground decals of decor.ts. An op is
//   F<color> <path>  fill            E<color> <path>  fill (even-odd)
//   S<color>/<width> <path>  stroke  D<color>/<width> <path>  dotted stroke (1.5 dashes)
//   C <path>  clip (until R)         R  restore the clip
// where <path> is SVG path data plus 'O x y r', a whole circle. '@' as the colour is the caller's
// (the padlock). Strokes have round caps and joins.

/** Ids without a mark of their own get the goal ring; concept, forecast and biome marks share ids. */
const GLYPHS: Readonly<Record<string, string>> = {
  breezy: 'S#4A9BD9/1.8 M-6-3.5L2.5-3.5A2 2 0 1 0 0.6-6.12M-6 0.5L5 0.5M-6 4L1 4A2 2 0 1 1-0.9 6.62',
  overcast: 'F#8FA3BF O-3 1.5 3O1-0.5 4O4 2 2.6M-3 1.5h7v3.1h-7Z',
  heat: 'F#FFFFFF M-1.7 2L-1.7-4.8A1.7 1.7 0 0 1 1.7-4.8L1.7 2L1.57 1.68A2.8 2.8 0 1 1-1.57 1.68Z|S#E8541E/1.3 M-1.7 2L-1.7-4.8A1.7 1.7 0 0 1 1.7-4.8L1.7 2L1.57 1.68A2.8 2.8 0 1 1-1.57 1.68Z|F#FF5D3D O0 4 1.7M-0.7-2.6h1.4v6h-1.4Z',
  long: 'F#E8A33A M-5 5Q-5-5 5-5Q5 5-5 5|S#A0611A/1.1 M-6.2 6.2L2.5-2.5',
  dazzle: 'F#FFB020 M-1-7Q-0.2-1.2 5-0.5Q-0.2 0.2-1 6Q-1.8 0.2-7-0.5Q-1.8-1.2-1-7M5-6.5L6-5A1.5 1.5 0 0 1 3-5A1.5 1.5 0 0 1 6-5',
  market: 'S#A86F0A/1.4 M-4.3-0.5A4.3 4.3 0 0 1 4.3-0.5|F#D99A12 M-6.5-1L6.5-1L4.6 6L-4.6 6Z|S#A86F0A/0.9 M-5.6 1.6L5.6 1.6M-5 3.9L5 3.9',
  clear: 'S#F2A516/1.4 M4.6 0L6.4 0M3.25 3.25L4.53 4.53M0 4.6L0 6.4M-3.25 3.25L-4.53 4.53M-4.6 0L-6.4 0M-3.25-3.25L-4.53-4.53M0-4.6L0-6.4M3.25-3.25L4.53-4.53|F#FFC93C O0 0 3.3',
  meadow: 'F#8A5A3C M-0.9 1h1.8v5.5h-1.8Z|F#6BBF59 O0-2 4.4O-2.6 1.2 2.7O2.6 1.2 2.7',
  oldtown: 'F#F2D9C4 M-4.8-0.5h9.6v6.5h-9.6Z|S#B88A6A/1 M-4.8-0.5h9.6v6.5h-9.6Z|F#D9644A M-6.5 0.3L0-6.2L6.5 0.3Z|F#8A5A3C M-1.2 2h2.4v4h-2.4Z',
  goal: 'S#13857C/1.8 O0 0 5.5|F#13857C O0 0 2.2',
  gusts: 'S#4A9BD9/1.8 M-6-3.5L2.5-3.5A2 2 0 1 0 0.6-6.12M-6 0.5L5 0.5M-6 4L1 4A2 2 0 1 1-0.9 6.62',
  lock: 'S@/1.8 M-3.4-2.2A3.4 3.4 0 0 1 3.4-2.2M-3.4-2.2L-3.4 0M3.4-2.2L3.4 0|F@ M-5.2-0.5h10.4v7.2h-10.4Z|F#FFFFFF O0 2.6 1.3M-0.6 2.6h1.2v2.4h-1.2Z',
  drag: 'S#2B2140/1.6 M-4.63-1.36A5.2 5.2 0 0 1 5.14 0.19|F#2B2140 M5.66 1.2L3.46-0.54L6.54-1.46Z|F#FFC23D M1.54 0.56L2.72 1L1.54 1.44M1.15 2.11L1.36 3.36L0.39 2.55M-0.39 2.55L-1.36 3.36L-1.15 2.11M-1.54 1.44L-2.72 1L-1.54 0.56M-1.15-0.11L-1.36-1.36L-0.39-0.55M0.39-0.55L1.36-1.36L1.15-0.11|F#FFC23D O0 1 1.6',
  flakes: 'S#4A9BD9/1.3 M0.7-2L-5.7-2M-0.9 0.77L-4.1-4.77M-4.1 0.77L-0.9-4.77|F#4A9BD9 O-2.5-2 0.96|S#4A9BD9/1.3 M5.4 3L0.6 3M4.2 5.08L1.8 0.92M1.8 5.08L4.2 0.92|F#4A9BD9 O3 3 0.72',
  cloud: 'F#8FA3BF O-2.73 1.05 2.52O0.21-0.42 3.36O3.36 1.47 2.31M-2.73 1.05h6.09v2.73h-6.09Z',
  noon: 'F#FF8A2B M3.08-1.88L5.44-1L3.08-0.12M2.8 0.55L3.85 2.85L1.55 1.8M0.88 2.08L0 4.44L-0.88 2.08M-1.55 1.8L-3.85 2.85L-2.8 0.55M-3.08-0.12L-5.44-1L-3.08-1.88M-2.8-2.55L-3.85-4.85L-1.55-3.8M-0.88-4.08L0-6.44L0.88-4.08M1.55-3.8L3.85-4.85L2.8-2.55|F#FF8A2B O0-1 3.2|S#2B2140/1.6 M-6 6L6 6',
  glare: 'F#8A5A3C M-1.5 2h3v4.5h-3Z|F#B9E3FF O0-1 4|S#5A8AB0/1 O0-1 4|F#FFFFFF O-1.4-2.4 1.2|S#FF5D5D/1.3 M4.5-5.5L6.5-7.5M5.5-2.5L7.5-2.5',
  swing: 'S#2EC4B6/2.2 M-5.93 2.06A6 6 0 0 1 5.93 2.06|F#2EC4B6 M6.28 4.4L4.12 2.34L7.48 1.66Z',
  gate: 'F#B7A48C M-6-2h2.6v8.5h-2.6Z|F#B7A48C M3.4-2h2.6v8.5h-2.6Z|F#F2E8DA M-6.5-5h13v3.2h-13Z|S#B7A48C/1 M-6.5-5h13v3.2h-13Z',
  sprint: 'S#2B2140/1.8 M-6.5-3L-1-3M-6.5 0.5L0.5 0.5M-6.5 4L-2 4|F#FFC23D M3-6.5L-0.5 1L2.5 1L0.5 6.5L6-1.5L3-1.5Z',
  stroll: 'F#2B2140 M-2.6 2A1.4 2.2 0 0 1-5.4 2A1.4 2.2 0 0 1-2.6 2|F#2B2140 O-3.7-1 0.9|F#2B2140 M1.4-2.5A1.4 2.2 0 0 1-1.4-2.5A1.4 2.2 0 0 1 1.4-2.5|F#2B2140 O0.3-5.5 0.9|F#2B2140 M5.4 2A1.4 2.2 0 0 1 2.6 2A1.4 2.2 0 0 1 5.4 2|F#2B2140 O4.3-1 0.9',
  giants: 'F#6BBF59 M0-7L5.5 4L-5.5 4Z|F#8A5A3C M-1 4h2v3h-2Z',
  lowland: 'F#6BBF59 M0 0.5L6 5L-6 5Z|S#2B2140/1.4 M-7-4L7-4',
  sparse: 'F#2B2140 O-5 0 1.8O5 0 1.8|D#2B2140/1 M-2.5 0L2.5 0',
  dense: 'F#2B2140 O-4-4 1.6|F#2B2140 O-4 0 1.6|F#2B2140 O-4 4 1.6|F#2B2140 O0-4 1.6|F#2B2140 O0 0 1.6|F#2B2140 O0 4 1.6|F#2B2140 O4-4 1.6|F#2B2140 O4 0 1.6|F#2B2140 O4 4 1.6',
  drought: 'F#FF8A2B M1.19-2.27L3.26-1.5L1.19-0.73M0.95-0.14L1.87 1.87L-0.14 0.95M-0.73 1.19L-1.5 3.26L-2.27 1.19M-2.86 0.95L-4.87 1.87L-3.95-0.14M-4.19-0.73L-6.26-1.5L-4.19-2.27M-3.95-2.86L-4.87-4.87L-2.86-3.95M-2.27-4.19L-1.5-6.26L-0.73-4.19M-0.14-3.95L1.87-4.87L0.95-2.86|F#FF8A2B O-1.5-1.5 2.8|S#D9644A/1.6 M1.5 2L6.5 7M6.5 2L1.5 7',
  fleet: 'F#B8C6DA O-4.56-2.4 1.44O-2.88-3.24 1.92O-1.08-2.16 1.32M-4.56-2.4h3.48v1.56h-3.48Z|F#B8C6DA O1.94-0.9 1.44O3.62-1.74 1.92O5.42-0.66 1.32M1.94-0.9h3.48v1.56h-3.48Z|F#8FA3BF O-1.82 4.2 1.68O0.14 3.22 2.24O2.24 4.48 1.54M-1.82 4.2h4.06v1.82h-4.06Z',
  thaw: 'F#5AB8FF M0-6.5Q5.5 1 4 3.5A4 4 0 0 1-4 3.5Q-5.5 1 0-6.5',
  frosty: 'S#4A9BD9/1.4 O0 0 6.2|S#4A9BD9/1.3 M3.6 0L-3.6 0M1.8 3.12L-1.8-3.12M-1.8 3.12L1.8-3.12|F#4A9BD9 O0 0 1.08',
  ration: 'S#4A9BD9/1.6 O0 0 5.5|F#4A9BD9 M0 5.5A5.5 5.5 0 0 1 0-5.5Z',
  meltfast: 'S#4A9BD9/1.3 M2.2-2.5L-4.2-2.5M0.6 0.27L-2.6-5.27M-2.6 0.27L0.6-5.27|F#4A9BD9 O-1-2.5 0.96|F#5AB8FF M3.5 1Q6.5 5 3.5 6.5Q0.5 5 3.5 1',
  hardy: 'F#DDEEFF M0-6.5L5.5-4.5Q5.5 3 0 6.5Q-5.5 3-5.5-4.5Z|S#4A9BD9/1.3 M0-6.5L5.5-4.5Q5.5 3 0 6.5Q-5.5 3-5.5-4.5Z|S#4A9BD9/1.3 M2.8 0L-2.8 0M1.4 2.42L-1.4-2.42M-1.4 2.42L1.4-2.42|F#4A9BD9 O0 0 0.84',
  flurry: 'S#4A9BD9/1.3 M-1.3-3L-5.7-3M-2.4-1.09L-4.6-4.91M-4.6-1.09L-2.4-4.91|F#4A9BD9 O-3.5-3 0.66|S#4A9BD9/1.3 M5.2-3.5L0.8-3.5M4.1-1.59L1.9-5.41M1.9-1.59L4.1-5.41|F#4A9BD9 O3-3.5 0.66|S#4A9BD9/1.3 M2.6 1L-2.6 1M1.3 3.25L-1.3-1.25M-1.3 3.25L1.3-1.25|F#4A9BD9 O0 1 0.78|S#4A9BD9/1.3 M-1.5 4.5L-5.5 4.5M-2.5 6.23L-4.5 2.77M-4.5 6.23L-2.5 2.77|F#4A9BD9 O-3.5 4.5 0.6|S#4A9BD9/1.3 M5.5 4L1.5 4M4.5 5.73L2.5 2.27M2.5 5.73L4.5 2.27|F#4A9BD9 O3.5 4 0.6',
  heavy: 'F#FFC23D M2.88-2.33L5.1-1.5L2.88-0.67M2.62-0.05L3.61 2.11L1.45 1.12M0.83 1.38L0 3.6L-0.83 1.38M-1.45 1.12L-3.61 2.11L-2.62-0.05M-2.88-0.67L-5.1-1.5L-2.88-2.33M-2.62-2.95L-3.61-5.11L-1.45-4.12M-0.83-4.38L0-6.6L0.83-4.38M1.45-4.12L3.61-5.11L2.62-2.95|F#FFC23D O0-1.5 3|S#2B2140/1.8 M0 2.5L0 7M-2.5 4.5L0 7L2.5 4.5',
  slippery: 'F#FFC23D M4.69-0.77L6.76 0L4.69 0.77M4.45 1.36L5.37 3.37L3.36 2.45M2.77 2.69L2 4.76L1.23 2.69M0.64 2.45L-1.37 3.37L-0.45 1.36M-0.69 0.77L-2.76 0L-0.69-0.77M-0.45-1.36L-1.37-3.37L0.64-2.45M1.23-2.69L2-4.76L2.77-2.69M3.36-2.45L5.37-3.37L4.45-1.36|F#FFC23D O2 0 2.8|S#2B2140/1.4 M-7-3L-2.5-3M-7 0L-3.5 0M-7 3L-2.5 3',
  clockwork: 'F#2B2140 M4.07-1.04L6.27-1.27L6.27 1.27L4.07 1.04M3.61 2.14L5.33 3.54L3.54 5.33L2.14 3.61M1.04 4.07L1.27 6.27L-1.27 6.27L-1.04 4.07M-2.14 3.61L-3.54 5.33L-5.33 3.54L-3.61 2.14M-4.07 1.04L-6.27 1.27L-6.27-1.27L-4.07-1.04M-3.61-2.14L-5.33-3.54L-3.54-5.33L-2.14-3.61M-1.04-4.07L-1.27-6.27L1.27-6.27L1.04-4.07M2.14-3.61L3.54-5.33L5.33-3.54L3.61-2.14|F#2B2140 O0 0 4.4|F#FFF8EE O0 0 1.8',
  fog: 'S#8FA3BF/2 M-6-4L4-4M-3 0L6 0M-6 4L1 4',
  blind: 'S#2EC4B6/2 O0 0 5.5|S#D9644A/1.8 M-5.5-5.5L5.5 5.5',
  eclipse: 'F#FFC23D O0 0 5.8|F#2B2140 O1.2 0 5.2',
  sunset: 'C M-8-8h16v10.5h-16Z|F#FF9E6B M3.27 1.56L5.78 2.5L3.27 3.44M2.97 4.15L4.09 6.59L1.65 5.47M0.94 5.77L0 8.28L-0.94 5.77M-1.65 5.47L-4.09 6.59L-2.97 4.15M-3.27 3.44L-5.78 2.5L-3.27 1.56M-2.97 0.85L-4.09-1.59L-1.65-0.47M-0.94-0.77L0-3.28L0.94-0.77M1.65-0.47L4.09-1.59L2.97 0.85|F#FF9E6B O0 2.5 3.4|R|S#A0611A/1.4 M-7 3.5L7 3.5',
  moonlit: 'E#E8ECFF O0 0 5.5L7.2-1.6A4.6 4.6 0 0 0-2-1.6A4.6 4.6 0 0 0 7.2-1.6',
  marathon: 'S#8A5A3C/2.2 M-6 6C-6-2 6 6 6-6|F#FFFFFF M3.5-7.5h5v3.5h-5Z|S#2B2140/0.8 M3.5-7.5h5v3.5h-5Z',
  boss: 'F#FF6A3D M3.84-1.11L6.8 0L3.84 1.11M3.76 1.37L5.5 4L2.46 3.15M2.24 3.31L2.1 6.47L0.14 4M-0.14 4L-2.1 6.47L-2.24 3.31M-2.46 3.15L-5.5 4L-3.76 1.37M-3.84 1.11L-6.8 0L-3.84-1.11M-3.76-1.37L-5.5-4L-2.46-3.15M-2.24-3.31L-2.1-6.47L-0.14-4M0.14-4L2.1-6.47L2.24-3.31M2.46-3.15L5.5-4L3.76-1.37|F#FF6A3D O0 0 4|S#7A3B00/1.3 M-2.6-1.6L-0.8-0.6M2.6-1.6L0.8-0.6',
};

export interface ArtOp {
  kind: string;
  color: string;
  width: number;
  path: Path2D | null;
}

/** 'O x y r' → two SVG arcs from the circle's rightmost point. */
function circles(d: string): string {
  return d.replace(/O(-?[\d.]+) ?(-?[\d.]+) ?([\d.]+)/g, (_, x: string, y: string, r: string) => {
    const a = Number(x) + Number(r);
    const b = Number(x) - Number(r);
    return `M${a} ${y}A${r} ${r} 0 0 1 ${b} ${y}A${r} ${r} 0 0 1 ${a} ${y}`;
  });
}

/** Parses an art string (ops joined by '|'). */
export function artOps(src: string): ArtOp[] {
  return src.split('|').map((op) => {
    const sp = op.indexOf(' ');
    const head = sp < 0 ? op : op.slice(0, sp);
    const [color = '', width = '1'] = head.slice(1).split('/');
    return { kind: head.charAt(0), color, width: Number(width), path: sp < 0 ? null : new Path2D(circles(op.slice(sp + 1))) };
  });
}

const DOTS = [1.5, 1.5];
const NONE: number[] = [];

/** Draws parsed art in the current transform ('@' takes `color`). */
export function drawArt(g: CanvasRenderingContext2D, ops: readonly ArtOp[], color = '#2B2140'): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const op of ops) {
    const c = op.color === '@' ? color : op.color;
    const p = op.path as Path2D;
    switch (op.kind) {
      case 'F':
      case 'E':
        g.fillStyle = c;
        g.fill(p, op.kind === 'E' ? 'evenodd' : 'nonzero');
        break;
      case 'C':
        g.save();
        g.clip(p);
        break;
      case 'R':
        g.restore();
        break;
      default:
        g.strokeStyle = c;
        g.lineWidth = op.width;
        g.setLineDash(op.kind === 'D' ? DOTS : NONE);
        g.stroke(p);
        g.setLineDash(NONE);
    }
  }
}

const parsed = new Map<string, ArtOp[]>();

/**
 * Draws glyph `id` (a concept, forecast or biome id, 'clear', 'goal', 'lock' or 'gusts'; unknown ids
 * get the goal ring) `size` px wide centred on (x, y). `color` fills the padlock; `flip` mirrors it
 * (the wind blowing left).
 */
export function drawGlyph(g: CanvasRenderingContext2D, id: string, x: number, y: number, size: number, color?: string, flip = false): void {
  let ops = parsed.get(id);
  if (!ops) {
    ops = artOps(GLYPHS[id] ?? (GLYPHS.goal as string));
    parsed.set(id, ops);
  }
  const k = size / 14;
  g.save();
  g.translate(x, y);
  g.scale(flip ? -k : k, k);
  drawArt(g, ops, color);
  g.restore();
}
