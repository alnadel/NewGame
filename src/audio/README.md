# src/audio: synthesized sound for SHADY

Everything you hear is built at runtime with WebAudio: no asset files, no dependencies. The game wires
**one object**, `createAudio()`, and feeds it two things: the frame's `SimEvent`s and a small per-frame
`AudioView`. Haptics live next door in `src/platform/haptics.ts` and take the same events.

| File | What it is |
|---|---|
| `index.ts` | The facade: `createAudio(): ShadyAudio`, plus re-exported types. **The only import the game needs.** |
| `engine.ts` | Lazy `AudioContext`, unlock on gestures, visibility suspend/resume, the mix graph, noise buffers, one-shot `Voice`s and the per-bus voice limiter. |
| `recipes.ts` | One function per sound (GDD §12 plus UI and moment cues), registry `RECIPES`, names `SFX_NAMES`. |
| `music.ts` | 16th-note lookahead scheduler, pad (I-vi-IV-V), multiplier arpeggio, key change per day, results melody. |
| `ambience.ts` | Sizzle + crackle, noon cicadas, night crickets. |
| `scene.ts` | `AudioView` (what the game sends each frame) and the pure `sceneFor()` mapping to layer targets. |
| `sfxRouter.ts` | `SimEvent` → cue mapping with throttles; drives the scene and the heartbeat each frame. Pure. |
| `theory.ts`, `timing.ts` | Pure maths: keys, scales, chords, patterns, curves; rate limiters, step clock, heartbeat pulse. |
| `lab.ts`, `labTools.ts`, `/audio-lab.html` | Dev-only audition page and offline level/spectrogram tools. |

## Wiring (integrator)

```ts
import { createAudio, createAudioView } from '../audio/index.ts';
import { createHaptics } from '../platform/haptics.ts';

const audio = createAudio({ sfx: save.settings.sfx, music: save.settings.music, muted: params.mute });
const haptics = createHaptics(save.settings.haptics);
audio.onHeartbeat = () => haptics.play('heartbeat');   // keeps buzz and sound in sync
const view = createAudioView();                          // reuse one object; fill it every frame

// After the fixed-step loop has run this frame's ticks:
fillView(view, state, ui);                               // see "AudioView" below
audio.onEvents(frameEvents, view);                       // every SimEvent of the frame, in order
haptics.onEvents(frameEvents, state.sun.omega);
audio.update(view, realDtSeconds);                       // EVERY rendered frame, also paused/menus

// Lifecycle hooks:
audio.resetRun();                                        // on run start / retry
resumeButton.onclick = () => { audio.ensure(); /* … */ };// call ensure() inside gesture handlers
settings.onChange = (s) => { audio.setVolumes(s.sfx, s.music); haptics.setEnabled(s.haptics); };
hud.showMutedIcon = !audio.running;                      // or subscribe: audio.onStatusChange(cb)
```

`createAudio()` listens on `window` (capture phase, passive) for `pointerdown`, `pointerup`, `touchend`,
`click` and `keydown`, and calls `ensure()` until the context is `'running'`. It re-arms whenever the
context drops out of running (iOS `'interrupted'`, visibility suspend). Pass `unlockTarget: null` to
manage it yourself.

## API (`ShadyAudio`)

