# src/audio: synthesized sound for SHADY

Everything you hear is built at runtime with WebAudio: no asset files, no dependencies. The game wires
**one object**, `createAudio()`, and feeds it two things: the frame's `SimEvent`s and a small per-frame
`AudioView`. Haptics live next door in `src/platform/haptics.ts` and take the same events.

| File | What it is |
|---|---|
| `index.ts` | The facade: `createAudio(): ShadyAudio`, plus re-exported types. **The only import the game needs.** |
| `engine.ts` | Lazy `AudioContext`, unlock on gestures, visibility suspend/resume, the mix graph (compressor + limiter), noise buffers (prewarmed tables), one-shot `Voice`s and the per-bus voice limiter. |
| `recipes.ts` | One recipe per cue (`RECIPES`; `SfxName` is its keys). Tunes are note lists played by three instruments (bell, pluck, soft); noises are filtered white noise (`whoosh`, bursts). |
| `music.ts` | 16th-note lookahead scheduler, pad, multiplier arpeggio, bass-and-shaker groove, chapter palettes, key change per day, results melody. |
| `ambience.ts` | Sizzle + crackle, noon cicadas, night crickets, the eclipse drone: each layer built only while it can be heard. |
| `scene.ts` | `AudioView` (what the game sends each frame) and the pure `sceneFor()` mapping to layer targets. |
| `sfxRouter.ts` | `SimEvent` and campaign view edges → cues, throttles, music ducks; drives the scene and the heartbeat each frame. Pure. |
| `theory.ts`, `timing.ts` | Pure maths: keys, scales, chords, chapter palettes, patterns, curves; rate limiters, tempo-aware step clock, heartbeat pulse. |
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

// Once the Title is up and the page is idle (requestIdleCallback, else a timeout):
audio.prewarm();                                         // noise tables, off the first tap

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

**The first gesture stays light** (first-tap-audio-graph-in-gesture). Creating an `AudioContext`
and the mix graph costs tens of ms on phones, and the first tap on the Title is also the press that
starts a run. So the first `pointerdown` or `keydown` (while no context exists) only queues
`ensure()` in a task right after the event; Chrome accepts the start there (the activation is still
live), and if a browser doesn't, the `pointerup`/`touchend`/`click` that follows calls `ensure()`
inside its own handler, which is also what iOS needs (its touches only activate on the way up).
The noise buffers (2 s of white noise, the crackle grains) are computed by `prewarm()` during the
Title's idle time and copied into the graph's buffers (`copyToChannel`; computed on the spot if
`prewarm()` hasn't run or the context runs faster than 48 kHz), and the ambience builds no node
until a layer is first wanted. At 4× CPU throttle the first tap's `pointerdown` processing went from
~70-100 ms to ~1-10 ms (Event Timing).

## API (`ShadyAudio`)

| Member | Contract |
|---|---|
| `status: AudioStatus` | `'locked'` (no gesture yet) · `'running'` · `'suspended'` · `'interrupted'` (iOS) · `'closed'` · `'unavailable'` (no WebAudio). Use for the test hook `audioState()`. |
| `running: boolean` | True when sound can play. Show the HUD's small muted icon while false (V1_PLAN §12.1). |
| `muted: boolean` | The mute flag (`?mute=1` or `setMuted`). |
| `ensure()` | Create and/or resume the context and play a one-sample silent buffer (the iOS unlock). Idempotent. Must be called **synchronously** inside a gesture handler to count. |
| `setVolumes(sfx, music)` | `Settings.sfx` / `Settings.music`, 0..1, applied as linear bus gains (defaults 0.8 / 0.6). Ambience follows the music slider; 0 silences a bus. Smoothed, so sliders can call it on every input event. |
| `setMuted(m)` | Silences the final output (the context keeps running). Defaults to `?mute=1`. |
| `onEvents(events, view)` | All `SimEvent`s emitted this frame (any number of ticks, in order). See the table below. |
| `update(view, dtReal)` | Once per frame (every rAF, drawn or not) with **real** seconds. Drives every continuous layer, the concept cues and the heartbeat, and pumps the scheduler. Call it on every screen. |
| `prewarm()` | Computes the noise tables ahead of the first gesture (call once the page is idle). Idempotent. |
| `resetRun()` | New run: clears throttles, the heartbeat clock, slow-mo/duck timers, concept edges and any results melody. |
| `play(name, params?)` | Fire any cue directly (it ducks the score like the event would). UI: `'uiTap'`, `'uiBuy'`, `'uiError'`, `'newBest'`, and the v1.4 reward cues `'reward'` (a rolled bell sixth), `'rankUp'` (fanfare, octave chord, run up), `'open'` (a Snow Globe: shimmer, glassy pop, falling sparkles), `'claim'` (two-bell ka-ching) and `'tick'` (a dry click for count-ups); the session plays each with the haptic of the same name. Tonal cues use the last view's day and the playing chapter's key unless `params.day`/`key` are given. |
| `playMelody(degrees, day)` | Results replay of `RunResult.melody` (≤ 32 pentatonic degrees) as 8th notes at 120 BPM over the pad, in `day`'s key. Returns its length in seconds (0 if audio isn't running). |
| `stopMelody()` | Stops scheduling melody notes (also done by `resetRun`). |
| `onHeartbeat` | Called on each heartbeat with `strong` (Chill < 10). Wire it to `haptics.play('heartbeat')`. Fires even when audio is locked or muted. |
| `onStatusChange(cb)` | Status-change subscription. |
| `meter()` | Debug: an `AnalyserNode` on the final output (null until unlocked). |
| `dispose()` | Stops the pump and its watchdog and every ambience layer, removes listeners, closes the context. |

