# SHADY game and render layers (wave 3)

`src/game` orchestrates a run on top of the deterministic core; `src/render` draws it with Canvas 2D.
`src/main.ts` boots everything (save, audio, haptics, UI, renderer, session, service worker) and
removes the `#boot` splash after the first frame. Any uncaught `error` or `unhandledrejection`
flushes the save (the error still reaches the console); if `boot()` itself throws, the splash is
replaced by "SHADY couldn't start." and a Reload button (`game/crash.ts`).

| File | What it does |
|---|---|
| `game/session.ts` | Owns the `SimState` and the run lifecycle: Title hold → play → dying (1.1 s) → Results → retry/home; pause (visibility, blur, Back), the history sentinel, dailies, challenges, profiles, meta, other tabs' saves, audio/haptics routing, the frame loop and its crash containment. |
| `game/cadence.ts` | The render cadence: which rAFs call `renderer.draw` (pure; unit-tested). |
| `game/compat.ts` | Accessors for the APIs the other wave-3 batches add (`RunConfig.drain`/`endlessDrain`, the SaveStore hooks, `Ui.isModalOpen`, `shareBase`, the `dailyProgress` strip): the real call when present, the old behaviour otherwise. Once every batch is merged each can collapse to a direct call. |
| `game/crash.ts` | The self-contained crash overlay (`#crash`) and the boot-failure splash, built with inline styles. |
| `game/loop.ts` | `FixedClock`: 60 Hz accumulator, max 5 ticks/frame (× `?fast`), slow-mo, hit-stop, the sustained `assist` scale (the first lesson's slow time), interpolation alpha. |
| `game/input.ts` | Pointer Events (+ coalesced) and arrow/A-D keys → per-tick `InputFrame`s (quantized dTheta/release, edge-ignore zones, latest pointer wins, release velocity). |
| `game/camera.ts` | View metrics and letterboxing, Nubs at 68 %/70 %, shake and zoom pulses. Screen-space mapping `sx = ox + x·S`, `sy = oy − (y + 0.25·z)·S`. |
| `game/fx.ts` | SimEvents → particles, rings, pops, HUD/banner timers, Nubs reactions, slow-mo and hit-stop; continuous steam, sweat, frost sparkles and fireflies. |
| `game/assist.ts` | Guide Auto alpha rules (V1_PLAN §6.3), the ghost-thumb hint tracker (§6.2) with its sticky target arc and the first lesson, and the ui.css ghost keyframes as functions (so the canvas moves in step with the DOM hand). |
| `game/perf.ts` | Frame-time governor (crisp shadows → DPR × 0.75 → particles 400 → 200 → DPR × 0.625 → detail tiles off; never below 1 device px per CSS px): late rAF intervals step it down, a steady 28-45 Hz display cadence with light JS work does not; 2 s warm-up after boot/resize; one step back up after 10 s of clean frames. `deviceClass()`: ≤ 4 GB or ≤ 4 cores (not iOS) starts at crisp shadows with DPR capped at 1.5. |
| `game/params.ts`, `game/debug.ts` | URL params, the `?debug=1` overlay, `window.__SHADY_TEST__`. |
| `render/renderer.ts` | Draw order and the per-frame render state (`RenderScene`). |
| `render/*` | palette LUT, ground/trail/footprints, shadow layer, casters, clouds, pickups and glare, Nubs (+ Wardrobe preview), halo dial, sun mascot, HUD, banners/vignettes, particles, Melt Map, sprites. |

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
- **Settled Results** (Melt Map pulled and faded in, no particle, pop, ring or vignette alive,
  the sheet top unchanged): the renderer draws the world and the map overlay once into a canvas-
  sized backdrop, with the world clock frozen; each frame then copies back only the puddle marker's
  box from it and redraws the pulsing ring and carrot there, under the same clips (pixel-identical
  to a full redraw, checked by `resultsAB()`). It is rebuilt after a resize, a DPR or governor step,
  a sheet-top change, a palette change or new confetti. In this container (software compositing,
  390×844 at DPR 2, 1× CPU) the settled Results went from ~33 % to ~15 % of the main thread and from
  ~900 KB/s to ~120 KB/s of JS allocation five seconds in (~40 KB/s once the frame code is
  optimized); at 1280×800 from ~85 % to ~16 %. What is left is the per-rAF session work (~2.5 %),
  the UI's own per-frame style work, and the compositor's commit of the changed canvas (~5 % here),
  which a GPU canvas makes cheap.

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

- **Drain (K2)**: endless runs without `?profile=` or `?bot=` set `cfg.drain =
  endlessDrain(save.stats.runs)` (30, 33, 36 … 55 Chill/s by lifetime run); the prebuilt next run
  and the Title's held run come through the same `runConfig`. Dailies, challenges, `?profile=` and
  bots keep the profile's drain.
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

Draw order: bars → ground + tiles → trail → footprints → pickups → shadow layer (one path, one fill,
multiplied at the LUT alpha) → Nubs' own shadow and footprint disc → glare spots → ground particles,
rings → depth-sorted casters with Nubs (an offscreen sprite) inserted at his y, plus an "x-ray" pass
when something in front overlaps him → heat squiggles → clouds → air particles → Melt Map overlays
→ halo dial → vignettes → text pops → sun mascot → HUD → banners → confetti.

Per-frame cost notes: the ground detail tiles are pre-composited with the ground color into opaque
tiles of a whole number of device pixels (repainted when the ground palette, quantized to 1/64 of the
day, steps: about once a second) and blitted 1:1 at whole-pixel positions, a plain copy instead of a
full-screen fill plus ~8 scaled, blended images; the letterbox fill is skipped when the world fills
the canvas; additive particle glows share one `lighter` switch; the gazing ball reuses its gradient.
The soft shadow layer's full-screen scaled multiply blit is the largest raster item in software
raster, so the governor's first step (and low-end devices from the start) fill the same shadow path
straight onto the world with `multiply` instead (identical colors, crisp edges). In this container
(software raster, 4× CPU throttle, Day 4 noon, 390×844 at DPR 2) that took the rAF interval from
~170 ms to ~140 ms at full quality (`?perf=0`) and from ~130 ms (governor at DPR 0.625) to ~60 ms by
default (crisp shadows, DPR ≤ 1.5); the frame's JS is ~13-17 ms there, mostly caster and Nubs path
work, so a real mid-range phone profile is still the open check. Earlier: the HUD row is an offscreen layer rebuilt only when its text, flags or layout
change (about every 0.7 s), with the moving bits (flake pop, multiplier badge, ruler progress) drawn
from small sprites; Nubs is stamped from two cached layers (back, front) plus live scarf tails, the
layers redrawn only when his size (1/40 Chill steps), look (5° steps), tints or expression change;
building windows, stall posts and footprints are batched into few fills; tree canopies fill cached
unit-space `Path2D` lumps. At Day 4 noon with a 4× CPU throttle this took the frame's JS from
~16.5 ms to ~12.5 ms mean (container without a GPU; raster cost there is still software and dominates
the rAF interval, so a real mid-range phone profile is still the open check).

Wave 3 cache churn (at 4× CPU in this container): a biome's ground tile is built and painted only
when one of its rows is on screen or within one screen ahead, and palette-step or DPR repaints touch
only those tiles, so Day 1 paints the meadow tile alone (first-frame `drawGround` ~100-120 ms → ~33-46
ms). Nubs' cached layers take their shade tint from the quantized night (1/16 steps) instead of the
continuous palette value, so dusk and dawn redraw them ≤ 20 times a second (was 38-58). The Title
keeps the play HUD's row prebuilt for the held run, so the first play frame after a tap doesn't
build it. The first tap's pointerdown handling went from ~70-100 ms to ~1-10 ms: audio builds its
context and graph in a task right after the first pointerdown (see `src/audio/README.md`).

## Test hook (`?test=1`)

`screen()`, `state()` (`phase, day, minutes, chill, snow, theta, f`), `forceDeath()` (Nubs melts on
the next daylight tick; a paused run resumes first), `runHeadless(seed, ticks, bot)`,
`setTimeScale(n)`, `audioState()`; extras for tooling: `paused()`, `presses()`, `demo(name)`
(replays `phew`, `mult`, `mult5`, `noon`, `dawn`, `night`, `cloud`, `glare`, `flake` or `best`
through fx/audio only — the sim is untouched), `perf()` (frame/sim/gen/render ms, Nubs layer redraw
and compose counters, ground tile repaints (one per biome tile painted), the canvas DPR, the
governor level, `draws` (renderer.draw calls so far) and `ringDraws` (settled-Results frames that
only repainted the puddle ring)), `nubsScreen()`, `timeScale()` (slow-mo × lesson × hit-stop),
`hint()` (ghost mode, target arc, way round, lesson on, hints shown), `runCfg()` (the current or
held run's `mode, profile, tutorial, reducedMotion, seed, dailyDate, drain`; drain is `cfg.drain`
or the profile's), `cameraFx()` (`zoom, shakeX, shakeY`), `hudPb()` (the HUD's best flag),
`renderOptions({ resultsCache, mapOverlay })` (A/B switches), `mapProbe(mapT)` (on the Results:
draws the map at `mapT` with and without its overlay and counts the device pixels that differ above
and below the sheet's top), `resultsAB()` (settled Results: the cached frame vs a full redraw at the
same instant) and `bot(kind)` (a core bot plays the runs; unlike `?bot=` they stay scored). `?perf=0` is full quality: no governor and no device-class cap (useful for captures and A/B
timing).

## Deliberate deviations from the docs

- **First lesson** (V1_PLAN §6.2, CRITIQUE first minute): in profiles 0-1, until the save's
  `flags.tutorialDone`, the first hint of a run does not time out: it loops while game time runs at
  0.5× (`clock.assist`, eased) until a swing of ≥ 15° ends with Nubs fully shaded for 0.25 s (then
  `tutorialDone` is saved), its target is gone for 0.5 s, or the sun sets. A shadow that passes over
  an idle Nubs ends it unpassed; it returns the next time he is lit. The sim is untouched (replays and
  bots are unaffected); an idle first-timer now melts after ~10 s instead of ~7 s and a player who
  follows the hint 4 s late still makes it.
- **Hint target and direction**: the hint aims at the widest arc that is safe now *and* 0.6 s ahead
  (gaps ≤ 6° merged), tracked as it drifts, and keeps its first way round while that arc exists and
  the two ways differ by less than 20° of a half-turn (it used to aim at the nearest safe bin, which
  flipped sides on an unchanged sun when the arc sat ~180° away). The direction now honours
  Settings → invert (it ignored it). While a hint plays, the halo shows the target: a glow and a white bracket on the arc, dots
  along the way round, and a ghost sun that glides from the sun pointer into the arc in step with the
  ghost thumb (read from its CSS animation clock, `ui.ghostProgress()`).
- **Title**: the ±25° sway follows the ghost hand's swing (hand right → sun clockwise, or the other
  way with invert) instead of a free 0.3 Hz sine, and Nubs' footprint rim and tint follow the swaying
  sun through the guide's lit counts, so the Title shows drag → sun → shade → cool Nubs.
