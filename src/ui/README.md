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

**World column.** The game publishes the world viewport on `#ui` as `--world-left`, `--world-top`,
`--world-width` and `--world-height` (whole px; 400/0/480/800 at 1280×800, 0/0/390/844 on a phone),
together with `--nubs-y`, `--halo-r` and `--nubs-clear`, on every resize and safe-area change.
Screens, the ghost hint and toasts live in a `.world` wrapper at that rect (fallbacks 0/0/100%/100%);
dialogs and sheets are framed inside it; scrims and the menus' paper cover the whole viewport. A
MutationObserver on the root's style measures the column's right/bottom gaps
(`--world-gap-right/bottom`) and safe-area padding becomes `max(0, inset − gap)` (`--in-top/right/
bottom/left`). The Title re-fits its bottom cluster when `--nubs-y`/`--halo-r` move.

**Live region.** A visually hidden `role="status"` `aria-live="polite"` element announces the Results
summary ("Nubs melted at Day 2 · 2:40 PM. New best! Daily try 2 of 3.") and "Paused". Focus moves
into a screen only in keyboard mode, and a menu returns focus to the control that opened it.

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
| `popstate` (V1_PLAN §8.2 sentinel) | play: `ui.show('pause')`; pause: stay; otherwise `ui.back()` |

Input ownership:
- The UI handles **Escape** (back: play -> pause, pause -> resume, menus -> close, results -> home),
  **P** (pause in play) and **Enter/Space** (Title: start an endless run, or the challenge while its
  banner is up; Pause: resume; Dying: skip; Results: retry). Game input should only handle the sun
  keys (arrows, A/D).
- Canvas pointer input matters only on `title` and `play`. On every other screen the UI covers the
  canvas (menus, pause scrim, the dying catcher, the results map catcher), so stray taps never reach it.

## 3. `Ui` reference

| Method | Purpose |
|---|---|
| `show(id, ...args)` | Switch screen. Only `'results'` takes data: `show('results', view: ResultsView)`. |
| `current()` | Current `ScreenId`. |
| `back()` | Same as Escape: closes an open modal first, then the screen's back action (menus → their parent, Results → Home, dying → skip, Settings → where it was opened from, play → pause, pause → resume). The session's history sentinel and a native back button call it. |
| `isModalOpen()` | True while a confirm dialog or the install/restore sheet is open (the session keeps its history sentinel armed then). |
| `setSave(save)` | Push the latest save; visible screens re-render. Call after every store change the UI should see (wallet, unlocks, missions, settings…). Call it synchronously inside `buy`/`equip`/`importBackup`/`resetProgress`. |
| `setToday(date)` | Local date changed while open (midnight rollover; the session checks at most once a second and when the page shows). Re-renders the Daily screen (number, tries, Play label, 14-day history), the Title's Daily dot and Results' Retry label. |
| `setChallenge(banner \| null)` | Title banner "Beat Day 2 · 2:40 PM" + Play, from a `#c=` link (section 6). |
| `setGhostThumb(mode)` | `'both'`: looping swipe above the word "drag" (Title). `'left'` / `'right'`: one-way swipe hint in play (V1_PLAN §6.2). `'off'`. Shown only on `title`/`play`. |
| `ghostProgress()` | Progress 0..1 through the ghost hand's current animation loop (read from its CSS animation clock), or −1 while it is hidden or only pulsing (reduced motion). The game moves the Title sway and the halo's ghost sun in step with it. |
| `setAudioMuted(muted)` | Small muted icon under the pause button while the AudioContext isn't running. |
| `toast(text, { icon?, tone?, duration? })` | Stack at the top of the world column (below the header on menus, below the HUD row in play), 2.5 s each. Every screen switch fades the old toasts out in ~120 ms; toasts raised by the entering screen (in `enter()` or later) stay. Icons/tones as in `meta/progression` `ToastSpec`. |
| `showInstallSheet()` | iOS "Play SHADY from your Home Screen": copies a backup code first (the Home Screen app keeps its own storage), then shows the steps. A no-op in in-app browsers (`isInAppBrowser()`). Use `shouldShowInstallSheet()` and set `flags.installSheetShown`. The UI itself offers the restore sheet on the app's first standalone launch with no runs. |
| `notifyStorageDegraded()` | One-time "Progress can't be saved in this browser mode" toast. |
| `resultsSheetTop()` | Resting top of the Results sheet in viewport CSS px, excluding the slide-in transform (null elsewhere). Frame the Melt Map above it. Cached by a ResizeObserver on the sheet and the screen (and refreshed when the world rect changes), so reading it every frame costs no layout. |
| `isRotateBlocking()` | True while the rotate overlay covers a landscape phone. |
| `destroy()` | Removes listeners and DOM. |

