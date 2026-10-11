# Wave 1 handoff notes (integration requests and known issues)

Written by the three wave-1 tracks (core, audio, ui). The integration engineer must honour the **requests**. The **known issues** are context. The full APIs are in `src/core/README.md`, `src/audio/README.md` and `src/ui/README.md`.

## Track: core

### Requests

- package.json: please add "golden": "node scripts/golden.ts" and optionally "sim:check": "node scripts/sim.ts --check --seeds 50 --days 8". The existing test:all already runs `npm run sim -- --check --seeds 50`, which works as is.
- Session/game track: call generateSome(s.world, s.nubs.y + TUNING.world.idleAhead, 8..16) in idle time every frame. Otherwise step() may validate a whole chunk inside one tick (p99 ≈ 7.6 ms in Node, more on phones).
- Session/game track: send {downEdge: true, upEdge: true} for a Space/Enter start or retry. input.ts must quantize dTheta to 1/1024° and release to 1/64 °/s, as V1_PLAN §3.1 already says, so replays match live play.
- Render track: fill all partShadow polygons, discs and cloudShadow ellipses into one path, with arc/ellipse winding matching the CCW world polygons under the y-flipped transform. Fade cloud bodies with cloudVisibility(). Draw clouds at oblique height 0.25·z (z = 300).
- Meta track: RunResult.hourGlyphs[i] is for day (startDay + i); normal runs start on Day 1, so it is day i+1. The 'flake' event's snow field is the Snow awarded by that pickup, not the run total.

### Known issues and decisions

- Tutorial test 2 (V1_PLAN §6.1) is only approximately achievable. With 300-500 u dawn shadows, the right-hand casters behind Nubs still give a clockwise alternative about 31° from θ0 at 3.0 s; it grows to ≥55° by 3.5 s and lasts about a second. Forcing a strict ≥90° swing would mean removing all right-side shade within ~350 u, which breaks test 1 (≥80% shaded holding θ0). The test now asserts: at 3.0 s θ0 is lit; nothing within 30° of θ0 is safe; the west arc ≥90° away exists; holding θ0 drops Chill below 25 inside the chunk; and a 180°/s swing at 2.7 s keeps Chill above 70 and collects all 3 flakes. Test 1 measures 95%.
- Validator changes beyond the spec, all needed to reach unresolved = 0. (a) Rescue rocks keep the spec geometry (30×30, height clamp(40·tan ε+20, 60, 160), nearest edge 20 u), but their side and their position along the trail (failure point or wall slots ±4 rock lengths) are picked by a score: the rock that fully shades the DP's best reachable angles for 3 consecutive steps wins. Placed literally at the failure point, a rock gives about 0.3 s of shade at Day 4-8 noon, which the 3-step human model credits as ~0.1 s, so chunks hit 8 rescues and stayed unresolved. (b) Each chunk's DP re-runs the previous chunk's last 2 s from stored rows, so failures just past a chunk boundary can still be rescued. (c) Up to 2 parked clouds per chunk instead of 1 (TUNING.rescue.maxParked).
- Parked validator clouds (about 3% of chunks, at high-day noons) appear near Nubs for 6 s. cloudVisibility() fades the cloud body, but its shadow is real for its whole life, so the shadow can pop in and out.
- Day 1 config was tuned off the V1_PLAN table to bring novice p3 into range (it was 9:41 AM, short of the 10:00 AM floor): spacing 55→45, lateral max 50→46, clouds [19, 38]→[9, 19, 38]. Idle still dies before 8 AM on 92% of seeds, so that margin is thin (≥90% required).
- Other behaviour choices: PHEW checks the Chill from before the tick that found shade (otherwise one tick of regen hides a PHEW). The slab logic test is the exact swept form rather than GDD's 3-height sampling, so it matches the rendered shadow. Glare weight for the glare death cause is 2 × the number of glaring samples. The glare death line reads 'Glared by the {Adj} Gazing Ball at {time}.'
- The dawn tick is already daylight, so on a fully lit dawn Chill reads max − 55/60 after it (it was refilled to max at the start of that tick).
- The cloud death cause uses ±(180°/s × 1 s) = ±180°, which is every azimuth, as V1_PLAN specifies. It fires whenever any cloud could have fully covered Nubs one second before death. TUNING.death.cloudTurnRate/cloudTurnSec can narrow it if playtests find it too frequent.
- Generation timing is noisy on this shared 4-core machine; per-chunk means ranged 1.44-1.8 ms across runs.
- Tests import scripts/golden.ts (scriptedInput, chunkDigests); tests/golden/hashes.json must be regenerated with `node scripts/golden.ts` whenever config or generation changes.

