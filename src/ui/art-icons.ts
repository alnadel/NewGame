// Art icons (docs/UI_V2.md §6.17): illustrated 48 × 48 icons with their own ink outline, two-tone
// fills and one highlight, for coloured candy buttons, coins and squares (cloud and cream controls
// keep the line icons of icons.ts, in ink). They live as <symbol>s in one hidden sprite that
// createUi puts in #ui; artIcon() points a small <svg> at one. Each symbol carries a hard 2 px ink
// drop: a copy of its shapes, all in ink, 2 px lower, generated here from the same markup (so it
// costs no bytes and never needs a CSS filter, which would repaint during every transition).
//
// Markup shorthand, expanded once when the sprite is built: `O` = the ink outline attributes,
// `#I` = the ink colour.

import { svgFromMarkup } from './dom.ts';

const INK = '#2A1B45';
const OUTLINE = 'stroke="#I" stroke-width="3.5"';
const STAR = '24 4 29.88 16.91 43.97 18.51 33.51 28.09 36.34 41.99 24 35 11.66 41.99 14.49 28.09 4.03 18.51 18.12 16.91Z';
/** A white stroke over a thicker ink one: the chunky outlined glyph (back, retry, check, close…). */
const duo = (d: string, ink: number, white: number, extra = ''): string =>
  `<path d="${d}" fill="none" stroke="#I" stroke-width="${ink}"${extra}/><path d="${d}" fill="none" stroke="#fff" stroke-width="${white}"${extra}/>`;

