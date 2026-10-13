// Reusable UI pieces: buttons, switches, segmented controls, sliders, chips, progress bars, headers,
// the star road.

import { nextStarGoal } from '../meta/progression.ts';
import type { Save } from '../meta/saveTypes.ts';
import { h, setFlag } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import { cosmeticSwatch } from './swatches.ts';
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

/**
 * Counts `el`'s number from `from` up to `to` (ease-out, `ms` long, a soft tick on the way and the
 * `end` sound at the end); instant under reduced motion or when nothing changes. Returns a stop.
 */
export function countUp(
  el: HTMLElement,
  from: number,
  to: number,
  ctx: UiContext,
  o: { ms?: number; format?: (n: number) => string; end?: UiSoundName | null } = {},
): () => void {
  const format = o.format ?? String;
  if (ctx.reducedMotion() || from === to) {
    el.textContent = format(to);
    return () => {};
  }
  const ms = o.ms ?? 700;
  const start = performance.now();
  let frame = 0;
  let ticks = 0;
  const step = (now: number): void => {
    const k = Math.min(1, (now - start) / ms);
    el.textContent = format(Math.round(from + (to - from) * (1 - (1 - k) * (1 - k) * (1 - k))));
    // A tick every ~120 ms while counting.
    if (Math.floor((k * ms) / 120) > ticks && k < 1) {
      ticks += 1;
      ctx.sound('tick');
    }
    if (k < 1) frame = requestAnimationFrame(step);
    else if (o.end !== null) ctx.sound(o.end ?? 'count');
  };
  el.textContent = format(from);
  frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
    el.textContent = format(to);
  };
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

/**
 * The progress to the next Journey star reward: its item, "Starry Scarf at 25 stars", the count and
 * a bar (the Journey map and a level's Results). Hidden once every reward is earned.
 */
export function starRoad(): { el: HTMLElement; update(save: Save): void } {
  const art = h('span', { class: 'road-art', 'aria-hidden': 'true' });
  const name = h('strong', null);
  const target = h('span', null);
  const count = h('span', { class: 'road-count num' });
  const bar = progressBar(0);
  const el = h('p', { class: 'road' }, art, h('span', { class: 'road-text' }, name, target), count, bar);
  return {
    el,
    update(save) {
      const g = nextStarGoal(save);
      hide(el, g === null);
      if (!g) return;
      art.replaceChildren(g.item ? cosmeticSwatch(g.item) : icon('star'));
      name.textContent = g.item?.name ?? g.name;
      target.textContent = ` at ${g.target} stars`;
      count.textContent = `${g.stars}/${g.target}`;
      (bar.firstElementChild as HTMLElement).style.width = `${Math.round(((g.stars - g.from) / (g.target - g.from)) * 100)}%`;
    },
  };
}
