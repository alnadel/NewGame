# SHADY UI v2 · "Candy" — the binding spec

**Status:** binding for the UI rework. It supersedes `src/ui/README.md` §7 ("Visual system (v1.4)")
wherever the two disagree; the builder who owns the kit (§14, B1) rewrites README §7 to match.

**The request it serves:** *"focus only on UI and heavily rework it to actually look like a game."*
Today the menus look like a productivity app (white pills, a system font, soft shadows, flat cards, a
plain grid of tiles). After this rework every screen reads as a polished casual game: glossy candy
controls with an ink outline and a pressable lip, a chunky display font with an ink halo, ribbon
banners, framed trays, embossed currency slots, star bursts, a level map with a road.

**Scope.** UI only: the DOM menus and overlays (`src/ui/**`) and the canvas HUD, cards, stamps, toasts
and pops (`src/render/hud.ts`, `banners.ts`, `particles.ts`, the text labels in `meltMap.ts` and
`friend.ts`). Not in scope: gameplay, the simulation (`src/core`, `src/config`), meta rules
(`src/meta`), the world art (ground, casters, Nubs, the sun), the app icons and `og.png`. Two small
view-model additions are allowed because the screens need them (§10.3: `ResultsCampaign.starRules`
and `starBits`); they carry data that already exists and change no rule.

**Words.** *Must* is binding. *Should* is the default unless a measurement says otherwise (write the
measurement in the commit). *May* is optional. Numbers are CSS px at a 390 px wide column unless a
line says otherwise.

**Precedence.** The user's request, then this document, then the mockups. The mockups were drawn
before the judges' grafts and fixes; where a mockup and this text disagree, this text wins.

---

## 0. Visual targets

The mockups lived in the design session's scratch directory (they are not in the repo; this document
stands on its own without them). `$S` below is that scratch directory: any temporary folder works for
your own captures.

