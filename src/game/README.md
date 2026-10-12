# SHADY game and render layers

`src/game` orchestrates a run on top of the deterministic core; `src/render` draws it with Canvas 2D.
`src/main.ts` boots everything (save, audio, haptics, UI, renderer, session, service worker) and
removes the `#boot` splash after the first frame. Any uncaught `error` or `unhandledrejection`
flushes the save (the error still reaches the console); if `boot()` itself throws, the splash is
replaced by "SHADY couldn't start." and a Reload button (`game/crash.ts`).

| File | What it does |
|---|---|
| `game/session.ts` | Owns the `SimState` and the run lifecycle: Title hold → play → dying (1.1 s) → Results → retry/home; pause (visibility, blur, Back), the history sentinel, dailies, challenges, profiles, meta, other tabs' saves, audio/haptics routing, the frame loop and its crash containment. |
| `game/cadence.ts` | The render cadence: which rAFs call `renderer.draw` (pure; unit-tested). |
| `game/crash.ts` | The self-contained crash overlay (`#crash`) and the boot-failure splash, built with inline styles. |
| `game/loop.ts` | `FixedClock`: 60 Hz accumulator, max 5 ticks/frame (× `?fast`), slow-mo, hit-stop, the sustained `assist` scale (the first lesson's slow time), interpolation alpha. |
| `game/input.ts` | Pointer Events (+ coalesced) and arrow/A-D keys → per-tick `InputFrame`s (quantized dTheta/release, edge-ignore zones, latest pointer wins, release velocity). |
| `game/camera.ts` | View metrics and letterboxing, Nubs at 68 %/70 %, shake and zoom pulses. Screen-space mapping `sx = ox + x·S`, `sy = oy − (y + 0.25·z)·S`. |
| `game/fx.ts` | SimEvents → particles, rings, pops, HUD/banner timers, Nubs reactions, slow-mo and hit-stop; continuous steam, sweat, frost sparkles and fireflies. |
| `game/assist.ts` | Guide Auto alpha rules (V1_PLAN §6.3), the ghost-thumb hint tracker (§6.2) with its sticky target arc and the first lesson, and the ui.css ghost keyframes as functions (so the canvas moves in step with the DOM hand). |
| `game/perf.ts` | Frame-time governor, four levels (v1.1 GR4): 0 full → 1 crisp shadows → 2 DPR × 0.75 → 3 DPR × 0.625 and a 200-particle cap (never below 1 device px per CSS px). Late rAF intervals step it down, a steady 28-45 Hz display cadence with light JS work does not; 2 s warm-up after boot/resize; one step back up after 10 s of clean frames. `deviceClass()`: ≤ 4 GB or ≤ 4 cores (not iOS) starts at crisp shadows with DPR capped at 1.5. |
| `game/params.ts`, `game/debug.ts` | URL params, the `?debug=1` overlay, `window.__SHADY_TEST__`. |
| `render/renderer.ts` | Draw order and the per-frame render state (`RenderScene`). |
| `render/*` | palette LUT, ground/trail/footprints, shadow layer, casters (+ night window glow), clouds, pickups and glare, Nubs (+ Wardrobe preview), halo dial (+ the frozen dial of the Melt Map), sun mascot with its Sun Shades (+ the Wardrobe's sun preview), HUD, banners/vignettes/stamps, particles, Melt Map, sprites; v1.1 adds `atmosphere.ts` (one small offscreen sky/vignette canvas, A12), `decor.ts` (decals, puddles, the biome signpost), `deathbeat.ts` (grey-out and hat pop), `friend.ts` (the challenger's puddle), `glyphs.ts` (forecast and biome glyphs) and `postcard.ts`. |

## Frame

1. `FixedClock.advance(real)` → n ticks; `Input.takeFrames(n)` (or the `?bot=` bot per tick).
2. For each tick: `takeSnap(prev)`, `step()`, collect events; then `takeSnap(curr)`.
3. `lerpSnap(prev, curr, alpha)`; route the frame's events to `audio.onEvents`, `haptics.onEvents`
   and `fx.onEvents`; daily try/progress bookkeeping.
4. `generateSome(world, nubs.y + idleAhead, 12)` every frame (idle-time world generation). After an
   endless run ends, the next run's world is built in slices (`prepareRun`/`prepareSome`, 2.5 ms a
   frame, up to a tenth of the frame interval on slow devices) while the death and Results play;
   Retry or Home finishes whatever is left. Nothing is built inside the death tick.
