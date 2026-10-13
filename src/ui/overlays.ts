// Layers that sit above the screens: toasts, modal dialogs/sheets and the rotate overlay.

import type { ToastIcon } from '../meta/progression.ts';
import { copyText } from '../platform/share.ts';
import { h } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import type { ConfirmOptions, UiContext } from './screen.ts';
import type { ToastOptions } from './types.ts';
import { button } from './widgets.ts';

// ---------------------------------------------------------------------------------------------
// Toasts: a stack at the top of the world column (below the header on menus, below the HUD row in
// play), each visible for 2.5 s (archive/TECH_SPEC §13). A screen switch fades the stack out in 120 ms.
// ---------------------------------------------------------------------------------------------

const TOAST_MS = 2500;
const TOAST_MAX = 3;
const TOAST_OUT_MS = 220;
/** A screen switch clears the stack this fast (the CSS fade is 120 ms). */
const TOAST_CLEAR_MS = 140;

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
  star: 'star',
};

/** The icon a toast (or a Results award chip) shows for a ToastSpec icon. */
export function toastIconName(i: ToastIcon): IconName {
  return TOAST_ICON[i];
}

export interface ToastStack {
  el: HTMLElement;
  show(text: string, options?: ToastOptions): void;
  /** Fades out every toast on screen (screen switches). */
  clear(): void;
}