`ResultsView`: `{ result: RunResult, outcome: RunOutcome, dailyTry?: number | null, dailyDate?: string,
dailyScored?: boolean, challengeTarget?: number, debug?: boolean }`. For every run with
`result.mode === 'daily'` (k:'d' challenges included) the session sets `dailyDate` and `dailyScored`
(the run was eligible to count: the date was today and tries were left when it began); `dailyTry`
is the counted try number or null. The kicker reads `Daily #N · Try n/3`, `· Not counted` (with
"Melted before 6:30 AM, so no try was used") or `· Practice`, and Retry reads exactly
`Retry · practice` when the next run of that date can't count (another date, or 3 tries used);
the label logic is in `labels.ts`.
The sheet shows the big time, a NEW BEST ribbon (`outcome.newBest`), `result.death.line` typed at 30
chars/s, Snow +N → wallet, flakes/melted, PHEWs, the best multiplier (or seconds held at ×5), the 3
missions with "complete" stamps, then `outcome.toasts`. Retry is described by the time and the
death line (`aria-describedby`). Retry arms 0.3 s after the sheet appears; a tap anywhere above the
sheet also retries (the UI catches it, the game does nothing). The sheet is at least 58% tall and
grows with its content up to 96 px below the top; on short or large-text screens the top part
scrolls with the list and Retry stays pinned.

## 4. `UiCallbacks` reference

