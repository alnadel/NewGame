// Clouds (GDD §10, V1_PLAN §9): soft lumpy bodies drawn at their oblique height (0.25·z = 75 u up),
// a light interior with a soft cooler rim, faded near Nubs (0.2 α within 70 u) and at the ends of
// their life (cloudVisibility). Each cloud body is rendered once into a cached sprite.

import { cloudCenter, cloudVisibility, queryClouds, type Cloud, type World } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { OBLIQUE } from '../game/camera.ts';
import { ctx2d, makeCanvas, type Canvas2D } from './sprites.ts';

const TAU = Math.PI * 2;
const PAD = 14;

interface CloudSprite {
  canvas: Canvas2D;
  scale: number;
  /** Sprite center offset (u) from its top-left corner. */
  cx: number;
  cy: number;
}

const cache = new Map<number, CloudSprite>();

function build(cl: Cloud, scale: number): CloudSprite {
  const l = cl.lumps;
  let minX = -cl.rx;
  let maxX = cl.rx;
  let minY = -cl.ry;
  let maxY = cl.ry;
  for (let i = 0; i + 2 < l.length; i += 3) {
    const x = l[i] as number;
    const y = l[i + 1] as number;
    const r = l[i + 2] as number;
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  }
  const wU = maxX - minX + PAD * 2;
  const hU = maxY - minY + PAD * 2;
  const canvas = makeCanvas(wU * scale, hU * scale);
  const g = ctx2d(canvas);
  g.scale(scale, scale);
  const cx = -minX + PAD;
  // Sprite y grows downward; world dy grows upward.
  const cy = maxY + PAD;
  const lumpsPath = (dx: number, dy: number, grow: number): void => {
    g.beginPath();
    for (let i = 0; i + 2 < l.length; i += 3) {
      const x = cx + (l[i] as number) + dx;
      const y = cy - (l[i + 1] as number) + dy;
      const r = (l[i + 2] as number) + grow;
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, TAU);
    }
  };
  // Soft outer rim.
  g.fillStyle = 'rgba(255,255,255,0.35)';
  lumpsPath(0, 0, 5);
  g.fill();
  // Cool underside.
  g.fillStyle = '#DCE6F7';
  lumpsPath(0, 4, 0);
  g.fill();
  // Bright body.
  g.fillStyle = '#FFFFFF';
  lumpsPath(-1, -1, -1.5);
  g.fill();
  return { canvas, scale, cx, cy };
}

function spriteFor(cl: Cloud, scale: number): CloudSprite {
  let s = cache.get(cl.id);
  if (!s || Math.abs(s.scale - scale) > 0.2) {
    if (cache.size > 24) cache.clear();
    s = build(cl, scale);
    cache.set(cl.id, s);
  }
  return s;
}

const buf: Cloud[] = [];
const c2 = new Float64Array(2);

/** Draws every visible cloud body. `nightDim` 0..1 darkens them at night. */
export function drawClouds(
  g: CanvasRenderingContext2D,
  v: View,
  world: World,
  tAbs: number,
  nubsSX: number,
  nubsSY: number,
  night: number,
): void {
  const n = queryClouds(world, tAbs, buf);
  if (n === 0) return;
  const scale = Math.min(3, v.S * v.dpr);
  for (let i = 0; i < n; i++) {
    const cl = buf[i] as Cloud;
    cloudCenter(cl, tAbs, c2);
    const x = c2[0] as number;
    const y = (c2[1] as number) + OBLIQUE * cl.z;
    if (x + cl.rx + PAD < v.x0 || x - cl.rx - PAD > v.x1 || y + cl.ry + PAD < v.y0 || y - cl.ry - PAD > v.y1) continue;
    const vis = cloudVisibility(cl, tAbs);
    if (vis <= 0) continue;
    const sx = v.ox + x * v.S;
    const sy = v.oy - y * v.S;
    // Fade to 0.2 when the body comes within 70 u of Nubs' screen point (distance to the ellipse).
    const dx = (nubsSX - sx) / v.S;
    const dy = (nubsSY - sy) / v.S;
    const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    const rEff = (cl.rx * cl.ry) / Math.sqrt(((cl.ry * dx) / d) ** 2 + ((cl.rx * dy) / d) ** 2);
    const edge = d - rEff;
    const near = Math.max(0, Math.min(1, (edge - 10) / 60));
    const alpha = vis * (0.2 + 0.62 * near) * (1 - 0.55 * night);
    const s = spriteFor(cl, scale);
    const k = v.S / s.scale;
    g.globalAlpha = alpha;
    g.drawImage(s.canvas, sx - s.cx * v.S, sy - s.cy * v.S, s.canvas.width * k, s.canvas.height * k);
  }
  g.globalAlpha = 1;
}
