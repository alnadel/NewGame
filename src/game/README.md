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
| `game/campaign.ts` | Campaign (Journey, v1.2) runs: a level's run config, the intro card's words and star rules, the Results goal line, the HUD goal pill and the stars so far (`starState`: the HUD pips and the Pause card) (CAMPAIGN_PLAN §4). |
| `game/moments.ts` | v1.4 in-run moments: mission toasts ("MISSION ✓ 2/3", the save's active missions measured against the live run every 0.1 s, read-only on the save; scored runs only), the first three Journey levels' contextual tips (`LEVEL_TIPS`, shown until the level is passed), and the COMEBACK (Chill under the PHEW line while lit, then 0.75 s of held shade, no PHEW on the way in; once per dip). |
| `render/renderer.ts` | Draw order and the per-frame render state (`RenderScene`). |
| `render/*` | palette LUT, ground/trail/footprints, shadow layer, casters (+ night window glow), clouds, pickups and glare, Nubs (+ Wardrobe preview), halo dial (+ the frozen dial of the Melt Map), sun mascot with its Sun Shades (+ the Wardrobe's sun preview), HUD, banners/vignettes/stamps, particles, Melt Map, sprites; v1.1 adds `atmosphere.ts` (one small offscreen sky/vignette canvas, A12), `decor.ts` (decals, puddles, the biome signpost), `deathbeat.ts` (grey-out and hat pop), `friend.ts` (the challenger's puddle), `glyphs.ts` (every forecast, biome and concept glyph and the ground decals, stored as SVG path ops: `drawGlyph(id)`, `artOps`/`drawArt`) and `postcard.ts`. |

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

### In-run UX (v1.4)

- **HUD**: on a level three star pips replace the clock (gold earned, white still open, grey a lost
  cool run; a pip that lights pops and chimes `claim`), the goal count turns teal when met; the
  multiplier badge warms with every level and fills a charge bar over its 4 s of shade.
- **Intro card**: the goal pill, then the three star rules as icons ("Finish", "6 flakes",
  "≤ 4 s in sun").
- **Toasts** (`banners.ts showToast`): a card under the HUD band, clear of the pause column, never
  over Nubs or his dial; they wait while a card or stamp holds the top. A mission goes ahead of a
  waiting tip (and a tip shown 1.5 s steps aside), a new tip replaces a waiting one, the run's end
  drops the queue.
- **Pause**: `UiCallbacks.runStatus()` (and the test hook's `runStatus()`) gives the Pause card the
  run's title, goal (with its count or progress), the time reached and, on a level, the star rules
  with their state so far.
- **Reward cues**: `uiSound` plays `reward`, `rankUp`, `open` and `claim` with the haptic of the
  same name, and `tick` with a 6 ms tick at most every 90 ms.

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
- **Other tabs**: the store merges a save another tab or instance wrote with this one's (meta
  `SaveStore`, `saveMerge.ts`) and the session adopts the result (`ui.setSave`, settings, and between
  runs the run count and the held run), surfaces the first failed write, writes buys and equips at
  once, and refuses reset and restore while a newer version's save sits on disk.
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
- **Cue line**: event cues (`keep-shade` at go, `shade-found`, the first `swing`, the timed
  `melting` of runs 1-2) show once per run and keep the line while they last. Inside the lesson the
  line is live (`lessonCue`): "Drag ←/→" follows the ghost hint's side as it changes, "Melting!"
  (same arrow) shows only while Nubs is lit with Chill low after the run's first `lowChill`, and
  "Keep Nubs in the shade" replaces any arrowed cue once the hint rests in shade; a pause clears it
  and it comes back on resume.

## v1.2: the campaign (Journey)

See CAMPAIGN_PLAN §4 for the contract; the core names (`CONCEPTS`, `levelDef`, `levelProgress`,
`campaignConfig`, the `levelWon` event, phase `'won'`) come from `core/index.ts`.

- **Runs**: `startRun('campaign', _, level)` builds `campaignConfig(level)` (the level's seed, profile
  3, no tutorial chunk, no Day Plan, its concepts as `mods`, drain, start time, biome and forecast;
  the lesson on level 1 until it is passed) and holds it on the intro card until the first press.
  `?level=N` opens a level this way at boot (a normal run unless other debug params are present).
  Retry and Pause > Restart replay the level at once (no intro card); `nextLevel()` starts the next one on its card;
  `openJourney()` leaves the run like Home and shows the Journey map. Campaign runs never use the
  comfort ladder, bests or the endless history; `?bot=` autoplay goes on to the next level.
- **Intro card** (`render/banners.ts` `showLevelCard`): "LEVEL 6", the name, the concept's glyph,
  short name and blurb (wrapped, ≤ 3 lines), the goal pill and a breathing "tap or drag to start";
  it slides in (0.32 s), holds through `hold` and slides out (0.3 s) on `start`.
- **HUD** (`render/hud.ts` `HudCampaign`): the badge reads `L6`, the ruler is a teal progress bar to a
  checkered finish flag with the gate or eclipse marker at the midpoint, the Snow pill counts
  `flakes/target` or `snow/target` on goal levels, the clock stays, and a wind mark rides the
  progress head during a gust.
- **Finish**: on `levelWon` the session builds the result (the core fills `result.level` and
  `stats.minChill`), fx
  stamps `FINISH` (a checkered plate whose earned stars pop in under it one by one, 64 confetti,
  a gold ring and sparkles, a 60 ms hit-stop, a hop and a zoom pulse) or the rose miss line
  ("NOT ENOUGH FLAKES"/"SNOW"), the sim stays frozen in `won` for `FINISH_FREEZE_S` (1 s, effects
  still animate; a tap after `FINISH_SKIP_S` skips the rest), then the Results show with `ResultsView.campaign` (id, name, passed, stars,
  nextId, goalLine, introduces). A melt is the death flow as before.
- **Render signatures** (`renderer.ts`): fog (a cached mist band fades the world out 170-330 u ahead,
  the halo loses its `next` arcs), No Dial (`blind`: the halo's shade arcs and hint are off, the
  pointer and glare stay), eclipse (`s.eclipse` dims the palette toward night with a star field and
  slides a dark disc over the sun mascot), gusts (`P_GUST` streaks fly the way the sun is pushed
  while `s.sun.gust ≠ 0`), Sun Lock (a padlock outside the sun pointer while `s.sun.locked`,
  blinking in 0.6 s before each lock),
  Moonlit (night palette, the sun's own shadows in the moonlight colour, stars, the moon as the sun
  mascot), and the finish line (`casters.ts` `drawFinishArch`: a gate arch as a finish banner with
  a checkered line on the ground, drawn for the core's `kind: 'finish'` caster at `World.finishY`).
- **Chapter looks** (v1.3, `palette.ts` `themeFor(chapter)`): each of the 20 chapters tints the
  biomes' ground and the trail, washes its own grade over the frame (the atmosphere layer, off in
  high contrast) and fills the air with spring petals, winter snow or blown leaves (`fx.ts`, none
  under reduced motion). Endless, Daily and challenge runs keep `PLAIN_THEME`.

## v1.3 game feel

- **Danger at a glance**: while Nubs stands in the sun the halo ring burns hot (`#FF6A3D`) with a
  heartbeat glow, 1.2 Hz at full Chill to 3.4 Hz near empty (steady under reduced motion); a hot
  ring snaps out of the dial when he leaves shade (at most one per 0.6 s); the Chill gauge turns hot
  below 25.
- **Start**: GO! (`POP_GO`), a hop and a puff of snow when the start beat ends.
- **SWING**: a 30 ms hit-stop and a teal ring off the dial, on top of the SWING! pop and swept arc.

## v1.5 core mechanics (game side)

See V1_5_PLAN §3 for the contract; the sim (core) fills it, the game makes it readable.

- **Input** (`input.ts`): a Cold Snap is asked for by a quick swipe down anywhere (≥ 40 px or 5 % of
  the viewport height, ≥ 2.2× more down than sideways, within 450 ms of the press; a press that first
  moves 14 px sideways or upward is a drag for good, so drags and flicks never snap; a press that
  snaps takes back the turn it made and releases at 0 °/s), by Down or S, or by a short tap on the
  frost meter (`hudMeterHit`). `InputFrame.snap` is set on the next tick's first frame, only while
  `canSnap()` (a run in play past its hold and start beat; never the Title, an intro card, a pause or
  a menu). `Input.snaps` counts them (test hook `mech().snaps`).
- **`mechanics.ts`**: fills the renderer's `MechView` every frame from the sim (read defensively):
  the meter shows on a run once its frost first moves, deep shade, the snap's share left, the snap
  cloud to draw (while it lives) and the dial's bud mask (`guide.bud`). `mechanicOf(concept)` finds
  the mechanic a Journey concept teaches by its id, name or title. The test hook's demos `bud`,
  `bloom`, `snapReady`, `snap` and `deep` stage a moment (a bud ahead, its sunflower, a full meter, a
  low snap cloud over Nubs, deep shade) for visual review without changing a rule.
- **Render**: `flora.ts` draws a closed bud (its ground marks with the ground: the gold ±faceTol arc
  with a little sun, a fan of light and the growth ring; the plant in the depth sort) and the
  `'sunflower'` caster kind (a stem with leaves and a head drawn as a disc facing the sun, its face
  or its green back; it pops up on `bloom`). Unknown caster kinds draw their prisms, slabs and discs
  plainly. The dial (`halo.ts`) has gold bud arcs just outside the ring and, in deep shade, an indigo
  ring with three circling frost glints. The HUD's frost meter sits in the world rect's bottom-right
  corner (fills ice-blue; full: a deep-blue plate, a glow, a breathing pulse and a bobbing "swipe
  down" chevron; during a snap the ring drains white). The snap cloud (`clouds.ts`) is frosty, drawn
  over its own shadow so it reads as riding over Nubs, gathers in 0.3 s and melts away at its end;
  snow falls from it (`fx.ts`, `P_SNOWFALL`).
- **Feedback** (`fx.ts`, audio, haptics): budGrow gold motes and a ring tick (sound: a tick climbing
  the scale, ≤ 8/s), bloom (petals, BLOOM!, +Snow, a short hit-stop; a bell run), frostReady (a cool
  ring; a glassy shimmer; the cue line "Frost full! Swipe ↓…" until the player has snapped twice in
  the session), snap (COLD SNAP!, an ice ring and shards, a cool wash; a crack and whoosh that duck
  the score), snapEnd, deepEnter (DEEP at most every 4 s; a low whoom ≤ 1 per 2.5 s).
- **Tips** (`moments.ts`): the level that teaches a mechanic shows its `MECH_TIPS` at their moments
  until passed; a new player's endless and daily runs get one tip per mechanic moment.
- **Meta**: Results tiles for blooms, Cold Snaps and deep shade; missions `blooms-2`, `snaps-2`,
  `deep-8`; trophies Green Thumb, Cold Front, Deep Diver.

## v1.6 priced decisions (game side)

See docs/V1_6_PLAN.md §4 and §9; CORE fills the rules, the game makes them readable. Every layer
reads the sim defensively (`game/mechanics.ts` fills the renderer's `MechView`): absent or zero state
shows nothing new (a run with every v1.6 rule off plays like v1.5), and each `World.v16` kill switch turns its
layer off (`ring` off: no charge ring; `bank` off: one gauge, as in v1.5). v1.6 ships with the
Frost Bank off (`V16_SHIP`, calibration: see src/core/README.md §16.3), so the meter is one gauge
unless a run switches it on; the debug URL parameters `?on=bank,…` and `?off=flares,…` switch rules
over the shipped ones (a debug run), and the e2e of the Bank's layers use `?on=bank`.

- **Flow Ring** (`hud.ts`): the charge runs clockwise round the multiplier badge from its top, the
  pill's own outline dashed on (`ringCharge` over `TUNING.ring.need` of the level; at ×5 the gold
  buffer); hot while the charge falls; a trick flashes it; the run's first trick pops "+RING" and
  losing ×5 to the sun shakes the badge (lower drops are silent; a snap's drop is its pour).
- **Frost Bank** (`hud.ts`): two pips (`frostH` / 100) fill in turn; a full one glows, breathes, pops
  when it fills and takes the tap (the capsule round both pips); `frostSpill` shakes the second.
  During a snap the pips freeze, the first drains white with the snap (`snapTicks` over
  `SNAP_TICKS + snapExt`) and a chip shows `snapBankH` ("+0.3"). `snapCash` pours a stream of frost
  from the badge into the meter; frost gains pop beside Nubs ("+0.3", the run's first "+0.3 snap").
- **Dial layers** (`halo.ts`, §4 priority): the deep band (`guide.deep`, runs ≥ 3°) darker inside the
  lasting teal; the glass layer (`guide.flake`, `glassDecision`) on its own rim at R + 24 (outside
  the sun pointer's rays and 6 px outside the drag arrow, which dims beside it): a twinkling glint
  where the safe teal already saves the flake, else a beaded ice-blue detour arc with the glint
  running along it; during a snap (`guide.land`) a frost band says "covered", the teal on it is the
  shade at the snap's end and the dashed arcs hide; during a flare's warning (`guide.flare`, the
  flare's ticks) twelve white-hot ticks on an orange edge count down at R + 25 (the sun cue's look,
  not the hot ring's solid orange, whose glow rests meanwhile), frost-rimmed teal marks the shade
  that holds (a run under 8° wears a target dot) and the glass layer hides. Text pops rise clear of
  the rims while a warning runs (`RenderScene.popLift`); headlines arriving together take rows.
- **Heat Flares**: the sun mascot's twelve white-hot ticks go out one by one through the warning
  while a white glow gathers (no swell, no flash; reduced motion: the ring only), a steady white-hot
  ring through the rise and hold; PARRY! (an ice stamp), a miss's hot ring; the ruler marks the
  day's kept flares at their rise (white-hot, teal once parried, grey once missed; clear of the
  progress head) and a level's progress bar its flares (3 px ticks, teal once parried, a red ✕ once
  missed; a boss finale's HP is the flares not parried yet). The edge sun steps back to 40 % while
  it sits over the dial. **Noon Heat**: a hot band over 11-1 on the ruler (`noonHeatAt`) with an
  underline below the bar (the progress head, wider than the band, hides it at noon; its ring turns
  hot meanwhile) and a line on the Day card of the day it rises.
- **Glass flakes** (`pickups.ts`): `Pickup.brittle` flakes sit in a pale faceted diamond and melt on
  `TUNING.brittle.meltBudget`. GLASS SAVED! on `clusterSaved`; LANDING! on `snapLand`.
- **Dares** (`campaign.ts`): a level's `feats` (star 2 when it has any, else the flakes star) are
  named on the intro card (a gold "Dare · Bloom 2" pill; a finale's "Bloom 2 or Parry 6"), counted on
  the HUD pill once the goal is met (its glyph instead of the flake; ticks as seconds), on the Pause
  card and in the Results' next-star hint; verb goals ('swings', 'blooms', 'deep'…) count on the pill
  until met. Counts come from the core's `featValue`, or the sim's `feat` events where those run
  ahead. DARE ✓ on `featMet`.
- **Soft-fail**: a level finished with its goal missed counts in the save (`campaign.misses`, meta
  `ApplyRunOptions.goalMiss`); after two, `campaignConfig(…, relaxed)` sets `RunConfig.relaxedGoal`,
  the card, pill and Pause card say "Reach the finish", a tip says so at go and the Results' miss line
  says the next try eases.
- **Tips** (`moments.ts` `MECH_TIPS`): the ring on L2, the Bank and Garden on the Cold Snap's level
  (a pip full, a bud in reach under the snap, the first cash-in), glass and flare levels at their
  first window and at go; a new player's endless runs also get the ring's first drop from ×3,
  the Garden, the cash-in and glass tips, and the flare's 4 s before the first kept flare's warning
  (urgent: it goes ahead of any toast; held to the rise). A stamp or card arriving over a toast on
  screen hides it and holds its clock until it has gone (`Banners.toastHide`).
- **Audio and haptics**: a flare's warning hum and the parry's crack and bells are new; a ring
  trick, the cash-in, a spill, an extension, a landing, glass saved and a miss reuse existing cues
  and patterns (only losing ×5 sounds).
- **Meta**: missions 'mult-3' asks ×4 and 'hold-x5' ×5 (T8).

## Test hook (`?test=1`)

`screen()`, `state()` (`phase, day, minutes, chill, snow, theta, f`, and in v1.1 `profile, rung`
(−1 outside endless), `drain, noonCloud, forecast, biome, lessonOn`, and in v1.2 `level` (−1
outside the campaign), `mods`, `levelProgress` (0..1), `eclipse`, `gust`, `locked`, `moonlit`), `forceDeath()`,
`runHeadless(seed, ticks, bot)`, `setTimeScale(n)`, `audioState()`; for tooling: `paused()`,
`presses()`, `demo(name)` (fx and audio only: `phew`, `mult`, `mult5`, `noon`, `dawn`, `night`,
`cloud`, `glare`, `flake`, `best`, in v1.1 `passed`, `swing`, `highnoon`, `postcard`, and in v1.2
`finish`), `campaign()` (the last Results' `ResultsView.campaign`, or null), `perf()`
(frame, sim, generation and render ms, layer counters, the DPR, `govLevel`, `draws`, and in v1.1
`fullScreenPasses, decals`), `nubsScreen()`, `timeScale()`, `hint()`, `runCfg()`, `cameraFx()`,
`hudPb()`, `renderOptions({ mapOverlay, multiplyShadows, decor })`, `pixelAB(a, b)`,
`mapProbe(mapT)` (whole device pixels of the world rect only), `mapCallouts()` (Melt Map callout
boxes, CSS px), `resultsTip()`, `postcard()` (`{ ready, stageMs, bytes, name }`) and `bot(kind)`
(a core bot plays; unlike `?bot=` the runs stay scored), and in v1.5 `mech()` (the MechView, the
meter's centre and the snaps input asked for) and the demos above. v1.6: `mech()` adds the pips, the
banked chip, the ring (on, fill, bleeding), each dial layer's bins, the flare's phase, share left and
outcomes, Noon Heat and the badge's centre; demos `ring`, `bleed`, `trick`, `pips`, `spill`, `cash`,
`bank`, `land`, `landing`, `deepBand`, `glass`, `flare`, `parry`, `noonHeat` (game/mechanics.ts, with
the core's `debugRing` and `debugFlare`) and, on a level, `dare` and `dares` (one Dare, a finale's two). `demo('noon')` is an alias of
`'highnoon'`, and `demo('postcard')` shares without user activation (the download path).
`forceDeath()` also ends the first-run lesson, whose Chill floor would keep Nubs alive. URL
parameters are in V1_PLAN §14.

Decisions that differ from the GDD or V1_PLAN (the first lesson, the hint's target, the Title sway,
the start beat, Nubs' size, x-ray, heat squiggles, crisp shadows) are listed in V1_PLAN §15.
