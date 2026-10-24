// Frame orchestration and draw order (archive/TECH_SPEC §9.2 with the V1_PLAN changes). The renderer only
// reads the sim; render-side state (particles, rings, pops, footprints, the halo, the sun glyph,
// banners, HUD timers, Nubs' springs) lives in RenderScene and is driven by game/fx.ts.
// Elementals: on a Trial the walker wears its element's art (render/heroes.ts); the Nubs-only cues
// follow health and the element's own state (the vignette, the sun's moods, the hot ring, the
// sizzle, which becomes Ember's smoke); the relay's Tag Stones stand on the trail and its NEXT chip
// counts the telegraph down under the dial.

import {
  coolLine,
  dayTicks,
  nextTagTicks,
  nightTicks,
  PICKUP_ALIVE,
  queryBuds,
  queryCasters,
  queryPickups,
  SAMPLE_DX,
  SAMPLE_DY,
  trailSlope,
  worldPlan,
  type Bud,
  type Caster,
  type Cloud,
  type ElState,
  type HeroId,
  type NubsState,
  type Pickup,
  type RenderSnap,
  type SimState,
  type World,
  windAt,
} from '../core/index.ts';
import { sunLockedAt } from '../core/sim/sun.ts';
import { createCameraFx, createView, layoutView, setPlayCamera, updateCameraFx, type CameraFx, type View } from '../game/camera.ts';
import type { Equipped } from '../meta/content.ts';
import type { Insets } from '../platform/safeArea.ts';
import { createAtmosphere, createAtmosphereIn, drawAtmosphere, type Atmosphere, type AtmosphereIn } from './atmosphere.ts';
import { drawBanners, createBanners, updateBanners, type Banners } from './banners.ts';
import { createLight, drawCaster, drawContactAO, drawWindowGlow, type Light } from './casters.ts';
import { drawClouds } from './clouds.ts';
import { drawBud } from './flora.ts';
import { drawFriendPennant, drawFriendPuddle, friendSpot } from './friend.ts';
import { cssa, hex } from './color.ts';
import { radialSprite, type Canvas2D } from './sprites.ts';
import {
  createFootprints,
  biomeSeamIn,
  createGroundPaint,
  drawBars,
  drawFootprints,
  drawGround,
  drawTrail,
  stepFootprints,
  type Footprints,
  type GroundPaint,
} from './ground.ts';
import { createHalo, createHaloIn, drawHalo, tagSoon, updateHalo, type HaloInput, type HaloState } from './halo.ts';
import { drawNextChip, drawTagStones, heroArt } from './heroes.ts';
import { drawElAir, drawElCues, drawElGround, drawElWalls } from './trial.ts';
import { createHud, drawHud, hudScale, syncHud, updateHud, type HudCampaign, type HudInput, type HudState } from './hud.ts';
import {
  applyPull,
  createMapFrame,
  drawMeltMap,
  frameDeath,
  MAP_PULL_S,
  mapAlphas,
  mapSettleT,
  mapTarget,
  type MapFrame,
  type MapOverlay,
} from './meltMap.ts';
import {
  createNubsAnim,
  createNubsSprite,
  createPose,
  drawFootprintDisc,
  drawNubsSprite,
  drawOwnShadow,
  drawSizzle,
  looksFor,
  hopLift,
  nubsBox,
  renderNubsSprite,
  updateNubsAnim,
  type NubsAnim,
  type NubsPose,
  type NubsSprite,
} from './nubs.ts';
import { createPalette, themeFor, updatePalette, type Palette } from './palette.ts';
import {
  createParticles,
  createPops,
  createRings,
  drawAirParticles,
  drawGroundParticles,
  drawGustStreaks,
  drawPops,
  drawRings,
  drawScreenParticles,
  updateParticles,
  updatePops,
  updateRings,
  type Particles,
  type Pops,
  type Rings,
} from './particles.ts';
import { createDeathBeat, drawGrey, drawHatPop, greyOf, startDeathBeat, type DeathBeat } from './deathbeat.ts';
import { createDecor, drawBunting, drawDecor, invalidateDecor, type Decor, type DecorFrame } from './decor.ts';
import { drawGlare, drawPickups } from './pickups.ts';
import { createShadowLayer, drawShadowLayer, traceShadows, type ShadowLayer } from './shadowLayer.ts';
import { ctx2d, makeCanvas } from './sprites.ts';
import { bossWeight, createSunGlyph, drawFlareCue, drawSun, placeSun, type SunGlyph, type SunMood } from './sun.ts';

const DEG = Math.PI / 180;
/** Sun Lock's warning: the padlock blinks this many ticks before the lock. */
const LOCK_WARN_TICKS = 36;
/** The moon's shadow length factor (a low moon). */
const MOON_COT = 1.2;
let moonRim: Canvas2D | null = null;
/** Fog (v1.2): the world fades out from FOG_NEAR to FOG_FAR u ahead of Nubs and is gone beyond. */
const FOG_NEAR = 170;
const FOG_FAR = 330;
/** The mist's colour (the band sprite and the fill above it share it). */
const FOG_RGB = '246,247,250';
const FOG_ALPHA = 0.97;
let fogBand: Canvas2D | null = null;
/** Moonlit shadows: the moon sun's shadow alpha. */
const MOONLIT_SHADOW = 0.5;
/** Eclipse: how dark the world goes at full eclipse (0..1 of a full night). */
const ECLIPSE_DIM = 0.85;
/** A small fixed star field (fractions of the world rect, plus a size), seeded once. */
const STAR_N = 56;
const STARS = new Float32Array(STAR_N * 3);
{
  let x = 0x9e3779b9;
  const next = (): number => {
    x = (Math.imul(x ^ (x >>> 16), 0x45d9f3b) ^ 0x7f4a7c15) >>> 0;
    return (x >>> 8) / 0x1000000;
  };
  for (let i = 0; i < STAR_N; i++) {
    STARS[3 * i] = next();
    STARS[3 * i + 1] = next() * 0.72;
    STARS[3 * i + 2] = 0.7 + next() * 1.3;
  }
}

/** The fog's vertical band sprite: white, transparent at the bottom (near) to opaque at the top (far). */
function fogSprite(): Canvas2D {
  if (fogBand) return fogBand;
  const c = makeCanvas(4, 128);
  const g = ctx2d(c);
  const lg = g.createLinearGradient(0, 0, 0, 128);
  lg.addColorStop(0, `rgba(${FOG_RGB},1)`);
  lg.addColorStop(0.45, `rgba(${FOG_RGB},0.82)`);
  lg.addColorStop(0.8, `rgba(${FOG_RGB},0.3)`);
  lg.addColorStop(1, `rgba(${FOG_RGB},0)`);
  g.fillStyle = lg;
  g.fillRect(0, 0, 4, 128);
  fogBand = c;
  return c;
}

export type RenderScreen = 'boot' | 'title' | 'play' | 'pause' | 'dying' | 'results' | 'menu';

export interface DebugDraw {
  testPoints: boolean;
  masks: boolean;
  outlines: boolean;
}

