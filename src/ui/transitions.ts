// Legal screen transitions (V1_PLAN §8 with the v1.2 Journey and the v1.4 Profile). Re-showing the current screen is
// always legal: it refreshes the screen with new data (e.g. Results).

import type { ScreenId } from './types.ts';

const LEGAL: Readonly<Record<ScreenId, readonly ScreenId[]>> = {
  // 'play' straight from boot covers deep links such as ?bot= autoplay.
  boot: ['title', 'play'],
  title: ['play', 'daily', 'wardrobe', 'missions', 'settings', 'journey', 'profile'],
  // v1.4: the Profile (rank, trophies, collection, records) opens from the rank badge, the Title's
  // best chip and Missions; Back returns there.
  profile: ['title', 'missions', 'wardrobe', 'journey'],
  daily: ['play', 'title'],
  wardrobe: ['title'],
  missions: ['title', 'profile'],
  // The Journey map: a tile starts its level; Back returns to the Title.
  journey: ['play', 'title'],
  settings: ['title', 'pause'],
  // 'results' directly covers a skipped death animation; 'title' an aborted run.
  play: ['pause', 'dying', 'results', 'title'],
  pause: ['play', 'title', 'settings'],
  dying: ['results'],
  // 'journey': Map (or Back) on a Journey run's Results.
  results: ['play', 'title', 'journey'],
};

export function isLegalTransition(from: ScreenId, to: ScreenId): boolean {
  return from === to || LEGAL[from].includes(to);
}
