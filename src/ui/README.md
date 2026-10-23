# SHADY UI, meta and platform layer

DOM menus and panels over the game canvas, the save/progression rules behind them, and the browser
plumbing (storage, share, PWA, lifecycle, safe areas). The in-play HUD is drawn in the canvas by the
renderer; the only DOM element during play is the pause button (plus a small muted indicator).

```
src/ui/        createUi() controller, screens, overlays, ui.css, brand art, lab, the Journey map,
               the Elementals screen
src/meta/      save v4, content catalog, progression (Journey levels, Trials and star rewards included),
               missions, gamify (Sun Rank, globes, daily streak, unlocks), sunny days, daily,
               share text, challenge links, backup
src/platform/  storage, share, pwa, lifecycle, safeArea, native
```

Dev lab: `npx vite` then open `/ui-lab.html` (every screen with fake data and a working fake integrator).
URL parameters reach any state: `?screen=results&variant=warmup&inset=47&rm=1&bare=1&today=2026-10-18`
(see `src/ui/lab.ts`; `screen=journey` with `regular|fresh|unlock-all|far`, `screen=elementals` with
`regular|fresh|unlock-all|done`, and the Results variants
`level|level-perfect|level-last|level-fail|level-death`).

---

## 1. Mounting

```ts
import { createUi } from './ui/ui.ts';

const ui = createUi(document.getElementById('ui')!, {
  callbacks,              // UiCallbacks, section 4
  save: store.get(),      // Save (v3)
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
title -> play | daily | wardrobe | missions | settings | journey | profile | elementals
profile -> title | missions | wardrobe | journey  (v1.4; Back returns where it opened from)
daily -> play | title          wardrobe -> title | profile          missions -> title | profile
journey -> play | title | profile  (a tile starts its level; Back returns where it opened from)
elementals -> play | title     (a Trial tile or Play starts the Trial; Back is the Title)
settings -> title | pause      (Back returns to wherever Settings was opened from)
play -> pause | dying | results | title
pause -> play | title | settings
dying -> results               results -> play | title | journey | elementals
```

Re-showing the current screen is legal and refreshes it (e.g. `show('results', newView)`).
Illegal transitions throw in dev and are ignored in production.

**The UI switches screens itself for player intents, then calls the callback.** When `retry()`,
`resume()`, `pause()`, `home()`, `restart()`, `startRun()`, `nextLevel()` or `openJourney()` runs,
`ui.current()` already reports the new screen. **The game switches screens for game events** with `ui.show()`:

| Game event | Call |
|---|---|
| Boot finished | `ui.show('title')` |
| A pointerdown on the canvas starts the run on the Title | `ui.show('play')` |
| Nubs melts | `ui.show('dying')` |
| Death animation done (1.1 s) or `callbacks.skipDying()` | `ui.show('results', view)` |
| Page hidden mid-run (lifecycle `onPageHidden`) | `ui.show('pause')` (never auto-resume) |
| `popstate` (V1_PLAN §8.2 sentinel) | play: `ui.show('pause')`; pause: stay; otherwise `ui.back()` |

