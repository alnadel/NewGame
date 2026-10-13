// Legal screen transitions (V1_PLAN §8 with the v1.1 Journal and the v1.2 Journey). Re-showing the current screen is
// always legal: it refreshes the screen with new data (e.g. Results).

import type { ScreenId } from './types.ts';

const LEGAL: Readonly<Record<ScreenId, readonly ScreenId[]>> = {
  // 'play' straight from boot covers deep links such as ?bot= autoplay.
  boot: ['title', 'play'],
  title: ['play', 'daily', 'wardrobe', 'missions', 'settings', 'journal', 'journey'],
  daily: ['play', 'title'],
  wardrobe: ['title'],
  missions: ['title', 'journal'],
  // Back returns to where the Journal was opened from.
  journal: ['title', 'missions'],
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
