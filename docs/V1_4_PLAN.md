# SHADY v1.4: UI/UX and gamification

User request: "Completely enhance the UI/UX and gamification." Same house rules as v1.3: biggest
player-facing gain per line, compact code, no runtime dependencies, deterministic core untouched.

## 1. The loop (what a player feels)

One coherent progression loop instead of parallel systems:

- **Play** a Journey level (or Endless/Daily) → earn **Snow** (currency), **stars** and **XP**.
- **XP fills the Sun Rank.** Every rank up pays a reward; every 5th rank pays a **Snow Globe**.
- **Snow Globes** are the reward chest: a reveal overlay where the globe shakes and opens to show a
  cosmetic the player doesn't own (or Snow when everything is owned). Sources: every 5th rank,
  completing a Journey chapter (all 10 levels passed), all three missions done, day 7 of the daily
  streak, star milestones.
- **Daily streak**: a 7-day reward calendar claimed from the Title (day 1 small Snow … day 7 a globe).
  Missing a day resets it (one free "frozen" day per week keeps a streak alive). Replaces Morning
  Snow; Sunny Week may fold into it.
- **Missions**: three at a time; finishing all three pays a globe. Progress shows in-run when a step
  lands.
- **Trophies** (the achievements) live in the Profile with progress bars and tiers.
- **Progressive disclosure**: a first-time player sees the Title with Play only. Features unlock with
  a celebration: Endless after level 3, Missions after level 5, Wardrobe at the first globe or Rank 2,
  Daily after level 8, Profile at Rank 2 (thresholds are the meta builder's call; e2e and testing
  must be able to bypass: Settings → Unlock all levels (testing) also unlocks every feature, and so
  does any save that already has progress past the threshold).
- **Claim dots**: the Title tray and Profile show a dot with a count for anything waiting (globes,
  daily reward, new trophies, new wardrobe items).

Balance guard: Snow income must stay roughly where it is (wardrobe prices unchanged); XP is a new
axis, globes mostly give cosmetics.

## 2. Contract (already on the base commit; shapes are fixed)

- `src/meta/gamify.ts`: `Feature`, `Reward`, `RankView`, `Claimables`, `GamifyOutcome`,
  `rankView(save)`, `claimables(save)`, `featureUnlocked(save, f)`, `featureHint(f)`. Bodies are
  `V14-SHIM` stubs owned by the META builder. More exports may be added.
- `RunOutcome.gamify?: GamifyOutcome` (meta fills it in `applyRunResult`; it may become required).
- `src/ui/gamify.ts`: `rankBadge(ctx)`, `xpMeter(ctx)`, `claimDot(el, n)`, `revealRewards(ctx,
  rewards)`. META owns the bodies and their CSS; UX places them.
- `src/ui/screens/profile.ts`, ScreenId `'profile'` (title ↔ profile; profile → wardrobe/journey).
  META owns the screen.
- `UiCallbacks.updateSave(change)`: apply a pure meta change and persist (the session and the lab
  implement it). Use it for claims, globe opening and "seen" marks.
- `UiSoundName` gains `reward`, `rankUp`, `open`, `claim`, `tick` (the session maps them to the
  buy chime for now; GAME gives them their own recipes and haptics).
- Save: META bumps the save to v4 with a migration (keep v3 → v4 lossless; old saves with progress
  get their features unlocked and XP back-filled from lifetime stats).

## 3. Ownership

| Builder | Owns |
|---|---|
| META (gamification) | src/meta/**, src/ui/gamify.ts, src/ui/screens/profile.ts, src/ui/screens/missions.ts, a new src/ui/gamify.css (imported from src/ui/gamify.ts), meta unit tests, e2e for profile/rewards |
| UX (menus) | src/ui/** except META's files, ui.css, index.html, public/**, src/main.ts, src/platform/** (not haptics.ts), UI e2e specs, README.md |
| GAME (in-run UX) | src/game/**, src/render/**, src/audio/**, src/platform/haptics.ts, their tests and e2e specs |

Cross-area edits: smallest possible, additive, listed in the report. UX places META widgets with
plain calls (`rankBadge(ctx)`, `claimDot(btn, claimables(save).globes)`, `revealRewards(...)` after
the Results settle, `featureUnlocked` to hide/lock tray buttons) and never styles their insides.

## 4. Per-builder goals

**META.** Implement §1 and the contract: XP rules and rank curve (fast early ranks: rank 2 within the
first 2-3 runs), rank names, rewards table, globes (save field for unopened globes, `openGlobe`
pure function with a seeded pick so tests are deterministic), daily streak with claim, missions
all-done globe, chapter-complete globe, feature unlocks, claimables, seen-marks, save v4 + migration,
the Profile screen (rank road with upcoming rewards, trophies grid with progress, collection N/M,
stats), the reveal overlay (big, juicy, skippable, reduced-motion friendly), the XP meter and rank
badge. Unit tests for every rule. Retire whatever the new loop makes redundant (Morning Snow, maybe
Sunny Week and the Journal: merge the Journal's useful parts into the Profile).

**UX.** Make every menu feel like a polished hit mobile game: a consistent visual system (type scale,
spacing, colour tokens, elevation, one button family, icon sizes), screen transitions with motion
that respects reduced motion, pressed/hover/focus states, number count-ups, empty states, toasts.
Title: Play-first with progressive disclosure (locked features show a lock and the hint; a newly
unlocked one gets a "NEW" ribbon and pulse), rank badge, daily-streak button, claim dots. Results:
XP meter under the stars, then `revealRewards` for `outcome.gamify.rewards` after the stars land,
so the order is stars → XP → rewards → buttons. Journey: chapter banners with a chapter-complete
state and the globe icon for the chapter reward. Wardrobe: collection N/M, rarity, "new" dots,
better try-on. Settings: grouped and short. Accessibility: focus order, labels, contrast, 44 px
targets, keyboard. Check 360x640, 390x844, 1280x800.

**GAME.** In-run UX: HUD clarity and hierarchy (what matters at a glance on a phone), mission
progress toasts in-run ("Mission 2/3 ✓") without covering Nubs, a combo/multiplier readout that
feels rewarding, a near-miss and comeback moment, a stronger level-intro card (goal + star rules
icons), a pause screen that shows the level's goal and stars-so-far, the first three levels'
contextual tips. Audio: recipes for `reward`, `rankUp`, `open`, `claim`, `tick` (and remove the
session's V14-SHIM mapping), haptics for them. Keep perf.

## 5. Gates (each builder, then the integrator)

typecheck; vitest; `node scripts/sim.ts --check --seeds 40` (META and GAME must not change sim
results); `PW_PORT=<port> npx playwright test` on the specs you touch, the full suite before the
report; `npm run build:single` (budget: +25 KiB over 543 KiB). Screenshots at 360x640, 390x844 and
1280x800 for every screen you changed, looked at. No `V14-SHIM` left in your own files at the end.
