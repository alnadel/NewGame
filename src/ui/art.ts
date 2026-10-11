// Brand art as pure SVG strings (no DOM access), shared by the Title logo and scripts/gen-icons.ts:
// the sun mascot in sunglasses (GDD §10 colors), the SHADY wordmark and the app icon.

const SUN = {
  core: '#FFE27A',
  rim: '#FFC94A',
  rays: '#FFD36B',
  bloom: '#FFB547',
  glasses: '#1E1E28',
  glint: '#5A5A70',
  mouth: '#7A3B00',
  cheek: '#FF9E6B',
} as const;

const INK = '#2B2140';
const PAPER = '#FFF8EE';
const INDIGO = '#34306B';
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function rays(count: number, inner: number, outer: number, halfAngleDeg: number): string {
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const h = (halfAngleDeg * Math.PI) / 180;
    const p = (ang: number, r: number): string => `${(Math.cos(ang) * r).toFixed(3)} ${(Math.sin(ang) * r).toFixed(3)}`;
    d += `M${p(a - h, inner)}L${p(a, outer)}L${p(a + h, inner)}Z`;
  }
  return d;
}

/** One sunglasses lens in unit space, centered on its own origin. */
const LENS = 'M-0.34 -0.15H0.3Q0.37 -0.15 0.35 -0.05Q0.3 0.21 0.03 0.22Q-0.29 0.22 -0.35 -0.02Q-0.37 -0.15 -0.34 -0.15Z';

export interface SunOptions {
  /** Unique prefix for gradient ids (several suns may share a page). */
  id: string;
  cx: number;
  cy: number;
  /** Core disc radius; rays reach 1.62× and the bloom 1.95×. */
  r: number;
  /** Adds the class hooks `.sun-rays` and `.sun-bob` (for animating a standalone logo). */
  animated?: boolean;
}

/** The mascot's pieces in unit space, bottom to top: bloom, rays, then the disc with its face. */
function sunPieces(id: string): { defs: string; bloom: string; rays: string; face: string } {
  const bloom = `${id}-bloom`;
  return {
    defs: `<defs><radialGradient id="${bloom}"><stop offset="0" stop-color="${SUN.bloom}" stop-opacity="0.38"/><stop offset="1" stop-color="${SUN.bloom}" stop-opacity="0"/></radialGradient></defs>`,
    bloom: `<circle r="1.95" fill="url(#${bloom})"/>`,
    rays: `<path d="${rays(12, 1.1, 1.62, 11)}" fill="${SUN.rays}" stroke="${SUN.rays}" stroke-width="0.08" stroke-linejoin="round"/>`,
    face: `<circle r="1" fill="${SUN.core}" stroke="${SUN.rim}" stroke-width="0.1"/>
<ellipse cx="-0.52" cy="0.3" rx="0.17" ry="0.1" fill="${SUN.cheek}" opacity="0.45"/>
<ellipse cx="0.52" cy="0.3" rx="0.17" ry="0.1" fill="${SUN.cheek}" opacity="0.45"/>
<path d="M-0.88 -0.25Q0 -0.33 0.88 -0.25" fill="none" stroke="${SUN.glasses}" stroke-width="0.09" stroke-linecap="round"/>
<path d="${LENS}" transform="translate(-0.41 -0.1)" fill="${SUN.glasses}"/>
<path d="${LENS}" transform="translate(0.41 -0.1) scale(-1 1)" fill="${SUN.glasses}"/>
<path d="M-0.11 -0.2Q0 -0.27 0.11 -0.2" fill="none" stroke="${SUN.glasses}" stroke-width="0.08" stroke-linecap="round"/>
<path d="M-0.6 -0.08L-0.5 -0.19M-0.5 -0.01L-0.34 -0.18M0.24 -0.08L0.34 -0.19M0.34 -0.01L0.5 -0.18" stroke="${SUN.glint}" stroke-width="0.055" stroke-linecap="round"/>
<path d="M-0.3 0.4Q0.02 0.6 0.32 0.36Q0.38 0.31 0.41 0.25" fill="none" stroke="${SUN.mouth}" stroke-width="0.085" stroke-linecap="round" stroke-linejoin="round"/>`,
  };
}

/** The smug sun in sunglasses as an SVG <g> (plus its <defs>). Drawn in unit space, then scaled. */
export function sunMascot(o: SunOptions): string {
  const p = sunPieces(o.id);
  const raysGroup = `<g${o.animated ? ' class="sun-rays"' : ''}>${p.rays}</g>`;
  return `${p.defs}
<g transform="translate(${o.cx} ${o.cy}) scale(${o.r})"><g${o.animated ? ' class="sun-bob"' : ''}>
${p.bloom}
${raysGroup}
${p.face}
</g></g>`;
}

/** Title logo geometry: viewBox 360 × 172, the sun at (300, 64) with radius 36. */
const LOGO = { w: 360, h: 172, sunX: 300, sunY: 64, sunR: 36 } as const;

function logoText(attrs: string): string {
  return `<text x="180" y="150" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="94" textLength="300" lengthAdjust="spacingAndGlyphs" rotate="-5 3 -3 4 -4" ${attrs}>SHADY</text>`;
}