`muteParam()` reads `?mute=1`. `createAudioView()` returns a neutral view (title, Day 1, dawn).
`SFX_NAMES` lists every cue.

## AudioView: the per-frame contract

Fill one reused object from `SimState` and the UI state machine every frame (`Session.fillAudioView`):

| Field | Source | Used for |
|---|---|---|
| `screen` | UI: `'title' \| 'play' \| 'paused' \| 'dying' \| 'results' \| 'menu'` (all tray screens and the Journey are `'menu'`; the rotate overlay counts as `'paused'`) | Which layers play (below) |
| `phase` | `state.phase` (`'hold' \| 'day' \| 'night' \| 'dead' \| 'won'`) | Day vs night layers; `won` = the finish freeze |
| `day` | `state.day` (1-based) | Musical key; changes on the next beat after it changes |
| `tDay`, `dayLength` | `state.tDay`, Dl of the current day | Noon cicada window (0.4-0.6 Dl) |
| `eps`, `epsNoon` | `state.eps`, εnoon of the day | Pad cutoff 300 + 2200·(ε/εnoon)² Hz (500 Hz at night) |
| `f`, `glareW` | `state.nubs.f` (0..2), glare share of the lit weight (0..1) | Sizzle level/brightness, crackle density |
| `chill` | `state.nubs.chill` (absolute; GDD thresholds 40/25/10) | Arpeggio and groove mute < 40, heartbeat < 25, fast < 10 |
| `mult` | `state.nubs.mult` | Arpeggio and groove density |
| `omega` | `state.sun.omega` (°/s) | Softens detent clicks during fast spins |
| `chapter`? | `state.level?.chapter ?? 0` | The chapter's music palette (0 = default score) |
| `progress`? | `levelProgress(state)`, −1 outside the campaign | "Finish line near" cue and the final stretch at ≥ 0.85 |
| `gust`?, `locked`? | `state.sun.gust`, `state.sun.locked` | Gust whoosh (towards the wind), lock clink / release |
| `eclipse`? | `state.eclipse` (0..1) | Eclipse cue, drone, score muffle |
| `moonlit`?, `fog`? | `state.moonlit`, `state.mods.has('fog')` | Night bed by day; score muffled to 1.4 kHz |

