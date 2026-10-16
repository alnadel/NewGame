// v1.6 Dares in the sim (docs/V1_6_PLAN.md §2.6; CORE-2 owns this file): the RunStats Dare
// counters (deepTicks, earnedSnapSavedTicks, cloudsRidden, gateDeep, flipTicks, lock and gust
// windows) and the `feat` / `featMet` events of a campaign level's Dares (LevelDef.feats, counted by
// featValue in config/campaign.ts). Per-tick work must stay allocation-free (events excepted).

import type { SimState } from './types.ts';

/** Called by step() every running tick after passObjects. Contract stub: no-op. */
export function updateFeats(_s: SimState): void {}
