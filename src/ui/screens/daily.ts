// Daily Solstice (V1_PLAN §11.3): today's number and date, tries n/3 (then Practice), best today,
// Play, and the last 14 days.

import { formatScore } from '../../core/format.ts';
import { beforeSaveStart, DAILY_TRIES, formatDateLabel, localDate, recentDates } from '../../meta/daily.ts';
import { dailyStatus, type DailyStatus } from '../../meta/progression.ts';
import { h, setChildren } from '../dom.ts';
import { icon } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import { button, menuHeader, setButtonLabel } from '../widgets.ts';

const HISTORY_DAYS = 14;
export const NEW_DAY_TOAST = "It's a new day: here's today's Daily.";

/** The final day's strip of a stored glyph block (one line per day). */
function lastStrip(glyphs: string): string {
  const lines = glyphs.split('\n');
  return lines[lines.length - 1] ?? '';
}

export function createDailyScreen(ctx: UiContext): Screen {
  /** The date the screen shows (and Play would start): today when it was last rendered. */
  let shown = ctx.today();

  const number = h('span', { class: 'daily-num' });
  const date = h('span', { class: 'daily-date' });
  const tryPips = h('span', { class: 'try-pips', 'aria-hidden': 'true' });
  const tryText = h('span', { class: 'daily-tries-text' });
  const best = h('span', { class: 'daily-best-val' });
  const play = button(ctx, {
    label: 'Play',
    icon: 'play',
    variant: 'primary',
    size: 'lg',
    block: true,
    onPress: () => {
      // The clock may have passed midnight while this screen was open: never start yesterday's
      // Daily from a stale screen. Show today's instead and let the player press again.
      const now = localDate();
      if (now !== shown) {
        ctx.setToday(now);
        refresh();
        ctx.toast(NEW_DAY_TOAST, { icon: 'calendar', tone: 'accent' });
        return;
      }
      ctx.go('play');
      ctx.cb.startRun('daily', shown);
    },
  });
  const history = h('ol', { class: 'daily-list', 'aria-label': `Last ${HISTORY_DAYS} days` });

  const hero = h(
    'div',
    { class: 'card daily-hero' },
    h('div', { class: 'daily-sun', 'aria-hidden': 'true' }, icon('sun')),
    h('p', { class: 'kicker' }, 'Daily Solstice'),
    h('p', { class: 'daily-id' }, number, date),
    h('p', { class: 'daily-blurb' }, 'Same world for everyone today. You get 3 tries and your best one counts.'),
    h(
      'div',
      { class: 'daily-meta' },
      h('div', { class: 'daily-meta-cell' }, h('span', { class: 'kicker' }, 'Tries'), h('span', { class: 'daily-tries' }, tryPips, tryText)),
      h('div', { class: 'daily-meta-cell' }, h('span', { class: 'kicker' }, 'Best today'), best),
    ),
    play,
  );

  const body = h('div', { class: 'menu-body' }, hero, h('section', { class: 'card' }, h('h3', { class: 'card-title' }, 'Recent days'), history));
  const el = h('section', { class: 'scr scr-menu scr-daily', 'aria-label': 'Daily Solstice' }, h('div', { class: 'menu pe' }, menuHeader(ctx, 'Daily'), body));

  /** One history row. Days before the save existed read neutrally ("—"), not as missed. */
  const historyRow = (s: DailyStatus, isToday: boolean, before: boolean): HTMLElement => {
    const unplayed = before ? '—' : isToday ? 'Not played yet' : 'Missed';
    const result = s.played && s.bestMinutes > 0 ? formatScore(s.bestMinutes) : s.played ? 'Melted early' : unplayed;
    const strip = s.glyphs ? lastStrip(s.glyphs) : '';
    const quiet = before && !s.played;
    return h(
      'li',
      { class: `drow${isToday ? ' is-today' : ''}${s.played ? '' : ' is-empty'}${quiet ? ' is-before' : ''}` },
      h('span', { class: 'drow-when' }, h('span', { class: 'drow-num' }, `#${s.number}`), h('span', { class: 'drow-date' }, isToday ? 'Today' : formatDateLabel(s.date))),
      h(
        'span',
        { class: 'drow-result' },
        quiet ? h('span', { class: 'sr-only' }, 'Before you started') : null,
        h('span', { class: 'drow-score', 'aria-hidden': quiet ? 'true' : null }, result),
        strip ? h('span', { class: 'drow-strip', 'aria-hidden': 'true' }, strip) : null,
      ),
      quiet
        ? h('span', { class: 'drow-tries', 'aria-hidden': 'true' })
        : h(
            'span',
            { class: 'drow-tries' },
            h('span', { 'aria-hidden': 'true' }, `${s.tries}/${DAILY_TRIES}`),
            h('span', { class: 'sr-only' }, `${s.tries} of ${DAILY_TRIES} tries`),
          ),
    );
  };

  function refresh(): void {
    const save = ctx.save();
    const today = ctx.today();
    shown = today;
    const s = dailyStatus(save, today);
    number.textContent = `#${s.number}`;
    date.textContent = formatDateLabel(today);
    setChildren(tryPips, ...Array.from({ length: DAILY_TRIES }, (_, i) => h('i', { class: i < s.tries ? 'is-used' : '' })));
    tryText.textContent = s.scored ? `${s.tries}/${DAILY_TRIES} used` : 'All used';
    best.textContent = s.bestMinutes > 0 ? formatScore(s.bestMinutes) : '–';
    setButtonLabel(play, s.scored ? `Play · try ${s.tries + 1}/${DAILY_TRIES}` : 'Practice (unscored)');
    play.classList.toggle('btn--primary', s.scored);
    play.classList.toggle('btn--plain', !s.scored);
    setChildren(
      history,
      ...recentDates(today, HISTORY_DAYS).map((d) => historyRow(dailyStatus(save, d), d === today, beforeSaveStart(d, save.createdAt))),
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
    initialFocus: () => play,
  };
}
