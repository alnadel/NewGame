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
import { NOTE_CALM, NOTE_PRESS, NOTE_REFUSE, NOTE_SETTLE, REFUSE_BUSY, REFUSE_CHARGING, REFUSE_FULL, REFUSE_LOCKED, REFUSE_LOW, REFUSE_NOTHING, REFUSE_WAIT, type DriveView, type HourGlyph, type RunResult } from '../../src/core/index.ts';
import { defaults } from '../../src/meta/save.ts';
import type { Save } from '../../src/meta/saveTypes.ts';
import { dayStripLines, GLYPHS, MOON } from '../../src/meta/share.ts';
import {
  RARITY_LABEL,
  campaignKicker,
  challengeGoalText,
  chapterTitle,
  continueLabel,
  cueDuration,
  cueText,
  noteText,
  dailyPlan,
  dailyRunLabel,
  journalChart,
  journalSummary,
  levelTileLabel,
  minutesDelta,
  multiplierTile,
  NOT_COUNTED_NOTE,
  parLine,
  planText,
  playTime,
  resultsAnnouncement,
  retryLabel,
  starsLabel,
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
    ['title', 'journey'],
    ['journey', 'play'],
    ['journey', 'title'],
    ['results', 'journey'],
    // Elementals (docs/ELEMENTALS.md §4.10): from the Title, to a Trial or back, and a Trial's Results' Map.
    ['title', 'elementals'],
    ['elementals', 'play'],
    ['elementals', 'title'],
    ['results', 'elementals'],
  ];
  const illegal: [ScreenId, ScreenId][] = [
    ['journey', 'results'],
    ['journey', 'settings'],
    ['pause', 'journey'],
    ['title', 'results'],
    ['title', 'pause'],
    ['wardrobe', 'play'],
    ['missions', 'daily'],
    ['dying', 'play'],
    ['results', 'pause'],
    ['pause', 'dying'],
    ['daily', 'settings'],
    ['elementals', 'journey'],
    ['elementals', 'results'],
    ['journey', 'elementals'],
    ['pause', 'elementals'],
    ['play', 'elementals'],
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
    outcome: { newBest: false, prevBestMinutes: 0, bestEased: false, runSnow: 0, missionSnow: 0, bonusSnow: 0, snowEarned: 0, walletBefore: 0, walletAfter: 0, missions: [], missionsCompleted: [], achievementsUnlocked: [], cosmeticsUnlocked: [], dailyUnlocked: false, toasts: [], pace: null, paceDown: false, recentBestBefore: 0, comfortAfter: 4 },
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

  it('Controls v3: the cue line announces each TAG with its drag and button lines (docs/CONTROLS_V3.md §6.1, §13.1)', () => {
    expect(cueText('tag-ember', undefined, false)).toBe("Ember's turn. Drag: turn the sun · Button: burn the next wall");
    expect(cueText('tag-drip', undefined, true)).toBe("Drip's turn. Drag: steer Drip · No button: the sun holds");
    expect(cueText('tag-gust', undefined, false)).toBe("Gust's turn. Drag: set the wind · Button: calm the wind");
    expect(cueText('tag-nubs', undefined, false)).toBe("Nubs' turn. Drag: turn the sun · Button: Cold Snap");
    expect(cueDuration('tag-sprout', undefined)).toBe(2400);
    expect([cueText('snap-ready', undefined, false), cueText('snap-ready', undefined, true)]).toEqual(['Full! Tap the frost button.', 'Full! Press ↓ for a Cold Snap.']);
  });

  it('Controls v3: driver notes on the cue line: refusal reasons with their numbers, Armed and Growing, the calm cues (§8.2, §13.3)', () => {
    const v = { act: 'snap', fill: 0.427, lockTicks: 100 } as unknown as DriveView;
    expect(noteText(NOTE_REFUSE, REFUSE_CHARGING, v)).toBe('Cold Snap charging · 42%');
    expect(noteText(NOTE_REFUSE, REFUSE_CHARGING + 16, v)).toBe('Cold Snap charging · 42%');
    expect(noteText(NOTE_REFUSE, REFUSE_LOCKED, v)).toBe('Hand-off in 2 s');
    expect([noteText(NOTE_REFUSE, REFUSE_WAIT, v), noteText(NOTE_REFUSE, REFUSE_BUSY, v), noteText(NOTE_PRESS, 1, v)]).toEqual(['Get ready…', 'The snap is on', '']);
    const burn = { ...v, act: 'burn' } as DriveView;
    expect([noteText(NOTE_REFUSE, REFUSE_NOTHING, burn), noteText(NOTE_REFUSE, REFUSE_LOW, burn), noteText(NOTE_REFUSE, REFUSE_FULL, burn), noteText(NOTE_PRESS, 2, burn)]).toEqual([
      'Nothing to burn yet',
      'Low flame: turn the sun onto Ember',
      'Two walls ready',
      'Armed',
    ]);
    const grow = { ...v, act: 'grow' } as DriveView;
    expect([noteText(NOTE_REFUSE, REFUSE_NOTHING, grow), noteText(NOTE_REFUSE, REFUSE_LOW, grow), noteText(NOTE_REFUSE, REFUSE_FULL, grow), noteText(NOTE_PRESS, 3, grow)]).toEqual([
      'Nothing to grow yet',
      'Low sap',
      'Two plants queued',
      'Growing',
    ]);
    const calm = { ...v, act: 'calm' } as DriveView;
    expect([noteText(NOTE_CALM, 0, calm), noteText(NOTE_CALM, 1, calm), noteText(NOTE_CALM, 2, calm), noteText(NOTE_PRESS, 4, calm), noteText(NOTE_SETTLE, 1, calm)]).toEqual([
      '',
      'Calm: saving Lift',
      'The wind is calm',
      '',
      '',
    ]);
    expect(cueText('ctl:Armed', undefined, false)).toBe('Armed');
    expect(cueDuration('ctl:Armed', undefined)).toBe(1600);
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

describe('Journey labels (CAMPAIGN_PLAN §5)', () => {
  it('words the stars, Continue, the chapters and the tiles', () => {
    expect(starsLabel(2)).toBe('2 of 3 stars');
    expect(starsLabel(30, 30)).toBe('30 of 30 stars');
    expect(continueLabel(12)).toBe('Continue · Level 12');
    expect(chapterTitle(2, 'Cobbles')).toBe('Chapter 2 · Cobbles');
    expect(levelTileLabel({ id: 6, name: 'Glass Garden', introduces: 'glare' }, 2, true)).toBe(
      'Level 6, Glass Garden. Teaches Glare: Gazing balls throw light back. Red arcs on the dial are glare. 2 of 3 stars.',
    );
    expect(levelTileLabel({ id: 45, name: 'Quiet Lane', introduces: null }, 0, true)).toBe('Level 45, Quiet Lane. Not passed yet.');
    expect(levelTileLabel({ id: 45, name: 'Quiet Lane', introduces: null }, 0, false)).toBe('Level 45, Quiet Lane. Locked.');
  });

  it('kicks and announces a level', () => {
    expect(campaignKicker({ id: 12, passed: true })).toBe('Level 12 · Passed');
    expect(campaignKicker({ id: 2, passed: false })).toBe('Level 2 · Not passed');
    const stats = { flakes: 0, flakesMelted: 0, crystals: 0, flowers: 0, phews: 0, snow: 0, maxMult: 1, x5HoldBest: 0, cloudRideBest: 0, cloudSeconds: 0, ballsPassedClean: 0, ballGlared: false, gateNoon: false, dayReached: 1, nightsReached: 0, minutes: 360, litTotal: 0, swings: 0, swingChainBest: 0, phewMinChill: 100, minChill: 100 };
    const outcome = { newBest: false, prevBestMinutes: 0, bestEased: false, runSnow: 0, missionSnow: 0, bonusSnow: 0, snowEarned: 0, walletBefore: 0, walletAfter: 0, missions: [], missionsCompleted: [], achievementsUnlocked: [], cosmeticsUnlocked: [], dailyUnlocked: false, toasts: [], pace: null, paceDown: false, recentBestBefore: 0, comfortAfter: 4 };
    const result: RunResult = {
      mode: 'campaign', seed: 1, profile: 3, drain: 40, noonCloud: 0, plan: [], minutes: 360, day: 1, clock: '', stats, hourGlyphs: [], melody: [], assisted: false,
      death: { day: 1, tDay: 0, minutes: 360, time: '12:00 PM', x: 0, y: 0, cause: 'plain', line: 'Melted by You at 11:10 AM.' },
      level: { id: 6, passed: true, stars: 2, introduces: 'glare' },
    };
    const passed: ResultsView = { result, outcome, campaign: { id: 6, name: 'Glass Garden', passed: true, stars: 2, nextId: 7, goalLine: 'Reached the finish · 14 flakes' } };
    expect(resultsAnnouncement(passed)).toBe('Level 6, Glass Garden: passed with 2 of 3 stars. Reached the finish · 14 flakes');
    const failed: ResultsView = { result, outcome, campaign: { id: 6, name: 'Glass Garden', passed: false, stars: 0, nextId: 7, goalLine: 'Not enough flakes: 5 of 8' } };
    expect(resultsAnnouncement(failed)).toBe('Level 6, Glass Garden: not passed. Melted by You at 11:10 AM.');
    // An Elementals Trial says "Trial 3" where a level says "Level 12".
    expect(campaignKicker({ id: 1003, passed: true })).toBe('Trial 3 · Passed');
    const trial: ResultsView = { result, outcome, campaign: { id: 1001, name: 'Kindling', passed: false, stars: 0, nextId: null, goalLine: 'Out before the finish' } };
    expect(resultsAnnouncement(trial)).toBe('Trial 1, Kindling: not passed. Melted by You at 11:10 AM.');
  });
});

describe('v1.4 labels', () => {
  it('words every rarity (meta/gamify rarity rates the items)', () => {
    expect(Object.values(RARITY_LABEL)).toEqual(['Common', 'Rare', 'Epic', 'Legendary']);
  });

});
