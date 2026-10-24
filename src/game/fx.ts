// FX router (GDD §11 juice list, V1_PLAN changes): SimEvents → particles, rings, text pops, HUD and
// banner timers, Nubs' reactions, camera shake/zoom, slow-mo and hit-stop; plus the continuous
// effects (steam while lit, sweat below 60 Chill, frost sparkles in shade, fireflies at night).
// Particles are render-only and may use Math.random.
// v1.5: a bud's growth sparkles, the bloom (the sunflower pops up: render/flora.ts), the frost
// meter filling, the Cold Snap (COLD SNAP!, an ice ring, snow falling from its cloud) and deep
// shade (DEEP, at most every DEEP_POP_GAP s).
// v1.6: the ring's tricks flash it (the run's first pops "+RING") and losing ×5 shakes the badge;
// frost gains pop beside Nubs ("+0.3", the run's first "+0.3 snap"), a spill shakes the meter, a
// cash-in pours from the badge into it; LANDING!, GLASS SAVED!, the PARRY! stamp, a flare's miss,
// a Dare met (DARE ✓); the Day card names the day's Noon Heat when it rises.
// Elementals: the TAG! stamp in the incoming element's face with a hop and 0.3 s of slow-mo,
// CLEAN!, an element's fall. The snowman's steam, sweat, breath and frost stay his: an element's
// states show in its art. v2 (docs/ELEMENTALS_V2.md §7.10): a fire's sparks (water for ice and
// puddles), ash and steam puffs, Ember feeding ("+n"), a grey puff for a refused verb, BUMP!, a hold's
// ring, BRIDGE!/TREE!, Drip's splash ("+30"), a hot stone's steam or sparks, a gust's wind streaks
// (none under reduced motion); no zoom pulses while another element walks (§1.4).

import { cloudCenter, cloudOffset, dayParams, dayTicks, HEROES, noonHeatAt, worldPlan, type SimEvent, type SimState } from '../core/index.ts';
import { pointLitWeight } from '../core/sim/pickups.ts';
import {
  addHeadline,
  addPlus,
  addPop,
  addRing,
  addSwing,
  P_BREATH,
  P_BURST,
  P_CONFETTI,
  P_DRIP,
  P_FIREFLY,
  P_FLAKE_FLY,
  P_FROST,
  P_GLINT,
  P_GUST,
  P_LEAF,
  P_PETAL,
  P_PUFF,
  P_SNOW,
  P_SNOWFALL,
  P_SPARKLE,
  P_STEAM,
  P_WISP,
  POP_BANG,
  POP_DEEP,
  POP_GO,
  POP_MULT,
  POP_PHEW,
  POP_SNAP,
  POP_SWING,
  spawn,
} from '../render/particles.ts';
import { flashDetent, heroArcColor, SWING_ARC_S } from '../render/halo.ts';
import { POUR_S, RING_FLASH_S, snapsText, SPILL_S } from '../render/hud.ts';
import { hop } from '../render/nubs.ts';
import { showDayCard, showNightCard, showStamp, STAMP_IN, type StampKind } from '../render/banners.ts';
import type { FaceName } from '../render/candy.ts';
import type { MechView, RenderScene } from '../render/renderer.ts';
import type { Cloud } from '../core/index.ts';
import { registerBloom, resetBlooms } from '../render/flora.ts';
import { SNAP_LIFT } from '../render/clouds.ts';
import { themeFor } from '../render/palette.ts';
import { bossWeight } from '../render/sun.ts';
import { addShake, addZoomPulse, holdZoom, OBLIQUE } from './camera.ts';
import type { FixedClock } from './loop.ts';

const MULT = ['×1', '×1', '×2', '×3', '×4', '×5'];
const FIREFLIES = 14;
const FROST: number = 0xe6f6ff;
const HOT: number = 0xff6a3d;
const TEAL: number = 0x2ec4b6;
const GOLD: number = 0xffd36b;
const SUN_GOLD: number = 0xffc23d;
const ICE: number = 0x5ab8ff;
const EMBER: number = 0xff8a1f;
const LIME: number = 0x8bd650;
const ASH: number = 0x8c8c8c;
/** A DEEP pop shows at most this often (s). */
const DEEP_POP_GAP = 4;
/** Snow falling from the Cold Snap's cloud: flakes per second, and how long one takes to land (s). */
const SNOWFALL_RATE = 22;
const SNOWFALL_S = 1.3;
const CONFETTI: readonly number[] = [0xff5d5d, 0xffc23d, 0x2ec4b6, 0x5ab8ff, 0x9b5de5, 0xff9eb0, 0xffffff];
const PETALS: readonly number[] = [0xffd6e0, 0xffe8c2, 0xfff4dc, 0xffb3c6, 0xffc9a3];
const LEAVES: readonly number[] = [0x7cb342, 0x9ccc65, 0xc0ca33, 0xf9a825, 0x8bc34a];

