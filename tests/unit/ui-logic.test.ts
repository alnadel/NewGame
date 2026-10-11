import { describe, expect, it } from 'vitest';
import { isLegalTransition } from '../../src/ui/transitions.ts';
import type { ScreenId } from '../../src/ui/types.ts';
import {
  canPromptInstall,
  canRegisterServiceWorker,
  captureInstallPrompt,
  onInstallPromptChange,
  promptInstall,
  type SwEnvironment,
} from '../../src/platform/pwa.ts';
import { appIconSvg, logoSvg } from '../../src/ui/art.ts';

describe('screen transitions', () => {
  const legal: [ScreenId, ScreenId][] = [
    ['boot', 'title'],
    ['title', 'play'],
    ['title', 'daily'],
    ['title', 'wardrobe'],
    ['title', 'missions'],
    ['title', 'settings'],
    ['daily', 'play'],
    ['settings', 'pause'],
    ['play', 'pause'],
    ['play', 'dying'],
    ['pause', 'play'],
    ['pause', 'settings'],
    ['pause', 'title'],
    ['dying', 'results'],
    ['results', 'play'],
    ['results', 'title'],
    ['results', 'results'],
  ];
  const illegal: [ScreenId, ScreenId][] = [
    ['title', 'results'],
    ['title', 'pause'],
    ['wardrobe', 'play'],
    ['missions', 'daily'],
    ['dying', 'play'],
    ['results', 'pause'],
    ['pause', 'dying'],
    ['daily', 'settings'],
  ];

  it('allows the flows of TECH_SPEC §13', () => {
    for (const [a, b] of legal) expect(isLegalTransition(a, b), `${a} -> ${b}`).toBe(true);
  });

  it('rejects everything else', () => {
    for (const [a, b] of illegal) expect(isLegalTransition(a, b), `${a} -> ${b}`).toBe(false);
  });
});

describe('service worker registration rules', () => {
  const env = (over: Partial<SwEnvironment>): SwEnvironment => ({
    prod: true,
    protocol: 'https:',
    hostname: 'shady.example',
    hasServiceWorker: true,
    native: false,
    ...over,
  });

  it('registers for production https and localhost', () => {
    expect(canRegisterServiceWorker(env({}))).toBe(true);
    expect(canRegisterServiceWorker(env({ protocol: 'http:', hostname: 'localhost' }))).toBe(true);
  });

  it('never registers in dev, native shells, file: builds or plain http', () => {
    expect(canRegisterServiceWorker(env({ prod: false }))).toBe(false);
    expect(canRegisterServiceWorker(env({ native: true }))).toBe(false);
    expect(canRegisterServiceWorker(env({ protocol: 'file:', hostname: '' }))).toBe(false);
    expect(canRegisterServiceWorker(env({ protocol: 'http:' }))).toBe(false);
    expect(canRegisterServiceWorker(env({ hasServiceWorker: false }))).toBe(false);
  });

  it('never registers in the single-file build', () => {
    expect(canRegisterServiceWorker(env({ mode: 'single' }))).toBe(false);
    expect(canRegisterServiceWorker(env({ mode: 'production' }))).toBe(true);
  });
});

describe('install prompt (Android)', () => {
  /** A synthetic beforeinstallprompt with a stubbed prompt() and userChoice. */
  function promptEvent(outcome: 'accepted' | 'dismissed'): Event & { prompts: number } {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompts: number;
      prompt(): Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    e.prompts = 0;
    e.prompt = async () => {
      e.prompts++;
    };
    e.userChoice = Promise.resolve({ outcome });
    return e;
  }

  it('stashes the prompt, shows it once and forgets it after appinstalled', async () => {
    const target = new EventTarget();
    const stop = captureInstallPrompt(target);
    let changes = 0;
    const off = onInstallPromptChange(() => changes++);
    expect(canPromptInstall()).toBe(false);
    expect(await promptInstall()).toBe('unavailable');

    const e = promptEvent('accepted');
    target.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(canPromptInstall()).toBe(true);
    expect(changes).toBe(1);
    expect(await promptInstall()).toBe('accepted');
    expect(e.prompts).toBe(1);
    // A prompt event works once.
    expect(canPromptInstall()).toBe(false);
    expect(await promptInstall()).toBe('unavailable');
    expect(e.prompts).toBe(1);

    const again = promptEvent('dismissed');
    target.dispatchEvent(again);
    expect(canPromptInstall()).toBe(true);
    target.dispatchEvent(new Event('appinstalled'));
    expect(canPromptInstall()).toBe(false);
    expect(again.prompts).toBe(0);

    target.dispatchEvent(promptEvent('dismissed'));
    expect(await promptInstall()).toBe('dismissed');
    stop();
    off();
    target.dispatchEvent(promptEvent('accepted'));
    expect(canPromptInstall()).toBe(false);
  });
});

describe('brand art', () => {
  it('builds well-formed icon variants', () => {
    for (const variant of ['any', 'maskable', 'apple'] as const) {
      const svg = appIconSvg(variant, 192);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('width="192"');
      expect(svg).toContain('#34306B');
      expect(svg).toContain('#FFE27A');
    }
    // Only the "any" icon has transparent rounded corners; maskable art is scaled into the safe zone.
    expect(appIconSvg('any')).toContain('rx="114"');
    expect(appIconSvg('apple')).not.toContain('rx="114"');
    expect(appIconSvg('maskable')).toContain('scale(0.8)');
  });

  it('labels the logo for assistive tech', () => {
    expect(logoSvg()).toContain('aria-label="SHADY"');
  });
});
