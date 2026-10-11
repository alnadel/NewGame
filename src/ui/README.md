# SHADY UI, meta and platform layer

DOM menus and panels over the game canvas, the save/progression rules behind them, and the browser
plumbing (storage, share, PWA, lifecycle, safe areas). The in-play HUD is drawn in the canvas by the
renderer; the only DOM element during play is the pause button (plus a small muted indicator).

```
src/ui/        createUi() controller, screens, overlays, ui.css, brand art, lab
src/meta/      save v1, content catalog, progression, missions, daily, share text, challenge links, backup
src/platform/  storage, share, pwa, lifecycle, safeArea, native
```

Dev lab: `npx vite` then open `/ui-lab.html` (every screen with fake data and a working fake integrator).
URL parameters reach any state: `?screen=results&variant=best&inset=47&rm=1&bare=1` (see `src/ui/lab.ts`).

---

## 1. Mounting

```ts
import { createUi } from './ui/ui.ts';

const ui = createUi(document.getElementById('ui')!, {
  callbacks,              // UiCallbacks, section 4
  save: store.get(),      // SaveV1
  today: localDate(),     // meta/daily.ts
  version: '0.1.0 (a1b2c3d)',
});
ui.show('title');         // boot -> title once the canvas shows the dawn scene
```

`createUi` imports `ui.css`, adds class `sui` to the root and sets `root.dataset.screen` to the current
screen (handy for e2e selectors). `#ui` keeps `pointer-events: none`; only real controls take touches.

## 2. Screens and who switches them

```
boot -> title | play
title -> play | daily | wardrobe | missions | settings
daily -> play | title          wardrobe | missions -> title
settings -> title | pause      (Back returns to wherever Settings was opened from)
play -> pause | dying | results | title
pause -> play | title | settings
dying -> results               results -> play | title
```

Re-showing the current screen is legal and refreshes it (e.g. `show('results', newView)`).
Illegal transitions throw in dev and are ignored in production.

**The UI switches screens itself for player intents, then calls the callback.** When `retry()`,
`resume()`, `pause()`, `home()`, `restart()` or `startRun()` runs, `ui.current()` already reports the
new screen. **The game switches screens for game events** with `ui.show()`:

| Game event | Call |
|---|---|
| Boot finished | `ui.show('title')` |
| A pointerdown on the canvas starts the run on the Title | `ui.show('play')` |
| Nubs melts | `ui.show('dying')` |
| Death animation done (1.1 s) or `callbacks.skipDying()` | `ui.show('results', view)` |
| Page hidden mid-run (lifecycle `onPageHidden`) | `ui.show('pause')` (never auto-resume) |
| `popstate` during play (V1_PLAN §8.2) | `ui.show('pause')` |

Input ownership:
- The UI handles **Escape** (back: play -> pause, pause -> resume, menus -> close, results -> home),
  **P** (pause in play) and **Enter/Space** (Title: start an endless run; Pause: resume; Dying: skip;
  Results: retry). Game input should only handle the sun keys (arrows, A/D).
- Canvas pointer input matters only on `title` and `play`. On every other screen the UI covers the
  canvas (menus, pause scrim, the dying catcher, the results map catcher), so stray taps never reach it.

## 3. `Ui` reference

| Method | Purpose |
|---|---|
| `show(id, ...args)` | Switch screen. Only `'results'` takes data: `show('results', view: ResultsView)`. |
| `current()` | Current `ScreenId`. |
| `back()` | Same as Escape (wire the Capacitor back button here later). |
| `setSave(save)` | Push the latest save; visible screens re-render. Call after every store change the UI should see (wallet, unlocks, missions, settings…). Call it synchronously inside `buy`/`equip`/`importBackup`/`resetProgress`. |
| `setToday(date)` | Local date changed while open (midnight rollover). |
| `setChallenge(banner \| null)` | Title banner "Beat Day 2 · 2:40 PM" + Play, from a `#c=` link (section 6). |
| `setGhostThumb(mode)` | `'both'`: looping swipe above the word "drag" (Title). `'left'` / `'right'`: one-way swipe hint in play (V1_PLAN §6.2). `'off'`. Shown only on `title`/`play`. |
| `ghostProgress()` | Progress 0..1 through the ghost hand's current animation loop (read from its CSS animation clock), or −1 while it is hidden or only pulsing (reduced motion). The game moves the Title sway and the halo's ghost sun in step with it. |
| `setAudioMuted(muted)` | Small muted icon under the pause button while the AudioContext isn't running. |
| `toast(text, { icon?, tone?, duration? })` | Top-center stack, 2.5 s. Icons/tones as in `meta/progression` `ToastSpec`. |
| `showInstallSheet()` | iOS "Add to Home Screen" instructions. Use `shouldShowInstallSheet()` and set `flags.installSheetShown`. |
| `notifyStorageDegraded()` | One-time "Progress can't be saved in this browser mode" toast. |
| `resultsSheetTop()` | Top of the Results sheet in CSS px (null elsewhere). Frame the Melt Map above it. Cheap enough to read every frame; it only changes with the sheet's content height or the viewport. |
| `isRotateBlocking()` | True while the rotate overlay covers a landscape phone. |
| `destroy()` | Removes listeners and DOM. |

