// Reusable UI pieces: buttons, switches, segmented controls, sliders, chips, progress bars, headers.

import { h, setFlag } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import type { UiContext } from './screen.ts';
import type { UiSoundName } from './types.ts';

export interface ButtonOptions {
  /** Visible text; for `round` buttons it becomes the aria-label. */
  label: string;
  icon?: IconName;
  variant?: 'primary' | 'gold' | 'danger' | 'plain';
  size?: 'md' | 'lg' | 'xl';
  block?: boolean;
  /** Icon-only circular 48 px button. */
  round?: boolean;
  /** Overrides the accessible name (defaults to `label`). */
  ariaLabel?: string;
  sound?: UiSoundName | null;
  className?: string;
  onPress: () => void;
}

export function button(ctx: UiContext, o: ButtonOptions): HTMLButtonElement {
  const cls = [
    'btn',
    `btn--${o.variant ?? 'plain'}`,
    o.size && o.size !== 'md' ? `btn--${o.size}` : '',
    o.block ? 'btn--block' : '',
    o.round ? 'btn--round' : '',
    o.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const el = h(
    'button',
    { class: cls, type: 'button', 'aria-label': o.round ? (o.ariaLabel ?? o.label) : (o.ariaLabel ?? null) },
    o.icon ? icon(o.icon) : null,
    o.round ? null : h('span', { class: 'btn-label' }, o.label),
  );
  el.addEventListener('click', () => {
    if (el.getAttribute('aria-disabled') === 'true') return;
    if (o.sound !== null) ctx.sound(o.sound ?? 'tap');
    o.onPress();
  });
  return el;
}

/** Sets the visible label of a button made by `button()`. */
export function setButtonLabel(el: HTMLButtonElement, label: string): void {
  const span = el.querySelector('.btn-label');
  if (span) span.textContent = label;
}

/** Disables a button while keeping it focusable and announced (aria-disabled). */
export function setDisabled(el: HTMLElement, disabled: boolean): void {
  el.setAttribute('aria-disabled', String(disabled));
}

export interface SwitchControl {
  el: HTMLButtonElement;
  set(on: boolean): void;
}

export function toggleSwitch(ctx: UiContext, label: string, onChange: (on: boolean) => void): SwitchControl {
  const el = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': label },
    h('span', { class: 'switch-knob' }));
  const set = (on: boolean): void => el.setAttribute('aria-checked', String(on));
  el.addEventListener('click', () => {
    const on = el.getAttribute('aria-checked') !== 'true';
    set(on);
    ctx.sound('toggle');
    onChange(on);
  });
  return { el, set };
}

export interface SegmentedControl<T extends string> {
  el: HTMLElement;
  set(value: T): void;
}

export function segmented<T extends string>(
  ctx: UiContext,
  label: string,
  options: readonly { value: T; label: string }[],
  onChange: (value: T) => void,
): SegmentedControl<T> {
  const el = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const buttons = options.map((opt) => {
    const b = h('button', { class: 'seg-opt', type: 'button', role: 'radio', 'aria-checked': 'false' }, opt.label);
    b.addEventListener('click', () => {
      set(opt.value);
      ctx.sound('toggle');
      onChange(opt.value);
    });
    el.append(b);
    return b;
  });
  // Arrow keys move between options, as radio groups do.
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = buttons.findIndex((b) => b === document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length] as HTMLButtonElement;
    next.focus();
    next.click();
  });
  const set = (value: T): void => {
    options.forEach((opt, i) => {
      const b = buttons[i] as HTMLButtonElement;
      const on = opt.value === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  };
  return { el, set };
}

export interface SliderControl {
  el: HTMLElement;
  set(value: number): void;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  /** Live, on every input event. */
  onInput: (value: number) => void;
  /** When the thumb is released. */
  onCommit?: (value: number) => void;
}

export function slider(o: SliderOptions): SliderControl {
  const input = h('input', {
    class: 'range',
    type: 'range',
    min: o.min,
    max: o.max,
    step: o.step,
    'aria-label': o.label,
  });
  const out = h('output', { class: 'range-value' });
  const paint = (v: number): void => {
    out.textContent = o.format(v);
    input.setAttribute('aria-valuetext', o.format(v));
    input.style.setProperty('--fill', `${((v - o.min) / (o.max - o.min)) * 100}%`);
  };
  input.addEventListener('input', () => {
    const v = Number(input.value);
    paint(v);
    o.onInput(v);
  });
  input.addEventListener('change', () => o.onCommit?.(Number(input.value)));
  const set = (v: number): void => {
    input.value = String(v);
    paint(v);
  };
  return { el: h('div', { class: 'range-wrap' }, input, out), set };
}

/** Snowflake + amount chip, e.g. the wallet. Give it an aria-label such as "230 Snow". */
export function snowChip(value: string): HTMLElement {
  return h('span', { class: 'chip chip--snow', role: 'img' }, icon('snow'), h('span', { class: 'num' }, value));
}

/** A thin progress bar; `fraction` in [0, 1]. */
export function progressBar(fraction: number, className = 'bar'): HTMLElement {
  const fill = h('i');
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  return h('span', { class: className, 'aria-hidden': 'true' }, fill);
}

/** Header for full-screen menus: back button, title, optional right-hand slot. */
export function menuHeader(ctx: UiContext, title: string, right?: HTMLElement): HTMLElement {
  const back = button(ctx, { label: 'Back', icon: 'back', round: true, sound: 'back', onPress: () => ctx.back() });
  back.classList.add('menu-back');
  return h('header', { class: 'menu-head' }, back, h('h2', { class: 'menu-title' }, title), right ?? h('span', { class: 'menu-spacer' }));
}

/** A labeled settings/menu section card. */
export function section(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return h('section', { class: 'card' }, h('h3', { class: 'card-title' }, title), ...children);
}

export function hide(el: HTMLElement, hidden: boolean): void {
  setFlag(el, 'hidden', hidden);
}
