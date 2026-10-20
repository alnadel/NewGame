// Results bottom sheet (GDD §5, V1_PLAN §8.4, V1_1_PLAN UM8): the canvas Melt Map shows above it.
// Big time with the postcard, the Sun Strip (one row of hour tiles per day), NEW BEST ribbon, death
// line typed at 30 chars/s with the recap tip and the pace line, the run's unlocks and bonuses as
// award chips (plus one for the missions done), stats and missions with stamps that land in place
// (and Swap on stale missions).
// Retry arms 0.3 s after the sheet appears; a tap on the map area above the sheet also retries.
// Journey runs (CAMPAIGN_PLAN §5, view.campaign): a compact sheet with the stars as the hero (they
// pop in), the level name, the goal line (the death line too when it wasn't passed), the progress to
// the next star reward, the award chips and one row of stats; Next level (primary when passed) /
// Retry / Map sit at the bottom, in thumb reach. Back and the map tap follow the primary action.
// The unlocks live in the sheet rather than the top toast stack: toasts there would sit over the
// top of the Melt Map, where the named caster pins of the death line usually are.
//
// Sizing: the sheet is at least 58% tall and grows with its content up to the viewport minus
// 96 px of map. The score block stays pinned while stats and missions scroll; on short or
// large-text screens (under 520 px, or under 200 px left for the scroll area) the whole sheet body
// scrolls as one, with Retry always pinned below it.
//
// UI v2 (docs/UI_V2.md §10.3): the sheet is a framed panel; the celebration (the star burst, the
// three hero stars and the ribbon on the sheet's top edge) lives in the map band above
// it (.res-hero), sized to the room there (--hero-scale), so the sheet's height rules and
// resultsSheetTop() keep their meaning. A level adds goal cards; its actions are Retry | Next level |
// Map with the squares' names as tags.

import type { HourGlyph } from '../../core/sim/events.ts';
import { formatScore, formatTimeOfDay, splitMinutes } from '../../core/format.ts';
import { challengeVerdict } from '../../meta/challenge.ts';
import { dailyNumber } from '../../meta/daily.ts';
import type { MissionView } from '../../meta/missions.ts';
import { activeMissionViews, type ToastSpec } from '../../meta/progression.ts';
import { runPlanOn } from '../../meta/share.ts';
import { artIcon } from '../art-icons.ts';
import { h, setChildren, svgFromMarkup } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import {
  campaignKicker,
  dailyRunLabel,
  multiplierTile,
  NOT_COUNTED_NOTE,
  resultsAnnouncement,
  retryLabel,
  starsLabel,
  sunStrip,
  tileFill,
  viewDailyDate,
  type SunStrip,
} from '../labels.ts';
import type { Screen, UiContext } from '../screen.ts';
import type { ResultsView } from '../types.ts';
import { toastIconName } from '../overlays.ts';
import { revealRewards, xpMeter } from '../gamify.ts';
import { button, countUp, fitRibbon, hide, progressBar, ribbon, setButtonLabel, setDisabled, starRoad } from '../widgets.ts';

const RETRY_ARM_MS = 300;
/** The XP meter starts filling this long after an endless sheet appears. */
const XP_ENDLESS_MS = 500;
const TYPE_CPS = 30;
const STAMP_FIRST_MS = 650;
const STAMP_GAP_MS = 300;
/** Award chips pop this far apart, before the stamps. */
const CHIP_GAP_MS = 280;
/** Below this viewport height the sheet body scrolls as one. */
const ONE_SCROLL_BELOW_PX = 520;
/** The stats/missions scroll area must keep at least this much height, or the body scrolls as one. */
const MIN_SCROLL_PX = 200;
/**
 * A sheet that grows with its content stops at 68 % of the screen, so the Melt Map (and the
 * postcard cropped from it) keeps about a third; on tiny screens it keeps at least 96 px, and the
 * sheet may always take 58 %. What doesn't fit scrolls.
 */
const MAP_MIN_PX = 96;
const SHEET_MIN_FRACTION = 0.58;
const SHEET_MAX_FRACTION = 0.68;
/** A Journey level's sheet may take more: it has no postcard and its map matters less. */
const SHEET_MAX_CAMPAIGN = 0.82;
/** Sun Strip rows: the last 4 days, or 2 on screens under 700 px tall. */
const STRIP_ROWS = 4;
const STRIP_ROWS_SHORT = 2;
const STRIP_SHORT_BELOW_PX = 700;
const TAKE_CHALLENGE = 'Take the challenge';
/** Journey stars slam in this long after the sheet, this far apart (reduced motion: fades, 120 ms apart). */
const STAR_FIRST_MS = 420;
const STAR_GAP_MS = 250;
const STAR_FADE_MS = 120;
/** The hero stars' full height (92 / 124 / 92 px) and the room the ribbon's top half takes (§10.3). */
const HERO_STARS_PX = 124;
const HERO_RIBBON_PX = 30;
/** A missed level's sockets never grow past this scale. */
const HERO_MISS_MAX = 0.72;
/** Under this scale the rays go (too little room for them to read). */
const HERO_FX_MIN = 0.55;
/**
 * A level's sheet always leaves the hero this much room under the top inset (results.css mirrors
 * it as 99 px): stars at the rays' scale and the ribbon, never up into the inset.
 */
