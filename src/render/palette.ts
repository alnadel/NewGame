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
/** Biome tints multiplied into the ground: the two biomes read apart at a glance (GR11). */
const OLD_TOWN = hex('#F2D9C4');
const MEADOW = hex('#E6F2CF');
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
export function updatePalette(p: Palette, dayFrac: number, night: number, town: number, highContrast: boolean): void {
  const k = keyAt(dayFrac, scratch);
  const n = night <= 0 ? 0 : night >= 1 ? 1 : night;
  p.dayFrac = dayFrac;
  p.night = n;
  p.town = town;
  p.groundMeadow = mix(multiply(k.ground, MEADOW), NIGHT.ground, n);
  p.groundTown = mix(multiply(k.ground, OLD_TOWN), NIGHT.ground, n);
  const ground = mix(p.groundMeadow, p.groundTown, town);
  p.ground = ground;
  p.groundDeep = darken(ground, 0.08);
  const trail = mix(mix(k.trail, multiply(k.trail, OLD_TOWN), town), NIGHT.trail, n);
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
