import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  challengeVerdict,
  challengeFromHash,
  challengeUrl,
  decodeChallenge,
  encodeChallenge,
  type Challenge,
} from '../../src/meta/challenge.ts';
import { decodeBase64Url, encodeBase64Url } from '../../src/meta/base64url.ts';

describe('challenge codes', () => {
  it('round-trips endless and daily challenges', () => {
    const cases: Challenge[] = [
      { v: 1, k: 'e', seed: 123456789, m: 1240, s: 112 },
      { v: 1, k: 'e', seed: 0xffffffff, m: 0, s: 0 },
      { v: 1, k: 'd', d: '2026-10-11', m: 1240, s: 112 },
    ];
    for (const c of cases) expect(decodeChallenge(encodeChallenge(c))).toEqual(c);
  });

  it('encodes compact JSON in a fixed key order as unpadded base64url', () => {
    const code = encodeChallenge({ v: 1, k: 'd', d: '2026-10-11', m: 1240, s: 112 });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeBase64Url(code)).toBe('{"v":1,"k":"d","d":"2026-10-11","m":1240,"s":112}');
    const e = encodeChallenge({ s: 5, m: 1240, seed: 7, k: 'e', v: 1 });
    expect(decodeBase64Url(e)).toBe('{"v":1,"k":"e","seed":7,"m":1240,"s":5}');
  });

  it('rejects malformed codes', () => {
    const bad = [
      '',
      '!!!!',
      'abcde', // length ≡ 1 mod 4
      encodeBase64Url('not json'),
      encodeBase64Url('[1,2]'),
      encodeBase64Url('null'),
      encodeBase64Url('{"v":2,"k":"e","seed":1,"m":1,"s":1}'),
      encodeBase64Url('{"v":1,"k":"x","seed":1,"m":1,"s":1}'),
      encodeBase64Url('{"v":1,"k":"e","seed":-1,"m":1,"s":1}'),
      encodeBase64Url('{"v":1,"k":"e","seed":1.5,"m":1,"s":1}'),
      encodeBase64Url('{"v":1,"k":"e","seed":4294967296,"m":1,"s":1}'),
      encodeBase64Url('{"v":1,"k":"e","seed":"1","m":1,"s":1}'),
      encodeBase64Url('{"v":1,"k":"e","seed":1,"m":-3,"s":1}'),
      encodeBase64Url('{"v":1,"k":"e","seed":1,"m":1}'),
      encodeBase64Url('{"v":1,"k":"d","d":"2026-02-30","m":1,"s":1}'),
      encodeBase64Url('{"v":1,"k":"d","m":1,"s":1}'),
      'A'.repeat(400),
    ];
    for (const code of bad) expect(decodeChallenge(code), code).toBeNull();
  });

  describe('daily dates', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Local noon on 2026-10-11 (Daily #284).
      vi.setSystemTime(new Date(2026, 9, 11, 12, 0, 0));
    });
    afterEach(() => vi.useRealTimers());

    const code = (d: string): string => encodeChallenge({ v: 1, k: 'd', d, m: 1240, s: 3 });

    it('accepts Daily #1 up to tomorrow', () => {
      for (const d of ['2026-10-11', '2026-10-10', '2026-10-12', '2026-01-01']) {
        expect(decodeChallenge(code(d)), d).toEqual({ v: 1, k: 'd', d, m: 1240, s: 3 });
      }
    });

    it('rejects dates before Daily #1 or after tomorrow', () => {
      for (const d of ['0100-01-01', '9999-12-31', '2027-06-01', '2026-10-13', '2025-12-31']) {
        expect(decodeChallenge(code(d)), d).toBeNull();
        expect(challengeFromHash(`#c=${code(d)}`), d).toBeNull();
      }
    });

    it('takes the bounding date as a parameter', () => {
      expect(decodeChallenge(code('2027-06-01'), '2027-06-01')).not.toBeNull();
      expect(decodeChallenge(code('2027-06-02'), '2027-06-01')).not.toBeNull();
      expect(decodeChallenge(code('2027-06-03'), '2027-06-01')).toBeNull();
    });
  });

  it('reads the code from a location hash', () => {
    const c: Challenge = { v: 1, k: 'e', seed: 99, m: 1240, s: 3 };
    const code = encodeChallenge(c);
    expect(challengeFromHash(`#c=${code}`)).toEqual(c);
    expect(challengeFromHash(`#debug=1&c=${code}`)).toEqual(c);
    expect(challengeFromHash(`c=${code}`)).toEqual(c);
    expect(challengeFromHash('')).toBeNull();
    expect(challengeFromHash('#c=garbage!')).toBeNull();
  });

  it('builds links as <origin><path>#c=<code>', () => {
    const c: Challenge = { v: 1, k: 'e', seed: 1, m: 2, s: 3 };
    expect(challengeUrl('https://a.example/shady/', c)).toBe(`https://a.example/shady/#c=${encodeChallenge(c)}`);
    expect(challengeUrl('https://a.example/#c=old', c)).toBe(`https://a.example/#c=${encodeChallenge(c)}`);
  });
});

describe('challenge verdict (Results)', () => {
  it('names the target across days and gives a clock gap only on its own day', () => {
    // Day 2 · 2:40 PM is 1240.
    expect(challengeVerdict(23, 1240)).toEqual({ text: 'Short of the target: Day 2 · 2:40 PM', win: false });
    expect(challengeVerdict(1200, 1240)).toEqual({ text: '40 min short of 2:40 PM on Day 2', win: false });
    expect(challengeVerdict(1240 - 137, 1240)).toEqual({ text: '2 h 17 min short of 2:40 PM on Day 2', win: false });
    expect(challengeVerdict(1240, 1240)).toEqual({ text: 'Dead heat with Day 2 · 2:40 PM!', win: true });
    expect(challengeVerdict(1265, 1240)).toEqual({ text: 'Beat Day 2 · 2:40 PM by 25 min!', win: true });
    expect(challengeVerdict(1500, 1240)).toEqual({ text: 'Beat Day 2 · 2:40 PM!', win: true });
  });
});

describe('base64url', () => {
  it('is UTF-8 safe', () => {
    const text = 'Nubs ❄️🟨🔥💧🌙 · ü';
    expect(decodeBase64Url(encodeBase64Url(text))).toBe(text);
  });
});
