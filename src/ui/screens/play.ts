// In-play DOM: only the pause button (the HUD is canvas) and a small muted indicator
// (V1_PLAN §12.1: shown while the AudioContext isn't running). Everything else passes through.

import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import { button, hide } from '../widgets.ts';

export interface PlayScreen extends Screen {
  setMuted(muted: boolean): void;
}

export function createPlayScreen(ctx: UiContext): PlayScreen {
  const pause = (): void => {
    ctx.go('pause');
    ctx.cb.pause();
  };
  const pauseBtn = button(ctx, { label: 'Pause', icon: 'pause', round: true, className: 'pause-btn pe', onPress: pause });
  const muted = h('span', { class: 'muted-ind', role: 'img', 'aria-label': 'Sound is off', hidden: true }, icon('mute'));

  return {
    el: h('section', { class: 'scr scr-play', 'aria-label': 'Playing' }, pauseBtn, muted),
    enter() {},
    back: pause,
    setMuted(on) {
      hide(muted, !on);
    },
  };
}
