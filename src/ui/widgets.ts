// Reusable UI pieces: buttons, switches, segmented controls, sliders, chips, progress bars, ribbons,
// headers, the star road. Their look is the kit's (kit.css, docs/UI_V2.md §6).

import { nextStarGoal } from '../meta/progression.ts';
import type { Save } from '../meta/saveTypes.ts';
import { artIcon, hasArt, kitShape } from './art-icons.ts';
import { h, setFlag } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import { cosmeticSwatch } from './swatches.ts';
import type { UiContext } from './screen.ts';
import type { UiSoundName } from './types.ts';

/** The candy face: green go, blue navigate, violet endless/XP, pink share/dares, gold rewards, red danger, cloud (plain) neutral. */
export type ButtonVariant = 'primary' | 'gold' | 'danger' | 'plain' | 'blue' | 'violet' | 'pink';

export interface ButtonOptions {
  /** Visible text; for `round` and `square` buttons it becomes the aria-label. */
  label: string;
  /** On a coloured face the art icon of that name is used when there is one (art-icons.ts); cloud faces keep the line icon in ink. */
  icon?: IconName;
  variant?: ButtonVariant;
  /** Heights: sm 48, md 56 (default), lg 64, xl 72. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  block?: boolean;
  /** Icon-only circular coin (48 px; .menu-back and Home are 50). */
  round?: boolean;
  /** Icon-only square of the size's height. */
  square?: boolean;
  /** Overrides the accessible name (defaults to `label`). */
  ariaLabel?: string;
  sound?: UiSoundName | null;
  className?: string;
  onPress: () => void;
}

/** The button's icon: the art icon on coloured faces, the ink line icon on cloud ones (§6.17). */
export function buttonIcon(name: IconName, variant: ButtonVariant = 'plain'): SVGSVGElement {
  return variant !== 'plain' && hasArt(name) ? artIcon(name) : icon(name);
}

