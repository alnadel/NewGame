// The halo dial around Nubs (V1_PLAN §9, archive/CRITIQUE #5/#6, GR6 dial v2): the main control readout.
// A 40 u ring around his ground point carries the sun pointer (never fades), the teal shade arcs in
// three weights, red hatched glare arcs (always shown), 24 detent ticks and a curved rotation arrow
// while dragging, and an inner Chill gauge. Teal means only shade and red only glare:
//   - lasting (shaded now and in 0.6 s): thick, round caps, a white inner edge: "go here";
//   - ending (shaded now, lit in 0.6 s): thin;
//   - coming (lit now, shaded in 0.6 s): a thin dashed arc just outside the ring;
//   - when nothing lasts, the now-arcs are drawn medium-thick, so the dial is never blank.
// The Chill gauge is frost-white, hidden while the tank is full, amber below TUNING.bank.cashFullChill (50:
// a snap pours less of the ring and cools Nubs less, buds grow slower, economy iteration 2) and hot, dashed and pulsing
// below TUNING.bank.coolChill (25: red-hot Nubs grows no buds, freezes no frost and a snap only shades),
// both lines scaled to the tank and notched on its track; a missed flare's scorch chars the track's
// end, and in the Noon Heat a white gauge is hatched hot. In the sun the ring itself burns hot with a heartbeat glow (v1.3). The whole dial fades to 35 % while idle at full Chill. While a ghost-thumb hint plays
// (V1_PLAN §6.2) the dial shows where to put the sun: the target arc pulses, dots mark the way
// round, and a ghost sun glides from the sun pointer into the arc in step with the ghost thumb.
// v1.5: gold arcs just outside the ring mark the angles that grow a Sunflower bud (GuideState.bud;
// where gold meets teal, one angle does both; pale and dashed while Nubs is red-hot and grows none), and deep shade darkens the ring to indigo with a
// few frost sparkles circling it.
// v1.6 layers (docs/V1_6_PLAN.md §4, drawn only when their mask has something): a darker teal band
// inside the lasting teal where shade is deep (runs ≥ 3° wide); for a glass flake in its melt window
// a twinkling glint on the glass rim (R + GLASS_R, outside the sun pointer's rays) where a safe angle
// saves it, else a beaded ice-blue arc on that rim (the detour off the teal, at most two runs near
// the pointer; the drag arrow dims beside it) with the glint running along it (glassDecision);
// during a snap a frost band says "covered", the teal on it is the shade Nubs will land in when it
// ends, and the dashed arcs hide; during a Heat Flare's warning twelve white-hot ticks on an orange
// edge (the sun's own flare cue) count down to the rise round the outside, the ring's hot glow
// rests, and frost-rimmed teal marks the shade that holds through it, a run under 8° wearing a
// target dot (the glass layer hides).
// Elementals (docs/ELEMENTALS.md §1-§2, HaloInput.hero): on a Trial the arcs are the walking hero's
// go arcs, drawn as the teal ones in its colour on an ink underlay, with its pattern (Ember amber with
// outward ray ticks and gold dots on the glare it feeds on, and no red glare; Sprout lime in leaf
// dashes; Volt yellow with bolt notches beside a grey hatched dead zone round its last strike; Drip
// teal while it wants shade, dotted amber while it wants sun, pulsing; a narrow run wears a target
// dot), and the gauge is frost-white like Nubs' (amber below 60, hot below 25, so the hero's colour
// only ever means go; Drip's a two-ended thermometer, always shown). A duo draws each hero's own arcs thin (the lead's inside the ring, the mate's
// outside), the band where both are happy in white-gold with the lead's colour on its inner edge,
// and splits the gauge in two halves; a relay's telegraph dashes the incoming hero's arcs outside.
// Nubs walking alone keeps the teal dial.

import { coolLine, heroHealth, nextTagHero, nextTagTicks, TUNING, whiteLine, type HeroId, type SimState } from '../core/index.ts';
import { ghostSwipe } from '../game/assist.ts';
import type { MechView } from './renderer.ts';
import { cssa, hex } from './color.ts';
import { drawGlyph } from './glyphs.ts';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const TEAL = hex('#2EC4B6');
const RED = hex('#FF5D5D');
const FROST = hex('#EAF6FF');
const AMBER = hex('#FFA53D');
const INK = hex('#2B2140');
const HOT = hex('#FF6A3D');
const GOLD = hex('#FFC23D');
/** The gold arcs while Nubs is red-hot (no bud grows): a pale, dashed gold. */
const BUD_PALE = hex('#E8DDB8');
const BUD_DASH = [5, 5];
/** The scorched end of the Chill gauge's track (a missed flare's lowered ceiling). */
const CHAR = hex('#5A2A1E');
const NOON_DASH = [2, 5];
const DEEP = hex('#1F2A66');
const ICE = hex('#DDF4FF');
const DEEP_TEAL = hex('#0B5F5A');
const ICE_LINE = hex('#7FC4F0');
const FLARE = hex('#FF6A3D');
const WHITE_HOT = hex('#FFF4D6');
const GLASS_ICE = hex('#BFE6FF');
const DASH = [4, 5];
/** Elementals: each hero's go colour (Drip: teal cooling, amber warming), the duo's band, Volt's dead zone and Drip's thermometer (cold, steady, hot). */
const HERO_ARC: Readonly<Record<HeroId, number>> = { nubs: TEAL, ember: hex('#FF8A1F'), sprout: hex('#8BD650'), volt: hex('#FFE14D'), drip: TEAL };
const DRIP_WARM = hex('#FFB347');
const BOTH = hex('#FFF2B0');
const GREY = hex('#9AA0B4');
const THERMO_COL = [hex('#5AB8FF'), hex('#6CC04A'), hex('#FF5D3D')];
const LEAF_DASH = [8, 6];

/** A hero's go colour (Drip's by side: `cool` wants shade). */
export function heroArcColor(hero: HeroId, cool: boolean): number {
  return hero === 'drip' && !cool ? DRIP_WARM : HERO_ARC[hero];
}
/** Round-capped dots 5 px apart (the glass arc's beads). */
const BEADS = [0.1, 5];
const NO_DASH: number[] = [];
const HOT_RED = hex('#E8303A');

export interface HaloState {
  /** Eased overall alpha (1 active, 0.35 idle at full Chill). */
  alpha: number;
  /** Detent tick flashes (24), seconds remaining. */
  readonly flash: Float32Array;
  /** Smoothed rotation direction for the arrow (+1 CCW, −1 CW) and its strength. */
  arrow: number;
  arrowA: number;
  /** A SWING: seconds left of its swept arc (0.3 s) and the signed sweep that ended at θ (°). */
  swingT: number;
  swingDeg: number;
  /** Danger (GR v1.3): eased 0..1 while Nubs stands in the sun, and its heartbeat phase (faster as Chill drops). */
  heat: number;
  beat: number;
  /** v1.5 deep shade, eased 0..1, and the sparkles' orbit phase. */
  deep: number;
  deepSpin: number;
}

export const SWING_ARC_S = 0.3;

export function createHalo(): HaloState {
  return { alpha: 1, flash: new Float32Array(24), arrow: 0, arrowA: 0, swingT: 0, swingDeg: 0, heat: 0, beat: 0, deep: 0, deepSpin: 0 };
}

