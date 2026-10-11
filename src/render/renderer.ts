// Frame orchestration and draw order (TECH_SPEC §9.2 with the V1_PLAN changes). The renderer only
// reads the sim; render-side state (particles, rings, pops, footprints, the halo, the sun glyph,
// banners, HUD timers, Nubs' springs) lives in RenderScene and is driven by game/fx.ts.

import {
  dayTicks,
  nightTicks,
  queryCasters,
  SAMPLE_DX,
  SAMPLE_DY,
  trailSlope,
  type Caster,
  type RenderSnap,
  type SimState,
} from '../core/index.ts';
import { createCameraFx, createView, layoutView, setPlayCamera, type CameraFx, type View } from '../game/camera.ts';
import type { Equipped } from '../meta/content.ts';
import type { Insets } from '../platform/safeArea.ts';
import { drawBanners, drawVignettes, createBanners, updateBanners, type Banners } from './banners.ts';
import { createLight, drawCaster, type Light } from './casters.ts';
import { drawClouds } from './clouds.ts';
import { cssa } from './color.ts';
import {
  createFootprints,
  createGroundPaint,
  drawBars,
  drawFootprints,
  drawGround,
  drawTrail,
  stepFootprints,
  type Footprints,
  type GroundPaint,
} from './ground.ts';
import { createHalo, drawHalo, updateHalo, type HaloState } from './halo.ts';
import { createHud, drawHud, hudScale, updateHud, type HudState } from './hud.ts';
import { applyPull, createMapFrame, drawMeltMap, frameDeath, mapTarget, type MapFrame } from './meltMap.ts';
import {
  createNubsAnim,
  createNubsSprite,
  createPose,
  drawFootprintDisc,
  drawNubsSprite,
  drawOwnShadow,
  drawSizzle,
  looksFor,
  nubsBox,
  renderNubsSprite,
  updateNubsAnim,
  type NubsAnim,
  type NubsPose,
  type NubsSprite,
} from './nubs.ts';
import { createPalette, updatePalette, type Palette } from './palette.ts';
import {
  createParticles,
  createPops,
  createRings,
  drawAirParticles,
  drawGroundParticles,
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
import { drawGlare, drawPickups } from './pickups.ts';
import { createShadowLayer, drawShadowLayer, traceShadows, type ShadowLayer } from './shadowLayer.ts';
import { createSunGlyph, drawSun, placeSun, type SunGlyph, type SunMood } from './sun.ts';

const DEG = Math.PI / 180;

export type RenderScreen = 'boot' | 'title' | 'play' | 'pause' | 'dying' | 'results' | 'menu';

export interface DebugDraw {
  testPoints: boolean;
  masks: boolean;
  outlines: boolean;
}

export interface RenderInput {
  s: SimState;
  snap: RenderSnap;
  screen: RenderScreen;
  /** Render-only Title sway added to θ (degrees). */
  sway: number;
  dragging: boolean;
  guideAlpha: number;
  pbMinutes: number;
  challengeMinutes: number;
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
  /** Perf governor: ground detail tiles on/off. */
  detail: boolean;
  /** Perf governor: soft (half-res layer) or crisp (direct multiply fill) shadows. */
  softShadows: boolean;
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
  hud: HudState;
  banners: Banners;
  map: MapFrame;
  /** Map pull endpoints (S, cx, cy, scx, scy). */
  mapFrom: Float64Array;
  mapTo: Float64Array;
  mapReady: boolean;
  lastTheta: number;
  thetaSpeed: number;
  /** CPU ms of the last draw (debug). */
  ms: number;
}

export function createScene(): RenderScene {
  const pal = createPalette();
  return {
    view: createView(),
    cam: createCameraFx(),
    pal,
    groundPal: createPalette(),
    ground: createGroundPaint(),
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
    hud: createHud(),
    banners: createBanners(),
    map: createMapFrame(),
    mapFrom: new Float64Array(5),
    mapTo: new Float64Array(5),
    mapReady: false,
    lastTheta: NaN,
    thetaSpeed: 0,
    ms: 0,
  };
}

export function resizeScene(sc: RenderScene, cssW: number, cssH: number, dpr: number, safe: Insets): void {
  layoutView(sc.view, cssW, cssH, dpr, safe);
}

const casterBuf: Caster[] = [];
const box = new Float64Array(4);

export class Renderer {
  readonly scene: RenderScene;
  private readonly g: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('Canvas 2D is not available');
    this.g = g;
    this.scene = createScene();
  }

  /** Resizes the backing store (CSS size × dpr) and re-fits the view. */
  resize(cssW: number, cssH: number, dpr: number, safe: Insets): void {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    resizeScene(this.scene, cssW, cssH, dpr, safe);
  }

  draw(inp: RenderInput): void {
    const t0 = performance.now();
    const sc = this.scene;
    const g = this.g;
    const v = sc.view;
    const s = inp.s;
    const snap = inp.snap;

    // ---- Time of day, palette and light -----------------------------------------------------
    const dl = dayTicks(snap.day);
    const nt = nightTicks(snap.day);
    let dayFrac = Math.min(1, snap.dayTick / dl);
    let night = 0;
    let town = snap.day % 2 === 0 ? 1 : 0;
    if (snap.dayTick > dl) {
      const tn = (snap.dayTick - dl) / 60;
      const nl = nt / 60;
      night = smooth(Math.min(1, tn / 1.5)) * (1 - smooth(Math.max(0, (tn - (nl - 1.5)) / 1.5)));
      if (tn > nl / 2) {
        dayFrac = 0;
        town = (snap.day + 1) % 2 === 0 ? 1 : 0;
      }
    }
    updatePalette(sc.pal, dayFrac, night, town, inp.highContrast);
    // The ground steps through the day in 1/64ths (≈ 0.8 s): a 1-3 level change at most.
    updatePalette(sc.groundPal, Math.round(dayFrac * 64) / 64, Math.round(night * 16) / 16, town, inp.highContrast);
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
    L.time = inp.time;

    // Photosensitivity: ease the shadow layer down during very fast sweeps (> 300°/s).
    if (Number.isFinite(sc.lastTheta) && inp.dt > 0) {
      let d = theta - sc.lastTheta;
      d -= Math.round(d / 360) * 360;
      sc.thetaSpeed += (Math.abs(d) / inp.dt - sc.thetaSpeed) * Math.min(1, inp.dt * 20);
    }
    sc.lastTheta = theta;
    const baseAlpha = sc.pal.shadowAlpha;
    const targetAlpha = sc.thetaSpeed > 300 ? baseAlpha * 0.72 : baseAlpha;
    sc.shadow.alpha += (targetAlpha - sc.shadow.alpha) * Math.min(1, inp.dt / 0.04);
    if (!Number.isFinite(sc.shadow.alpha) || inp.dt <= 0) sc.shadow.alpha = targetAlpha;

    // ---- Camera ------------------------------------------------------------------------------
    sc.cam.reducedMotion = inp.reducedMotion;
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
      applyPull(v, sc.mapFrom, sc.mapTo, inp.reducedMotion ? 1 : inp.mapT / 1.4);
    } else {
      sc.mapReady = false;
    }

    // ---- Animate render-side state ----------------------------------------------------------
    const gdt = inp.gdt;
    updateParticles(sc.particles, gdt, snap.nubsX, snap.nubsY, v.cssH);
    updateRings(sc.rings, gdt);
    const udt = inp.paused ? 0 : inp.dt;
    updatePops(sc.pops, udt);
    updateHud(sc.hud, udt);
    updateBanners(sc.banners, udt, s.phase === 'day' && snap.chill < 25 && inp.dying < 0);
    // Nubs stands still through the start beat (the clock waits; the sun already moves).
    const walking = (s.phase === 'day' || s.phase === 'night') && s.ready === 0 && inp.dying < 0;
    updateNubsAnim(sc.nubs, gdt, v.ox + snap.nubsX * v.S, v.S, walking, s.params.v);
    updateHalo(sc.halo, udt, inp.dragging, snap.chill, s.sun.dTheta);
    sc.relief = Math.max(0, sc.relief - inp.dt);
    if (inp.screen === 'play' && walking) {
      stepFootprints(sc.footprints, snap.nubsX, snap.nubsY, trailSlope(s.world.trail, snap.nubsY), s.nubs.f === 0, gdt);
    } else {
      stepFootprints(sc.footprints, snap.nubsX, snap.nubsY, 0, true, gdt);
    }

    // ---- Draw ------------------------------------------------------------------------------
    g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    drawBars(g, v, sc.pal, inp.detail);
    g.save();
    g.beginPath();
    g.rect(v.vx, v.vy, v.vw, v.vh);
    g.clip();

    drawGround(g, v, sc.groundPal, inp.detail, sc.ground);
    drawTrail(g, v, s.world, sc.groundPal);
    drawFootprints(g, sc.footprints, v, sc.pal);
    drawPickups(g, v, s.world, inp.time, snap.nubsY, night);
    if (sunUp) drawShadowLayer(g, sc.shadow, v, s.world, sc.pal, ux, uy, snap.cot, snap.tAbs, sc.shadow.alpha, inp.softShadows);

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
    pose.lookX = ux;
    pose.lookY = -uy;
    pose.sunUp = sunUp;
    pose.walking = walking;
    pose.night = night;
    pose.time = inp.time;
    pose.melt = inp.dying;
    pose.shade = sc.pal.nubsShade;
    pose.reducedMotion = inp.reducedMotion;
    if (inp.screen === 'title' && sunUp) {
      // The Title sway is render-only: show Nubs as shaded (he idles in the hut's shadow).
      pose.w0 = pose.w1 = pose.w2 = pose.w3 = pose.w4 = 0;
      pose.f = 0;
    }

    drawOwnShadow(g, pose, sc.pal.shadow, sc.pal.shadowAlpha);
    drawFootprintDisc(g, pose, sc.pal.trail);
    if (sunUp) drawGlare(g, v, s.world, ux, uy, snap.cot, snap.eps, inp.time);
    drawGroundParticles(g, sc.particles, v);
    drawRings(g, sc.rings, v);

    // Depth-sorted objects, far (north) first, with Nubs inserted at his y.
    const looks = looksFor(inp.equipped);
    renderNubsSprite(sc.nubsSprite, pose, sc.nubs, looks, v.S * v.dpr);
    nubsBox(pose.x, pose.y, v.S, box);
    const n = queryCasters(s.world, v.y0 - 130, v.y1 + 40, casterBuf);
    let nubsDrawn = false;
    let occluded = false;
    for (let i = n - 1; i >= 0; i--) {
      const c = casterBuf[i] as Caster;
      if (c.maxX < v.x0 - 40 || c.minX > v.x1 + 40) continue;
      if (!nubsDrawn && c.y < snap.nubsY) {
        drawNubsSprite(g, sc.nubsSprite, pose.x, pose.y, v.dpr);
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
    if (!nubsDrawn) drawNubsSprite(g, sc.nubsSprite, pose.x, pose.y, v.dpr);
    else if (occluded) {
      // X-ray: Nubs stays readable through whatever stands in front of him.
      g.globalAlpha = 0.62;
      drawNubsSprite(g, sc.nubsSprite, pose.x, pose.y, v.dpr);
      g.globalAlpha = 1;
    }

    if (inp.screen !== 'title') drawSizzle(g, pose, inp.time, s.nubs.glare > 0);
    drawClouds(g, v, s.world, snap.tAbs, nubsSX, nubsSY - 12 * v.S, night);
    drawAirParticles(g, sc.particles, v);

    if (inp.mapT >= 0 && sc.mapReady) drawMeltMap(g, v, s, sc.map, Math.min(1, inp.mapT / 0.8), inp.time);

    // Debug geometry.
    if (inp.debug) drawDebug(g, v, s, inp.debug, ux, uy, snap.cot, snap.tAbs, pose);

    // Halo dial (play/title; fades out on death and under the map).
    const showHalo = inp.mapT < 0 && (inp.screen === 'play' || inp.screen === 'pause' || inp.screen === 'title' || inp.screen === 'dying');
    if (showHalo) {
      const fade = inp.dying >= 0 ? Math.max(0, 1 - inp.dying / 0.3) : inp.screen === 'title' ? 0.75 : 1;
      drawHalo(g, sc.halo, {
        cx: pose.x,
        cy: pose.y,
        R: 40 * v.S,
        theta,
        dragging: inp.dragging,
        dTheta: s.sun.dTheta,
        chill: snap.chill,
        sunUp,
        guideAlpha: inp.guideAlpha,
        now: s.guide.now,
        next: s.guide.next,
        glare: s.guide.glare,
        fade,
        time: inp.time,
      });
    }
    g.restore();

    drawVignettes(g, sc.banners, v);
    drawPops(g, sc.pops, v, hudScale(v));

    // Edge sun mascot (decoration), kept below the HUD band.
    if (inp.mapT < 0 && inp.screen !== 'title' && inp.screen !== 'menu') {
      const scale = hudScale(v) * 0.9;
      sc.sun.night += ((sunUp ? 0 : 1) - sc.sun.night) * Math.min(1, inp.dt * 2);
      sc.sun.squash = Math.max(0, sc.sun.squash - inp.dt);
      if (inp.dying >= 0) sc.sun.guilty = Math.min(1, sc.sun.guilty + inp.dt * 3);
      else sc.sun.guilty = Math.max(0, sc.sun.guilty - inp.dt * 3);
      placeSun(sc.sun, v, pose.x, pose.y - 10 * v.S, ux, -uy, inp.dt, v.safe.top + 84);
      const mood: SunMood =
        inp.dying >= 0 ? 'guilty' : sc.relief > 0 ? 'relief' : snap.chill >= 60 ? 'smug' : snap.chill >= 30 ? 'worried' : 'horrified';
      sc.sunMood = mood;
      drawSun(g, sc.sun, mood, inp.time, scale, 1, sc.sun.x < pose.x ? -1 : 1);
    }

    // HUD.
    const hudVisible = inp.screen === 'play' || inp.screen === 'pause' || inp.screen === 'dying';
    if (hudVisible) {
      const a = inp.dying >= 0 ? Math.max(0, 1 - inp.dying / 0.4) : 1;
      drawHud(g, sc.hud, v, { s, pbMinutes: inp.pbMinutes, challengeMinutes: inp.challengeMinutes, alpha: a, time: inp.time });
    }
    if (inp.screen === 'play' || inp.screen === 'pause') drawBanners(g, sc.banners, v, sc.hud.bottom, hudScale(v), inp.reducedMotion);
    drawScreenParticles(g, sc.particles, v.dpr);
    g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    sc.ms = performance.now() - t0;
  }
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
