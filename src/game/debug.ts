// Debug overlay (?debug=1) and the test hook (?test=1, window.__SHADY_TEST__) — V1_PLAN §14.

import { BOT_KINDS, runHeadless, type BotKind } from '../core/index.ts';
import type { ShadyAudio } from '../audio/index.ts';
import type { DebugDraw, RenderOptions } from '../render/renderer.ts';
import { calloutBoxes, calloutsDrawn } from '../render/meltMap.ts';
import { shakeOf, zoomOf } from './camera.ts';
import type { MapProbe, PixelAB, Session } from './session.ts';
import type { RunStatusView } from '../ui/types.ts';

export interface ShadyTestHook {
  screen(): string;
  /** The sim at a glance plus the run's rules (Session.testState). */
  state(): ReturnType<Session['testState']>;
  forceDeath(): void;
  runHeadless(seed: number, ticks: number, bot: string): string;
  setTimeScale(n: number): void;
  audioState(): string;
  /** Extras for tooling. */
  paused(): boolean;
  presses(): number;
  /** Plays a render-only moment (phew, mult, noon, dawn, cloud, glare, flake, best, finish) for visual review. */
  demo(name: string): void;
  /** Nubs' ground point on screen (CSS px), for review tooling. */
  nubsScreen(): { x: number; y: number };
  /** The game clock's current time scale (slow-mo, the lesson's slow time, hit-stop = 0). */
  timeScale(): number;
  /** The ghost hint: thumb mode, target arc, way round (+1 CCW) and whether the lesson is on. */
  hint(): { mode: string; target: number; width: number; turn: number; lesson: boolean; shown: number };
  /** Frame timing (ms) of the last frame: frame, sim, gen, render. */
  perf(): {
    frameMs: number;
    simMs: number;
    genMs: number;
    renderMs: number;
    fps: number;
    nubsLayerDraws: number;
    nubsComposes: number;
    /** Ground tile repaints so far, one per biome tile painted (render/ground.ts GroundPaint). */
    groundPaints: number;
    /** Canvas DPR and governor level now. */
    dpr: number;
    govLevel: number;
    /** renderer.draw calls so far (the render cadence skips the rest of the rAFs). */
    draws: number;
    /** Full-viewport layers composited over the ground in the last drawn frame (≤ 3, A12). */
    fullScreenPasses: number;
    /** Ground decals drawn in the last frame (render/decor.ts). */
    decals: number;
  };
  /** The current run's config (the Title's held run between runs); drain = cfg.drain ?? the profile's. */
  runCfg(): { mode: string; profile: number; tutorial: boolean; reducedMotion: boolean; seed: number; dailyDate: string | null; drain: number };
  /** Camera effects now: zoom factor (1 = none) and shake offset (u). */
  cameraFx(): { zoom: number; shakeX: number; shakeY: number };
  /** The best flag the HUD shows (frozen for the run in progress). */
  hudPb(): number;
  /** Render switches for A/B checks (render/renderer.ts RenderOptions). */
  renderOptions(o: Partial<RenderOptions>): void;
  /**
   * Results: draws the Melt Map at `mapT` with and without its overlay (time frozen) and counts the
   * device pixels that differ above and below the sheet's top edge (K10 checks).
   */
  mapProbe(mapT: number): MapProbe | null;
  /** The Melt Map's callout label boxes in the last drawn frame ([x, y, w, h] in CSS px). */
  mapCallouts(): number[][];
  /** The death recap's tip handed to the last Results (null: none fitted). */
  resultsTip(): string | null;
  /** The last Results' campaign verdict (ResultsView.campaign), or null. */
  campaign(): { id: number; name: string; passed: boolean; stars: number; nextId: number | null; goalLine: string } | null;
  /** The Results postcard: file ready, its size and name, and each drawing stage's ms. */
  postcard(): { ready: boolean; stageMs: number[]; bytes: number; name: string };
  /** The current frame drawn under render options `a` and then `b` (time frozen), compared pixel by pixel. */
  pixelAB(a: Partial<RenderOptions>, b: Partial<RenderOptions>): PixelAB | null;
  /** A core bot plays the runs from now on ('reactive', 'oracle'…; null stops it). The runs stay scored. */
  bot(kind: string | null): void;
  /** The HUD row's layout as last built: left panel and ruler shown, ruler width (CSS px), Snow's flake icon. */
  hud(): { snow: number; left: boolean; ruler: boolean; rulerW: number; icon: boolean; stars: number };
  /** The Pause card's view of the run in progress (UiCallbacks.runStatus). */
  runStatus(): RunStatusView | null;
  /** The in-run toasts: the one showing first, then the queue (kind, kicker, text). */
  toasts(): { kind: string; kicker: string; text: string }[];
  /** Sets the run's Snow (layout checks with long numbers). */
  setSnow(n: number): void;
  /**
   * v1.5 mechanics as the renderer sees them (game/mechanics.ts): the frost meter (shown, fill, its
   * centre in CSS px), deep shade, the snap left and its cloud, the dial's gold bins, the run's buds
   * and Cold Snaps asked for by input so far.
   */
  mech(): {
    meter: boolean;
    frost: number;
    meterX: number;
    meterY: number;
    deep: boolean;
    snapLeft: number;
    snapId: number;
    budBins: number;
    buds: number;
    snaps: number;
    /** v1.6: the meter's pips and banked chip, the ring (on, fill, bleeding), the dial layers' bins, the flare, Noon Heat, the badge's centre (CSS px). */
    pips: number;
    bankH: number;
    ring: boolean;
    ringFill: number;
    bleed: boolean;
    deepBins: number;
    glassBins: number;
    landBins: number;
    flareBins: number;
    flarePhase: number;
    flareLeft: number;
    flareOut: number[];
    noonHeat: number;
    badgeX: number;
    badgeY: number;
    /** The dial's centre and radius (CSS px on the canvas). */
    dialX: number;
    dialY: number;
    dialR: number;
  };
}