| Member | Contract |
|---|---|
| `status: AudioStatus` | `'locked'` (no gesture yet) · `'running'` · `'suspended'` · `'interrupted'` (iOS) · `'closed'` · `'unavailable'` (no WebAudio). Use for the test hook `audioState()`. |
| `running: boolean` | True when sound can play. Show the HUD's small muted icon while false (V1_PLAN §12.1). |
| `muted: boolean` | The mute flag (`?mute=1` or `setMuted`). |
| `ensure()` | Create and/or resume the context and play a one-sample silent buffer (the iOS unlock). Idempotent. Must be called **synchronously** inside a gesture handler to count. |
| `setVolumes(sfx, music)` | `Settings.sfx` / `Settings.music`, 0..1, applied as linear bus gains (defaults 0.8 / 0.6 = GDD bus levels). Ambience follows the music slider. Smoothed, so sliders can call it on every input event. |
| `setMuted(m)` | Silences the final output (the context keeps running). Defaults to `?mute=1`. |
| `onEvents(events, view)` | All `SimEvent`s emitted this frame (any number of ticks, in order). See the table below. |
| `update(view, dtReal)` | Once per rendered frame with **real** seconds (not slow-mo-scaled). Drives every continuous layer and the heartbeat, and pumps the scheduler. Call it on every screen, paused included. |
| `resetRun()` | New run: clears throttles, the heartbeat clock, slow-mo/duck timers and any results melody. |
| `play(name, params?)` | Fire any cue directly. For UI: `'uiTap'` (buttons), `'uiBuy'` (buy/equip), `'uiError'` (can't afford, locked), `'newBest'` (results ribbon). Tonal cues use the key of the last view's day unless `params.day` is given. |
| `playMelody(degrees, day)` | Results replay of `RunResult.melody` (≤ 32 pentatonic degrees) as 8th notes at 120 BPM over the pad, in `day`'s key. Returns its length in seconds (0 if audio isn't running), handy for timing the stats count-up. |
| `stopMelody()` | Stops scheduling melody notes (also done by `resetRun`). |
| `onHeartbeat` | Called on each heartbeat with `strong` (Chill < 10). Wire it to `haptics.play('heartbeat')`. Fires even when audio is locked or muted. |
| `onStatusChange(cb)` | Status-change subscription. |
| `meter()` | Debug: an `AnalyserNode` on the final output (null until unlocked), for the `?debug=1` overlay. |
| `dispose()` | Stops the scheduler, removes listeners, closes the context. |

`muteParam()` reads `?mute=1`. `createAudioView()` returns a neutral view (title, Day 1, dawn).
`SFX_NAMES` lists every cue.

## AudioView: the per-frame contract

Fill one reused object from `SimState` and the UI state machine every frame:

| Field | Source | Used for |
|---|---|---|
| `screen` | UI: `'title' \| 'play' \| 'paused' \| 'dying' \| 'results' \| 'menu'` (all tray screens are `'menu'`; the rotate overlay counts as `'paused'`) | Which layers play (below) |
| `phase` | `state.phase` (`'hold' \| 'day' \| 'night' \| 'dead'`) | Day vs night layers |
| `day` | `state.day` (1-based) | Musical key; changes on the next beat after it changes |
| `tDay`, `dayLength` | `state.tDay`, Dl of the current day | Noon cicada window (0.4-0.6 Dl) |
| `eps`, `epsNoon` | `state.eps`, εnoon of the day | Pad cutoff 300 + 2200·(ε/εnoon)² Hz (500 Hz at night) |
| `f`, `glareW` | `state.nubs.f` (0..2), `state.nubs.glareW` (0..1) | Sizzle level/brightness, crackle density |
| `chill` | `state.nubs.chill` (absolute; GDD thresholds 40/25/10) | Arpeggio mute < 40, heartbeat < 25, fast < 10 |
| `mult` | `state.nubs.mult` | Arpeggio density |
| `omega` | `state.sun.omega` (°/s) | Softens detent clicks during fast spins |

### What plays where

| Screen / phase | Pad | Arpeggio | Sizzle | Cicadas | Crickets | Heartbeat |
|---|---|---|---|---|---|---|
| title, menu | soft, warm (420 Hz) | – | – | – | – | – |
| play · hold | yes | – | – | – | – | – |
| play · day | cutoff follows ε | by `mult`, muted < 40 Chill | by `f` | noon window | – | < 25 Chill |
| play · night | 500 Hz | – | – | – | yes | – |
| paused | ducked to 50 %, music bus muffled to 650 Hz | – | – | – | – | – |
| dying / play · dead | darker (380 Hz), 65 % | – | – | – | – | – |
| results | 75 %, 650 Hz, plus `playMelody` | – | – | – | – | – |

