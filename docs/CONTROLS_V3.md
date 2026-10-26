# SHADY Controls v3: one drag, one button

User request (verbatim): "it is quite rather hard to do the some with touchs while swing and hold and
so on. Take a huge take to see to enhnace the UX and control gretly. feel free to change the core
gamplay and mehcaninc if needed. the goal is to make the gamplay and control streamlined and easy to
use yet maybey have challanges in later levels. but nothing about control being clucnky"

Lead direction (binding): one thumb, two gestures everywhere. **Drag** anywhere in the world moves
what matters on this leg. **Tap the button** acts, and the game picks the target and the moment.
Nothing needs a hold, a swipe, a flick, a second finger or two inputs at once. Lifting the finger
never surprises you. Later levels get harder through pacing, density, resources and decisions, never
through tighter input windows.

This document is the **binding spec** for Controls v3. It supersedes, for input and controls only:
`docs/ELEMENTALS_V2.md` §1.3, the pointer half of §1.4 and §7.9 (and amends §6.3, §6.4 and §9.3);
`docs/GDD.md` §2.3 ("no magnetic snap"; the gain is 360°, not 310°), §3.2 (flick-and-catch) and §14
(handedness); `docs/V1_PLAN.md` §3.3 (release coasting); `docs/V1_5_PLAN.md` (the swipe-down Cold
Snap); and the Journey's control concepts in `docs/CAMPAIGN_PLAN.md`. Three teams (CORE, ART, UI)
build it in parallel from the contract commits C0a/C0b (§11.1), and the integrator merges them. It
has no open questions. A number written here is the value to ship.

It folds in four measured audits (touch playtest, code, mobile patterns; their scratch scripts are
outside the repo), three designs, two judges and one review round. The winner was the "feel" design;
§14 lists every graft and cut the judges asked for and how conflicts between them were settled, and
§14.1 records what the review changed and which of its proposals were refused.

Design rule added by the review: **aim help finishes the player's moves; it never plays for an idle
player** (§4.1), and **no drag is ever dead**: a drag that starts on the button, or after a stray
contact, still turns the sun (§1.2, §1.3).

---

## 0. In one page

### 0.1 The controls

| Leg | Drag (anywhere in the world) | The button (bottom corner, handed side) | Keys | The sun |
|---|---|---|---|---|
| **Nubs** (Endless, Daily, Journey, Trial Nubs legs) | turns the sun | **Cold Snap** (Journey: from L10, the level that teaches it; a first-run lesson: from the first full meter) | ← → turn · ↑ or ↓ Cold Snap | turns; aim help settles it into shade |
| **Ember** | turns the sun (light refuels) | **Burn**: arms the next wall (walls first, then a puddle); Ember lights it right on time | ← → turn · ↑ burn | turns; aim help settles it into light |
| **Sprout** | turns the sun (light speeds growth) | **Grow**: pours Sap into the next gap or plot; it stops by itself | ← → turn · ↑ grow | turns; aim help settles it onto the growing site |
| **Drip** | steers Drip (finger-exact, unchanged) | none: the corner shows the Size pill and is plain world | ← → steer | held (unchanged) |
| **Gust** | sets the wind vane; it **stays set** when you lift | **Calm**: the vane back to 0 | ← → one notch · ↑ calm | held (unchanged) |

- **Lift = stop.** The sun finishes going where the finger asked and stops. Nothing coasts, and
  there is no catch.
