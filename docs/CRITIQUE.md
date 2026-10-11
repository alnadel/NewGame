# SHADY: Design critique (pre-implementation review)

> Produced by an adversarial design review before any code was written. `docs/V1_PLAN.md` records how each item was resolved.

## Verdict

Build it, but not as written. The core toy works: one swipe swings every shadow in the world, the time of day is the difficulty curve, noon is the boss, and the score is the time of day you reached. It can be built procedurally to a high level of polish. The verb is not new, though: Shadow Vamp (2013), Cast By Light and Wandering Shadows all rotate light to shade a character. What is fresh here is the auto-walking endless run, the elevation clock, clouds used as long levers, and glare.

Three things must change before anyone writes code:

1. **Sun control is broken in the spec.** The pseudo-code in sun.ts and takeFrames breaks the two core skills:
   - Catching a coasting sun snaps it backward toward a stale target.
   - A fast swipe is cut short when the finger lifts.
   - Depending on how the release frame is read, either inertia never runs or the last drag movement is lost.
2. **Swipe-anywhere collides with OS gestures.** iOS home-bar swipes, Safari edge-back, and Android back/app-switch swipes will throw players out mid-noon.
3. **Scope is 3-4x what can be polished.** Cut to a vertical slice and gate it on the first 60 seconds feeling great on a phone.

The major problems to fix:

- **Readability.** Nubs is drawn 8-22 u above the points the game tests for shade. The perimeter dial is far from Nubs and its scale is uneven: about 1 px per degree on the sides and 9 px per degree on top. A ring dial around Nubs fixes both.
- **The difficulty curve inverts after Day 6.** Days get shorter while every other number stays fixed, so later days get easier per minute and expert runs never end.
- **The validator does not keep its fairness promise:**
  - After a fork it carries on only from the Safe Lane, so Frost Lane players get unchecked stretches.
  - Mirroring a caster removes shade from chunks already checked.
  - Rescue trees and the parked-cloud fallback only work at some sun heights.
  - Each chunk is checked in one blocking pass, which can stall frames at noon.
  - It assumes a player with perfect foresight and no reaction time.
- **Determinism leaks:**
  - The `**` operator is not banned, and day length uses 0.9^(N-5).
  - Release speed is quantized only in replays, not in live play.
  - The state hash includes how far world generation has run, which depends on frame timing.
- **Tooling and platform:**
  - I confirmed in this repo that Node crashes on type-only imports unless `verbatimModuleSyntax` is on.
  - `@types/node` is missing.
  - Touch pointerdown does not unlock audio, so the first run is silent.
  - Safari deletes all saved progress after 7 days without a visit.
- **First run:** most first runs will die at noon (0:24-0:32) and never see the night, the best moment in the game.

**Session 10:** gentle tuning ended at run 3, and at run 6 the guide disappears from Day 2. That is the same day glare first appears, so players hit a difficulty cliff. Bring in glare with the guide still visible, and fade the guide out over runs 6-10.

**Day 7:** every run replays an easy Day 1, there are only two biomes, the cosmetics run out of things to buy at about 1,890 Snow, and Long Night is strictly worse than no charm. A start-at-dawn option for reached days, a ramp that keeps rising after Day 6, and a real upside for Long Night fix most of it.

With the critical and major fixes in place, this is a credible, original-feeling, healthy one-more-run game.

## First-minute walkthrough

**-0:05, Title (silent).** The player sees a pastel dawn, Nubs sweating in a hut's shadow, and the sunglasses sun swaying ±25°. "SHADY" sits on top, and a ghost thumb swipes over "drag" just above six round icons. The Daily icon has an unread dot.

*Bounce #1.* Many players tap, because tap-to-start is the convention. Nothing happens: the hold phase only ends on `down && dTheta != 0`. Others put their thumb where the ghost thumb is and land on a tray icon (Wardrobe or Daily), and end up in a menu.

**0:00, first drag.** An excited swipe across the whole screen turns the sun about 300°. The logo flies off, the clock starts, and Nubs leaves the start-hut shade the tutorial counts on. Steam rises, but there is no sound: the AudioContext was resumed on a touch pointerdown, which does not count as a user gesture, so audio only starts when the finger lifts. The hut is on the left, so the sun glyph sits on the left edge, and dragging right moves it up, not right. The player wonders which way it turns.

**0:01-0:03 (6:00-6:43 AM).** Shadows are 300-520 u long and about a third of all angles are safe, so wiggling finds shade. The "ahh", frost ring and shiver fire. This is the first good moment, if the audio is running. The teal guide is a sliver on the left edge: Nubs is about 100 px from that edge, so the scale is under 2 px per degree. Nobody notices it.

**About 0:03 (6:43 AM).** The left-side casters end and the right-side ones begin. The ghost-thumb hint needs "no drag in the last 1 s", but the player is dragging, so no hint appears. The 3 px chill ring turns amber. The player learns "drag = rotate" by trial. They will sometimes think Nubs is in shadow (his drawn head is) while his feet, where shade is tested, are lit and sizzling.

**0:05.** Three flakes: a bell, a "+1" pop, and maybe a melted flake with a "tss" nobody understands.

**0:08-0:12.** If they found a long shadow, the ×2 badge pops with a cool vignette. It feels good without being understood.

**0:14 (9:21 AM; it can slip later because forks are moved to fit inside one chunk).** The fork shows its chevrons and a "!". Most players don't realise they chose a lane. That is harmless.

**0:19.** The guaranteed overtaker cloud starts 350 u behind Nubs. Only 192 u behind him is visible, so the cloud is off-screen below. Its shadow sweeps in from under the thumb, moving about 4.5 u per px of drag. To ride it, the sun has to sit on the bottom edge, under the thumb. Most players miss it.

