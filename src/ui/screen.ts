// Internal contracts between the UI controller (ui.ts) and its screens.

import type { Save, Settings } from '../meta/saveTypes.ts';
import type { ChallengeBanner, ScreenArgs, ScreenId, ToastOptions, UiCallbacks, UiSoundName } from './types.ts';

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
}

/** What every screen can see and do. */
export interface UiContext {
  readonly cb: UiCallbacks;
  readonly version: string;
  save(): Save;
  today(): string;
  /** Sets the local date and re-renders the date-dependent screens (Daily, the Title's Daily dot). */
  setToday(date: string): void;
  challenge(): ChallengeBanner | null;
  /** Clears the challenge banner locally (the integrator is told through cb.dismissChallenge). */
  clearChallenge(): void;
  go<K extends ScreenId>(id: K, ...args: ScreenArgs<K>): void;
  back(): void;
  toast(text: string, options?: ToastOptions): void;
  /** Says `text` through the polite live region (screen readers only). */
  announce(text: string): void;
  sound(name: UiSoundName): void;
  reducedMotion(): boolean;
  /** The last input came from a keyboard (focus follows screens; key hints show). */
  keyboardMode(): boolean;
  /** A CSS length published on the UI root (e.g. '--nubs-y'), in px, or null when unset. */
  rootPx(name: string): number | null;
  /** Applies a settings change locally (motion) and reports it through cb.settingsChanged. */
  changeSettings(settings: Settings): void;
  confirm(options: ConfirmOptions): Promise<boolean>;
}

export interface Screen {
  readonly el: HTMLElement;
  /** Called before the screen becomes visible (and again when re-shown with new data). */
  enter(from: ScreenId, data?: unknown): void;
  /** Called after the screen is hidden: stop timers here. */
  leave?(): void;
  /** The save, date or challenge changed. */
  refresh?(): void;
  /** The viewport or the world column changed size (re-fit layouts that measure). */
  relayout?(): void;
  /** Escape / back button on this screen. Defaults to nothing. */
  back?(): void;
  /** Enter/Space that no focused control consumed. Return true when handled. */
  activate?(): boolean;
  /** Where keyboard focus lands when the screen opens. */
  initialFocus?(): HTMLElement | null;
}

export type ScreenFactory = (ctx: UiContext) => Screen;
