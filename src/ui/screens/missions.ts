// Missions (GDD §8, V1_PLAN §11.1-§11.2, V1_1_PLAN UM4-UM6): the Sunny Week, Today's errand, the
// three active missions (with Swap on a stale one) and the achievements wall. Locked achievements
// show riddles and the item they grant. The header links to the Journal.

import { ACHIEVEMENTS, getCosmetic } from '../../meta/content.ts';
import { addDays, formatDateLabel } from '../../meta/daily.ts';
import type { MissionView } from '../../meta/missions.ts';
import { activeMissionViews, errandView } from '../../meta/progression.ts';
import { SUNNY_REWARDS, sunnyDays, weekFor } from '../../meta/week.ts';
import { h, setChildren, svgFromMarkup } from '../dom.ts';
import { icon } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import { button, menuHeader, progressBar } from '../widgets.ts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
/** A day stamp's sun shows one ray per Day reached, up to this many (a gold ring at 5). */
const MAX_RAYS = 5;

/** A day stamp: a sun whose lit rays count the Day reached that date (of 5), an outline when unplayed. */
function sunStamp(best: number): SVGSVGElement {
  let lit = '';
  let dim = '';
  for (let i = 0; i < MAX_RAYS; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / MAX_RAYS;
    const p = (r: number): string => `${(16 + r * Math.cos(a)).toFixed(1)} ${(16 + r * Math.sin(a)).toFixed(1)}`;
    if (i < best) lit += `M${p(9.6)}L${p(14)}`;
    else dim += `M${p(9.6)}L${p(14)}`;
  }
  return svgFromMarkup(
    `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="${dim}" class="wk-rays wk-rays--dim"/><path d="${lit}" class="wk-rays"/><circle cx="16" cy="16" r="6.4" class="wk-sun"/></svg>`,
  );
}

