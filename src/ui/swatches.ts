// Wardrobe tile art: a tiny Nubs bust wearing one item, drawn as SVG from the same look data the
// game renderer uses (meta/content.ts), so tiles always match what Nubs wears in the world.

import type { Cosmetic, HatLook, NoseLook, ScarfLook } from '../meta/content.ts';
import { svgFromMarkup } from './dom.ts';

const SNOW = '#FFFFFF';
const SNOW_RIM = '#C9D8F0';
const COAL = '#2B2B33';

const head = (cx: number, cy: number, r: number): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${SNOW}" stroke="${SNOW_RIM}" stroke-width="1.4"/>`;
const eyes = (cx: number, cy: number): string =>
  `<circle cx="${cx - 3.6}" cy="${cy}" r="1.5" fill="${COAL}"/><circle cx="${cx + 3.6}" cy="${cy}" r="1.5" fill="${COAL}"/>`;

/** Thin parallel lines (`thickness` every `period`) across the swatch, along x or y. */
function lines(color: string, axis: 'x' | 'y', period: number, thickness: number, from: number, to: number): string {
  let out = '';
  for (let p = from; p < to; p += period) {
    out +=
      axis === 'x'
        ? `<rect x="${p}" y="0" width="${thickness}" height="48" fill="${color}"/>`
        : `<rect x="0" y="${p}" width="48" height="${thickness}" fill="${color}"/>`;
  }
  return out;
}

/** Equal consecutive color bands along x. */
function bands(colors: readonly string[], width: number, from: number, to: number): string {
  let out = '';
  for (let p = from, i = 0; p < to; p += width, i++) {
    out += `<rect x="${p}" y="-20" width="${width + 0.2}" height="90" fill="${colors[i % colors.length]}"/>`;
  }
  return out;
}

function scarfArt(id: string, l: ScarfLook): string {
  const clip = `sw-${id}`;
  // Neck wrap plus one hanging tail.
  const shape = 'M12 22.5Q24 26.5 36 22.5L37 28Q24 32.5 11 28ZM28 28.5L34.5 27.5L37.5 41L31.5 42.5Z';
  let fill = `<rect width="48" height="48" fill="${l.main}"/>`;
  switch (l.pattern) {
    case 'stripes':
      fill += lines(l.stripes[0] ?? '#fff', 'y', 4.6, 1.8, 23.5, 44);
      break;
    case 'plaid':
      fill += `<g opacity="0.85">${lines(l.stripes[0] ?? l.shade, 'y', 5.2, 2.2, 23, 44)}</g>`;
      fill += `<g opacity="0.8">${lines(l.stripes[1] ?? l.shade, 'x', 5, 1.3, 11, 40)}</g>`;
      break;
    case 'rainbow':
      // Diagonal bands read as a rainbow on both the wrap and the tail.
      fill = `<g transform="rotate(35 24 30)">${bands(l.stripes, 3.6, -12, 60)}</g>`;
      break;
    case 'metallic':
      fill += `<path d="M10 30L30 18L33 20L13 32Z" fill="${l.shine ?? '#fff'}" opacity="0.8"/><path d="M28 34L38 28L38 33L30 38Z" fill="${l.shine ?? '#fff'}" opacity="0.6"/>`;
      break;
    case 'solid':
      break;
  }
  return `${head(24, 15, 9)}${eyes(24, 14)}<circle cx="24" cy="38" r="12" fill="${SNOW}" stroke="${SNOW_RIM}" stroke-width="1.4"/>
<defs><clipPath id="${clip}"><path d="${shape}"/></clipPath></defs>
<g clip-path="url(#${clip})">${fill}<path d="M11 27.5Q24 32 37 27.5L37 29Q24 33.5 11 29Z" fill="${l.shade}" opacity="0.55"/></g>
<path d="M32 42.5l-.6 2.4M34 42l-.4 2.4M36 41.4l-.2 2.4" stroke="${l.shade}" stroke-width="1.3" stroke-linecap="round"/>`;
}