5. Fill the render input; `renderer.draw()` only when the render cadence says so (below), then
   `audio.update(view, realDt)` on every rAF (menus and pause included) and the history-sentinel
   check. Real and game time not handed to a drawn frame carry over to the next one (≤ 0.1 s).

### Render cadence (`cadence.ts`)

Every rAF still steps the sim, generates the world, builds the next run, updates hints, the UI and
audio; only the draw is skipped:

- **Menus** (Settings, Daily, Missions, Wardrobe; `renderScreen` 'menu'): the UI paints an opaque
  background over the world rect, so the canvas is drawn once on entry and again only after a
  resize, a DPR or governor change, or a canvas-affecting setting (high contrast, the equipped
  cosmetics). Nothing animates behind a menu, and the UI never depends on it.
- **Pause**: at most 30 fps. **Title under reduced motion**: at most 10 fps.
- **Play, dying, Results and the Title**: at most 60 fps on fast displays, on a 60 Hz timeline
  (a 90 Hz display gets 60, not 45; 120 Hz draws every other frame), but every rAF while a finger
  or a key is down or the clock runs at another rate than 1 (hit-stop, slow-mo, the lesson's slow
  time).
- The governor samples only drawn frames of play, dying and the Title, with the interval since the
  previous drawn frame, so capped and menu screens never trip it.
- **Settled Results** (v1.1 GR4): once the Melt Map has settled (`renderer.settled`: the pull is
  done and no particle, pop, ring or vignette is alive) the Results draw every 50 ms (≤ 20 fps),
  and each of those frames repaints only the world column above the sheet (the puddle ring still
  pulses there); the bars and the world under the sheet keep the pixels of the frame that settled.
  A resize or a failed draw repaints everything once. Puddles steam only during play, so they never keep the
  Results from settling.

### World rect (K9)

`Session.resize()` publishes the world viewport on `#ui` with every resize and safe-area change,
next to `--nubs-y`, `--halo-r` and `--nubs-clear`: `--world-left`, `--world-top`, `--world-width`
and `--world-height` (whole CSS px: 400/0/480/800 at 1280×800, 0/0/390/844 at 390×844). The UI lays
out every screen, control, sheet, toast and dialog inside it.

### Back, focus and failures

- **History sentinel** (V1_PLAN §8.2): one entry of ours (`history.pushState({ shady: 1 })`) is
  on top exactly while Back has something to do in the game: any screen but boot and the Title, or
  an open modal (confirm dialog, install or restore sheet). It is checked every frame and right
  after UI callbacks; in-app navigation that ends that state takes it back with `history.back()`
  (its own popstate ignored, and no new push until it has come back). On a Back press a modal
  closes first; play pauses; pause stays paused; any other screen takes its back action (menus →
  their parent, Results → Home, dying → skip, Settings → where it was opened from). On the Title
  with nothing open there is no sentinel, so Back leaves the game. A native shell routes its back
  button to the same handler, `Session.handleBack()`: with Capacitor,
  `App.addListener('backButton', …)` calls it, and calls `App.exitApp()` instead when the Title
  shows with no modal open.
- **Blur pause** (V1_PLAN §8.5): losing window focus during play pauses, like hiding the page;
  nothing ever resumes by itself.
- **Crash containment**: the loop schedules its next frame before running this one and catches
  what it throws (logged with `console.error`). A drawn frame that completes resets the count;
  after 30 failing frames in a row (~0.5 s) the save is flushed and `#crash` (role alertdialog,
  "Something went wrong. Your progress is saved." and a 48 px Reload button) covers the game.
  A draw that threw also resets the canvas state and marks every cached layer stale, so a one-off
  failure heals on the next frame and a persistent one keeps failing into the overlay.