| What | File | Use it for |
|---|---|---|
| Title | `$S/dir-candy/final/candy-title.png` | top bar, logo, modes, tray (but see §10.1: the tray is neutral, the goal is Nubs' speech bubble) |
| Journey map | `$S/dir-candy/final/candy-journey.png` | boards, nodes, the snake, the locked plate, the sticky header |
| Results (win) | `$S/dir-candy/final/candy-results-win.png` | hero stars, ribbon on the frame edge, XP bar, actions (but see §10.3: loot tiles and goal cards) |
| In-game HUD | `$S/dir-candy/final/candy-hud.png` | medal, plate, slot, coin, toast (but see §9.3: a longer ruler, a slim head) |
| Level intro card | `$S/dir-candy/final/candy-level-intro.png` | frame, ribbon, chip, wells (but see §9.7: the start pill hangs off the edge, the Dare keeps its own chip) |
| Pause | `$S/dir-candy/final/candy-pause-modal.png` | the modal recipe (but no close coin, §10.5) |
| Settings controls | `$S/dir-candy/final/candy-settings-tabs-toggles.png` | toggle, slider, row tiles (Settings keeps stacked cards, no tabs, §10.7) |
| Before and after | `$S/dir-candy/final/candy-before-after.png` | the size of the jump this rework must make |
| Component kit (source) | `$S/dir-candy/mock/candy.css`, `$S/dir-candy/mock/sprite.js` | starting CSS and the art-icon drawings (§6.17) |
| Clean title still | `$S/dir-candy/mock/world-title-clean.png` | the world without UI, for checking the Title over busy ground |
| Grafts | `$S/dir-storybook/journey.png` (props casting the purple shade), `$S/dir-storybook/win.png` (goal cards, loot tiles, the two-line Next), `$S/dir-storybook/pause.png` (dozing Nubs), `$S/dir-sticker/mock/e-intro.png` (start pill, Dare chip), `$S/dir-sticker/mock/d-hud.png` (comic burst stamp) | the specific ideas named in §10 and §9 |
| Judges' crops | `$S/judge-fit/*.png` | 1x readability checks |
| Today (before) | `$S/before/*.png` | the current screens |

---

## 1. The look in six rules

1. **One ink.** Every outline, text halo, hard drop and dark text is `--ink #2A1B45`. No grey
   borders. No blur-only shadows: depth comes from hard ink drops; one soft shadow is allowed on
   panels and modals only (§5).
2. **Display text is Lilita One with an ink halo.** White fill, `-webkit-text-stroke` with
   `paint-order: stroke fill`, plus a hard ink drop. Sentences stay in the system font at 700–800, in
   ink on cream. Haloed text is never smaller than 15 px; anything smaller is plain fill that passes
   4.5:1 on its own (§4.3).
3. **Everything you can press has a lip.** A face gradient, a darker inset bottom band (the lip), a
   gloss cap, a 3 px ink border and a hard 4 px ink drop. Pressing sinks it onto its lip.
4. **Colour means role.** Green = go (Play, Continue, Next, Resume, Collect, Claim). Blue = navigate
   (Map, Back, Retry when it is not the main action, Restart). Violet = Endless, XP, epic. Pink =
   Share, Dare, challenges, stickers. Gold = rewards and stars. Red = danger, screen-title ribbons and
   wins. Cloud (white-lavender) = neutral (Settings, Home, the Title tray, secondary actions). **One
   saturated hero per screen**: the main action is the only big saturated control; everything around
   it is smaller or neutral (the Title tray is cloud, §10.1).
5. **Frames hold content, ribbons name it.** Cream panels sit in a coloured frame; a ribbon straddles
   the top edge of screen titles, dialogs and hero moments; tags and medals overhang edges on purpose.
   Menu section cards use an ink panel title on cream, not a ribbon (six ribbons on one screen is
   noise).
6. **Warm, not cold.** The world is a warm pastel diorama, so the menus' sky is a warm dawn sky that
   fades into the world's sand, scrims are warm plum, and the map's road is the world's own dirt road
   with the world's own purple shade under its props (§6.16, §6.13).

---

## 2. The font: Lilita One

### 2.1 Files (committed)

| File | What |
|---|---|
| `src/ui/fonts/lilita-one-latin.woff2` | Google Fonts' own latin subset of Lilita One, unmodified. 10,672 B (14,232 B as base64). sha256 `d2575d4fa3632580aafcbcdf6978b3b57e144b90cf5bd9c2c98194f28b869704`. |
| `src/ui/fonts/LICENSE-LilitaOne.txt` | The SIL Open Font License 1.1 text with the copyright line: © 2011 Juan Montoreano, Reserved Font Name "Lilita". |

Rules: never re-subset, rename, convert or edit the woff2 (the Reserved Font Name forbids shipping a
modified font under that name). It is a single weight (400).

**Credit.** Settings shows one line under the version line, in the `.version` style:
`Lilita One font © 2011 Juan Montoreano · SIL Open Font License 1.1`. The UI README (§8 PWA or a new
§10 Credits) names the font and its licence file.

### 2.2 Loading (one code path for the PWA and the single file)

`src/ui/fonts.ts` (new, owner B1):

```ts
// The display face (docs/UI_V2.md §2). The ?inline import is a data: URL in every build (verified
// with this repo's Vite: `data:font/woff2;base64,…` even with assetsInlineLimit 0), so the PWA and the
// single-file build share one path and neither vite.config.ts nor scripts/inline-build.mjs changes.
import lilita from './fonts/lilita-one-latin.woff2?inline';

export const DISPLAY_FONT = "'Lilita One', 'Arial Rounded MT Bold', system-ui, sans-serif";

/** Resolves true once Lilita One is usable (false if the browser refused it: the fallbacks fit). */
export const fontsReady: Promise<boolean> = (async () => {
  try {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false;
    const face = new FontFace('Lilita One', `url("${lilita}") format('woff2')`, { weight: '400', style: 'normal', display: 'swap' });
    document.fonts.add(await face.load());
    return true;
  } catch {
    return false;
  }
})();
```

- No `@font-face` rule in CSS, no `assetsInlineLimit` change, no `inline-build.mjs` change. The font
  rides inside the JS chunk (the service worker precaches it with the chunk).
- `ui.ts` imports `./fonts.ts` (so the game and the UI lab both start the load at import time).
- The module touches `document`/`FontFace` only inside the async body, so a node unit test that
  imports a UI module never crashes.

### 2.3 After the font arrives

- **Boot splash** (`src/main.ts`, B1): the splash is removed on the first frame as today, but not
  before `Promise.race([fontsReady, delay(300 ms)])` settles. A slow font never holds the game more
  than 300 ms; a fast one (the usual case: a data URL decodes in a few ms) means no flash of the
  fallback face.
- **DOM layout** (`ui.ts`, B1): when `fontsReady` resolves true, call the current screen's
  `relayout?.()` (the Title's `fit()` measures text) and the Results `measure()`. Nothing else: CSS
  text re-renders by itself. The UI lab awaits `fontsReady` before its first render, so lab
  screenshots never show the fallback face.
- **Canvas caches** (`session.ts` → a new `invalidateFonts(scene)` export in `renderer.ts`, B5): on
  resolve, once:
  - `hud.widths.clear()`; `hud.layer = null` (or NaN the first key slot); `hud.fontK = -1`;
    `hud.badgeKey = -1`; drop the HUD sprite caches (pips, coin, medal, head, flag, meter base);
  - `banners.fontK = 0`; `banners.stampW = banners.dayTitleW = banners.dayLineW = banners.nightW = 0`;
    `banners.levelWrapW = 0`; drop the intro-card, stamp, toast and day/night card sprites;
  - clear the pop sprite cache (`particles.ts`) if one exists.
  A font-generation counter (`fontGen`) is added to the HUD row-layer key so no other path can reuse a
  layer built with the fallback face.

### 2.4 Using the font

- CSS: `font-family: var(--font-display)`; always `font-weight: 400; font-synthesis: none` (asking
  for 800 makes Chrome fake a bold and the glyphs turn to blobs).
- Canvas: `` `400 ${px}px 'Lilita One', 'Arial Rounded MT Bold', system-ui, sans-serif` `` (the
  `displayFont(px)` helper in `src/render/candy.ts`, §9.1).
- Coverage (checked in Chromium): digits, Basic Latin, Latin-1 accents and `× · ’ “ ” – — … •` are in
  the subset. **Not in it:** `★ ≤ ← → ↑ ↓ ✓` and every emoji. The browser falls back per glyph, which
  is acceptable only where this document says so:
  - strings that must keep a glyph for e2e or meaning keep it **in a `<span class="glyph">`** set in
    `--font-body` (the Title map tag `71★`, the key hint `Space: play the level · ← →: Endless · Esc:
    back`, `≤ 3.7 s in sun` on cards, the Daily's forecast emoji);
  - where the glyph is decoration, draw an art icon instead (§6.17).
- Lilita has no tabular figures. Counters that count up set `min-width` in `ch` for their final value
  (`style.minWidth = \`${String(to).length + 0.5}ch\``) so the slot does not jitter; the canvas keeps
  its width table (`drawTabular`), rebuilt after the font loads.

### 2.5 The `paint-order` fallback

Chromium before 123 ignores `paint-order` on HTML text, so a 0.24 em stroke would eat into the white
fill. `ui.ts` adds `.no-po` to the root when `/Chrom(e|ium)\/(\d+)/` matches with a major below 123
and the UA is not Safari; `.sui.no-po` sets `--halo: 0.1em` (§4.2), so every haloed text gets a
thinner stroke that, centred, still leaves the fill readable. Canvas text is not affected (it
strokes, then fills).

---

## 3. Design tokens

All tokens live on `.sui` in **`src/ui/kit.css`** (new, owner B1), imported by `ui.ts` before
`ui.css` and `gamify.css`. No other stylesheet may hard-code a colour that has a token. SVG art and
the canvas (which mirrors these values in `src/render/candy.ts`) are the exceptions.

```css
.sui {
  /* Ink: every outline, halo, hard drop and dark text. */
  --ink: #2A1B45;
  --ink-2: #4E3A6E;            /* secondary text: 9.2:1 on cream, 8.4:1 on cream-2 */

  /* Cream: panel faces, plates, wells. */
  --cream: #FFF8E6;
  --cream-2: #FFEDC2;          /* wells */
  --cream-3: #EBC982;          /* well and plate bevels */

  /* Candy faces: -hi (top), face, -lo (bottom), -lip (the extruded bottom band). */
  --green-hi: #B4F25E;  --green: #69D33B;  --green-lo: #43B226;  --green-lip: #2C8416;
  --blue-hi: #8EDBFF;   --blue: #3FAEF7;   --blue-lo: #2189E6;   --blue-lip: #1660B4;
  --gold-hi: #FFF07A;   --gold: #FFCB2B;   --gold-lo: #FFA51C;   --gold-lip: #CF6F00;
  --pink-hi: #FFA3C0;   --pink: #FF6390;   --pink-lo: #EE3D6E;   --pink-lip: #AE2453;
  --violet-hi: #D7B0FF; --violet: #A26AF7; --violet-lo: #8550EC; --violet-lip: #5B2EB4;
  --red-hi: #FF9A6E;    --red: #FF6A45;    --red-lo: #F0472C;    --red-lip: #B0301A;
  --cloud-hi: #FFFFFF;  --cloud: #F4F1FB;  --cloud-lo: #DCD5EC;  --cloud-lip: #A99CC6;
  --ice-hi: #E9F6FF;    --ice: #9ED8FF;    --ice-lo: #4FA9EE;    --ice-lip: #2D7FC8;
  --locked-hi: #EEEAF5; --locked: #D9D1E6; --locked-lo: #C3B8D6; --locked-lip: #A99CC6;

  /* The embossed slot (counters, bar tracks, toggle off, HUD goal pill). Always opaque. */
  --slot-1: #3B2A5A;
  --slot-2: #4E3B6C;
  --slot-sub: #FFE58A;         /* secondary numbers on the slot: 10.1:1 */
  --slot-off: #E6DCF5;         /* "OFF" on the toggle slot: 6.8:1 at its lightest */

  /* Accent text on cream (each ≥ 4.5:1 on --cream). */
  --t-green: #136E4E;  --t-blue: #1660B4;  --t-rose: #C62A55;  --t-amber: #B5560A;
  --t-orange: #C9470F; --t-violet: #5B2EB4; --t-brown: #8A4B00;

  /* Light tinted chip faces (ink or accent text on them). */
  --tint-green: #E5F8D8; --tint-blue: #E3F3FF; --tint-gold: #FFF1C9;
  --tint-pink: #FFE4EE;  --tint-violet: #F1E6FF;

  /* Bubbles and stickers (flat faces so small white text passes without a halo). */
  --bubble: #D9263A;           /* white: 4.9:1 */
  --sticker: #B8285A;          /* white: 6.0:1 */

  /* The warm sky behind full-screen menus. */
  --sky-1: #7CCBF2; --sky-2: #BFE7F4; --sky-3: #FBE9C6; --sky-4: #EBD3A0;
  --sky-glow: #FFE6A3; --cloud-shade: #E9DCC8;

  /* Chapter boards. */
  --meadow-hi: #B6EE7C;  --meadow: #6CCB45;  --meadow-lo: #3E9B2A;
  --meadow-ground: #CFEFA3;  --meadow-ground-2: #B5E284;
  --oldtown-hi: #FFB088; --oldtown: #F2774A; --oldtown-lo: #C9502C;
  --oldtown-ground: #F7DDB0; --oldtown-ground-2: #EFCB8E;
  --lockboard-hi: #CDC4DD; --lockboard: #A99DC0; --lockboard-lo: #8A7DA6;
  --lockboard-ground: #EAE5F2;

  /* The map road: the world's own dirt road. */
  --road-edge: #C9826A; --road: #E8A98A; --road-hi: #F2BEA0;
  --road-todo-edge: #BFA796; --road-todo: #DCC6B6;

  /* The game's shade colour, under map props and nodes. */
  --shade: rgba(90, 74, 120, 0.32);

  /* Scrims. */
  --scrim: rgba(56, 30, 50, 0.58);       /* Pause, confirm, install: warm plum */
  --scrim-rv: rgba(34, 20, 64, 0.88);    /* the reward reveal's stage */

  /* Elevation and outline (§5). */
  --top-light: inset 0 2px 0 rgba(255, 255, 255, 0.65);
  --drop-sm: 0 3px 0 var(--ink);
  --drop: 0 4px 0 var(--ink);
  --drop-lg: 0 6px 0 var(--ink);
  --soft: 0 14px 24px -8px rgba(42, 27, 69, 0.45);   /* panels and modals only */
  --bw-sm: 2.5px; --bw: 3px; --bw-lg: 4px;

  /* Radii. */
  --r-sm: 14px; --r: 18px; --r-lg: 22px; --r-xl: 24px; --r-panel: 30px; --pill: 999px;

  /* Type (§4). */
  --font-display: 'Lilita One', 'Arial Rounded MT Bold', system-ui, sans-serif;
  --font-body: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font: var(--font-body);
  --halo: 0.24em;              /* the ink halo's stroke width; resolves per element (em) */

  /* Motion (§7). */
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-back: cubic-bezier(0.34, 1.56, 0.64, 1);
  --t-down: 80ms; --t-up: 140ms; --t: 180ms;
}
```

**Legacy aliases** (also in `kit.css`) keep the old screen rules working while each builder rewrites
its screens. B1 deletes each alias once `grep` shows no rule uses it; none may remain at the end.

```css
.sui {
  --ink-3: var(--ink-2);                     /* the old muted step is folded into ink-2 */
  --paper: var(--cream); --paper-2: var(--cream-2); --panel: var(--cream);
  --line: rgba(42, 27, 69, 0.14);
  --accent: var(--green); --accent-deep: var(--green-lip);
  --accent-ink: var(--t-green); --accent-soft: var(--tint-green);
  --gold-deep: var(--gold-lip); --gold-soft: var(--tint-gold);   /* --gold keeps its name */
  --danger: var(--red); --danger-deep: var(--red-lip); --danger-soft: #FFE4DC;
  --indigo: var(--violet-lip); --sky: var(--tint-blue);
  --shadow-sm: var(--drop-sm); --shadow: var(--drop); --shadow-lg: var(--drop-lg), var(--soft);
  --gloss: none;
}
```

**Face classes.** One class sets a candy face's four variables; any element can wear it:

```css
.f-green,  .btn--primary { --hi: var(--green-hi);  --face: var(--green);  --lo: var(--green-lo);  --lip: var(--green-lip); }
.f-blue,   .btn--blue    { --hi: var(--blue-hi);   --face: var(--blue);   --lo: var(--blue-lo);   --lip: var(--blue-lip); }
.f-gold,   .btn--gold    { --hi: var(--gold-hi);   --face: var(--gold);   --lo: var(--gold-lo);   --lip: var(--gold-lip); }
.f-pink,   .btn--pink    { --hi: var(--pink-hi);   --face: var(--pink);   --lo: var(--pink-lo);   --lip: var(--pink-lip); }
.f-violet, .btn--violet  { --hi: var(--violet-hi); --face: var(--violet); --lo: var(--violet-lo); --lip: var(--violet-lip); }
.f-red,    .btn--danger  { --hi: var(--red-hi);    --face: var(--red);    --lo: var(--red-lo);    --lip: var(--red-lip); }
.f-cloud,  .btn--plain   { --hi: var(--cloud-hi);  --face: var(--cloud);  --lo: var(--cloud-lo);  --lip: var(--cloud-lip); }
.f-ice                   { --hi: var(--ice-hi);    --face: var(--ice);    --lo: var(--ice-lo);    --lip: var(--ice-lip); }
.f-locked                { --hi: var(--locked-hi); --face: var(--locked); --lo: var(--locked-lo); --lip: var(--locked-lip); }
```

---

## 4. Type

### 4.1 Scale

Text sizes are in **rem** (the 150 % and 200 % large-text specs must scale them). Two exceptions keep
px on purpose: the Title tray labels (decorative, `aria-hidden`; they must never collide, see
`layout.spec` "tray labels apart") and everything drawn on the canvas.

| Token | rem / px | Role | Font | Halo stroke | Drop |
|---|---|---|---|---|---|
| (SVG) | 104 units | Logo word | Lilita | layered (§10.1) | 12-unit extrusion |
| `--fs-d-hero` | 2.125 / 34 | Daily number, results level name on wide sheets | Lilita, ink fill | none | none |
| `--fs-d-2xl` | 1.875 / 30 | XL button; level name on the results sheet (ink, no halo) | Lilita | 0.24 em | 0.1 em (min 2 px) |
| `--fs-d-xl` | 1.625 / 26 | Ribbon (screen title, win), L button | Lilita | 0.24 em | 0.1 em (min 2 px) |
| `--fs-d-lg` | 1.375 / 22 | M button, counter numbers, node numbers, chapter names, stat values | Lilita | 0.24 em | 0.1 em |
| `--fs-d-md` | 1.125 / 18 | S button, chips, small ribbon, tabs (17 px → 1.0625 rem) | Lilita | 0.24 em | 0.1 em |
| `--fs-d-sm` | 0.9375 / 15 | Tags, bar labels, tray labels (15 px fixed), toast kickers | Lilita | 0.24 em | 2 px |
| `--fs-d-xs` | 0.8125 / 13 | Kickers on frames, stickers, ON/OFF | Lilita | **never** | none |
| `--fs-md` … `--fs-2xl` (existing) | 1 … 1.75 | Body: sentences, descriptions, captions | system 700–800 | none | none |

Body copy keeps the v1.4 floor: at least 16 px on menus; 13–14 px only inside chips, tiles and
captions. Panel titles on cream are Lilita `--fs-d-lg` to `--fs-d-2xl` in ink, no halo.

### 4.2 Text classes

```css
.gt {                       /* game type: white with an ink halo */
  font-family: var(--font-display); font-weight: 400; font-synthesis: none;
  color: #fff; letter-spacing: 0.02em;
  -webkit-text-stroke: var(--halo) var(--ink); paint-order: stroke fill;
  text-shadow: 0 max(2px, 0.1em) 0 var(--ink);
}
.gt-ink {                   /* game type in ink, on cream or tints */
  font-family: var(--font-display); font-weight: 400; font-synthesis: none;
  color: var(--ink); letter-spacing: 0.01em;
}
.sui.no-po { --halo: 0.1em; }   /* §2.5: every haloed recipe reads var(--halo) */
```

Buttons, ribbons, counters, medals, tags and bar labels apply the same recipe on their own selector
(they do not need `.gt` in the markup). Every haloed recipe writes its stroke as
`-webkit-text-stroke: var(--halo) var(--ink)`, never a literal width, so the `.no-po` fallback reaches
all of them.

### 4.3 The halo rule

The stroke is centred on the glyph edge; with `paint-order: stroke fill` half of it shows outside.
At 0.24 em that is ≥ 1.8 px at 15 px and 3.6 px at 30 px. **Every white text on a candy face, the sky
or the world carries this halo, without exception** (white on green is 1.9:1 without it). Text under
15 px **never** carries a halo (it turns to blobs, the judges' 13 px bar labels proved it); it must
pass 4.5:1 by its fill alone: ink on light faces, white on `--bubble`, `--sticker`, `--slot-*`, or
`--violet-lip`.

---

## 5. Elevation, outline and gloss

| Element | Border | Lip (inset bottom band) | Drop | Soft shadow |
|---|---|---|---|---|
| S button, chip, tag, bubble | 3 px (2.5 px tags, bubbles) | 5 px | `--drop-sm` | none |
| M/L button, node disc, medal, counter | 3 px | 6–7 px | `--drop` | none |
| XL button | 3 px | 8 px | `--drop` | none |
| Plate, well | 3 px / none | 4 px bevel (`--cream-3`) | `--drop-sm` / none | none |
| Panel (frame), modal, sheet, ribbon, stamp | 4 px | — | `--drop-lg` | `--soft` (panels and modals only) |

- **Top light:** `inset 0 2px 0 rgba(255,255,255,.65)` on every candy face.
- **Gloss cap and sparkle** share **one** `::before` (so `::after` stays free for the claim dot,
  `.has-dot::after`, and the Results arming sweep, `.res-arm::after`):

```css
.btn::before, .candy::before {
  content: ''; position: absolute; z-index: -1; pointer-events: none;
  left: 7px; right: 7px; top: 4px; height: 40%;
  border-radius: calc(var(--r) - 6px) calc(var(--r) - 6px) 40% 40% / calc(var(--r) - 6px) calc(var(--r) - 6px) 9px 9px;
  background:
    radial-gradient(4.5px 3px at 9px 6px, #fff 90%, rgba(255, 255, 255, 0) 100%),   /* sparkle */
    linear-gradient(180deg, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0.12)); /* gloss cap */
}
```

  Gloss is restrained on small things: chips, tags, bubbles, stickers, wells, plates and slots have
  **no** gloss cap (the judges' "wall-to-wall candy" warning).
- **The `--sh` pattern.** Every kit component writes `box-shadow: var(--sh)` and defines `--sh` per
  state. Focus appends the ring instead of replacing the stack (§8.3). Pressed states redefine `--sh`.
- **Icons carry their own outline.** Art icons bake their 2 px ink drop into the SVG (a second
  `<use>` offset by 2 px), never CSS `filter: drop-shadow` (it repaints during every transition).
- **Retired:** the v1.4 blurred `--shadow*` stacks, the `--gloss` gradient, `filter: drop-shadow` on
  the logo and on star icons, `opacity: .55` on locked tiles.

---

## 6. Component recipes

Owner of every recipe: B1 (`kit.css`, `widgets.ts`, `art-icons.ts`). Screen builders compose them and
must not fork them; a needed variant is added to the kit (a one-line PR to B1's files is fine).

### 6.1 Candy button (`.btn`; `widgets.ts button()`)

`ButtonOptions` gains `variant: 'primary' | 'gold' | 'danger' | 'plain' | 'blue' | 'violet' | 'pink'`
(default `'plain'` = cloud), `size: 'sm' | 'md' | 'lg' | 'xl'` and `square?: boolean`. Existing class
names stay (`btn`, `btn--primary`, `btn--lg`, `btn--round`, `btn-label`, `btn--block`).

```css
.btn {
  --hi: var(--cloud-hi); --face: var(--cloud); --lo: var(--cloud-lo); --lip: var(--cloud-lip);
  --h: 56px; --r: 18px; --lipH: 6px; --ic: 28px;
  --sh: inset 0 calc(-1 * var(--lipH)) 0 var(--lip), var(--top-light), var(--drop);
  position: relative; isolation: isolate;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: var(--h); min-width: 48px;
  padding: 2px 20px var(--lipH);
  border: var(--bw) solid var(--ink); border-radius: var(--r);
  background: linear-gradient(180deg, var(--hi), var(--face) 46%, var(--lo));
  box-shadow: var(--sh);
  font: 400 var(--fs-d-lg)/1.05 var(--font-display); font-synthesis: none;
  color: #fff; letter-spacing: 0.02em;
  -webkit-text-stroke: var(--halo) var(--ink); paint-order: stroke fill;
  text-shadow: 0 max(2px, 0.1em) 0 var(--ink);
  transition: transform var(--t-up) var(--ease-back);
}
.btn:active:not([aria-disabled='true']) {
  --sh: inset 0 -3px 0 var(--lip), var(--top-light), 0 0 0 var(--ink);
  transform: translateY(calc(var(--lipH) - 2px));
  transition-duration: var(--t-down);
  transition-timing-function: var(--ease-out);
}
.btn--sm { --h: 48px; --r: 15px; --lipH: 5px; --ic: 24px; padding: 2px 14px var(--lipH); font-size: var(--fs-d-md); }
.btn--lg { --h: 64px; --r: 22px; --lipH: 7px; --ic: 32px; font-size: var(--fs-d-xl); }
.btn--xl { --h: 72px; --r: 24px; --lipH: 8px; --ic: 36px; font-size: var(--fs-d-2xl); }
.btn--sq    { width: var(--w, var(--h)); padding: 0 0 var(--lipH); }          /* icon-only square */
.btn--round { width: var(--h); padding: 0 0 var(--lipH); border-radius: 50%; } /* icon-only coin */
.btn--round::before { left: 8px; right: 8px; border-radius: 50% 50% 40% 40% / 60% 60% 30% 30%; }
```

- **Sizes:** sm 48 (yes, 48: no candy control relies on a pseudo-element hit box any more), md 56,
  lg 64, xl 72. Round default 48; `.menu-back`, the pause button and the Results Home are 50.
- **Icon-only** (`round` or `square`): the label becomes the `aria-label` as today; the icon is an
  art icon (§6.17) at `--ic`.
- **Labels never wrap on XL** (`white-space: nowrap`); they step down one size (`--fs-d-xl`) when the
  column is under 360 px or the root font is ≥ 150 % (a `@container` or the existing narrow rules).
  Other labels may wrap, as today.
- **Two-line label** (`.btn-label` + `.btn-kicker`): the kicker is CSS generated content where the
  e2e text must stay exact: `.play-pill .btn-label::before { content: 'PLAY'; display: block;
  font-size: var(--fs-d-sm); letter-spacing: 0.08em; }`, so `.play-pill` still reads exactly
  `Level N`. Results' Next uses the same trick: `.res-next .btn-label::after { content: attr(data-sub); … }`
  with `data-sub="LEVEL 39"` set by results.ts (generated content is not in `textContent`).
- **Disabled** (`aria-disabled="true"`, except `.res-arm.is-arming`, which keeps its face and plays
  the sweep): cloud face, label `--ink-2` with no stroke and no text shadow, no gloss, drop
  `0 2px 0 rgba(42,27,69,.35)`, no press. Never a greyed-out coloured candy.
- **Locked** (Title Endless/tray, `.is-locked`): its own face (violet/cloud) desaturated with
  `--locked` tokens (`f-locked`), the icon at full ink, a gold lock badge (§6.7) at the bottom-right.
  Locked controls stay focusable and toast how to unlock (unchanged behaviour).
- **Shake** (`.is-shake`, deny) stays.
- **Hover** (only under `(hover: hover)`): the face brightens, never a filter:
  `background: linear-gradient(180deg, color-mix(in srgb, var(--hi), #fff 25%), color-mix(in srgb, var(--face), #fff 12%) 46%, var(--lo))`
  (a variable cannot be redefined in terms of itself, so the gradient is restated).

### 6.2 Icon buttons in the HUD row and headers

| Button | Recipe | Size | Icon |
|---|---|---|---|
| `.pause-btn` (in play) | `btn--blue btn--sq`, r 16 | 48 × 48 at (in-left + 8, in-top + 8): **unchanged geometry** (the HUD row starts at x 64) | art `pause` 26 |
| `.menu-back` | `btn--blue btn--round` | 50 | art `back` 28 |
| Results Home | `btn--plain btn--round` | 50 | art `home` 28 |
| Results Share | `btn--pink btn--sm` with label "Share" (or "Send it back") | 48 h | art `share` 24 |
| Title Reward | `btn--gold btn--sq`, label visually hidden (`.sr-only` on `.btn-label`; the aria-label stays) | 54 | art `gift` 34, a ray burst behind (§6.16), a dot bubble |
| Challenge close | `btn--danger btn--round` | 48 (was 32 + hit box) | art `close` 22 |

### 6.3 Panel, plate and well

**Panel** (`.panel`; applied by CSS to `.card`, `.dialog`, `.res-sheet`, `.install`, `.stage`) is one
element: no wrapper markup. The coloured frame and the inner ink line are inset shadows:

```css
.panel, .card, .dialog {
  --frame: var(--blue);
  /* Shadows paint first-listed on top, so from the outside in: the frame's top light and bottom
     shade, the 8 px coloured frame band, the 3 px inner ink line (8-11 px), the cream's top shade. */
  --sh: inset 0 2px 0 rgba(255, 255, 255, 0.55),
        inset 0 -3px 0 rgba(0, 0, 0, 0.18),
        inset 0 0 0 8px var(--frame),
        inset 0 0 0 11px var(--ink),
        inset 0 5px 0 11px rgba(42, 27, 69, 0.10),
        var(--drop-lg), var(--soft);
  position: relative;
  border: var(--bw-lg) solid var(--ink); border-radius: var(--r-panel);
  padding: calc(11px + 16px);
  background: var(--cream);
  box-shadow: var(--sh);
}
.panel::before, .card::before, .dialog::before {      /* two rivets, centred in the top frame band */
  content: ''; position: absolute; top: 0.5px; left: 24px; right: 24px; height: 7px; pointer-events: none;
  background: radial-gradient(circle 3.5px at 3.5px 3.5px, rgba(255,255,255,.8) 95%, transparent),
              radial-gradient(circle 3.5px at calc(100% - 3.5px) 3.5px, rgba(255,255,255,.8) 95%, transparent);
}
.panel--gold   { --frame: var(--gold); }
.panel--violet { --frame: var(--violet); }
.panel--red    { --frame: var(--red); }
.panel--cloud  { --frame: var(--cloud-lo); }
.panel--meadow, .chapter[data-biome='meadow']   { --frame: var(--meadow); }
.panel--oldtown, .chapter[data-biome='oldtown'] { --frame: var(--oldtown); }
.chapter.is-locked { --frame: var(--lockboard); }
```

The panel is a single element, so no markup changes for the dozens of `.card`s. A card that already
uses `::before` for something of its own (`.daily-hero::before` today) keeps that rule and drops the
rivets.

- Menu cards (`.card`) are blue panels; the Daily hero is gold; the Profile hero violet; the
  Results sheet blue (`border-bottom: 0; border-radius: 30px 30px 0 0`, the soft shadow points up:
  `0 -10px 24px -8px rgba(42,27,69,.45)`; it keeps its own safe-area padding plus the 11 px frame).
- `.card-title` = Lilita `--fs-d-lg` in ink on the cream (no ribbon, rule 5).
- **Plate** (`.plate`): cream face, `--bw` ink border, `--r`, `inset 0 -4px 0 var(--cream-3)`,
  `--drop-sm`. For dense rows (mission rows, list rows, the star road, toasts).
- **Well** (`.well`): `--cream-2`, r 16, `inset 0 3px 0 var(--cream-3), inset 0 0 0 2px rgba(42,27,69,.12)`,
  no border, no drop. For anything nested inside a panel (stat tiles' background, the pause status,
  the mascot well).
- Rows inside a panel are separated by `border-top: 2.5px dashed rgba(42,27,69,.18)`.

### 6.4 Ribbon

Markup (helper `ribbon(text, { tone, size, tag })` in `widgets.ts`, which returns the wrapper and the
band so callers can keep setting the band's `textContent`). The wrapper is
`position: relative; display: inline-flex; justify-content: center; padding: 0 30px;` so each 50 px
tail tucks 20 px under the band's end:

```html
<div class="ribbon ribbon--red">                       <!-- tone: red | blue | green | violet | pink -->
  <svg class="ribbon-tail ribbon-tail--l" aria-hidden="true"><use href="#k-tail"/></svg>
  <h2 class="ribbon-band">Journey</h2>                  <!-- the heading stays real text -->
  <svg class="ribbon-tail ribbon-tail--r" aria-hidden="true"><use href="#k-tail"/></svg>
</div>
```

- **Band:** `min-height: 52px; padding: 0 22px 4px; border: 4px solid var(--ink); border-radius: 10px;`
  background `linear-gradient(180deg, var(--rb-hi), var(--rb) 45%, var(--rb-lo))`, shadows
  `inset 0 3px 0 rgba(255,255,255,.5), inset 0 -5px 0 rgba(0,0,0,.18), var(--drop)`; text Lilita
  `--fs-d-xl` white with the halo; `white-space: nowrap`; `position: relative; z-index: 2`.
- **Tails:** the shared symbol `#k-tail` (in the kit sprite, §6.17): a 50 × 46 shape
  `M2 2H48V44H2L15 23Z` filled `currentColor`, ink stroke 4 with round joins, and a fold stripe
  (`M30 2V44`, stroke `#000` at .28, width 5). Placed 16 px lower than the band, 0 px from the
  wrapper's edges, `color: var(--rb-tail)`, the right one mirrored with `scaleX(-1)`, and a baked 3 px
  ink drop (a second `<use>` offset 3 px, filled ink). Never `clip-path` tails (they cut the outline).
- **Tones:** red `#FF9B6A / #FF6A45 / #E2401F`, tail `#C5381C` (screen titles, wins); blue
  `#8EDBFF / #3FAEF7 / #1F86E0`, tail `#1B6FC6` (Pause, the tagline, "So close!"); green
  `#B4F25E / #69D33B / #43B226`, tail `#2E8C1A` (level intros, Meadow day card, "Wearing"); violet
  `#D7B0FF / #A26AF7 / #8550EC`, tail `#5B2EB4` (night, XP, the reveal's epic); pink
  `#FFA3C0 / #FF6390 / #EE3D6E`, tail `#AE2453` (challenges).
- **Small** (`.ribbon--sm`): band 38 px, text `--fs-d-md`, 3 px border, tails 36 × 34 at top 11.
- **Long text:** the band may shrink its font down to `--fs-d-md` before it may ellipsize; it never
  wraps.
- Ribbons are never interactive and never the only place a heading lives: the band *is* the
  heading element, or it is `aria-hidden` and a real heading carries the same words.

### 6.5 Embossed counter (wallet, star total, Results Snow)

Applied to the existing `.chip--snow` / `.chip--stars` elements (keep `role="img"`, the aria-label and
the `.num` child), plus `.counter` for new ones:

```css
.counter, .chip--snow, .chip--stars {
  position: relative; display: inline-flex; align-items: center;
  height: 40px; margin-left: 20px; padding: 0 14px 0 30px;
  border: var(--bw) solid var(--ink); border-radius: 20px;
  background: linear-gradient(180deg, var(--slot-1), var(--slot-2));
  box-shadow: inset 0 3px 0 rgba(0,0,0,.35), inset 0 -2px 0 rgba(255,255,255,.12), 0 3px 0 rgba(42,27,69,.5);
  font: 400 var(--fs-d-lg)/1 var(--font-display); color: #fff;
  -webkit-text-stroke: var(--halo) var(--ink); paint-order: stroke fill;
}
.counter > .ai, .chip--snow > .ai, .chip--stars > .ai {   /* the coin overlaps the slot */
  position: absolute; left: -22px; top: 50%; translate: 0 -50%; width: 46px; height: 46px;
}
.counter small, .chip--stars small { font-size: var(--fs-d-sm); color: var(--slot-sub); margin-left: 2px; }
```

- Coins: Snow = art `snow` (the ice gem), stars = art `star` (replace the line `icon('snow')` /
  `icon('star')` in `snowChip()`, the Title's wallet and the Journey header). The `/600` part is a
  `<small>`.
- **No "+" button** on any counter: the game has no shop, a "+" is a fake purchase affordance.
- A count-up pops only the coin (`scale: 1 → 1.18 → 1`, 160 ms) and sets `min-width` on `.num` (§2.4).

### 6.6 Medal (Sun Rank, HUD level badge, item road, trophies)

```css
.medal {
  --d: 52px;
  position: relative; display: grid; place-items: center; flex: none;
  width: var(--d); height: var(--d); border-radius: 50%; border: var(--bw) solid var(--ink);
  background: radial-gradient(circle at 50% 38%, #FFF29A 0 30%, #FFC82A 62%, #F59A0E);
  box-shadow: inset 0 -4px 0 #D17400, inset 0 3px 0 rgba(255,255,255,.7), var(--drop-sm);
  font: 400 calc(var(--d) * 0.5)/1 var(--font-display); color: #fff;
  -webkit-text-stroke: var(--halo) var(--ink); paint-order: stroke fill;
}
.medal::after { content: ''; position: absolute; inset: 5px; border-radius: 50%; border: 2px dashed rgba(170,90,0,.45); }
.medal--ice    { background: radial-gradient(circle at 50% 38%, #E9F6FF 0 30%, #9ED8FF 62%, #4FA9EE); box-shadow: inset 0 -4px 0 #2D7FC8, inset 0 3px 0 rgba(255,255,255,.7), var(--drop-sm); }
.medal--bronze { background: radial-gradient(circle at 50% 38%, #FFD7A8 0 30%, #E89A55 62%, #B8662A); box-shadow: inset 0 -4px 0 #8A4415, inset 0 3px 0 rgba(255,255,255,.6), var(--drop-sm); }
.medal--silver { background: radial-gradient(circle at 50% 38%, #FFFFFF 0 30%, #DCE3EE 62%, #A9B4C8); box-shadow: inset 0 -4px 0 #7F8AA3, inset 0 3px 0 rgba(255,255,255,.8), var(--drop-sm); }
```

- Number text is `0.5 × --d`; three characters shrink to `0.42 × --d`.
- **With a name plate** (the rank badge): the plate (cream, `r 0 16px 16px 0`, ink 3, bevel) starts
  under the medal's centre and holds a kicker ("SUN RANK", Lilita `--fs-d-xs`, `--ink-2`), the name
  (Lilita `--fs-d-lg`, ink) and a 7 px mini XP bar (§6.8 compact).

### 6.7 Chips, tags, bubbles, stickers, lock badge

- **Chip** (`.chip`): h 36, r 18, `--bw` ink, cream face, `--drop-sm`, Lilita `--fs-d-md` ink, a
  24 px icon at the left. Dark variant `.chip--dark`: slot gradient, white text with the halo
  (forecast chip, the Title's Best and mission-pips chips, the Dying hint). A chip that opens
  something (`.chip--btn`) keeps its 44 px `::before` hit box (chips have no gloss).
- **Tag** (`.tag`, labels hung under icon buttons: "★ 71", "Endless", "Retry", "Map"): h 26, r 13,
  2.5 px ink, cream, Lilita `--fs-d-sm` ink (no halo: ink on cream), overlapping the button's bottom
  edge by 12 px, `pointer-events: none`. It is the button's visible label: either the label element
  itself styled as a tag (keeps the e2e text), or `aria-hidden` when the button has an aria-label.
- **Bubble** (`.has-dot::after`, the claim dots; restyled in `gamify.css` by B1): min 26 × 26 for a
  count, 20 × 20 for a bare dot, `--bw` ink border (not white), flat `--bubble` face with
  `inset 0 2px 0 rgba(255,255,255,.35)`, Lilita 15 px white (4.9:1, no halo). It hops every 4 s
  (`translate: 0 -3px`, 300 ms) except under reduced motion.
- **Sticker** (NEW, BEST, DARE, RANK UP!): flat `--sticker` face, 2.5 px ink, r 8, Lilita
  `--fs-d-xs` white (6.0:1, no halo), rotated 4–8°, `aria-hidden` (its meaning is in a label or the
  aria-description, as today for NEW).
- **Lock badge** (`.tray-lock`, `.lvl-lock`): a 22 px gold coin (`f-gold` radial, 2.5 px ink) with an
  ink lock glyph 13 px, at the bottom-right of its control.

### 6.8 Progress bar (`progressBar()` → `.bar > i`)

```css
.bar {
  position: relative; display: block; height: 22px; overflow: hidden;
  border: var(--bw) solid var(--ink); border-radius: 13px;
  background: linear-gradient(180deg, #3A2A58, #54406F);
  box-shadow: inset 0 3px 0 rgba(0,0,0,.35), 0 2px 0 rgba(255,255,255,.6);
}
.bar > i {
  --b-hi: #FFE45C; --b: #FFB21D;                       /* gold by default */
  position: absolute; inset: 0 auto 0 0; border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255,255,255,.55) 0 30%, rgba(255,255,255,0) 31%),
    repeating-linear-gradient(-45deg, rgba(255,255,255,.18) 0 7px, rgba(255,255,255,0) 7px 14px),
    linear-gradient(180deg, var(--b-hi), var(--b));
  box-shadow: 2px 0 0 var(--ink);
}
.bar--green  > i { --b-hi: #B4F25E; --b: #4CC22C; }
.bar--blue   > i { --b-hi: #9BE3FF; --b: #2E9BEF; }
.bar--violet > i { --b-hi: #D7B0FF; --b: #8E59F0; }
.bar--sm { height: 16px; border-radius: 9px; }          /* compact: no label, no stripes */
.bar--sm > i { background: linear-gradient(180deg, rgba(255,255,255,.5) 0 35%, rgba(255,255,255,0) 36%), linear-gradient(180deg, var(--b-hi), var(--b)); }
.bar-label { position: absolute; inset: 0; display: grid; place-items: center; font: 400 var(--fs-d-sm)/1 var(--font-display); color: #fff; -webkit-text-stroke: var(--halo) var(--ink); paint-order: stroke fill; }
```

- `progressBar(fraction, className, tone?)` gains an optional tone (`'gold' | 'green' | 'blue' |
  'violet'`). Colours: XP violet; stars and star rewards gold; missions and level progress green;
  frost and the slider blue.
- **Labels inside bars** only on bars ≥ 22 px tall, at 15 px; otherwise the count sits beside the bar
  (the star road's `.road-count`, the mission rows' progress text).
- **XP gain:** a lighter overlay segment `.bar-gain` marks what this run added
  (`background: rgba(255,255,255,.45)`, left = before, width = gain), and the "+125 XP" tag is a
  violet comic burst (§6.18) rotated 6° at the bar's top-right.
- Fills keep today's mechanics (width set once; the XP meter's existing animation). No new width
  animations.

### 6.9 Folder tabs (Wardrobe) and the segmented control (Settings)

**Tabs** (`.tabs[role=tablist] > .tab[role=tab]`, Wardrobe only):

```css
.tabs { display: flex; align-items: flex-end; gap: 4px; padding: 0 10px; margin-bottom: -4px; position: relative; z-index: 1; }
.tab {
  flex: 1; height: 48px; display: grid; place-items: center; position: relative;
  border: var(--bw) solid var(--ink); border-bottom: 0; border-radius: 16px 16px 0 0;
  background: linear-gradient(180deg, #5FBDF9, #2A8FE3);
  box-shadow: inset 0 3px 0 rgba(255,255,255,.45);
  font: 400 1.0625rem/1 var(--font-display); color: #fff;
  -webkit-text-stroke: var(--halo) var(--ink); paint-order: stroke fill;
}
.tab[aria-selected='true'] {
  height: 56px; margin-bottom: -3px; z-index: 2;
  background: linear-gradient(180deg, #fff, var(--cream)); color: var(--ink); -webkit-text-stroke: 0;
}
```

The selected tab is taller, white and joined to the panel below; the panel's top border runs under
the unselected tabs only. `role`, `aria-selected`, `aria-controls` and the arrow-key behaviour are
unchanged. The NEW dot sits on the tab's top-right as a 14 px bubble.

**Segmented control** (`.seg[role=radiogroup] > .seg-opt[role=radio]`, Settings: Reduced motion,
Shade guide): a sunk slot track (slot gradient, `--bw` ink, r 18, padding 4, `inset 0 3px 0
rgba(0,0,0,.35)`) with options of h 44, Lilita `--fs-d-md`, white with the halo. The checked option is
a raised cloud candy (`f-cloud` face, 3 px ink, lip 4, `--drop-sm`) with **ink** text and no halo:
it differs in shape, height and text colour, never colour alone.

### 6.10 Toggle (`.switch[role=switch]`)

```css
.switch {
  position: relative; flex: none; width: 76px; height: 40px; padding: 0;
  border: var(--bw) solid var(--ink); border-radius: 20px;
  background: linear-gradient(180deg, #3F2E5C, #54406F);
  box-shadow: inset 0 3px 0 rgba(0,0,0,.35);
}
.switch::before { content: ''; position: absolute; inset: -7px -4px; }      /* the 48 px hit box (kept) */
.switch::after {                                                             /* the state word */
  content: 'OFF'; position: absolute; right: 9px; top: 50%; translate: 0 -50%;
  font: 400 var(--fs-d-xs)/1 var(--font-display); color: var(--slot-off); letter-spacing: 0.04em;
}
.switch[aria-checked='true'] {
  background: linear-gradient(180deg, var(--green-hi), var(--green-lo));
  box-shadow: inset 0 -4px 0 var(--green-lip), var(--top-light);
}
.switch[aria-checked='true']::after { content: 'ON'; right: auto; left: 11px; color: var(--ink); }
.switch-knob {
  position: absolute; top: 2px; left: 2px; width: 30px; height: 30px; border-radius: 50%;
  border: var(--bw) solid var(--ink);
  background: radial-gradient(circle at 40% 35%, #fff, #E4DDF0);
  box-shadow: 0 2px 0 var(--ink);
  transition: transform var(--t) var(--ease-back);
}
.switch[aria-checked='true'] .switch-knob { transform: translateX(36px); }
```

ON/OFF is generated content, so it is not part of the accessible name (the `aria-label` is) and the
state never relies on knob position and colour alone. The whole Settings row remains the hit area as
today.

### 6.11 Slider (`.range` in `.range-wrap`)

Track = the bar slot at 22 px (`.range` styles its `::-webkit-slider-runnable-track` and
`::-moz-range-track`), fill = blue bar fill up to `--fill` (already set by `slider()`), thumb = a
34 px gold coin (`radial-gradient(circle at 45% 35%, #FFF6B0, var(--gold) 55%, var(--gold-lo))`,
3 px ink, `inset 0 -3px 0 var(--gold-lip)`, `--drop-sm`). The value (`.range-value`) is Lilita
`--fs-d-md` ink, right-aligned, `min-width: 3.2em`.

### 6.12 Star

One path in a 48 × 48 box, shared by SVG and canvas (`Path2D`, created lazily, never at module scope):

```
M24 4 L29.88 16.91 L43.97 18.51 L33.51 28.09 L36.34 41.99 L24 35 L11.66 41.99 L14.49 28.09 L4.03 18.51 L18.12 16.91 Z
```

- **Earned:** fill `#FFF27A → #FFC81F (55 %) → #FF9A0A` (top to bottom), ink stroke 3.5 with round
  joins, a lower-right facet `M24 35 L36.34 41.99 L33.51 28.09 L43.97 18.51 L33.51 28.09 Z` in
  `#E98500` at .35, and a white highlight ellipse (rx 2.6, ry 5.2 at 18.5, 20.5, rotated 38°, .85).
- **Empty (socket):** fill `#4A3768`, ink stroke 3.5, an inner top shade
  `M24 9.5 L28.3 19 L38.6 20.2` (black .28, 2.5). It differs from earned in fill and shading.
- **Lost** (HUD, the cool-run star once lost): fill `#CFC6DD`, ink stroke at .55, a 2 px ink slash.
- Sizes: HUD pips 17; node stars 19 / 21 / 19 in an arc (outer ones rotated ±14°, the middle 3 px
  higher); intro-card wells 28; Results hero 92 / 124 / 92 (side stars rotated ∓16°, 30 px lower);
  goal cards 26; Pause status 18.
- DOM: `.lvl-star`, `.res-star` and the Pause stars swap the line `star` icon for the art `star` /
  `starEmpty` symbols; `.is-on` keeps meaning earned.

### 6.13 Level node, the road and the snake (Journey)

**The node** is the whole grid cell: `<button class="lvl-tile">` keeps its children (`.lvl-num`,
`.lvl-concept`, `.lvl-stars`, `.lvl-lock`) and all its classes and attributes.

```css
.lvl-grid { --gap: 4px; --cy: 48px; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); column-gap: var(--gap); row-gap: 10px; position: relative; isolation: isolate; }
.lvl-tile { position: relative; min-width: 0; min-height: 84px; padding: 22px 0 0; border: 0; background: none; display: grid; justify-items: center; align-content: start; }
.lvl-stars { position: relative; z-index: 3; }                  /* above discs and road */
.lvl-concept, .lvl-lock { position: absolute; z-index: 3; }
.lvl-num {                                   /* the disc */
  --d: 52px; --lipH: 5px; --r: 50%;
  --sh: inset 0 -5px 0 var(--lip), var(--top-light), var(--drop-sm), 6px 7px 0 var(--shade);
  position: relative; z-index: 2; isolation: isolate; display: grid; place-items: center;
  width: var(--d); height: var(--d); border-radius: 50%; border: var(--bw) solid var(--ink);
  background: radial-gradient(circle at 50% 30%, var(--hi) 0 18%, var(--face) 55%, var(--lo));
  box-shadow: var(--sh);
  font: 400 var(--fs-d-lg)/1 var(--font-display); color: #fff;
  -webkit-text-stroke: var(--halo) var(--ink); paint-order: stroke fill;
}
```

The disc is a `.candy` (it gets the gloss `::before`; its `::after` is reserved for the next-level
ring pulse). Its face follows the tile's state in CSS (`.lvl-tile.is-next .lvl-num { --hi: var(--green-hi); … }`);
journey.ts sets no new classes.

| State | Disc | Extras |
|---|---|---|
| open, not passed | `f-blue` | star sockets above |
| passed (`.is-done`) | `f-blue` | earned stars above |
| 3 stars (`.is-perfect`) | `f-gold` | three earned stars |
| next (`.is-next`) | `f-green`, 60 px | the **disc** grows (`--d: 60px; margin-top: -4px`, so its centre stays on `--cy` and the road), never a transform, and the tile box does not change (the e2e centring and size checks measure the tile); a white 7 px ring and an ink 3 px ring (`box-shadow` spreads in `--sh`), a slow ring pulse on a `::after` of the disc (opacity only), a rotating sun-ray burst behind (§6.16, 120 px, `z-index: 1`, under the disc), and Nubs' head (art `nubs`, 34 px) pinned above it in place of the stars, bobbing 5 px |
| locked (`.is-locked`) | `f-locked`, number **`--ink-2` with no halo** (7.7:1 at the top, 6.6:1 at the bottom) | no stars, the gold lock badge bottom-right; **no opacity** |
| finale (every 10th) | `f-pink`, 58 px | the sun mascot (art.ts face, 30 px, `aria-hidden`) as its crown above the disc; hidden while the finale is locked (the lock badge says enough; no filter, no opacity) |

- **Concept badge** (`.lvl-concept`): 24 px cream disc, 2.5 px ink, at the disc's top-right
  (`top: 16px; right: calc(50% - 34px)`), holding a 15 px ink line icon (unchanged icons).
- **Stars** (`.lvl-stars`): an arc above the disc, sizes per §6.12; `.is-fresh` keeps its pop.
- **Focus:** `.lvl-tile:focus-visible { outline: none }` and
  `.lvl-tile:focus-visible .lvl-num { --sh: <normal stack>, 0 0 0 9px var(--ink); outline: 3px solid #fff; outline-offset: 3px; }`.
- **Targets:** the cell is ≥ 56 × 84 at 390 and ≥ 50 × 78 at 320 (the e2e floor is 48 × 48). At
  `max-width: 359.98px`: disc 46, next 52, `--gap: 1px`, the board paddings in §10.2.

**The snake.** Row 1 runs left to right (1→5), row 2 right to left (6→10), so the road U-turns on the
right. CSS only; DOM and Tab order stay 1→10:

```css
.lvl-tile:nth-child(6)  { grid-area: 2 / 5; }
.lvl-tile:nth-child(7)  { grid-area: 2 / 4; }
.lvl-tile:nth-child(8)  { grid-area: 2 / 3; }
.lvl-tile:nth-child(9)  { grid-area: 2 / 2; }
.lvl-tile:nth-child(10) { grid-area: 2 / 1; }
```

`.lvl-grid` holds only the ten tiles (nothing else may be its child, or `nth-child` breaks).

**The road** is drawn by the tiles themselves, so it always passes through the disc centres: each
tile's `::before` (edge band) and `::after` (face band) run from its disc centre to the next tile's.

```css
.lvl-tile::before, .lvl-tile::after { content: ''; position: absolute; z-index: 0; pointer-events: none; }
/* straight segments: 1-4 go right, 6-9 go left (tile 10 has none) */
.lvl-tile:nth-child(-n + 4)::before, .lvl-tile:nth-child(n + 6):nth-child(-n + 9)::before {
  top: calc(var(--cy) - 9px); height: 18px; width: calc(100% + var(--gap));
  background: var(--road-todo-edge); border-block: 2px solid var(--ink);
}
.lvl-tile:nth-child(-n + 4)::after, .lvl-tile:nth-child(n + 6):nth-child(-n + 9)::after {
  top: calc(var(--cy) - 5px); height: 10px; width: calc(100% + var(--gap));
  background: var(--road-todo);
}
.lvl-tile:nth-child(-n + 4)::before, .lvl-tile:nth-child(-n + 4)::after { left: 50%; }
.lvl-tile:nth-child(n + 6)::before, .lvl-tile:nth-child(n + 6)::after { right: 50%; }
/* travelled: the segment leaving a passed tile */
.lvl-tile.is-done::before { background: var(--road-edge); }
.lvl-tile.is-done::after  { background: linear-gradient(180deg, var(--road) 0 35%, var(--road-hi) 35% 65%, var(--road) 65%); }
/* the U-turn leaves tile 5 on the right and enters tile 6, directly below it */
.lvl-tile:nth-child(5)::before {
  left: 50%; top: calc(var(--cy) - 9px); width: calc(50% + 6px);
  height: calc(100% + 10px + 18px);            /* one row pitch (cell + row-gap) + the band */
  border: 18px solid var(--road-todo-edge); border-left: 0; border-radius: 0 60px 60px 0;
  box-shadow: 0 0 0 2px var(--ink), inset 0 0 0 2px var(--ink); background: none;
  clip-path: inset(-3px -3px -3px 2px);        /* no ink line down the open left side */
}
.lvl-tile:nth-child(5)::after {                /* the face band, 4 px inside the edge band */
  left: 50%; top: calc(var(--cy) - 5px); width: calc(50% + 2px);
  height: calc(100% + 10px + 10px);
  border: 10px solid var(--road-todo); border-left: 0; border-radius: 0 56px 56px 0; background: none;
}
.lvl-tile.is-done:nth-child(5)::before { border-color: var(--road-edge); }
.lvl-tile.is-done:nth-child(5)::after  { border-color: var(--road); }
```

The disc sits above the road (`z-index: 2`); the stars and badges above the disc. A locked chapter's
road is all "todo". Builders may tune `--cy`, the radii and the pitch to the final cell geometry; the
contract is: the road is continuous through the ten disc centres, travelled segments are the warm
dirt road with a light centre line, untravelled ones are the pale dirt road.

**Arrow keys** follow the screen, not the level numbers (§10.2): Left/Right move one column within
the visual row and stop at its ends; Up/Down move one visual row in the same column, across
chapters.

### 6.14 Toast (DOM `.toast`)

- A cream pill: min-height 44, r 22, `--bw` ink, `inset 0 -4px 0 var(--cream-3)`, `--drop-sm`,
  padding `6px 16px 8px 6px`.
- A 32 px icon disc at the left (`.toast-ic`): candy face by tone (`toast--gold` → `f-gold`,
  `toast--accent` → `f-green`, `toast--danger` → `f-red`, ink/default → `f-cloud`), 2.5 px ink, the
  line icon 18 px in ink.
- Text: Lilita `--fs-d-md` ink for short phrases ("Copied!", "Wardrobe unlocked!", "Finish Level 4
  first."); `overlays.ts` adds `.toast--long` when the text is over 34 characters (the storage and
  backup messages are sentences) and those use body 800 `--fs-md` ink. Up to two lines.
- In: slide down 12 px + fade, 220 ms ease-back; out: fade 200 ms. Placement unchanged except the menu
  offset, which follows the new header height: `top: calc(var(--in-top) + 10px + 64px + 8px)` on menus
  (the header is 64 px: the 50 px back coin, its drop and the ribbon). Title and play offsets stay.

### 6.15 Modal, dialog, sheet

- **Scrim:** `--scrim` over the whole viewport; no blur.
- **Card:** a panel (§6.3), blue by default, max-width 360, inside the world column; a confirm that
  destroys data uses a red ribbon and a red danger button.
- **Ribbon:** straddles the top edge (`top: -30px`, centred); the card's padding-top grows by 26 px
  to clear it. The ribbon band is the dialog's heading (`.dialog-title`, `id` and `aria-labelledby`
  unchanged).
- **Buttons:** the primary first (green L, block), the secondary (blue M, block), then a `.row-2` of
  cloud M buttons.
- **No close coin on Pause** (a second "Resume" button would break `getByRole('button', { name:
  'Resume' })` in four specs). Confirm dialogs and the install sheet may show a red round 48 close
  coin at the top-right corner (−14 / −16) with `aria-label="Close"` when they have no Cancel button;
  today they all have one, so they don't.
- **Install / restore sheet** (`.install`): a bottom sheet with the Results sheet's frame; steps are
  wells with a 28 px gold medal number (`.install-n`); "Not now" stays a quiet text button
  (`.sheet-quiet`: body 800 16, ink-2, underline on hover).
- The existing `--nubs-clear` centring and the small-phone compaction of the Pause card stay.
- Entrance: the card scales .85 → 1 with opacity over 260 ms **ease-out, no overshoot** (the layout
  specs measure the card's clearance above Nubs' halo; an overshoot could cross it); the ribbon does
  the bouncy part: it drops 24 px with a −6° → −2° swing, 360 ms ease-back, 80 ms later. Reduced
  motion: opacity only.

### 6.16 Backdrops

**Menus** (Settings, Daily, Missions, Wardrobe, Journey, Profile): `.scr-menu::before` (fixed, full
viewport; K8 holds, the canvas does not redraw behind menus) becomes the warm sky, and `.menu` loses
its paper background (it stays a transparent, transformed layer):

```css
.scr-menu::before {
  content: ''; position: fixed; inset: 0;
  background:
    repeating-conic-gradient(from 0deg at 50% -8%, rgba(255,255,255,.12) 0 6deg, rgba(255,255,255,0) 6deg 15deg),
    radial-gradient(90% 45% at 50% -6%, var(--sky-glow), rgba(255,230,163,0) 70%),
    linear-gradient(180deg, var(--sky-1) 0%, var(--sky-2) 42%, var(--sky-3) 80%, var(--sky-4) 100%);
}
.scr-menu::after {                      /* three clouds, one static layer behind .menu */
  content: ''; position: fixed; inset: 0; pointer-events: none;
  background: url("data:image/svg+xml,…three clouds…") center top / 100% auto no-repeat;
}
```

- The clouds: one shared SVG path (`M30 76c-16 0-26-10-24-22…Z` from the candy kit), white with a
  `--cloud-shade` underside stroke, three of them at 150–240 px wide, opacity .8–1, baked into one
  data URI (≤ 900 B). They may drift ±20 px over 40 s on the `::after` (transform only); static under
  reduced motion and in `.is-hc`.
- The sky's lower part is the world's sand (`--sky-4`), so long menus end on warm ground, not on cold
  blue. Text never sits directly on the sky except headings with the halo.

**Overlays on the world** (Title, Results, Pause, the intro card):
- Title: a top shade `linear-gradient(rgba(42,27,69,.38), transparent 120px)` and a bottom shade
  `linear-gradient(transparent, rgba(42,27,69,.42))` over the last 260 px, so candy reads over busy
  ground. (Static layers on `.scr-title::before/::after`.)
- Results: a radial scrim `radial-gradient(ellipse at 50% 30%, rgba(56,30,50,.18), rgba(56,30,50,.55))`
  on `.res-map`; the Melt Map stays readable.
- Pause, confirm, install: `--scrim`.

**Celebration burst** (`.burst`, one element, `aria-hidden`): Results hero, the reward reveal, the
Title gift, the Journey `.is-next` node:

```css
.burst {
  background: repeating-conic-gradient(rgba(255,236,140,.55) 0 9deg, rgba(255,236,140,0) 9deg 22.5deg);
  -webkit-mask: radial-gradient(closest-side, #000 18%, rgba(0,0,0,.5) 45%, transparent 75%);
          mask: radial-gradient(closest-side, #000 18%, rgba(0,0,0,.5) 45%, transparent 75%);
  border-radius: 50%;
}
```

It sits on a soft yellow glow ellipse (`radial-gradient(closest-side, rgba(255,230,120,.55), transparent)`)
and rotates 360° in 24 s, linear (a transform on the one element). It is `display: none` wherever it is
not shown, static under reduced motion, absent in `.is-hc`.

**Confetti** (Results win only): 8 small rects (`<i>` children of the hero, `aria-hidden`), one fall
of 1.4 s (transform and opacity), CSS only, never under reduced motion.

### 6.17 Art icons (`src/ui/art-icons.ts`, new)

Illustrated 48 × 48 icons with their own ink outline, two-tone fills and one highlight, ported from
`$S/dir-candy/mock/sprite.js` (simplified where it saves bytes). They live as `<symbol>`s in one hidden
sprite `<svg>` injected once into `#ui` by `createUi`; `artIcon(name, className = 'ai')` returns
`<svg class="ai" aria-hidden="true" focusable="false"><use href="#a-{name}"/></svg>`. The ink drop is
baked into each symbol (a second copy of the outline path offset 2 px, filled ink).

The set (and nothing else, to hold the budget): `star`, `starEmpty`, `snow` (the ice gem), `gift`,
`play`, `pause`, `back`, `home`, `share`, `retry`, `map`, `endless`, `daily`, `missions`,
`wardrobe`, `settings`, `lock`, `trophy`, `globe`, `nubs` (head), `flag` (checkered), `crown`,
`check`, `close`, `xp`, plus the kit shapes `k-tail` (ribbon tail) and `k-burst` (§6.18).

Where icons go:
- **Coloured candy buttons and squares use art icons** (they are drawn for a coloured face).
- **Cloud/cream buttons, chips, rows, settings tiles and the concept badges keep the 24 × 24 line
  icons (`icons.ts`) in ink.** Line icons are never drawn white on a candy face.
- The Settings row tile (`.set-ic`, 46 px, r 14): a candy face by section (Sound pink, Controls
  blue, Play green, Accessibility violet, Testing cloud), no gloss, the line icon in ink (ink on the
  `-hi` to face gradient is ≥ 4.4:1, and icons need 3:1).

### 6.18 Comic burst

A spiky ellipse used for stamps (canvas), the "+125 XP" tag, the RANK UP! sticker's backing and the
headline pops' backing. Generator (`burst(n, rx, ry, depth)` → path data or a `Path2D`), deterministic
(no random jitter: alternate spikes are 8 % shorter):

```
for i in 0 … 2n−1:  a = i·π/n − π/2;  r = (i even ? 1 : 1 − depth) · (i % 4 === 2 ? 0.92 : 1)
                     point = (cx + rx·r·cos a, cy + ry·r·sin a)
```

Drawn as: an ink copy at +4 px y, then the fill with a 3.5 px ink stroke, round joins. DOM uses the
`k-burst` symbol (n 14, depth .18) scaled with `preserveAspectRatio="none"` behind the text.

---

## 7. Motion

Tokens: `--ease-out`, `--ease-back`, `--t-down` 80 ms, `--t-up` 140 ms. **Only `transform` and
`opacity` animate.** Never `box-shadow`, gradients, `width` (except the XP fill as today), `filter`
or text-stroke. Animations never tick in inactive screens (the existing `.scr:not(.is-on)` rule).

| Moment | Motion | Reduced motion |
|---|---|---|
| Press | sink `translateY(lipH − 2)`, lip to 3 px, 80 ms; release 140 ms ease-back | lip shrink only, no translate |
| Modal and dialog in | scale .85 → 1 + opacity, 260 ms ease-out (no overshoot, §6.15) | opacity 150 ms |
| Results sheet in | the existing slide (translateY 40 % → 0) | opacity (existing) |
| Ribbon in | drops 24 px, rotate −6° → −2° (or 0°), 360 ms ease-back, 80 ms after its panel | appears with its panel |
| Menu cards | rise 16 px, staggered 50 ms (existing) | opacity only (existing) |
| Results stars | slam one by one, 250 ms apart: scale 2.2 → .9 → 1 in 300 ms, 8 sparks each, the existing stamp sound | 120 ms opacity fades in sequence |
| Results rays | fade in, then rotate 360° / 24 s | static |
| Count-ups | existing `countUp`; the coin or icon pops 1.18 per step | jump to the final value (existing) |
| Confetti | 8 rects, one 1.4 s fall | none |
| Idle CTA (Play, Next level, Claim, Collect) | a white shine sweep across a clipped `::after` band, 600 ms every 3.2 s (transform only; the button itself never scales, fit() measures it). On Next level the `::after` is the arming sweep's: the shine runs on `.res-arm.is-ready::after` only, after arming | none |
| Bubbles | hop 3 px every 4 s | none |
| Journey `.is-next` | ring pulse (opacity), rays 12 s per turn, Nubs' pin bobs 5 px / 1.6 s | static ring, no rays, no bob |
| Title gift | its burst rotates 30 s per turn; the gift wiggles ±6° twice every 4 s | static |
| Clouds | drift ±20 px / 40 s | static |
| Toasts (DOM and canvas) | slide 12 px + fade, 220 ms in, 200 ms out | fade only |
| Canvas stamps | slam 2.4 → 1 in 220 ms with overshoot, hold, then fade and rise 12 px over 300 ms (existing timing) | fade in place (existing) |
| Intro card footer | the start pill's alpha .75 ↔ 1 over 1.4 s | static at 1 |
| HUD star pip | pop 1 → 1.35 → 1 (existing) | no scale |
| Pops | scale 1.3 → 1 and rise (existing curves) | existing |

At most four compositor animations run at once on any screen (rays, the CTA shine, the pin, a
bubble).

---

## 8. Accessibility

### 8.1 Contrast (WCAG luminance, measured)

| Pair | Ratio |
|---|---|
| ink on cream / on cloud / on white | 14.8 / 14.0 / 15.7 |
| ink-2 on cream / on cream-2 well / on cloud | 9.2 / 8.4 / 8.7 |
| `--t-green` / `--t-blue` on cream | 5.9 / 5.9 |
| `--t-rose` on cream / on white | 5.1 / 5.4 |
| `--t-amber` / `--t-orange` on cream | 4.61 / 4.51 |
| `--t-violet` / `--t-brown` on cream | 8.0 / 6.0 (on `--tint-gold`) |
| `--slot-sub` on the slot (dark / light end) | 10.1 / 7.8 |
| white on the slot (light end) | 9.7 |
| `--slot-off` on the toggle slot (light end) | 6.8 |
| ink "ON" on `--green` | 8.2 |
| locked node number `--ink-2` on `--locked-hi` / `--locked` | 7.7 / 6.6 |
| white on `--bubble` / on `--sticker` | 4.9 / 6.0 |
| concept chip `#124A86` on `#BFE6FF` (canvas) | 6.8 |
| ink on the sky (`--sky-1` / `--sky-2`) | 8.7 / 11.9 |
| ink-2 on the sand end of the sky (`--sky-4`) | 6.7 |
| ink outline vs world sand `#E3C890` / vs `--sky-1` | 9.6 / 8.7 |

**The halo is load-bearing.** White fill with no halo fails on every candy face (1.9:1 on green,
2.4:1 on blue). With the halo, the glyph edge is white against ink (15.7:1) and the ink against the
face is ≥ 3.25:1 in the worst case (`--violet-lo`), 4.1–8.2:1 elsewhere. So: every white text
carries a stroke ≥ 0.22 em with `paint-order: stroke fill` (§4.3); text is never an image (the logo
`h1` keeps the accessible name "SHADY").

**UI boundaries:** the 3 px ink outline is ≥ 3:1 against every backdrop (sand 9.6, sky 8.7, cream
14.8, the slot is the exception it sits on, where the face supplies the boundary).

### 8.2 Never colour alone

- Locked: lock badge + desaturated face + no stars (+ the hatch in `.is-hc`).
- Current level: Nubs' pin + ring + larger disc.
- Selected tab: white, taller, joined. Selected segment: raised, ink text.
- Toggle: knob position + ON/OFF word + `aria-checked`.
- Earned vs empty star: fill and shading. Lost star: a slash.
- Rarity: frame colour + a label word.
- Met goal card: a check sticker.

### 8.3 Focus

The old global rule's `box-shadow: 0 0 0 6px #fff` would erase candy shadows. New rules (B1):

```css
.sui :focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }   /* inputs, links, plain elements */
.sui .btn:focus-visible, .sui .candy:focus-visible, .sui .tab:focus-visible, .sui .seg-opt:focus-visible,
.sui .switch:focus-visible, .sui .chip--btn:focus-visible, .sui .tile:focus-visible, .sui .rank-badge:focus-visible {
  outline: 3px solid #fff; outline-offset: 3px;
  box-shadow: var(--sh, 0 0 #0000), 0 0 0 9px var(--ink);
}
```

That gives an ink | white | ink three-ring that reads on sky, cream and the world. Tiles whose visual
is a child (`.lvl-tile` → `.lvl-num`, `.tray-btn` → `.tray-disc`) put the ring on the child (§6.13).
Focus order and initial focus are unchanged everywhere.

### 8.4 Targets

Every pressable visual is ≥ 48 × 48: candy buttons (sm included), coins, squares, tabs (48, the
selected one 56). Exceptions keep their pseudo hit box: chips (`.chip--btn`, 36 visual → 44), the
switch (40 → 48). Title tray squares 62 × 56 (tight 52 × 48), modes 74 × 68, back/pause/home
48–50, Journey nodes ≥ 56 × 84 (≥ 50 × 78 at 320). Tags and stickers are never interactive.

### 8.5 High contrast (`.sui.is-hc`)

`ui.ts` toggles `.is-hc` on the root when `settings.highContrast` is on **or**
`matchMedia('(prefers-contrast: more)')` matches (listen for changes). Today that setting only touches
the world's shadows; the UI now honours it too (no copy change). Under `.is-hc`:

- gloss caps, sparkles, rays, bursts, clouds, confetti and stripes are off (`display: none` /
  `background-image: none` on those layers);
- face gradients become flat faces (`background: var(--face)`), panels flat frames;
- borders and outlines 4 px; scrims .78; the sky becomes flat `--sky-2`;
- haloed text keeps its halo (it is already maximum contrast) but loses the drop;
- locked nodes and tray squares get a 45° hatch (`repeating-linear-gradient(45deg, rgba(42,27,69,.18) 0 3px, transparent 3px 7px)`);
- the canvas reads the same flag (`hc: boolean` in the renderer input, B5): no glow sprites, no
  bursts behind stamps and pops, 4 px plate outlines.

### 8.6 Forced colours (`@media (forced-colors: active)`, extends the existing block)

- all text: `-webkit-text-stroke: 0; text-shadow: none`;
- gradients and box-shadows fall away; borders stay (the kit uses real borders);
- `::before` gloss caps, `.burst`, confetti, clouds: `display: none`;
- bar fills: `forced-color-adjust: none; background: Highlight`;
- selected tab and checked segment: a 4 px `Highlight` border; toggle on: knob border `Highlight`;
- the locked badge keeps its glyph (`CanvasText`).

### 8.7 Other

- Reduced motion: §7. Large text: rem sizes (§4.1); hero labels drop a step before wrapping.
- Labels: icon-only buttons keep their `aria-label` (Map, Endless, Retry, Pause, Back, Home, Resume,
  "Claim the daily reward"). Ribbons are real headings or duplicate one. Star rows keep `role="img"`
  with their counts. The live region and focus order are unchanged; the Journey snake is CSS only.
- Decorative layers (rays, bursts, clouds, confetti, sparkles, tails, props, Nubs' pin, the logo's
  sun and shadow layers) are `aria-hidden` or pseudo-elements.

---

## 9. Canvas: HUD, cards, stamps, toasts, pops

Owner: B5. The HUD stays opaque so it reads over the normal and the "High-contrast shadows" world
palettes. **No `shadowBlur` anywhere** in the files B5 touches; glows are pre-rendered sprites.

### 9.1 `src/render/candy.ts` (new): palette and helpers

```ts
export const INK = '#2A1B45';
export const DISPLAY = "'Lilita One', 'Arial Rounded MT Bold', system-ui, sans-serif";
export const BODY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const displayFont = (px: number): string => `400 ${Math.round(px)}px ${DISPLAY}`;
export type Face = readonly [hi: string, face: string, lo: string, lip: string];
export const FACE = {
  green: ['#B4F25E', '#69D33B', '#43B226', '#2C8416'], blue: ['#8EDBFF', '#3FAEF7', '#2189E6', '#1660B4'],
  gold: ['#FFF07A', '#FFCB2B', '#FFA51C', '#CF6F00'], pink: ['#FFA3C0', '#FF6390', '#EE3D6E', '#AE2453'],
  violet: ['#D7B0FF', '#A26AF7', '#8550EC', '#5B2EB4'], red: ['#FF9A6E', '#FF6A45', '#F0472C', '#B0301A'],
  cloud: ['#FFFFFF', '#F4F1FB', '#DCD5EC', '#A99CC6'], ice: ['#E9F6FF', '#9ED8FF', '#4FA9EE', '#2D7FC8'],
} as const satisfies Record<string, Face>;
export const CREAM = '#FFF8E6', CREAM_2 = '#FFEDC2', CREAM_3 = '#EBC982';
export const SLOT_1 = '#3B2A5A', SLOT_2 = '#4E3B6C', SLOT_SUB = '#FFE58A';

/** White (or `fill`) text with an ink halo and a hard drop; set textAlign/baseline before calling. */
export function outlined(g: CanvasRenderingContext2D, t: string, x: number, y: number, px: number, fill = '#fff', maxW?: number): void {
  g.font = displayFont(px);
  g.lineJoin = 'round';
  g.lineWidth = px * 0.24;
  g.strokeStyle = INK;
  g.strokeText(t, x, y + px * 0.1, maxW);   // the drop
  g.strokeText(t, x, y, maxW);
  g.fillStyle = fill;
  g.fillText(t, x, y, maxW);
}
// candyRect(g, x, y, w, h, r, face, { lip, drop, line, gloss }): ink roundRect at +drop, face gradient,
//   lip band (clip to the shape, fillRect the bottom `lip` px with face[3]), top light, gloss cap
//   (skipped when gloss is false), ink stroke `line`.
// plate(g, x, y, w, h, r, k): white → cream gradient, a 4k CREAM_3 bottom band, ink 3k, ink drop 3k.
// slot(g, x, y, w, h, r, k): SLOT_1 → SLOT_2, an inset top shade, ink 2.5k.
// coin(g, cx, cy, r, face, k): radial face (hi 0-30 %, face 62 %, lo), a lip arc, ink 3k ring, ink drop 3k.
// burst(g, cx, cy, rx, ry, n, depth, fill, k): §6.18, ink copy at +4k, fill, ink 3.5k.
// starPath(): Path2D of §6.12, created on first use (never at module scope: unit tests run in node).
// starSprite(px, dpr, state: 'on' | 'off' | 'lost'): a cached Canvas2D per (px, dpr, state).
```

Rules: outlined text and candy shapes are drawn **only into cached layers or sprites** (the HUD row
layer, the card sprites, the stamp sprite, pop sprites), never freshly every frame, with one
exception: the pops, which stay per-frame `strokeText`/`fillText` as today (≤ 12 live pops).

### 9.2 Fonts in the render code

| Where | Before | After |
|---|---|---|
| `hud.ts` `FONT` | system 800 | `DISPLAY` at 400 (snow 20k, mult 19k, day badge 19k, clock 18k, chip 14k) |
| `banners.ts` `SERIF` italic titles, `SANS` small caps, `italic 900` stamps | | `DISPLAY` 400; blurbs and tip text stay `BODY` 700 |
| `particles.ts` `POP_FONT` | system 800 20 px | `displayFont(20)` (scaled per pop as today) |
| `meltMap.ts` labels (9 px, 13 px), `friend.ts` (11 px) | system 800 | `DISPLAY` at 11 / 14 / 12 px, white with an ink stroke of 0.3 em (world labels are the one place a sub-15 px halo is allowed: they sit on the busy world) |
| `sun.ts`, `casters.ts`, `decor.ts`, `postcard.ts` | | unchanged (world art and the shareable image are out of scope) |

`halo.ts` draws no text today; nothing to change there.

### 9.3 The HUD row (`hud.ts buildLayer`)

Reference layout at 390 × 844, k = `hudScale(v)` = 1, every x in CSS px, `top = safe.top + 8`,
`ROW_H = 48`, `cy = top + 24`. Everything below is drawn into the cached row layer as today.

| Part | Geometry (k = 1) | Look |
|---|---|---|
| Pause (DOM) | 48 × 48 at (8, top) | blue candy square (§6.2); `lx0 = 64` as today |
| Level medal | centre (lx0 + 23, cy), r 23 | gold medal (§6.6) via `coin()`; text "L6" / "D2" Lilita 19k outlined, 4 chars ("L200") at 16k; Endless forecast sticker: a 16k white disc with ink 2k at the medal's top-right holding the forecast glyph (as today) |
| Plate | from the medal centre to `plateR`, y cy ± 19 (h 38), r 14 | `plate()`: white → cream, 4 px `#EBC982` bottom band, ink 3, ink drop 3 (an offset ink roundRect behind) |
| Star pips (levels) | 3 pips of 17k, step 17k, from x0 = medal right + 6k (= 116) | `starSprite(17k, …)`: earned gold, open socket, lost slashed; the pop draws the earned sprite at 23k with a pre-rendered gold glow sprite under it |
| Clock (Endless) | at x0, width = the widest clock of the day (existing `widestClock`) | Lilita 18k **ink** on the plate (no halo) |
| Ruler | from the pips/clock + 6k to `plateR − 10k`, h 12k, r 6k | `slot()`; campaign fill green `#9BEA4F → #3FB52A` with a white gloss line; Endless keeps the dawn → noon → dusk gradient inside the same slot |
| Ruler markers | gate/eclipse midpoint, flares (teal parried, grey missed), Noon Heat 11–1 band, boss HP notches | unchanged semantics; ticks are 3k wide ink-outlined and extend 3k above and below the slot so they show around the head |
| Progress head | at the progress point | a **slim** white disc r 6k with a 2.5k ink ring (not the 26 px Nubs head: it hid the markers); the gust wind glyph still rides it |
| Finish flag | on a 2k ink post rising from the ruler's end to 9k above the plate's top | 14k × 10k checkered flag with an ink outline (inside `BAND_PAD`); PB flag gold, challenge flag teal, both ink-outlined |
| Goal / Snow slot | right end tucked under the multiplier coin at the coin's centre; h 34k, r 17k | `slot()`; value Lilita 20k white outlined; "/target" `SLOT_SUB` Lilita 15k; a met goal turns the value `#9BEA4F` (on the slot, 6.6–8.6:1) |
| Goal coin | centre (slotL + 2k, cy), 32k | the Snow gem (Snow pill) or the level's goal glyph on a white coin (ink 2.5k); `ICON_TIGHT` shrinks it to 24k, never drops it on levels |
| Multiplier coin | centre (rx1 − 22k, cy), r 22k (`rx1 = vx + vw − safe.right − 8`) | ×1 cloud coin with ink text; ×2–×4 violet coin (`#D7B0FF → #A26AF7 → #8550EC`, lip `#5B2EB4`) with white outlined "×3" Lilita 19k; ×5 gold coin + a pre-rendered gold glow sprite; the existing pop and shake |
| Flow Ring charge | an arc at r + 5k, 5k wide, round caps, around the multiplier coin | the existing colours (teal, gold as ×5's buffer, hot while it bleeds) and the trick flash |

**The ruler rule (binding).** The ruler carries the progress, the gate/eclipse, the flares, Noon Heat
and the boss HP, so it never gets shorter than today for the same state:

- `rulerW(new) ≥ rulerW(v1.6) − 2` for the same state at 390 and at 360 (measure both with
  `__SHADY_TEST__.hud().rulerW` before and after; put the table in the commit message);
- at 390 × 844 a level whose goal text is ≤ 3 characters ("0/1") gets ≥ 80 px;
- the floor stays `RULER_MIN = 48` (layout.spec, v16.spec).

The fitting ladder, in order, each step only while the ruler is short:
1. cosmetic, while `rulerW < 72`: medal r 23k → 19k; plate inner gaps 6k → 3k; goal coin overlap
   +4k;
2. information, while `rulerW < RULER_MIN` (today's ladder, unchanged order): a seconds goal drops
   its tenths; star pips close up to 14k; the goal glyph shrinks to `ICON_TIGHT` (never dropped on
   levels); Endless: the clock font 95 % → 90 %, then the Snow coin drops (`icon = false`), then the
   clock to 70 %.

`__SHADY_TEST__.hud()` keeps its fields and meanings (`rulerW = rulerX1 − rulerX0`, `icon = iconS > 0`,
`left`, `ruler`, `snow`, `stars`).

### 9.4 Frost meter (bottom-right)

An ice coin r 28k (`coin(…, FACE.ice)`) with an ink snowflake, its fill ring at r 34k, 6k wide (ice
blue on a slot-coloured track). Full: the gold glow sprite + the existing bobbing chevron. The Frost
Bank pips under it become two 18k ink-outlined coins. The base coin is a cached sprite; only the arc is
drawn per frame. Its centre moves inward by the extra radius (it stays clear of the edges and the home
bar: `METER_SIDE`/`METER_BOTTOM` grow by 10k); `hudMeterHit` uses the new radius + `METER_SLOP`.

### 9.5 Canvas toasts (`banners.ts drawToast`)

The DOM toast's look: a cream pill (`plate()`), min h 40k, r 20k; a 30k icon coin at the left (green
for missions, gold for trophies, cloud for tips) with the glyph in ink; the kicker Lilita 15k in its
colour (mission `#136E4E`, tip `#B5560A`, warning `#C9470F`, rose `#C62A55`); the text: Lilita 16k ink
for mission text, `BODY` 800 15k ink for tips (sentences); up to two lines (`toastWrapW` as today).
Each toast is rendered once into a sprite at show time; placement, queue and timing unchanged.
`__SHADY_TEST__.toasts()` still returns the same kicker and text strings.

### 9.6 Stamps (`showStamp` / `drawStamp`)

- A plate: `candyRect` r 18k, ink 4k, lip 6k, drop 5k; text Lilita 40k auto-fit as today, white with
  an 8k halo and a 4k drop.
- Behind it, a comic burst (§6.18), elliptical so long texts work: rx = plateW/2 + 18k,
  ry = plateH/2 + 22k, n = 14, depth .2.
- An optional sub-plate: an ink pill holding `SLOT_SUB` Lilita 15k (e.g. "×3 · +12 Snow").
- By kind: `noon` red plate + gold burst; `teal` (PASSED SAM!) green plate + white burst; `gold`
  (PAST YOUR RECENT BEST) gold plate + white burst; `finish` cream plate with the checkered bands (as
  today) + gold burst, stars popping underneath; `miss` pink plate, no burst; `frost` (PARRY!) blue
  plate + ice burst.
- Tilt −4° to −6° (as today). The whole stamp is rendered once into a sprite at `showStamp` (and on
  resize or font load); per frame it is one `drawImage` with translate, rotate, scale and alpha.
- `.is-hc` / `hc`: no burst.

### 9.7 Level intro card (`levelCard`)

Rendered once into an offscreen sprite at the device pixel ratio (≤ 2) when shown, on resize and when
the font loads; per frame: the slide (existing) + one `drawImage` + the start pill's pulse.

Content, top to bottom (k = the HUD scale; width `min(vw − 32, 352k)` as today):
1. **Frame:** a blue panel (ink 4k, frame band 8k, inner ink 3k, cream inner r 20k).
2. **Ribbon:** green, straddling the top edge (22k above it), the kicker words as given ("LEVEL 6"),
   Lilita 26k outlined, tails as in §6.4.
3. **Title:** Lilita 32k ink, auto-fit to the inner width (existing logic).
4. **Concept chip:** a light-blue pill (`#E9F6FF → #BFE6FF`, ink 2.5k, h 32k), a 22k white coin with
   the concept glyph, the concept name Lilita 15k `#124A86` (6.8:1).
5. **Blurb:** `BODY` 700 15k `--ink-2`, centred, ≤ 3 lines (existing wrap and ellipsis).
6. **Goal chip:** `--tint-green` pill, ink 2.5k, h 28k, the goal glyph, the goal text Lilita 15k
   `#136E4E` (5.6:1). Wording unchanged.
7. **Dare chip** (when there is a Dare): `--tint-gold` pill, ink 2.5k, h 28k, a pink DARE sticker
   (Lilita 13k white on `#B8285A`), then the Dare text Lilita 15k `#8A4B00`; when the text starts with
   "Dare · " the sticker replaces that prefix. Wording otherwise unchanged; it keeps its own row (it is
   not merged into a star well).
8. **Star wells:** three wells (`CREAM_2`, r 14k, inset), h 60k: a 28k star sprite at the top
   centre, the rule's glyph 16k at the star's lower-right, the rule label (`BODY` 800 13.5k ink,
   one line, shrink to 12k then ellipsis). Labels as given ("Finish", "6 flakes", "≤ 3.7 s in sun").
9. **Start pill:** a gold candy pill hanging off the frame's bottom edge (its centre on the edge),
   h 40k, width = text + 64k, a white 24k drag coin (ink 2.5k, a ↔ drawn as two chevrons) at its
   left, "TAP OR DRAG TO START" Lilita 17k white outlined. It pulses its alpha .75 ↔ 1 over 1.4 s
   (static under reduced motion). The floating hint line is gone.

**Fit.** The card must stay between the HUD band (+ 8 + the ribbon's 22k) and the dial's top (− 8 −
the pill's 20k), as today's placement rule. While it is too tall, in order: blurb to 2 lines; star
wells to 46k (star 22k, no glyph); goal and Dare chips side by side when both fit, else the goal chip
goes (the first well says the goal); blurb hidden; concept chip hidden; finally scale the sprite down
(not below .8). The ghost hand and "‹ drag ›" below it keep their behaviour; "drag" is Lilita 22
outlined.

### 9.8 Day and night cards

- **Day card:** a ribbon (green for Meadow, red `#FF6A45` family for Old Town) with "DAY 2" Lilita
  34k outlined, over a plate line "MEADOW · Heat Wave · NOON 72°" (Lilita 15k ink, with the biome
  glyph) and the Noon Heat line under it when present. The five slow rays behind become warm white.
  Slide timing unchanged. Rendered once into a sprite per show.
- **Night card:** a violet ribbon "NIGHT" + a plate "Day 2 survived" with the crescent; same timing.

### 9.9 Pops (`particles.ts`)

Font `displayFont(20)` scaled per pop (as today), stroke **ink** for every style at
`lineWidth = 0.25 × 20 = 5` (as today), fills: PHEW!/SWING! white, GO/MULT gold `#FFE27A`, BANG red
`#FF6A45`, DEEP/SNAP ice `#EAF7FF`, "+n" Snow white. Headline pops (PHEW!, SWING!, COLD SNAP!) get a
small burst sprite behind them (pre-rendered once per style: SWING gold, PHEW green, SNAP ice;
n 12, depth .2, sized to the text), drawn with the pop's alpha; none under `hc`. Curves, clamping
and merging stay.

### 9.10 Performance rules for the canvas

- The row layer is still rebuilt only when its key changes (≈ every 0.7 s); the candy shapes cost
  only then.
- Per-frame work stays: blit the layer, the progress fill and head sprites, the multiplier coin
  sprite (with its pop/shake transform), the Flow Ring arc, the frost meter arc, cached card, stamp
  and toast sprites, and the pops.
- Sprites are keyed by (size, dpr, state) and dropped on resize, font load and `hc` change.
- No `shadowBlur`, no `filter`, no per-frame gradients created (cache `CanvasGradient`s with the
  sprite).

---

## 10. Screens

Every e2e hook in §11 survives. "Unchanged" means the behaviour and DOM are as today; only CSS and
the listed elements change.

### 10.1 Title (B2)

Reference: `candy-title.png`, with three changes: the tray is neutral, the goal is Nubs' speech
bubble, and the Endless/Map squares are the only colour beside Play.

**Top bar** (`.title-hud`, y = in-top + 10):
- **Rank badge** (`gamify.ts rankBadge`, `.title-rank`): a 54 px gold medal with the rank number and
  a name plate ("SUN RANK" kicker, "Icicle" Lilita `--fs-d-lg` ink, a 7 px `bar--sm` violet XP bar).
  The old conic ring becomes the mini bar. The claim count is a bubble on the medal.
- **Reward** (`.title-reward`): the gold square of §6.2 with its static burst and a dot bubble.
- **Wallet** (`.chip--snow`): the counter (§6.5), right-aligned.

**Logo** (`art.ts logoLayers`, the `LogoLayers` interface and `session.ts`'s use of it unchanged):
the `word` layer becomes four stacked `<text>` layers in Lilita One (viewBox 360 × 172 unchanged):
1. an ink silhouette, stroke 15, at y, y + 6 and y + 12 (the extrusion's outline);
2. an orange extrusion `#F07E14`, stroke 4, at y + 3 and y + 7;
3. the face: a gradient `#FFFFFF → #FFF7CF (46 %) → #FFE15A (50 %) → #FFB01E`, ink stroke 4;
4. per-letter `rotate="-7 4 -3 5 -4"`.
The sun keeps its position and its bob/spin layers; two ink-outlined sparkles are added to the
`word` layer. The swaying `shadow` layer stays (the logo casts a shadow that moves with the Title's
sun: keep that, it is pure SHADY), recoloured `#5A4A78` at .32. The CSS `filter: drop-shadow` on
`.logo` goes. Width `min(cw × 0.86, 340px)` (`is-compact`: `min(cw × 0.56, 220px)` as today).

**Tagline** (`.tagline`, DOM unchanged; its text is set by `refresh()`):
- **Not a goal** ("Don't melt Nubs."): a small blue ribbon (§6.4 small; the `<p>` is the band, its
  tails are siblings in a wrapper) overlapping the logo's bottom by 14 px.
- **A goal** (`.is-goal`, "So close: …"): **Nubs' speech bubble.** White face, 3 px ink, r 20, a
  tail at the bottom centre pointing down at Nubs (a 16 × 14 triangle, ink-outlined), body 800
  `--fs-sm` ink text with the missions art icon (32 px) at its left, max-width 300. It is positioned
  absolutely so its tail tip sits at `--nubs-y − --halo-r − 6px`, centred on the column. `fit()`
  computes and sets its top (`--goal-top`) every time it runs; when the bubble would come within 8 px
  of the last visible `.title-top` item (the forecast chip, the key line, the challenge banner), `fit()`
  adds `.goal-inline` and the bubble returns to the flow under the logo as a plate without a tail. The
  challenge ladder (`no-tagline` first while a goal shows) is unchanged. `meta.spec`'s
  "tagline, forecast, banner and chips apart" must hold at every size.

**Forecast chip** (`.forecast-chip`): a dark chip (§6.7), body-font emoji in a `.glyph` span, the
words in Lilita. **Key line** (`.title-keys`): a dark chip in the body font (it holds ← →), text
unchanged.

**Challenge banner** (`.challenge`): a panel (§6.3) with a small pink ribbon "CHALLENGE!"
(`aria-hidden`; the group's `aria-label` "Challenge" stays), the goal in Lilita `--fs-d-lg` ink, the
note in body, the Play button green M, the close coin of §6.2.

**Bottom cluster** (`.title-bottom`; `fit()`'s ladder and the `--nubs-y + --halo-r` clearance are
unchanged):
- **Chips row** (`.chips`): the Best chip (`.chip--btn`) and the missions chip as dark chips.
- **Modes** (`.modes`):
  - Map (`.journey-pill`): a blue `btn--sq` 74 × 68 with the art map icon (38 px) and its `.num` as a
    tag hanging under it, reading `71★` (the ★ in a body-font `.glyph` span, gold `--gold-lo` with a
    2 px ink stroke) or "Map". Its text must stay `N★` (journey.spec).
  - Play (`.play-pill`): `btn--primary btn--xl`, width 204 (min 168 in narrow columns), the art play
    icon in a 40 px white coin, the label "Level 38" with the generated "PLAY" kicker above it (§6.1).
    Its idle motion is the shine sweep (never a scale: `fit()` measures it).
  - Endless (`.endless-pill`): a violet `btn--sq` 74 × 68, the art endless icon, its "Endless" label
    as a tag under it (icon only in narrow columns, as today); locked → `f-locked` + lock badge; NEW →
    sticker.
- **Tray** (`.tray`): four `.tray-disc` squares 62 × 56, **all cloud** (`candy f-cloud`), each with
  its **coloured art icon** 38 px (daily, missions, wardrobe, settings); the labels (`.tray-label`)
  Lilita 15 px fixed, white outlined, overlapping the square's bottom by 8 px. Dots, locks and NEW
  tags as §6.7. Narrow columns: modes squares 64, tray squares 56; `is-tight`: tray 52 × 48, modes
  58 × 56, Play h 64.
- The Title top/bottom shades of §6.16.

### 10.2 Journey (B3)

Reference: `candy-journey.png` plus the storybook graft (the road is the world's dirt road; props
and nodes cast the game's purple shade).

- **Backdrop:** the warm sky (§6.16).
- **Header** (`menuHeader`): the blue back coin, a red ribbon "Journey" **left-aligned after the
  back coin** at widths under 430 (centred above), the star counter `71/600` (`.chip--stars` with the
  `/600` as `<small>`).
- **Sticky** (`.journey-sticky`): Continue (`.journey-continue`, green L, block, text exactly
  "Continue · Level N"), then the star road (`.road`) as a plate: an ice medal (48) holding the item
  swatch overlapping the plate's left end, the name (Lilita `--fs-d-md` ink) + " at 75 stars" (body
  800 `--fs-sm` `--t-amber`), `.road-count` (Lilita `--fs-d-md` `--t-amber`) at the right, a gold
  `bar` of 16 px under them.
- **Chapter board** (`section.card.chapter[data-biome]`): a panel framed in its biome colour
  (§6.3; locked → lavender). `overflow: visible` (the banner clips itself).
  - **Head** (`.chapter-banner`, transparent now, on the frame): the biome disc (`.chapter-biome`,
    44 px cream coin, ink 3, the biome icon in ink), the kicker "CHAPTER 4" (Lilita `--fs-d-xs`,
    **ink**, no halo: 7.7:1 on meadow, 5.6:1 on old town, 6.2:1 on locked; white would fail), the
    name (`.chapter-name`, Lilita `--fs-d-lg` white
    outlined, `nowrap` + ellipsis), the prize globe (`.chapter-prize`, 44 px art globe, its
    aria-label and `.is-complete` check unchanged) with a tag "★ 13/30" hanging under it: that tag is
    `.chapter-meta` repositioned (its `.chapter-count` text unchanged; the meta row's bar is hidden,
    the count says the same).
  - **Body** (`.lvl-grid`): a well whose background is the biome ground (meadow
    `--meadow-ground → --meadow-ground-2`, old town `--oldtown-ground → --oldtown-ground-2`, locked
    `--lockboard-ground`) with a faint dot texture
    (`radial-gradient(rgba(42,27,69,.06) 1.2px, transparent 1.6px) 0 0 / 14px 14px`), padding
    `8px 8px 10px` (`6px 4px 8px` under 360 px), the ten nodes, the road and the snake (§6.13).
  - **Props** (graft): `.chapter::after`, a 100 % × 34 px strip at the board's bottom edge
    (`bottom: -16px`) with two props from one data-URI SVG per biome — meadow: a round tree and a bush;
    old town: a red-roof house and a lamp post — each with its purple shade baked in (an ellipse
    `#5A4A78` at .32 offset +5, +3), 28–34 px tall, at the left and right corners. Locked boards: the
    same props desaturated. Boards are spaced 22 px apart so the props stand in the gap.
  - **Locked chapter:** a cream plate "Finish Level 40" with a lock badge across the middle of the
    board (`aria-hidden`; each locked tile still says "Locked" in its label).
- **The finale's crown** is the sun mascot (§6.13).
- **Arrow keys** (journey.ts, B3): replace `{ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 }`
  with screen geometry. For level n: chapter `c = ⌊(n−1)/10⌋`, index `i = (n−1) % 10`, row
  `r = ⌊i/5⌋`, column `col = r === 0 ? i % 5 : 4 − i % 5`, visual row `R = 2c + r`. Left/Right:
  `col ∓ 1` in the same visual row (no move at the ends). Up/Down: `R ∓ 1`, same `col`. Map (R, col)
  back to n. The test `journey.spec.ts` "arrow keys walk the tiles…" changes **one** expectation at its
  cause: from Level 2, ArrowDown lands on Level **9** (directly below it on screen), not 7; the rest of
  the walk (Down → 12, Left → 11) already holds. Do not weaken any other assertion.
- **Centring** on every visit and the `.is-fresh` / `.is-unlocked` pops are unchanged; do not add
  `content-visibility` (it would shift the centring measure).

### 10.3 Results (B4)

Reference: `candy-results-win.png`, the storybook `win.png` grafts (goal cards, loot tiles, the
two-line Next) and the sticker rule that the celebration lives in the map band.

**Structure** (DOM additions marked new):

```
section.scr-results
  .res-map                        unchanged (+ the radial scrim, §6.16)
  .res-sheet  (panel, blue)       unchanged role/label; height rules unchanged
    .res-hero          (new)      position:absolute; bottom: calc(100% − 26px); left:0; right:0;
                                  pointer-events:none; holds .burst (rays), confetti <i>s,
                                  .res-stars (moved here from h2.res-level; role="img" kept),
                                  .res-ribbon (moved here; aria-hidden; the ribbon band)
    .res-body
      .res-top        .res-head (kicker, Share, Home), .res-score, h2.res-level (name only now),
                      .strip, .res-goal, xp, death, tip, pace, note, verdict, road
      .res-scroll     .res-goals (new, campaign only), .res-warmup, .res-awards, .res-stats, .res-missions
    .res-actions      Next, Retry, Map
```

- **The hero sits in the map band above the sheet**, so `resultsSheetTop()` and the Melt Map framing
  keep their meaning and the sheet's height rules (68 % / 82 % caps, the scroll split, the 360 × 640
  Retry and stats specs) are unchanged. When a ribbon shows, `.res-top` gets `padding-top: 30px` for
  the ribbon's lower half (today's new-best ribbon already adds 16 px; on levels the visually hidden
  kicker row gives most of it back).
- **Hero size** follows the room: `results.ts measure()` sets `--hero-scale` on the sheet to
  `clamp(0.4, (room − 30) / 124, 1)` where `room = sheetTop − (in-top + 8)`; the star row scales by it
  (92 / 124 / 92 at 1), the ribbon does not. Under 0.55 the rays and confetti are hidden.
- **Ribbon text** (`.res-ribbon`): a passed level "Level 38 Passed!" (red); a failed level "So close!"
  (blue); an endless, Daily or challenge run with a new best "New best!" (or "New eased best!") (red);
  otherwise no ribbon. On a level the kicker (`.res-kicker`, "Level 38 · Passed") becomes visually
  hidden (`sr-only`), the ribbon carries it visually; elsewhere the kicker stays as a dark chip at the
  head's left.
- **Stars:** passed: earned stars lit as today (`c.passed ? c.stars : 0`), slammed (§7); failed: three
  sockets.
- **Level name** (`.res-level-name`): Lilita `--fs-d-2xl` ink. **Goal line** (`.res-goal`): body 800
  `--fs-sm`, `--t-green` on a pass, ink otherwise (as today).
- **Goal cards** (new `.res-goals > .res-goal-card`, `.is-met` on a met rule; levels only, first in
  `.res-scroll`): three plates side by side,
  each with a 26 px star (earned/socket by the rule's bit), the rule label (body 800 13 ink, one line),
  and a green check sticker (20 px `f-green` coin, ink 2.5, white check) on the rules met. Data:
  `ResultsCampaign` gains optional `starRules?: readonly [string, string, string]` and
  `starBits?: number`, filled in `session.ts campaignView` from `game/campaign.ts starRules(level,
  relaxed)` and `starState(level, result.stats, passed, relaxed, featSeen)` (bit 1 goal, bit 2 flakes
  or Dare, bit 4 = cool run *lost*). Absent fields → no goal cards (the lab supplies them).
- **Loot tiles** (`.res-stats .stat`, restyled; DOM unchanged): plates, r 16, with the icon in a 34 px
  coin straddling the top edge, the value Lilita `--fs-d-lg` ink, the caption body 800 13 `--ink-2`.
  The Snow tile is a blue candy plate with the value white outlined and an ink caption. A tile with a
  new best wears the BEST sticker. Grid rules (4 columns, `data-n=6` → 3 × 2, narrow → 2 per row)
  unchanged.
- **Awards** (`.res-awards .award`): cream chips with a 26 px coin (gold for trophies, pink for
  cosmetics, green for "missions done") and Lilita `--fs-d-sm` ink; **all chips stay** (no cap, no
  expand interaction; they scroll as today). `.is-in` pops unchanged.
- **XP** (`gamify.ts xpMeter`): a 52 px gold medal, the violet `bar` with its label "368 / 450 XP"
  (15 px), the `.bar-gain` segment, the "+125 XP" violet burst tag; "Rank 9: +55 Snow" in `--t-blue`.
  A pink RANK UP! sticker only at the existing rank-up moment, never otherwise.
- **Star road** (`.road`): as on the Journey (§10.2) inside a well.
- **Missions** (`.res-missions .mrow`): plates with a green check coin when done; the COMPLETE stamp
  (`.stamp--sm`) is a green plate, white outlined Lilita, rotated −6°; Swap is a cloud `btn--sm`.
- **Actions** (`.res-actions`):
  - a passed level: Retry (`.res-retry`) blue `btn--sq` 66 with its "Retry" tag, **Next level**
    (`.res-next`) green XL, `nowrap`, label "Next level" with the generated sub-line `LEVEL 39`
    (`data-sub`), Map (`.res-mapbtn`) blue `btn--sq` 66 with its tag; the accessible names keep
    starting "Retry", "Next level", "Map";
  - a failed level: Retry green XL ("Retry" text unchanged), Map blue square;
  - endless/Daily/challenge: Retry green XL (its label unchanged: "Retry", "Retry · practice",
    "Take the challenge"); Home round cloud 50 and Share pink sm stay in `.res-head-actions` inside the
    sheet (layout.spec selects them there);
  - the arming sweep (`.res-arm::after`) stays.
- **The postcard pill** (`.res-postcard`): a cloud `btn--sm` with the tilted thumbnail; unchanged
  behaviour.
- **Endless sheet:** `.res-time` (the score heading, `aria-describedby` target) Lilita
  `--fs-d-hero` ink with the day badge as a violet chip; the Sun Strip unchanged except tile radii
  and an ink 1.5 px outline per tile.

**Reward reveal** (`.rv`, `gamify.ts`, B4): the snow globe stays. The stage: `--scrim-rv`; the rays
`.rv-rays` become a `.burst` (static under reduced motion); the kicker (`.rv-kicker`) is a red small
ribbon; the prize card (`.rv-frame`) a panel framed by rarity (common cloud, rare blue, epic violet,
legendary gold) with the rarity word as a tag; the name (`.rv-name`) Lilita `--fs-d-2xl` white
outlined; the sub-line body 800 15 `--slot-off`; Collect (`.rv-next`) green XL; `.rv-count`
unchanged.

### 10.4 Dying (B2)

The canvas plays the death beat. The DOM adds one `aria-hidden` dark chip "Tap to skip" (Lilita
`--fs-d-sm` white outlined) at the bottom centre (`bottom: calc(var(--in-bottom) + 24px)`), fading in
after 500 ms (static at once under reduced motion). The catcher, its label and its timing are
unchanged.

### 10.5 Pause (B2)

Reference: `candy-pause-modal.png` without the close coin, plus the storybook dozing Nubs.
- The modal recipe (§6.15): blue panel, blue ribbon "Paused" (the `h2.dialog-title`).
- `.pause-badge` (aria-hidden) becomes **Nubs dozing** above the ribbon: the art `nubs` head
  (48 px) with closed eyes (a variant of the symbol) and a "z Z" in Lilita 18 white outlined drifting
  up 6 px over 2.4 s (static under reduced motion).
- `.dialog-sub` ("Nubs is chilling. Take your time.") in a well, body 800 `--fs-md` ink.
- `.pause-status` in a well: the title Lilita `--fs-d-md` ink, the goal body 800, the stars as art
  stars 18 px (earned / socket / lost) with their labels. The `.pause-star` items keep their
  aria-labels.
- Resume green L block, Restart blue M block, Settings and Home cloud M in the `.row-2`.
- The scrim is `--scrim`. The small-phone compaction rules stay (they hide the sub and tighten).

### 10.6 Daily (B2)

- Sky backdrop; header ribbon "Daily".
- **Hero** (`.daily-hero`): a gold panel; the sun mascot (art.ts face) on a gold medal 72 px; the kicker
  "DAILY SOLSTICE" Lilita `--fs-d-xs` `--ink-2`; "Daily #293" (`.daily-num`) Lilita `--fs-d-hero` ink;
  the plan chip (`.daily-plan`, text unchanged incl. the emoji in a `.glyph` span) as a cream chip; the
  date and blurb in body; the tries as three snowflake pips (`.try-pips`: unused = ice coin with a
  flake, used = socket) beside "0/3 used"; Best today in a well; Snowbot's par line in body with the
  bolt icon; **Play** green XL ("Play · try 1/3" unchanged).
- **Recent days** (`.daily-list`): a blue panel; rows as plates; today's row a gold-tint plate; the
  strip emoji unchanged.

### 10.7 Settings (B1)

Reference: `candy-settings-tabs-toggles.png` for the rows and controls, **without tabs** (scope cut:
tabs would change the DOM and the specs). Sky backdrop; header ribbon "Settings"; each section is a
blue panel with its `card-title` in ink; rows with the 46 px coloured icon tile (§6.17), the label
Lilita `--fs-d-md` ink, hints body 700 `--fs-sm` `--ink-2`; sliders and toggles per §6.10–6.11; the
segmented controls per §6.9; the name input as a well (r 14, 3 px ink, Lilita `--fs-d-md`); export,
restore buttons cloud block; Reset red; the backup code box a well in a monospace body font; the
version line and the font credit (§2.1) at the end in `--ink-2` on the sand end of the sky (6.7:1).

### 10.8 Wardrobe (B3)

- Sky backdrop; header ribbon "Wardrobe" + the wallet counter.
- **Stage** (`.stage.card`): a blue panel with a radial spotlight in the preview area
  (`radial-gradient(circle at 50% 40%, #fff, var(--tint-blue) 70%)` on `.stage-spot`, a 3 px ink ring);
  the item name Lilita `--fs-d-xl` ink; the rarity (`.rarity`) as a tag in the rarity colour (common
  cloud, rare blue, epic violet, legendary gold; ink text); the note body; the action: **Wear** green
  L, **Buy** gold L with the price as a mini counter inside, **Wearing** a disabled-look cloud L with a
  small green ribbon "Wearing" over it (state in words).
- **Collection** (`.collection`): Lilita label, count, a gold `bar`.
- **Tabs:** folder tabs (§6.9) joined to the grid's panel.
- **Item tiles** (`.tile[data-id]`): mini panels framed in the rarity colour (frame 5 px instead of
  8), the art swatch on a light disc, the name Lilita `--fs-d-sm` ink, the status: price as a mini
  counter (snow coin 26 + Lilita 16), "Owned" body 800, "✓ Wearing" a green tag, locked a lock badge +
  the unlock words; the selected tile gets a 4 px `--green` ring outside its frame; NEW as a sticker.

### 10.9 Missions (B3)

- Sky backdrop; header ribbon "Missions" + the Trophies link (cloud `btn--sm`).
- **Streak card** (`gamify.ts` streak card, `.streak-day`): seven tiles: claimed = green candy plate
  with a check; today = gold candy plate, glowing (a static gold glow ring), raised 4 px; future =
  cream plate; day 7 = violet plate with the globe art. Claim = green L with the gift art icon.
- **Mission cards** (`.mcard`): plates with the label Lilita `--fs-d-md` ink, the hint body, a green
  `bar`, the reward as a cream chip with the snow coin, COMPLETE as the green stamp plate rotated −6°,
  Swap a cloud `btn--sm`.
- **Globe row** (the progress to the next Snow Globe): an ice well with the globe art and three
  pips (green coin = done, socket = not).

### 10.10 Profile (B3)

- Sky backdrop; header ribbon "Profile".
- **Hero** (`.pf-hero`): a violet panel; an 80 px gold medal with the rank; the plate with "SUN RANK 8"
  kicker and "Icicle"; the violet XP `bar` with its label; the globe line in body.
- **Rank road** (`.pf-road`): the level-node recipe at 48 px in a straight road (no snake): done =
  green with a check, current = gold and larger, future = cream; the reward under each as a small
  chip (snow coin + "+55", or the globe art).
- **Streak** card as in Missions.
- **Trophies** (`.badges .badge`): medal cards: a plate with a 56 px medal in its tier (bronze,
  silver, gold per §6.6) holding the trophy glyph, the name Lilita `--fs-d-md` ink, the description
  body; locked = socket medal + progress bar; `.badge.is-on` unchanged; "2 new" = sticker.
- **Records** (the bests, the 30-run chart `.jbar`, totals): a blue panel; bars keep their colours by
  day reached, with a 1.5 px ink outline; cells (`.cell`) as wells.

### 10.11 In-play DOM (B5)

- `.pause-btn`: §6.2. `.muted-ind`: a 36 px cloud coin with the mute line icon in ink.
- `.cue` (the line above Nubs): a dark chip (slot gradient, 3 px ink, r 20), Lilita 18 white outlined,
  the arrows and key names in body-font `.glyph` spans; position and timing unchanged.
- Ghost hand: the existing white glove art; the word "drag" Lilita 22 white outlined; the key chip for
  keyboard players a cloud candy square with the arrow in body font.

### 10.12 Overlays (B1)

Confirm dialog, install/restore sheet: §6.15. Rotate overlay (`.rotate`): the warm sky, a cream panel
(`.rotate-card`) holding the phone art (an ink-outlined blue candy phone with Nubs on a sky screen,
turning upright), the title Lilita `--fs-d-xl` white outlined, the sub body 800 ink. Toast stack: §6.14.

### 10.13 HUD, level intro card, toasts

See §9.3–§9.9.

---

## 11. The e2e contract

### 11.1 Hooks that must survive (class, attribute, text)

`.sui`, `#ui[data-screen]`, `.scr-*`, `.is-on`, `.tray`, `.tray button[aria-label=…]`, `.tray-label`
boxes apart, `.title-keys` text, `.title-bottom > *`, `.chips`, `.modes`, `.play-pill` text exactly
"Level N", `.journey-pill` text "N★" or "Map", `.endless-pill`, `.tagline`, `.forecast-chip`,
`.challenge*`, `.lvl-tile[data-level]` with `.is-locked` / `.is-next` / `.is-done` / `.is-perfect`, the
tile ≥ 48 × 48 and the level in play centred within 40 px, `.lvl-star.is-on`, `.lvl-concept`,
`.chapter`, `.chapter-prize[aria-label]`, `.journey-continue` text "Continue · Level N",
`.res-sheet`, `.res-retry` (accessible name starting "Retry"), `.res-next`, `.res-sheet
button[aria-label="Share"]`, `.res-sheet button[aria-label="Home"]`, `.res-stats`, `.res-scroll`,
`.res-body`, `.res-score`, `.res-awards .award(.is-in)`, `.res-warmup`, `.res-verdict`, `.res-pace`,
`.res-postcard-img`, `.rv`, `.rv-kicker`, `.rv-count`, `.rv-name`, `.chip--stars`, `.chip--snow`
(`.num`), `.streak-day`, `.toast`, `.dialog`, `.scr-pause .dialog`, a single button named "Resume",
`[role="switch"][aria-label=…]`, `.mrow`, `[data-id]`, `.badge.is-on`, `.jbar`, `.daily-plan` text,
`.daily-par`, `.cue[aria-live]`, `button[aria-label="Pause"]`, `.rotate.is-on`, the canvas test hook
`__SHADY_TEST__.hud()` fields and `toasts()` strings.

### 11.2 Allowed spec changes (at their cause, never weaker)

- `tests/e2e/journey.spec.ts`, "arrow keys walk the tiles": ArrowDown from Level 2 lands on Level 9
  (the screen-geometry walk of §10.2). Nothing else changes in that test.
- Any other spec that fails must be fixed in the code, not the spec, unless this document names it
  here. A builder who believes a spec must change asks the integrator first and records why.

### 11.3 New hooks (for new tests)

`.res-hero`, `.res-goals` (`.res-goal-card.is-met`), `.res-ribbon` text, `.sui.is-hc`,
`.switch::after` content (read with `getComputedStyle`), `.tagline.is-goal.goal-inline`, `--hero-scale`.

### 11.4 New visible strings

"PLAY" (generated), "LEVEL N" sub-line on Next (generated), "Level N Passed!", "So close!",
"New best!", "New eased best!", "CHALLENGE!", "Tap to skip", "z Z", "ON", "OFF", "DARE" (canvas
sticker), "BEST", "RANK UP!", "Finish Level N" (locked board plate), the font credit. Everything else
keeps its words.

---

## 12. Performance (60 fps on a mid phone)

- Static paint everywhere; compositor-only animation on at most four elements per screen (§7).
- No `backdrop-filter`. No CSS `filter` on icons, the logo or animated elements (remove the existing
  ones on the logo and the stars).
- Opaque slots and plates (no alpha over the canvas) keep HUD compositing cheap; the HUD's per-frame
  cost does not grow (§9.10).
- Text halos use `-webkit-text-stroke`, never multi-direction `text-shadow` outlines (8× the paint).
- The Journey: 20 boards of CSS-only roads (no SVG per board, no JS layout).
- Measure: `npm run e2e` perf specs as today, plus a 10 s DevTools trace at 4× CPU throttle on the
  Title, the Journey (scrolling) and a level with stamps: no long frames attributable to UI paint.

---

## 13. Size budget (`npm run build:single`)

**Budget for this rework: 730 KiB** (747,520 B). Today: 682,336 B (666.3 KiB). Headroom: 63.7 KiB.
`docs/V1_6_PLAN.md` A3 (670 KiB) is superseded for the UI v2 release by this number; the integrator
records the amendment there when the rework lands.

| Owner | Allowance | Mostly |
|---|---|---|
| B1 Kit | +24 KiB | the font as base64 (+13.9), `kit.css` net of the deleted rules (+5), art icons (+5) |
| B2 Title, Pause, Daily, Dying | +3 KiB | logo layers, bubble, CSS |
| B3 Journey, Profile, Missions, Wardrobe | +4 KiB | board/road/props CSS, prop SVGs (≤ 1.6 KiB), arrow keys |
| B4 Results, reveal | +3 KiB | hero, goal cards, CSS |
| B5 Canvas | +5 KiB | `candy.ts`, HUD, cards, stamps |
| Reserve | ~25 KiB | integration, fixes |

Every builder runs `npm run build:single` before handing work to the integrator and states the size in
the commit message. Over allowance → cut decoration first (confetti, cloud variants, prop variety),
never accessibility.

**Measured at the merge of the four screen branches** (bytes on disk): the kit landed at 729,406 B
(712.3 KiB, not the ~690 planned; `candy.ts` was not in it yet, as nothing imported it), the screens
added Title + Journey +12.9, Results + overlays +7.5, menus +5.8 and canvas +11.8 KiB, and the merged
build was 767,543 B. The integrator took back 5,075 B with no visual change (CSS target at the first
browsers with container queries and `:has()`, see `vite.config.ts`; dead rules and recipe variants no
screen uses): **762,468 B (744.6 KiB), 14.6 KiB over.** What is left is shipped look, spread thin (the
largest single decorations are 0.3-1.5 KiB each), so meeting 730 KiB means cutting decoration across
every screen or amending this budget; that call is the lead's.

---

## 14. Work split (five builders)

| Builder | Owns (files and CSS sections) | Starts |
|---|---|---|
| **B1 Kit** | `src/ui/fonts.ts`, `src/ui/kit.css` (new), `src/ui/art-icons.ts` (new), `widgets.ts`, `icons.ts` (no new icons unless a screen needs one), `overlays.ts`, `ui.ts` (`is-hc`, `no-po`, relayout on fonts, kit import), `main.ts` (splash race), `lab.ts` (`&hc=1`; awaits `fontsReady` before its first render), the generic sections of `ui.css` (resets, focus, buttons, chips/bars/rewards/stamps, menus and headers, settings rows, segmented/tabs base, toasts, modals, rotate, reduced motion, forced colours), `gamify.css` claim dots, Settings (`screens/settings.ts` + its CSS), `src/ui/README.md` §7 | **Phase 0 first**: tokens, face classes, `.btn`, `.candy`, panel, ribbon + `ribbon()`, counter, medal, chip/tag/bubble/sticker, bar, art-icon sprite. Land it as one commit within the first working block, then the rest. |
| **B2 Title & co.** | `screens/title.ts`, `art.ts` (logo word only), `gamify.ts rankBadge` + its CSS, the Title section of `ui.css` (and the Title rules in the Journey section), `screens/pause.ts`, `screens/dying.ts`, `screens/daily.ts` + their CSS | after Phase 0 (structure work may start at once) |
| **B3 Map & menus** | `screens/journey.ts` (+ arrow keys, + `tests/e2e/journey.spec.ts` §11.2), the Journey CSS, `screens/profile.ts`, `screens/missions.ts`, `screens/wardrobe.ts`, `gamify.ts` streak card + Profile/Missions sections of `gamify.css` | after Phase 0 |
| **B4 Results** | `screens/results.ts`, the Results CSS, `gamify.ts xpMeter` + reveal (`.rv`) + their CSS, `types.ts` (`starRules`, `starBits`), `session.ts campaignView` (those two fields only), the lab's results variants | after Phase 0 |
| **B5 Canvas & play** | `src/render/candy.ts` (new), `hud.ts`, `banners.ts`, `particles.ts`, the text in `meltMap.ts` / `friend.ts`, `renderer.ts invalidateFonts` + the `hc` input, `session.ts` (the `fontsReady` → `invalidateFonts` line and the `hc` flag only), `game/debug.ts` if a hook field needs it, `screens/play.ts` + the Play/cue/ghost CSS | at once (independent of Phase 0 except the font name) |

Rules for working in parallel:
- One owner per file section. A change needed in someone else's section goes to its owner (or is
  agreed in a one-line note in the commit). `session.ts` has two owners for two separate one-line
  hooks (B4's `campaignView` fields, B5's font/hc wiring).
- Compose kit recipes; never copy their CSS into a screen section. Missing variant → add it to
  `kit.css` (B1 reviews).
- House rules: never push, never open PRs, small coherent commits, each commit message ends with the
  two attribution lines given to the builders; no model names or ids in code, docs or commits;
  `verbatimModuleSyntax`, explicit `.ts` imports, `import type`, no enums/namespaces/parameter
  properties; Playwright on your own port, Chromium only from `/opt/pw-browsers`, never
  `playwright install`, stop servers with a bracket-pattern `pkill` in its own command.

---

## 15. Done means

For each screen and state, capture 390 × 844 @2x from the UI lab
(`/ui-lab.html?screen=<id>&variant=<v>&bare=1`, plus `&rm=1` and `&hc=1`) and from the real game
(`/?test=1&seed=42&level=N` with the save `{"v":4,"createdAt":1,"settings":{"unlockAll":true}}` in
`localStorage['shady.save']`), into `$S/<your-label>/`, and compare against §0. Then:

1. It looks like the mockup's game, not the old app (the before/after sheet is the bar).
2. `npm run typecheck`, `npm test`, `npm run build`, `npm run build:single` (size stated), and the full
   `npx playwright test` pass (with `PW_PORT=<port>`).
3. 320 × 568, 360 × 640, 390 × 844 and 1280 × 800: no sideways scroll, no overlap the specs check,
   targets ≥ 48, haloed text ≥ 15 px.
4. Reduced motion, `.is-hc`, forced colours and 200 % text checked by eye on Title, Journey, Results,
   Pause and Settings.
5. The ruler table of §9.3 in the B5 commit.
6. No legacy alias left in `kit.css` (§3), no `shadowBlur`, no new `filter`.

---

## Appendix A. Decisions taken by the lead (and why)

| Decision | Why |
|---|---|
| Candy as the base | All three judges ranked it first: reads as a polished casual game on every screen, maps onto the existing classes, lowest e2e risk. |
| Font via `?inline` + `FontFace`, no Vite config change | One path for the PWA and the single file, a promise for the canvas, verified with this repo's Vite. |
| Warm sky + warm plum scrim | Two judges: candy's cold blue fought the pastel world. A plum (not brown) scrim keeps it from looking muddy (the third judge's objection to storybook). |
| Neutral tray, one hero | The judges' "rainbow" note: Play must be the only big saturated control. |
| Road drawn by the tiles' pseudo-elements | Always aligned with the discs at every width, no SVG stretching, no JS, ~1 KiB. |
| No Settings tabs, no Title side rails, no saga path | Each fights the DOM, the fit() ladder or the specs (judge 3). Folder tabs only where `role=tab` already exists (Wardrobe). |
| No close coin on Pause | A second "Resume" would break four specs' role queries. |
| Hero in the map band, awards uncapped | Keeps `resultsSheetTop()`, the melt-map framing and the award specs as they are. |
| Slim ruler head, longer ruler | The 26 px Nubs head hid the gate, flare and boss marks (all judges). |
| Multiplier stays a coin (not a burst) | The Flow Ring's charge must run round a circle; bursts go to stamps, pops and the XP tag. |
| No halo under 15 px | Halos blob at 13 px (judge 2's 1x crops); small text passes by fill instead. |
| `ON`/`OFF` in toggles, hatch in high contrast | State never by colour alone (two judges). |