- **Crisp shadow mode** (V1_PLAN §9 specifies only the soft half-res layer): see the cost notes above.
- **Start beat** (core, `TUNING.start.readyTicks`): every run opens with 0.8 s in which the sun
  answers the finger but the clock, Nubs and Chill wait; Nubs stands until the `go` event, then sets
  off with a little cheer. Retry/Restart start the run on the tap, so without it Nubs walked out of
  the start hut's shade ~0.2 s later while the finger was still lifting off the button.

- **Nubs is drawn at 1.15× the GDD body size** (V1_PLAN says 0.9): at 360 u per screen width the
  compressed sprite was a ~20 px speck. The footprint disc still marks the true test area; its rim is
  drawn at r 13.5 u (not 9) so its per-sample quadrants stay visible around his base.
- **X-ray**: when a caster drawn in front of Nubs overlaps his sprite, he is stamped again at 62 %
  alpha; canopies near him fade to ~0.62 (GDD 0.7).
- **Heat squiggles** above a lit Nubs, in addition to steam (white steam is invisible on noon ground).
- Glare spots are drawn **above** the shadow layer (glare ignores shade, so it should look bright).
- The canvas sun mascot is hidden on the Title (the DOM logo already carries the sun).
- `?reset=1` only works in dev builds (TECH_SPEC §17); a shared link must not wipe a save.
- The in-play ghost-thumb hint sits at 84 % height (`ui.css`), below Nubs and his halo.