const HERO_ROOM_MIN = Math.ceil(HERO_RIBBON_PX + HERO_FX_MIN * HERO_STARS_PX);
/** The goal cards' star bits (game/campaign.ts starState): the goal, the flakes or Dare, the cool run lost. */
const BIT_GOAL = 1;
const BIT_TWO = 2;
const BIT_COOL_LOST = 4;
/** Which of the three star rules a run met (the goal, the flakes or Dare, the cool run). */
const rulesMet = (bits: number): boolean[] => [(bits & BIT_GOAL) !== 0, (bits & BIT_TWO) !== 0, (bits & BIT_COOL_LOST) === 0];

/** The glyph art inside a Sun Strip tile (10 px, white on the tile colour). */
const TILE_ART: Readonly<Partial<Record<HourGlyph, string>>> = {
  cool: '<path d="M5 .8v8.4M1.36 2.9l7.28 4.2M1.36 7.1l7.28-4.2M3.9 1.7 5 2.8l1.1-1.1M3.9 8.3 5 7.2l1.1 1.1" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
  hot: '<path d="M5 .6C5.6 2.6 8.4 3.8 8.4 6.4A3.4 3.4 0 0 1 1.6 6.4c0-1.5.9-2.4 1.6-3 .1 1 .6 1.7 1.3 1.9C4.3 3.6 4.4 2 5 .6Z" fill="#fff"/>',
  melt: '<path d="M5 .7S8.5 4.4 8.5 6.6a3.5 3.5 0 0 1-7 0C1.5 4.4 5 .7 5 .7Z" fill="#fff"/>',
};

/** A wrapped line keeps a number with its unit ("14 flakes", "3.7 s"), "≤" with its number and a ✓ with its clause. */
const keepUnits = (s: string): string => s.replace(/(≤|\d) /g, '$1\u00a0').replace(/ ✓/g, '\u00a0✓');

/** "Day 2: 7 cool, 3 warm and 2 hot hours" per row, for screen readers. */
function stripLabel(strip: SunStrip): string {
  const rows = strip.rows.map((r) => {
    const n: Record<HourGlyph, number> = { cool: 0, warm: 0, hot: 0, melt: 0 };
    for (const g of r.tiles) if (g) n[g] += 1;
    const parts = (['cool', 'warm', 'hot'] as const).filter((g) => n[g] > 0).map((g) => `${n[g]} ${g}`);
    const weather = r.forecast ? ` (${r.forecast.name})` : '';
    return `Day ${r.day}${weather}: ${parts.join(', ') || 'no'} hours${n.melt > 0 ? ', then the melt' : ''}.`;
  });
  return `Hour by hour. ${strip.hidden > 0 ? `${strip.hidden} earlier days not shown. ` : ''}${rows.join(' ')}`;
}

export interface ResultsScreen extends Screen {
  /** The postcard's thumbnail (an object URL of the ready PNG), or null while it is built. */
  setPostcard(url: string | null): void;
  /**
   * The sheet's resting top edge in viewport CSS px (slide-in transforms excluded). Cached: it is
   * re-measured only when the sheet or the screen resizes (ResizeObserver), on enter and on
   * invalidateSheetTop(), so reading it every frame costs no layout.
   */
  sheetTop(): number;
  /** The world column moved: re-measure the sheet top. */
  invalidateSheetTop(): void;
}