export interface HaloInput {
  cx: number;
  cy: number;
  /** Ring radius in CSS px. */
  R: number;
  theta: number;
  dragging: boolean;
  /** Signed θ change this frame (°), for the arrow. */
  dTheta: number;
  chill: number;
  /** The tank (100; a 'ration' level's 50): the gauge's white and red lines scale with it. */
  maxChill: number;
  sunUp: boolean;
  guideAlpha: number;
  now: Uint8Array;
  next: Uint8Array;
  glare: Uint8Array;
  /** Overall multiplier (title/dying fades). */
  fade: number;
  time: number;
  /** Ghost-hint target arc center and width (degrees); NaN center = no hint. */
  hintTarget: number;
  hintWidth: number;
  /** The way round to the target: +1 counter-clockwise, −1 clockwise. */
  hintTurn: number;
  /** Progress (0..1) through the ghost thumb's swipe loop, or −1 (no swipe on screen). */
  hintPhase: number;
  /** Hint visibility (eased 0..1). */
  hintAlpha: number;
  reducedMotion: boolean;
  /** Campaign concepts (v1.2): No Dial hides the shade arcs and the hint; Fog hides the `next` arcs; Sun Lock shows a padlock. */
  blind: boolean;
  hideNext: boolean;
  /** Sun Lock: locked now, or about to lock (the padlock blinks in 0.6 s ahead). */
  locked: boolean;
  lockSoon: boolean;
  /** v1.5: angles that grow a bud now (gold arcs), or null; Nubs in deep shade. */
  bud: Uint8Array | null;
  deep: boolean;
  /** v1.6 layers (the MechView's deepBand, glass, land, flare and the flare's phase), null on the Title. */
  mech: MechView | null;
  /**
   * Elementals: on a Trial its sim state (the dial reads the heroes, their masks guide.lead, .mate and
   * .tag, Volt's last strike and Drip's side and T from it; a solo hero's gauge reads `chill` as its
   * health 0..100), else null.
   */
  trial: SimState | null;
  /** High contrast: a hero's patterns (rays, notches, beads, food dots, the dead-zone hatch) half as thick again. */
  hc: boolean;
}

/** The incoming hero while a relay's TAG is telegraphed (TUNING.heroes.tagSoonTicks ahead), else null. */
export function tagSoon(s: SimState): HeroId | null {
  const n = nextTagTicks(s);
  return n >= 0 && n <= TUNING.heroes.tagSoonTicks ? nextTagHero(s) : null;
}

/** A dial input to refill every frame. */
export function createHaloIn(): HaloInput {
  const none = new Uint8Array(360);
  return {
    cx: 0, cy: 0, R: 1, theta: 0, dragging: false, dTheta: 0, chill: 100, maxChill: 100, sunUp: false, guideAlpha: 0, now: none, next: none, glare: none, fade: 1, time: 0,
    hintTarget: Number.NaN, hintWidth: 0, hintTurn: 0, hintPhase: -1, hintAlpha: 0, reducedMotion: false, blind: false, hideNext: false, locked: false, lockSoon: false,
    bud: null, deep: false, mech: null, trial: null, hc: false,
  };
}

const swipe = new Float64Array(2);
const split = createShadeSplit();

export function updateHalo(h: HaloState, dt: number, dragging: boolean, chill: number, dTheta: number, lit: boolean, deep = false): void {
  const target = dragging || chill < 99 || lit || deep ? 1 : 0.35;
  h.deep += ((deep ? 1 : 0) - h.deep) * Math.min(1, dt * (deep ? 8 : 4));
  h.deepSpin = (h.deepSpin + dt * 0.35) % 1;
  // The sun on Nubs turns the ring hot at once and lets go a little slower; the heartbeat runs at
  // 1.2 Hz at full Chill and 3.4 Hz near empty.
  h.heat += ((lit ? 1 : 0) - h.heat) * Math.min(1, dt * (lit ? 14 : 5));
  h.beat = (h.beat + dt * (1.2 + 2.2 * (1 - Math.max(0, Math.min(100, chill)) / 100))) % 1;
  h.alpha += (target - h.alpha) * Math.min(1, dt * (target > h.alpha ? 12 : 3));
  for (let i = 0; i < 24; i++) if ((h.flash[i] as number) > 0) h.flash[i] = Math.max(0, (h.flash[i] as number) - dt);
  h.swingT = Math.max(0, h.swingT - dt);
  if (dragging && Math.abs(dTheta) > 0.05) {
    const dir = dTheta > 0 ? 1 : -1;
    h.arrow = dir;
    h.arrowA = Math.min(1, h.arrowA + dt * 8);
  } else {
    h.arrowA = Math.max(0, h.arrowA - dt * (dragging ? 2 : 6));
  }
}

/** Flashes the tick of detent line `index` (0..23). */
export function flashDetent(h: HaloState, index: number): void {
  const i = ((index % 24) + 24) % 24;
  h.flash[i] = 0.22;
}

/** The shade masks split by how long they last (GR6), refilled every frame. */
export interface ShadeSplit {
  readonly lasting: Uint8Array;
  readonly ending: Uint8Array;
  readonly coming: Uint8Array;
}

export function createShadeSplit(): ShadeSplit {
  return { lasting: new Uint8Array(360), ending: new Uint8Array(360), coming: new Uint8Array(360) };
}

/**
 * lasting = now ∧ next, ending = now ∧ ¬next, coming = next ∧ ¬now. Returns 'lasting' when some
 * shade lasts, 'fallback' when only short shade exists now (the dial then draws `now` medium-thick),
 * 'none' when nothing is shaded now.
 */
export function splitShade(now: Uint8Array, next: Uint8Array, out: ShadeSplit): 'lasting' | 'fallback' | 'none' {
  let anyLasting = false;
  let anyNow = false;
  for (let b = 0; b < 360; b++) {
    const n = now[b] !== 0;
    const x = next[b] !== 0;
    out.lasting[b] = n && x ? 1 : 0;
    out.ending[b] = n && !x ? 1 : 0;
    out.coming[b] = x && !n ? 1 : 0;
    if (n) {
      anyNow = true;
      if (x) anyLasting = true;
    }
  }
  return anyLasting ? 'lasting' : anyNow ? 'fallback' : 'none';
}

/** Circular runs of set bins as [start, end] degree pairs (edges ±0.5), from the last runs() call. */
const runBuf = new Float32Array(2 * 181);

/** Collects every circular run of set bins into runBuf; returns the number of runs. */
function runs(mask: Uint8Array): number {
  let start = -1;
  // Find a gap to start from so wrap-around runs are handled once.
  let first = -1;
  for (let b = 0; b < 360; b++) {
    if (mask[b] === 0) {
      first = b;
      break;
    }
  }
  if (first < 0) {
    runBuf[0] = 0;
    runBuf[1] = 360;
    return 1;
  }
  let n = 0;
  for (let k = 1; k <= 360; k++) {
    const b = (first + k) % 360;
    const on = mask[b] !== 0;
    if (on && start < 0) start = first + k;
    if (!on && start >= 0) {
      runBuf[2 * n] = start - 0.5;
      runBuf[2 * n + 1] = first + k - 0.5;
      n++;
      start = -1;
    }
  }
  return n;
}

/** Adds every run of `mask` to the current path at radius r, each trimmed by `inset` degrees per end. */
function arcRuns(g: CanvasRenderingContext2D, mask: Uint8Array, cx: number, cy: number, r: number, inset: number): void {
  const n = runs(mask);
  for (let i = 0; i < n; i++) {
    const a0 = (runBuf[2 * i] as number) + inset;
    const a1 = (runBuf[2 * i + 1] as number) - inset;
    if (a1 > a0) arcPath(g, cx, cy, r, a0, a1);
  }
}

function arcPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number): void {
  // World angle θ maps to canvas angle −θ (screen y is down).
  g.moveTo(cx + Math.cos(-a1 * DEG) * r, cy + Math.sin(-a1 * DEG) * r);
  g.arc(cx, cy, r, -a1 * DEG, -a0 * DEG);
}

