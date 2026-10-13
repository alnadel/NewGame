// Time-of-day palette LUT (GDD §10): keyframes at 6, 9, 12, 15 and 18 o'clock interpolated linearly
// in RGB, a separate night keyframe, and the two biome tints (a green Meadow, a warm terracotta Old
// Town). One Palette object is updated in place every frame; materials are tinted through tint().

import { hex, mix, multiply, darken, lighten, type Rgb } from './color.ts';

interface Key {
  ground: Rgb;
  trail: Rgb;
  shadow: Rgb;
  shadowAlpha: number;
  tint: Rgb;
}

// Shadows are cool (GR5 colour script): violet-blue at dawn, a clean sky blue at noon (it reads as
// "cold, safe" on the cream ground), indigo by dusk; the light around them stays warm. The shadow is
// a multiply, which cannot turn a saturated ochre blue: the dawn, 9 AM and 3 PM grounds are pale
// peach and cream (a warm light, not a warm paint) and their shadow colours lean hard to blue, so
// the shade stays blue-grey to violet at every hour instead of olive or brown (fix round 1). How
// blue they can go is bounded by the matched composite's error on white pickups (shadowLayer.ts,
// ≤ 40 levels in the GR2 A/B): (255 − ground blue)·a·(C_b − C_r)/255 stays under ~39 on both biomes.
const KEYS: readonly Key[] = [
  { ground: hex('#F4CCB2'), trail: hex('#E3A07E'), shadow: hex('#3030CC'), shadowAlpha: 0.52, tint: hex('#FF9E6B') },
  { ground: hex('#F4E0BA'), trail: hex('#DDB88A'), shadow: hex('#2848C8'), shadowAlpha: 0.56, tint: hex('#FFE8C2') },
  { ground: hex('#FFF4DC'), trail: hex('#EAD3A6'), shadow: hex('#2F62C4'), shadowAlpha: 0.62, tint: hex('#FFFFFF') },
  { ground: hex('#F4DEB8'), trail: hex('#D9AD74'), shadow: hex('#2C44C2'), shadowAlpha: 0.56, tint: hex('#FFD59A') },
  { ground: hex('#E8A0B4'), trail: hex('#C76784'), shadow: hex('#2A20A0'), shadowAlpha: 0.52, tint: hex('#D96A8E') },
];

const NIGHT: Key = { ground: hex('#1D2247'), trail: hex('#2A2F5E'), shadow: hex('#1D2247'), shadowAlpha: 0, tint: hex('#3A4380') };
/** Old Town's tint of the trail (the theme tints the biomes' ground, GR11). */
const OLD_TOWN = hex('#F2D9C4');

/** Ambient particles of a chapter (fx.ts): spring petals, falling snow, blown leaves, or none. */
export type ThemeAir = 'petal' | 'snow' | 'leaf' | '';

/**
 * A look (v1.3): the ground tints of the two biomes and of the trail (multiplied in), a grade washed
 * over the whole frame by the atmosphere layer (off in high contrast), and the air's particles.
 */
export interface Theme {
  readonly meadow: Rgb;
  readonly town: Rgb;
  readonly trail: Rgb;
  readonly grade: Rgb;
  readonly gradeA: number;
  readonly air: ThemeAir;
}

const th = (meadow: string, town: string, trail: string, grade: string, gradeA: number, air: ThemeAir): Theme =>
  Object.freeze({ meadow: hex(meadow), town: hex(town), trail: hex(trail), grade: hex(grade), gradeA, air });

/** Endless, Daily and challenge runs: the plain biomes. */
export const PLAIN_THEME: Theme = th('#E6F2CF', '#F2D9C4', '#FFFFFF', '#FFFFFF', 0, '');

/**
 * The Journey's 20 chapters, each its own season and light, so progress shows on the ground: spring
 * meadows, frost, lilac stone, summer straw, harbour salt, moss, brass, snowfields, dusk rose, mint
 * glass, slate, autumn, saffron, storm, ice, parched gold and the scorched dome.
 */
