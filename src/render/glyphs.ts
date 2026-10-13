// Small vector glyphs (GR10): the Day Plan's forecast marks (HUD, Day card, postcard), the two
// biome marks and, in v1.2, the campaign concept marks. Each is designed on a 14-unit grid and
// drawn `size` px wide centred on (x, y).

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

// ---------------------------------------------------------------------------------------------
// Campaign concept glyphs (CAMPAIGN_PLAN §3): one small mark per concept id, on the same 14-unit
// grid, for the intro card, the HUD and the Journey map. Forecast concepts reuse the forecast
// marks; the rest are drawn here. Unknown ids get the goal ring.
// ---------------------------------------------------------------------------------------------

const INK = '#2B2140';
const TEAL = '#2EC4B6';
const GOLD = '#FFC23D';
const ORANGE = '#FF8A2B';
const SKY = '#4A9BD9';

function sun(g: CanvasRenderingContext2D, x: number, y: number, r: number, rays: number, fill: string): void {
  g.fillStyle = fill;
  g.beginPath();
  for (let i = 0; i < rays; i++) {
    const a = (i * TAU) / rays;
    g.moveTo(x + Math.cos(a - 0.28) * r, y + Math.sin(a - 0.28) * r);
    g.lineTo(x + Math.cos(a) * r * 1.7, y + Math.sin(a) * r * 1.7);
    g.lineTo(x + Math.cos(a + 0.28) * r, y + Math.sin(a + 0.28) * r);
  }
  g.fill();
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}

function cloud(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string): void {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(x - 2.6 * s, y + 1 * s, 2.4 * s, 0, TAU);
  g.moveTo(x + 3.4 * s, y - 0.4 * s);
  g.arc(x + 0.2 * s, y - 0.4 * s, 3.2 * s, 0, TAU);
  g.moveTo(x + 5.4 * s, y + 1.4 * s);
  g.arc(x + 3.2 * s, y + 1.4 * s, 2.2 * s, 0, TAU);
  g.rect(x - 2.6 * s, y + 1 * s, 5.8 * s, 2.6 * s);
  g.fill();
}

function flakeMark(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = 1.3;
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = (i * PI) / 3;
    g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    g.lineTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
  }
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r * 0.3, 0, TAU);
  g.fill();
}

function arrowHead(g: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, s: number): void {
  const nx = -dy;
  const ny = dx;
  g.beginPath();
  g.moveTo(x + dx * s, y + dy * s);
  g.lineTo(x + nx * s * 0.7, y + ny * s * 0.7);
  g.lineTo(x - nx * s * 0.7, y - ny * s * 0.7);
  g.closePath();
  g.fill();
}

/** The goal ring (a target) used by the intro card's goal pill. */
export function drawGoalGlyph(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  begin(g, x, y, size);
  g.strokeStyle = '#13857C';
  g.lineWidth = 1.8;
  g.beginPath();
  g.arc(0, 0, 5.5, 0, TAU);
  g.stroke();
  g.fillStyle = '#13857C';
  g.beginPath();
  g.arc(0, 0, 2.2, 0, TAU);
  g.fill();
  g.restore();
}

