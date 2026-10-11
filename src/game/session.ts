// The game session (TECH_SPEC §9.10, §13; V1_PLAN §6, §8, §11): owns the SimState and the run
// lifecycle (Title hold → play → dying → Results → retry/home), the fixed-step loop, and routes
// every frame's events to fx, audio, haptics, meta and the UI.

import {
  buildRunResult,
  createBot,
  createRun,
  createSnap,
  dayTicks,
  generateSome,
  lerpSnap,
  step,
  takeSnap,
  TUNING,
  type Bot,
  type ProfileId,
  type RenderSnap,
  type RunConfig,
  type RunResult,
  type SimEvent,
  type SimState,
} from '../core/index.ts';
import { createAudioView, type AudioView, type ScreenMode, type ShadyAudio } from '../audio/index.ts';
import type { Haptics } from '../platform/haptics.ts';
import { exportBackup, importBackup, backupErrorMessage } from '../meta/backup.ts';
import { challengeFromHash, type Challenge } from '../meta/challenge.ts';
import { dailyNumber, dailySeed, localDate } from '../meta/daily.ts';
import {
  applyRunResult,
  beginRun,
  buyCosmetic,
  dailyProgress,
  dailyStatus,
  dailyTryStarted,
  equipCosmetic,
  resetProgress,
  shouldShowInstallSheet,
  type RunOutcome,
} from '../meta/progression.ts';
import type { SaveStore } from '../meta/save.ts';
import type { Settings } from '../meta/saveTypes.ts';
import { buildShare } from '../meta/share.ts';
import { isIOS, isStandalone, onPageHidden, onReducedMotionChange, prefersReducedMotion } from '../platform/lifecycle.ts';
import { readSafeArea, onSafeAreaChange } from '../platform/safeArea.ts';
import { shareText } from '../platform/share.ts';
import { requestPersistence } from '../platform/storage.ts';
import { Renderer, type DebugDraw, type RenderInput, type RenderScreen } from '../render/renderer.ts';
import { renderWardrobePreview, resetNubsAnim } from '../render/nubs.ts';
import { clearParticles, clearPops, clearRings } from '../render/particles.ts';
import { resetFootprints } from '../render/ground.ts';
import { resetBanners } from '../render/banners.ts';
import { createUi } from '../ui/ui.ts';
import type { RunKind, ScreenId, Ui, UiSoundName } from '../ui/types.ts';
import { guideAlpha, HintTracker, type GuideSetting } from './assist.ts';
import { Fx } from './fx.ts';
import { Input } from './input.ts';
import { FixedClock } from './loop.ts';
import { startTFor, type Params } from './params.ts';
import { Governor } from './perf.ts';

const DYING_S = 1.1;
const MELODY_MAX = 32;
const IDLE_BUDGET = 12;
const DAILY_COUNT_MINUTES = 30;

export interface SessionDeps {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  params: Params;
  store: SaveStore;
  audio: ShadyAudio;
  haptics: Haptics;
  version: string;
}

export interface DebugStats {
  fps: number;
  frameMs: number;
  simMs: number;
  genMs: number;
  renderMs: number;
  ticks: number;
}

function profileFor(runs: number): ProfileId {
  return runs >= 3 ? 3 : (runs as ProfileId);
}

function randomSeed(): number {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return (a[0] as number) >>> 0;
  } catch {
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }
}

export class Session {
  readonly ui: Ui;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly clock = new FixedClock();
  readonly fx: Fx;
  readonly gov = new Governor();
  readonly stats: DebugStats = { fps: 60, frameMs: 0, simMs: 0, genMs: 0, renderMs: 0, ticks: 0 };

  private readonly d: SessionDeps;
  private readonly params: Params;
  private s: SimState;
  private readonly prev: RenderSnap = createSnap();
  private readonly curr: RenderSnap = createSnap();
  private readonly snap: RenderSnap = createSnap();
  private readonly frameEvents: SimEvent[] = [];
  private readonly audioView: AudioView = createAudioView();
  private readonly hints = new HintTracker();
  private readonly renderIn: RenderInput;

  // Run bookkeeping.
  private kind: RunKind = 'endless';
  private lifetimeRuns = 0;
  private melody: number[] = [];
  private dailyDate: string | null = null;
  private dailyScored = false;
  private dailyTry: number | null = null;
  private dailyCounted = false;
  private challenge: Challenge | null = null;
  private runChallenge: Challenge | null = null;
  private bot: Bot | null = null;
  private usedUrlSeed = false;
  private nextRun: SimState | null = null;
  private runActive = false;

