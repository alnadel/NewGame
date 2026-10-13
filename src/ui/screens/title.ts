// Title overlay over the live dawn scene (GDD §4-§5, V1_PLAN §8.3-§8.4, V1_1_PLAN UM9).
// Only the actual controls take pointer events; a pointerdown anywhere else reaches the canvas and
// starts the run (the challenge run while a challenge banner is up). Tray buttons activate on click
// with < 8 px of travel, and a sideways drag that starts on one is handed to the canvas.

import { formatScore, formatTimeOfDay, splitMinutes, type DayPlan } from '../../core/index.ts';
import {
  activeMissionViews,
  dailyStatus,
  errandView,
  isDailyUnlocked,
  nextGoal,
  nextRunEased,
  DAILY_UNLOCK_RUNS,
} from '../../meta/progression.ts';
import { logoLayers } from '../art.ts';
import { h, setChildren, svgFromMarkup } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import type { ScreenId } from '../types.ts';
import { challengeGoalText, planText } from '../labels.ts';
import { button, hide } from '../widgets.ts';

/** Travel (px) after which a press is no longer a tap. */
const TAP_SLOP = 8;
/** Horizontal travel (px) that turns a press on a tray button into a canvas drag. */
const HANDOFF_DX = 10;

/** Best score shows once onboarding (gentle runs 0-2) is over: no score pressure before that. */
const BEST_CHIP_RUNS = 3;

/** Gap (px) kept between the challenge banner and the ghost hint. */
const BANNER_GAP = 6;

const TAGLINE = "Don't melt Nubs.";
const REGION_LABEL = 'Drag, or press Space, to start.';
const REGION_LABEL_CHALLENGE = 'Drag, or press Space, to start the challenge.';

/**
 * The logo as stacked layers (art.ts logoLayers): the sun's bob, the rays' spin and the shadow's
 * sway animate HTML wrappers' transforms only, so the compositor runs them without relayout or
 * SVG repaints every frame.
 */
function logo(): HTMLElement {
  const l = logoLayers();
  const origin = `${l.origin.x} ${l.origin.y}`;
  const rays = h('span', { class: 'logo-layer logo-rays' }, svgFromMarkup(l.rays));
  const sun = h('span', { class: 'logo-layer logo-sun' }, svgFromMarkup(l.bloom), rays, svgFromMarkup(l.face));
  sun.style.transformOrigin = origin;
  rays.style.transformOrigin = origin;
  return h('h1', { class: 'logo' }, sun, h('span', { class: 'logo-layer logo-drop' }, svgFromMarkup(l.shadow)), svgFromMarkup(l.word));
}

/** An element's layout box in viewport px, ignoring transforms (the banner pops in with a scale). */
function layoutRect(e: HTMLElement): DOMRect {
  let x = 0;
  let y = 0;
  let p: HTMLElement = e;
  // Sum offsets up to the last offsetParent (the fixed #ui root), then add that root's position.
  for (let next = p.offsetParent as HTMLElement | null; next; next = p.offsetParent as HTMLElement | null) {
    x += p.offsetLeft;
    y += p.offsetTop;
    p = next;
  }
  const base = p.getBoundingClientRect();
  return new DOMRect(base.left + x, base.top + y, e.offsetWidth, e.offsetHeight);
}

function overlaps(a: DOMRect, b: DOMRect, gap = 0): boolean {
  return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 &&
    a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}

export interface TitleScreen extends Screen {
  /** Chips + tray at the bottom of the Title. */
  readonly bottomCluster: HTMLElement;
  /** The Title run's Day-1 plan for the forecast chip (null hides it). */
  setRunPreview(p: DayPlan | null): void;
}

