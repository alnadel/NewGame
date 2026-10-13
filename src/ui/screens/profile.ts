// The Profile (v1.4, docs/V1_4_PLAN.md): the Sun Rank with the rank road and its rewards, waiting
// Snow Globes, the daily streak, trophies with their progress, the collection and the records that
// were the Journal (bests, the last 30 endless runs, lifetime totals). Opened from the rank badge
// and from Missions; Back returns there. Opening it marks the trophies seen.

import { formatScore } from '../../core/format.ts';
import { ACHIEVEMENTS, COSMETICS, getCosmetic } from '../../meta/content.ts';
import {
  featureIsNew,
  featureUnlocked,
  markFeatureSeen,
  markTrophiesSeen,
  nextGlobeRank,
  rankRoad,
  rankView,
  rarity,
  trophyProgress,
  trophyTier,
} from '../../meta/gamify.ts';
import { CAMPAIGN_STARS_MAX, totalStars } from '../../meta/progression.ts';
import { scoreText } from '../../meta/share.ts';
import { h, setChildren } from '../dom.ts';
import { globeSvg, openGlobes, rankRing, streakCard } from '../gamify.ts';
import { icon, type IconName } from '../icons.ts';
import { journalChart, journalSummary, playTime } from '../labels.ts';
import type { Screen, UiContext } from '../screen.ts';
import { cosmeticSwatch } from '../swatches.ts';
import type { ScreenId } from '../types.ts';
import { button, hide, menuHeader, progressBar } from '../widgets.ts';

/** Bars keep a sliver of height so a 6:05 AM melt still shows. */
const MIN_BAR = 0.04;
/** Trophies shown until "Show all": the unlocked ones first, then the closest to done. */
const TROPHIES_SHOWN = 6;

const card = (title: Node | string, ...children: (Node | null)[]): HTMLElement =>
  h('section', { class: 'card' }, h('h3', { class: 'card-title' }, title), ...children);