**0:23 (11:31 AM).** The NOON banner drops over the clock and the cicadas swell. Shadows shrink to 0.9 of object height, tree trunks become thin lollipop sticks, and only about 20% of angles are safe. A new caster passes every ~0.8 s, often on the other side, which needs a 120-180° handoff.

*Bounce #2.* Most first-timers melt between 0:24 and 0:32 (11:45 AM to 1:40 PM). Even with gentle tuning, full sun empties Chill in 2.5 s. The death itself is charming: hit-stop, slow-mo melt, slide whistle, the guilty sun, the bobbing carrot. It is the best-produced moment they have seen.

**About +1.1 s after death.** The Melt Map pulls up and the line types out: "Melted by You at 12:07 PM, between the Mossy Oak and the Little Hut." The player never saw those names, and at 0.35 scale those objects are 10-20 px specks under or beside a sheet covering 58% of the screen.

*Bounce #3 (mild).* "What's a Mossy Oak?" Still, the "Reach 9:00 AM" mission stamp (+10 Snow) and the big Retry button carry most players on. Retry works about 2.5 s after death, on a new seed, with the clock running at once.

**Runs 2-3.** The rotation clicks for most players. But the hook (night, frost flowers, crickets, the "DAY 2" card at 0:50-0:58) is seen by perhaps 25-35% of first runs, not the 60% target.

**Bounce risks, ranked:**
1. An OS gesture fires mid-swipe: edge-back or the home bar pulls the player out of the game.
2. The first run is silent.
3. Tap-to-start does nothing, or the tap hits a tray icon.
4. Death at noon before ever seeing night.
5. The rotation direction is confusing when the glyph is on the left or bottom edge.

## Issues

### 1. [critical] Sun control state machine (src/core/sim/sun.ts, src/game/input.ts takeFrames)

**Problem.** The §5 pseudo-code breaks both core skills, flick and catch.
(a) During inertia, sun.target stays at the release angle; it is only re-synced when |ω| < 5. A catch mid-coast then makes the `if input.down` branch pull θ back toward that stale target at 600°/s. Catching a 300°/s flick snaps the sun up to about 100° backward.
(b) On release, `target = theta` throws away any drag the sun has not caught up with yet. Example: a 180° swipe done in 120 ms and held 60 ms before lifting ends at θ ≈ 108° (600°/s × 0.18 s), with ω = 0 because the finger was still. The turn stops 72° short.
(c) takeFrames sets `down` on all n frames and puts the release on the last one. If that frame has down = true, the `elif release` branch never runs, so there is no inertia at all. If it has down = false, that frame's dTheta is silently dropped.
(d) The keyboard branch moves θ without updating target, so a held key fights a held finger.

**Fix.** Rewrite sun.ts as explicit states: idle, dragging, chasing, coasting.
- Down edge: target = theta, ω = 0, emit catch if |ω| was > 90.
- Dragging: target += dTheta; θ follows at maxRate.
- Release frame: apply its dTheta first, then enter chasing (keep following the remaining target at maxRate). Hand off to coasting with ω = clamp(release) only when |angleDiff(target, θ)| < 1°.
- Every coast tick and every keyboard tick sets target = theta.
- Add an explicit `up` edge flag to InputFrame. takeFrames marks only the final frame down = false, up = true.

Add sun.test cases:
- a catch mid-coast moves θ by less than 1°;
- a 180° swipe in 120 ms + 60 ms hold ends within 1° of +180°;
- the release frame's dTheta is applied;
- key + finger together never oscillate.

### 2. [critical] OS system gestures vs swipe-anywhere input (input.ts, index.html, Capacitor shells)

**Problem.** The only verb is a horizontal swipe anywhere on screen, and a 180° turn takes 58% of the screen width, so swipes often start near an edge. Several of those swipes belong to the operating system:
- A horizontal swipe on the iOS home-indicator strip (bottom ~25 px) switches apps, including in a standalone PWA.
- A left-edge swipe in iOS Safari goes Back whenever there is history, for example after arriving from a link.
- Android gesture navigation treats left/right edge swipes as Back (leaves the page, or closes the installed PWA) and a swipe on the bottom bar as app switch.

touch-action and preventDefault cannot stop any of these. Being pulled out of the game mid-noon is the worst bounce possible.

**Fix.** 1. Ignore pointerdowns that start within 20 CSS px of the left/right viewport edges or inside the bottom safe inset + 16 px. Put the ghost-thumb hint in a band at 60-85% of screen height.
2. Raise the default gain to about 400° per viewport width, so a 180° turn needs at most ~45% of the width and swipes stay off the edges. Keep the sensitivity slider.
3. When a run starts, call history.pushState({play: 1}). On popstate, pause and push again, so Back pauses instead of navigating away.
4. Capacitor:
   - Android: setSystemGestureExclusionRects over the lower play band (at most 200 dp per edge) plus immersive mode.
   - iOS: preferredScreenEdgesDeferringSystemGestures = .all and prefersHomeIndicatorAutoHidden, via a tiny native plugin. Keep WKWebView allowsBackForwardNavigationGestures = false.
5. Add an e2e test: a drag starting at x = 5 px is ignored, and popstate during play leads to the pause screen.

### 3. [critical] v1 scope

**Problem.** The v1 list includes:
- 12 caster kinds with 3 part types, plus clouds, balloons and glare;
- forks, which need a multi-path validator;
- a deterministic fdlibm port, RLE replays, 4 bots, a sim, golden hashes and e2e tests;
- adaptive music and about 20 synthesized sounds;
- Daily with a calendar, 15 missions with tiers, 14 achievements, 15 cosmetics, 5 charms, Atlas, postcard PNG and challenge links;
- a PWA with a Playwright icon pipeline, and handedness mirroring.

