// Golden determinism (split from determinism.test.ts so the suite balances across workers): a
// 3-minute oracle run, a forced run of every forecast and a run at every comfort rung match the
// Node-made goldens (scripts/golden.ts).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { campaignHashes, CHECK_EVERY, forecastHashes, GOLDEN_LEVELS, oracleHashes, rungHashes, SCRIPT_TICKS } from '../../scripts/golden.ts';

const golden = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../golden/hashes.json'), 'utf8'),
) as { oracle3min: string[]; forecasts: Record<string, string>; rungs: string[]; campaign: Record<string, string> };

describe('golden hashes', () => {
  it('a 3-minute oracle run matches the golden hashes (equality with Node-made goldens is the determinism proof)', () => {
    const a = oracleHashes();
    expect(a.length).toBe(SCRIPT_TICKS / CHECK_EVERY);
    expect(a).toEqual(golden.oracle3min);
  }, 60_000);

  it('a forced run of every forecast and a run at every comfort rung match the golden hashes', () => {
    expect(forecastHashes()).toEqual(golden.forecasts);
    expect(rungHashes()).toEqual(golden.rungs);
  }, 60_000);

  it('the oracle on campaign levels 1, 6, 32, 36, 38, 100 and 200 matches the golden hashes (and wins them all)', () => {
    const got = campaignHashes();
    expect(got).toEqual(golden.campaign);
    for (const id of GOLDEN_LEVELS) expect(got[String(id)]?.startsWith('won:'), `level ${id}`).toBe(true);
  }, 120_000);

});
