// Results bottom sheet (GDD §5, V1_PLAN §8.4): the canvas Melt Map shows above it.
// Big time, NEW BEST ribbon, death line typed at 30 chars/s, the run's unlocks (achievements,
// cosmetics, the Daily) as award chips, stats, missions with stamps.
// Retry arms 0.3 s after the sheet appears; a tap on the map area above the sheet also retries.
// The unlocks live in the sheet rather than the top toast stack: toasts there would sit over the
// top of the Melt Map, where the named caster pins of the death line usually are.

import { splitMinutes, formatTimeOfDay } from '../../core/format.ts';
import { dailyNumber, DAILY_TRIES } from '../../meta/daily.ts';
import type { MissionView } from '../../meta/missions.ts';
import { h, setChildren } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import type { ResultsView } from '../types.ts';
import { toastIconName } from '../overlays.ts';
import { button, hide, progressBar, setDisabled } from '../widgets.ts';

const RETRY_ARM_MS = 300;
const TYPE_CPS = 30;
const COUNT_MS = 700;
const STAMP_FIRST_MS = 650;
const STAMP_GAP_MS = 300;
const TOAST_GAP_MS = 650;

export interface ResultsScreen extends Screen {
  /** Top edge of the sheet in CSS px from the top of the UI root. */
  sheetTop(): number;
}

function formatDuration(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  if (hh === 0) return `${mm} min`;
  return mm === 0 ? `${hh} h` : `${hh} h ${mm} min`;
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
  const time = h('h2', { class: 'res-time' }, dayBadge, clock);
  const shareBtn = button(ctx, { label: 'Share', icon: 'share', round: true, onPress: () => void share() });
  const homeBtn = button(ctx, { label: 'Home', icon: 'home', round: true, sound: 'back', onPress: home });
  // The full line is laid out invisibly so the paragraph has its final height from the first
  // frame; the typed copy is drawn over it. Screen readers get the sr-only copy at once.
  const deathFull = h('span', { class: 'sr-only' });
  const deathSpace = h('span', { class: 'res-death-space', 'aria-hidden': 'true' });
  const deathTyped = h('span', { 'aria-hidden': 'true' });
  const death = h(
    'p',
    { class: 'res-death' },
    deathFull,
    deathSpace,
    h('span', { class: 'res-death-typed' }, deathTyped, h('span', { class: 'caret', 'aria-hidden': 'true' })),
  );
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

  const sheet = h(
    'div',
    { class: 'res-sheet pe', role: 'region', 'aria-label': 'Run results' },
    ribbon,
    // The score stays pinned; only stats and missions scroll on short screens.
    h('div', { class: 'res-top' }, h('div', { class: 'res-head' }, kicker, h('div', { class: 'res-head-actions' }, shareBtn, homeBtn)), time, death, verdict),
    h('div', { class: 'res-scroll' }, awards, stats, missionList),
    h('div', { class: 'res-actions' }, retryBtn),
  );
  const el = h('section', { class: 'scr scr-results' }, mapCatch, sheet);

  // Keep the tap-to-retry area exactly above the sheet as its height changes.
  const syncMapArea = (): void => {
    mapCatch.style.bottom = `${sheet.offsetHeight}px`;
  };
  new ResizeObserver(syncMapArea).observe(sheet);

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
      h('span', { class: 'mrow-side' }, side, h('span', { class: 'reward', 'aria-label': `reward ${m.reward} Snow` }, icon('snow'), `+${m.reward}`)),
    );
  };

  function render(view: ResultsView): void {
    const { result, outcome } = view;
    const reduced = ctx.reducedMotion();

    // Header
    if (view.debug) {
      kicker.textContent = 'Debug run · not saved';
    } else if (result.mode === 'daily' && result.dailyDate) {
      const tryText = view.dailyTry != null ? `Try ${view.dailyTry}/${DAILY_TRIES}` : 'Practice';
      kicker.textContent = `Daily #${dailyNumber(result.dailyDate)} · ${tryText}`;
    } else {
      kicker.textContent = result.mode === 'challenge' ? 'Challenge run' : 'Nubs made it to';
    }
    // A debug run's score isn't real: no share text or challenge link for it.
    hide(shareBtn, view.debug === true);
    const { day, minute } = splitMinutes(result.minutes);
    dayBadge.textContent = `Day ${day}`;
    clock.textContent = formatTimeOfDay(minute);
    // The ribbon is decorative; the heading carries "New best" for screen readers.
    time.setAttribute('aria-label', `${outcome.newBest ? 'New best! ' : ''}Day ${day}, ${formatTimeOfDay(minute)}`);
    ribbon.classList.toggle('is-on', outcome.newBest);

    // Death line, typed.
    // Keep "4:15 PM" on one line when the sentence wraps.
    const line = result.death.line.replace(/(\d) ([AP]M)/g, '$1 $2');
    deathFull.textContent = line;
    deathSpace.textContent = line;
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
      const diff = result.minutes - view.challengeTarget;
      verdict.classList.toggle('is-win', diff >= 0);
      verdict.textContent =
        diff > 0 ? `Challenge beaten by ${formatDuration(diff)}!` : diff === 0 ? 'Dead heat with the challenge!' : `${formatDuration(-diff)} short of the challenge`;
    }

    // Stats (Snow counts up into the wallet).
    const snowValue = h('span', { class: 'num' }, reduced ? `+${outcome.snowEarned}` : '+0');
    const st = result.stats;
    setChildren(
      stats,
      tile('snow', snowValue, `Wallet ${outcome.walletAfter}`, 'stat--snow'),
      tile('flake', String(st.flakes), st.flakes === 1 ? 'flake' : 'flakes', '', st.flakesMelted > 0 ? `${st.flakesMelted} melted` : undefined),
      tile('phew', String(st.phews), st.phews === 1 ? 'PHEW' : 'PHEWs'),
      tile('bolt', st.x5HoldBest > 0 ? `${st.x5HoldBest.toFixed(1)}s` : '–', 'longest ×5'),
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

    sheet.querySelector('.res-scroll')?.scrollTo({ top: 0 });
    syncMapArea();
  }

  return {
    el,
    enter(_from, data) {
      stopAll();
      render(data as ResultsView);
    },
    leave: stopAll,
    back: home,
    activate() {
      retry();
      return true;
    },
    initialFocus: () => retryBtn,
    sheetTop: () => el.clientHeight - sheet.offsetHeight,
  };
}
