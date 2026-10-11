// Results bottom sheet (GDD §5, V1_PLAN §8.4): the canvas Melt Map shows above it.
// Big time, NEW BEST ribbon, death line typed at 30 chars/s, the run's unlocks (achievements,
// cosmetics, the Daily) as award chips, stats, missions with stamps.
// Retry arms 0.3 s after the sheet appears; a tap on the map area above the sheet also retries.
// The unlocks live in the sheet rather than the top toast stack: toasts there would sit over the
// top of the Melt Map, where the named caster pins of the death line usually are.
//
// Sizing: the sheet is at least 58% tall and grows with its content up to the viewport minus
// 96 px of map. The score block stays pinned while stats and missions scroll; on short or
// large-text screens (under 520 px, or under 120 px left for the scroll area) the whole sheet body
// scrolls as one, with Retry always pinned below it.

import { splitMinutes, formatTimeOfDay } from '../../core/format.ts';
import { challengeVerdict } from '../../meta/challenge.ts';
import { dailyNumber } from '../../meta/daily.ts';
import type { MissionView } from '../../meta/missions.ts';
import { h, setChildren } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import { dailyRunLabel, multiplierTile, NOT_COUNTED_NOTE, resultsAnnouncement, retryLabel, viewDailyDate } from '../labels.ts';
import type { Screen, UiContext } from '../screen.ts';
import type { ResultsView } from '../types.ts';
import { toastIconName } from '../overlays.ts';
import { button, hide, progressBar, setButtonLabel, setDisabled } from '../widgets.ts';

const RETRY_ARM_MS = 300;
const TYPE_CPS = 30;
const COUNT_MS = 700;
const STAMP_FIRST_MS = 650;
const STAMP_GAP_MS = 300;
const TOAST_GAP_MS = 650;
/** Below this viewport height the sheet body scrolls as one. */
const ONE_SCROLL_BELOW_PX = 520;
/** The stats/missions scroll area must keep at least this much height, or the body scrolls as one. */
const MIN_SCROLL_PX = 120;
/** Map kept above a sheet that grows with its content. */
const MAP_MIN_PX = 96;
const SHEET_MIN_FRACTION = 0.58;

export interface ResultsScreen extends Screen {
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
  const share = async (): Promise<void> => {
    const outcome = await ctx.cb.share();
    if (outcome === 'copied') ctx.toast('Copied! Paste it anywhere.', { icon: 'check', tone: 'accent' });
    else if (outcome === 'failed') ctx.toast("Couldn't share from this browser.", { icon: 'warn', tone: 'danger' });
  };

  // The map area above the sheet: tap = retry. Hidden from assistive tech (Retry is the real control).
  const mapCatch = h('div', { class: 'res-map pe', 'aria-hidden': 'true' });
  mapCatch.addEventListener('pointerdown', retry);

  const ribbon = h('div', { class: 'res-ribbon', 'aria-hidden': 'true' }, icon('trophy'), h('span', null, 'New best'));
  const kicker = h('p', { class: 'kicker res-kicker' });
  const dayBadge = h('span', { class: 'res-day' });
  const clock = h('span', { class: 'res-clock' });
  const time = h('h2', { class: 'res-time', id: 'res-time' }, dayBadge, clock);
  const shareBtn = button(ctx, { label: 'Share', icon: 'share', round: true, onPress: () => void share() });
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
  const note = h('p', { class: 'res-note' });
  const verdict = h('p', { class: 'res-verdict' });
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

  const top = h('div', { class: 'res-top' }, h('div', { class: 'res-head' }, kicker, h('div', { class: 'res-head-actions' }, shareBtn, homeBtn)), time, death, note, verdict);
  const scroll = h('div', { class: 'res-scroll' }, awards, stats, missionList);
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
    const maxSheet = Math.max(SHEET_MIN_FRACTION * screenH, screenH - MAP_MIN_PX);
    const cs = getComputedStyle(sheet);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const left = maxSheet - padY - top.offsetHeight - actions.offsetHeight;
    sheet.classList.toggle('is-one-scroll', window.innerHeight < ONE_SCROLL_BELOW_PX || left < MIN_SCROLL_PX);
    const hh = sheet.offsetHeight;
    mapCatch.style.bottom = `${hh}px`;
    sheetTopPx = el.getBoundingClientRect().top + screenH - hh;
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