export function createResultsScreen(ctx: UiContext): ResultsScreen {
  let armed = false;
  let timers: number[] = [];
  /** Counts renders (and leaves), so an XP fill or reveal that ends later doesn't act on another sheet. */
  let renders = 0;
  let typing = 0;
  let stopCount = (): void => {};

  const later = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms));
  };
  const stopAll = (): void => {
    renders++; // a pending XP fill or reveal no longer belongs to the shown sheet
    for (const t of timers) clearTimeout(t);
    timers = [];
    clearInterval(typing);
    stopCount();
  };

  const retry = (): void => {
    if (!armed) return;
    armed = false;
    ctx.go('play');
    ctx.cb.retry();
  };
  const home = (): void => {
    ctx.go('title');
    ctx.cb.home();
  };
  // Journey: the next level (a passed level's primary action) and the map.
  const next = (): void => {
    if (!armed) return;
    armed = false;
    ctx.go('play');
    ctx.cb.nextLevel();
  };
  const map = (): void => {
    ctx.go('journey');
    ctx.cb.openJourney();
  };
  /** The reward reveal is up: the sheet's actions wait for it. */
  let revealing = false;
  const hasNext = (): boolean => shown?.campaign?.passed === true && shown.campaign.nextId !== null;
  /** Retry, or Next level on a passed Journey level (the map tap, Space/Enter). */
  const primary = (): void => (hasNext() ? next() : retry());
  /** Back: Home, or the Journey map after a level. */
  const leave = (): void => {
    if (!revealing) (shown?.campaign ? map : home)();
  };
  const shared = (outcome: string): void => {
    if (outcome === 'copied') ctx.toast('Copied! Paste it anywhere.', { icon: 'check', tone: 'accent' });
    else if (outcome === 'saved') ctx.toast('Postcard saved · link copied', { icon: 'check', tone: 'accent' });
    else if (outcome === 'failed') ctx.toast("Couldn't share from this browser.", { icon: 'warn', tone: 'danger' });
  };
  // Both run synchronously in the click task (the share sheet needs the tap's user activation).
  const share = (): void => void ctx.cb.share().then(shared);
  const sharePostcard = (): void => void ctx.cb.sharePostcard().then(shared);

  // The map area above the sheet: tap = retry. Hidden from assistive tech (Retry is the real control).
  const mapCatch = h('div', { class: 'res-map pe', deco: true });
  mapCatch.addEventListener('pointerdown', primary);

  // The hero in the map band: the ribbon on the sheet's edge ("Level 38 Passed!", "So close!",
  // "New best!"; decorative: the heading and the live region say it), the stars above it and, on a
  // passed level, the rays behind them (the canvas throws the confetti).
  const heroRibbon = ribbon('', { tone: 'red', tag: 'p', className: 'res-ribbon', hidden: true });
  const kicker = h('p', 'res-kicker');
  const dayBadge = h('span', 'candy f-violet gt res-day');
  const clock = h('span', 'res-clock');
  const time = h('h2', { class: 'res-time', id: 'res-time' }, dayBadge, clock);
  // The postcard: a 4:5 thumbnail of the shareable image (a placeholder while it is built).
  const postcardThumb = h('img', { class: 'res-postcard-img', alt: '', decoding: 'async' });
  const postcardBtn = h(
    'button',
    { class: 'candy f-cloud res-postcard pe', type: 'button', 'aria-label': 'Share the postcard' },
    h('span', { class: 'res-postcard-card', deco: true }, postcardThumb),
    h('span', { class: 'res-postcard-label', deco: true }, icon('share'), 'Postcard'),
  );
  postcardBtn.addEventListener('click', () => {
    ctx.sound('tap');
    sharePostcard();
  });
  // Journey: the stars (in the hero) and the level name take the time's place; the goal line, the
  // goal cards and the progress to the next star reward follow.
  const starEls = Array.from({ length: 3 }, () => h('span', 'res-star', artIcon('starEmpty'), artIcon('star', 'ai res-star-on')));
  const starsEl = h('span', { class: 'res-stars', role: 'img' }, ...starEls);
  const fx = h('div', { class: 'res-fx', deco: true }, h('i', 'burst res-burst'));
  /** A level's Share sits in the hero's top corner (Home is the Map there); endless runs keep it in the head row. */
  const heroShare = h('div', 'res-hero-share');
  const hero = h('div', 'res-hero', fx, heroShare, starsEl, heroRibbon.el);
  const levelName = h('span', 'res-level-name');
  const level = h('h2', { class: 'res-level', id: 'res-level' }, levelName);
  const goal = h('p', { class: 'res-goal', id: 'res-goal' });
  const goals = h('ul', { class: 'res-goals', 'aria-label': 'Star goals' });
  const road = starRoad();
  // v1.4: the XP the run earned fills the Sun Rank under the stars (the score on endless runs).
  const xp = xpMeter(ctx);
  const strip = h('div', { class: 'strip', role: 'img' });
  const shareBtn = button(ctx, { label: 'Share', icon: 'share', variant: 'pink', size: 'sm', className: 'res-share', onPress: share });
  const homeBtn = button(ctx, { label: 'Home', icon: 'home', round: true, sound: 'back', onPress: home });
  // A cloud coin wears the art house (drawn for any face; §6.2).
  homeBtn.firstElementChild?.replaceWith(artIcon('home'));
  const headActions = h('div', 'res-head-actions', shareBtn, homeBtn);
  const nextBtn = button(ctx, { label: 'Next level', icon: 'play', variant: 'primary', size: 'xl', className: 'res-next res-arm', onPress: next });
  // Retry and Map squares carry their names as tags under them (the label is the tag: the
  // accessible names stay "Retry" and "Map").
  const mapBtn = button(ctx, { label: 'Map', icon: 'map', variant: 'blue', className: 'res-mapbtn res-sq', sound: 'back', onPress: map });
  mapBtn.querySelector('.btn-label')?.classList.add('tag');
  // The full line is laid out invisibly so the paragraph has its final height from the first
  // frame; the typed copy is drawn over it. Screen readers get the sr-only copy at once.
  const deathFull = h('span', 'sr-only');
  const deathSpace = h('span', { class: 'res-death-space', deco: true });
  const deathTyped = h('span', { deco: true });
  let caret = h('span', { class: 'caret', deco: true });
  const death = h(
    'p',
    { class: 'res-death', id: 'res-death' },
    deathFull,
    deathSpace,
    h('span', 'res-death-typed', deathTyped, caret),
  );
  const tip = h('p', 'res-tip');
  const pace = h('p', 'res-pace');
  const note = h('p', 'res-note');
  const verdict = h('p', 'plate res-verdict');
  const warmup = h('p', 'plate res-warmup');
  const awards = h('ul', { class: 'res-awards', 'aria-label': 'Unlocked this run' });
  const stats = h('div', 'res-stats');
  const missionList = h('ul', { class: 'res-missions', 'aria-label': 'Missions' });
  const retryBtn = button(ctx, {
    label: 'Retry',
    icon: 'retry',
    variant: 'primary',
    size: 'xl',
    block: true,
    className: 'res-retry res-arm',
    onPress: retry,
  });
  // Screen readers hear the score and the death line as Retry's description.
  retryBtn.setAttribute('aria-describedby', 'res-time res-death');
  const retryLabelEl = retryBtn.querySelector<HTMLElement>('.btn-label');
  /** Next level's label carries its sub-line ("LEVEL 39") as generated content (not in the text). */
  const nextLabelEl = nextBtn.querySelector<HTMLElement>('.btn-label');

  const top = h(
    'div',
    { class: 'res-top' },
    h('div', 'res-head', kicker, headActions),
    h('div', 'res-score', time, postcardBtn),
    level,
    strip,
    goal,
    xp.el,
    death,
    tip,
    pace,
    note,
    verdict,
    road.el,
  );
  const scroll = h('div', 'res-scroll', goals, warmup, awards, stats, missionList);
  // Retry | Next level | Map, left to right (Next level, the primary, gets the initial focus).
  const actions = h('div', 'res-actions', retryBtn, nextBtn, mapBtn);
  // The score block stays pinned; stats and missions scroll (or the whole body, see sizing above).
  const body = h('div', 'res-body', top, scroll);
  const sheet = h('div', { class: 'panel res-sheet pe', role: 'region', 'aria-label': 'Run results' }, hero, body, actions);
  const el = h('section', 'scr scr-results', mapCatch, sheet);

  // Keep the tap-to-retry area exactly above the sheet as its height changes, pick the scroll mode,
  // and cache the sheet's resting top for resultsSheetTop() (offset sizes ignore the slide-in).
  let sheetTopPx = 0;
  const measure = (): void => {
    const screenH = el.clientHeight;
    const campaign = sheet.classList.contains('is-campaign');
    const padTop = parseFloat(getComputedStyle(el).paddingTop);
    const maxSheet = Math.max(
      SHEET_MIN_FRACTION * screenH,
      Math.min((campaign ? SHEET_MAX_CAMPAIGN : SHEET_MAX_FRACTION) * screenH, screenH - MAP_MIN_PX, campaign ? screenH - padTop - HERO_ROOM_MIN : screenH),
    );
    const cs = getComputedStyle(sheet);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const left = maxSheet - padY - top.offsetHeight - actions.offsetHeight;
    sheet.classList.toggle('is-one-scroll', window.innerHeight < ONE_SCROLL_BELOW_PX || left < MIN_SCROLL_PX);
    const hh = sheet.offsetHeight;
    mapCatch.style.bottom = `${hh}px`;
    sheetTopPx = el.getBoundingClientRect().top + screenH - hh;
    // The hero fills the map band down to the sheet: from the top inset (the section's padding)
    // to the sheet's edge; its stars scale to that room.
    const room = Math.max(0, screenH - hh - padTop);
    // A missed level's empty sockets stay smaller: the Melt Map's pins of the death line show more.
    const cap = campaign && !sheet.classList.contains('is-passed') ? HERO_MISS_MAX : 1;
    const scale = Math.max(0.4, Math.min(cap, (room - HERO_RIBBON_PX) / HERO_STARS_PX));
    sheet.style.setProperty('--room', `${Math.round(room)}px`);
    sheet.style.setProperty('--hero-scale', scale.toFixed(3));
    sheet.classList.toggle('is-low-hero', scale < HERO_FX_MIN);
    fitRibbon(heroRibbon.el);
  };
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(measure);
    ro.observe(sheet);
    ro.observe(top);
    ro.observe(el);
  }

  /** A loot tile: its icon in a coin on the top edge (Snow: the ice gem), the value, the caption. */
  const tile = (iconName: IconName, value: HTMLElement | string, caption: string, cls = '', sub?: string): HTMLElement =>
    h(
      'div',
      { class: `${iconName === 'snow' ? 'candy f-blue' : 'plate'} stat ${cls}` },
      iconName === 'snow' ? artIcon('snow', 'ai stat-coin') : h('span', { class: 'f-cloud res-coin stat-coin', deco: true }, icon(iconName)),
      h('span', { class: iconName === 'snow' ? 'stat-val gt' : 'stat-val' }, value),
      h('span', 'stat-cap', caption),
      sub ? h('span', 'stat-sub', sub) : null,
    );

  /** A mission row, with Swap on a stale mission. */
  const missionRow = (m: MissionView): HTMLElement => {
    const side = m.done
      ? h('span', 'stamp stamp--sm', 'Complete')
      : h('span', 'mrow-prog', m.progressText === '–' ? 'Not yet' : m.progressText);
    return h(
      'li',
      { class: `plate mrow${m.done ? ' is-done' : ''}${m.done && !m.justCompleted ? ' is-stamped' : ''}` },
      h('span', { class: 'f-green res-coin mrow-check', deco: true }, icon('check')),
      h(
        'span',
        { class: 'mrow-main' },
        h('span', 'mrow-label', m.label, m.tierLabel ? h('span', 'tier', m.tierLabel) : null),
        progressBar(m.fraction, 'bar bar--sm', 'green'),
      ),
      h(
        'span',
        { class: 'mrow-side' },
        side,
        h('span', 'reward', icon('snow'), h('span', { deco: true }, `+${m.reward}`), h('span', 'sr-only', `, reward ${m.reward} Snow`)),
        m.swappable
          ? button(ctx, { label: 'Swap', icon: 'swap', className: 'btn--swap', ariaLabel: `Swap “${m.label}” for another mission`, onPress: () => ctx.cb.swapMission(m.id) })
          : null,
      ),
    );
  };

  /** Sun Strip rows, tiles popping in one after another as the sheet lands. */
  function renderStrip(view: ResultsView, reduced: boolean): void {
    const r = view.result;
    const rows = window.innerHeight < STRIP_SHORT_BELOW_PX ? STRIP_ROWS_SHORT : STRIP_ROWS;
    const model = sunStrip(r.hourGlyphs, runPlanOn(r) ? r.plan : null, rows, r.day);
    strip.setAttribute('aria-label', stripLabel(model));
    strip.classList.toggle('is-instant', reduced);
    let n = 0;
    setChildren(
      strip,
      model.hidden > 0 ? h('span', 'strip-more', `+${model.hidden} ${model.hidden === 1 ? 'day' : 'days'}`) : null,
      ...model.rows.map((rowModel) =>
        h(
          'div',
          { class: 'strip-row' },
          h('span', 'strip-day', rowModel.forecast ? rowModel.forecast.emoji : `D${rowModel.day}`),
          ...rowModel.tiles.map((g, hour) => {
            if (g === null) return h('i', 'st st--ghost');
            const t = h('i', `st st--${g}`);
            t.style.background = tileFill(hour, g);
            t.style.setProperty('--i', String(n++));
            const art = TILE_ART[g];
            if (art) t.append(svgFromMarkup(`<svg viewBox="0 0 10 10" aria-hidden="true">${art}</svg>`));
            return t;
          }),
          rowModel.night ? h('i', 'strip-night') : null,
        ),
      ),
    );
  }

  /** The goal cards: each star rule with its star, and a check sticker on the rules this run met. */
  function renderGoals(c: NonNullable<ResultsView['campaign']>): void {
    const rules = c.starRules;
    const bits = c.starBits;
    hide(goals, !rules || bits === undefined);
    if (!rules || bits === undefined) return;
    const met = rulesMet(bits);
    setChildren(
      goals,
      ...rules.map((rule, i) => {
        const ok = met[i] === true;
        return h(
          'li',
          { class: `plate res-goal-card${ok ? ' is-met' : ''}`, 'aria-label': `${rule}: ${ok ? 'met' : 'not met'}` },
          artIcon(ok ? 'star' : 'starEmpty'),
          h('span', { class: 'res-goal-rule', deco: true }, keepUnits(rule)),
          ok ? h('span', { class: 'f-green res-coin res-goal-check', deco: true }, artIcon('check')) : null,
        );
      }),
    );
  }

  /**
   * The Journey variant: the stars slam in over the hero, the level name, the goal line and cards,
   * the next star reward, and Retry | Next level | Map. Null restores the endless sheet.
   */
  function renderCampaign(c: ResultsView['campaign'] | null, reduced: boolean): void {
    const on = c !== null && c !== undefined;
    const nextUp = on && c.passed && c.nextId !== null;
    sheet.classList.toggle('is-campaign', on);
    sheet.classList.toggle('is-passed', on && c.passed);
    sheet.classList.toggle('is-win', on && c.passed && c.stars > 0);
    hide(level, !on);
    hide(goal, !on);
    hide(strip, on);
    hide(starsEl, !on);
    hide(time.parentElement as HTMLElement, on);
    road.update(ctx.save());
    if (!on) hide(road.el, true);
    // A level's Share moves to the hero's corner; the kicker is said by the ribbon (sr-only).
    if (on) heroShare.append(shareBtn);
    else headActions.prepend(shareBtn);
    shareBtn.classList.toggle('btn--round', on);
    kicker.classList.toggle('sr-only', on);
    actions.classList.toggle('res-actions--campaign', on);
    hide(nextBtn, !nextUp);
    hide(mapBtn, !on);
    // Retry is the primary action unless Next level is; then it is a blue square with its tag.
    retryBtn.classList.toggle('btn--primary', !nextUp);
    retryBtn.classList.toggle('btn--blue', nextUp);
    retryBtn.classList.toggle('btn--xl', !nextUp);
    retryBtn.classList.toggle('res-sq', nextUp);
    retryLabelEl?.classList.toggle('tag', nextUp);
    retryBtn.setAttribute('aria-describedby', on ? 'res-level res-goal' : 'res-time res-death');
    goals.replaceChildren();
    hide(goals, true);
    if (!on) return;
    levelName.textContent = c.name;
    level.setAttribute('aria-label', `Level ${c.id}, ${c.name}, ${c.passed ? starsLabel(c.stars) : 'not passed'}`);
    starsEl.setAttribute('aria-label', starsLabel(c.passed ? c.stars : 0));
    goal.textContent = keepUnits(c.goalLine);
    goal.classList.toggle('is-win', c.passed);
    if (nextLabelEl) nextLabelEl.dataset.sub = c.nextId !== null ? `LEVEL ${c.nextId}` : '';
    renderGoals(c);
    // A passed level lights each star whose rule was met, in the goal cards' (and the HUD's) order;
    // without the rule bits, the first `stars` stars.
    const bits = c.starBits;
    const lit = c.passed ? (bits === undefined ? [0, 1, 2].map((i) => i < c.stars) : rulesMet(bits)) : [];
    let n = 0;
    starEls.forEach((star, i) => {
      star.classList.remove('is-on', 'is-pop');
      if (lit[i] !== true) return;
      const k = n++;
      // Reduced motion: the stars fade in one after another; otherwise they slam in with a stamp.
      if (reduced) later(40 + k * STAR_FADE_MS, () => star.classList.add('is-on'));
      else {
        later(STAR_FIRST_MS + k * STAR_GAP_MS, () => {
          star.classList.add('is-on', 'is-pop');
          ctx.sound('stamp');
        });
      }
    });
  }

  let shown: ResultsView | null = null;
  let postcardUrl: string | null = null;

  function renderPostcard(): void {
    const ready = postcardUrl !== null;
    postcardBtn.classList.toggle('is-ready', ready);
    if (ready) postcardThumb.src = postcardUrl as string;
    else postcardThumb.removeAttribute('src');
    setDisabled(postcardBtn, !ready);
  }

  /** Retry (and Next level) live or not; the arming sweep plays while they wait. */
  function setArmed(on: boolean): void {
    armed = on;
    for (const b of [retryBtn, nextBtn]) {
      b.classList.toggle('is-arming', !on);
      b.classList.toggle('is-ready', on);
      setDisabled(b, !on);
    }
    mapCatch.classList.toggle('is-armed', on);
  }


  function render(view: ResultsView): void {
    shown = view;
    const { result, outcome } = view;
    const reduced = ctx.reducedMotion();

    // Header
    const dailyDate = viewDailyDate(view);
    const c = view.campaign ?? null;
    if (c) {
      kicker.textContent = campaignKicker(c);
    } else if (view.debug) {
      kicker.textContent = 'Debug run · not saved';
    } else if (dailyDate !== undefined) {
      kicker.textContent = `Daily #${dailyNumber(dailyDate)}\u00a0· ${dailyRunLabel(view.dailyTry, view.dailyScored)}`;
    } else {
      kicker.textContent = result.mode === 'challenge' ? 'Challenge run' : 'Nubs made it to';
    }
    const notCounted = !view.debug && dailyDate !== undefined && view.dailyTry == null && view.dailyScored === true;
    note.textContent = notCounted ? NOT_COUNTED_NOTE : '';
    hide(note, !notCounted);
    // A debug run's score isn't real: no share text, postcard or challenge link for it. A Journey
    // level has no Melt Map postcard and leaves for the map, not Home.
    hide(shareBtn, view.debug === true);
    hide(postcardBtn, view.debug === true || c !== null);
    hide(homeBtn, c !== null);
    const win = view.challengeTarget !== undefined && challengeVerdict(result.minutes, view.challengeTarget).win;
    const shareLabel = win ? 'Send it back' : 'Share';
    setButtonLabel(shareBtn, shareLabel);
    shareBtn.setAttribute('aria-label', shareLabel);
    renderPostcard();
    const { day, minute } = splitMinutes(result.minutes);
    dayBadge.textContent = `Day ${day}`;
    clock.textContent = formatTimeOfDay(minute);
    // The ribbon is decorative; the heading carries "New best" for screen readers. A best at eased
    // rules (a comfort rung, the warm-up) says so: it is not the standard best.
    const bestWords = outcome.bestEased ? 'New eased best' : 'New best';
    time.setAttribute('aria-label', `${outcome.newBest ? `${bestWords}! ` : ''}Day ${day}, ${formatTimeOfDay(minute)}`);
    // The ribbon: a level's verdict ("Level 38 Passed!" red, "So close!" blue), or an endless,
    // Daily or challenge run's new best; none otherwise.
    const words = c ? (c.passed ? `Level ${c.id} Passed!` : 'So close!') : outcome.newBest ? `${bestWords}!` : '';
    heroRibbon.band.textContent = words;
    heroRibbon.el.classList.toggle('ribbon--red', c?.passed !== false);
    heroRibbon.el.classList.toggle('ribbon--blue', c?.passed === false);
    hide(heroRibbon.el, words === '');
    hide(hero, words === '' && !c);
    sheet.classList.toggle('has-ribbon', words !== '');

    // Retry replays this run's kind; a Daily that can't count any more says so; after the warm-up
    // it starts the challenge.
    setButtonLabel(retryBtn, view.warmupFor ? TAKE_CHALLENGE : retryLabel(view, ctx.save(), ctx.today()));
    renderCampaign(c, reduced);
    if (!c) renderStrip(view, reduced);
    tip.textContent = view.tip ?? '';
    hide(tip, !view.tip);
    pace.textContent = outcome.pace ?? '';
    hide(pace, outcome.pace === null);
    // Praise in the accent; "Below your usual" in plain ink.
    pace.classList.toggle('is-down', outcome.paceDown);
    hide(warmup, !view.warmupFor);
    if (view.warmupFor) {
      warmup.replaceChildren('Now beat ', h('bdi', null, view.warmupFor.name || 'your friend'), `: ${formatScore(view.warmupFor.minutes)}`);
    }

    // Death line, typed (a passed Journey level shows its goal line instead).
    hide(death, c?.passed === true);
    // Keep "4:15 PM" on one line when the sentence wraps.
    const line = c?.passed ? '' : result.death.line.replace(/(\d) ([AP]M)/g, '$1\u00a0$2');
    deathFull.textContent = line;
    deathSpace.textContent = line;
    // A fresh caret restarts its blink (its animation was paused while Results was hidden).
    const freshCaret = caret.cloneNode(false) as HTMLSpanElement;
    caret.replaceWith(freshCaret);
    caret = freshCaret;
    clearInterval(typing);
    if (reduced) {
      deathTyped.textContent = line;
      death.classList.add('is-typed');
    } else {
      deathTyped.textContent = '';
      death.classList.remove('is-typed');
      let n = 0;
      typing = window.setInterval(() => {
        n += 1;
        deathTyped.textContent = line.slice(0, n);
        if (n >= line.length) {
          clearInterval(typing);
          death.classList.add('is-typed');
        }
      }, 1000 / TYPE_CPS);
    }

    // Challenge verdict
    hide(verdict, view.challengeTarget === undefined);
    if (view.challengeTarget !== undefined) {
      const v = challengeVerdict(result.minutes, view.challengeTarget);
      verdict.classList.toggle('is-win', v.win);
      verdict.textContent = v.text;
    }

    // Stats (Snow counts up into the wallet); tiles with nothing to show are left out.
    const snowValue = h('span', 'num');
    const st = result.stats;
    const mult = multiplierTile(st);
    setChildren(
      stats,
      tile('snow', snowValue, `Wallet ${outcome.walletAfter}`, 'stat--snow'),
      st.flakes > 0 || st.flakesMelted > 0
        ? tile('flake', String(st.flakes), st.flakes === 1 ? 'flake' : 'flakes', '', st.flakesMelted > 0 ? `${st.flakesMelted} melted` : undefined)
        : null,
      st.phews > 0 ? tile('phew', String(st.phews), st.phews === 1 ? 'PHEW' : 'PHEWs') : null,
      st.maxMult > 1 || st.x5HoldBest > 0 ? tile('bolt', mult.value, mult.caption) : null,
      st.swings > 0 ? tile('swing', String(st.swings), st.swings === 1 ? 'SWING' : 'SWINGs', 'stat--swing', `best ×${st.swingChainBest}`) : null,
      // v1.5 mechanics (absent in older results = 0).
      (st.blooms ?? 0) > 0 ? tile('sunflower', String(st.blooms), st.blooms === 1 ? 'bloom' : 'blooms', 'stat--bloom') : null,
      (st.snaps ?? 0) > 0 ? tile('coldsnap', String(st.snaps), st.snaps === 1 ? 'Cold Snap' : 'Cold Snaps', 'stat--snap') : null,
      (st.deepSeconds ?? 0) >= 1 ? tile('deep', `${Math.round(st.deepSeconds ?? 0)} s`, 'deep shade', 'stat--deep') : null,
    );
    stats.dataset.n = String(stats.childElementCount);
    stopCount = countUp(snowValue, 0, outcome.snowEarned, ctx, { format: (n) => `+${n}` });

    // The run's unlocks first, then the mission stamps. Chips sit at the top of the scroll area
    // (their space is held from the start so nothing reflows) and pop in quickly; the stamps land in
    // place. Nothing scrolls by itself (fix round 2): scrolling to a stamp pushed the warm-up's
    // challenge line, the chips and the wallet out of view and left tiles cut in half. Instead the
    // missions done this run pop in as one chip with the first stamp ("2 missions done +20"), so the
    // reward shows even when the rows sit below the fold.
    const done = outcome.missionsCompleted.length;
    // outcome.toasts carries the run's unlocks, features included (v1.4: "Wardrobe unlocked!").
    const toasts: ToastSpec[] = [...outcome.toasts];
    if (done > 0) toasts.push({ text: `${done === 1 ? 'Mission' : `${done} missions`} done +${outcome.missionSnow}`, icon: 'check', tone: 'accent' });
    const chips = toasts.map((t) =>
      h(
        'li',
        { class: `plate award award--${t.tone ?? 'ink'}` },
        // A coin by kind: gold trophies and stars, pink cosmetics, green missions and features.
        h('span', { class: `res-coin award-ic ${t.icon === 'gift' ? 'f-pink' : t.tone === 'gold' ? 'f-gold' : t.tone === 'accent' ? 'f-green' : 'f-cloud'}`, deco: true }, icon(toastIconName(t.icon ?? 'info'))),
        h('span', 'award-text', t.text),
      ),
    );
    setChildren(awards, ...chips);
    hide(awards, chips.length === 0);
    const unlockChips = chips.length - (done > 0 ? 1 : 0);
    chips.slice(0, unlockChips).forEach((chip, i) => {
      if (reduced) {
        chip.classList.add('is-in');
        return;
      }
      later(STAMP_FIRST_MS + i * CHIP_GAP_MS, () => {
        chip.classList.add('is-in');
        ctx.sound('unlock');
      });
    });

    // Missions, with stamps landing one after another (the missions chip with the first one).
    const rows = outcome.missions.map(missionRow);
    setChildren(missionList, ...rows);
    const firstStamp = STAMP_FIRST_MS + (unlockChips > 0 ? unlockChips * CHIP_GAP_MS + 200 : 0);
    const missionsChip = done > 0 ? (chips[chips.length - 1] as HTMLElement) : null;
    if (missionsChip) {
      if (reduced) missionsChip.classList.add('is-in');
      else later(firstStamp, () => missionsChip.classList.add('is-in'));
    }
    let stampAt = firstStamp;
    outcome.missions.forEach((m, i) => {
      if (!m.justCompleted) return;
      const row = rows[i] as HTMLElement;
      if (reduced) {
        row.classList.add('is-stamped');
        return;
      }
      later(stampAt, () => {
        row.classList.add('is-stamped', 'is-new');
        ctx.sound('stamp');
      });
      stampAt += STAMP_GAP_MS;
    });

    // The rewards sequence (v1.4): the stars land, the XP meter fills under them (awaited), then the
    // run's rewards are revealed one at a time; the actions arm once that is over. With nothing to reveal
    // Retry (and Next level) arm after 0.3 s, as before: the sheet is readable before a stray tap
    // can fire it, and a quick retry stays quick.
    const g = outcome.gamify;
    const xpAt = reduced ? 0 : c ? STAR_FIRST_MS + (c.passed ? c.stars : 0) * STAR_GAP_MS + 120 : XP_ENDLESS_MS;
    const rewards = g?.rewards ?? [];
    const id = ++renders;
    setArmed(false);
    revealing = rewards.length > 0;
    if (!revealing) later(RETRY_ARM_MS, () => setArmed(true));
    // Until it starts filling the meter holds its place unseen (an empty ring and bar read as broken).
    xp.el.classList.toggle('is-waiting', xpAt > 0);
    later(xpAt, () => {
      xp.el.classList.remove('is-waiting');
      void xp.show(g, ctx.save()).then(async () => {
        if (!revealing || id !== renders) return;
        await revealRewards(ctx, rewards);
        if (id !== renders) return;
        revealing = false;
        setArmed(true);
      });
    });

    scroll.scrollTo({ top: 0 });
    body.scrollTo({ top: 0 });
    measure();
    ctx.announce(resultsAnnouncement(view));
  }

  /** A mission was swapped (or another tab changed the save): the mission rows follow the save. */
  function refreshMissions(view: ResultsView): void {
    const views = activeMissionViews(ctx.save());
    const changed = views.length !== view.outcome.missions.length || views.some((v, i) => v.id !== view.outcome.missions[i]?.id);
    if (!changed) return;
    setChildren(missionList, ...views.map((v) => {
      const r = missionRow(v);
      if (v.done) r.classList.add('is-stamped');
      return r;
    }));
  }

  return {
    el,
    enter(_from, data) {
      stopAll();
      render(data as ResultsView);
    },
    leave: stopAll,
    // A new save (another tab's Daily try, a swapped mission) or a new day can change Retry and the
    // mission rows.
    refresh() {
      if (!shown) return;
      if (!shown.warmupFor) setButtonLabel(retryBtn, retryLabel(shown, ctx.save(), ctx.today()));
      refreshMissions(shown);
    },
    setPostcard(url) {
      postcardUrl = url;
      renderPostcard();
    },
    back: leave,
    activate() {
      if (!revealing) primary();
      return true;
    },
    initialFocus: () => (hasNext() ? nextBtn : retryBtn),
    sheetTop: () => sheetTopPx,
    invalidateSheetTop: measure,
  };
}
