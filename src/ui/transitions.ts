// Legal screen transitions (TECH_SPEC §13, minus charms/atlas). Re-showing the current screen is
// always legal: it refreshes the screen with new data (e.g. Results).

import type { ScreenId } from './types.ts';

const LEGAL: Readonly<Record<ScreenId, readonly ScreenId[]>> = {
  // 'play' straight from boot covers deep links such as ?bot= autoplay.
  boot: ['title', 'play'],
  title: ['play', 'daily', 'wardrobe', 'missions', 'settings'],
  daily: ['play', 'title'],
  wardrobe: ['title'],
  missions: ['title'],
  settings: ['title', 'pause'],
  // 'results' directly covers a skipped death animation; 'title' an aborted run.
  play: ['pause', 'dying', 'results', 'title'],
  pause: ['play', 'title', 'settings'],
  dying: ['results'],
  results: ['play', 'title'],
};

export function isLegalTransition(from: ScreenId, to: ScreenId): boolean {
  return from === to || LEGAL[from].includes(to);
}