const CHAPTER_THEMES: readonly Theme[] = [
  th('#E6F2CF', '#F2D9C4', '#FFFFFF', '#FFF4DC', 0, 'petal'),
  th('#E6F2CF', '#F2D9C4', '#FFFFFF', '#FFF4DC', 0, ''),
  th('#E2EEF8', '#E6E6F0', '#E8F0FF', '#CFE6FF', 0.1, 'snow'),
  th('#E8E2F0', '#E8D6F0', '#F0E4FF', '#B9A2E6', 0.08, ''),
  th('#D4EEBC', '#F2D9C4', '#FFF6E8', '#E8FFD8', 0.05, 'petal'),
  th('#E6F2CF', '#E2DED8', '#ECE8F0', '#C8D4E6', 0.07, ''),
  th('#F4EDC6', '#F2D9C4', '#FFF0D0', '#FFC46B', 0.06, ''),
  th('#E6F2CF', '#D8E4EA', '#E8F2F6', '#9CC8E6', 0.08, 'leaf'),
  th('#CADFAF', '#F2D9C4', '#F2EAD8', '#6E9A5A', 0.06, ''),
  th('#E6F2CF', '#F0DDB2', '#FFF0C8', '#E6B45A', 0.07, ''),
  th('#ECF3FA', '#E6E6F0', '#EEF4FF', '#DDEEFF', 0.12, 'snow'),
  th('#E6F2CF', '#EED0DA', '#FFE4EC', '#C8789E', 0.09, ''),
  th('#D6F2E6', '#F2D9C4', '#E8FFF6', '#8AE6D8', 0.07, ''),
  th('#E6F2CF', '#D8D4E8', '#E8E6F4', '#6A6AA0', 0.08, ''),
  th('#F2DEB4', '#F2D9C4', '#FFE8C8', '#FF9E4A', 0.07, 'leaf'),
  th('#E6F2CF', '#F8D8AA', '#FFEBC8', '#FFB45A', 0.06, 'petal'),
  th('#D2DECA', '#F2D9C4', '#E8ECE4', '#7F93A8', 0.13, 'leaf'),
  th('#E6F2CF', '#E2E8F4', '#EEF2FF', '#BFDCFF', 0.1, 'snow'),
  th('#F6EAC0', '#F2D9C4', '#FFF0C0', '#FFB04A', 0.07, ''),
  th('#E6F2CF', '#F4D0B6', '#FFE0C8', '#FF6A3D', 0.08, ''),
];

/** The look of a run: its Journey chapter's, else the plain biomes. */
export function themeFor(chapter: number | undefined): Theme {
  return (chapter !== undefined ? CHAPTER_THEMES[chapter - 1] : undefined) ?? PLAIN_THEME;
}
const DAY_TINT_MIX = 0.25;
const NIGHT_TINT_MIX = 0.55;

export interface Palette {
  /** 0..1 position in the daylight (0 = 6:00 AM, 0.5 noon, 1 = 6:00 PM). */
  dayFrac: number;
  /** 0 = day, 1 = full night. */
  night: number;
  /** 0 = meadow, 1 = old town. */
  town: number;
  /** The ground of the current biome blend, and of each biome on its own (its tiles and decor). */
  ground: Rgb;
  groundMeadow: Rgb;
  groundTown: Rgb;
  groundDeep: Rgb;
  trail: Rgb;
  trailEdge: Rgb;
  shadow: Rgb;
  shadowAlpha: number;
  tintColor: Rgb;
  tintMix: number;
  /** Letterbox bars. */
  bar: Rgb;
  /** Cool shade tint for Nubs (drawn above the shadow layer). */
  nubsShade: Rgb;
}

