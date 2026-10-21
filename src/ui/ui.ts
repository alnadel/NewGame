// UI controller: screen state machine, keyboard, overlays, the cue line (V1_PLAN §8, V1_1_PLAN
// UM9). The game session drives it through the `Ui` interface and receives player intents through
// `UiCallbacks` (see README.md).

// Stylesheets, in cascade order (docs/UI_V2.md §14): the kit (tokens and component recipes), the
// shared base, one file per screen (each owned by one builder), then the motion / hover /
// forced-colour states over all of them.
import './kit.css';
import './ui.css';
import './styles/title.css';
import './styles/play.css';
import './styles/pause.css';
import './styles/dying.css';
import './styles/results.css';
import './styles/settings.css';
import './styles/daily.css';
import './styles/missions.css';
import './styles/wardrobe.css';
import './styles/profile.css';
import './styles/journey.css';
import './a11y.css';
import { shouldOfferRestoreSheet, welcomeBackDue } from '../meta/progression.ts';
import type { Save, Settings } from '../meta/saveTypes.ts';
import {
  isInAppBrowser,
  isIOS,
  isLandscapePhone,
  isStandalone,
  onReducedMotionChange,
  onViewportChange,
  prefersReducedMotion,
} from '../platform/lifecycle.ts';
import { captureInstallPrompt } from '../platform/pwa.ts';
import { ghostHandSvg } from './art.ts';
import { artSprite } from './art-icons.ts';
import { fontsReady } from './fonts.ts';
import { h, isInteractive, setFlag, svgFromMarkup } from './dom.ts';
import { createModalHost, createRotateOverlay, createToastStack } from './overlays.ts';
import { fitRibbon } from './widgets.ts';
import type { Screen, UiContext } from './screen.ts';
import { createDailyScreen } from './screens/daily.ts';
import { createDyingScreen } from './screens/dying.ts';
import { createJourneyScreen } from './screens/journey.ts';
import { createMissionsScreen } from './screens/missions.ts';
import { createPauseScreen } from './screens/pause.ts';
import { createProfileScreen } from './screens/profile.ts';
import { createPlayScreen } from './screens/play.ts';
import { createResultsScreen } from './screens/results.ts';
import { createSettingsScreen } from './screens/settings.ts';
import { createTitleScreen } from './screens/title.ts';
import { createWardrobeScreen } from './screens/wardrobe.ts';
import { isLegalTransition } from './transitions.ts';
import { cueDuration, cueText } from './labels.ts';
import type { ChallengeBanner, CueId, GhostMode, ScreenArgs, ScreenId, Ui, UiDeps } from './types.ts';

const STORAGE_WARNING = "Progress can't be saved in this browser mode.";
const WELCOME_BACK = 'Welcome back! Double Snow this run.';

const WORLD_VARS = ['--world-left', '--world-top', '--world-width', '--world-height'] as const;
/** A screen that left is skipped (ui.css) once its fade (180 ms) and its parts' slide-outs (340 ms) are done. */
const SKIP_AFTER_MS = 400;