/** One concept's mark, `size` px wide centred on (x, y). */
export function drawConceptGlyph(g: CanvasRenderingContext2D, id: string, x: number, y: number, size: number): void {
  switch (id) {
    case 'breezy':
    case 'long':
    case 'heat':
    case 'overcast':
    case 'dazzle':
    case 'market':
      drawForecastGlyph(g, id, x, y, size);
      return;
    default:
      break;
  }
  begin(g, x, y, size);
  g.lineWidth = 1.6;
  switch (id) {
    case 'drag': {
      // A curved arrow around a dot: the swing.
      g.strokeStyle = INK;
      g.beginPath();
      g.arc(0, 1, 5.2, PI * 1.15, PI * 1.95);
      g.stroke();
      g.fillStyle = INK;
      arrowHead(g, 5, -1, 0.3, 1, 2.2);
      sun(g, 0, 1, 1.6, 6, GOLD);
      break;
    }
    case 'flakes':
      flakeMark(g, -2.5, -2, 3.2, SKY);
      flakeMark(g, 3, 3, 2.4, SKY);
      break;
    case 'cloud':
      cloud(g, 0, 0, 1.05, '#8FA3BF');
      break;
    case 'noon':
      sun(g, 0, -1, 3.2, 8, ORANGE);
      g.strokeStyle = INK;
      g.beginPath();
      g.moveTo(-6, 6);
      g.lineTo(6, 6);
      g.stroke();
      break;
    case 'oldtown':
      g.restore();
      drawBiomeGlyph(g, 'oldtown', x, y, size);
      return;
    case 'glare':
      g.fillStyle = '#8A5A3C';
      g.fillRect(-1.5, 2, 3, 4.5);
      g.fillStyle = '#B9E3FF';
      g.strokeStyle = '#5A8AB0';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(0, -1, 4, 0, TAU);
      g.fill();
      g.stroke();
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      g.arc(-1.4, -2.4, 1.2, 0, TAU);
      g.fill();
      g.strokeStyle = '#FF5D5D';
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(4.5, -5.5);
      g.lineTo(6.5, -7.5);
      g.moveTo(5.5, -2.5);
      g.lineTo(7.5, -2.5);
      g.stroke();
      break;
    case 'swing':
      g.strokeStyle = TEAL;
      g.lineWidth = 2.2;
      g.beginPath();
      g.arc(0, 3, 6, PI * 1.05, PI * 1.95);
      g.stroke();
      g.fillStyle = TEAL;
      arrowHead(g, 5.8, 2, 0.2, 1, 2.4);
      break;
    case 'gate':
      g.fillStyle = '#B7A48C';
      g.fillRect(-6, -2, 2.6, 8.5);
      g.fillRect(3.4, -2, 2.6, 8.5);
      g.fillStyle = '#F2E8DA';
      g.strokeStyle = '#B7A48C';
      g.lineWidth = 1;
      g.beginPath();
      g.rect(-6.5, -5, 13, 3.2);
      g.fill();
      g.stroke();
      break;
    case 'sprint':
      g.strokeStyle = INK;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(-6.5, -3);
      g.lineTo(-1, -3);
      g.moveTo(-6.5, 0.5);
      g.lineTo(0.5, 0.5);
      g.moveTo(-6.5, 4);
      g.lineTo(-2, 4);
      g.stroke();
      g.fillStyle = GOLD;
      g.beginPath();
      g.moveTo(3, -6.5);
      g.lineTo(-0.5, 1);
      g.lineTo(2.5, 1);
      g.lineTo(0.5, 6.5);
      g.lineTo(6, -1.5);
      g.lineTo(3, -1.5);
      g.closePath();
      g.fill();
      break;
    case 'stroll':
      g.fillStyle = INK;
      for (let i = 0; i < 3; i++) {
        const fx = -4 + i * 4;
        const fy = i % 2 === 0 ? 2 : -2.5;
        g.beginPath();
        g.ellipse(fx, fy, 1.4, 2.2, 0, 0, TAU);
        g.fill();
        g.beginPath();
        g.arc(fx + 0.3, fy - 3, 0.9, 0, TAU);
        g.fill();
      }
      break;
    case 'giants':
      g.fillStyle = '#6BBF59';
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5.5, 4);
      g.lineTo(-5.5, 4);
      g.closePath();
      g.fill();
      g.fillStyle = '#8A5A3C';
      g.fillRect(-1, 4, 2, 3);
      break;
    case 'lowland':
      g.fillStyle = '#6BBF59';
      g.beginPath();
      g.moveTo(0, 0.5);
      g.lineTo(6, 5);
      g.lineTo(-6, 5);
      g.closePath();
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(-7, -4);
      g.lineTo(7, -4);
      g.stroke();
      break;
    case 'sparse':
      g.fillStyle = INK;
      g.beginPath();
      g.arc(-5, 0, 1.8, 0, TAU);
      g.moveTo(6.8, 0);
      g.arc(5, 0, 1.8, 0, TAU);
      g.fill();
      g.strokeStyle = INK;
      g.setLineDash([1.5, 1.5]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-2.5, 0);
      g.lineTo(2.5, 0);
      g.stroke();
      g.setLineDash([]);
      break;
    case 'dense':
      g.fillStyle = INK;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          g.beginPath();
          g.arc(i * 4, j * 4, 1.6, 0, TAU);
          g.fill();
        }
      }
      break;
    case 'drought':
      sun(g, -1.5, -1.5, 2.8, 8, ORANGE);
      g.strokeStyle = '#D9644A';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(1.5, 2);
      g.lineTo(6.5, 7);
      g.moveTo(6.5, 2);
      g.lineTo(1.5, 7);
      g.stroke();
      break;
    case 'fleet':
      cloud(g, -3, -3, 0.6, '#B8C6DA');
      cloud(g, 3.5, -1.5, 0.6, '#B8C6DA');
      cloud(g, 0, 3.5, 0.7, '#8FA3BF');
      break;
    case 'thaw':
      g.fillStyle = '#5AB8FF';
      g.beginPath();
      g.moveTo(0, -6.5);
      g.quadraticCurveTo(5.5, 1, 4, 3.5);
      g.arc(0, 3.5, 4, 0, PI);
      g.quadraticCurveTo(-5.5, 1, 0, -6.5);
      g.fill();
      break;
    case 'frosty':
      g.strokeStyle = SKY;
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(0, 0, 6.2, 0, TAU);
      g.stroke();
      flakeMark(g, 0, 0, 3.6, SKY);
      break;
    case 'ration':
      g.strokeStyle = SKY;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(0, 0, 5.5, 0, TAU);
      g.stroke();
      g.fillStyle = SKY;
      g.beginPath();
      g.arc(0, 0, 5.5, PI / 2, PI * 1.5);
      g.closePath();
      g.fill();
      break;
    case 'meltfast':
      flakeMark(g, -1, -2.5, 3.2, SKY);
      g.fillStyle = '#5AB8FF';
      g.beginPath();
      g.moveTo(3.5, 1);
      g.quadraticCurveTo(6.5, 5, 3.5, 6.5);
      g.quadraticCurveTo(0.5, 5, 3.5, 1);
      g.fill();
      break;
    case 'hardy':
      g.fillStyle = '#DDEEFF';
      g.strokeStyle = SKY;
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(0, -6.5);
      g.lineTo(5.5, -4.5);
      g.quadraticCurveTo(5.5, 3, 0, 6.5);
      g.quadraticCurveTo(-5.5, 3, -5.5, -4.5);
      g.closePath();
      g.fill();
      g.stroke();
      flakeMark(g, 0, 0, 2.8, SKY);
      break;
    case 'flurry':
      flakeMark(g, -3.5, -3, 2.2, SKY);
      flakeMark(g, 3, -3.5, 2.2, SKY);
      flakeMark(g, 0, 1, 2.6, SKY);
      flakeMark(g, -3.5, 4.5, 2, SKY);
      flakeMark(g, 3.5, 4, 2, SKY);
      break;
    case 'heavy':
      sun(g, 0, -1.5, 3, 8, GOLD);
      g.strokeStyle = INK;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(0, 2.5);
      g.lineTo(0, 7);
      g.moveTo(-2.5, 4.5);
      g.lineTo(0, 7);
      g.lineTo(2.5, 4.5);
      g.stroke();
      break;
    case 'slippery':
      sun(g, 2, 0, 2.8, 8, GOLD);
      g.strokeStyle = INK;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(-7, -3);
      g.lineTo(-2.5, -3);
      g.moveTo(-7, 0);
      g.lineTo(-3.5, 0);
      g.moveTo(-7, 3);
      g.lineTo(-2.5, 3);
      g.stroke();
      break;
    case 'clockwork':
      g.fillStyle = INK;
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8;
        g.moveTo(Math.cos(a - 0.25) * 4.2, Math.sin(a - 0.25) * 4.2);
        g.lineTo(Math.cos(a - 0.2) * 6.4, Math.sin(a - 0.2) * 6.4);
        g.lineTo(Math.cos(a + 0.2) * 6.4, Math.sin(a + 0.2) * 6.4);
        g.lineTo(Math.cos(a + 0.25) * 4.2, Math.sin(a + 0.25) * 4.2);
      }
      g.fill();
      g.beginPath();
      g.arc(0, 0, 4.4, 0, TAU);
      g.fill();
      g.fillStyle = '#FFF8EE';
      g.beginPath();
      g.arc(0, 0, 1.8, 0, TAU);
      g.fill();
      break;
    case 'gusts':
      g.restore();
      drawWindGlyph(g, x, y, size, 1);
      return;
    case 'lock':
      g.restore();
      drawLockGlyph(g, x, y, size, INK);
      return;
    case 'fog':
      g.strokeStyle = '#8FA3BF';
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-6, -4);
      g.lineTo(4, -4);
      g.moveTo(-3, 0);
      g.lineTo(6, 0);
      g.moveTo(-6, 4);
      g.lineTo(1, 4);
      g.stroke();
      break;
    case 'blind':
      g.strokeStyle = TEAL;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 5.5, 0, TAU);
      g.stroke();
      g.strokeStyle = '#D9644A';
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(-5.5, -5.5);
      g.lineTo(5.5, 5.5);
      g.stroke();
      break;
    case 'eclipse':
      g.fillStyle = GOLD;
      g.beginPath();
      g.arc(0, 0, 5.8, 0, TAU);
      g.fill();
      g.fillStyle = INK;
      g.beginPath();
      g.arc(1.2, 0, 5.2, 0, TAU);
      g.fill();
      break;
    case 'sunset':
      g.save();
      g.beginPath();
      g.rect(-8, -8, 16, 10.5);
      g.clip();
      sun(g, 0, 2.5, 3.4, 8, '#FF9E6B');
      g.restore();
      g.strokeStyle = '#A0611A';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(-7, 3.5);
      g.lineTo(7, 3.5);
      g.stroke();
      break;
    case 'moonlit':
      g.fillStyle = '#E8ECFF';
      g.strokeStyle = '#34306B';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(0, 0, 5.5, 0, TAU);
      g.arc(2.6, -1.6, 4.6, 0, TAU, true);
      g.fill('evenodd');
      break;
    case 'marathon':
      g.strokeStyle = '#8A5A3C';
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(-6, 6);
      g.bezierCurveTo(-6, -2, 6, 6, 6, -6);
      g.stroke();
      g.fillStyle = '#FFFFFF';
      g.strokeStyle = INK;
      g.lineWidth = 0.8;
      g.beginPath();
      g.rect(3.5, -7.5, 5, 3.5);
      g.fill();
      g.stroke();
      break;
    case 'boss':
      sun(g, 0, 0, 4, 10, '#FF6A3D');
      g.strokeStyle = '#7A3B00';
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(-2.6, -1.6);
      g.lineTo(-0.8, -0.6);
      g.moveTo(2.6, -1.6);
      g.lineTo(0.8, -0.6);
      g.stroke();
      break;
    default:
      g.restore();
      drawGoalGlyph(g, x, y, size);
      return;
  }
  g.restore();
}

/** Three wind lines blowing toward `dir` (+1 right, −1 left), for the HUD during a gust. */
export function drawWindGlyph(g: CanvasRenderingContext2D, x: number, y: number, size: number, dir: number): void {
  begin(g, x, y, size);
  if (dir < 0) g.scale(-1, 1);
  g.strokeStyle = SKY;
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
  g.restore();
}

/** A padlock (closed), `size` px wide, for the Sun Lock concept and the halo. */
export function drawLockGlyph(g: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  begin(g, x, y, size);
  g.strokeStyle = color;
  g.lineWidth = 1.8;
  g.beginPath();
  g.arc(0, -2.2, 3.4, PI, 0);
  g.moveTo(-3.4, -2.2);
  g.lineTo(-3.4, 0);
  g.moveTo(3.4, -2.2);
  g.lineTo(3.4, 0);
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.rect(-5.2, -0.5, 10.4, 7.2);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(0, 2.6, 1.3, 0, TAU);
  g.rect(-0.6, 2.6, 1.2, 2.4);
  g.fill();
  g.restore();
}
