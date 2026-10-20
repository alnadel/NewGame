// Settings (GDD §14 + volumes, V1_PLAN §11.5 backup code, V1_1_PLAN UM2/UM9: the name on challenge
// links and adaptive comfort). Opened from the Title or from Pause;
// Back returns to wherever it was opened from. Mid-run (from Pause) the backup, restore and reset
// controls are hidden: replacing the save under a running run would desync it. A "Testing" group
// holds the Journey's unlock-all toggle (CAMPAIGN_PLAN §5).

import { backupErrorMessage, backupSummary, importBackup } from '../../meta/backup.ts';
import { sanitizeName } from '../../meta/challenge.ts';
import type { Settings } from '../../meta/saveTypes.ts';
import { isStandalone } from '../../platform/lifecycle.ts';
import { canPromptInstall, onInstallPromptChange, promptInstall } from '../../platform/pwa.ts';
import { copyText } from '../../platform/share.ts';
import { h } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import type { ScreenId } from '../types.ts';
import { button, hide, menuHeader, section, segmented, setButtonLabel, slider, toggleSwitch } from '../widgets.ts';

const percent = (v: number): string => `${Math.round(v)}%`;

export const KEYS_LINE = '← → or A D: turn the sun · Shift: fine turns · Space/Enter: play the level, or retry · P or Esc: pause';
export const MID_RUN_BACKUP_NOTE = 'Backup, restore and reset are in Settings on the Title screen.';

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
      h('span', { class: 'set-ic', 'aria-hidden': 'true' }, icon(iconName)),
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
  const keys = h('div', { class: 'set-row set-row--keys' },
    h('span', { class: 'set-ic', 'aria-hidden': 'true' }, icon('keyboard')),
    h('span', { class: 'set-text' }, h('span', { class: 'set-label' }, 'Keys'), h('span', { class: 'set-hint set-keys' },
      // One binding per line (a "·" between them would wrap mid-binding on phones); the separators
      // stay in the text for screen readers.
      ...KEYS_LINE.split(' · ').flatMap((part, i) => [
        ...(i > 0 ? [h('span', { class: 'sr-only' }, ' · ')] : []),
        h('span', { class: 'set-key' }, part),
      ]))));

  // Play: the name friends see on challenge links (sanitized; '' = "A friend"), adaptive comfort.
  const nameInput = h('input', {
    class: 'text-field',
    type: 'text',
    maxlength: 12,
    placeholder: 'A friend',
    autocomplete: 'nickname',
    autocapitalize: 'words',
    spellcheck: 'false',
    enterkeyhint: 'done',
    'aria-label': 'Name on challenges',
  });
  nameInput.addEventListener('change', () => {
    const raw = nameInput.value;
    const name = sanitizeName(raw);
    nameInput.value = name;
    if (raw.trim() !== '' && name === '') ctx.toast('Names use letters, numbers, spaces and . _ \' -', { icon: 'info', tone: 'ink' });
    if (name !== current.name) change('name', name);
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });
  const comfort = toggleSwitch(ctx, 'Adaptive comfort', (on) => change('comfort', on));

  // Testing: every Journey level playable from the map and every feature open (progress still counts as usual).
  const unlockAll = toggleSwitch(ctx, 'Unlock all levels (testing)', (on) => change('unlockAll', on));

  // Accessibility
  const motion = segmented(ctx, 'Reduced motion', [
    { value: 'auto', label: 'Auto' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' },
  ] as const, (v) => change('reducedMotion', v));
  const contrast = toggleSwitch(ctx, 'High-contrast shadows', (on) => change('highContrast', on));
  const guide = segmented(ctx, 'Shade guide', [
    { value: 'auto', label: 'Auto' }, { value: 'always', label: 'Always' }, { value: 'off', label: 'Off' },
  ] as const, (v) => change('guide', v));

  // App: the browser's install prompt, caught by platform/pwa (Chromium/Android only).
  const installBtn = button(ctx, {
    label: 'Install SHADY',
    icon: 'plusSquare',
    block: true,
    onPress: () => {
      void promptInstall().then((outcome) => {
        if (outcome === 'accepted') ctx.toast('Installing SHADY. Find it with your apps.', { icon: 'check', tone: 'accent' });
        syncInstall();
      });
    },
  });
  const appSection = section('App', h('p', { class: 'card-note card-note--top' }, 'Play full screen from your home screen, even offline.'), installBtn);
  const syncInstall = (): void => hide(appSection, !(canPromptInstall() && !isStandalone()));

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
  const importArea = h('textarea', { class: 'code-box', rows: 3, hidden: true, placeholder: 'Paste a backup code here', 'aria-label': 'Backup code to restore', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
  const importBtn = button(ctx, {
    label: 'Restore from a code',
    icon: 'restore',
    block: true,
    onPress: () => {
      // The paste box opens on the first press (Settings stays short until it is needed).
      if (importArea.hidden) {
        hide(importArea, false);
        setButtonLabel(importBtn, 'Restore');
        importArea.focus();
        return;
      }
      const code = importArea.value;
      if (code.trim() === '') {
        ctx.sound('deny');
        ctx.toast('Paste a backup code first.', { icon: 'info', tone: 'ink' });
        importArea.focus();
        return;
      }
      // Check the code before asking anything: a typo or a cut-off paste gets its error at once,
      // and only a code that would really restore gets the (destructive) confirmation.
      const check = importBackup(code);
      if (!check.ok) {
        ctx.sound('deny');
        ctx.toast(backupErrorMessage(check.error), { icon: 'warn', tone: 'danger' });
        importArea.focus();
        return;
      }
      void ctx
        .confirm({
          title: 'Restore this backup?',
          body: `It holds: ${backupSummary(check.save)}. Your current Snow, cosmetics, missions and bests will be replaced by these.`,
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
          const r = ctx.cb.resetProgress();
          if (r.ok) {
            ctx.toast('Progress reset. Fresh snow!', { icon: 'info', tone: 'ink' });
          } else {
            ctx.sound('deny');
            ctx.toast(r.message, { icon: 'warn', tone: 'danger' });
          }
        });
    },
  });

  // Backup, restore and reset; hidden mid-run (from Pause), where replacing the save would desync the run.
  const progressSection = section(
    'Progress',
    h('p', { class: 'card-note card-note--top' }, 'Browsers can clear saved games. A backup code carries your progress to another browser or device.'),
    exportBtn,
    exportArea,
    importArea,
    importBtn,
    resetBtn,
  );
  const midRunNote = h('p', { class: 'card card-note set-midrun' }, MID_RUN_BACKUP_NOTE);

  /** A section's row tiles wear its candy face (kit.css .set-ic). */
  const toned = (face: string, card: HTMLElement): HTMLElement => {
    card.classList.add(face);
    return card;
  };
  const body = h(
    'div',
    { class: 'menu-body' },
    // Short groups: one line per control where it fits (sliders sit beside their label).
    toned('f-pink', section(
      'Sound',
      row('sound', 'Effects', null, sfx.el),
      row('music', 'Music', null, music.el),
      row('vibrate', 'Vibration', typeof navigator.vibrate === 'function' ? null : 'Not supported here', haptics.el),
    )),
    toned('f-blue', section(
      'Controls',
      row('gauge', 'Drag speed', null, sensitivity.el),
      row('invert', 'Invert drag', 'Drag right to turn the sun the other way', invert.el),
      keys,
    )),
    toned('f-green', section(
      'Play',
      stackRow('flag', 'Name on challenges', 'Friends see it on the links you share.', nameInput),
      row('sun', 'Adaptive comfort', 'Eases the heat after a rough run (not in Daily or challenges).', comfort.el),
    )),
    toned('f-violet', section(
      'Accessibility',
      stackRow('motion', 'Reduced motion', 'No shake, zoom or sliding cards', motion.el),
      row('contrast', 'High-contrast shadows', null, contrast.el),
      stackRow('compass', 'Shade guide', 'Thick teal lasts, thin is ending. "Always" marks your shares.', guide.el),
    )),
    section(
      'Testing',
      row('map', 'Unlock all levels (testing)', 'Every Journey level opens from the map, and every feature (Endless, Daily, Missions, Wardrobe, Profile) is open. Stars and unlocks still count as usual.', unlockAll.el),
    ),
    appSection,
    progressSection,
    midRunNote,
    h('p', { class: 'version' }, `SHADY v${ctx.version}`),
    // The display face's credit (docs/UI_V2.md §2.1; its licence is src/ui/fonts/LICENSE-LilitaOne.txt).
    h('p', { class: 'version' }, 'Lilita One font © 2011 Juan Montoreano · SIL Open Font License 1.1'),
  );

  const header = menuHeader(ctx, 'Settings');
  const el = h('section', { class: 'scr scr-menu scr-settings', 'aria-labelledby': 'settings-title' },
    h('div', { class: 'menu pe' }, header, body));
  header.querySelector('.menu-title')?.setAttribute('id', 'settings-title');
  const backBtn = header.querySelector('button');

  // While shown, the install row appears (or goes) as the browser offers or withdraws the prompt.
  let stopInstallWatch: (() => void) | null = null;

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
    if (document.activeElement !== nameInput) nameInput.value = current.name;
    comfort.set(current.comfort);
    unlockAll.set(current.unlockAll);
    syncInstall();
  }

  return {
    el,
    enter(from) {
      if (from === 'title' || from === 'pause') origin = from;
      hide(progressSection, origin === 'pause');
      hide(midRunNote, origin !== 'pause');
      hide(exportArea, true);
      exportArea.value = '';
      hide(importArea, true);
      setButtonLabel(importBtn, 'Restore from a code');
      body.scrollTop = 0;
      stopInstallWatch?.();
      stopInstallWatch = onInstallPromptChange(syncInstall);
      refresh();
    },
    leave() {
      stopInstallWatch?.();
      stopInstallWatch = null;
    },
    refresh,
    back: () => ctx.go(origin),
    initialFocus: () => backBtn,
  };
}
