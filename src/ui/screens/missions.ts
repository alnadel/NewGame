// Missions (GDD §8, V1_PLAN §11.1-§11.2, v1.4): the daily streak calendar, the three active
// missions (with Swap on a stale one) and the progress to the next Snow Globe (every third mission
// finished pays one). The trophies live in the Profile, which the header links to.
// Look (docs/UI_V2.md §10.9, styles/missions.css): mission cards are plates with a green bar that
// carries the count, the reward as a cream chip with the Snow gem, COMPLETE as a tilted green stamp;
// the globe row is an ice well with three coins.

import { featureUnlocked, MISSIONS_PER_GLOBE } from '../../meta/gamify.ts';
import type { MissionView } from '../../meta/missions.ts';
import { activeMissionViews } from '../../meta/progression.ts';
import { artIcon } from '../art-icons.ts';
import { h, setChildren } from '../dom.ts';
import { globeSvg, streakCard } from '../gamify.ts';
import type { Screen, UiContext } from '../screen.ts';
import { button, hide, menuHeader, progressBar } from '../widgets.ts';

export function createMissionsScreen(ctx: UiContext): Screen {
  const streak = streakCard(ctx);
  const missionList = h('ul', 'mission-list');
  const pips = h('span', { class: 'mset-pips', deco: true });
  const setText = h('span', null);
  const set = h('p', 'mset well', globeSvg(), setText, pips);

  const trophiesLink = button(ctx, { label: 'Trophies', icon: 'trophy', size: 'sm', className: 'menu-link', onPress: () => ctx.go('profile') });

  const body = h(
    'div',
    { class: 'menu-body' },
    streak.el,
    h('section', 'card', h('h3', 'card-title', 'Active missions'), missionList, set,
      h('p', 'card-note', 'Finished missions pay Snow right away and are swapped for new ones when your next run starts.')),
  );
  const el = h('section', { class: 'scr scr-menu scr-missions', 'aria-label': 'Missions' },
    h('div', 'menu pe', menuHeader(ctx, 'Missions', trophiesLink), body));

  const reward = (n: number): (Node | string)[] => [artIcon('snow'), h('span', { deco: true }, `+${n}`), h('span', 'sr-only', `Reward ${n} Snow`)];

  /** The green bar with the count inside it (the bar is decoration; the count is also read out). */
  const bar = (m: MissionView): HTMLElement => {
    const b = progressBar(m.fraction, 'bar', 'green');
    // A time goal with no run yet reads '–' (meta): the bar says so in words.
    if (!m.done) b.append(h('span', 'bar-label', m.progressText === '–' ? 'Not yet' : m.progressText));
    return b;
  };

  const missionCard = (m: MissionView): HTMLElement =>
    h(
      'li',
      { class: `mcard plate${m.done ? ' is-done' : ''}` },
      h(
        'div',
        { class: 'mcard-top' },
        h('span', 'mcard-label gt-ink', m.label, m.tierLabel ? h('span', 'tier', m.tierLabel) : null),
        h('span', 'chip mcard-reward', ...reward(m.reward)),
      ),
      m.hint && !m.done ? h('p', 'mcard-hint', m.hint) : null,
      h(
        'div',
        { class: 'mcard-bottom' },
        bar(m),
        m.done ? h('span', 'stamp', 'Complete') : h('span', 'mcard-prog sr-only', m.progressText),
        m.swappable
          ? button(ctx, { label: 'Swap', icon: 'swap', size: 'sm', className: 'mcard-swap', ariaLabel: `Swap “${m.label}” for another mission`,
              onPress: () => ctx.cb.swapMission(m.id) })
          : null,
      ),
    );

  function refresh(): void {
    const save = ctx.save();
    streak.update(save);
    hide(streak.el, save.stats.runs === 0);
    setChildren(missionList, ...activeMissionViews(save).map(missionCard));
    const n = save.gamify.missionSet;
    const left = MISSIONS_PER_GLOBE - n;
    setText.textContent = `${left} more ${left === 1 ? 'mission' : 'missions'} for a Snow Globe`;
    set.setAttribute('aria-label', `${n} of ${MISSIONS_PER_GLOBE} missions toward a Snow Globe`);
    setChildren(pips, ...Array.from({ length: MISSIONS_PER_GLOBE }, (_, i) => (i < n ? h('i', 'is-on', artIcon('check')) : h('i', 'socket'))));
    hide(trophiesLink, !featureUnlocked(save, 'profile'));
  }

  return {
    el,
    enter(from) {
      if (from !== 'profile') body.scrollTop = 0;
      refresh();
    },
    refresh,
    back: () => ctx.go('title'),
    initialFocus: () => el.querySelector('.menu-back'),
  };
}