export function drawHalo(g: CanvasRenderingContext2D, h: HaloState, inp: HaloInput): void {
  const { cx, cy, R } = inp;
  const A = h.alpha * inp.fade;
  if (inp.fade <= 0.01) return;
  g.lineCap = 'butt';
  // A Trial's own dial (Nubs walking alone keeps the teal one): its band colour and ink underlay.
  const st = inp.trial;
  const lead = st ? st.nubs.hero : 'nubs';
  const mate = st?.mate?.hero;
  const duo = mate !== undefined;
  const hd = duo || lead !== 'nubs';
  const solo = hd && !duo ? lead : null;
  const col = duo ? BOTH : heroArcColor(lead, st ? st.dripCool : true);
  const under = hd ? 0.4 : 0;
  const tag = st ? tagSoon(st) : null;

  // Track ring with a soft dark backing so it reads on pale ground.
  g.lineWidth = 4;
  g.strokeStyle = cssa(INK, 0.12 * A);
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.stroke();
  g.lineWidth = 1.5;
  g.strokeStyle = cssa(0xffffff, 0.6 * A);
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.stroke();
  const heat = h.heat * inp.fade;
  if (heat > 0.01) {
    // In the sun the ring burns: a hot rim with a glow that beats like a heart (steady under
    // reduced motion), so "Nubs is melting" reads at a glance, before any number does.
    // During a flare's warning the glow rests (the countdown outside is the one hot thing to read).
    const k = inp.reducedMotion ? 0.6 : Math.max(0, Math.sin(h.beat * TAU)) ** 3;
    // Beside Ember's amber arcs the hot ring burns red.
    const hot = lead === 'ember' || mate === 'ember' ? HOT_RED : HOT;
    if (inp.mech?.flarePhase !== 1) {
      g.lineWidth = 12 + 6 * k;
      g.strokeStyle = cssa(hot, (0.14 + 0.2 * k) * heat);
      g.stroke();
    }
    g.lineWidth = 2.5;
    g.strokeStyle = cssa(hot, 0.9 * heat);
    g.stroke();
  }

  const deep = h.deep * inp.fade;
  if (deep > 0.01) {
    // Deep shade: the ring sinks to indigo under the teal.
    g.lineWidth = 11;
    g.strokeStyle = cssa(DEEP, 0.38 * deep);
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.stroke();
  }

  if (inp.sunUp && !inp.blind) {
    // Shade arcs by how long the shade lasts (in fog the dial only knows the shade it has now); Drip's pulse slowly.
    const ga = inp.guideAlpha * A * (solo === 'drip' && !inp.reducedMotion ? 0.875 + 0.125 * Math.sin(inp.time * TAU * 0.8) : 1);
    // The v1.6 rule layers (landing, deep band) read a rule, not the teal guide: like the other v1.6
    // rims they stay at max(0.7, A) when Guide Auto has faded the teal away.
    const va = Math.max(0.7, A) * inp.fade;
    const land = inp.mech?.land;
    if (land) {
      // v1.6 landing: a frost band says "covered"; the teal on it is the shade at the snap's end.
      const la = Math.max(ga, va);
      g.lineWidth = 12;
      g.strokeStyle = cssa(ICE, 0.7 * la);
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.stroke();
      g.lineWidth = 2;
      g.strokeStyle = cssa(ICE_LINE, 0.9 * la);
      g.beginPath();
      g.arc(cx, cy, R - 6, 0, TAU);
      g.stroke();
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.strokeStyle = cssa(TEAL, 0.95 * la);
      g.beginPath();
      arcRuns(g, land, cx, cy, R, 1);
      g.stroke();
      g.lineCap = 'butt';
      g.lineWidth = 2;
      g.strokeStyle = cssa(ICE_LINE, 0.9 * la);
      g.beginPath();
      g.arc(cx, cy, R + 6, 0, TAU);
      g.stroke();
    } else {
      const kind = ga > 0.01 ? splitShade(inp.now, inp.hideNext ? inp.now : inp.next, split) : 'none';
      if (duo && ga > 0.01) {
        // A duo: each hero's own arcs, thin, the lead's inside the ring and the mate's outside.
        thin(g, inp, (st as SimState).guide.lead, R - 3, HERO_ARC[lead], ga);
        thin(g, inp, (st as SimState).guide.mate, R + 5, HERO_ARC[mate], ga);
      }
      if (ga > 0.01) {
        g.setLineDash(DASH);
        g.lineWidth = 2;
        g.strokeStyle = cssa(col, 0.35 * ga);
        g.beginPath();
        arcRuns(g, split.coming, cx, cy, R + 6, 0);
        g.stroke();
        g.setLineDash(NO_DASH);
        if (kind === 'fallback') {
          g.lineCap = 'round';
          g.beginPath();
          arcRuns(g, inp.now, cx, cy, R, 0.5);
          band(g, 5, cssa(col, 0.75 * ga), under * ga, solo === 'sprout');
        } else if (kind === 'lasting') {
          g.lineWidth = 3;
          g.strokeStyle = cssa(col, 0.45 * ga);
          g.beginPath();
          arcRuns(g, split.ending, cx, cy, R, 0);
          g.stroke();
          g.lineCap = 'round';
          g.beginPath();
          arcRuns(g, split.lasting, cx, cy, R, 1);
          band(g, 8, cssa(col, 0.95 * ga), under * ga, solo === 'sprout');
          // The white inner edge: "go here" (a duo's in the lead's colour, Sprout's lime keeps its dashed run whole).
          g.lineWidth = solo === 'sprout' || duo ? 2 : 1;
          g.strokeStyle = cssa(duo ? HERO_ARC[lead] : solo === 'sprout' ? col : 0xffffff, 0.85 * ga);
          g.beginPath();
          arcRuns(g, split.lasting, cx, cy, R - 4.5, 1);
          g.stroke();
        }
        if (solo && kind !== 'none') marks(g, inp, solo, kind === 'lasting' ? split.lasting : inp.now, col, ga);
      }
      if (solo === 'volt' && (st as SimState).voltTheta >= 0) deadZone(g, inp, (st as SimState).voltTheta, Math.max(0.7, ga));
      const deepBand = inp.mech?.deepBand;
      if (deepBand) {
        // v1.6 deep shade: a darker band inside the teal, only where it is at least 3° wide; with the
        // teal faded (Guide Auto) it keeps its own thin teal track, so the deep goal stays readable.
        const n = runs(deepBand);
        g.lineCap = 'round';
        if (kind === 'none') {
          g.lineWidth = 7;
          g.strokeStyle = cssa(TEAL, 0.55 * va);
          g.beginPath();
          for (let i = 0; i < n; i++) {
            const a0 = (runBuf[2 * i] as number) + 1;
            const a1 = (runBuf[2 * i + 1] as number) - 1;
            if (a1 - a0 >= 1) arcPath(g, cx, cy, R, a0, a1);
          }
          g.stroke();
        }
        g.lineWidth = 3.5;
        g.strokeStyle = cssa(DEEP_TEAL, 0.95 * Math.max(ga, va));
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const a0 = (runBuf[2 * i] as number) + 1;
          const a1 = (runBuf[2 * i + 1] as number) - 1;
          if (a1 - a0 >= 1) arcPath(g, cx, cy, R, a0, a1);
        }
        g.stroke();
      }
      g.lineCap = 'butt';
    }
  }
  if (inp.sunUp && tag && !inp.blind) {
    // A relay's telegraph: the incoming hero's arcs, dashed just outside the ring.
    g.setLineDash(DASH);
    g.lineWidth = 3;
    g.strokeStyle = cssa(HERO_ARC[tag], Math.max(0.7, A));
    g.beginPath();
    arcRuns(g, (st as SimState).guide.tag, cx, cy, R + 6, 0.5);
    g.stroke();
    g.setLineDash(NO_DASH);
  }
  if (inp.sunUp && solo !== 'ember') {
    // Glare arcs: red with hatching, always shown (but to Ember, which feeds on glare: its gold dots).
    let anyGlare = false;
    for (let b = 0; b < 360; b++) {
      if (inp.glare[b] !== 0) {
        anyGlare = true;
        break;
      }
    }
    if (anyGlare) {
      g.lineWidth = 7;
      g.strokeStyle = cssa(RED, 0.35 * Math.max(0.6, A));
      g.beginPath();
      arcRuns(g, inp.glare, cx, cy, R, 0);
      g.stroke();
      g.lineWidth = 1.6;
      g.strokeStyle = cssa(RED, 0.95 * Math.max(0.6, A));
      g.beginPath();
      const n = runs(inp.glare);
      for (let i = 0; i < n; i++) {
        const a1 = runBuf[2 * i + 1] as number;
        for (let a = (runBuf[2 * i] as number) + 2; a < a1; a += 6) {
          const c0 = Math.cos(-a * DEG);
          const s0 = Math.sin(-a * DEG);
          const c1 = Math.cos(-(a + 4) * DEG);
          const s1 = Math.sin(-(a + 4) * DEG);
          g.moveTo(cx + c0 * (R - 4), cy + s0 * (R - 4));
          g.lineTo(cx + c1 * (R + 4), cy + s1 * (R + 4));
        }
      }
      g.stroke();
    }
  }

  if (inp.sunUp && inp.bud !== null) {
    // Bud arcs: gold just outside the ring, a soft glow under a bright line. A red-hot Nubs grows no
    // buds (economy iteration 2): the gold goes pale and dashed, a promise for when he cools.
    if (inp.bud.includes(1)) {
      const ba = Math.max(0.7, A) * inp.fade;
      const red = inp.mech !== null && inp.mech.pips > 1 && inp.chill < coolLine(inp.maxChill);
      g.lineCap = 'round';
      g.beginPath();
      arcRuns(g, inp.bud, cx, cy, R + 11, 0.5);
      if (red) {
        g.setLineDash(BUD_DASH);
        g.lineWidth = 3.5;
        g.strokeStyle = cssa(BUD_PALE, 0.6 * ba);
        g.stroke();
        g.setLineDash([]);
      } else {
        g.lineWidth = 9;
        g.strokeStyle = cssa(GOLD, 0.28 * ba);
        g.stroke();
        g.lineWidth = 3.5;
        g.strokeStyle = cssa(GOLD, 0.95 * ba);
        g.stroke();
      }
      g.lineCap = 'butt';
    }
  }

  const glassArc = inp.sunUp && inp.mech ? drawV16(g, inp, inp.mech, A, h) : false;

  if (inp.sunUp && !inp.blind) drawHint(g, inp, A);

  if (deep > 0.01) {
    // Three frost glints circling the deep ring, twinkling (still under reduced motion).
    g.fillStyle = cssa(ICE, 0.9 * deep);
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = ((inp.reducedMotion ? 0 : h.deepSpin) + i / 3) * TAU;
      const r = inp.reducedMotion ? 2.6 : 1.8 + Math.sin(inp.time * 7 + i * 2.1) + 1;
      g.moveTo(cx + Math.cos(a) * R + r, cy + Math.sin(a) * R);
      g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, r, 0, TAU);
    }
    g.fill();
  }

  // A SWING: the arc the sun swept to hand the shade over, flashing teal and fading out.
  if (h.swingT > 0 && h.swingDeg !== 0) {
    const a1 = inp.theta;
    const a0 = a1 - h.swingDeg;
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.strokeStyle = cssa(TEAL, 0.6 * (h.swingT / SWING_ARC_S) * inp.fade);
    g.beginPath();
    arcPath(g, cx, cy, R + 3, Math.min(a0, a1), Math.max(a0, a1));
    g.stroke();
    g.lineCap = 'butt';
  }

  // Chill gauge inside the ring, clockwise from the top: frost-white while a snap pours the whole ring
  // and cools Nubs full (TUNING.bank.cashFullChill), amber below it (less of both, buds grow slower), red, dashed and pulsing below
  // TUNING.bank.coolChill (red-hot: no buds grow, no frost freezes, a snap only shades); hidden while
  // Chill is full (the teal arcs lead then).
  // Its marks: a notch where it turns amber (whiteLine: 6 o'clock on a full tank) and red (coolLine:
  // 3 o'clock); an ink underlay keeps the amber apart from the hot ring outside it. A missed flare's
  // scorch chars the end of the track it took away; in the Noon Heat a white gauge is hatched hot
  // (a snap there pours nothing). A full tank hides it, a ration level's half tank too.
  const chill = Math.max(0, Math.min(100, inp.chill));
  const scorch = inp.mech ? inp.mech.scorch : 0;
  if (duo || solo === 'drip') heroGauge(g, inp, st as SimState, Math.max(A, 0.9));
  else if (chill < Math.min(100, inp.maxChill) - 1 || scorch > 0) {
    const gR = R - 8;
    const gA = Math.max(A, 0.9);
    const top = -Math.PI / 2;
    g.lineWidth = 3;
    g.strokeStyle = cssa(INK, 0.15 * gA);
    g.beginPath();
    g.arc(cx, cy, gR, 0, TAU);
    g.stroke();
    if (scorch > 0) {
      g.lineWidth = 4;
      g.setLineDash(BUD_DASH);
      g.strokeStyle = cssa(CHAR, 0.8 * gA);
      g.beginPath();
      g.arc(cx, cy, gR, top + TAU * (1 - scorch) * (inp.maxChill / 100), top + TAU * (inp.maxChill / 100));
      g.stroke();
      g.setLineDash([]);
    }
    g.lineWidth = 1.5;
    g.strokeStyle = cssa(INK, 0.45 * gA);
    g.beginPath();
    // A hero's gauge turns at 60 and 25 health.
    const wl = hd ? 60 : whiteLine(inp.maxChill);
    const cl = hd ? 25 : coolLine(inp.maxChill);
    for (const line of [wl, cl]) {
      const a = top + (TAU * line) / 100;
      g.moveTo(cx + Math.cos(a) * (gR - 3), cy + Math.sin(a) * (gR - 3));
      g.lineTo(cx + Math.cos(a) * (gR + 3), cy + Math.sin(a) * (gR + 3));
    }
    g.stroke();
    if (chill > 0.5) {
      const red = chill < cl;
      const white = chill >= wl;
      const end = top + (TAU * chill) / 100;
      g.lineCap = 'round';
      g.lineWidth = 5;
      g.strokeStyle = cssa(INK, 0.35 * gA);
      g.beginPath();
      g.arc(cx, cy, gR, top, end);
      g.stroke();
      g.lineWidth = 3;
      if (red) g.setLineDash([4, 3]);
      const pulse = red ? 0.7 + 0.3 * Math.sin(inp.time * TAU * 1.1) : 1;
      // A hero's gauge is frost-white like Nubs' when full: the hero's colour means only "go".
      g.strokeStyle = cssa(red ? HOT : white ? FROST : AMBER, gA * pulse);
      g.beginPath();
      g.arc(cx, cy, gR, top, end);
      g.stroke();
      if (white && inp.mech?.noonNow) {
        g.setLineDash(NOON_DASH);
        g.strokeStyle = cssa(HOT, 0.85 * gA);
        g.stroke();
      }
      g.setLineDash([]);
      g.lineCap = 'butt';
    }
  }

  // Detent ticks and the rotation arrow while dragging.
  if (inp.dragging || h.arrowA > 0.01) {
    const ta = inp.dragging ? 1 : h.arrowA;
    g.lineWidth = 1.5;
    for (let i = 0; i < 24; i++) {
      const a = -(i * 15) * DEG;
      const fl = (h.flash[i] as number) / 0.22;
      const r0 = R + 9;
      const r1 = R + 13 + 5 * fl;
      g.strokeStyle = cssa(fl > 0 ? 0xffffff : INK, (0.35 + 0.65 * fl) * ta);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
    if (h.arrowA > 0.01 && h.arrow !== 0) {
      // A curved arrow trailing the sun pointer, pointing the way it turns (dimmed beside a glass
      // detour arc, 6 px further out, so the two never read as one white arc).
      const dir = h.arrow;
      const rr = R + 18;
      const end = inp.theta;
      const start = end - dir * 38;
      const aa = h.arrowA * (glassArc ? 0.45 : 1);
      g.strokeStyle = cssa(0xffffff, 0.9 * aa);
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      if (dir > 0) arcPath(g, cx, cy, rr, start, end - 6);
      else arcPath(g, cx, cy, rr, end + 6, start);
      g.stroke();
      // Arrowhead at the leading end.
      const tip = (end - dir * 2) * DEG;
      const tx = cx + Math.cos(-tip) * rr;
      const ty = cy + Math.sin(-tip) * rr;
      // Tangent in the direction of motion on screen.
      const tanX = -Math.sin(-tip) * -dir;
      const tanY = Math.cos(-tip) * -dir;
      const nX = Math.cos(-tip);
      const nY = Math.sin(-tip);
      g.fillStyle = cssa(0xffffff, 0.95 * aa);
      g.beginPath();
      g.moveTo(tx + tanX * 7, ty + tanY * 7);
      g.lineTo(tx - tanX * 3 + nX * 5, ty - tanY * 3 + nY * 5);
      g.lineTo(tx - tanX * 3 - nX * 5, ty - tanY * 3 - nY * 5);
      g.closePath();
      g.fill();
      g.lineCap = 'butt';
    }
  }

  // The sun pointer: never fades (the fallback when a thumb covers everything else).
  const a = -inp.theta * DEG;
  const sx = cx + Math.cos(a) * R;
  const sy = cy + Math.sin(a) * R;
  const f = inp.fade;
  if (inp.sunUp) {
    sunPointer(g, cx, cy, R, inp.theta, f, inp.time, false);
  } else {
    g.fillStyle = cssa(0xe8ecff, 0.5 * f);
    g.beginPath();
    g.arc(sx, sy, 5, 0, TAU);
    g.fill();
  }
  if (inp.locked || inp.lockSoon) {
    // Sun Lock: a padlock just outside the pointer, on an ink plate; the ring greys over. It
    // blinks in just before the lock (steady under reduced motion), so the lock never surprises.
    const la = inp.locked ? f : f * (inp.reducedMotion ? 0.6 : 0.35 + 0.65 * Math.abs(Math.sin(inp.time * TAU * 2.5)));
    g.strokeStyle = cssa(INK, 0.35 * la);
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.stroke();
    const lx = cx + Math.cos(a) * (R + 20);
    const ly = cy + Math.sin(a) * (R + 20);
    g.fillStyle = cssa(INK, 0.9 * la);
    g.beginPath();
    g.arc(lx, ly, 11, 0, TAU);
    g.fill();
    g.globalAlpha = la;
    drawGlyph(g, 'lock', lx, ly, 15, '#FFFFFF');
    g.globalAlpha = 1;
  }
}

