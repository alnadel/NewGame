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
import { appIconSvg, logoLayers, logoSvg } from '../../src/ui/art.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HourGlyph, RunResult } from '../../src/core/index.ts';
import { defaults } from '../../src/meta/save.ts';
import type { Save } from '../../src/meta/saveTypes.ts';
import { dayStripLines, GLYPHS, MOON } from '../../src/meta/share.ts';
import {
  challengeGoalText,
  cueDuration,
  cueText,
  dailyPlan,
  dailyRunLabel,
  journalChart,
  journalSummary,
  minutesDelta,
  multiplierTile,
  NOT_COUNTED_NOTE,
  parLine,
  planText,
  playTime,
  resultsAnnouncement,
  retryLabel,
  settingsSections,
  sunStrip,
  tileFill,
} from '../../src/ui/labels.ts';
import type { ResultsView } from '../../src/ui/types.ts';

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

  it('allows the flows of archive/TECH_SPEC §13', () => {
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
    // The Title's layered logo: only the wordmark is the image; the other layers are hidden.
    const l = logoLayers();
    expect(l.word).toContain('aria-label="SHADY"');
    for (const layer of [l.bloom, l.rays, l.face, l.shadow]) expect(layer).toContain('aria-hidden="true"');
    expect(l.origin).toEqual({ x: '83.3333%', y: '37.2093%' });
  });
});

describe('Results labels (U3, U8, U17)', () => {
  const TODAY = '2026-10-11';
  const stats = { flakes: 0, flakesMelted: 0, crystals: 0, flowers: 0, phews: 0, snow: 0, maxMult: 3, x5HoldBest: 0, cloudRideBest: 0, cloudSeconds: 0, ballsPassedClean: 0, ballGlared: false, gateNoon: false, dayReached: 2, nightsReached: 1, minutes: 1240, litTotal: 0, swings: 0, swingChainBest: 0, phewMinChill: 100, minChill: 100 };
  const view = (over: Partial<ResultsView> = {}, result: Partial<RunResult> = {}): ResultsView => ({
    result: {
      mode: 'daily', seed: 1, profile: 3, drain: 55, noonCloud: 0, plan: [], minutes: 1240, day: 2, clock: '', stats, hourGlyphs: [], melody: [], assisted: false, dailyDate: TODAY,
      death: { day: 2, tDay: 0, minutes: 1240, time: '2:40 PM', x: 0, y: 0, cause: 'plain', line: 'Melted by You at 2:40 PM.' },
      ...result,
    },
    outcome: { newBest: false, prevBestMinutes: 0, bestEased: false, runSnow: 0, missionSnow: 0, bonusSnow: 0, snowEarned: 0, walletBefore: 0, walletAfter: 0, missions: [], missionsCompleted: [], achievementsUnlocked: [], cosmeticsUnlocked: [], dailyUnlocked: false, toasts: [], pace: null, paceDown: false, errand: null, recentBestBefore: 0, comfortAfter: 4 },
    ...over,
  });
  const saveWith = (tries: number): Save => {
    const s = defaults(1);
    if (tries > 0) s.daily[TODAY] = { tries, bestMinutes: 0, bestSnow: 0, glyphs: '' };
    return s;
  };

  it('names how a Daily run counted', () => {
    expect(dailyRunLabel(2, true)).toBe('Try 2/3');
    expect(dailyRunLabel(1, undefined)).toBe('Try 1/3');
    expect(dailyRunLabel(null, true)).toBe('Not counted');
    expect(dailyRunLabel(undefined, true)).toBe('Not counted');
    expect(dailyRunLabel(null, false)).toBe('Practice');
    expect(dailyRunLabel(undefined, undefined)).toBe('Practice');
    expect(NOT_COUNTED_NOTE).toBe('Melted before 6:30 AM, so no try was used');
  });

  it("says 'Retry · practice' exactly when the next Daily retry can't count", () => {
    const v = view({ dailyTry: 1, dailyScored: true, dailyDate: TODAY });
    expect(retryLabel(v, saveWith(1), TODAY)).toBe('Retry');
    expect(retryLabel(v, saveWith(2), TODAY)).toBe('Retry');
    expect(retryLabel(v, saveWith(3), TODAY)).toBe('Retry · practice');
    // Another date (yesterday's run after midnight, or a past date).
    expect(retryLabel(v, saveWith(1), '2026-10-12')).toBe('Retry · practice');
    expect(retryLabel(view({ dailyDate: '2026-10-01' }, { dailyDate: '2026-10-01' }), saveWith(0), TODAY)).toBe('Retry · practice');
    // Endless, challenge and debug runs: plain Retry.
    expect(retryLabel(view({}, { mode: 'endless', dailyDate: undefined }), saveWith(3), TODAY)).toBe('Retry');
    expect(retryLabel(view({}, { mode: 'challenge' }), saveWith(3), TODAY)).toBe('Retry');
    expect(retryLabel(view({ debug: true }), saveWith(3), TODAY)).toBe('Retry');
  });

  it('shows the best multiplier, or the seconds held at ×5', () => {
    expect(multiplierTile({ x5HoldBest: 0, maxMult: 3 })).toEqual({ value: '×3', caption: 'best multiplier' });
    expect(multiplierTile({ x5HoldBest: 0, maxMult: 0 })).toEqual({ value: '×1', caption: 'best multiplier' });
    expect(multiplierTile({ x5HoldBest: 6.44, maxMult: 5 })).toEqual({ value: '6.4 s', caption: 'longest ×5' });
  });

  it('announces the run for screen readers', () => {
    expect(resultsAnnouncement(view({ dailyTry: 2, dailyScored: true }))).toBe('Nubs melted at Day 2 · 2:40 PM. Daily try 2 of 3.');
    expect(resultsAnnouncement(view({ dailyTry: null, dailyScored: true }))).toBe('Nubs melted at Day 2 · 2:40 PM. Daily not counted.');
    const best = view({}, { mode: 'endless', dailyDate: undefined });
    best.outcome.newBest = true;
    expect(resultsAnnouncement(best)).toBe('Nubs melted at Day 2 · 2:40 PM. New best!');
    expect(resultsAnnouncement(view({ challengeTarget: 1200 }, { mode: 'challenge', dailyDate: undefined }))).toBe('Nubs melted at Day 2 · 2:40 PM. Challenge beaten.');
    expect(resultsAnnouncement(view({ challengeTarget: 1300 }, { mode: 'challenge', dailyDate: undefined }))).toBe('Nubs melted at Day 2 · 2:40 PM. Challenge not beaten.');
  });
});

