// Legal screen transitions (V1_PLAN §8 with the v1.2 Journey, the v1.4 Profile and the Elementals). Re-showing the current screen is
// always legal: it refreshes the screen with new data (e.g. Results).

import type { ScreenId } from './types.ts';

const LEGAL: Readonly<Record<ScreenId, readonly ScreenId[]>> = {
  // 'play' straight from boot covers deep links such as ?bot= autoplay.
  boot: ['title', 'play'],
  title: ['play', 'daily', 'wardrobe', 'missions', 'settings', 'journey', 'profile', 'elementals'],
  // v1.4: the Profile (rank, trophies, collection, records) opens from the rank badge, the Title's
  // best chip and Missions; Back returns there.
  profile: ['title', 'missions', 'wardrobe', 'journey'],
  daily: ['play', 'title'],
  // Back returns to where the Wardrobe or the map was opened from (the Title, or the v1.4 Profile).
  wardrobe: ['title', 'profile'],
  missions: ['title', 'profile'],
  // The Journey map: a tile starts its level; Back returns to the Title.
  journey: ['play', 'title', 'profile'],
  // Elementals (docs/ELEMENTALS.md §4.10): a Trial tile or Play starts it; Back returns to the Title.
  elementals: ['play', 'title'],
  settings: ['title', 'pause'],
  // 'results' directly covers a skipped death animation; 'title' an aborted run.
  play: ['pause', 'dying', 'results', 'title'],
  pause: ['play', 'title', 'settings'],
  dying: ['results'],
  // 'journey': Map (or Back) on a Journey run's Results; 'elementals' on a Trial's.
  results: ['play', 'title', 'journey', 'elementals'],
};

export function isLegalTransition(from: ScreenId, to: ScreenId): boolean {
  return from === to || LEGAL[from].includes(to);
}
