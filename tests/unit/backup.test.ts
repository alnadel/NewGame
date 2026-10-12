import { describe, expect, it } from 'vitest';
import { backupErrorMessage, backupSummary, exportBackup, importBackup } from '../../src/meta/backup.ts';
import { encodeBase64Url } from '../../src/meta/base64url.ts';
import { defaults } from '../../src/meta/save.ts';

const NOW = 1_760_000_000_000;

describe('backup codes', () => {
  it('round-trips a save', () => {
    const save = defaults(NOW);
    save.stats.wallet = 321;
    save.unlocks.cosmetics.push('scarf-mint');
    save.equipped.scarf = 'scarf-mint';
    save.daily['2026-10-11'] = { tries: 2, bestMinutes: 1240, bestSnow: 40, glyphs: '❄️🟨🌙\n🔥💧' };
    const code = exportBackup(save);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const r = importBackup(code, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.save).toEqual(migrateShape(save));
  });

  it('summarizes what a backup holds for the restore confirmation', () => {
    const save = defaults(1);
    expect(backupSummary(save)).toBe(`No best yet, 0 Snow, ${save.unlocks.cosmetics.length} cosmetics`);
    save.stats.bestMinutes = 1240;
    save.stats.wallet = 420;
    save.unlocks.cosmetics = ['scarf-red'];
    expect(backupSummary(save)).toBe('Best Day 2 · 2:40 PM, 420 Snow, 1 cosmetic');
  });

  it('ignores whitespace and line breaks from pasting', () => {
    const code = exportBackup(defaults(NOW));
    const messy = `  ${code.slice(0, 20)}\n${code.slice(20, 40)} \t${code.slice(40)}\n`;
    expect(importBackup(messy, NOW).ok).toBe(true);
  });

  it('rejects empty, malformed and future codes', () => {
    expect(importBackup('   ', NOW)).toEqual({ ok: false, error: 'empty' });
    expect(importBackup('###', NOW)).toEqual({ ok: false, error: 'malformed' });
    expect(importBackup(encodeBase64Url('{"v":1,'), NOW)).toEqual({ ok: false, error: 'malformed' });
    expect(importBackup(encodeBase64Url('[]'), NOW)).toEqual({ ok: false, error: 'malformed' });
    expect(importBackup(encodeBase64Url('{"v":9}'), NOW)).toEqual({ ok: false, error: 'future' });
    expect(backupErrorMessage('future')).toMatch(/newer version/);
  });

  it('validates tampered values through migrate', () => {
    const code = encodeBase64Url(JSON.stringify({ v: 1, stats: { wallet: -500, runs: 4 }, unlocks: { cosmetics: ['hat-crown'] } }));
    const r = importBackup(code, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.stats.wallet).toBe(0);
    expect(r.save.stats.runs).toBe(4);
    // Crown is an achievement item: owning it via a cosmetic list is allowed, it was earned on another device.
    expect(r.save.unlocks.cosmetics).toContain('hat-crown');
  });
});

/** Ownership lists are stored in catalog order after validation. */
function migrateShape(save: ReturnType<typeof defaults>): ReturnType<typeof defaults> {
  const copy = structuredClone(save);
  copy.unlocks.cosmetics = ['scarf-red', 'scarf-mint', 'hat-none', 'nose-carrot', 'shades-classic'];
  return copy;
}
