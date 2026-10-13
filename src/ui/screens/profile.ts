// The Profile (v1.4, docs/V1_4_PLAN.md): Sun Rank, the rank road, trophies, the collection and
// lifetime stats. The meta builder owns this screen. V14-SHIM: a header and Back.

import { h } from '../dom.ts';
import type { Screen, UiContext } from '../screen.ts';
import { menuHeader } from '../widgets.ts';

export function createProfileScreen(ctx: UiContext): Screen {
  const el = h('section', { class: 'scr scr-menu scr-profile' }, menuHeader(ctx, 'Profile'));
  return { el, enter: () => {}, back: () => ctx.go('title') };
}
