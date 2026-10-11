// UI controller: screen state machine, keyboard, overlays (TECH_SPEC §13). The game session drives
// it through the `Ui` interface and receives player intents through `UiCallbacks` (see README.md).

import './ui.css';
import type { SaveV1, Settings } from '../meta/saveTypes.ts';
import { isLandscapePhone, onReducedMotionChange, onViewportChange, prefersReducedMotion } from '../platform/lifecycle.ts';
import { ghostHandSvg } from './art.ts';
import { h, isInteractive, setFlag, svgFromMarkup } from './dom.ts';
import { createModalHost, createRotateOverlay, createToastStack } from './overlays.ts';
import type { Screen, UiContext } from './screen.ts';
import { createDailyScreen } from './screens/daily.ts';
import { createDyingScreen } from './screens/dying.ts';
import { createMissionsScreen } from './screens/missions.ts';
import { createPauseScreen } from './screens/pause.ts';
import { createPlayScreen } from './screens/play.ts';
import { createResultsScreen } from './screens/results.ts';
import { createSettingsScreen } from './screens/settings.ts';
import { createTitleScreen } from './screens/title.ts';
import { createWardrobeScreen } from './screens/wardrobe.ts';
import { isLegalTransition } from './transitions.ts';
import type { ChallengeBanner, GhostMode, ScreenArgs, ScreenId, Ui, UiDeps } from './types.ts';

const STORAGE_WARNING = "Progress can't be saved in this browser mode.";