/** Strokes the current path `w` wide in `c` (a hero's band: on an ink underlay of alpha `under`, Sprout's in leaf dashes). */
function band(g: CanvasRenderingContext2D, w: number, c: string, under: number, dash: boolean): void {
  if (under > 0) {
    g.lineWidth = w + 3;
    g.strokeStyle = cssa(INK, under);
    g.stroke();
  }
  if (dash) {
    g.setLineDash(LEAF_DASH);
    g.lineCap = 'butt';
  }
  g.lineWidth = w;
  g.strokeStyle = c;
  g.stroke();
  g.setLineDash(NO_DASH);
}

/** A duo hero's own arcs, thin, at radius r. */
function thin(g: CanvasRenderingContext2D, inp: HaloInput, mask: Uint8Array, r: number, c: number, a: number): void {
  g.lineWidth = 2.5;
  g.strokeStyle = cssa(c, 0.9 * a);
  g.beginPath();
  arcRuns(g, mask, inp.cx, inp.cy, r, 0.5);
  g.stroke();
}

/** Adds a ring point at angle `a` (°), radius r, offset (u, t) radially and tangentially: a dot, a tick end, a bolt corner. */
function at(g: CanvasRenderingContext2D, inp: HaloInput, a: number, r: number, line: boolean): void {
  const x = inp.cx + Math.cos(-a * DEG) * r;
  const y = inp.cy + Math.sin(-a * DEG) * r;
  if (line) g.lineTo(x, y);
  else g.moveTo(x, y);
}