`ResultsView`: `{ result: RunResult, outcome: RunOutcome, dailyTry?: number | null, challengeTarget?: number }`.
The sheet shows the big time, a NEW BEST ribbon (`outcome.newBest`), `result.death.line` typed at 30
chars/s, Snow +N → wallet, flakes/melted, PHEWs, longest ×5, the 3 missions with "complete" stamps,
then `outcome.toasts`. Retry arms 0.3 s after the sheet appears; a tap anywhere above the sheet
also retries (the UI catches it, the game does nothing).

## 4. `UiCallbacks` reference

| Callback | When / what to do |
|---|---|
| `startRun(kind)` | `'endless'` (Space/Enter on Title), `'daily'` (Daily > Play), `'challenge'` (banner Play). Start the run (daily: `dailySeed(today)`, profile 3; challenge: its seed or date, profile 3). UI is on `play`. |
| `retry()` | New run, started at once (the core's 0.8 s start beat then gives the player time to aim before Nubs walks). |
| `home()` | Abandon/leave to the Title scene. Don't trap back-navigation any more. |
| `pause()` / `resume()` | Freeze/unfreeze the loop. In `resume`, call `ensureAudio()` synchronously (iOS). |
| `restart()` | Abandon this run, start a new one. |
| `skipDying()` | Jump to Results now: `ui.show('results', view)`. |
| `share()` | `buildShare(result, location.origin + location.pathname, dailyTry)` then `shareText({ text })`; return the `ShareOutcome`. The UI toasts "Copied!" / failure. |
| `settingsChanged(settings)` | Full new `Settings` (already clamped by the controls). Persist (`store.update`), apply volumes, sensitivity, invert, guide, high contrast. Reduced motion is applied to the DOM by the UI. |
| `buy(id)` | `buyCosmetic(save, id)`; on success `store.set(save)`, `ui.setSave(save)`, return true. |
| `equip(id)` | `equipCosmetic(save, id)`; `store.set`, `ui.setSave`. |
| `exportBackup()` | `exportBackup(store.get())`. The UI copies it and shows it in a box. |
| `importBackup(code)` | `importBackup(code)`; on success `store.set(save); store.flush(); ui.setSave(save)` and return `{ ok: true }`, else `{ ok: false, message: backupErrorMessage(error) }`. The UI confirms before calling. |
| `resetProgress()` | `resetProgress(save)`; `store.set`, `store.flush`, `ui.setSave`. The UI confirms before calling. |
| `dismissChallenge()` | Forget the challenge and clear `#c=` (`history.replaceState`). |
| `dragHandoff(e)` | A press that began on a Title tray button slid sideways > 10 px: start the run with catch semantics at `e.clientX/Y` and follow `e.pointerId` (listen on `window`; the button released capture). |
| `uiSound(name)` | `'tap' 'back' 'toggle' 'slide' 'buy' 'equip' 'deny' 'stamp' 'unlock' 'count'`. Map to the GDD "UI tap" recipe (or richer ones) plus the 4 ms UI haptic. |
| `renderWardrobePreview(canvas, equipped)` | Draw Nubs wearing `equipped` (use `equippedLooks(equipped)` from `meta/content`). The canvas backing store is CSS size × DPR (≤ 2). Called on every try-on change; you may keep animating it until the next call. |

## 5. Meta API (pure unless noted)

- `meta/save.ts`: `defaults()`, `migrate(raw) -> { save, status }` (`fresh|ok|corrupt|future`),
  `sanitizeSettings`, `pruneDaily`, `cloneSave`, and **`SaveStore`** (side effects):
  `new SaveStore(createStorage())`, `.status` (`fresh|ok|recovered|corrupt|future`), `.degraded`,
  `.get()`, `.set(save)`, `.update(fn)`, `.flush()`, `.subscribe(fn)`. Writes are debounced 300 ms;
  call `flush()` on `onPageHidden` and at run end. A newer-version save is copied to
  `shady.save.future` and never overwritten; repaired/corrupt raw data is kept in `shady.save.bak`;
  an unreadable main save is recovered from `.bak` when possible.
- `meta/progression.ts`:
  - `beginRun(save) -> { save, dealt }` at every run start (completed missions are replaced here).
  - `applyRunResult(save, result, { today, dailyTry }) -> { save, outcome }` at run end.
  - `dailyTryStarted(save, date) -> { save, tryNumber | null }` when a daily run passes 6:30 AM;
    then `store.set(save); store.flush()` immediately. `null` = practice (unscored).
  - `dailyProgress(save, date, minutes, snow)` every in-game hour of a scored daily run (then flush).
  - `dailyStatus`, `isDailyUnlocked`, `activeMissionViews`, `itemState`, `buyCosmetic`,
    `equipCosmetic`, `resetProgress`, `shouldShowInstallSheet`.
- `meta/content.ts`: `COSMETICS` (with `look` render params per slot), `equippedLooks`, `MISSIONS`,
  `ACHIEVEMENTS`, lookups.
- `meta/daily.ts`: `localDate()`, `dailyNumber(date)` (#284 = 2026-10-11), `dailySeed(date)`,
  `recentDates`, `formatDateLabel`, `addDays`, `isDateString`.
- `meta/share.ts`: `buildShare(result, baseUrl, tryNumber) -> { text, url, challenge }`, glyph helpers.
- `meta/challenge.ts`: `encodeChallenge`, `decodeChallenge` (null when malformed),
  `challengeFromHash(location.hash)`, `challengeUrl`.
- `meta/backup.ts`: `exportBackup`, `importBackup`, `backupErrorMessage`.

Run profile from lifetime runs: `save.stats.runs` (0, 1, 2, then 3). Daily and challenge runs use 3.

## 6. Integration recipes

**Boot**
```ts
const storage = createStorage();
const store = new SaveStore(storage);
if (store.degraded) ui.notifyStorageDegraded();
onPageHidden(() => { store.flush(); if (ui.current() === 'play') ui.show('pause'); /* + game pause */ });
const challenge = challengeFromHash(location.hash);
if (challenge) ui.setChallenge({ minutes: challenge.m, note: challenge.k === 'd' && challenge.d !== localDate() ? `Daily #${dailyNumber(challenge.d)} · practice run` : undefined });
void registerServiceWorker();
```

**Run end**
```ts
const { save, outcome } = applyRunResult(store.get(), result, { today: localDate(), dailyTry });
store.set(save); store.flush(); ui.setSave(save);
if (!save.flags.persistRequested) { void requestPersistence(); store.update((s) => { s.flags.persistRequested = true; }); }
ui.show('dying');
// … 1.1 s later, or on callbacks.skipDying():
ui.show('results', { result, outcome, dailyTry, challengeTarget });
if (shouldShowInstallSheet(save, { ios: isIOS(), standalone: isStandalone() })) { ui.showInstallSheet(); store.update((s) => { s.flags.installSheetShown = true; }); }
```

**Safe areas**: `readSafeArea()` / `onSafeAreaChange()` give the canvas HUD the same insets the DOM
uses. `simulateSafeArea({ top: 47 })` fakes a notch for layout tests (it sets `--safe-*` on `<html>`).

## 7. Styling

`ui.css` defines the GDD palette as custom properties on `.sui` (`--ink #2B2140`, `--paper #FFF8EE`,
`--accent #2EC4B6`, `--gold #FFC23D`, `--danger #FF5D5D`), white 0.92 panels with 20 px radius and
the GDD shadow, system-ui at weight 800 with tabular numerals, buttons ≥ 48 px with a pressable lip,
3 px accent `:focus-visible` rings and 180 ms transitions. Layout uses `--safe-top|right|bottom|left`
(default `env(safe-area-inset-*)`). Reduced motion (`settings.reducedMotion` or the OS preference
when "auto") adds `.is-rm`: transitions become opacity-only and keyframe motion stops.

## 8. PWA

- `public/manifest.webmanifest` (TECH_SPEC §14) and `public/icons/*` (committed). The icon art lives
  in `src/ui/art.ts`; regenerate with `node scripts/gen-icons.ts` (Playwright Chromium).
- `shadySW()` in `vite.config.ts` emits `sw.js` for client builds (skipped for `dist-single`):
  precache = bundle + public files (minus install/store-only icons), `VERSION` = content hash,
  navigations network-first with a 3 s timeout falling back to the cached `index.html`, assets
  cache-first, only `ok` + `basic` responses cached, old `shady-*` caches deleted on activate, no
  `skipWaiting`.
- `platform/pwa.ts` `registerServiceWorker()` registers only in production, over https or localhost,
  never in native shells or `file:` builds.
