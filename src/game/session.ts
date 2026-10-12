// The game session (TECH_SPEC §9.10, §13; V1_PLAN §6, §8, §11): owns the SimState and the run
// lifecycle (Title hold → play → dying → Results → retry/home), the fixed-step loop, and routes
// every frame's events to fx, audio, haptics, meta and the UI.

import {
  buildRunResult,
  createBot,
  createRun,
  createSnap,
  dayTicks,
  effectiveDrain,
  formatTimeOfDay,
  generateSome,
  lerpSnap,
  prepareRun,
  prepareSome,
  splitMinutes,
  step,
  takeSnap,
  TUNING,
  type Bot,
  type BotKind,
  type RenderSnap,
  type RunBuild,
  type RunConfig,
  type RunResult,
  type SimEvent,
  type SimState,
} from '../core/index.ts';
import { createAudioView, type AudioView, type ScreenMode, type ShadyAudio } from '../audio/index.ts';
import type { Haptics } from '../platform/haptics.ts';
import { exportBackup, importBackup, backupErrorMessage } from '../meta/backup.ts';
import { challengeFromHash, type Challenge } from '../meta/challenge.ts';
import { DAILY_TRIES, dailyNumber, dailySeed, localDate } from '../meta/daily.ts';
import {
  applyRunResult,
  beginRun,
  buyCosmetic,
  debugRunOutcome,
  dailyStatus,
  dailyProgress,
  dailyTryStarted,
  equipCosmetic,
  isDailyUnlocked,
  resetProgress,
  shouldShowInstallSheet,
  type RunOutcome,
} from '../meta/progression.ts';
import type { SaveStore } from '../meta/save.ts';
import { buildShare, shareBase } from '../meta/share.ts';
import type { SaveV1, Settings } from '../meta/saveTypes.ts';
import {
  isInAppBrowser,
  isIOS,
  isStandalone,
  onPageHidden,
  onPageVisible,
  onReducedMotionChange,
  onWindowBlur,
  prefersReducedMotion,
} from '../platform/lifecycle.ts';
import { readSafeArea, onSafeAreaChange } from '../platform/safeArea.ts';
import { shareText } from '../platform/share.ts';
import { requestPersistence } from '../platform/storage.ts';
import { Renderer, type DebugDraw, type RenderInput, type RenderOptions, type RenderScreen } from '../render/renderer.ts';
import { resetDeathBeat } from '../render/deathbeat.ts';
import { renderWardrobePreview, resetNubsAnim } from '../render/nubs.ts';
import { calloutBoxes, calloutsDrawn } from '../render/meltMap.ts';
import { createPostcardJob, postcardName, stepPostcard, type PostcardJob } from '../render/postcard.ts';
import { renderSunPreview } from '../render/sun.ts';
import { logoLayers } from '../ui/art.ts';
import { clearParticles, clearPops, clearRings } from '../render/particles.ts';
import { resetFootprints } from '../render/ground.ts';
import { resetBanners } from '../render/banners.ts';
import { createUi } from '../ui/ui.ts';
import type { ImportOutcome, RunKind, ScreenId, Ui, UiSoundName } from '../ui/types.ts';
import { ghostSwingX, guideAlpha, HintTracker, LESSON_TIME_SCALE, type GuideSetting, type HintInput } from './assist.ts';
import { Cadence, type CadenceInput } from './cadence.ts';
import { createCameraFx } from './camera.ts';
import { showCrashOverlay } from './crash.ts';
import { Fx } from './fx.ts';
import { Input } from './input.ts';
import { FixedClock } from './loop.ts';
import { dailyDateInBounds, isDebugRun, startTFor, type Params } from './params.ts';
import { canvasDpr, deviceClass, dprCap, Governor } from './perf.ts';
import {
  biomeAtWorld,
  COMFORT_MAX,
  createParJob,
  type ParJob,
  deathRecap,
  deathTip,
  effectiveNoonCloud,
  forecastOf,
  lessonOnOf,
  lessonShimTick,
  PLAN_START_DATE,
  planOnOf,
  rungConfig,
  shadesLook,
  worldPlan,
  type RunConfigV11,
  type SimEventV11,
} from '../render/shims.ts';
import {
  challengeRules,
  comfortOn,
  comfortStat,
  historyLength,
  nextMilestone,
  recentBest,
  uiV11,
  type ApplyRunOptionsV11,
  type ChallengeBannerV11,
  type CueId,
  type ResultsViewV11,
  dailyPar,
  setDailyPar,
  shareFiles,
  type ShareOutcomeV11,
  swapMission,
  type UiCallbacksV11,
} from './shims.ts';
import type { StampKind } from '../render/banners.ts';

const DYING_S = 1.1;
const MELODY_MAX = 32;
const IDLE_BUDGET = 12;
/** The par job's share of an idle frame (A13: ≤ 3 ms) and its sim chunk. */
const PAR_MS = 3;
const PAR_TICKS = 6;

/** Runs `fn` in idle time (a frame later where requestIdleCallback is missing). */
function idle(fn: () => void): void {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 400 });
  else setTimeout(fn, 16);
}
/**
 * Real ms per frame spent building the next run's world while a death or the Results play: 2.5 ms,
 * or up to a tenth of the frame interval on slow devices (≤ 10 ms), so it is done before Retry.
 */
const PREBUILD_MS = 2.5;
const PREBUILD_SHARE = 0.1;
const PREBUILD_MAX_MS = 10;
/** Work units per prebuild slice (each slice is checked against PREBUILD_MS). */
const PREBUILD_SLICE = 4;
const DAILY_COUNT_MINUTES = 30;
/** Title sway amplitude (GDD §4: ±25° around θ0), following the ghost hand's swing. */
const SWAY_DEG = 25;
/** Render-time cap per drawn frame (s), like the frame's own real-time cap. */
const MAX_DRAW_DT = 0.1;
/** Consecutive failed frames (about 0.5 s) before the crash overlay replaces the game. */
const CRASH_FRAMES = 30;
/** How long a history.back() of our own may take to come back as a popstate (ms). */
const DISARM_WAIT_MS = 600;
/** Title frames before the play HUD is prebuilt (keeps it off the first, boot-heavy frames). */
const TITLE_HUD_PREBUILD_FRAMES = 3;
/** The local date is re-read at most this often from the frame loop (ms). */
const TODAY_CHECK_MS = 1000;
/** Reset/Restore refusal while a newer version's save sits on disk (it must not be overwritten). */
const NEWER_SAVE_MESSAGE = 'A newer version of SHADY saved progress here. Update the game first.';

export interface SessionDeps {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  params: Params;
  store: SaveStore;
  audio: ShadyAudio;
  haptics: Haptics;
  version: string;
}

/** mapProbe() result: device-pixel differences with/without the Melt Map overlay, by region. */
export interface MapProbe {
  /** The Results sheet's top (CSS px) and the first device-px row counted as below it. */
  sheetTop: number;
  cutRow: number;
  dpr: number;
  above: number;
  below: number;
  /** Device-px box (x0, y0, x1, y1) of the differences below the cut, or null. */
  belowBox: number[] | null;
  /** The frame with the overlay, as a PNG data URL (test attachments). */
  png: string;
}

/** pixelAB() result: per-pixel max-channel differences between two renders of one frame. */
export interface PixelAB {
  mean: number;
  over3: number;
  over8: number;
  max: number;
}

export interface DebugStats {
  fps: number;
  frameMs: number;
  simMs: number;
  genMs: number;
  renderMs: number;
  ticks: number;
}

/** A challenge the game can play: k:'d' dates must be in bounds (params.ts dailyDateInBounds). */
function playableChallenge(c: Challenge | null): Challenge | null {
  if (!c) return null;
  if (c.k === 'd' && !dailyDateInBounds(c.d)) return null;
  return c;
}