const ART = {
  star: `<defs><linearGradient id="g-star" x2="0" y2="1"><stop offset="0" stop-color="#FFF27A"/><stop offset=".55" stop-color="#FFC81F"/><stop offset="1" stop-color="#FF9A0A"/></linearGradient></defs><path d="M${STAR}" fill="url(#g-star)" O/><path d="M24 35 36.34 41.99 33.51 28.09 43.97 18.51Z" fill="#E98500" opacity=".35"/><ellipse cx="18.5" cy="20.5" rx="2.6" ry="5.2" transform="rotate(38 18.5 20.5)" fill="#fff" opacity=".85"/>`,
  starEmpty: `<path d="M${STAR}" fill="#4A3768" O/><path d="M24 9.5 28.3 19 38.6 20.2" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="2.5"/>`,
  snow: `<defs><radialGradient id="g-gem" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#F1FDFF"/><stop offset=".45" stop-color="#8EDCFF"/><stop offset="1" stop-color="#2A8EEA"/></radialGradient></defs><circle cx="24" cy="24" r="19.5" fill="url(#g-gem)" O/><path d="M24 12.5v23M14 18.2l20 11.6M14 29.8l20-11.6" stroke="#1B63B5" stroke-width="6"/><path d="M24 12.5v23M14 18.2l20 11.6M14 29.8l20-11.6" stroke="#fff" stroke-width="2.8"/><path d="M11.5 17.5a14 14 0 0 1 9-8" fill="none" stroke="#fff" stroke-width="3"/>`,
  gift: `<rect x="8.5" y="21" width="31" height="20" rx="3.5" fill="#FFC21F" O/><rect x="6" y="14.5" width="36" height="9" rx="3.5" fill="#FFE066" O/><path d="M21 14.5h6V41h-6z" fill="#FF4F6E" O/><path d="M24 14C19 6 11 7.5 13.5 12.5 15 15 21 14.5 24 14Zm0 0c5-8 13-6.5 10.5-1.5C33 15 27 14.5 24 14Z" fill="#FF4F6E" O/><path d="M10.5 18h9" stroke="#fff" stroke-width="2.5" opacity=".8"/>`,
  play: `<path d="M16 9.5 39 24 16 38.5Z" fill="#fff" stroke="#I" stroke-width="4"/>`,
  pause: `<rect x="12.5" y="10" width="8.5" height="28" rx="3" fill="#fff" O/><rect x="27" y="10" width="8.5" height="28" rx="3" fill="#fff" O/>`,
  back: duo('M29 9.5 14.5 24 29 38.5', 13, 6),
  home: `<path d="M8 23 24 9l16 14v15.5a3 3 0 0 1-3 3H28V31h-8v10.5h-9a3 3 0 0 1-3-3Z" fill="#fff" O/><path d="M5.5 24 24 7.5 42.5 24" fill="none" stroke="#I" stroke-width="4.5"/>`,
  share: duo('M17 19h-3.5a3 3 0 0 0-3 3v15.5a3 3 0 0 0 3 3h21a3 3 0 0 0 3-3V22a3 3 0 0 0-3-3H31M24 29V8m-7 6.5L24 7.5l7 7', 10, 4),
  retry: `${duo('M37 27A13 13 0 1 1 31 13.6', 11, 5)}<path d="M27.5 6.5 37.5 12 29 20.5Z" fill="#fff" O/>`,
  map: `<path d="M5.5 11 17 6.5l14 4.5 11.5-4.5v30.5L31 41.5 17 37 5.5 41.5Z" fill="#FFF3D1" O/><path d="M17 6.5 31 11v30.5L17 37Z" fill="#9BE36A" O/><path d="M10 34c4-6 8-1 11-7s7-5 9-8 4-4 7-4" fill="none" stroke="#FF4F6E" stroke-width="3" stroke-dasharray="1 5.2"/><path d="m34.5 10.5 5 5m0-5-5 5" stroke="#FF4F6E" stroke-width="3.2"/>`,
  endless: duo('M24 24c-5-8-15.5-8-15.5 0s10.5 8 15.5 0 15.5-8 15.5 0-10.5 8-15.5 0Z', 12, 5.5),
  daily: `<rect x="6.5" y="10.5" width="35" height="31" rx="6" fill="#fff" O/><path d="M6.5 16.5a6 6 0 0 1 6-6h23a6 6 0 0 1 6 6v5h-35Z" fill="#FF5468" O/><rect x="13" y="5" width="5.5" height="10" rx="2.75" fill="#E7E1F1" O/><rect x="29.5" y="5" width="5.5" height="10" rx="2.75" fill="#E7E1F1" O/><path d="M24 25v2.2M24 37.8V40M16.5 32.5h2.2M29.3 32.5h2.2" stroke="#FFAA00" stroke-width="2.6"/><circle cx="24" cy="32.5" r="4.2" fill="#FFD23F" stroke="#I" stroke-width="2.5"/>`,
  missions: `<rect x="8" y="8" width="32" height="36" rx="5" fill="#D98C4A" O/><rect x="12.5" y="13" width="23" height="26.5" rx="2.5" fill="#fff" stroke="#I" stroke-width="2.5"/><rect x="16.5" y="4.5" width="15" height="8" rx="3" fill="#C8D3EA" O/><path d="m16 21 3 3 5.5-5.5M16 31.5l3 3 5.5-5.5" fill="none" stroke="#3DB52A" stroke-width="3.6"/><path d="M28 22h4M28 32.5h4" stroke="#B9AFCB" stroke-width="3"/>`,
  wardrobe: `<ellipse cx="24" cy="36" rx="19" ry="6" fill="#6E3FD0" O/><path d="M12.5 35V15a4 4 0 0 1 4-4h15a4 4 0 0 1 4 4v20c-3 2.5-20 2.5-23 0Z" fill="#9A6BF2" O/><path d="M12.5 26.5c4 2 19 2 23 0V32c-4 2-19 2-23 0Z" fill="#FF4F6E" O/><path d="M17 15v8" stroke="#fff" stroke-width="3" opacity=".75"/>`,
  settings: `<path d="M38 19.7 42.8 20.3v7.4L38 28.3 36.9 30.9 39.9 34.7 34.7 39.9 30.9 36.9 28.3 38 27.7 42.8h-7.4L19.7 38 17.1 36.9 13.3 39.9 8.1 34.7 11.1 30.9 10 28.3 5.2 27.7v-7.4L10 19.7 11.1 17.1 8.1 13.3 13.3 8.1 17.1 11.1 19.7 10 20.3 5.2h7.4L28.3 10 30.9 11.1 34.7 8.1 39.9 13.3 36.9 17.1Z" fill="#C9D4E8" O/><circle cx="24" cy="24" r="6.8" fill="#5B6E92" O/><path d="M15 15a12 12 0 0 1 6-3" fill="none" stroke="#fff" stroke-width="3"/>`,
  lock: `${duo('M16.5 22v-5a7.5 7.5 0 0 1 15 0v5', 9, 3.5)}<rect x="11" y="21" width="26" height="20" rx="5" fill="#FFC21F" O/><path d="M24 29v6" stroke="#I" stroke-width="4"/>`,
  trophy: `<path d="M14 9h20v11a10 10 0 0 1-20 0Z" fill="#FFC21F" O/><path d="M14 12H8.5v2.5a7 7 0 0 0 7 7M34 12h5.5v2.5a7 7 0 0 1-7 7" fill="none" stroke="#I" stroke-width="3.5"/><path d="M21 29h6v5h-6z" fill="#FFAA00" O/><rect x="14.5" y="34" width="19" height="7" rx="2.5" fill="#D9853C" O/><path d="M18.5 13v6" stroke="#fff" stroke-width="3" opacity=".85"/>`,
  globe: `<circle cx="24" cy="21" r="16" fill="#BFE9FF" O/><path d="M9.6 27.5c5-3 23.8-3 28.8 0A16 16 0 0 1 9.6 27.5Z" fill="#fff" stroke="#I" stroke-width="2"/><circle cx="24" cy="22" r="3.6" fill="#fff" stroke="#I" stroke-width="2"/><path d="M8 36h32l-3.5 7h-25Z" fill="#FFB52E" O/><path d="M14 12a12 12 0 0 1 7-5" fill="none" stroke="#fff" stroke-width="3"/>`,
  nubs: `<circle cx="24" cy="24" r="17" fill="#fff" O/><path d="M11 28.5a17 17 0 0 0 26 0" fill="none" stroke="#CFE3F7" stroke-width="5"/><circle cx="18.5" cy="21" r="2.6" fill="#I"/><circle cx="29.5" cy="21" r="2.6" fill="#I"/><path d="M24 25.5 34 28 24 29.5Z" fill="#FF8A1F" stroke="#I" stroke-width="2"/><path d="M8.5 35.5c6 4 25 4 31 0l-1.5 6c-6 3-22 3-28 0Z" fill="#FF4F5E" O/>`,
  // Nubs dozing (the Pause card): the same head with closed eyes.
  nubsSleep: `<circle cx="24" cy="24" r="17" fill="#fff" O/><path d="M11 28.5a17 17 0 0 0 26 0" fill="none" stroke="#CFE3F7" stroke-width="5"/><path d="M15.5 21.5q3 2.5 6 0M26.5 21.5q3 2.5 6 0" fill="none" stroke="#I" stroke-width="2.6"/><path d="M24 25.5 34 28 24 29.5Z" fill="#FF8A1F" stroke="#I" stroke-width="2"/><path d="M8.5 35.5c6 4 25 4 31 0l-1.5 6c-6 3-22 3-28 0Z" fill="#FF4F5E" O/>`,
  flag: `<path d="M12 44V5" stroke="#I" stroke-width="4.5"/><path d="M12 7h26v18H12Z" fill="#fff" O/><path d="M12 7h6.5v6H12zM25 7h6.5v6H25zM18.5 13H25v6h-6.5zM31.5 13H38v6h-6.5zM12 19h6.5v6H12zM25 19h6.5v6H25z" fill="#I"/>`,
  crown: `<path d="M7 36 9 15l9 9 6-12 6 12 9-9 2 21Z" fill="#FFC21F" O/><path d="M9 31h30" stroke="#E98500" stroke-width="3" opacity=".6"/>`,
  check: duo('m10 25 9 9 19-19', 12, 5.5),
  close: duo('m13 13 22 22M35 13 13 35', 13, 6),
  xp: `<path d="M24 4.5 40.5 14v20L24 43.5 7.5 34V14Z" fill="#9B5DF5" O/><path d="M24 10l11.5 6.8v14.4L24 38 12.5 31.2V16.8Z" fill="#B98AFF"/>`,
} as const;