export function createMissionsScreen(ctx: UiContext): Screen {
  const weekDays = h('ol', { class: 'week-days' });
  const weekNote = h('p', { class: 'card-note' });
  const weekCount = h('span', { class: 'card-count' });
  const errandLabel = h('span', { class: 'mcard-label' });
  const errandReward = h('span', { class: 'reward reward--chip' });
  const errandBottom = h('div', { class: 'mcard-bottom' });
  const errandCard = h('div', { class: 'mcard mcard--errand' }, h('div', { class: 'mcard-top' }, errandLabel, errandReward), errandBottom);
  const missionList = h('ul', { class: 'mission-list' });
  const badgeCount = h('span', { class: 'card-count' });
  const badges = h('ul', { class: 'badges' });

  const journalLink = button(ctx, {
    label: 'Journal',
    icon: 'journal',
    className: 'menu-link',
    onPress: () => ctx.go('journal'),
  });

  const body = h(
    'div',
    { class: 'menu-body' },
    h('section', { class: 'card card--week' }, h('h3', { class: 'card-title' }, 'Sunny Week', weekCount), weekDays, weekNote),
    h('section', { class: 'card' }, h('h3', { class: 'card-title' }, "Today's errand"), errandCard),
    h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Active missions'), missionList,
      h('p', { class: 'card-note' }, 'Finished missions pay Snow right away and are swapped for new ones when your next run starts.')),
    h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Achievements', badgeCount), badges),
  );
  const el = h('section', { class: 'scr scr-menu scr-missions', 'aria-label': 'Missions and achievements' },
    h('div', { class: 'menu pe' }, menuHeader(ctx, 'Missions', journalLink), body));

  const reward = (n: number): (Node | string)[] => [icon('snow'), h('span', { 'aria-hidden': 'true' }, `+${n}`), h('span', { class: 'sr-only' }, `Reward ${n} Snow`)];

  const missionCard = (m: MissionView): HTMLElement => {
    const swap = ctx.cb.swapMission;
    return h(
      'li',
      { class: `mcard${m.done ? ' is-done' : ''}` },
      h(
        'div',
        { class: 'mcard-top' },
        h('span', { class: 'mcard-label' }, m.label, m.tierLabel ? h('span', { class: 'tier' }, m.tierLabel) : null),
        h('span', { class: 'reward reward--chip' }, ...reward(m.reward)),
      ),
      h(
        'div',
        { class: 'mcard-bottom' },
        progressBar(m.fraction, 'bar bar--lg'),
        m.done ? h('span', { class: 'stamp stamp--sm' }, 'Complete') : h('span', { class: 'mcard-prog' }, m.progressText),
        m.swappable && swap
          ? button(ctx, { label: 'Swap', icon: 'swap', className: 'btn--swap', ariaLabel: `Swap “${m.label}” for another mission`,
              onPress: () => swap.call(ctx.cb, m.id) })
          : null,
      ),
    );
  };

  function refresh(): void {
    const save = ctx.save();
    const today = ctx.today();

    // The week: Monday to Sunday, today ringed. No streaks and no countdowns (GDD §16).
    const week = weekFor(save.week, today);
    const sunny = sunnyDays(week);
    weekCount.textContent = `${sunny}/7`;
    setChildren(
      weekDays,
      ...WEEKDAYS.map((name, i) => {
        const date = addDays(week.start, i);
        const best = week.best[i] ?? 0;
        const on = (week.days & (1 << i)) !== 0;
        return h(
          'li',
          {
            class: `wk-day${on ? ' is-sunny' : ''}${best >= MAX_RAYS ? ' is-gold' : ''}${date === today ? ' is-today' : ''}`,
            'aria-label': `${formatDateLabel(date)}: ${on ? `played, best Day ${best}` : date > today ? 'to come' : 'not played'}`,
          },
          sunStamp(on ? Math.min(MAX_RAYS, best) : 0),
          h('span', { class: 'wk-name', 'aria-hidden': 'true' }, name),
        );
      }),
    );
    const next = SUNNY_REWARDS.find((r) => sunny < r.days);
    weekNote.textContent = next
      ? `Play on ${next.days} days this week for +${next.snow} Snow. Each sun's rays show the Day you reached.`
      : 'A full Sunny Week! Every sun has its rays.';

    // Today's errand: the same for everyone today.
    const e = errandView(save, today);
    errandCard.classList.toggle('is-done', e.done);
    errandLabel.textContent = e.label;
    setChildren(errandReward, ...reward(e.reward));
    setChildren(errandBottom, progressBar(e.fraction, 'bar bar--lg'),
      e.done ? h('span', { class: 'stamp stamp--sm' }, 'Done') : h('span', { class: 'mcard-prog' }, e.progressText));

    setChildren(missionList, ...activeMissionViews(save).map(missionCard));

    const unlocked = new Set(save.unlocks.achievements);
    badgeCount.textContent = `${unlocked.size}/${ACHIEVEMENTS.length}`;
    setChildren(
      badges,
      ...ACHIEVEMENTS.map((a) => {
        const on = unlocked.has(a.id);
        const item = a.reward ? getCosmetic(a.reward)?.name : undefined;
        return h(
          'li',
          { class: `badge${on ? ' is-on' : ''}`, 'aria-label': `${on ? `${a.name}: ${a.description}` : `Locked: ${a.name}. Hint: ${a.hint}`}${item ? ` Reward: ${item}.` : ''}` },
          h('span', { class: 'badge-medal', 'aria-hidden': 'true' }, icon(on ? 'medal' : 'lock')),
          h('span', { class: 'badge-name', 'aria-hidden': 'true' }, a.name),
          h('span', { class: 'badge-desc', 'aria-hidden': 'true' }, on ? a.description : a.hint),
          item ? h('span', { class: 'badge-reward', 'aria-hidden': 'true' }, icon('gift'), item) : null,
        );
      }),
    );
  }

  return {
    el,
    enter(from) {
      if (from !== 'journal') body.scrollTop = 0;
      refresh();
    },
    refresh,
    back: () => ctx.go('title'),
    initialFocus: () => el.querySelector('.menu-back'),
  };
}