The campaign fields are optional; a view without them is an Endless run.

### What plays where

| Screen / phase | Pad | Arpeggio | Groove | Sizzle | Cicadas | Crickets | Heartbeat |
|---|---|---|---|---|---|---|---|
| title, menu | soft (520 Hz) | ×1 music box | bass once a bar | – | – | – | – |
| play · hold | yes | – | – | – | – | – | – |
| play · day | cutoff follows ε | by `mult`, muted < 40 Chill | by `mult` | by `f` | noon window | moonlit | < 25 Chill |
| play · day, progress ≥ 0.85 | | one level busier | full | | | | |
| play · night | 500 Hz | – | – | – | – | yes | – |
| play · won | bright (1.8 kHz) under the win jingle | – | – | – | – | – | – |
| paused | ducked to 50 %, score muffled to 650 Hz | – | – | – | – | – | – |
| dying / play · dead | darker (380 Hz), 65 % | – | – | – | – | – | – |
| results | 75 %, 650 Hz, plus `playMelody` | – | – | – | – | – | – |

Fog muffles the score to 1.4 kHz and halves the cicadas. An eclipse hums a low drone at its intensity,
sinks the score under a lowpass (down to 450 Hz) and drops the pad 40 %; past half the beat stops.

**Pause choice.** The pad keeps playing, ducked and muffled, while every tension loop stops: a pause
should feel like holding your breath, and resuming glides back over ~0.4 s. **Menus** get the Title's
tune, so the game has one consistent "home" sound.

**Ambience layers exist only while they can be heard** (silent-ambience-dsp-always-on): the sizzle
bed and its crackle while the screen is in play, the cicadas from 0.5 s before the noon window
until it ends, the crickets at night (or moonlit), the drone during an eclipse. A start glides up
from 0 with the layer's fade; a layer unwanted for ≥ 1 s and five of its fade constants (so below
−60 dBFS) fades to 0 over 50 ms, stops and disconnects. On the Title and menus only music runs.

## SimEvent → sound

| Event | Cue | Rule |
|---|---|---|
| `detent` | Detent click (pitch ladder by `index`) | ≥ 50 ms apart and ≤ 20/s; softer (to 60 %) as \|ω\| → 600°/s |
| `catch` | Catch thunk | |
| `flake` | Flake bell at `degree` (0..9, octaves 5-6) | **Quantized** to the next free 16th note; ≤ 12/s |
| `crystal` | Ice-crystal triad | |
| `flower` | Frost-flower music-box note | Climbs the pentatonic scale each night; quantized |
| `flakeMelt` | "tss" and a droplet | ≤ 3/s |
| `shadeEnter` | Shade "ahh" | Only if `litFor ≥ 0.25` s |
| `multUp` | Pluck chime climbing with `level`; ×5 rolls a full arpeggio | |
| `multReset` | Descending blip | Only if `from > 1` |
| `phew` | PHEW whoop + bell | Music dips under a lowpass for the 350 ms slow-mo |
| `noonBanner` / `noonPassed` | NOON gong / relieved cascade | Gong ducks the score to 70 % for 1.5 s |
| `nightStart` | Nightfall chord | Crickets fade in via the view |
| `dawn` | Day fanfare in the **new** day's key | Ducks the score to 60 % for 1 s; key change on the next beat |
| `cloudCapture` | Cloud whoosh (left to right) | |
| `glareTouch` | Glare zap | |
| `gateArch` | "Ding-dong" | |
| `swing` | Swoosh + a pluck climbing with `chain` | |
| `levelWon` | `passed`: win jingle tiered by `stars` (★ fanfare, ★★ + chord, ★★★ + sparkle run); else a soft "aww" | Ducks to 40 % for 2.4 s (miss: 60 %, 1.4 s) |
| `death` | Death slide-whistle + plop | Loops stop via `screen`/`phase` |
| `budGrow` | A soft tick climbing the scale with the bud's growth | ≤ 8/s, ≥ 90 ms apart |
| `bloom` | A round pop and a bell run opening out | |
| `frostReady` | Three high bells rolled up, a breath of ice | |
| `snap` / `snapEnd` | An icy crack, a falling whoosh, a cold thump and a bell cluster / two quiet bells falling | The snap ducks the score to 70 % for 0.8 s |
| `deepEnter` | A low soft whoom and a high bell | ≤ 1 per 2.5 s |
| `start`, `go`, `shadeExit`, `lowChill` | none | Carried by continuous layers |
| `hourEnd`, `ballPassed`, `lessonDone` | none | Bookkeeping |