/**
 * A solo hero's pattern on its go arcs `m` (see the header): Ember's ray ticks every 6° and gold food
 * dots, Volt's bolt notches, Drip's warm dots, and a target dot on every run under 8°.
 */
function marks(g: CanvasRenderingContext2D, inp: HaloInput, hero: HeroId, m: Uint8Array, col: number, a: number): void {
  const R = inp.R;
  const n = runs(m);
  const T = inp.hc ? 1.5 : 1;
  if (hero === 'ember' || hero === 'volt') {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const b0 = runBuf[2 * i] as number;
      const b1 = runBuf[2 * i + 1] as number;
      const mid = (b0 + b1) / 2;
      if (hero === 'volt') {
        // A bolt across the band: in from outside, a step back, on in.
        at(g, inp, mid - 1.5, R + 5, false);
        at(g, inp, mid + 1, R + 0.5, true);
        at(g, inp, mid - 1, R - 0.5, true);
        at(g, inp, mid + 1.5, R - 5, true);
      } else {
        for (let b = b0 + 3; b < b1 - 1; b += 6) {
          at(g, inp, b, R + 5, false);
          at(g, inp, b, R + 10, true);
        }
      }
    }
    g.lineWidth = 2 * T;
    g.strokeStyle = cssa(hero === 'volt' ? INK : col, a);
    g.stroke();
  }
  if (col === DRIP_WARM) {
    // Drip warming: white beads along the band.
    g.setLineDash(BEADS);
    g.lineWidth = 3 * T;
    g.strokeStyle = cssa(0xffffff, a);
    g.beginPath();
    arcRuns(g, m, inp.cx, inp.cy, R, 2);
    g.stroke();
    g.setLineDash(NO_DASH);
  }
  // Dots (round caps on points): Ember's food, the glare that is also safe, gold outside its rays...
  let k = 0;
  g.beginPath();
  for (let b = 0; b < 360 && hero === 'ember'; b += 6) {
    if (inp.glare[b] !== 0 && m[b] !== 0) {
      at(g, inp, b, R + 14, false);
      at(g, inp, b, R + 14, true);
      k++;
    }
  }
  if (k > 0) {
    g.lineWidth = 6 * T;
    g.strokeStyle = cssa(GOLD_FOOD, a);
    g.stroke();
  }
  // ...and a narrow run (Sprout's edges) is a target, not a sliver: a white dot ringed in the hero's colour.
  k = 0;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const b0 = runBuf[2 * i] as number;
    const b1 = runBuf[2 * i + 1] as number;
    if (b1 - b0 < FLARE_DOT_DEG) {
      at(g, inp, (b0 + b1) / 2, R, false);
      at(g, inp, (b0 + b1) / 2, R, true);
      k++;
    }
  }
  if (k > 0) {
    g.lineWidth = 11;
    g.strokeStyle = cssa(col, a);
    g.stroke();
    g.lineWidth = 7;
    g.strokeStyle = cssa(0xffffff, a);
    g.stroke();
  }
}
const GOLD_FOOD = hex('#FFD84A');