That is 3-4x what an agent can bring to a high level of polish. The likely result is a broad build where everything is half-juiced, and the first 60 seconds, which decide whether the game is a hit, get the least iteration.

**Fix.** Ship a vertical slice first, with a hard gate: the first 60 seconds must feel great on a real mid-range phone.

v1 keeps:
- sun control, shadows, Chill, multiplier and PHEW;
- Meadow and Old Town with tree, oak, cottage, stone, hedge, hut, house, column, wall and arch (the arch keeps the gate moment);
- clouds and gazing balls;
- flakes, crystals and frost flowers;
- the validator without forks;
- tutorial, guide and gentle tuning;
- HUD, death line and Melt Map;
- Daily (3 tries, plain list instead of a stamp calendar);
- share text and challenge link;
- save v1;
- core audio: sizzle, ahh, bell, detent, pad with arpeggio density, noon/night ambience, death;
- juice items 1-14 and 17;
- PWA;
- unit and determinism tests;
- the sim with idle, reactive and oracle bots.

Defer to v1.1:
- forks and the Frost Lane, balloons, stalls, all charms, Atlas, postcard PNG;
- mission tiers (keep 10 missions), achievements beyond 5, wardrobe beyond 6 items;
- RLE replay encoding (keep an in-memory record/replay for tests);
- handedness mirroring, the night music box, debug sliders, the Playwright icon generator.

### 4. [major] Readability: Nubs' drawing vs his shade test points (render/nubs.ts, core/sim/nubs.ts)

**Problem.** The game tests shade at 5 ground points within ±5.5 u of Nubs' feet. The body is drawn centred 8 px up and the head 22 px up, ignoring the 0.25 oblique, so about 70% of the visible snowman sits 8-30 u north of where shade is tested. Players aim shadows at the drawing. They will see Nubs 'in the shadow' (it covers his head) while his feet are lit and he sizzles, and the reverse. This breaks the 'visibly your fault' pillar at the most important spot on screen.

**Fix.** - Draw a ground footprint disc (r 8.5 u) exactly over the 5 test points: frost-white rim when f = 0, wet-dark when lit.
- Compress the sprite to match the oblique: body centre −4 u, head −12 u, overall scale 0.9, so most of the drawing overlaps the footprint.
- Tint the body by which test points are shaded (left/right/front thirds), not by the average, so partial shade reads spatially.
- Add a debug toggle that draws the 5 test points, and an e2e screenshot at f = 0.4.

### 5. [major] Sun dial, safe-arc guide and HUD collisions (render/sunDial.ts, render/hud.ts)

**Problem.** The glyph and guide sit on a rounded rectangle around the screen edge, cast from Nubs. Nubs' x ranges over 80-280 u, so the scale along that path varies about 10x:
- At 360 px wide with Nubs at x = 80, the left edge is 54 px away: about 0.94 px per degree.
- The top edge is about 500 px away: about 8.7 px per degree.

So the same 20° safe window is a 19 px sliver on one side and a 175 px bar on top, and it slides along the edge as the trail curves even when θ is constant. The guide also sits in peripheral vision, far from Nubs, where the eye is.

Occlusion and collisions:
- For θ ≈ 200-340°, the glyph and guide are on the bottom edge, under the thumb.
- For θ ≈ 60-120°, the glyph (r20 core, r60 bloom) lands on the clock and ruler.
- Near 30-60° and 120-150°, it lands on the pause and Snow corners.

**Fix.** Make the main control readout a halo dial around Nubs' ground point:
- A 38 u radius ring (at least 34 px at 360 width) with an even angular scale.
- It carries the sun pointer (never fades; it is the fallback when the thumb covers things), the teal safe arcs (solid = now, dashed = +0.6 s), red hatched arcs for glare angles, and detent ticks while dragging.
- Fade it to 35% opacity when not dragging and Chill is full.

Keep the edge glyph as decoration only. Run its top segment below the HUD band (safe inset + 84 px) and draw the HUD over it. Make the pause button's hit area 48×48 to match the GDD's own 48 px minimum.

### 6. [major] Control mapping (drag right = clockwise)

**Problem.** A horizontal drag becomes a rotation, so the glyph moves with the finger only on the top edge:
- On the bottom edge it moves against the finger.
- On the side edges it moves vertically: drag right moves it down on the right edge and up on the left edge.
- Shadow tips also move up for casters on one side and down for the other.

New players form a positional idea ('drag the sun to the left') that the game contradicts about half the time. The start hut is on the left, which is exactly the confusing case.

**Fix.** Prototype this in milestone 4, before any meta work.

(a) Show rotation as rotation: a curved arrow on the halo while dragging.

(b) A/B test two mappings with at least 5 fresh testers:
- the current relative rotation;
- 'edge-aware': flip the sign when sin θ < 0, with ±20° hysteresis around 0° and 180°, so the glyph follows the finger's direction along whichever half of the dial it is on.

Pick the winner by the share of first-60-second drags whose first 100 ms move Nubs toward shade.

(c) Put the start hut on the RIGHT by default, so the opening glyph sits on the right edge and a rightward drag moves it down, which reads like turning a wheel.

### 7. [major] Difficulty curve after Day 6 (config/days.ts)

**Problem.** From Day 7 on, walk speed (130), caster spacing (75), lateral spread and noon sun height (76°) are all fixed, while daylight shrinks from 45 s to 30 s and night stays at 8 s. Every later day is the same day squeezed into less time:
- about 33% less high-sun exposure per day;
- a full Chill refill every 38 s instead of every 53 s (night grows from 15% to 21% of each cycle);
- cloud timing scales with day length too.

