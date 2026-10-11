// Public types of the UI controller. See src/ui/README.md for how the game session drives it.

import type { RunResult } from '../core/sim/events.ts';
import type { SaveV1, Settings } from '../meta/saveTypes.ts';
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
  | 'wardrobe';

export type RunKind = 'endless' | 'daily' | 'challenge';

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
  /** Daily runs: the counted try (1-3), or null for practice. */
  dailyTry?: number | null;
  /** Challenge runs: the target score in in-game minutes. */
  challengeTarget?: number;
}

/** Title banner shown when the page was opened from a challenge link. */
export interface ChallengeBanner {
  /** Target score in in-game minutes ("Beat Day 2 · 2:40 PM"). */
  minutes: number;
  /** Optional second line, e.g. "Daily #280 · practice run". */
  note?: string;
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
  /** Start a run. 'endless' from Space/Enter on the Title, 'daily' from the Daily screen, 'challenge' from the banner. The UI is already on 'play'. */
  startRun(kind: RunKind): void;
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
  /** Results > Share: build the text (meta/share buildShare) and hand it to platform/share. */
  share(): Promise<ShareOutcome>;
  /** Any Settings change, with the full new settings. Persist and apply (volumes, sensitivity…). */
  settingsChanged(settings: Settings): void;
  /** Wardrobe purchase; return true on success (then push the new save with ui.setSave). */
  buy(id: CosmeticId): boolean;
  /** Wardrobe equip of an owned item (then push the new save with ui.setSave). */
  equip(id: CosmeticId): void;
  /** Settings > Backup: the current save as a backup code (meta/backup exportBackup). */
  exportBackup(): string;
  /** Settings > Restore: validate and apply a pasted code (meta/backup importBackup). */
  importBackup(code: string): ImportOutcome;
  /** Settings > Reset progress, after the player confirmed (meta/progression resetProgress). */
  resetProgress(): void;
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
   * Draw Nubs wearing `equipped` into the Wardrobe preview canvas. The backing store is already
   * sized to its CSS box × devicePixelRatio (max 2). Called whenever the try-on selection changes.
   */
  renderWardrobePreview(canvas: HTMLCanvasElement, equipped: Equipped): void;
}

export interface UiDeps {
  callbacks: UiCallbacks;
  save: SaveV1;
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
  /** Escape / Android back: the screen's back action (pause in play, resume in pause, close menus…). */
  back(): void;
  /** Pushes a new save; every screen re-renders from it. */
  setSave(save: SaveV1): void;
  /** Updates the local date (call when the date rolls over while the app is open). */
  setToday(date: string): void;
  setChallenge(banner: ChallengeBanner | null): void;
  setGhostThumb(mode: GhostMode): void;
  /** Shows the small muted indicator in play while audio isn't running. */
  setAudioMuted(muted: boolean): void;
  toast(text: string, options?: ToastOptions): void;
  /** iOS "Add to Home Screen" instructions (see progression shouldShowInstallSheet). */
  showInstallSheet(): void;
  /** One-time "Progress can't be saved in this browser mode" toast (no-op after the first call). */
  notifyStorageDegraded(): void;
  /** Top edge (CSS px from the viewport top) of the Results sheet, or null when Results isn't shown. Frame the Melt Map above it. */
  resultsSheetTop(): number | null;
  /** True while the rotate overlay covers the game (phone held landscape). */
  isRotateBlocking(): boolean;
  destroy(): void;
}
