// Internal contracts between the UI controller (ui.ts) and its screens.

import type { SaveV1, Settings } from '../meta/saveTypes.ts';
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
  save(): SaveV1;
  today(): string;
  challenge(): ChallengeBanner | null;
  /** Clears the challenge banner locally (the integrator is told through cb.dismissChallenge). */
  clearChallenge(): void;
  go<K extends ScreenId>(id: K, ...args: ScreenArgs<K>): void;
  back(): void;
  toast(text: string, options?: ToastOptions): void;
  sound(name: UiSoundName): void;
  reducedMotion(): boolean;
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
  /** Escape / back button on this screen. Defaults to nothing. */
  back?(): void;
  /** Enter/Space that no focused control consumed. Return true when handled. */
  activate?(): boolean;
  /** Where keyboard focus lands when the screen opens. */
  initialFocus?(): HTMLElement | null;
}

export type ScreenFactory = (ctx: UiContext) => Screen;