## Track: audio

### Requests

- Integrator (src/game/session.ts and src/main.ts): call createAudio({ sfx, music, muted: params.mute }) once. Every frame:
  - fill one reused AudioView: screen = UI state, with tray screens as 'menu' and the rotate overlay as 'paused'; phase, day, tDay, Dl, eps, εnoon, nubs.f, nubs.glareW, nubs.chill, nubs.mult, sun.omega;
  - call audio.onEvents(frameEvents, view) and haptics.onEvents(frameEvents, sun.omega) after the fixed steps;
  - call audio.update(view, realDt) on every rendered frame, including paused and menu screens.
  Also:
  - call audio.resetRun() on run start and retry;
  - set audio.onHeartbeat = () => haptics.play('heartbeat');
  - wire __SHADY_TEST__.audioState = () => audio.status.
- UI track: call audio.ensure() synchronously inside the Resume button handler. Play audio.play('uiTap') and haptics.play('ui') on button taps, 'uiBuy' on buy/equip, 'uiError' on a failed buy, and audio.play('newBest') plus haptics.play('best') on the results NEW BEST ribbon. Call audio.playMelody(result.melody, result.day) when Results appear (it returns the length in seconds, handy for timing the stats count-up) and audio.stopMelody() when leaving. Show the HUD muted icon while !audio.running (or subscribe with audio.onStatusChange). Settings changes call audio.setVolumes(sfx, music) and haptics.setEnabled(haptics).
- Sim track: confirm the detent index semantics above. The flake event's degree should be (pickups this day + mult) mod 10 per GDD §12; audio folds any integer into 0..9 regardless.

### Known issues and decisions

- Assumption to confirm with the sim track: SimEvent detent.index is the detent bucket AFTER the crossing, floor(θ/15), and dir is the travel direction. Haptics use this to find the crossed 45° boundary. If the sim defines index as the crossed boundary instead, only which detents buzz shifts by one; harmless, but worth aligning.
- Assumption: AudioView.glareW is SimState.nubs.glareW, the glare share of the lit weight in 0..1. It only raises crackle density, by up to 1.5×.
- Several mix levels deliberately differ from GDD §12 after measurement, all documented in src/audio/README.md:
  - pad tone gain 0.028 at ±4 cents with a 1 : 0.6 balance (GDD: 0.035 with two equal saws at ±7 cents, which made an audible tremolo and masked the arpeggio);
  - arpeggio gain 0.09 with a 0.4 s ring (GDD: 0.03 and 180 ms);
  - sizzle 0.12 (GDD 0.22);
  - cicadas 0.4 and crickets 0.05 (the GDD values measured inaudible);
  - flake bell 0.18, and multiplier/glare/cloud/melt cues raised 2-4 dB;
  - keys fold around C4 (−5…+6 semitones) instead of upward.
  All of this was tuned in headless Chromium with meters and spectrograms, not by ear, so a listen on real phone speakers and headphones is still needed.