declare global {
  interface Window {
    __SHADY_TEST__?: ShadyTestHook;
  }
}

export function installTestHook(session: Session, audio: ShadyAudio): void {
  const hook: ShadyTestHook = {
    screen: () => session.ui.current(),
    state: () => session.testState(),
    forceDeath: () => session.forceDeath(),
    // The single-file build ships no bots (session.ts makeBot): there it reports no hash.
    runHeadless: (seed, ticks, bot) => (import.meta.env.MODE === 'single' ? '' : runHeadless(seed, ticks, bot as BotKind)),
    setTimeScale: (n) => {
      session.clock.debugScale = Number.isFinite(n) && n >= 0 ? n : 1;
    },
    audioState: () => audio.status,
    paused: () => session.isPaused,
    presses: () => session.input.presses,
    demo: (name) => session.demo(name),
    perf: () => ({
      ...session.stats,
      nubsLayerDraws: session.renderer.scene.nubsSprite.layerDraws,
      nubsComposes: session.renderer.scene.nubsSprite.composes,
      groundPaints: session.renderer.scene.ground.paints,
      dpr: session.renderer.scene.view.dpr,
      govLevel: session.gov.level,
      draws: session.renderer.draws,
      fullScreenPasses: session.renderer.scene.passes,
      decals: session.renderer.scene.decor.drawn,
    }),
    runCfg: () => session.runCfg(),
    cameraFx: () => {
      const c = session.renderer.scene.cam;
      return { zoom: zoomOf(c), shakeX: shakeOf(c, 0), shakeY: shakeOf(c, 1) };
    },
    hudPb: () => session.hudPb(),
    renderOptions: (o) => {
      Object.assign(session.renderer.options, o);
      session.cadence.invalidate();
    },
    mapProbe: (mapT) => session.mapProbe(mapT),
    resultsTip: () => session.resultsTip,
    campaign: () => session.campaignResults(),
    postcard: () => session.postcardState(),
    mapCallouts: () => {
      const out: number[][] = [];
      for (let i = 0; i < calloutsDrawn(); i++) out.push(Array.from(calloutBoxes.subarray(4 * i, 4 * i + 4)));
      return out;
    },
    pixelAB: (a, b) => session.pixelAB(a, b),
    bot: (kind) => session.setTestBot(kind !== null && (BOT_KINDS as readonly string[]).includes(kind) ? (kind as BotKind) : null),
    nubsScreen: () => ({ x: session.renderer.scene.pose.x, y: session.renderer.scene.pose.y }),
    timeScale: () => session.clock.timeScale,
    hint: () => session.hintState(),
    hud: () => {
      const h = session.renderer.scene.hud;
      return { snow: h.key[0] as number, left: h.leftShown, ruler: h.leftShown && h.rulerShown, rulerW: h.rulerShown ? h.rulerX1 - h.rulerX0 : 0, icon: h.iconS > 0, stars: h.starBits };
    },
    runStatus: () => session.runStatus(),
    toasts: () => session.renderer.scene.banners.toasts.map((t) => ({ kind: t.kind, kicker: t.kicker.replace(/\u200c/g, ''), text: t.text })),
    setSnow: (n) => session.testSetSnow(n),
    mech: () => {
      const m = session.mech.view;
      const h = session.renderer.scene.hud;
      const bins = (a: Uint8Array | null): number => (a ? a.reduce((n, x) => n + (x ? 1 : 0), 0) : 0);
      const budBins = bins(m.bud);
      return {
        meter: h.meterShown,
        frost: m.frost,
        meterX: h.meterX,
        meterY: h.meterY,
        deep: m.deep,
        snapLeft: m.snapLeft,
        snapId: m.snapCloud?.id ?? -1,
        budBins,
        buds: session.state.world.buds?.length ?? 0,
        snaps: session.input.snaps,
        pips: m.pips,
        bankH: m.bankH,
        ring: m.ring,
        ringFill: m.ringFill,
        bleed: m.bleed,
        deepBins: bins(m.deepBand),
        glassBins: bins(m.glass),
        landBins: bins(m.land),
        flareBins: bins(m.flare),
        flarePhase: m.flarePhase,
        flareLeft: m.flareLeft,
        flareOut: Array.from(m.flareOut.values()),
        noonHeat: m.noonHeat,
        badgeX: h.badgeX,
        badgeY: h.cy,
        dialX: session.renderer.scene.haloIn.cx,
        dialY: session.renderer.scene.haloIn.cy,
        dialR: session.renderer.scene.haloIn.R,
      };
    },
  };
  window.__SHADY_TEST__ = hook;
}

