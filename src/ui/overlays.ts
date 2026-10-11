// Layers that sit above the screens: toasts, modal dialogs/sheets and the rotate overlay.

import type { ToastIcon } from '../meta/progression.ts';
import { h } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import type { ConfirmOptions, UiContext } from './screen.ts';
import type { ToastOptions } from './types.ts';
import { button } from './widgets.ts';

// ---------------------------------------------------------------------------------------------
// Toasts: a stack at the top center, each visible for 2.5 s (TECH_SPEC §13).
// ---------------------------------------------------------------------------------------------

const TOAST_MS = 2500;
const TOAST_MAX = 3;
const TOAST_OUT_MS = 220;

const TOAST_ICON: Record<ToastIcon, IconName> = {
  trophy: 'trophy',
  gift: 'gift',
  snow: 'snow',
  calendar: 'daily',
  info: 'info',
  warn: 'warn',
  check: 'check',
  share: 'share',
  lock: 'lock',
};

export interface ToastStack {
  el: HTMLElement;
  show(text: string, options?: ToastOptions): void;
}

export function createToastStack(): ToastStack {
  const el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
  const dismiss = (t: HTMLElement): void => {
    if (t.classList.contains('is-out')) return;
    t.classList.add('is-out');
    window.setTimeout(() => t.remove(), TOAST_OUT_MS);
  };
  return {
    el,
    show(text, o = {}) {
      const t = h(
        'div',
        { class: `toast toast--${o.tone ?? 'ink'}` },
        h('span', { class: 'toast-ic' }, icon(TOAST_ICON[o.icon ?? 'info'])),
        h('span', { class: 'toast-text' }, text),
      );
      el.append(t);
      // Never stack more than a few: the oldest leave early.
      const live = [...el.children].filter((c) => !c.classList.contains('is-out')) as HTMLElement[];
      for (let i = 0; i < live.length - TOAST_MAX; i++) dismiss(live[i] as HTMLElement);
      window.setTimeout(() => dismiss(t), o.duration ?? TOAST_MS);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Modal host: one dialog or sheet at a time, focus moved in and restored on close.
// ---------------------------------------------------------------------------------------------

export interface ModalHost {
  el: HTMLElement;
  isOpen(): boolean;
  /** Closes the open modal as if dismissed (Escape). */
  dismiss(): void;
  confirm(options: ConfirmOptions): Promise<boolean>;
  installSheet(): void;
}

export function createModalHost(ctx: () => UiContext, onOpenChange: (open: boolean) => void): ModalHost {
  const el = h('div', { class: 'modal-layer' });
  let close: (() => void) | null = null;

  function open(content: HTMLElement, kind: 'dialog' | 'sheet', label: string, onDismiss: () => void): () => void {
    close?.();
    const scrim = h('div', { class: 'scrim pe' });
    const box = h('div', { class: `modal modal--${kind} pe`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: -1 }, content);
    const wrap = h('div', { class: `modal-wrap modal-wrap--${kind}` }, scrim, box);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    scrim.addEventListener('click', () => {
      onDismiss();
      finish();
    });
    el.append(wrap);
    requestAnimationFrame(() => wrap.classList.add('is-on'));
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      close = null;
      wrap.classList.remove('is-on');
      window.setTimeout(() => wrap.remove(), 200);
      onOpenChange(false);
      previous?.focus({ preventScroll: true });
    };
    close = () => {
      onDismiss();
      finish();
    };
    onOpenChange(true);
    // Focus the dialog itself: screen readers announce it and Tab reaches its buttons, without a
    // focus ring flashing on a button the player never pointed at.
    box.focus({ preventScroll: true });
    // Keep Tab inside the modal.
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const items = [...box.querySelectorAll<HTMLElement>('button, textarea, input')];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    return finish;
  }

  return {
    el,
    isOpen: () => close !== null,
    dismiss: () => close?.(),
    confirm(o) {
      return new Promise<boolean>((resolve) => {
        const c = ctx();
        let finish = (): void => {};
        const cancel = button(c, { label: 'Cancel', sound: 'back', block: true, onPress: () => {
          resolve(false);
          finish();
        } });
        const ok = button(c, { label: o.confirmLabel, variant: o.danger ? 'danger' : 'primary', block: true, onPress: () => {
          resolve(true);
          finish();
        } });
        const content = h(
          'div',
          { class: 'confirm' },
          h('div', { class: `confirm-ic${o.danger ? ' is-danger' : ''}`, 'aria-hidden': 'true' }, icon(o.danger ? 'warn' : 'info')),
          h('h2', { class: 'dialog-title' }, o.title),
          h('p', { class: 'dialog-sub' }, o.body),
          h('div', { class: 'row-2' }, cancel, ok),
        );
        finish = open(content, 'dialog', o.title, () => resolve(false));
      });
    },
    installSheet() {
      const c = ctx();
      let finish = (): void => {};
      const step = (n: number, text: string, iconName: IconName): HTMLElement =>
        h('li', { class: 'install-step' }, h('span', { class: 'install-n' }, String(n)), h('span', { class: 'install-text' }, text), h('span', { class: 'install-ic' }, icon(iconName)));
      const content = h(
        'div',
        { class: 'install' },
        h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
        h('h2', { class: 'dialog-title' }, 'Keep Nubs safe'),
        h('p', { class: 'dialog-sub' }, 'Add SHADY to your Home Screen. It opens full screen, works offline, and Safari won’t clear your progress.'),
        h('ol', { class: 'install-steps' },
          step(1, 'Tap Share in Safari’s toolbar', 'share'),
          step(2, 'Choose “Add to Home Screen”', 'plusSquare'),
          step(3, 'Tap Add, then play from the new icon', 'check')),
        button(c, { label: 'Got it', variant: 'primary', size: 'lg', block: true, onPress: () => finish() }),
      );
      finish = open(content, 'sheet', 'Add SHADY to your Home Screen', () => {});
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Rotate overlay: a phone held landscape (touch, height < 500 px) covers everything.
// ---------------------------------------------------------------------------------------------

export function createRotateOverlay(): HTMLElement {
  return h(
    'div',
    { class: 'rotate', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'rotate-title' },
    h('div', { class: 'rotate-phone', 'aria-hidden': 'true' }, icon('phone')),
    h('h2', { class: 'rotate-title', id: 'rotate-title' }, 'Turn your phone upright'),
    h('p', { class: 'rotate-sub' }, 'SHADY plays in portrait. Nubs will wait.'),
  );
}
