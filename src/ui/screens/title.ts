// Title overlay over the live dawn scene (GDD §4-§5, V1_PLAN §8.3-§8.4, CRITIQUE #9).
// Only the actual controls take pointer events; a pointerdown anywhere else reaches the canvas and
// starts the run (the challenge run while a challenge banner is up). Tray buttons activate on click
// with < 8 px of travel, and a sideways drag that starts on one is handed to the canvas.

import { formatScore, formatTimeOfDay, splitMinutes } from '../../core/format.ts';
import { activeMissionViews, dailyStatus, isDailyUnlocked, DAILY_UNLOCK_RUNS } from '../../meta/progression.ts';
import { logoLayers } from '../art.ts';
import { h, setChildren, svgFromMarkup } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import type { ScreenId } from '../types.ts';
import { challengeGoalText } from '../labels.ts';
import { button, hide } from '../widgets.ts';

/** Travel (px) after which a press is no longer a tap. */
const TAP_SLOP = 8;
/** Horizontal travel (px) that turns a press on a tray button into a canvas drag. */
const HANDOFF_DX = 10;

/** Best score shows once onboarding (gentle runs 0-2) is over: no score pressure before that. */
const BEST_CHIP_RUNS = 3;

/** Gap (px) kept between the challenge banner and the ghost hint. */
const BANNER_GAP = 6;

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
    h('div', { class: 'challenge-text' }, h('span', { class: 'kicker' }, 'Challenge'), challengeGoal, challengeNote),
    challengePlay,
    challengeClose,
  );

  // --- Chips -------------------------------------------------------------------------------------
  // Best as "D3 2:40 PM", matching the HUD's compact day badge.
  const bestDay = h('span', { class: 'day-badge' });
  const bestValue = h('span', { class: 'num' });
  // Chips are read as one labeled image each (their aria-label carries the full sentence).
  const chipBest = h('span', { class: 'chip', role: 'img' }, icon('trophy'), bestDay, bestValue);
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
    daily: dailyBtn,
    missions: missionsBtn,
    wardrobe: wardrobeBtn,
    settings: settingsBtn,
  };
  const tray = h('nav', { class: 'tray', 'aria-label': 'Menu' }, dailyBtn, missionsBtn, wardrobeBtn, settingsBtn);

  const tagline = h('p', { class: 'tagline' }, "Don't melt Nubs.");
  const bottomCluster = h('div', { class: 'title-bottom' }, chips, h('i', { class: 'title-gap', 'aria-hidden': 'true' }), tray);
  const el = h(
    'section',
    { class: 'scr scr-title', 'aria-label': REGION_LABEL },
    h('div', { class: 'title-top' }, logo(), tagline, challenge),
    bottomCluster,
  );

  /**
   * Measures and resolves crowding (called on enter, refresh, resize and the first key press; reads
   * layout, never per frame):
   * - the chips stay on one line: the Snow chip is dropped when the row would overflow;
   * - the bottom cluster stays below Nubs' halo (--nubs-y + --halo-r): gaps shrink first (CSS),
   *   then the tray labels go (the buttons keep their aria-labels);
   * - a tall challenge banner shrinks the logo, then drops the tagline, to stay clear of the chips;
   * - the ghost hint never overlaps the tagline or the challenge banner: its key line goes first,
   *   then the word "drag", then (with a banner) the logo shrinks, and as a last resort the hint
   *   hides on the Title (the banner's Play and the region label carry the message).
   */
  function fit(): void {
    if (!el.classList.contains('is-on')) return;
    chips.classList.remove('no-wallet');
    bottomCluster.classList.remove('no-labels');
    el.classList.remove('is-compact', 'no-tagline', 'no-ghost-keys', 'no-ghost-word', 'no-ghost');
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

    // A tall banner (large text, small phone) must not reach the chips: shrink the logo, then drop
    // the tagline.
    if (ctx.challenge() !== null) {
      const clear = (): boolean => layoutRect(challenge).bottom + BANNER_GAP <= chips.getBoundingClientRect().top;
      if (!clear()) el.classList.add('is-compact');
      if (!clear()) el.classList.add('no-tagline');
    }

    const ghost = el.closest('.world')?.querySelector('.ghost');
    if (!ghost) return;
    const word = ghost.querySelector('.ghost-word');
    const keys = ghost.querySelector('.ghost-keys');
    const track = ghost.querySelector('.ghost-track');
    const obstacles = (): DOMRect[] => [tagline, ...(ctx.challenge() ? [challenge] : [])].map(layoutRect);
    const hitsAny = (r: DOMRect | null | undefined): boolean => !!r && obstacles().some((o) => overlaps(r, o, BANNER_GAP));
    const handBox = (): DOMRect | null => {
      // The hand hangs from the track's center line: 5 px above to 50 px below it (any swing phase,
      // its tip glow included).
      const t = track?.getBoundingClientRect();
      if (!t || t.height === 0) return null;
      const c = t.top + t.height / 2;
      return new DOMRect(t.left, c - 18, t.width, 68);
    };
    const wordHits = (): boolean => hitsAny(word?.getBoundingClientRect());
    const handHits = (): boolean => hitsAny(handBox());
    // The key line sits between the word and the hand: dropping it lowers the word, so try that first.
    if (hitsAny(keys?.getBoundingClientRect()) || wordHits()) el.classList.add('no-ghost-keys');
    // "drag" and the hand teach the game, so make room before dropping them: a smaller logo, then
    // no tagline (small phones with a notch, large text, a tall banner).
    if (wordHits() || handHits()) el.classList.add('is-compact');
    if (wordHits() || handHits()) el.classList.add('no-tagline');
    if (wordHits()) el.classList.add('no-ghost-word');
    if (handHits()) el.classList.add('no-ghost-word', 'no-ghost');
  }

  function refresh(): void {
    const save = ctx.save();
    const s = save.stats;

    hide(chipBest, s.runs < BEST_CHIP_RUNS || s.bestMinutes <= 0);
    const best = splitMinutes(s.bestMinutes);
    bestDay.textContent = `D${best.day}`;
    bestValue.textContent = formatTimeOfDay(best.minute);
    chipBest.setAttribute('aria-label', `Best: ${formatScore(s.bestMinutes)}`);

    const missions = activeMissionViews(save);
    setChildren(
      pips,
      ...missions.map((m) => {
        const pip = h('i', { class: m.done ? 'pip is-done' : 'pip' });
        pip.style.setProperty('--p', String(m.fraction));
        return pip;
      }),
    );
    const done = missions.filter((m) => m.done).length;
    chipMissions.setAttribute('aria-label', `Missions: ${done} of ${missions.length} complete`);

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
      challengeGoal.textContent = challengeGoalText(banner.minutes);
      challengeNote.textContent = banner.note ?? '';
      hide(challengeNote, !banner.note);
    }
    fit();
  }

  return {
    el,
    bottomCluster,
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
