// Journal (V1_1_PLAN UM10 as cut by A15): bests, the last 30 endless runs as a bar chart, and
// lifetime totals. Opened from the Title's Best chip and the Missions header; Back returns there.

import { formatScore } from '../../core/format.ts';
import { scoreText } from '../../meta/share.ts';
import { h, setChildren } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import { journalChart, journalSummary, minutesDelta, playTime } from '../labels.ts';
import type { Screen, UiContext } from '../screen.ts';
import type { ScreenId } from '../types.ts';
import { menuHeader } from '../widgets.ts';

/** Bars keep a sliver of height so a 6:05 AM melt still shows. */
const MIN_BAR = 0.04;

export function createJournalScreen(ctx: UiContext): Screen {
  let origin: ScreenId = 'title';

  const bestEndless = h('span', { class: 'jbest-val' });
  // The best run at standard rules; the best at eased rules (first runs, comfort rungs, the warm-up)
  // shows beside it, marked eased, while it is ahead.
  const bestEased = h('span', { class: 'jbest-eased' });
  const bestDaily = h('span', { class: 'jbest-val' });
  const bests = h(
    'div',
    { class: 'cells' },
    h('div', { class: 'cell' }, h('span', { class: 'kicker' }, 'Best run'), bestEndless, bestEased),
    h('div', { class: 'cell' }, h('span', { class: 'kicker' }, 'Best Daily'), bestDaily),
  );

  const chart = h('div', { class: 'jchart', 'aria-hidden': 'true' });
  const summary = h('p', { class: 'sr-only' });
  const average = h('p', { class: 'javerage' });
  const empty = h('p', { class: 'card-note' }, 'Your endless runs show up here once you have played a few.');
  const legend = h(
    'p',
    { class: 'jlegend', 'aria-hidden': 'true' },
    h('span', { class: 'jkey jkey--best' }, 'Best'),
    h('span', { class: 'jkey jkey--eased' }, 'Eased rules'),
  );

  const totals = h('dl', { class: 'jtotals' });

  const body = h(
    'div',
    { class: 'menu-body' },
    h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Bests'), bests),
    h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Last 30 runs'), chart, summary, average, legend, empty),
    h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Totals'), totals),
  );
  const el = h('section', { class: 'scr scr-menu scr-journal', 'aria-label': 'Journal' }, h('div', { class: 'menu pe' }, menuHeader(ctx, 'Journal'), body));

  const total = (iconName: IconName, label: string, value: string): HTMLElement[] => [
    h('dt', null, icon(iconName), label),
    h('dd', { class: 'tnum' }, value),
  ];

  function refresh(): void {
    const save = ctx.save();
    const st = save.stats;
    bestEndless.textContent = st.bestMinutes > 0 ? formatScore(st.bestMinutes) : '–';
    const eased = st.easedBest > st.bestMinutes;
    bestEased.textContent = eased ? `Eased: ${formatScore(st.easedBest)}` : '';
    bestEased.title = eased ? 'Runs on eased rules (your first runs, a comfort rung, the warm-up) keep a best of their own.' : '';
    bestEased.hidden = !eased;
    const daily = Object.values(save.daily).reduce((m, e) => Math.max(m, e.bestMinutes), 0);
    bestDaily.textContent = daily > 0 ? formatScore(daily) : '–';

    const c = journalChart(save.history);
    setChildren(
      chart,
      ...c.bars.map((b) => {
        const bar = h('i', { class: `jbar jbar--d${Math.min(4, b.day)}${b.best ? ' is-best' : ''}${b.eased ? ' is-eased' : ''}` });
        bar.style.height = `${Math.round(Math.max(MIN_BAR, b.height) * 100)}%`;
        return bar;
      }),
    );
    summary.textContent = journalSummary(c);
    average.replaceChildren();
    if (c.average !== null) {
      average.append('Last 10 average ', h('strong', null, scoreText(c.average)));
      if (c.delta !== null) {
        average.append(
          h('span', { class: `jdelta${c.delta >= 0 ? ' is-up' : ''}` }, `${minutesDelta(c.delta)} vs your previous ${c.previous}`),
        );
      }
    }
    const none = c.bars.length === 0;
    for (const e of [chart, average, legend]) e.hidden = none;
    empty.hidden = !none;

    setChildren(
      totals,
      ...total('retry', 'Runs', String(st.runs)),
      ...total('clock', 'Time played', playTime(st.playSeconds)),
      ...total('moon', 'Days survived', String(st.daysSurvived)),
      ...total('flake', 'Flakes', String(st.flakes)),
      ...total('phew', 'PHEWs', String(st.phews)),
      ...total('swing', 'SWINGs', String(st.swings)),
      ...total('droplet', 'Cloud shade', `${Math.floor(st.cloudSeconds)} s`),
      ...total('snow', 'Snow earned', String(st.lifetimeSnow)),
      ...total('daily', 'Dailies played', String(st.dailyDaysPlayed)),
      ...total('sun', 'Sunny weeks', String(st.sunnyWeeks)),
    );
  }

  return {
    el,
    enter(from) {
      if (from === 'title' || from === 'missions') origin = from;
      body.scrollTop = 0;
      refresh();
    },
    refresh,
    back: () => ctx.go(origin),
    initialFocus: () => el.querySelector('.menu-back'),
  };
}
