// The game session (archive/TECH_SPEC §9.10, §13; V1_PLAN §6, §8, §11): owns the SimState and the run
// lifecycle (Title hold → play → dying → Results → retry/home), the fixed-step loop, and routes
// every frame's events to fx, audio, haptics, meta and the UI.

import {
  biomeAtY,
  bridged,
  buildRunResult,
  burnSweet,
  burnTarget,
  CAUSE_TIPS,
  COMFORT_MAX,
  CONCEPTS,
  createBot,
  createParJob,
  createRun,
  createSnap,
  dayTicks,
  deathRecap,
  deathTip,
  effectiveDrain,
  effectiveNoonCloud,
  elFixture,
  elHealth,
  formatTimeOfDay,
  generateSome,
  groveCount,
  growTarget,
  HEROES,
  isTrialId,
  lerpSnap,
  anyLevelDef,
  levelDef,
  levelTag,
  levelProgress,
  needOf,
  PLAN_START_DATE,
  prepareRun,
  prepareSome,
  rungConfig,
  splitMinutes,
  step,
  tagLocked,
  takeSnap,
  TRIAL_BASE,
  TUNING,
  veiled,
  worldPlan,
  type Bot,
  type BotKind,
  type ElObj,
  type FeatKind,
  type LevelDef,
  type ParJob,
  type RenderSnap,
  type RunBuild,
  type RunConfig,
  type RunResult,
  type SimEvent,
  type SimState,
  type Verb,
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
  continueLevel,
  debugRunOutcome,
  dailyStatus,
  dailyProgress,
  dailyTryStarted,
  equipCosmetic,
  isDailyUnlocked,
  nextMilestone,
  nextOpenTrial,
  recentBestAt,
  resetProgress,
  setDailyPar,
  shouldShowInstallSheet,
  swapMission,
  warmupDue,
  type ApplyRunOptions,
  type RunOutcome,
} from '../meta/progression.ts';
import { equippedLooks } from '../meta/content.ts';
import { featureUnlocked } from '../meta/gamify.ts';
import type { SaveStore } from '../meta/save.ts';
import { buildShare, shareBase } from '../meta/share.ts';
import type { Save, Settings } from '../meta/saveTypes.ts';
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
import { shareFiles, shareText, type ShareOutcome } from '../platform/share.ts';
import { requestPersistence } from '../platform/storage.ts';
import { Renderer, type DebugDraw, type RenderInput, type RenderOptions, type RenderScreen } from '../render/renderer.ts';
import { resetDeathBeat } from '../render/deathbeat.ts';
import { renderWardrobePreview, resetNubsAnim } from '../render/nubs.ts';
import { renderHeroPreview } from '../render/heroes.ts';
import { calloutBoxes, calloutsDrawn } from '../render/meltMap.ts';
import { createPostcardJob, postcardName, stepPostcard, type PostcardJob } from '../render/postcard.ts';
import { renderSunPreview } from '../render/sun.ts';
import { logoLayers } from '../ui/art.ts';
import { clearParticles, clearPops, clearRings } from '../render/particles.ts';
import { resetFootprints } from '../render/ground.ts';
import { resetBanners } from '../render/banners.ts';
import { createUi } from '../ui/ui.ts';
import { cueDuration } from '../ui/labels.ts';
import type { ChallengeBanner, CueId, GhostMode, ImportOutcome, ResultsCampaign, ResultsView, RunKind, RunStatusView, ScreenId, Ui, UiCallbacks, UiSoundName } from '../ui/types.ts';
import { ghostSwingX, guideAlpha, HintTracker, LESSON_TIME_SCALE, type GuideSetting, type HintInput } from './assist.ts';
import { Cadence, type CadenceInput } from './cadence.ts';
import { createCameraFx } from './camera.ts';
import { showCrashOverlay } from './crash.ts';
import { Fx } from './fx.ts';
import { createMechanics } from './mechanics.ts';
import { hudMeterHit } from '../render/hud.ts';
import { Input } from './input.ts';
import { FixedClock } from './loop.ts';
import { dailyDateInBounds, isDebugRun, startTFor, type Params } from './params.ts';
import { canvasDpr, deviceClass, dprCap, Governor } from './perf.ts';
import { dismissLevelCard, holdToasts, showLevelCard, type StampKind } from '../render/banners.ts';
import { createMoments, type RunMoments } from './moments.ts';
import {
  campaignConfig,
  countText,
  dareProgressText,
  featInSeconds,
  featLive,
  FINISH_FREEZE_S,
  FINISH_SKIP_S,
  goalLine,
  goalTarget,
  goalText,
  goalValue,
  hudGoal,
  introCard,
  missLine,
  relaxedGoalFor,
  STAR_COOL_LOST,
  STAR_FLAKES,
  STAR_GOAL,
  starRules,
  starState,
  trialDareCount,
  type HudGoal,
} from './campaign.ts';
import { formatScore } from '../core/format.ts';

/** The sim's finish-line event (CAMPAIGN_PLAN §2). */
type LevelWon = Extract<SimEvent, { e: 'levelWon' }>;

const DYING_S = 1.1;
/** A count-up's tick buzzes at most this often (ms). */
const TICK_HAPTIC_MS = 90;
const MELODY_MAX = 32;
const IDLE_BUDGET = 12;
/**
 * The single-file build (`--mode single`): its test hook is only screen() and forceDeath() (main.ts),
 * so the tooling-only methods below (state, demos, pixel and map probes) compile away there.
 */
const SINGLE = import.meta.env.MODE === 'single';
/**
 * World built before the Title's first frame: the view above Nubs plus the 540 u shadow reach, with
 * margin (GR19). Idle frames generate the rest; a tap at once pays the remainder on the first tick.
 */
const TITLE_AHEAD = 1100;
/** The par job's share of an idle frame (A13: ≤ 3 ms) and its sim chunk. */
const PAR_MS = 3;
const PAR_TICKS = 6;

/** Runs `fn` in idle time (a frame later where requestIdleCallback is missing). */
/**
 * A core bot for ?bot= and the test hook. The single-file build (`--mode single`) ships no bots
 * (A3 budget; the Daily par has its own novice bot), so there both fall back to the player's input.
 */
function makeBot(kind: BotKind): Bot | null {
  return import.meta.env.MODE === 'single' ? null : createBot(kind);
}

/** Elementals v2 (§7.9): the kinds of object each verb's ghost hand shows on. */
const GHOST_KINDS: Readonly<Record<Verb, string>> = { sun: '', burn: 'bramble gate ice', grow: 'gap stream plot', steer: 'puddle', blow: 'rain fog' };