Input ownership:
- The UI handles **Escape** (back: play -> pause, pause -> resume, menus -> close, results -> home,
  or the Journey map after a level, the Elementals screen after a Trial), **P** (pause in play) and **Enter/Space** (Title: play the next
  Journey level, or the challenge while its banner is up; Pause: resume; Dying: skip; Results:
  retry, or Next level after a passed level). Game input should only handle the sun keys (arrows,
  A/D; on the Title they start an endless run, as a canvas drag does).
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
| `setGhostThumb(mode)` | `'both'`: the looping swipe with the word "drag" while a run waits for its first press. `'left'` / `'right'`: the one-way hint in play, or a "Hold ←" key chip for keyboard players. `'off'`. Shown only in `play` (the Title leads with its Play button; the game may keep sending `'both'` there). |
| `ghostProgress()` | Progress 0..1 through the ghost hand's current animation loop (read from its CSS animation clock), or −1 while it is hidden or only pulsing (reduced motion). The game moves the halo's ghost sun (and a run's waiting sway) in step with it. |
| `setAudioMuted(muted)` | Small muted icon under the pause button while the AudioContext isn't running. |
| `toast(text, { icon?, tone?, duration? })` | Stack at the top of the world column (below the header on menus, below the HUD row in play), 2.5 s each. Every screen switch fades the old toasts out in ~120 ms; toasts raised by the entering screen (in `enter()` or later) stay. Icons/tones as in `meta/progression` `ToastSpec`. |
| `showInstallSheet()` | iOS "Play SHADY from your Home Screen": copies a backup code first (the Home Screen app keeps its own storage), then shows the steps. A no-op in in-app browsers (`isInAppBrowser()`). Use `shouldShowInstallSheet()` and set `flags.installSheetShown`. The UI itself offers the restore sheet on the app's first standalone launch with no runs. |
| `notifyStorageDegraded()` | One-time "Progress can't be saved in this browser mode" toast. |
| `resultsSheetTop()` | Resting top of the Results sheet in viewport CSS px, excluding the slide-in transform (null elsewhere). Frame the Melt Map above it. Cached by a ResizeObserver on the sheet and the screen (and refreshed when the world rect changes), so reading it every frame costs no layout. |
| `isRotateBlocking()` | True while the rotate overlay covers a landscape phone. |
| `destroy()` | Removes listeners and DOM. |

`ResultsView`: `{ result, outcome, dailyTry?, dailyDate?, dailyScored?, challengeTarget?,
challengeName?, debug?, tip?, warmupFor?, campaign? }`. For Daily runs (k:'d' challenges included) the session
sets `dailyDate` and `dailyScored`; the kicker reads `Daily #N · Try n/3`, `· Not counted` or
`· Practice`, and Retry reads `Retry · practice` when the next run of that date can't count. `tip` is
core's death recap line; `warmupFor { minutes, name }` marks the warm-up before a challenge (a card
"Now beat Sam: Day 2 · 2:40 PM" and Retry labelled "Take the challenge").
The sheet (v1.1): the big time with the Postcard pill (its thumbnail), the **Sun Strip** (one row of
12 hour tiles per day, the last 4 or 2 on screens under 700 px, a "+N days" chip, the day's forecast
emoji on Day Plan runs, a night pill after each completed day, ghost outlines after the melt; tiles
pop in 35 ms apart), the typed death line, the tip and `outcome.pace`, the challenge verdict, the
warm-up card, `outcome.toasts` as award chips (achievements, items, Welcome back, features unlocked), stat tiles with nothing to show left out (Snow always; SWINGs with the best chain),
the missions with stamps and Swap on stale ones. Share is a labeled pill (accent
after a new best, a challenge or a counted Daily try; "Send it back" after a won challenge). Retry
arms 0.3 s after the sheet appears; a tap above the sheet also retries. The sheet grows with its
content up to 68% of the screen (the Melt Map, and the postcard cropped from it, keep about a third;
at least 96 px on tiny screens), then the stats and missions scroll; on short or large-text screens
the whole body scrolls with Retry pinned. The award chips pop first (their space held from the
start), then the stamps land in place; nothing scrolls by itself, so the warm-up card, the chips
and the tiles stay where they are (fix round 2). The missions done this run pop in as one more
chip with the first stamp ("2 missions done +20"), so the reward shows wherever the rows sit.

**Journey** (v1.2, docs/CAMPAIGN_PLAN.md §5; Journey-first since v1.3): the Title's bottom
cluster is the chips (Best → Profile, mission pips), the **modes** row and the tray (Daily,
Missions, Wardrobe, Settings). The modes are the map button `.journey-pill` (the stars earned,
"Map" before any; `openJourney()`), the primary **Play** `.play-pill` "Level N" (`continueLevel`,
the highest unlocked level: `startRun('campaign', undefined, N)`; Space/Enter too) and **Endless**
`.endless-pill` (`startRun('endless')`); the map and Endless are candy squares with their label
as a tag hanging under them (docs/UI_V2.md §10.1). A sideways drag on any of them is handed to the
sun. When the cluster would reach Nubs' halo the Title sheds, in order, the tray labels, then the
square and pill sizes (`is-tight`), then the chips row (`no-chips`). A goal tagline is Nubs' speech
bubble just above his halo (`fit()` places it, or returns it under the logo: `.goal-inline`). Mouse and keyboard
players see the key line "Space: play the level · ← →: Endless · Esc: back" under the tagline
("Space or ← →: play the level" while Endless is locked: a canvas press or an arrow then plays the
next level, session.ts onPress).