export function button(ctx: UiContext, o: ButtonOptions): HTMLButtonElement {
  const variant = o.variant ?? 'plain';
  const iconOnly = o.round === true || o.square === true;
  const cls = [
    'btn',
    `btn--${variant}`,
    o.size && o.size !== 'md' ? `btn--${o.size}` : '',
    o.block ? 'btn--block' : '',
    o.round ? 'btn--round' : '',
    o.square ? 'btn--sq' : '',
    o.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const el = h(
    'button',
    { class: cls, type: 'button', 'aria-label': iconOnly ? (o.ariaLabel ?? o.label) : (o.ariaLabel ?? null) },
    o.icon ? buttonIcon(o.icon, variant) : null,
    iconOnly ? null : h('span', 'btn-label', o.label),
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
    h('span', 'switch-knob'));
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
  const out = h('output', 'range-value');
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
  return { el: h('div', 'range-wrap', input, out), set };
}

/** The Snow counter (the wallet): an embossed slot with the ice-gem coin. Give it an aria-label such as "230 Snow". */
export function snowChip(value: string): HTMLElement {
  return h('span', { class: 'chip chip--snow', role: 'img' }, artIcon('snow'), h('span', 'num', value));
}

/** Sets a counter's number with room for its widest value (Lilita has no tabular figures, §2.4). */
export function setCount(num: HTMLElement, text: string, widest = text): void {
  num.textContent = text;
  num.style.minWidth = `${widest.length + 0.5}ch`;
}

export type RibbonTone = 'red' | 'blue' | 'green' | 'violet' | 'pink';

export interface Ribbon {
  /** The wrapper: the band and its two tails. */
  el: HTMLElement;
  /** The band: the heading element itself (set its textContent to change the words). */
  band: HTMLElement;
}

/**
 * A ribbon banner (§6.4): a band between two swallowtails. The band is the heading (`tag`, h2 by
 * default) unless the ribbon only repeats one (then pass `hidden` and it is aria-hidden).
 */
export function ribbon(
  text: string,
  o: { tone?: RibbonTone; size?: 'sm' | 'md'; tag?: 'h1' | 'h2' | 'h3' | 'p' | 'span'; className?: string; bandClass?: string; id?: string; hidden?: boolean } = {},
): Ribbon {
  const band = h(o.tag ?? 'h2', { class: `ribbon-band${o.bandClass ? ` ${o.bandClass}` : ''}`, id: o.id ?? null }, text);
  const cls = ['ribbon', `ribbon--${o.tone ?? 'red'}`, o.size === 'sm' ? 'ribbon--sm' : '', o.className ?? ''].filter(Boolean).join(' ');
  const el = h('div', { class: cls, 'aria-hidden': o.hidden ? 'true' : null },
    kitShape('tail', 'ribbon-tail ribbon-tail--l'), band, kitShape('tail', 'ribbon-tail ribbon-tail--r'));
  return { el, band };
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

/** The steps a ribbon takes to fit its words (kit.css .ribbon.fit-N): smaller type, then no tails, then smaller still. */
const RIBBON_FIT = ['fit-1', 'fit-2', 'fit-3', 'fit-4'] as const;

/**
 * Shrinks a ribbon until its words fit on one line (§6.4: the band shrinks before it may ellipsize,
 * and it never wraps). Reads layout: call it when the ribbon's room may have changed (a screen
 * shown, a resize, the display font arriving), never per frame.
 */
export function fitRibbon(el: HTMLElement): void {
  const band = el.querySelector<HTMLElement>('.ribbon-band');
  if (!band) return;
  el.classList.remove(...RIBBON_FIT);
  for (const step of RIBBON_FIT) {
    if (band.scrollWidth <= band.clientWidth + 1) return;
    el.classList.remove(...RIBBON_FIT);
    el.classList.add(step);
  }
}

export type BarTone = 'gold' | 'green' | 'blue' | 'violet';

/**
 * A progress bar in the embossed slot (§6.8); `fraction` in [0, 1]. Tones: XP violet; stars and star
 * rewards gold (the default); missions and level progress green; frost and sliders blue. Add
 * `bar--sm` to `className` for the compact 16 px bar.
 */
export function progressBar(fraction: number, className = 'bar', tone?: BarTone): HTMLElement {
  const fill = h('i');
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  const cls = tone && tone !== 'gold' ? `${className} bar--${tone}` : className;
  return h('span', { class: cls, deco: true }, fill);
}

/** Header for full-screen menus: the blue back coin, the title as a red ribbon, an optional right-hand slot. */
export function menuHeader(ctx: UiContext, title: string, right?: HTMLElement): HTMLElement {
  const back = button(ctx, { label: 'Back', icon: 'back', variant: 'blue', round: true, sound: 'back', onPress: () => ctx.back() });
  back.classList.add('menu-back');
  const r = ribbon(title, { tone: 'red', className: 'menu-ribbon', bandClass: 'menu-title' });
  return h('header', 'menu-head', back, r.el, right ?? h('span', 'menu-spacer'));
}

/** An empty state: an icon in a soft disc, a short title and one line (and an optional action). */
export function emptyState(iconName: IconName, title: string, text: string, action?: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'empty' },
    h('span', { class: 'empty-ic', deco: true }, icon(iconName)),
    h('strong', 'empty-title', title),
    h('p', 'empty-text', text),
    action ?? null,
  );
}

/** A labeled settings/menu section: a framed panel (blue by default) with its title in ink. */
export function section(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return h('section', 'card', h('h3', 'card-title', title), ...children);
}

/** A medal (§6.6): Sun Rank, trophies, level badges. `tier` picks the metal. */
export function medal(text: string, o: { size?: number; tier?: 'gold' | 'ice' | 'bronze' | 'silver' | 'socket'; className?: string } = {}): HTMLElement {
  const el = h('span', { class: `medal${o.tier && o.tier !== 'gold' ? ` medal--${o.tier}` : ''}${o.className ? ` ${o.className}` : ''}` }, text);
  if (o.size) el.style.setProperty('--d', `${o.size}px`);
  if (text.length >= 3) el.classList.add('medal--sm');
  return el;
}

export function hide(el: HTMLElement, hidden: boolean): void {
  setFlag(el, 'hidden', hidden);
}

/**
 * The progress to the next Journey star reward: its item, "Starry Scarf at 25 stars", the count and
 * a bar (the Journey map and a level's Results). Hidden once every reward is earned.
 */
export function starRoad(): { el: HTMLElement; update(save: Save): void } {
  const art = h('span', { class: 'road-art', deco: true });
  const name = h('strong', null);
  const target = h('span', null);
  const count = h('span', 'road-count num');
  const bar = progressBar(0);
  const el = h('p', 'road', art, h('span', 'road-text', name, target), count, bar);
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