const WORD_ATTRS = `fill="${PAPER}" stroke="${INK}" stroke-width="11" stroke-linejoin="round" paint-order="stroke"`;
const SHADOW_ATTRS = `fill="${INDIGO}" stroke="${INDIGO}" stroke-width="12" stroke-linejoin="round" opacity="0.45" transform="translate(-9 8)"`;

/**
 * The Title logo as one SVG: the SHADY wordmark in paper with an ink outline, casting a soft indigo
 * shadow down-left, away from the sun peeking over its top-right corner. (The Title itself uses
 * logoLayers(), the same picture split so its motions run on the compositor.)
 */
export function logoSvg(): string {
  return `<svg class="logo-svg" viewBox="0 0 ${LOGO.w} ${LOGO.h}" role="img" aria-label="SHADY" xmlns="http://www.w3.org/2000/svg">
${sunMascot({ id: 'logo-sun', cx: LOGO.sunX, cy: LOGO.sunY, r: LOGO.sunR, animated: true })}
<g class="logo-shadow">${logoText(SHADOW_ATTRS)}</g>
${logoText(WORD_ATTRS)}
</svg>`;
}

export interface LogoLayers {
  /** Sun bloom, rays and face: three stacked layers that bob together; the rays also spin. */
  bloom: string;
  rays: string;
  face: string;
  /** The wordmark's shadow, which sways. */
  shadow: string;
  /** The wordmark (the accessible image, labeled "SHADY"). */
  word: string;
  /** Sun center as percentages of the logo box: the transform-origin of the bob and the spin. */
  origin: { x: string; y: string };
}

/**
 * logoSvg() as separate full-size SVG layers with the same viewBox, so the Title can stack them in
 * HTML wrappers and animate only the wrappers' transforms (composited, no SVG repaints). Sharing the
 * full viewBox keeps every layer on the same pixel grid as the single SVG, so a still frame is
 * pixel-identical to logoSvg().
 */
export function logoLayers(): LogoLayers {
  const p = sunPieces('logo-sun');
  const layer = (body: string, label?: string): string =>
    `<svg class="logo-svg" viewBox="0 0 ${LOGO.w} ${LOGO.h}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"'} xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  const sun = (body: string): string => `<g transform="translate(${LOGO.sunX} ${LOGO.sunY}) scale(${LOGO.sunR})">${body}</g>`;
  const pct = (v: number, of: number): string => `${((v / of) * 100).toFixed(4)}%`;
  return {
    bloom: layer(`${p.defs}${sun(p.bloom)}`),
    rays: layer(sun(p.rays)),
    face: layer(sun(p.face)),
    shadow: layer(logoText(SHADOW_ATTRS)),
    word: layer(logoText(WORD_ATTRS), 'SHADY'),
    origin: { x: pct(LOGO.sunX, LOGO.w), y: pct(LOGO.sunY, LOGO.h) },
  };
}

/**
 * The ghost hand of the drag hint: a cartoon pointing hand, fingertip at (22, 5) of its 48×60 box.
 * Shapes are outlined in one pass and filled in a second, so the overlaps merge into one silhouette.
 */
export function ghostHandSvg(): string {
  const parts =
    '<rect x="17" y="1" width="10" height="32" rx="5"/><rect x="26" y="20" width="9.5" height="17" rx="4.75"/>' +
    '<rect x="34" y="23" width="8.5" height="16" rx="4.25"/><rect x="13" y="27" width="29.5" height="27" rx="11"/>' +
    '<rect x="5" y="31" width="10" height="18" rx="5" transform="rotate(-28 10 40)"/>';
  return `<svg viewBox="0 0 48 60" aria-hidden="true" focusable="false">
<g fill="${INK}" stroke="${INK}" stroke-width="3.6" stroke-linejoin="round" opacity="0.5">${parts}</g>
<g fill="#FFFFFF">${parts}</g>
<path d="M21 26.5v6M29.5 31v4M37.6 33.5v3.5" stroke="${INK}" stroke-opacity="0.18" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;
}

export type IconVariant = 'any' | 'maskable' | 'apple';

/**
 * App icon at 512×512 user units (scale freely):
 * - `any`: rounded square with transparent corners (favicon, manifest "any").
 * - `maskable`: full bleed; artwork scaled into the central 80% safe zone.
 * - `apple`: full bleed (iOS rounds the corners itself).
 */
export function appIconSvg(variant: IconVariant, size = 512): string {
  const shape =
    variant === 'any'
      ? `<rect width="512" height="512" rx="114" fill="url(#bg)"/>`
      : `<rect width="512" height="512" fill="url(#bg)"/>`;
  // Maskable: shrink the artwork into the central 80% safe zone.
  const art = variant === 'maskable' ? ' transform="translate(256 256) scale(0.8) translate(-256 -256)"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
<defs><radialGradient id="bg" cx="0.44" cy="0.42" r="0.75"><stop offset="0" stop-color="#4A4599"/><stop offset="0.7" stop-color="${INDIGO}"/><stop offset="1" stop-color="#2A2759"/></radialGradient></defs>
${shape}
<g${art}>
${sunMascot({ id: 'icon-sun', cx: 226, cy: 214, r: 100 })}
<ellipse cx="414" cy="454" rx="56" ry="12" fill="#1F1B4A" opacity="0.55"/>
<circle cx="392" cy="410" r="44" fill="#FFFFFF"/>
<circle cx="392" cy="352" r="30" fill="#FFFFFF"/>
</g>
</svg>`;
}
