// The Profile (v1.4, docs/V1_4_PLAN.md): the Sun Rank with the rank road and its rewards, waiting
// Snow Globes, the daily streak, trophies with their progress, the collection and the records that
// were the Journal (bests, the last 30 endless runs, lifetime totals; ui.css's Journal and badge
// styles). Opened from the rank badge, the Title's best chip and Missions; Back returns there.
// Opening it marks the trophies seen.
// Look (docs/UI_V2.md §10.10, styles/profile.css): a violet hero with the rank on a gold medal and a
// name plate, the rank road as candy nodes on a dirt road, trophies as medal cards in their tier,
// the collection as wells ringed by rarity, the records' bests as wells and the chart in a well.

import { formatScore } from '../../core/format.ts';
import { ACHIEVEMENTS, COSMETICS, getCosmetic } from '../../meta/content.ts';
import { featureIsNew, featureUnlocked, markFeatureSeen, markTrophiesSeen, nextGlobeRank, rankRoad, rankView, rarity, trophyProgress, trophyTier } from '../../meta/gamify.ts';
import { CAMPAIGN_STARS_MAX, totalStars } from '../../meta/progression.ts';
import { h, setChildren } from '../dom.ts';
import { artIcon } from '../art-icons.ts';
import { globeSvg, openGlobes, streakCard } from '../gamify.ts';
import { icon, type IconName } from '../icons.ts';
import { journalChart, journalSummary, playTime } from '../labels.ts';
import type { Screen, UiContext } from '../screen.ts';
import { cosmeticSwatch } from '../swatches.ts';
import type { ScreenId } from '../types.ts';
import { button, hide, medal, menuHeader, progressBar } from '../widgets.ts';

/** Bars keep a sliver of height so a 6:05 AM melt still shows. */
const MIN_BAR = 0.04;
/** Trophies shown until "Show all": the unlocked ones first, then the closest to done. */
const TROPHIES_SHOWN = 6;

const fill = (bar: HTMLElement, f: number): void => {
  (bar.firstElementChild as HTMLElement).style.width = `${Math.round(Math.min(1, f) * 100)}%`;
};

// State classes are written out whole (never built at run time), so the build can shorten them (vite.config.ts).
const TIER_CLASS = { bronze: 'is-bronze', silver: 'is-silver', gold: 'is-gold' } as const;
const RARITY_CLASS = { common: 'is-common', rare: 'is-rare', epic: 'is-epic', legendary: 'is-legendary' } as const;

