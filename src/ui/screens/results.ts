// Results bottom sheet (GDD §5, V1_PLAN §8.4, V1_1_PLAN UM8): the canvas Melt Map shows above it.
// Big time with the postcard, the Sun Strip (one row of hour tiles per day), NEW BEST ribbon, death
// line typed at 30 chars/s with the recap tip and the pace line, the run's unlocks and bonuses as
// award chips, stats, missions and Today's errand with stamps (and Swap on stale missions).
// Retry arms 0.3 s after the sheet appears; a tap on the map area above the sheet also retries.
// The unlocks live in the sheet rather than the top toast stack: toasts there would sit over the
// top of the Melt Map, where the named caster pins of the death line usually are.
//
// Sizing: the sheet is at least 58% tall and grows with its content up to the viewport minus
// 96 px of map. The score block stays pinned while stats and missions scroll; on short or
// large-text screens (under 520 px, or under 120 px left for the scroll area) the whole sheet body
// scrolls as one, with Retry always pinned below it.

import type { HourGlyph } from '../../core/sim/events.ts';
import { formatScore, formatTimeOfDay, splitMinutes } from '../../core/format.ts';
import { challengeVerdict } from '../../meta/challenge.ts';
import { dailyNumber } from '../../meta/daily.ts';
import type { ErrandView, MissionView } from '../../meta/missions.ts';
import { activeMissionViews } from '../../meta/progression.ts';
import { runPlanOn } from '../../meta/share.ts';
import { h, setChildren, svgFromMarkup } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import {
  dailyRunLabel,
  multiplierTile,
  NOT_COUNTED_NOTE,
  resultsAnnouncement,
  retryLabel,
  sunStrip,
  tileFill,
  viewDailyDate,
  type SunStrip,
} from '../labels.ts';
import type { Screen, UiContext } from '../screen.ts';
import type { ResultsView } from '../types.ts';
import { toastIconName } from '../overlays.ts';
import { button, hide, progressBar, setButtonLabel, setDisabled } from '../widgets.ts';

const RETRY_ARM_MS = 300;
const TYPE_CPS = 30;
const COUNT_MS = 700;
const STAMP_FIRST_MS = 650;
const STAMP_GAP_MS = 300;
/** Award chips pop this far apart, before the stamps. */
const CHIP_GAP_MS = 280;
/** Below this viewport height the sheet body scrolls as one. */
const ONE_SCROLL_BELOW_PX = 520;
/** The stats/missions scroll area must keep at least this much height, or the body scrolls as one. */
const MIN_SCROLL_PX = 120;
/**
 * A sheet that grows with its content stops at 68 % of the screen, so the Melt Map (and the
 * postcard cropped from it) keeps about a third; on tiny screens it keeps at least 96 px, and the
 * sheet may always take 58 %. What doesn't fit scrolls.
 */
const MAP_MIN_PX = 96;
const SHEET_MIN_FRACTION = 0.58;
/** The scroll area's bottom fade (ui.css .res-scroll mask): revealed rows stop above it. */
const SCROLL_FADE_PX = 28;
const SHEET_MAX_FRACTION = 0.68;
/** Sun Strip rows: the last 4 days, or 2 on screens under 700 px tall. */
const STRIP_ROWS = 4;
const STRIP_ROWS_SHORT = 2;
const STRIP_SHORT_BELOW_PX = 700;
const TAKE_CHALLENGE = 'Take the challenge';