View edges in play (day or night): a gust starting → **gust** whoosh (≤ 1/s); `locked` on/off →
**lock** clink / release; `eclipse` leaving 0 → **eclipse** falling shimmer; `progress` crossing
0.85 → **finishNear** lift (once per run, re-armed by `resetRun`). `newBest` ducks to 50 % for 2 s.

## Music system

- **Grid:** a 16th-note scheduler with a 120 ms lookahead, pumped by every `update()`. A watchdog
  timeout every 250 ms checks that `update()` ran in the last 100 ms; when it hasn't, a 25 ms
  interval pumps until it does. Steps in the past are **skipped, never burst-played**.
- **Key:** Day 1 of the default palette is C4. Each day moves up a fifth from the palette's base,
  folded into −5…+6 semitones around C4, so late days never drift shrill or muddy.
- **Chapter palettes** (`theory.PALETTES`): every Journey chapter has its own base key, tempo
  (80-120 BPM), pad voice (detuned saws, triangle organ, lowpassed square reed), arpeggio voice
  (marimba, music box, soft chip pluck) and chord order (I-vi-IV-V, I-IV-vi-V, vi-IV-I-V,
  I-V-vi-IV). Index 0 (Endless, Daily, menus) is the original 90 BPM C score. A new palette, like a
  dawn, lands on the next beat with a quick crossfade.
- **Pad:** bass + close triad (two oscillators each, ±4 cents, 1 : 0.6) → lowpass (Q 0.7), the
  smoothest voicings of I, vi, IV, V; 1.5 s in / 2 s out crossfades every 4 bars.
- **Arpeggio:** an octave above the pad, alternating ±0.3 pan. ×1 quarters at 50 %, ×2 quarters,
  ×3 8ths, ×4 8ths plus syncopated 16ths, ×5 16ths with octave jumps. Rises wait for the beat.
- **Groove:** a bass pluck on the chord root (once a bar, then on 1 and 3) and, at ×4+ or in the
  final stretch, a quiet shaker on the off-8ths.

## Mix and levels

`sfx`/`music`/`amb` buses → master 0.9 → −3 dB air shelf at 7 kHz → glue compressor (−14 dB,
ratio 4, knee 8, 3 ms / 250 ms) → limiter (−2 dB, ratio 20, 1 ms / 80 ms) → trim 0.85 (mute) →
destination. The whole score sits under a 0.7 (−3 dB) trim so it never competes with the cues, and
ducks under the big moments (table above). Voices: 20 one-shots per bus (12 for ambience), the
oldest stolen with a 20 ms fade. Every envelope starts and ends at 0.0001 (never 0) and sources stop
50 ms after their floor, so no one-shot is cut off.

**Measured, not guessed** (nobody had listened). Every cue and representative scenes were rendered
offline through the real chain in Chromium (`labTools.levelCases`, default volumes) and analysed
for sample peak, max momentary loudness (BS.1770 K-weighted, 400 ms), clipping, DC offset and the
energy share above 6 kHz. Before = v1.2, after = v1.3:

| Material | Peak dBFS before → after | Max momentary LUFS before → after | > 6 kHz energy |
|---|---|---|---|
| Flake bell (deg 9) | −18.1 → −17.9 | −25.0 → −24.5 | 0 % |
| Crystal / ×5 mult-up / PHEW | −13.9 / −18.0 / −13.8 → −13.0 / −15.8 / −13.1 | −24.2 / −27.6 / −22.4 → −23.2 / −24.1 / −21.8 | 0 % |
| Day fanfare / new best | −17.3 / −17.3 → −16.6 / −16.6 | −24.4 / −23.4 → −23.8 / −22.8 | 0 % |
| Level win ★★★ / ★ / miss (new) | – → −14.8 / −14.8 / −20.0 | – → −21.3 / −22.1 / −27.3 | 0 % |
| Death | −12.5 → −13.1 | −19.3 → −20.3 | 0 % |
| UI tap | −27.7 → −23.0 | −48.0 → −41.6 | 0 % |
| v1.4 reward / rank up / globe open / claim / tick (loudest 100 ms RMS) | −13.8 / −13.5 / −14.7 / −19.7 / −26.3 | −24.2 / −23.3 / −24.5 / −28.8 / −48.0 | 0 % |
| Melt | −27.1 → −27.4 | −43.3 → −44.0 | **68.5 → 1.1 %** |
| Sizzle, f 1.5 in glare | −12.7 → −18.5 | **−18.6 → −25.0** (was the loudest sound in the game) | **45 → 20 %** |
| Score, noon ×5 (×1) | −17.8 (−18.8) → −19.3 (−19.7) | −26.9 (−27.8) → −29.1 (−30.7) | 0 % |
| Title bed | −22.5 → −19.8 | −29.8 → −31.4 | 0 % |
| Chapter scores (Frost ×3, Clockwork ×4, Heat Dome final stretch) | – | −28.6, −30.6, −30.9 | 0 % |
| Moonlit / fog / eclipse scenes | – | −28.1 / −28.5 / −28.6 | 0 % |
| Worst realistic pile-up (×5, glare, 6 bells, 10 cues, heartbeats, win jingle) | −6.5 → −5.6 | −13.5 → −13.4 | 20 → 2.5 % |
| Every cue at once ×1/×2/×4, both sliders at 1 | −2.4/−2.8/−2.5 → −3.3/−3.2/−3.3 | | |

No render clips (0 samples ≥ 0.999) and DC stays under 2·10⁻³ (the short sub-bass glides of the
heartbeat and catch). The reward and moment cues now span 6.6 dB (−20.3 to −26.9 LUFS) and sit
5-8 dB over the score (−28.6 to −31.4); before, the sizzle hiss outshouted every cue and the score
sat 2 dB under the bells. **Long session:** a bot playing Journey levels for 4 minutes keeps the
live AudioNode count (created minus disconnected) between 48 and 194 with no upward trend
(v1.2: 43-176); voices and layers release their nodes.

## Audio lab

`npx vite`, then open `/audio-lab.html`: a button per cue (plus bell degrees, multiplier levels and
star tiers), router event buttons (detent storm, quantized flake run, melt storm, PHEW dip, dawn
duck, level won/missed, swing chain), sliders for the whole `AudioView` including the campaign
fields (palette, final stretch, eclipse, gust, lock, moonlit, fog), the results melody, a live
meter and the **level check**: every cue and scene rendered offline through the real chain, with
peak, loudest-100 ms RMS, pre-compressor peak, length, a cut-off check and a waveform/spectrogram
per row. `window.__AUDIO_LAB__` exposes `{ audio, view, runLevelCheck, results }` for automation.
Retune levels there, not by guesswork.

`detent.index` is the bucket **after** the crossing (`floor(θ/15)`) and `dir` the direction of travel; haptic
patterns, gating and the event mapping live in `src/platform/haptics.ts`.