/** Volt's dead zone: ±40° round its last strike as a grey band hatched across, with a bolt marker at the strike. */
function deadZone(g: CanvasRenderingContext2D, inp: HaloInput, t: number, a: number): void {
  const R = inp.R;
  g.lineWidth = 7;
  g.strokeStyle = cssa(GREY, 0.4 * a);
  g.beginPath();
  arcPath(g, inp.cx, inp.cy, R, t - 40, t + 40);
  g.stroke();
  g.beginPath();
  for (let b = t - 38; b < t + 38; b += 6) {
    at(g, inp, b, R - 4, false);
    at(g, inp, b + 4, R + 4, true);
  }
  // The marker: a bolt standing out of the ring at the strike.
  at(g, inp, t + 3, R + 20, false);
  at(g, inp, t - 2, R + 13, true);
  at(g, inp, t + 2, R + 12, true);
  at(g, inp, t - 3, R + 5, true);
  g.lineWidth = inp.hc ? 3 : 2;
  g.strokeStyle = cssa(GREY, a);
  g.stroke();
}

/**
 * A duo's gauge (two halves filling up from the bottom: the lead's left, the mate's right) or Drip's
 * two-ended thermometer (cold blue, a calm green band 30-70, hot red; the needle at T, notches at
 * the Steady band), always shown.
 */
function heroGauge(g: CanvasRenderingContext2D, inp: HaloInput, st: SimState, gA: number): void {
  const { cx, cy } = inp;
  const gR = inp.R - 8;
  const p2 = Math.PI / 2;
  const m = st.mate;
  g.lineCap = 'round';
  g.lineWidth = 5;
  g.strokeStyle = cssa(INK, 0.3 * gA);
  g.beginPath();
  g.arc(cx, cy, gR, m ? 0 : 0.75 * Math.PI, m ? TAU : 2.25 * Math.PI);
  g.stroke();
  g.lineWidth = 3;
  if (m) {
    for (let s = 0; s < 2; s++) {
      const nb = s ? m : st.nubs;
      const hp = Math.max(0, Math.min(100, heroHealth(nb)));
      g.strokeStyle = cssa(hp < 25 ? HOT : hp < 60 ? AMBER : HERO_ARC[nb.hero], gA);
      g.beginPath();
      g.arc(cx, cy, gR, p2 + (s ? -0.1 : 0.1), p2 + (s ? -0.1 - 3 * hp / 100 : 0.1 + 3 * hp / 100), s > 0);
      g.stroke();
    }
  } else {
    // T 0..100 across 270° from the bottom left; the needle a white dot.
    for (let i = 0; i < 3; i++) {
      g.strokeStyle = cssa(THERMO_COL[i] as number, gA);
      g.beginPath();
      g.arc(cx, cy, gR, 0.75 * Math.PI + 0.0471 * THERMO[i]!, 0.75 * Math.PI + 0.0471 * THERMO[i + 1]!);
      g.stroke();
    }
    // Notches at the Steady band, then the needle: a white dot ringed in ink at T.
    const sT = (st.trial?.steady ?? 0) / 2;
    g.beginPath();
    for (let i = 0; i < 2 && sT > 0; i++) {
      at(g, inp, -135 - 2.7 * (i ? 100 - sT : sT), gR + 5, false);
      at(g, inp, -135 - 2.7 * (i ? 100 - sT : sT), gR - 5, true);
    }
    g.lineWidth = 1.5;
    g.strokeStyle = cssa(INK, gA);
    g.stroke();
    const T = -135 - 2.7 * Math.max(0, Math.min(100, st.nubs.chill));
    g.beginPath();
    at(g, inp, T, gR, false);
    at(g, inp, T, gR, true);
    g.lineWidth = 9;
    g.stroke();
    g.lineWidth = 6;
    g.strokeStyle = '#FFFFFF';
    g.stroke();
  }
  g.lineCap = 'butt';
}
const THERMO = [0, 30, 70, 100];

/**
 * The glass rim (px outside R): clear of the bud glow at R + 11, 6 px outside the drag arrow at
 * R + 18 and outside the sun pointer's rays (R + 10.5), so a glint at the pointer's angle still
 * shows; and the narrowest run it draws (°).
 */
const GLASS_R = 24;
const GLASS_MIN_DEG = 4;
/** Runs of the glass decision closer than this (°) merge into one arc. */
const GLASS_MERGE_DEG = 8;
/** At most this share of the dial in glass detours: wider, the arc says nothing (behind dense casters most angles shade one point). */
const GLASS_MAX_SHARE = 0.35;
/** A second detour arc is drawn only within this of the sun pointer (°). */
const GLASS_SECOND_DEG = 90;

/** What the glass layer draws (glassDecision): 0 nothing, 1 detour arcs (the angles that save the glass flake but leave the safe teal), 2 a glint by the teal (the safe angles already save it). */
export interface GlassDraw {
  mode: 0 | 1 | 2;
  /** Detour arcs as [b0, b1] (°, b1 > b0, b1 may pass 360), at most two, the nearest the pointer first. */
  readonly arcs: Float32Array;
  n: number;
  /** Where the glint sits (°). */
  glint: number;
}

export function createGlassDraw(): GlassDraw {
  return { mode: 0, arcs: new Float32Array(4), n: 0, glint: 0 };
}

const glassCost = new Uint8Array(360);
const glassRuns = new Float32Array(2 * 181);

/** Circular distance (°) from angle a to the run [b0, b1]. */
function runDist(a: number, b0: number, b1: number): number {
  const d = (x: number): number => Math.abs(((((x - a) % 360) + 540) % 360) - 180);
  const mid = (b0 + b1) / 2;
  if (d(mid) <= (b1 - b0) / 2) return 0;
  return Math.min(d(b0), d(b1));
}

/**
 * The glass layer's decision (fix round 2: the whole flake mask read as a broken white ring over
 * the teal): when a safe angle (guide.now) already saves the glass flake, a glint on the teal there
 * and no arc; else the detour, guide.flake AND NOT guide.now, its runs merged across gaps under
 * GLASS_MERGE_DEG, slivers under GLASS_MIN_DEG dropped, nothing when it covers over GLASS_MAX_SHARE
 * of the dial, and only the run nearest the sun pointer plus at most one more within
 * GLASS_SECOND_DEG of it.
 */
