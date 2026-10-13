# SHADY UI, meta and platform layer

DOM menus and panels over the game canvas, the save/progression rules behind them, and the browser
plumbing (storage, share, PWA, lifecycle, safe areas). The in-play HUD is drawn in the canvas by the
renderer; the only DOM element during play is the pause button (plus a small muted indicator).

```
src/ui/        createUi() controller, screens, overlays, ui.css, brand art, lab
src/meta/      save v2, content catalog, progression, missions and errands, Sunny Week, daily, share text,
               challenge links, backup
src/platform/  storage, share, pwa, lifecycle, safeArea, native
```

Dev lab: `npx vite` then open `/ui-lab.html` (every screen with fake data and a working fake integrator).
URL parameters reach any state: `?screen=results&variant=warmup&inset=47&rm=1&bare=1&today=2026-10-18`
(see `src/ui/lab.ts`).

---

## 1. Mounting

```ts
import { createUi } from './ui/ui.ts';

const ui = createUi(document.getElementById('ui')!, {
  callbacks,              // UiCallbacks, section 4
  save: store.get(),      // Save (v2)
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
title -> play | daily | wardrobe | missions | settings | journal
daily -> play | title          wardrobe -> title          missions -> title | journal
journal -> title | missions    (Back returns to wherever the Journal was opened from)
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
| `setChallenge(banner \| null)` | Title banner "Sam challenges you: Beat Day 2 · 2:40 PM" + Play, from a `#c=` link (section 6). `banner.name` ('' = "A friend", shown in `<bdi>`), `banner.warmup` (note "Warm-up run first"), `banner.note`. |
| `setRunPreview(plan \| null)` | The Title run's Day-1 `DayPlan` for the chip "Forecast: 🌬️ Breezy · Old Town"; null (plan-off runs) hides it. |
| `showCue(id \| null, dir?)` | The cue line above Nubs (`aria-live` polite, 18 px on an ink pill): `keep-shade` "Keep Nubs in the shade" (2 s), `drag` "Drag ← to swing the sun" ("Hold ←" for keyboard players, Invert honoured; until replaced), `shade-found` "Shade! Thick teal = safe" (1.4 s), `melting` "Melting! Find thick teal" (1.6 s; with `dir`, "Melting! Drag → to the thick teal" until replaced; the session re-sends `drag`/`melting` whenever the lesson's hint changes sides), `swing` "SWING! Straight into the next shade: +Snow" (2.4 s, after the first SWING of a lifetime). Null clears it. Shown only in play. |
| `setPostcard(url \| null)` | The Results postcard thumbnail (an object URL of the ready PNG; a paper placeholder while null). |
| `setGhostThumb(mode)` | `'both'`: the Title's looping swipe (below the dial when it fits above the chips, else above Nubs with the word "drag"). `'left'` / `'right'`: the one-way hint in play, or a "Hold ←" key chip for keyboard players. `'off'`. Shown only on `title`/`play`. |
| `ghostProgress()` | Progress 0..1 through the ghost hand's current animation loop (read from its CSS animation clock), or −1 while it is hidden or only pulsing (reduced motion). The game moves the Title sway and the halo's ghost sun in step with it. |
| `setAudioMuted(muted)` | Small muted icon under the pause button while the AudioContext isn't running. |
| `toast(text, { icon?, tone?, duration? })` | Stack at the top of the world column (below the header on menus, below the HUD row in play), 2.5 s each. Every screen switch fades the old toasts out in ~120 ms; toasts raised by the entering screen (in `enter()` or later) stay. Icons/tones as in `meta/progression` `ToastSpec`. |
| `showInstallSheet()` | iOS "Play SHADY from your Home Screen": copies a backup code first (the Home Screen app keeps its own storage), then shows the steps. A no-op in in-app browsers (`isInAppBrowser()`). Use `shouldShowInstallSheet()` and set `flags.installSheetShown`. The UI itself offers the restore sheet on the app's first standalone launch with no runs. |
| `notifyStorageDegraded()` | One-time "Progress can't be saved in this browser mode" toast. |
| `resultsSheetTop()` | Resting top of the Results sheet in viewport CSS px, excluding the slide-in transform (null elsewhere). Frame the Melt Map above it. Cached by a ResizeObserver on the sheet and the screen (and refreshed when the world rect changes), so reading it every frame costs no layout. |
| `isRotateBlocking()` | True while the rotate overlay covers a landscape phone. |
| `destroy()` | Removes listeners and DOM. |

`ResultsView`: `{ result, outcome, dailyTry?, dailyDate?, dailyScored?, challengeTarget?,
challengeName?, debug?, tip?, warmupFor? }`. For Daily runs (k:'d' challenges included) the session
sets `dailyDate` and `dailyScored`; the kicker reads `Daily #N · Try n/3`, `· Not counted` or
`· Practice`, and Retry reads `Retry · practice` when the next run of that date can't count. `tip` is
core's death recap line; `warmupFor { minutes, name }` marks the warm-up before a challenge (a card
"Now beat Sam: Day 2 · 2:40 PM" and Retry labelled "Take the challenge").
The sheet (v1.1): the big time with the Postcard pill (its thumbnail), the **Sun Strip** (one row of
12 hour tiles per day, the last 4 or 2 on screens under 700 px, a "+N days" chip, the day's forecast
emoji on Day Plan runs, a night pill after each completed day, ghost outlines after the melt; tiles
pop in 35 ms apart), the typed death line, the tip and `outcome.pace`, the challenge verdict, the
warm-up card, `outcome.toasts` as award chips (achievements, items, Morning Snow, Sunny Week, Welcome
back, the errand), stat tiles with nothing to show left out (Snow always; SWINGs with the best chain),
the missions with stamps and Swap on stale ones, and Today's errand. Share is a labeled pill (accent
after a new best, a challenge or a counted Daily try; "Send it back" after a won challenge). Retry
arms 0.3 s after the sheet appears; a tap above the sheet also retries. The sheet grows with its
content up to 68% of the screen (the Melt Map, and the postcard cropped from it, keep about a third;
at least 96 px on tiny screens), then the stats and missions scroll; on short or large-text screens
the whole body scrolls with Retry pinned. The award chips pop first (their space held from the
start), then the stamps land, each scrolled into view: auto-scroll moves only the stats/missions
list and only downward, never the body that holds the score.