### Runs

- **Comfort rungs** (v1.1, V1_1_PLAN GR7 with A2): endless runs without `?profile`, `?bot`,
  `?forecast` or `?rung` take their profile, drain and noon cloud from core `rungConfig(rung)`, with
  rung 0 for lifetime run 0, else `max(1, stats.comfort)` (or 4 with Adaptive comfort off); the
  rung played goes to `applyRunResult`. Dailies use the Daily's rules, challenges the sender's (A1).
- **The held Title run** is the challenge run while a challenge link is open (a canvas press or a
  tray drag starts it, `startRun('challenge')` reuses it, Home brings it back). `refreshTitleRun()`
  rebuilds it, and drops the prebuilt next run, after a reset or restore, another tab's save, a
  change of the effective reduced motion, or a challenge set or dismissed. A `#c=` link opened in
  the same document sets the banner at once, or on the next Home while a run is active.
- **Dailies** run on a given date (default today); Retry replays it. A run counts when its date is
  today and tries were left when it began (`dailyScored`, sent to the Results with `dailyDate`).
  `?mode=daily&date=` and k:'d' challenges accept dates from the epoch to tomorrow only.
- **Midnight**: the session tells the UI about a new local date (`ui.setToday`), checked at most
  once a second and when the page shows again.
- **Markers**: `runAssisted` latches Guide "Always" (set when a run begins with it, or when it is
  switched on mid-run) and becomes `RunResult.assisted` (the share's compass). The HUD's best flag
  is read when a run begins (`runPb`): Daily checkpoints, which save a new best each in-game hour
  (with the run's hour-glyph strip), no longer move it mid-run.
- **Other tabs**: the session adopts a save another tab or instance wrote (`ui.setSave`, settings,
  and between runs the run count and the held run), surfaces the first failed write, writes buys
  and equips at once, and refuses reset and restore while a newer version's save sits on disk.
- **Share links** come from `shareBase()`: the page's address on the web, else `VITE_SHARE_URL`,
  else no link line (a `file:` build never shares a `file:` link).

Draw order: bars → ground + tiles → trail → decals and puddles → footprints → pickups → shadow layer (one path, one fill,
multiplied at the LUT alpha) → Nubs' own shadow and footprint disc → glare spots → ground particles,
rings → depth-sorted casters with Nubs (an offscreen sprite) inserted at his y, plus an "x-ray" pass
when something in front overlaps him → heat squiggles → clouds → air particles → Melt Map overlays
→ halo dial → vignettes → text pops → sun mascot → HUD → banners → confetti.

Per-frame cost notes: ground detail tiles are pre-composited into opaque, whole-device-pixel tiles
(repainted when the quantized ground palette steps, and only for a biome on or near the screen) and
blitted 1:1; the shadow layer is one path and one fill; the governor's first step fills it straight
onto the world (crisp shadows); the HUD row and Nubs are cached layers redrawn only when their
content changes; windows, posts and footprints are batched; audio builds its graph in a task after
the first pointerdown. v1.1 adds one small offscreen atmosphere canvas stretched with a single
`drawImage` (A12, `perf().fullScreenPasses` ≤ 3).

## v1.1 at a glance

See V1_1_PLAN §4.2 for the contracts.

- **Boot**: the Title's held run is created 1100 u ahead (`createRun(cfg, undefined, 1100)`, GR19);
  idle frames build the rest and the first tick completes the hard guarantee, so the world is the
  same. The caster sprite cache (GR3) is not built (STRETCH under A12).
- **Ground** (GR11): `decor.ts` lays out seeded decals per 48 u cell (12 per biome, puddles in 8 %
  of cells, the rare sleeping cat), each ≥ 24 u plus its radius from the trail and ≥ 6 u plus its
  radius from every caster footprint, into a 64-row ring, and blits them from a lazy per-biome
  atlas. Puddles freeze in shade and steam in the sun (one `pointLitWeight` test per frame, round
  robin; no effects from governor level 2). Decals fade out below 0.5 CSS px per u and are skipped
  below 0.3, so a long run's Melt Map isn't ~2,000 blits a frame. Each biome tile has its own ground
  colour; the boundary row fades the next biome in over 64 u with a signpost and two lamp posts.
- **Death beat** (GR12): `CameraFx.holdZoom` eases to 1.18 between 80 and 600 ms and holds into the
  Melt Map pull (none under reduced motion). One 'saturation' pass greys the world outside a ring
  around the puddle, only at governor level 0 and DPR ≤ 2 (A12), fading out over the pull; the hat
  (or scarf knot) pops off. The recap tip is core `deathTip(deathRecap(s), invert, save.stats.runs)`
  read on the death tick into `ResultsView.tip` (the run count rotates its wording). Melt Map callouts flip sides when they would overlap.
- **Postcard** (GR14, A11): starts on the first drawn frame of settled Results and runs one stage
  per idle callback (`requestIdleCallback` with a 400 ms timeout, else `setTimeout` 16): crop,
  header, tiles and footer, then `toBlob`. Debug runs get none; the object URL is revoked when the
  next run begins. The Postcard pill calls `shareFiles({ file, text })` synchronously in the click
  (the text alone until the file is ready); Share stays text and link. Both texts carry the
  player's name, Snowbot's par on a Daily and the world's Day Plan.
- **Daily par** (GR15): `createParJob(dailySeed(today), today ≥ PLAN_START_DATE)` steps on the
  non-play screens (not play, pause, dying or boot), 6 ticks a step for at most 3 ms a frame. It
  skips when the store can't persist, the Daily is locked or today's par exists, restarts on a new
  local date, and stores the minutes with meta `setDailyPar`.
- **Night** (GR16): moon shadows reuse the shadow layer and its pass slot; window light pools
  south of lit faces (≤ 12), a moonlight rim under Nubs, frost-flower halos, a steady pool of 14
  fireflies; glows are off from governor level 2.
- **Title sundial** (GR17): each drawn Title frame sets `--lsx`/`--lsy` on the document element
  when they move 0.25 px: (−cos θ, +sin θ) · 6 px · (1 + 0.6 · (1 − elevation)).
- New SimEvents (`swing`, `lessonDone`) drive fx, haptics and the cue line; audio ignores them.

## Test hook (`?test=1`)

`screen()`, `state()` (`phase, day, minutes, chill, snow, theta, f`, and in v1.1 `profile, rung`
(−1 outside endless), `drain, noonCloud, forecast, biome, lessonOn`), `forceDeath()`,
`runHeadless(seed, ticks, bot)`, `setTimeScale(n)`, `audioState()`; for tooling: `paused()`,
`presses()`, `demo(name)` (fx and audio only: `phew`, `mult`, `mult5`, `noon`, `dawn`, `night`,
`cloud`, `glare`, `flake`, `best`, and in v1.1 `passed`, `swing`, `highnoon`, `postcard`), `perf()`
(frame, sim, generation and render ms, layer counters, the DPR, `govLevel`, `draws`, and in v1.1
`fullScreenPasses, decals`), `nubsScreen()`, `timeScale()`, `hint()`, `runCfg()`, `cameraFx()`,
`hudPb()`, `renderOptions({ mapOverlay, multiplyShadows, decor })`, `pixelAB(a, b)`,
`mapProbe(mapT)` (whole device pixels of the world rect only), `mapCallouts()` (Melt Map callout
boxes, CSS px), `resultsTip()`, `postcard()` (`{ ready, stageMs, bytes, name }`) and `bot(kind)`
(a core bot plays; unlike `?bot=` the runs stay scored). `demo('noon')` is an alias of
`'highnoon'`, and `demo('postcard')` shares without user activation (the download path).
`forceDeath()` also ends the first-run lesson, whose Chill floor would keep Nubs alive. URL
parameters are in V1_PLAN §14.

Decisions that differ from the GDD or V1_PLAN (the first lesson, the hint's target, the Title sway,
the start beat, Nubs' size, x-ray, heat squiggles, crisp shadows) are listed in V1_PLAN §15.
