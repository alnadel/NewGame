// Settings (GDD §14 + volumes, V1_PLAN §11.5 backup code). Opened from the Title or from Pause;
// Back returns to wherever it was opened from.

import type { Settings } from '../../meta/saveTypes.ts';
import { copyText } from '../../platform/share.ts';
import { h } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import type { ScreenId } from '../types.ts';
import { button, hide, menuHeader, section, segmented, slider, toggleSwitch } from '../widgets.ts';

const percent = (v: number): string => `${Math.round(v)}%`;

export function createSettingsScreen(ctx: UiContext): Screen {
  let origin: ScreenId = 'title';
  let current: Settings = { ...ctx.save().settings };

  const change = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    current = { ...current, [key]: value };
    ctx.changeSettings(current);
  };

  const row = (iconName: IconName, label: string, hint: string | null, control: HTMLElement): HTMLElement =>
    h(
      'div',
      { class: 'set-row' },
      h('span', { class: 'set-ic' }, icon(iconName)),
      h('span', { class: 'set-text' }, h('span', { class: 'set-label' }, label), hint ? h('span', { class: 'set-hint' }, hint) : null),
      control,
    );
  const stackRow = (iconName: IconName, label: string, hint: string | null, control: HTMLElement): HTMLElement => {
    const r = row(iconName, label, hint, control);
    r.classList.add('set-row--stack');
    return r;
  };

  // Sound
  const sfx = slider({ label: 'Sound effects volume', min: 0, max: 100, step: 5, format: percent,
    onInput: (v) => change('sfx', v / 100), onCommit: () => ctx.sound('slide') });
  const music = slider({ label: 'Music volume', min: 0, max: 100, step: 5, format: percent, onInput: (v) => change('music', v / 100) });
  const haptics = toggleSwitch(ctx, 'Vibration', (on) => change('haptics', on));

  // Controls
  const sensitivity = slider({ label: 'Drag sensitivity', min: 0.6, max: 1.5, step: 0.05, format: (v) => `${v.toFixed(2)}×`,
    onInput: (v) => change('sensitivity', Math.round(v * 100) / 100) });
  const invert = toggleSwitch(ctx, 'Invert drag direction', (on) => change('invert', on));

  // Display & assist
  const motion = segmented(ctx, 'Reduced motion', [
    { value: 'auto', label: 'Auto' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' },
  ] as const, (v) => change('reducedMotion', v));
  const contrast = toggleSwitch(ctx, 'High-contrast shadows', (on) => change('highContrast', on));
  const guide = segmented(ctx, 'Shade guide', [
    { value: 'auto', label: 'Auto' }, { value: 'always', label: 'Always' }, { value: 'off', label: 'Off' },
  ] as const, (v) => change('guide', v));

  // Progress: backup code export / import, reset.
  const exportArea = h('textarea', { class: 'code-box', readonly: true, rows: 3, 'aria-label': 'Your backup code', hidden: true });
  exportArea.addEventListener('focus', () => exportArea.select());
  const exportBtn = button(ctx, {
    label: 'Copy backup code',
    icon: 'copy',
    block: true,
    onPress: () => {
      const code = ctx.cb.exportBackup();
      exportArea.value = code;
      hide(exportArea, false);
      void copyText(code).then((ok) =>
        ok
          ? ctx.toast('Backup code copied. Keep it somewhere safe!', { icon: 'check', tone: 'accent' })
          : ctx.toast('Copy the code from the box below.', { icon: 'info', tone: 'ink' }),
      );
    },
  });
  const importArea = h('textarea', { class: 'code-box', rows: 3, placeholder: 'Paste a backup code here', 'aria-label': 'Backup code to restore', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
  const importBtn = button(ctx, {
    label: 'Restore',
    icon: 'restore',
    block: true,
    onPress: () => {
      const code = importArea.value;
      if (code.trim() === '') {
        ctx.sound('deny');
        ctx.toast('Paste a backup code first.', { icon: 'info', tone: 'ink' });
        importArea.focus();
        return;
      }
      void ctx
        .confirm({
          title: 'Restore this backup?',
          body: 'Your current Snow, cosmetics, missions and bests will be replaced by the ones in the code.',
          confirmLabel: 'Restore',
        })
        .then((yes) => {
          if (!yes) return;
          const r = ctx.cb.importBackup(code);
          if (r.ok) {
            importArea.value = '';
            ctx.sound('unlock');
            ctx.toast('Progress restored. Welcome back!', { icon: 'check', tone: 'accent' });
          } else {
            ctx.sound('deny');
            ctx.toast(r.message, { icon: 'warn', tone: 'danger' });
          }
        });
    },
  });
  const resetBtn = button(ctx, {
    label: 'Reset progress',
    icon: 'trash',
    variant: 'danger',
    block: true,
    onPress: () => {
      void ctx
        .confirm({
          title: 'Reset all progress?',
          body: 'Snow, cosmetics, missions, achievements and bests will be erased for good. Settings are kept.',
          confirmLabel: 'Reset',
          danger: true,
        })
        .then((yes) => {
          if (!yes) return;
          ctx.cb.resetProgress();
          ctx.toast('Progress reset. Fresh snow!', { icon: 'info', tone: 'ink' });
        });
    },
  });

  const body = h(
    'div',
    { class: 'menu-body' },
    section(
      'Sound',
      stackRow('sound', 'Sound effects', null, sfx.el),
      stackRow('music', 'Music', null, music.el),
      row('vibrate', 'Vibration', typeof navigator.vibrate === 'function' ? null : 'Not supported by this browser', haptics.el),
    ),
    section(
      'Controls',
      stackRow('gauge', 'Drag sensitivity', 'How far the sun turns per swipe', sensitivity.el),
      row('invert', 'Invert drag', 'Drag right to turn the sun the other way', invert.el),
    ),
    section(
      'Display & assist',
      stackRow('motion', 'Reduced motion', 'No shake, zoom or sliding cards', motion.el),
      row('contrast', 'High-contrast shadows', null, contrast.el),
      stackRow('compass', 'Shade guide', 'Teal arcs on the dial show safe angles. "Always" marks your shares.', guide.el),
    ),
    section(
      'Backup',
      h('p', { class: 'card-note' }, 'Browsers can clear saved games. A backup code carries your progress to another browser or device.'),
      exportBtn,
      exportArea,
      importArea,
      importBtn,
    ),
    section('Danger zone', resetBtn),
    h('p', { class: 'version' }, `SHADY v${ctx.version}`),
  );

  const header = menuHeader(ctx, 'Settings');
  const el = h('section', { class: 'scr scr-menu scr-settings', 'aria-labelledby': 'settings-title' },
    h('div', { class: 'menu pe' }, header, body));
  header.querySelector('.menu-title')?.setAttribute('id', 'settings-title');

  function refresh(): void {
    current = { ...ctx.save().settings };
    sfx.set(Math.round(current.sfx * 100));
    music.set(Math.round(current.music * 100));
    haptics.set(current.haptics);
    sensitivity.set(current.sensitivity);
    invert.set(current.invert);
    motion.set(current.reducedMotion);
    contrast.set(current.highContrast);
    guide.set(current.guide);
  }

  return {
    el,
    enter(from) {
      if (from === 'title' || from === 'pause') origin = from;
      hide(exportArea, true);
      exportArea.value = '';
      body.scrollTop = 0;
      refresh();
    },
    refresh,
    back: () => ctx.go(origin),
    initialFocus: () => header.querySelector('button'),
  };
}