function sameChallenge(a: Challenge | null, b: Challenge | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.k !== b.k || a.m !== b.m || a.s !== b.s) return false;
  return a.k === 'e' ? a.seed === (b as typeof a).seed : a.d === (b as typeof a).d;
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
  readonly cadence = new Cadence();
  private readonly cadenceIn: CadenceInput = { now: 0, screen: 'boot', inputActive: false, timeScale: 1, reducedMotion: false, settled: false };
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
  private readonly hintIn: HintInput;
  /** Cues shown this run (bit per CueId: each at most once per run). */
  private cues = 0;
  /** Eased visibility of the hint on the halo dial. */
  private hintAlpha = 0;
  private readonly renderIn: RenderInput;

  // Run bookkeeping.
  private kind: RunKind = 'endless';
  private lifetimeRuns = 0;
  private melody: number[] = [];
  private dailyDate: string | null = null;
  /** The run can count as a Daily try: its date is today and tries were left when it began. */
  private dailyScored = false;
  private dailyTry: number | null = null;
  private dailyCounted = false;
  private challenge: Challenge | null = null;
  /** A challenge link opened (hashchange) while a run was active: applied on the next home(). */
  private queuedChallenge: Challenge | null = null;
  private runChallenge: Challenge | null = null;
  private bot: Bot | null = null;
  /** Test hook: a core bot plays the runs (they stay scored, unlike ?bot=). */
  private testBot: BotKind | null = null;
  private usedUrlSeed = false;
  private nextRun: SimState | null = null;
  /** The next endless run while its world is still being generated in slices (see stepPrebuild). */
  private nextBuild: RunBuild | null = null;
  private nextBuildRung = -1;
  /** The comfort rung a run was built at (endless runs from the ladder; others are absent). */
  private readonly rungOf = new WeakMap<SimState, number>();
  /** The rung the last runConfig() built (−1: not from the ladder). */
  private cfgRung = -1;
  /** The rung the current run is played at (−1: not an endless ladder run). */
  private runRung = -1;
  private runActive = false;
  /** Guide "Always" was on at some point of this run (latched: the share's compass marker). */
  private runAssisted = false;
  /** The best the HUD flags during this run, read when it began (checkpoints must not move it). */
  private runPb = -1;
  /** The next milestone the HUD ticks during this run (−1 none), read when it began. */
  private runGoal = -1;
  /** This run is the warm-up a first-time player plays before a friend's challenge (its Retry takes the challenge). */
  private warmup: Challenge | null = null;
  /** The in-run stamp still to come: the score that triggers it (−1 none), its look and text. */
  private stampAt = -1;
  private stampKind: StampKind = 'teal';
  private stampText = '';
  /**
   * Sim-altering debug URL params are present (?day, ?t, ?chill, ?profile, ?bot, ?fast, ?guide):
   * such runs are not scored, saved, shared or counted as Daily tries.
   */
  private readonly debugRuns: boolean;

  // Death / results.
  private deathAt = -1;
  private dyingGame = -1;
  private resultsAt = -1;
  private result: RunResult | null = null;
  private outcome: RunOutcome | null = null;
  /** The death recap's line of advice for the Results (null: none fits). */
  private tip: string | null = null;
  /** Today's Daily par job (Snowbot) and the date it is for. */
  private parJob: ParJob | null = null;
  private parDate = '';
  /** The postcard of `postcardFor` (built in idle stages once its Melt Map settles) and its file. */
  private postcardFor: RunResult | null = null;
  private postcardJob: PostcardJob | null = null;
  private postcardFile: File | null = null;
  private postcardUrl: string | null = null;
  private logoImages: HTMLImageElement[] | null = null;

  /** Test hook: the last Results' recap tip. */
  get resultsTip(): string | null {
    return this.tip;
  }
  private resultsShown = false;

  // Frame state.
  private paused = false;
  private last = -1;
  private time = 0;
  private swayPhase = 0;
  private swayOut = 0;
  private booted = false;
  private raf = 0;
  private cssW = 0;
  private sizeDirty = true;
  /** Cached reduced-motion decision (−1 = recompute). */
  private rmCache = -1;
  /** The effective reduced motion the held Title run was built with. */
  private runRm = false;
  private cssH = 0;
  private dpr = 1;
  /** Canvas DPR cap for this device (perf.ts deviceClass). */
  private dprCap = 2;
  private readonly unsub: (() => void)[] = [];

  // Render cadence (cadence.ts): real and game time not yet handed to a drawn frame.
  private drawDt = 0;
  private drawGdt = 0;
  /** rAF time of the last drawn frame, and whether it was a screen the governor samples. */
  private lastDrawAt = -1;
  private lastDrawSampled = false;
  /** Canvas-affecting settings the last drawn frame used (a change redraws a menu once). */
  private drawnHighContrast = false;
  private drawnEquipped: unknown = null;
  /** Title frames since the Title last appeared. */
  private titleFrames = 0;

  // App-wide history sentinel (V1_PLAN §8.2): armed exactly while a Back press has something to do.
  private sentinel = false;
  /** URL when the sentinel was pushed (the entry a Back press lands on). */
  private sentinelHref = '';
  /** One of our own history.back() calls is in flight: its popstate is ours to ignore. */
  private disarming = false;
  private disarmUntil = 0;

  // Midnight rollover.
  private today = localDate();
  private todayCheckAt = Number.NEGATIVE_INFINITY;

  // Crash containment.
  private failures = 0;
  private crashed = false;
  private frameDrew = false;

  constructor(deps: SessionDeps) {
    this.d = deps;
    this.params = deps.params;
    this.debugRuns = isDebugRun(deps.params);
    this.gov.enabled = deps.params.perf;
    // ?perf=0 is full quality for captures and A/B timing: no governor and no device-class cap.
    if (deps.params.perf) {
      const nav = navigator as Navigator & { deviceMemory?: number };
      const cls = deviceClass({ memory: nav.deviceMemory, cores: nav.hardwareConcurrency, ios: isIOS() });
      this.dprCap = dprCap(cls);
      if (cls === 'low') this.gov.startAt(1);
    }
    this.clock.fast = deps.params.fast;
    this.renderer = new Renderer(deps.canvas);
    this.fx = new Fx(this.renderer.scene, this.clock);
    const store = deps.store;
    const save = store.get();
    this.challenge = playableChallenge(challengeFromHash(location.hash));
    // UI callbacks re-check the history sentinel as soon as they return (screens just changed).
    const sync =
      <A extends unknown[], R>(fn: (...a: A) => R) =>
      (...a: A): R => {
        const r = fn(...a);
        this.syncSentinel();
        return r;
      };
    const callbacks: UiCallbacksV11 = {
        startRun: sync((k: RunKind, date?: string) => this.startRun(k, date)),
        retry: sync(() => this.retry()),
        home: sync(() => this.home()),
        pause: sync(() => this.pause()),
        resume: sync(() => this.resume()),
        restart: sync(() => this.restart()),
        skipDying: sync(() => this.showResults()),
        share: () => this.share(),
        settingsChanged: (st) => this.settingsChanged(st),
        buy: (id) => {
          const r = buyCosmetic(store.get(), id);
          if (!r.ok) {
            deps.audio.play('uiError');
            return false;
          }
          store.set(r.save);
          // Written at once: another tab finishing a run must not clobber the purchase.
          store.flush();
          this.ui.setSave(r.save);
          deps.audio.play('uiBuy');
          return true;
        },
        equip: (id) => {
          const r = equipCosmetic(store.get(), id);
          if (!r.ok) return;
          store.set(r.save);
          store.flush();
          this.ui.setSave(r.save);
        },
        exportBackup: () => exportBackup(store.get()),
        importBackup: sync((code: string): ImportOutcome => {
          if (!store.canPersist) return { ok: false, message: NEWER_SAVE_MESSAGE };
          const r = importBackup(code);
          if (!r.ok) return { ok: false, message: backupErrorMessage(r.error) };
          store.set(r.save);
          store.flush();
          this.ui.setSave(r.save);
          this.applySettings(r.save.settings);
          this.refreshTitleRun();
          return { ok: true };
        }),
        resetProgress: sync((): ImportOutcome => {
          if (!store.canPersist) return { ok: false, message: NEWER_SAVE_MESSAGE };
          const next = resetProgress(store.get());
          store.set(next);
          store.flush();
          this.ui.setSave(next);
          this.applySettings(next.settings);
          this.refreshTitleRun();
          return { ok: true };
        }),
        dismissChallenge: () => {
          this.challenge = null;
          this.queuedChallenge = null;
          try {
            history.replaceState(history.state, '', location.pathname + location.search);
          } catch {
            // ignore
          }
          this.refreshTitleRun();
        },
        dragHandoff: (e) => {
          if (this.ui.current() === 'title') this.input.begin(e);
        },
        uiSound: (name) => this.uiSound(name),
        renderWardrobePreview: (canvas, equipped, subject) =>
          subject === 'sun' ? renderSunPreview(canvas, shadesLook(equipped)) : renderWardrobePreview(canvas, equipped),
        swapMission: (slotId) => {
          const next = swapMission(store.get(), slotId);
          store.set(next);
          store.flush();
          this.ui.setSave(next);
        },
        sharePostcard: () => this.sharePostcard(),
    };
    this.ui = createUi(deps.uiRoot, {
      callbacks,
      save,
      today: this.today,
      version: deps.version,
    });
    if (this.challenge) this.ui.setChallenge(this.challengeBanner(this.challenge));
    this.input = new Input({
      canvas: deps.canvas,
      accepting: () => this.accepting(),
      onPress: () => this.onPress(),
      viewportWidth: () => this.renderer.scene.view.vw,
      safeBottom: () => this.renderer.scene.view.safe.bottom,
    });
    this.applySettings(save.settings);
    this.runRm = this.reducedMotion();
    this.s = this.createTitleRun();
    this.lifetimeRuns = save.stats.runs;
    this.resetSnaps();
    this.previewRun();

    this.hintIn = {
      profile: 3,
      f: 0,
      sunUp: false,
      now: this.s.guide.now,
      next: this.s.guide.next,
      theta: 0,
      dragging: false,
      invert: false,
      lessonOn: false,
    };
    this.renderIn = {
      s: this.s,
      snap: this.snap,
      screen: 'boot',
      sway: 0,
      dragging: false,
      guideAlpha: 0,
      hint: { target: Number.NaN, width: 0, turn: 0, phase: -1, alpha: 0 },
      pbMinutes: -1,
      challengeMinutes: -1,
      goalMinutes: -1,
      challengeName: '',
      dying: -1,
      mapT: -1,
      sheetTop: null,
      time: 0,
      dt: 0,
      gdt: 0,
      highContrast: save.settings.highContrast,
      reducedMotion: false,
      equipped: save.equipped,
      softShadows: true,
      govLevel: 0,
      paused: false,
      debug: null,
    };

    deps.audio.onHeartbeat = () => deps.haptics.play('heartbeat');
    const syncMuted = (): void => this.ui.setAudioMuted(!deps.audio.running || deps.audio.muted);
    deps.audio.onStatusChange(syncMuted);
    syncMuted();

    this.unsub.push(
      onPageHidden(() => {
        store.flush();
        this.pauseIfPlaying();
      }),
      // V1_PLAN §8.5: losing focus (alt-tab, an OS dialog over the browser) pauses too; nothing
      // ever resumes by itself.
      onWindowBlur(() => this.pauseIfPlaying()),
      onPageVisible(() => this.checkToday()),
      // Another tab or instance saved: adopt its save instead of overwriting it later.
      store.onExternalChange((next) => this.adoptSave(next)),
      store.onDegraded(() => this.ui.notifyStorageDegraded()),
    );
    const onPop = (): void => this.onPopState();
    window.addEventListener('popstate', onPop);
    this.unsub.push(() => window.removeEventListener('popstate', onPop));
    const onHash = (): void => this.onHashChange();
    window.addEventListener('hashchange', onHash);
    this.unsub.push(() => window.removeEventListener('hashchange', onHash));
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
        this.reducedMotionMaybeChanged();
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
      this.raf = requestAnimationFrame(this.tick);
      this.last = now;
      this.runFrame(now);
      if (!this.booted) {
        this.booted = true;
        if (this.params.bot) {
          this.bot = createBot(this.params.bot);
          this.ui.show('play');
          this.beginRun(this.s);
        } else {
          this.ui.show('title');
        }
        this.syncSentinel();
        onFirstFrame();
        this.scheduleAudioPrewarm();
      }
    };
    this.raf = requestAnimationFrame(first);
  }

  /** The next frame is scheduled first, so one exception never stops the game. */
  private loop(now: number): void {
    this.raf = requestAnimationFrame(this.tick);
    this.runFrame(now);
  }

  /** The rAF callback, made once (no closure per frame). */
  private readonly tick = (now: number): void => this.loop(now);

  /**
   * One frame, contained: an exception is logged and counted, and after CRASH_FRAMES failed frames
   * in a row (about 0.5 s) the save is flushed and a self-contained crash overlay offers a reload.
   * A frame that completes and draws resets the count (frames that skip their draw prove nothing).
   */
  private runFrame(now: number): void {
    this.frameDrew = false;
    try {
      this.frame(now);
      if (this.frameDrew) this.failures = 0;
    } catch (e) {
      console.error(e);
      this.failures++;
      if (this.failures >= CRASH_FRAMES && !this.crashed) {
        this.crashed = true;
        try {
          this.d.store.flush();
        } catch {
          // The save stays in memory; nothing more to do.
        }
        showCrashOverlay();
      }
    }
  }

  /** Builds the audio noise tables once the Title is up, off the first tap's critical path. */
  private scheduleAudioPrewarm(): void {
    const audio = this.d.audio;
    const run = (): void => audio.prewarm();
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(run, { timeout: 2000 });
    else window.setTimeout(run, 200);
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
    const dpr = canvasDpr(window.devicePixelRatio || 1, this.dprCap, this.gov.dprScale);
    if (!force && w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    // A new size means new buffers and first-frame costs: the governor warms up again.
    if (w !== this.cssW || h !== this.cssH) this.gov.reset();
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.renderer.resize(w, h, dpr, readSafeArea());
    this.cadence.invalidate();
    // Where Nubs and his halo dial sit, for DOM overlays that must keep them visible (the Title's
    // ghost hint goes above them, the Pause card is centered in the space above the dial), and the
    // world rect (K9): every screen, control, sheet and toast lays out inside it.
    const v = this.renderer.scene.view;
    const nubsY = v.vy + v.nubsFrac * v.vh;
    const haloR = 40 * v.k;
    const root = this.d.uiRoot.style;
    root.setProperty('--nubs-y', `${Math.round(nubsY)}px`);
    root.setProperty('--halo-r', `${Math.round(haloR)}px`);
    root.setProperty('--nubs-clear', `${Math.round(h - nubsY + haloR)}px`);
    root.setProperty('--world-left', `${Math.round(v.vx)}px`);
    root.setProperty('--world-top', `${Math.round(v.vy)}px`);
    root.setProperty('--world-width', `${Math.round(v.vw)}px`);
    root.setProperty('--world-height', `${Math.round(v.vh)}px`);
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
    if (now - this.todayCheckAt >= TODAY_CHECK_MS) {
      this.todayCheckAt = now;
      this.checkToday();
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
        // V11-SHIM: CC-5 — the v1.0 core has no lesson: emulate its lessonDone (delete with the shim).
        if (lessonShimTick(s)) this.onTickEvent({ e: 'lessonDone' });
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
    this.checkDailyTry();
    if (stepping) this.checkStamp();

    // Idle-time world generation (keeps step() from ever validating a chunk inside a tick).
    const tGen = performance.now();
    if (screen !== 'boot') generateSome(s.world, s.nubs.y + TUNING.world.idleAhead, IDLE_BUDGET);
    // The next run's world is built only while no run is being played.
    if (screen !== 'play' && screen !== 'pause') this.stepPrebuild(Math.min(PREBUILD_MAX_MS, Math.max(PREBUILD_MS, realMs * PREBUILD_SHARE)));
    if (screen !== 'play' && screen !== 'pause' && screen !== 'dying' && screen !== 'boot') this.stepPar();
    this.stats.genMs = performance.now() - tGen;

    const gdt = stepping || screen === 'dying' || screen === 'results' ? this.clock.gameDt : screen === 'pause' ? 0 : real;
    if (this.deathAt >= 0) this.dyingGame += this.clock.gameDt;
    this.fx.update(stepping ? this.clock.gameDt : 0, s, s.phase === 'day' || s.phase === 'night');
    this.updateHints(real, screen);
    this.updateDeathFlow();

    // Render input (cheap; filled every frame so hints and sway stay continuous).
    const r = this.renderIn;
    const screenNow = this.ui.current();
    r.s = this.s;
    r.screen = this.renderScreen(screenNow);
    this.swayPhase += real;
    if (screenNow === 'title' || (screenNow === 'play' && this.s.phase === 'hold')) {
      // The sun turns with the ghost hand's swing (a rightward drag turns it clockwise), so the
      // Title shows what a drag does; without the hand's clock, a plain 0.3 Hz sway.
      const rm = this.reducedMotion();
      const p = rm ? -1 : this.ui.ghostProgress();
      if (rm) r.sway = 0;
      else if (p >= 0) r.sway = (this.input.invert ? SWAY_DEG : -SWAY_DEG) * ghostSwingX(p);
      else r.sway = SWAY_DEG * Math.sin(this.swayPhase * Math.PI * 2 * 0.3);
      this.swayOut = r.sway;
    } else {
      this.swayOut *= Math.exp(-real / 0.12);
      if (Math.abs(this.swayOut) < 0.01) this.swayOut = 0;
      r.sway = this.swayOut;
    }
    const inputDown = this.input.pointerDown || this.input.keyDown;
    r.dragging = inputDown || this.s.sun.mode === 'dragging';
    r.guideAlpha = this.currentGuideAlpha();
    this.fillHintView(real, screenNow);
    const save = this.d.store.get();
    r.pbMinutes = this.runActive ? this.runPb : this.livePb();
    r.goalMinutes = this.runActive ? this.runGoal : this.liveGoal();
    r.challengeMinutes = this.runChallenge ? this.runChallenge.m : -1;
    r.challengeName = this.runChallenge ? challengeRules(this.runChallenge).n : '';
    r.dying = this.deathAt >= 0 ? Math.max(0, this.dyingGame) : -1;
    r.mapT = this.resultsAt >= 0 && screenNow === 'results' ? this.time - this.resultsAt : -1;
    r.sheetTop = screenNow === 'results' ? this.ui.resultsSheetTop() : null;
    r.time = this.time;
    r.highContrast = save.settings.highContrast;
    r.reducedMotion = this.reducedMotion();
    r.equipped = save.equipped;
    r.softShadows = this.gov.softShadows;
    r.govLevel = this.gov.level;
    r.paused = this.paused || screenNow === 'pause';
    this.fx.reducedMotion = r.reducedMotion;

    // Render cadence (cadence.ts): time not handed to a drawn frame carries over to the next one.
    this.drawDt += real;
    this.drawGdt += gdt;
    if (r.highContrast !== this.drawnHighContrast || r.equipped !== this.drawnEquipped) this.cadence.invalidate();
    const ci = this.cadenceIn;
    ci.now = now;
    ci.screen = r.screen;
    ci.inputActive = inputDown;
    ci.timeScale = this.clock.timeScale;
    ci.reducedMotion = r.reducedMotion;
    ci.settled = this.renderer.settled;
    const draw = this.cadence.shouldDraw(ci);
    if (draw) {
      r.dt = Math.min(MAX_DRAW_DT, this.drawDt);
      r.gdt = Math.min(MAX_DRAW_DT, this.drawGdt);
      this.drawDt = 0;
      this.drawGdt = 0;
      this.drawnHighContrast = r.highContrast;
      this.drawnEquipped = r.equipped;
      const tRender = performance.now();
      this.renderer.draw(r);
      this.stats.renderMs = performance.now() - tRender;
      this.cadence.drawn(now);
      this.frameDrew = true;
      if (screenNow === 'results' && this.renderer.settled) this.startPostcard();
    }
    if (r.screen === 'title') {
      // Past the boot frames, keep the play HUD's row built for the held run (change-detected, so
      // it is built once), so the first play frame after a tap doesn't build it.
      if (++this.titleFrames > TITLE_HUD_PREBUILD_FRAMES) this.renderer.prebuildHud(r);
    } else {
      this.titleFrames = 0;
    }
    this.d.audio.update(view, real);
    this.syncSentinel();
    this.stats.frameMs = performance.now() - t0;
    if (draw) {
      // The governor weighs the interval between drawn frames against this frame's own work (see
      // perf.ts), on the screens that draw at full rate; capped and menu screens never trip it.
      const sampled = r.screen === 'play' || r.screen === 'dying' || r.screen === 'title';
      if (sampled && this.lastDrawSampled && this.lastDrawAt >= 0) {
        const interval = now - this.lastDrawAt;
        this.gov.sample(interval, this.stats.frameMs, Math.min(0.25, interval / 1000));
      }
      this.lastDrawAt = now;
      this.lastDrawSampled = sampled;
    }
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

  /** The effective reduced motion may have changed (setting, OS preference, another tab's save). */
  private reducedMotionMaybeChanged(): void {
    const rm = this.reducedMotion();
    if (rm === this.runRm) return;
    // Runs bake it into their config (sun follow and inertia caps): rebuild the held run.
    this.runRm = rm;
    this.refreshTitleRun();
  }

  private debugStart(cfg: RunConfig): RunConfig {
    const p = this.params;
    if (p.day !== null) cfg.startDay = p.day;
    const t = startTFor(p.t, p.day ?? 1);
    if (t !== null) cfg.startT = t;
    if (p.chill !== null) cfg.startChill = p.chill;
    return cfg;
  }

  /** A fresh run for `kind` (endless seeds are random unless ?seed= is given; Dailies on `date`). */
  private makeRun(kind: RunKind, date?: string): SimState {
    const run = createRun(this.runConfig(kind, date));
    this.rungOf.set(run, this.cfgRung);
    return run;
  }

  /**
   * The comfort rung of the next endless run (A2): the tutorial rung on the very first run, then
   * the save's rung (at least 1) while adaptive comfort is on, else the standard rules.
   */
  private comfortRung(): number {
    const save = this.d.store.get();
    if (save.stats.runs === 0) return 0;
    return comfortOn(save.settings) ? Math.max(1, comfortStat(save)) : COMFORT_MAX;
  }

  /** The config of a fresh run of `kind`, with the run bookkeeping (kind, daily, challenge) set. */
  private runConfig(kind: RunKind, date?: string): RunConfig {
    const save = this.d.store.get();
    const p = this.params;
    const rm = this.reducedMotion();
    let cfg: RunConfigV11;
    this.runChallenge = null;
    this.dailyDate = null;
    this.dailyScored = false;
    this.cfgRung = -1;
    if (kind === 'daily' || (kind === 'endless' && p.daily && !this.usedUrlSeed)) {
      const d = kind === 'daily' ? (date ?? localDate()) : (p.date ?? localDate());
      cfg = this.dailyConfig(d, rm);
      if (kind === 'endless') this.usedUrlSeed = true;
      this.kind = 'daily';
    } else if (kind === 'challenge' && this.challenge) {
      const c = this.challenge;
      this.runChallenge = c;
      if (c.k === 'd') {
        cfg = this.dailyConfig(c.d, rm);
      } else {
        // The sender's exact rules (CC-8, A1); never a lesson, hint or cue.
        const r = challengeRules(c);
        cfg = { seed: c.seed >>> 0, mode: 'challenge', profile: r.p, tutorial: r.p === 0, reducedMotion: rm, drain: r.dr, noonCloud: r.nc, plan: r.pl === 1 };
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
      if (p.profile !== null || p.bot) {
        // A forced profile or a ?bot= run keeps that profile's own rules (a forced first-run profile
        // still teaches the lesson until it is passed).
        const profile = p.profile ?? 3;
        cfg = { seed, mode: 'endless', profile, tutorial: profile === 0, reducedMotion: rm };
        if (!p.bot && profile <= 1 && !save.flags.tutorialDone) cfg.lesson = true;
      } else {
        // The comfort ladder (A2); ?rung= forces a rung, a forced forecast plays the standard rules.
        const rung = p.rung ?? (p.forecast !== null ? COMFORT_MAX : this.comfortRung());
        const r = rungConfig(rung, { tutorialDone: save.flags.tutorialDone });
        cfg = { seed, mode: 'endless', profile: r.profile, tutorial: r.tutorial, reducedMotion: rm, drain: r.drain, noonCloud: r.noonCloud };
        if (r.lesson) cfg.lesson = true;
        this.cfgRung = rung;
      }
      this.kind = 'endless';
    }
    this.dailyScored = this.dailyDate !== null && this.dailyEligible(this.dailyDate);
    if (p.profile !== null && cfg.mode !== 'endless') {
      // Debug override applies to every mode.
      cfg.profile = p.profile;
      cfg.tutorial = p.profile === 0;
    }
    if (p.forecast !== null) cfg.forecast = p.forecast;
    if (p.plan !== null) cfg.plan = p.plan;
    return this.debugStart(cfg);
  }

  /** A Daily on `date`: the standard rules without the noon cloud; the Day Plan from PLAN_START_DATE (A1). */
  private dailyConfig(date: string, rm: boolean): RunConfigV11 {
    this.dailyDate = date;
    return { seed: dailySeed(date), mode: 'daily', profile: 3, tutorial: false, reducedMotion: rm, dailyDate: date, noonCloud: 0, plan: date >= PLAN_START_DATE };
  }

  /** A Daily of `date` would count as a try now: it is today's and tries are left. */
  private dailyEligible(date: string): boolean {
    return !this.debugRuns && date === localDate() && dailyStatus(this.d.store.get(), date).tries < DAILY_TRIES;
  }

  /** A challenge is open on a save that has never finished a run: the tutorial run comes first. */
  private inWarmup(): boolean {
    return this.challenge !== null && this.d.store.get().stats.runs === 0;
  }

  /**
   * The Title's live scene, held at dawn: the challenge run while a challenge link is open (so a
   * press on the canvas or a tray drag starts it) unless the tutorial warm-up comes first,
   * otherwise the next endless run.
   */
  private createTitleRun(): SimState {
    this.finishPrebuild();
    if (this.challenge && !this.inWarmup()) return this.makeRun('challenge');
    if (this.nextRun && this.nextRun.cfg.mode === 'endless' && this.nextRun.phase === 'hold') {
      const r = this.nextRun;
      this.nextRun = null;
      this.kind = 'endless';
      this.runChallenge = null;
      this.dailyDate = null;
      this.dailyScored = false;
      return r;
    }
    return this.makeRun('endless');
  }

  /**
   * Something the held runs depend on changed (save reset or restored, another tab's save, reduced
   * motion, the challenge): drop the prebuilt next run and, between runs, rebuild the Title's.
   */
  private refreshTitleRun(): void {
    this.nextRun = null;
    this.nextBuild = null;
    if (this.runActive) return;
    if (this.challenge) this.ui.setChallenge(this.challengeBanner(this.challenge));
    this.lifetimeRuns = this.d.store.get().stats.runs;
    this.runRm = this.reducedMotion();
    this.s = this.createTitleRun();
    this.renderIn.s = this.s;
    this.resetSnaps();
    this.resetRender();
    this.cadence.invalidate();
    this.previewRun();
  }

  /** Tells the Title which Day 1 the held run plays (null for plan-off worlds). */
  private previewRun(): void {
    const w = this.s.world;
    uiV11(this.ui).setRunPreview?.(planOnOf(w) ? worldPlan(w, 1) : null);
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
    // Shake and zoom pulses belong to the run that made them.
    Object.assign(sc.cam, createCameraFx());
    sc.cam.reducedMotion = this.reducedMotion();
    sc.sun.guilty = 0;
    resetDeathBeat(sc.death);
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
    this.dropPostcard();
    this.resetSnaps();
    this.resetRender();
    this.clock.reset();
    if (!keepInput) this.input.clearPending();
    const botKind = this.params.bot ?? this.testBot;
    this.bot = botKind ? createBot(botKind) : null;
    this.d.audio.resetRun();
    this.melody = [];
    this.hints.reset();
    this.hintAlpha = 0;
    this.cues = 0;
    this.runRung = this.rungOf.get(run) ?? -1;
    const store = this.d.store;
    const save = store.get();
    this.dailyTry = null;
    this.dailyCounted = false;
    // Eligibility is decided when the run begins (the Title may have held it since yesterday).
    this.dailyScored = this.dailyDate !== null && this.dailyEligible(this.dailyDate);
    this.deathAt = -1;
    this.dyingGame = -1;
    this.resultsAt = -1;
    this.result = null;
    this.outcome = null;
    this.resultsShown = false;
    this.paused = false;
    this.runActive = true;
    this.runAssisted = (this.params.guide ?? save.settings.guide) === 'always';
    this.runPb = this.livePb();
    this.runGoal = this.liveGoal();
    this.lifetimeRuns = save.stats.runs;
    this.warmup = run.cfg.mode === 'endless' && this.inWarmup() ? this.challenge : null;
    this.armStamp(run);
    if (!this.debugRuns) {
      const begun = beginRun(save);
      if (begun.save !== save) {
        store.set(begun.save);
        this.ui.setSave(begun.save);
      }
    }
    this.setGhost('off');
  }

  private ghost: 'off' | 'both' | 'left' | 'right' = 'off';

  private setGhost(mode: 'off' | 'both' | 'left' | 'right'): void {
    if (mode === this.ghost) return;
    this.ghost = mode;
    this.ui.setGhostThumb(mode);
  }

  // -------------------------------------------------------------------------------------------
  // History sentinel (V1_PLAN §8.2, android-back-exits-from-menus)
  // -------------------------------------------------------------------------------------------

  /** Back has something to do in the game: any screen but the Title (and boot), or an open modal. */
  private wantsSentinel(): boolean {
    const sc = this.ui.current();
    return (sc !== 'boot' && sc !== 'title') || this.ui.isModalOpen();
  }

  /**
   * Keeps exactly one history entry of ours on top while wantsSentinel(): pushed when it turns
   * true, taken back (history.back(), its popstate ignored) when in-app navigation turns it false.
   * Checked every frame and right after UI callbacks.
   */
  private syncSentinel(): void {
    if (this.disarming) {
      // Wait for our own pop before pushing again (the history traversal is asynchronous).
      if (performance.now() < this.disarmUntil) return;
      this.disarming = false;
    }
    const want = this.wantsSentinel();
    if (want === this.sentinel) return;
    if (want) {
      try {
        history.pushState({ shady: 1 }, '');
        this.sentinel = true;
        this.sentinelHref = location.href;
      } catch {
        // History may be unavailable (sandboxed iframes): play on without the sentinel.
      }
      return;
    }
    this.sentinel = false;
    try {
      this.disarming = true;
      this.disarmUntil = performance.now() + DISARM_WAIT_MS;
      history.back();
    } catch {
      this.disarming = false;
    }
  }

  /**
   * Back (browser, Android, a swipe): our sentinel was consumed. A modal closes first; play pauses;
   * pause stays paused; any other screen takes its own back action (menus → their parent, Results →
   * Home, dying → skip, Settings → where it was opened from). The next check re-arms as needed; on
   * the Title with nothing open there is no sentinel, so Back leaves the game.
   * (A native shell routes its back button here too: see src/game/README.md.)
   */
  private onPopState(): void {
    if (this.disarming) {
      this.disarming = false;
      return;
    }
    // Not our entry (a fragment navigation, or nothing armed): leave it to the browser.
    if (!this.sentinel || location.href !== this.sentinelHref) return;
    this.sentinel = false;
    this.handleBack();
    this.syncSentinel();
  }

  /** The app's Back action (also what a native back button should call). */
  handleBack(): void {
    const ui = this.ui;
    if (ui.isModalOpen()) {
      ui.back();
      return;
    }
    const sc = ui.current();
    if (sc === 'play') {
      ui.show('pause');
      this.pause();
    } else if (sc !== 'pause' && sc !== 'boot' && sc !== 'title') {
      ui.back();
    }
  }

  private accepting(): boolean {
    if (this.paused || this.ui.isRotateBlocking()) return false;
    const sc = this.ui.current();
    return sc === 'title' || sc === 'play';
  }

  private onPress(): void {
    // Audio unlocks from the engine's own gesture listeners (on a first pointerdown it builds the
    // context in a task right after the event, so the press itself stays light).
    if (this.ui.current() === 'title') {
      // Any press on the canvas starts the Title's run with catch semantics (θ stays θ0); with a
      // challenge link open, that is the challenge run.
      this.ui.show('play');
      this.beginRun(this.s, true);
      this.syncSentinel();
    }
  }

  private startRun(want: RunKind, date?: string): void {
    this.d.audio.ensure();
    const held = !this.runActive && this.s.phase === 'hold';
    // A first-time player plays the tutorial run before a friend's challenge (CC-8 warm-up).
    const kind = want === 'challenge' && this.inWarmup() ? 'endless' : want;
    if (kind === 'endless') {
      if (!held || this.s.cfg.mode !== 'endless' || this.kind !== 'endless') this.s = this.makeRun('endless');
      this.beginRun(this.s);
      this.input.tap();
      return;
    }
    // Daily and challenge runs wait for the first press (clock held at dawn). The Title already
    // holds the challenge run while a challenge link is open.
    const run =
      kind === 'challenge' && held && this.kind === 'challenge' && this.challenge !== null && this.runChallenge === this.challenge
        ? this.s
        : this.makeRun(kind, date);
    this.beginRun(run);
    this.setGhost('both');
  }

  private retry(): void {
    this.d.audio.ensure();
    this.finishPrebuild();
    // After the warm-up, Retry ("Take the challenge") plays the friend's run.
    if (this.warmup && this.challenge) this.kind = 'challenge';
    let run: SimState;
    if (this.kind === 'endless' && this.nextRun && this.nextRun.cfg.mode === 'endless') {
      run = this.nextRun;
      this.nextRun = null;
      this.kind = 'endless';
      this.runChallenge = null;
      this.dailyDate = null;
    } else {
      // A Daily replays its own date (a past date stays a practice run of that date).
      const date = this.kind === 'daily' && this.dailyDate !== null ? this.dailyDate : undefined;
      run = this.makeRun(this.kind, date);
    }
    this.beginRun(run);
    this.input.tap();
  }

  private restart(): void {
    this.retry();
  }

  private home(): void {
    this.d.audio.stopMelody();
    this.runActive = false;
    this.paused = false;
    this.input.releaseAll();
    if (this.queuedChallenge) {
      this.challenge = this.queuedChallenge;
      this.queuedChallenge = null;
    }
    // The banner drops its warm-up note once the first run is done.
    if (this.challenge) this.ui.setChallenge(this.challengeBanner(this.challenge));
    this.lifetimeRuns = this.d.store.get().stats.runs;
    this.s = this.createTitleRun();
    this.renderIn.s = this.s;
    this.resetSnaps();
    this.resetRender();
    this.previewRun();
    this.deathAt = -1;
    this.dyingGame = -1;
    this.resultsAt = -1;
    this.setGhost('both');
  }

  private pause(): void {
    this.paused = true;
    this.input.releaseAll();
    this.setGhost('off');
    this.cue(null);
  }

  private pauseIfPlaying(): void {
    if (this.ui.current() !== 'play') return;
    this.ui.show('pause');
    this.pause();
    this.syncSentinel();
  }

  private resume(): void {
    this.d.audio.ensure();
    this.paused = false;
    this.input.releaseAll();
    this.clock.acc = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Challenges, the date, other tabs
  // -------------------------------------------------------------------------------------------

  private challengeBanner(c: Challenge): ChallengeBannerV11 {
    const b: ChallengeBannerV11 = { minutes: c.m };
    const name = challengeRules(c).n;
    if (name) b.name = name;
    if (this.inWarmup()) b.warmup = true;
    if (c.k === 'd') {
      const n = dailyNumber(c.d);
      b.note = c.d === localDate() ? `Daily #${n}` : `Daily #${n} · practice run`;
    }
    return b;
  }

  /** A challenge link opened in this document (same-document navigation to #c=…). */
  private onHashChange(): void {
    const c = playableChallenge(challengeFromHash(location.hash));
    if (!c || sameChallenge(c, this.challenge)) return;
    if (this.runActive) {
      // Never swap a run mid-play: the banner appears when the player is back on the Title.
      this.queuedChallenge = c;
      return;
    }
    this.challenge = c;
    this.queuedChallenge = null;
    this.ui.setChallenge(this.challengeBanner(c));
    this.refreshTitleRun();
  }

  /** Midnight: tell the UI when the local date changes (Daily number, tries, history). */
  private checkToday(): void {
    const d = localDate();
    if (d === this.today) return;
    this.today = d;
    this.ui.setToday(d);
  }

  /** Another tab or instance wrote the save and the store adopted it. */
  private adoptSave(next: SaveV1): void {
    this.ui.setSave(next);
    this.applySettings(next.settings);
    if (!this.runActive) {
      this.lifetimeRuns = next.stats.runs;
      this.refreshTitleRun();
    }
    this.reducedMotionMaybeChanged();
  }

  // -------------------------------------------------------------------------------------------
  // Events, daily bookkeeping, death and results
  // -------------------------------------------------------------------------------------------

  private onTickEvent(ev: SimEventV11): void {
    switch (ev.e) {
      case 'flake':
        if (this.melody.length < MELODY_MAX) this.melody.push(ev.degree);
        break;
      case 'go':
        if (this.s.cfg.profile <= 1) this.cue('keep-shade');
        break;
      case 'lessonDone':
        if (!this.debugRuns) {
          this.d.store.update((sv) => {
            sv.flags.tutorialDone = true;
          });
          this.d.store.flush();
        }
        this.cue('shade-found');
        break;
      case 'lowChill':
        // The first scare of a new player; inside the lesson it keeps the drag instruction (A16).
        if (this.lifetimeRuns <= 2) this.cue('melting', this.hints.lesson ? this.dragDir() : undefined);
        break;
      case 'hourEnd':
        if (this.dailyTry !== null && this.dailyDate) {
          const store = this.d.store;
          const strip = { hourGlyphs: this.s.hourGlyphs, assisted: this.runAssisted };
          const next = dailyProgress(store.get(), this.dailyDate, this.s.minutes, this.s.stats.snow, strip);
          if (next !== store.get()) {
            store.set(next);
            store.flush();
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

  /** Daily: a try is counted (and saved at once) when the run passes 6:30 AM. */
  private checkDailyTry(): void {
    const s = this.s;
    if (this.dailyScored && !this.debugRuns && this.dailyDate && !this.dailyCounted && s.phase !== 'hold' && s.minutes >= DAILY_COUNT_MINUTES) {
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
    // The death plays at its own pace (hit-stop, slow-mo), never inside the lesson's slow time.
    this.hints.stop();
    this.clock.assist = 1;
    this.dyingGame = 0;
    this.checkDailyTry();
    const save = this.d.store.get();
    const result = buildRunResult(this.s);
    this.tip = deathTip(deathRecap(this.s), save.settings.invert);
    result.melody = this.melody.slice();
    // Latched: Guide "Always" at any point of the run marks it assisted.
    result.assisted = this.runAssisted;
    this.result = result;
    if (this.debugRuns) {
      // Debug runs leave the save alone: no Snow, bests, missions, achievements or Daily tries.
      this.outcome = debugRunOutcome(save, result);
    } else {
      const options: ApplyRunOptionsV11 = { today: localDate(), dailyTry: this.dailyTry, playSeconds: this.s.tick / 60 };
      if (this.runChallenge) options.challengeTarget = this.runChallenge.m;
      if (this.runRung >= 0) options.rung = this.runRung;
      const { save: next, outcome } = applyRunResult(save, result, options);
      this.d.store.set(next);
      this.d.store.flush();
      this.ui.setSave(next);
      this.outcome = outcome;
      if (!next.flags.persistRequested) {
        void requestPersistence();
        this.d.store.update((sv) => {
          sv.flags.persistRequested = true;
        });
      }
    }
    this.setGhost('off');
    this.cue(null);
    this.input.releaseAll();
    if (this.ui.current() === 'play') this.ui.show('dying');
    // Start building the next endless run: its world is generated a slice per frame while the
    // death and the Results play (stepPrebuild), so Retry is instant and no frame hitches.
    this.startPrebuild();
  }

  private updateDeathFlow(): void {
    if (this.deathAt < 0 || this.resultsShown) return;
    if (this.time - this.deathAt >= DYING_S) this.showResults();
  }

  private showResults(): void {
    if (this.resultsShown || !this.result || !this.outcome) return;
    this.resultsShown = true;
    const daily = this.result.mode === 'daily';
    const view: ResultsViewV11 = {
      result: this.result,
      outcome: this.outcome,
      dailyTry: daily ? this.dailyTry : undefined,
      // K5: every Daily (k:'d' challenges too) says which date it was and whether it could count.
      ...(daily && this.dailyDate !== null ? { dailyDate: this.dailyDate, dailyScored: this.dailyScored } : {}),
      ...(this.runChallenge ? { challengeTarget: this.runChallenge.m, challengeName: challengeRules(this.runChallenge).n } : {}),
      ...(this.warmup ? { warmupFor: { minutes: this.warmup.m, name: challengeRules(this.warmup).n } } : {}),
      ...(this.debugRuns ? { debug: true } : {}),
      ...(this.tip !== null ? { tip: this.tip } : {}),
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
    if (!this.debugRuns && shouldShowInstallSheet(save, { ios: isIOS(), standalone: isStandalone(), inApp: isInAppBrowser() })) {
      this.ui.showInstallSheet();
      this.d.store.update((sv) => {
        sv.flags.installSheetShown = true;
      });
    }
    this.startPrebuild();
    if (this.params.bot) {
      // ?bot= autoplay: on to the next run.
      window.setTimeout(() => {
        if (this.ui.current() === 'results') {
          this.ui.show('play');
          this.retry();
        }
      }, 1500);
    }
  }

  /** runConfig('endless') without disturbing the current run's kind/challenge bookkeeping. */
  private endlessConfigQuiet(): RunConfig {
    const kind = this.kind;
    const ch = this.runChallenge;
    const dd = this.dailyDate;
    const ds = this.dailyScored;
    const cfg = this.runConfig('endless');
    this.kind = kind;
    this.runChallenge = ch;
    this.dailyDate = dd;
    this.dailyScored = ds;
    return cfg;
  }

  /** Starts preparing the next endless run (after an endless run ends), if none is ready. */
  private startPrebuild(): void {
    if (this.kind !== 'endless' || this.nextRun || this.nextBuild) return;
    this.nextBuild = prepareRun(this.endlessConfigQuiet());
    this.nextBuildRung = this.cfgRung;
  }

  /**
   * The Daily par (Snowbot, CC-17): while no run is being played and today's par is missing, the
   * novice bot plays today's Daily world for at most PAR_MS a frame; the result goes into the save.
   * A new local date restarts it.
   */
  private stepPar(): void {
    const save = this.d.store.get();
    const today = this.today;
    if (!this.d.store.canPersist || !isDailyUnlocked(save) || dailyPar(save, today) !== undefined) {
      this.parJob = null;
      return;
    }
    if (!this.parJob || this.parDate !== today) {
      this.parJob = createParJob(dailySeed(today), today >= PLAN_START_DATE);
      this.parDate = today;
    }
    const job = this.parJob;
    const t0 = performance.now();
    let done = false;
    do done = job.step(PAR_TICKS);
    while (!done && performance.now() - t0 < PAR_MS);
    if (!done) return;
    this.parJob = null;
    const next = setDailyPar(this.d.store.get(), today, job.minutes);
    this.d.store.set(next);
    this.d.store.flush();
    this.ui.setSave(next);
  }

  /** Spends up to `ms` of this frame generating the next run's world; creates the run when done. */
  private stepPrebuild(ms: number): void {
    const b = this.nextBuild;
    if (!b) return;
    const t0 = performance.now();
    let done = false;
    do done = prepareSome(b, PREBUILD_SLICE);
    while (!done && performance.now() - t0 < ms);
    if (done) this.finishPrebuild();
  }

  /** Finishes a pending prebuild now (Retry or Home came before its last slice). */
  private finishPrebuild(): void {
    const b = this.nextBuild;
    if (!b) return;
    this.nextBuild = null;
    this.nextRun = createRun(b.cfg, b);
    this.rungOf.set(this.nextRun, this.nextBuildRung);
  }

  /**
   * Starts the postcard of the settled Results (once per run; not for debug runs, which can't be
   * shared): one idle callback per stage, then the PNG is encoded off the main thread.
   */
  private startPostcard(): void {
    const result = this.result;
    const sheetTop = this.ui.resultsSheetTop();
    if (!result || this.debugRuns || this.postcardFor === result || sheetTop === null) return;
    this.postcardFor = result;
    const v = this.renderer.scene.view;
    const dpr = v.dpr;
    const death = this.s.death;
    const { day, minute } = splitMinutes(result.minutes);
    const first = Math.max(1, result.hourGlyphs.length - 1);
    const days = result.hourGlyphs.slice(first - 1);
    const daily = result.mode === 'daily' && result.dailyDate !== undefined ? `Daily #${dailyNumber(result.dailyDate)}` : '';
    this.logoImages ??= [logoLayers().shadow, logoLayers().word].map((svg) => {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      return img;
    });
    const job = createPostcardJob({
      source: this.d.canvas,
      srcX: v.vx * dpr,
      srcY: v.vy * dpr,
      srcW: v.vw * dpr,
      srcH: Math.max(1, (sheetTop - v.vy) * dpr),
      focusX: (v.ox + (death ? death.x : this.s.nubs.x) * v.S) * dpr,
      callouts: Array.from(calloutBoxes.subarray(0, 4 * calloutsDrawn()), (x) => x * dpr),
      day,
      time: formatTimeOfDay(minute),
      deathLine: result.death.line,
      days,
      forecasts: days.map((_, i) => worldPlan(this.s.world, first + i).forecast),
      daily,
      url: buildShare(result, shareBase(), this.dailyTry).url ?? '',
      shades: shadesLook(this.d.store.get().equipped),
      logo: this.logoImages,
    });
    this.postcardJob = job;
    const next = (): void => {
      if (this.postcardJob !== job) return;
      // The crop needs the settled map still on screen; the footer waits (briefly) for the wordmark.
      if (job.stage === 0 && this.ui.current() !== 'results') return this.dropPostcard();
      if (job.stage === 2 && this.logoImages?.some((img) => !img.complete) && job.stageMs.length < 12) {
        job.stageMs.push(0);
        return idle(next);
      }
      if (!stepPostcard(job)) return idle(next);
      job.canvas.toBlob((blob) => {
        if (this.postcardJob !== job || !blob) return;
        this.postcardFile = new File([blob], postcardName(day, formatTimeOfDay(minute)), { type: 'image/png' });
        this.postcardUrl = URL.createObjectURL(blob);
        job.stage = 4;
        uiV11(this.ui).setPostcard?.(this.postcardUrl);
      }, 'image/png');
    };
    idle(next);
  }

  /** Forgets the postcard (a new run started): its thumbnail URL is revoked. */
  private dropPostcard(): void {
    this.postcardJob = null;
    this.postcardFile = null;
    if (this.postcardUrl !== null) {
      URL.revokeObjectURL(this.postcardUrl);
      this.postcardUrl = null;
      uiV11(this.ui).setPostcard?.(null);
    }
  }

  /** Test hook: whether the postcard file is ready, and each drawing stage's ms. */
  postcardState(): { ready: boolean; stageMs: number[]; bytes: number; name: string } {
    const f = this.postcardFile;
    return { ready: f !== null, stageMs: this.postcardJob?.stageMs.slice() ?? [], bytes: f?.size ?? 0, name: f?.name ?? '' };
  }

  /**
   * The Postcard pill: the postcard file plus the share text through the native sheet (or a
   * download and a copied link), called synchronously in the click; the text alone until it is ready.
   */
  private sharePostcard(): Promise<ShareOutcomeV11> {
    if (!this.result || this.debugRuns) return Promise.resolve('failed');
    const text = buildShare(this.result, shareBase(), this.dailyTry).text;
    return this.postcardFile ? shareFiles({ file: this.postcardFile, text }) : shareText({ text });
  }

  private async share(): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
    if (!this.result || this.debugRuns) return 'failed';
    // No web address (a file: build, a native shell without VITE_SHARE_URL): no link line.
    const text = buildShare(this.result, shareBase(), this.dailyTry).text;
    return shareText({ text });
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

  /**
   * The HUD's gold flag (frozen for the run in progress, live on the Title and menus): the Daily's
   * best on a Daily, else the recent best (the best of the last 10 runs) from lifetime run 3 on.
   */
  private livePb(): number {
    const save = this.d.store.get();
    if (this.dailyDate) {
      const st = dailyStatus(save, this.dailyDate);
      return st.bestMinutes > 0 ? st.bestMinutes : -1;
    }
    const recent = recentBest(save);
    return recent > 0 && save.stats.runs >= 3 ? recent : -1;
  }

  /** The HUD's white tick: the next milestone of endless runs. */
  private liveGoal(): number {
    if (this.kind !== 'endless') return -1;
    return nextMilestone(this.d.store.get()) ?? -1;
  }

  /**
   * The run's stamp (GR8): a challenge stamps 'PASSED SAM!' when its target is reached; an endless
   * run with three runs of history stamps 'PAST YOUR RECENT BEST' when it beats that, once.
   */
  private armStamp(run: SimState): void {
    this.stampAt = -1;
    const save = this.d.store.get();
    const c = this.runChallenge;
    if (run.cfg.mode === 'challenge' && c) {
      const name = challengeRules(c).n;
      this.stampAt = c.m;
      this.stampKind = 'teal';
      this.stampText = name ? `PASSED ${name.toUpperCase()}!` : 'TARGET PASSED!';
    } else if (run.cfg.mode === 'endless' && historyLength(save) >= 3) {
      this.stampAt = recentBest(save) + 1;
      this.stampKind = 'gold';
      this.stampText = 'PAST YOUR RECENT BEST';
    }
  }

  /** Fires the run's stamp on the first tick its score is reached. */
  private checkStamp(): void {
    const s = this.s;
    if (this.stampAt < 0 || s.phase === 'hold' || s.minutes < this.stampAt) return;
    this.stampAt = -1;
    this.fx.celebrate(this.stampKind, this.stampText);
    this.d.haptics.play('best');
  }

  private updateHints(dt: number, screen: ScreenId): void {
    // Paused (or a menu over a paused run): the hint and the lesson's time scale hold still.
    if (this.paused || screen === 'pause' || screen === 'settings') return;
    let slow = false;
    if (screen === 'title') {
      this.setGhost('both');
    } else if (screen === 'play') {
      const s = this.s;
      if (s.phase === 'hold') {
        this.setGhost('both');
      } else if (this.kind === 'challenge') {
        // The sender's rules: no ghost hint.
        this.setGhost('off');
      } else {
        const dragging = this.input.pointerDown || this.input.keyDown;
        const h = this.hintIn;
        const lessonOn = lessonOnOf(s);
        h.profile = s.cfg.profile;
        h.f = s.nubs.f;
        h.sunUp = s.sunUp;
        h.now = s.guide.now;
        h.next = s.guide.next;
        h.theta = s.sun.theta;
        h.dragging = dragging;
        h.invert = this.input.invert;
        h.lessonOn = lessonOn;
        if (this.hints.update(dt, h) && !this.debugRuns) {
          this.d.store.update((sv) => {
            sv.flags.hintsShown += 1;
          });
        }
        if (this.hints.lesson) this.cue('drag', this.dragDir());
        this.setGhost(this.hints.showing(dragging) ? this.hints.dir : 'off');
        // The lesson's slow time runs from its first hint until the sim ends the lesson (A5).
        slow = this.hints.lessonStarted && lessonOn;
      }
    } else {
      this.hints.stop();
    }
    // Ease the lesson's slow time in and out (about 0.2 s).
    const target = slow ? LESSON_TIME_SCALE : 1;
    const c = this.clock;
    c.assist += (target - c.assist) * Math.min(1, dt * 10);
    if (Math.abs(c.assist - target) < 0.005) c.assist = target;
  }

  /** The finger direction toward the hint's target: −1 ← or +1 → (invert honoured by the tracker). */
  private dragDir(): -1 | 1 {
    return this.hints.dir === 'left' ? -1 : 1;
  }

  /** Shows a cue once per run (never in challenge runs); null clears the cue line. */
  private cue(id: CueId | null, dir?: -1 | 1): void {
    const ui = uiV11(this.ui);
    if (id === null) {
      ui.showCue?.(null);
      return;
    }
    const bit = id === 'keep-shade' ? 1 : id === 'drag' ? 2 : id === 'shade-found' ? 4 : 8;
    if (this.kind === 'challenge' || (this.cues & bit) !== 0) return;
    this.cues |= bit;
    ui.showCue?.(id, dir);
  }

  /** The hint as the halo dial shows it: the target while a hint or the lesson is on, eased. */
  private fillHintView(dt: number, screen: ScreenId): void {
    const hv = this.renderIn.hint;
    const h = this.hints;
    const on = screen === 'play' && this.s.phase !== 'hold' && (h.lesson || h.active > 0) && !Number.isNaN(h.target);
    if (on) {
      // Ease the target as its arc drifts and grows, so the glow glides instead of jumping.
      if (Number.isNaN(hv.target) || this.hintAlpha < 0.05 || hv.turn !== h.turn) {
        hv.target = h.target;
        hv.width = h.targetW;
      } else {
        const k = Math.min(1, dt * 8);
        let d = h.target - hv.target;
        d -= Math.round(d / 360) * 360;
        hv.target = (((hv.target + d * k) % 360) + 360) % 360;
        hv.width += (h.targetW - hv.width) * k;
      }
      hv.turn = h.turn;
    }
    if (!this.paused) this.hintAlpha += ((on ? 1 : 0) - this.hintAlpha) * Math.min(1, dt * 8);
    if (this.hintAlpha < 0.01 && !on) this.hintAlpha = 0;
    hv.alpha = this.hintAlpha;
    hv.phase = on && this.ghost !== 'off' && this.ghost !== 'both' ? this.ui.ghostProgress() : -1;
  }

  private settingsChanged(st: Settings): void {
    const comfortChanged = comfortOn(st) !== comfortOn(this.d.store.get().settings);
    this.d.store.update((sv) => {
      sv.settings = st;
    });
    // The next endless run's rung depends on adaptive comfort (not on the player's name, A16).
    if (comfortChanged) this.refreshTitleRun();
    this.applySettings(st);
    this.ui.setSave(this.d.store.get());
    // Switching to Guide "Always" mid-run marks the run assisted, even if it is switched back.
    if (this.runActive && (this.params.guide ?? st.guide) === 'always') this.runAssisted = true;
    this.reducedMotionMaybeChanged();
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
    if (this.ui.current() === 'pause') {
      // A paused run (blur, Back, the pause button) resumes so the melt can happen.
      this.ui.show('play');
      this.resume();
    }
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

  /**
   * Test hook state() (CC-15): the sim at a glance plus the run's rules: profile, comfort rung (−1
   * when not an endless ladder run), drain, noon cloud, today's forecast and biome, lesson on.
   */
  testState(): {
    phase: string;
    day: number;
    minutes: number;
    chill: number;
    snow: number;
    theta: number;
    f: number;
    profile: number;
    rung: number;
    drain: number;
    noonCloud: number;
    forecast: string;
    biome: string;
    lessonOn: boolean;
  } {
    const s = this.s;
    return {
      phase: s.phase,
      day: s.day,
      minutes: s.minutes,
      chill: s.nubs.chill,
      snow: s.stats.snow,
      theta: s.sun.theta,
      f: s.nubs.f,
      profile: s.cfg.profile,
      rung: this.runActive ? this.runRung : (this.rungOf.get(s) ?? -1),
      drain: effectiveDrain(s),
      noonCloud: effectiveNoonCloud(s.cfg),
      forecast: forecastOf(s.params),
      biome: biomeAtWorld(s.world, s.nubs.y),
      lessonOn: lessonOnOf(s),
    };
  }

  /** Test hook: the config of the current run (the Title's held run between runs). */
  runCfg(): { mode: string; profile: number; tutorial: boolean; reducedMotion: boolean; seed: number; dailyDate: string | null; drain: number } {
    const s = this.s;
    const c = s.cfg;
    return {
      mode: c.mode,
      profile: c.profile,
      tutorial: c.tutorial,
      reducedMotion: c.reducedMotion,
      seed: c.seed,
      dailyDate: c.dailyDate ?? null,
      drain: effectiveDrain(s),
    };
  }

  /** Test hook: a core bot plays this run and the next ones (null: hands back to the input). */
  setTestBot(kind: BotKind | null): void {
    this.testBot = kind;
    this.bot = kind ? createBot(kind) : this.params.bot ? createBot(this.params.bot) : null;
  }

  /**
   * Test hook (A/B checks): draws the current frame (time frozen) under render options `a` and then
   * `b`, and compares the device pixels: the mean per-pixel max-channel |Δ|, the share of pixels
   * more than 3 and 8 levels apart, and the largest |Δ|. The next frame draws as usual.
   */
  pixelAB(a: Partial<RenderOptions>, b: Partial<RenderOptions>): PixelAB | null {
    const canvas = this.d.canvas;
    const g = canvas.getContext('2d');
    if (!g) return null;
    const opts = this.renderer.options;
    const keep = { ...opts };
    const pixels = (o: Partial<RenderOptions>): Uint8ClampedArray => {
      Object.assign(opts, keep, o);
      this.renderer.draw(this.renderIn);
      return g.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    return this.frozen(() => {
      try {
        pixels(a);
        const pa = pixels(a);
        const pb = pixels(b);
        let sum = 0;
        let over3 = 0;
        let over8 = 0;
        let max = 0;
        const n = pa.length / 4;
        for (let i = 0; i < pa.length; i += 4) {
          const d = Math.max(
            Math.abs((pa[i] as number) - (pb[i] as number)),
            Math.abs((pa[i + 1] as number) - (pb[i + 1] as number)),
            Math.abs((pa[i + 2] as number) - (pb[i + 2] as number)),
          );
          sum += d;
          if (d > 3) over3++;
          if (d > 8) over8++;
          if (d > max) max = d;
        }
        return { mean: sum / n, over3: over3 / n, over8: over8 / n, max };
      } finally {
        Object.assign(opts, keep);
      }
    });
  }

  /**
   * Runs `fn` with the render input frozen (no real or game time passes; particles, pops, the
   * camera and UI timers hold still), then restores it and has the next frame drawn as usual.
   */
  private frozen<T>(fn: () => T): T {
    const r = this.renderIn;
    const keep = { dt: r.dt, gdt: r.gdt, paused: r.paused, mapT: r.mapT, sheetTop: r.sheetTop };
    r.dt = 0;
    r.gdt = 0;
    r.paused = true;
    try {
      return fn();
    } finally {
      Object.assign(r, keep);
      this.cadence.invalidate();
    }
  }

  /** Test hook: the best flag the HUD shows (the run's snapshot while one is active). */
  hudPb(): number {
    return this.renderIn.pbMinutes;
  }

  /**
   * Test hook (K10): on the Results, draws the frame at `mapT` with and without the Melt Map
   * overlay (no time passes between the two) and counts the device pixels that differ above and
   * below the sheet's top edge. The next frame draws as usual.
   */
  mapProbe(mapT: number): MapProbe | null {
    const sheetTop = this.ui.current() === 'results' ? this.ui.resultsSheetTop() : null;
    if (sheetTop === null || this.resultsAt < 0) return null;
    const rr = this.renderer;
    const canvas = this.d.canvas;
    const g = canvas.getContext('2d');
    if (!g) return null;
    return this.frozen(() => {
      const r = this.renderIn;
      r.mapT = mapT;
      r.sheetTop = sheetTop;
      try {
        // A first draw at this mapT settles the zoom-dependent caches (the ground's whole-pixel tiles
        // need the scale to hold still for a frame), so the two measured frames take the same paths.
        rr.options.mapOverlay = true;
        rr.draw(r);
        rr.draw(r);
        const png = canvas.toDataURL('image/png');
        const a = g.getImageData(0, 0, canvas.width, canvas.height).data;
        rr.options.mapOverlay = false;
        rr.draw(r);
        const b = g.getImageData(0, 0, canvas.width, canvas.height).data;
        const dpr = rr.scene.view.dpr;
        const cutRow = Math.floor(sheetTop * dpr);
        const w = canvas.width;
        let above = 0;
        let below = 0;
        /** Device-px box of the differences below the cut (x0, y0, x1, y1), for diagnostics. */
        const box = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i < a.length; i += 4) {
          if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
          const px = i >> 2;
          const y = Math.floor(px / w);
          if (y < cutRow) {
            above++;
            continue;
          }
          below++;
          const x = px - y * w;
          box[0] = Math.min(box[0] as number, x);
          box[1] = Math.min(box[1] as number, y);
          box[2] = Math.max(box[2] as number, x);
          box[3] = Math.max(box[3] as number, y);
        }
        return { sheetTop, cutRow, dpr, above, below, belowBox: below > 0 ? box : null, png };
      } finally {
        rr.options.mapOverlay = true;
      }
    });
  }

  /** Test hook: the ghost hint's state. */
  hintState(): { mode: string; target: number; width: number; turn: number; lesson: boolean; shown: number } {
    const h = this.hints;
    return { mode: this.ghost, target: h.target, width: h.targetW, turn: h.turn, lesson: h.lesson, shown: h.shown };
  }

  /**
   * Test hook: replays a moment through fx and audio only (the sim is untouched): phew, mult, mult5,
   * noon (= highnoon), dawn, night, cloud, glare, flake, best, passed, swing, postcard.
   */
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
      case 'highnoon':
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
      case 'passed': {
        const name = this.runChallenge ? challengeRules(this.runChallenge).n : '';
        this.fx.celebrate('teal', name ? `PASSED ${name.toUpperCase()}!` : 'TARGET PASSED!');
        return;
      }
      case 'postcard':
        // What the Postcard pill does (no user activation here: the download path in Chromium).
        void this.sharePostcard();
        return;
      case 'swing':
        // The audio layer ignores SWING: fx only.
        this.fx.onEvents([{ e: 'swing', deg: 75, chain: 2, snow: 2, x: s.nubs.x, y: s.nubs.y }], s);
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