/** The ghost-thumb hint as the halo shows it (game/assist.ts HintTracker, V1_PLAN §6.2). */
export interface HintView {
  /** Target arc center and width (degrees); NaN = none. */
  target: number;
  width: number;
  /** +1 counter-clockwise, −1 clockwise, 0 none. */
  turn: number;
  /** Ghost-thumb swipe progress 0..1, or −1 when the thumb isn't sliding. */
  phase: number;
  /** Eased visibility 0..1. */
  alpha: number;
}

/** A campaign run as the renderer sees it (session fillCampaignView): the HUD's campaign row. */
export type CampaignView = HudCampaign;

/**
 * v1.5 mechanics as the renderer sees them (session fillMech, which reads the sim and lets the test
 * hook's demos stand in for it): the frost meter, deep shade, the Cold Snap's cloud and the dial's
 * gold bud arcs.
 */
export interface MechView {
  /** The frost meter shows on this run (it has the mechanic), and its fill in snaps (1 = one ready; v1.6: up to 2). */
  meter: boolean;
  frost: number;
  /** Nubs is in deep shade now. */
  deep: boolean;
  /** The Cold Snap: the share left of the snap now (1 → 0; 0 none), and its cloud while it lives (drawn frosty, snowing). */
  snapLeft: number;
  snapCloud: Cloud | null;
  /** Angles that grow a bud now (GuideState.bud), or null. */
  bud: Uint8Array | null;
  /**
   * v1.6 Frost Bank: the meter's pips (2 with the Bank, else 1), the frost banked under the snap
   * (hundredths; paid at its end) and the saved glass waiting for the next snap (hundredths; poured
   * as it is cast). Each has its own chip.
   */
  pips: number;
  bankH: number;
  glassH: number;
  /** A missed flare's scorch: the share of the tank scorched until nightfall or a snap (0..1). */
  scorch: number;
  /** The Noon Heat is on now (a snap pours nothing). */
  noonNow: boolean;
  /** v1.6 Flow Ring: the badge's level (nubs.mult), the badge wears the charge ring, its fill 0..1 toward the next level (×5: its buffer), and it is bleeding now. */
  mult: number;
  ring: boolean;
  ringFill: number;
  bleed: boolean;
  /** v1.6 dial layers (V1_6_PLAN §4): guide.deep, guide.flake, guide.land (a snap is on) and guide.flare (a warning), null when off. */
  deepBand: Uint8Array | null;
  glass: Uint8Array | null;
  land: Uint8Array | null;
  flare: Uint8Array | null;
  /** v1.6 Heat Flare now: 0 none, 1 warning, 2 rise, 3 hold, 4 fall; the warning's share left (1 → 0), the phase's progress 0..1. */
  flarePhase: number;
  flareLeft: number;
  flareT: number;
  /** Changes whenever the run's kept flares or their outcomes do (the HUD's ruler marks). */
  flareSig: number;
  /** Outcome by flare id: 1 parried, 2 missed. */
  readonly flareOut: Map<number, number>;
  /** Noon Heat today (×H on the drain from 11 AM to 1 PM; 1 = none). */
  noonHeat: number;
  /** A demo's glass cluster (its flakes draw as glass), −1 none. */
  glassCluster: number;
}

export function createMechView(): MechView {
  return {
    meter: false, frost: 0, deep: false, snapLeft: 0, snapCloud: null, bud: null, pips: 1, bankH: 0, glassH: 0, scorch: 0, noonNow: false, mult: 1, ring: false, ringFill: 0, bleed: false,
    deepBand: null, glass: null, land: null, flare: null, flarePhase: 0, flareLeft: 0, flareT: 0, flareSig: 0, flareOut: new Map(), noonHeat: 1, glassCluster: -1,
  };
}

export interface RenderInput {
  s: SimState;
  snap: RenderSnap;
  screen: RenderScreen;
  /** Render-only Title sway added to θ (degrees). */
  sway: number;
  dragging: boolean;
  guideAlpha: number;
  hint: HintView;
  /** HUD ruler: the recent best (gold flag), the challenge target (teal flag), the next milestone (white tick); −1 = none. */
  pbMinutes: number;
  challengeMinutes: number;
  goalMinutes: number;
  /** Challenge runs: the sender's name ('' = none) on the friend's pennant. */
  challengeName: string;
  /** A campaign run (null otherwise). */
  campaign: CampaignView | null;
  /** v1.5 mechanics (frost meter, deep shade, Cold Snap, bud arcs). */
  mech: MechView;
  /** Game seconds since the death (after hit-stop), or −1. */
  dying: number;
  /** Real seconds since Results appeared, or −1. */
  mapT: number;
  sheetTop: number | null;
  time: number;
  dt: number;
  gdt: number;
  highContrast: boolean;
  reducedMotion: boolean;
  equipped: Equipped;
  /** Perf governor: soft (half-res layer) or crisp (direct fill) shadows. */
  softShadows: boolean;
  /**
   * Perf governor level 0..3 (game/perf.ts): level 2 drops the contact AO, the decor's effects and
   * the atmosphere's gradients (sun side, noon bleach, night pool); level 3 also the ground decals
   * and the forecast grade.
   */
  govLevel: number;
  /** Paused: UI timers (banners, HUD pops, halo) hold still. */
  paused: boolean;
  debug: DebugDraw | null;
}

/** All render-side state. fx.ts writes into it; the renderer reads and animates it. */
export interface RenderScene {
  view: View;
  cam: CameraFx;
  pal: Palette;
  /** The palette the ground is drawn with: quantized to 1/64 of the day, so the pre-tinted tiles
   * (ground.ts GroundPaint) are repainted about once a second, not every frame. */
  groundPal: Palette;
  ground: GroundPaint;
  /** Seeded ground decals (decor.ts) and the frame inputs handed to them. */
  decor: Decor;
  decorIn: DecorFrame;
  /** The death beat: grey-out, cool wash and the popped hat (deathbeat.ts). */
  death: DeathBeat;
  /** The moonlight shadow colour (#0A0D2A) as a palette for drawShadowLayer. */
  moonPal: Palette;
  light: Light;
  shadow: ShadowLayer;
  particles: Particles;
  rings: Rings;
  pops: Pops;
  footprints: Footprints;
  nubs: NubsAnim;
  pose: NubsPose;
  nubsSprite: NubsSprite;
  halo: HaloState;
  sun: SunGlyph;
  sunMood: SunMood;
  relief: number;
  /** Seconds left of the sun's worried look after noon has passed. */
  sunWorried: number;
  /** The text pops' eased lift (CSS px): during a flare's warning they rise clear of the dial's rims. */
  popLift: number;
  /** The edge sun's eased alpha: 0.4 while it sits over the dial's rims (Nubs by a screen edge). */
  sunAlpha: number;
  /** The biome the ground shows (1 Old Town) for day `townDay` of world `townWorld`. */
  town: number;
  townDay: number;
  townWorld: World | null;
  /** The last 16 heat-wisp spawn tries (x, y, 1 lit / 0 shaded), for the debug overlay. */
  wispTries: Float32Array;
  wispTry: number;
  hud: HudState;
  banners: Banners;
  map: MapFrame;
  /** Map pull endpoints (S, cx, cy, scx, scy). */
  mapFrom: Float64Array;
  mapTo: Float64Array;
  mapReady: boolean;
  lastTheta: number;
  thetaSpeed: number;
  /**
   * The world's animation clock (pickup twinkles, pedestal glints, Nubs' idle motion): the real
   * clock, stopped once the Results are up, so the Melt Map is a still picture of the moment Nubs
   * melted and only its puddle ring pulses.
   */
  worldTime: number;
  /** CPU ms of the last draw (debug). */
  ms: number;
  atm: Atmosphere;
  atmIn: AtmosphereIn;
  /** The friend's puddle on a challenge run: [x, y] for the score `friendFor` of world `friendWorld`. */
  friend: Float64Array;
  friendFor: number;
  friendWorld: World | null;
  /**
   * Full-viewport layers composited over the ground in the last frame (soft shadow blit, the
   * atmosphere, the Melt Map wash, the death desaturation): at most 3 (A12).
   */
  passes: number;
  /** The walking body's alpha (a fall fades it out). */
  fallA: number;
  /** The HUD's and the dial's inputs, refilled each frame (no allocation). */
  hudIn: HudInput;
  haloIn: HaloInput;
}