export function createTitleScreen(ctx: UiContext): TitleScreen {
  /** The menu the Title was last left for: keyboard focus returns to its tray button. */
  let returnFrom: ScreenId | null = null;

  const start = (): void => {
    const challengeRun = ctx.challenge() !== null;
    ctx.go('play');
    ctx.cb.startRun(challengeRun ? 'challenge' : 'endless');
  };

  // --- Challenge banner ------------------------------------------------------------------------
  // "Sam challenges you:" — the name is isolated (<bdi>) so a right-to-left name can't reorder the line.
  const challengeName = h('bdi', null);
  const challengeFrom = h('span', { class: 'challenge-from' }, challengeName, ' challenges you:');
  const challengeGoal = h('strong', { class: 'challenge-goal' });
  const challengeNote = h('span', { class: 'challenge-note' });
  const challengePlay = button(ctx, {
    label: 'Play',
    icon: 'play',
    variant: 'primary',
    className: 'challenge-play',
    onPress: () => {
      ctx.go('play');
      ctx.cb.startRun('challenge');
    },
  });
  const challengeClose = button(ctx, {
    label: 'Dismiss challenge',
    icon: 'close',
    round: true,
    sound: 'back',
    className: 'challenge-close',
    onPress: () => {
      ctx.clearChallenge();
      ctx.cb.dismissChallenge();
    },
  });
  const challenge = h(
    'div',
    { class: 'challenge pe', role: 'group', 'aria-label': 'Challenge' },
    h('span', { class: 'challenge-flag', 'aria-hidden': 'true' }, icon('flag')),
    h('div', { class: 'challenge-text' }, challengeFrom, challengeGoal, challengeNote),
    challengePlay,
    challengeClose,
  );

  // --- Chips -------------------------------------------------------------------------------------
  // Best as "D3 2:40 PM", matching the HUD's compact day badge; it opens the Journal.
  const bestDay = h('span', { class: 'day-badge' });
  const bestValue = h('span', { class: 'num' });
  const chipBest = h('button', { class: 'chip chip--btn pe', type: 'button' }, icon('trophy'), bestDay, bestValue, icon('chevron', 'ic chip-chev'));
  chipBest.addEventListener('click', () => {
    ctx.sound('tap');
    ctx.go('journal');
  });
  // The other chips are read as one labeled image each (their aria-label carries the full sentence).
  const pips = h('span', { class: 'pips' });
  const chipMissions = h('span', { class: 'chip', role: 'img' }, icon('missions'), pips);
  const walletValue = h('span', { class: 'num' });
  const chipSnow = h('span', { class: 'chip chip--snow', role: 'img' }, icon('snow'), walletValue);
  const chips = h('div', { class: 'chips' }, chipBest, chipMissions, chipSnow);

  // --- Tray --------------------------------------------------------------------------------------
  const dailyDot = h('span', { class: 'tray-dot', 'aria-hidden': 'true' });
  const dailyLock = h('span', { class: 'tray-lock', 'aria-hidden': 'true' }, icon('lock'));

  const trayButton = (label: string, iconName: IconName, onActivate: () => void, extras: HTMLElement[] = []): HTMLButtonElement => {
    const btn = h(
      'button',
      { class: 'tray-btn pe', type: 'button', 'aria-label': label },
      h('span', { class: 'tray-disc' }, icon(iconName), ...extras),
      h('span', { class: 'tray-label', 'aria-hidden': 'true' }, label),
    );
    let press: { id: number; x: number; y: number } | null = null;
    let moved = false;
    btn.addEventListener('pointerdown', (e) => {
      press = { id: e.pointerId, x: e.clientX, y: e.clientY };
      moved = false;
    });
    btn.addEventListener('pointermove', (e) => {
      if (!press || e.pointerId !== press.id) return;
      const dx = e.clientX - press.x;
      const dy = e.clientY - press.y;
      if (dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) moved = true;
      if (Math.abs(dx) > HANDOFF_DX) {
        press = null;
        if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
        ctx.cb.dragHandoff(e);
      }
    });
    const end = (): void => {
      press = null;
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('click', () => {
      if (moved) {
        moved = false;
        return;
      }
      onActivate();
    });
    return btn;
  };

  const openMenu = (id: 'daily' | 'missions' | 'wardrobe' | 'settings'): void => {
    ctx.sound('tap');
    ctx.go(id);
  };
  const dailyBtn = trayButton(
    'Daily',
    'daily',
    () => {
      if (isDailyUnlocked(ctx.save())) {
        openMenu('daily');
      } else {
        ctx.sound('deny');
        ctx.toast(`The Daily unlocks after ${DAILY_UNLOCK_RUNS} runs.`, { icon: 'lock', tone: 'ink' });
      }
    },
    [dailyDot, dailyLock],
  );
  const missionsBtn = trayButton('Missions', 'missions', () => openMenu('missions'));
  const wardrobeBtn = trayButton('Wardrobe', 'wardrobe', () => openMenu('wardrobe'));
  const settingsBtn = trayButton('Settings', 'settings', () => openMenu('settings'));
  const trayFor: Partial<Record<ScreenId, HTMLButtonElement>> = {
    journal: chipBest,
    daily: dailyBtn,
    missions: missionsBtn,
    wardrobe: wardrobeBtn,
    settings: settingsBtn,
  };
  const tray = h('nav', { class: 'tray', 'aria-label': 'Menu' }, dailyBtn, missionsBtn, wardrobeBtn, settingsBtn);

  // After onboarding the tagline names the next goal; the forecast chip previews the run's Day 1.
  const tagline = h('p', { class: 'tagline' }, TAGLINE);
  const forecast = h('p', { class: 'forecast-chip', hidden: true });
  const bottomCluster = h('div', { class: 'title-bottom' }, chips, h('i', { class: 'title-gap', 'aria-hidden': 'true' }), tray);
  const el = h(
    'section',
    { class: 'scr scr-title', 'aria-label': REGION_LABEL },
    h('div', { class: 'title-top' }, logo(), tagline, forecast, challenge),
    bottomCluster,
  );
  let preview: DayPlan | null = null;
  /** The tagline shows the next goal (it gives way first when the Title is crowded). */
  let goalTagline = false;

  /**
   * Measures and resolves crowding (called on enter, refresh, resize and the first key press; reads
   * layout, never per frame):
   * - the chips stay on one line: the Snow chip is dropped when the row would overflow;
   * - the bottom cluster stays below Nubs' halo (--nubs-y + --halo-r): gaps shrink first (CSS),
   *   then the tray labels go (the buttons keep their aria-labels);
   * - a tall challenge banner drops the goal tagline, shrinks the logo, drops the forecast chip,
   *   then the tagline, to stay clear of the chips;
   * - the swiping hand sits below the dial when it fits between the dial and the chips (the thumb
   *   it teaches then never covers Nubs or what comes at him); otherwise the whole hint sits above
   *   Nubs and never overlaps the tagline, the forecast chip or the banner: its key line goes first,
   *   then the goal tagline, the word "drag", and (after a smaller logo) the hint itself.
   */
  function fit(): void {
    if (!el.classList.contains('is-on')) return;
    chips.classList.remove('no-wallet');
    bottomCluster.classList.remove('no-labels');
    el.classList.remove('is-compact', 'no-tagline', 'no-forecast', 'no-ghost-keys', 'no-ghost-word', 'no-ghost', 'ghost-below');
    if (chips.scrollWidth > chips.clientWidth + 1) chips.classList.add('no-wallet');

    // --nubs-y is in viewport px, like the rects.
    const nubsY = ctx.rootPx('--nubs-y');
    const haloR = ctx.rootPx('--halo-r');
    if (nubsY !== null && haloR !== null) {
      // The chips are the cluster's top row; when the column can't hold it all they overflow
      // upward, so measure them rather than the (capped) cluster box. 1 px covers the rounding of
      // the published vars.
      const limit = nubsY + haloR + 1;
      if (chips.getBoundingClientRect().top < limit) bottomCluster.classList.add('no-labels');
    }

    const shed = (fits: () => boolean, steps: readonly string[]): void => {
      for (const step of steps) if (!fits()) el.classList.add(step);
    };
    const first = goalTagline ? ['no-tagline'] : [];
    // A tall banner (large text, small phone) must not reach the chips.
    if (ctx.challenge() !== null) {
      shed(() => layoutRect(challenge).bottom + BANNER_GAP <= chips.getBoundingClientRect().top, [...first, 'is-compact', 'no-forecast', 'no-tagline']);
    }

    const ghost = el.closest('.world')?.querySelector('.ghost');
    if (!ghost) return;
    const word = ghost.querySelector('.ghost-word');
    const keys = ghost.querySelector('.ghost-keys');
    const track = ghost.querySelector('.ghost-track');
    const handBox = (): DOMRect | null => {
      // The hand hangs from the track's center line: 18 px above (its tip glow) to 50 px below it.
      const t = track?.getBoundingClientRect();
      if (!t || t.height === 0) return null;
      const c = t.top + t.height / 2;
      return new DOMRect(t.left, c - 18, t.width, 68);
    };
    // Below the dial: only the hand and its trail, for touch players (mouse and keyboard players
    // need the key line, which only fits above).
    if (!ctx.keyboardMode() && !matchMedia('(pointer: fine)').matches) {
      el.classList.add('ghost-below');
      if (overlaps(handBox() ?? new DOMRect(), chips.getBoundingClientRect(), 2)) el.classList.remove('ghost-below');
      else return;
    }
    const obstacles = (): DOMRect[] => [tagline, forecast, ...(ctx.challenge() ? [challenge] : [])].map(layoutRect);
    const hitsAny = (r: DOMRect | null | undefined): boolean => !!r && obstacles().some((o) => overlaps(r, o, BANNER_GAP));
    const wordHits = (): boolean => hitsAny(word?.getBoundingClientRect());
    const handHits = (): boolean => hitsAny(handBox());
    // The key line sits between the word and the hand: dropping it lowers the word, so try that first.
    if (hitsAny(keys?.getBoundingClientRect()) || wordHits()) el.classList.add('no-ghost-keys');
    // "drag" and the hand teach the game, so make room before dropping them: the goal tagline, a
    // smaller logo, the forecast chip, then no tagline (small phones, large text, a tall banner).
    shed(() => !wordHits() && !handHits(), [...first, 'is-compact', 'no-forecast', 'no-tagline']);
    if (wordHits()) el.classList.add('no-ghost-word');
    if (handHits()) el.classList.add('no-ghost-word', 'no-ghost');
  }

  function refresh(): void {
    const save = ctx.save();
    const s = save.stats;

    // The best of the rules the next run is played at: the eased best (hatched) on a comfort rung
    // or the warm-up, the standard best at standard rules; the other one when that is still empty.
    const easedNext = nextRunEased(save);
    const eased = s.easedBest > 0 && (easedNext || s.bestMinutes <= 0);
    const shownBest = eased ? s.easedBest : s.bestMinutes;
    hide(chipBest, s.runs < BEST_CHIP_RUNS || shownBest <= 0);
    chipBest.classList.toggle('is-eased', eased);
    const best = splitMinutes(shownBest);
    bestDay.textContent = `D${best.day}`;
    bestValue.textContent = formatTimeOfDay(best.minute);
    chipBest.setAttribute('aria-label', `Journal, ${eased ? 'eased best' : 'best'} ${formatScore(shownBest)}`);

    // Three mission pips and a fourth, set apart, for Today's errand.
    const missions = activeMissionViews(save);
    const errand = errandView(save, ctx.today());
    const pip = (fraction: number, done: boolean, cls = ''): HTMLElement => {
      const p = h('i', { class: `pip${done ? ' is-done' : ''}${cls}` });
      p.style.setProperty('--p', String(fraction));
      return p;
    };
    setChildren(pips, ...missions.map((m) => pip(m.fraction, m.done)), pip(errand.fraction, errand.done, ' pip--errand'));
    const done = missions.filter((m) => m.done).length;
    chipMissions.setAttribute(
      'aria-label',
      `Missions: ${done} of ${missions.length} complete. Today's errand ${errand.done ? 'done' : errand.progressText}`,
    );

    const goal = nextGoal(save, ctx.today());
    goalTagline = goal !== null;
    tagline.textContent = goal?.text ?? TAGLINE;
    tagline.classList.toggle('is-goal', goalTagline);
    renderPreview();

    hide(chipSnow, s.runs === 0);
    walletValue.textContent = String(s.wallet);
    chipSnow.setAttribute('aria-label', `${s.wallet} Snow`);

    const unlocked = isDailyUnlocked(save);
    const unplayed = unlocked && !dailyStatus(save, ctx.today()).played;
    dailyBtn.classList.toggle('is-locked', !unlocked);
    hide(dailyLock, unlocked);
    hide(dailyDot, !unplayed);
    dailyBtn.setAttribute('aria-label', !unlocked ? 'Daily (locked)' : unplayed ? "Daily: today's is new" : 'Daily');

    const banner = ctx.challenge();
    hide(challenge, banner === null);
    el.classList.toggle('has-challenge', banner !== null);
    el.setAttribute('aria-label', banner ? REGION_LABEL_CHALLENGE : REGION_LABEL);
    if (banner) {
      challengeName.textContent = banner.name || 'A friend';
      challengeGoal.textContent = challengeGoalText(banner.minutes);
      const note = banner.warmup ? 'Warm-up run first' : (banner.note ?? '');
      challengeNote.textContent = note;
      hide(challengeNote, note === '');
    }
    fit();
  }

  function renderPreview(): void {
    hide(forecast, preview === null);
    forecast.textContent = preview ? `Forecast: ${planText(preview)}` : '';
  }

  return {
    el,
    bottomCluster,
    setRunPreview(p) {
      if (p?.biome === preview?.biome && p?.forecast === preview?.forecast) return;
      preview = p;
      renderPreview();
      fit();
    },
    enter(from) {
      returnFrom = from;
      refresh();
    },
    refresh,
    relayout: fit,
    activate() {
      start();
      return true;
    },
    // Back from a menu: the tray button that opened it. Otherwise nothing is focused, so Space and
    // Enter start the run (or the challenge) instead of pressing a button.
    initialFocus: () => (returnFrom !== null ? (trayFor[returnFrom] ?? null) : null),
  };
}