function hatArt(l: HatLook): string {
  const face = `${head(24, 33, 12)}${eyes(24, 33)}`;
  switch (l.shape) {
    case 'none':
      return face;
    case 'beanie':
      return `${face}<path d="M12.5 27Q12 11 24 11Q36 11 35.5 27Z" fill="${l.main}"/><path d="M17 13.5Q18 21 18 27M24 11.5V27M31 13.5Q30 21 30 27" stroke="${l.shade}" stroke-width="1.2" opacity="0.6" fill="none"/><rect x="11" y="23.5" width="26" height="6" rx="3" fill="${l.shade}"/><circle cx="24" cy="9.5" r="4" fill="${l.accent}"/>`;
    case 'topHat':
      return `${face}<ellipse cx="24" cy="24.5" rx="15" ry="3.6" fill="${l.shade}"/><path d="M15.5 6.5h17v18h-17z" fill="${l.main}"/><path d="M28.5 6.5h4v18h-4z" fill="${l.shade}"/><rect x="15.5" y="17.5" width="17" height="4" fill="${l.accent}"/><ellipse cx="24" cy="6.5" rx="8.5" ry="1.8" fill="${l.shade}"/>`;
    case 'partyCone':
      return `${face}<g transform="rotate(-12 24 24)"><path d="M14.5 25L24 3.5L33.5 25Z" fill="${l.main}"/><path d="M24 3.5L33.5 25H28Z" fill="${l.shade}"/><circle cx="21" cy="19" r="1.7" fill="${l.detail}"/><circle cx="26.5" cy="13" r="1.5" fill="${l.detail}"/><circle cx="27.5" cy="21" r="1.7" fill="${l.detail}"/><circle cx="24" cy="3.5" r="3.2" fill="${l.accent}"/></g>`;
    case 'sunVisor':
      return `${face}<path d="M12.6 27Q13 19.5 24 19.5Q35 19.5 35.4 27L32.5 26Q31 22.6 24 22.6Q17 22.6 15.5 26Z" fill="${l.accent}"/><path d="M27 24Q38 20.5 44 25.5Q37 28.5 27 27.5Z" fill="${l.main}"/><path d="M27 27.5Q37 28.5 44 25.5L43 27.5Q36 30 27 29Z" fill="${l.shade}"/><circle cx="20" cy="21.2" r="1.6" fill="${l.detail}"/>`;
    case 'crown':
      return `${face}<path d="M12.5 26V11l6 6.5L24 8l5.5 9.5 6-6.5v15Z" fill="${l.main}" stroke="${l.shade}" stroke-width="1.2" stroke-linejoin="round"/><rect x="12.5" y="22" width="23" height="4" fill="${l.shade}" opacity="0.6"/><circle cx="18" cy="20" r="1.7" fill="${l.accent}"/><circle cx="24" cy="18.5" r="2" fill="${l.detail}"/><circle cx="30" cy="20" r="1.7" fill="${l.accent}"/>`;
  }
}

function noseArt(l: NoseLook): string {
  const face = `${head(20, 24, 13)}${eyes(19, 20)}<path d="M15.5 30.5Q19.5 33 23.5 30.5" stroke="${COAL}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  const tip = 24 + 18 * l.length;
  switch (l.shape) {
    case 'carrot':
      return `${face}<path d="M22 22.6L${tip} 25.4L22 28.4Z" fill="${l.main}"/><path d="M22 25.6L${tip} 25.4L22 28.4Z" fill="${l.shade}"/><path d="M27 23.6l.6 3.4M31 24.3l.4 2.4" stroke="${l.accent}" stroke-width="1.1" stroke-linecap="round"/>`;
    case 'parsnip':
      return `${face}<path d="M22 22.2Q28 23 ${tip} 25.6Q28 28 22 28.8Z" fill="${l.main}"/><path d="M22 25.8Q30 26.4 ${tip} 25.6Q28 28 22 28.8Z" fill="${l.shade}"/><path d="M26.5 23.6l.5 3.4M31 24.4l.3 2.3M35 25l.2 1.4" stroke="${l.shade}" stroke-width="1" stroke-linecap="round"/><path d="M22.5 22.8Q21 18.5 24.5 17.5" stroke="${l.accent}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    case 'candyCane':
      return `${face}<path d="M22 26H34.5a4.2 4.2 0 0 0 0-8.4a4.2 4.2 0 0 0-4.2 4.2" fill="none" stroke="${l.main}" stroke-width="3.6" stroke-linecap="round"/><path d="M22 26H34.5a4.2 4.2 0 0 0 0-8.4a4.2 4.2 0 0 0-4.2 4.2" fill="none" stroke="${l.accent}" stroke-width="3.6" stroke-dasharray="2.2 2.6" stroke-linecap="butt"/><path d="M22 26H34.5a4.2 4.2 0 0 0 0-8.4a4.2 4.2 0 0 0-4.2 4.2" fill="none" stroke="${l.shade}" stroke-width="0.8" opacity="0.6" transform="translate(0 1.4)"/>`;
    case 'pinecone':
      return `${face}<ellipse cx="29.5" cy="25.6" rx="7.5" ry="5" fill="${l.main}"/><path d="M25 22.8q2 2.8 0 5.6M28.5 21.4q2.4 4.2 0 8.4M32 21.8q2 3.8 0 7.6" stroke="${l.shade}" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M26.5 24.2h2M30 23.6h2M30 27.6h2M26.5 27h2" stroke="${l.accent}" stroke-width="1" stroke-linecap="round"/>`;
  }
}

/** A 48×48 swatch for a Wardrobe tile. */
export function cosmeticSwatch(c: Cosmetic): SVGSVGElement {
  const art = c.look.slot === 'scarf' ? scarfArt(c.id, c.look) : c.look.slot === 'hat' ? hatArt(c.look) : noseArt(c.look);
  return svgFromMarkup(`<svg class="swatch" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${art}</svg>`);
}