function moonPalette(): Palette {
  const p = createPalette();
  p.shadow = hex('#0A0D2A');
  return p;
}

export function createScene(): RenderScene {
  const pal = createPalette();
  return {
    view: createView(),
    cam: createCameraFx(),
    pal,
    groundPal: createPalette(),
    ground: createGroundPaint(),
    decor: createDecor(),
    decorIn: { time: 0, dt: 0, night: 0, effects: true },
    death: createDeathBeat(),
    moonPal: moonPalette(),
    light: createLight(pal),
    shadow: createShadowLayer(),
    particles: createParticles(),
    rings: createRings(),
    pops: createPops(),
    footprints: createFootprints(),
    nubs: createNubsAnim(),
    pose: createPose(),
    nubsSprite: createNubsSprite(),
    halo: createHalo(),
    sun: createSunGlyph(),
    sunMood: 'smug',
    relief: 0,
    sunWorried: 0,
    popLift: 0,
    sunAlpha: 1,
    town: 0,
    townDay: -1,
    townWorld: null,
    wispTries: new Float32Array(48),
    wispTry: 0,
    hud: createHud(),
    banners: createBanners(),
    map: createMapFrame(),
    mapFrom: new Float64Array(5),
    mapTo: new Float64Array(5),
    mapReady: false,
    lastTheta: NaN,
    thetaSpeed: 0,
    worldTime: 0,
    ms: 0,
    atm: createAtmosphere(),
    atmIn: createAtmosphereIn(),
    friend: new Float64Array(2),
    friendFor: -1,
    friendWorld: null,
    passes: 0,
    fallA: 1,
    haloIn: createHaloIn(),
    hudIn: {
      s: null as unknown as SimState,
      pbMinutes: -1,
      challengeMinutes: -1,
      goalMinutes: -1,
      alpha: 1,
      time: 0,
      campaign: null,
      mech: null,
      reducedMotion: false,
      hc: false,
    },
  };
}

/** The HUD's input for this frame. */
function hudInput(sc: RenderScene, inp: RenderInput, alpha: number): HudInput {
  const h = sc.hudIn;
  h.s = inp.s;
  h.pbMinutes = inp.pbMinutes;
  h.challengeMinutes = inp.challengeMinutes;
  h.goalMinutes = inp.goalMinutes;
  h.alpha = alpha;
  h.time = sc.worldTime;
  h.campaign = inp.campaign;
  h.mech = inp.mech;
  h.reducedMotion = inp.reducedMotion;
  h.hc = inp.highContrast;
  return h;
}

