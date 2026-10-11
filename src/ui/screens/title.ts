// Title overlay over the live dawn scene (GDD §4-§5, V1_PLAN §8.3-§8.4, CRITIQUE #9).
// Only the actual controls take pointer events; a pointerdown anywhere else reaches the canvas and
// starts the run. Tray buttons activate on click with < 8 px of travel, and a sideways drag that
// starts on one is handed to the canvas.

import { formatScore, formatTimeOfDay, splitMinutes } from '../../core/format.ts';
import { activeMissionViews, dailyStatus, isDailyUnlocked, DAILY_UNLOCK_RUNS } from '../../meta/progression.ts';
import { logoSvg } from '../art.ts';
import { h, setChildren, svgFromMarkup } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import { button, hide } from '../widgets.ts';

/** Travel (px) after which a press is no longer a tap. */
const TAP_SLOP = 8;
/** Horizontal travel (px) that turns a press on a tray button into a canvas drag. */
const HANDOFF_DX = 10;

/** Best score shows once onboarding (gentle runs 0-2) is over: no score pressure before that. */
const BEST_CHIP_RUNS = 3;

export interface TitleScreen extends Screen {
  /** Chips + tray at the bottom; the ghost-thumb hint is kept above it. */
  readonly bottomCluster: HTMLElement;
}

export function createTitleScreen(ctx: UiContext): TitleScreen {
  const startEndless = (): void => {
    ctx.go('play');
    ctx.cb.startRun('endless');
  };

  // --- Challenge banner ------------------------------------------------------------------------
  const challengeGoal = h('strong', { class: 'challenge-goal' });
  const challengeNote = h('span', { class: 'challenge-note' });
  const challengePlay = button(ctx, {
    label: 'Play',
    icon: 'play',
    variant: 'primary',
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
    h('span', { class: 'challenge-flag' }, icon('flag')),
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

  // --- Tray --------------------------------------------------------------------------------------
  const dailyDot = h('span', { class: 'tray-dot', 'aria-hidden': 'true' });
  const dailyLock = h('span', { class: 'tray-lock', 'aria-hidden': 'true' }, icon('lock'));

  const trayButton = (label: string, iconName: IconName, onActivate: () => void, extras: HTMLElement[] = []): HTMLButtonElement => {
    const btn = h(
      'button',
      { class: 'tray-btn pe', type: 'button', 'aria-label': label },
      h('span', { class: 'tray-disc' }, icon(iconName), ...extras),
      h('span', { class: 'tray-label' }, label),
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

  const dailyBtn = trayButton(
    'Daily',
    'daily',
    () => {
      if (isDailyUnlocked(ctx.save())) {
        ctx.sound('tap');
        ctx.go('daily');
      } else {
        ctx.sound('deny');
        ctx.toast(`The Daily unlocks after ${DAILY_UNLOCK_RUNS} runs, or once Nubs sees a night.`, { icon: 'lock', tone: 'ink' });
      }
    },
    [dailyDot, dailyLock],
  );
  const tray = h(
    'nav',
    { class: 'tray', 'aria-label': 'Menu' },
    dailyBtn,
    trayButton('Missions', 'missions', () => {
      ctx.sound('tap');
      ctx.go('missions');
    }),
    trayButton('Wardrobe', 'wardrobe', () => {
      ctx.sound('tap');
      ctx.go('wardrobe');
    }),
    trayButton('Settings', 'settings', () => {
      ctx.sound('tap');
      ctx.go('settings');
    }),
  );

  const bottomCluster = h('div', { class: 'title-bottom' }, h('div', { class: 'chips' }, chipBest, chipMissions, chipSnow), tray);
  const el = h(
    'section',
    { class: 'scr scr-title', 'aria-label': 'SHADY title screen. Drag anywhere to start.' },
    h(
      'div',
      { class: 'title-top' },
      h('h1', { class: 'logo' }, svgFromMarkup(logoSvg())),
      h('p', { class: 'tagline' }, "Don't melt Nubs."),
      challenge,
    ),
    bottomCluster,
  );

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
    if (banner) {
      challengeGoal.textContent = `Beat ${formatScore(banner.minutes)}`;
      challengeNote.textContent = banner.note ?? '';
      hide(challengeNote, !banner.note);
    }
  }

  return {
    el,
    bottomCluster,
    enter: refresh,
    refresh,
    activate() {
      startEndless();
      return true;
    },
    initialFocus: () => (ctx.challenge() ? challengePlay : dailyBtn),
  };
}