export function glassDecision(flake: Uint8Array, now: Uint8Array, theta: number, out: GlassDraw): GlassDraw {
  out.mode = 0;
  out.n = 0;
  let cost = 0;
  let both = -1;
  let bothD = Infinity;
  for (let b = 0; b < 360; b++) {
    const f = flake[b] !== 0;
    const c = f && now[b] === 0 ? 1 : 0;
    glassCost[b] = c;
    cost += c;
    if (f && now[b] !== 0) {
      const d = Math.abs(((((b - theta) % 360) + 540) % 360) - 180);
      if (d < bothD) {
        bothD = d;
        both = b;
      }
    }
  }
  if (both >= 0) {
    out.mode = 2;
    out.glint = both;
    return out;
  }
  if (cost === 0 || cost > GLASS_MAX_SHARE * 360) return out;
  let n = runs(glassCost);
  for (let i = 0; i < 2 * n; i++) glassRuns[i] = runBuf[i] as number;
  // Merge neighbours across short gaps (the last run wraps onto the first).
  let m = 0;
  for (let i = 0; i < n; i++) {
    const b0 = glassRuns[2 * i] as number;
    const b1 = glassRuns[2 * i + 1] as number;
    if (m > 0 && b0 - (glassRuns[2 * m - 1] as number) < GLASS_MERGE_DEG) glassRuns[2 * m - 1] = b1;
    else {
      glassRuns[2 * m] = b0;
      glassRuns[2 * m + 1] = b1;
      m++;
    }
  }
  if (m > 1 && (glassRuns[0] as number) + 360 - (glassRuns[2 * m - 1] as number) < GLASS_MERGE_DEG) {
    glassRuns[2 * m - 1] = (glassRuns[1] as number) + 360;
    glassRuns[0] = glassRuns[2 * m - 2] as number;
    glassRuns[1] = glassRuns[2 * m - 1] as number;
    m--;
  }
  n = m;
  // The nearest run to the pointer, then the next nearest within GLASS_SECOND_DEG.
  let i0 = -1;
  let d0 = Infinity;
  let i1 = -1;
  let d1 = Infinity;
  for (let i = 0; i < n; i++) {
    const b0 = glassRuns[2 * i] as number;
    const b1 = glassRuns[2 * i + 1] as number;
    if (b1 - b0 < GLASS_MIN_DEG) continue;
    const d = runDist(theta, b0, b1);
    if (d < d0) {
      i1 = i0;
      d1 = d0;
      i0 = i;
      d0 = d;
    } else if (d < d1) {
      i1 = i;
      d1 = d;
    }
  }
  if (i0 < 0) return out;
  out.mode = 1;
  for (const i of i1 >= 0 && d1 <= GLASS_SECOND_DEG ? [i0, i1] : [i0]) {
    out.arcs[2 * out.n] = glassRuns[2 * i] as number;
    out.arcs[2 * out.n + 1] = glassRuns[2 * i + 1] as number;
    out.n++;
  }
  out.glint = ((glassRuns[2 * i0] as number) + (glassRuns[2 * i0 + 1] as number)) / 2;
  return out;
}

const glassDraw = createGlassDraw();

/** Flare parry runs narrower than this (°) wear a target dot (a 4° run is an 11 px pill on a phone). */
const FLARE_DOT_DEG = 8;

/**
 * The v1.6 rims outside the ring (see the header): a flare's countdown and its shade (they take the
 * glass layer's place), else the glass arc and its glint. True when a glass detour arc was drawn.
 */
function drawV16(g: CanvasRenderingContext2D, inp: HaloInput, m: MechView, A: number, h: HaloState): boolean {
  const { cx, cy, R } = inp;
  const f = Math.max(0.7, A) * inp.fade;
  let arc = false;
  g.lineCap = 'round';
  const ph = m.flarePhase;
  if (ph === 1) {
    // The flare's shade arc names the angles that parry it; when every angle does (a snap covers the
    // hold) there is no decision to draw, and the landing's teal leads (§4 priority): rim only.
    const n = m.flare && !inp.blind ? runs(m.flare) : 0;
    if (m.flare && n > 0 && !(n === 1 && (runBuf[1] as number) - (runBuf[0] as number) >= 360)) {
      g.beginPath();
      arcRuns(g, m.flare, cx, cy, R + 17, 0.5);
      g.lineWidth = 7;
      g.strokeStyle = cssa(0xffffff, 0.95 * f);
      g.stroke();
      g.lineWidth = 3.5;
      g.strokeStyle = cssa(TEAL, f);
      g.stroke();
      // A narrow run is a target, not a pill: a teal dot in a white disc with a soft teal halo.
      for (let i = 0; i < n; i++) {
        const b0 = runBuf[2 * i] as number;
        const b1 = runBuf[2 * i + 1] as number;
        if (b1 - b0 >= FLARE_DOT_DEG) continue;
        const a = -((b0 + b1) / 2) * DEG;
        const x = cx + Math.cos(a) * (R + 17);
        const y = cy + Math.sin(a) * (R + 17);
        g.fillStyle = cssa(TEAL, 0.3 * f);
        g.beginPath();
        g.arc(x, y, 9, 0, TAU);
        g.fill();
        g.fillStyle = cssa(0xffffff, 0.95 * f);
        g.beginPath();
        g.arc(x, y, 5.5, 0, TAU);
        g.fill();
        g.fillStyle = cssa(TEAL, f);
        g.beginPath();
        g.arc(x, y, 3, 0, TAU);
        g.fill();
      }
    }
    // The countdown: the sun cue's twelve white-hot ticks on an orange edge, going out one by one
    // from the end of the clockwise sweep, over a faint ink track; not the hot ring's solid orange.
    const rr = R + 25;
    g.lineWidth = 2;
    g.strokeStyle = cssa(INK, 0.16 * f);
    g.beginPath();
    g.arc(cx, cy, rr, 0, TAU);
    g.stroke();
    const lit = m.flareLeft * 12;
    g.beginPath();
    for (let i = 0; i < lit; i++) {
      const a0 = -Math.PI / 2 + (i * TAU) / 12 + 0.09;
      const a1 = -Math.PI / 2 + ((Math.min(lit, i + 1) * TAU) / 12) - 0.09;
      if (a1 <= a0) break;
      g.moveTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr);
      g.arc(cx, cy, rr, a0, a1);
    }
    g.lineWidth = 6.5;
    g.strokeStyle = cssa(FLARE, 0.95 * f);
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = cssa(WHITE_HOT, f);
    g.stroke();
  } else if (m.glass && !inp.blind) {
    // The decision, not the mask (glassDecision): a beaded ice-blue detour arc on the glass rim with
    // a glint running along it, or, when the teal already saves the flake, a glint on the rim just
    // outside the teal that does it (never under the sun pointer's disc).
    const gd = glassDecision(m.glass, inp.now, inp.theta, glassDraw);
    const u = inp.reducedMotion ? 0.5 : (h.deepSpin * 3) % 1;
    const gr = R + GLASS_R;
    let ga = gd.glint;
    if (gd.mode === 1) {
      arc = true;
      g.beginPath();
      for (let i = 0; i < gd.n; i++) arcPath(g, cx, cy, gr, (gd.arcs[2 * i] as number) + 0.5, (gd.arcs[2 * i + 1] as number) - 0.5);
      g.setLineDash(BEADS);
      g.lineWidth = 6.5;
      g.strokeStyle = cssa(INK, 0.45 * f);
      g.stroke();
      g.lineWidth = 3.5;
      g.strokeStyle = cssa(GLASS_ICE, f);
      g.stroke();
      g.setLineDash(NO_DASH);
      // The glint runs along the nearest arc (resting at its middle under reduced motion).
      const b0 = gd.arcs[0] as number;
      ga = b0 + ((gd.arcs[1] as number) - b0) * u;
    }
    if (gd.mode !== 0) {
      // A four-point sparkle over a dark-rimmed disc in an ice glow; it twinkles (still under reduced motion).
      const a = -ga * DEG;
      const x = cx + Math.cos(a) * gr;
      const y = cy + Math.sin(a) * gr;
      const k = inp.reducedMotion ? 1 : 0.9 + 0.2 * Math.sin(inp.time * 9);
      g.fillStyle = cssa(GLASS_ICE, 0.55 * f);
      g.beginPath();
      g.arc(x, y, 8.5 * k, 0, TAU);
      g.fill();
      g.fillStyle = cssa(0xffffff, f);
      g.strokeStyle = cssa(INK, 0.45 * f);
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y, 4 * k, 0, TAU);
      g.fill();
      g.stroke();
      g.strokeStyle = cssa(0xffffff, f);
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x - 11 * k, y);
      g.lineTo(x + 11 * k, y);
      g.moveTo(x, y - 11 * k);
      g.lineTo(x, y + 11 * k);
      g.stroke();
    }
  }
  g.lineCap = 'butt';
  return arc;
}

