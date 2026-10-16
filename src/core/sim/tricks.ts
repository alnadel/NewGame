// v1.6 world tricks' payoffs (CORE-2): a flare parry and a glass cluster saved whole each pay frost
// (TUNING.bank.parryH / clusterH hundredths) and a Flow Ring trick (TUNING.ring.trick units,
// docs/V1_6_PLAN.md §2.1-§2.3, §2.5). The Frost Bank and the ring belong to CORE-1 (sim/mechanics.ts,
// sim/nubs.ts); this adapter is the one place the world's tricks reach them.
//
// Integration note: until CORE-1's Bank lands this pays through the v1.5 meter (addFrost, 0..1:
// hundredths / 100, nothing while a snap is on) and leaves the ring alone; with the Bank it becomes
// addFrostH(s, kind, H) (banked during a snap) plus the ring trick (ringTrick event, +600 charge).

import { TUNING } from '../../config/tuning.ts';
import { addFrost } from './mechanics.ts';
import type { SimState } from './types.ts';

/** Pays a world trick: frost and the ring trick. */
export function payTrick(s: SimState, kind: 'parry' | 'cluster'): void {
  const h = kind === 'parry' ? TUNING.bank.parryH : TUNING.bank.clusterH;
  addFrost(s, h / 100);
}
