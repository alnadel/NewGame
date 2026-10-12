// Page lifecycle and device-shape probes (V1_PLAN §8.5, archive/TECH_SPEC §13).
// Every `on*` helper returns an unsubscribe function.

export type Unsubscribe = () => void;

/**
 * Fires when the page stops being visible: tab switch, app backgrounded, screen locked or the page
 * being unloaded (`pagehide` is the only event iOS reliably sends on swipe-to-close). Pause the
 * game and flush the save here. It may fire twice in a row; handlers must be idempotent.
 */
export function onPageHidden(cb: () => void): Unsubscribe {
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') cb();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', cb);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', cb);
  };
}

/** Fires when the page becomes visible again (resume audio here; never auto-resume play). */
export function onPageVisible(cb: () => void): Unsubscribe {
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') cb();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', cb);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', cb);
  };
}

/** Fires when the window loses focus (desktop alt-tab, an OS dialog over the browser). */
export function onWindowBlur(cb: () => void): Unsubscribe {
  window.addEventListener('blur', cb);
  return () => window.removeEventListener('blur', cb);
}

/** Fires on any viewport change: resize, rotation, or the on-screen keyboard / URL bar moving. */
export function onViewportChange(cb: () => void): Unsubscribe {
  const vv = window.visualViewport;
  window.addEventListener('resize', cb);
  window.addEventListener('orientationchange', cb);
  vv?.addEventListener('resize', cb);
  return () => {
    window.removeEventListener('resize', cb);
    window.removeEventListener('orientationchange', cb);
    vv?.removeEventListener('resize', cb);
  };
}

function media(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** A finger-driven device (phones, tablets). */
export function isTouchDevice(): boolean {
  return media('(pointer: coarse)');
}

/** A phone held sideways: show the rotate overlay and pause (V1_PLAN §1.1). */
export function isLandscapePhone(): boolean {
  return isTouchDevice() && window.innerWidth > window.innerHeight && window.innerHeight < 500;
}

/** Launched from the Home Screen / installed PWA rather than a browser tab. */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return media('(display-mode: standalone)') || media('(display-mode: fullscreen)') || nav.standalone === true;
}

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with touch). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** Facebook, Instagram, LINE, X/Twitter, LinkedIn and Google app web views. */
const IN_APP_UA = /FBAN|FBAV|Instagram|Line\/|Twitter|LinkedInApp|GSA/;

/**
 * True inside a social or search app's embedded browser. Those can't add a page to the Home
 * Screen (and keep their own storage), so install prompts make no sense there.
 */
export function isInAppBrowser(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return IN_APP_UA.test(userAgent);
}

/** The OS-level reduced-motion preference. */
export function prefersReducedMotion(): boolean {
  return media('(prefers-reduced-motion: reduce)');
}

/** Fires when the OS-level reduced-motion preference changes. */
export function onReducedMotionChange(cb: (reduce: boolean) => void): Unsubscribe {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const listener = (e: MediaQueryListEvent): void => cb(e.matches);
  mq.addEventListener('change', listener);
  return () => mq.removeEventListener('change', listener);
}