Risk per minute therefore falls after Day 7. A player who clears Day 7 noon tends to keep going indefinitely, which breaks the 5-8 minute expert-run target and turns top players' runs into endurance chores.

**Fix.** Keep daylight at 45 s from Day 6 on, and ramp danger instead. For each day after Day 6:
- caster spacing +4 u;
- latMax +4 u;
- night −0.5 s (minimum 5 s);
- validator floor −2 (minimum 25);
- Old Town gazing-ball interval −1 s (minimum 5 s);
- one fewer cloud per day (minimum 3).

Cap the ramp with a 'heat-wave' noon of 80° from Day 10.

Add sim acceptance targets:
- the oracle's per-day survival probability never increases from one day to the next;
- the reactive bot's p90 death is before Day 8.

### 8. [major] First run: the first night is the hook, but most players won't reach it

**Problem.** All the magic (night, frost flowers, crickets, the 'DAY 2' card, the key change) happens at 50-58 s. The target says 60% of first runs see night. But the spec's own novice bot, which has a 200 ms lag and reads the guide, has a median death of Day 1 11:30 AM. Gentle tuning only cuts drain by 27% (55 to 40/s). Day 1 noon (about 20% safe angles) arrives at 23-30 s, before a newcomer has learned which way the sun turns. Most first-timers will die before the best content.

**Fix.** Give run 0 its own Day 1 profile:
- noon sun height 40° (shadows 1.19× object height at noon);
- drain 30/s;
- a parked overtaker cloud covering 11:00 AM-1:00 PM;
- validator floor 70;
- guide always on.

For runs 1-2, keep drain at 40/s and raise Day 1's noon sun height 40° → 44° → 48°.

Add a sim acceptance test: the novice bot on the run-0 profile reaches night on at least 75% of seeds.

### 9. [major] Title and run start (session.ts, ui/screens/title.ts, step.ts 'hold')

**Problem.** (a) The run only starts on `down && dTheta != 0`, so a pure tap (the usual 'tap to start') does nothing.
(b) The first swipe, often a wild one, both starts the run and spins the sun (a full-width swipe is 310°). Nubs leaves the start-hut shade the tutorial depends on, which assumes 'holding still mostly works'.
(c) The title sway is described as 'the session feeding dTheta', but sun.ts ignores dTheta when down = false, and with down = true the sway would start the run itself.
(d) The six tray icons sit in the thumb's drag zone, right under the ghost-thumb hint. A pointerdown on an icon is swallowed (stopPropagation), so a swipe that starts there either does nothing or opens the Wardrobe.
(e) The spec doesn't say whether Nubs keeps walking during 'hold'.

**Fix.** Start the run on touch, not on drag:
- Any pointerdown or tap on the canvas starts the clock and snaps θ to θ0 (catch semantics; the sway stops).
- Only movement after that rotates the sun.

The sway becomes a render-only θ offset in the session layer, discarded at start; the sim gets θ0 through RunConfig. Freeze Nubs' y during 'hold'.

Tray icons activate on click only (pointerup with under 8 px of movement). A pointer that moves more than 10 px horizontally after landing on an icon is handed to the canvas as the start of a drag. Move the ghost thumb to about 65% of screen height, clear of the tray.

### 10. [major] Death line and Melt Map (core/sim/deathcause.ts, render/meltMap.ts)

**Problem.** - Caster names are never shown in the world, so 'between the Crooked Pine and the Lonely Hut' points at objects the player can't identify.
- At 0.35 scale the trail on the Melt Map is a ~126 px strip, and the results sheet covers 58% of the screen, so most of the 2000 u is hidden and the named casters are 10-20 px specks.
- The 'long way' cause fires on any swing of 150° or more within 1.2 s, even when turning the short way would not have helped.
- 'That cloud was right there' is checked at the instant of death, when Chill is already 0, not when the decision was made.

**Fix.** - Frame the Melt Map on the last ~600 u around the puddle, at about 0.55 scale, inside the area above the results sheet.
- Pin both named casters with callout labels, and draw the 'gap' (the run of lit footprints between them) as a red bracket. The death line then names things the player can see.
- Long way: fire only if the short-direction rotation over the same ticks would have meant at least 0.3 s less time lit. Compute this from the guide masks already being stored.
- Missed cloud: evaluate at tick −60 (1 s before death), using the validator's 240°/s reachability.
- Add deathcause tests for each cause, including a case where it should not fire.

### 11. [major] Validator: fork merge carry (gen/validator.ts)

**Problem.** After a fork the DP continues from C_safe_lane_end only. The Frost Lane is validated to a floor of 15, so a player who took it can leave the merge with 15-30 Chill. The stretch after the merge was validated assuming the Safe Lane's higher end state. So that stretch is not guaranteed survivable for anyone who took the risk the game rewards.

**Fix.** After the merge, set C = the per-angle minimum of C_safe_end and C_frost_end, which is conservative for both lanes. Alternatively, validate the post-merge stretch from both end states and add rescues for the worse one.

Add a test: a crafted Frost Lane that ends at Chill 16, followed by a hard noon segment, must trigger a rescue.

### 12. [major] Validator: the demand rule's mirroring can break validated chunks

**Problem.** The safety argument is: 'adding casters only ever adds shade, so earlier validated chunks stay valid'. Mirroring a caster also removes shade from its old position. Between 8 AM and 4 PM shadows still reach 250 u or more (at 8 AM on Day 1, a 130 u stone casts 255 u). So mirroring a caster in chunk k can make chunk k−1, already validated, infeasible. The mirrored caster can also break fork or clearance rules on the other side of the trail.