  const missionRow = (m: MissionView): HTMLElement => {
    const side = m.done
      ? h('span', { class: 'stamp stamp--sm' }, 'Complete')
      : h('span', { class: 'mrow-prog' }, m.progressText);
    return h(
      'li',
      { class: `mrow${m.done ? ' is-done' : ''}${m.done && !m.justCompleted ? ' is-stamped' : ''}` },
      h('span', { class: 'mrow-check', 'aria-hidden': 'true' }, icon('check')),
      h(
        'span',
        { class: 'mrow-main' },
        h('span', { class: 'mrow-label' }, m.label, m.tierLabel ? h('span', { class: 'tier' }, m.tierLabel) : null),
        progressBar(m.fraction),
      ),
      h(
        'span',
        { class: 'mrow-side' },
        side,
        h('span', { class: 'reward' }, icon('snow'), h('span', { 'aria-hidden': 'true' }, `+${m.reward}`), h('span', { class: 'sr-only' }, `, reward ${m.reward} Snow`)),
      ),
    );
  };

  let shown: ResultsView | null = null;

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
    // A debug run's score isn't real: no share text or challenge link for it.
    hide(shareBtn, view.debug === true);
    const { day, minute } = splitMinutes(result.minutes);
    dayBadge.textContent = `Day ${day}`;
    clock.textContent = formatTimeOfDay(minute);
    // The ribbon is decorative; the heading carries "New best" for screen readers.
    time.setAttribute('aria-label', `${outcome.newBest ? 'New best! ' : ''}Day ${day}, ${formatTimeOfDay(minute)}`);
    ribbon.classList.toggle('is-on', outcome.newBest);

    // Retry replays this run's kind; a Daily that can't count any more says so.
    setButtonLabel(retryBtn, retryLabel(view, ctx.save(), ctx.today()));

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

    // Stats (Snow counts up into the wallet).
    const snowValue = h('span', { class: 'num' }, reduced ? `+${outcome.snowEarned}` : '+0');
    const st = result.stats;
    const mult = multiplierTile(st);
    setChildren(
      stats,
      tile('snow', snowValue, `Wallet ${outcome.walletAfter}`, 'stat--snow'),
      tile('flake', String(st.flakes), st.flakes === 1 ? 'flake' : 'flakes', '', st.flakesMelted > 0 ? `${st.flakesMelted} melted` : undefined),
      tile('phew', String(st.phews), st.phews === 1 ? 'PHEW' : 'PHEWs'),
      tile('bolt', mult.value, mult.caption),
    );
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

    // Missions, with stamps landing one after another.
    const rows = outcome.missions.map(missionRow);
    setChildren(missionList, ...rows);
    let stampAt = STAMP_FIRST_MS;
    outcome.missions.forEach((m, i) => {
      if (!m.justCompleted) return;
      const row = rows[i] as HTMLElement;
      if (reduced) {
        row.classList.add('is-stamped');
        later(0, () => row.scrollIntoView({ block: 'nearest' }));
        return;
      }
      later(stampAt, () => {
        row.classList.add('is-stamped', 'is-new');
        // On short screens the missions sit below the fold: bring each stamp into view as it lands.
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        ctx.sound('stamp');
      });
      stampAt += STAMP_GAP_MS;
    });

    // Unlocks: chips at the top of the scroll area (their space is held from the start so nothing
    // jumps), popping in one by one after the stamps.
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
      later(stampAt + 250 + i * TOAST_GAP_MS, () => {
        chip.classList.add('is-in');
        chip.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
        ctx.sound('unlock');
      });
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

  return {
    el,
    enter(_from, data) {
      stopAll();
      render(data as ResultsView);
    },
    leave: stopAll,
    // A new save (another tab's Daily try) or a new day can turn Retry into practice.
    refresh() {
      if (shown) setButtonLabel(retryBtn, retryLabel(shown, ctx.save(), ctx.today()));
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
