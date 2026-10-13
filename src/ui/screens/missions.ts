// Missions (GDD §8, V1_PLAN §11.1-§11.2, v1.4): the daily streak calendar, the three active
// missions (with Swap on a stale one) and the progress to the next Snow Globe (every third mission
// finished pays one). The trophies live in the Profile, which the header links to.

import { featureUnlocked, MISSIONS_PER_GLOBE } from '../../meta/gamify.ts';
import type { MissionView } from '../../meta/missions.ts';
import { activeMissionViews } from '../../meta/progression.ts';
import { h, setChildren } from '../dom.ts';
import { globeSvg, streakCard } from '../gamify.ts';
import { icon } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import { button, hide, menuHeader, progressBar } from '../widgets.ts';

export function createMissionsScreen(ctx: UiContext): Screen {
  const streak = streakCard(ctx);
  const missionList = h('ul', { class: 'mission-list' });
  const pips = h('span', { class: 'mset-pips', 'aria-hidden': 'true' });
  const setText = h('span', null);
  const set = h('p', { class: 'mset' }, globeSvg(), setText, pips);

  const trophiesLink = button(ctx, { label: 'Trophies', icon: 'trophy', className: 'menu-link', onPress: () => ctx.go('profile') });

  const body = h(
    'div',
    { class: 'menu-body' },
    streak.el,
    h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Active missions'), missionList, set,
      h('p', { class: 'card-note' }, 'Finished missions pay Snow right away and are swapped for new ones when your next run starts.')),
  );
  const el = h('section', { class: 'scr scr-menu scr-missions', 'aria-label': 'Missions' },
    h('div', { class: 'menu pe' }, menuHeader(ctx, 'Missions', trophiesLink), body));

  const reward = (n: number): (Node | string)[] => [icon('snow'), h('span', { 'aria-hidden': 'true' }, `+${n}`), h('span', { class: 'sr-only' }, `Reward ${n} Snow`)];

  const missionCard = (m: MissionView): HTMLElement =>
    h(
      'li',
      { class: `mcard${m.done ? ' is-done' : ''}` },
      h(
        'div',
        { class: 'mcard-top' },
        h('span', { class: 'mcard-label' }, m.label, m.tierLabel ? h('span', { class: 'tier' }, m.tierLabel) : null),
        h('span', { class: 'reward reward--chip' }, ...reward(m.reward)),
      ),
      m.hint && !m.done ? h('p', { class: 'mcard-hint' }, m.hint) : null,
      h(
        'div',
        { class: 'mcard-bottom' },
        progressBar(m.fraction, 'bar bar--lg'),
        m.done ? h('span', { class: 'stamp stamp--sm' }, 'Complete') : h('span', { class: 'mcard-prog' }, m.progressText),
        m.swappable
          ? button(ctx, { label: 'Swap', icon: 'swap', className: 'btn--swap', ariaLabel: `Swap “${m.label}” for another mission`,
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
    setChildren(pips, ...Array.from({ length: MISSIONS_PER_GLOBE }, (_, i) => h('i', { class: i < n ? 'is-on' : '' })));
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