**Fix.** Store the DP carry at the entry of every chunk. Any edit that removes shade (a mirror) in chunk k re-runs validation from the entry of chunk k−1; rescues added there only add shade, so it converges.

Alternatively, apply the demand rule at placement time, before chunk k−1 is validated, using a cheap scan for the longest run of full shade at a single angle over chunks k−1 to k+1.

Re-run the clearance loop after any mirror, and cancel the mirror if it fails.

### 13. [major] Validator performance and frame hitches (gen/validator.ts, game/loop.ts idleWork, bots)

**Problem.** Each chunk is validated in one pass that cannot be split. Near noon, any prism in reach that is larger than its shadow length needs exact per-angle tests: about 80 angles × 5 points × several parts × 70 steps. Each rescue re-validates the whole chunk (up to 9 passes), and each mirror up to 3 more. Worst case is tens of milliseconds on a Pixel 4a-class phone, exactly in the noon chunks. That work runs either in idle time, which cannot split a chunk, or inside step() as the hard guarantee. Either way it stalls frames at the boss moment.

The oracle bot also recomputes masks every 6 ticks, so `sim:check` (50 seeds × 8 days) would take many minutes.

**Fix.** 1. Make validateChunk resumable: a cursor over the 0.1 s steps that carries the DP state, run in slices of at most 2 ms per frame. Keep DP snapshots per step, so a rescue at y re-runs only from y minus the longest shadow reach at that sun height.
2. Cache each step's per-angle lit values on the chunk (Uint8, 360 bytes per step per lane). The oracle, the novice bot and the debug overlay read these instead of recomputing.
3. Generate 3 chunks ahead (y + 1900). Pre-generate chunks 0-4 of the next seed while the Results screen is up.
4. Keep the in-step hard guarantee as a fallback that logs a perf warning.