export function createProfileScreen(ctx: UiContext): Screen {
  let origin: ScreenId = 'title';
  /** Trophies unlocked since the last visit, counted on entry (before they are marked seen). */
  let fresh = 0;
  let showAll = false;

  // The hero: the rank number on a gold medal, its name on a plate, the violet XP bar with the
  // count inside it, and when the next Snow Globe comes.
  const rankMedal = medal('1', { size: 80, className: 'pf-medal' });
  rankMedal.setAttribute('aria-hidden', 'true');
  const kicker = h('span', 'rank-kicker');
  const rankName = h('span', 'rank-name gt-ink');
  const xpCount = h('span', 'bar-label');
  const xpBar = progressBar(0, 'bar pf-xp', 'violet');
  xpBar.removeAttribute('aria-hidden');
  xpBar.append(xpCount);
  const xpNext = h('p', 'pf-next');
  const hero = h('section', 'card panel--violet pf-hero', rankMedal, h('span', 'rank-text plate', kicker, rankName), xpBar, xpNext);
  const road = h('ol', 'pf-road');

  const globeCount = h('strong', 'gt-ink');
  const globes = h('section', 'card panel--gold pf-globes', h('span', { class: 'pf-globe-art', deco: true }, globeSvg()),
    h('div', null, globeCount, 'Each holds an item you don’t own yet.'),
    button(ctx, { label: 'Open', icon: 'gift', variant: 'gold', className: 'pf-open', sound: null, onPress: () => void openGlobes(ctx) }));
  const streak = streakCard(ctx);

  const count = (): HTMLElement => h('span', 'card-count');
  const trophyCount = count();
  const trophyNew = h('span', 'sticker pf-new');
  const trophies = h('ul', 'badges');
  const more = button(ctx, { label: '', className: 'pf-more', onPress: () => {
    showAll = !showAll;
    refresh();
  } });

  const ownedCount = count();
  const ownedBar = progressBar(0, 'bar bar--sm');
  const swatches = h('ul', { class: 'pf-swatches', deco: true });
  const starsCount = h('span', 'num');
  const starsBar = progressBar(0, 'bar bar--sm');
  const wardrobeBtn = button(ctx, { label: 'Wardrobe', icon: 'wardrobe', size: 'sm', onPress: () => ctx.go('wardrobe') });
  const journeyBtn = button(ctx, { label: 'Journey', icon: 'map', size: 'sm', onPress: () => {
    ctx.go('journey');
    ctx.cb.openJourney();
  } });

  const bests = h('div', 'cells pf-bests');
  const chart = h('div', { class: 'jchart well', deco: true });
  const chartSummary = h('p', 'sr-only');
  const totals = h('dl', 'jtotals');

  const card = (title: string, right: Node | null, ...children: Node[]): HTMLElement =>
    h('section', 'card', h('h3', 'card-title', title, right), ...children);
  const body = h(
    'div',
    { class: 'menu-body' },
    hero,
    card('Rank road', null, road, h('p', 'card-note', 'Every run earns XP. Missions and trophies pay extra.')),
    globes,
    streak.el,
    card('Trophies', h('span', null, trophyNew, trophyCount), trophies, more),
    card('Collection', ownedCount, ownedBar, swatches,
      h('p', 'pf-row gt-ink', artIcon('star'), 'Journey stars', starsCount), starsBar, h('div', 'pf-links', wardrobeBtn, journeyBtn)),
    card('Records', null, bests, chart, chartSummary, totals),
  );
  const el = h('section', { class: 'scr scr-menu scr-profile', 'aria-label': 'Profile' }, h('div', 'menu pe', menuHeader(ctx, 'Profile'), body));

  function refresh(): void {
    const save = ctx.save();
    const st = save.stats;
    const v = rankView(save);
    rankMedal.textContent = String(v.level);
    rankMedal.classList.toggle('medal--sm', String(v.level).length >= 3);
    kicker.textContent = `Sun Rank ${v.level}`;
    rankName.textContent = v.title;
    fill(xpBar, v.fraction);
    xpCount.textContent = `${v.into} / ${v.need} XP`;
    xpNext.replaceChildren(globeSvg('globe-mini'), `Globe at Rank ${nextGlobeRank(save)}`);

    setChildren(
      road,
      ...rankRoad(save).map((n) => {
        const globe = n.reward.kind === 'globe';
        const what = globe ? 'a Snow Globe' : `${n.reward.amount} Snow`;
        return h(
          'li',
          { class: `pf-node${n.reached ? ' is-now' : ''}${globe ? ' is-globe' : ''}`, 'aria-label': `Rank ${n.level}, ${n.title}${n.reached ? ', now' : `: ${what}`}` },
          h('b', 'node', String(n.level)),
          h('span', 'pf-reward', ...(n.reached ? [artIcon('check')] : globe ? [globeSvg('globe-mini')] : [artIcon('snow'), `+${n.reward.amount}`])),
          h('small', null, n.title),
        );
      }),
    );

    const g = save.gamify.globes;
    hide(globes, g === 0);
    globeCount.textContent = `${g} Snow Globe${g === 1 ? '' : 's'} to open`;
    streak.update(save);
    hide(streak.el, st.runs === 0);

    // Trophies: unlocked first, then the closest to done.
    const unlocked = new Set(save.unlocks.achievements);
    trophyCount.textContent = `${unlocked.size}/${ACHIEVEMENTS.length}`;
    trophyNew.textContent = `${fresh} new`;
    hide(trophyNew, fresh === 0);
    const rows = ACHIEVEMENTS.map((a) => ({ a, p: trophyProgress(save, a.id), on: unlocked.has(a.id) }));
    rows.sort((x, y) => Number(y.on) - Number(x.on) || (x.on ? 0 : y.p.value / y.p.target - x.p.value / x.p.target));
    (more.firstElementChild as HTMLElement).textContent = showAll ? 'Show fewer' : `Show all ${rows.length}`;
    setChildren(
      trophies,
      ...rows.slice(0, showAll ? rows.length : TROPHIES_SHOWN).map(({ a, p, on }) => {
        const tier = trophyTier(a.id);
        const item = a.reward ? getCosmetic(a.reward)?.name : undefined;
        // Counts read as numbers (High Noon's is a clock time: its bar says enough).
        const n = p.target > 1 && !on && a.id !== 'high-noon' ? `${p.value}/${p.target}` : '';
        return h(
          'li',
          { class: `badge plate ${TIER_CLASS[tier]}${on ? ' is-on' : ''}`, 'aria-label': `${on ? `${a.name}: ${a.description}` : `Locked: ${a.name}. ${a.hint}`} ${tier} trophy${n ? `, ${n}` : ''}${item ? `. Reward: ${item}` : ''}.` },
          h('span', { class: `badge-medal medal medal--${on ? tier : 'socket'}`, deco: true }, on ? artIcon('trophy') : icon('lock')),
          h('span', { class: 'badge-name gt-ink', deco: true }, a.name),
          h('span', { class: 'badge-desc', deco: true }, on ? a.description : a.hint),
          on ? null : h('span', { class: 'pf-prog', deco: true }, progressBar(p.value / p.target, 'bar bar--sm'), n),
          item ? h('span', { class: 'badge-reward tag', deco: true }, icon('gift'), item) : null,
        );
      }),
    );

    // Collection: every item, owned ones ringed in their rarity's colour.
    const owned = new Set(save.unlocks.cosmetics);
    ownedCount.textContent = `${owned.size}/${COSMETICS.length}`;
    fill(ownedBar, owned.size / COSMETICS.length);
    setChildren(swatches, ...COSMETICS.map((c) => h('li', { class: owned.has(c.id) ? RARITY_CLASS[rarity(c)] : null }, cosmeticSwatch(c))));
    const stars = totalStars(save);
    starsCount.textContent = `${stars}/${CAMPAIGN_STARS_MAX}`;
    fill(starsBar, stars / CAMPAIGN_STARS_MAX);
    hide(wardrobeBtn, !featureUnlocked(save, 'wardrobe'));

    // Records (the Journal's bests, chart and totals).
    const daily = Object.values(save.daily).reduce((m, e) => Math.max(m, e.bestMinutes), 0);
    const best = Math.max(st.bestMinutes, st.easedBest);
    setChildren(
      bests,
      ...([['Best run', best > 0 ? formatScore(best) : '–'], ['Best Daily', daily > 0 ? formatScore(daily) : '–'],
        ['Best streak', `${save.gamify.streak.best} d`]] as const).map(([k, val]) => h('div', 'cell well', h('span', 'kicker', k), h('span', 'jbest-val gt-ink', val))),
    );
    const c = journalChart(save.history);
    setChildren(
      chart,
      ...c.bars.map((b) => {
        const bar = h('i', `jbar jbar--d${Math.min(4, b.day)}${b.best ? ' is-best' : ''}${b.eased ? ' is-eased' : ''}`);
        bar.style.height = `${Math.round(Math.max(MIN_BAR, b.height) * 100)}%`;
        return bar;
      }),
    );
    chartSummary.textContent = journalSummary(c);
    hide(chart, c.bars.length === 0);
    const rowsOf: [IconName, string, string | number][] = [
      ['retry', 'Runs', st.runs], ['clock', 'Time played', playTime(st.playSeconds)], ['moon', 'Days survived', st.daysSurvived],
      ['flake', 'Flakes', st.flakes], ['phew', 'PHEWs', st.phews], ['swing', 'SWINGs', st.swings], ['snow', 'Snow earned', st.lifetimeSnow],
      ['daily', 'Dailies played', st.dailyDaysPlayed], ['gift', 'Globes opened', save.gamify.opened], ['sun', 'Sunny weeks', st.sunnyWeeks],
    ];
    setChildren(totals, ...rowsOf.flatMap(([i, k, val]) => [h('dt', null, icon(i), k), h('dd', 'gt-ink', String(val))]));
  }

  return {
    el,
    enter(from) {
      if (from === 'title' || from === 'missions') origin = from;
      const save = ctx.save();
      fresh = Math.max(0, save.unlocks.achievements.length - save.gamify.seenTrophies);
      if (from !== 'profile') {
        body.scrollTop = 0;
        showAll = false;
      }
      refresh();
      if (fresh > 0 || featureIsNew(save, 'profile')) ctx.cb.updateSave((s) => markFeatureSeen(markTrophiesSeen(s), 'profile'));
    },
    refresh,
    back: () => ctx.go(origin),
    initialFocus: () => el.querySelector('.menu-back'),
  };
}