| Callback | When / what to do |
|---|---|
| `startRun(kind, date?)` | `'endless'` (Space/Enter on the Title), `'challenge'` (the banner's Play, or Space/Enter while the banner is up), `'daily'` with the date the Daily screen showed (it checks that date is still today at press time; if not, it refreshes to today with a toast and doesn't start). Start the run (daily: `dailySeed(date ?? localDate())`, profile 3; challenge: its seed or date, profile 3). UI is on `play`. |
| `retry()` | New run, started at once (the core's 0.8 s start beat then gives the player time to aim before Nubs walks). |
| `home()` | Abandon/leave to the Title scene. Don't trap back-navigation any more. |
| `pause()` / `resume()` | Freeze/unfreeze the loop. In `resume`, call `ensureAudio()` synchronously (iOS). |
| `restart()` | Abandon this run, start a new one. |
| `skipDying()` | Jump to Results now: `ui.show('results', view)`. |
| `share()` | `buildShare(result, shareBase(), dailyTry)` then `shareText({ text })`; return the `ShareOutcome`. `shareBase()` is the page's address on the web, else `VITE_SHARE_URL`, else null (no link line). The UI toasts "Copied!" / failure. |
| `settingsChanged(settings)` | Full new `Settings` (already clamped by the controls). Persist (`store.update`), apply volumes, sensitivity, invert, guide, high contrast. Reduced motion is applied to the DOM by the UI. |
| `buy(id)` | `buyCosmetic(save, id)`; on success `store.set(save)`, `ui.setSave(save)`, return true. |
| `equip(id)` | `equipCosmetic(save, id)`; `store.set`, `ui.setSave`. |
| `exportBackup()` | `exportBackup(store.get())`. The UI copies it and shows it in a box. |
| `importBackup(code)` | `importBackup(code)`; on success `store.set(save); store.flush(); ui.setSave(save)` and return `{ ok: true }`, else `{ ok: false, message: backupErrorMessage(error) }`. Return `{ ok: false, message: 'A newer version of SHADY saved progress here. Update the game first.' }` while `!store.canPersist`. The UI confirms before calling and toasts the outcome. |
| `resetProgress()` | Returns `ImportOutcome`: `resetProgress(save)`; `store.set`, `store.flush`, `ui.setSave`, `{ ok: true }`; the same newer-version message while `!store.canPersist`. The UI confirms before calling and toasts "Progress reset. Fresh snow!" or the message. Settings opened from Pause hides Backup and Reset (one line points to the Title's Settings). |
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
  `SAVE_FUTURE_KEY` (`shady.save.future`) and never overwritten; repaired/corrupt raw data is kept in
  `SAVE_BAK_KEY` (`shady.save.bak`); an unreadable main save is recovered from `.bak` when possible.
  - `.canPersist`: false while a newer version's save is on disk (the store then never writes;
    refuse reset and restore with the newer-version message).
  - `.onExternalChange(cb) -> unsubscribe`: another tab or instance wrote the save (a `storage`
    event, or a re-read on page visible that finds different bytes) and the store adopted it (only
    clean `ok` saves; with an unsaved local change it keeps the local settings and owned outfit, then
    writes). Wire it to `ui.setSave(save)` and the settings, and between runs refresh the run count.
  - `.onDegraded(cb) -> unsubscribe`: fires once, on the first failed write after boot (wire it to
    `ui.notifyStorageDegraded()`). `.dispose()` flushes and detaches the listeners.
  - `createStorage()` reads the backing store first (so another tab's write is seen) and retries it
    on every write; `degraded` reports whether the latest write failed.
- `meta/progression.ts`:
  - `beginRun(save) -> { save, dealt }` at every run start (completed missions are replaced here).
  - `applyRunResult(save, result, { today?, dailyTry }) -> { save, outcome }` at run end. "Play
    today's Daily" counts a run with a `dailyTry`, even one that ends after midnight.
  - `dailyTryStarted(save, date) -> { save, tryNumber | null }` when a daily run passes 6:30 AM;
    then `store.set(save); store.flush()` immediately. `null` = practice (unscored).
  - `dailyProgress(save, date, minutes, snow, strip?)` every in-game hour of a scored daily run
    (then flush). Pass `strip = { hourGlyphs, assisted }` so a new best also stores the run's glyph
    strip in the format `applyRunResult` uses.
  - `dailyStatus`, `isDailyUnlocked` (after 3 completed runs, or once any Daily was played),
    `activeMissionViews`, `itemState`, `buyCosmetic`, `equipCosmetic`, `resetProgress`,
    `shouldShowInstallSheet` (not in in-app browsers), `shouldOfferRestoreSheet`.
- `meta/content.ts`: `COSMETICS` (with `look` render params per slot), `equippedLooks`, `MISSIONS`,
  `ACHIEVEMENTS`, lookups.
- `meta/daily.ts`: `localDate()`, `dailyNumber(date)` (#284 = 2026-10-11), `dailySeed(date)`,
  `recentDates`, `formatDateLabel`, `addDays`, `isDateString`.
- `meta/share.ts`: `buildShare(result, baseUrl | null, tryNumber) -> { text, url | null, challenge }`
  (no link line when the base is null), `shareBase()`, the pure `resolveShareBase()`, glyph helpers.
- `meta/challenge.ts`: `encodeChallenge`, `decodeChallenge(code, today?)` (null when malformed, or
  for a Daily date outside `DAILY_EPOCH`..tomorrow), `challengeFromHash(location.hash)`,
  `challengeUrl`.
- `meta/backup.ts`: `exportBackup`, `importBackup`, `backupErrorMessage`.

Run profile from lifetime runs: `save.stats.runs` (0, 1, 2, then 3). Daily and challenge runs use 3.

## 6. Integration recipes

**Boot**
```ts
const storage = createStorage();
const store = new SaveStore(storage);
if (store.degraded) ui.notifyStorageDegraded();
store.onDegraded(() => ui.notifyStorageDegraded());
store.onExternalChange((save) => { ui.setSave(save); applySettings(save.settings); });
onPageHidden(() => { store.flush(); if (ui.current() === 'play') ui.show('pause'); /* + game pause */ });
const challenge = challengeFromHash(location.hash);
if (challenge) ui.setChallenge({ minutes: challenge.m, note: challenge.k === 'd' && challenge.d !== localDate() ? `Daily #${dailyNumber(challenge.d)} · practice run` : undefined });
void registerServiceWorker();   // never in the single-file build or native shells
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
the GDD shadow, system-ui at weight 800 with tabular numerals, buttons ≥ 48 px with a pressable lip
and 180 ms transitions. Text on menus and Results is ≥ 16 px; every control has a 48×48 hit area
(a `::before` hit box where the visual is smaller); `--ink-3` (#6E6584) meets 4.5:1 on paper.
`:focus-visible` is a two-tone ring (3 px ink outline + white halo) that reads on any background;
selected options and tabs carry an ink edge; `@media (forced-colors: active)` keeps switches,
sliders and selections visible; hover states apply only on `(hover: hover)`. Layout uses
`--safe-top|right|bottom|left` (default `env(safe-area-inset-*)`) through the world-column insets.
Reduced motion (`settings.reducedMotion` or the OS preference when "auto") adds `.is-rm`:
transitions become opacity-only and keyframe motion stops. Hidden screens pause their CSS
animations; the Title logo animates composited transforms on stacked layers. The page pans but
never zooms (`touch-action: pan-x pan-y`, iOS `gesturestart` prevented); the canvas and the tray
keep `none`.

## 8. PWA

- `public/manifest.webmanifest` (TECH_SPEC §14) and `public/icons/*` (committed). The icon art lives
  in `src/ui/art.ts`; regenerate with `node scripts/gen-icons.ts` (Playwright Chromium).
- `shadySW()` in `vite.config.ts` emits `sw.js` for client builds (skipped for `--mode single` and
  `dist-single`): precache = bundle + public files (minus install/store-only icons), fetched with
  `cache: 'reload'` so a CDN's stale copy is never precached, `VERSION` = content hash,
  navigations network-first with a 3 s timeout falling back to the cached `index.html`, assets
  cache-first, only `ok` + `basic` responses cached, old `shady-*` caches deleted on activate, no
  `skipWaiting`.
- `platform/pwa.ts` `registerServiceWorker()` registers only in production, over https or localhost,
  never in native shells, `file:` pages or the `single` mode build.
- `captureInstallPrompt()` (called by `createUi`) stashes `beforeinstallprompt`; Settings shows
  "Install SHADY" while `canPromptInstall()` and not standalone; `promptInstall()` →
  `'accepted' | 'dismissed' | 'unavailable'`.