- **Aim help (the magnet).** With the finger up (or resting still), a sun left just outside lasting
  shade glides into it (capture radius 14° early, 10° late, never pulled across glare, never out of a
  gold bud arc, a glass glint, a flare rim or the next element's aim the player chose). It works
  only while you play: within 5 s of your last sun move, never during the first-run lesson, and
  never against a swing you are still making (a 0.25 s re-grip grace, §4.5).
- **The button acts on a still tap**: on the lift, or once the finger has stayed still on it for
  120 ms. A drag that starts on the button turns the sun like a drag anywhere else. The button has
  its own pointer slot, so a press never turns or catches the sun. A press that is not legal yet waits
  300 ms, and a refused press always says why (the buzz only the first time per reason and leg).
- **The game picks the target and the moment** for Ember's burns and Sprout's pours (the policy that
  already proves the Trials). Required targets come first: the wall the button pulses for is the
  wall a press arms. The player decides **whether** and **what to spend**: one tap per wall, one tap
  per bridge, extra taps for bigger trees, how long and which way to blow.
- **A finger held through a hand-off keeps working** with its new meaning, from where it is, and a
  swing's follow-through never becomes a slide or a gale (§1.5).

### 0.2 What changes, what stays, what goes

- **Stays:** every sim rule of `step()`, the `InputFrame` type, `recordFrame` and replays, Retry from
  the Tag Stone, the seven Trials and their pinned salts, the audits (G1) and the existing gates,
  every golden key except two Journey entries (§9.3; a Trial entry moves only through a recorded
  §10.1 lever after the refactor's proof commit), the Drip steer, the sun hold on Drip and Gust legs,
  the Frost Bank, Flow Ring, flares, buds, glass and every v1.6 rule.
- **New:** the **driver** (`src/core/drive/`): a pure, deterministic per-tick policy that turns button
  presses, the vane and the finger state into ordinary `InputFrame`s (verbs with points, the snap
  flag, magnet glides) before `step()`. The action button (drag-through). The vane. Arming and pour
  jobs. The magnet (engagement window, re-grip grace, lesson off) and the sun hand-over. TAG
  re-anchoring. Handedness. Settings for aim help, Swing Boost, button side and Auto actions. Four
  touch bots (`humanTouch`, `reactiveTouch`, `idleTouch`, `mashTouch`) and a parked-sun scan, hard
  gates that run through the driver (idle and parked suns never win, act windows, the touch contract,
  substituted and new teaching levels) and advisory rows.
- **Goes:** flick coasting and the catch tap; the swipe-down Cold Snap and the coin's 350 ms / 12 px
  rule; tap-on-target and the held-back verb slot; the 220 ms hold and the second-finger sun;
  the sideways swipe gust; the latest-pointer-wins takeover; the finger cut at a TAG; the bottom
  +16 px dead zone (the side zones shrink from 20 px to 16 px); the start tap's stray turn; and five
  Journey concepts whose challenge was the controls themselves (Mirror Sun, Slippery Sun, Clockwork,
  Gusts, Heavy Sun).

### 0.3 Words

| Word | Meaning |
|---|---|
| **world slot** | The one pointer that drags (first pointer wins; a still one yields to a new press, §1.2). |
| **button** | The round action button; its pointer slot is separate from the world slot. |
| **act** | What the button does on this leg: `snap`, `burn`, `grow`, `calm` or `none`. |
| **press** | One committed button touch: a still tap (lifted after moving < 12 px) or a touch that stayed within 12 px for 120 ms (or ↑/W, or ↓/S on a Nubs leg). A touch that moves 12 px first is a drag, not a press. |
| **driver** | `createDriver()` in `src/core/drive/`: fills each tick's `InputFrame` from presses, the vane and the state. |
| **pick** | The object the next press would act on (drawn as a ring with a tether to the button). **Required** targets (walls, crossings) come before **optional** ones (puddles, plots). |
| **rest** | A world finger on the sun that has moved < 3 px in the last 300 ms. Aim help treats it as no hand. |
| **engaged** | The last **sun move** (input `downEdge`, `upEdge`, `dTheta ≠ 0` or `key ≠ 0` on a sun leg, after the start beat) was within `engageTicks` (300 ticks, 5 s). Aim help acts only while engaged. Button presses do not count. |
| **arm** | Ember: a pressed target waiting for its ignition moment (at most 2). |
| **job** | Sprout: a pour into one site up to a goal (at most 2: the running one and one queued). |
| **vane** | Gust: the wanted wind in notches −2..2 (`breeze` ±1, `gale` ±2); the driver keeps it blowing with ordinary gusts. |
| **magnet** | Aim help: **settle** (a lit or ending sun glides into lasting shade) and **track** (a sun near an arc's moving edge glides back inside). |
| **hand-over** | The magnet's pre-aim in the last second before a TAG into Drip. |
| **glide** | The driver's synthetic sun drag: a `downEdge`, per-tick `dTheta` and an `upEdge` at 0 °/s. |
| **hand** | A world finger or a turn key on the sun this tick (`down` while not resting, `downEdge`, `upEdge`, `dTheta ≠ 0` or `key ≠ 0` on the frame as the input filled it). |
| **due** | A required act whose last working moment is close (amber ≤ 1.0 s, red ≤ 0.4 s). Whenever `due > 0` the pick is that target. |
| **re-anchor** | At a TAG, the live world pointer continues with the new leg's drag meaning from where it is. |
| **re-grip grace** | The 15 ticks (250 ms) after a real lift in which no settle glide starts, and the 30 ticks (0.5 s) in which a glide never runs more than 4° against the last stroke and a new press undoes it (§4.5). |

---

## 1. Touch vocabulary and recognition (`src/game/input.ts`, UI)

### 1.1 Zones (CSS px)

| Zone | Rule |
|---|---|
| **Edge zones** | A pointerdown with `x < 16`, `x > innerWidth − 16` or `y > innerHeight − max(safe.bottom, 8)` is ignored (OS gestures, and the holding hand's grip). Was 20 px at the sides and inset + 16 px at the bottom. A press that starts inside stays ignored even if it moves out. |
| **Pause** | The DOM pause button (48×48 at top-left) never reaches the game input (unchanged). It does not mirror. |
| **Button** | A disc whose hit radius is `52k`, centred at `cx = vx + vw − safe.right − 70k` (right hand) or `vx + safe.left + 70k` (left hand), `cy = vy + vh − safe.bottom − 88k`, with `k = hudScale(view) = clamp(cssW / 390, 0.85, 1.3)`. It takes touches only while it shows an act (`view.act`, or `view.incoming` in the pre-TAG window, not `'none'`), the run's phase is `'day'` (the start beat included) and the play screen shows. Drawn disc radius `34k`, ring radius `40k`, ring width `6k`. At 390×844: hit disc 104 px across (x 268-372, y 670-774), its edge 18 px from the side (outside the 16 px edge zone) and 36 px above the inset. The button is tested before the edge zones. |
| **World** | Everything else on the canvas. |

### 1.2 The world slot

- **First pointer wins; a still pointer yields.** The first accepted pointerdown in the world owns
  the slot until it lifts or is cancelled. A later world pointerdown is ignored (never captured) for
  its whole life, **unless the owner is still**: it has moved < 4 px in total over the last 300 ms.
  Then the new pointer takes the slot from its own press point with zero jump (a `downEdge` on its
  first batch, the re-grip carry of §4.5 keeping any unfinished chase), and the old pointer is
  ignored until it lifts. So a grip contact that landed first never blocks the thumb, and a palm that
  lands during a real drag never steals it. A mouse counts only its primary button.
- **Rest.** While the slot's `sun` pointer is down and has moved < 3 px in total over the last 300 ms,
  `controls()` reports `rest = true` on each frame of the batch (§1.7). Aim help treats a resting
  finger as no hand (§4.1).
- The slot's **kind** is `host.drag()` at touch-down: `'sun'`, `'steer'` (Drip) or `'vane'` (Gust).
- **`sun`:** each coalesced move turns the requested angle by
  `Δθ = −dx / vw · 360° · sensitivity · (invert ? −1 : 1) · boost`, where `vw` is the world viewport
  width. It is 1:1 from the first pixel (0.923°/px at 390 px, sensitivity 0.6-1.5 as today).
  - **Start slop.** A press that begins while `host.starting()` (the run's hold or its start beat)
    sends no turn until it is 10 px from its press point horizontally. Then it sends the whole
    displacement since the press (a catch-up of ≤ 10 px the sun chases at 600 °/s). A start tap with
    2-8 px of wobble turns nothing. Every other press is 1:1 from its first pixel, so 2-3° nudges work.
  - **Swing Boost** (Settings, **off by default**): `boost = 1 + 0.6 · smoothstep(400, 1000, v)`, with
    `v` the finger's horizontal speed in px/s over the last 50 ms of coalesced samples (an 8-sample
    ring) and `smoothstep(a, b, x) = t²(3 − 2t)`, `t = clamp((x − a)/(b − a), 0, 1)`. Off: `boost = 1`.
  - **Lift** (pointerup, lostpointercapture, pointercancel): `upEdge` with `release` **always 0**.
    The sim chases the finger's target and stops. Input never sends `release ≠ 0` again.
- **`steer`:** today's Drip steer, unchanged: `steer += dx · host.uPerPx()` (no sensitivity, no
  invert), split over the batch.
- **`vane`:** horizontal motion changes the vane by `dx / 36` notches (36 CSS px per notch, no
  sensitivity, no invert; a rightward drag blows east). Relative to the vane's current value, so a
  re-grab never resets it. The lift sends `vaneUp` (the value snaps to its notch, §3.5). An 18 px
  drag gives ±1 notch symmetrically (§3.5's rounding).
- Quantization is today's: `dTheta` to 1/1024°, `steer` to 1/64 u.

### 1.3 The button slot

- **Drag-through.** A pointerdown inside `host.buttonHit(x, y)` is captured by the button slot and
  shows the press-in look at once (`buttonDown`, §7.1), but acts nothing yet. It then becomes one of:
  - **a press**, when it lifts having moved < `BUTTON_SLOP` (12 CSS px) from its touch-down point, or
    when it has stayed within 12 px for `BUTTON_COMMIT_MS` (120 ms), whichever comes first. The press
    is counted (`acts++`, and `snaps++` on a Nubs leg), `host.onPress()` is called, and one act is
    queued;
  - **a drag**, when it moves 12 px from its touch-down point before committing. If the world slot is
    free (or its owner is still, §1.2) the pointer becomes the world slot's pointer with its baseline
    at the **touch-down point**, so the whole motion counts (the sun turns 1:1 from the first pixel,
    and §1.2's start slop applies during the start beat). It acts nothing and the press-in look
    springs back. If the world slot is busy, the pointer is ignored until it lifts.
  - After a timed commit (the 120 ms rule), a pointer that later moves 12 px also becomes a world drag,
    from its position at that moment; the act already committed stays. No drag is ever dead.
- Fire-on-down buys nothing here: every act is buffered or timed by the driver (§2.3), so no act needs
  the touch-down instant. A tap commits on its lift (typically 60-150 ms), and a long press after
  120 ms.
- **Refusal feedback.** A committed press that the driver refuses (§2.3) always shows its chip. The
  refusal haptic and the fizz sound play only the first time per reason per leg (a Nubs run is one
  leg); repeats are silent (§7.3).
- It never touches the world slot as a press, so a two-thumb player may drag and press at once, but
  nothing requires it.
- Presses queue (at most 2 waiting) and reach the driver **one per frame batch**, on the batch's
  first tick (`DriveControl.act = 1`). A third waiting press is dropped.
- On a Drip leg (`act` is `none`) `buttonHit` is false: the corner is plain world and steers. The same
  holds while a first-run lesson hides the Cold Snap button (§3.1).
- During the hold (before the run starts) `buttonHit` is false: a press there starts the run like
  any world press.

### 1.4 Keys and wheel

| Key | Nubs leg | Ember leg | Sprout leg | Drip leg | Gust leg |
|---|---|---|---|---|---|
| ← → / A D | turn (`key ±1`, Shift ±2: today) | turn | turn | steer (today) | one notch per keydown (no repeat): ← `vane −1` (west), → `vane +1` (east), with `vaneUp` |
| ↑ / W | Cold Snap (a press) | burn (a press) | grow (a press) | nothing | calm (a press) |
| ↓ / S | Cold Snap (a press) | nothing | nothing | nothing | nothing |
| Space, Enter, Escape, P | UI (unchanged) | | | | |

- Act keys are one press per keydown (repeats ignored), refused like the button, and never move the
  sun. `VERB_KEY_BURN` and `VERB_KEY_HOLD` are no longer sent by input (core keeps them for its tests).
- **Wheel:** today's sun turn on sun legs (15° per line notch, 0.35° per pixel, ±45° per event);
  ignored on Drip and Gust legs.
- On the Title, a turn key or ↑ starts the run as today.

### 1.5 Hand-offs: re-anchor, never cut

On every `'tag'` event the session calls `input.handoff()` (it replaces `cut()`):
- A world pointer that is down keeps its slot. Its kind becomes `host.drag()` for the new leg and its
  baseline becomes its current position (zero jump). A thumb mid-swing keeps moving by momentum, so
  each new kind guards against that follow-through:
  - **into `sun`:** for 150 ms the mapping is scaled by `min(1, (t − tTag) / 150)` (a sun drag is 1:1
    and a lift stops it, so a short follow-through is harmless);
  - **into `steer`:** motion is dropped while the finger's speed (over the last 50 ms) is above
    600 px/s; from the first sample at or under it, the mapping ramps in over 300 ms
    (`min(1, (t − tSlow) / 300)`). A swing carried through the TAG moves Drip ≤ 6 u in its first
    150 ms;
  - **into `vane`:** the pointer does not change the vane at all until it has **paused** (under
    40 px/s for 120 ms), or lifted and pressed again; after the pause, its baseline is its position at
    that moment. A swing carried 80 px past the TAG leaves the vane at 0, so a leg never starts on an
    unintended gale.
- New kind `sun`: the next batch carries a `downEdge`. Old kind `sun`, new kind not `sun`: an `upEdge`
  at 0 °/s (the sim's lock ends the drag anyway).
- Pending `steer` and vane deltas are dropped; held keys keep working with the new meaning; queued
  button presses stay queued (the driver decides, §2.3).

### 1.6 What happens to every v2 gesture

| Gesture (v2 and before) | Controls v3 |
|---|---|
| Flick release coasting, catch tap | Removed. `release` is always 0. The `sun.ts` coast code stays in place, unused (the `scripted` golden still feeds it). |
| Swipe down = Cold Snap (±18° cone) | Removed. The button (or ↑/↓). A downward drag does nothing (vertical motion is ignored). |
| Coin tap (≤ 350 ms, < 12 px, full meter only) | Replaced by the button: a still tap (any length; commits on the lift or after 120 ms still), 300 ms buffer, refusal reasons; a drag from it turns the sun. |
| Ember: tap on a wall (held-back press, decided at lift) | Removed. The button arms the picked target; the driver sends `VERB_TAP` with its point at the ignition moment. |
| Sprout: 220 ms still hold on a site, `HOLD_BREAK_PX`, second finger turns the sun | Removed. The button starts a pour job; the driver sends `VERB_HOLD` and `VERB_RELEASE`. The thumb stays free for the sun. |
| Gust: sideways swipe (24 px in 300 ms, one gust per press) | Removed. The drag sets a persistent vane; the driver sends `VERB_WEST/EAST` to keep it blowing. |
| Drip: drag steers | Unchanged. |
| Sun hold on Drip and Gust legs | Unchanged (core). The magnet pre-aims before Drip (§4.4). |
| Two pointers | First pointer wins in the world, but a still owner yields to a new press (§1.2); the button's slot is the only other. |
| Latest pointer wins, a new press catches the sun | Removed. A new press continues an unfinished chase (§4.5). |
| Finger cut at a TAG | Removed: re-anchor (§1.5), with follow-through guards for Drip and Gust. |
| Up/W act keys (6, 7) | Up/W is a press for every act; it goes through the driver's pick. |

### 1.7 Frames and controls

- `takeFrames(n)` keeps today's batching (pending turn split evenly with the remainder carried, a
  press on the first frame, a lift on the last). It resets `verb`, `vx`, `vy`, `steer` and `snap` on
  every frame (today) and now also sets `release = 0` on every frame.
- `controls()` returns `n` `DriveControl`s for the same batch: `act` and the vane delta land on the
  first, `vaneUp` on the first (a lift or key in the batch), and `rest` (§1.2) on every one (true only
  while the world `sun` finger rests through the whole batch).
- Input writes only `dTheta`, `down`, `downEdge`, `upEdge`, `key` and `steer`. The driver writes
  `verb`, `vx`, `vy`, `snap` and the glide's `dTheta`/edges (§2.1).

---

## 2. The driver (`src/core/drive/`, CORE)

### 2.1 Where it runs

The driver is pure core code: it reads `SimState` and its `DriveControl`, keeps its own small state,
and writes the tick's `InputFrame`. It never writes `SimState`. It follows the core determinism rules
(no `Math.exp/log/pow`, no wall clock, no per-tick allocation) and imports only core and config.

```ts
// Session.frame (UI): the driver fills each input frame before step (bot frames skip it).
const frames = this.bot ? null : this.input.takeFrames(n);
const ctl = this.bot ? null : this.input.controls();
for (let i = 0; i < n; i++) {
  takeSnap(s, this.prev);
  const f = this.bot ? this.bot.next(s) : (frames?.[i] ?? null);
  if (!f) break;
  if (!this.bot) this.driver.fill(s, f, ctl![i]!);
  step(s, f);
  if (this.rec) recordFrame(this.rec, f); // records what the driver added: replays stay exact
  ...
}
```

- **Bots bypass the session's driver**: `?bot=`, `setTestBot` and `testSkipToLeg` frames go straight
  to `step()`. The touch bots (§10.2) own a driver inside themselves and expose its view as
  `bot.drive`; in a run whose bot has one, the session renders `bot.drive` instead of calling
  `driver.observe(s)`, so the HUD's pips, queue and vane chevrons are the bot's real ones.
- **Reset points:** `driver.begin(s, opts)` at every `beginRun` (new run, Retry), after `retryTag`'s
  replay, and at the end of `testSkipToLeg`. `driver.interrupt()` on pause, blur, `releaseAll()` and
  every TAG: an open glide is closed on the next fill (an `upEdge` at 0 °/s on that frame) and
  buffered presses drop (the pre-TAG press of §2.3 survives a TAG).
- **Gate:** the driver acts only while `s.phase === 'day'`; it writes nothing in `'hold'`, `'night'`,
  `'dead'` or `'won'` (so its frames never start a run: a `downEdge` in the hold starts one,
  `step.ts`).
- **One verb per tick.** When two things want the verb slot, the order is: Sprout `VERB_RELEASE`,
  Ember `VERB_TAP` (earliest deadline first), Sprout `VERB_HOLD`, Gust `VERB_WEST/EAST`. The rest
  waits a tick.

### 2.2 Fill order per tick

1. Close an interrupted glide (`upEdge`, `release 0`, `down false`) if one is open (a resting glide,
   §4.5, just stops: it has no edges to close).
2. Note the hand (`(f.down && !c.rest) || f.downEdge || f.upEdge || f.dTheta !== 0 || f.key !== 0`,
   read from the frame as the input or bot filled it, before the driver writes) and the **sun move**
   (`f.downEdge || f.upEdge || f.dTheta !== 0 || f.key !== 0`, on a sun leg with `s.ready === 0`);
   remember the last sun move's tick (the engagement clock, §4.1), a real lift's tick and the last
   stroke's net direction (the sign of the input `dTheta` summed from its `downEdge` to its `upEdge`;
   none under 1°).
3. Gust legs: apply `c.vane` and `c.vaneUp` to the vane (§3.5). Other legs: vane 0.
4. A press (`c.act`) joins the press buffer with this tick.
5. Resolve buffered presses (§2.3) and the pre-TAG press.
6. Ember arms (§3.2), Sprout jobs (§3.3), Gust governor (§3.5), Nubs snap (§3.1), in §2.1's verb order.
7. Aim help (§4): the re-grip carry and undo on a real `downEdge` (§4.5); cancel on a hand; continue
   a glide; or plan one.
8. Refresh `view` (§11.3) and push notes.

### 2.3 Presses: legal, buffered, refused

A press resolves on its tick if the act is legal. If not, it waits up to `TUNING.drive.bufferTicks`
(18 ticks, 300 ms) and fires on the first legal tick. When the wait runs out it is **refused** with a
reason. A refused press costs nothing and never moves anything.

| Leg (act) | Legal when | Refusal reasons (first that applies) |
|---|---|---|
| Nubs (`snap`) | `snapReady(s)` (meter full, no snap on, sun up, past the start beat, not inside a TAG lock) | `locked` (TAG soon), `wait` (start beat), `busy` (a snap is on), `charging` (meter not full) |
| Ember (`burn`) | a pick exists and fewer than 2 arms | `full` (2 armed), `nothing` (no target in range) |
| Sprout (`grow`) | §3.3 has something to do with the press | `full` (2 jobs and no top-up), `nothing` (no site), `low` (a new plot job with Sap ≤ `plotSap + plotMin`, 30) |
| Gust (`calm`) | always. Calming a calm vane is a no-op: note `CALM` with `a = 2`, the soft cue "The wind is calm" (`cue.calm`), no `REFUSE` note, no refusal haptic | none |
| Drip (`none`) | never: the button is not there | |

A refusal's `REFUSE` note carries `a = reason`, plus 16 when the same reason was already refused on
this leg (a **repeat**). Repeats show the chip but play no haptic and no fizz (§1.3, §7.3).

**Pre-TAG press.** In the last `preTagTicks` (45 ticks, 0.75 s; 30 before fix round 3) before a TAG
into Ember or Sprout the button shows the incoming act (`view.incoming`), and a press then is kept and
applied on the first tick the new element walks. It is the only press that survives a TAG. With the
300 ms buffer, a press up to about 1 s before the TAG reaches the incoming element. The Trials leave
that press room to matter: the first required Ember or Sprout act after a TAG comes due no sooner than
1.5 s after it (G9b, §10.3).

**Mashing** (fix round 3). A press while another waits joins it: mashing never restarts the 300 ms
wait, so an illegal press is still refused once, when the first press's wait runs out, and the
presses after it on that leg are repeats.

**Night** (fix round 3). Outside `day` the act is `none` (`view.act`). A press still waiting when
night falls is refused at once with its reason (a key press too, so it is never silently lost); the
pre-TAG press is dropped.

Ember's affordability is checked at ignition, not at the press (arming is free). Sprout's crossing
jobs are never refused for Sap: they wait for it (§3.3).

### 2.4 Notes (feedback without sim events)

The driver keeps a ring of 8 notes `(code, a)` that the session drains once per drawn frame and routes
to `fx`, `audio`, `haptics`, `moments` and the cue line. Sim events (`burn`, `grow`, `gust`, `snap`,
`detent`…) keep their own routes.

| Code | `a` | When |
|---|---|---|
| `PRESS` 1 | the act | a press was accepted (snap asked, armed, job started or queued, top-up, calm) |
| `REFUSE` 2 | the reason (§2.3: 1 charging, 2 locked, 3 nothing, 4 low, 5 full, 6 wait, 7 busy), + 16 on a repeat this leg | a press was refused |
| `BUFFER` 3 | the act | a press is waiting (≤ 300 ms) |
| `SETTLE` 4 | 1 captured into shade/light, 0 a track re-inset | a glide ended |
| `NOTCH` 5 | the vane notch | the vane changed notch |
| `CALM` 6 | 0 pressed, 2 already calm (no-op), also while a drag holds the vane at notch 0; 1 (auto) is never sent since fix round 3 (§3.5) | the vane went to 0, or a Calm press found it there |
| `WAIT_LOW` 7 | the object | an armed ignition waits for Flame (once per arm) |
| `EXPIRE` 8 | the object | an arm's target can no longer burn (once) |
| `HANDOVER` 9 | the target bin | the pre-TAG hand-over glide started |
| `AUTO` 10 | the act | Auto Snap or Auto actions acted |

---

## 3. Per leg: exact rules

### 3.1 Nubs: drag turns the sun, the button is the Cold Snap

- **Drag:** §1.2. **Lift:** the sun stops where the finger asked; then aim help (§4).
- **Button:** a legal press sets `f.snap = true` on its tick (one tick). The Frost Bank, cash-in,
  landing and every snap rule are the core's, unchanged. The button exists on every Nubs leg whose run
  has the snap mechanic (`s.world.mech.snap`): always in Endless, Daily and Trials; in the Journey from
  L10. **Exception, first-run lessons:** on a run with `s.cfg.lesson` (the Endless tutorial, L1's
  lesson) `view.act` stays `'none'` (no button; the corner is world) until `snapReady(s)` is first true
  in that run (the driver latches it); then the button appears with §6.1's first-full-meter teaching.
  A new player never meets a charging button that answers taps with refusals.
- **Buffer:** a press during the last 300 ms of the start beat, of a TAG lock or of the meter filling
  fires on the first legal tick.
- **Auto Snap** (Endless comfort rungs R0-R1 only; `TUNING.drive.autoSnap`): when `snapReady(s)`,
  Nubs is lit (`s.nubs.f > 0`) and Chill < 20, the driver sets `f.snap` (note `AUTO`). Not on R2-R4,
  Daily, challenges, the Journey or Trials.
- **Keys:** ↑/W and ↓/S are presses.

### 3.2 Ember: drag turns the sun, the button arms the next burn

**Eligible targets** are core's `burnTarget` targets (an intact bramble, gate or ice wall `near..range`
ahead, also past the next Tag Stone; a puddle on Ember's own path before the TAG; unveiled), not
armed, whose point resolves to themselves: walls at `(trailX(o.y), o.y)`, puddles at `(o.x, o.y)`,
`burnTarget(s, x, y) === i` (as the bot checks today).

**Ignition moment** (`emberDue(s, i, lead)` in `src/core/drive/pick.ts`, ticks from now, ≤ 0 = now;
the driver passes `lead = 0`, the bots their press lead). `pace` is the walker's u per tick, `d` the
contact edge's distance ahead:
- **own bramble or gate** (Ember will reach it): the middle of its sweet window,
  `d ≤ (burnTicks · pace + near) / 2`;
- **ice, or a wall another walker reaches:** `l ≤ nowTicks` (30) with
  `l = min(burnLeft(s, o), nextTagTicks(s) − tagMargin)` (`tagMargin` 2; with no TAG ahead,
  `l = burnLeft`);
- **puddle on Ember's path:** `contactTicks(s, o) ≤ 60` while Flame > 30; otherwise Ember wades it;
- **showers:** while rain is predicted over the object for the burn (`showered`, moved from the bots
  into `drive/pick.ts`), ignition waits, but never past the last working tick.

**Last working tick** (`emberLast(s, i)`, ticks from now) is computed for the state `step()` will see:
`step()` moves the walker (`syncTime`) before it resolves the verb (`updateElements`), so the driver
counts one tick of walking in. An own bramble or gate works while `d − pace ≥ near` (the driver never
fires inside `d < near + pace`); ice and others' walls while `l − 1 ≥ 0`; a puddle while it is ahead
of `near` one tick on. Past it the target can no longer burn in time.

**Required and optional.** Every eligible **wall** (bramble, gate or ice; Ember's own or past the TAG)
is **required**: one reached unburnt bumps its walker (−30). Puddles are **optional**.

**The pick** (`emberPick(s, armed)`): the unarmed required target with the **earliest last working
tick** (ties: the nearest contact edge, then the lower index); only when no required target is
unarmed in range, the unarmed puddle with the earliest last working tick. **A press arms the pick.**
At most 2 arms (`TUNING.drive.ember.arms`). Arming is free.

**Ignition:** on an armed target's moment, if Flame > cost × `costMul`, the driver sends `VERB_TAP`
with the target's point; the core pays and burns as today (an own wall still refunds through the
feed). If Flame is short, the arm waits (`WAIT_LOW` once; the cost shows red) and fires the first tick
Flame covers it, until its last working tick. An arm whose target is gone, burnt by spread, or past
its last working tick is dropped (`EXPIRE`). A veiled armed target waits while veiled.

**Due** is read from the same order: the pick, when it is required, sets `view.due` 1 when its last
working tick is within `dueTicks` (60), 2 within `urgentTicks` (24). So **whenever `view.due > 0` the
pick is the due wall**, and a press while a required wall is due always arms that wall (a unit test
holds the invariant on T5's u270 between b245 and g296, and T7's u437 between b423 and g453).

**Windows:** a target can be armed any time from first sight (≥ 340 u ahead, about 4.7 s) to its last
working tick, while it is the pick and fewer than 2 arms are live; harness gate G9 (§10.3) makes every
required one pressable for ≥ 1.5 s in a row. A wall Ember reaches unarmed bumps (−30) as today: that,
and Flame, are the leg's failure states.

**Keys:** ↑/W is a press. ← → turn the sun.

### 3.3 Sprout: drag turns the sun, the button pours

**Pick** (the bot's proven order, `sproutPick` in `drive/pick.ts`):
1. the unbridged crossing (gap or stream, `size < need`, unveiled, `near..range`, resolving at
   `(trailX(o.y), o.y)`) with the least `growLeft`, not already in a job (crossings are **required**);
2. else the nearest plot without a tree that can take Sap (`size < treeMax`, resolving at `(o.x, o.y)`),
   not already in a job, and **not `downwind`** (a plot a later fire would reach while the breeze
   spreads it; the same test Auto actions and the bots use);
3. else the nearest such plot even if `downwind` (only when no other plot is in range).

So the ring always shows a plot worth growing, and T7's "keep 3 trees" choice is made by the pick:
p428 before the nearer p420, which sits downwind of Ember's required b423 (a unit test).

A crossing's last pour start is computed like Ember's last working tick, with the walker one tick on.

**A job** is `{ obj, goal }`: a crossing's goal is its `need` (2r = 24-36 Sap); a plot's goal is
`treeMin` (20) if `size < 20`, else `size + 20`, capped at `treeMax` (60).

**A press:**
- no job running → start the pick's job (a plot job needs Sap > `plotSap + plotMin` = 30, else `low`);
- a plot job running and the pick is a plot (no crossing waiting) → top up the running plot's goal by
  20 (cap 60);
- otherwise (a crossing job running, or the pick is a crossing) → queue the pick's job (at most 1
  queued; `full` beyond).

**Pouring:** the driver sends `VERB_HOLD` with the site's point; the core pours 50 Sap/s as today. It
sends `VERB_RELEASE` on the tick after `o.size ≥ goal`. A plot job also ends when Sap ≤ `plotSap`
(25): the plot keeps what it got (under 20 it stays a sapling). A crossing job waits through Sap 0 and
keeps pouring as Sap seeps back. The core still ends a hold at `near` and at a TAG; the driver then
drops the job. Trees stand as today once the hold lets go.

**Pre-emption:** while a plot job runs, a **queued** crossing whose `growLeft < 90` ends the plot job
(`VERB_RELEASE`) and starts next tick; the plot's remaining job takes the freed queue place. A
crossing never starts without a press (except under Auto actions, §3.6).

**Due:** an unbridged crossing in range and not in a job sets `view.due` 1 when its `growLeft < 120`
ticks, 2 when `< 60`.

**Keys:** ↑/W is a press. ← → turn the sun, which stays free for the whole leg (light doubles growth).

### 3.4 Drip: drag steers (unchanged)

Drip's steer, lane, slide, keys and rules are v2's. The button is absent; the Size pill sits at the
button's centre and the corner is plain world. The sun is held. Before the TAG into Drip the magnet's
hand-over pre-aims the sun (§4.4). A finger held through the TAG steers at once (§1.5).

### 3.5 Gust: drag sets the vane, the button calms

**The vane** is an integer notch `n ∈ {−2, −1, 0, 1, 2}` (west negative) held by the driver:
`raw += c.vane` (clamped to ±2.49), `n = sign(raw) · floor(|raw| + 0.5)` (symmetric: an 18 px drag
gives +1 east and −1 west; JS `Math.round` would not, since `round(−0.5)` is −0); on `c.vaneUp`,
`raw = n`. A notch change notes `NOTCH`. The vane is 0 at the start of every Gust leg and after a Calm
press. Lifting the finger **keeps** the notch.

**The floor** is the Lift the governor keeps back, the proven policy's (`SWIPE_LIFT` and
`SWIPE_GAIN` in `bots/elements.ts`, moved into `drive/pick.ts` with `ownAhead`):
`floor = ownAhead(s, el) ? lift (20) : swipe · costMul + gain (2)`. While weather of Gust's own stretch
can still soak it, Gust keeps 20 Lift; otherwise the hand-off pushes (T4's ride cloud, T6's and T7's
garden cloud) may spend down to the price of one gust. Since fix round 3 the floor never stops the
vane: it only picks the weaker band (**Low Lift** below).

**The governor** keeps the wind in the notch's band with today's gust verbs and costs. With
`σ = sign(n)` and the band floor `band[|n|]` (`[0, 15, 30]` u/s; `low[|n|]`, `[0, 5, 15]`, while Lift
≤ `floor`), on a tick where all hold:
- `n ≠ 0` and `σ · s.el.wind` below the band floor;
- at least `every` (15) ticks since the governor's last gust (the bots' `SWIPE_EVERY`), waived on the
  tick a drag sets a new non-zero notch (the **drag kick**);
- Lift > one gust's price + `gain` (`swipe · costMul + 2`), or, on the drag kick, Lift > one gust's
  price;
- **weather is in play:** some awake rain or fog object (weather wakes 400 u ahead), not gone, whose
  far edge is not yet behind the walker;

it sends `VERB_EAST` (σ > 0) or `VERB_WEST`. One kick is +30 u/s (half in fog) for 8 Lift ×
`costMul`, so `breeze` (±1) holds the wind at about 15-45 u/s for about 4.9 Lift/s and `gale` (±2) at
about 30-45 u/s for about 13.0 Lift/s (`TUNING.drive.gust.cost`, steady state in clear air, × `costMul`
on the HUD). Air restores 4 Lift/s.

- **Resting:** with no weather in play the governor sends nothing; the vane keeps its notch and shows
  dimmed (`view.vaneResting`).
- **Low Lift** (fix round 3; it replaces the auto-calm, which turned every drag in the rain into
  nothing: the vane snapped back to 0 on the next tick). The governor never moves the vane. At or
  below `floor` it keeps the weaker band `low` (`view.vaneLow` 1; about 2.7 Lift/s at a breeze and 4.9
  at a gale, `TUNING.drive.gust.lowCost`), so the wind still blows the way the player set it, only
  softer. At one gust's price + `gain` or less it **waits** (`view.vaneLow` 2, `view.vaneCost` 0) until
  air (4 Lift/s) brings Lift back over that line. A forgotten vane spends no further than the bots
  do: it gusts only above one gust's price + `gain`.
- **The drag kick:** a drag always moves the vane (`NOTCH`), and on the tick it sets a new non-zero
  notch the governor may gust at once, even while waiting, as long as Gust can pay for one gust. So a
  drag always moves the wind while Gust has the Lift for it.
- **Soak** (fix round 3): rain soaks 30 Lift/s (`TUNING.elements.gust.soak`, 36 before), so from the
  lowest Gust start a player has about 1 s after a hand-off before Lift matters (G8d, §10.3).
- **Calm press:** the vane goes to 0; the wind decays as today (τ 1.5 s). On a calm vane it is the
  no-op of §2.3.
- **Keys:** ← → move one notch per keydown; ↑/W calms.

**Arrival ghosts** read `driveWeatherX(s, o, ticks, n)` (core, `drive/vane.ts`): today's
`weatherXAt` with the governor's gusts simulated for the current notch (no Lift limit), so the ghosts
show where each cloud lands under the vane as set. **While `n ≠ 0`, a second, fainter ghost** shows
`driveWeatherX(s, o, ticks, 0)`: where the cloud lands **if you calm now** (no governor gusts, so the
current wind decays with τ 1.5 s; a cloud drifts about 45 u on after a Calm). With `n = 0` it is
exactly today's `weatherXAt`, so this ghost costs one more draw, not a new prediction.
The player calms when that ghost sits where they want the cloud, which is how T4's ride cloud lands
on the trail and a fog stops just clear.

### 3.6 Auto actions (accessibility)

With Settings → Auto actions on, the driver plays Ember's and Sprout's acts itself, with the reactive
policy (the one `elPolicy` proves): every eligible Ember target is ignited at its moment while Flame
covers it; every unbridged crossing gets a job when it is picked; plots get jobs to `treeMin` while
Sap > 25, skipping a plot a later fire would reach downwind (`downwind`, moved into `drive/pick.ts`;
the player's pick uses the same test, §3.3).
The button stays available (extra plot top-ups, Calm). Gust and the sun stay the player's. It marks the
run assisted (§8.1).

---

## 4. Aim help: the magnet and the hand-over (`src/core/drive/aim.ts`, CORE)

### 4.1 When the magnet acts

**Aim help finishes the player's moves; it never plays for an idle player.** All of these, else it
does nothing:
- `s.phase === 'day'`, `s.ready === 0`, `s.sunUp`, `!s.sun.locked`, `!s.eclipseOn`;
- **no lesson:** `!s.lessonOn` (the first-run lesson, Endless R0's tutorial and L1's, must be passed by
  the player's own turn: A5's "θ turned ≥ 15°" may never be a glide);
- the walker is Nubs, Ember or Sprout (Drip and Gust hold the sun);
- the radius `R > 0` (§4.3);
- **engaged:** the last sun move (§0.3: an input `downEdge`, `upEdge`, `dTheta ≠ 0` or `key ≠ 0` on a
  sun leg after the start beat) was at most `engageTicks` (300, 5 s) ago. Button presses, a resting
  finger and the start tap do not count, so a player who stops playing gets no help after 5 s, and an
  idle, parked or button-mashing player gets none;
- **no hand** this tick (a resting finger, §1.2, is no hand), and the sun is settled: `s.sun.mode ===
  'idle'` (a lift's chase has finished), or `'dragging'` under a resting finger with `|s.sun.lag| <
  0.01°`;
- **re-grip grace:** at least `regripTicks` (15, 250 ms) since the last real lift (§4.5); the release of a
  key turn is a lift too, its direction the key's (fix round 3), so a keyboard nudge out of shade is
  not glided back at the next refresh;
- planning happens on guide refresh ticks (`s.guide.tick` changed) and at most one new glide starts
  per `gapTicks` (30) ticks.

### 4.2 Target and rules

- **Bins** follow the guide's convention: `binOf(θ)` rounds to the nearest degree and `markRange`
  marks bins whose centre lies in an interval, so bin b covers [b − 0.5, b + 0.5). An arc of bins
  `b_lo..b_hi` has edges `b_lo − 0.5` and `b_hi + 0.5` and width `W = b_hi − b_lo + 1`. `settleTarget`
  and the tests use `binOf()`.
- **Target mask `T`** (360 bins): during a Cold Snap with any `guide.land` bin, `guide.land`; else the
  **lasting** mask `guide.now ∧ guide.next` if it has any bin, else `guide.now`. On 'fog' levels,
  `guide.now` only. (On Trials `now`/`next` are already Ember's light and Sprout's focus-site light.)
- **During a TAG telegraph** (`tagLocked(s)`, the 180 ticks before a TAG) into Nubs, Ember or Sprout,
  where `guide.tag` shows where the incoming element wants the sun: `T` becomes `T ∧ guide.tag` when
  that has a bin within `R` of θ (the sun settles where both walkers are served), else `T`. The
  hand-over into Drip is §4.4.
- **Honour:** if θ's bin is in `guide.bud`, `guide.flake`, (`guide.flareTicks ≥ 0`) `guide.flare`, or
  (during a TAG telegraph) `guide.tag`, the magnet leaves the sun alone. It never pulls toward the bud,
  flake or flare masks either. A player who pre-aims at the next element's arc keeps that aim.
- **Settle (rescue):** θ's bin not in `T`:
  - not in `guide.now` (lit; Ember: not light) → act now (after the re-grip grace, §4.1);
  - in `guide.now` but not in `T` (shade that is ending) → act once no hand has happened for
    `endingTicks` (18) (cut at the merge as CORE's cut 2; restored in fix round 3, §16.8);
  - search outward bin by bin up to `R`; the first bin of `T` reached **without crossing a glare bin**
    (Nubs only; glare is light for Ember) wins; ties: the wider arc, then counter-clockwise;
  - the glide's target lies `min(inset, W/2)` inside the arc's near edge (`inset` 4°).
- **Track** (off under Light): θ inside an arc of `T` but less than `min(edge, W/2)` (2°) from its
  edge → glide to `min(inset, W/2)` inside that edge. It never hops to another arc.
- **Against the stroke:** until `againstTicks` (30, 0.5 s) after a real lift, a plan whose glide would
  move the sun more than `againstDeg` (4°) against the last stroke's direction (§2.2) is skipped; it
  is planned again after that, when the player has clearly let go.
- A plan that would move the sun less than 0.5° is skipped.

### 4.3 Radius `R` (`aimRadius`, shared by the session and the bots)

| Context | Standard (default) | Strong | Light | Off |
|---|---|---|---|---|
| Journey L1-40 | 14° | 14° | 8°, no track | 0 |
| Journey L41-100 | 12° | 14° | 8°, no track | 0 |
| Journey L101-200 | 10° | 14° | 8°, no track | 0 |
| Endless comfort rungs R0, R1, R2 | 14° | 14° | 8°, no track | 0 |
| Endless R3 | 12° | 14° | 8°, no track | 0 |
| Endless R4 (standard rules, the warm-up) | 10° | 14° | 8°, no track | 0 |
| Daily, challenge runs | 10° (fixed for everyone) | 14° (marks assisted) | 8°, no track | 0 |
| Trials (Nubs, Ember, Sprout legs) | 14° | 14° | 8°, no track | 0 |
| 'blind' levels (No Dial) | 0 | 0 | 0 | 0 |

The schedule's floor is 10°. 8° and 0 exist only by the player's choice. The only other changes are
gate levers (§9.5, §10.1): `AIM_OVERRIDE: Record<string, { deg: number; track: boolean }>` in
`src/config/tuning.ts` (keys `'L<n>'`, `'T<n>'`, `'R<n>'`; at most 6 entries, each with its reason in a
comment and in §16), read by `aimRadius` for Standard only (Strong, Light and Off stay the player's).

### 4.4 The sun hand-over before Drip

In the last `handTicks` (60 ticks, 1.0 s) before a TAG into Drip, with no hand (a resting finger is
no hand) and `guide.tag` non-empty, the magnet's target is `guide.tag` instead of §4.2's: if θ's bin
is already marked, nothing; else it glides to the nearest marked bin within `handReach` (30°),
preferring bins also in `guide.now` (Nubs stays shaded), landing `min(handInset 3°, W/2)` inside the
dashed arc (`HANDOVER`). The bud, flake and flare honour does not apply here (the dashed arcs are what
G1 proves Drip's leg from). It follows §4.1's conditions (engaged, no lesson, re-grip grace), so aim
help Off disables it and Light keeps it. A finger or key overrides it at any time.
Gust's leg is θ-free (`guide.tag` is empty), so nothing happens before
it.

### 4.5 Glides and the re-grip carry

- **Glide frames:** for a turn `Δ = angleDiff(target, θ)`, `N = max(2, ceil(2 · |Δ| / (rate · DT)))`
  ticks (`rate` 240 °/s, 180 under reduced motion; DT 1/60). Tick k (1..N) adds
  `q1024(Δ · (e(k/N) − e((k−1)/N)))` with the ease-out `e(x) = 1 − (1 − x)²`, the last tick taking the
  quantized remainder so the steps sum to `q1024(Δ)` exactly. Tick 1 has `downEdge`; ticks 1..N−1
  `down`; tick N `upEdge`, `down false`, `release 0`. The largest step is `rate · DT` (4°), within every
  follow rate (the lowest is 300 °/s under reduced motion; no concept slows the sun any more), so the
  sun lands on the target.
- **Resting glides:** under a resting finger (§1.2) the sun is already `dragging` from the finger, so
  the glide writes only the per-tick `dTheta` (no `downEdge`, no `upEdge`, `down` left as the input
  set it). A drag is relative, so the finger's next move continues from wherever the glide left the
  sun. Any hand (the finger moving 3 px, lifting, a key) ends it where it is.
- **Cancel:** a hand on a glide tick ends the glide. If that frame has no `downEdge` (a key, a wheel),
  the driver adds the `upEdge` at 0 °/s so the sun never stays in `dragging`.
- **Re-grip carry:** when a frame has a real `downEdge` while `s.sun.mode === 'chasing'`, the driver
  adds `q1024(s.sun.lag)` to that frame's `dTheta` (the sim's `downEdge` zeroes the lag), so a second
  stroke continues the first instead of dropping it.
- **Re-grip undo:** when a real `downEdge` comes at most `againstTicks` (30) after the last real lift
  and a glide started after that lift, the driver also adds `q1024(−angleDiff(s.sun.theta, θg))` to
  the frame's `dTheta`, where `θg` is `s.sun.theta` when that glide began. The new stroke starts from exactly where the
  player's last stroke left the sun, whatever the magnet did in between. With the grace of §4.1 (no
  glide before 15 ticks) and the 4° limit of §4.2, a re-grip at 150-300 ms usually finds no glide at
  all; the undo covers the rest. **Race** (fix round 3): a real `downEdge` within `raceTicks` (3) of a
  glide's start undoes that glide the same way, lift or no lift (the magnet began a frame before the
  player's deliberate touch, so its first step must not stick).
- **The driver's own edges** (fix round 3): the driver reads the frame's `downEdge`, `upEdge`, `down`
  and `dTheta` before it writes any, so a glide's closing `upEdge` (or the one a cancel adds) is never
  read as the player's sun move (§4.1's engagement clock) or as a real lift (§4.1's re-grip grace).
- **Notes:** `SETTLE` at a glide's end (`a = 1` for a rescue, 0 for a track).
- **Sim events during glides:** a glide is a real drag in the sim, so it can emit `detent` events.
  On a tick where `view.glideTick` is set (the driver wrote a glide step, the last one included; fix
  round 3: `view.glide` is already NaN on the last step), the session drops `detent` from haptics and
  audio (the dial's tick marks still draw); the only feedback for magnet motion is `SETTLE`'s clink and
  6 ms tap (§7.3).

---

## 5. Nubs' own game: Endless, Daily, Journey

### 5.1 Controls

§1.2 and §3.1: drag turns the sun 1:1 (Swing Boost optional), lift stops it, aim help settles it, the
button is the Cold Snap. No flicks, no catches, no swipes, no coin-tap timing. `release` is always 0,
so the sim's coast path is never entered from play.

### 5.2 Camera: Nubs rides higher

`src/game/camera.ts` (UI): `nubsFrac = clamp((352 + (safe.top + 64) / k) / viewH, 0.60, 0.72)`, with
`k` the camera's CSS px per u and `viewH` the visible world height. 352 u is the targeting range (340 u)
plus 12 u; `(safe.top + 64) / k` is the HUD band in u. So every target in range stays visible below the
HUD on every screen, and on tall phones Nubs moves up out of the thumb's band:

| Screen (safe.top) | Today | v3 | Nubs' y | Ahead below the HUD |
|---|---|---|---|---|
| 390×844 (47) | 0.70 | 0.60 | 506 px (dial 463-549) | 365 u |
| 430×932 (47) | 0.70 | 0.60 | 559 px | 375 u |
| 412×915 (0) | 0.70 | 0.60 | 549 px | 424 u |
| 360×640 (0) | 0.68 | 0.65 | 416 px | 352 u |
| 360×640 (24) | 0.68 | 0.6875 | 440 px | 352 u |
| 1280×720 desktop (0) | 0.68 | 0.675 | 486 px | 352 u |

The button (centre ≈ 722 px at 390×844) and the drag band below Nubs (≈ 560-800 px) no longer cover
the dial. `layout.spec`'s range check (§12.2) asserts the 340 u guarantee at every size.

### 5.3 Journey content: the control concepts retire

Sixty levels drew their challenge from sun-control handicaps. Five of them make the controls
themselves the obstacle (an inverted, sliding, snapping, pushed or sluggish sun) and are **retired**;
Sun Lock stays as a telegraphed planning beat. The challenge those 46 levels lose comes back as
pacing, spacing and scarcity (the substitutes below), never as input.

| Concept | Levels | v3 |
|---|---|---|
| `dazzle` (Mirror Sun) | 16, 123, 130, 139, 144, 145, 177 | retired |
| `slippery` | 30, 81, 83, 85, 87, 89, 90, 161, 162, 164, 167 | retired (with no coast it would do nothing) |
| `clockwork` | 31, 54, 92, 96, 99, 100, 114 | retired (its 30° release snap fights the magnet) |
| `gusts` | 32, 71-76, 78-80, 93, 163, 169, 170 | retired (the magnet's track would cancel it) |
| `heavy` (Heavy Sun) | 29, 97, 98, 103, 112, 165, 168 | retired: a sun that lags the finger is clunk by design; at 300 °/s it would equal the reduced-motion cap and barely exist, and its "start early" planning returns as `sprint` |
| `lock` | 33, 91, 94, 95, 110, 131, 134, 136, 140, 186, 194, 195, 197, 198 | kept: a 1.0 s countdown ring on the dial before each lock (ART); the sim rule is unchanged |

**How (CORE, `src/config/concepts.ts`, `src/config/campaign.ts`):**
1. `ConceptId` loses the five ids; `CONCEPTS`, `DARE_OF` (`heavy: 'ring'`, `gusts: 'still'` …),
   `CONCEPT_CONFLICTS` (`['swing', 'slippery']`) lose their entries.
2. **Teaching slots.** `CONCEPT_IDS` becomes (40 ids, all taught; `TEACH_LEVELS` stays 40):
   `drag flakes cloud noon deep glare swing bloom breezy snap · oldtown overcast gate long heat sparse
   market sprint stroll giants · brittle fleet thaw frosty ration meltfast hardy flurry drought dense ·
   moonlit lowland lock fog blind eclipse sunset flare marathon boss`.
   So L16 teaches **Wide Open** ("Big Sky"), L29 **Drought** ("Cloudless"), L30 **Crowded**
   ("Thicket"), L31 **Moon Sun** ("Moonlit", a gentle low-sun breather) and L32 **Lowland** ("Short
   Grass"). The three shade-scarcity concepts are spread out (16, 29, 32) with a denser and a gentler
   level between them, and none follows a retired control concept. They have no verb goal (`finish`);
   their Dares and world variants come from the bake as for every teaching level (`lessonReads`).
   `teachLevel()` of these five moves from 0 to 16, 29, 30, 31 and 32; composed levels (41-200) are
   past every teaching level, so no composed level's definition changes through it (CORE checks every
   reader of `teachLevel`).
3. **Composed levels keep their draws.** `COMPOSE_ORDER` and the chapter lists of chapters 5-20 are
   typed `DrawId = ConceptId | 'dazzle' | 'slippery' | 'clockwork' | 'gusts' | 'heavy'` and keep their
   exact contents. A frozen `RETIRED_DRAW` table in `campaign.ts` keeps what the draw itself reads of
   the retired ids (kind `'dial'`, no required biome, the old `['swing', 'slippery']` conflict), used
   only by `composeConcepts`' compatibility checks, so every rng draw is byte-identical. After the
   draw, each retired id is replaced, in the level's concept order, by the first of its substitutes
   that fits (compatible with every non-retired concept of the level and every substitute already
   placed, not present, and its required biome absent or the chapter's); none fitting drops the slot:

   | Retired | Substitutes, in order |
   |---|---|
   | `dazzle` | `dense`, `lowland`, `sparse` |
   | `slippery` | `sprint`, `sparse`, `dense` |
   | `clockwork` | `sparse`, `dense`, `lowland` |
   | `gusts` | `fleet`, `breezy`, `sparse`, `dense` |
   | `heavy` | `sprint`, `ration`, `sparse` |

   The boss finales' appended `'flare'` comes after the substitution, as today. The other 154 levels'
   concept lists are byte-identical.
4. `DayParams.sunFollow` and `sunFriction` stay in `days.ts` and `sun.ts` (no concept sets them now;
   like the coast code they stay dormant, so no golden moves).
5. **Names:** ch9's L85 "Slippery Sun" → "Pine Hollow"; ch17's L165 "Slick Sun" → "Cloudburst Pass";
   ch10's L94 "Heavy Hands" → "Stop Clock". Every other name stays.
6. **Sim:** `sun.ts` loses the mirror, the clockwork snap and the gust push (`mirror`, `CLOCKWORK_DEG`,
   `sunGustAt`, `gustDir`, `GUST_*`). `SunState.gust` stays (always 0) and so does its hash feed, so
   every hash of every other run is unchanged. `feats.ts` loses the gust windows (the `still` Dare
   keeps its lock windows; `stats.gustHeld`/`gustWindows` stay, always 0). The bots lose their
   `dazzle` branches; `dares.ts` loses `gust`.
7. **Copy and docs:** §13.4; `CAMPAIGN_PLAN.md` chapter and concept tables (CORE).
8. **Fairness levers** (each entry with its reason in a comment and in §16; no others):
   - a hard gate (§9.5) fails on a **substituted level**: CORE moves that level to the next substitute
     in its list through `SUB_OVERRIDE: Record<number, ConceptId | null>` (at most 16 entries since
     fix round 3, 8 before; `null` drops the slot, which can only make the level easier), re-bakes it
     and re-runs; a level that still fails then lowers its drain by at most 2 steps through
     `SUB_DRAIN: Record<number, number>` (fix round 3; each entry with its numbers in §16.8);
   - a hard gate fails on a **new teaching slot** (L16, 29-32): first, one swap of two of these five
     concepts in `CONCEPT_IDS` (re-bake both); then `TOUCH_READS: readonly number[]` (at most 3
     levels), whose bake's `lessonReads` also requires humanTouch on `LESSON_SHARE` of its training
     streams (re-bake that level only);
   - an **idle or parked-sun** gate fails (§9.5, §10.3): `AIM_OVERRIDE` (§4.3) for that level, rung or
     Trial, in this order: track off, then the radius down by 2° (floor 8°). Never content.
   - a **chapter** comparison fails (§9.5) with no substituted level in that chapter: that is a driver
     defect and is fixed in the driver, not by content.

---

## 6. Teaching and contextual prompts (UI, with ART's ghosts and banners)

### 6.1 Teaching by doing

| Moment | What happens |
|---|---|
| First run (tutorial, Endless R0) and L1 | The DOM ghost hand drags in the band 130 px below Nubs (today's lesson logic and slow time). Aim help is off until the lesson is passed (§4.1), so the pass is always the player's own drag, and the slow time and ghost hand never end before the player has dragged. No Cold Snap button until the first full meter (§3.1). The first `SETTLE` capture after the lesson shows the cue "Let go near the teal: the sun slides into shade." once per profile. |
| L10 (Cold Snap) and the first full meter of a profile (in a lesson run, the moment the button first appears) | The button pulses; the game runs at `LESSON_TIME_SCALE` (0.5) until the first press, at most 2.5 s of real time; the ghost hand taps the button; cue "Full! Tap the frost button." |
| Intro Trials T1, T3 (Ember, Sprout) | At the element's first pick: 0.5× until the first press (≤ 2.5 s real), the ghost hand taps the button (ghost mode `press`), the pick's ring and tether pulse. |
| Intro Trial T4 (Gust) | At the first red arrival ghost: 0.5× until the first vane notch (≤ 2.5 s), the ghost hand drags sideways 40 px and lifts (mode `vane`). |
| Intro Trial T2 (Drip) | Unchanged (ghost `steer` at the TAG). |
| Every TAG | A 1.2 s canvas banner (ART): the element's name, its drag line and its button line (§13.2); the button icon morphs; a live finger glows for 300 ms (it was handed over, not dropped). The cue line announces the same. |

Slow time is game-loop only (the sim is untouched) and never runs on Daily or challenge runs.

### 6.2 Contextual prompts (`moments.ts`, shown until the Trial is passed or once per profile)

New `TipOn` triggers, fired from driver notes and the view:
- `due`: the first amber `view.due` on an Ember or Sprout leg;
- `refuse`: the first refusal of each reason (the reason's chip text, §13.3);
- `vane`: the first `gale` notch;
- `calm`: the first auto-calm (never fires since fix round 3: there is no auto-calm; UI's cut 3 had removed it);
- `settle`: the first rescue capture (Nubs, once per profile).

The tip texts are §13.1. A drag that turns nothing (an ignored edge press) gets no hint.

---

## 7. Feedback (ART, with UI's cue line)

### 7.1 The button

One disc; the act's icon (snowflake `snap`, flame `burn`, leaf `grow`, still-wind `calm`); the walker's
meter ring around it; shape carries every state, never colour alone.

| State (`view`) | Look |
|---|---|
| ready | full colour; one pulse (scale 1 → 1.08 → 1, 600 ms) when it becomes ready |
| charging (`snap`, meter < 1) | the frost fill arc; icon at 60%; the Frost Bank's two charge coins hang under it (today's) |
| locked | padlock glyph and the seconds to the TAG |
| low | the next cost in red under the icon |
| idle (nothing to act on) | icon at 45% |
| working (Sprout pouring) | a progress ring `size / goal` |
| armed / queued | up to 2 pips on the rim (filled per arm or job) |
| due | amber ring pulsing (1 → 1.08, 600 ms period); red and faster (400 ms) when urgent |
| buffered | a rim spinner, up to 300 ms |
| incoming (pre-TAG) | the next element's icon with a small arrow |
| Gust | one or two chevrons on the rim the way the vane blows (dimmed while resting) and "−N/s" under the Lift pill |
| pressed (`buttonDown`) | press-in to 0.92 within 60 ms of the pointerdown, drawn from the input state in the same frame; springs back within 60 ms when the touch turns into a drag (§1.3) |

The walker's meter pill (Flame, Sap, Lift) moves to sit above the button (`cy − 52k − 14k`); on Drip
legs the Size pill sits at the button's centre. Handedness mirrors the button, its pill, chips and
pips.

### 7.2 In the world and on the dial

- **Pick ring and tether:** on Ember and Sprout legs, a ring on `view.pick` (Ember short dashes,
  Sprout leaf dashes) and a 1 px line at 50% alpha from the button's rim to it, every frame, before the
  press. Armed targets carry a flame pip; queued sites a sap pip. v2's telegraphs (sweet band, tap-now
  pulse, too-late cross, bridge chevrons, hold ring, growth bars) stay.
- **Ghost sun:** while a world finger is down on a sun leg, a hollow sun on the dial at `θ + lag` (the
  finger's target). If `settleTarget(s, θ + lag, R, nowOnly)` is finite and differs, a small filled
  ring at the settle point and that one arc brightened; the dial's other layers at 60%.
- **Glides** are visible as motion (240 °/s); a capture flashes the arc for 200 ms.
- **Hand-over:** a dashed sweep from θ to the target for the glide's length.
- **Lock countdown:** in the 60 ticks before each lock a ring around the sun pointer drains, then the
  padlock (replaces today's 36-tick tint).
- **Vane:** chevrons at the wind chip; the arrival ghosts follow `driveWeatherX`; while the vane is
  set, a second ghost at 40% of the first's alpha, dashed, shows where each cloud lands if you calm
  now (`driveWeatherX(…, 0)` = `weatherXAt`, §3.5).
- **TAG pre-aim:** during a telegraph the dial's `guide.tag` arc (today's) is what the magnet honours
  (§4.2); no new art.
- **Retired visuals:** the gust-concept wind streaks (`drawGustStreaks`) and the HUD's gust glyph on
  the progress head go; the Trials wind chip stays.

### 7.3 Haptics (`src/platform/haptics.ts`) and audio (`src/audio`)

| Moment | Haptic (new names) | Audio |
|---|---|---|
| `PRESS` | `act` 8 ms | today's `ui` click |
| `REFUSE` (first of its reason this leg), `EXPIRE` | `refuse` [30, 40, 30] | today's fizz |
| `REFUSE` repeat (`a ≥ 16`) | none | none (the chip still shows) |
| `SETTLE` (a = 1) | `settle` 6 ms | `clink` (the one new recipe) |
| `NOTCH` | `notch` 6 ms | today's detent click |
| `CALM` (a = 0, 1) | `act` 8 ms | none |
| `CALM` (a = 2, already calm) | none | none (the soft cue "The wind is calm") |
| sim `detent` while `view.glide` is finite (a magnet glide) | none | none |
| sim events (`burn`, `grow`, `gust`, `snap`, `feed`…) | today's | today's |

The existing gating (40 ms spacing, detent limits) applies. iOS has no vibration: every haptic has a
sound and a visual. Nothing buzzes or clicks while the player is not touching except `SETTLE`, so
magnet motion never reads as a phantom input.

### 7.4 Latency

- Pointer move to sun turn: one frame (unchanged).
- Button pointerdown to the press-in look: the same frame.
- Button commit (the lift of a still tap, or 120 ms still) to its act: the next tick batch (≤ 1 frame).
- `touch.spec` (§12.2) measures move-to-θ and commit-to-`drive` change: ≤ 50 ms at the 95th
  percentile.

---

## 8. Accessibility and settings

### 8.1 Settings (`src/meta/saveTypes.ts` `Settings`, UI)

| Field | Values | Default | Effect | Marks the run assisted (Compass 🧭) |
|---|---|---|---|---|
| `aim` | `'standard' \| 'strong' \| 'light' \| 'off'` | `'standard'` | §4.3 | `strong`, on any run (as Guide "Always" does) |
| `swingBoost` | boolean | `false` | §1.2 | no |
| `hand` | `'right' \| 'left'` | `'right'` | mirrors the button (§1.1, §7.1) | no |
| `autoAct` | boolean | `false` | §3.6 | yes, on any run |
| `sensitivity`, `invert` | as today | | | |

- Sanitize fills missing fields with their defaults; no save version bump. Merging takes the newer
  settings object as today.
- **Screen** (Settings → Controls): Drag speed, Invert, Aim help (four choices: "Standard: the sun
  slides into nearby shade", "Strong: it reaches farther (marked 🧭)", "Light: only a nudge", "Off"),
  Swing Boost, Button side. Under Accessibility: Auto actions ("Ember and Sprout act on their own
  (marked 🧭)").
- **Params** (tests and tooling, like `?guide=`): `?aim=standard|strong|light|off`, `?hand=left|right`,
  `?boost=0|1`, `?autoact=1`.

### 8.2 Guarantees

- **One hand, one thumb, either side.** No holds, swipes, long-press limits, simultaneous inputs or
  second fingers. Every control is in the bottom band; nothing needs a reach above Nubs.
- **No dead drag.** A drag that starts on the button turns the sun; a still stray contact yields the
  world slot to the thumb; a palm that lands mid-drag is ignored.
- **The magnet never fights the player:** nothing moves the sun for 250 ms after a lift, a re-grip
  within 0.5 s undoes any glide, a pre-aim at the next element is kept, and aim help stops 5 s after
  the player's last sun move.
- **No act window under 1.5 s** (arming, jobs and G9 over pressable ticks); the shortest wait is the
  300 ms buffer, and it only ever helps. The button's pulse and its pick always name the same target.
- **Targets:** the button's hit disc is 104 px across at 390 px wide (≥ 88 px at 0.85), 18 px clear of
  the side edge zone; pause 48 px.
- **Keyboard parity** (§1.4) on every leg; switch users map to these keys.
- **Reduced motion:** glides at 180 °/s; pulses become a static 3 px outline; no button scale bounce
  or wobble (a colour swap); no camera kick on capture; banners appear without sliding.
- **High contrast:** button states by shape (padlock, pips, spinner, rings); pick rings double
  stroked; glare stays red with a hatch.
- **Screen reader:** the cue line (aria-live) announces each TAG banner, "Cold Snap ready", each
  refusal reason, auto-calm, and "Armed" / "Growing" on accepted presses.

---

## 9. Difficulty and fairness

### 9.1 What gets harder, and what never does

- **Never:** input windows, precision below the magnet's floor, timing at lift, hidden gestures,
  inverted or ignored input without a telegraph.
- **Nubs (Journey, Endless):** noon height (εnoon 48 → 80 on bosses), walk speed (sprint), caster
  spacing (sparse, lowland), clouds (drought, fleet), glare density, telegraphed flares and bosses,
  Noon Heat, thaw and ration budgets, glass and bud decisions, the Frost Bank and Sun Lock (countdown).
  The magnet radius tapers 14° → 12° → 10° across the Journey and the rungs, and it only ever helps a
  player who is playing.
- **Trials:** object density, `costMul` and start meters, weather that douses fire and veils
  targets, Flame, Sap and Lift budgets, cross-leg investments, hand-off cadence (T7 changes walker
  about every 7 s; the gestures do not change, only what the drag moves and the button's icon).

### 9.2 Guardrails (gates, §10.3)

- Every required act can be pressed for at least 1.5 s in a row before its last moment, counting
  only ticks where it is the pick, an arm or job slot is free and no other act's pre-TAG window
  holds the button (G9).
- No two inputs are ever required at once (the touch bots are single-thumb, §10.2).
- Constant inputs never win, **through the driver too**: a fixed sun angle (G5b), a fixed vane (G5e),
  spam (G5d), idle (G5a), and idle or a parked sun with aim help on (G5f on Trials; the Journey and
  Endless idleTouch gates of §9.5). Aim help must never win a level, a Trial or a day by itself.
- The controls change never makes a level harder for a human model: each substituted level, each new
  teaching slot and each chapter is checked against humanDial on the old content (§9.5).

### 9.3 Golden policy (`node scripts/golden.ts`)

| Key | Allowed to change |
|---|---|
| `scripted`, `oracle3min`, `headless_7_3600_reactive`, `chunks`, `chunksPlanOff`, `buds`, `forecasts`, `rungs` | **no** (byte-identical) |
| `trials` | **no, in the refactor's proof commit**: the bot refactor onto `drive/pick.ts` must reproduce every Trial hash. After it, a §10.1 lever may re-pin **only the lever's Trial's own entries** (`'100N'` and `'100N:…'`), each with its reason in §16 |
| `campaign` | **only the entries of L32 and L100** (retired concepts); L1, L6, L36, L38 and L200 byte-identical |

**Order (CORE):** (1) C0c, then a separate commit "pick.ts refactor" with `node scripts/golden.ts`
showing an empty diff (the proof); (2) the driver, gates and Journey commits; (3) only then any §10.1
lever commit, one Trial per commit, whose golden diff touches that Trial's entries alone. C0a, C0b,
ART's and UI's branches change no key at all. Only CORE's Journey commit moves the two `campaign`
entries.

### 9.4 Bake policy (`node scripts/sim.ts --bake`)

- `BAKE_VERSION` **stays 4**. `levelBakeKey` changes for exactly the 46 retired-concept levels (the
  39 of Mirror Sun, Slippery Sun, Clockwork and Gusts and the 7 of Heavy Sun; the five new teaching
  slots L16, 29, 30, 31, 32 are among them); `levelBake.test.ts` then requires a re-bake.
- CORE runs a **full** `--bake`. The regenerated `src/config/levelBake.gen.ts` may differ only in those
  46 entries (and the `LEVEL_BAKE_RUN` line); an entry with an unchanged key whose content changed is a
  failure (the bake is deterministic per level). A §5.3 lever re-bakes only levels inside the 46. The
  integrator checks the diff.
- `levelBake.test.ts` spot levels (6, 21, 32, 38, 50, 190) stay; L32's expected world is re-read.
- Saved stars are kept by level id.

### 9.5 Recalibration gates

**Baseline.** The human comparisons need humanDial on the **old** content with the **old** controls.
CORE runs `node scripts/sim.ts --campaign --bot humanDial --streams 20 --json <scratch>/base.json` on
the commit before its Journey commit (C0c or the refactor commit: retired concepts still live, the bots
unchanged), outside the repo, and records the file's SHA-256 in §16. `--campaign --compare
<scratch>/base.json` reads it on the new content. Streams are held out (never baked on).

| Gate | Kind |
|---|---|
| `sim --campaign`: oracle passes 200/200 (verb goals included) | **hard** |
| reactive passes ≥ 95% of 1-100 | **hard** |
| the Feat-seeking oracle earns ★2 on ≥ 85% and meets every Dare of 1-10 | **hard** |
| **Substituted levels:** on each of the 46, humanTouch's first-try passes over 12 streams ≥ humanDial's on the old definition − 1 (a failure moves the level through `SUB_OVERRIDE`, §5.3) | **hard** (new) |
| **New teaching slots** L16, 29, 30, 31, 32: humanTouch passes on its first try on ≥ 17 of 20 streams (85%, J2's bar; levers §5.3) | **hard** (new) |
| **Chapters:** in every chapter, humanTouch's passes (`--tries 3`, 20 streams) ≥ humanDial's on the old content | **hard** (new) |
| **idleTouch** (no input, the driver at the run's Standard radius, §10.2) passes no Journey level that plain `idle` does not already pass (both with the lesson off, levels 1-200) | **hard** (new; lever `AIM_OVERRIDE`) |
| `idle` passes printed per level (today L2, 14, 15, 18, 26, 34, 51 of 1-60) | advisory (new; pre-existing content, §15) |
| humanDial (unassisted) ≥ 85% of 1-40 on its first try, and the 1-10 soft-fail row | advisory (unchanged) |
| **humanTouch** (humanDial + the driver at Standard, §10.2) ≥ 90% of 1-40 on its first try | advisory (new) |
| humanTouch `rest` variant (rests the thumb instead of lifting) ≥ humanTouch − 2 points on 1-40 | advisory (new) |
| humanTouch's Dare-met and cool-run-star shares printed beside the oracle's | advisory (new; Dares and stars stay oracle-sized, no re-sizing this round) |
| `sim --check --seeds 40` (Endless) | **hard** (unchanged; these bots never use the driver) |
| `--check`: idleTouch at R2, R3 and R4 reaches the first nightfall on 0 of 40 seeds | **hard** (new; lever `AIM_OVERRIDE` on that rung) |
| `--check` advisory rows: humanTouch at rungs R0-R4 outlives humanDial at the same rung (median minutes); idleTouch at R0-R1 printed | advisory (new) |
| `sim --trials --check` (§10.3) | **hard** |

The late Journey stays hard for a human model even with aim help (the onethumb measurement: L100,
L140, L200 at 0-2 of 12 assisted). That is noon heat and resources, a content question outside this
spec; the advisory rows record it.

Review measurement (an approximation of §4 without the engagement window, R 14/12/10, settle and
track, no input; scratch scripts outside the repo): idle with the magnet passed 14 of Journey 1-60
against plain idle's 7 (new: L1, 9, 11, 23, 28, 33, 52, 54), cleared L1's lesson at tick 116 and 5
of 6 Endless R0 tutorial seeds with no input, and lifted Endless R2's median idle survival from 129
to 202 minutes (no day won; R4 unchanged at 30). The engagement window and the lesson rule (§4.1) are
the answer; the idleTouch gates prove it.

---

## 10. Trials: authoring and the proof harness

### 10.1 The Trials keep their pins

The seven TrialDefs, salts, objects and tunes do not change. Only their card copy does (§13.2).
G0-G7 and G5b keep their v2 definitions; the audits (G1) keep their single-pointer schedules, which
model a weaker player than the button gives, so they remain valid proofs. If a new gate (§10.3) fails,
the levers come in this order, each on that Trial only, after the refactor's proof commit (§9.3), with
its reason in §16:
1. **driver levers** (no golden change): for G5f, `AIM_OVERRIDE` for that Trial (track off, then the
   radius down 2°, floor 8°); for G9, `TUNING.drive.ember.arms` or `sprout.jobs` 2 → 3 (global, the
   only global lever, taken once);
2. **content levers**: `ELEMENTALS_V2.md` §6.5's (same bounds, same records), re-pinning only that
   Trial's `trials` golden entries.

### 10.2 Bots model the new controls (`src/core/sim/bots*`, CORE)

- **Shared policy.** `src/core/drive/pick.ts` holds `emberDue`, `emberLast`, the Ember pick,
  `sproutPick`, the job goals, `showered`, `downwind`, `ownAhead` and the Gust floor.
  `createElPolicy`'s Ember, Sprout and Gust timing is refactored to call them (the bot passes its
  press lead, `TAP_PRESS` + jitter; its own target order and margins stay its own, so its play does
  not change). The `trials` golden must stay byte-identical in that commit: that proves the refactor
  kept the bots' play (§9.3).
- **`humanTouch`** (new `BotKind`, tooling only): humanDial's sun play (lag, aim error, min-jerk drags,
  lift at ω = 0) through a driver with the run's Standard `aimRadius` and Auto Snap rule. Its Cold
  Snaps are presses (`act`) when humanDial would snap. On Trials its element legs use
  `createElPolicy({ human: true, touch: true })`:
  - **one thumb:** a press waits for any sun drag to end; the next sun drag starts ≥ 150 ms after a
    press (humanEl's re-grab);
  - **Ember:** presses once per target, `ready()`'s reaction delay (250 ± 80 ms, and 1.2 s first
    exposure) after the target becomes `view.pick`, while fewer than 2 are armed;
  - **Sprout:** presses once for each crossing when it becomes the pick (reaction delay), and once per
    plot while Sap > 45 (a plot's 20 plus the 25 reserve), skipping `downwind` plots;
  - **Gust:** every 6 ticks the policy's swipe decision (today's `gust()` scoring) becomes a vane
    target: a wanted swipe `dir` sets `n = dir` (`n = 2·dir` when it wanted two swipes the same way
    within 30 ticks), after the reaction delay; 5% of new settings go the wrong way and are corrected
    after one more reaction delay; 10% land one decision late; the bot presses Calm after 90 ticks
    with no wanted swipe;
  - **Drip:** humanEl's steer (unchanged);
  - **before Drip:** humanEl's aim at `guide.tag` (N(0, 6°)); the driver's hand-over finishes it.
  - **rest variant** (`humanTouch` with `{ rest: true }`, a `--campaign` row): instead of lifting at
    ω = 0, the thumb stays down and still between strokes (`rest` frames after 300 ms), so §4's
    resting-finger help is measured.
- **`reactiveTouch`** (new `BotKind`): the reactive bot's sun play; element acts as presses the tick a
  target becomes the pick; Gust as the same vane mapping with no delay or errors; through a driver at
  the Trials' Standard radius.
- **`idleTouch`** (new `BotKind`): the start tap and nothing else, through a driver at the run's
  Standard radius (Journey, Endless, Trials). With the engagement window it should equal `idle`; the
  gates prove it.
- **Parked sun** (`reactiveTouch` with `{ park: θ }`, harness only): one drag to θ in the start beat,
  then no sun input at all; element presses and vane as `reactiveTouch`; the driver on. Scanned over
  every degree like G5b.
- **`mashTouch`** (new `BotKind`, tooling only): the reactive sun; on Ember and Sprout legs one press
  every 30 ticks (0.5 s), blind; Gust exactly as `reactiveTouch` (the policy's vane), so only the
  Ember and Sprout decisions are mashed. It measures whether those decisions still matter (G11).
- **Required first, everywhere.** The touch bots press through their driver, so `emberPick`'s
  required-first order and `sproutPick`'s downwind rule (§3.2, §3.3) are what G8, G8b and G9 measure.
- **Bot view.** Every touch bot exposes `readonly drive: Readonly<DriveView>` (its driver's view);
  the session renders it in `?bot=` runs (§2.1).
- The reactive, oracle, humanDial and humanEl bots are unchanged (they keep the goldens and today's
  gates).

### 10.3 Harness additions (`scripts/sim16/trials.ts`, CORE)

New rows: humanTouch (16 salts), reactiveTouch (8 salts), idleTouch, the parked-sun scan, mashTouch
(8 salts). New gates:

| Gate | Requirement | Kind |
|---|---|---|
| G5e | Constant vanes fail: for each of `n ∈ {−2, −1, 1, 2}`, the pathBot with its Gust input replaced by that notch held from the leg's first tick (the governor's rules, no Calm) fails every Gust leg of T4, T6 and T7 | hard |
| G5f | Aim help never plays alone: idleTouch fails every Trial (G5a through the driver), and the parked sun fails every Trial at every degree (G5b through the driver) | hard (lever: `AIM_OVERRIDE`, §10.1) |
| G8 | Touch contract: per Trial, humanTouch wins ≥ humanEl's wins − 1 (of 16) | hard |
| G8b | reactiveTouch wins ≥ 7 of 8 per Trial | hard |
| G8d | Late hands on Gust (fix round 3): reactiveTouch whose Gust input starts 60 ticks (1 s) into each Gust leg wins ≥ 7 of 8 on T4, T6 and T7 | hard |
| G9 | Act windows over **pressable ticks**: on the reactiveTouch salt-0 run, for every required target (every Ember wall, every crossing) the pathBot acts on, the longest run of consecutive ticks in which it is pressable is ≥ 90 (1.5 s). A tick is pressable when the target is eligible and unveiled in range and before its last working tick (§3.2, §3.3, the walker one tick on), it is the pick computed as if it were not yet armed or queued (required-first order), fewer than 2 arms or jobs other than its own are live, and the tick is not inside the last `preTagTicks` before a TAG into a different act. Print the shortest window per Trial and the target | hard (levers §10.1) |
| G9b | Time after a TAG (fix round 3): on the reactive salt-0 run, a driver that only watches reports, for each Ember or Sprout leg, the first tick its `view.due` turns amber; it comes no sooner than 90 ticks (1.5 s) after the leg's TAG (a leg with nothing due passes) | hard |
| G10 | Lasting arcs on Nubs legs: the share of guide refreshes on the pathBot's Nubs legs where `now ∧ next` has an arc ≥ 6° wide (printed per Trial) | advisory |
| G11 | Decisions matter: on T5, T6 and T7, mashTouch's Dare share (and stars) < reactiveTouch's; printed for every Trial with its wins | advisory (a miss is recorded in §16 as a content follow-up for the mixers; it does not block) |
| G4t | humanTouch's pass share against G4's bands (75-95% intros, 45-90% mixers) | advisory |

`--pick` includes G5e, G5f, G8, G8b, G8d, G9 and G9b. `--perf` adds the driver's µs per tick on T7 (gate ≤ 5 µs
median).

---

## 11. Contracts

### 11.0 Teams, ownership, branches

| Team | Owns (writes) | Never edits |
|---|---|---|
| **CORE** | `src/core/**` (new `src/core/drive/**`), `src/config/**`, `scripts/**`, `tests/golden/hashes.json`, `tests/unit/{drive,sun,elements,trials,golden,determinism,generator,sim,campaign,levelBake,bots,journeyKeys}.test.ts`, `src/core/README.md`, `docs/CAMPAIGN_PLAN.md` | render, audio, ui, meta, game |
| **ART** | `src/render/**`, `src/game/fx.ts`, `src/audio/**`, `src/platform/haptics.ts`, `tests/unit/{render,audio*,haptics}.test.ts`, `tests/e2e/render.spec.ts` | core, config, ui, meta, the rest of game |
| **UI** | `src/ui/**`, `src/meta/**`, `src/game/**` except `fx.ts` (`input.ts`, `session.ts`, `camera.ts`, `moments.ts`, `assist.ts`, `params.ts`, `debug.ts` included), `src/main.ts`, `index.html`, `tests/e2e/**` except `render.spec.ts`, `tests/unit/{game,save,saveSync,progression,ui-logic,moments,share,campaignGame}.test.ts`, `src/game/README.md`, `src/ui/README.md` | core, config, render, audio |

1. C0a and C0b land on `claude/mobile-game-web-prototype-54l0ia` (the integrator writes them across
   layers, deleting and stubbing only outside contract files), each measured with a real
   `build:single`, the size in the commit message and in §16.
2. The teams branch from C0b: `controls3/core`, `controls3/art`, `controls3/ui`, each in its own
   worktree.
3. CORE lands C0c (the driver skeleton) on the base as soon as it passes its gates; ART and UI rebase.
4. Merge order CORE, ART, UI (`--no-ff`); the integrator runs §12.5 after each merge.
5. A contract change goes through the integrator as C1, C2… with this doc updated; teams rebase.
6. ART and UI may merge `controls3/core` locally to preview real behaviour; never committed.

### 11.1 C0: demolition, contract, skeleton

**C0a, demolition** (no behaviour added; goldens byte-identical):
- `input.ts`: `classify` and `SNAP_*`, `velocity`/`pushSample`/the ring, the verb slot (`vId`…,
  `poll`, `moveVerb`, `toSun`, `endVerb`), the `BLOW` swipe window, `METER_TAP_*`, `requestSnap`,
  `cut`, `dropVerbs`.
- `session.ts`: the `canSnap`, `meterHit`, `toWorld`, `canTarget` host members and their helpers.
- `hud.ts`: `hudMeterHit`'s tap rule (the coin stays drawn).
- Tests of the removed recognizers (`game.test.ts` input sections, `mechanics.spec` swipe tests,
  `elementals.spec` tap/hold/swipe tests) are deleted; `mechanics.spec.ts` and `elementals.spec.ts`
  may carry `test.fixme` for their rewritten cases until UI lands (only those two files).

**C0b, contract** (the teams branch from here; goldens byte-identical):
1. Config: `TUNING.drive` (§11.2); `HEROES` new fields and copy (§11.2, §13); `src/config/controls.ts`
   copy (§13.3); `snapReady` moved from the bots to `src/core/sim/mechanics.ts` and exported.
2. Core: `src/core/drive/` with every export of §11.3 at its final signature. Stubs: `createDriver` sets
   `view.act` per leg, applies vane notch math, resolves Cold Snap presses (`f.snap` when
   `snapReady`), and does nothing else; `settleTarget` returns NaN; `driveWeatherX` returns
   `weatherXAt`; `aimRadius` is the full table; the pick functions return −1 / `Infinity`.
3. Input skeleton (UI file, integrator-written): the world slot with the three kinds (no slop, no boost,
   no ramp, no yield, no rest, first pointer wins), the button slot calling `host.buttonHit` (a press
   commits on its lift; the drag-through and the 120 ms commit come with UI's branch), the key table,
   `controls()` (`rest` always false), `handoff()` with zero baseline (no ramp, no guards).
4. Session wiring: the driver in the tick loop (§2.1), `begin`/`interrupt` calls, notes drained into
   no-op routes, `RenderInput` fields (§11.7), `testState().drive`, the test hook members (§11.8).
5. Render: `hudButtonHit` and `hudButton` with §1.1's geometry; the existing coin drawn at the new
   centre as the placeholder button; `fx.onDrive`, `audio.onDrive`, `haptics.onDrive` as no-ops.
6. Meta: the `Settings` fields with defaults and sanitize.
7. Retired-concept readers outside CORE files go now, with their tests, so CORE can drop the ids from
   `ConceptId` without touching other layers: the Mirror Sun hint inversion in `session.ts`, `gusty`
   in `src/game/campaign.ts` (the `still` Dare's word is always `FEAT_WORDS`'), the `'mirror'` mapping
   in `render/banners.ts`, the five entries of `src/ui/concepts.ts` (`heavy: 'gauge'` included), and
   the retired concepts' glyphs in `render/glyphs.ts` where they are keyed by a retired id (`heavy`
   among them). Readers of `sun.gust` (always 0 once CORE lands) are removed by ART and UI in their
   branches. The `dazzle` forecast and the `gusts` glyph (the Trials wind chip) stay.

**Gates for C0a + C0b:** `node scripts/golden.ts` diff empty; typecheck; vitest; `build:single`
**≤ 825,000 B**, measured and published; Playwright smoke, layout and flows pass.

**C0c, skeleton** (CORE, on the base, two commits): first the shared `pick.ts` with the bot refactor
alone (`emberDue`, `showered`, `downwind`, `ownAhead` and the policy's Lift floor moved; goldens
byte-identical: the proof commit of §9.3); then Ember arms and ignition (required-first pick, last
working tick one tick on), Sprout jobs with goals and release (downwind-aware pick), and the Gust
governor (policy floor, symmetric notches). No magnet, hand-over, due, Auto actions, Auto Snap or notes
beyond `PRESS`/`REFUSE`.

### 11.2 Config (`src/config`, CORE)

```ts
// src/config/tuning.ts: a new block (read only by src/core/drive and the bots; never by step()).
  /** Controls v3 (docs/CONTROLS_V3.md §2-§4): the driver's numbers (ticks at 60 Hz, degrees, meter units). */
  drive: {
    /** A press that is not legal yet waits this long (300 ms), then is refused. */
    bufferTicks: 18,
    /** A press this close before a TAG into Ember or Sprout acts for the incoming element (0.75 s). */
    preTagTicks: 45,
    /** Due prompts: amber within dueTicks of a required act's last moment, red within urgentTicks. */
    dueTicks: 60,
    urgentTicks: 24,
    ember: { arms: 2, dryTicks: 60, dryFlame: 30, tagMargin: 2 },
    sprout: { jobs: 2, urgent: 90, step: 20, plotSap: 25, plotMin: 5, dueGrowLeft: 120, urgentGrowLeft: 60 },
    /**
     * Vane notches ±1 breeze, ±2 gale: band floors (u/s), gust spacing (ticks), the Lift floor (the
     * policy's: `lift` while own weather is ahead, else one gust's price + `gain`), steady Lift/s per notch at costMul 1.
     */
    gust: { band: [0, 15, 30], every: 15, lift: 20, gain: 2, cost: [0, 4.9, 13.0], low: [0, 5, 15], lowCost: [0, 2.7, 4.9] },
    aim: {
      /** Capture radius (°): Journey L1-40, 41-100, 101-200; Endless rungs R0..R4; Daily and challenges; Trials; Strong; Light. */
      journey: [14, 12, 10],
      endless: [14, 14, 14, 12, 10],
      daily: 10,
      trials: 14,
      strong: 14,
      light: 8,
      /** Glide speed (°/s), under reduced motion. */
      rate: 240,
      rateReduced: 180,
      /** Land this far inside an arc (°, at most half its width); track when closer than `edge` to an edge. */
      inset: 4,
      edge: 2,
      /** An ending sun is rescued after this many idle ticks; one glide start per gapTicks. */
      endingTicks: 18,
      gapTicks: 30,
      /** Aim help acts only within engageTicks of the last sun move (5 s), never during the lesson. */
      engageTicks: 300,
      /** Re-grip grace: no glide for regripTicks after a real lift; until againstTicks, none against the stroke by more than againstDeg, and a re-grip undoes a glide. */
      regripTicks: 15,
      againstTicks: 30,
      againstDeg: 4,
      /** A real downEdge this soon after a glide's start undoes it (fix round 3). */
      raceTicks: 3,
      /** The pre-TAG hand-over into Drip: last ticks, reach (°), inset (°). */
      handTicks: 60,
      handReach: 30,
      handInset: 3,
    },
    /** Endless comfort rungs ≤ rungs: a ready Cold Snap casts itself when Nubs is lit with Chill < chill. */
    autoSnap: { rungs: 1, chill: 20 },
  },
```

```ts
// src/config/heroes.ts: HeroInfo additions (verb, sunHeld and the rest stay).
export type DriveAct = 'none' | 'snap' | 'burn' | 'grow' | 'calm';
export type DragKind = 'sun' | 'steer' | 'vane';
// (both re-exported from src/core/index.ts)
  /** What the button does while this element walks (§0.1). nubs 'snap', ember 'burn', sprout 'grow', drip 'none', gust 'calm'. */
  readonly act: DriveAct;
  /** What a world drag moves. nubs, ember, sprout 'sun'; drip 'steer'; gust 'vane'. */
  readonly drag: DragKind;
  /** The TAG banner's two lines (§13.1). */
  readonly dragLine: string;
  readonly actLine: string;
  // gesture ids: 'g-drag' (nubs), 'g-press' (ember, sprout), 'g-steer' (drip), 'g-vane' (gust).
```

`src/config/concepts.ts` and `campaign.ts`: §5.3. `src/config/trials.ts`: card copy only (§13.2).

### 11.3 Core drive API (`src/core/drive/`, exported from `src/core/index.ts`)

```ts
export type AimSetting = 'standard' | 'strong' | 'light' | 'off';

/** Per tick, from the input (or a touch bot). */
export interface DriveControl {
  /** 1 when a press lands on this tick. */
  act: 0 | 1;
  /** Gust: the vane's change this tick (notches; drag px / 36, keys ±1). */
  vane: number;
  /** Gust: the vane's finger lifted, or a key set it: the raw value snaps to its notch. */
  vaneUp: boolean;
  /** The world sun finger is down and has moved < 3 px over the last 300 ms (§1.2): aim help treats it as no hand. */
  rest: boolean;
}

export interface DriveOpts {
  /** Magnet capture radius (°; 0 off) and whether it tracks (§4.3). */
  readonly aimDeg: number;
  readonly track: boolean;
  /** 'fog' level: the magnet reads guide.now only. */
  readonly nowOnly: boolean;
  /** Endless rungs R0-R1: Auto Snap (§3.1). */
  readonly autoSnap: boolean;
  /** Settings → Auto actions (§3.6). */
  readonly autoAct: boolean;
  /** Glides at rateReduced. */
  readonly reducedMotion: boolean;
}

/** What the HUD, the dial, the tips and the test hook read (updated by fill). */
export interface DriveView {
  /** The button's act on this leg ('none': no button). */
  act: DriveAct;
  /** 0 idle, 1 ready, 2 locked, 3 low, 4 working, 5 charging. */
  state: number;
  /** 0..1: the frost meter (snap), the running job's size / goal (grow); 0 otherwise. */
  fill: number;
  /** Ticks to the TAG while locked, else −1. */
  lockTicks: number;
  /** The next act's cost (Flame or Sap, costMul applied); 0 none. */
  cost: number;
  /** The object the next press acts on (index in s.el.objs; −1 none). */
  pick: number;
  /** Ember: armed objects in ignition order; Sprout: the running job's object, then the queued one (−1 empty). */
  readonly queue: Int16Array; // length 2
  /** 0 none, 1 amber, 2 red (§3.2, §3.3). */
  due: number;
  /** A press is buffered. */
  buffered: boolean;
  /** The act the button shows for the incoming element in the pre-TAG window ('none' otherwise). */
  incoming: DriveAct;
  /** Gust: the notch −2..2, resting (no weather in play), and the steady Lift/s it costs (costMul applied; 0 calm or resting). */
  vane: number;
  vaneResting: boolean;
  vaneCost: number;
  /** Fix round 3: how low Lift holds the set vane back: 0 full band, 1 the weaker band, 2 waiting for Lift. */
  vaneLow: number;
  /** The glide's target θ while one runs (NaN none), and whether it is the hand-over. */
  glide: number;
  handover: boolean;
  /** Fix round 3: the driver wrote a glide step this tick (the last one included). */
  glideTick: boolean;
  /** The last refusal's reason (§2.4 codes; 0 none) and its tick. */
  refuse: number;
  refuseTick: number;
}

export interface Driver {
  /** A new run, or a resumed one (retry from the Tag Stone, after testSkipToLeg): drops arms, jobs, presses, glide; vane 0. */
  begin(s: SimState, opts: DriveOpts): void;
  /** Pause, blur, releaseAll, every TAG: closes an open glide on the next fill; drops buffered presses (not the pre-TAG press). */
  interrupt(): void;
  /** One tick: after the input fills f, before step(s, f). */
  fill(s: SimState, f: InputFrame, c: Readonly<DriveControl>): void;
  /** Refreshes `view` from the state without acting or writing a frame (bot runs, frames with no tick). */
  observe(s: SimState): void;
  readonly view: DriveView;
  /** Notes since the last clear: pairs (code, a) in notes[0 .. 2·noteN). */
  readonly notes: Int16Array; // length 16
  readonly noteN: number;
  clearNotes(): void;
}
export function createDriver(): Driver;

/** §4.3: the capture radius for a run. */
export function aimRadius(setting: AimSetting, ctx: { mode: RunConfig['mode']; level: number | null; rung: number; trial: boolean; blind: boolean }): { deg: number; track: boolean };
/** §4.2: where a lift at θ would settle now (NaN: it would not move). Allocation-free; the dial preview and the tests use it. */
export function settleTarget(s: SimState, theta: number, aimDeg: number, nowOnly: boolean): number;
/** §3.5: weather object o's x after `ticks` with the vane held at notch n (the governor's gusts, no Lift limit); n = 0 is "calm now". */
export function driveWeatherX(s: SimState, o: ElObj, ticks: number, n: number): number;
// drive/pick.ts (shared with the bots): emberDue(s, i, lead), emberLast(s, i) (last working tick, the walker one
// tick on), emberPick(s, armed) (required walls first by last working tick, then puddles), sproutPick(s, inJob)
// (crossings, then plots not downwind, then any plot), jobGoal(o), showered(s, el, o, from, to), downwind(s, el, p),
// ownAhead(s, el), gustFloor(s, el) (the policy's Lift floor). The bots import these instead of their private copies.
```

`createBot` keeps its signature; the touch bots' `Bot` also carries `readonly drive: Readonly<DriveView>`
(§2.1, §10.2). `BotKind` adds `'humanTouch' | 'reactiveTouch' | 'idleTouch' | 'mashTouch'`; `BotOptions`
adds `rest?: boolean` and `park?: number`.

### 11.4 Other core changes (CORE)

- `src/core/sim/sun.ts`: §5.3 item 6. The coast branch, `TUNING.sun.flick*`, `releaseCap*`,
  `friction`, `catchOmega` stay.
- `src/config/concepts.ts`: five concepts out (Heavy Sun among them); five teaching slots; copy §13.4.
- `src/config/tuning.ts`: `TUNING.drive`; `AIM_OVERRIDE` (empty unless a lever needs it).
  `src/config/campaign.ts`: `RETIRED_DRAW`, the substitution table, `SUB_OVERRIDE`, `TOUCH_READS`
  (both empty unless a lever needs them), the three names.
- `src/core/sim/bots.ts`: `humanTouch`, `reactiveTouch`, `idleTouch`, `mashTouch` in `BotKind` and
  `BOT_KINDS`; the `dazzle` branches go. `bots/elements.ts`: the `touch` option and the refactor onto
  `drive/pick.ts`. `bots/dares.ts`, `feats.ts`: gust windows go.
- `scripts/sim.ts`: `--campaign --bot all` adds humanTouch (and its `rest` variant), idleTouch and
  their rows (§9.5), `--json` and `--compare`; `--check` adds idleTouch at R0-R4 (hard at R2-R4) and the
  humanTouch advisory rows; `--career --bot humanTouch` works. `scripts/sim16/trials.ts`: §10.3.
  `scripts/golden.ts`: unchanged.
- Nothing in `step()`, `InputFrame`, `RunConfig`, `hash.ts`, the generator, the validator or the element
  rules changes.

### 11.5 InputFrame and replays

- `InputFrame` is unchanged. `recordFrame` is unchanged and records the frame **after** the driver,
  so a recorded run replays bit for bit without a driver (`determinism.test.ts` checks a T5 and a
  T7 run played by humanTouch, and an L3 run with glides).
- Retry from the Tag Stone replays the recorded frames, then `driver.begin()`: arms, jobs and the vane
  restart empty (the player re-arms; the cue says "Back at the Tag Stone").
- Challenge codes encode no frames and do not change.

### 11.6 Input and session contract (UI)

```ts
// src/game/input.ts
export interface InputHost {
  canvas: HTMLCanvasElement;
  accepting(): boolean;
  onPress(): void;
  viewportWidth(): number;
  safeBottom(): number;
  /** What a world drag moves now: HEROES[walker].drag on a Trial past the start beat, else 'sun'. */
  drag(): DragKind;
  /** The button's act now (driver.view.act, or view.incoming in the pre-TAG window). */
  act(): DriveAct;
  /** (x, y) is inside the button's hit disc and the button takes presses now (hudButtonHit, phase 'day'). */
  buttonHit(x: number, y: number): boolean;
  /** The run is in its hold or start beat (§1.2 start slop). */
  starting(): boolean;
  /** World units per CSS px on the last drawn frame (Drip). */
  uPerPx(): number;
}
export class Input {
  sensitivity: number; invert: boolean; swingBoost: boolean;
  get pointerDown(): boolean;  // a world finger on the sun
  get steering(): boolean;
  get vaning(): boolean;
  get buttonDown(): boolean;
  get keyDown(): boolean;
  presses: number; acts: number; snaps: number;
  begin(e: PointerEvent): void; // the world slot (the Title tray handoff keeps using it)
  handoff(): void;              // every TAG (§1.5)
  releaseAll(): void;           // pause, blur, new run
  clearPending(): void;
  tap(): void;                  // Space/Enter start: downEdge + upEdge
  takeFrames(n: number): readonly InputFrame[];
  controls(): readonly DriveControl[];
  isEdge(x: number, y: number): boolean;
  dispose(): void;
}
// Constants (input.ts): EDGE_SIDE_PX 16, BUTTON_SLOP 12, BUTTON_COMMIT_MS 120, YIELD_PX 4, YIELD_MS 300,
// REST_PX 3, REST_MS 300, TAG_RAMP_SUN_MS 150, TAG_RAMP_STEER_MS 300, TAG_STEER_FAST 600 (px/s),
// TAG_VANE_PAUSE 40 (px/s) for 120 ms.
```

Session (UI) duties: build `DriveOpts` per run from `aimRadius(settings.aim, …)` (blind → 0, fog →
`nowOnly`), the rung (Auto Snap on R0-R1), `autoAct` and reduced motion; latch `runAssisted` for
`strong` and `autoAct` (§8.1); call `begin`/`interrupt` (§2.1); drain notes each frame into
`fx.onDrive`, `audio.onDrive`, `haptics.onDrive`, `moments.onDrive` and the cue line; set
`r.dragging = input.pointerDown || input.keyDown || input.steering || input.vaning || (bot ≠ null &&
sun.mode === 'dragging')` (a glide never lights the dial as a drag; every game-layer reader of "the
player is dragging", the lesson's hint tracker included, uses the input's state, never `sun.mode`); route `'tag'` to
`input.handoff()` and `driver.interrupt()`; keep `testSkipToLeg` bot-only and `begin` the driver
after it; in bot runs render `bot.drive` when the bot has one, else call `driver.observe(s)` once per
drawn frame, so the HUD's button stays true; drop sim `detent` events from haptics and audio while
`view.glide` is finite (§4.5); play no refusal haptic or fizz for a repeat `REFUSE` (`a ≥ 16`).

### 11.7 Render contract (ART)

```ts
// RenderInput (src/render/renderer.ts) additions, filled by the session every frame
  /** Controls v3: the driver's view (always set; `act` 'none' on the Title; bot runs pass the touch bot's `drive`, or keep it fresh with `observe`). */
  drive: Readonly<DriveView>;
  /** A pointer is down on the button. */
  buttonDown: boolean;
  /** The button's side (Settings). */
  hand: 'right' | 'left';
  /** Aim help in force (°; 0 off) and 'fog' now-only: the dial's ghost-sun preview. */
  aimDeg: number;
  nowOnly: boolean;
```

```ts
// src/render/hud.ts
/** True inside the button's hit disc (§1.1) while it is shown. */
export function hudButtonHit(h: HudState, x: number, y: number): boolean;
/** The button's centre and hit radius (CSS px) as last laid out, and whether it is shown. */
export function hudButton(h: HudState): { x: number; y: number; r: number; shown: boolean };
// src/game/fx.ts, src/audio (index), src/platform/haptics.ts
onDrive(code: number, a: number): void;
```

ART reads `settleTarget`, `driveWeatherX`, `aimRadius`, `sunLockedAt` and the `DriveView`; it never
calls the driver.

### 11.8 UI and meta contract

- `Settings` (§8.1); sanitize and defaults; Settings screen rows; params.
- `GhostMode = 'off' | 'both' | 'left' | 'right' | 'steer' | 'press' | 'vane'` (`'tap'` and `'hold'`
  go): `press` taps the button (anchored at `hudButton`), `vane` drags 40 px and lifts. Icons
  (`src/ui/icons.ts`): `g-press`, `g-vane` added; `g-tap`, `g-hold`, `g-swipe` removed.
- `moments.ts`: §6.2 triggers and §13.1 copy; `onDrive(code, a)`.
- Elementals screen: the verb row shows the hero's `gesture` icon, `verbLine` and `keyLine` (new copy).
- Results and shares: the Compass for `strong` and `autoAct` runs.

**Test hook** (`window.__SHADY_TEST__`, behind the `makeBot` gate as today):
- `state().drive`: `{ act, state, pick, queue: number[], due, buffered, incoming, vane, vaneResting,
  glide: number | null, refuse, aimDeg }`; `state().sunMode`, `state().lag`.
- `button(): { x, y, r, shown, side }` (CSS px).
- `acts(): number` (presses the input accepted).
- `testGuide(): { now: number[]; next: number[]; lasting: number[] }` (bins set).
- `testSkipToLeg(i: number, before = 0)`: stops `before` ticks ahead of TAG `i` instead of at it (to
  hold a finger through a hand-off).
- `mech().meterX/meterY` read the button's centre; `mech().snaps` counts snap presses.
- `tests/e2e/helpers.ts` mirrors all of these.

### 11.9 Stubs until merge

| Team | Has from C0b (and C0c) | Works around until the others merge |
|---|---|---|
| CORE | everything | verifies headless (`sim`, unit tests) |
| ART | C0b: `DriveView` with `act` per leg, notes routes, `hudButtonHit` geometry, `settleTarget` (NaN). C0c: real picks, arms, jobs and vane | previews the magnet and due prompts by merging `controls3/core` locally (never committed) |
| UI | C0b: the input skeleton, the driver in the loop, Cold Snap presses work. C0c: Ember, Sprout and Gust acts work end to end | tips on `due`/`settle` fire only once CORE lands them; the button is the coin placeholder until ART lands |

### 11.10 Team task lists and acceptance

**CORE:** C0c (the refactor's proof commit first); the full driver (§2-§4); the touch bots; harness
gates (§10.3) and `--campaign`/`--check` rows with the humanDial baseline (§9.5); the Journey content
(§5.3), the full bake and the two `campaign` golden entries; any levers, in §10.1's and §5.3's order,
each recorded; unit tests (§12.1); `src/core/README.md` (a Controls v3 section); `CAMPAIGN_PLAN.md`.
**Accept** when §9.3's golden policy and order hold, §9.4's bake diff holds, `sim --trials --check`
and `--campaign`'s and `--check`'s hard gates pass, and the branch's build delta over C0b (C0c
included) is ≤ 3,456 B.

**ART:** the button and its states (the drag-through spring-back included), handedness, the moved
meter pills, pick rings and tethers, pips, the ghost sun and settle preview, dial dimming, hand-over
sweep, lock countdown ring, vane chevrons, the arrival ghost and the calm-now ghost, the TAG banner,
the retired gust and Heavy Sun visuals removed, drive notes in fx/audio/haptics (repeat refusals and
glide detents silent), the `clink` recipe, four haptic patterns, `render.spec` frames (§12.2).
**Accept** when the Nubs frame's draw budget holds (§12.4), reduced motion and high contrast hold, and
the delta over C0b is ≤ 2,688 B.

**UI:** input (§1: drag-through button, still-pointer yield, rest, the TAG follow-through guards, 16 px
side zones), session wiring (§11.6), camera (§5.2), settings and params, ghost modes, icons, tips and
teaching (§6), cue line, test hook, e2e (§12.2), `game.test.ts`, READMEs. **Accept** when every
existing e2e passes (rewritten where §12.2 says), the new specs pass, and the delta over C0b is
≤ 2,176 B.

---

## 12. Tests and release gates

### 12.1 Unit tests

**CORE** (`tests/unit/drive.test.ts`, new, plus updates):
- presses: legal, buffered within 18 ticks, refused after with each reason; the pre-TAG press lands on
  the new leg's first tick; one press per batch.
- Ember: the pick order (required walls by last working tick before puddles; a puddle only when no
  required wall is unarmed in range); **the invariant `view.due > 0 ⇒ view.pick` is the due wall**, on
  T5 (u270 between b245 and g296) and T7 (u437 between b423 and g453) and in a randomized sweep over
  every Trial tick; arming cap; ignition on the bot's tick for each kind (own wall, ice, wall past the
  TAG, puddle) with `lead` 0; **an arm pressed on each of the last three working ticks burns** (the
  walker one tick on); the shower wait; `WAIT_LOW` then ignition once Flame covers it; `EXPIRE`; every
  `VERB_TAP` point resolves to its object.
- Sprout: the pick order (crossings, then plots not downwind, then any plot; T7: p428 before p420);
  goals (crossing need; plot 20, +20, cap 60); top-up; queue cap; pre-emption by a queued urgent
  crossing; release the tick after the goal; plot stop at Sap 25; job drop at `near` and TAG.
- Gust: notch math (raw, lift snap, keys; **±18 px gives ±1 symmetrically**); governor conditions
  (band, spacing, the policy floor with and without own weather ahead, weather in play); low Lift
  (the weaker band at the floor, waiting at one gust's price + gain, the drag kick, no auto-calm); resting; Calm on a calm vane is `CALM` a = 2 with no `REFUSE`;
  `driveWeatherX` equals stepping the sim with the governor, and with `n = 0` equals stepping it with
  no gusts.
- Magnet: rescue (lit, ending after 18 ticks); honour bud, glass, flare and (in a telegraph)
  `guide.tag`; **a sun parked in `guide.tag` before a TAG into Nubs is not moved**; the telegraph
  target prefers `T ∧ guide.tag`; no glare crossing; track re-inset without hopping; bin edges at
  `b ± 0.5` (`binOf`); radius table and `AIM_OVERRIDE`; glide frames sum exactly to `q1024(Δ)` and the
  sun lands within 0.01°; cancel by a downEdge and by a key (upEdge added); one glide per 30 ticks;
  the hand-over (Drip only, prefers `tag ∧ now`, ignores the bud/flake/flare honour); the re-grip
  carry; **no glide within 15 ticks of a lift; two strokes 200 ms apart lose ≤ 1° of the swing;
  a re-grip 400 ms after a lift undoes the glide since it**; **no glide during `s.lessonOn`**; **no
  glide more than 300 ticks after the last sun move, and none at all for an idle run, a resting
  finger that never moved, or a press-only player**; a resting finger gets a glide with no edges, and
  its next move continues from there.
- Auto Snap only on rungs ≤ 1; Auto actions equals the reactive policy's verbs on T1 and T3; in a
  lesson run `view.act` is `'none'` until the first `snapReady`.
- Determinism: humanTouch on T5 and T7 and an L3 run with glides (and one with resting glides),
  recorded and replayed: equal hashes.
- `sun.test.ts`: the mirror, clockwork and gust tests go; the `sunFollow` param path keeps a direct
  test (no concept uses it); `SunState.gust` stays 0.
- `campaign.test.ts`: no level carries a retired concept; the substitution table (five rows), its
  `SUB_OVERRIDE` and `null` fallback; the five teaching slots; 40 concept ids, all taught; names.
  `levelBake.test.ts`: keys current.
- `bots.test.ts`: the touch bots expose `drive`; idleTouch's frames equal idle's after the start beat
  when no glide is planned.
- `golden.test.ts` as today.

**ART:** `render.test.ts` (button geometry at 0.85/1/1.3 and both hands, 18 px from the side at 390;
`hudButtonHit`; pill placement; Nubs art unchanged); `haptics.test.ts` (the four patterns; a repeat
`REFUSE` and a glide `detent` are silent); `audioRouter.test.ts` (every note code maps to a cue or an
explicit none).

**UI** (`tests/unit/game.test.ts`, input sections rewritten):
- the world slot: the mapping; start slop (no turn under 10 px, catch-up after); Swing Boost's curve
  and off by default; first pointer wins; **a still owner (< 4 px in 300 ms) yields to a new press with
  zero jump; a moving owner keeps the slot against a later press**; `rest` after 3 px / 300 ms;
  `release` 0 on every lift.
- the button slot: a still tap commits on its lift; a still press commits at 120 ms; **a touch that
  moves 12 px first becomes a world drag from its touch-down point and acts nothing**; a timed commit
  that then moves 12 px also drags (the act stays); a drag from the button with the world slot busy is
  ignored; queue of 2; Drip corner is world; hold-phase press is a world press; repeat refusals carry
  `a ≥ 16`.
- keys per leg (§1.4); wheel.
- `handoff`: zero jump; into `sun` the 150 ms ramp; into `steer` motion over 600 px/s dropped then a
  300 ms ramp; into `vane` nothing until a 120 ms pause under 40 px/s; kind change; downEdge into a sun
  leg.
- `takeFrames`/`controls` batching and resets (`rest` on every frame); edge zones at 16 px (sides) and
  `max(safe, 8)` (bottom); the button tested before the edge zones.
- **A single-pointer drag and key script on a Nubs run past its start beat (no press inside the old
  edge zones or the button's disc) produces frames equal to today's on `dTheta`, `down`, `downEdge`,
  `upEdge`, `key`**; only `release` differs (now 0). A drag from the disc differs only in that its
  `downEdge` lands on the batch where it crosses 12 px, carrying the whole displacement.
- `save`/`saveSync`: the settings fields' defaults and sanitize; `moments`: the new triggers.

### 12.2 End-to-end (Playwright, both projects unless noted)

- `controls.spec.ts` (new): no coast (a 150 px stroke in 120 ms then lift, `?aim=off`: θ ends within
  1° of the finger's target and stays); start tap (a 6 px wobble starts the run, |Δθ| < 0.01°); first
  pointer wins (mobile); the button snaps on a 500 ms press (`demo('snapReady')`), refuses with
  `charging` when not full (the second refusal in a row has `drive.refuse ≥ 16`); a 100 px drag that
  starts on the button turns the sun and acts nothing; ↑ and ↓ snap; the magnet (`?aim=strong`,
  Endless: drag to 8° outside a lasting arc from `testGuide()`, lift: θ inside it within 0.5 s, and
  nothing moves in the first 200 ms); no glide 6 s after the last drag; `?hand=left` puts the button
  left of centre; a press at x = 12 px is ignored and one at x = 20 px turns the sun; the first-run
  lesson (a fresh save, no `seedSave`, so `tutorialDone` is false) shows no button and θ does not
  move without a drag.
- `elementals.spec.ts` (rewritten): T1 leg 1: a press arms (`drive.queue`), the wall burns before
  contact, θ unchanged by the press, ↑ arms; T2: a finger held through the TAG
  (`testSkipToLeg(1, 30)`) steers Drip within 0.5 s; T3: a press grows the first gap to its need, a
  second press on a plot tops it up; T4: a 40 px drag sets the vane to 1, the wind rises, ↑ calms,
  Lift spent is a multiple of 8 × `costMul`, ↑ on a calm vane shows "The wind is calm" with no
  refusal; Pause on a Drip leg; `bot('reactive')` passes T1 and T4; `bot('reactiveTouch')` shows the
  bot's pips (`drive.queue` non-empty on T1 leg 1); Retry from the Tag Stone resumes with `drive.queue`
  empty.
- `mechanics.spec.ts` (rewritten): the button snaps; a swipe down never snaps and turns nothing.
- `layout.spec.ts`: the button's hit disc inside the viewport and clear of the edge zones at 360×640,
  390×844, 430×932, 1280×720, both hands; the range check (a point 340 u ahead of Nubs is below the
  HUD band) at the same sizes.
- `touch.spec.ts` (new, mobile project only): real CDP `Input.dispatchTouchEvent` sent on a wall-clock
  schedule at 120 Hz **without awaiting each call** (awaiting throttles Chromium to about 20 Hz). The
  real-touch acceptance:
  - 13 thumb swings (80-160 px in 180-320 ms, lifted moving, `?aim=off`): each overshoots the finger's
    target by ≤ 2°;
  - 20 button presses of 80-600 ms with 2-8 px wobble: 20 counted presses (`acts`), none of which
    turns the sun; 5 of them, each on a full meter (`demo('snapReady')`, the previous snap waited out),
    cast a snap;
  - **20 thumb drags of 80-160 px that start inside the button's disc** (Endless, meter charging and
    meter full): 0 acts, 0 snaps, and each turns the sun 1:1 (within 1° of the drag's mapping,
    `?aim=off`);
  - **a still contact at x = 24 px held from before the drag, then a thumb drag**: the sun turns (the
    still owner yields); **a thumb drag, then a second contact landing mid-drag**: the thumb keeps
    turning the sun;
  - **two strokes 200 ms apart** (`?aim=standard`, the first lifted just outside a lasting arc): the
    final θ is within 1° of the two strokes' sum;
  - a start tap with 2-8 px wobble: |Δθ| ≤ 0.5°;
  - T3 leg 1: 10 presses, each right after a sun drag: every one answered on the next batch
    (accepted, or refused with a reason in `drive.refuse`), none lost;
  - T2: a ±70 px back-and-forth held through the TAG: Drip's `dx` moves ≤ 6 u in the first 150 ms
    after it and ≥ 10 u within 1 s;
  - T4: a swing carried 80 px past the TAG into Gust (`testSkipToLeg(i, 30)`) leaves the vane at 0;
    after a 150 ms pause, a 40 px drag sets it to 1;
  - T4 leg 1: 10 slow drags (40-120 px over 0.7-1.2 s): each leaves the vane at its notch, no gust
    spam (≥ 15 ticks between gusts);
  - latency: pointermove to θ, and a press's commit (lift or 120 ms) to `drive` change, ≤ 50 ms at the
    95th percentile; pointerdown to the press-in look in the same frame.
- `render.spec.ts` (ART): the button in each state (`?elfix=1` and demos), both hands, reduced motion
  and high contrast; the ghost sun while dragging; the calm-now ghost on T4; Trial frames within
  §12.4.

### 12.3 Bundle: 815 KiB = 834,560 B

`build:single` is 828,287 B today (1,153 B under 829,440 B). The demolition frees about 2.4-2.8 KB of
input recognizers and about 1.6 KB of retired-concept code, art and copy (Heavy Sun's included); the
driver, the button, the previews, the settings and the copy add about 7 KB, and the review's fixes
(drag-through button, still-pointer yield, rest, TAG follow-through guards, engagement window and
re-grip grace, required-first picks, policy floor, refusal repeats, glide detent mute, the lesson-run
button, bot views) about 0.9 KB more. The budget becomes **815 KiB = 834,560 B**, recorded by the
integrator in `docs/V1_6_PLAN.md` A3 and `docs/UI_V2.md` §13 with the reason "Controls v3
(docs/CONTROLS_V3.md): nine touch recognizers replaced by one drag and one button with a driver,
aim help that never plays alone, arming, pour jobs and the vane; five control concepts retired;
shipped feature code." **Recorded at the merge** (§16.3): the merged build measured 840,695 B and ships at
832,031 B, 2,529 B under, with no feature cut beyond the teams' own cut lists.

| Step | Size gate |
|---|---|
| C0a + C0b, measured and published before branching | ≤ 825,000 B |
| CORE over C0b (C0c included; the bots are not in `build:single`) | ≤ +3,456 B |
| ART over C0b | ≤ +2,688 B |
| UI over C0b | ≤ +2,176 B |
| Integration reserve | 834,560 − 825,000 − 8,320 = 1,240 B (more if C0 lands lower) |
| **Release** | **≤ 834,560 B** |

Every commit message states its measured `build:single`. Over its allowance a team applies its cut
list in order before asking for anything:

| Team | Ordered cut list |
|---|---|
| CORE | 1. `driveWeatherX` for `n ≠ 0` (the set-vane ghost; the calm-now ghost stays, it is `weatherXAt`); 2. the `ending` rescue (lit rescue only); 3. Auto Snap |
| ART | 1. the TAG banner (the cue line stays); 2. button pulses become static outlines everywhere; 3. the dial dimming and arc highlight (the ghost sun stays); 4. the lock countdown ring (today's tint stays); 5. vane chevrons (the wind chip stays) |
| UI | 1. Swing Boost (setting and code); 2. slow time on an element's first act (the ghost stays); 3. the `vane`, `calm` and `settle` tips |

**Never cut:** the button and its slot, the drag-through rule, buffering and refusal reasons (at least
on the cue line) and the silent repeats, arming with the required-first pick, pour jobs with the
downwind-aware pick, the vane, Calm and the calm-now ghost, the policy floor, no coasting, the
magnet's settle and track with the engagement window, the lesson rule and the re-grip grace and undo,
the TAG honour, the hand-over, re-anchoring with its follow-through guards, first pointer wins with
the still-pointer yield, rest, start slop, handedness, keyboard parity, the pick ring and tether,
reduced motion and high contrast, and copy that teaches a rule.

### 12.4 Performance

- Sim: unchanged (`bench-step` ≤ 1.10 step, ≤ 1.5 guide; `--gen` as today).
- Driver: ≤ 5 µs per tick median on T7 and on an Endless noon (`sim --trials --perf`; a `bench-step
  --drive` row).
- Render: `settleTarget` ≤ 0.05 ms per frame; vane ghost predictions (set-vane and calm-now together)
  ≤ 0.25 ms per frame. The Nubs frame
  (`render.spec`: 390×844, DPR 1, seed 42, 9:12 AM): drawImage ≤ 190, fill ≤ 190, stroke ≤ 77,
  full-screen passes ≤ 3 (the button replaces the coin). Trial frames: the same ceilings.

### 12.5 Release gates (the integrator, after the last merge)

1. `npm run typecheck`
2. `npm test` (the architecture scan included: `src/core/drive` imports only core and config and keeps
   the determinism rules)
3. `node scripts/golden.ts`, then `git diff tests/golden/hashes.json`: only `campaign` entries 32 and
   100, plus the entries of any Trial a recorded §10.1 lever re-pinned (each listed in §16); the
   refactor's proof commit shows an empty diff (`git show --stat` of it touches no golden)
4. `git diff <base> -- src/config/levelBake.gen.ts`: only the 46 levels of §9.4 (and `LEVEL_BAKE_RUN`)
5. `npm run sim -- --check --seeds 40` (the idleTouch rows at R2-R4 included)
6. `npm run sim -- --campaign --bot all --tries 3 --compare <scratch>/base.json` (hard gates of §9.5;
   advisory rows recorded; the baseline's SHA-256 matches §16)
7. `npm run sim -- --trials --check`, then `--perf`
8. `node scripts/bench-step.ts`, `--gen` and `--drive`
9. `npx playwright test` with the default workers, both projects (never `playwright install`;
   Chromium is at `/opt/pw-browsers`)
10. `npm run build:single` ≤ 834,560 B, the amendment recorded (§12.3)

Then the integrator adds "Input and controls: superseded by docs/CONTROLS_V3.md" under the titles of
`docs/ELEMENTALS_V2.md` (§1.3, §7.9), `docs/GDD.md` (§2.3, §3.2, §14) and `docs/V1_PLAN.md` (§3.3), and
writes §16 (every lever with its reason, the baseline digest, G9's shortest window per Trial, G11's
mash shares, the idle-pass list). No commits or pushes outside the normal merge flow.

---

## 13. Copy (binding; short, warm, plain)

### 13.1 Elements (`HEROES`, `src/config/heroes.ts`) and tips (`src/game/moments.ts`)

| id | rules (3 chips) | verbLine | keyLine | dragLine | actLine | deathTip |
|---|---|---|---|---|---|---|
| nubs | Shade cools · Sun melts · Drag turns the sun | Drag: turn the sun | ← → turn the sun · ↑ or ↓ Cold Snap | Drag: turn the sun | Button: Cold Snap | (today's) |
| ember | Tap the flame button · Light refuels · Water douses | Button: burn the next wall | ↑ burns the next wall · ← → turn the sun | Drag: turn the sun | Button: burn the next wall | Tap the flame button for each wall as it comes: Ember burns it right on time. |
| drip | Drag to steer · Puddles grow · Sun shrinks | Drag: steer Drip | ← → steer | Drag: steer Drip | No button: the sun holds | Before Drip's turn, let the sun settle on the dashed arcs, then steer into the shade. |
| sprout | Tap the leaf button · Bridges cross gaps · Sun and rain speed it | Button: grow the next plant | ↑ grows the next one · ← → turn the sun | Drag: turn the sun | Button: grow the next plant | Tap the leaf button as soon as you see a gap: bridges take time to grow. |
| gust | Drag to set the wind · Wind costs Lift · Rain soaks | Drag: set the wind | ← → set the wind · ↑ calm | Drag: set the wind | Button: calm the wind | Drag the wind early so each cloud misses the trail, then calm it to save Lift. |

`CAUSE_TIPS`: fall and swept "Start each bridge early: tap the leaf button as soon as you see the gap."
· douse and rain "Walls come first; one more tap on the flame button dries the puddle on Ember's path.
Rain douses fire too."
· crash "Ember can burn walls past the Tag Stone too: one tap each." · ember:crash "Tap the flame
button for every wall: Ember burns it right on time." · sizzle (today's) · soak "Rain soaks Gust. Drag
the wind early so each cloud misses the trail." · fog (today's) · sprout:sap "Sprout ran out of Sap.
Each extra tap on a plot spends 20: save Sap for the bridges."

`ELEMENT_TIPS`:
- ember: tag "Ember's turn! Tap the flame button once for each wall ahead." · target "Tap early:
  Ember waits and burns the ringed wall right on time." · water "Puddles and rain douse Ember. Once the
  walls are armed, one more tap dries the puddle on its path." · low "Low flame! Turn the sun onto
  Ember to refuel." · due "A wall
  is close! Tap the flame button."
- drip: (today's three)
- sprout: tag "Sprout's turn! Tap the leaf button: Sprout grows the next plant." · target "Tap now: a
  bridge takes time to grow. Sun on it helps." · plot "Tap again for a bigger tree (20 Sap a tap). Save
  some for bridges." · water (today's) · due "Gap ahead! Tap the leaf button."
- gust: tag "Gust's turn! Drag left or right to set the wind. Watch where the clouds will land." ·
  target "The wind keeps blowing, and it costs Lift. Tap the button to calm it when the faint ghost
  cloud sits where you want it." · low "Low Lift! Calm the wind and stay dry: clear air restores
  Lift." · vane "A gale costs a lot of Lift. Calm it once the clouds are clear." · calm "Lift ran low,
  so the wind calmed. Drag again to blow once Lift is back."
- nubs: tag "Nubs again: drag to turn the sun. Let go near the teal and it settles in."

`RELAY_TIPS`: drip "Drip is next: the sun will hold. Let go and it settles on the dashed arcs." ·
gust "Gust is next: the sun will hold where you leave it." · other "Hand-off soon! Aim at the next
element's arc if you like: the sun stays there. The button changes with each element."

`MECH_TIPS` snap: go "Sunflowers grown in shade fill the frost. Full? Tap the frost button." · frost
"A snap is ready! Tap the frost button or press ↓." (the other snap lines stay).

Nubs `settle` (once per profile): "Let go near the teal: the sun slides into shade."

### 13.2 Trial cards and the TAG banner

Card blurbs (`TrialDef.card`): T1 "Tap the flame button once for each wall: Ember burns it right on
time. Light refuels the flame." · T3 "Tap the leaf button: vines bridge gaps, trees shade Nubs. Sun
speeds them." · T4 "Drag to set the wind and blow rain and fog off Gust's path. Rain shades Nubs:
push a cloud onto him." · T2, T5, T6, T7 unchanged.

TAG banner: the element's name, then its `dragLine`, then its `actLine` (§13.1).

### 13.3 Chips and cues (`src/config/controls.ts`)

| Key | Text |
|---|---|
| refuse.charging | Cold Snap charging · {pct}% |
| refuse.locked | Hand-off in {s} s |
| refuse.wait | Get ready… |
| refuse.busy | The snap is on |
| refuse.nothing.burn | Nothing to burn yet |
| refuse.nothing.grow | Nothing to grow yet |
| cue.calm | The wind is calm (a soft cue, not a refusal: §2.3) |
| refuse.low.burn | Low flame: turn the sun onto Ember |
| refuse.low.grow | Low sap |
| refuse.full.burn | Two walls ready |
| refuse.full.grow | Two plants queued |
| calm.auto | Calm: saving Lift |
| vane.rest | No weather in reach |
| cue.armed | Armed |
| cue.growing | Growing |
| cue.ready | Cold Snap ready |
| cue.retryTag | Back at the Tag Stone |

### 13.4 Concepts and Journey copy (`src/config/concepts.ts`)

- drag: "Drag anywhere: you are the sun. Let go near the teal and it settles into shade."
- snap: "Sunflowers grown from cool shade fill the frost meter. Full? Tap the frost button: a frosty
  cloud rides over Nubs."
- lock: "Every 7 s the sun locks for a moment. Watch the ring run out and park it on shade that lasts."
- heavy: retired with Mirror Sun, Slippery Sun, Clockwork and Gusts (its copy goes).
- The concept-card rows for Wide Open, Drought, Crowded, Moon Sun and Lowland (their blurbs today)
  serve as the new teaching cards of L16, 29, 30, 31 and 32.

---

## 14. Decisions (judges' grafts and cuts, and how conflicts were settled)

| # | Decision | From | Reason |
|---|---|---|---|
| 1 | The act lives on a dedicated button, not tap-anywhere; no "tap anywhere to act" option. The button acts on a **still** tap (lift < 12 px, or 120 ms still); a touch that moves 12 px first is a world drag (amended by the review) | all three audits, both judges, review | 21-49% of sun corrections are under 12 px and would misfire anywhere; the disc sits in the right thumb's resting zone, so it must never swallow a drag, and no act needs the touch-down instant |
| 2 | The button takes every **still** press on legs that have an act, legal or not (refused ones say why, silently after the first per reason); drags pass through; only Drip's corner, and a lesson run's corner before the first full meter, is world (amended by the review) | judge 2 over judge 1, review | idle pass-through is ambiguous when the button becomes legal mid-press, so still presses stay the button's; motion is unambiguous, so drags go to the world |
| 3 | Ember arms any time (cap 2), ignition at the bot-proven moment; no "wait for the ring" refusal | feel, both judges | timing windows were the complaint; arming keeps a tap per wall, so the leg does not empty |
| 4 | Ember's walls and Sprout's crossings are not automatic by default; full automation is the Auto actions toggle | both judges (cut onethumb's default) | keeps each element's verb and avoids the Flame re-tune and re-pins |
| 5 | Sprout: tap = job; extra taps +20 Sap; crossings before plots (the bot's order) | feel, judge 1 | "more taps = bigger tree" keeps the size decision without a hold |
| 6 | Gust: a persistent vane with Calm, an auto-calm at the policy's Lift floor (#27) and resting with no weather (fix round 3: no auto-calm; low Lift weakens the wind instead, §3.5) | both judges, review | a held offset is a hold; a forgotten vane must not drain Lift past what the proven policy keeps |
| 7 | The vane has 2 notches a side (breeze, gale), not 3 of 15 u/s | this spec | one gust is +30 u/s: a 15 u/s target cannot be held by gusts; the costs are measured from `keep` |
| 8 | Magnet targets lasting shade (land during a snap, `tag` in the hand-over); honours bud, glass and flare; never crosses glare | judge 1, judge 2 | pulling to flare arcs and R 20 measured worse |
| 9 | Radius 14/12/10 by chapter and rung, Daily 10, floor 10 scheduled; Light 8 and Off 0 only by choice | onethumb, both judges | measured; a 16-salt re-run shows the radius barely matters in 8-20° |
| 10 | The magnet and every automation are recorded frames from the driver; no `RunConfig.assist`, no `InputFrame.aim`, no core vane | judge 2 | no golden or `trialHashes` churn; replays stay exact |
| 11 | The policies live in `src/core/drive/`, not `src/game/` | this spec | judge 2 asked for pure modules the core bots import; core may not import game (architecture test) |
| 12 | Swing Boost: 1.6× from 400 to 1000 px/s, a toggle, **off by default** | judge 1's curve, judge 2's default | path-dependent mapping; re-grip carry and undo already make big swings two clean strokes |
| 13 | Re-grip carries the unfinished chase, and (review) undoes any glide since a lift ≤ 0.5 s old; no glide in the first 250 ms | depth via both judges, review | a magnet that moves the sun between two strokes of one swing is the player fighting the game |
| 14 | The camera moves Nubs up by formula, keeping the 340 u range in view | onethumb via judge 1, judge 2's check | a fixed 0.60 would hide part of the range on short screens; no per-touch camera jump |
| 15 | Handedness mirrors the button and its pill and chips; Pause and the top HUD do not move | this spec (narrows judge 1) | the top corners are not thumb controls during play; mirroring the HUD row costs bytes for no control gain |
| 16 | Retire dazzle, slippery, clockwork, gusts and (review) heavy; Lock gets a countdown ring only | both judges, review | Sun Stall and "gusts push clouds" were cut: they change the lock path and the validator's clouds; Heavy at 300 °/s was invisible and at 220 °/s is a sluggish sun, which is the clunk the user named |
| 17 | Retirement by post-draw substitution; `BAKE_VERSION` stays 4; teaching slots 16, 29-32 take Wide Open, Drought, Crowded, Moon Sun, Lowland | this spec, review | the other 154 levels stay byte-identical, so the bake diff is checkable entry by entry (still 46 entries); the scarcity concepts are spread out |
| 18 | The coast code stays dormant | judge 2 | deleting it moves the `scripted` golden |
| 19 | Auto Snap on Endless R0-R1 | judge 1 | |
| 20 | Dares and stars stay oracle-sized this round; humanTouch's 1-40 share and Dare rows stay advisory, but the human checks on substituted levels, new teaching slots and chapters are hard (review) | this spec, review | the hard gates keep the Journey proven; the controls change must never make a level or chapter harder for a human model; re-sizing is a separate decision with data |
| 21 | Touch contract (G8) is a hard gate; G9 act windows (over pressable ticks) hard; G5f aim-alone hard; G10 lasting arcs and G11 mash advisory; G5e constant vanes hard | both judges, this spec, review | |
| 22 | The pick ring and tether show before the press, every frame; required targets first, so the pulse and the pick never disagree | judge 1, review | the player must see what the press will hit, and the press must hit what the pulse asks for |
| 23 | The TAG banner (1.2 s), icon morph and finger glow | judge 1 | |
| 24 | Aim help needs a sun move within 5 s and is off during the lesson | review (this spec's answer to the autopilot measurement) | measured: the magnet alone passed 7 more of Journey 1-60 and the whole first-run lesson; help that never plays alone needs no content lever |
| 25 | First pointer wins, but a still owner yields; side edge zones 16 px | review | a grip contact must never block the thumb, and a palm landing mid-drag must never steal it |
| 26 | TAG follow-through guards (steer drops fast motion, then a 300 ms ramp; the vane waits for a pause) | review | a swing's momentum must not become a Drip slide or a gale |
| 27 | The governor keeps the policy's Lift floor (20 with own weather ahead, else one gust's price + 2); a calm-now ghost | review | the touch player can spend what the bots spend, and can see when to calm |

### 14.1 Review decisions

The review's four musts are resolved in full (§1.3 drag-through; §4.1-§4.5 re-grip grace, undo and
TAG honour; §3.2 required-first pick and due invariant; §4.1 engagement and lesson rules with the
idleTouch and parked-sun gates). Every should and most coulds are in. What was refused or changed:

| Proposal | Decision | Why |
|---|---|---|
| Latest pointer wins with re-anchor (the review's first choice) | **Refused**; its alternative is taken: first pointer wins, a still owner (< 4 px in 300 ms) yields | latest-wins lets a palm that lands mid-swing steal the slot and kill the drag; the yield rule fixes the grip contact without that hole |
| Levers for an autopilot magnet (track off from L41 and R3, smaller radii per level) as the main fix | **Changed**: the engagement window (§4.1) is the fix; those levers stay only as `AIM_OVERRIDE` fallbacks | a magnet that needs a recent sun move cannot win alone anywhere, so the Journey, Endless and Trials gates pass by construction, with no per-level radius patchwork that players would feel as inconsistency |
| After a 120 ms timed commit, the button's later motion is ignored | **Changed**: it becomes a world drag from that point (the act stays) | "no drag is ever dead" |
| Undo only the part of a glide that ran against the stroke | **Changed**: a re-grip within 0.5 s undoes any glide since the lift | one predictable rule: the second stroke starts where the first ended |
| Keep Heavy Sun at 220-240 °/s with the ghost sun | **Refused**; Heavy is retired | a deliberately sluggish sun is control clunk by definition; "start early" returns as `sprint` |
| Teach "lift to settle" instead of helping a resting finger | **Refused**; a resting finger counts as no hand | the rest-and-nudge players the user described get the help without a lesson |
| G9 summed over pressable ticks | **Changed**: the longest consecutive run must be ≥ 1.5 s | a window broken into slivers is not one a human can use |
| `TOUCH_READS` (bake teaching levels with humanTouch) for every teaching level | **Refused**; only as a lever for at most 3 of the five new slots | it couples the bake to driver tuning; humanDial's `lessonReads` stays the rule |
| Fix the pre-existing idle passes (L26, 34, 51) now | **Deferred** (reported every run, §9.5; §15) | a content question outside controls; the idleTouch gate already guarantees aim help adds none |
| Raise the arm and job caps to 3 by default | **Refused**; kept as G9's one global lever | 2 keeps the pips readable and each press a decision |
| An always-visible charging button in the first-run lesson (implicit in the review's drag-through fix) | **Changed**: no button in a lesson run until the first full meter | a new player should never meet refusals before the button means anything |

## 15. Out of scope (cut, by decision)

A Chill coyote time (it would touch the validator DP and every Endless golden); a core `RunConfig.assist`
or `InputFrame.aim`; a continuous core vane; Sun Stall; wind that pushes the Journey's clouds; a Large
button, Relaxed speed, "Prompts: Expert" and a mini dial echo; manual target override by dragging from the
button; re-sizing Dares and stars; content tuning of the late Journey's noon-heat levels; mirroring the
top HUD row and Pause; content fixes for levels plain idle already passes (L26, 34 and 51 should need
input; they are reported every `--campaign` run for the next content pass); content levers for the
mixers if G11 shows mashing matches thinking (recorded, not fixed, this round).

## 16. As-built record

Written by the integrator at the merge: the C0b measured size, the merge record, the refactor's proof
commit, the humanDial baseline's SHA-256, any `SUB_OVERRIDE`, `TOUCH_READS`, `AIM_OVERRIDE`, cap and
§6.5 levers used (each with its reason, and each Trial whose golden entries a lever re-pinned),
deviations, gate results (§12.5; G9's shortest window per Trial, G11's mash shares, the idle-pass
list) and the final `build:single`.

### 16.1 C0 (the integrator's contract commits)

- **C0a** (demolition): `build:single` 822,916 B (828,287 B before: −5,371 B). Golden diff empty.
- **C0b** (contract): `build:single` **824,994 B** (gate ≤ 825,000 B; +2,078 B over C0a). Golden diff
  empty. The teams branch from here. To fit the gate, C0b keeps four things small, each a deliberate
  and recorded choice, not a change to the contract:
  1. The session begins the driver with neutral `DriveOpts` (aim 0, no track, Auto Snap and Auto
     actions off): building them per run from `aimRadius` (§11.6) is UI's session wiring, and the
     skeleton driver has no magnet to use them. `aimRadius` is the full table in core; it enters the
     bundle when UI calls it.
  2. The skeleton driver writes only `view.act` (the lesson-run rule included), `view.vane`,
     `view.buffered` and the `PRESS` note: a Cold Snap press casts on the first legal tick within
     `bufferTicks` and is otherwise dropped. Refusals (`REFUSE` notes, `view.refuse`) and the snap
     states (`view.state`, `fill`, `lockTicks`) come with C0c.
  3. `CONTROL_TEXT` (§13.3) is marked pure, so the build drops it until UI ships a reader.
  4. Demolition that came with the contract: the full coin's "swipe down" chevron, the dead
     `meterSpan` tap span, the intro Trials' Ember and Sprout ghost hand (it tapped walls and held
     sites, gestures C0a removed; UI adds the `press` ghost), and the "Frost full! Swipe ↓" cue (now
     "Frost full! Tap the frost button").
- Other C0b notes: the side and bottom edge zones stay at 20 px and inset + 16 px until UI's branch
  (§1.1); the gesture icons `g-tap` and `g-swipe` are renamed `g-press` and `g-vane` as placeholders
  and `g-hold` goes (UI draws its own); the DOM icons `spin`, `detent` and `mirror` and the canvas
  glyph `mirror` go with the retired concepts that alone used them; `featGlyph` and `featLabel` lose
  their level argument with `gusty`; `Bot` gains the optional `drive` view (§2.1).
- **C0c** (skeleton, two commits on C0b):
  1. The proof commit (`039bfa7`): `drive/pick.ts` holds the shared timing (`emberDue`, `emberLeft`,
     `showered`, `downwind`, `overlapQ`, `ownAhead`, `gustFloor`, `paceOf`) and `bots/elements.ts`
     calls it instead of its private copies. `node scripts/golden.ts` leaves `tests/golden/hashes.json`
     byte-identical and `sim --trials --check` prints C0b's report line for line (exit 0, only the
     accepted waivers). `build:single` 825,050 B.
  2. The driver: arms and ignition, jobs with goals, release and pre-emption, the governor with
     auto-calm, refusals with repeats, the pre-TAG press, the snap states. Goldens and the trials
     report unchanged again (the bots do not use the driver yet). `build:single` **831,014 B**:
     +6,020 B over C0b (the picks about 2.7 KB, the driver about 3.3 KB over the C0b stub; no other
     code enters the bundle), so C0c alone is 2,564 B over CORE's +3,456 B allowance (§12.3). Recorded
     for the lead: the release budget needs rebalancing or CORE's cut list before CORE's branch adds
     the magnet, the hand-over, due, Auto actions and Auto Snap.
  Choices made in C0c, each within the contract:
  - `emberDue(s, i, lead, tagMargin = TUNING.drive.ember.tagMargin)`: the optional fourth argument is
    the TAG margin of `emberLeft`; the bots pass their own (2 · `TAP_PRESS` = 12 ticks), which kept
    every hash. Showers stay the caller's test (`showered`), as in the bots.
  - `pick.ts` also exports `paceOf`, `emberLeft`, `overlapQ`, `targetX` and `nearLast` (a verb's last
    tick that still finds its object `near` ahead, the walker one tick on); core's `isWall`,
    `isCrossing`, `edgeOf`, `burnTicksOf` and `ownWall` are exported from `sim/elements.ts` and used
    instead of copies (the bots now use core's `ownWall` and `burnTicksOf`: same results, same hashes).
  - A press is tried on its own tick and the next 18 and refused on the 18th; a buffered press also
    drops when the driver sees a new leg (`relayIdx`), so a bot-owned driver needs no `interrupt`. The
    pre-TAG press waits in its own slot (`view.buffered` while it waits) and becomes an ordinary
    buffered press on the incoming element's first tick.
  - Notes are `PRESS` and `REFUSE` only: a Calm press on a calm vane writes nothing until CORE adds
    `CALM` with a = 2; an auto-calm writes nothing until `CALM` with a = 1.
  - Ember: `view.pick` is −1 while both arms are taken (the next press would be refused `full`);
    `view.state` is ready or low by the pick's cost. Sprout: a press tops up a running plot when the
    pick is a plot or there is none (the running plot is in a job, so it is never the pick); a job's
    hold starts only on a tick its point resolves to it (`growTarget`), and any hold that is not the
    running job's is let go first (a pre-empted plot, a hold left from before `begin`).
    `view.state` is ready, low (a plot with Sap ≤ 30) or working (pouring). `view.due` stays 0.
  - Driver cost per tick (fill with its observe, Node, reactive sun frames with presses every 20
    ticks): median 0.3-3.5 µs on T1, T3, T4 and T7; the Sprout pick's downwind test is the most.

### 16.2 Merge record

The three branches merged into `claude/mobile-game-web-prototype-54l0ia` with `--no-ff` in §11.0's
order: `controls3/core` (e7dcaff, 15 commits over C0c) as b59c05c, `controls3/art` (2e28880) as 9737965
and `controls3/ui` (e3f5d7b) as 4bccbc6. The teams' files were disjoint, nothing conflicted, and the
typecheck was clean after each merge. The integrator's commits after them: b3813d5 (the bundle, §16.3,
and ART's merge notes), 92cc862 (UI's fixme cases), f3f6072 (the TAG cue), 07a9ec2 (render.spec), and
the record you are reading. Every merge note was applied:
- **ART → UI: the glide flag.** The session sets `AudioView.glide` and passes `Haptics.onEvents(events,
  omega, glide)` while `drive.glide` is finite; its own detent filter (§11.6) is gone, since both routes
  now drop a glide's detents themselves.
- **ART → UI: `HudCampaign.gust` and `AudioView.gust`.** The last writer (the campaign view's initializer)
  and both optional fields are gone, with the audioRouter test line that set one.
- **CORE → ART: the set-vane ghost.** After CORE's cut 1, `driveWeatherX(s, o, t, n)` is `weatherXAt`
  for every notch, so the arrival ghost is the calm-now ghost and ART's second, ink-dashed pass drew
  the same ellipses again. The second pass is gone (render.test: one ghost per cloud whatever the notch).
  §3.5's two ghosts come back with the set-vane prediction if the lead restores cut 1.
- **ART → UI: the TAG cue and the meter pill.** At 360×640 the two-line TAG cue hung below the dial
  covered the pill and the top of the button. The session publishes `--pill-top` (174k above the
  bottom inset), and the cue hangs below the dial only when two lines (65 px) fit above it, else it
  takes the cue line's usual place above the dial. Measured: 390×844 and 430×932 keep it below (its
  bottom 650 px against the pill's 670; 708 against 740), and 360×640 lifts it.
- **ART → UI: `buttonDown`.** The session copies `input.buttonDown` into `RenderInput` every frame; no
  change needed.
- **ART: the Endless draw-call frame.** It was a first-run lesson run with no button; it now seeds a
  passed lesson, so it measures the frame §12.4 means: drawImage 156, fill 183, stroke 73 (ceilings
  190, 190, 77).
- **UI → CORE: the fixme cases.** controls.spec's aim help pair and elementals.spec's CALM note and
  reactiveTouch pips run. The magnet case needed three test fixes once it met the real magnet (the
  magnet was right each time): it lifts 8° short of a lasting arc on a lit bin, moving toward it (a
  lift past the arc glides back against the stroke, which waits `againstTicks` by design, §4.2, and
  cut 2 left no rescue from ending shade); the sim stands still while the target is chosen and the
  stroke played, then runs at 1/8 speed so the hook's polling stays inside the 15-tick grace; and the
  case starts again from the new angle, at most four times, when seed 42's morning arcs moved under
  the lift. 24 of 24 over six repeats on both projects.
- **UI → ART: render.spec's Trial 7 frame** measures 192 fills with the §5.2 camera (181 at C0c; T2
  174 → 188 and T4 164 → 184 stay under 190). The camera shows more of the world and the trial art is
  cached, so T7's fill ceiling allows the world, 196, as T5's already did (216). A deviation from
  §12.4's "the same ceilings", recorded here.
- **render.spec's Gust chevron check** counted pixels brighter than the ground; with the new framing the
  ground east of the button is pale (233), so the white chevron barely beat it and its ink edge counted
  against it. It now counts changed pixels and requires a white one.
- **CORE: the baseline** (`/home/user/controls3-core-base.json`, outside the repo) hashes to the
  recorded SHA-256 (§16.4); the golden and bake diffs are §16.6's gates 3 and 4.

### 16.3 Sizes and the budget

| Step | `build:single` | Delta | Allowance |
|---|---|---|---|
| C0a + C0b (10ef53b) | 824,994 B | | ≤ 825,000 B: pass |
| C0c (7aaa9ce) | 831,014 B | +6,020 over C0b | counted in CORE's |
| `controls3/core` (e7dcaff) | 834,758 B | +9,764 over C0b | +3,456 B: **6,308 B over** after its whole cut list |
| `controls3/art` (2e28880) | 833,623 B | +2,609 over C0c | +2,688 B: pass, after cut-list items 1-3 |
| `controls3/ui` (e3f5d7b) | 834,333 B | +3,319 over C0c (its own files +2,166 over C0b) | +2,176 B: pass for its own files, after items 1 and 3; `CONTROL_TEXT` (+618), `aimRadius` (+408) and `hudButton` (+61) are CORE's and ART's code its readers pull in |
| merged (4bccbc6) | 840,695 B | +15,701 over C0b | 8,320 B + the 1,240 B reserve: **6,135 B over** 834,560 B |
| the script targets the CSS floor | 840,468 B | −227 | |
| `#private` session | 834,972 B | −5,496 | |
| ART's merge notes (glide flag, gust fields, the doubled ghost) | 834,599 B | −373 | |
| `#private` Fx −415, audio router −245, engine −650, music −791, perf −329, haptics −286 | 831,883 B | −2,716 | |
| the TAG cue's placement | 832,031 B | +148 | |
| **release (this record)** | **832,031 B (812.5 KiB)** | | **≤ 834,560 B: pass (2,529 B under)** |

**How it fits with no feature cut.** By source map, the session spent 15,160 B of its 45,363 on 1,300
`this.member` accesses: class members keep their names through the minifier. The script build now
targets the browsers the CSS already targets (`chrome105, edge105, firefox121, safari16`: the UI
cannot lay out below them), so class fields and `#private` members ship natively, and the TypeScript
`private` members of seven classes became ES `#private` members, renamed through the language service
(declaration and every reference). The minifier shortens `#name`s, as it does locals. Behaviour is
unchanged: `useDefineForClassFields` stays false and the transform keeps public and private
initialisers in declaration order in the constructor, no private method is passed unbound (`#tick`
is an arrow field), and the typecheck rejects any outside access (none existed; the test hook uses
public members only). It is a new idiom for these files, kept to classes with many private members
outside `src/core` (the sim's classes keep `private`).

**Amendment recorded** (§12.3): **815 KiB = 834,560 B** in `docs/V1_6_PLAN.md` A3 and `docs/UI_V2.md`
§13, with §12.3's reason. The cut lists stay as the teams applied them: CORE's 1-3 (b554779: the
set-vane prediction, the ending rescue, Auto Snap), ART's 1-3 (the TAG banner's two lines, the
button's scale pulses, the dial dimming with the settle-arc highlight and the capture flash) and UI's
1 and 3 (Swing Boost, the `vane`, `calm` and `settle` tips). Restoring any of them inside the
2,529 B left is the lead's call (CORE's b554779 reverts on its own; ART's three cost about 276 + 180
+ 370 B, UI's about 379 + 597 B).

### 16.4 Levers and the baseline

- **Baseline** (§9.5): humanDial, 20 held-out streams × 3 tries, on C0c (7aaa9ce) with `node
  scripts/sim.ts --campaign --bot humanDial --tries 3 --streams 20 --json`, kept outside the repo at
  `/home/user/controls3-core-base.json`, SHA-256
  `dce2686f2ed95b1e1cc33bda154adddee90b4d8ffad09fd7a22d730ecedd05ee` (checked again at the merge).
- **The refactor's proof commit** is 039bfa7 (`drive/pick.ts` and `bots/elements.ts` only; the golden
  diff empty).
- **`SUB_OVERRIDE`**, all 8 entries (§5.3's cap), each the first later choice that met the
  substituted-level gate when CORE chose it (humanTouch's first tries over the 12 baseline streams
  against humanDial's on the old level), measured before cut 2 redrew the streams:
  L73 gusts → sparse 4 vs 12; **dense** 12. L79 gusts → sparse 1 vs 10, dense 6; **dropped** 9. L80 gusts
  → sparse 0 vs 4, dense 2; **dropped** 4. L92 clockwork → sparse 5 vs 12, dense 7, lowland 7;
  **dropped** 11. L103 heavy → ration 7 vs 11; **sparse** 12. L123 dazzle → dense 5 vs 9; **lowland** 12.
  L164 slippery → sprint 4 vs 11 (sparse does not fit beside fleet); **dense** 10. L165 heavy → sprint 0
  vs 6 (ration and sparse do not fit); **dropped** 10. The three dropped slots leave L79 (breezy) and L92
  (ration) with one concept; `campaign.test` and `campaignGame.test` allow it.
- **`TOUCH_READS`**: empty (the five teaching slots pass 20/20). **`AIM_OVERRIDE`**: empty (idleTouch and
  the parked sun fail everywhere they must). **G9's global lever** (arms or jobs 2 → 3): not taken. **§6.5
  Trial levers**: none, so no `trials` golden entry moved.

### 16.5 Deviations as built

**CORE**
- Cut list 1-3 applied in one revertible commit (b554779): `driveWeatherX` reads `weatherXAt` for every
  notch; `aimPlan` rescues only a lit sun (no `ending` parameter; restored in fix round 3, §16.8); the
  driver never casts Auto Snap
  (`DriveOpts.autoSnap` stays in the contract, ignored). `NOTE_AUTO` carries a = 2 (arm) and 3 (job)
  only. About 110 B in the branch.
- Auto actions' plot rule matches the touch bots' press (a plot short of treeMin, not downwind, no plot
  job running, Sap above treeMin + plotSap), so Auto actions plays exactly the reactive verbs on T1 and
  T3 (§12.1).
- G5e's player sets the notch once on the leg's first tick and keeps the governor's auto-calm (fix round
  3: no auto-calm; the governor's low-Lift rules, §3.5).
- reactiveTouch and humanTouch map Gust differently from §10.2's letter: a gale when the wanted wind
  dir·wind ≥ band[1]; humanTouch calms after 30 ticks with no wanted swipe, reactiveTouch at its first
  no-want decision (the literal mapping lost Gust Trials for reactiveTouch).
- G5f's parked player steers Drip with G5b's plan lanes, not reactive's adaptive steer (adaptive Drip
  let a parked sun pass T2 and T5 through Drip skill, which is not aim help).
- humanTouch on Trials draws from humanEl's rng label, so G8 compares the same decision streams.
- The idle advisory row includes L29 and L32 (new teaching slots, gentle enough for idle with the lesson
  off); idleTouch adds none.
- `tests/unit/campaignGame.test.ts` (UI's file): L32's gust check is "`sun.gust` stays 0", and a composed
  level may have one concept.
- No dedicated unit test for Ember's shower wait (the due invariant runs on every Ember tick of T1, T5
  and T7 with the reactive bot instead of a randomized sweep).

**ART**
- Cut-list items 1-3 (§16.3); items 4 (the lock countdown ring) and 5 (the vane chevrons) shipped.
- `drawGustStreaks` and `P_GUST` are removed entirely (§7.2 names them), so the Gust element's own
  `gust` event lost its streaks too (the chevrons and the wind chip show the wind). Its whoosh is
  throttled to one a second and it buzzes nothing (§7.3: nothing buzzes untouched but `SETTLE`).
- The catch cue, recipe and mascot squash are gone (§1.6); the `catch` haptic stays (burn and feed use it).
- Due amber is `#FFC83D` (not Ember's orange), and due also turns the pick ring solid (shape, not
  colour alone). The press-in to 0.92 stays under reduced motion (direct feedback, not a bounce).
- The calm-now ghost was ink dashes at alpha 0.45 (white vanished on Old Town's ground); at the merge it
  is the arrival ghost itself (§16.2).
- The sap pip is Sprout's leaf glyph; `meterShown` means "the action button is drawn"; the button hides
  in the hold (the driver's act is `none` there); the TAG finger glow is drawn on the walker's dial, not
  under the finger (`RenderInput` carries no pointer position).

**UI**
- Input is a closure factory, `createInput(host)`, returning §11.6's `Input` interface (minus
  `swingBoost`), not `class Input`: about 2.9 KB smaller.
- The yield and rest rules use path accumulators whose clocks start at touch-down; finger speed is the
  displacement since 50 ms ago over min(50 ms, sample age); Drip's TAG guard drops fast motion through
  the whole ramp.
- `?aim` and `?autoact` make a run a debug run; `?hand` does not. Settings changes apply from the next run.
- Cut-list items 1 (Swing Boost: `settings.swingBoost` stays in the save, unread; `?boost` is gone) and 3
  (the `vane`, `calm` and `settle` tips; `flags.settleTip` removed). Item 2 not applied (it shares code
  with the Cold Snap lesson: about 0 B).
- Refusal tips show only in teaching runs. `pause.css`'s compact query moved from 22em to 24em (the Pause
  card clears the halo at 430×932). elementals.spec allows one fewer intro-card blurb line under 700 px.
- touch.spec's latency bound counts a sample on time within 50 ms or by the game's second frame after
  the event; long touch cases keep the walker alive with the test-only `demo('cool')`, and
  `demo('snapReady')` also fills the Bank charge.

**Integrator**
- The script build targets the CSS floor, and seven classes' `private` members are `#private` (§16.3).
- The calm-now ghost's second pass is gone with CORE's cut 1 (§16.2); §3.5's two ghosts return with it.
- The TAG cue's placement rule (`--pill-top`), render.spec's T7 fill ceiling (196) and chevron check,
  the Nubs frame with the button, and the magnet e2e's test-side fixes (§16.2).

### 16.6 Release gates (§12.5) at the merge

1. `npm run typecheck`: clean (both configs).
2. `npm test`: 57 files, 1,189 of 1,189 (the architecture scan included). One full run before the merge
   commits showed an order-dependent `share.test` failure under `isolate: false` that passed alone and
   on the re-run; not seen again.
3. `node scripts/golden.ts`: `hashes.json` unchanged at HEAD; against C0c only `campaign` 32 and 100
   (`32`, `32:600`, `32:1200`, `100`, `100:600`, `100:1200`, `100:1800`); no Trial entry moved; the
   proof commit 039bfa7 touches no golden.
4. `levelBake.gen.ts` against C0c: exactly the 46 retired-concept levels (16, 29-32, 54, 71-76, 78-81,
   83, 85, 87, 89, 90, 92, 93, 96-100, 103, 112, 114, 123, 130, 139, 144, 145, 161-165, 167-170, 177) and
   `LEVEL_BAKE_RUN`.
5. `sim --check --seeds 40`: all targets met (4 min 22 s). idleTouch reaches the first night at R2, R3 and
   R4 on 0 of 40 each (R0 5%, R1 0%, advisory); humanTouch outlives humanDial at every rung (median R0
   Day 2 11:33 AM vs 11:28, R1 11:55 vs 11:30, R2 10:46 vs 9:28, R3 9:17 vs 8:57, R4 Day 1 12:21 PM both).
6. `sim --campaign --bot all --tries 3 --compare` (baseline digest matches): **2 hard gates fail.**
   Pass: oracle 200/200; reactive 100% of 1-100; the Feat-seeking oracle ★2 on 100% and every Dare of
   1-10; idleTouch passes nothing plain idle does not (11 passes, all idle's); the five teaching slots
   20/20 each. **Fail: substituted levels** (7 of 46: L54 1 vs 3, L139 2 vs 7, L162 10 vs 12, L163 2 vs 4,
   L164 7 vs 11, L168 0 vs 12, L169 2 vs 9) and **chapters** (ch6 154 < 158, ch7 178 < 182, ch12 179 <
   182, ch14 134 < 141, ch15 126 < 133, ch17 134 < 164, ch20 94 < 95). Advisory: humanTouch 95.8% of 1-40
   on its first try (failed 10, 38, 39), its resting variant 95.0%; humanDial 93.3%; Dare met humanTouch
   9.8%, humanDial 7.7%, oracle 10.5%; cool-run star humanTouch 1.2%, humanDial 0.5%, oracle 8.5%.
   **Idle passes** (lesson off): L2, 14, 15, 18, 26, 29, 32, 34, 51, 111, 156; idleTouch the same 11.
7. `sim --trials --check` (56 s), then `--perf`: **G5e fails** on T4 (+1 walks Gust's leg), T6 (−1) and
   T7 (−1); every other gate passes (G6 waivers on T1, T2, T4, T5 and G4's on T5 as accepted before). G5f:
   idleTouch fails every Trial, the parked sun every degree. G8: humanTouch 15/16 (humanEl 15), 16/16
   (15), 13/16 (13), 12/16 (12), 16/16 (16), 15/16 (13), 15/16 (13). G8b: reactiveTouch 8/8 everywhere.
   **G9 shortest windows** (reactiveTouch salt 0): T1 m376 137 ticks, T3 m408 263, T5 m436 101, T6 m511
   280, T7 m423 105; T2 and T4 have no targets. G10 (advisory): 82, 87, 67, 91, 91, 79, 96% of refreshes.
   **G11** (advisory), mashTouch vs reactiveTouch Dare share and stars: T1 100% 3.00 vs 100% 3.00, T2
   100% 2.38 vs 100% 2.38, T4 100% 2.38 vs the same, T5 88% 2.75 vs 88% 2.75 (MISS: a content follow-up
   for the mixer, §10.3), T3 0% 2.00 vs 100% 3.00, T6 0% 2.00 vs 100% 3.00, T7 0% 1.00 vs 100% 2.00
   (PASS). G4t (advisory): 94, 100, 81, 75, 100, 94, 94%. `--perf`: the driver 0.50 µs per tick on T7
   (gate ≤ 5), 0.33-1.20 elsewhere.
8. `bench-step`: step ×1.053 (min ×1.096; gate ≤ 1.10), guide ×1.025 (≤ 1.5); `--gen` passes (p99 slice
   1.04 ms, paired 0.875 × base); `--drive` 0.23 µs per tick (≤ 5).
9. Playwright, the full suite with the default workers (2), both projects: 439 passed, 64 skipped (by
   design: one-project cases), 1 failed in 21.4 min. The failure, touch.spec's latency case on mobile
   (one press-in of 30 a frame late under two workers' load), passed 3 of 3 alone (`--workers=1`): a
   load flake, not a defect.
10. `npm run build:single`: **832,031 B ≤ 834,560 B** (§16.3).

### 16.7 Open for the lead

1. (Fix round 3, §16.8: the substituted-level gate passes; the chapter gate still fails on ch3, ch7 and
   ch12.) **§9.5's substituted-level and chapter gates (hard) fail**, as at CORE's branch, and §5.3's levers are
   spent: `SUB_OVERRIDE` holds its 8 entries and L169 already drops its slot yet measures 2 vs 9. The
   chapters that fail are those with the most substituted levels (ch17 has nine), and on the 154
   unchanged levels humanTouch matches humanDial (2,346 vs 2,345 passes), so the driver is not the cause.
   The gate compares humanTouch on substitutes that are real pacing and scarcity (sprint, fleet, ration,
   dense) against humanDial on retired concepts that cost the bots almost nothing, so most substitutions
   read as "harder". The choices are the lead's: raise `SUB_OVERRIDE`'s cap and drop the slots of the
   failing levels (easier levels, the challenge §5.3 meant to keep partly gone), accept the measured
   differences as the intended difficulty and amend the gate, or a content pass on chapters 6, 7, 12,
   14, 15, 17 and 20.
2. (Fix round 3, §16.8: resolved; G5e passes with no waiver.) **G5e (hard) fails on T4, T6 and T7.** A constant breeze held from the leg's first tick walks the Gust
   leg; no single §6.5 move of T4's weather (48 tried by CORE) fails +1 while keeping G1-G4, and a lower
   Gust start (−10 Lift) drops humanTouch to 0/16. A multi-object re-authoring of the three Gust legs, with
   their `trials` golden entries re-pinned, is the remaining route, and it is a content round, not a merge
   fix: T4's G4 already sits at its band's floor (75%), and controls.spec, touch.spec, elementals.spec and
   render.spec all play T4's layout.
3. **G11** misses on T5 (mashTouch equals reactiveTouch); recorded as a content follow-up for the mixer.
4. The 2,529 B left under the budget can buy back cut-list items (§16.3).

### 16.8 Fix round 3 (core)

The review after the merge (31 findings) went to two fixers. CORE's branch, `fix3/core` from 358a7ee,
carries the lead's three decisions: Gust must never feel dead, the substituted Journey levels must
meet §9.5, and the driver findings in core. The finding numbers below are the lead's (the review's
list counted from 0).

**Driver**
- **F3, the driver's own edges.** `fill` read the frame's `upEdge` after closing a glide, so the
  `upEdge` it had just written counted as a sun move (the engagement clock ran on) and as a real lift
  (the re-grip grace began). It now reads `downEdge`, `upEdge`, `dTheta` and `down` before it writes
  anything (§4.5).
- **F4, night.** A press buffered at dusk waited out the night (the driver's clock stops outside `day`)
  and fired at dawn. Now a press still waiting at nightfall is refused at once with its reason, the
  pre-TAG press is dropped, and the act is `none` outside the day (§2.3), so the session shows no act
  that a key press could lose.
- **F5, mashing.** Each press restarted the 300 ms wait, so a mashed illegal press was never refused.
  A press while one waits now joins it, and the refusal comes once when the first wait runs out (§2.3).
- **F7, Calm at notch 0 mid-drag.** It reported a real calm. Now it is the no-op `CALM` with a = 2.
- **F8, detents on a glide's last tick.** `view.glide` is already NaN on the closing tick, so the
  session's per-tick drop missed it. The core adds `view.glideTick` (§4.5, §11.3); the session's use of
  it is the UX fixer's.
- **F14, the time after a TAG.** `preTagTicks` 30 → 45 (0.75 s), so a press up to about 1 s before the TAG
  reaches the incoming element. G9b (§10.3, hard) holds the content to 1.5 s before the first due
  act: T1's first wall b376 → b381 (its due prompt 1.28 → 1.63 s after the TAG), T5's b245 → b258
  (0.78 → 1.68 s), T6's first crossing x511 → x518 (Sprout's prompt was 0.57 s after its TAG), T7's
  crossings x355 → x362 and s383 → s377 with the TAG into Ember 394 → 383 (b423 due 1.55 s after it).
- **F1, keyboard nudges.** A key turn never counted as a lift, so the next refresh glided the sun back
  into the arc a key tap had just left (3-tick taps of the fine key netted −3.7° with aim help against
  −71.5° without, in the review's probe). The release of a key turn now sets the lift and the stroke's
  direction (§4.1); the touch bots never press keys, so no gate or golden moved.
- **F16, the race.** A glide could start a frame before a deliberate touch and keep its first step
  (2.7-3.4°). A real `downEdge` within `raceTicks` (3) of a glide's start now undoes it (§4.5).
- Not CORE's: F6 (the TAG ramp's negative scale) is `input.ts`, fixed by the UX fixer; F8's session half
  likewise.
- Regression tests in `tests/unit/drive.test.ts`: a key release as a lift, own closing edge, nightfall refusal, mashing refusal
  once, Calm at notch 0, `glideTick` on the last step, the 45-tick pre-TAG window, the race undo, the
  low-Lift governor and the ending rescue.

**Gust (F10, F12)**
- §3.5's governor never calms the vane (no `CALM` a = 1). At or below the policy floor it keeps the
  weaker band `low` `[0, 5, 15]` u/s (`lowCost` `[0, 2.7, 4.9]` Lift/s, `view.vaneLow` 1); at one
  gust's price + `gain` it waits for air (`view.vaneLow` 2); the tick a drag sets a new notch it may
  gust at once while Gust can pay for one gust. A drag always moves the vane and the wind.
- `TUNING.elements.gust.soak` 36 → 30 Lift/s: from the lowest Gust start a player has about 1 s after a
  hand-off's grace before rain soaks Lift to the floor (24 was tried: the weather then threatened
  too little for any layout to fail a constant vane while keeping G1-G4).
- T4, T6 and T7's Gust weather re-authored (`trials.ts` comments give each layout and its measures):
  near clouds drift onto the trail from each side in turn, each on Gust's line if nobody pushes it,
  and a far cloud on each side that a held wind would carry in, so no constant vane survives. G5e:
  every vane (−2, −1, +1, +2) dies on Gust's leg of T4, T6 and T7, with no waiver. T4's G6 waiver
  text now reads 96% (cloudRide ≥ 60).
- G8d (§10.3, hard): reactiveTouch whose Gust input starts 1 s into each Gust leg wins 8/8 on T4, T6
  and T7.
- `trials` goldens re-pinned: 1001 and 1005 (G9b's walls) and 1004, 1006 and 1007 (the Gust legs), with
  their 600/1200/1800 frames; no other entry moved.

**Journey (§5.3's levers)**
- `SUB_OVERRIDE` cap 8 → 16 (16 entries) and `SUB_DRAIN` (at most 2 steps) per the lead. New or changed
  entries, each with what was measured (humanTouch's first tries over the 12 baseline streams vs
  humanDial's on the old level; within-3 passes over 20 where the chapter gate needed them): L54
  dense (sparse 2 vs 3; dense 5); L79 giants (dropped 8 vs 10; giants 12); L112 breezy (sprint 5 vs 5
  but 17 vs 20 within; ration 0, sparse 1, dropped 1; breezy 5, 18 vs 20); L139 giants (dense 4 vs 7,
  lowland 0, sparse 0, dropped 2; giants 7); L145 gate (dense 0 vs 4, lowland 2, sparse 0, dropped 5;
  gate 8); L162 dense (sprint 8 vs 12; dense 11); L163 giants (dense 1 vs 4, dropped 0, lock 0, gate 0;
  giants 7); L164 dense with `SUB_DRAIN` 2 (drain 41 → 39: 8 → 10 vs 11); L165 gate (dropped 9 vs 6 but
  18 vs 20 within; gate 10, 20 vs 20); L167 `SUB_DRAIN` 1 (drain 32 → 31: sprint 4 → 6 vs 5); L168 gate
  with `SUB_DRAIN` 2 (ration 0 vs 12, dropped 2, dense 6, lowland 5, lock 5; gate 7, drain 24 → 22:
  11); L169 lock with `SUB_DRAIN` 2 (dropped 4 vs 9; lock 7, drain 40 → 38: 10). L80 and L92 stay
  dropped.
- The ending rescue (CORE's cut 2, §4.2) is back: on the 154 unchanged levels humanTouch passed 2,345
  streams within 3 tries without the rescue and 2,381 with it, against humanDial's 2,345 (aim help
  off: 2,337). Its bytes are inside the branch's +739 B (`build:single` below).
- Re-baked per the bake policy: `levelBake.gen.ts` changed only L54, 79, 112, 139, 145, 162, 163, 164,
  165, 167, 168, 169 and `LEVEL_BAKE_RUN`; no `campaign` golden moved.

**Gates on `fix3/core`**
1. `npm run typecheck`: clean.
2. `npx vitest run`: 57 files, 1,195 of 1,195.
3. `node scripts/golden.ts`: against 358a7ee only `trials` 1001, 1004, 1005, 1006, 1007 and their frames.
4. `sim --campaign --bot all --tries 3 --compare` (baseline digest matches; 4 min 47 s): oracle 200/200;
   reactive 100% of 1-100; the Feat-seeking oracle ★2 on 100% and every Dare of 1-10; idleTouch 11
   passes, all idle's; **substituted levels pass** (worst margin −1: L98 0 vs 1, L162 11 vs 12, L164
   10 vs 11, L168 11 vs 12); the five teaching slots 20, 20, 20, 20 and 19 of 20; humanTouch 93.3% of
   1-40 on its first try (failed 7, 10, 38, 39), resting 94.2%, humanDial 93.3%. **Chapters fail on
   three:** ch3 199 < 200, ch7 181 < 182, ch12 178 < 182 (every other chapter at or above humanDial:
   ch1 200/199, 2 200/200, 4 183/182, 5 178/171, 6 162/158, 8 190/187, 9 164/157, 10 159/125, 11
   140/140, 13 156/156, 14 143/141, 15 144/133, 16 116/113, 17 170/164, 18 165/136, 19 101/92, 20 95/95).
5. `sim --trials --check --perf` (56 s): exit 0, every Trial passes; the only waivers are the accepted
   ones (G6 on T1, T2, T4 and T5, G4 on T5). G5e passes on T4, T6 and T7; G8 15, 16, 13, 15, 16, 14
   and 11 of 16 (humanEl 15, 15, 13, 15, 16, 14, 9); G8b and G8d 8/8; G9 shortest T1 m381 158 ticks, T3
   m408 263, T5 m436 101, T6 m518 280, T7 m423 153; G9b T1 1.63 s, T3 6.40 s, T5 1.68 s, T7 1.55 s
   (T6 and T7's Sprout legs: nothing due); G11 PASS on T3, T6, T7 (MISS on T5 as before); the driver
   0.45 µs per tick on T7.
6. `sim --check --seeds 40` (4 min 5 s): all targets met; idleTouch reaches the first night at R2, R3
   and R4 on 0 of 40 each (R0 5%, R1 0%). Advisory: humanTouch outlives humanDial at R0 (Day 2 11:45 AM
   vs 11:28), R2 (10:36 vs 9:28) and R3 (9:15 vs 8:57) but not at R1 (10:54 vs 11:30) or R4 (Day 1
   11:44 AM vs 12:21 PM). Toggling this round's driver changes one at a time on the same 40 seeds
   (the ending rescue off, `endingTicks` 36 or 60, the race undo off) moves those medians up and down
   by a few percent with no consistent sign across the rungs, so the two misses are within the row's
   noise, not a cost of one change.
7. `bench-step --check`: step ×1.061 (min ×1.067; gate ≤ 1.10), guide ×0.985 (≤ 1.5); `--drive` 0.22 µs
   per tick (≤ 5); `--gen` passes (p99 slice 1.44 ms, paired 0.936 × base). Its first run under load
   failed the paired p99 (1.302); the merge's tree, timed right after, failed it too (1.183) with the
   same slice count (13,234 vs 13,233): world generation is unchanged on this branch.
8. `npm run build:single`: 832,770 B (+739 B over the merge's 832,031 B; 1,790 B under 834,560 B),
   without the UX fixer's branch.

**Open for the lead**
1. **The chapter gate fails on ch3, ch7 and ch12, and the levers cannot move it.** ch3 and ch7 have no
   substituted level short of its baseline (ch3's L29 and L30 are 20/20; ch7 has none): their shortfall
   is one stream each on unchanged levels (ch3: L21's stream 9 fails all three tries, a glass save lost
   to a run that diverged early, not a glide over the glass; ch7: L62 19 vs 20 and L65 5 vs 6 against
   L64 18 vs 17). ch12's −4 is L119 (unchanged, 11 vs 13) and L112 (18 vs 20, the best of six choices;
   even 20 leaves ch12 at 180 < 182). humanTouch beats humanDial over the unchanged levels (2,381 vs
   2,345), so the misses are the noise of a per-chapter "≥" over 20 streams: between runs of this round
   that differed only in a few substituted levels or driver details the failing set moved (one failed
   ch11 and ch14 by 3 each and passed ch7). The choice is the lead's: a per-chapter tolerance (for
   example ≥ humanDial − 2, which still fails ch12 by 2), a pooled test over the unchanged levels, or
   more streams in a new baseline.
2. G11 still misses on T5 (the content follow-up for the mixer, §16.7 item 3).
