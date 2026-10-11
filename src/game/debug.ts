// Debug overlay (?debug=1) and the test hook (?test=1, window.__SHADY_TEST__) — V1_PLAN §14.

import { runHeadless, type BotKind } from '../core/index.ts';
import type { ShadyAudio } from '../audio/index.ts';
import type { DebugDraw } from '../render/renderer.ts';
import type { Session } from './session.ts';

export interface ShadyTestHook {
  screen(): string;
  state(): { phase: string; day: number; minutes: number; chill: number; snow: number; theta: number; f: number };
  forceDeath(): void;
  runHeadless(seed: number, ticks: number, bot: string): string;
  setTimeScale(n: number): void;
  audioState(): string;
  /** Extras for tooling. */
  paused(): boolean;
  presses(): number;
  /** Plays a render-only moment (phew, mult, noon, dawn, cloud, glare, flake, best) for visual review. */
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
    /** Ground tile repaints so far (render/ground.ts GroundPaint). */
    groundPaints: number;
    /** Canvas DPR and governor level now. */
    dpr: number;
    govLevel: number;
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
    state: () => {
      const s = session.state;
      return {
        phase: s.phase,
        day: s.day,
        minutes: s.minutes,
        chill: s.nubs.chill,
        snow: s.stats.snow,
        theta: s.sun.theta,
        f: s.nubs.f,
      };
    },
    forceDeath: () => session.forceDeath(),
    runHeadless: (seed, ticks, bot) => runHeadless(seed, ticks, bot as BotKind),
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
    }),
    nubsScreen: () => ({ x: session.renderer.scene.pose.x, y: session.renderer.scene.pose.y }),
    timeScale: () => session.clock.timeScale,
    hint: () => session.hintState(),
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