export function createProfileScreen(ctx: UiContext): Screen {
  let origin: ScreenId = 'title';
  /** Trophies unlocked since the last visit, counted on entry (before they are marked seen). */
  let fresh = 0;

  // --- Rank -------------------------------------------------------------------------------------
  const ring = rankRing();
  ring.el.setAttribute('aria-hidden', 'true');
  const rankName = h('span', { class: 'rank-name' });
  const xpFill = h('i', { class: 'xp-fill' });
  const xpCount = h('span', { class: 'xp-count num' });
  const xpNext = h('span', { class: 'xp-next' });
  const hero = h(
    'section',
    { class: 'card pf-hero' },
    ring.el,
    h('span', { class: 'rank-text' }, h('span', { class: 'rank-kicker' }), rankName),
    h('span', { class: 'xp-bar', 'aria-hidden': 'true' }, xpFill),
    h('span', { class: 'xp-foot' }, xpCount, xpNext),
  );
  const road = h('ol', { class: 'pf-road', 'aria-label': 'Next ranks and their rewards' });

  // --- Waiting globes, streak -------------------------------------------------------------------
  const globeCount = h('strong', null);
  const openBtn = button(ctx, { label: 'Open', icon: 'gift', variant: 'gold', className: 'pf-open', sound: null, onPress: () => void openGlobes(ctx) });
  const globes = h('section', { class: 'card pf-globes' }, globeSvg(), h('div', null, globeCount, h('span', null, 'Each holds an item you don’t own yet.')), openBtn);
  const streak = streakCard(ctx);

  // --- Trophies -----------------------------------------------------------------------------------
  const trophyCount = h('span', { class: 'card-count' });
  const trophyNew = h('span', { class: 'pf-new' });
  const trophies = h('ul', { class: 'pf-trophies' });
  let showAll = false;
  const moreBtn = button(ctx, { label: 'Show all', className: 'pf-more', onPress: () => {
    showAll = !showAll;
    refresh();
  } });

  // --- Collection -------------------------------------------------------------------------------
  const collectionCount = h('span', { class: 'card-count' });
  const collectionBar = progressBar(0, 'bar bar--lg');
  const swatches = h('ul', { class: 'pf-swatches', 'aria-hidden': 'true' });
  const wardrobeBtn = button(ctx, { label: 'Wardrobe', icon: 'wardrobe', onPress: () => ctx.go('wardrobe') });
  const starsCount = h('span', { class: 'num' });
  const starsBar = progressBar(0, 'bar bar--lg');
  const journeyBtn = button(ctx, { label: 'Journey', icon: 'map', onPress: () => {
    ctx.go('journey');
    ctx.cb.openJourney();
  } });

  // --- Records (the Journal) --------------------------------------------------------------------
  const bests = h('div', { class: 'pf-bests' });
  const chart = h('div', { class: 'pf-chart', 'aria-hidden': 'true' });
  const chartSummary = h('p', { class: 'sr-only' });
  const chartNote = h('p', { class: 'card-note' });
  const totals = h('dl', { class: 'pf-totals' });

  const body = h(
    'div',
    { class: 'menu-body' },
    hero,
    card('Rank road', road, h('p', { class: 'card-note' }, 'Every run earns XP. Missions and trophies pay extra.')),
    globes,
    streak.el,
    card(h('span', null, 'Trophies', trophyNew), trophies, moreBtn),
    card(h('span', null, 'Collection'), h('div', { class: 'pf-row' }, collectionBar, collectionCount), swatches,
      h('div', { class: 'pf-row pf-stars' }, icon('star'), h('span', null, 'Journey stars'), starsCount), starsBar, h('div', { class: 'pf-links' }, wardrobeBtn, journeyBtn)),
    card('Records', bests, chart, chartSummary, chartNote, totals),
  );
  (trophies.parentElement?.querySelector('.card-title') as HTMLElement).append(trophyCount);
  (swatches.parentElement?.querySelector('.card-title') as HTMLElement).append(collectionCount);
  const el = h('section', { class: 'scr scr-menu scr-profile', 'aria-label': 'Profile' }, h('div', { class: 'menu pe' }, menuHeader(ctx, 'Profile'), body));
  const total = (iconName: IconName, label: string, value: string): HTMLElement =>
    h('div', null, h('dt', null, icon(iconName), label), h('dd', null, value));
  const best = (label: string, value: string): HTMLElement => h('div', { class: 'pf-best' }, h('b', null, value), h('span', null, label));

  function refresh(): void {
    const save = ctx.save();
    const st = save.stats;
    const v = rankView(save);

    ring.set(v.level, v.fraction);
    (hero.querySelector('.rank-kicker') as HTMLElement).textContent = `Sun Rank ${v.level}`;
    rankName.textContent = v.title;
    xpFill.style.width = `${(v.fraction * 100).toFixed(1)}%`;
    xpCount.textContent = `${v.into} / ${v.need} XP`;
    xpNext.textContent = `Globe at Rank ${nextGlobeRank(save)}`;
    hero.setAttribute('aria-label', `Sun Rank ${v.level}, ${v.title}. ${v.into} of ${v.need} XP to Rank ${v.level + 1}.`);

    setChildren(
      road,
      ...rankRoad(save).map((n) => {
        const globe = n.reward.kind === 'globe';
        return h(
          'li',
          {
            class: `pf-node${n.reached ? ' is-now' : ''}${globe ? ' is-globe' : ''}`,
            'aria-label': `Rank ${n.level}, ${n.title}${n.reached ? ' (now)' : `: ${globe ? 'a Snow Globe' : `${n.reward.amount} Snow`}`}`,
          },
          h('span', { class: 'pf-node-n num' }, String(n.level)),
          h('span', { class: 'pf-node-r' }, ...(n.reached ? [icon('check')] : globe ? [globeSvg('globe-mini')] : [icon('snow'), `+${n.reward.amount}`])),
          h('span', { class: 'pf-node-t' }, n.title),
        );
      }),
    );

    const g = save.gamify.globes;
    hide(globes, g === 0);
    globeCount.textContent = g === 1 ? '1 Snow Globe to open' : `${g} Snow Globes to open`;
    streak.update(save);
    hide(streak.el, st.runs === 0);

    // Trophies: unlocked first (by tier), then the closest to done.
    const unlocked = new Set(save.unlocks.achievements);
    trophyCount.textContent = `${unlocked.size}/${ACHIEVEMENTS.length}`;
    trophyNew.textContent = fresh > 0 ? `${fresh} new` : '';
    hide(trophyNew, fresh === 0);
    const rows = ACHIEVEMENTS.map((a) => ({ a, p: trophyProgress(save, a.id), on: unlocked.has(a.id) }));
    rows.sort((x, y) => Number(y.on) - Number(x.on) || (x.on ? 0 : y.p.value / y.p.target - x.p.value / x.p.target));
    moreBtn.querySelector('.btn-label')!.textContent = showAll ? 'Show fewer' : `Show all ${ACHIEVEMENTS.length}`;
    moreBtn.setAttribute('aria-expanded', String(showAll));
    setChildren(
      trophies,
      ...rows.slice(0, showAll ? rows.length : TROPHIES_SHOWN).map(({ a, p, on }) => {
        const tier = trophyTier(a.id);
        const item = a.reward ? getCosmetic(a.reward)?.name : undefined;
        const counted = p.target > 1;
        return h(
          'li',
          {
            class: `pf-trophy is-${tier}${on ? ' is-on' : ''}`,
            'aria-label': `${on ? `${a.name}: ${a.description}` : `Locked: ${a.name}. ${a.hint}`} ${tier} trophy${counted && !on ? `, ${p.value} of ${p.target}` : ''}${item ? `. Reward: ${item}` : ''}.`,
          },
          h('span', { class: 'pf-medal', 'aria-hidden': 'true' }, icon(on ? (tier === 'gold' ? 'trophy' : 'medal') : 'lock')),
          h('span', { class: 'pf-trophy-name', 'aria-hidden': 'true' }, a.name),
          h('span', { class: 'pf-trophy-bar', 'aria-hidden': 'true' }, progressBar(p.value / p.target, 'bar'), counted && !on ? `${p.value}/${p.target}` : null),
          h('span', { class: 'pf-trophy-desc', 'aria-hidden': 'true' }, on ? a.description : a.hint, item ? ` · ${item}` : ''),
        );
      }),
    );

    // Collection: every item, owned ones in their rarity's ring.
    const owned = new Set(save.unlocks.cosmetics);
    collectionCount.textContent = `${owned.size}/${COSMETICS.length}`;
    (collectionBar.firstElementChild as HTMLElement).style.width = `${Math.round((owned.size / COSMETICS.length) * 100)}%`;
    setChildren(
      swatches,
      ...COSMETICS.map((c) => {
        const li = h('li', { class: `pf-swatch${owned.has(c.id) ? '' : ' is-missing'}` }, cosmeticSwatch(c));
        if (owned.has(c.id)) li.style.setProperty('--r', `var(--r-${rarity(c)})`);
        return li;
      }),
    );
    const stars = totalStars(save);
    starsCount.textContent = `${stars}/${CAMPAIGN_STARS_MAX}`;
    (starsBar.firstElementChild as HTMLElement).style.width = `${Math.round((stars / CAMPAIGN_STARS_MAX) * 100)}%`;
    hide(wardrobeBtn, !featureUnlocked(save, 'wardrobe'));

    // Records.
    const bestDaily = Object.values(save.daily).reduce((m, e) => Math.max(m, e.bestMinutes), 0);
    setChildren(
      bests,
      best('Best run', st.bestMinutes > 0 ? formatScore(st.bestMinutes) : st.easedBest > 0 ? formatScore(st.easedBest) : '–'),
      best('Best Daily', bestDaily > 0 ? formatScore(bestDaily) : '–'),
      best('Best streak', save.gamify.streak.best > 0 ? `${save.gamify.streak.best} d` : '–'),
    );
    const c = journalChart(save.history);
    setChildren(
      chart,
      ...c.bars.map((b) => {
        const bar = h('i', { class: `is-d${Math.min(4, b.day)}${b.best ? ' is-best' : ''}${b.eased ? ' is-eased' : ''}` });
        bar.style.height = `${Math.round(Math.max(MIN_BAR, b.height) * 100)}%`;
        return bar;
      }),
    );
    chartSummary.textContent = journalSummary(c);
    hide(chart, c.bars.length === 0);
    chartNote.textContent =
      c.average === null ? 'Your Endless runs show up here once you have played a few.' : `Your last ${c.bars.length} Endless runs. Last 10 average ${scoreText(c.average)}.`;
    setChildren(
      totals,
      total('retry', 'Runs', String(st.runs)),
      total('clock', 'Time played', playTime(st.playSeconds)),
      total('moon', 'Days survived', String(st.daysSurvived)),
      total('flake', 'Flakes', String(st.flakes)),
      total('phew', 'PHEWs', String(st.phews)),
      total('swing', 'SWINGs', String(st.swings)),
      total('snow', 'Snow earned', String(st.lifetimeSnow)),
      total('daily', 'Dailies played', String(st.dailyDaysPlayed)),
      total('gift', 'Globes opened', String(save.gamify.opened)),
      total('sun', 'Sunny weeks', String(st.sunnyWeeks)),
    );
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
