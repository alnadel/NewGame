// v1.4 gamification widgets (docs/V1_4_PLAN.md). CONTRACT FILE: the signatures are fixed for the
// v1.4 builders; the meta builder owns the bodies (V14-SHIM stubs until then). The UX builder
// places these widgets (Title, Results, Journey); the meta builder makes them look and behave.

import type { GamifyOutcome, Reward } from '../meta/gamify.ts';
import type { Save } from '../meta/saveTypes.ts';
import { h } from './dom.ts';
import type { UiContext } from './screen.ts';

/** The rank badge (level number in a progress ring, rank name). Tapping it opens the Profile. */
export function rankBadge(ctx: UiContext): { el: HTMLElement; update(save: Save): void } {
  const el = h('button', { type: 'button', class: 'rank-badge', 'aria-label': 'Profile' });
  el.addEventListener('click', () => ctx.go('profile'));
  return { el, update: () => {} };
}

/** The Results XP meter: fills by the run's XP, rolls over on a rank up. V14-SHIM: empty. */
export function xpMeter(ctx: UiContext): { el: HTMLElement; show(o: GamifyOutcome | undefined, save: Save): void } {
  void ctx;
  const el = h('div', { class: 'xp-meter' });
  return { el, show: () => {} };
}

/** Puts (n > 0) or clears a claim dot with the count on a button. */
export function claimDot(el: HTMLElement, n: number): void {
  el.dataset.dot = n > 0 ? String(Math.min(n, 9)) : '';
  el.classList.toggle('has-dot', n > 0);
}

/**
 * Shows the rewards one at a time in the reward reveal overlay (a Snow Globe shakes and opens),
 * resolving once the player has dismissed the last. V14-SHIM: resolves at once.
 */
export function revealRewards(ctx: UiContext, rewards: readonly Reward[]): Promise<void> {
  void ctx;
  void rewards;
  return Promise.resolve();
}
