// Pause card: Resume / Restart / Settings / Home (GDD §5). Escape resumes.
// UI v2 (docs/UI_V2.md §10.5): a blue panel under a blue "Paused" ribbon (the heading), Nubs dozing
// on top of it, the sub-line and the run's status in wells with art stars.

import { artIcon } from '../art-icons.ts';
import { h } from '../dom.ts';
import type { Screen, UiContext } from '../screen.ts';
import type { ScreenId } from '../types.ts';
import { button, ribbon } from '../widgets.ts';

export function createPauseScreen(ctx: UiContext): Screen {
  let from: ScreenId = 'play';
  const resume = (): void => {
    ctx.go('play');
    ctx.cb.resume();
  };
  const resumeBtn = button(ctx, { label: 'Resume', icon: 'play', variant: 'primary', size: 'lg', block: true, onPress: resume });
  const restartBtn = button(ctx, {
    label: 'Restart',
    icon: 'retry',
    variant: 'blue',
    block: true,
    onPress: () => {
      ctx.go('play');
      ctx.cb.restart();
    },
  });
  const settingsBtn = button(ctx, { label: 'Settings', icon: 'settings', block: true, onPress: () => ctx.go('settings') });
  const homeBtn = button(ctx, {
    label: 'Home',
    icon: 'home',
    block: true,
    onPress: () => {
      ctx.go('title');
      ctx.cb.home();
    },
  });

  // The run so far (v1.4): the level or mode, its goal and progress, the time reached, star pips.
  const statusTitle = h('p', 'pause-st-title');
  const statusGoal = h('p', 'pause-st-goal');
  const statusStars = h('ul', 'pause-st-stars');
  const status = h('div', 'well pause-status', statusTitle, statusGoal, statusStars);
  const STAR_WORD = { earned: 'earned', open: 'still open', lost: 'lost' } as const;
  // Written out whole (never built at run time), so the build can shorten them (vite.config.ts).
  const STAR_CLASS = { earned: 'is-earned', open: 'is-open', lost: 'is-lost' } as const;
  const renderStatus = (): void => {
    const v = ctx.cb.runStatus?.() ?? null;
    status.hidden = v === null;
    card.classList.toggle('has-status', v !== null);
    card.classList.remove('has-stars');
    if (!v) return;
    statusTitle.textContent = v.title;
    // "Day 1 · 6:47 AM" and "16 %" never break inside; the time may give way on short screens (ui.css).
    const nb = (t: string): string => t.replace(/ (AM|PM|%)/g, '\u00a0$1').replace(/Day (\d+) · /g, 'Day\u00a0$1\u00a0·\u00a0');
    statusGoal.replaceChildren(nb(v.goal), v.now ? h('span', 'pause-st-now', `${v.goal ? ' · ' : ''}now ${nb(v.now)}`) : '');
    statusStars.replaceChildren(
      ...v.stars.map((st) =>
        h('li', { class: `tag pause-star ${STAR_CLASS[st.state]}`, 'aria-label': `${st.label}: ${STAR_WORD[st.state]}` }, artIcon(st.state === 'earned' ? 'star' : 'starEmpty', 'ai pause-star-ic'), st.label),
      ),
    );
    statusStars.hidden = v.stars.length === 0;
    // A level's card is the tallest: on short screens its time gives way to the goal and stars (ui.css).
    card.classList.toggle('has-stars', v.stars.length > 0);
  };

  const card = h(
    'div',
    { class: 'dialog pause-card pe', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pause-title' },
    ribbon('Paused', { tone: 'blue', id: 'pause-title', bandClass: 'dialog-title' }).el,
    h('div', { class: 'pause-badge', deco: true }, artIcon('nubsSleep'), h('span', 'gt pause-z', 'z Z')),
    h('p', 'well dialog-sub', 'Nubs is chilling. Take your time.'),
    status,
    resumeBtn,
    restartBtn,
    h('div', 'row-2', settingsBtn, homeBtn),
  );
  const el = h('section', 'scr scr-pause', h('div', 'scrim'), card);

  return {
    el,
    enter(prev) {
      from = prev;
      renderStatus();
      // Coming back from Settings isn't news; arriving from play is.
      if (prev !== 'settings') ctx.announce('Paused');
    },
    back: resume,
    activate() {
      resume();
      return true;
    },
    // Back from Settings: the button that opened it.
    initialFocus: () => (from === 'settings' ? settingsBtn : resumeBtn),
  };
}
