import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HourGlyph, RunResult } from '../../src/core/index.ts';
import {
  COMPASS,
  GLYPHS,
  MOON,
  buildShare,
  campaignShareText,
  dailyShareText,
  dayStripLines,
  endlessShareText,
  glyphStrip,
  linkLabel,
  resolveShareBase,
  starText,
} from '../../src/meta/share.ts';
import { decodeChallenge } from '../../src/meta/challenge.ts';
import { shareFiles } from '../../src/platform/share.ts';

const C: HourGlyph = 'cool';
const W: HourGlyph = 'warm';
const H: HourGlyph = 'hot';
const M: HourGlyph = 'melt';

const DAY1: HourGlyph[] = [C, C, C, W, W, H, H, W, C, C, C, C];
const DAY2: HourGlyph[] = [C, C, W, W, H, H, W, W, M];

describe('glyphs', () => {
  it('uses the colorblind-safe V1 glyph set', () => {
    expect(GLYPHS.cool).toBe('❄️');
    expect(GLYPHS.warm).toBe('🟨');
    expect(GLYPHS.hot).toBe('🔥');
    expect(GLYPHS.melt).toBe('💧');
    expect(MOON).toBe('🌙');
    expect(COMPASS).toBe('🧭');
  });

  it('builds a strip with one glyph per hour', () => {
    expect(glyphStrip([C, W, H, M])).toBe('❄️🟨🔥💧');
    expect(glyphStrip([])).toBe('');
  });

  it('ends completed days with a moon and marks assisted runs', () => {
    expect(dayStripLines([[C, C], [W, M]], false)).toEqual(['❄️❄️🌙', '🟨💧']);
    expect(dayStripLines([[C, C], [W, M]], true)).toEqual(['❄️❄️🌙', '🟨💧🧭']);
  });
});

describe('share text', () => {
  it('formats the endless share exactly', () => {
    const text = endlessShareText({
      minutes: 2 * 720 + 520,
      hourGlyphs: [DAY1, DAY1, DAY2],
      snow: 112,
      phews: 4,
      assisted: false,
      forecasts: '☀️🌬️🌡️',
      name: 'Sam',
      link: 'https://shady.example/#c=CODE',
    });
    expect(text).toBe(
      [
        'SHADY: Nubs made it to Day 3 · 2:40 PM ☀️🌬️🌡️',
        '❄️❄️🟨🟨🔥🔥🟨🟨💧',
        'Snow 112 · 4 PHEWs',
        'Beat Sam’s run: https://shady.example/#c=CODE',
      ].join('\n'),
    );
  });

  it('uses the singular for one PHEW and appends the compass when assisted', () => {
    const text = endlessShareText({
      minutes: 300,
      hourGlyphs: [[C, W, W, H, H, M]],
      snow: 9,
      phews: 1,
      assisted: true,
      forecasts: '',
      name: '',
      link: 'L',
    });
    expect(text).toBe('SHADY: Nubs made it to Day 1 · 11:00 AM\n❄️🟨🟨🔥🔥💧🧭\nSnow 9 · 1 PHEW\nBeat my run: L');
  });

  const daily = (par: number | null): string =>
    dailyShareText({
      dailyNumber: 284,
      minutes: 1240,
      tryNumber: 2,
      hourGlyphs: [DAY1, DAY2],
      assisted: false,
      forecasts: '☀️🍂',
      par,
      link: 'https://shady.example/#c=CODE',
    });

  it('formats the daily share exactly, with Snowbot’s par once it is known', () => {
    const head = ['SHADY Daily #284: Day 2 · 2:40 PM (try 2/3) ☀️🍂', '❄️❄️❄️🟨🟨🔥🔥🟨❄️❄️❄️❄️🌙', '❄️❄️🟨🟨🔥🔥🟨🟨💧'];
    expect(daily(null)).toBe([...head, 'https://shady.example/#c=CODE'].join('\n'));
    expect(daily(500).split('\n').at(-2)).toBe('Beat Snowbot’s 2:20 PM ✓');
    expect(daily(1240).split('\n').at(-2)).toBe('Snowbot made Day 2 · 2:40 PM');
    expect(daily(1500).split('\n').at(-2)).toBe('Snowbot made Day 3 · 7:00 AM');
  });

  it('labels unscored daily runs as practice', () => {
    const text = dailyShareText({ dailyNumber: 9, minutes: 30, tryNumber: null, hourGlyphs: [[M]], assisted: false, forecasts: '', par: null, link: 'L' });
    expect(text.split('\n')[0]).toBe('SHADY Daily #9: Day 1 · 6:30 AM (practice)');
  });
});