- Audio can only start on the first activating gesture. On touch screens that is pointerup/touchend (browser policy), so the very first drag on a fresh page is silent until the finger lifts. This is unavoidable; the unlock is wired to every allowed event.
- Continuous layers (sizzle noise, cicadas and their oscillators, crickets) keep running at zero gain when unused, about 25 persistent nodes. That is cheap on WebAudio, but it is the first thing to look at if an audio-thread profile on a low-end phone shows load.
- The Web Audio compressor's automatic make-up gain differs slightly between engines, so Safari or Firefox loudness may differ by a dB or two from the Chromium measurements.

## Track: ui

### Requests

- package.json: add the script "icons": "node scripts/gen-icons.ts" (TECH_SPEC §1). It runs fine with plain node; I can't edit package.json.
- Integration (src/main.ts / game/session.ts): wire boot as in src/ui/README.md §6. Specifically: create a SaveStore; flush on onPageHidden and at run end; call notifyStorageDegraded when store.degraded; read challengeFromHash; call registerServiceWorker; call beginRun at every run start; call applyRunResult at run end and pass dailyTry from dailyTryStarted (at 6:30 AM, then flush); call dailyProgress every in-game hour; call requestPersistence after the first completed run; offer the install sheet when shouldShowInstallSheet is true.
- Game input (src/game/input.ts):
  - Do not handle Escape, P, Enter or Space; the UI owns them and calls the callbacks.
  - Act on canvas pointers only when ui.current() is 'title' or 'play'.
  - Accept a run start from callbacks.dragHandoff(e): start with catch semantics, then follow e.pointerId via window pointermove/pointerup.
- Renderer:
  - Implement renderWardrobePreview(canvas, equipped) by drawing Nubs with equippedLooks(equipped). Field meanings are documented on ScarfLook, HatLook and NoseLook in src/meta/content.ts.
  - Draw the equipped cosmetics on Nubs in-game.
  - Frame the Melt Map above ui.resultsSheetTop().
  - Use readSafeArea()/onSafeAreaChange() for HUD insets; they honour the --safe-* simulation used for the 47 px layout test.
- Audio: map UiSoundName (tap, back, toggle, slide, buy, equip, deny, stamp, unlock, count) to recipes (at minimum the GDD "UI tap") plus the 4 ms UI haptic; keep calling ui.setAudioMuted(!running).
- e2e (tests/e2e, not my track): selectors you can rely on are #ui[data-screen=…], the Pause button (aria-label "Pause"), .res-retry, .scr-daily .btn--primary (reads "Play · try 1/3"), and the .rotate.is-on overlay. To fake a notch for the layout tests, use simulateSafeArea({ top: 47 }) or set --safe-top: 47px on <html>.

### Known issues and decisions

- Rules I had to interpret: the multiplier mission caps at ×5 in higher tiers; the gate-arch and "Play today's Daily" missions do not scale with tier; any glare contact voids the gazing-ball mission (uses RunStats.ballGlared); NEW BEST is never shown on the very first run; endless and challenge runs update bestMinutes, daily runs keep their own per-date best.
- "Play today's Daily" also completes with a practice run (any daily-mode run with today's date).
- The progression code assumes `RunStats` meanings that the sim track must match: `nightsReached` counts survived nights, `cloudRideBest` and `x5HoldBest` are seconds, `ballsPassedClean` is a count.
- On 360x640 the Results stats and missions scroll inside the sheet (score, Share/Home and Retry stay visible), because the sheet is capped at 58% height. On 390x844 with the NEW BEST ribbon, two-line mission labels and a melted-flakes line, the top ~3 px of the stats can scroll out of view once the stamps scroll into view.
- `SaveV1.flags.storageWarned` is not used: the storage warning is limited to once per session, since nothing persists when storage is degraded.
- icon-512 and icon-maskable-512 are about 140-150 KiB each because of the gradients. They are left out of the service-worker precache (the browser fetches install icons itself), along with icon-1024.
- The lab's stand-in scene, Melt Map and Nubs preview are placeholders. The real ones come from the render track through `renderWardrobePreview` and the canvas.