**v1.4 Title** (docs/V1_4_PLAN.md): a top bar holds the Sun Rank badge (`gamify.ts rankBadge`; it
opens the Profile once `featureUnlocked(save, 'profile')`, else it toasts `featureHint`), a gold
"Reward" button while `claimables(save).daily` (it claims the streak's reward: `claimDailyReward`, the reveal plays)
and the Snow wallet (it counts up after a run). Endless, Daily, Missions and Wardrobe are gated by
`featureUnlocked`: locked, they show a lock badge and a tap toasts `featureHint(f)`; while nothing
is unlocked yet (and no stars) the locked buttons, the map and the top bar are hidden, so a first
launch is Play (and Settings) only. A feature unlocked by progress gets `.is-new` (a NEW tag and a
pulse) until opened (`featureIsNew`; opening it applies `markFeatureSeen` through `cb.updateSave`),
and a one-time "Wardrobe unlocked!" toast. Claim dots
(`claimDot`) go on the badge (globes + trophies) and on the Missions and Wardrobe discs.

**v1.4 Results**: the XP meter (`xpMeter`) sits under the goal line (the score on endless runs) and
fills once the stars have landed (0.5 s in on endless runs); when its `show` resolves `revealRewards(ctx,
outcome.gamify.rewards)` runs, and Retry / Next level arm only when it resolves (Back, Enter and
the map tap wait too). With nothing to reveal they arm after 0.3 s as before. Features the run
unlocked are among `outcome.toasts`, the award chips ("Wardrobe unlocked!").

**v1.4 Journey and Wardrobe**: each chapter card opens with a biome-coloured banner ("Chapter 4"
over its name) and the chapter's Snow Globe, gold with a check once all ten levels are passed
(`.is-complete`; its star tag turns gold at 30 stars, `.is-perfect`); a chapter completed since the last visit
pops its globe and toasts. The Wardrobe shows the collection (owned / all, with a bar), each item's
rarity (meta/gamify.ts `rarity`, the one the Snow Globes weigh and the reveal names: by price, by
the granting trophy's tier, or globe exclusive) as a coloured rim and label, and NEW marks (with a dot on their tab) on wearable or buyable
items not seen there yet (`newItems`, taken on entry so they stay while browsing; a tapped item
loses its mark, and leaving applies `markItemsSeen`).

`ResultsView.campaign = { id, name, passed, stars, nextId: number | null, goalLine, introduces? }`
turns the sheet into the compact level variant (it may take 82% of the screen, it has no postcard):
the kicker "Level 12 · Passed", three big stars as the hero (the middle one raised; popping in
220 ms apart with the stamp sound), the level name, the goal line (accent on a pass), the death
line and tip only when the level wasn't passed, the **star road** (widgets.ts `starRoad`: the next
star reward's item, "Starry Scarf at 25 stars", `6/25` and a bar), then one row of stat pills and
the award chips; mission rows are left out (their award chip says what they paid). The actions sit
at the bottom: **Next level** (primary, armed like Retry, only when passed and `nextId` is set; the
map tap and Enter/Space fire it), **Retry** and **Map** (`openJourney()`); Back is Map. Share is
the accent after a pass. `introduces` is no longer shown (the level's intro card teaches it).

The Journey screen (`'journey'`, `screens/journey.ts`) reads the save and `CAMPAIGN_LEVELS` itself:
the header's total stars `n/600`, a sticky "Continue · Level N" over the star road, then 20 chapter
boards (biome mark, name, stars `n/30` as a tag under the globe; `.is-locked` while their first level
is, with a "Finish Level N" plate; `.is-complete` at 30) of 10 tiles `.lvl-tile[data-level]` on a
road that snakes 1→5, then 6→10 right to left (CSS only; DOM and Tab order stay 1→10). A tile shows
its number on a disc, its stars, the concept mark on levels 1-40 with the concept's name and blurb
as the tooltip and in the aria-label, `.is-locked` with a lock when `isLevelPlayable` is false,
`.is-next` (Continue's level: a larger green disc with Nubs on top), `.is-perfect` at 3 stars. A
playable tile calls `startRun('campaign', undefined, id)`; a locked one toasts "Finish Level N
first.". Arrow keys follow the screen (`journeyStep`): along the visual row, straight up and down. Every visit centers the level
in play, and the stars and unlocks earned since the last visit pop in (`.is-fresh` stars one after
another, `.is-unlocked` tiles, with the stamp or unlock sound). `setSave` and the Settings toggle
re-render the tiles in place (focus survives).

**Elementals** (docs/ELEMENTALS.md §4.10; `'elementals'`, `screens/elementals.ts`,
`styles/elementals.css`). The Title square `.elementals-btn` (art icon `elementals`, aria-label
"Elementals") sits in the top bar just before the wallet. It is hidden on a fresh save and until
Endless opens, and it wears the NEW sticker until the screen is first opened
(`markElementalsSeen`). When the Rank name would be cut, the bar tightens (`.title-hud.is-tight`,
measured in `fit()`), so 360x640, 390x844 and 1280x800 keep every item whole. The screen rebuilds
from the save on every refresh. It has a header with the Trial stars `n/24`, then the stage (the
Wardrobe's stage recipe). The stage holds the selected Trial's featured hero (a duo shows both) on
`renderHeroPreview` canvases, its name and element, tagline, ability with its glyph, the three
rules as tags, and the primary **Play** "Play T3 · Thunder Alley". Below the stage sit the five
heroes as round candy coins (`.hero-tile[data-hero]`, `aria-pressed`). A locked hero is a
silhouette with a lock coin and "Pass Kindling" (its intro Trial). Picking a hero frames its
Trials in gold (`.is-hl`). Then come the eight Trials, two columns of Wardrobe tiles
(`.trial-tile[data-trial]`). Each tile shows its `levelShort` disc, name, three stars and the cast
as lettered faces ('▸' a relay, '+' a duo), and carries `.is-locked`, `.is-done`, `.is-next`
(selected) and `aria-disabled`. An open tile starts its Trial
(`startRun('campaign', undefined, 1000 + n)`). A locked one toasts "Pass Kindling first.". Arrow
keys walk the grid. Trials and heroes opened since the last visit pop open (`.is-unlocked`), with
"Ember joins the team!" and the unlock sound. `show('elementals', id)` selects that Trial (Results >
Map and Back after a Trial). A Trial's Results print `levelTag` ("Trial 3"), hide the star road
and lead Map/Back here; its Pause card adds the hero's tagline under the title.

**Records** (the Profile's, v1.4; the v1.1 Journal's until then): bests (endless and Daily), the
last 30 endless runs as bars (height ∝ score, colour by the day reached, the best in gold, runs on
eased rules hatched, an sr-only summary), the last-10 average and its change against the 10 before,
and lifetime totals. The Title's Best chip ("Profile, best …") opens them. Bests are kept per rules (fix round 2):
"Best run" is the standard-rules best (`stats.bestMinutes`: endless runs at R4, challenges); runs
on eased rules (the first three, comfort rungs R1-R3, the warm-up; never the tutorial run, whose
Chill floor no comfort rung can match) keep `stats.easedBest`,
shown as "Eased: …" while it is ahead. The Title's Best chip shows the best of the rules the next
run is played at (`nextRunEased`): the eased best with its day badge hatched ("Profile, eased best
…"), else the standard one (either falls back to the other while empty). Results: a best at eased
rules is "New eased best" (`outcome.bestEased`); the pace line compares with runs at the same rules
and a "Below your usual" line (`outcome.paceDown`) is set in plain ink, not the accent.

## 4. `UiCallbacks` reference

| Callback | When / what to do |
|---|---|
| `startRun(kind, date?, level?)` | `'endless'` (the Title's Endless button), `'challenge'` (the banner's Play, or Space/Enter while the banner is up), `'daily'` with the date the Daily screen showed (it checks that date is still today at press time; if not, it refreshes to today with a toast and doesn't start), `'campaign'` with the level id from the Title's Play (Space/Enter), a Journey tile or Continue. Start the run (daily: `dailySeed(date ?? localDate())`, profile 3; challenge: its seed or date, profile 3; campaign: `levelDef(level)`, CAMPAIGN_PLAN §4). UI is on `play`. |
| `nextLevel()` | Results > Next level after a passed Journey level: start `view.campaign.nextId`. UI is on `play`. After a Trial, `nextId` is the next open Trial (`nextOpenTrial`); with none the session shows `elementals`. |
| `openJourney(to?)` | The Title's map button, and Results > Map (or Back) after a Journey level: leave the run for the Title scene behind the map (the map is opaque). UI is on `journey`. After a Trial `to` is `'elementals'` and the UI is on `elementals`. |
| `retry()` | New run, started at once (the core's 0.8 s start beat then gives the player time to aim before Nubs walks). |
| `home()` | Abandon/leave to the Title scene. Don't trap back-navigation any more. |
| `pause()` / `resume()` | Freeze/unfreeze the loop. In `resume`, call `ensureAudio()` synchronously (iOS). |
| `restart()` | Abandon this run, start a new one. |
| `skipDying()` | Jump to Results now: `ui.show('results', view)`. |
| `share()` | `buildShare(result, shareBase(), dailyTry, { name: settings.name, par })` then `shareText({ text })` (text and link; desktop copies). The UI toasts "Copied!" / failure. |
| `sharePostcard()` | The Postcard pill: `shareFiles({ file, text })` called synchronously in the click task; `'saved'` toasts "Postcard saved · link copied". Optional until gameRender's postcard lands (the pill hides without it). |
| `swapMission(slotId)` | Swap on a stale mission (Missions card or Results row): `swapMission(save, slotId)`, `store.set`, `ui.setSave`. |
| `settingsChanged(settings)` | Full new `Settings` (already clamped by the controls). Persist (`store.update`), apply volumes, sensitivity, invert, guide, high contrast. Reduced motion is applied to the DOM by the UI, which also keeps the new settings in its own copy of the save (so the Journey's "Unlock all levels (testing)" toggle refreshes the map at once, before `setSave`). |
| `buy(id)` | `buyCosmetic(save, id)`; on success `store.set(save)`, `ui.setSave(save)`, return true. |
| `equip(id)` | `equipCosmetic(save, id)`; `store.set`, `ui.setSave`. |
| `exportBackup()` | `exportBackup(store.get())`. The UI copies it and shows it in a box. |
| `importBackup(code)` | `importBackup(code)`; on success `store.set(save); store.flush(); ui.setSave(save)` and return `{ ok: true }`, else `{ ok: false, message: backupErrorMessage(error) }`. Return `{ ok: false, message: 'A newer version of SHADY saved progress here. Update the game first.' }` while `!store.canPersist`. The UI confirms before calling and toasts the outcome. |
| `resetProgress()` | Returns `ImportOutcome`: `resetProgress(save)`; `store.set`, `store.flush`, `ui.setSave`, `{ ok: true }`; the same newer-version message while `!store.canPersist`. The UI confirms before calling and toasts "Progress reset. Fresh snow!" or the message. Settings opened from Pause hides the Progress card (backup, restore, reset; one line points to the Title's Settings). |
| `dismissChallenge()` | Forget the challenge and clear `#c=` (`history.replaceState`). |
| `dragHandoff(e)` | A press that began on a Title tray button slid sideways > 10 px: start the run with catch semantics at `e.clientX/Y` and follow `e.pointerId` (listen on `window`; the button released capture). |
| `uiSound(name)` | `'tap' 'back' 'toggle' 'slide' 'buy' 'equip' 'deny' 'stamp' 'unlock' 'count'`. Map to the GDD "UI tap" recipe (or richer ones) plus the 4 ms UI haptic. |
| `renderHeroPreview(canvas, hero)` | The Elementals stage and hero coins: draw `hero` (a `HeroId`) on `canvas`; the screen sizes the backing store (CSS × DPR ≤ 2) and greys a locked hero's pixels itself. Until ART's `renderHeroPreview` lands, the session draws Nubs in his outfit (`renderWardrobePreview(…, 'nubs')`, §4.11). |
| `renderWardrobePreview(canvas, equipped, subject)` | Draw Nubs wearing `equipped` (`subject` 'nubs'), or the sun in `equipped.shades` on the Shades tab ('sun'); use `equippedLooks(equipped)`. The backing store is CSS size × DPR (≤ 2). Called on every try-on or tab change. |

## 5. Meta API (pure unless noted)

- `meta/save.ts` (save **v3**: v2 plus `campaign: { stars[200] 0..3, unlocked, lastLevel }` and
  `settings.unlockAll`; v1 → v2 → v3 migrate in a chain, v2 → v3 fills a fresh Journey; `sanitize`
  clamps the stars and keeps `unlocked` past every passed level; `emptyCampaign()`,
  `CAMPAIGN_LEVEL_COUNT`, `STARS_PER_LEVEL`): `defaults()`, `migrate(raw) -> { save, status }`
  (`fresh|ok|corrupt|future`), `sanitizeSettings`, `pruneDaily`, `cloneSave`, and **`SaveStore`**
  (side effects):
  `new SaveStore(createStorage())`, `.status` (`fresh|ok|recovered|corrupt|future`), `.degraded`,
  `.get()`, `.set(save)`, `.update(fn)`, `.flush()`, `.subscribe(fn)`. Writes are debounced 300 ms;
  call `flush()` on `onPageHidden` and at run end. A newer-version save is copied to
  `SAVE_FUTURE_KEY` (`shady.save.future`) and never overwritten; repaired/corrupt raw data is kept in
  `SAVE_BAK_KEY` (`shady.save.bak`); an unreadable main save is recovered from `.bak` when possible.
  - `.canPersist`: false while a newer version's save is on disk (the store then never writes;
    refuse reset and restore with the newer-version message).
  - `elementals?: { stars[8] 0..3, seen }` (docs/ELEMENTALS.md §4.10) is optional: `sanitize` emits it
    only when the raw save has it (`defaults()` has none), merges take the larger stars per Trial
    and `seen` from either side, and a side without it (a build from before the Elementals) never
    deletes it. A tab of such a build writing over it is merged rather than adopted, so the Trials
    survive. The v3 → v4 upgrade (`upgradeToV4`) of a save with progress writes it
    with `seen: true`, so that first visit marks nothing new. (A lone older build, with no newer tab open, still drops the field when it writes.)
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
    Welcome back, sunny days, missions with staleness, achievements, and the v1.4 XP, rank,
    globes and feature unlocks (`outcome.gamify`, gamify.ts awardRun). `outcome` adds `bonusSnow`,
    `pace`, `recentBestBefore`, `comfortAfter`.
  - Journey runs (`result.mode === 'campaign'` with `result.level`): the wallet gets the run's Snow
    plus a first-pass bonus of `id × 2` (an award chip "First pass +24"), `campaign.stars[id-1]`
    keeps the best, a pass sets `unlocked = max(unlocked, id + 1)`, `lastLevel = id`; missions,
    achievements and the daily bonuses count as for endless; the history, comfort ladder and bests
    are never touched. `outcome.campaign = { passed, stars, newStars, unlockedNext }`. Achievements
    `journey-10` (levels 1-10 passed), `journey-100`, `three-star-20` carry no items; the **star
    rewards** `stars-25|75|150|300|600` (achievements with `stars`) grant the Starry Scarf, Night
    Beanie, Golden Carrot, Galaxy Shades and Star Crown. `nextStarGoal(save) -> { stars, from,
    target, name, item } | null` names the next one (the Title's goal line, the map, Results).
    `isLevelPlayable(save, id)` (`id ≤ unlocked || settings.unlockAll`), `totalStars`,
    `continueLevel` (the highest unlocked level, the last once all are passed), `CAMPAIGN_STARS_MAX`.
  - Elementals Trials (`result.level.id` 1001..1008, docs/ELEMENTALS.md §4.10): `elementals.stars[n-1]`
    keeps the best (the field is created on the first star), the first pass pays +20 Snow ("First
    pass +20"), each Trial it opens toasts "New trial: Day Shift", and XP comes through `awardRun`.
    The Journey (stars, unlocked, misses, `lastLevel`, n/600, Continue), missions, achievements and
    trophies are never touched. Helpers: `trialOpen(save, n)` (every `requires` passed, or
    `unlockAll`), `heroUnlocked(save, hero)` (its intro Trial passed; Nubs always), `nextOpenTrial(save,
    n)`, `trialBest`, `elementalStars` (of `ELEMENTAL_STARS_MAX` 24), `markElementalsSeen`;
    `resetProgress` zeroes the field when the save has it (so a merge cannot bring Trials back).
  - `swapMission`, `recentBest` (tutorial runs ignored), `MILESTONES`, `nextMilestone`, `nextGoal`
    (the Title tagline from run 3: a nearly done mission, a fresh Daily, the next star reward once the
    Journey has begun, the next milestone), `welcomeBackDue` (the launch toast), `setDailyPar`.
  - `dailyTryStarted(save, date) -> { save, tryNumber | null }` when a daily run passes 6:30 AM;
    then `store.set(save); store.flush()` immediately. `null` = practice (unscored).
  - `dailyProgress(save, date, minutes, snow, strip?)` every in-game hour of a scored daily run
    (then flush). Pass `strip = { hourGlyphs, assisted }` so a new best also stores the run's glyph
    strip in the format `applyRunResult` uses.
  - `dailyStatus`, `isDailyUnlocked` (after 3 completed runs, or once any Daily was played),
    `activeMissionViews`, `itemState`, `buyCosmetic`, `equipCosmetic`, `resetProgress`,
    `shouldShowInstallSheet` (not in in-app browsers), `shouldOfferRestoreSheet`.
- `meta/content.ts`: `COSMETICS` (29 in 4 slots, Sun Shades included, with `look` render params),
  `equippedLooks`, `MISSIONS` (with skill gates), `ACHIEVEMENTS` (24), lookups.
- `meta/week.ts`: `markSunnyDay`, `mondayOf`, `weekFor` (local date strings; DST never matters).
- `meta/daily.ts`: `localDate()`, `dailyNumber(date)` (#284 = 2026-10-11), `dailySeed(date)`,
  `recentDates`, `formatDateLabel`, `addDays`, `isDateString`.
- `meta/share.ts`: `buildShare(result, baseUrl | null, tryNumber, { name?, par?, plan? }) -> { text,
  url | null, challenge | null }` (forecast emojis on Day Plan runs, "Beat Sam's run", Snowbot's par
  on Dailies; a Journey level shares `SHADY Journey · Level 12 ★★☆ · Glass Garden` (a Trial `SHADY
  Elementals · Trial 3 ★★☆ · Thunder Alley`) plus the plain
  game link, `challenge` null, `campaignShareText`, `starText`), `shareBase()`, the pure
  `resolveShareBase()`, glyph helpers. `platform/share.ts`:
  `shareText`, `shareFiles({ file, text })` ('saved' = downloaded and copied), `copyText`.
- `meta/challenge.ts`: `encodeChallenge` (keys v, k, seed|d, m, s, p, dr, nc, pl, n), `decodeChallenge`
  (a v1.0 code decodes to the v1.0 world; invalid optional fields are dropped), `sanitizeName`,
  `challengeFromHash(location.hash)`, `challengeUrl(base, c)` = `${base}#c=${code}`.
- `meta/backup.ts`: `exportBackup`, `importBackup`, `backupErrorMessage`.

Endless rules come from the comfort rung (`stats.comfort`, core `rungConfig`); Daily and challenge
runs use their own rules; Journey levels come from `levelDef(id)` (core, CAMPAIGN_PLAN §2), Trials
from `trialLevel(id)` (core, docs/ELEMENTALS.md §3). Wherever a level is named, `levelTag(id)` prints
"Level 12" or "Trial 3".

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

**Visual system (v2 "Candy", the binding spec is `docs/UI_V2.md`).** Every screen reads as a
casual game: glossy candy controls with an ink outline and a pressable lip, Lilita One with an ink
halo for display text, ribbon banners, framed panels, embossed counters, medals and star bursts.

**Stylesheets** (imported by `ui.ts` in cascade order; each has one owner, §14 of the spec):

| File | Holds |
|---|---|
| `kit.css` | The tokens on `.sui` (ink `#2A1B45`, cream, the candy faces `--{green,blue,gold,pink,violet,red,cloud,ice,locked}-{hi,,lo,lip}`, slots, accent text `--t-*`, tints, the warm sky, scrims, drops, radii, the type scale `--fs-d-*` / `--fs-*`, motion) and every shared recipe: `.btn` (+ `--primary/--blue/--violet/--pink/--gold/--danger/--plain`, `--sm/--lg/--xl`, `--sq`, `--round`), `.candy`, `.f-*` face classes, `.panel`/`.card`/`.dialog` (+ `--gold/--violet/…`), `.plate`, `.well`, `.ribbon`, `.counter` (`.chip--snow`, `.chip--stars`), `.medal`, `.chip` (+ `--dark`, `--btn`), `.tag`, `.sticker`, `.lock-badge`, `.bar` (+ tones, `--sm`, `.bar-label`, `.bar-gain`), `.tabs`/`.tab`, `.seg`, `.switch`, `.range`, fields, `.toast`, dialogs and sheets, `.node` (level disc), the menu sky, `.burst`, and the high-contrast rules. Legacy v1.4 token names are aliases there until no rule uses them. `.f-ice` (with `--ice-lip`) is the Elementals' Nubs face. A recipe variant the spec lists but no screen uses (`.panel--red`, `.panel--cloud`, `.ribbon--violet`, `.bar--blue`, `.reward--chip`, `.node.is-current`, `.rows`) is left out until one does, to hold the size budget. |
| `ui.css` | The shared layout: the root and its world-column insets, resets, screens, menus and headers, dialogs, toasts, modals, the rotate overlay. |
| `styles/<screen>.css` | One file per screen (title, play, pause, dying, results, settings, daily, missions, wardrobe, profile, journey, elementals); they compose the kit and never copy it. |
| `a11y.css` | Reduced motion, desktop hover and forced colours, imported last. |
| `gamify.css` | Imported by `gamify.ts`: the rank badge, XP meter, claim bubbles and the reward reveal (the streak card, the Profile and the Missions globe row are styled by `styles/missions.css` and `styles/profile.css`). |

**Rules of the look.** One ink for every outline, halo and hard drop (no grey borders, no blur-only
shadows; one soft shadow on panels and modals). Display text is Lilita One (`--font-display`,
weight 400, `font-synthesis: none`) in white with `-webkit-text-stroke: var(--halo) var(--ink)` and
`paint-order: stroke fill`, never under 15 px; smaller text passes 4.5:1 by its fill alone.
Sentences stay in the system font (`--font-body`) at 700-800. Colour means role: green go, blue
navigate, violet Endless/XP, pink share/dares, gold rewards, red danger and titles, cloud neutral;
one saturated hero per screen. Components write `box-shadow: var(--sh)` so press and focus extend
the stack; only `transform` and `opacity` animate; no CSS `filter`, no `backdrop-filter`.

**Widgets** (`widgets.ts`): `button()` (variants, sizes, `round`/`square`; coloured faces take the
art icon of the same name, cloud faces the ink line icon), `buttonIcon()`, `ribbon(text, { tone,
size, tag })` (returns the wrapper and the band, which is the heading), `menuHeader()` (blue back
coin + red ribbon), `section()` (a framed panel with an ink title), `medal()`, `progressBar(fraction,
className, tone)`, `snowChip()` (the wallet counter), `setCount()` (a counter's min-width in `ch`:
Lilita has no tabular figures), `toggleSwitch()` (ON/OFF are generated content), `segmented()`,
`slider()`, `countUp()`, `emptyState()`, `starRoad()`. `art-icons.ts` holds the illustrated
48 × 48 icons (`artIcon(name)`, a sprite of `<symbol>`s injected once into `#ui`, each with a baked
2 px ink drop) and the kit shapes (`kitShape('tail' | 'burst')`).

**Font** (`fonts.ts`): Lilita One's latin woff2 imported with `?inline` (a data URL in every build:
the PWA precaches it with the JS chunk, `build:single` inlines it with the script) and loaded with
`FontFace` (`display: swap`); `fontsReady` resolves once it is usable. The boot splash waits for it
up to 300 ms; the current screen re-lays out when it arrives; the UI lab waits for it. Glyphs the
subset lacks (★ ≤ ← → ↑ ↓ ✓, emoji) sit in a `.glyph` span in the body font. The canvas mirrors
the palette and draws outlined text and candy shapes with `src/render/candy.ts` (`displayFont`,
`outlined`, `candyRect`, `plate`, `slot`, `coin`, `burst`, `drawStar`/`starSprite`,
`onDisplayFont` + `fontGen` for its caches).

**Accessibility.** Every pressable visual is ≥ 48 × 48 (chips and the switch keep a pseudo hit
box). Focus is an ink | white | ink ring (`outline` + a 9 px ink spread in `--sh`) that reads on
sky, cream and the world. `.is-hc` (the "High-contrast shadows" setting or `prefers-contrast:
more`) turns faces flat, drops gloss, rays and clouds and thickens outlines; `.no-po` (Chromium
< 123, which ignores `paint-order` on HTML text) thins the halo. Reduced motion (`.is-rm`: the
setting, or the OS preference on "auto") makes transitions opacity-only, stops keyframes and
presses without moving. Forced colours drop halos and decoration and keep real borders and
`Highlight` states. Layout uses `--safe-top|right|bottom|left` through the world-column insets;
a screen that is not shown skips style, layout and paint (`content-visibility: hidden` until
`go()` gives it `is-in`, which it keeps through its fade and slide-outs, 400 ms), so boot and every
switch restyle the screen shown and not all eleven; a screen measures only while it has `is-in`
(Results' `measure()`, the Title's `fit()`), and its first show styles it once hidden so its
transitions start there. Journey boards off screen skip the same way (`content-visibility: auto`,
296 px). The page pans but never zooms (`touch-action: pan-x pan-y`, iOS `gesturestart`
prevented); the canvas and the tray keep `none`.

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

## 10. Credits

The display face is **Lilita One** © 2011 Juan Montoreano, under the SIL Open Font License 1.1
(`src/ui/fonts/LICENSE-LilitaOne.txt`), shipped unmodified as Google Fonts' latin subset
(`src/ui/fonts/lilita-one-latin.woff2`). Settings shows the credit under the version line.
