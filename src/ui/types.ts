// Public types of the UI controller. See src/ui/README.md for how the game session drives it.

import type { DayPlan, RunResult } from '../core/index.ts';
import type { Save, Settings } from '../meta/saveTypes.ts';
import type { CosmeticId, Equipped } from '../meta/content.ts';
import type { RunOutcome, ToastIcon, ToastTone } from '../meta/progression.ts';
import type { ShareOutcome } from '../platform/share.ts';

export type ScreenId =
  | 'boot'
  | 'title'
  | 'play'
  | 'pause'
  | 'dying'
  | 'results'
  | 'settings'
  | 'daily'
  | 'missions'
  | 'wardrobe'
  | 'journal'
  | 'journey';

/**
 * The plain-language cue line above Nubs (ui.showCue):
 * - `keep-shade`: "Keep Nubs in the shade" (2 s).
 * - `drag`: "Drag ← to swing the sun" (or "Hold ←" for keyboard players) until replaced or cleared.
 * - `shade-found`: "Shade! Thick teal = safe" (1.4 s). `melting`: "Melting! Find thick teal" (1.6 s).
 */
export type CueId = 'keep-shade' | 'drag' | 'shade-found' | 'melting' | 'swing';

export type RunKind = 'endless' | 'daily' | 'challenge' | 'campaign';

/** Short UI sounds the audio layer should provide (all may map to the GDD "UI tap" recipe). */
export type UiSoundName =
  | 'tap'
  | 'back'
  | 'toggle'
  | 'slide'
  | 'buy'
  | 'equip'
  | 'deny'
  | 'stamp'
  | 'unlock'
  | 'count';

/** Data for the Results sheet. */
export interface ResultsView {
  result: RunResult;
  /** From meta/progression applyRunResult. */
  outcome: RunOutcome;
  /** Daily runs: the counted try (1-3), or null when the run wasn't counted. */
  dailyTry?: number | null;
  /** Daily runs (and k:'d' challenges): the Daily's date ('YYYY-MM-DD'). */
  dailyDate?: string;
  /**
   * Daily runs: the run was eligible to count (its date was today and fewer than 3 tries were used
   * when it started). With dailyTry null it melted before 6:30 AM ("Not counted"); false = practice.
   */
  dailyScored?: boolean;
  /** Challenge runs: the target score in in-game minutes. */
  challengeTarget?: number;
  /** Challenge runs: the sender's name ('' or absent = "a friend"). */
  challengeName?: string;
  /** A run started with sim-altering debug URL params: not scored, saved or shareable. */
  debug?: boolean;
  /** The death recap line under the death line (core deathTip). */
  tip?: string;
  /**
   * This run was the warm-up before a challenge: Results show "Now beat {name}: {score}" and Retry
   * reads "Take the challenge" (the session's retry() then starts the challenge).
   */
  warmupFor?: { minutes: number; name: string };
  /**
   * Journey runs (docs/CAMPAIGN_PLAN.md §5): the level, whether its goal was met, the stars earned
   * (0-3), the next level to play (null after the last), the goal line ("Reach the finish with 8
   * flakes · 9 collected") and the concept the level introduced, if any (not shown: the level's
   * intro card teaches it). The sheet then makes the stars its hero, shows the level name in place
   * of the time and the next star reward, and offers Next level / Retry / Map instead of Home.
   */
  campaign?: ResultsCampaign;
}

export interface ResultsCampaign {
  id: number;
  name: string;
  passed: boolean;
  stars: number;
  nextId: number | null;
  goalLine: string;
  introduces?: { name: string; blurb: string };
}

/** Title banner shown when the page was opened from a challenge link. */
export interface ChallengeBanner {
  /** Target score in in-game minutes ("Beat Day 2 · 2:40 PM"). */
  minutes: number;
  /** Optional second line, e.g. "Daily #280 · practice run". */
  note?: string;
  /** The sender's name ('' or absent = "A friend"). */
  name?: string;
  /** A fresh save plays the tutorial run first: the note reads "Warm-up run first". */
  warmup?: boolean;
}

