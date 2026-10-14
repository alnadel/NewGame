// Clouds (GDD §10, V1_PLAN §9): soft lumpy bodies drawn at their oblique height (0.25·z = 75 u up),
// a light interior with a soft cooler rim, faded near Nubs (0.2 α within 70 u) and at the ends of
// their life (cloudVisibility). Each cloud body is rendered once into a cached sprite.
// v1.5: the Cold Snap's cloud (SimState.snapCloudId) is frosty: an icy body with a blue-white
// underside and a rim of ice glints, kept readable over Nubs (it rides with him), fading out as
// the snap runs down (snow falls from it: game/fx.ts).

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

function build(cl: Cloud, scale: number, frost: boolean): CloudSprite {
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
  g.fillStyle = frost ? 'rgba(200,236,255,0.5)' : 'rgba(255,255,255,0.35)';
  lumpsPath(0, 0, 5);
  g.fill();
  // Cool underside.
  g.fillStyle = frost ? '#9FD3F5' : '#DCE6F7';
  lumpsPath(0, 4, 0);
  g.fill();
  // Bright body.
  g.fillStyle = frost ? '#F2FAFF' : '#FFFFFF';
  lumpsPath(-1, -1, -1.5);
  g.fill();
  if (frost) {
    // Ice glints along the top of the lumps.
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = 'rgba(90,184,255,0.9)';
    g.lineWidth = 1.2;
    for (let i = 0; i + 2 < l.length; i += 3) {
      const x = cx + (l[i] as number) - (l[i + 2] as number) * 0.3;
      const y = cy - (l[i + 1] as number) - (l[i + 2] as number) * 0.55;
      const r = 2.6;
      g.beginPath();
      g.moveTo(x, y - r);
      g.lineTo(x + r * 0.3, y - r * 0.3);
      g.lineTo(x + r, y);
      g.lineTo(x + r * 0.3, y + r * 0.3);
      g.lineTo(x, y + r);
      g.lineTo(x - r * 0.3, y + r * 0.3);
      g.lineTo(x - r, y);
      g.lineTo(x - r * 0.3, y - r * 0.3);
      g.closePath();
      g.stroke();
      g.fill();
    }
  }
  return { canvas, scale, cx, cy };
}

function spriteFor(cl: Cloud, scale: number, frost: boolean): CloudSprite {
  // A snap cloud keeps its own sprite (negative key), so its id never shows a plain body.
  const key = frost ? -1 - cl.id : cl.id;
  let s = cache.get(key);
  if (!s || Math.abs(s.scale - scale) > 0.2) {
    if (cache.size > 24) cache.clear();
    s = build(cl, scale, frost);
    cache.set(key, s);
  }
  return s;
}

const buf: Cloud[] = [];
const c2 = new Float64Array(2);

/**
 * Draws every visible cloud body. `nightDim` 0..1 darkens them at night. `snapId` is the Cold
 * Snap's cloud (−1 none), drawn frosty and faded by `snapFade` (0..1).
 */
export function drawClouds(
  g: CanvasRenderingContext2D,
  v: View,
  world: World,
  tAbs: number,
  nubsSX: number,
  nubsSY: number,
  night: number,
  snapId = -1,
  snapFade = 0,
): void {
  const n = queryClouds(world, tAbs, buf);
  if (n === 0) return;
  const scale = Math.min(3, v.k * v.dpr);
  for (let i = 0; i < n; i++) {
    const cl = buf[i] as Cloud;
    cloudCenter(cl, tAbs, c2);
    const x = c2[0] as number;
    const y = (c2[1] as number) + OBLIQUE * cl.z;
    if (x + cl.rx + PAD < v.x0 || x - cl.rx - PAD > v.x1 || y + cl.ry + PAD < v.y0 || y - cl.ry - PAD > v.y1) continue;
    // The snap cloud gathers in 0.3 s (it is cast on the spot) and melts away over its last 0.8 s.
    const vis = cl.id === snapId ? Math.max(0, Math.min(1, (tAbs - cl.t0) / 0.3, (cl.t0 + cl.life - tAbs) / 0.8)) : cloudVisibility(cl, tAbs);
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
    const frost = cl.id === snapId;
    const alpha = frost
      ? Math.min(vis, snapFade) * (0.5 + 0.3 * near) * (1 - 0.4 * night)
      : vis * (0.2 + 0.42 * near) * (1 - 0.55 * night);
    if (alpha <= 0.005) continue;
    const s = spriteFor(cl, scale, frost);
    const k = v.S / s.scale;
    g.globalAlpha = alpha;
    g.drawImage(s.canvas, sx - s.cx * v.S, sy - s.cy * v.S, s.canvas.width * k, s.canvas.height * k);
  }
  g.globalAlpha = 1;
}
