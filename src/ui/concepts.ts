// The Journey's concept and biome marks (CAMPAIGN_PLAN §3): each concept id maps to one of the UI's
// inline icons (the render layer draws its own glyphs on the canvas; the DOM map uses these so the
// tiles render identically everywhere). Unknown ids fall back to a flag.

import type { BiomeId, ConceptId } from '../core/index.ts';
import type { IconName } from './icons.ts';
import { BIOME_NAMES } from './labels.ts';

// Partial: concepts the core adds later fall back by name (conceptIcon) instead of failing the build.
const CONCEPT_ICONS: Readonly<Partial<Record<ConceptId | (string & {}), IconName>>> = {
  drag: 'drag',
  flakes: 'flake',
  cloud: 'cloud',
  noon: 'sun',
  oldtown: 'town',
  glare: 'ball',
  swing: 'swing',
  gate: 'gate',
  breezy: 'wind',
  long: 'mountain',
  heat: 'thermo',
  overcast: 'fog',
  dazzle: 'mirror',
  market: 'basket',
  sprint: 'dash',
  stroll: 'steps',
  giants: 'tree',
  lowland: 'flat',
  sparse: 'dots',
  dense: 'grid',
  drought: 'sun',
  fleet: 'cloud',
  thaw: 'thaw',
  frosty: 'snow',
  ration: 'half',
  meltfast: 'droplet',
  hardy: 'anchor',
  flurry: 'flakes',
  heavy: 'gauge',
  slippery: 'spin',
  clockwork: 'detent',
  gusts: 'wind',
  lock: 'lock',
  fog: 'fog',
  blind: 'eyeOff',
  eclipse: 'eclipse',
  sunset: 'sunset',
  moonlit: 'moon',
  marathon: 'road',
  boss: 'dome',
};

/**
 * The icon of a concept (a flag for an id this build doesn't know). The v1.5 mechanics' concepts
 * (named by the core) are found by what their id says: buds and blooms, Cold Snap, deep shade.
 */
export function conceptIcon(id: string): IconName {
  const own = (CONCEPT_ICONS as Partial<Record<string, IconName>>)[id];
  if (own) return own;
  const k = id.toLowerCase();
  if (k.includes('bud') || k.includes('bloom') || k.includes('sunflower')) return 'sunflower';
  if (k.includes('snap')) return 'coldsnap';
  if (k.includes('deep')) return 'deep';
  return 'flag';
}

const BIOME_ICONS: Readonly<Record<BiomeId, IconName>> = { meadow: 'tree', oldtown: 'town' };

export function biomeIcon(id: BiomeId): IconName {
  return BIOME_ICONS[id] ?? 'tree';
}

export function biomeName(id: BiomeId): string {
  return BIOME_NAMES[id] ?? id;
}