/** Live particles of one kind. */
function countKind(p: { cap: number; kind: Uint8Array; life: Float32Array }, kind: number): number {
  let n = 0;
  for (let i = 0; i < p.cap; i++) if (p.kind[i] === kind && (p.life[i] as number) > 0) n++;
  return n;
}

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export class Fx {
  private readonly sc: RenderScene;
  private readonly clock: FixedClock;
  reducedMotion = false;
  private steamAcc = 0;
  private sweatAcc = 0;
  private frostAcc = 0;
  private breathAcc = 0;
  private wispAcc = 0;
  private leafAcc = 0;
  private glintAcc = 0;
  private gustAcc = 0;
  /** Game seconds until HIGH NOON lands (the sim's noonBanner comes 2 s early), or 0. */
  private noonIn = 0;
  /** Seconds until the current stamp lands (its camera shake), or −1. */
  private stampImpact = -1;
  /** Seconds until another sun-exit ring may show. */
  private sunT = 0;
  /** The way the sun last turned (+1 counter-clockwise, −1 clockwise): a SWING's arc sweeps that way. */
  private turn: 1 | -1 = 1;
  /** v1.5: the mechanics as the renderer sees them (the session's MechView), the snow from the snap cloud, the last DEEP pop. */
  mech: MechView | null = null;
  private snowAcc = 0;
  private deepT = -1e9;
  /** v1.6: the run's first ring trick and first frost gain were shown. */
  private trickSeen = false;
  private gainSeen = false;
  private readonly c2 = new Float64Array(2);
  /** Zoom pulses are on (Nubs walks). */
  private zoom = true;

  constructor(scene: RenderScene, clock: FixedClock) {
    this.sc = scene;
    this.clock = clock;
  }

  /** A new run begins: drop pending timers from the last one (a HIGH NOON due after its melt). */
  resetRun(): void {
    this.noonIn = 0;
    this.leafAcc = 0;
    this.glintAcc = 0;
    this.snowAcc = 0;
    this.deepT = -1e9;
    this.trickSeen = this.gainSeen = false;
    resetBlooms();
  }

  /** Routes one frame's events. */
  onEvents(events: readonly SimEvent[], s: SimState): void {
    const sc = this.sc;
    const nx = s.nubs.x;
    const ny = s.nubs.y;
    // On a Trial, Nubs' own ring cues (shade in and out, glare) follow only Nubs; so do the zoom
    // pulses (§1.4: another element's taps and holds read the plain camera).
    const snowman = s.nubs.hero === 'nubs';
    this.zoom = snowman;
    // The frame's frost gains pop as one (a snap's pour and the glass it lands come on one tick).
    let gainH = 0;
    for (const ev of events) {
      switch (ev.e) {
        case 'detent':
          flashDetent(sc.halo, ev.index);
          break;
        case 'catch':
          sc.sun.squash = 0.08;
          break;
        case 'go': {
          // End of the start beat: a little cheer and a kick of snow dust as Nubs sets off; on a
          // forecast day the Day card names the weather (later days get theirs at dawn). A campaign
          // level had its intro card instead.
          const plan = worldPlan(s.world, s.day);
          if (plan.forecast !== 'clear' && s.cfg.mode !== 'campaign') showDayCard(sc.banners, s.day, plan.biome, plan.forecast, s.params.epsNoon);
          sc.nubs.happy = Math.max(sc.nubs.happy, 0.45);
          for (let i = 0; i < 8; i++) {
            spawn(sc.particles, P_PUFF, nx + rnd(-6, 6), ny - 4, 2, rnd(-22, 22), rnd(-36, -10), rnd(8, 18), 0.45, 2.2, 5, 0xffffff);
          }
          // GO! high over his head (clear of the first runs' cue pill) and a hop as he sets off.
          addHeadline(sc.pops, 'GO!', POP_GO, 0.7, 1);
          hop(sc.nubs, 5);
          break;
        }
        case 'flake': {
          const p = sc.particles;
          spawn(p, P_FLAKE_FLY, ev.x, ev.y, 8, 0, 0, 0, 0.15, 7, 5, 0xffffff);
          for (let i = 0; i < 8; i++) {
            const a = rnd(0, Math.PI * 2);
            const sp = rnd(60, 120);
            spawn(p, P_SPARKLE, nx, ny, 14, Math.cos(a) * sp, Math.sin(a) * sp + s.params.v, rnd(10, 60), 0.4, 4, 1.5, 0xffffff);
          }
          addPlus(sc.pops, ev.snow);
          break;
        }
        case 'crystal': {
          const p = sc.particles;
          spawn(p, P_FLAKE_FLY, ev.x, ev.y, 8, 0, 0, 0, 0.18, 9, 6, 0xbdf3ff);
          for (let i = 0; i < 18; i++) {
            const a = rnd(0, Math.PI * 2);
            const sp = rnd(70, 150);
            spawn(p, P_SPARKLE, nx, ny, 14, Math.cos(a) * sp, Math.sin(a) * sp, rnd(10, 80), 0.55, 5, 1.5, 0xbdf3ff);
          }
          addRing(sc.rings, nx, ny, 4, 34, 0.35, 2.5, 0.9, 0xbdf3ff);
          addPlus(sc.pops, ev.snow);
          break;
        }
        case 'flower': {
          for (let i = 0; i < 6; i++) {
            const a = rnd(0, Math.PI * 2);
            spawn(sc.particles, P_SPARKLE, ev.x, ev.y, 6, Math.cos(a) * 40, Math.sin(a) * 40, 30, 0.45, 3.5, 1, 0xe6f7ff);
          }
          addPlus(sc.pops, ev.snow);
          break;
        }
        case 'flakeMelt':
          for (let i = 0; i < 6; i++) {
            spawn(sc.particles, P_PUFF, ev.x + rnd(-4, 4), ev.y + rnd(-3, 3), 6, rnd(-8, 8), rnd(-4, 4), rnd(18, 34), 0.6, 2.5, 7, 0xffffff);
          }
          break;
        case 'shadeEnter':
          if (snowman && ev.litFor >= 0.25) {
            addRing(sc.rings, nx, ny, 0, 40, 0.3, 2.2, 0.8, 0xffffff);
            sc.nubs.shiver = 0.14;
          }
          break;
        case 'shadeExit':
          // Out in the sun: a hot ring snaps out of the dial (at most one every 0.6 s at a ragged edge).
          if (snowman && this.sunT <= 0) {
            addRing(sc.rings, nx, ny, 36, 48, 0.28, 2.5, 0.75, HOT);
            this.sunT = 0.6;
          }
          break;
        case 'multUp':
          sc.hud.multPop = 0.3;
          sc.banners.coolPulse = 0.25;
          addPop(sc.pops, MULT[Math.min(5, ev.level)] as string, POP_MULT, -18, 200, 0.8);
          sc.nubs.happy = Math.max(sc.nubs.happy, 0.6);
          hop(sc.nubs, ev.level >= 5 ? 9 : 5);
          if (ev.level >= 5) {
            this.clock.addHitStop(0.04);
            sc.banners.goldPulse = 0.45;
          }
          break;
        case 'multReset':
          if (ev.from > 1) sc.hud.multShake = 0.2;
          break;
        case 'phew': {
          this.clock.slowMo(0.4, 0.35);
          addHeadline(sc.pops, 'PHEW!', POP_PHEW, 1.1);
          addPlus(sc.pops, 3);
          hop(sc.nubs, 7);
          for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2 + rnd(-0.1, 0.1);
            const sp = rnd(80, 150);
            spawn(sc.particles, P_BURST, nx, ny, 2, Math.cos(a) * sp, Math.sin(a) * sp, 0, 0.6, 5, 2, FROST);
          }
          addRing(sc.rings, nx, ny, 6, 52, 0.4, 3, 0.9, 0xdff1ff);
          sc.relief = 1.2;
          sc.nubs.phew = 1;
          break;
        }
        case 'noonBanner':
          // The sim warns 2 s early (the audio's cue); the stamp lands at noon, with the clock. A Trial
          // has no HIGH NOON (its noon falls on an element leg; TAG! stamps and tips hold that slot).
          if (s.el === null) this.noonIn = 2;
          break;
        case 'noonPassed':
          // The boss blinks first: a worried sun for 1.5 s, the ruler's sparkle and one cool pulse.
          sc.hud.noonSparkle = 1.2;
          sc.sunWorried = 1.5;
          sc.banners.coolPulse = 0.25;
          break;
        case 'nightStart':
          showNightCard(sc.banners, ev.day);
          break;
        case 'dawn': {
          const plan = worldPlan(s.world, ev.day);
          const eps = (s.params.day === ev.day ? s.params : dayParams(ev.day, s.cfg.profile)).epsNoon;
          // v1.6 Noon Heat: the card says so on the day it rises (a demo's stands in for the sim's).
          const heatOf = (d: number): number => (d < 1 ? 1 : noonHeatAt(s.world, d, dayTicks(d) >> 1));
          const heat = Math.max(heatOf(ev.day), this.mech?.noonHeat ?? 1);
          showDayCard(sc.banners, ev.day, plan.biome, plan.forecast, eps, heat > heatOf(ev.day - 1) ? heat : 1);
          this.petals(30);
          // Two little hops 0.4 s apart: a new day.
          hop(sc.nubs, 4, 0.06, 4);
          break;
        }
        case 'cloudCapture':
          if (snowman) addZoomPulse(sc.cam, 0.04, 0.4);
          sc.nubs.happy = 0.9;
          break;
        case 'glareTouch':
          // Glare is Ember's food: no flash, no "!".
          if (s.nubs.hero === 'ember') break;
          sc.nubs.glare = 0.25;
          addShake(sc.cam, 2, 0.1);
          addPop(sc.pops, '!', POP_BANG, 22, 160, 0.5);
          break;
        case 'swing':
          // The hand-off: the sun's sweep flashes on the dial, a SWING! pop (one a second at most;
          // a chain updates it) and a little hop.
          sc.halo.swingT = SWING_ARC_S;
          sc.halo.swingDeg = ev.deg * this.turn;
          addSwing(sc.pops, ev.chain);
          sc.nubs.happy = Math.max(sc.nubs.happy, 0.5);
          hop(sc.nubs, 4);
          // A beat of weight: a 30 ms hit-stop and a teal ring off the dial.
          this.clock.addHitStop(0.03);
          addRing(sc.rings, nx, ny, 40, 58, 0.35, 3, 0.85, TEAL);
          break;
        case 'gateArch':
          if (ev.noon) {
            for (let i = 0; i < 10; i++) {
              const a = rnd(0, Math.PI * 2);
              spawn(sc.particles, P_SPARKLE, nx, ny, 30, Math.cos(a) * 70, Math.sin(a) * 70, 20, 0.5, 4, 1.5, 0xffe27a);
            }
          }
          break;
        case 'budGrow':
          // Light is reaching a bud: its ring ticks out, wider as it grows.
          addRing(sc.rings, ev.x, ev.y, 7, 10 + 6 * ev.grow, 0.3, 1.6, 0.6 + 0.3 * ev.grow, SUN_GOLD);
          break;
        case 'bloom':
          this.bloom(ev.x, ev.y, ev.snow);
          break;
        case 'frostReady':
        case 'snapEnd':
          // The meter pops on its own (hud.ts); a cool pulse and a ring of frost around Nubs say why.
          // The snap's end: a last soft ring of cold.
          if (ev.e === 'frostReady') sc.banners.coolPulse = Math.max(sc.banners.coolPulse, 0.25);
          addRing(sc.rings, nx, ny, 12, 50, 0.45, 2.2, 0.75, 0xbfe6ff);
          break;
        case 'snap':
          this.snap(nx, ny);
          break;
        case 'deepEnter':
          // Deep shade: the ring sinks to indigo (halo.ts); DEEP and an inward ring, now and then.
          if (sc.worldTime - this.deepT >= DEEP_POP_GAP) {
            this.deepT = sc.worldTime;
            addHeadline(sc.pops, 'DEEP', POP_DEEP, 0.9);
            addRing(sc.rings, nx, ny, 50, 30, 0.4, 3, 0.7, 0x1f2a66);
          }
          break;
        // v1.6 (docs/V1_6_PLAN.md §2).
        case 'multDown':
          // Only losing ×5 to the sun shows; lower steps are silent (a snap's drop is its pour).
          if (ev.cause === 'bleed' && ev.from >= 5) {
            sc.hud.multShake = 0.25;
            addRing(sc.rings, nx, ny, 36, 52, 0.3, 2.5, 0.8, HOT);
          }
          break;
        case 'ringTrick':
          sc.hud.ringFlash = RING_FLASH_S;
          // The run's first trick says what charged.
          // Left of and above the Snow pop (+5 of a bloom or a parry, at the same moment) so the two never read as one.
          if (!this.trickSeen) addPop(sc.pops, '+RING', POP_MULT, -58, 262, 0.8);
          this.trickSeen = true;
          break;
        case 'frostGain':
          if (ev.source !== 'cash') gainH += ev.amountH;
          break;
        case 'frostSpill':
          sc.hud.spill = SPILL_S;
          break;
        case 'snapCash':
          if (ev.refundH > 0) {
            sc.hud.pour = POUR_S;
            gainH += ev.refundH;
          }
          break;
        case 'snapExtend':
          addRing(sc.rings, nx, ny, 10, 60, 0.4, 2.5, 0.8, ICE);
          break;
        case 'snapLand':
          // The hand-off out of the frost: LANDING!, a ring (gold into its own sunflower), a beat.
          addHeadline(sc.pops, 'LANDING!', POP_SWING, 1);
          addRing(sc.rings, nx, ny, 40, 60, 0.35, 3, 0.85, ev.own ? SUN_GOLD : TEAL);
          if (ev.own) this.burst(ev.x, ev.y, 30, 12, 60, SUN_GOLD);
          hop(sc.nubs, 5);
          this.clock.addHitStop(0.03);
          break;
        case 'clusterSaved':
          if (ev.brittle) {
            addHeadline(sc.pops, 'GLASS SAVED!', POP_DEEP, 0.9);
            this.burst(ev.x, ev.y, 10, 14, 70, 0xffffff);
          }
          break;
        case 'flareParry':
          this.stamp('frost', 'PARRY!', 0.6);
          addPlus(sc.pops, ev.snow);
          addRing(sc.rings, nx, ny, 8, 64, 0.5, 3.5, 0.95, ICE);
          sc.nubs.happy = 0.9;
          hop(sc.nubs, 6);
          break;
        case 'flareMiss':
          addRing(sc.rings, nx, ny, 36, 56, 0.35, 3, 0.8, HOT);
          sc.nubs.shiver = 0.2;
          // Endless: the flash scorched the tank (the gauge's charred end says how much).
          if (s.flareScorch > 0) addHeadline(sc.pops, 'SCORCHED!', POP_BANG, 1);
          break;
        case 'featMet':
          addHeadline(sc.pops, 'DARE ✓', POP_MULT, 1);
          break;
        case 'death': {
          this.clock.addHitStop(0.08);
          this.clock.slowMo(0.3, 0.58);
          addShake(sc.cam, 6, 0.25);
          // The push-in on the puddle: 1 → 1.18 from 80 to 600 ms, held into the Melt Map pull.
          holdZoom(sc.cam, 0.18, 0.08, 0.52);
          addRing(sc.rings, ev.info.x, ev.info.y, 6, 30, 0.9, 2, 0.8, 0xffffff);
          // A fallen Elemental leaves no meltwater: a puff in its colour (its art shows the rest).
          const who = ev.info.who;
          if (who && who !== 'nubs') {
            this.burst(ev.info.x, ev.info.y, 10, 14, 60, heroArcColor(who));
            break;
          }
          for (let i = 0; i < 14; i++) {
            spawn(sc.particles, P_STEAM, nx + rnd(-8, 8), ny + rnd(-4, 4), rnd(4, 18), rnd(-10, 10), rnd(-4, 4), rnd(25, 45), rnd(0.8, 1.3), 3, 11, 0xffffff);
            // And a splash of meltwater thrown out around the puddle.
            const a = (i / 14) * Math.PI * 2;
            spawn(sc.particles, P_DRIP, nx, ny, rnd(10, 20), Math.cos(a) * rnd(30, 55), Math.sin(a) * rnd(30, 55), rnd(40, 70), 1.4, 1.6, 1.4, 0x7fc8ff);
          }
          break;
        }
        // Elementals.
        case 'tag': {
          // TAG!: the incoming element's stamp, a hop, a ring and sparks in its colour, 0.3 s of slow-mo.
          const c = heroArcColor(ev.to);
          this.stamp('tag', 'TAG!', 0.7, HEROES[ev.to].face);
          hop(sc.nubs, 8);
          sc.nubs.happy = 0.9;
          addRing(sc.rings, nx, ny, 6, 60, 0.45, 3.5, 0.9, c);
          this.burst(nx, ny, 20, 16, 110, c);
          if (!this.reducedMotion) this.clock.slowMo(0.5, 0.3);
          break;
        }
        case 'tagClean':
          addHeadline(sc.pops, 'CLEAN!', POP_PHEW, 1);
          break;
        // Elementals v2 (docs/ELEMENTALS_V2.md §7.10): the objects' moments.
        case 'burn':
        case 'feed':
          // A fire starts (melting ice or a drying puddle: water); Ember feeds on its own fire: "+n".
          if (ev.e === 'feed') addPop(sc.pops, `+${Math.round(ev.delta)}`, POP_DEEP, 20, 120, 0.9);
          this.burst(ev.x, ev.y, 8, 12, 70, ev.e === 'burn' && (ev.kind === 'ice' || ev.kind === 'puddle') ? ICE : EMBER);
          break;
        case 'burnOut':
        case 'doused':
        case 'fizz':
          // Ash (a melt or a drying ends in steam); a doused fire's steam; a refused verb's grey puff.
          if (ev.e === 'fizz') this.puff(nx, ny, ASH);
          else this.puff(ev.x, ev.y, ev.e === 'burnOut' && ev.kind !== 'puddle' ? ASH : 0xffffff);
          break;
        case 'bump':
          // The wall shatters, the walker hops: BUMP!
          this.burst(ev.x, ev.y, 8, 16, 110, ev.kind === 'ice' ? 0xbfe6ff : ev.kind === 'gate' ? 0xc98b4e : 0x5e9a36);
          addHeadline(sc.pops, 'BUMP!', POP_BANG, 0.8);
          hop(sc.nubs, 6);
          addShake(sc.cam, 3, 0.15);
          break;
        case 'grow':
          // A hold starts: a lime ring at the site (the glow line is the telegraph's).
          if (ev.on) addRing(sc.rings, ev.x, ev.y, 4, 22, 0.35, 2.5, 0.9, LIME);
          break;
        case 'grown':
          addHeadline(sc.pops, ev.tree ? 'TREE!' : 'BRIDGE!', POP_MULT, 0.9);
          this.burst(ev.x, ev.y, 12, 14, 70, LIME);
          break;
        case 'drink':
          // A splash and the size it grew; Drip bulges for a moment (its art).
          this.puff(nx, ny, ICE);
          addPop(sc.pops, `+${Math.round(ev.delta)}`, POP_DEEP, 20, 120, 0.9);
          sc.nubs.happy = Math.max(sc.nubs.happy, 0.3);
          break;
        case 'sizzle':
          // A hot stone: Drip flashes and steams; Ember sparks.
          if (ev.hero !== 'drip') this.burst(nx, ny, 10, 10, 80, 0xffd36b);
          else {
            sc.nubs.glare = 0.25;
            this.puff(nx, ny, 0xffffff);
          }
          break;
        case 'gust':
          // Wind streaks across the view the way it blows (none under reduced motion).
          if (!this.reducedMotion) this.streaks(ev.dir, 8);
          break;
        default:
          break;
      }
    }
    if (gainH > 0) this.gain(gainH);
  }


  /**
   * A bud blooms at (x, y) (v1.5): the sunflower pops up out of it (render/flora.ts), gold petals
   * burst, a gold ring spreads, its Snow pops over Nubs with BLOOM!, a short hit-stop.
   */
  bloom(x: number, y: number, snow: number): void {
    const sc = this.sc;
    if (!this.reducedMotion) registerBloom(x, y, sc.worldTime);
    this.burst(x, y, 40, 16, 70, SUN_GOLD);
    addRing(sc.rings, x, y, 6, 34, 0.5, 3, 0.9, SUN_GOLD);
    if (snow > 0) addPlus(sc.pops, snow);
    // Through the headline rows, so it never lands on a DEEP, PHEW or SWING! of the same moment.
    addHeadline(sc.pops, 'BLOOM!', POP_MULT, 0.9);
    hop(sc.nubs, 4);
    this.clock.addHitStop(0.04);
  }

  /**
   * v1.6: frost gained (hundredths) pops beside Nubs in frost blue, to a tenth of a snap (none under
   * 0.05); the run's first worth a tenth or more says "snap".
   */
  private gain(h: number): void {
    if (h < 5) return;
    const first = !this.gainSeen && h >= 10;
    addPop(this.sc.pops, first ? `${snapsText(h)} snap` : snapsText(h), POP_DEEP, 20, 120, 0.9);
    if (h >= 10) this.gainSeen = true;
  }

  /** A Cold Snap lands over Nubs (v1.5): COLD SNAP!, an ice ring and shards, a cool wash, a beat. */
  snap(x: number, y: number): void {
    const sc = this.sc;
    addHeadline(sc.pops, 'COLD SNAP!', POP_SNAP, 1.1);
    sc.banners.coolPulse = 0.5;
    addRing(sc.rings, x, y, 6, 72, 0.55, 3.5, 0.95, ICE);
    this.burst(x, y, 2, 22, 130, 0xbfe6ff);
    sc.nubs.happy = 0.9;
    hop(sc.nubs, 6);
    this.clock.addHitStop(0.05);
    if (this.zoom) addZoomPulse(sc.cam, 0.04, 0.4);
  }

  /** n sparkles bursting out of (x, y, z) at about `speed` u/s. */
  private burst(x: number, y: number, z: number, n: number, speed: number, color: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.15, 0.15);
      const sp = speed * rnd(0.7, 1.2);
      spawn(this.sc.particles, P_SPARKLE, x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, rnd(10, 50), 0.6, 4.5, 1.5, color);
    }
  }

  /**
   * A stamp in the banner slot (HIGH NOON, PASSED SAM!, PAST YOUR RECENT BEST): it slams in and
   * lands with a 3 u camera shake (none under reduced motion); `face` dresses a TAG!.
   */
  stamp(kind: StampKind, text: string, hold: number, face?: FaceName): void {
    showStamp(this.sc.banners, kind, text, hold, face);
    this.stampImpact = STAMP_IN;
  }

  /** A stamp that celebrates (a target passed): the stamp plus confetti. */
  celebrate(kind: StampKind, text: string): void {
    this.stamp(kind, text, 0.7);
    this.confetti(24);
  }

  /**
   * The finish line (v1.2): a FINISH stamp whose stars pop in one by one under it, a burst of
   * confetti and gold sparkles, a hit-stop, a hop and a zoom pulse; a missed goal stamps its miss
   * line in rose, with no confetti.
   */
  finish(passed: boolean, text: string, stars: number, x: number, y: number): void {
    const sc = this.sc;
    this.stamp(passed ? 'finish' : 'miss', text, 1.2);
    if (passed) {
      sc.banners.stampStars = stars;
      this.confetti(64);
      hop(sc.nubs, 9);
      sc.nubs.happy = 1;
      if (this.zoom) addZoomPulse(sc.cam, 0.06, 0.5);
      this.clock.addHitStop(0.06);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        spawn(sc.particles, P_SPARKLE, x, y, 14, Math.cos(a) * 110, Math.sin(a) * 110, rnd(20, 70), 0.6, 5, 1.5, GOLD);
      }
      addRing(sc.rings, x, y, 8, 70, 0.5, 4, 0.9, GOLD);
    } else {
      sc.nubs.shiver = 0.3;
    }
  }

  /**
   * COMEBACK (v1.4): Nubs climbed out of a slow burn (Chill under the PHEW line, then held shade;
   * game/moments.ts). PHEW's little brother: no slow-mo, a gold headline, a cool ring and a hop.
   */
  comeback(x: number, y: number): void {
    const sc = this.sc;
    addHeadline(sc.pops, 'COMEBACK!', POP_PHEW, 1.1);
    hop(sc.nubs, 6);
    sc.nubs.happy = Math.max(sc.nubs.happy, 0.8);
    addRing(sc.rings, x, y, 6, 56, 0.45, 3, 0.9, GOLD);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      spawn(sc.particles, P_SPARKLE, x, y, 10, Math.cos(a) * 95, Math.sin(a) * 95, rnd(20, 60), 0.55, 4, 1.5, i % 2 ? GOLD : FROST);
    }
    sc.relief = 0.8;
  }

  /** Continuous effects, once per frame with game dt. */
  update(dt: number, s: SimState, playing: boolean): void {
    if (this.stampImpact >= 0 && (this.stampImpact -= dt) < 0) addShake(this.sc.cam, 3, 0.2);
    this.sunT -= dt;
    if (this.noonIn > 0 && (this.noonIn -= dt) <= 0) {
      this.noonIn = 0;
      if (playing && s.phase === 'day') this.stamp('noon', 'HIGH NOON', 1.1);
    }
    if (s.sun.dTheta !== 0) this.turn = s.sun.dTheta > 0 ? 1 : -1;
    if (dt <= 0 || !playing) return;
    const sc = this.sc;
    const nb = s.nubs;
    const p = sc.particles;
    const daylight = s.phase === 'day';
    const walk = daylight ? s.params.v : 0;
    // The snowman's steam, sweat, breath and frost are his alone (a trial's heroes show theirs in
    // their art).
    const snowman = nb.hero === 'nubs';
    if (daylight && snowman && nb.f > 0) {
      // Steam at 30·f per second, rising 30 u/s and growing 3 → 9 u over 0.8 s.
      this.steamAcc += dt * 30 * Math.min(2, nb.f);
      while (this.steamAcc >= 1) {
        this.steamAcc -= 1;
        // Steam inherits Nubs' walking speed so it rises from him instead of trailing behind.
        spawn(p, P_STEAM, nb.x + rnd(-8, 8), nb.y + rnd(0, 6), rnd(70, 92), rnd(-6, 6), walk * rnd(0.9, 1), 40, 0.8, 2.5, 8, 0xffffff);
      }
    } else {
      this.steamAcc = 0;
    }
    if (daylight && snowman && nb.chill < 60) {
      this.sweatAcc += dt;
      if (this.sweatAcc >= 0.4) {
        this.sweatAcc = 0;
        const side = Math.random() < 0.5 ? -1 : 1;
        spawn(p, P_DRIP, nb.x + side * rnd(5, 8), nb.y + 2, rnd(34, 44), side * rnd(10, 22), walk * 0.9, rnd(30, 60), 1.2, 1.4, 1.2, 0x7fc8ff);
      }
    }
    if (daylight && snowman && nb.f === 0) {
      // Cold breath: a small puff from the mouth every 1.6 s, drifting the way he looks.
      this.breathAcc += dt;
      if (this.breathAcc >= 1.6) {
        this.breathAcc = 0;
        const lx = sc.nubs.lookX;
        const ly = sc.nubs.lookY;
        const size = 0.6 + 0.4 * Math.max(0, nb.chill / nb.maxChill);
        spawn(p, P_BREATH, nb.x + lx * 4 * size, nb.y - ly * 2 * size, 68 * size, lx * 4, -ly * 4 + walk, 0, 0.7, 2, 5, 0xffffff);
      }
    } else {
      this.breathAcc = 1;
    }
    const mech = this.mech;
    if (mech?.snapCloud && !this.reducedMotion) this.snowfall(dt, s, mech.snapCloud);
    else this.snowAcc = 0;
    if (daylight && snowman && nb.f === 0) {
      // Frost sparkles: 2 per second on the ground within 16 u, living 1.2 s (5 in deep shade).
      this.frostAcc += dt * (mech?.deep ? 5 : 2);
      while (this.frostAcc >= 1) {
        this.frostAcc -= 1;
        const a = rnd(0, Math.PI * 2);
        const r = rnd(4, 16);
        spawn(p, P_FROST, nb.x + Math.cos(a) * r, nb.y + Math.sin(a) * r, 0, 0, 0, 0, 1.2, 3.2, 3.2, FROST);
      }
    }
    // Heat wisps while the sun is a boss: 7 tries a second 44-160 u from Nubs, rising (18 u/s on
    // screen, 1.4 s) only from lit ground — about 10 in the air at once. A Heat Wave shimmers from
    // 8 AM to 4 PM and twice as thick.
    const fc = s.params.forecast;
    const dayFrac = s.dayTick / dayTicks(s.day);
    const heatDay = fc === 'heat' && daylight && dayFrac > 0.17 && dayFrac < 0.83;
    const boss = daylight ? bossWeight(dayFrac, fc === 'heat') : 0;
    if (boss > 0.3 || heatDay) {
      this.wispAcc += dt * (heatDay ? 14 : 7);
      while (this.wispAcc >= 1) {
        this.wispAcc -= 1;
        const a = rnd(0, Math.PI * 2);
        const r = rnd(44, 160);
        const x = nb.x + Math.cos(a) * r;
        const y = nb.y + Math.sin(a) * r;
        const lit = pointLitWeight(s, x, y) > 0;
        const k = sc.wispTry;
        sc.wispTries[k] = x;
        sc.wispTries[k + 1] = y;
        sc.wispTries[k + 2] = lit ? 1 : 0;
        sc.wispTry = (k + 3) % sc.wispTries.length;
        if (lit) spawn(p, P_WISP, x, y, 0, 0, 0, 18 / OBLIQUE, 1.4, 1, 1, 0xffffff);
      }
    } else {
      this.wispAcc = 0;
    }
    // The air: Breezy days and windy chapters blow leaves across the screen (at most 6 at once,
    // the wind's way); spring chapters drop petals and winter ones snow (v1.3; none under reduced
    // motion).
    const v = sc.view;
    const air = this.reducedMotion || !daylight ? '' : fc === 'breezy' ? 'leaf' : themeFor(s.level?.chapter).air;
    if (air !== '') {
      this.leafAcc += dt * (air === 'snow' ? 8 : 1.6);
      if (this.leafAcc >= 1) {
        this.leafAcc -= 1;
        if (air === 'leaf' && countKind(p, P_LEAF) < 6) {
          const dir = s.day % 2 === 0 ? -1 : 1;
          const li = spawn(p, P_LEAF, dir > 0 ? v.vx - 20 : v.vx + v.vw + 20, v.vy + rnd(0.1, 0.8) * v.vh, 0, dir * rnd(110, 170), 0, 0, rnd(3.5, 5.5), rnd(11, 15), 0, LEAVES[Math.floor(rnd(0, LEAVES.length))] as number);
          p.vrot[li] = rnd(-4, 4);
        } else if (air === 'snow' && countKind(p, P_SNOW) < 48) {
          spawn(p, P_SNOW, v.vx + rnd(0, v.vw), v.vy - 8, 0, 0, rnd(28, 60), 0, 30, rnd(1.6, 3.2), 0, 0xffffff);
        } else if (air === 'petal' && countKind(p, P_PETAL) < 8) {
          spawn(p, P_PETAL, v.vx + rnd(0, v.vw), v.vy - 10, 0, rnd(-30, 30), rnd(20, 50), 0, rnd(5, 7), rnd(3.5, 5.5), 0, PETALS[Math.floor(rnd(0, PETALS.length))] as number);
        }
      }
    } else {
      this.leafAcc = 0;
    }
    // Gusts (v1.2): while a gust turns the sun, wind streaks fly across the screen the way it pushes
    // (+1 counter-clockwise reads as a leftward drag), at most 14 at once.
    const gust = s.sun.gust;
    if (gust !== 0) {
      this.gustAcc += dt * 16;
      while (this.gustAcc >= 1) {
        this.gustAcc -= 1;
        this.streaks(gust > 0 ? -1 : 1, 1);
      }
    } else {
      this.gustAcc = 0;
    }
    // Dazzle: glints flash on lit ground around Nubs (at most 6 at once).
    if (fc === 'dazzle' && daylight) {
      this.glintAcc += dt * 5;
      while (this.glintAcc >= 1) {
        this.glintAcc -= 1;
        if (countKind(p, P_GLINT) >= 6) continue;
        const a = rnd(0, Math.PI * 2);
        const r = rnd(30, 200);
        const x = nb.x + Math.cos(a) * r;
        const y = nb.y + Math.sin(a) * r;
        if (pointLitWeight(s, x, y) <= 0) continue;
        const gi = spawn(p, P_GLINT, x, y, rnd(0, 6), 0, 0, 0, rnd(0.45, 0.7), rnd(9, 13), 0, 0xffffff);
        p.rot[gi] = rnd(0, Math.PI);
      }
    } else {
      this.glintAcc = 0;
    }
    if (s.phase === 'night') {
      // A steady pool of 14 fireflies within 140 u of Nubs, each wandering for 5-8 s.
      let alive = 0;
      for (let i = 0; i < p.limit; i++) if (p.kind[i] === P_FIREFLY && p.life[i]! > 0) alive++;
      for (; alive < FIREFLIES; alive++) {
        const a = rnd(0, Math.PI * 2);
        const r = 140 * Math.sqrt(Math.random());
        const h = rnd(0, Math.PI * 2);
        spawn(p, P_FIREFLY, nb.x + Math.cos(a) * r, nb.y + Math.sin(a) * r, rnd(8, 30), Math.cos(h) * 12, Math.sin(h) * 12, 0, rnd(5, 8), 2.5, 2.5, 0xfff2a0);
      }
    }
  }

  /** Eight puffs rising off (x, y): ash, steam or a splash. */
  private puff(x: number, y: number, color: number): void {
    for (let i = 0; i < 8; i++) spawn(this.sc.particles, P_PUFF, x + rnd(-12, 12), y + rnd(-4, 4), rnd(2, 12), rnd(-12, 12), rnd(-4, 4), rnd(14, 30), 0.8, 3, 8, color);
  }

  /** n wind streaks flying across the view the way `dir` blows (+1 east), at most 14 at once. */
  private streaks(dir: number, n: number): void {
    const p = this.sc.particles;
    const v = this.sc.view;
    for (let i = 0; i < n && countKind(p, P_GUST) < 14; i++) {
      const speed = rnd(760, 1100);
      const gi = spawn(p, P_GUST, dir > 0 ? v.vx - 40 : v.vx + v.vw + 40, v.vy + rnd(0.1, 0.92) * v.vh, 0, dir * speed, 0, 0, (v.vw + 120) / speed + 0.2, rnd(60, 130), rnd(1.6, 3), 0xffffff);
      p.vrot[gi] = 0;
    }
  }

  /** Snow falling from the Cold Snap's cloud body to the ground under it, riding along with it. */
  private snowfall(dt: number, s: SimState, cl: Cloud): void {
    // From the body as drawn: over its shadow, SNAP_LIFT up (render/clouds.ts).
    cloudCenter(cl, s.tAbs, this.c2);
    const r = s.cot > 0 ? cloudOffset(cl.z, s.cot) : 0;
    const cx = (this.c2[0] as number) - s.ux * r;
    const cy = (this.c2[1] as number) - s.uy * r;
    const z = SNAP_LIFT / OBLIQUE;
    this.snowAcc += dt * SNOWFALL_RATE;
    while (this.snowAcc >= 1) {
      this.snowAcc -= 1;
      const a = rnd(0, Math.PI * 2);
      const d = Math.sqrt(Math.random()) * 0.8;
      spawn(this.sc.particles, P_SNOWFALL, cx + Math.cos(a) * cl.rx * d, cy + Math.sin(a) * cl.ry * d, z, cl.vx, cl.vy, -z / SNOWFALL_S, SNOWFALL_S + 0.35, rnd(1.8, 3), 0, 0xffffff);
    }
  }

  /** Dawn petals (screen space). */
  petals(n: number): void {
    const v = this.sc.view;
    for (let i = 0; i < n; i++) {
      spawn(
        this.sc.particles,
        P_PETAL,
        v.vx + rnd(0, v.vw),
        v.vy - rnd(10, 160),
        0,
        rnd(-30, 30),
        rnd(40, 110),
        0,
        rnd(3.5, 5),
        rnd(3.5, 6),
        0,
        PETALS[i % PETALS.length] as number,
      );
    }
  }

  /** New-best confetti (screen space). */
  confetti(n: number): void {
    const v = this.sc.view;
    for (let i = 0; i < n; i++) {
      spawn(
        this.sc.particles,
        P_CONFETTI,
        v.vx + v.vw / 2 + rnd(-40, 40),
        v.vy + v.vh * 0.32,
        0,
        rnd(-260, 260),
        rnd(-520, -220),
        0,
        rnd(1.8, 2.8),
        rnd(7, 11),
        0,
        CONFETTI[i % CONFETTI.length] as number,
      );
    }
  }
}