**Journal** (v1.1): bests (endless and Daily), the last 30 endless runs as bars (height ∝ score,
colour by the day reached, the best in gold, runs on eased rules hatched, an sr-only summary), the
last-10 average and its change against the 10 before, and lifetime totals. Opened from the Title's
Best chip ("Journal, best …") and the Missions header. The first three runs never count as a best
(gentler rules): their best (`stats.easedBest`) shows under "Best run" as "Eased: …", and on the
Best chip (its day badge hatched, "Journal, eased best …") while it is ahead of the counted best.

## 4. `UiCallbacks` reference

| Callback | When / what to do |
|---|---|
| `startRun(kind, date?)` | `'endless'` (Space/Enter on the Title), `'challenge'` (the banner's Play, or Space/Enter while the banner is up), `'daily'` with the date the Daily screen showed (it checks that date is still today at press time; if not, it refreshes to today with a toast and doesn't start). Start the run (daily: `dailySeed(date ?? localDate())`, profile 3; challenge: its seed or date, profile 3). UI is on `play`. |
| `retry()` | New run, started at once (the core's 0.8 s start beat then gives the player time to aim before Nubs walks). |
| `home()` | Abandon/leave to the Title scene. Don't trap back-navigation any more. |
| `pause()` / `resume()` | Freeze/unfreeze the loop. In `resume`, call `ensureAudio()` synchronously (iOS). |
| `restart()` | Abandon this run, start a new one. |
| `skipDying()` | Jump to Results now: `ui.show('results', view)`. |
| `share()` | `buildShare(result, shareBase(), dailyTry, { name: settings.name, par })` then `shareText({ text })` (text and link; desktop copies). The UI toasts "Copied!" / failure. |
| `sharePostcard()` | The Postcard pill: `shareFiles({ file, text })` called synchronously in the click task; `'saved'` toasts "Postcard saved · link copied". Optional until gameRender's postcard lands (the pill hides without it). |
| `swapMission(slotId)` | Swap on a stale mission (Missions card or Results row): `swapMission(save, slotId)`, `store.set`, `ui.setSave`. |
| `settingsChanged(settings)` | Full new `Settings` (already clamped by the controls). Persist (`store.update`), apply volumes, sensitivity, invert, guide, high contrast. Reduced motion is applied to the DOM by the UI. |
| `buy(id)` | `buyCosmetic(save, id)`; on success `store.set(save)`, `ui.setSave(save)`, return true. |
| `equip(id)` | `equipCosmetic(save, id)`; `store.set`, `ui.setSave`. |
| `exportBackup()` | `exportBackup(store.get())`. The UI copies it and shows it in a box. |
| `importBackup(code)` | `importBackup(code)`; on success `store.set(save); store.flush(); ui.setSave(save)` and return `{ ok: true }`, else `{ ok: false, message: backupErrorMessage(error) }`. Return `{ ok: false, message: 'A newer version of SHADY saved progress here. Update the game first.' }` while `!store.canPersist`. The UI confirms before calling and toasts the outcome. |
| `resetProgress()` | Returns `ImportOutcome`: `resetProgress(save)`; `store.set`, `store.flush`, `ui.setSave`, `{ ok: true }`; the same newer-version message while `!store.canPersist`. The UI confirms before calling and toasts "Progress reset. Fresh snow!" or the message. Settings opened from Pause hides Backup and Reset (one line points to the Title's Settings). |
| `dismissChallenge()` | Forget the challenge and clear `#c=` (`history.replaceState`). |
| `dragHandoff(e)` | A press that began on a Title tray button slid sideways > 10 px: start the run with catch semantics at `e.clientX/Y` and follow `e.pointerId` (listen on `window`; the button released capture). |
| `uiSound(name)` | `'tap' 'back' 'toggle' 'slide' 'buy' 'equip' 'deny' 'stamp' 'unlock' 'count'`. Map to the GDD "UI tap" recipe (or richer ones) plus the 4 ms UI haptic. |
| `renderWardrobePreview(canvas, equipped, subject)` | Draw Nubs wearing `equipped` (`subject` 'nubs'), or the sun in `equipped.shades` on the Shades tab ('sun'); use `equippedLooks(equipped)`. The backing store is CSS size × DPR (≤ 2). Called on every try-on or tab change. |

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
    event, or a re-read on page visible that finds different bytes) and the store took it in (only
    clean `ok` saves). Each stored save names the revisions it includes (`revs`), so the store
    adopts a save that includes everything it has as it is, and otherwise merges the two from the
    newest save both include (`meta/saveMerge.ts`: counters add both sides' gains, bests take the
    larger, owned items, Daily tries and run history keep both sides'; settings and outfit keep this
    instance's) and writes the merge back at once. `flush()` merges a save written meanwhile before
    writing, so no write replaces progress it never saw. The live save object is updated in place.
    Wire it to `ui.setSave(save)` and the settings, and between runs refresh the run count.
  - `.onDegraded(cb) -> unsubscribe`: fires once, on the first failed write after boot (wire it to
    `ui.notifyStorageDegraded()`). `.dispose()` flushes and detaches the listeners.
  - `createStorage()` reads the backing store first (so another tab's write is seen) and retries it
    on every write; `degraded` reports whether the latest write failed.
- `meta/progression.ts`:
  - `beginRun(save) -> { save, dealt }` at every run start (completed missions are replaced here).
  - `applyRunResult(save, result, { today, dailyTry?, challengeTarget?, playSeconds?, rung? }) ->
    { save, outcome }` at run end: bests from lifetime run 3, the history and comfort rung (endless),
    Morning Snow, Welcome back, Sunny Week, Today's errand, missions with staleness, achievements.
    `outcome` adds `bonusSnow`, `pace`, `errand`, `recentBestBefore`, `comfortAfter`.
  - `swapMission`, `recentBest` (tutorial runs ignored), `MILESTONES`, `nextMilestone`, `nextGoal`
    (the Title tagline from run 3), `welcomeBackDue` (the launch toast), `errandView`, `setDailyPar`.
  - `dailyTryStarted(save, date) -> { save, tryNumber | null }` when a daily run passes 6:30 AM;
    then `store.set(save); store.flush()` immediately. `null` = practice (unscored).
  - `dailyProgress(save, date, minutes, snow, strip?)` every in-game hour of a scored daily run
    (then flush). Pass `strip = { hourGlyphs, assisted }` so a new best also stores the run's glyph
    strip in the format `applyRunResult` uses.
  - `dailyStatus`, `isDailyUnlocked` (after 3 completed runs, or once any Daily was played),
    `activeMissionViews`, `itemState`, `buyCosmetic`, `equipCosmetic`, `resetProgress`,
    `shouldShowInstallSheet` (not in in-app browsers), `shouldOfferRestoreSheet`.
- `meta/content.ts`: `COSMETICS` (24 in 4 slots, Sun Shades included, with `look` render params),
  `equippedLooks`, `MISSIONS` (with skill gates), `ERRANDS`, `ACHIEVEMENTS` (16), lookups.
- `meta/week.ts`: `markSunnyDay`, `mondayOf`, `weekFor` (local date strings; DST never matters).
- `meta/daily.ts`: `localDate()`, `dailyNumber(date)` (#284 = 2026-10-11), `dailySeed(date)`,
  `recentDates`, `formatDateLabel`, `addDays`, `isDateString`.
- `meta/share.ts`: `buildShare(result, baseUrl | null, tryNumber, { name?, par?, plan? }) -> { text,
  url | null, challenge }` (forecast emojis on Day Plan runs, "Beat Sam's run", Snowbot's par on
  Dailies), `shareBase()`, the pure `resolveShareBase()`, glyph helpers. `platform/share.ts`:
  `shareText`, `shareFiles({ file, text })` ('saved' = downloaded and copied), `copyText`.
- `meta/challenge.ts`: `encodeChallenge` (keys v, k, seed|d, m, s, p, dr, nc, pl, n), `decodeChallenge`
  (a v1.0 code decodes to the v1.0 world; invalid optional fields are dropped), `sanitizeName`,
  `challengeFromHash(location.hash)`, `challengeUrl(base, c)` = `${base}#c=${code}`.
- `meta/backup.ts`: `exportBackup`, `importBackup`, `backupErrorMessage`.

Endless rules come from the comfort rung (`stats.comfort`, core `rungConfig`); Daily and challenge
runs use their own rules.

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
if (challenge) ui.setChallenge({ minutes: challenge.m, name: challenge.n ?? '', warmup: store.get().stats.runs === 0 });
void registerServiceWorker();   // never in the single-file build or native shells
```

**Run end**
```ts
const { save, outcome } = applyRunResult(store.get(), result, { today: localDate(), dailyTry, challengeTarget, playSeconds, rung });
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

- `public/manifest.webmanifest` and `public/icons/*` (committed). The icon art lives
  in `src/ui/art.ts`; regenerate with `node scripts/gen-icons.ts` (Playwright Chromium).
- `shadySW()` in `vite.config.ts` emits `sw.js` for client builds (skipped for `--mode single` and
  `dist-single`): precache = bundle + public files (minus install/store-only icons and `og.png`), fetched with
  `cache: 'reload'` so a CDN's stale copy is never precached, `VERSION` = content hash,
  navigations network-first with a 3 s timeout falling back to the cached `index.html`, assets
  cache-first, only `ok` + `basic` responses cached, old `shady-*` caches deleted on activate, no
  `skipWaiting`.
- `platform/pwa.ts` `registerServiceWorker()` registers only in production, over https or localhost,
  never in native shells, `file:` pages or the `single` mode build.
- `captureInstallPrompt()` (called by `createUi`) stashes `beforeinstallprompt`; Settings shows
  "Install SHADY" while `canPromptInstall()` and not standalone; `promptInstall()` →
  `'accepted' | 'dismissed' | 'unavailable'`.

## 9. Link previews

`index.html` carries Open Graph and Twitter tags with absolute URLs from `%VITE_SHARE_URL%` (one card
for every link, A10). `node scripts/gen-og.ts` (after `npx vite build`) renders `public/og.png`:
1200×630, 256 colours, under 300 KB; re-run it after visual changes and commit the PNG.
