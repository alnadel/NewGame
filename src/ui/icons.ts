// Inline SVG icon set (24×24, round strokes in currentColor). Drawn for this game; no icon font,
// no emoji (their look varies per platform), so every icon renders identically everywhere.

import { svgFromMarkup } from './dom.ts';

const FILL = 'fill="currentColor" stroke="none"';
/** A sideways drag (the Journey's drag concept and Nubs' gesture). */
const DRAG = `<path d="M2.8 12h18.4"/><path d="m6.2 8.6-3.4 3.4 3.4 3.4M17.8 8.6l3.4 3.4-3.4 3.4"/><circle cx="12" cy="12" r="2.2" ${FILL}/>`;

const ICONS = {
  daily: `<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15.3" r="2.5" ${FILL}/>`,
  missions: `<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 3h6v2.6H9z" ${FILL}/><path d="M8.6 11.2l1.6 1.6 3.2-3.2M8.6 16.6l1.6 1.6 3.2-3.2"/>`,
  wardrobe: `<path d="M7.5 15.5V6.4c0-.8.6-1.4 1.4-1.4h6.2c.8 0 1.4.6 1.4 1.4v9.1"/><path d="M7.5 11.8h9" stroke-width="3.2"/><path d="M3.4 17.4c0-1 .9-1.9 2.4-1.9h12.4c1.5 0 2.4.9 2.4 1.9s-.9 1.6-2.4 1.6H5.8c-1.5 0-2.4-.6-2.4-1.6Z"/>`,
  settings: `<path d="M18.98 9.87 21.42 10.17 21.42 13.83 18.98 14.13 18.45 15.43 19.96 17.37 17.37 19.96 15.43 18.45 14.13 18.98 13.83 21.42 10.17 21.42 9.87 18.98 8.57 18.45 6.63 19.96 4.04 17.37 5.55 15.43 5.02 14.13 2.58 13.83 2.58 10.17 5.02 9.87 5.55 8.57 4.04 6.63 6.63 4.04 8.57 5.55 9.87 5.02 10.17 2.58 13.83 2.58 14.13 5.02 15.43 5.55 17.37 4.04 19.96 6.63 18.45 8.57Z"/><circle cx="12" cy="12" r="3"/>`,
  pause: `<rect x="6.3" y="5" width="4.2" height="14" rx="1.6" ${FILL}/><rect x="13.5" y="5" width="4.2" height="14" rx="1.6" ${FILL}/>`,
  play: `<path d="M8 5.6v12.8a1.1 1.1 0 0 0 1.7.94l10.1-6.4a1.1 1.1 0 0 0 0-1.88L9.7 4.66A1.1 1.1 0 0 0 8 5.6Z" ${FILL}/>`,
  back: `<path d="M14.8 5.2 8 12l6.8 6.8"/>`,
  home: `<path d="M3.8 11.4 12 4.5l8.2 6.9"/><path d="M6.2 9.6v9.2c0 .7.5 1.2 1.2 1.2h3.1v-5.1h3v5.1h3.1c.7 0 1.2-.5 1.2-1.2V9.6"/>`,
  share: `<path d="M12 3.6v10.9"/><path d="M8.1 7.3 12 3.6l3.9 3.7"/><path d="M8.6 10.4H7.4A2.4 2.4 0 0 0 5 12.8v5.3a2.4 2.4 0 0 0 2.4 2.4h9.2a2.4 2.4 0 0 0 2.4-2.4v-5.3a2.4 2.4 0 0 0-2.4-2.4h-1.2"/>`,
  retry: `<path d="M19.4 13.2A7.5 7.5 0 1 1 17 6.6"/><path d="M18.4 3.4v4.4H14"/>`,
  snow: `<path d="M12 2.7v18.6M3.95 7.35l16.1 9.3M3.95 16.65l16.1-9.3M10.07 4.12 12 6.42l1.93-2.3M10.07 19.88 12 17.58l1.93 2.3M4.21 9.73l2.96-.52-1.03-2.82M19.79 14.27l-2.96.52 1.03 2.82M4.21 14.27l2.96.52-1.03 2.82M19.79 9.73l-2.96-.52 1.03-2.82"/>`,
  flake: `<path d="M12 3.4v17.2M4.55 7.7l14.9 8.6M4.55 16.3l14.9-8.6"/><circle cx="12" cy="12" r="2.4" ${FILL}/>`,
  droplet: `<path d="M12 3.6s6 6.3 6 10.4a6 6 0 0 1-12 0c0-4.1 6-10.4 6-10.4Z"/>`,
  trophy: `<path d="M8 4h8v5.2a4 4 0 0 1-8 0Z"/><path d="M8 6H5.3v1.3a3.2 3.2 0 0 0 3.1 3.2M16 6h2.7v1.3a3.2 3.2 0 0 1-3.1 3.2M12 13.2v3.3M8.5 20h7M9.6 20c0-2 1-3.5 2.4-3.5s2.4 1.5 2.4 3.5"/>`,
  medal: `<circle cx="12" cy="15" r="5.2"/><path d="M8.6 10.4 6.2 3.8h3.6l2.2 4.6 2.2-4.6h3.6l-2.4 6.6"/><path d="m12 12.6.8 1.6 1.7.2-1.3 1.2.4 1.7-1.6-.9-1.6.9.4-1.7-1.3-1.2 1.7-.2Z" ${FILL}/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2.6"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/><circle cx="12" cy="15.4" r="1.4" ${FILL}/>`,
  check: `<path d="M5 12.6 9.6 17 19 7.4"/>`,
  close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  flag: `<path d="M5.5 21V3.8"/><path d="M5.5 4.4c4.2-2.3 7.1 2.3 13.5 0v9.4c-6.4 2.3-9.3-2.3-13.5 0" fill="currentColor" fill-opacity=".22"/>`,
  mute: `<path d="M4 9.4v5.2h3.6l4.6 4V5.4l-4.6 4Z" fill="currentColor" fill-opacity=".2"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>`,
  sound: `<path d="M4 9.4v5.2h3.6l4.6 4V5.4l-4.6 4Z" fill="currentColor" fill-opacity=".2"/><path d="M15.6 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>`,
  music: `<path d="M9 17.6V6.2l10-2.2v11.4"/><circle cx="6.6" cy="17.6" r="2.4"/><circle cx="16.6" cy="15.4" r="2.4"/>`,
  vibrate: `<rect x="8" y="4" width="8" height="16" rx="2.2"/><path d="M4.6 9v6M19.4 9v6M2.2 11v2M21.8 11v2"/>`,
  invert: `<path d="M4 8.4h14.5L15 4.9M20 15.6H5.5L9 19.1"/>`,
  gauge: `<path d="M4.4 16.4a7.6 7.6 0 1 1 15.2 0"/><path d="m12 16.4 3.6-4.6"/><circle cx="12" cy="16.4" r="1.3" ${FILL}/>`,
  motion: `<path d="M3 8h8.5M5 12h9M3 16h8.5"/><circle cx="18.2" cy="12" r="2.8"/>`,
  contrast: `<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4Z" ${FILL}/>`,
  compass: `<circle cx="12" cy="12" r="8.6"/><path d="m15.6 8.4-2.2 5-5 2.2 2.2-5Z" fill="currentColor" fill-opacity=".3"/>`,
  sun: `<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8V5M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M5.5 18.5l1.6-1.6M16.9 7.1l1.6-1.6"/>`,
  moon: `<path d="M19.4 14.6A7.9 7.9 0 0 1 9.4 4.6a7.9 7.9 0 1 0 10 10Z"/>`,
  copy: `<rect x="8.6" y="8.6" width="11" height="11.8" rx="2.6"/><path d="M15.4 8.6V6.2a2.6 2.6 0 0 0-2.6-2.6H6.6A2.6 2.6 0 0 0 4 6.2v6.6a2.6 2.6 0 0 0 2.6 2.6h2"/>`,
  restore: `<path d="M12 4v10.6"/><path d="M7.6 10.4 12 14.8l4.4-4.4"/><path d="M5 19.6h14"/>`,
  trash: `<path d="M4.5 7h15M9.6 7V5.2c0-.8.6-1.4 1.4-1.4h2c.8 0 1.4.6 1.4 1.4V7M6.5 7l.9 11.8a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.5 7"/>`,
  plusSquare: `<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.4v7.2M8.4 12h7.2"/>`,
  gift: `<rect x="4" y="9" width="16" height="11" rx="2.2"/><path d="M3.4 9h17.2M12 9v11"/><path d="M12 9C10.6 5.7 6.6 5 6.6 7.2 6.6 8.6 9 9 12 9Zm0 0c1.4-3.3 5.4-4 5.4-1.8C17.4 8.6 15 9 12 9Z"/>`,
  info: `<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.6M12 7.8v.1"/>`,
  warn: `<path d="M12 4.2 21 19.6H3Z"/><path d="M12 10v4.6M12 17.1v.1"/>`,
  bolt: `<path d="M13 3.2 5.6 13.4H12l-1 7.4 7.4-10.2H12Z"/>`,
  phew: `<path d="M3.5 9h10.6a3 3 0 1 0-3-3M3.5 13h14.6a3 3 0 1 1-3 3M3.5 17h6"/>`,
  keyboard: `<rect x="2.6" y="6" width="18.8" height="12" rx="2.6"/><path d="M6.4 10h.1M9.2 10h.1M12 10h.1M14.8 10h.1M17.6 10h.1M6.4 13.8h.1M17.6 13.8h.1M9.4 13.8h5.2"/>`,
  endless: `<path d="M12 12c-2.2-2.7-3.8-4-5.6-4a4 4 0 0 0 0 8c1.8 0 3.4-1.3 5.6-4Zm0 0c2.2 2.7 3.8 4 5.6 4a4 4 0 0 0 0-8c-1.8 0-3.4 1.3-5.6 4Z"/>`,
  chevron: `<path d="M9.4 5.4 16 12l-6.6 6.6"/>`,
  swap: `<path d="M4.6 10a7.6 7.6 0 0 1 13.5-3.6"/><path d="M18.6 3.2v3.9h-3.9"/><path d="M19.4 14a7.6 7.6 0 0 1-13.5 3.6"/><path d="M5.4 20.8v-3.9h3.9"/>`,
  swing: `<path d="M4.4 15.6a8 8 0 0 1 14.8-4.2"/><path d="m20.2 7.6-.9 4.2-4.1-1.2"/><circle cx="12" cy="17.6" r="2.2" ${FILL}/>`,
  clock: `<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3.2 2.1"/>`,
  // Journey (v1.2): the map, stars, a chapter's biome and the concept marks on the level tiles.
  star: `<path d="m12 3.4 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.8l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8Z" ${FILL}/>`,
  map: `<path d="M3.6 6.2v13.2l5.6-2.2 5.6 2.2 5.6-2.2V4l-5.6 2.2L9.2 4Z"/><path d="M9.2 4v15.4M14.8 6.2v13.2"/>`,
  tree: `<path d="M12 3.2 6.6 10.4h2.6L5.4 15.6h4.8L7.4 19.4h9.2l-2.8-3.8h4.8l-3.8-5.2h2.6Z" fill="currentColor" fill-opacity=".18"/><path d="M12 19.4v2"/>`,
  town: `<path d="M3.6 20.4h16.8"/><path d="M4.6 20.4v-8.2l4-3.2 4 3.2v8.2"/><path d="M12.6 12.2V6.6h5.6v13.8"/><path d="M14.8 9.4h1.2M14.8 12.6h1.2M14.8 15.8h1.2M7.6 15.6h2"/>`,
  drag: DRAG,
  cloud: `<path d="M7 18.4a3.6 3.6 0 0 1-.6-7.1 4.8 4.8 0 0 1 9.3-1.3 3.4 3.4 0 0 1 1.5 6.5"/><path d="M7 18.4h10.2"/>`,
  wind: `<path d="M3.4 9h9.2a2.4 2.4 0 1 0-2.4-2.4"/><path d="M3.4 13h13.2a2.6 2.6 0 1 1-2.6 2.6"/><path d="M3.4 17h5.4"/>`,
  fog: `<path d="M4 8.4h10M7 12.4h13M4 16.4h9M16 16.4h3"/>`,
  gate: `<path d="M4.6 20.4V10.2a7.4 7.4 0 0 1 14.8 0v10.2"/><path d="M8.4 20.4v-8a3.6 3.6 0 0 1 7.2 0v8"/><path d="M3 20.4h18"/>`,
  ball: `<circle cx="12" cy="10.6" r="5.8"/><path d="M9.2 8.2a3 3 0 0 1 2-1.4"/><path d="M8.6 20.6h6.8l-1-3.4h-4.8Z"/>`,
  eyeOff: `<path d="M3 3.8l18 16.4"/><path d="M10 6.4A9.4 9.4 0 0 1 12 6.2c5 0 8.4 4.2 9.4 5.8-.5.8-1.5 2.1-2.9 3.3M6.3 7.9C4 9.5 2.9 11.3 2.6 12c1 1.6 4.4 5.8 9.4 5.8 1.5 0 2.8-.4 4-.9"/><path d="M9.6 9.7a3.2 3.2 0 0 0 4.6 4.5"/>`,
  dash: `<path d="M13.4 4.4h6.8M9 9.2h11.2M5 14h15.2M10.6 18.8h9.6"/>`,
  steps: `<path d="M7.2 4.2c-1.8 0-3 2.6-3 5.4 0 1.6.6 2.6 1.9 2.6s2.3-1 2.3-2.8c0-2.8-.6-5.2-1.2-5.2Z" ${FILL}/><path d="M16.8 11.2c1.8 0 3 2.6 3 5.4 0 1.6-.6 2.6-1.9 2.6s-2.3-1-2.3-2.8c0-2.8.6-5.2 1.2-5.2Z" ${FILL}/><path d="M4.6 14.6h3.2M16.2 21.2h3.2"/>`,
  mountain: `<path d="M3 19.4 9.2 7.8l3.4 5.4 2-2.6L21 19.4Z"/><path d="M7.6 10.8 9.2 7.8l1.6 3"/>`,
  flat: `<path d="M3 16.6h18"/><path d="M5 16.6c2-2.6 4-3.6 6-3.6s4 1 6 3.6"/><path d="M8.2 19.6h7.6"/>`,
  dots: `<circle cx="6" cy="12" r="1.8" ${FILL}/><circle cx="12" cy="12" r="1.8" ${FILL}/><circle cx="18" cy="12" r="1.8" ${FILL}/>`,
  grid: `<circle cx="7" cy="7" r="1.8" ${FILL}/><circle cx="12" cy="7" r="1.8" ${FILL}/><circle cx="17" cy="7" r="1.8" ${FILL}/><circle cx="7" cy="12" r="1.8" ${FILL}/><circle cx="12" cy="12" r="1.8" ${FILL}/><circle cx="17" cy="12" r="1.8" ${FILL}/><circle cx="7" cy="17" r="1.8" ${FILL}/><circle cx="12" cy="17" r="1.8" ${FILL}/><circle cx="17" cy="17" r="1.8" ${FILL}/>`,
  thermo: `<path d="M9.6 14.2V5.6a2.4 2.4 0 0 1 4.8 0v8.6a3.6 3.6 0 1 1-4.8 0Z"/><path d="M12 10v6.4"/><circle cx="12" cy="17.6" r="1.4" ${FILL}/>`,
  thaw: `<path d="M12 3.6v7.2M8.9 5.4 12 7.2l3.1-1.8"/><path d="M12 13.6s4.4 4.1 4.4 6.4a4.4 4.4 0 0 1-8.8 0c0-2.3 4.4-6.4 4.4-6.4Z"/>`,
  half: `<rect x="5.5" y="4" width="13" height="16" rx="3"/><path d="M5.5 12h13v5a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3Z" ${FILL}/>`,
  flakes: `<path d="M8 4.6v6M5.4 6.1l2.6 1.5 2.6-1.5M5.4 9.1l2.6-1.5 2.6 1.5"/><path d="M16 12.4v7M13 14.1l3 1.8 3-1.8M13 17.7l3-1.8 3 1.8"/>`,
  anchor: `<circle cx="12" cy="5.6" r="2.2"/><path d="M12 7.8v12.6"/><path d="M5 13.2a7 7 0 0 0 14 0"/><path d="M8.6 12h6.8"/>`,
  eclipse: `<circle cx="12" cy="12" r="6.4"/><path d="M12 5.6a6.4 6.4 0 0 1 0 12.8 7 7 0 0 0 0-12.8Z" ${FILL}/><path d="M12 2.4v1.6M12 20v1.6M2.4 12H4M20 12h1.6M5.2 5.2l1.2 1.2M17.6 17.6l1.2 1.2M5.2 18.8l1.2-1.2M17.6 6.4l1.2-1.2"/>`,
  sunset: `<path d="M3.6 16.4h16.8"/><path d="M7.2 16.4a4.8 4.8 0 0 1 9.6 0"/><path d="M12 6.6v2.2M5.6 10.2l1.5 1.5M18.4 10.2l-1.5 1.5"/><path d="M8.4 20h7.2"/>`,
  road: `<path d="M7.6 20.4 10 3.6h4l2.4 16.8"/><path d="M12 6.4v2.2M12 11.4v2.2M12 16.4v2.2"/>`,
  dome: `<path d="M4.4 15.6a7.6 7.6 0 1 1 15.2 0Z"/><path d="M3 19h18"/><path d="M12 4.6v3.4M12 15.6v-3"/>`,
  // v1.5 mechanics: a sunflower (buds), a cloud dropping a flake (Cold Snap), two shadows overlapping (deep shade).
  sunflower: `<circle cx="12" cy="8.6" r="2.7" ${FILL}/><path d="M12 2.3v2.1M12 12.8v1.6M5.7 8.6h2.1M16.2 8.6h2.1M7.5 4.1 9 5.6M15 11.6l1.3 1.3M16.5 4.1 15 5.6M9 11.6l-1.3 1.3"/><path d="M12 14.6v6.8M12 19.2c1.3-1.8 3-2.2 4.4-1.6-.6 1.6-2.5 2.4-4.4 1.6Z"/>`,
  coldsnap: `<path d="M6.6 12.6a3.2 3.2 0 0 1-.4-6.3 4.4 4.4 0 0 1 8.5-1.1 3.1 3.1 0 0 1 1.6 5.9"/><path d="M6.6 12.6h9.4"/><path d="M12 14.6v6.4M9.2 16.2l5.6 3.2M9.2 19.4l5.6-3.2"/>`,
  deep: `<circle cx="9" cy="12" r="5.8"/><circle cx="15" cy="12" r="5.8"/><path d="M12 7.2a5.8 5.8 0 0 1 0 9.6 5.8 5.8 0 0 1 0-9.6Z" ${FILL}/>`,
  // v1.4: the Snow Globe (rewards: chapters, ranks, the streak).
  globe: `<circle cx="12" cy="10" r="7"/><path d="M6.2 15.6 5 20.6h14l-1.2-5"/><path d="M12 6.8v6.4M9.2 8.4l5.6 3.2M9.2 11.6l5.6-3.2" stroke-width="1.6"/>`,
  basket: `<path d="M3.8 9.6h16.4l-1.6 9.6a1.6 1.6 0 0 1-1.6 1.4H7a1.6 1.6 0 0 1-1.6-1.4Z"/><path d="M8.4 9.6 11 4M15.6 9.6 13 4M9.4 13.4v3.6M12 13.4v3.6M14.6 13.4v3.6"/>`,
  // Elementals v2 (docs/ELEMENTALS_V2.md §7.11): the one gesture set (HEROES[h].gesture): drag the
  // sun, steer (a drop slid sideways); Controls v3 (docs/CONTROLS_V3.md §11.8) placeholders until UI
  // draws its own: press (a press and its ring), vane (a sideways drag).
  'g-drag': DRAG,
  'g-press': `<circle cx="12" cy="12" r="2.8" ${FILL}/><circle cx="12" cy="12" r="7.4"/>`,
  'g-steer': `<path d="M12 6.4s3.4 3.6 3.4 6a3.4 3.4 0 0 1-6.8 0c0-2.4 3.4-6 3.4-6Z"/><path d="M5.6 9.6 3.2 12l2.4 2.4M18.4 9.6l2.4 2.4-2.4 2.4"/>`,
  'g-vane': `<path d="M3.6 12h13.6M13.6 8l4 4-4 4M3.6 7.6h5M3.6 16.4h5"/>`,
} as const;

export type IconName = keyof typeof ICONS;

/** An inline icon, hidden from assistive tech (pair it with a visible label or aria-label). */
export function icon(name: IconName, className = 'ic'): SVGSVGElement {
  return svgFromMarkup(
    `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`,
  );
}
