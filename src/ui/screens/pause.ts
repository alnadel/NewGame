// Pause card: Resume / Restart / Settings / Home (GDD §5). Escape resumes.

import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import type { ScreenId } from '../types.ts';
import { button } from '../widgets.ts';

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
  const statusTitle = h('p', { class: 'pause-st-title' });
  const statusGoal = h('p', { class: 'pause-st-goal' });
  const statusStars = h('ul', { class: 'pause-st-stars' });
  const status = h('div', { class: 'pause-status' }, statusTitle, statusGoal, statusStars);
  const STAR_WORD = { earned: 'earned', open: 'still open', lost: 'lost' } as const;
  const renderStatus = (): void => {
    const v = ctx.cb.runStatus?.() ?? null;
    status.hidden = v === null;
    card.classList.remove('has-stars');
    if (!v) return;
    statusTitle.textContent = v.title;
    // "Day 1 · 6:47 AM" and "16 %" never break inside; the time may give way on short screens (ui.css).
    const nb = (t: string): string => t.replace(/ (AM|PM|%)/g, '\u00a0$1').replace(/Day (\d+) · /g, 'Day\u00a0$1\u00a0·\u00a0');
    statusGoal.replaceChildren(nb(v.goal), v.now ? h('span', { class: 'pause-st-now' }, `${v.goal ? ' · ' : ''}${nb(v.now)}`) : '');
    statusStars.replaceChildren(
      ...v.stars.map((st) =>
        h('li', { class: `pause-star is-${st.state}`, 'aria-label': `${st.label}: ${STAR_WORD[st.state]}` }, h('span', { class: 'pause-star-ic', 'aria-hidden': 'true' }, '★'), st.label),
      ),
    );
    statusStars.hidden = v.stars.length === 0;
    // A level's star pips make the card taller: on short screens its subtitle gives way (ui.css).
    card.classList.toggle('has-stars', v.stars.length > 0);
  };

  const card = h(
    'div',
    { class: 'dialog pause-card pe', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pause-title' },
    h('div', { class: 'pause-badge', 'aria-hidden': 'true' }, icon('pause')),
    h('h2', { class: 'dialog-title', id: 'pause-title' }, 'Paused'),
    h('p', { class: 'dialog-sub' }, 'Nubs is chilling. Take your time.'),
    status,
    resumeBtn,
    restartBtn,
    h('div', { class: 'row-2' }, settingsBtn, homeBtn),
  );
  const el = h('section', { class: 'scr scr-pause' }, h('div', { class: 'scrim' }), card);

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