/** The eclipse's (and a Moonlit level's) stars over the world rect, twinkling. */
function drawStars(g: CanvasRenderingContext2D, v: View, a: number, time: number): void {
  if (a <= 0.01) return;
  g.fillStyle = '#FFFFFF';
  for (let i = 0; i < STAR_N; i++) {
    const tw = 0.55 + 0.45 * Math.sin(time * 2.4 + i * 1.7);
    g.globalAlpha = a * tw;
    const r = (STARS[3 * i + 2] as number) * 0.9;
    const x = v.vx + (STARS[3 * i] as number) * v.vw;
    const y = v.vy + (STARS[3 * i + 1] as number) * v.vh;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

export function resizeScene(sc: RenderScene, cssW: number, cssH: number, dpr: number, safe: Insets): void {
  layoutView(sc.view, cssW, cssH, dpr, safe);
}

const casterBuf: Caster[] = [];
const budBuf: Bud[] = [];
const box = new Float64Array(4);

/** Test/debug render switches (A/B checks). */
export interface RenderOptions {
  /** Draw the Melt Map overlay (off for K10 diffs). */
  mapOverlay: boolean;
  /** Composite the shadow layer with a multiply of the LUT color (the GR2 A/B reference). */
  multiplyShadows: boolean;
  /** Draw the ground decals (GR11; off for A/B timing). */
  decor: boolean;
}

export class Renderer {
  readonly scene: RenderScene;
  /** renderer.draw calls so far. */
  draws = 0;
  /**
   * The last frame was the settled Results: the Melt Map has stopped moving and no particle, pop,
   * ring or vignette is alive (only the puddle ring pulses), so the cadence may draw it at 20 fps.
   */
  settled = false;
  readonly options: RenderOptions = { mapOverlay: true, multiplyShadows: false, decor: true };
  private readonly g: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  /** A draw is in progress (left set when one threw: the next draw resets the context first). */
  private inDraw = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('Canvas 2D is not available');
    this.g = g;
    this.scene = createScene();
  }

  /**
   * Builds the play HUD's row layer for this input without drawing (the Title calls it on idle
   * frames, so the first play frame of a run doesn't pay for it).
   */
  prebuildHud(inp: RenderInput): void {
    const sc = this.scene;
    syncHud(sc.hud, sc.view, hudInput(sc, inp, 1));
  }

  /**
   * A previous draw threw midway: drop its save/clip/transform state, and mark every cached layer
   * stale, since one may have been half drawn (its key already updated). The next draw then redoes
   * that work: a one-off failure heals at once, and a persistent one fails every frame, which the
   * session turns into its crash overlay.
   */
  private recover(): void {
    this.settled = false;
    const g = this.g as CanvasRenderingContext2D & { reset?: () => void };
    if (typeof g.reset === 'function') g.reset();
    else for (let i = 0; i < 8; i++) g.restore();
    const sc = this.scene;
    sc.nubsSprite.key = Number.NaN;
    sc.hud.layer = null;
    sc.hud.badgeKey = -1;
    sc.ground.meadow.T = 0;
    sc.ground.town.T = 0;
    sc.ground.seam.T = 0;
    invalidateDecor(sc.decor);
  }

  /** Resizes the backing store (CSS size × dpr) and re-fits the view. */
  resize(cssW: number, cssH: number, dpr: number, safe: Insets): void {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    resizeScene(this.scene, cssW, cssH, dpr, safe);
    // The next frame repaints everything (a settled Results frame repaints only the map band).
    this.settled = false;
  }

  draw(inp: RenderInput): void {
    if (this.inDraw) this.recover();
    this.inDraw = true;
    this.draws++;
    const t0 = performance.now();
    const sc = this.scene;
    // Settled Results: only the map above the sheet still moves (the puddle ring), so a frame
    // repaints just that band of the world column and every other pixel keeps the frame that
    // settled (the letterbox bars and the world under the sheet are most of the canvas).
    const band = this.settled && inp.screen === 'results' && inp.sheetTop !== null;
    if (band) {
      const v = sc.view;
      // Its bottom edge sits on a whole device pixel: a part-covered row would blend a little more
      // of each frame into the last and drift.
      const bottom = Math.floor((inp.sheetTop as number) * v.dpr) / v.dpr;
      this.g.save();
      this.g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      this.g.beginPath();
      this.g.rect(v.vx, v.vy, v.vw, Math.max(0, bottom - v.vy));
      this.g.clip();
    }
    this.drawScene(inp);
    if (band) this.g.restore();
    this.settled =
      inp.screen === 'results' &&
      inp.sheetTop !== null &&
      sc.mapReady &&
      inp.mapT >= mapSettleT(inp.reducedMotion) &&
      !particlesAlive(sc.particles) &&
      !popsAlive(sc.pops) &&
      !ringsAlive(sc.rings) &&
      !vignettesOn(sc.banners);
    sc.ms = performance.now() - t0;
    this.inDraw = false;
  }

  private drawScene(inp: RenderInput): void {
    const sc = this.scene;
    const g = this.g;
    const v = sc.view;
    const s = inp.s;
    const snap = inp.snap;
    if (inp.mapT < 0) sc.worldTime = inp.time;
    const time = sc.worldTime;
    const dying = inp.dying;
    const adt = inp.dt;
    const agdt = inp.gdt;

    // ---- Time of day, palette and light -----------------------------------------------------
    const dl = dayTicks(snap.day);
    const nt = nightTicks(snap.day);
    let dayFrac = Math.min(1, snap.dayTick / dl);
    let night = 0;
    // The ground's biome is the day's plan; past midnight it is already tomorrow's (A9).
    let planDay = snap.day;
    if (snap.dayTick > dl) {
      const tn = (snap.dayTick - dl) / 60;
      const nl = nt / 60;
      night = smooth(Math.min(1, tn / 1.5)) * (1 - smooth(Math.max(0, (tn - (nl - 1.5)) / 1.5)));
      if (tn > nl / 2) {
        dayFrac = 0;
        planDay = snap.day + 1;
      }
    }
    if (planDay !== sc.townDay || s.world !== sc.townWorld) {
      sc.town = worldPlan(s.world, planDay).biome === 'oldtown' ? 1 : 0;
      sc.townDay = planDay;
      sc.townWorld = s.world;
    }
    const town = sc.town;
    // Campaign concepts (v1.2): a Moonlit level is a night run under a moon sun (the night palette
    // with the sun's own shadows); an eclipse dims the day toward night while it lasts.
    const moonlit = s.moonlit;
    const eclipse = s.eclipse;
    if (moonlit) night = 1;
    else if (eclipse > night / ECLIPSE_DIM) night = eclipse * ECLIPSE_DIM;
    const fog = s.mods.has('fog');
    // A Journey chapter has its own season and light (palette.ts themes).
    const theme = themeFor(s.level?.chapter);
    updatePalette(sc.pal, dayFrac, night, town, inp.highContrast, theme);
    // The ground steps through the day in 1/64ths (≈ 0.8 s): a 1-3 level change at most.
    updatePalette(sc.groundPal, Math.round(dayFrac * 64) / 64, Math.round(night * 16) / 16, town, inp.highContrast, theme);
    const theta = snap.theta + inp.sway;
    const ux = Math.cos(theta * DEG);
    const uy = Math.sin(theta * DEG);
    const sunUp = snap.eps > 0;
    const L = sc.light;
    L.ux = ux;
    L.uy = uy;
    L.sunUp = sunUp;
    L.elev = sunUp ? Math.min(1, (snap.eps - 6) / Math.max(1, s.params.epsNoon - 6)) : 0;
    L.nubsX = snap.nubsX;
    L.nubsY = snap.nubsY;
    L.time = time;
    L.theta = theta;

    // Photosensitivity: ease the shadow layer down during very fast sweeps (> 300°/s).
    if (Number.isFinite(sc.lastTheta) && adt > 0) {
      let d = theta - sc.lastTheta;
      d -= Math.round(d / 360) * 360;
      sc.thetaSpeed += (Math.abs(d) / adt - sc.thetaSpeed) * Math.min(1, adt * 20);
    }
    sc.lastTheta = theta;
    const baseAlpha = sc.pal.shadowAlpha;
    const targetAlpha = sc.thetaSpeed > 300 ? baseAlpha * 0.72 : baseAlpha;
    sc.shadow.alpha += (targetAlpha - sc.shadow.alpha) * Math.min(1, adt / 0.04);
    if (!Number.isFinite(sc.shadow.alpha) || adt <= 0) sc.shadow.alpha = targetAlpha;

    // ---- Camera ------------------------------------------------------------------------------
    // Shake and zoom pulses run on real time (slow-mo doesn't stretch them); none under reduced motion.
    sc.cam.reducedMotion = inp.reducedMotion;
    updateCameraFx(sc.cam, adt);
    const trial = s.trial;
    setPlayCamera(v, sc.cam, snap.nubsX, snap.nubsY);
    const nubsSX = v.nx;
    const nubsSY = v.ny;
    if (inp.mapT >= 0 && inp.sheetTop !== null) {
      if (!sc.mapReady) {
        frameDeath(sc.map, s);
        sc.mapFrom[0] = v.S;
        sc.mapFrom[1] = snap.nubsX;
        sc.mapFrom[2] = snap.nubsY;
        sc.mapFrom[3] = nubsSX;
        sc.mapFrom[4] = nubsSY;
        sc.mapReady = true;
      }
      mapTarget(v, sc.map, v.safe.top + 8, inp.sheetTop, sc.mapTo);
      applyPull(v, sc.mapFrom, sc.mapTo, inp.reducedMotion ? 1 : inp.mapT / MAP_PULL_S);
    } else {
      sc.mapReady = false;
    }

    // ---- Animate render-side state ----------------------------------------------------------
    const gdt = agdt;
    updateParticles(sc.particles, gdt, snap.nubsX, snap.nubsY, v.cssH);
    updateRings(sc.rings, gdt);
    const udt = inp.paused ? 0 : adt;
    updatePops(sc.pops, udt);
    updateHud(sc.hud, udt);
    // A Trial's cues read health where Nubs' read Chill.
    const hp = trial ? (100 * snap.chill) / s.nubs.maxChill : 0;
    const chillCue = trial ? hp : snap.chill;
    updateBanners(sc.banners, udt, s.phase === 'day' && chillCue < 25 && dying < 0);
    // Nubs stands still through the start beat (the clock waits; the sun already moves).
    const walking = (s.phase === 'day' || s.phase === 'night') && s.ready === 0 && dying < 0;
    updateNubsAnim(sc.nubs, gdt, v.ox + snap.nubsX * v.S, v.S, walking, s.params.v);
    // The hot ring: Nubs in the sun; on a Trial the walker not safe.
    const hot = trial ? !s.nubs.safe : s.nubs.f > 0;
    // A held sun (Drip's and Gust's legs) takes no drag: no detent ticks or arrow, even with a finger down.
    const dragging = inp.dragging && !(trial && s.sun.locked);
    updateHalo(sc.halo, udt, dragging, chillCue, s.sun.dTheta, walking && sunUp && hot && inp.screen === 'play', inp.mech.deep && walking);
    sc.relief = Math.max(0, sc.relief - adt);
    sc.sunWorried = Math.max(0, sc.sunWorried - adt);
    if (inp.screen === 'play' && walking) {
      stepFootprints(sc.footprints, snap.nubsX, snap.nubsY, trailSlope(s.world.trail, snap.nubsY), s.nubs.f === 0, gdt);
    } else {
      stepFootprints(sc.footprints, snap.nubsX, snap.nubsY, 0, true, gdt);
    }

    // ---- Draw ------------------------------------------------------------------------------
    sc.passes = 0;
    g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    drawBars(g, v, sc.pal, s.world);
    g.save();
    g.beginPath();
    g.rect(v.vx, v.vy, v.vw, v.vh);
    g.clip();

    drawGround(g, v, sc.groundPal, sc.ground, s.world);
    drawTrail(g, v, s.world, sc.groundPal);
    const di = sc.decorIn;
    di.time = time;
    // Steam only while a run plays: elsewhere it would keep the Results from ever settling.
    di.dt = inp.screen === 'play' ? agdt : 0;
    di.night = night;
    di.effects = inp.govLevel < 2;
    // Governor level 3 (the slowest devices) drops the ground decals altogether.
    if (this.options.decor && inp.govLevel < 3) drawDecor(g, v, sc.decor, s, sc.particles, biomeSeamIn(s.world, v.y0 - 40, v.y1 + 40), di);
    else sc.decor.drawn = 0;
    drawFootprints(g, sc.footprints, v, sc.pal);
    // A Trial's ground objects (under the shadow layer, so shade falls on them).
    drawElGround(g, v, s);
    if (trial !== null && trial.relays.length > 0) drawTagStones(g, v, s);
    // A challenge run: the friend's puddle where the sender melted.
    const friend = s.cfg.mode === 'challenge' && inp.challengeMinutes >= 0;
    if (friend) {
      if (sc.friendFor !== inp.challengeMinutes || sc.friendWorld !== s.world) {
        friendSpot(s.world, inp.challengeMinutes, sc.friend);
        sc.friendFor = inp.challengeMinutes;
        sc.friendWorld = s.world;
      }
      drawFriendPuddle(g, v, sc.friend[0] as number, sc.friend[1] as number);
    }
    drawPickups(g, v, s.world, time, snap.nubsY, night, inp.mech.glassCluster);
    if (sunUp && moonlit) {
      // The moon sun's shadows: the sim's own geometry in the moonlight colour.
      if (drawShadowLayer(g, sc.shadow, v, s.world, sc.moonPal, sc.groundPal.ground, ux, uy, snap.cot, snap.tAbs, MOONLIT_SHADOW * (1 - eclipse), inp.softShadows, false)) {
        sc.passes++;
      }
    } else if (sunUp) {
      const multiply = this.options.multiplyShadows;
      if (drawShadowLayer(g, sc.shadow, v, s.world, sc.pal, sc.groundPal.ground, ux, uy, snap.cot, snap.tAbs, sc.shadow.alpha, inp.softShadows, multiply)) {
        sc.passes++;
      }
    } else if (night > 0.05) {
      // Moonlight (GR16): soft indigo shadows thrown the other way (θ + 180°), long and low. Chill
      // ignores them; the dial stays hidden at night.
      if (drawShadowLayer(g, sc.shadow, v, s.world, sc.moonPal, sc.groundPal.ground, -ux, -uy, MOON_COT, snap.tAbs, 0.32 * night, inp.softShadows, false)) {
        sc.passes++;
      }
    }
    // A Trial's walls stand over the shade, under the casters and the walker.
    drawElWalls(g, v, s, time, inp.reducedMotion);
    // Visible casters, far (north) first: contact shadows now (over the shadow layer, so its matched
    // source-over fill stays exact), the depth sort below.
    // (A campaign level's finish banner is a world caster of kind 'finish'; casters.ts draws it.)
    let n = queryCasters(s.world, v.y0 - 130, v.y1 + 40, casterBuf);
    if (inp.govLevel < 2) drawContactAO(g, v, casterBuf, n, night);
    const glows = night > 0.05 && inp.govLevel < 2;
    if (glows) drawWindowGlow(g, v, casterBuf, n, night);

    // Nubs' pose (needed for the footprint disc and the depth sort).
    const pose = sc.pose;
    pose.x = v.ox + snap.nubsX * v.S;
    pose.y = v.oy - snap.nubsY * v.S;
    pose.S = v.S;
    pose.chill = Math.max(0, Math.min(1, snap.chill / s.nubs.maxChill));
    pose.w0 = s.nubs.w[0] as number;
    pose.w1 = s.nubs.w[1] as number;
    pose.w2 = s.nubs.w[2] as number;
    pose.w3 = s.nubs.w[3] as number;
    pose.w4 = s.nubs.w[4] as number;
    pose.f = s.nubs.f;
    pose.sunX = ux;
    pose.sunY = -uy;
    lookAt(sc.nubs, s, snap.nubsX, snap.nubsY, ux, -uy, sunUp && walking && s.nubs.f === 0, gdt);
    pose.lookX = sc.nubs.lookX;
    pose.lookY = sc.nubs.lookY;
    pose.sunUp = sunUp;
    pose.walking = walking;
    pose.night = night;
    pose.time = time;
    pose.melt = dying;
    pose.shade = sc.pal.nubsShade;
    pose.reducedMotion = inp.reducedMotion;
    // Elementals: which element fell, and the walker's state.
    const who: HeroId = s.death?.who ?? s.nubs.hero;
    if (trial) heroPose(pose, s, s.nubs, hp, snap.chill, inp.highContrast);
    if ((inp.screen === 'title' || s.phase === 'hold') && sunUp) {
      // The Title sway is render-only and the sim is held, so read Nubs' shade at the swaying sun
      // from the guide's lit counts: he cools while the sun sits in the teal arc and warms outside
      // it, which is the whole game in one look.
      const lit = s.guide.lit[(((Math.round(theta) % 360) + 360) % 360)] as number;
      const w = lit > 0 ? 1 : 0;
      pose.w0 = pose.w1 = pose.w2 = pose.w3 = pose.w4 = w;
      pose.f = lit / 5;
    }

    drawOwnShadow(g, pose, sc.pal.shadow, sc.pal.shadowAlpha);
    drawFootprintDisc(g, pose, sc.pal.trail);
    if (glows) {
      // Moonlight rim under Nubs.
      const rr = 26 * v.S;
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = night;
      moonRim ??= radialSprite('191,211,255', 64, 0.18, 0.5, 0.08);
      g.drawImage(moonRim, pose.x - rr, pose.y - rr, 2 * rr, 2 * rr);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    // v1.5 closed buds, with the ground (they are short; a bloomed one is its sunflower caster).
    const budN = s.world.buds ? queryBuds(s.world, v.y0 - 40, v.y1 + 40, budBuf) : 0;
    const budsGrow = !s.world.v16?.bank || snap.chill >= coolLine(s.nubs.maxChill);
    for (let i = budN - 1; i >= 0; i--) {
      const b = budBuf[i] as Bud;
      if (b.state === 0 && b.x > v.x0 - 40 && b.x < v.x1 + 40) drawBud(g, v, L, b, night, budsGrow);
    }
    if (sunUp) drawGlare(g, v, s.world, ux, uy, snap.cot, snap.eps, time);
    drawGroundParticles(g, sc.particles, v);
    drawRings(g, sc.rings, v);

    // Depth-sorted objects, far (north) first, with Nubs inserted at his y.
    const looks = looksFor(inp.equipped);
    // A trial's layers redraw at most 10 times a second (≤ 12/s).
    sc.nubsSprite.cap = trial ? 0.1 : 0;
    // A fall into a gap (or a stream sweeping the walker away) is drawn on the living sprite: it
    // shrinks, drops (or slides off) and fades out.
    const fall = dying >= 0 ? (s.death?.heroCause ?? '') : '';
    const fell = fall === 'fall' || fall === 'swept';
    if (fell) pose.melt = -1;
    renderNubsSprite(sc.nubsSprite, pose, sc.nubs, looks, v.S * v.dpr, trial ? heroArt(s.nubs.hero) : null);
    sc.fallA = 1;
    if (fell) {
      const e = Math.min(1, dying / 0.7);
      const sp = sc.nubsSprite;
      sp.sx *= 1 - 0.8 * e;
      sp.sy *= 1 - 0.8 * e;
      if (fall === 'fall') sp.dy -= e * 12 * v.S;
      else sp.jx += e * 36 * v.S;
      sc.fallA = 1 - e;
    }
    const beat = sc.death;
    if (dying >= 0 && beat.t < 0) startDeathBeat(beat, snap.nubsX, snap.nubsY, ux, looks, v.S * v.dpr, trial ? who : 'nubs');
    else if (beat.t >= 0) beat.t += adt;
    nubsBox(pose.x, pose.y, v.S, box);
    let nubsDrawn = false;
    let occluded = false;
    // v1.5 buds (closed ones; a bloomed bud is its sunflower caster) join the depth sort.
    for (let i = n - 1; i >= 0; i--) {
      const c = casterBuf[i] as Caster;
      if (c.maxX < v.x0 - 40 || c.minX > v.x1 + 40) continue;
      if (!nubsDrawn && c.y < snap.nubsY) {
        drawBodies(g, sc, v.dpr);
        nubsDrawn = true;
      }
      drawCaster(g, v, L, c);
      if (nubsDrawn && !occluded) {
        // Screen bounds of the caster (its top rises 0.25·maxZ; canopies spread wider).
        const sx0 = v.ox + c.minX * v.S;
        const sx1 = v.ox + c.maxX * v.S;
        const syTop = v.oy - (c.maxY + 0.25 * c.maxZ) * v.S;
        const syBot = v.oy - c.minY * v.S;
        occluded = sx1 > (box[0] as number) && sx0 < (box[2] as number) && syBot > (box[1] as number) && syTop < (box[3] as number);
      }
    }
    if (!nubsDrawn) drawBodies(g, sc, v.dpr);
    else if (occluded) {
      // X-ray: Nubs stays readable through whatever stands in front of him.
      g.globalAlpha = 0.62;
      drawBodies(g, sc, v.dpr);
      g.globalAlpha = 1;
    }

    // Market days string bunting over the street (the forecast's signature; no shadow).
    if (this.options.decor) drawBunting(g, v, s.world, 1 - 0.6 * night);
    if (friend) drawFriendPennant(g, v, sc.friend[0] as number, sc.friend[1] as number, inp.challengeName);
    if (inp.screen !== 'title') {
      // Nubs sizzles in the sun; Ember smokes out of the light.
      if (s.nubs.hero === 'nubs') drawSizzle(g, pose, time, s.nubs.glare > 0);
      else if (s.nubs.hero === 'ember' && !s.nubs.safe) drawSizzle(g, pose, time, false, true);
    }
    drawHatPop(g, v, beat, inp.reducedMotion);
    drawClouds(g, v, s.world, snap.tAbs, nubsSX, nubsSY - 12 * v.S, night, inp.mech.snapCloud, ux, uy, snap.cot);
    drawElAir(g, v, s, time, inp.reducedMotion);
    drawAirParticles(g, sc.particles, v);
    if (s.sun.gust !== 0 || sc.particles.count > 0) drawGustStreaks(g, sc.particles);
    if (fog && inp.mapT < 0) {
      // Fog: the world fades out between FOG_NEAR and FOG_FAR u ahead and is gone beyond (one
      // cached band sprite stretched over the fade, a flat fill above it).
      const yNear = v.oy - (snap.nubsY + FOG_NEAR) * v.S;
      const yFar = v.oy - (snap.nubsY + FOG_FAR) * v.S;
      g.globalAlpha = FOG_ALPHA * (1 - 0.5 * night);
      if (yFar > v.vy) {
        g.fillStyle = `rgb(${FOG_RGB})`;
        g.fillRect(v.vx, v.vy, v.vw, yFar - v.vy + 0.5);
      }
      if (yNear > v.vy) g.drawImage(fogSprite(), v.vx, yFar, v.vw, yNear - yFar);
      g.globalAlpha = 1;
    }
    // The death beat drains the world to grey around the puddle (full rendering quality only, A12).
    const grey = greyOf(beat, inp.mapT < 0 ? -1 : inp.mapT / MAP_PULL_S);
    if (grey > 0.005 && inp.govLevel === 0 && v.dpr <= 2) {
      drawGrey(g, v, beat, grey);
      sc.passes++;
    }

    // The atmosphere: sun-side light, noon bleach, night pool and the edge vignettes in one layer.
    // On the Results the Melt Map's wash takes its place.
    if (inp.mapT < 0) {
      const at = sc.atmIn;
      const b = sc.banners;
      at.ux = ux;
      at.uy = uy;
      at.elev = L.elev;
      at.dayFrac = dayFrac;
      at.night = night;
      at.nubsX = pose.x;
      at.nubsY = pose.y;
      at.heat = b.heat;
      at.heatPhase = b.heatPhase;
      at.cool = b.coolPulse;
      at.gold = b.goldPulse;
      at.wash = 0.08 * grey;
      at.forecast = s.params.forecast;
      at.tint = theme.grade;
      at.tintA = inp.highContrast ? 0 : theme.gradeA;
      at.full = inp.govLevel < 2;
      at.grade = inp.govLevel < 3;
      if (drawAtmosphere(g, sc.atm, v, at)) sc.passes++;
      // Stars: through the eclipse, and all along a Moonlit level.
      drawStars(g, v, moonlit ? 0.75 : eclipse, time);
    } else if (sc.mapReady && this.options.mapOverlay) {
      const o = mapAlphas(inp.mapT, inp.reducedMotion, mapOverlay);
      o.sheetTop = inp.sheetTop;
      o.time = inp.time;
      if (drawMeltMap(g, v, s, sc.map, o)) sc.passes++;
    }

    // A Trial's telegraphs, over the world (canopies and clouds included) and under the dial.
    if (inp.mapT < 0 && (inp.screen === 'play' || inp.screen === 'pause')) drawElCues(g, v, s, time, inp.reducedMotion, inp.highContrast, inp.dragging, sc.hud.bottom + 6);
    // Debug geometry.
    if (import.meta.env.MODE !== 'single' && inp.debug) drawDebug(g, v, s, inp.debug, ux, uy, snap.cot, snap.tAbs, pose, sc.wispTries);

    // Halo dial (play/title; fades out on death and under the map).
    const showHalo = inp.mapT < 0 && (inp.screen === 'play' || inp.screen === 'pause' || inp.screen === 'title' || inp.screen === 'dying');
    if (showHalo) {
      const fade = dying >= 0 ? Math.max(0, 1 - dying / 0.3) : inp.screen === 'title' ? 0.75 : 1;
      const hi = sc.haloIn;
      hi.cx = pose.x;
      hi.cy = pose.y;
      hi.R = 40 * v.S;
      hi.theta = theta;
      hi.dragging = dragging;
      hi.dTheta = s.sun.dTheta;
      // An element's gauge reads its health.
      const heroGauge = trial !== null && s.nubs.hero !== 'nubs';
      hi.chill = heroGauge ? hp : snap.chill;
      hi.maxChill = heroGauge ? 100 : s.nubs.maxChill;
      hi.sunUp = sunUp;
      hi.guideAlpha = inp.guideAlpha;
      hi.now = s.guide.now;
      hi.next = s.guide.next;
      hi.glare = s.guide.glare;
      hi.fade = fade;
      hi.time = time;
      hi.hintTarget = inp.hint.target;
      hi.hintWidth = inp.hint.width;
      hi.hintTurn = inp.hint.turn;
      hi.hintPhase = inp.hint.phase;
      hi.hintAlpha = inp.screen === 'play' || inp.screen === 'pause' ? inp.hint.alpha : 0;
      hi.reducedMotion = inp.reducedMotion;
      hi.blind = s.mods.has('blind');
      hi.hideNext = fog;
      hi.locked = s.sun.locked;
      // A Trial's bud arcs show while Nubs or Sprout walks.
      hi.bud = inp.screen === 'title' || (trial !== null && s.nubs.hero !== 'nubs' && s.nubs.hero !== 'sprout') ? null : inp.mech.bud;
      hi.deep = inp.mech.deep;
      hi.mech = inp.screen === 'title' ? null : inp.mech;
      hi.lockSoon = !s.sun.locked && s.phase === 'day' && s.ready === 0 && s.mods.has('lock') && sunLockedAt(s.dayTick + LOCK_WARN_TICKS);
      hi.trial = trial ? s : null;
      hi.hc = inp.highContrast;
      drawHalo(g, sc.halo, hi);
    }
    g.restore();

    // During a flare's warning the pops (lowest at z 120, 30 u up) rise clear of the countdown at
    // R + 25 (their centres from R + 40), so a +5 never sits on the parry arc.
    const lift = inp.mech.flarePhase === 1 && inp.screen !== 'title' ? 10 * v.S + 40 : 0;
    sc.popLift += (lift - sc.popLift) * Math.min(1, adt * 12);
    drawPops(g, sc.pops, v, hudScale(v), snap.nubsX, snap.nubsY + hopLift(sc.nubs, inp.reducedMotion), sc.popLift, inp.highContrast);

    // Edge sun mascot (decoration), kept below the HUD band.
    if (inp.mapT < 0 && inp.screen !== 'title' && inp.screen !== 'menu') {
      const scale = hudScale(v) * 0.9;
      sc.sun.night += ((sunUp ? 0 : 1) - sc.sun.night) * Math.min(1, adt * 2);
      sc.sun.squash = Math.max(0, sc.sun.squash - adt);
      if (dying >= 0) sc.sun.guilty = Math.min(1, sc.sun.guilty + adt * 3);
      else sc.sun.guilty = Math.max(0, sc.sun.guilty - adt * 3);
      placeSun(sc.sun, v, pose.x, pose.y - 10 * v.S, ux, -uy, adt, v.safe.top + 84);
      // Never over the frost meter (bottom right): the sun slides up above its pips and chips.
      const hd = sc.hud;
      if (hd.meterShown) {
        const mr = 26 * scale;
        const top = hd.meterY - hd.meterR - 40 * scale - mr;
        if (sc.sun.y > top && Math.abs(sc.sun.x - hd.meterX) < hd.meterSpan + hd.meterR + mr) sc.sun.y = top;
      }
      // Over the dial (its rims reach R + 30; Nubs by a screen edge) the sun steps back to 40 %, so
      // it never hides the sun pointer or the flare arc under it.
      const over = Math.hypot(sc.sun.x - pose.x, sc.sun.y - pose.y) < 40 * v.S + 30 + 24 * scale;
      sc.sunAlpha += ((over ? 0.4 : 1) - sc.sunAlpha) * Math.min(1, adt * 8);
      // Around noon the sun is the boss (unless Nubs is nearly gone: then it is horrified).
      const boss = sunUp && night === 0 && !moonlit ? bossWeight(dayFrac, s.params.forecast === 'heat') : 0;
      let mood: SunMood;
      if (dying >= 0) mood = 'guilty';
      else if (sc.relief > 0) mood = 'relief';
      else if (chillCue < 30) mood = 'horrified';
      else if (sc.sunWorried > 0) mood = 'worried';
      else if (boss > 0.6) mood = 'boss';
      else mood = chillCue >= 60 ? 'smug' : 'worried';
      sc.sunMood = mood;
      drawSun(g, sc.sun, mood, time, scale, sc.sunAlpha, sc.sun.x < pose.x ? -1 : 1, boss, looksFor(inp.equipped).shades, moonlit, eclipse);
      if (inp.mech.flarePhase > 0) drawFlareCue(g, sc.sun, scale, inp.mech.flarePhase, inp.mech.flareLeft, inp.mech.flareT, time, inp.reducedMotion, sc.sunAlpha);
      // A relay's telegraph: "NEXT ▸ EMBER 3" under the dial (over it while the sun is below), over the sun.
      const tag = trial && inp.screen === 'play' && dying < 0 ? tagSoon(s) : null;
      const hh = sc.haloIn;
      const side = sc.sun.y > hh.cy ? -1 : 1;
      if (tag) drawNextChip(g, tag, nextTagTicks(s), hh.cx, hh.cy + side * (hh.R + 26), scale / 0.9, side);
    }

    // HUD.
    const hudVisible = inp.screen === 'play' || inp.screen === 'pause' || inp.screen === 'dying';
    if (hudVisible) {
      // Under 672 px a level's pause card rises onto the HUD row (pause.css), so the row steps back.
      const a = dying >= 0 ? Math.max(0, 1 - dying / 0.4) : inp.screen === 'pause' && v.cssH < 672 ? 0.3 : 1;
      drawHud(g, sc.hud, v, hudInput(sc, inp, a));
    } else {
      sc.hud.meterShown = false;
    }
    // Toasts, stamps and cards are play's alone: a pause card never sits over a live tip (their timers hold).
    if (inp.screen === 'play') drawBanners(g, sc.banners, v, sc.hud.bottom, hudScale(v), inp.reducedMotion, inp.highContrast);
    drawScreenParticles(g, sc.particles, v.dpr);
    g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  }
}

const mapOverlay: MapOverlay = { a: 0, labelA: 0, sheetTop: null, time: 0 };
/** A Trial walker's pose fields (render/heroes.ts reads them): health, lit sum, safe, meter, high contrast, how it fell. */
function heroPose(p: NubsPose, s: SimState, nb: NubsState, hp: number, meter: number, hc: boolean): void {
  p.chill = Math.max(0, Math.min(1, hp / 100));
  p.c = nb.c;
  p.safe = nb.safe;
  p.meter = meter / 100;
  p.hc = hc;
  p.cause = s.death?.heroCause ?? '';
  const el = s.el as ElState;
  const h = nb.hero;
  const t = el.touch;
  p.act = h === 'sprout' ? +(el.hold >= 0) : h === 'gust' ? (t & 2 ? 1 : t & 4 ? 2 : 0) : t & 3;
  p.lean = Math.max(-1, Math.min(1, h === 'gust' ? windAt(s) / 45 : (el.dxTarget - el.dx) / 10));
}

/** Stamps the walking body. */
function drawBodies(g: CanvasRenderingContext2D, sc: RenderScene, dpr: number): void {
  const a = g.globalAlpha;
  g.globalAlpha = a * sc.fallA;
  drawNubsSprite(g, sc.nubsSprite, sc.pose.x, sc.pose.y, dpr);
  g.globalAlpha = a;
}
const pickBuf: Pickup[] = [];

/**
 * Eases Nubs' face toward what he looks at (8/s; the sprite quantizes it to 5° steps): the sun,
 * or, while he walks in full shade, the nearest flake or crystal within 70 u ahead.
 */
function lookAt(a: NubsAnim, s: SimState, nx: number, ny: number, sunX: number, sunY: number, shaded: boolean, dt: number): void {
  let tx = sunX;
  let ty = sunY;
  if (shaded) {
    const n = queryPickups(s.world, ny, ny + 70, pickBuf);
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const pk = pickBuf[i] as Pickup;
      if (pk.state !== PICKUP_ALIVE || pk.kind === 'flower') continue;
      const dx = pk.x - nx;
      const dy = pk.y - ny;
      const d = dx * dx + dy * dy;
      if (d < best && d > 1 && d <= 70 * 70) {
        best = d;
        tx = dx;
        ty = -dy;
      }
    }
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
  }
  const k = dt > 0 ? Math.min(1, 8 * dt) : 0;
  let lx = a.lookX + (tx - a.lookX) * k;
  let ly = a.lookY + (ty - a.lookY) * k;
  const len = Math.hypot(lx, ly);
  if (len < 1e-3) {
    lx = tx;
    ly = ty;
  } else {
    lx /= len;
    ly /= len;
  }
  a.lookX = lx;
  a.lookY = ly;
}

function particlesAlive(p: Particles): boolean {
  const life = p.life;
  for (let i = 0; i < p.cap; i++) if ((life[i] as number) > 0) return true;
  return false;
}

function popsAlive(p: Pops): boolean {
  for (let i = 0; i < p.dur.length; i++) if ((p.dur[i] as number) > 0) return true;
  return false;
}

function ringsAlive(r: Rings): boolean {
  for (let i = 0; i < r.dur.length; i++) if ((r.dur[i] as number) > 0) return true;
  return false;
}

function vignettesOn(b: Banners): boolean {
  return b.heat > 0.01 || b.coolPulse > 0 || b.goldPulse > 0;
}

function smooth(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}


function drawDebug(
  g: CanvasRenderingContext2D,
  v: View,
  s: SimState,
  d: DebugDraw,
  ux: number,
  uy: number,
  cot: number,
  tAbs: number,
  pose: NubsPose,
  wisps: Float32Array,
): void {
  if (d.outlines && cot > 0) {
    g.strokeStyle = 'rgba(255,0,180,0.8)';
    g.lineWidth = 1;
    g.beginPath();
    traceShadows(g, v, s.world, ux, uy, cot, tAbs);
    g.stroke();
  }
  if (d.testPoints) {
    for (let k = 0; k < 5; k++) {
      const w = s.nubs.w[k] as number;
      const x = v.ox + (s.nubs.x + (SAMPLE_DX[k] as number)) * v.S;
      const y = v.oy - (s.nubs.y + (SAMPLE_DY[k] as number)) * v.S;
      g.fillStyle = w === 0 ? '#2EC4B6' : w === 1 ? '#FFC23D' : '#FF3D3D';
      g.strokeStyle = '#2B2140';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, 2.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // Heat-wisp spawn tries: amber where the ground was lit (a wisp rose), teal where it was shaded.
    for (let i = 0; i < wisps.length; i += 3) {
      const x = wisps[i] as number;
      const y = wisps[i + 1] as number;
      if (x === 0 && y === 0) continue;
      g.fillStyle = wisps[i + 2] === 1 ? '#FF8A3D' : '#2EC4B6';
      g.beginPath();
      g.arc(v.ox + x * v.S, v.oy - y * v.S, 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (d.masks) {
    // Lit counts per bin as a ring of ticks (teal = shaded, amber = partly, red = glare).
    const R = 52 * v.S;
    for (let b = 0; b < 360; b += 2) {
      const lit = s.guide.lit[b] as number;
      const a = -b * DEG;
      g.strokeStyle = s.guide.glare[b] ? '#FF3D3D' : lit === 0 ? '#2EC4B6' : cssa(0x2b2140, 0.15 + 0.06 * lit);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(pose.x + Math.cos(a) * R, pose.y + Math.sin(a) * R);
      g.lineTo(pose.x + Math.cos(a) * (R + 6), pose.y + Math.sin(a) * (R + 6));
      g.stroke();
    }
  }
}
