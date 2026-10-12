// Small vector glyphs (GR10): the Day Plan's forecast marks (HUD, Day card, postcard) and the two
// biome marks. Each is designed on a 14-unit grid and drawn `size` px wide centred on (x, y).

import type { BiomeId, ForecastId } from '../core/index.ts';

const PI = Math.PI;
const TAU = PI * 2;

function begin(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  g.save();
  g.translate(x, y);
  g.scale(size / 14, size / 14);
  g.lineCap = 'round';
  g.lineJoin = 'round';
}

/** Wind lines, a cloud, a thermometer, a leaf, a sparkle or a basket; nothing on a clear day. */
export function drawForecastGlyph(g: CanvasRenderingContext2D, id: ForecastId, x: number, y: number, size: number): void {
  if (id === 'clear') return;
  begin(g, x, y, size);
  switch (id) {
    case 'breezy':
      g.strokeStyle = '#4A9BD9';
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(-6, -3.5);
      g.lineTo(2.5, -3.5);
      g.arc(2.5, -5.5, 2, PI / 2, -PI * 0.9, true);
      g.moveTo(-6, 0.5);
      g.lineTo(5, 0.5);
      g.moveTo(-6, 4);
      g.lineTo(1, 4);
      g.arc(1, 6, 2, -PI / 2, PI * 0.9);
      g.stroke();
      break;
    case 'overcast':
      g.fillStyle = '#8FA3BF';
      g.beginPath();
      g.arc(-3, 1.5, 3, 0, TAU);
      g.moveTo(5, -0.5);
      g.arc(1, -0.5, 4, 0, TAU);
      g.moveTo(6.6, 2);
      g.arc(4, 2, 2.6, 0, TAU);
      g.rect(-3, 1.5, 7, 3.1);
      g.fill();
      break;
    case 'heat':
      g.fillStyle = '#FFFFFF';
      g.strokeStyle = '#E8541E';
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(-1.7, 2);
      g.lineTo(-1.7, -4.8);
      g.arc(0, -4.8, 1.7, PI, 0);
      g.lineTo(1.7, 2);
      g.arc(0, 4, 2.8, -PI * 0.31, PI * 1.31);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#FF5D3D';
      g.beginPath();
      g.arc(0, 4, 1.7, 0, TAU);
      g.rect(-0.7, -2.6, 1.4, 6);
      g.fill();
      break;
    case 'long':
      g.fillStyle = '#E8A33A';
      g.beginPath();
      g.moveTo(-5, 5);
      g.quadraticCurveTo(-5, -5, 5, -5);
      g.quadraticCurveTo(5, 5, -5, 5);
      g.fill();
      g.strokeStyle = '#A0611A';
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(-6.2, 6.2);
      g.lineTo(2.5, -2.5);
      g.stroke();
      break;
    case 'dazzle':
      g.fillStyle = '#FFB020';
      g.beginPath();
      g.moveTo(-1, -7);
      g.quadraticCurveTo(-0.2, -1.2, 5, -0.5);
      g.quadraticCurveTo(-0.2, 0.2, -1, 6);
      g.quadraticCurveTo(-1.8, 0.2, -7, -0.5);
      g.quadraticCurveTo(-1.8, -1.2, -1, -7);
      g.moveTo(5, -6.5);
      g.arc(4.5, -5, 1.5, 0, TAU);
      g.fill();
      break;
    case 'market':
      g.strokeStyle = '#A86F0A';
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(0, -0.5, 4.3, PI, 0);
      g.stroke();
      g.fillStyle = '#D99A12';
      g.beginPath();
      g.moveTo(-6.5, -1);
      g.lineTo(6.5, -1);
      g.lineTo(4.6, 6);
      g.lineTo(-4.6, 6);
      g.closePath();
      g.fill();
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(-5.6, 1.6);
      g.lineTo(5.6, 1.6);
      g.moveTo(-5, 3.9);
      g.lineTo(5, 3.9);
      g.stroke();
      break;
  }
  g.restore();
}

/**
 * A small sun for a clear day, where a row of forecasts needs a mark in every slot (the postcard's
 * day rows); the HUD and the Day card show nothing on a clear day.
 */
export function drawClearGlyph(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  begin(g, x, y, size);
  g.strokeStyle = '#F2A516';
  g.lineWidth = 1.4;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * TAU) / 8;
    g.moveTo(Math.cos(a) * 4.6, Math.sin(a) * 4.6);
    g.lineTo(Math.cos(a) * 6.4, Math.sin(a) * 6.4);
  }
  g.stroke();
  g.fillStyle = '#FFC93C';
  g.beginPath();
  g.arc(0, 0, 3.3, 0, TAU);
  g.fill();
  g.restore();
}

/** A tree for the Meadow, a house for the Old Town. */
export function drawBiomeGlyph(g: CanvasRenderingContext2D, biome: BiomeId, x: number, y: number, size: number): void {
  begin(g, x, y, size);
  if (biome === 'oldtown') {
    g.fillStyle = '#F2D9C4';
    g.strokeStyle = '#B88A6A';
    g.lineWidth = 1;
    g.beginPath();
    g.rect(-4.8, -0.5, 9.6, 6.5);
    g.fill();
    g.stroke();
    g.fillStyle = '#D9644A';
    g.beginPath();
    g.moveTo(-6.5, 0.3);
    g.lineTo(0, -6.2);
    g.lineTo(6.5, 0.3);
    g.closePath();
    g.fill();
    g.fillStyle = '#8A5A3C';
    g.fillRect(-1.2, 2, 2.4, 4);
  } else {
    g.fillStyle = '#8A5A3C';
    g.fillRect(-0.9, 1, 1.8, 5.5);
    g.fillStyle = '#6BBF59';
    g.beginPath();
    g.arc(0, -2, 4.4, 0, TAU);
    g.moveTo(0.1, 1.2);
    g.arc(-2.6, 1.2, 2.7, 0, TAU);
    g.moveTo(5.3, 1.2);
    g.arc(2.6, 1.2, 2.7, 0, TAU);
    g.fill();
  }
  g.restore();
}