export function createUi(root: HTMLElement, deps: UiDeps): Ui {
  const cb = deps.callbacks;
  let save: SaveV1 = deps.save;
  let today = deps.today;
  let challenge: ChallengeBanner | null = null;
  let current: ScreenId = 'boot';
  let ghost: GhostMode = 'off';
  let rotateBlocking = false;
  let storageWarned = false;
  /** Last input came from a keyboard: move focus into screens as they open. */
  let keyboardMode = false;
  let motionSetting: Settings['reducedMotion'] = save.settings.reducedMotion;

  root.classList.add('sui');
  root.dataset.screen = current;

  const reducedMotion = (): boolean => motionSetting === 'on' || (motionSetting === 'auto' && prefersReducedMotion());
  const applyMotion = (): void => {
    root.classList.toggle('is-rm', reducedMotion());
  };

  const ctx: UiContext = {
    cb,
    version: deps.version,
    save: () => save,
    today: () => today,
    challenge: () => challenge,
    clearChallenge: () => {
      challenge = null;
      screens.title.refresh?.();
    },
    go: (id, ...args) => go(id, args[0]),
    back: () => back(),
    toast: (text, options) => toasts.show(text, options),
    sound: (name) => cb.uiSound(name),
    reducedMotion,
    changeSettings: (settings) => {
      motionSetting = settings.reducedMotion;
      applyMotion();
      cb.settingsChanged(settings);
    },
    confirm: (options) => modals.confirm(options),
  };

  const title = createTitleScreen(ctx);
  const play = createPlayScreen(ctx);
  const results = createResultsScreen(ctx);
  const screens: Record<Exclude<ScreenId, 'boot'>, Screen> = {
    title,
    play,
    pause: createPauseScreen(ctx),
    dying: createDyingScreen(ctx),
    results,
    settings: createSettingsScreen(ctx),
    daily: createDailyScreen(ctx),
    missions: createMissionsScreen(ctx),
    wardrobe: createWardrobeScreen(ctx),
  };

  const screenLayer = h('div', { class: 'screens' });
  for (const s of Object.values(screens)) {
    setHidden(s.el, true);
    screenLayer.append(s.el);
  }

  // Ghost thumb: Title swipe hint and the in-play directional hint (V1_PLAN §6.2).
  const ghostEl = h(
    'div',
    { class: 'ghost', 'aria-hidden': 'true' },
    h('div', { class: 'ghost-track' }, h('div', { class: 'ghost-trail' }),
      h('div', { class: 'ghost-hand' }, h('span', { class: 'ghost-tip' }), svgFromMarkup(ghostHandSvg()))),
    h('p', { class: 'ghost-word' }, h('span', { class: 'ghost-arrow' }, '‹'), 'drag', h('span', { class: 'ghost-arrow' }, '›')),
  );
  const toasts = createToastStack();
  const modals = createModalHost(() => ctx, (open) => setFlag(screenLayer, 'inert', open || rotateBlocking));
  const rotateEl = createRotateOverlay();
  root.append(screenLayer, ghostEl, toasts.el, modals.el, rotateEl);

  function setHidden(el: HTMLElement, hidden: boolean): void {
    el.classList.toggle('is-on', !hidden);
    // inert keeps hidden screens out of the tab order and the accessibility tree.
    setFlag(el, 'inert', hidden);
  }

  function updateGhost(): void {
    const visible = ghost !== 'off' && (current === 'title' || current === 'play') && !rotateBlocking;
    ghostEl.dataset.mode = visible ? ghost : 'off';
  }

  function go(id: ScreenId, data?: unknown): void {
    if (id === 'boot') return;
    const from = current;
    if (!isLegalTransition(from, id)) {
      if (import.meta.env.DEV) throw new Error(`Illegal UI transition: ${from} -> ${id}`);
      return;
    }
    const next = screens[id];
    if (from === id) {
      next.enter(from, data);
      return;
    }
    if (from !== 'boot') {
      const prev = screens[from];
      setHidden(prev.el, true);
      prev.leave?.();
    }
    current = id;
    root.dataset.screen = id;
    next.enter(from, data);
    setHidden(next.el, false);
    updateGhost();
    if (keyboardMode) next.initialFocus?.()?.focus({ preventScroll: true });
  }

  function back(): void {
    if (modals.isOpen()) {
      modals.dismiss();
      return;
    }
    if (rotateBlocking || current === 'boot') return;
    screens[current].back?.();
  }

  function checkRotate(): void {
    const block = isLandscapePhone();
    if (block === rotateBlocking) return;
    rotateBlocking = block;
    rotateEl.classList.toggle('is-on', block);
    setFlag(screenLayer, 'inert', block || modals.isOpen());
    if (block && current === 'play') {
      go('pause');
      cb.pause();
    }
    updateGhost();
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    keyboardMode = true;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      back();
      return;
    }
    if (modals.isOpen() || rotateBlocking || current === 'boot') return;
    if ((e.key === 'p' || e.key === 'P') && current === 'play') {
      e.preventDefault();
      back();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && !isInteractive(e.target)) {
      if (screens[current].activate?.()) e.preventDefault();
    }
  };
  const onPointerDown = (): void => {
    keyboardMode = false;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointerdown', onPointerDown, true);
  const stopViewport = onViewportChange(checkRotate);
  const stopMotion = onReducedMotionChange(applyMotion);

  applyMotion();
  checkRotate();

  return {
    show: <K extends ScreenId>(id: K, ...args: ScreenArgs<K>) => go(id, args[0]),
    current: () => current,
    back,
    setSave(next) {
      save = next;
      motionSetting = next.settings.reducedMotion;
      applyMotion();
      if (current !== 'boot') screens[current].refresh?.();
    },
    setToday(date) {
      today = date;
      if (current !== 'boot') screens[current].refresh?.();
    },
    setChallenge(banner) {
      challenge = banner;
      screens.title.refresh?.();
    },
    setGhostThumb(mode) {
      ghost = mode;
      updateGhost();
    },
    setAudioMuted(muted) {
      play.setMuted(muted);
    },
    toast: (text, options) => toasts.show(text, options),
    showInstallSheet: () => modals.installSheet(),
    notifyStorageDegraded() {
      if (storageWarned) return;
      storageWarned = true;
      toasts.show(STORAGE_WARNING, { icon: 'warn', tone: 'danger', duration: 4500 });
    },
    resultsSheetTop: () => (current === 'results' ? results.sheetTop() : null),
    isRotateBlocking: () => rotateBlocking,
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
      stopViewport();
      stopMotion();
      for (const s of Object.values(screens)) s.leave?.();
      root.replaceChildren();
      root.classList.remove('sui', 'is-rm');
      delete root.dataset.screen;
    },
  };
}
