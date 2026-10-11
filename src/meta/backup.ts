// Backup codes (V1_PLAN §11.5, CRITIQUE #20): the whole save as base64url JSON, so progress can be
// carried across Safari's 7-day eviction, browser profiles or from a tab into the installed app.

import { formatScore } from '../core/format.ts';
import type { SaveV1 } from './saveTypes.ts';
import { decodeBase64Url, encodeBase64Url } from './base64url.ts';
import { migrate } from './save.ts';

export function exportBackup(save: SaveV1): string {
  return encodeBase64Url(JSON.stringify(save));
}

export type BackupError = 'empty' | 'malformed' | 'future';

export type BackupImport = { ok: true; save: SaveV1 } | { ok: false; error: BackupError };

/** Validates a pasted code through migrate(); whitespace and line breaks from pasting are ignored. */
export function importBackup(code: string, now: number = Date.now()): BackupImport {
  const clean = code.replace(/\s+/g, '');
  if (clean.length === 0) return { ok: false, error: 'empty' };
  const json = decodeBase64Url(clean);
  if (json === null) return { ok: false, error: 'malformed' };
  const result = migrate(json, now);
  if (result.status === 'future') return { ok: false, error: 'future' };
  if (result.status !== 'ok') return { ok: false, error: 'malformed' };
  return { ok: true, save: result.save };
}

export function backupErrorMessage(error: BackupError): string {
  switch (error) {
    case 'empty':
      return 'Paste a backup code first.';
    case 'malformed':
      return "That code doesn't look right. Check it was copied in full.";
    case 'future':
      return 'That code is from a newer version of SHADY. Update the game first.';
  }
}

/** What a valid backup holds, for the Restore confirmation: "Best Day 3 · 2:40 PM, 420 Snow, 6 cosmetics". */
export function backupSummary(save: SaveV1): string {
  const st = save.stats;
  const best = st.bestMinutes > 0 ? `Best ${formatScore(st.bestMinutes)}` : 'No best yet';
  const n = save.unlocks.cosmetics.length;
  return `${best}, ${st.wallet} Snow, ${n} ${n === 1 ? 'cosmetic' : 'cosmetics'}`;
}
