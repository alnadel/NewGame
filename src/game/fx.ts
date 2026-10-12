// FX router (GDD §11 juice list, V1_PLAN changes): SimEvents → particles, rings, text pops, HUD and
// banner timers, Nubs' reactions, camera shake/zoom, slow-mo and hit-stop; plus the continuous
// effects (steam while lit, sweat below 60 Chill, frost sparkles in shade, fireflies at night).
// Particles are render-only and may use Math.random.

import type { SimState } from '../core/index.ts';
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
  P_PETAL,
  P_PUFF,
  P_SPARKLE,
  P_STEAM,
  POP_BANG,
  POP_MULT,
  POP_PHEW,
  spawn,
} from '../render/particles.ts';
import { flashDetent, SWING_ARC_S } from '../render/halo.ts';
import { hop } from '../render/nubs.ts';
import type { SimEventV11 } from '../render/shims.ts';
import { showDayCard, showStamp, STAMP_IN, type StampKind } from '../render/banners.ts';
import type { RenderScene } from '../render/renderer.ts';
import { addShake, addZoomPulse } from './camera.ts';
import type { FixedClock } from './loop.ts';

const MULT = ['×1', '×1', '×2', '×3', '×4', '×5'];
const FROST: number = 0xe6f6ff;
const CONFETTI: readonly number[] = [0xff5d5d, 0xffc23d, 0x2ec4b6, 0x5ab8ff, 0x9b5de5, 0xff9eb0, 0xffffff];
const PETALS: readonly number[] = [0xffd6e0, 0xffe8c2, 0xfff4dc, 0xffb3c6, 0xffc9a3];

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
  private fireflyAcc = 0;
  private breathAcc = 0;
  /** Seconds until the current stamp lands (its camera shake), or −1. */
  private stampImpact = -1;
  /** The way the sun last turned (+1 counter-clockwise, −1 clockwise): a SWING's arc sweeps that way. */
  private turn: 1 | -1 = 1;

  constructor(scene: RenderScene, clock: FixedClock) {
    this.sc = scene;
    this.clock = clock;
  }

  /** Routes one frame's events. */
  onEvents(events: readonly SimEventV11[], s: SimState): void {
    const sc = this.sc;
    const nx = s.nubs.x;
    const ny = s.nubs.y;
    for (const ev of events) {
      switch (ev.e) {
        case 'detent':
          flashDetent(sc.halo, ev.index);
          break;
        case 'catch':
          sc.sun.squash = 0.08;
          break;
        case 'go':
          // End of the start beat: a little cheer and a kick of snow dust as Nubs sets off.
          sc.nubs.happy = Math.max(sc.nubs.happy, 0.45);
          for (let i = 0; i < 5; i++) {
            spawn(sc.particles, P_PUFF, nx + rnd(-6, 6), ny - 4, 2, rnd(-14, 14), rnd(-30, -10), rnd(8, 18), 0.45, 2.2, 5, 0xffffff);
          }
          break;
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
          if (ev.litFor >= 0.25) {
            addRing(sc.rings, nx, ny, 0, 40, 0.3, 2.2, 0.8, 0xffffff);
            sc.nubs.shiver = 0.14;
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
          sc.banners.noon = 0;
          break;
        case 'noonPassed':
          sc.hud.noonSparkle = 1.2;
          break;
        case 'nightStart':
          sc.banners.night = 0;
          break;
        case 'dawn': {
          showDayCard(sc.banners, ev.day);
          this.petals(30);
          // Two little hops 0.4 s apart: a new day.
          hop(sc.nubs, 4, 0.06, 4);
          break;
        }
        case 'cloudCapture':
          addZoomPulse(sc.cam, 0.04, 0.4);
          sc.nubs.happy = 0.9;
          break;
        case 'glareTouch':
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
          break;
        case 'gateArch':
          if (ev.noon) {
            for (let i = 0; i < 10; i++) {
              const a = rnd(0, Math.PI * 2);
              spawn(sc.particles, P_SPARKLE, nx, ny, 30, Math.cos(a) * 70, Math.sin(a) * 70, 20, 0.5, 4, 1.5, 0xffe27a);
            }
          }
          break;
        case 'death': {
          this.clock.addHitStop(0.08);
          this.clock.slowMo(0.3, 0.58);
          addShake(sc.cam, 6, 0.25);
          addRing(sc.rings, ev.info.x, ev.info.y, 6, 30, 0.9, 2, 0.8, 0xffffff);
          for (let i = 0; i < 14; i++) {
            spawn(sc.particles, P_STEAM, nx + rnd(-8, 8), ny + rnd(-4, 4), rnd(4, 18), rnd(-10, 10), rnd(-4, 4), rnd(25, 45), rnd(0.8, 1.3), 3, 11, 0xffffff);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * A stamp in the banner slot (HIGH NOON, PASSED SAM!, PAST YOUR RECENT BEST): it slams in and
   * lands with a 3 u camera shake (none under reduced motion).
   */
  stamp(kind: StampKind, text: string, hold: number): void {
    showStamp(this.sc.banners, kind, text, hold);
    this.stampImpact = STAMP_IN;
  }

  /** A stamp that celebrates (a target passed): the stamp plus confetti. */
  celebrate(kind: StampKind, text: string): void {
    this.stamp(kind, text, 0.7);
    this.confetti(24);
  }

  /** Continuous effects, once per frame with game dt. */
  update(dt: number, s: SimState, playing: boolean): void {
    if (this.stampImpact >= 0 && (this.stampImpact -= dt) < 0) addShake(this.sc.cam, 3, 0.2);
    if (s.sun.dTheta !== 0) this.turn = s.sun.dTheta > 0 ? 1 : -1;
    if (dt <= 0 || !playing) return;
    const sc = this.sc;
    const nb = s.nubs;
    const p = sc.particles;
    const daylight = s.phase === 'day';
    const walk = daylight ? s.params.v : 0;
    if (daylight && nb.f > 0) {
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
    if (daylight && nb.chill < 60) {
      this.sweatAcc += dt;
      if (this.sweatAcc >= 0.4) {
        this.sweatAcc = 0;
        const side = Math.random() < 0.5 ? -1 : 1;
        spawn(p, P_DRIP, nb.x + side * rnd(5, 8), nb.y + 2, rnd(34, 44), side * rnd(10, 22), walk * 0.9, rnd(30, 60), 1.2, 1.4, 1.2, 0x7fc8ff);
      }
    }
    if (daylight && nb.f === 0) {
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
    if (daylight && nb.f === 0) {
      // Frost sparkles: 2 per second on the ground within 16 u, living 1.2 s.
      this.frostAcc += dt * 2;
      while (this.frostAcc >= 1) {
        this.frostAcc -= 1;
        const a = rnd(0, Math.PI * 2);
        const r = rnd(4, 16);
        spawn(p, P_FROST, nb.x + Math.cos(a) * r, nb.y + Math.sin(a) * r, 0, 0, 0, 0, 1.2, 3.2, 3.2, FROST);
      }
    }
    if (s.phase === 'night') {
      this.fireflyAcc += dt * 3;
      while (this.fireflyAcc >= 1) {
        this.fireflyAcc -= 1;
        spawn(p, P_FIREFLY, nb.x + rnd(-170, 170), nb.y + rnd(-120, 420), rnd(8, 30), rnd(-8, 8), rnd(-8, 8), rnd(-3, 3), rnd(2.5, 4.5), 4.5, 4.5, 0xffec96);
      }
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