/** A small DOM overlay updated 4×/s, with toggles for test points, masks and shadow outlines. */
export function installDebugOverlay(session: Session, draw: DebugDraw): void {
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText =
    'position:fixed;left:calc(env(safe-area-inset-left) + 64px);bottom:calc(env(safe-area-inset-bottom) + 8px);z-index:50;' +
    'font:600 11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#fff;background:rgba(20,16,40,0.72);' +
    'padding:6px 8px;border-radius:8px;white-space:pre;pointer-events:auto;max-width:72vw';
  const text = document.createElement('div');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;margin-top:4px';
  const toggle = (label: string, key: keyof DebugDraw): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    const sync = (): void => {
      b.style.cssText = `font:inherit;padding:2px 6px;border-radius:6px;border:0;color:#2B2140;background:${draw[key] ? '#2EC4B6' : '#ddd'}`;
    };
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => {
      draw[key] = !draw[key];
      sync();
    });
    sync();
    row.append(b);
  };
  toggle('pts', 'testPoints');
  toggle('mask', 'masks');
  toggle('shadow', 'outlines');
  box.append(text, row);
  document.body.append(box);
  const update = (): void => {
    const s = session.state;
    const st = session.stats;
    const w = s.world.stats;
    const v = session.renderer.scene.view;
    const gov = session.gov;
    const lines = [
      `fps ${st.fps.toFixed(0)}  frame ${st.frameMs.toFixed(1)}ms  sim ${st.simMs.toFixed(2)} gen ${st.genMs.toFixed(2)} draw ${st.renderMs.toFixed(2)}`,
      `ticks/f ${st.ticks}  dpr ${v.dpr.toFixed(2)} gov L${gov.level} (${gov.mean.toFixed(1)}ms, cadence ${gov.median.toFixed(1)}${gov.capped ? ' capped' : ''}, work ${gov.meanWork.toFixed(1)})  particles ${session.renderer.scene.particles.count}`,
      `casters ${s.world.casters.length}  chunks ${w.chunksValidated}/${w.chunksPlaced}  rescues ${w.rescues} parked ${w.parkedClouds} unres ${w.unresolved}`,
      `day ${s.day} t ${s.tDay.toFixed(1)}s  ε ${s.eps.toFixed(1)}°  θ ${s.sun.theta.toFixed(1)}° ${s.sun.mode}  ω ${s.sun.omega.toFixed(0)}`,
      `f ${s.nubs.f.toFixed(2)}  chill ${s.nubs.chill.toFixed(1)}  ×${s.nubs.mult}  hour lit ${s.hourLit.toFixed(2)}s  seed ${s.cfg.seed} p${s.cfg.profile}`,
    ];
    text.textContent = lines.join('\n');
  };
  window.setInterval(update, 250);
  update();
}