function result(over: Partial<RunResult>): RunResult {
  return {
    mode: 'endless',
    seed: 123456789,
    profile: 3,
    drain: 55,
    noonCloud: 0,
    plan: [
      { biome: 'oldtown', forecast: 'breezy' },
      { biome: 'meadow', forecast: 'heat' },
    ],
    minutes: 1240,
    day: 2,
    clock: 'Day 2 · 2:40 PM',
    stats: {
      flakes: 30, flakesMelted: 2, crystals: 1, flowers: 8, phews: 2, snow: 61.6, maxMult: 4, x5HoldBest: 0,
      cloudRideBest: 2, cloudSeconds: 3, ballsPassedClean: 2, ballGlared: false, gateNoon: false, dayReached: 2,
      nightsReached: 1, minutes: 1240, litTotal: 3, swings: 2, swingChainBest: 2, phewMinChill: 30,
    },
    death: { day: 2, tDay: 30, minutes: 1240, time: '2:40 PM', x: 0, y: 0, cause: 'plain', line: 'Melted by You at 2:40 PM.' },
    hourGlyphs: [DAY1, DAY2],
    melody: [],
    assisted: false,
    ...over,
  };
}

describe('buildShare', () => {
  it('links an endless run to its seed and rules', () => {
    const p = buildShare(result({}), 'https://shady.example/play/');
    expect(p.challenge).toEqual({ v: 1, k: 'e', seed: 123456789, m: 1240, s: 61, p: 3, dr: 55, nc: 0, pl: 1 });
    expect(p.url?.startsWith('https://shady.example/play/#c=')).toBe(true);
    expect(decodeChallenge(p.url!.split('#c=')[1]!)).toEqual(p.challenge);
    expect(p.text.split('\n')).toEqual([
      'SHADY: Nubs made it to Day 2 · 2:40 PM 🌬️🌡️',
      '❄️❄️🟨🟨🔥🔥🟨🟨💧',
      'Snow 61 · 2 PHEWs',
      `Beat my run: ${p.url}`,
    ]);
  });

  it('carries the name and leaves the forecasts out of runs without a Day Plan', () => {
    const legacy = [
      { biome: 'meadow', forecast: 'clear' },
      { biome: 'oldtown', forecast: 'clear' },
    ] as const;
    const p = buildShare(result({ profile: 2, drain: 40, noonCloud: 1, plan: [...legacy] }), 'https://x/', null, { name: 'Zoë' });
    expect(p.challenge).toEqual({ v: 1, k: 'e', seed: 123456789, m: 1240, s: 61, p: 2, dr: 40, nc: 1, pl: 0, n: 'Zoë' });
    expect(p.text.split('\n')[0]).toBe('SHADY: Nubs made it to Day 2 · 2:40 PM');
    expect(p.text.split('\n').at(-1)).toBe(`Beat Zoë’s run: ${p.url}`);
    // The session knows the world (World.planOn) and can say so.
    expect(buildShare(result({ plan: [...legacy] }), null, null, { plan: true }).text.split('\n')[0]).toBe(
      'SHADY: Nubs made it to Day 2 · 2:40 PM ☀️☀️',
    );
  });

  it('links a daily run to its date', () => {
    const p = buildShare(result({ mode: 'daily', dailyDate: '2026-10-11' }), 'https://shady.example/', 3, { par: 300 });
    expect(p.challenge).toEqual({ v: 1, k: 'd', d: '2026-10-11', m: 1240, s: 61 });
    // Dailies before PLAN_START_DATE keep the v1.0 world: no forecasts.
    expect(p.text.split('\n')[0]).toBe('SHADY Daily #284: Day 2 · 2:40 PM (try 3/3)');
    expect(p.text.split('\n').at(-2)).toBe('Beat Snowbot’s 11:00 AM ✓');
    expect(p.text.split('\n').at(-1)).toBe(p.url);
    const later = buildShare(result({ mode: 'daily', dailyDate: '2026-10-20' }), null, 1);
    expect(later.text.split('\n')[0]).toBe('SHADY Daily #293: Day 2 · 2:40 PM (try 1/3) 🌬️🌡️');
  });

  it('shares a replayed daily challenge as practice', () => {
    const p = buildShare(result({ mode: 'challenge', dailyDate: '2026-10-01' }), 'https://x/', 2);
    expect(p.text.split('\n')[0]).toBe('SHADY Daily #274: Day 2 · 2:40 PM (practice)');
  });

  it('leaves the link line out without a base URL', () => {
    const e = buildShare(result({}), null);
    expect(e.url).toBeNull();
    expect(e.text.split('\n')).toEqual(['SHADY: Nubs made it to Day 2 · 2:40 PM 🌬️🌡️', '❄️❄️🟨🟨🔥🔥🟨🟨💧', 'Snow 61 · 2 PHEWs']);
    const d = buildShare(result({ mode: 'daily', dailyDate: '2026-10-11' }), null, 1);
    expect(d.text.split('\n')).toHaveLength(3);
    expect(d.text).not.toMatch(/#c=|https?:|file:/);
  });
});

describe('postcard link label', () => {
  it('reads as a short address: no scheme, www., code, query, index.html or trailing slash', () => {
    expect(linkLabel('https://alnadel.github.io/NewGame/#c=eyJ2IjoxLCJrIjoiZSIsInNlZWQiOjF9')).toBe('alnadel.github.io/NewGame');
    expect(linkLabel('http://localhost:4173/#c=abc&x=1')).toBe('localhost:4173');
    expect(linkLabel('https://www.shady.example/play/index.html?ref=card#c=abc')).toBe('shady.example/play');
    expect(linkLabel('')).toBe('');
  });
});

describe('canonical share base URL', () => {
  const CONFIGURED = 'https://alnadel.github.io/NewGame/';
  const at = (over: Partial<Parameters<typeof resolveShareBase>[0]>) =>
    resolveShareBase({ protocol: 'https:', origin: 'https://shady.example', pathname: '/play/', native: false, configured: CONFIGURED, ...over });

  it('links a web page to itself', () => {
    expect(at({})).toBe('https://shady.example/play/');
    expect(at({ protocol: 'http:', origin: 'http://localhost:4173', pathname: '/' })).toBe('http://localhost:4173/');
    expect(at({ configured: undefined })).toBe('https://shady.example/play/');
  });

  it('uses the configured URL off the web (file:, capacitor://, native shells)', () => {
    expect(at({ protocol: 'file:', origin: 'null', pathname: '/home/me/dist-single/index.html' })).toBe(CONFIGURED);
    expect(at({ protocol: 'capacitor:', origin: 'capacitor://localhost', pathname: '/' })).toBe(CONFIGURED);
    // Android's Capacitor serves https://localhost: still native, so not a link anyone can open.
    expect(at({ origin: 'https://localhost', pathname: '/', native: true })).toBe(CONFIGURED);
  });

  it('shares no link at all when nothing is configured off the web', () => {
    const base = at({ protocol: 'file:', origin: 'null', pathname: '/x/index.html', configured: '' });
    expect(base).toBeNull();
    expect(at({ protocol: 'file:', origin: 'null', pathname: '/x/index.html', configured: undefined })).toBeNull();
    const p = buildShare(result({}), base);
    expect(p.text).not.toContain('file:');
    expect(p.text).not.toContain('Beat my run');
    expect(p.url).toBeNull();
  });
});

describe('shareFiles', () => {
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'shady-day2-240pm.png', { type: 'image/png' });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** A document whose <a download> clicks are recorded. */
  function stubDocument(): { downloads: string[] } {
    const downloads: string[] = [];
    const noop = (): void => undefined;
    vi.stubGlobal('document', {
      body: { appendChild: noop },
      activeElement: null,
      // The clipboard fallback (a hidden textarea) finds no way to copy.
      execCommand: () => false,
      createElement: () => {
        const el = { href: '', download: '', value: '', style: {}, setAttribute: noop, select: noop, setSelectionRange: noop, remove: noop,
          click: () => downloads.push(el.download) };
        return el;
      },
    });
    return { downloads };
  }

  it('hands the file and text to the share sheet before any await', () => {
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { share, canShare: () => true });
    void shareFiles({ file, text: 'T' });
    // Synchronously, inside the click task (iOS user activation).
    expect(share).toHaveBeenCalledWith({ files: [file], text: 'T' });
  });

  it('reports a dismissed sheet as cancelled', async () => {
    vi.stubGlobal('navigator', { share: () => Promise.reject(new DOMException('no', 'AbortError')), canShare: () => true });
    expect(await shareFiles({ file, text: 'T' })).toBe('cancelled');
  });

  it('downloads the file and copies the text where files cannot be shared', async () => {
    vi.useFakeTimers();
    const { downloads } = stubDocument();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { share: vi.fn(), canShare: () => false, clipboard: { writeText } });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    expect(await shareFiles({ file, text: 'T' })).toBe('saved');
    expect(downloads).toEqual(['shady-day2-240pm.png']);
    expect(writeText).toHaveBeenCalledWith('T');
    vi.advanceTimersByTime(10_000);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('skips the Clipboard API where the permissions policy blocks it (a sandboxed frame)', async () => {
    const { downloads } = stubDocument();
    const doc = globalThis.document as unknown as { featurePolicy: { allowsFeature: (f: string) => boolean }; execCommand: () => boolean };
    doc.featurePolicy = { allowsFeature: (f) => f !== 'clipboard-write' };
    doc.execCommand = () => true;
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { share: vi.fn(), canShare: () => false, clipboard: { writeText } });
    vi.stubGlobal('HTMLElement', class {});
    expect(await shareFiles({ file, text: 'T' })).toBe('saved');
    expect(downloads).toEqual(['shady-day2-240pm.png']);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('still saves when the copy fails', async () => {
    stubDocument();
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    vi.stubGlobal('HTMLElement', class {});
    expect(await shareFiles({ file, text: 'T' })).toBe('saved');
  });
});

describe('Journey share (CAMPAIGN_PLAN §5)', () => {
  it('prints the stars as ★ and ☆', () => {
    expect(starText(0)).toBe('☆☆☆');
    expect(starText(2)).toBe('★★☆');
    expect(starText(3)).toBe('★★★');
    expect(starText(7)).toBe('★★★');
    expect(starText(-1)).toBe('☆☆☆');
  });

  it('formats the level line with the link, and without one', () => {
    expect(campaignShareText({ id: 12, name: 'Glass Garden', stars: 2, link: 'https://shady.example/' })).toBe(
      'SHADY Journey · Level 12 ★★☆ · Glass Garden\nhttps://shady.example/',
    );
    expect(campaignShareText({ id: 1, name: 'First Shade', stars: 3, link: null })).toBe('SHADY Journey · Level 1 ★★★ · First Shade');
  });

  it('buildShare links a level to the plain game address, with no challenge code', () => {
    const r: RunResult = { ...result({}), mode: 'campaign', level: { id: 6, passed: true, stars: 2, introduces: 'glare' } };
    const p = buildShare(r, 'https://shady.example/play/', null, { name: 'Sam' });
    expect(p.challenge).toBeNull();
    expect(p.url).toBe('https://shady.example/play/');
    expect(p.text).toBe('SHADY Journey · Level 6 ★★☆ · Glass Garden\nhttps://shady.example/play/');
    // Not passed: no stars. No base URL: no link line.
    const failed = buildShare({ ...r, level: { id: 6, passed: false, stars: 0, introduces: 'glare' } }, null);
    expect(failed.text).toBe('SHADY Journey · Level 6 ☆☆☆ · Glass Garden');
    expect(failed.url).toBeNull();
  });
});