export function createToastStack(): ToastStack {
  const el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
  const dismiss = (t: HTMLElement, fast = false): void => {
    if (t.classList.contains('is-out')) {
      if (!fast || t.classList.contains('is-fast')) return;
    }
    t.classList.add('is-out');
    if (fast) t.classList.add('is-fast');
    window.setTimeout(() => t.remove(), fast ? TOAST_CLEAR_MS : TOAST_OUT_MS);
  };
  return {
    el,
    show(text, o = {}) {
      const t = h(
        'div',
        { class: `toast toast--${o.tone ?? 'ink'}` },
        h('span', { class: 'toast-ic', 'aria-hidden': 'true' }, icon(TOAST_ICON[o.icon ?? 'info'])),
        h('span', { class: 'toast-text' }, text),
      );
      el.append(t);
      // Never stack more than a few: the oldest leave early.
      const live = [...el.children].filter((c) => !c.classList.contains('is-out')) as HTMLElement[];
      for (let i = 0; i < live.length - TOAST_MAX; i++) dismiss(live[i] as HTMLElement);
      window.setTimeout(() => dismiss(t), o.duration ?? TOAST_MS);
    },
    clear() {
      for (const t of [...el.children] as HTMLElement[]) dismiss(t, true);
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
  /** iOS: how to add SHADY to the Home Screen, with the progress copied first. */
  installSheet(): void;
  /** The iOS Home Screen app's first launch: paste the progress copied in the browser. */
  restoreSheet(): void;
}

export function createModalHost(ctx: () => UiContext, onOpenChange: (open: boolean) => void): ModalHost {
  const el = h('div', { class: 'modal-layer' });
  let close: (() => void) | null = null;

  function open(content: HTMLElement, kind: 'dialog' | 'sheet', label: string, onDismiss: () => void): () => void {
    close?.();
    const scrim = h('div', { class: 'scrim pe' });
    const box = h('div', { class: `modal modal--${kind} pe`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: -1 }, content);
    // The scrim dims the whole viewport; the frame puts the dialog or sheet in the world column.
    const wrap = h('div', { class: `modal-wrap modal-wrap--${kind}` }, scrim, h('div', { class: 'modal-frame' }, box));
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
      const items = [...box.querySelectorAll<HTMLElement>('button, textarea, input')].filter((x) => !x.hidden);
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
      // Step 1 copies the backup code: the Home Screen app keeps its own storage, so the progress
      // is pasted there on its first launch (restoreSheet).
      const copyProgress = async (): Promise<boolean> => {
        const ok = await copyText(c.cb.exportBackup());
        if (ok) c.toast('Progress copied. Paste it in the new app.', { icon: 'check', tone: 'accent' });
        else c.toast("Couldn't copy here. Use Settings → Backup in both places.", { icon: 'warn', tone: 'danger' });
        return ok;
      };
      const copyBtn = button(c, { label: 'Copy progress', icon: 'copy', className: 'install-copy', onPress: () => void copyProgress() });
      const step = (n: number, text: string, side: HTMLElement): HTMLElement =>
        h('li', { class: 'install-step' }, h('span', { class: 'install-n', 'aria-hidden': 'true' }, String(n)), h('span', { class: 'install-text' }, text), side);
      const glyph = (name: IconName): HTMLElement => h('span', { class: 'install-ic', 'aria-hidden': 'true' }, icon(name));
      const steps = h('ol', { class: 'install-steps', hidden: true },
        step(1, 'Copy your progress', copyBtn),
        step(2, 'Tap the Share button, then “Add to Home Screen”', glyph('share')),
        step(3, 'Open SHADY from the new icon and paste your progress', glyph('plusSquare')));
      const done = button(c, { label: 'Done', variant: 'primary', size: 'lg', block: true, onPress: () => finish() });
      done.hidden = true;
      const later = button(c, { label: 'Not now', sound: 'back', block: true, className: 'sheet-quiet', onPress: () => finish() });
      const cta = button(c, {
        label: 'Copy progress & show steps',
        variant: 'primary',
        size: 'lg',
        block: true,
        onPress: () => {
          void copyProgress();
          steps.hidden = false;
          cta.hidden = true;
          later.hidden = true;
          done.hidden = false;
          done.focus({ preventScroll: true });
        },
      });
      const content = h(
        'div',
        { class: 'install' },
        h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
        h('h2', { class: 'dialog-title' }, 'Play SHADY from your Home Screen'),
        h('p', { class: 'dialog-sub' }, 'It opens full screen and works offline. The Home Screen app keeps its own copy. Copy your progress first, then paste it there.'),
        steps,
        cta,
        later,
        done,
      );
      finish = open(content, 'sheet', 'Add SHADY to your Home Screen', () => {});
    },
    restoreSheet() {
      const c = ctx();
      let finish = (): void => {};
      const field = h('textarea', {
        class: 'code-box',
        rows: 3,
        placeholder: 'Paste your progress code here',
        'aria-label': 'Progress code to restore',
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
      });
      const restore = (): void => {
        const code = field.value;
        if (code.trim() === '') {
          c.sound('deny');
          c.toast('Paste your progress code first.', { icon: 'info', tone: 'ink' });
          field.focus();
          return;
        }
        const r = c.cb.importBackup(code);
        if (r.ok) {
          c.sound('unlock');
          c.toast('Progress restored. Welcome back!', { icon: 'check', tone: 'accent' });
          finish();
        } else {
          c.sound('deny');
          c.toast(r.message, { icon: 'warn', tone: 'danger' });
          field.focus();
        }
      };
      const paste = button(c, {
        label: 'Paste',
        icon: 'copy',
        onPress: () => {
          const clip = navigator.clipboard;
          if (!clip || typeof clip.readText !== 'function') {
            field.focus();
            return;
          }
          clip.readText().then(
            (text) => {
              field.value = text;
              if (text.trim() !== '') restore();
            },
            () => field.focus(),
          );
        },
      });
      const content = h(
        'div',
        { class: 'install restore' },
        h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
        h('h2', { class: 'dialog-title' }, 'Bringing your progress from Safari?'),
        h('p', { class: 'dialog-sub' }, 'The Home Screen app starts with its own empty save. Paste the progress you copied before adding it.'),
        field,
        h('div', { class: 'row-2' }, paste, button(c, { label: 'Restore', icon: 'restore', variant: 'primary', onPress: restore })),
        button(c, { label: 'Start fresh', sound: 'back', block: true, className: 'sheet-quiet', onPress: () => finish() }),
      );
      finish = open(content, 'sheet', 'Restore your progress', () => {});
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
