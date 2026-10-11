# SHADY: Don't Melt Nubs

A one-thumb arcade game for phones and the web. **You are the sun.** Nubs the snowman walks up a
winding trail, and one horizontal drag swings the sun around him, and with it every shadow in the
world: stones, huts, trees, clouds. Keep Nubs in the shade. The sun climbs toward noon, shadows
shrink, and **noon is the boss** of every day; evenings and nights let him recover. Your **score is
the time of day you reached**, for example "Day 2 · 2:40 PM".

TypeScript, Vite, Canvas 2D and WebAudio, with **no runtime dependencies**. It installs as a PWA,
works offline, and is built to ship later in iOS and Android shells through Capacitor.

- Live build: <https://alnadel.github.io/NewGame/>
- Design: [docs/GDD.md](docs/GDD.md) · Scope (authoritative): [docs/V1_PLAN.md](docs/V1_PLAN.md) ·
  Architecture: [docs/TECH_SPEC.md](docs/TECH_SPEC.md) · Review: [docs/CRITIQUE.md](docs/CRITIQUE.md)

## How to play

| | Touch | Keyboard and mouse |
|---|---|---|
| Turn the sun | drag left or right anywhere | ← → or A D (or drag with the mouse) |
| Start or retry | drag on the Title, or tap Retry | Space or Enter |
| Pause | the pause button | Esc or P |

- A flick makes the sun coast; a slow drag stops where your finger lifts. Touch a coasting sun to
  catch it.
- Snowflakes melt if they stay in sunlight; collect them for **Snow**. Staying shaded builds a frost
  multiplier; a last-moment save is a **PHEW**.
- **Daily Solstice**: one shared world per day with 3 scored tries (unlocks after 3 runs). A run
  that melts before 6:30 AM doesn't use a try.
- **Challenges**: Share puts your time and a link in a message; the link opens the same world with
  "Beat Day 2 · 2:40 PM" on the Title.
- **Missions** give Snow for goals such as "Collect 10 flakes in one run"; spend Snow in the
  **Wardrobe** on scarves, hats and noses for Nubs.
- Progress lives on the device. Settings → Backup copies a code you can paste in another browser,
  on another device or in the Home Screen app.

## Requirements

