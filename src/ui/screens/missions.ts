// Missions + achievements wall (GDD §8, V1_PLAN §11.1-§11.2). Locked achievements show riddles.

import { ACHIEVEMENTS, getCosmetic } from '../../meta/content.ts';
import type { MissionView } from '../../meta/missions.ts';
import { activeMissionViews } from '../../meta/progression.ts';
import { h, setChildren } from '../dom.ts';
import { icon } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import { menuHeader, progressBar } from '../widgets.ts';

export function createMissionsScreen(ctx: UiContext): Screen {
  const missionList = h('ul', { class: 'mission-list' });
  const badgeCount = h('span', { class: 'card-count' });
  const badges = h('ul', { class: 'badges' });
  const body = h(
    'div',
    { class: 'menu-body' },
    h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Active missions'), missionList,
      h('p', { class: 'card-note' }, 'Finished missions pay Snow right away and are swapped for new ones when your next run starts.')),
    h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Achievements', badgeCount), badges),
  );
  const el = h('section', { class: 'scr scr-menu scr-missions', 'aria-label': 'Missions and achievements' },
    h('div', { class: 'menu pe' }, menuHeader(ctx, 'Missions'), body));

  const missionCard = (m: MissionView): HTMLElement =>
    h(
      'li',
      { class: `mcard${m.done ? ' is-done' : ''}` },
      h(
        'div',
        { class: 'mcard-top' },
        h('span', { class: 'mcard-label' }, m.label, m.tierLabel ? h('span', { class: 'tier' }, m.tierLabel) : null),
        h('span', { class: 'reward reward--chip', 'aria-label': `Reward ${m.reward} Snow` }, icon('snow'), `+${m.reward}`),
      ),
      h(
        'div',
        { class: 'mcard-bottom' },
        progressBar(m.fraction, 'bar bar--lg'),
        m.done ? h('span', { class: 'stamp stamp--sm' }, 'Complete') : h('span', { class: 'mcard-prog' }, m.progressText),
      ),
    );

  function refresh(): void {
    const save = ctx.save();
    setChildren(missionList, ...activeMissionViews(save).map(missionCard));
    const unlocked = new Set(save.unlocks.achievements);
    badgeCount.textContent = `${unlocked.size}/${ACHIEVEMENTS.length}`;
    setChildren(
      badges,
      ...ACHIEVEMENTS.map((a) => {
        const on = unlocked.has(a.id);
        const reward = a.reward ? getCosmetic(a.reward)?.name : undefined;
        return h(
          'li',
          { class: `badge${on ? ' is-on' : ''}`, 'aria-label': on ? `${a.name}: ${a.description}` : `Locked: ${a.name}. Hint: ${a.hint}` },
          h('span', { class: 'badge-medal', 'aria-hidden': 'true' }, icon(on ? 'medal' : 'lock')),
          h('span', { class: 'badge-name' }, a.name),
          h('span', { class: 'badge-desc' }, on ? a.description : a.hint),
          reward ? h('span', { class: 'badge-reward' }, icon('gift'), reward) : null,
        );
      }),
    );
  }

  return {
    el,
    enter() {
      body.scrollTop = 0;
      refresh();
    },
    refresh,
    back: () => ctx.go('title'),
    initialFocus: () => el.querySelector('.menu-back'),
  };
}