If generation ever moves to a Worker: build:single deletes non-inlined assets/*.js, so the worker would need `?worker&inline`.

### 14. [major] Validator vs a real human (fairness pillar)

**Problem.** Feasibility assumes perfect knowledge of all 360 angles and an instant 240°/s turn with zero reaction time. At noon on Days 4-5 (shadows 0.25-0.32× height, walk speed 100-110), the oracle's path can require a 120-180° switch every ~0.5 s. Each is technically possible, but a human needs about 250 ms to react plus about 300 ms of thumb travel. The floor (35-40 Chill) is the only margin for human limits, so 'every stretch is survivable' will feel false exactly when players are most stressed. The bots also read the full masks, so the bot targets overstate human perception.

**Fix.** Add a human model to the DP:
- turn rate 180°/s;
- an angle counts as shaded only if it stays shaded for at least 3 consecutive steps (0.3 s);
- a switch budget: the path may need at most one reversal of 90° or more per second; if it needs more, insert a rescue.

Report 'required reversals per noon' from the sim, and tune spacing until its p90 is at most 1 per second on Days 1-5. Give the novice bot partial perception, for example only the guide band nearest its current angle.

### 15. [major] Validator fallbacks: rescue tree and parked-cloud geometry

**Problem.** A rescue tree's canopy shadow lands 75·cot ε from the trunk (ε = sun height). With the trunk about 20 u from the path, the canopy can only cover the failure point when that distance is about 20 ± 24 u, which means a sun height of roughly 59° or more.
- At 9 AM on Day 3 the canopy shadow is 66 u from the trunk, and at Day 1 noon 67.5 u. A tree placed 20 u past the failure point cannot shade it there.
- The 8×8 trunk can only fully cover the 5 test points at angles near 45°.

When the tree can't help, the loop uses up all 8 rescues.

The parked-cloud fallback sits 0.7·R from the path, where R is the cloud's shadow offset. At Day 1 noon (R = 270) it would need a cloud radius of at least 81 u; no cloud is that big (rx ≤ 80, ry ≤ 53). The fallback is accepted without re-validation, so the stretch can stay infeasible.

**Fix.** Place rescues analytically:
- Preferred: a 30×30 prism (a 'Shade Rock', height max(60, 40·tan ε + 20)) beside the failure point at lateral 16. Its shadow starts at its own footprint, so it covers the failure point over a wide angle band at any sun height.
- Or: a tree at the failure point's y ± sqrt(R² − lat²), with R = 75·cot ε.

Park the fallback cloud at a distance of exactly R (for the sun height at the failure time) from the path, and re-validate after inserting it.

Also take drain, regen (20 or 30) and max Chill (100 or 130) from dayParams(charm) instead of hard-coding 55/30/100. Snowball's regen is 20, so with the current constants its worlds are under-checked.

### 16. [major] Determinism: the ** operator and pow (architecture.test.ts, config/days.ts)

**Problem.** The forbidden list bans Math.pow but not the `**` operator, which has the same engine-specific rounding. The obvious way to write day length, Dl(N) = 50·0.9^(N−5), is `0.9 ** (N - 5)`. Dl drives the time↔y mapping, the sun height, forks and generation. A one-bit difference between V8 and JavaScriptCore changes every hash after that, so the same Daily or challenge seed can produce different worlds on Android and iPhone.

**Fix.** - Add `**` to the forbidden tokens in architecture.test.ts, along with float math done through strings (toFixed or parseFloat of computed values).
- Compute 0.9^n by repeated multiplication, or store a literal day-length table in days.ts.
- Make the WebKit e2e determinism project (SHADY_E2E_WEBKIT) a required pre-release check, not an optional one.

### 17. [major] Determinism: replay and hash mismatches (replay.ts, hash.ts, input.ts)

**Problem.** (a) Live play passes the raw float release velocity to the sim, but replays store it quantized to 1/64 °/s. A recorded run and its replay therefore diverge after the first flick.
(b) hashState includes caster count, rescue count and world.lastValidatedChunk. Those depend on how far idle-frame generation has run, which depends on frame timing, not on the tick. Live and headless hashes then differ even when gameplay is identical.

**Fix.** - Quantize dTheta and release in input.ts before they reach the sim, so the sim sees exactly what the encoder stores.
- Hash only state determined by the tick: Nubs, sun, Chill, multiplier, Snow, pickups taken/melted, plus a canonical hash of the casters with y < nubs.y + 1600 (the hard-guarantee horizon), sorted by id.
- Show world-generation progress separately in the debug overlay.

### 18. [major] Tooling: Node type stripping and @types/node (tsconfig, scripts/*.ts)

**Problem.** Checked in this environment (Node 22.22): with T declared as an interface, `import { T, v } from './types.ts'` crashes `node main.ts` with "does not provide an export named 'T'". Node strips types without removing type-only imports. So every scripts/*.ts (sim, golden, gen-icons) will crash on its first type-only import from core.

Also, @types/node is not installed and tsconfig's `types` is only ["vite/client"]. Adding "scripts" to `include` will fail the typecheck on process and node:fs.

**Fix.** - Add "verbatimModuleSyntax": true to tsconfig, which forces `import type` / `import { type X }`, alongside the planned allowImportingTsExtensions and erasableSyntaxOnly.
- Add @types/node as a devDependency, plus a tsconfig.scripts.json with types: ["node"] that the typecheck script includes.
- Add a CI smoke step: `node scripts/sim.ts --seeds 1 --days 1`.

### 19. [major] Audio unlock on touch devices (audio/engine.ts)

**Problem.** The AudioContext is created and resumed on the first pointerdown. Under the browser user-activation rules, a touch pointerdown or touchstart does not count as a user gesture; for touch, only pointerup and touchend count (mousedown and keydown count for mouse and keyboard). On Android Chrome and iOS Safari the context therefore stays suspended for the whole first drag, so the first run is silent (the title-to-play moment, the first 'ahh', the bells) until the finger lifts, if it resumes at all. iOS can also return the context as 'interrupted' after a phone call or Siri.

**Fix.** - Call ensureAudio() (create if needed, resume(), play a 1-sample buffer) on pointerdown, pointerup, touchend, click and keydown until ctx.state === 'running', then remove those listeners.
- Call ensureAudio() synchronously inside the Resume button handler, and again on the next gesture after the page becomes visible.
- Show a small muted icon in the HUD while audio isn't running.
- Add an e2e assertion that ctx.state === 'running' after the first drag.

### 20. [major] Save persistence on iOS Safari (platform/storage.ts)

**Problem.** When played in Safari rather than from the Home Screen, WebKit's tracking prevention deletes all site storage (localStorage and the service-worker cache) after 7 days without the user visiting the site. A player returning on day 8 loses their Snow wallet, cosmetics, bests and Daily calendar. That is the worst outcome for a retention design built on collections. Safari tabs and the installed Home Screen app also keep separate storage.

**Fix.** - Call navigator.storage.persist() after the first completed run.
- On iOS, prompt 'Add to Home Screen' after run 3, using a custom sheet with instructions.
- Add a Settings > Backup code option: export/import the save as a base64url string of compressed JSON, copied to the clipboard. Offer it on the results screen the first time the player reaches night.
- In Capacitor, keep Preferences as the main store, as already planned.

### 21. [major] Challenge links, the growth loop (score/challenge.ts, session.ts)

**Problem.** (a) The endless code {k, seed, m, s} leaves out the charm. World generation depends on the charm (Long Night changes sun height and rescues; Snowball changes max Chill and regen in the DP), so the friend can get a different world.
(b) A brand-new recipient (lifetimeRuns = 0) hits a conflict: tutorial overrides and gentle tuning either change the seed's world, or are skipped and the newcomer gets no onboarding.
(c) On iOS the link opens in Safari, not in the installed PWA, which has a separate save, so returning players also look new.
(d) The example "m":1180 doesn't match 'Day 2 · 2:40 PM' (1240) or 'Day 3 · 2:40 PM' (1960); 1180 is Day 2 · 1:40 PM. Exact-string tests copied from the GDD will be wrong.

**Fix.** - New code format: {k, seed or d, c: charm, m, s, v: 1}. A challenge always runs with that charm, gentle = false and tutorial = false.
- If lifetimeRuns = 0: play the tutorial run first while keeping the banner ('Warm-up, then beat Ana: Day 2 · 2:40 PM'), and make Retry on that results screen launch the challenge. Show a small 'Played before? Skip warm-up' link.
- Fix the example to m = 1240, and generate the GDD's examples from the code.

### 22. [major] Long Night charm has no real upside (content.ts charms)

**Problem.** Night distance is always 8 × walk speed, whatever the night's length, and frost flowers spawn every 60 u. A 12 s night therefore yields exactly the same number of flowers. Chill already refills to max at every dawn. The 'upside' is cosmetic, while the downside (+3° noon sun height every day) is real, so the charm is strictly worse than no charm.

**Fix.** Give it a real upside that fits the theme, for example:
- frost flowers every 30 u while equipped, plus
- 'Moonchill': start each dawn 30 Chill above max, with the extra decaying at 5/s.

Or: the multiplier gains +1 each night.

Have the sim report median Snow and median death time per charm, and require every charm to win on at least one of those.

### 23. [major] Session 10 and day-7 retention: every run replays Day 1

**Problem.** - An expert run lasts 5-8 min, but the first ~2 min (Day 1 and Day 2 mornings) are trivial for them.
- Only 2 biomes alternate, and every mechanic has been seen by about run 10.
- At run 6 the guide disappears from Day 2, the same day glare first appears: a difficulty cliff.
- After the wardrobe is bought out (1,890 Snow, about 40-60 runs), Snow has no use.

By day 7 a player replays the same two easy minutes before every meaningful decision, and the Daily is the only fresh content.

**Fix.** - Add 'Dawn Start': once you have reached Day N, you may start a run at the dawn of Day min(N−1, 4). This is fair because every dawn resets Chill to max and the world is seeded, so the headline time stays comparable; only Snow is lower. Shares say 'from Day 3'.
- Fade the guide on Day 2 over runs 6-10 instead of removing it at run 6.
- In v1.1, add repeatable Snow sinks (scarf dyes, Melt Map frames), and make a third biome from the Later list the first post-launch content.

### 24. [major] Glare readability (gazing balls)

**Problem.** The glare spot sits up to 300 u from its ball, on the sun side, and moves opposite to the shadows. During a 120-180° rescue swing it sweeps a 300 u-radius arc across the screen at up to ~3000 u/s, so it hits Nubs for a few ticks at double drain (110/s) from somewhere the player wasn't looking. 'Glared by the Fancy Gazing Ball' may then name a ball that is off-screen.

**Fix.** - Show glare angles on the halo dial as red hatched arcs, even when the guide is off.
- Draw a faint ghost of the glare spot's path while dragging.
- Limit the glare offset to 160 u so the spot stays near its ball.
- Add a teaching beat on the first Old Town day: place the first ball so its glare crosses the trail around 9-10 AM, with an obvious alternative angle.

### 25. [major] HUD top band and clock (render/hud.ts)

**Problem.** The top HUD (DAY label, 28 px clock, ruler) takes about 80 px below the safe inset and hides about 80 u of the 408 u look-ahead; at walk speed 130 that leaves about 2.5 s of preview. The clock's minute digits change about 14 times per second (14.4 in-game minutes per real second), which is constant flicker at the top of vision.

**Fix.** - Show the in-play clock in 10-minute steps, so it changes every 0.69 s; show exact minutes only on death and on the results screen.
- Make the HUD one compact row: '2:40 PM' to the left of the ruler, with 'D2' as a badge.
- On tall screens (view height > 760 u), place Nubs at 70% from the top to win back look-ahead.

### 26. [minor] PHEW reliability and farming

**Problem.** Below 15 Chill, full sun at 55/s kills in at most 0.27 s, so the GDD's 'a PHEW is likely here' at noon is unlikely for a first-timer. Meanwhile a skilled player can hover at 10-15 Chill using partial shade, re-entering full shade every 3 s for +3 Snow plus slow-mo.

**Fix.** Arm PHEW only if Chill fell from 40 or more within the last 3 s, and re-arm it only after Chill recovers above 50. Raise the threshold to 20 for runs 0-2.

### 27. [minor] Flake melt window (pickups.ts)

**Problem.** At Day 1 noon (about 20% safe angles), flakes enter the 280 u melt window 4 s before Nubs reaches them, and almost all of them melt. The result is a stream of 'tss' sounds, and Snow income depends on the time of day more than on skill.

**Fix.** - Make the melt window time-based: 1.6 s ahead of Nubs, with a 1.0 s melt budget, so flakes near Nubs share his shade. *(Resolved: the time-based window shipped; wave 3 restored the GDD's 1.2 s budget, V1_PLAN §5.4.)*
- Limit the 'tss' sound to 3 per second.
- Tune mission 10's threshold using the sim's flake stats.

### 28. [minor] Clouds covering Nubs (render/floaters.ts)

**Problem.** A 120-160 u white cloud at 0.55 opacity, drawn 75 u up, often sits over Nubs and his shadow when the sun is high (on Day 5 at noon, a cloud is only useful when it is 30-120 u from Nubs). It washes out the most important pixels on screen.

**Fix.** Fade the cloud body to 0.2 opacity within 70 u of Nubs' screen position or wherever it overlaps the halo. Draw clouds as a soft rim with a light interior.

### 29. [minor] 'Long Way Round' achievement is impossible

**Problem.** Inertia alone can carry the sun at most (360 − 5)/3.5 ≈ 101°, or about 178° with Sundog. An inertial flick of 270° or more cannot happen.

**Fix.** Redefine it as 'drag plus coast of at least 270° within 0.8 s, ending with Nubs in full shade', or as 'a coast of at least 90° that ends in full shade'.

### 30. [minor] Daily Solstice for newcomers, and try accounting

**Problem.** The Daily button shows an unread dot from run 1. The Daily forces the charm of the day (today, #284, it is Sundog; other days Long Night or Ice Heart) and never uses gentle tuning, so a newcomer gets a harsh, unfamiliar run.

A try is counted at 6:30 AM, but if that count isn't saved at that moment, force-quitting a bad run refunds the try.

**Fix.** - Unlock the Daily after run 3 or after the first night, and show a one-card explanation of the charm of the day. *(Resolved: v1 has no charms, and the Daily unlocks after 3 completed runs, V1_PLAN §11.3.)*
- Save the try increment immediately at 6:30 AM.
- Save the run's best time to the Daily entry every in-game hour, so quitting the app counts the try along with the progress made.

### 31. [minor] Share glyphs (score/share.ts)

**Problem.** U+1F7E6 (blue square) and U+1F7E8 (yellow square) are both squares, so the GDD's claim that 'the glyphs differ in shape as well as colour, so the strip is colourblind-safe' is false for the two most common glyphs.

**Fix.** Use U+2744 U+FE0F (snowflake) for cool hours, which also fits the brand. Keep the yellow square for warm hours, fire for hot hours and the droplet for the melt hour, and update the share tests.

### 32. [minor] Time from death to the next run vs pillar 4

**Problem.** Earliest possible retry: 1.1 s of dying animation, then the panel at +1.2 s, then a 0.6 s lockout, about 2.3-2.9 s after death. The pillar promises a retry in under 1 second.

**Fix.** - A tap during the dying animation skips straight to results with Retry active.
- Retry becomes active 0.3 s after results appear.
- Add an e2e check that death to control takes at most 1.5 s.

### 33. [minor] Multiple pointers and pointercancel (input.ts)

**Problem.** Secondary pointers are ignored, so players who use both thumbs can't flick with one and catch with the other. Also, a pointercancel (for example when an iOS system gesture takes over) would compute a release speed and send the sun spinning.

**Fix.** Latest pointer wins: a new pointerdown takes over and counts as a catch. Treat pointercancel as a release with ω = 0.

### 34. [minor] Fork preview window (forks.ts)

**Problem.** The preview window is fixed by distance: 100 u, which is only 0.77 s at walk speed 130 to read the chevrons and react. Fitting the fork inside one chunk can also push it up to about 330 u (4.7 s) later than the scheduled time.

**Fix.** Make the preview window time-based (1.6 s). Let fork windows cross chunk boundaries; the lane-aware validator already handles lanes.

### 35. [minor] Caster clearance vs trail width (placer.ts)

**Problem.** The clearance (14 u) is smaller than the trail's half-width (15 u), so buildings overlap the drawn trail ribbon and Nubs (radius 11) brushes walls with a 3 u gap.

**Fix.** Raise clearance to 20 u, with gate-arch posts at trailX ± 34. Re-run the clearance test on seeds 1-100.

### 36. [minor] Shadow union winding (render/shadowLayer.ts)

**Problem.** The one-fill union with the nonzero rule only works if every subpath has the same winding in device space. Under the y-flipped world transform, arc and ellipse subpaths and the CCW hull polygons can end up with opposite windings, and overlapping shadows would then punch holes in each other.

**Fix.** Derive the arc/ellipse direction flag from the sign of the transform's determinant. Add a Playwright pixel test where two overlapping shadows (a prism and a disc) must show no hole.

### 37. [minor] PWA service worker (vite.config.ts shadySW, sw.js)

**Problem.** - build:single still runs shadySW, so dist-single/sw.js precaches assets/*.js files that inline-build deletes. If that folder is ever hosted, addAll hits a 404 and the service worker never installs.
- The fetch handler caches non-ok responses.
- VERSION is built from file names and sizes, so a same-size change to a public file doesn't trigger an update.

**Fix.** - Skip the plugin when outDir is dist-single (or when an env flag is set).
- Only cache responses with res.ok and type 'basic'.
- Compute VERSION from a hash of file contents.

### 38. [minor] Tooling: Playwright browsers and icon generation

**Problem.** There is no Playwright browser cache in this environment (~/.cache/ms-playwright is missing). Both `npm run e2e` and gen-icons (which drives Chromium) will fail until `npx playwright install chromium` succeeds through the proxy.

**Fix.** Remove gen-icons' dependency on a browser: commit a hand-written SVG and rasterize the 192/512/180/1024 PNGs with a ~150-line Node PNG writer (node:zlib) that only draws circles and rectangles. Run e2e only when a browser is installed, and document the install step.

### 39. [minor] Haptics during drags (platform/haptics.ts)

**Problem.** A 5 ms vibration per detent at up to 20 per second becomes a continuous buzz on Android, where many motors can't do less than 10-20 ms. It is annoying and drains the battery.

**Fix.** Vibrate on detents only every 45° and at most 8 times per second, with none while the sun is turning faster than 300°/s. Keep the click sound and the visual tick for every 15°.

### 40. [minor] Fast sweeps of dawn shadows (photosensitivity and legibility)

**Problem.** At dawn, 520 u shadows turning at 600°/s sweep across the screen at about 5000 u/s. Wiggling the sun causes large-area brightness swings of 42% faster than 3 Hz, against the spirit of the GDD's own flash rule, and the scene can't be read during the sweep.

**Fix.** Cap the follow rate at 450°/s while the sun is below 15°, and ease the shadow layer's opacity toward its target over about 40 ms during fast sweeps.

### 41. [minor] Mission 13 (gate arch at noon) depends on luck

**Problem.** Gate arches are 10% of arches and arches are 15% of Old Town casters, so the chance one falls between 11 AM and 1 PM is about 17% per Old Town day. Players face a random wait.

**Fix.** Always place one gate arch on Day 2 between 11:00 AM and 1:00 PM, at a fixed position in that day's chunk.

### 42. [minor] Originality and positioning

**Problem.** The core verb has precedents: Shadow Vamp (iOS, 2013: a wheel rotates the island so a vampire can dart between shadows; https://toucharcade.com/community/threads/shadow-vamp-a-sunny-vampire-tale-by-gamesmold.200855/), Cast By Light (a rotating dial shapes shadows to protect the hero; https://game.speldesign.uu.se/projects/arcade-games/cast-by-light/) and Wandering Shadows (rotate the sun to form shadow paths; https://hebeki.itch.io/wandering-shadows). None is a famous hit, but 'turn the sun' alone is not a new verb.

**Fix.** Lead the pitch and store page with what is new: the time of day is the score, noon is the boss, the sun's height changes shadow length through the day, clouds act as long levers, and glare is a second hazard. Make the noon boss the signature moment (banner, music, cicadas), and keep avoiding the vampire framing.
