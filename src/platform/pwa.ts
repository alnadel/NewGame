// Service worker registration (TECH_SPEC §14) and the Android install prompt. The worker itself
// (sw.js) is emitted at build time by the shadySW plugin in vite.config.ts. No skipWaiting: a new
// version takes over on the next cold start, so a running game never reloads under the player.

import { isNative } from './native.ts';

export interface SwEnvironment {
  prod: boolean;
  protocol: string;
  hostname: string;
  hasServiceWorker: boolean;
  native: boolean;
  /** Vite build mode; 'single' is the self-contained single-file build (no sw.js exists for it). */
  mode?: string;
}

/**
 * Register only for production web builds served over https (or localhost for `vite preview`).
 * Native shells, the single-file build (`--mode single`), `file:` pages and dev servers never register.
 */
export function canRegisterServiceWorker(env: SwEnvironment): boolean {
  if (!env.prod || env.native || !env.hasServiceWorker || env.mode === 'single') return false;
  const loopback = env.hostname === 'localhost' || env.hostname === '127.0.0.1';
  return env.protocol === 'https:' || (env.protocol === 'http:' && loopback);
}

function currentEnvironment(): SwEnvironment {
  return {
    prod: import.meta.env.PROD,
    protocol: location.protocol,
    hostname: location.hostname,
    hasServiceWorker: 'serviceWorker' in navigator,
    native: isNative(),
    mode: import.meta.env.MODE,
  };
}

/** Registers ./sw.js when allowed. Resolves null when skipped or when registration fails. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !canRegisterServiceWorker(currentEnvironment())) return null;
  try {
    return await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch {
    // e.g. a build without sw.js hosted over https: play on without offline support.
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Install prompt (Chromium / Android): `beforeinstallprompt` is stashed so Settings can offer
// "Install SHADY" at a moment the player chooses, instead of the browser's mini-infobar.
// ---------------------------------------------------------------------------------------------

/** The non-standard event Chromium fires when the page is installable. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

let stashed: InstallPromptEvent | null = null;
const changeListeners = new Set<() => void>();

function setStash(next: InstallPromptEvent | null): void {
  if (stashed === next) return;
  stashed = next;
  for (const cb of [...changeListeners]) cb();
}

/**
 * Starts catching the install prompt: `beforeinstallprompt` is cancelled (no mini-infobar) and
 * kept; `appinstalled` drops it. Call once at startup. Returns a function that stops listening.
 */
export function captureInstallPrompt(target: EventTarget | null = typeof window === 'undefined' ? null : window): () => void {
  if (!target) return () => {};
  const onPrompt = (e: Event): void => {
    e.preventDefault();
    setStash(e as InstallPromptEvent);
  };
  const onInstalled = (): void => setStash(null);
  target.addEventListener('beforeinstallprompt', onPrompt);
  target.addEventListener('appinstalled', onInstalled);
  return () => {
    target.removeEventListener('beforeinstallprompt', onPrompt);
    target.removeEventListener('appinstalled', onInstalled);
  };
}

/** True while a caught install prompt can be shown. */
export function canPromptInstall(): boolean {
  return stashed !== null;
}

/** Calls back whenever canPromptInstall() may have changed. Returns an unsubscribe function. */
export function onInstallPromptChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

/**
 * Shows the caught install prompt (it can be used once) and resolves with the player's choice, or
 * 'unavailable' when there is none or the browser refuses.
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const e = stashed;
  if (!e) return 'unavailable';
  setStash(null);
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  }
}
