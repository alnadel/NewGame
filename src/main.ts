// Boot (archive/TECH_SPEC §9-§14, src/ui/README.md §6): load the save, create audio, haptics, the UI, the
// renderer and the session, start the loop, register the service worker, then drop the boot splash
// once the first frame (the live dawn scene) is on screen. Any uncaught error or rejection flushes
// the save first; a boot that throws leaves a "couldn't start" splash with a Reload button.

import { createAudio } from './audio/index.ts';
import { showBootFailure } from './game/crash.ts';
import { installDebugOverlay, installTestHook, type ShadyTestHook } from './game/debug.ts';
import { parseParams } from './game/params.ts';
import { Session } from './game/session.ts';
import { SAVE_BAK_KEY, SAVE_KEY, SaveStore } from './meta/save.ts';
import { createHaptics } from './platform/haptics.ts';
import { prepareHostDownloads } from './platform/host.ts';
import { registerServiceWorker } from './platform/pwa.ts';
import { createStorage } from './platform/storage.ts';
import type { DebugDraw } from './render/renderer.ts';
import { fontsReadyWithin } from './ui/fonts.ts';

const VERSION = '0.1.0';

/** The live store, for the global error handlers (null until boot has made it). */
let liveStore: SaveStore | null = null;

function flushSave(): void {
  try {
    liveStore?.flush();
  } catch {
    // Storage itself failing: nothing more to do here.
  }
}

// Never swallow the error (no preventDefault): it still reaches the console and any tooling.
window.addEventListener('error', flushSave);
window.addEventListener('unhandledrejection', flushSave);

function boot(): void {
  const params = parseParams(location.search);
  const storage = createStorage();
  if (params.reset && import.meta.env.DEV) {
    storage.remove(SAVE_KEY);
    storage.remove(SAVE_BAK_KEY);
  }
  const store = new SaveStore(storage);
  liveStore = store;
  const settings = store.get().settings;
  const audio = createAudio({ sfx: settings.sfx, music: settings.music, muted: params.mute });
  const haptics = createHaptics(settings.haptics);

  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui');
  if (!canvas || !uiRoot) throw new Error('index.html is missing #game or #ui');

  const session = new Session({ canvas, uiRoot, params, store, audio, haptics, version: VERSION });
  if (store.degraded) session.ui.notifyStorageDegraded();
  if (import.meta.env.MODE === 'single') {
    // The single-file build ships no tooling (A3 budget): its hook is what single.spec drives.
    if (params.test) window.__SHADY_TEST__ = { screen: () => session.ui.current(), forceDeath: () => session.forceDeath() } as Partial<ShadyTestHook> as ShadyTestHook;
  } else {
    if (params.test) installTestHook(session, audio);
    if (params.debug) {
      const draw: DebugDraw = { testPoints: true, masks: false, outlines: false };
      session.setDebugDraw(draw);
      installDebugOverlay(session, draw);
    }
  }
  // The splash waits for the display face as well as the first frame, but never more than 300 ms
  // for the face (docs/UI_V2.md §2.3): a data-URL font decodes in a few ms, so the usual boot shows
  // no flash of the fallback face, and a slow one never holds the game.
  const fontGate = fontsReadyWithin(300);
  session.start(() => void fontGate.then(() => {
    const splash = document.getElementById('boot');
    if (splash) {
      splash.style.pointerEvents = 'none';
      splash.style.transition = 'opacity 200ms ease';
      splash.style.opacity = '0';
      window.setTimeout(() => splash.remove(), 220);
    }
  }));
  // The single-file build has no sw.js (pwa.ts skips it there too): leave the registration out of it.
  if (import.meta.env.MODE !== 'single') void registerServiceWorker();
  prepareHostDownloads();
}

try {
  boot();
} catch (e) {
  console.error(e);
  flushSave();
  showBootFailure();
}
