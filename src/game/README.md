# SHADY game and render layers (wave 2)

`src/game` orchestrates a run on top of the deterministic core; `src/render` draws it with Canvas 2D.
`src/main.ts` boots everything (save, audio, haptics, UI, renderer, session, service worker) and
removes the `#boot` splash after the first frame.

| File | What it does |
|---|---|
| `game/session.ts` | Owns the `SimState` and the run lifecycle: Title hold → play → dying (1.1 s) → Results → retry/home; pause, visibility, the Back trap, dailies, challenges, profiles, meta, audio/haptics routing, the frame loop. |
| `game/loop.ts` | `FixedClock`: 60 Hz accumulator, max 5 ticks/frame (× `?fast`), slow-mo, hit-stop, interpolation alpha. |
| `game/input.ts` | Pointer Events (+ coalesced) and arrow/A-D keys → per-tick `InputFrame`s (quantized dTheta/release, edge-ignore zones, latest pointer wins, release velocity). |
| `game/camera.ts` | View metrics and letterboxing, Nubs at 68 %/70 %, shake and zoom pulses. Screen-space mapping `sx = ox + x·S`, `sy = oy − (y + 0.25·z)·S`. |
| `game/fx.ts` | SimEvents → particles, rings, pops, HUD/banner timers, Nubs reactions, slow-mo and hit-stop; continuous steam, sweat, frost sparkles and fireflies. |
| `game/assist.ts` | Guide Auto alpha rules (V1_PLAN §6.3) and the ghost-thumb hint tracker (§6.2). |
| `game/perf.ts` | Frame-time governor (DPR 1 → 0.75 → 0.625, particles 400 → 200, detail tiles off). |
| `game/params.ts`, `game/debug.ts` | URL params, the `?debug=1` overlay, `window.__SHADY_TEST__`. |
| `render/renderer.ts` | Draw order and the per-frame render state (`RenderScene`). |
| `render/*` | palette LUT, ground/trail/footprints, shadow layer, casters, clouds, pickups and glare, Nubs (+ Wardrobe preview), halo dial, sun mascot, HUD, banners/vignettes, particles, Melt Map, sprites. |

## Frame

1. `FixedClock.advance(real)` → n ticks; `Input.takeFrames(n)` (or the `?bot=` bot per tick).
2. For each tick: `takeSnap(prev)`, `step()`, collect events; then `takeSnap(curr)`.
3. `lerpSnap(prev, curr, alpha)`; route the frame's events to `audio.onEvents`, `haptics.onEvents`
   and `fx.onEvents`; daily try/progress bookkeeping.
4. `generateSome(world, nubs.y + idleAhead, 12)` every frame (idle-time world generation).
5. `renderer.draw()`, then `audio.update(view, realDt)` on every frame (menus and pause included).

Draw order: bars → ground + tiles → trail → footprints → pickups → shadow layer (one path, one fill,
multiplied at the LUT alpha) → Nubs' own shadow and footprint disc → glare spots → ground particles,
rings → depth-sorted casters with Nubs (an offscreen sprite) inserted at his y, plus an "x-ray" pass
when something in front overlaps him → heat squiggles → clouds → air particles → Melt Map overlays
→ halo dial → vignettes → text pops → sun mascot → HUD → banners → confetti.

## Test hook (`?test=1`)

`screen()`, `state()` (`phase, day, minutes, chill, snow, theta, f`), `forceDeath()` (Nubs melts on
the next daylight tick), `runHeadless(seed, ticks, bot)`, `setTimeScale(n)`, `audioState()`; extras
for tooling: `paused()`, `presses()`, `demo(name)` (replays `phew`, `mult`, `mult5`, `noon`, `dawn`,
`night`, `cloud`, `glare`, `flake` or `best` through fx/audio only — the sim is untouched), `perf()`
and `nubsScreen()`. `?perf=0` disables the governor (useful for captures).

## Deliberate deviations from the docs

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