export function createPalette(): Palette {
  return {
    dayFrac: 0,
    night: 0,
    town: 0,
    ground: 0,
    groundMeadow: 0,
    groundTown: 0,
    groundDeep: 0,
    trail: 0,
    trailEdge: 0,
    shadow: 0,
    shadowAlpha: 0,
    tintColor: 0xffffff,
    tintMix: DAY_TINT_MIX,
    bar: 0,
    nubsShade: hex('#C9D6F2'),
  };
}

function keyAt(frac: number, out: Key): Key {
  const f = frac <= 0 ? 0 : frac >= 1 ? 1 : frac;
  const pos = f * (KEYS.length - 1);
  const i = Math.min(KEYS.length - 2, Math.floor(pos));
  const t = pos - i;
  const a = KEYS[i] as Key;
  const b = KEYS[i + 1] as Key;
  out.ground = mix(a.ground, b.ground, t);
  out.trail = mix(a.trail, b.trail, t);
  out.shadow = mix(a.shadow, b.shadow, t);
  out.shadowAlpha = a.shadowAlpha + (b.shadowAlpha - a.shadowAlpha) * t;
  out.tint = mix(a.tint, b.tint, t);
  return out;
}

const scratch: Key = { ground: 0, trail: 0, shadow: 0, shadowAlpha: 0, tint: 0 };

/**
 * Updates `p` for a daylight fraction, a night blend (0..1) and an Old Town blend (0..1).
 * `highContrast` adds +0.17 shadow alpha (GDD §14).
 */
export function updatePalette(p: Palette, dayFrac: number, night: number, town: number, highContrast: boolean, theme: Theme = PLAIN_THEME): void {
  const k = keyAt(dayFrac, scratch);
  const n = night <= 0 ? 0 : night >= 1 ? 1 : night;
  p.dayFrac = dayFrac;
  p.night = n;
  p.town = town;
  p.groundMeadow = mix(multiply(k.ground, theme.meadow), NIGHT.ground, n);
  p.groundTown = mix(multiply(k.ground, theme.town), NIGHT.ground, n);
  const ground = mix(p.groundMeadow, p.groundTown, town);
  p.ground = ground;
  p.groundDeep = darken(ground, 0.08);
  const trailDay = multiply(k.trail, theme.trail);
  const trail = mix(mix(trailDay, multiply(trailDay, OLD_TOWN), town), NIGHT.trail, n);
  p.trail = trail;
  p.trailEdge = darken(trail, 0.12);
  p.shadow = k.shadow;
  p.shadowAlpha = (k.shadowAlpha + (highContrast ? 0.17 : 0)) * (1 - n);
  p.tintColor = mix(k.tint, NIGHT.tint, n);
  p.tintMix = DAY_TINT_MIX + (NIGHT_TINT_MIX - DAY_TINT_MIX) * n;
  p.bar = darken(ground, 0.35);
  p.nubsShade = nubsShadeAt(n);
}

const NUBS_SHADE_DAY = hex('#C9D6F2');
const NUBS_SHADE_NIGHT = hex('#8E9AD0');

/** Nubs' cool shade tint at a night blend (0..1): 60 % of the way to the night tint at full night. */
export function nubsShadeAt(night: number): Rgb {
  return mix(NUBS_SHADE_DAY, NUBS_SHADE_NIGHT, night * 0.6);
}

/** A material color seen under the current light. */
export function tint(p: Palette, material: Rgb): Rgb {
  return mix(material, p.tintColor, p.tintMix);
}

/** Side-face shading: `side` brightened toward `top` when the face looks at the sun (n·u > 0). */
export function faceShade(p: Palette, side: Rgb, top: Rgb, nDotU: number, sunUp: boolean): Rgb {
  const s = tint(p, side);
  if (!sunUp) return s;
  if (nDotU > 0) return mix(s, lighten(tint(p, top), 0.06), 0.45 * nDotU);
  return darken(s, -0.1 * nDotU);
}