/** Ghost-thumb hint: a looping left-right swipe (Title) or a one-way swipe (in-play hint). */
export type GhostMode = 'off' | 'both' | 'left' | 'right';

export interface ToastOptions {
  icon?: ToastIcon;
  tone?: ToastTone;
  /** Milliseconds on screen (default 2500). */
  duration?: number;
}

export type ImportOutcome = { ok: true } | { ok: false; message: string };

/**
 * Everything the UI asks of the game. The UI owns screen state: for intents that change screens
 * (pause, resume, retry, home, startRun…) it has already switched screens when the callback runs.
 */
export interface UiCallbacks {
  /**
   * Start a run. 'endless' from Space/Enter on the Title; 'challenge' from the banner's Play (or
   * Space/Enter while the banner is up); 'daily' from the Daily screen with the date it shows (the
   * UI has checked it is still today); 'campaign' from a Journey tile with its level id. The UI is
   * already on 'play'.
   */
  startRun(kind: RunKind, date?: string, level?: number): void;
  /** Results > Next level on a passed Journey level: start `campaign.nextId`. The UI is already on 'play'. */
  nextLevel(): void;
  /**
   * Results > Map (or Back) on a Journey run, and the Title's Journey pill: leave the run for the
   * Title scene behind the map. The UI is already on 'journey'.
   */
  openJourney(): void;
  /** Results: Retry button, Space/Enter, or a tap on the map above the sheet. The UI is already on 'play'. */
  retry(): void;
  /** Back to the Title (Pause > Home, Results > Home). The UI is already on 'title'. */
  home(): void;
  /** Pause button, Escape/P, or the rotate overlay appearing mid-run. The UI is already on 'pause'. */
  pause(): void;
  /** The UI is already on 'play'. Call ensureAudio() synchronously in here (iOS resume rule). */
  resume(): void;
  /** Pause > Restart: abandon this run and start a new one. The UI is already on 'play'. */
  restart(): void;
  /** A tap during the death animation: jump to Results (call ui.show('results', view)). */
  skipDying(): void;
  /**
   * Results > Share: build the text (meta/share buildShare) and hand it to platform/share shareText
   * ('shared', 'copied', 'cancelled' or 'failed').
   */
  share(): Promise<ShareOutcome>;
  /**
   * Results > Postcard: the postcard PNG plus the share text through platform/share shareFiles
   * ('saved' = downloaded and the text copied). Call shareFiles synchronously (iOS user activation).
   */
  sharePostcard(): Promise<ShareOutcome>;
  /** Missions or Results > Swap on a stale mission: apply meta swapMission, then ui.setSave. */
  swapMission(slotId: string): void;
  /** Any Settings change, with the full new settings. Persist and apply (volumes, sensitivity…). */
  settingsChanged(settings: Settings): void;
  /** Wardrobe purchase; return true on success (then push the new save with ui.setSave). */
  buy(id: CosmeticId): boolean;
  /** Wardrobe equip of an owned item (then push the new save with ui.setSave). */
  equip(id: CosmeticId): void;
  /** Settings > Progress: the current save as a backup code (meta/backup exportBackup). */
  exportBackup(): string;
  /** Settings > Restore: validate and apply a pasted code (meta/backup importBackup). */
  importBackup(code: string): ImportOutcome;
  /**
   * Settings > Reset progress, after the player confirmed (meta/progression resetProgress). Returns
   * { ok: false, message } when nothing could be reset (a newer version's save is on disk).
   */
  resetProgress(): ImportOutcome;
  /** The challenge banner was dismissed (clear the #c= hash and the challenge). */
  dismissChallenge(): void;
  /**
   * A drag that began on a Title tray button and moved sideways more than 10 px: treat it as a
   * canvas drag starting at this event (start the run with catch semantics, then follow this
   * pointerId). The button has released pointer capture, so later moves reach the canvas/window.
   */
  dragHandoff(e: PointerEvent): void;
  /** Play a short UI sound (and the 4 ms "UI button" haptic if enabled). */
  uiSound(name: UiSoundName): void;
  /**
   * Draw the Wardrobe preview: Nubs wearing `equipped` ('nubs'), or the sun in its shades on the
   * Shades tab ('sun'). The backing store is already sized to its CSS box × devicePixelRatio (max 2).
   * Called whenever the try-on selection or the tab changes.
   */
  renderWardrobePreview(canvas: HTMLCanvasElement, equipped: Equipped, subject: 'nubs' | 'sun'): void;
}