export function createUi(root: HTMLElement, deps: UiDeps): Ui {
  const cb = deps.callbacks;
  let save: Save = deps.save;
  let today = deps.today;
  let challenge: ChallengeBanner | null = null;
  let current: ScreenId = 'boot';
  let ghost: GhostMode = 'off';
  let rotateBlocking = false;
  let storageWarned = false;
  /** Last input came from a keyboard: move focus into screens as they open, show key hints. */
  let keyboardMode = false;
  let motionSetting: Settings['reducedMotion'] = save.settings.reducedMotion;
  let announceFlip = false;

  root.classList.add('sui');
  root.dataset.screen = current;
  // Chromium before 123 ignores paint-order on HTML text, so the centred ink halo would eat into the
  // white fill: a thinner halo there (docs/UI_V2.md §2.5). WebKit browsers (Safari, iOS's CriOS)
  // carry no "Chrome/NNN" token, so they never match.
  const chrome = typeof navigator === 'undefined' ? null : /Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent);
  root.classList.toggle('no-po', chrome !== null && Number(chrome[1]) < 123);

  const reducedMotion = (): boolean => motionSetting === 'on' || (motionSetting === 'auto' && prefersReducedMotion());
  const applyMotion = (): void => {
    root.classList.toggle('is-rm', reducedMotion());
  };
  // High contrast (docs/UI_V2.md §8.5): the "High-contrast shadows" setting or the OS preference
  // flattens the candy (no gloss, rays, clouds; flat faces, thicker outlines).
  const contrastQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-contrast: more)') : null;
  const applyContrast = (): void => {
    root.classList.toggle('is-hc', save.settings.highContrast || contrastQuery?.matches === true);
  };
  const setKeyboardMode = (on: boolean): void => {
    if (on === keyboardMode) return;
    keyboardMode = on;
    root.classList.toggle('is-kbd', on);
    // The Title's key line may just have appeared: let it make room.
    if (current !== 'boot') screens[current].relayout?.();
    // Keyboard players hold a key: the cue and the in-play hint say which.
    if (shownCue) renderCue(shownCue.id, shownCue.dir);
    updateGhostKey();
  };

  // Polite live region for screen-reader-only announcements (Results, Pause).
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const announce = (text: string): void => {
    // A trailing no-break space alternates so the same sentence twice is still a change.
    announceFlip = !announceFlip;
    live.textContent = announceFlip ? text : `${text} `;
  };

  const rootPx = (name: string): number | null => {
    const v = parseFloat(root.style.getPropertyValue(name));
    return Number.isFinite(v) ? v : null;
  };

  const ctx: UiContext = {
    cb,
    version: deps.version,
    save: () => save,
    today: () => today,
    setToday: (date) => setToday(date),
    challenge: () => challenge,
    clearChallenge: () => {
      challenge = null;
      screens.title.refresh?.();
    },
    go: (id, ...args) => go(id, args[0]),
    back: () => back(),
    toast: (text, options) => toasts.show(text, options),
    announce,
    sound: (name) => cb.uiSound(name),
    reducedMotion,
    keyboardMode: () => keyboardMode,
    rootPx,
    changeSettings: (settings) => {
      motionSetting = settings.reducedMotion;
      applyMotion();
      // The screens read the new settings at once (the Journey's testing toggle), whether or not
      // the integrator pushes the persisted save back with setSave.
      save = { ...save, settings };
      applyContrast();
      cb.settingsChanged(settings);
    },
    confirm: (options) => modals.confirm(options),
  };

  const title = createTitleScreen(ctx);
  const play = createPlayScreen(ctx);
  const results = createResultsScreen(ctx);
  const daily = createDailyScreen(ctx);
  const screens: Record<Exclude<ScreenId, 'boot'>, Screen> = {
    journey: createJourneyScreen(ctx),
    title,
    play,
    pause: createPauseScreen(ctx),
    dying: createDyingScreen(ctx),
    results,
    settings: createSettingsScreen(ctx),
    daily,
    missions: createMissionsScreen(ctx),
    wardrobe: createWardrobeScreen(ctx),
    profile: createProfileScreen(ctx),
  };

  const screenLayer = h('div', 'screens');
  for (const s of Object.values(screens)) {
    setHidden(s.el, true);
    screenLayer.append(s.el);
  }

  // Ghost thumb: the in-play swipe hint (V1_PLAN §6.2): both ways while a run waits for its first
  // press, one way during the lesson. The Title leads with its Play button instead.
  const ghostEl = h(
    'div',
    { class: 'ghost', deco: true },
    h('div', 'ghost-track', h('div', 'ghost-trail'),
      h('div', 'ghost-hand', h('span', 'ghost-tip'), svgFromMarkup(ghostHandSvg()))),
    h('p', 'ghost-word', h('span', 'ghost-arrow', '‹'), 'drag', h('span', 'ghost-arrow', '›')),
  );
  // Keyboard players in play see the key to hold instead of the swiping hand.
  const ghostKey = h('span', 'ghost-key');
  ghostEl.querySelector('.ghost-track')?.append(ghostKey);

  // The cue line above Nubs (ui.showCue): plain words for the first runs.
  const cueEl = h('p', { class: 'cue', 'aria-live': 'polite' });
  let shownCue: { id: CueId; dir: -1 | 1 | undefined } | null = null;
  let cueTimer = 0;
  /** A finger direction as the arrow key that turns the sun the same way (Invert flips drags only). */
  const keyDir = (dir: -1 | 1 | undefined): -1 | 1 | undefined => (dir !== undefined && save.settings.invert ? (-dir as -1 | 1) : dir);
  const renderCue = (id: CueId, dir: -1 | 1 | undefined): void => {
    cueEl.textContent = cueText(id, keyboardMode ? keyDir(dir) : dir, keyboardMode);
  };
  const showCue = (id: CueId | null, dir?: -1 | 1): void => {
    clearTimeout(cueTimer);
    shownCue = id === null ? null : { id, dir };
    cueEl.classList.toggle('is-on', id !== null);
    if (id === null) return;
    renderCue(id, dir);
    const ms = cueDuration(id, dir);
    if (ms !== null) cueTimer = window.setTimeout(() => showCue(null), ms);
  };
  function updateGhostKey(): void {
    const dir = ghost === 'left' ? -1 : ghost === 'right' ? 1 : undefined;
    // Waiting to start ('both'): Space starts the run (the arrows do too, steering as they go).
    ghostKey.textContent = dir === undefined ? 'Space' : `Hold ${keyDir(dir) === -1 ? '←' : '→'}`;
  }
  const toasts = createToastStack();
  const modals = createModalHost(() => ctx, (open) => setFlag(screenLayer, 'inert', open || rotateBlocking));
  const rotateEl = createRotateOverlay();
  // Screens, the ghost hint and toasts live in the world column; modals and the rotate overlay
  // span the viewport (modals place their dialog inside the column themselves).
  const world = h('div', 'world', screenLayer, ghostEl, cueEl, toasts.el);
  // The art icons' sprite (art-icons.ts): one hidden <svg> of symbols every artIcon() points at.
  root.append(artSprite(), world, modals.el, rotateEl, live);

  // The column's distance to the right and bottom viewport edges, for the inset math in ui.css.
  // Re-measured when the game republishes --world-* (an inline style change) or the viewport moves;
  // the Title re-fits its bottom cluster when Nubs' line (--nubs-y, --halo-r) moves.
  const setVar = (name: string, value: string): void => {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  };
  let worldKey = '';
  let nubsKey = '';
  const syncWorld = (force: boolean): void => {
    const st = root.style;
    const key = WORLD_VARS.map((n) => st.getPropertyValue(n)).join('|');
    const nkey = `${st.getPropertyValue('--nubs-y')}|${st.getPropertyValue('--halo-r')}`;
    const worldChanged = force || key !== worldKey;
    const nubsChanged = nkey !== nubsKey;
    worldKey = key;
    nubsKey = nkey;
    if (worldChanged) {
      const l = rootPx('--world-left');
      const t = rootPx('--world-top');
      const w = rootPx('--world-width');
      const hh = rootPx('--world-height');
      const right = l !== null && w !== null ? Math.max(0, Math.round(root.clientWidth - l - w)) : 0;
      const bottom = t !== null && hh !== null ? Math.max(0, Math.round(root.clientHeight - t - hh)) : 0;
      setVar('--world-gap-right', `${right}px`);
      setVar('--world-gap-bottom', `${bottom}px`);
      results.invalidateSheetTop();
    }
    if ((worldChanged || nubsChanged) && current !== 'boot') screens[current].relayout?.();
    if (worldChanged) fitTitles(current);
  };
  const worldObserver = typeof MutationObserver === 'function' ? new MutationObserver(() => syncWorld(false)) : null;
  worldObserver?.observe(root, { attributes: true, attributeFilter: ['style'] });

  /** Menu headers' ribbon titles shrink to fit their row (it depends on the column and the right-hand chip). */
  function fitTitles(id: ScreenId): void {
    if (id === 'boot') return;
    for (const r of screens[id].el.querySelectorAll<HTMLElement>('.menu-ribbon')) fitRibbon(r);
  }

  function setHidden(el: HTMLElement, hidden: boolean): void {
    el.classList.toggle('is-on', !hidden);
    // inert keeps hidden screens out of the tab order and the accessibility tree.
    setFlag(el, 'inert', hidden);
  }

  // The hand's CSS animation, looked up when the mode changes, so ghostProgress() can read its clock.
  const ghostHand = ghostEl.querySelector('.ghost-hand') as HTMLElement | null;
  let ghostAnim: Animation | null = null;
  let ghostDur = 0;

  function updateGhost(): void {
    const mode = ghost !== 'off' && current === 'play' && !rotateBlocking ? ghost : 'off';
    if (ghostEl.dataset.mode === mode) return;
    ghostEl.dataset.mode = mode;
    ghostAnim = null;
    ghostDur = 0;
    if (mode === 'off' || !ghostHand || typeof ghostHand.getAnimations !== 'function') return;
    try {
      const a = ghostHand.getAnimations()[0];
      const d = a ? Number(a.effect?.getComputedTiming().duration) : 0;
      // Under reduced motion the hand only pulses in place: nothing to follow.
      if (a && d > 0 && !root.classList.contains('is-rm')) {
        ghostAnim = a;
        ghostDur = d;
      }
    } catch {
      // Web Animations unavailable: the canvas falls back to its own timing.
    }
  }

  function ghostProgress(): number {
    if (!ghostAnim || ghostDur <= 0) return -1;
    const t = Number(ghostAnim.currentTime);
    if (!Number.isFinite(t) || t < 0) return -1;
    return (t % ghostDur) / ghostDur;
  }

  let restoreOffered = false;

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
      // Rendered through its fade and its parts' slide-outs, then skipped until shown again (ui.css).
      window.setTimeout(() => prev.el.classList.contains('is-on') || prev.el.classList.remove('is-in'), SKIP_AFTER_MS);
      prev.leave?.();
      // Toasts belong to the screen that raised them; the entering screen's own (raised in enter()
      // or later) stay. The boot-time storage warning survives the first switch.
      toasts.clear();
    }
    current = id;
    root.dataset.screen = id;
    // Rendered again before enter() measures; a screen never styled yet is styled once hidden first,
    // so its transitions start there.
    next.el.classList.add('is-in');
    next.enter(from, data);
    if (!styled.has(next.el)) void next.el.offsetWidth;
    styled.add(next.el);
    setHidden(next.el, false);
    fitTitles(id);
    updateGhost();
    // Screens that measure (the Title's crowding checks) do it once they and the ghost are shown.
    next.relayout?.();
    // Screens choose their focus target from where they were entered (a menu returns focus to the
    // control that opened it).
    if (keyboardMode) focusInto(id);
    if (from === 'boot' && id === 'title' && !restoreOffered) {
      restoreOffered = true;
      if (shouldOfferRestoreSheet(save, { ios: isIOS(), standalone: isStandalone() })) modals.restoreSheet();
      else if (welcomeBackDue(save, today)) toasts.show(WELCOME_BACK, { icon: 'snow', tone: 'gold', duration: 4000 });
    }
  }

  /** Screens styled at least once (go() styles a new one hidden before it shows, for its transitions). */
  const styled = new Set<HTMLElement>();

  /**
   * Moves the focus to screen `id`'s initial target; if the target can't take it yet (still
   * fading in), tries again on the next two frames while that screen is current.
   */
  function focusInto(id: Exclude<ScreenId, 'boot'>, tries = 2): void {
    const target = screens[id].initialFocus?.();
    if (!target) return;
    target.focus({ preventScroll: true });
    if (document.activeElement !== target && tries > 0) requestAnimationFrame(() => current === id && focusInto(id, tries - 1));
  }

  function back(): void {
    if (modals.isOpen()) {
      modals.dismiss();
      return;
    }
    if (rotateBlocking || current === 'boot') return;
    screens[current].back?.();
  }

  function setToday(date: string): void {
    if (date === today) return;
    today = date;
    // Date-dependent views: the Daily screen (number, tries, Play label, history), the Title's dot,
    // and Results' Retry label (yesterday's Daily replays as practice).
    screens.daily.refresh?.();
    screens.title.refresh?.();
    if (current !== 'boot' && current !== 'daily' && current !== 'title') screens[current].refresh?.();
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
    setKeyboardMode(true);
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
    setKeyboardMode(false);
  };
  // iOS Safari ignores user-scalable=no; its proprietary gesture events are the only way to stop a
  // pinch from zooming the page (touch-action covers the rest).
  const onGesture = (e: Event): void => e.preventDefault();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('gesturestart', onGesture, { passive: false });
  const stopInstallPrompt = captureInstallPrompt();
  const stopViewport = onViewportChange(() => {
    checkRotate();
    syncWorld(true);
  });
  const stopMotion = onReducedMotionChange(applyMotion);
  contrastQuery?.addEventListener('change', applyContrast);
  // The display face changes text widths: the Title re-fits, Results re-measures its sheet. CSS text
  // re-renders by itself.
  let alive = true;
  const refit = (): void => {
    if (current !== 'boot') screens[current].relayout?.();
    results.invalidateSheetTop();
    fitTitles(current);
  };
  void fontsReady.then((ok) => {
    if (ok && alive) refit();
  });
  // The text size (the root font size) can change after boot, from browser text scaling or a page
  // zoom setting: a 1rem-wide probe re-fits the same things when it does.
  const remProbe = h('i', { class: 'sr-only', style: 'width:1rem' });
  root.append(remProbe);
  const remPx = (): string => getComputedStyle(root).fontSize;
  let rem = remPx();
  const remObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          if (alive && remPx() !== rem) {
            rem = remPx();
            refit();
          }
        })
      : null;
  remObserver?.observe(remProbe);

  applyMotion();
  applyContrast();
  checkRotate();
  syncWorld(true);

  return {
    show: <K extends ScreenId>(id: K, ...args: ScreenArgs<K>) => go(id, args[0]),
    current: () => current,
    back,
    isModalOpen: () => modals.isOpen(),
    setSave(next) {
      save = next;
      motionSetting = next.settings.reducedMotion;
      applyMotion();
      applyContrast();
      if (current !== 'boot') screens[current].refresh?.();
    },
    setToday,
    setChallenge(banner) {
      challenge = banner;
      screens.title.refresh?.();
    },
    setRunPreview(p) {
      title.setRunPreview(p);
    },
    showCue,
    setPostcard(url) {
      results.setPostcard(url);
    },
    setGhostThumb(mode) {
      ghost = mode;
      updateGhost();
      updateGhostKey();
    },
    ghostProgress,
    ghostClearMeter: (on) => ghostEl.classList.toggle('is-meter', on),
    keyboardMode: () => keyboardMode,
    setAudioMuted(muted) {
      play.setMuted(muted);
    },
    toast: (text, options) => toasts.show(text, options),
    showInstallSheet() {
      // Social apps' web views can't add to the Home Screen.
      if (isInAppBrowser()) return;
      modals.installSheet();
    },
    notifyStorageDegraded() {
      if (storageWarned) return;
      storageWarned = true;
      toasts.show(STORAGE_WARNING, { icon: 'warn', tone: 'danger', duration: 4500 });
    },
    resultsSheetTop: () => (current === 'results' ? results.sheetTop() : null),
    isRotateBlocking: () => rotateBlocking,
    destroy() {
      clearTimeout(cueTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('gesturestart', onGesture);
      stopInstallPrompt();
      stopViewport();
      stopMotion();
      contrastQuery?.removeEventListener('change', applyContrast);
      alive = false;
      worldObserver?.disconnect();
      remObserver?.disconnect();
      for (const s of Object.values(screens)) s.leave?.();
      root.replaceChildren();
      root.classList.remove('sui', 'is-rm', 'is-kbd', 'is-hc', 'no-po');
      delete root.dataset.screen;
    },
  };
}
