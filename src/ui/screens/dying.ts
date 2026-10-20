// Death animation (canvas): a full-screen invisible catcher so a tap skips straight to Results
// (V1_PLAN §8.4, archive/CRITIQUE #32: retry in well under 1.5 s).

import { h } from '../dom.ts';
import type { Screen, UiContext } from '../screen.ts';

export function createDyingScreen(ctx: UiContext): Screen {
  let skipped = false;
  const skip = (): void => {
    if (skipped) return;
    skipped = true;
    ctx.cb.skipDying();
  };
  const catcher = h('button', { class: 'dying-catch pe', type: 'button', 'aria-label': 'Skip to results' });
  // pointerdown, not click: the skip should land on touch-down, like every other game input.
  catcher.addEventListener('pointerdown', skip);
  catcher.addEventListener('click', skip);

  return {
    // "Tap to skip" fades in after 0.5 s (dying.css); decorative: the catcher's label says it.
    el: h('section', 'scr scr-dying', catcher, h('span', { class: 'chip chip--dark dying-hint', deco: true }, 'Tap to skip')),
    enter() {
      skipped = false;
    },
    back: skip,
    activate() {
      skip();
      return true;
    },
    initialFocus: () => catcher,
  };
}