export interface UiDeps {
  callbacks: UiCallbacks;
  save: Save;
  /** Local date 'YYYY-MM-DD' (meta/daily localDate()). */
  today: string;
  /** Shown at the bottom of Settings, e.g. "0.1.0 (a1b2c3d)". */
  version: string;
}

/** Arguments of `show` per screen: only Results takes data. */
export type ScreenArgs<K extends ScreenId> = K extends 'results' ? [view: ResultsView] : [];

export interface Ui {
  /** Switches screens (legal transitions only: illegal ones throw in dev and are ignored in prod). */
  show<K extends ScreenId>(id: K, ...args: ScreenArgs<K>): void;
  current(): ScreenId;
  /**
   * Escape / Android back: dismiss an open modal first; otherwise the screen's back action (play →
   * pause, pause → resume, menus → their parent, results → home, dying → skip, settings → origin).
   */
  back(): void;
  /** True while a modal (confirm dialog, install or restore sheet) is open. */
  isModalOpen(): boolean;
  /** Pushes a new save; every screen re-renders from it. */
  setSave(save: Save): void;
  /**
   * Updates the local date (call when the date rolls over while the app is open). Re-renders the
   * Daily screen, the Title's Daily dot and the 14-day history.
   */
  setToday(date: string): void;
  setChallenge(banner: ChallengeBanner | null): void;
  /** The Title run's Day-1 plan for the forecast chip; null for runs without a Day Plan (chip hidden). */
  setRunPreview(p: DayPlan | null): void;
  /**
   * Shows a cue above Nubs (`dir` = the finger direction for 'drag': −1 ←, +1 →); null clears it.
   * Timed cues clear themselves; 'drag' stays until replaced or cleared.
   */
  showCue(id: CueId | null, dir?: -1 | 1): void;
  /** The Results postcard's thumbnail (an object URL of the ready PNG), or null while it is built. */
  setPostcard(thumbUrl: string | null): void;
  setGhostThumb(mode: GhostMode): void;
  /**
   * Progress (0..1) through the current loop of the ghost hand's swipe animation, so the canvas can
   * move the sun in step with it; −1 while the hand is hidden or not sliding (reduced motion).
   */
  ghostProgress(): number;
  /** Shows the small muted indicator in play while audio isn't running. */
  setAudioMuted(muted: boolean): void;
  toast(text: string, options?: ToastOptions): void;
  /** iOS "Add to Home Screen" instructions (see progression shouldShowInstallSheet). No-op in in-app browsers. */
  showInstallSheet(): void;
  /** One-time "Progress can't be saved in this browser mode" toast (no-op after the first call). */
  notifyStorageDegraded(): void;
  /**
   * The Results sheet's resting top edge in viewport CSS px (slide-in transforms excluded), or null
   * when Results isn't shown. Frame the Melt Map above it. Cached (ResizeObserver on the sheet and
   * the screen): reading it every frame costs no layout.
   */
  resultsSheetTop(): number | null;
  /** True while the rotate overlay covers the game (phone held landscape). */
  isRotateBlocking(): boolean;
  destroy(): void;
}