describe('Settings sections (U16)', () => {
  it('hides backup, restore and reset mid-run', () => {
    expect(settingsSections('title')).toEqual({ backup: true, danger: true, backupNote: false });
    expect(settingsSections('pause')).toEqual({ backup: false, danger: false, backupNote: true });
  });
});

describe('challenge banner goal (U10)', () => {
  it('wraps only after "Beat": the score stays in one piece', () => {
    const t = challengeGoalText(1240);
    expect(t.replace(/\u00a0/g, ' ')).toBe('Beat Day 2 · 2:40 PM');
    // One breakable space, after "Beat" (never "Beat Day 2 ·" over "2:40 PM").
    expect(t.split(' ')).toEqual(['Beat', 'Day\u00a02\u00a0·\u00a02:40\u00a0PM']);
  });
});

describe('Sun Strip (UM8)', () => {
  const C: HourGlyph = 'cool';
  const W: HourGlyph = 'warm';
  const H: HourGlyph = 'hot';
  const M: HourGlyph = 'melt';
  const DAY: HourGlyph[] = [C, C, W, C, H, W, C, C, W, C, C, C];
  const glyphCount = (row: (HourGlyph | null)[]): number => row.filter((g) => g !== null).length;

  it('has one row per day with the glyphs the share strip prints, ghosts after the melt', () => {
    const hours = [DAY, DAY, [C, W, H, M]];
    const strip = sunStrip(hours, null, 4);
    const lines = dayStripLines(hours, false);
    expect(strip.hidden).toBe(0);
    expect(strip.rows.map((r) => r.day)).toEqual([1, 2, 3]);
    strip.rows.forEach((r, i) => {
      expect(r.tiles).toHaveLength(12);
      const printed = (lines[i] as string).replace(MOON, '');
      expect(r.tiles.filter((g) => g !== null).map((g) => GLYPHS[g as HourGlyph]).join('')).toBe(printed);
      expect(r.night).toBe(i < 2);
      expect(r.forecast).toBeNull();
    });
    expect(glyphCount((strip.rows[2] as { tiles: (HourGlyph | null)[] }).tiles)).toBe(4);
    // A run started on Day 3 (a debug start) records its glyphs from there.
    expect(sunStrip([[C, M]], null, 4, 3).rows.map((r) => r.day)).toEqual([3]);
  });

  it('folds earlier days into a chip and labels plan days with their forecast', () => {
    const plan = [
      { biome: 'meadow', forecast: 'clear' },
      { biome: 'oldtown', forecast: 'market' },
      { biome: 'meadow', forecast: 'heat' },
      { biome: 'oldtown', forecast: 'breezy' },
      { biome: 'meadow', forecast: 'long' },
    ] as const;
    const strip = sunStrip([DAY, DAY, DAY, DAY, [C, M]], plan, 2);
    expect(strip.hidden).toBe(3);
    expect(strip.rows.map((r) => [r.day, r.forecast?.emoji])).toEqual([
      [4, '🌬️'],
      [5, '🍂'],
    ]);
  });

  it('tints each tile with its hour', () => {
    expect(tileFill(0, 'cool')).toBe('#bdd8e6');
    expect(tileFill(6, 'cool')).not.toBe(tileFill(0, 'cool'));
    expect(tileFill(5, 'melt')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('Title, Daily and cue copy (UM9)', () => {
  it('names a day by its weather and place', () => {
    expect(planText({ biome: 'oldtown', forecast: 'breezy' })).toBe('🌬️ Breezy · Old Town');
    expect(planText({ biome: 'meadow', forecast: 'clear' })).toBe('☀️ Clear · Meadow');
  });

  it("previews a Daily's Day 1: the Day Plan from its start date, the classic Meadow before", () => {
    expect(dailyPlan('2026-10-13')).toEqual({ biome: 'meadow', forecast: 'clear' });
    const later = dailyPlan('2026-10-20');
    expect(['meadow', 'oldtown']).toContain(later.biome);
    expect(dailyPlan('2026-10-20')).toEqual(later);
  });

  it("reads Snowbot's par, or waits for it", () => {
    expect(parLine(null)).toBe('Snowbot is warming up…');
    expect(parLine(455)).toBe('Snowbot made it to 1:35 PM');
    expect(parLine(1500)).toBe('Snowbot made it to Day 3 · 7:00 AM');
  });

  it('words the cues for touch and keyboard players', () => {
    expect(cueText('keep-shade', undefined, false)).toBe('Keep Nubs in the shade');
    expect(cueText('drag', -1, false)).toBe('Drag ← to swing the sun');
    expect(cueText('drag', 1, true)).toBe('Hold → to swing the sun');
    expect(cueText('shade-found', undefined, false)).toBe('Shade! Thick teal = safe');
    expect(cueText('melting', undefined, false)).toBe('Melting! Find thick teal');
    // In the lesson the warning keeps the drag instruction.
    expect(cueText('melting', 1, false)).toBe('Melting! Drag → to the thick teal');
    expect([cueDuration('keep-shade', undefined), cueDuration('shade-found', undefined), cueDuration('melting', undefined)]).toEqual([2000, 1400, 1600]);
    expect([cueDuration('drag', -1), cueDuration('melting', -1)]).toEqual([null, null]);
    // The first SWING of a lifetime says what just happened.
    expect(cueText('swing', undefined, false)).toBe('SWING! Straight into the next shade: +Snow');
    expect(cueDuration('swing', undefined)).toBe(2400);
  });
});

describe('Journal (UM10)', () => {
  const runs = (ms: number[], r = 4): Save['history'] => ms.map((m) => ({ m, s: 0, r, d: '2026-10-11' }));

  it('scales bars to the best run, marks it gold and hatches eased runs', () => {
    const c = journalChart([...runs([100], 0), ...runs([400, 800]), ...runs([200], 2)]);
    expect(c.bars.map((b) => b.height)).toEqual([0.125, 0.5, 1, 0.25]);
    expect(c.bars.map((b) => b.best)).toEqual([false, false, true, false]);
    expect(c.bars.map((b) => b.eased)).toEqual([true, false, false, true]);
    expect(c.bars.map((b) => b.day)).toEqual([1, 1, 2, 1]);
  });

  it('averages the last 10 and compares them with the 10 before', () => {
    const c = journalChart(runs([...Array<number>(10).fill(300), ...Array<number>(10).fill(342)]));
    expect([c.average, c.delta, c.previous]).toEqual([342, 42, 10]);
    expect(journalChart(runs([100, 200, 300])).delta).toBeNull();
    expect(journalChart([]).average).toBeNull();
    expect(journalSummary(c)).toBe('Last 20 runs. Best: 11:42 AM. Last 10 average: 11:42 AM. +42 min against the 10 runs before.');
    expect(journalSummary(journalChart([]))).toBe('No runs yet.');
  });

  it('formats deltas and play time', () => {
    expect([minutesDelta(42), minutesDelta(-65), minutesDelta(120), minutesDelta(0)]).toEqual(['+42 min', '−1 h 5 min', '+2 h', '+0 min']);
    expect([playTime(59), playTime(720), playTime(3 * 3600 + 754)]).toEqual(['0 m', '12 m', '3 h 12 m']);
  });
});

describe('no aria-label on role-less spans (U17)', () => {
  it('src/ui never labels a span without a role', () => {
    const dir = fileURLToPath(new URL('../../src/ui/', import.meta.url));
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(/h\('span',\s*\{([^}]*)\}/g)) {
        const attrs = m[1] ?? '';
        if (/'aria-label'/.test(attrs) && !/role:/.test(attrs)) offenders.push(`${f}: ${attrs.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