/** The little sun on the ring at θ (rays, disc, an inward notch). `ghost` draws a pale copy. */
function sunPointer(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, theta: number, f: number, time: number, ghost: boolean): void {
  const a = -theta * DEG;
  const sx = cx + Math.cos(a) * R;
  const sy = cy + Math.sin(a) * R;
  g.fillStyle = cssa(ghost ? 0xfff1c2 : 0xffd36b, f);
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const ra = (i * TAU) / 8 + time * 0.6;
    g.moveTo(sx + Math.cos(ra - 0.25) * 6.5, sy + Math.sin(ra - 0.25) * 6.5);
    g.lineTo(sx + Math.cos(ra) * 10.5, sy + Math.sin(ra) * 10.5);
    g.lineTo(sx + Math.cos(ra + 0.25) * 6.5, sy + Math.sin(ra + 0.25) * 6.5);
  }
  g.fill();
  g.fillStyle = cssa(ghost ? 0xffefb0 : 0xffe27a, f);
  g.strokeStyle = cssa(ghost ? 0xffffff : 0xe8a21f, f);
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(sx, sy, 6.5, 0, TAU);
  g.fill();
  g.stroke();
  if (ghost) return;
  // A tiny inward notch so it reads as a pointer.
  g.fillStyle = cssa(0xe8a21f, f);
  g.beginPath();
  const ix = cx + Math.cos(a) * (R - 9);
  const iy = cy + Math.sin(a) * (R - 9);
  g.moveTo(ix, iy);
  g.lineTo(sx + Math.cos(a + 1.9) * 6, sy + Math.sin(a + 1.9) * 6);
  g.lineTo(sx + Math.cos(a - 1.9) * 6, sy + Math.sin(a - 1.9) * 6);
  g.closePath();
  g.fill();
}

/**
 * The ghost hint on the dial: "put the little sun here". The target arc glows and pulses as the ghost
 * sun arrives; dots mark the way round from the sun pointer; the ghost sun glides along them in
 * step with the ghost thumb (or waits in the arc under reduced motion).
 */
function drawHint(g: CanvasRenderingContext2D, inp: HaloInput, A: number): void {
  const ha = inp.hintAlpha * Math.max(0.6, A) * inp.fade;
  if (ha < 0.01 || Number.isNaN(inp.hintTarget) || inp.hintTurn === 0) return;
  const { cx, cy, R } = inp;
  const c = inp.hintTarget;
  const half = Math.max(5, inp.hintWidth / 2);
  const turn = inp.hintTurn > 0 ? 1 : -1;
  // Degrees from the sun pointer to the target center the hinted way round.
  const route = ((((c - inp.theta) * turn) % 360) + 360) % 360;
  let travel = -1;
  let ghostA = 0;
  let pulse: number;
  if (inp.hintPhase >= 0 && !inp.reducedMotion) {
    ghostSwipe(inp.hintPhase, swipe);
    travel = swipe[0] as number;
    ghostA = swipe[1] as number;
    // The arc lights up as the ghost sun arrives in it.
    pulse = Math.max(0, Math.min(1, (travel - 0.6) / 0.4)) * ghostA;
  } else {
    pulse = 0.5 + 0.5 * Math.sin(inp.time * TAU * 0.8);
  }

  // Target arc: a soft wide glow and a bright bracket just outside the ring.
  g.lineCap = 'round';
  g.lineWidth = 16;
  g.strokeStyle = cssa(TEAL, ha * (0.16 + 0.3 * pulse));
  g.beginPath();
  arcPath(g, cx, cy, R, c - half, c + half);
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = cssa(0xffffff, ha * (0.55 + 0.45 * pulse));
  g.beginPath();
  arcPath(g, cx, cy, R + 9, c - half, c + half);
  g.stroke();
  g.lineCap = 'butt';

  // The way round: dots from just past the sun pointer to the arc's near edge.
  const end = route - half;
  if (end > 14) {
    g.fillStyle = cssa(0xffffff, ha * 0.7);
    g.beginPath();
    for (let d = 14; d <= end; d += 10) {
      const t = -(inp.theta + turn * d) * DEG;
      const x = cx + Math.cos(t) * R;
      const y = cy + Math.sin(t) * R;
      g.moveTo(x + 1.7, y);
      g.arc(x, y, 1.7, 0, TAU);
    }
    g.fill();
  }

  // The ghost sun, with a short fading trail so the way it goes reads at a glance.
  if (travel >= 0) {
    if (ghostA > 0.01) {
      const at = inp.theta + turn * route * travel;
      const tail = Math.min(36, route * travel);
      if (tail > 2) {
        g.lineCap = 'round';
        for (let k = 0; k < 3; k++) {
          const a0 = at - turn * tail * ((k + 1) / 3);
          const a1 = at - turn * tail * (k / 3);
          g.lineWidth = 5 - k * 1.3;
          g.strokeStyle = cssa(0xffffff, ha * ghostA * (0.55 - k * 0.16));
          g.beginPath();
          if (turn > 0) arcPath(g, cx, cy, R, a0, a1);
          else arcPath(g, cx, cy, R, a1, a0);
          g.stroke();
        }
        g.lineCap = 'butt';
      }
      sunPointer(g, cx, cy, R, at, ha * ghostA * 0.9, inp.time, true);
    }
  } else if (inp.reducedMotion) {
    sunPointer(g, cx, cy, R, c, ha * (0.45 + 0.35 * pulse), 0, true);
  }
}

const frozen = createShadeSplit();

/**
 * The dial frozen at the melt (the Melt Map's 'frozen' mode): a faint ring, the thick teal shade that
 * lasted (or the shade there was), a dotted short way from the sun pointer to its nearest bin, and
 * the sun pointer at θ.
 */
export function drawFrozenDial(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, theta: number, now: Uint8Array, next: Uint8Array, a: number): void {
  const mode = splitShade(now, next, frozen);
  const mask = mode === 'lasting' ? frozen.lasting : now;
  g.globalAlpha = a;
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.stroke();
  if (mode === 'none') {
    sunPointer(g, cx, cy, R, theta, a, 0, false);
    return;
  }
  g.lineCap = 'round';
  g.strokeStyle = cssa(0x2ec4b6, 0.95 * a);
  g.lineWidth = 6;
  g.beginPath();
  arcRuns(g, mask, cx, cy, R, 1);
  g.stroke();
  g.strokeStyle = cssa(0xffffff, 0.9 * a);
  g.lineWidth = 1;
  g.beginPath();
  arcRuns(g, mask, cx, cy, R - 3, 1);
  g.stroke();
  // The short way from θ to the nearest set bin, in dots.
  let best = 999;
  for (let b = 0; b < 360; b++) {
    if (mask[b] === 0) continue;
    const d = ((b - theta + 540) % 360) - 180;
    if (Math.abs(d) < Math.abs(best)) best = d;
  }
  if (Math.abs(best) >= 6) {
    g.fillStyle = cssa(0xffffff, 0.95 * a);
    const steps = Math.floor(Math.abs(best) / 8);
    for (let k = 1; k <= steps; k++) {
      const ang = -(theta + Math.sign(best) * k * 8) * DEG;
      g.beginPath();
      g.arc(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, 1.8, 0, TAU);
      g.fill();
    }
  }
  sunPointer(g, cx, cy, R, theta, a, 0, false);
}
