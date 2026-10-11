import { describe, expect, it } from 'vitest';
import type { HourGlyph, RunResult } from '../../src/core/sim/events.ts';
import {
  COMPASS,
  GLYPHS,
  MOON,
  buildShare,
  dailyShareText,
  dayStripLines,
  endlessShareText,
  glyphStrip,
  resolveShareBase,
} from '../../src/meta/share.ts';
import { decodeChallenge } from '../../src/meta/challenge.ts';

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
      link: 'https://shady.example/#c=CODE',
    });
    expect(text).toBe(
      [
        'SHADY: Nubs made it to Day 3 · 2:40 PM',
        '❄️❄️🟨🟨🔥🔥🟨🟨💧',
        'Snow 112 · 4 PHEWs',
        'Beat my run: https://shady.example/#c=CODE',
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
      link: 'L',
    });
    expect(text).toBe('SHADY: Nubs made it to Day 1 · 11:00 AM\n❄️🟨🟨🔥🔥💧🧭\nSnow 9 · 1 PHEW\nBeat my run: L');
  });

  it('formats the daily share exactly', () => {
    const text = dailyShareText({
      dailyNumber: 284,
      minutes: 1240,
      tryNumber: 2,
      hourGlyphs: [DAY1, DAY2],
      assisted: false,
      link: 'https://shady.example/#c=CODE',
    });
    expect(text).toBe(
      [
        'SHADY Daily #284: Day 2 · 2:40 PM (try 2/3)',
        '❄️❄️❄️🟨🟨🔥🔥🟨❄️❄️❄️❄️🌙',
        '❄️❄️🟨🟨🔥🔥🟨🟨💧',
        'https://shady.example/#c=CODE',
      ].join('\n'),
    );
  });

  it('labels unscored daily runs as practice', () => {
    const text = dailyShareText({ dailyNumber: 9, minutes: 30, tryNumber: null, hourGlyphs: [[M]], assisted: false, link: 'L' });
    expect(text.split('\n')[0]).toBe('SHADY Daily #9: Day 1 · 6:30 AM (practice)');
  });
});

function result(over: Partial<RunResult>): RunResult {
  return {
    mode: 'endless',
    seed: 123456789,
    profile: 3,
    minutes: 1240,
    day: 2,
    clock: 'Day 2 · 2:40 PM',
    stats: {
      flakes: 30, flakesMelted: 2, crystals: 1, flowers: 8, phews: 2, snow: 61.6, maxMult: 4, x5HoldBest: 0,
      cloudRideBest: 2, cloudSeconds: 3, ballsPassedClean: 2, ballGlared: false, gateNoon: false, dayReached: 2,
      nightsReached: 1, minutes: 1240, litTotal: 3,
    },
    death: { day: 2, tDay: 30, minutes: 1240, time: '2:40 PM', x: 0, y: 0, cause: 'plain', line: 'Melted by You at 2:40 PM.' },
    hourGlyphs: [DAY1, DAY2],
    melody: [],
    assisted: false,
    ...over,
  };
}

describe('buildShare', () => {
  it('links an endless run to its seed', () => {
    const p = buildShare(result({}), 'https://shady.example/play/');
    expect(p.challenge).toEqual({ v: 1, k: 'e', seed: 123456789, m: 1240, s: 61 });
    expect(p.url?.startsWith('https://shady.example/play/#c=')).toBe(true);
    expect(decodeChallenge(p.url!.split('#c=')[1]!)).toEqual(p.challenge);
    expect(p.text.split('\n')).toEqual([
      'SHADY: Nubs made it to Day 2 · 2:40 PM',
      '❄️❄️🟨🟨🔥🔥🟨🟨💧',
      'Snow 61 · 2 PHEWs',
      `Beat my run: ${p.url}`,
    ]);
  });

  it('links a daily run to its date', () => {
    const p = buildShare(result({ mode: 'daily', dailyDate: '2026-10-11' }), 'https://shady.example/', 3);
    expect(p.challenge).toEqual({ v: 1, k: 'd', d: '2026-10-11', m: 1240, s: 61 });
    expect(p.text.split('\n')[0]).toBe('SHADY Daily #284: Day 2 · 2:40 PM (try 3/3)');
    expect(p.text.split('\n').at(-1)).toBe(p.url);
  });

  it('shares a replayed daily challenge as practice', () => {
    const p = buildShare(result({ mode: 'challenge', dailyDate: '2026-10-01' }), 'https://x/', 2);
    expect(p.text.split('\n')[0]).toBe('SHADY Daily #274: Day 2 · 2:40 PM (practice)');
  });

  it('leaves the link line out without a base URL', () => {
    const e = buildShare(result({}), null);
    expect(e.url).toBeNull();
    expect(e.text.split('\n')).toEqual(['SHADY: Nubs made it to Day 2 · 2:40 PM', '❄️❄️🟨🟨🔥🔥🟨🟨💧', 'Snow 61 · 2 PHEWs']);
    const d = buildShare(result({ mode: 'daily', dailyDate: '2026-10-11' }), null, 1);
    expect(d.text.split('\n')).toHaveLength(3);
    expect(d.text).not.toMatch(/#c=|https?:|file:/);
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