  // Death / results.
  private deathAt = -1;
  private dyingGame = -1;
  private resultsAt = -1;
  private result: RunResult | null = null;
  private outcome: RunOutcome | null = null;
  private resultsShown = false;

  // Frame state.
  private paused = false;
  private last = -1;
  private time = 0;
  private swayPhase = 0;
  private swayOut = 0;
  private trapArmed = false;
  private ignorePopUntil = -1;
  private booted = false;
  private raf = 0;
  private cssW = 0;
  private sizeDirty = true;
  /** Cached reduced-motion decision (−1 = recompute). */
  private rmCache = -1;
  private cssH = 0;
  private dpr = 1;
  private readonly unsub: (() => void)[] = [];

  constructor(deps: SessionDeps) {
    this.d = deps;
    this.params = deps.params;
    this.gov.enabled = deps.params.perf;
    this.clock.fast = deps.params.fast;
    this.renderer = new Renderer(deps.canvas);
    this.fx = new Fx(this.renderer.scene, this.clock);
    const save = deps.store.get();
    this.challenge = challengeFromHash(location.hash);
    this.ui = createUi(deps.uiRoot, {
      callbacks: {
        startRun: (k) => this.startRun(k),
        retry: () => this.retry(),
        home: () => this.home(),
        pause: () => this.pause(),
        resume: () => this.resume(),
        restart: () => this.restart(),
        skipDying: () => this.showResults(),
        share: () => this.share(),
        settingsChanged: (st) => this.settingsChanged(st),
        buy: (id) => {
          const r = buyCosmetic(deps.store.get(), id);
          if (!r.ok) {
            deps.audio.play('uiError');
            return false;
          }
          deps.store.set(r.save);
          this.ui.setSave(r.save);
          deps.audio.play('uiBuy');
          return true;
        },
        equip: (id) => {
          const r = equipCosmetic(deps.store.get(), id);
          if (!r.ok) return;
          deps.store.set(r.save);
          this.ui.setSave(r.save);
        },
        exportBackup: () => exportBackup(deps.store.get()),
        importBackup: (code) => {
          const r = importBackup(code);
          if (!r.ok) return { ok: false, message: backupErrorMessage(r.error) };
          deps.store.set(r.save);
          deps.store.flush();
          this.ui.setSave(r.save);
          this.applySettings(r.save.settings);
          return { ok: true };
        },
        resetProgress: () => {
          const next = resetProgress(deps.store.get());
          deps.store.set(next);
          deps.store.flush();
          this.ui.setSave(next);
        },
        dismissChallenge: () => {
          this.challenge = null;
          try {
            history.replaceState(history.state, '', location.pathname + location.search);
          } catch {
            // ignore
          }
        },
        dragHandoff: (e) => {
          if (this.ui.current() === 'title') this.input.begin(e);
        },
        uiSound: (name) => this.uiSound(name),
        renderWardrobePreview: (canvas, equipped) => renderWardrobePreview(canvas, equipped),
      },
      save,
      today: localDate(),
      version: deps.version,
    });
    if (this.challenge) {
      const c = this.challenge;
      const note = c.k === 'd' && c.d !== localDate() ? `Daily #${dailyNumber(c.d)} · practice run` : c.k === 'd' ? `Daily #${dailyNumber(c.d)}` : undefined;
      this.ui.setChallenge(note ? { minutes: c.m, note } : { minutes: c.m });
    }
    this.input = new Input({
      canvas: deps.canvas,
      accepting: () => this.accepting(),
      onPress: () => this.onPress(),
      viewportWidth: () => this.renderer.scene.view.vw,
      safeBottom: () => this.renderer.scene.view.safe.bottom,
    });
    this.applySettings(save.settings);
    this.s = this.createTitleRun();
    this.lifetimeRuns = save.stats.runs;
    this.resetSnaps();

    this.renderIn = {
      s: this.s,
      snap: this.snap,
      screen: 'boot',
      sway: 0,
      dragging: false,
      guideAlpha: 0,
      pbMinutes: -1,
      challengeMinutes: -1,
      dying: -1,
      mapT: -1,
      sheetTop: null,
      time: 0,
      dt: 0,
      gdt: 0,
      highContrast: save.settings.highContrast,
      reducedMotion: false,
      equipped: save.equipped,
      detail: true,
      paused: false,
      debug: null,
    };

    deps.audio.onHeartbeat = () => deps.haptics.play('heartbeat');
    const syncMuted = (): void => this.ui.setAudioMuted(!deps.audio.running || deps.audio.muted);
    deps.audio.onStatusChange(syncMuted);
    syncMuted();

    this.unsub.push(
      onPageHidden(() => {
        deps.store.flush();
        if (this.ui.current() === 'play') {
          this.ui.show('pause');
          this.pause();
        }
      }),
    );
    const onPop = (): void => {
      if (this.time < this.ignorePopUntil) return;
      // Our history entry was just consumed.
      const wasArmed = this.trapArmed;
      this.trapArmed = false;
      const sc = this.ui.current();
      if (sc === 'play') {
        this.ui.show('pause');
        this.pause();
      }
      // A run is still in progress (playing, paused, or settings opened from pause): re-arm.
      if (wasArmed && this.runActive && this.deathAt < 0 && (sc === 'play' || sc === 'pause' || sc === 'settings')) this.trap();
    };
    window.addEventListener('popstate', onPop);
    this.unsub.push(() => window.removeEventListener('popstate', onPop));
    this.unsub.push(onSafeAreaChange(() => (this.sizeDirty = true)));
    const onResize = (): void => {
      this.sizeDirty = true;
    };
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(onResize);
      ro.observe(deps.canvas);
      this.unsub.push(() => ro.disconnect());
    }
    window.addEventListener('orientationchange', onResize);
    this.unsub.push(() => window.removeEventListener('orientationchange', onResize));
    this.unsub.push(
      onReducedMotionChange(() => {
        this.rmCache = -1;
      }),
    );
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    this.unsub.push(() => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    });
    this.gov.onChange = () => {
      this.resize(true);
      this.renderer.scene.particles.limit = this.gov.particleCap;
    };
    this.resize(true);
  }

  // -------------------------------------------------------------------------------------------
  // Boot and the frame loop
  // -------------------------------------------------------------------------------------------

  /** Starts the loop; shows the Title (or autoplays with ?bot=) after the first frame. */
  start(onFirstFrame: () => void): void {
    const first = (now: number): void => {
      this.last = now;
      this.frame(now);
      if (!this.booted) {
        this.booted = true;
        if (this.params.bot) {
          this.bot = createBot(this.params.bot);
          this.ui.show('play');
          this.beginRun(this.s);
        } else {
          this.ui.show('title');
        }
        onFirstFrame();
      }
      this.raf = requestAnimationFrame((t) => this.loop(t));
    };
    this.raf = requestAnimationFrame(first);
  }

  private loop(now: number): void {
    this.frame(now);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const u of this.unsub) u();
    this.input.dispose();
    this.ui.destroy();
  }

  private resize(force: boolean): void {
    const c = this.d.canvas;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1) * this.gov.dprScale;
    if (!force && w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    // A new size means new buffers and first-frame costs: the governor warms up again.
    if (w !== this.cssW || h !== this.cssH) this.gov.reset();
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.renderer.resize(w, h, dpr, readSafeArea());
  }

  private frame(now: number): void {
    const t0 = performance.now();
    const realMs = this.last < 0 ? 16.7 : now - this.last;
    this.last = now;
    const real = Math.min(0.1, Math.max(0, realMs / 1000));
    this.time += real;
    this.stats.fps += (1000 / Math.max(1, realMs) - this.stats.fps) * 0.05;
    if (this.sizeDirty) {
      // Re-read size and safe-area insets (a notch can change without the canvas resizing).
      this.sizeDirty = false;
      this.resize(true);
    }

    const screen = this.ui.current();
    const stepping = !this.paused && (screen === 'play' || screen === 'dying') && this.s.phase !== 'dead';
    const s = this.s;
    let n = 0;
    const events = this.frameEvents;
    events.length = 0;
    const tSim = performance.now();
    if (stepping) {
      n = this.clock.advance(real);
      const frames = this.bot ? null : this.input.takeFrames(n);
      for (let i = 0; i < n; i++) {
        takeSnap(s, this.prev);
        const f = this.bot ? this.bot.next(s) : (frames?.[i] ?? null);
        if (!f) break;
        step(s, f);
        for (const ev of s.events) {
          events.push(ev);
          this.onTickEvent(ev);
        }
        if (s.phase === 'dead') break;
      }
      if (n > 0) takeSnap(s, this.curr);
    } else {
      this.clock.advance(screen === 'dying' || screen === 'results' ? real : 0);
      if (screen === 'dying' || screen === 'results') this.clock.acc = 0;
    }
    this.stats.ticks = n;
    this.stats.simMs = performance.now() - tSim;
    lerpSnap(this.prev, this.curr, this.clock.alpha, this.snap);

    // Route events.
    const view = this.fillAudioView(screen);
    if (events.length > 0) {
      this.d.audio.onEvents(events, view);
      this.d.haptics.onEvents(events, s.sun.omega);
      this.fx.onEvents(events, s);
    }
    this.afterEvents(events);

    // Idle-time world generation (keeps step() from ever validating a chunk inside a tick).
    const tGen = performance.now();
    if (screen !== 'boot') generateSome(s.world, s.nubs.y + TUNING.world.idleAhead, IDLE_BUDGET);
    this.stats.genMs = performance.now() - tGen;

    const gdt = stepping || screen === 'dying' || screen === 'results' ? this.clock.gameDt : screen === 'pause' ? 0 : real;
    if (this.deathAt >= 0) this.dyingGame += this.clock.gameDt;
    this.fx.update(stepping ? this.clock.gameDt : 0, s, s.phase === 'day' || s.phase === 'night');
    this.updateHints(real, screen);
    this.updateDeathFlow();

    // Render.
    const r = this.renderIn;
    r.s = s;
    r.screen = this.renderScreen(screen);
    this.swayPhase += real;
    if (screen === 'title' || (screen === 'play' && s.phase === 'hold')) {
      const rm = this.reducedMotion();
      r.sway = rm ? 0 : 25 * Math.sin(this.swayPhase * Math.PI * 2 * 0.3);
      this.swayOut = r.sway;
    } else {
      this.swayOut *= Math.exp(-real / 0.12);
      if (Math.abs(this.swayOut) < 0.01) this.swayOut = 0;
      r.sway = this.swayOut;
    }
    r.dragging = this.input.pointerDown || this.input.keyDown || s.sun.mode === 'dragging';
    r.guideAlpha = this.currentGuideAlpha();
    const save = this.d.store.get();
    r.pbMinutes = this.pbMinutes();
    r.challengeMinutes = this.runChallenge ? this.runChallenge.m : -1;
    r.dying = this.deathAt >= 0 ? Math.max(0, this.dyingGame) : -1;
    r.mapT = this.resultsAt >= 0 && screen === 'results' ? this.time - this.resultsAt : -1;
    r.sheetTop = screen === 'results' ? this.ui.resultsSheetTop() : null;
    r.time = this.time;
    r.dt = real;
    r.gdt = gdt;
    r.highContrast = save.settings.highContrast;
    r.reducedMotion = this.reducedMotion();
    r.equipped = save.equipped;
    r.detail = this.gov.detail;
    r.paused = this.paused || screen === 'pause';
    this.fx.reducedMotion = r.reducedMotion;
    const tRender = performance.now();
    this.renderer.draw(r);
    this.stats.renderMs = performance.now() - tRender;
    this.d.audio.update(view, real);
    this.stats.frameMs = performance.now() - t0;
    // The governor weighs the rAF interval against this frame's own work (see perf.ts).
    this.gov.sample(realMs, this.stats.frameMs, real);
  }

  private renderScreen(id: ScreenId): RenderScreen {
    switch (id) {
      case 'boot':
      case 'title':
      case 'play':
      case 'pause':
      case 'dying':
      case 'results':
        return id;
      default:
        return 'menu';
    }
  }

  private fillAudioView(screen: ScreenId): AudioView {
    const v = this.audioView;
    const s = this.s;
    let mode: ScreenMode;
    if (this.ui.isRotateBlocking()) mode = 'paused';
    else if (screen === 'title' || screen === 'boot') mode = 'title';
    else if (screen === 'play') mode = 'play';
    else if (screen === 'pause') mode = 'paused';
    else if (screen === 'dying') mode = 'dying';
    else if (screen === 'results') mode = 'results';
    else mode = 'menu';
    v.screen = mode;
    v.phase = s.phase;
    v.day = s.day;
    v.tDay = s.tDay;
    v.dayLength = s.params.dayLen;
    v.eps = s.eps;
    v.epsNoon = s.params.epsNoon;
    v.f = s.nubs.f;
    const lit = s.nubs.f * 5;
    v.glareW = lit > 0 ? Math.min(1, (2 * s.nubs.glare) / lit) : 0;
    v.chill = s.nubs.chill;
    v.mult = s.nubs.mult;
    v.omega = s.sun.omega;
    return v;
  }

  // -------------------------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------------------------

  private reducedMotion(): boolean {
    const m = this.d.store.get().settings.reducedMotion;
    if (m !== 'auto') return m === 'on';
    if (this.rmCache < 0) this.rmCache = prefersReducedMotion() ? 1 : 0;
    return this.rmCache === 1;
  }

  private debugStart(cfg: RunConfig): RunConfig {
    const p = this.params;
    if (p.day !== null) cfg.startDay = p.day;
    const t = startTFor(p.t, p.day ?? 1);
    if (t !== null) cfg.startT = t;
    if (p.chill !== null) cfg.startChill = p.chill;
    return cfg;
  }

  /** A fresh run config for `kind` (endless seeds are random unless ?seed= is given). */
  private makeRun(kind: RunKind): SimState {
    const save = this.d.store.get();
    const p = this.params;
    const today = localDate();
    const rm = this.reducedMotion();
    let cfg: RunConfig;
    this.runChallenge = null;
    this.dailyDate = null;
    this.dailyScored = false;
    if (kind === 'daily' || (kind === 'endless' && p.daily && !this.usedUrlSeed)) {
      const date = kind === 'daily' ? today : (p.date ?? today);
      cfg = { seed: dailySeed(date), mode: 'daily', profile: 3, tutorial: false, reducedMotion: rm, dailyDate: date };
      this.dailyDate = date;
      this.dailyScored = date === today;
      if (kind === 'endless') this.usedUrlSeed = true;
      this.kind = 'daily';
    } else if (kind === 'challenge' && this.challenge) {
      const c = this.challenge;
      this.runChallenge = c;
      if (c.k === 'd') {
        cfg = { seed: dailySeed(c.d), mode: 'daily', profile: 3, tutorial: false, reducedMotion: rm, dailyDate: c.d };
        this.dailyDate = c.d;
        this.dailyScored = c.d === today;
      } else {
        cfg = { seed: c.seed >>> 0, mode: 'challenge', profile: 3, tutorial: false, reducedMotion: rm };
      }
      this.kind = 'challenge';
    } else {
      let seed: number;
      if (p.seed !== null && !this.usedUrlSeed) {
        seed = p.seed;
        this.usedUrlSeed = true;
      } else {
        seed = randomSeed();
      }
      const profile = p.profile ?? profileFor(save.stats.runs);
      cfg = { seed, mode: 'endless', profile, tutorial: profile === 0, reducedMotion: rm };
      this.kind = 'endless';
    }
    if (p.profile !== null && cfg.mode !== 'endless') {
      // Debug override applies to every mode.
      cfg.profile = p.profile;
      cfg.tutorial = p.profile === 0;
    }
    return createRun(this.debugStart(cfg));
  }

  /** The Title's live scene: the next endless run, held at dawn. */
  private createTitleRun(): SimState {
    if (this.nextRun && this.nextRun.cfg.mode === 'endless' && this.nextRun.phase === 'hold') {
      const r = this.nextRun;
      this.nextRun = null;
      this.kind = 'endless';
      this.runChallenge = null;
      this.dailyDate = null;
      return r;
    }
    return this.makeRun('endless');
  }

  private resetSnaps(): void {
    takeSnap(this.s, this.prev);
    takeSnap(this.s, this.curr);
    takeSnap(this.s, this.snap);
  }

  private resetRender(): void {
    const sc = this.renderer.scene;
    clearParticles(sc.particles);
    clearRings(sc.rings);
    clearPops(sc.pops);
    resetBanners(sc.banners);
    resetNubsAnim(sc.nubs);
    resetFootprints(sc.footprints, this.s.nubs.y);
    sc.sun.guilty = 0;
    sc.relief = 0;
    sc.mapReady = false;
    sc.hud.multPop = 0;
    sc.hud.multShake = 0;
  }

  /**
   * Makes `run` the current run and starts its bookkeeping (it may still be in 'hold'). A press that
   * starts the run keeps its pending input (its downEdge is the run's start frame).
   */
  private beginRun(run: SimState, keepInput = false): void {
    this.s = run;
    this.renderIn.s = run;
    this.resetSnaps();
    this.resetRender();
    this.clock.reset();
    if (!keepInput) this.input.clearPending();
    if (this.params.bot) this.bot = createBot(this.params.bot);
    this.d.audio.resetRun();
    this.melody = [];
    this.hints.reset();
    this.dailyTry = null;
    this.dailyCounted = false;
    this.deathAt = -1;
    this.dyingGame = -1;
    this.resultsAt = -1;
    this.result = null;
    this.outcome = null;
    this.resultsShown = false;
    this.paused = false;
    this.runActive = true;
    const store = this.d.store;
    this.lifetimeRuns = store.get().stats.runs;
    const begun = beginRun(store.get());
    if (begun.save !== store.get()) {
      store.set(begun.save);
      this.ui.setSave(begun.save);
    }
    this.trap();
    this.setGhost('off');
  }

  private ghost: 'off' | 'both' | 'left' | 'right' = 'off';

  private setGhost(mode: 'off' | 'both' | 'left' | 'right'): void {
    if (mode === this.ghost) return;
    this.ghost = mode;
    this.ui.setGhostThumb(mode);
  }

  /** V1_PLAN §8.2: Back during play pauses instead of leaving. */
  private trap(): void {
    if (this.trapArmed) return;
    try {
      history.pushState({ play: 1 }, '');
      this.trapArmed = true;
    } catch {
      // History may be unavailable (sandboxed iframes): play on without the trap.
    }
  }

  private untrap(): void {
    if (!this.trapArmed) return;
    this.trapArmed = false;
    try {
      this.ignorePopUntil = this.time + 0.6;
      history.back();
    } catch {
      // ignore
    }
  }

  private accepting(): boolean {
    if (this.paused || this.ui.isRotateBlocking()) return false;
    const sc = this.ui.current();
    return sc === 'title' || sc === 'play';
  }

  private onPress(): void {
    this.d.audio.ensure();
    if (this.ui.current() === 'title') {
      // Any press on the canvas starts the Title's run with catch semantics (θ stays θ0).
      this.ui.show('play');
      this.beginRun(this.s, true);
    }
  }

  private startRun(kind: RunKind): void {
    this.d.audio.ensure();
    if (kind === 'endless') {
      if (this.s.phase !== 'hold' || this.s.cfg.mode !== 'endless') this.s = this.makeRun('endless');
      this.beginRun(this.s);
      this.input.tap();
      return;
    }
    // Daily and challenge runs wait for the first press (clock held at dawn).
    const run = this.makeRun(kind);
    this.beginRun(run);
    this.setGhost('both');
  }

  private retry(): void {
    this.d.audio.ensure();
    let run: SimState;
    if (this.kind === 'endless' && this.nextRun && this.nextRun.cfg.mode === 'endless') {
      run = this.nextRun;
      this.nextRun = null;
      this.kind = 'endless';
      this.runChallenge = null;
      this.dailyDate = null;
    } else {
      run = this.makeRun(this.kind);
    }
    this.beginRun(run);
    this.input.tap();
  }

  private restart(): void {
    this.retry();
  }

  private home(): void {
    this.untrap();
    this.d.audio.stopMelody();
    this.runActive = false;
    this.paused = false;
    this.input.releaseAll();
    this.s = this.createTitleRun();
    this.renderIn.s = this.s;
    this.resetSnaps();
    this.resetRender();
    this.deathAt = -1;
    this.dyingGame = -1;
    this.resultsAt = -1;
    this.setGhost('both');
  }

  private pause(): void {
    this.paused = true;
    this.input.releaseAll();
    this.setGhost('off');
  }

  private resume(): void {
    this.d.audio.ensure();
    this.paused = false;
    this.input.releaseAll();
    this.clock.acc = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Events, daily bookkeeping, death and results
  // -------------------------------------------------------------------------------------------

  private onTickEvent(ev: SimEvent): void {
    switch (ev.e) {
      case 'flake':
        if (this.melody.length < MELODY_MAX) this.melody.push(ev.degree);
        break;
      case 'hourEnd':
        if (this.dailyTry !== null && this.dailyDate) {
          const next = dailyProgress(this.d.store.get(), this.dailyDate, this.s.minutes, this.s.stats.snow);
          if (next !== this.d.store.get()) {
            this.d.store.set(next);
            this.d.store.flush();
          }
        }
        break;
      case 'death':
        this.onDeath();
        break;
      default:
        break;
    }
  }

  private afterEvents(events: readonly SimEvent[]): void {
    void events;
    this.checkDailyTry();
  }

  /** Daily: a try is counted (and saved at once) when the run passes 6:30 AM. */
  private checkDailyTry(): void {
    const s = this.s;
    if (this.dailyScored && this.dailyDate && !this.dailyCounted && s.phase !== 'hold' && s.minutes >= DAILY_COUNT_MINUTES) {
      this.dailyCounted = true;
      const r = dailyTryStarted(this.d.store.get(), this.dailyDate);
      this.dailyTry = r.tryNumber;
      if (r.save !== this.d.store.get()) {
        this.d.store.set(r.save);
        this.d.store.flush();
        this.ui.setSave(r.save);
      }
    }
  }

  private onDeath(): void {
    if (this.deathAt >= 0) return;
    this.deathAt = this.time;
    this.dyingGame = 0;
    this.checkDailyTry();
    const save = this.d.store.get();
    const result = buildRunResult(this.s);
    result.melody = this.melody.slice();
    const setting = this.params.guide ?? save.settings.guide;
    result.assisted = setting === 'always';
    const { save: next, outcome } = applyRunResult(save, result, { today: localDate(), dailyTry: this.dailyTry });
    this.d.store.set(next);
    this.d.store.flush();
    this.ui.setSave(next);
    this.result = result;
    this.outcome = outcome;
    if (!next.flags.persistRequested) {
      void requestPersistence();
      this.d.store.update((sv) => {
        sv.flags.persistRequested = true;
      });
    }
    this.untrap();
    this.setGhost('off');
    this.input.releaseAll();
    if (this.ui.current() === 'play') this.ui.show('dying');
    // Build the next endless run now, inside the death hit-stop where a hitch can't be seen, so
    // Retry is instant however fast it is tapped.
    if (this.kind === 'endless' && !this.nextRun) this.nextRun = this.makeRunQuiet();
  }

  private updateDeathFlow(): void {
    if (this.deathAt < 0 || this.resultsShown) return;
    if (this.time - this.deathAt >= DYING_S) this.showResults();
  }

  private showResults(): void {
    if (this.resultsShown || !this.result || !this.outcome) return;
    this.resultsShown = true;
    const view = {
      result: this.result,
      outcome: this.outcome,
      dailyTry: this.result.mode === 'daily' ? this.dailyTry : undefined,
      ...(this.runChallenge ? { challengeTarget: this.runChallenge.m } : {}),
    };
    this.ui.show('results', view);
    this.resultsAt = this.time;
    this.d.audio.playMelody(this.result.melody, this.result.day);
    if (this.outcome.newBest) {
      this.d.audio.play('newBest');
      this.d.haptics.play('best');
      this.fx.confetti(40);
    }
    const save = this.d.store.get();
    if (shouldShowInstallSheet(save, { ios: isIOS(), standalone: isStandalone() })) {
      this.ui.showInstallSheet();
      this.d.store.update((sv) => {
        sv.flags.installSheetShown = true;
      });
    }
    // Pre-build the next endless run while the sheet is up, so Retry is instant.
    window.setTimeout(() => {
      if (this.ui.current() === 'results' && this.kind === 'endless' && !this.nextRun) this.nextRun = this.makeRunQuiet();
    }, 450);
    if (this.bot) {
      window.setTimeout(() => {
        if (this.ui.current() === 'results') {
          this.ui.show('play');
          this.retry();
        }
      }, 1500);
    }
  }

  /** makeRun without disturbing the current run's kind/challenge bookkeeping. */
  private makeRunQuiet(): SimState {
    const kind = this.kind;
    const ch = this.runChallenge;
    const dd = this.dailyDate;
    const ds = this.dailyScored;
    const run = this.makeRun('endless');
    this.kind = kind;
    this.runChallenge = ch;
    this.dailyDate = dd;
    this.dailyScored = ds;
    return run;
  }

  private async share(): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
    if (!this.result) return 'failed';
    const payload = buildShare(this.result, location.origin + location.pathname, this.dailyTry);
    return shareText({ text: payload.text });
  }

  // -------------------------------------------------------------------------------------------
  // Assists, settings, sounds
  // -------------------------------------------------------------------------------------------

  private currentGuideAlpha(): number {
    const s = this.s;
    const save = this.d.store.get();
    const setting: GuideSetting = this.params.guide ?? save.settings.guide;
    const frac = Math.min(1, s.dayTick / dayTicks(s.day));
    return guideAlpha(setting, s.cfg.profile, this.lifetimeRuns, s.day, frac);
  }

  private pbMinutes(): number {
    const save = this.d.store.get();
    if (this.dailyDate) {
      const st = dailyStatus(save, this.dailyDate);
      return st.bestMinutes > 0 ? st.bestMinutes : -1;
    }
    return save.stats.bestMinutes > 0 && save.stats.runs >= 3 ? save.stats.bestMinutes : -1;
  }

  private updateHints(dt: number, screen: ScreenId): void {
    if (screen === 'title') {
      this.setGhost('both');
      return;
    }
    if (screen !== 'play' || this.paused) return;
    const s = this.s;
    if (s.phase === 'hold') {
      this.setGhost('both');
      return;
    }
    if (this.ghost === 'both') this.setGhost('off');
    const was = this.hints.active > 0;
    const start = this.hints.update(dt, s.cfg.profile, s.nubs.f, s.sunUp, s.guide.now, s.sun.theta, this.input.pointerDown || this.input.keyDown);
    if (start) {
      this.setGhost(this.hints.dir);
      this.d.store.update((sv) => {
        sv.flags.hintsShown += 1;
      });
    } else if (was && this.hints.active <= 0) {
      this.setGhost('off');
    }
  }

  private settingsChanged(st: Settings): void {
    this.d.store.update((sv) => {
      sv.settings = st;
    });
    this.applySettings(st);
    this.ui.setSave(this.d.store.get());
  }

  private applySettings(st: Settings): void {
    this.d.audio.setVolumes(st.sfx, st.music);
    this.d.haptics.setEnabled(st.haptics);
    this.input.sensitivity = st.sensitivity;
    this.input.invert = st.invert;
  }

  private uiSound(name: UiSoundName): void {
    const a = this.d.audio;
    switch (name) {
      case 'buy':
      case 'equip':
      case 'unlock':
      case 'stamp':
        a.play('uiBuy');
        break;
      case 'deny':
        a.play('uiError');
        break;
      default:
        a.play('uiTap');
        break;
    }
    this.d.haptics.play('ui');
  }

  // -------------------------------------------------------------------------------------------
  // Test hook support
  // -------------------------------------------------------------------------------------------

  get state(): SimState {
    return this.s;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Test hook: Nubs melts on the next daylight tick (it touches the sim only through its Chill). */
  forceDeath(): void {
    const s = this.s;
    if (s.phase === 'dead') return;
    if (s.phase === 'hold') {
      if (this.ui.current() === 'title') this.ui.show('play');
      this.beginRun(s);
      this.input.tap();
    }
    s.nubs.chill = -1e6;
  }

  get active(): boolean {
    return this.runActive;
  }

  /** Test hook: replays a moment through fx and audio only (the sim is untouched). */
  demo(name: string): void {
    const s = this.s;
    let ev: SimEvent | null = null;
    switch (name) {
      case 'phew':
        ev = { e: 'phew' };
        break;
      case 'mult':
        ev = { e: 'multUp', level: Math.min(5, s.nubs.mult + 1) };
        break;
      case 'mult5':
        ev = { e: 'multUp', level: 5 };
        break;
      case 'noon':
        ev = { e: 'noonBanner' };
        break;
      case 'dawn':
        ev = { e: 'dawn', day: s.day + 1 };
        break;
      case 'night':
        ev = { e: 'nightStart', day: s.day };
        break;
      case 'cloud':
        ev = { e: 'cloudCapture', id: -1 };
        break;
      case 'glare':
        ev = { e: 'glareTouch', ballId: -1 };
        break;
      case 'flake':
        ev = { e: 'flake', mult: s.nubs.mult, degree: 3, x: s.nubs.x, y: s.nubs.y + 30, snow: s.nubs.mult };
        break;
      case 'best':
        this.fx.confetti(40);
        return;
      default:
        return;
    }
    const list = [ev];
    this.fx.onEvents(list, s);
    this.d.audio.onEvents(list, this.audioView);
  }

  /** Debug geometry toggles (?debug=1). */
  setDebugDraw(d: DebugDraw | null): void {
    this.renderIn.debug = d;
  }
}