**Pause choice.** The pad keeps playing, ducked and muffled, while every tension loop (sizzle,
heartbeat, cicadas, crickets, arpeggio) stops. A pause should feel like holding your breath: the
danger cues would lie (nothing is happening), but dead silence makes the game feel broken and makes
resuming a jolt. The muffle opens over ~0.4 s on resume, so the score glides back. **Menus** get
the same calm pad as the title, so the game has one consistent "home" sound.

## SimEvent → sound

| Event | Cue | Rule |
|---|---|---|
| `detent` | Detent click (pitch ladder by `index`) | ≥ 50 ms apart and ≤ 20/s; softer (to 60 %) as \|ω\| → 600°/s |
| `catch` | Catch thunk | |
| `flake` | Flake bell at `degree` (0..9, octaves 5-6) | **Quantized** to the next free 16th note (a burst rolls up the grid); ≤ 12/s |
| `crystal` | Ice-crystal triad | |
| `flower` | Frost-flower music-box note | Climbs the pentatonic scale each night; quantized |
| `flakeMelt` | "tss" | ≤ 3/s (CRITIQUE #27) |
| `shadeEnter` | Shade "ahh" | Only if `litFor ≥ 0.25` s |
| `multUp` | Two-note chime climbing with `level`; ×5 rolls a full arpeggio | |
| `multReset` | Descending blip | Only if `from > 1` |
| `phew` | PHEW whoop + bell | Music dips under a lowpass for the 350 ms slow-mo |
| `noonBanner` | NOON gong | |
| `noonPassed` | Relieved descending cascade | |
| `nightStart` | Nightfall chord | Crickets fade in via the view |
| `dawn` | Day fanfare in the **new** day's key | Music ducks to 60 % for 1 s; key change on the next beat |
| `cloudCapture` | Cloud whoosh (pans left to right) | |
| `glareTouch` | Glare zap | |
| `death` | Death slide-whistle + plop | Loops stop via `screen`/`phase` |
| `start`, `shadeExit`, `lowChill` | none | Carried by continuous layers (arpeggio, sizzle, heartbeat) |
| `hourEnd`, `gateArch`, `ballPassed` | none | Bookkeeping |

The sim computes the flake `degree` ((pickups this day + mult) mod 10, GDD §12). The session records
those degrees into `RunResult.melody` for `playMelody`.

## Music system

- **Grid:** 90 BPM, 16th = 1/6 s. A 25 ms `setInterval` plus every `update()` call pump a scheduler
  with a 120 ms lookahead. Steps that fall in the past (throttled timer, suspended context) are
  **skipped, never burst-played**, and the bar phase is kept.
- **Key:** Day 1 is C (C4 = 261.63 Hz). Each day moves up a fifth, folded into −5…+6 semitones
  around C4 (C, G3, D, A3, E, B3, F#, C#…), so late days never drift shrill or muddy.
- **Pad:** bass (single saw) + close triad (two saws each, ±4 cents, 1 : 0.6) → lowpass (Q 0.7).
  I-vi-IV-V every 4 bars with 1.5 s in / 2 s out crossfades (0.5 s / 1 s on a key change). The
  voicing (G-C-E, A-C-E, A-C-F, G-B-D in C) is the smoothest possible cycle.
- **Arpeggio (daylight):** triangle plucks an octave above the pad, alternating ±0.3 pan. Density
  by multiplier: ×1 quarters at 50 %, ×2 quarters, ×3 8ths, ×4 8ths plus syncopated 16ths, ×5 16ths
  with octave jumps. Increases wait for the next beat; drops (reset, Chill < 40) apply at once.

## Mix and levels

`sfx`/`music`/`amb` buses → master 0.9 → −3 dB air shelf at 7.5 kHz → compressor (−14 dB, ratio 4,
knee 8, 3 ms, 250 ms) → output trim 0.9 → destination. The WebAudio compressor adds its own make-up
gain, so the chain is about **+3.8 dB under the threshold** and soft-limits near −5 dBFS. Measured
with the lab's level check (Chromium, default volumes):

| Material | Output |
|---|---|
| Single cues | peaks −28 (UI tap) to −12.5 dBFS (death); flake bells ≈ −18 to −17 |
| Score at noon ×5 (×1) | ≈ −28.4 (−29.5) dBFS RMS, peaks ≈ −18 |
| Sizzle at f = 1.5 with glare | ≈ −24 dBFS RMS |
| Worst realistic pile-up (×5, glare, 6 bells, PHEW, crystal, death, heartbeats) | **−6.2 dBFS** peak |

Every envelope starts and ends at 0.0001 (never 0), sources stop 50 ms after their floor, and every
one-shot's last 10 ms measure ≈ −80 dB (no cut-off clicks). Voices disconnect on `onended`. The
limiter caps 24 concurrent one-shots per bus (12 for ambience) and steals the oldest with a
20 ms fade.

**Deliberate deviations from GDD §12** (all found with the level check or spectrogram):
- Pad tone gain 0.028 (GDD 0.035) and ±4 cents at 1 : 0.6 (GDD ±7 equal). Equal saws at ±7 cents
  cancel fully at each fundamental 1-2 times a second (an audible tremolo at the dawn cutoff), and at
  0.035 the pad masked the arpeggio.
- Arpeggio gain 0.09 (GDD 0.03) and a 0.4 s ring (GDD 180 ms), so plucks read over the pad.
- Sizzle 0.12 (GDD 0.22): at 0.22 full-scale noise was the loudest sound in the game.
- Cicadas 0.4 (GDD 0.07) and crickets 0.05 (GDD 0.03): a Q 6 band keeps ~4 % of white noise's
  energy, and the GDD values measured −51 dBFS RMS (inaudible).
- Flake bell 0.18 (GDD 0.12); multiplier chime 0.12, glare 0.16, cloud 0.2, melt 0.09, catch
  +2 dB: rewards and hazards must cut through the score.
- Heartbeat adds an octave partial and a soft knock, because 55 Hz alone is inaudible on phone speakers.
- Keys fold around C4 (−5…+6) rather than upward into [C4, B4].

Decay times are the time to reach the 0.0001 floor (≈ RT60 at these gains).

## Audio lab

`npx vite`, then open `/audio-lab.html`. It has:
- a button for every sound (plus bell degrees, multiplier levels, detent pitches);
- event buttons that go through the router (detent storm, quantized flake run, melt storm, ahh
  threshold, flowers, PHEW dip, dawn duck and key change);
- sliders and selects for the whole `AudioView`, a music on/off toggle and a live output meter;
- **Simulate a day** (30 s: dawn → noon → dusk over 24 s, then night and a dawn key change);
- the results melody;
- a **level check** that renders every cue and layer offline through the real chain, reports peak,
  loudest-100 ms RMS, pre-compressor peak, length and a cut-off check, and draws a waveform and
  spectrogram for any row.

Retune levels there, not by guesswork. `window.__AUDIO_LAB__` exposes `{ audio, view, runLevelCheck }`
for automation.

## Assumptions (to confirm at integration)

- `detent.index` is the detent bucket **after** the crossing, `floor(θ/15)`, and `dir` is the
  direction of travel. Haptics use this to find the crossed 45° boundary.
- `glareW` is the glare share of the lit weight, 0..1 (`SimState.nubs.glareW`).
- Haptic patterns, gating and the event mapping are documented in `src/platform/haptics.ts`
  (`hapticForEvent`, `WebVibrateHaptics`, `NullHaptics`, `createHaptics`).
