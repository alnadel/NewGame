// Service worker registration (TECH_SPEC §14). The worker itself (sw.js) is emitted at build time by
// the shadySW plugin in vite.config.ts. No skipWaiting: a new version takes over on the next cold
// start, so a running game never reloads under the player.

import { isNative } from './native.ts';

export interface SwEnvironment {
  prod: boolean;
  protocol: string;
  hostname: string;
  hasServiceWorker: boolean;
  native: boolean;
}

/**
 * Register only for production web builds served over https (or localhost for `vite preview`).
 * Native shells, `file:` single-file builds and dev servers never register.
 */
export function canRegisterServiceWorker(env: SwEnvironment): boolean {
  if (!env.prod || env.native || !env.hasServiceWorker) return false;
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
  };
}

/** Registers ./sw.js when allowed. Resolves null when skipped or when registration fails. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !canRegisterServiceWorker(currentEnvironment())) return null;
  try {
    return await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch {
    // e.g. a build without sw.js (dist-single hosted over https): play on without offline support.
    return null;
  }
}
