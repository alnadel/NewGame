// v1.6 world tricks' payoffs (CORE-2): a flare parry and a glass cluster saved whole each pay frost
// (TUNING.bank.parryH / clusterH hundredths) and a Flow Ring trick (TUNING.ring.trick units,
// docs/V1_6_PLAN.md §2.1-§2.3, §2.5). The Frost Bank and the ring belong to CORE-1 (sim/mechanics.ts,
// sim/nubs.ts); this adapter is the one place the world's tricks reach them.
//
// With the Bank on the frost goes through addFrostH (held during a snap, paid when it ends); with it
// off it falls back to the v1.5 meter (addFrost, 0..1). ringTrick is a no-op with the ring off.

import { TUNING } from '../../config/tuning.ts';
import { addFrost, addFrostH } from './mechanics.ts';
import { ringTrick } from './nubs.ts';
import type { SimState } from './types.ts';

/** Pays a world trick: frost and the ring trick. */
export function payTrick(s: SimState, kind: 'parry' | 'cluster'): void {
  const h = kind === 'parry' ? TUNING.bank.parryH : TUNING.bank.clusterH;
  if (s.world.v16.bank) addFrostH(s, kind, h);
  else addFrost(s, h / 100);
  ringTrick(s, kind, TUNING.ring.trick);
}