/** Elementals v2 (?elfix=1): every object kind and state on a Trial run, for art review; bot builds only (makeBot's gate). */
function fixture(s: SimState): void {
  if (s.el !== null) elFixture(s);
}

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
  /** v1.5 mechanics: the renderer's MechView and the test hook's demos (game/mechanics.ts). */
  readonly mech = createMechanics();
  /** Cold Snaps seen this session (the "swipe down" cue stops after two). */
  private snapsSeen = 0;
  /** Mission toasts, the first levels' tips and the COMEBACK (moments.ts). */
  private readonly moments: RunMoments;
  /** The campaign star bits last seen (a newly lit one chimes). */
  private runStars = 0;
  /** v1.6: the run's Dare counts from the sim's `feat` events, and the HUD goal pill's reused count. */
  private readonly featSeen = new Map<FeatKind, number>();
  private readonly hudGoalOut: HudGoal = { value: 0, target: -1, flakes: false, glyph: null, sec: false };
  /** When the last count-up tick buzzed (uiSound 'tick'). */
  private tickHapticAt = Number.NEGATIVE_INFINITY;
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
  /** The cue on the line as this session last set it (an expired timed cue still counts). */
  private cueShown: { id: CueId; dir: -1 | 1 | undefined } | null = null;
  /** An event cue (go, shade found, first SWING, ...) keeps the line until then (performance.now ms). */
  private cueHold = 0;
  /** The run's first lowChill came in the lesson: from then on it warns while Chill is low. */
  private meltWarn = false;
  /** Eased visibility of the hint on the halo dial. */
  private hintAlpha = 0;
  private readonly renderIn: RenderInput;

  // Run bookkeeping.
  private kind: RunKind = 'endless';
  /** The campaign level the last runConfig() built (null: not a campaign run). */
  private cfgLevel: LevelDef | null = null;
  /** The level of each campaign run built (the Title never holds one). */
  private readonly levelOf = new WeakMap<SimState, LevelDef>();
  /** The level the current run plays (null outside the campaign). */
  private runLevel: LevelDef | null = null;
  /** The finish: real time the line was crossed (−1 none) and the sim's verdict. */
  private wonAt = -1;
  private won: LevelWon | null = null;
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
  /** Endless runs built as the warm-up after the climb to standard (days.ts STANDARD_WARMUP). */
  private readonly warmups = new WeakSet<SimState>();
  private cfgWarmup = false;
  private nextBuildWarmup = false;
  /** The run in play is the warm-up (applyRunResult records it as eased). */
  private runWarmup = false;
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

  /** Test hook: the last Results' campaign verdict (null outside the campaign or before Results). */
  campaignResults(): ResultsCampaign | null {
    return this.lastCampaign;
  }
  private lastCampaign: ResultsCampaign | null = null;
  private resultsShown = false;

  // Frame state.
  private paused = false;
  private last = -1;
  private time = 0;
  private swayPhase = 0;
  /** The Title logo shadow offset last published (CSS px). */
  private logoShadowX = Number.NaN;
  private logoShadowY = Number.NaN;
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
    this.moments = createMoments(this.renderer.scene.banners, {
      mission: () => {
        this.d.audio.play('reward');
        this.d.haptics.play('reward');
      },
      comeback: (x, y) => {
        this.fx.comeback(x, y);
        this.d.audio.play('comeback');
        this.d.haptics.play('phew');
      },
    });
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
    const callbacks: UiCallbacks = {
        startRun: sync((k: RunKind, date?: string, level?: number) => this.startRun(k, date, level)),
        startHeld: () => this.startHeld(),
        nextLevel: sync(() => this.nextLevel()),
        openJourney: sync((to?: 'journey' | 'elementals') => this.openJourney(to)),
        retry: sync(() => this.retry()),
        home: sync(() => this.home()),
        pause: sync(() => this.pause()),
        resume: sync(() => this.resume()),
        restart: sync(() => this.retry()),
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
        runStatus: () => this.runStatus(),
        renderWardrobePreview: (canvas, equipped, subject) =>
          subject === 'sun' ? renderSunPreview(canvas, equippedLooks(equipped).shades) : renderWardrobePreview(canvas, equipped),
        renderHeroPreview: (canvas, hero) => renderHeroPreview(canvas, hero, store.get().equipped),
        updateSave: (change) => {
          const next = change(store.get());
          store.set(next);
          store.flush();
          this.ui.setSave(next);
          return next;
        },
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
      // v1.5 Cold Snap: only while a run plays past its start (never on the Title, the intro card,
      // a pause or a menu), and the meter only where it is drawn.
      // Elementals v2: only while Nubs walks and no TAG is due (the sim refuses the rest).
      canSnap: () => this.ui.current() === 'play' && !this.paused && this.runActive && this.s.phase === 'day' && this.s.ready === 0 && (this.s.el === null || (this.s.nubs.hero === 'nubs' && !tagLocked(this.s))),
      meterHit: (x, y) => hudMeterHit(this.renderer.scene.hud, x, y),
      // Elementals v2 (docs/ELEMENTALS_V2.md §7.9): the walking element's verb, the last drawn
      // frame's ground mapping (camera.ts: sx = ox + x·S, sy = oy − y·S) and the targets under a press.
      verb: () => this.verbNow(),
      toWorld: (x, y, out) => {
        const v = this.renderer.scene.view;
        if (x < v.vx || x > v.vx + v.vw || y < v.vy || y > v.vy + v.vh) return false;
        out[0] = (x - v.ox) / v.S;
        out[1] = (v.oy - y) / v.S;
        return true;
      },
      uPerPx: () => 1 / this.renderer.scene.view.S,
      canTarget: (wx, wy) => {
        const verb = this.verbNow();
        return verb === 'burn' ? burnTarget(this.s, wx, wy) >= 0 : verb === 'grow' ? growTarget(this.s, wx, wy) >= 0 : false;
      },
    });
    this.mech.route = (ev) => {
      const list = [ev];
      this.fx.onEvents(list, this.s);
      this.d.audio.onEvents(list, this.audioView);
      this.d.haptics.onEvents(list, 0);
    };
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
      campaign: null,
      mech: this.mech.view,
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
      // Resized at the top of the next frame, which then draws (a resize clears the canvas, and the
      // governor steps after this frame's draw).
      this.sizeDirty = true;
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
        if (this.params.level !== null && anyLevelDef(this.params.level)) {
          // ?level=N opens the level directly: the intro card holds until the first tap (a ?bot=
          // plays it at once).
          this.ui.show('play');
          this.startRun('campaign', undefined, this.params.level);
        } else if (this.params.bot) {
          this.bot = makeBot(this.params.bot);
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

  /**
   * The Title sundial (GR17, CC-14): the logo's shadow falls the way the world's shadows do, from
   * the swaying sun, longer when the sun is low (--lsx / --lsy, CSS px; rewritten only when they
   * move a quarter pixel).
   */
  private publishLogoShadow(sway: number): void {
    const th = ((this.s.sun.theta + sway) * Math.PI) / 180;
    const k = 6 * (1 + 0.6 * (1 - this.renderer.scene.light.elev));
    const x = -Math.cos(th) * k;
    const y = Math.sin(th) * k;
    if (Math.abs(x - this.logoShadowX) < 0.25 && Math.abs(y - this.logoShadowY) < 0.25) return;
    this.logoShadowX = x;
    this.logoShadowY = y;
    const root = document.documentElement.style;
    root.setProperty('--lsx', `${x.toFixed(1)}px`);
    root.setProperty('--lsy', `${y.toFixed(1)}px`);
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
    const won = this.s.phase === 'won';
    const stepping = !this.paused && (screen === 'play' || screen === 'dying') && this.s.phase !== 'dead' && !won;
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
        if (s.phase === 'dead' || s.phase === 'won') break;
      }
      if (n > 0) takeSnap(s, this.curr);
      this.moments.update(s);
    } else {
      // The death, the finish freeze and the Results keep game time flowing for the effects.
      const flowing = screen === 'dying' || screen === 'results' || (won && screen === 'play');
      this.clock.advance(flowing ? real : 0);
      if (flowing) this.clock.acc = 0;
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

    const gdt = stepping || screen === 'dying' || screen === 'results' || (won && screen === 'play') ? this.clock.gameDt : screen === 'pause' ? 0 : real;
    if (this.deathAt >= 0) this.dyingGame += this.clock.gameDt;
    this.fx.update(stepping ? this.clock.gameDt : 0, s, s.phase === 'day' || s.phase === 'night');
    this.updateHints(real, screen);
    this.updateDeathFlow();
    this.updateWinFlow();

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
    r.challengeName = this.runChallenge?.n ?? '';
    this.fillCampaignView();
    this.fx.mech = this.mech.fill(this.s, this.time);
    r.dying = this.deathAt >= 0 ? Math.max(0, this.dyingGame) : -1;
    r.mapT = this.resultsAt >= 0 && screenNow === 'results' ? this.time - this.resultsAt : -1;
    r.sheetTop = screenNow === 'results' ? this.ui.resultsSheetTop() : null;
    r.time = this.time;
    r.highContrast = save.settings.highContrast;
    this.renderer.scene.banners.levelKeys = this.ui.keyboardMode();
    this.ui.ghostClearMeter(this.renderer.scene.hud.meterShown);
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
      if (screenNow === 'title') this.publishLogoShadow(r.sway);
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

  private readonly liveStatsOut = {} as SimState['stats'];
  /** s.stats, except on a grove Trial (T7) before the finish: stats.grove is set at the finish, so count the trees standing now. */
  private liveStats(): SimState['stats'] {
    const s = this.s;
    if (s.el === null || s.trial?.dare.kind !== 'grove' || s.phase === 'won') return s.stats;
    Object.assign(this.liveStatsOut, s.stats);
    this.liveStatsOut.grove = groveCount(s);
    return this.liveStatsOut;
  }

  /** The HUD's campaign row for the renderer (null outside a campaign run). */
  private fillCampaignView(): void {
    const r = this.renderIn;
    const level = this.runLevel;
    if (!level) {
      r.campaign = null;
      return;
    }
    const s = this.s;
    let c = r.campaign;
    if (!c) {
      c = { id: 0, progress: 0, goalValue: 0, goalTarget: -1, goalFlakes: false, markGate: -1, markEclipse: -1, gust: 0, stars: 0, coolLeft: 1, goalGlyph: null, goalSec: false };
      r.campaign = c;
    }
    const relaxed = this.relaxed();
    const st = this.liveStats();
    const goal = hudGoal(level, st, this.hudGoalOut, relaxed, this.featSeen);
    c.id = level.id;
    c.progress = levelProgress(s);
    c.goalValue = goal.value;
    c.goalTarget = goal.target;
    c.goalFlakes = goal.flakes;
    c.goalGlyph = goal.glyph;
    c.goalSec = goal.sec;
    c.markGate = level.concepts.includes('gate') ? 0.5 : -1;
    c.markEclipse = level.concepts.includes('eclipse') ? 0.5 : -1;
    c.gust = s.sun.gust;
    c.stars = starState(level, st, s.phase === 'won', relaxed, this.featSeen);
    c.coolLeft = 1 - Math.min(1, s.stats.litTotal / level.stars.sunSec);
    // A star earned mid-run (the goal, the flakes) chimes; the finish has its own jingle.
    if (c.stars & ~this.runStars & 3 && s.phase === 'day') {
      this.d.audio.play('claim');
      this.d.haptics.play('claim');
    }
    this.runStars = c.stars;
  }

  /** The run's goal is relaxed to the finish (the soft-fail). */
  private relaxed(): boolean {
    return this.s.cfg.relaxedGoal === true;
  }

  /** Goal misses recorded on level `id` (the soft-fail's count). */
  private misses(id: number): number {
    return this.d.store.get().campaign.misses?.[id - 1] ?? 0;
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
    // The sizzle and crackle are Nubs' melting cue (the renderer's drawSizzle). On a Trial another
    // hero's light is not its danger, so they stay silent there.
    v.f = s.nubs.hero === 'nubs' ? s.nubs.f : 0;
    const lit = v.f * 5;
    v.glareW = lit > 0 ? Math.min(1, (2 * s.nubs.glare) / lit) : 0;
    v.chill = s.nubs.chill;
    // Elementals: the heartbeat and the calm scene read the walker's steady health on a Trial
    // (Sprout's Sap is no life meter: never a heartbeat).
    v.health = s.el !== null ? (s.nubs.hero === 'sprout' ? 100 : elHealth(s)) : undefined;
    v.mult = s.nubs.mult;
    v.omega = s.sun.omega;
    // Campaign: the chapter's music palette, the finish line and the concept signatures.
    v.chapter = s.level?.chapter ?? 0;
    v.progress = s.level ? levelProgress(s) : -1;
    v.gust = s.sun.gust;
    v.locked = s.sun.locked;
    v.eclipse = s.eclipse;
    v.moonlit = s.moonlit;
    v.fog = s.mods.has('fog');
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

  /**
   * A fresh run for `kind` (endless seeds are random unless ?seed= is given; Dailies on `date`).
   * `ahead` = how far the world is built now; the first tick completes the rest (same world).
   */
  private makeRun(kind: RunKind, date?: string, ahead?: number, level?: number): SimState {
    const run = createRun(this.runConfig(kind, date, level), undefined, ahead);
    if (import.meta.env.MODE !== 'single' && this.params.elfix) fixture(run);
    this.rungOf.set(run, this.cfgRung);
    if (this.cfgWarmup) this.warmups.add(run);
    if (this.cfgLevel) this.levelOf.set(run, this.cfgLevel);
    return run;
  }

  /**
   * The comfort rung of the next endless run (A2): the tutorial rung on the very first run, then
   * the save's rung (at least 1) while adaptive comfort is on, else the standard rules.
   */
  private comfortRung(): number {
    const save = this.d.store.get();
    if (save.stats.runs === 0) return 0;
    return save.settings.comfort ? Math.max(1, save.stats.comfort) : COMFORT_MAX;
  }

  /** The config of a fresh run of `kind`, with the run bookkeeping (kind, daily, challenge) set. */
  private runConfig(kind: RunKind, date?: string, level?: number): RunConfig {
    const save = this.d.store.get();
    const p = this.params;
    const rm = this.reducedMotion();
    let cfg: RunConfig;
    this.runChallenge = null;
    this.dailyDate = null;
    this.dailyScored = false;
    this.cfgRung = -1;
    this.cfgWarmup = false;
    this.cfgLevel = null;
    const def = kind === 'campaign' ? anyLevelDef(level ?? 1) : null;
    if (def) {
      // A campaign level (CAMPAIGN_PLAN §4) or an Elementals Trial: the level's own rules, never the
      // comfort ladder.
      this.cfgLevel = def;
      cfg = campaignConfig(def, rm, save.flags.tutorialDone, relaxedGoalFor(def, save.campaign.misses?.[def.id - 1] ?? 0));
      this.kind = 'campaign';
    } else if (kind === 'daily' || (kind === 'endless' && p.daily && !this.usedUrlSeed)) {
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
        // The sender's exact rules (CC-8, A1; decodeChallenge resolves a v1.0 code's to the v1.0
        // world's); never a lesson, hint or cue.
        const profile = c.p ?? 3;
        cfg = { seed: c.seed >>> 0, mode: 'challenge', profile, tutorial: profile === 0, reducedMotion: rm, drain: c.dr ?? 55, noonCloud: c.nc ?? 0, plan: c.pl === 1 };
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
        // The first run at standard after the climb is the warm-up (not when a rung is forced).
        const warmup = p.rung === null && p.forecast === null && warmupDue(save);
        const r = rungConfig(rung, { tutorialDone: save.flags.tutorialDone, warmup });
        cfg = { seed, mode: 'endless', profile: r.profile, tutorial: r.tutorial, reducedMotion: rm, drain: r.drain, noonCloud: r.noonCloud };
        if (r.lesson) cfg.lesson = true;
        this.cfgRung = rung;
        this.cfgWarmup = r.warmup;
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
    if (p.rules) cfg.v16 = p.rules;
    return this.debugStart(cfg);
  }

  /** A Daily on `date`: the standard rules without the noon cloud; the Day Plan from PLAN_START_DATE (A1). */
  private dailyConfig(date: string, rm: boolean): RunConfig {
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
    this.runLevel = null;
    if (this.challenge && !this.inWarmup()) return this.makeRun('challenge', undefined, TITLE_AHEAD);
    if (this.nextRun && this.nextRun.cfg.mode === 'endless' && this.nextRun.phase === 'hold') {
      const r = this.nextRun;
      this.nextRun = null;
      this.kind = 'endless';
      this.runChallenge = null;
      this.dailyDate = null;
      this.dailyScored = false;
      return r;
    }
    return this.makeRun('endless', undefined, TITLE_AHEAD);
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
    this.ui.setRunPreview(w.planOn ? worldPlan(w, 1) : null);
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
  private beginRun(run: SimState, keepInput = false, card = true): void {
    this.s = run;
    this.renderIn.s = run;
    this.dropPostcard();
    this.resetSnaps();
    this.resetRender();
    this.fx.resetRun();
    this.mech.reset();
    this.featSeen.clear();
    this.clock.reset();
    if (!keepInput) this.input.clearPending();
    const botKind = this.params.bot ?? this.testBot;
    this.bot = botKind ? makeBot(botKind) : null;
    this.d.audio.resetRun();
    this.melody = [];
    this.hints.reset();
    this.hintAlpha = 0;
    this.cues = 0;
    this.cueShown = null;
    this.cueHold = 0;
    this.verbDone = false;
    this.meltWarn = false;
    this.runRung = this.rungOf.get(run) ?? -1;
    this.runWarmup = this.warmups.has(run);
    this.runLevel = this.levelOf.get(run) ?? null;
    this.wonAt = -1;
    this.won = null;
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
    this.moments.begin(save, this.runLevel, !this.debugRuns, run.cfg.relaxedGoal === true);
    this.runStars = 0;
    if (!this.debugRuns) {
      const begun = beginRun(save);
      if (begun.save !== save) {
        store.set(begun.save);
        this.ui.setSave(begun.save);
      }
    }
    this.setGhost('off');
    // The level's intro card holds until the first tap (§4).
    if (card && this.runLevel && run.phase === 'hold') {
      showLevelCard(this.renderer.scene.banners, introCard(this.runLevel, run.cfg.relaxedGoal === true), this.runLevel.biome);
    }
  }

  private ghost: GhostMode = 'off';
  /** Elementals v2: an element's verb landed this run (the intro ghost hand has taught it). */
  private verbDone = false;

  private setGhost(mode: GhostMode, at = false): void {
    if (!at) this.ui.setGhostAt(NaN, NaN);
    if (mode === this.ghost) return;
    this.ghost = mode;
    this.ui.setGhostThumb(mode);
  }

  /**
   * The intro element's ghost (§7.9): its verb played on the first target ahead in reach (Ember's
   * once the tap is due), anchored there on the last drawn frame; off once a verb has landed.
   */
  private verbGhost(): void {
    const s = this.s;
    const hero = s.nubs.hero;
    const verb = HEROES[hero].verb;
    const el = s.el as NonNullable<SimState['el']>;
    if (verb === 'steer' && Math.abs(el.dxTarget) >= 8) this.verbDone = true;
    let o: ElObj | undefined;
    if (!this.verbDone && s.trial?.intro === hero) {
      const E = TUNING.elements;
      for (const x of el.objs) {
        const ahead = x.y - s.nubs.y;
        if (ahead > E.range) break;
        // The verb's kinds: no standing tree, no bridge, weather awake.
        if (ahead >= E.near && x.state !== 2 && GHOST_KINDS[verb].includes(x.kind) && x.casterId < 0 && !bridged(x) && (verb !== 'blow' || x.awake)) {
          o = x;
          break;
        }
      }
    }
    if (!o || (verb === 'burn' && !burnSweet(s, o))) {
      this.setGhost('off');
      return;
    }
    const v = this.renderer.scene.view;
    this.ui.setGhostAt(Math.max(40, Math.min(v.vw - 40, v.ox + o.x * v.S - v.vx)), v.oy - o.y * v.S - v.vy);
    this.setGhost(verb === 'burn' ? 'tap' : verb === 'grow' ? 'hold' : verb === 'steer' ? 'steer' : o.x < s.nubs.x ? 'left' : 'right', true);
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
      // Before Endless unlocks (v1.4), a press plays the next Journey level, like the Play button.
      const save = this.d.store.get();
      if (this.challenge === null && !featureUnlocked(save, 'endless')) {
        this.ui.show('play');
        this.startRun('campaign', undefined, continueLevel(save));
        this.syncSentinel();
        return;
      }
      // Any press on the canvas starts the Title's run with catch semantics (θ stays θ0); with a
      // challenge link open, that is the challenge run.
      this.ui.show('play');
      this.beginRun(this.s, true);
      this.syncSentinel();
    } else if (this.wonAt >= 0 && this.time - this.wonAt >= FINISH_SKIP_S) {
      // A tap after the FINISH stamp has landed goes straight to the Results.
      this.showResults();
    }
  }

  private startRun(want: RunKind, date?: string, level?: number): void {
    this.d.audio.ensure();
    const held = !this.runActive && this.s.phase === 'hold';
    // A first-time player plays the tutorial run before a friend's challenge (CC-8 warm-up).
    const kind = want === 'challenge' && this.inWarmup() ? 'endless' : want;
    if (kind === 'campaign') {
      // A level waits on its intro card for the first press (the clock held at its start time).
      this.beginRun(this.makeRun('campaign', undefined, undefined, level ?? this.runLevel?.id ?? 1));
      this.setGhost('both');
      return;
    }
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

  /** Space/Enter in play: a run held on its level card (or at dawn) starts as a tap starts it. */
  private startHeld(): boolean {
    if (this.ui.current() !== 'play' || this.s.phase !== 'hold') return false;
    this.d.audio.ensure();
    this.input.tap();
    return true;
  }

  private retry(): void {
    this.d.audio.ensure();
    this.finishPrebuild();
    // After the warm-up, Retry ("Take the challenge") plays the friend's run.
    if (this.warmup && this.challenge) this.kind = 'challenge';
    let run: SimState;
    if (this.kind === 'campaign') {
      // Retry restarts the same level at once, without its intro card (Pause > Restart too).
      run = this.makeRun('campaign', undefined, undefined, this.runLevel?.id ?? 1);
    } else if (this.kind === 'endless' && this.nextRun && this.nextRun.cfg.mode === 'endless') {
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
    this.beginRun(run, false, false);
    this.input.tap();
  }

  /**
   * Results > Next level: the level after this one waits on its intro card (the UI is on 'play'); a
   * Trial's next is the next open Trial (the Results' nextId), and without one it leaves for the
   * Elementals screen.
   */
  private nextLevel(): void {
    this.d.audio.ensure();
    const id = this.runLevel?.id ?? 0;
    const trial = isTrialId(id);
    const next = trial ? (this.lastCampaign?.nextId ? anyLevelDef(this.lastCampaign.nextId) : null) : levelDef(id + 1);
    if (!next) {
      this.ui.show(trial ? 'elementals' : 'title');
      this.home();
      return;
    }
    this.finishPrebuild();
    this.beginRun(this.makeRun('campaign', undefined, undefined, next.id));
    this.setGhost('both');
  }

  /**
   * Results > Map and the Title's Journey pill: leaves the run like Home and shows the Journey map
   * (a Trial's Results: the Elementals screen).
   */
  private openJourney(to: 'journey' | 'elementals' = 'journey'): void {
    this.home();
    if (this.ui.current() !== to) this.ui.show(to);
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

  private challengeBanner(c: Challenge): ChallengeBanner {
    const b: ChallengeBanner = { minutes: c.m };
    if (c.n) b.name = c.n;
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
  private adoptSave(next: Save): void {
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

  /** The walking element's verb: HEROES[hero].verb on a Trial past the start beat, else 'sun' (§7.9). */
  private verbNow(): Verb {
    const s = this.s;
    return s.el !== null && s.phase === 'day' && s.ready === 0 ? HEROES[s.nubs.hero].verb : 'sun';
  }

  private onTickEvent(ev: SimEvent): void {
    this.moments.onEvent(ev, this.s);
    this.mech.onEvent(ev);
    switch (ev.e) {
      case 'tag':
        // §4.1: a TAG ends the verb slot, and the sun press too when a held-sun leg (steer, blow) is involved.
        this.input.cut(HEROES[ev.from].sunHeld || HEROES[ev.to].sunHeld);
        // §7.11: the cue line (aria-live) announces every hand-off: "Drip's turn. The sun holds."
        this.cueShown = { id: `tag-${ev.to}`, dir: undefined };
        this.ui.showCue(this.cueShown.id);
        break;
      case 'burn':
      case 'grow':
      case 'gust':
        // The first verb of the run that landed: the ghost hand has taught it (a spread fire is no tap).
        if (ev.e !== 'burn' || !ev.spread) this.verbDone = true;
        break;
      case 'feat':
        this.featSeen.set(ev.kind, ev.value);
        break;
      case 'flake':
        if (this.melody.length < MELODY_MAX) this.melody.push(ev.degree);
        break;
      case 'start':
        // The first tap: the level's intro card leaves.
        if (this.runLevel) dismissLevelCard(this.renderer.scene.banners);
        break;
      case 'go':
        if (this.s.cfg.profile <= 1 || (this.runLevel !== null && this.s.cfg.lesson === true)) {
          this.cue('keep-shade');
          // The cue line (2 s) is read first: no tip stacks over it.
          holdToasts(this.renderer.scene.banners, 2.4);
        }
        break;
      case 'levelWon':
        this.onLevelWon(ev);
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
      case 'frostReady':
        // v1.5: the meter is full; until the player has snapped twice this session, say how (not
        // under a snap, which no swipe can cast: the cast's own pour often refills a charge).
        // Not on a Trial: its ability coin is not "Frost" (the hero tips teach the swipe there).
        if (this.snapsSeen < 2 && this.s.snapTicks === 0 && this.s.trial === null) this.cue('snap-ready');
        break;
      case 'snap':
        this.snapsSeen++;
        // The "Frost full! Swipe ↓" line has done its job: clear it so it never covers the snap.
        if (this.cueShown?.id === 'snap-ready') this.cue(null);
        break;
      case 'snapEnd':
        // A charge filled under the snap: now it can be cast.
        if (this.snapsSeen < 2 && this.s.nubs.frost >= 1 && this.s.trial === null) this.cue('snap-ready');
        break;
      case 'swing':
        // The first SWING of a lifetime explains itself once (nothing else in the game names it).
        if (this.d.store.get().stats.swings === 0 && this.s.stats.swings === 1) this.cue('swing');
        break;
      case 'lowChill':
        // The first scare of a new player. Inside the lesson it is a live warning that keeps the
        // drag instruction (A16) and lasts while Nubs is lit with Chill low (lessonCue).
        // Not on a Trial: "Find thick teal" is Nubs' rule (the hero tips teach each hero's).
        if (this.lifetimeRuns > 2 || this.s.trial !== null) break;
        if (this.s.lessonOn) this.meltWarn = true;
        else this.cue('melting');
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
    // A Trial's recap tip names the cause (docs/ELEMENTALS_V2.md §7.2), else the fallen element's;
    // Nubs melting keeps today's recap tips.
    const d = result.death;
    const who = d.who ?? this.s.nubs.hero;
    // Sprout short of Sap for the bridge that took it: the Sap tip, not the timing one.
    const el = this.s.el;
    const co = el?.objs[el.causeObj];
    const sap = who === 'sprout' && co !== undefined && co.size < needOf(co) && this.s.nubs.chill < 10;
    const heroTip = this.s.trial ? (CAUSE_TIPS[sap ? 'sprout:sap' : `${who}:${d.heroCause}`] ?? CAUSE_TIPS[d.heroCause ?? ''] ?? HEROES[who].deathTip) : '';
    this.tip = heroTip || deathTip(deathRecap(this.s), save.settings.invert, save.stats.runs);
    result.melody = this.melody.slice();
    // Latched: Guide "Always" at any point of the run marks it assisted.
    result.assisted = this.runAssisted;
    this.result = result;
    this.applyResult(save, result);
    this.setGhost('off');
    this.cue(null);
    this.input.releaseAll();
    if (this.ui.current() === 'play') this.ui.show('dying');
    // Start building the next endless run: its world is generated a slice per frame while the
    // death and the Results play (stepPrebuild), so Retry is instant and no frame hitches.
    this.startPrebuild();
  }

  /** Folds the finished run into the save (debug runs leave it alone) and keeps the outcome for the Results. */
  private applyResult(save: Save, result: RunResult): void {
    if (this.debugRuns) {
      // Debug runs leave the save alone: no Snow, bests, missions, achievements or Daily tries.
      this.outcome = debugRunOutcome(save, result);
      return;
    }
    const options: ApplyRunOptions = { today: localDate(), dailyTry: this.dailyTry, playSeconds: this.s.tick / 60 };
    if (this.runChallenge) options.challengeTarget = this.runChallenge.m;
    if (this.runRung >= 0) options.rung = this.runRung;
    if (this.runWarmup) options.warmup = true;
    // v1.6 soft-fail: a level's finish reached with its goal missed counts toward relaxing it.
    if (this.won && !this.won.passed && result.level) options.goalMiss = true;
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

  /**
   * The finish line (§4): the run freezes on a FINISH stamp with confetti (or the miss line when
   * the goal was not met), the result is built (the core fills `result.level` and
   * `stats.minChill`), and after FINISH_FREEZE_S the Results show.
   */
  private onLevelWon(ev: LevelWon): void {
    const level = this.runLevel;
    if (!level || this.wonAt >= 0) return;
    this.wonAt = this.time;
    this.won = ev;
    this.hints.stop();
    this.clock.assist = 1;
    const save = this.d.store.get();
    const result = buildRunResult(this.s);
    result.melody = this.melody.slice();
    result.assisted = this.runAssisted;
    this.result = result;
    this.tip = null;
    this.applyResult(save, result);
    this.fx.finish(ev.passed, ev.passed ? 'FINISH' : missLine(level), ev.stars, this.s.nubs.x, this.s.nubs.y);
    this.d.haptics.play('best');
    this.setGhost('off');
    this.cue(null);
    this.input.releaseAll();
  }

  private updateWinFlow(): void {
    if (this.wonAt < 0 || this.resultsShown) return;
    if (this.time - this.wonAt >= FINISH_FREEZE_S) this.showResults();
  }

  private updateDeathFlow(): void {
    if (this.deathAt < 0 || this.resultsShown) return;
    if (this.time - this.deathAt >= DYING_S) this.showResults();
  }

  private showResults(): void {
    if (this.resultsShown || !this.result || !this.outcome) return;
    this.resultsShown = true;
    const daily = this.result.mode === 'daily';
    const view: ResultsView = {
      result: this.result,
      outcome: this.outcome,
      dailyTry: daily ? this.dailyTry : undefined,
      // K5: every Daily (k:'d' challenges too) says which date it was and whether it could count.
      ...(daily && this.dailyDate !== null ? { dailyDate: this.dailyDate, dailyScored: this.dailyScored } : {}),
      ...(this.runChallenge ? { challengeTarget: this.runChallenge.m, challengeName: this.runChallenge.n ?? '' } : {}),
      ...(this.warmup ? { warmupFor: { minutes: this.warmup.m, name: this.warmup.n ?? '' } } : {}),
      ...(this.debugRuns ? { debug: true } : {}),
      ...(this.tip !== null ? { tip: this.tip } : {}),
      ...(this.runLevel ? { campaign: this.campaignView(this.runLevel, this.result) } : {}),
    };
    this.lastCampaign = view.campaign ?? null;
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
      // ?bot= autoplay: on to the next run (the next level in the campaign).
      window.setTimeout(() => {
        if (this.ui.current() === 'results') {
          this.ui.show('play');
          if (this.runLevel && this.won?.passed) this.nextLevel();
          else this.retry();
        }
      }, 1500);
    }
  }

  /** ResultsView.campaign: the level's verdict (stars, the goal line, the next level, the concept it taught). */
  private campaignView(level: LevelDef, result: RunResult): ResultsCampaign {
    const won = this.won;
    const passed = won !== null && won.passed;
    // A Trial's Next is the next open Trial (docs/ELEMENTALS.md §4.10), or none.
    const trial = isTrialId(level.id);
    const nextTrial = trial ? nextOpenTrial(this.d.store.get(), level.id - TRIAL_BASE) : null;
    const next = trial ? null : levelDef(level.id + 1);
    const view: ResultsCampaign = {
      id: level.id,
      name: level.name,
      passed,
      stars: won?.stars ?? 0,
      nextId: nextTrial !== null ? TRIAL_BASE + nextTrial : next ? next.id : null,
      goalLine: goalLine(level, result.stats, passed, this.relaxed(), this.featSeen, this.misses(level.id)),
      // The goal cards (UI v2): each rule and whether this run met it (won: the finish was reached).
      starRules: starRules(level, this.relaxed()),
      starBits: starState(level, result.stats, won !== null, this.relaxed(), this.featSeen),
    };
    if (level.introduces) {
      // The sheet reads "New: {name} {blurb}"; a concept named after its level keeps just the blurb.
      const c = CONCEPTS[level.introduces];
      view.introduces = { name: c.name === level.name ? '' : c.name, blurb: c.blurb };
    }
    return view;
  }

  /** runConfig('endless') without disturbing the current run's kind/challenge bookkeeping. */
  private endlessConfigQuiet(): RunConfig {
    const kind = this.kind;
    const ch = this.runChallenge;
    const dd = this.dailyDate;
    const ds = this.dailyScored;
    const lv = this.runLevel;
    const cfg = this.runConfig('endless');
    this.kind = kind;
    this.runChallenge = ch;
    this.dailyDate = dd;
    this.dailyScored = ds;
    this.runLevel = lv;
    return cfg;
  }

  /** Starts preparing the next endless run (after an endless run ends), if none is ready. */
  private startPrebuild(): void {
    if (this.kind !== 'endless' || this.nextRun || this.nextBuild) return;
    this.nextBuild = prepareRun(this.endlessConfigQuiet());
    this.nextBuildRung = this.cfgRung;
    this.nextBuildWarmup = this.cfgWarmup;
  }

  /**
   * The Daily par (Snowbot, CC-17): while no run is being played and today's par is missing, the
   * novice bot plays today's Daily world for at most PAR_MS a frame; the result goes into the save.
   * A new local date restarts it.
   */
  private stepPar(): void {
    const save = this.d.store.get();
    const today = this.today;
    if (!this.d.store.canPersist || !isDailyUnlocked(save) || save.pars[today] !== undefined) {
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
    if (this.nextBuildWarmup) this.warmups.add(this.nextRun);
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
      focusY: (v.oy - (death ? death.y : this.s.nubs.y) * v.S) * dpr,
      callouts: Array.from(calloutBoxes.subarray(0, 4 * calloutsDrawn()), (x) => x * dpr),
      day,
      time: formatTimeOfDay(minute),
      deathLine: result.death.line,
      days,
      forecasts: days.map((_, i) => worldPlan(this.s.world, first + i).forecast),
      daily,
      url: this.sharePayload(result).url ?? '',
      shades: equippedLooks(this.d.store.get().equipped).shades,
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
        this.ui.setPostcard(this.postcardUrl);
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
      this.ui.setPostcard(null);
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
  private sharePostcard(): Promise<ShareOutcome> {
    if (!this.result || this.debugRuns) return Promise.resolve('failed');
    const text = this.sharePayload(this.result).text;
    return this.postcardFile ? shareFiles({ file: this.postcardFile, text }) : shareText({ text });
  }

  private share(): Promise<ShareOutcome> {
    if (!this.result || this.debugRuns) return Promise.resolve('failed');
    return shareText({ text: this.sharePayload(this.result).text });
  }

  /**
   * The finished run's share text and challenge link: the player's name, Snowbot's par on a Daily
   * and whether the world had the Day Plan. No web address (a file: build, a native shell without
   * VITE_SHARE_URL) means no link line.
   */
  private sharePayload(result: RunResult): { text: string; url: string | null } {
    const save = this.d.store.get();
    const par = result.dailyDate !== undefined ? (save.pars[result.dailyDate] ?? null) : null;
    return buildShare(result, shareBase(), this.dailyTry, { name: save.settings.name, par, plan: this.s.world.planOn });
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
   * best on a Daily, else from lifetime run 3 on the recent best at this run's rules (the best of
   * the last 10 runs at its rung, once there are 3; challenges play the standard rules).
   */
  private livePb(): number {
    const save = this.d.store.get();
    if (this.kind === 'campaign') return -1;
    if (this.dailyDate) {
      const st = dailyStatus(save, this.dailyDate);
      return st.bestMinutes > 0 ? st.bestMinutes : -1;
    }
    const recent = this.recentBestOf(this.s);
    return recent > 0 && save.stats.runs >= 3 ? recent : -1;
  }

  /** recentBestAt for the rules `run` is played at (its comfort rung and warm-up; else standard). */
  private recentBestOf(run: SimState): number {
    const rung = this.rungOf.get(run) ?? -1;
    return recentBestAt(this.d.store.get(), rung >= 0 ? rung : COMFORT_MAX, this.warmups.has(run));
  }

  /** The HUD's white tick: the next milestone of endless runs. */
  private liveGoal(): number {
    if (this.kind !== 'endless') return -1;
    return nextMilestone(this.d.store.get()) ?? -1;
  }

  /**
   * The run's stamp (GR8): a challenge stamps 'PASSED SAM!' when its target is reached; an endless
   * run with three runs of history at its rules stamps 'PAST YOUR RECENT BEST' when it beats that,
   * once.
   */
  private armStamp(run: SimState): void {
    this.stampAt = -1;
    const c = this.runChallenge;
    if (run.cfg.mode === 'challenge' && c) {
      const name = c.n ?? '';
      this.stampAt = c.m;
      this.stampKind = 'teal';
      this.stampText = name ? `PASSED ${name.toUpperCase()}!` : 'TARGET PASSED!';
    } else if (run.cfg.mode === 'endless' && this.recentBestOf(run) > 0) {
      // Against runs at the same rules only: a best set on an easier rung isn't this run's bar.
      this.stampAt = this.recentBestOf(run) + 1;
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
      } else if (this.verbNow() !== 'sun') {
        // Elementals v2 (§7.9): no drag ghost or lesson hint while an element plays its own verb; on
        // an intro Trial the ghost plays that verb on its next target until the first verb lands.
        this.hints.stop();
        this.verbGhost();
      } else {
        const dragging = this.input.pointerDown || this.input.keyDown;
        const h = this.hintIn;
        const lessonOn = s.lessonOn;
        h.profile = s.cfg.profile;
        h.f = s.nubs.f;
        h.sunUp = s.sunUp;
        h.now = s.guide.now;
        h.next = s.guide.next;
        h.theta = s.sun.theta;
        h.dragging = dragging;
        // Mirror Sun (concept 'dazzle') turns the sun against the drag, so the hint flips too.
        h.invert = this.input.invert !== s.mods.has('dazzle');
        h.lessonOn = lessonOn;
        if (this.hints.update(dt, h) && !this.debugRuns) {
          this.d.store.update((sv) => {
            sv.flags.hintsShown += 1;
          });
        }
        this.lessonCue();
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

  /** Shows an event cue once per run (never in challenge runs); null clears the cue line. */
  private cue(id: CueId | null, dir?: -1 | 1): void {
    if (id === null) {
      this.cueShown = null;
      this.cueHold = 0;
      this.ui.showCue(null);
      return;
    }
    const bit = id === 'keep-shade' ? 1 : id === 'drag' ? 2 : id === 'shade-found' ? 4 : id === 'melting' ? 8 : id === 'swing' ? 16 : 32;
    if (this.kind === 'challenge' || (this.cues & bit) !== 0) return;
    this.cues |= bit;
    this.cueShown = { id, dir };
    const ms = cueDuration(id, dir);
    this.cueHold = ms === null ? 0 : performance.now() + ms;
    this.ui.showCue(id, dir);
  }

  /**
   * A live cue (the lesson's): shown whenever its words or arrow differ from the line's, as often
   * as needed, but never over an event cue that is still up.
   */
  private liveCue(id: CueId | null, dir?: -1 | 1): void {
    if (this.kind === 'challenge' || performance.now() < this.cueHold) return;
    const cur = this.cueShown;
    if (id === null) {
      if (cur !== null) this.cue(null);
      return;
    }
    if (cur !== null && cur.id === id && cur.dir === dir) return;
    this.cueShown = { id, dir };
    this.ui.showCue(id, dir);
  }

  /**
   * The lesson's cue line says what the ghost hand shows, as it changes: "Drag ← / →" with the
   * hint's arrow; "Melting!" (with the same arrow) only while Nubs is lit with Chill low; "Keep
   * Nubs in the shade" once the hint rests in shade. Nothing arrowed is left behind when the hint
   * or the lesson ends.
   */
  private lessonCue(): void {
    const s = this.s;
    const cur = this.cueShown;
    const arrowed = cur !== null && cur.dir !== undefined;
    if (!s.lessonOn) {
      if (arrowed) this.liveCue(null);
      return;
    }
    const lit = s.nubs.f > 0;
    const melting = this.meltWarn && lit && s.nubs.chill < TUNING.nubs.lowChill;
    if (this.hints.lesson) this.liveCue(melting ? 'melting' : 'drag', this.dragDir());
    else if (melting) this.liveCue('melting');
    else if (arrowed || cur?.id === 'melting') this.liveCue(lit ? null : 'keep-shade');
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
    const comfortChanged = st.comfort !== this.d.store.get().settings.comfort;
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

  /** The Pause card's view of the run in progress (UiCallbacks.runStatus; also the test hook's). */
  runStatus(): RunStatusView | null {
    if (!this.runActive) return null;
    const s = this.s;
    const now = formatScore(s.minutes);
    const level = this.runLevel;
    if (level) {
      const relaxed = this.relaxed();
      const seen = this.featSeen;
      const st = this.liveStats();
      const bits = starState(level, st, s.phase === 'won', relaxed, seen);
      const labels = starRules(level, relaxed);
      // The goal's own count (a finish goal: the progress); an open Dare's count (a finale's names both).
      const goal = hudGoal({ ...level, feats: [] }, st, undefined, relaxed, seen);
      const f = level.feats[0];
      const t = s.trial;
      const x = HEROES[s.nubs.hero];
      const pct = `${Math.round(levelProgress(s) * 100)} %`;
      if (f && !(bits & STAR_FLAKES)) labels[1] = level.feats.length > 1 ? dareProgressText(level, s.stats, seen) : `${labels[1]} · ${countText(featLive(f.kind, s.stats, seen), f.target, featInSeconds(f.kind))}`;
      // A Trial: the Dare's count on its star while open; the goal line counts the goal itself
      // (hudGoal's Trial branch turns to the Dare once the goal is a finish or met).
      if (t && !(bits & STAR_FLAKES)) labels[1] = `${labels[1]} · ${trialDareCount(t, st)}`;
      // …and the Steady star's running low while it is still open (floored: never the threshold when just under it).
      if (t && !(bits & STAR_COOL_LOST)) labels[2] = `${labels[2]} · low ${Math.floor(s.stats.minChill)}`;
      const count = t
        ? level.goal.kind === 'finish'
          ? pct
          : countText(Math.min(goalValue(level, s.stats, seen), goalTarget(level)), goalTarget(level), false)
        : goal.target >= 0
          ? countText(goal.value, goal.target, goal.sec)
          : pct;
      return {
        title: `${levelTag(level.id)} · ${level.name}`,
        // A Trial: the walking element's tagline under the title, then how it plays.
        ...(t ? { tagline: x.tagline, verb: `${x.verbLine} · ${x.keyLine}` } : {}),
        goal: `${goalText(level, relaxed)} · ${count}`,
        now,
        stars: [
          { label: labels[0], state: bits & STAR_GOAL ? 'earned' : 'open' },
          { label: labels[1], state: bits & STAR_FLAKES ? 'earned' : 'open' },
          { label: labels[2], state: bits & STAR_COOL_LOST ? 'lost' : 'open' },
        ],
      };
    }
    const c = this.runChallenge;
    const title = this.kind === 'daily' ? 'Daily Solstice' : this.kind === 'challenge' ? 'Challenge' : 'Endless';
    const goal = c ? `Beat ${c.n ? `${c.n}: ` : ''}${formatScore(c.m)}` : this.runPb > 0 ? `Best: ${formatScore(this.runPb)}` : '';
    return { title, goal, now, stars: [] };
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
      case 'reward':
      case 'rankUp':
      case 'open':
      case 'claim':
        // The reward cues have their own sound and a haptic of the same name.
        a.play(name);
        this.d.haptics.play(name);
        return;
      case 'tick': {
        // Count-ups tick fast: the click every time, the haptic at most every TICK_HAPTIC_MS.
        a.play('tick');
        const t = performance.now();
        if (t - this.tickHapticAt >= TICK_HAPTIC_MS) {
          this.tickHapticAt = t;
          this.d.haptics.play('tick');
        }
        return;
      }
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

  /**
   * Test hook: Nubs melts on the next daylight tick. It touches the sim only through its Chill and
   * the lesson (whose Chill floor would otherwise keep him alive).
   */
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
    s.cfg.lesson = false;
    s.lessonOn = false;
    s.lessonGrace = 0;
    s.nubs.chill = -1e6;
  }

  get active(): boolean {
    return this.runActive;
  }

  /**
   * Test hook state() (CC-15): the sim at a glance plus the run's rules: profile, comfort rung (−1
   * when not an endless ladder run), drain, noon cloud, today's forecast and biome, lesson on;
   * campaign: the level id (−1 none), its concepts, the progress to the finish (0..1) and the
   * concept fields the renderer reads (eclipse, gust, lock, moonlit).
   */
  testState() {
    if (SINGLE) throw new Error('test hook');
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
      warmup: this.runActive ? this.runWarmup : this.warmups.has(s),
      drain: effectiveDrain(s),
      noonCloud: effectiveNoonCloud(s.cfg),
      forecast: s.params.forecast,
      biome: biomeAtY(s.world, s.nubs.y),
      lessonOn: s.lessonOn,
      level: s.cfg.level ?? -1,
      mods: Array.from(s.mods),
      levelProgress: levelProgress(s),
      eclipse: s.eclipse,
      gust: s.sun.gust,
      locked: s.sun.locked,
      moonlit: s.moonlit,
      // Elementals v2 (docs/ELEMENTALS_V2.md §7.11): the walking element, the relay index, the Cold
      // Snap charge, the walker's meter and verb, the sun hold and turn, and the Trial's objects.
      hero: s.nubs.hero,
      relay: s.relayIdx,
      charge: s.nubs.frost,
      meter: s.nubs.chill,
      verb: HEROES[s.nubs.hero].verb,
      sunHeld: s.el !== null && s.sun.locked,
      omega: s.sun.omega,
      el:
        s.el === null
          ? null
          : {
              dx: s.el.dx,
              wind: s.el.wind,
              hold: s.el.hold,
              spent: s.el.spent,
              objs: s.el.objs.map((o) => ({ k: o.kind, x: o.x, y: o.y, state: o.state, size: o.size, grown: o.grown, veiled: veiled(s, o) })),
              burns: s.stats.burns ?? 0,
              drinks: s.stats.drinks ?? 0,
              trees: s.stats.trees ?? 0,
              bumps: s.stats.bumps ?? 0,
            },
    };
  }

  /** Test hook (§7.11): CSS px of a ground point on the last drawn frame. */
  testWorldToScreen(x: number, y: number): { x: number; y: number } {
    if (SINGLE) throw new Error('test hook');
    const v = this.renderer.scene.view;
    return { x: v.ox + x * v.S, y: v.oy - y * v.S };
  }

  /**
   * Test hook (§7.11): fast-forwards the Trial headless with the core reactive bot until relayIdx is
   * `i` (its events routed as in play), then hands back to the input.
   */
  testSkipToLeg(i: number): void {
    if (SINGLE) throw new Error('test hook');
    const s = this.s;
    const bot = makeBot('reactive');
    if (!bot || s.el === null) return;
    for (let n = 0; n < 60_000 && s.relayIdx < i && s.phase !== 'dead' && s.phase !== 'won'; n++) {
      step(s, bot.next(s));
      for (const ev of s.events) this.onTickEvent(ev);
    }
    this.input.releaseAll();
    // The bot's last frame may leave the sun mid-drag (no lift reaches the sim): a tap at 0 °/s ends it.
    if (s.sun.mode === 'dragging') this.input.tap();
    takeSnap(s, this.prev);
    takeSnap(s, this.curr);
  }

  /** Test hook: sets the run's Snow (HUD layout checks with long numbers). */
  testSetSnow(n: number): void {
    if (Number.isFinite(n) && n >= 0) this.s.stats.snow = Math.floor(n);
  }

  /** Test hook: the config of the current run (the Title's held run between runs). */
  runCfg(): { mode: string; profile: number; tutorial: boolean; reducedMotion: boolean; seed: number; dailyDate: string | null; drain: number } {
    if (SINGLE) throw new Error('test hook');
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
    this.bot = kind ? makeBot(kind) : this.params.bot ? makeBot(this.params.bot) : null;
  }

  /**
   * Test hook (A/B checks): draws the current frame (time frozen) under render options `a` and then
   * `b`, and compares the device pixels: the mean per-pixel max-channel |Δ|, the share of pixels
   * more than 3 and 8 levels apart, and the largest |Δ|. The next frame draws as usual.
   */
  pixelAB(a: Partial<RenderOptions>, b: Partial<RenderOptions>): PixelAB | null {
    if (SINGLE) throw new Error('test hook');
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
    if (SINGLE) throw new Error('test hook');
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
        const v = rr.scene.view;
        const dpr = v.dpr;
        const cutRow = Math.floor(sheetTop * dpr);
        const w = canvas.width;
        // Only whole device pixels of the world rect: at a fractional DPR the backing store's last
        // column and row are part-covered, and their blend with the page colour isn't the overlay's.
        const xEnd = Math.floor((v.vx + v.vw) * dpr);
        const yEnd = Math.floor((v.vy + v.vh) * dpr);
        let above = 0;
        let below = 0;
        /** Device-px box of the differences below the cut (x0, y0, x1, y1), for diagnostics. */
        const box = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i < a.length; i += 4) {
          if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
          const px = i >> 2;
          const y = Math.floor(px / w);
          const x = px - y * w;
          if (x >= xEnd || y >= yEnd) continue;
          if (y < cutRow) {
            above++;
            continue;
          }
          below++;
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
    if (SINGLE) throw new Error('test hook');
    const h = this.hints;
    return { mode: this.ghost, target: h.target, width: h.targetW, turn: h.turn, lesson: h.lesson, shown: h.shown };
  }

  /**
   * Test hook: replays a moment through fx and audio only (the sim is untouched): phew, mult, mult5,
   * noon (= highnoon), dawn, night, cloud, glare, flake, best, passed, swing, postcard; v1.5 bud,
   * bloom, snapReady, snap and deep stage their objects in the run's world (game/mechanics.ts).
   */
  demo(name: string): void {
    if (SINGLE) throw new Error('test hook');
    const s = this.s;
    // v1.5: bud, bloom, snapReady, snap, deep (game/mechanics.ts).
    if (this.mech.demo(name, s, this.snap, this.time)) return;
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
        const name = this.runChallenge?.n ?? '';
        this.fx.celebrate('teal', name ? `PASSED ${name.toUpperCase()}!` : 'TARGET PASSED!');
        return;
      }
      case 'postcard':
        // What the Postcard pill does (no user activation here: the download path in Chromium).
        void this.sharePostcard();
        return;
      case 'finish':
        this.fx.finish(true, 'FINISH', 2, s.nubs.x, s.nubs.y);
        return;
      case 'dare':
      case 'dares': {
        // v1.6 Dares on the level being played (render and UI only): one Dare (Bloom 2, one
        // bloomed so far) or a finale's two.
        const lv = this.runLevel;
        if (!lv) return;
        this.runLevel = { ...lv, feats: name === 'dare' ? [{ kind: 'blooms', target: 2 }] : [{ kind: 'blooms', target: 2 }, { kind: 'parry', target: 3 }] };
        this.featSeen.set('blooms', 1);
        if (s.phase === 'hold') showLevelCard(this.renderer.scene.banners, introCard(this.runLevel, this.relaxed()), lv.biome);
        return;
      }
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
