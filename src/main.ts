// Boot (TECH_SPEC §9-§14, src/ui/README.md §6): load the save, create audio, haptics, the UI, the
// renderer and the session, start the loop, register the service worker, then drop the boot splash
// once the first frame (the live dawn scene) is on screen.

import { createAudio } from './audio/index.ts';
import { installDebugOverlay, installTestHook } from './game/debug.ts';
import { parseParams } from './game/params.ts';
import { Session } from './game/session.ts';
import { SAVE_KEY, SaveStore } from './meta/save.ts';
import { createHaptics } from './platform/haptics.ts';
import { registerServiceWorker } from './platform/pwa.ts';
import { createStorage } from './platform/storage.ts';
import type { DebugDraw } from './render/renderer.ts';

const VERSION = '0.1.0';

function boot(): void {
  const params = parseParams(location.search);
  const storage = createStorage();
  if (params.reset && import.meta.env.DEV) {
    storage.remove(SAVE_KEY);
    storage.remove(`${SAVE_KEY}.bak`);
  }
  const store = new SaveStore(storage);
  const settings = store.get().settings;
  const audio = createAudio({ sfx: settings.sfx, music: settings.music, muted: params.mute });
  const haptics = createHaptics(settings.haptics);

  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui');
  if (!canvas || !uiRoot) throw new Error('index.html is missing #game or #ui');

  const session = new Session({ canvas, uiRoot, params, store, audio, haptics, version: VERSION });
  if (store.degraded) session.ui.notifyStorageDegraded();
  if (params.test) installTestHook(session, audio);
  if (params.debug) {
    const draw: DebugDraw = { testPoints: true, masks: false, outlines: false };
    session.setDebugDraw(draw);
    installDebugOverlay(session, draw);
  }
  session.start(() => {
    const splash = document.getElementById('boot');
    if (splash) {
      splash.style.pointerEvents = 'none';
      splash.style.transition = 'opacity 200ms ease';
      splash.style.opacity = '0';
      window.setTimeout(() => splash.remove(), 220);
    }
  });
  void registerServiceWorker();
}

boot();