export type ArtName = keyof typeof ART;

/** True when `name` has an art icon (button() uses it on coloured candy faces). */
export function hasArt(name: string): name is ArtName {
  return Object.prototype.hasOwnProperty.call(ART, name);
}

/** The comic burst outline (§6.18) as path data in a 100 × 100 box. */
export function burstD(n = 14, depth = 0.18): string {
  let d = '';
  for (let i = 0; i < 2 * n; i++) {
    const a = (i * Math.PI) / n - Math.PI / 2;
    const r = 48 * (i % 2 === 0 ? 1 : 1 - depth) * (i % 4 === 2 ? 0.92 : 1);
    d += `${i ? 'L' : 'M'}${(50 + r * Math.cos(a)).toFixed(1)} ${(50 + r * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}Z`;
}

const expand = (s: string): string => s.replace(/ O\//g, ` ${OUTLINE}/`).replace(/#I/g, INK);

/** The ink drop: every shape of `body` in ink, 2 px lower (gradient defs left out: ids are unique). */
const drop = (body: string, dy = 2): string =>
  `<g transform="translate(0 ${dy})">${body.replace(/<defs>.*?<\/defs>/g, '').replace(/(fill|stroke)="(?!none)[^"]*"/g, `$1="${INK}"`).replace(/ opacity="[^"]*"/g, '')}</g>`;

let markup: string | null = null;

function spriteMarkup(): string {
  if (markup) return markup;
  const sym = (id: string, body: string, extra = ''): string =>
    `<symbol id="${id}" viewBox="0 0 48 48" overflow="visible"${extra}><g stroke-linecap="round" stroke-linejoin="round">${body}</g></symbol>`;
  let out = '';
  for (const [name, raw] of Object.entries(ART)) {
    const body = expand(raw);
    out += sym(`a-${name}`, drop(body) + body);
  }
  // The ribbon tail (§6.4): a 50 × 46 swallowtail in currentColor with a fold, its 3 px ink drop baked.
  const tail = expand('<path d="M2 2H48V44H2L15 23Z" fill="currentColor" stroke="#I" stroke-width="4"/><path d="M30 2v42" stroke="#000" stroke-opacity=".28" stroke-width="5"/>');
  out += `<symbol id="k-tail" viewBox="0 0 50 46" overflow="visible"><g stroke-linejoin="round">${drop(tail, 3)}${tail}</g></symbol>`;
  // The comic burst (§6.18), stretched to its box: the stroke keeps its width (non-scaling).
  const b = burstD();
  out += `<symbol id="k-burst" viewBox="0 0 100 100" preserveAspectRatio="none" overflow="visible"><path d="${b}" fill="${INK}" transform="translate(0 4)"/><path d="${b}" fill="currentColor" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></symbol>`;
  markup = `<svg class="ai-sprite" aria-hidden="true" focusable="false" width="0" height="0">${out}</svg>`;
  return markup;
}

/** The hidden sprite of every art symbol; createUi appends it to #ui once. */
export function artSprite(): SVGSVGElement {
  return svgFromMarkup(spriteMarkup());
}

/** An art icon (hidden from assistive tech: pair it with a visible label or an aria-label). */
export function artIcon(name: ArtName, className = 'ai'): SVGSVGElement {
  return svgFromMarkup(`<svg class="${className}" aria-hidden="true" focusable="false"><use href="#a-${name}"/></svg>`);
}

/** A kit shape from the sprite: the ribbon tail or the comic burst. */
export function kitShape(name: 'tail' | 'burst', className: string): SVGSVGElement {
  return svgFromMarkup(`<svg class="${className}" aria-hidden="true" focusable="false"><use href="#k-${name}"/></svg>`);
}