- Node **22.18 or newer** (scripts are TypeScript run directly by Node's type stripping).
- For the e2e tests: Playwright's Chromium.

## Commands

```sh
npm ci                              # install (dev dependencies only)
npm run dev                         # dev server (also on your LAN: open it on a phone)
npm run build                       # typecheck, then production build into dist/ (with sw.js)
npm run build:single                # one self-contained dist-single/index.html (no service worker)
npm run preview                     # serve dist/ (run a build first)

npm run typecheck                   # tsc for the app and the Node scripts
npm test                            # unit tests (Vitest)
npm run sim -- --check --seeds 50   # headless bots vs the difficulty targets; exits 1 on a miss
npm run golden                      # rewrite tests/golden/hashes.json (see below)
npm run e2e                         # Playwright, mobile (Pixel 7) and desktop Chromium projects
```

- **`npm run sim`** plays the real simulation with scripted bots (`idle`, `novice`, `reactive`,
  `oracle`, `human`) at full speed and reports death times, safe angles, rescues and flakes per bot
  and profile. `--check` enforces the targets in [V1_PLAN](docs/V1_PLAN.md) §13.
  It also prints three **ADVISORY** rows for the seeded `human` bot (a model of a new player): at
  least 50% reach the first night on profile 0, a median run of 30 s or more at the second run's
  drain, and 25 s or more at the fifth run's. They report PASS or MISS but never fail the check.
  Other flags: `--bot <kind|all>`, `--profile 0-3`, `--days N`, `--workers N`.
- **`npm run golden`** regenerates the determinism hashes that the unit tests and the browser
  determinism e2e test compare against. Run it only after a deliberate change to the simulation or
  world generation (tuning, generation, step order), and say why in the commit. If a hash changes
  when you did not mean to change the sim, you have a determinism bug.
- **`npm run e2e`** builds and serves the game on port 4173 itself. Install Chromium once with
  `npx playwright install chromium`; if a copy is already on the machine, point Playwright at it
  instead, for example `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run e2e`.
- `npm run icons` re-renders `public/icons/` from the SVG art (needs Playwright's Chromium);
  `npm run test:all` runs typecheck, unit tests, the sim check and e2e in a row.
- Dev-only pages: `/ui-lab.html` (every screen with sample data) and `/audio-lab.html` (every sound).

## URL parameters

| Param | Effect |
|---|---|
| `?test=1` | Exposes `window.__SHADY_TEST__` (`screen()`, `state()`, `forceDeath()`, `runHeadless()`, `setTimeScale()`, `perf()`, `demo(name)`, …) for e2e and tooling |
| `?seed=N` | Endless world seed |
| `?mode=daily&date=YYYY-MM-DD` | The Daily for that date (from the first Daily to tomorrow; practice unless it is today) |
| `?day=N&t=noon` | Start on day N at `dawn`, `noon`, `dusk` or `HH:MM` |
| `?bot=idle\|novice\|reactive\|oracle\|human` | A bot plays |
| `?fast=N` | N× simulation speed (1-16) |
| `?profile=0-3` | Force a difficulty profile (0 = first run … 3 = standard) |
| `?chill=N`, `?guide=always\|off` | Starting Chill; force the shade guide on or off |
| `?debug=1` | Debug overlay (frame, sim, generation and render times, counts; toggles for test points, validator masks and shadow outlines) |
| `?perf=0` | Full quality: no frame-time governor, no low-end caps (for captures and A/B timing) |
| `?mute=1` | No audio |
| `?reset=1` | Clear the save (dev builds only) |

Runs started with `?day`, `?t`, `?chill`, `?profile`, `?bot`, `?fast` or `?guide` are debug runs:
they are not saved, scored, shared or counted as Daily tries.

## Project structure

```
src/
  main.ts      boot: save, audio, haptics, UI, renderer, session, service worker
  config/      tuning constants and the day table (pure data)
  core/        the deterministic simulation: clock, sun, shadows, world generation and its
               fairness validator, bots, replays, state hashes
  game/        orchestration: session and run lifecycle, fixed-step loop, input, camera, fx,
               perf governor, URL params and the test hook
  render/      Canvas 2D renderer: ground, shadow layer, casters, Nubs, HUD, Melt Map
  audio/       synthesized WebAudio: sound recipes, adaptive music, ambience
  ui/          DOM screens and overlays (Title, Results, Daily, Missions, Wardrobe, Settings)
  meta/        save v1 and its store, progression, missions, Daily, share text, challenge codes,
               backups
  platform/    browser and native seams: storage, haptics, share, lifecycle, PWA, safe areas
tests/
  unit/        Vitest (node): core maths, sim, generation, meta, UI logic, architecture rules
  e2e/         Playwright: smoke, layout, flows, PWA and single-file build
  golden/      determinism hashes (npm run golden)
scripts/       sim.ts (headless balance check), golden.ts, gen-icons.ts, inline-build.mjs
docs/          design, scope, architecture and review documents
public/        manifest and icons
```

Module guides: [src/core](src/core/README.md), [src/game](src/game/README.md),
[src/ui](src/ui/README.md), [src/audio](src/audio/README.md).

## Architecture

```
game, main.ts     orchestration: session, loop, input, camera, fx      may import any layer
─────────────────────────────────────────────────────────────────────────────────────────
render · ui · audio   side effects: canvas, DOM, sound                 import the layers below
─────────────────────────────────────────────────────────────────────────────────────────
meta              save, progression, missions, Daily, share (no DOM)
─────────────────────────────────────────────────────────────────────────────────────────
core → config     deterministic simulation; tuning data (imports nothing)
platform          browser and native seams; imports only itself, usable by any layer but core/config
```

| Layer | May import |
|---|---|
| `config` | nothing |
| `core` | core, config |
| `platform` | platform |
| `meta` | meta, core, config, platform |
| `ui` | ui, meta, core, config, platform |
| `audio` | audio, core, config, platform |
| `render` | render, core, config, meta, platform, plus `game/camera.ts` and `game/assist.ts` |
| `game`, `main.ts` | anything |

Audio does not read meta; only render may reach into `game`, for the camera and the hint state.
`tests/unit/architecture.test.ts` enforces the table and bans non-deterministic APIs in `core` and
`config`.

- **Deterministic core.** The simulation steps at a fixed 60 Hz on integer ticks, using only exact
  IEEE-754 operations and its own trig (`dmath.ts`), so the same seed and inputs give bit-identical
  runs in V8, JavaScriptCore and Node. Rendering interpolates between the last two ticks.
- **Seeded, fair worlds.** World generation is seeded per chunk, and a validator proves every
  chunk survivable from where the player can be (inserting a rescue caster when it can't). The
  headless bots measure the difficulty curve against the targets.
- **Meta.** One versioned save (v1) behind a store with debounced writes, a `.bak` copy, a
  never-overwritten `.future` copy for newer versions, and adoption of saves written by other tabs.
  Backups are base64url codes; challenge links carry a code in the URL hash; there is no server.
- **Audio** is synthesized at runtime in WebAudio (no sample files): one recipe per sound event,
  music with a key change per day and an arpeggio that climbs with the multiplier, and ambience
  that follows the time of day (noon cicadas, night crickets).
- **PWA.** A hand-rolled service worker (emitted by a Vite plugin) precaches the build, bypassing
  the HTTP cache, and new versions take over on the next cold start, never mid-game.

## Path to Capacitor (iOS and Android)

Out of scope for v1 (docs only); the code keeps the seams open (`platform/native.ts` →
`isNative()`). From [TECH_SPEC](docs/TECH_SPEC.md) §18:

1. Add `@capacitor/core`, `app`, `haptics`, `preferences`, `share`, `filesystem`, `status-bar` and
   `splash-screen`, plus `@capacitor/cli`, `ios`, `android` and `assets` as dev dependencies.
   `npx cap init SHADY app.shady.game --web-dir=dist`, `npx cap add ios`, `npx cap add android`.
   `base: './'` already makes the build load from the app bundle.
2. Adapters behind `isNative()`:
   - **Storage**: Preferences is asynchronous, so `await Preferences.get({ key: 'shady.save' })`
     and seed the adapter **before** `new SaveStore(...)` (the store reads once, synchronously, at
     construction); keep mirroring writes to localStorage.
   - **Back button**: `App.addListener('backButton', …)` calls the session's back handler
     (`Session.handleBack()`, the same path as the browser's Back) and calls `App.exitApp()` when the
     Title shows with no dialog open.
   - **Lifecycle**: `App` `pause`/`resume` → pause and audio suspend/resume.
   - **Haptics**, **Share** (files through Filesystem), **Status bar** (overlay the web view; hide
     in play) and **Splash** (hide after the first frame).
3. **Android 15 edge-to-edge**: apps targeting SDK 35 draw under the system bars, and older
   Android WebViews report no `env(safe-area-inset-*)`. Either let the shell inset the web view
   (Capacitor's `adjustMarginsForEdgeToEdge`) or feed the real insets into the `--safe-top/right/
   bottom/left` properties on `<html>` (as `simulateSafeArea()` in `platform/safeArea.ts` does);
   the DOM layout and the canvas both read them.
4. **No service worker in native** (`canRegisterServiceWorker()` already returns false there).
5. **Share links**: a native page has no web address, so challenge links use `VITE_SHARE_URL`
   (committed in `.env`); set it to the public web build's URL.
6. Portrait only (Info.plist, AndroidManifest), icons and splash via `@capacitor/assets` from
   `public/icons/icon-1024.png`, then `npm run build && npx cap sync && npx cap open ios|android`.

## Deploy to GitHub Pages

1. In the repository: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Push to `main`. `.github/workflows/ci.yml` runs the checks (typecheck, unit tests, sim check,
   single-file build, e2e); only when they pass does it build `dist/` and deploy it to Pages. You
   can also run it by hand (Actions → CI → Run workflow) on `main`. Pull requests are checked, never
   deployed.
3. The Pages build sets `VITE_SHARE_URL` to the site's own address, so challenge links always point
   at the published game. Builds elsewhere use the value in `.env`.

## Credits

- All art is procedural: drawn with Canvas 2D paths and inline SVG at runtime; the app icons are
  rendered from the same SVG art (`npm run icons`).
- All sound and music are synthesized at runtime with WebAudio; there are no audio files.
- No runtime dependencies. Built with [Vite](https://vite.dev),
  [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev) and
  [Playwright](https://playwright.dev).