/** The glyph art inside a Sun Strip tile (10 px, white on the tile colour). */
const TILE_ART: Readonly<Partial<Record<HourGlyph, string>>> = {
  cool: '<path d="M5 .8v8.4M1.36 2.9l7.28 4.2M1.36 7.1l7.28-4.2M3.9 1.7 5 2.8l1.1-1.1M3.9 8.3 5 7.2l1.1 1.1" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
  hot: '<path d="M5 .6C5.6 2.6 8.4 3.8 8.4 6.4A3.4 3.4 0 0 1 1.6 6.4c0-1.5.9-2.4 1.6-3 .1 1 .6 1.7 1.3 1.9C4.3 3.6 4.4 2 5 .6Z" fill="#fff"/>',
  melt: '<path d="M5 .7S8.5 4.4 8.5 6.6a3.5 3.5 0 0 1-7 0C1.5 4.4 5 .7 5 .7Z" fill="#fff"/>',
};

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
  let typing = 0;
  let countFrame = 0;

  const later = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms));
  };
  const stopAll = (): void => {
    for (const t of timers) clearTimeout(t);
    timers = [];
    clearInterval(typing);
    cancelAnimationFrame(countFrame);
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
  const shared = (outcome: string): void => {
    if (outcome === 'copied') ctx.toast('Copied! Paste it anywhere.', { icon: 'check', tone: 'accent' });
    else if (outcome === 'saved') ctx.toast('Postcard saved · link copied', { icon: 'check', tone: 'accent' });
    else if (outcome === 'failed') ctx.toast("Couldn't share from this browser.", { icon: 'warn', tone: 'danger' });
  };
  // Both run synchronously in the click task (the share sheet needs the tap's user activation).
  const share = (): void => void ctx.cb.share().then(shared);
  const sharePostcard = (): void => void ctx.cb.sharePostcard().then(shared);

  // The map area above the sheet: tap = retry. Hidden from assistive tech (Retry is the real control).
  const mapCatch = h('div', { class: 'res-map pe', 'aria-hidden': 'true' });
  mapCatch.addEventListener('pointerdown', retry);

  const ribbonText = h('span', null, 'New best');
  const ribbon = h('div', { class: 'res-ribbon', 'aria-hidden': 'true' }, icon('trophy'), ribbonText);
  const kicker = h('p', { class: 'kicker res-kicker' });
  const dayBadge = h('span', { class: 'res-day' });
  const clock = h('span', { class: 'res-clock' });
  const time = h('h2', { class: 'res-time', id: 'res-time' }, dayBadge, clock);
  // The postcard: a 4:5 thumbnail of the shareable image (a placeholder while it is built).
  const postcardThumb = h('img', { class: 'res-postcard-img', alt: '', decoding: 'async' });
  const postcardBtn = h(
    'button',
    { class: 'res-postcard pe', type: 'button', 'aria-label': 'Share the postcard' },
    h('span', { class: 'res-postcard-card', 'aria-hidden': 'true' }, postcardThumb),
    h('span', { class: 'res-postcard-label', 'aria-hidden': 'true' }, icon('share'), 'Postcard'),
  );
  postcardBtn.addEventListener('click', () => {
    ctx.sound('tap');
    sharePostcard();
  });
  const strip = h('div', { class: 'strip', role: 'img' });
  const shareBtn = button(ctx, { label: 'Share', icon: 'share', className: 'res-share', onPress: share });
  const homeBtn = button(ctx, { label: 'Home', icon: 'home', round: true, sound: 'back', onPress: home });
  // The full line is laid out invisibly so the paragraph has its final height from the first
  // frame; the typed copy is drawn over it. Screen readers get the sr-only copy at once.
  const deathFull = h('span', { class: 'sr-only' });
  const deathSpace = h('span', { class: 'res-death-space', 'aria-hidden': 'true' });
  const deathTyped = h('span', { 'aria-hidden': 'true' });
  let caret = h('span', { class: 'caret', 'aria-hidden': 'true' });
  const death = h(
    'p',
    { class: 'res-death', id: 'res-death' },
    deathFull,
    deathSpace,
    h('span', { class: 'res-death-typed' }, deathTyped, caret),
  );
  const tip = h('p', { class: 'res-tip' });
  const pace = h('p', { class: 'res-pace' });
  const note = h('p', { class: 'res-note' });
  const verdict = h('p', { class: 'res-verdict' });
  const warmup = h('p', { class: 'res-warmup' });
  const awards = h('ul', { class: 'res-awards', 'aria-label': 'Unlocked this run' });
  const stats = h('div', { class: 'res-stats' });
  const missionList = h('ul', { class: 'res-missions', 'aria-label': 'Missions' });
  const retryBtn = button(ctx, {
    label: 'Retry',
    icon: 'retry',
    variant: 'primary',
    size: 'xl',
    block: true,
    className: 'res-retry',
    onPress: retry,
  });
  // Screen readers hear the score and the death line as Retry's description.
  retryBtn.setAttribute('aria-describedby', 'res-time res-death');

  const top = h(
    'div',
    { class: 'res-top' },
    h('div', { class: 'res-head' }, kicker, h('div', { class: 'res-head-actions' }, shareBtn, homeBtn)),
    h('div', { class: 'res-score' }, time, postcardBtn),
    strip,
    death,
    tip,
    pace,
    note,
    verdict,
  );
  const scroll = h('div', { class: 'res-scroll' }, warmup, awards, stats, missionList);
  const actions = h('div', { class: 'res-actions' }, retryBtn);
  // The score block stays pinned; stats and missions scroll (or the whole body, see sizing above).
  const body = h('div', { class: 'res-body' }, top, scroll);
  const sheet = h('div', { class: 'res-sheet pe', role: 'region', 'aria-label': 'Run results' }, ribbon, body, actions);
  const el = h('section', { class: 'scr scr-results' }, mapCatch, sheet);

  // Keep the tap-to-retry area exactly above the sheet as its height changes, pick the scroll mode,
  // and cache the sheet's resting top for resultsSheetTop() (offset sizes ignore the slide-in).
  let sheetTopPx = 0;
  const measure = (): void => {
    const screenH = el.clientHeight;
    const maxSheet = Math.max(SHEET_MIN_FRACTION * screenH, Math.min(SHEET_MAX_FRACTION * screenH, screenH - MAP_MIN_PX));
    const cs = getComputedStyle(sheet);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const left = maxSheet - padY - top.offsetHeight - actions.offsetHeight;
    sheet.classList.toggle('is-one-scroll', window.innerHeight < ONE_SCROLL_BELOW_PX || left < MIN_SCROLL_PX);
    const hh = sheet.offsetHeight;
    mapCatch.style.bottom = `${hh}px`;
    sheetTopPx = el.getBoundingClientRect().top + screenH - hh;
  };
  /**
   * Scrolls the stats/missions list (only) down so `el` shows above its bottom fade. Never scrolls
   * up, and never the sheet body: in one-scroll mode the score must stay in view, so nothing moves.
   */
  const reveal = (el: HTMLElement, smooth: boolean): void => {
    if (sheet.classList.contains('is-one-scroll')) return;
    const below = el.getBoundingClientRect().bottom - (scroll.getBoundingClientRect().bottom - SCROLL_FADE_PX);
    if (below > 0) scroll.scrollBy({ top: below, behavior: smooth ? 'smooth' : 'auto' });
  };
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(measure);
    ro.observe(sheet);
    ro.observe(top);
    ro.observe(el);
  }

  const tile = (iconName: IconName, value: HTMLElement | string, caption: string, cls = '', sub?: string): HTMLElement =>
    h(
      'div',
      { class: `stat ${cls}` },
      h('span', { class: 'stat-val' }, icon(iconName), value),
      h('span', { class: 'stat-cap' }, caption),
      sub ? h('span', { class: 'stat-sub' }, sub) : null,
    );

  /** A mission or errand row; `swap` adds the Swap button of a stale mission. */
  const row = (
    m: Pick<MissionView, 'label' | 'fraction' | 'progressText' | 'done' | 'justCompleted' | 'reward'> & { tierLabel?: string },
    kicker: string | null,
    swap: (() => void) | null,
  ): HTMLElement => {
    const side = m.done
      ? h('span', { class: 'stamp stamp--sm' }, 'Complete')
      : h('span', { class: 'mrow-prog' }, m.progressText);
    return h(
      'li',
      { class: `mrow${m.done ? ' is-done' : ''}${m.done && !m.justCompleted ? ' is-stamped' : ''}${kicker ? ' mrow--errand' : ''}` },
      h('span', { class: 'mrow-check', 'aria-hidden': 'true' }, icon('check')),
      h(
        'span',
        { class: 'mrow-main' },
        kicker ? h('span', { class: 'mrow-kicker' }, kicker) : null,
        h('span', { class: 'mrow-label' }, m.label, m.tierLabel ? h('span', { class: 'tier' }, m.tierLabel) : null),
        progressBar(m.fraction),
      ),
      h(
        'span',
        { class: 'mrow-side' },
        side,
        h('span', { class: 'reward' }, icon('snow'), h('span', { 'aria-hidden': 'true' }, `+${m.reward}`), h('span', { class: 'sr-only' }, `, reward ${m.reward} Snow`)),
        swap ? button(ctx, { label: 'Swap', icon: 'swap', className: 'btn--swap', ariaLabel: `Swap “${m.label}” for another mission`, onPress: swap }) : null,
      ),
    );
  };
  const swapFor = (m: MissionView): (() => void) | null => (m.swappable ? () => ctx.cb.swapMission(m.id) : null);
  const missionRow = (m: MissionView): HTMLElement => row(m, null, swapFor(m));
  const errandRow = (e: ErrandView): HTMLElement => row(e, "Today's errand", null);

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
      model.hidden > 0 ? h('span', { class: 'strip-more' }, `+${model.hidden} ${model.hidden === 1 ? 'day' : 'days'}`) : null,
      ...model.rows.map((rowModel) =>
        h(
          'div',
          { class: 'strip-row' },
          h('span', { class: 'strip-day' }, rowModel.forecast ? rowModel.forecast.emoji : `D${rowModel.day}`),
          ...rowModel.tiles.map((g, hour) => {
            if (g === null) return h('i', { class: 'st st--ghost' });
            const t = h('i', { class: `st st--${g}` });
            t.style.background = tileFill(hour, g);
            t.style.setProperty('--i', String(n++));
            const art = TILE_ART[g];
            if (art) t.append(svgFromMarkup(`<svg viewBox="0 0 10 10" aria-hidden="true">${art}</svg>`));
            return t;
          }),
          rowModel.night ? h('i', { class: 'strip-night' }) : null,
        ),
      ),
    );
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

  function render(view: ResultsView): void {
    shown = view;
    const { result, outcome } = view;
    const reduced = ctx.reducedMotion();

    // Header
    const dailyDate = viewDailyDate(view);
    if (view.debug) {
      kicker.textContent = 'Debug run · not saved';
    } else if (dailyDate !== undefined) {
      kicker.textContent = `Daily #${dailyNumber(dailyDate)} · ${dailyRunLabel(view.dailyTry, view.dailyScored)}`;
    } else {
      kicker.textContent = result.mode === 'challenge' ? 'Challenge run' : 'Nubs made it to';
    }
    const notCounted = !view.debug && dailyDate !== undefined && view.dailyTry == null && view.dailyScored === true;
    note.textContent = notCounted ? NOT_COUNTED_NOTE : '';
    hide(note, !notCounted);
    // A debug run's score isn't real: no share text, postcard or challenge link for it.
    hide(shareBtn, view.debug === true);
    hide(postcardBtn, view.debug === true);
    const win = view.challengeTarget !== undefined && challengeVerdict(result.minutes, view.challengeTarget).win;
    const shareLabel = win ? 'Send it back' : 'Share';
    setButtonLabel(shareBtn, shareLabel);
    shareBtn.setAttribute('aria-label', shareLabel);
    shareBtn.classList.toggle('btn--primary', outcome.newBest || view.challengeTarget !== undefined || view.dailyTry != null);
    renderPostcard();
    const { day, minute } = splitMinutes(result.minutes);
    dayBadge.textContent = `Day ${day}`;
    clock.textContent = formatTimeOfDay(minute);
    // The ribbon is decorative; the heading carries "New best" for screen readers. A best at eased
    // rules (a comfort rung, the warm-up) says so: it is not the standard best.
    const bestWords = outcome.bestEased ? 'New eased best' : 'New best';
    ribbonText.textContent = bestWords;
    time.setAttribute('aria-label', `${outcome.newBest ? `${bestWords}! ` : ''}Day ${day}, ${formatTimeOfDay(minute)}`);
    ribbon.classList.toggle('is-on', outcome.newBest);
    ribbon.classList.toggle('is-eased', outcome.newBest && outcome.bestEased);

    // Retry replays this run's kind; a Daily that can't count any more says so; after the warm-up
    // it starts the challenge.
    setButtonLabel(retryBtn, view.warmupFor ? TAKE_CHALLENGE : retryLabel(view, ctx.save(), ctx.today()));
    renderStrip(view, reduced);
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

    // Death line, typed.
    // Keep "4:15 PM" on one line when the sentence wraps.
    const line = result.death.line.replace(/(\d) ([AP]M)/g, '$1\u00a0$2');
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
    const snowValue = h('span', { class: 'num' }, reduced ? `+${outcome.snowEarned}` : '+0');
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
    );
    stats.dataset.n = String(stats.childElementCount);
    if (!reduced && outcome.snowEarned > 0) {
      const start = performance.now();
      const step = (now: number): void => {
        const k = Math.min(1, (now - start) / COUNT_MS);
        const eased = 1 - (1 - k) * (1 - k) * (1 - k);
        snowValue.textContent = `+${Math.round(outcome.snowEarned * eased)}`;
        if (k < 1) countFrame = requestAnimationFrame(step);
        else ctx.sound('count');
      };
      countFrame = requestAnimationFrame(step);
    } else {
      snowValue.textContent = `+${outcome.snowEarned}`;
    }

    // The run's unlocks first, then the mission stamps. Chips sit at the top of the scroll area
    // (their space is held from the start so nothing reflows) and pop in quickly; the stamps follow,
    // each scrolled into view as it lands. Auto-scroll only ever moves the stats/missions list, and
    // only downward: never the sheet body that holds the score (one-scroll mode on short screens).
    const chips = outcome.toasts.map((t) =>
      h(
        'li',
        { class: `award award--${t.tone ?? 'ink'}` },
        h('span', { class: 'award-ic', 'aria-hidden': 'true' }, icon(toastIconName(t.icon ?? 'info'))),
        h('span', { class: 'award-text' }, t.text),
      ),
    );
    setChildren(awards, ...chips);
    hide(awards, chips.length === 0);
    chips.forEach((chip, i) => {
      if (reduced) {
        chip.classList.add('is-in');
        return;
      }
      later(STAMP_FIRST_MS + i * CHIP_GAP_MS, () => {
        chip.classList.add('is-in');
        ctx.sound('unlock');
      });
    });

    // Missions and Today's errand, with stamps landing one after another.
    const items: { justCompleted: boolean }[] = [...outcome.missions, ...(outcome.errand ? [outcome.errand] : [])];
    const rows = [...outcome.missions.map(missionRow), ...(outcome.errand ? [errandRow(outcome.errand)] : [])];
    setChildren(missionList, ...rows);
    let stampAt = STAMP_FIRST_MS + (chips.length > 0 ? chips.length * CHIP_GAP_MS + 200 : 0);
    items.forEach((m, i) => {
      if (!m.justCompleted) return;
      const row = rows[i] as HTMLElement;
      if (reduced) {
        row.classList.add('is-stamped');
        later(0, () => reveal(row, false));
        return;
      }
      later(stampAt, () => {
        row.classList.add('is-stamped', 'is-new');
        reveal(row, true);
        ctx.sound('stamp');
      });
      stampAt += STAMP_GAP_MS;
    });

    // Retry arms after 0.3 s (the sheet is readable before a stray tap can fire it).
    armed = false;
    retryBtn.classList.add('is-arming');
    retryBtn.classList.remove('is-ready');
    setDisabled(retryBtn, true);
    mapCatch.classList.remove('is-armed');
    later(RETRY_ARM_MS, () => {
      armed = true;
      retryBtn.classList.remove('is-arming');
      retryBtn.classList.add('is-ready');
      setDisabled(retryBtn, false);
      mapCatch.classList.add('is-armed');
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
    const errand = missionList.querySelector('.mrow--errand');
    setChildren(missionList, ...views.map((v) => {
      const r = missionRow(v);
      if (v.done) r.classList.add('is-stamped');
      return r;
    }), errand);
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
    back: home,
    activate() {
      retry();
      return true;
    },
    initialFocus: () => retryBtn,
    sheetTop: () => sheetTopPx,
    invalidateSheetTop: measure,
  };
}
