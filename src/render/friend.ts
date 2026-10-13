// The friend's puddle (GR8): on a challenge run, the spot on the trail where the sender melted —
// a pale-blue puddle on the ground (shade darkens it like the rest of the ground) and a teal
// pennant with the sender's name on a pill above it.

import { dayLength, trailX, worldYAtTime, type World } from '../core/index.ts';
import type { View } from '../game/camera.ts';
import { roundRect } from './sprites.ts';

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Where a score of `minutes` sits on the trail (world u): writes [x, y] into out. */
export function friendSpot(world: World, minutes: number, out: Float64Array): void {
  const day = Math.floor(minutes / 720) + 1;
  const y = worldYAtTime(world, day, ((minutes % 720) / 720) * dayLength(day));
  out[0] = trailX(world.trail, y);
  out[1] = y;
}

/** The puddle: a 12×7 u ellipse with a glint (draw with the ground, before the shadow layer). */
export function drawFriendPuddle(g: CanvasRenderingContext2D, v: View, x: number, y: number): void {
  if (y < v.y0 - 20 || y > v.y1 + 20) return;
  const sx = v.ox + x * v.S;
  const sy = v.oy - y * v.S;
  g.fillStyle = 'rgba(143,211,255,0.7)';
  g.beginPath();
  g.ellipse(sx, sy, 6 * v.S, 3.5 * v.S, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.beginPath();
  g.ellipse(sx - 2 * v.S, sy - 1 * v.S, 2 * v.S, 0.9 * v.S, -0.3, 0, Math.PI * 2);
  g.fill();
}

/** The pennant (a 30 u pole, a 14×9 u teal flag) and the name pill 11 px above it. */
export function drawFriendPennant(g: CanvasRenderingContext2D, v: View, x: number, y: number, name: string): void {
  if (y < v.y0 - 60 || y > v.y1 + 20) return;
  const S = v.S;
  const sx = v.ox + (x + 5) * S;
  const sy = v.oy - y * S;
  const top = sy - 30 * S;
  g.strokeStyle = '#2B2140';
  g.lineWidth = Math.max(1.5, 1.6 * S);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(sx, sy);
  g.lineTo(sx, top);
  g.stroke();
  g.lineCap = 'butt';
  g.fillStyle = '#2EC4B6';
  g.beginPath();
  g.moveTo(sx, top);
  g.lineTo(sx + 14 * S, top + 4.5 * S);
  g.lineTo(sx, top + 9 * S);
  g.closePath();
  g.fill();
  g.strokeStyle = '#13857C';
  g.lineWidth = 1;
  g.stroke();
  const label = name || 'A friend';
  g.font = `800 11px ${FONT}`;
  const w = g.measureText(label).width + 12;
  const h = 17;
  const py = top - 11 - h;
  g.fillStyle = 'rgba(43,33,64,0.85)';
  roundRect(g, sx - w / 2, py, w, h, h / 2);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, sx, py + h / 2 + 0.5);
}
