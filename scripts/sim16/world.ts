// v1.6 world and Journey report (docs/V1_6_PLAN.md §2.3, §2.5, §2.6; CORE-2 owns this file): glass,
// flare and Noon Heat metrics and gates for `sim --check`, deaths by hour (`--hours`) and the
// `--bake` mode (levelBake.gen.ts: offers and boss flares). See registry.ts for the hooks.

import type { Sim16Ctx, Sim16Module } from './registry.ts';

export const WORLD: Sim16Module = {
  name: 'world',
  report(ctx: Sim16Ctx): void {
    if (ctx.hours) console.log('\n--hours (deaths by in-game hour): not implemented yet (CORE-2, docs/V1_6_PLAN.md §2.5).');
  },
  modes: {
    async bake(): Promise<void> {
      console.log('sim --bake: not implemented yet (CORE-2, docs/V1_6_PLAN.md §2.5, §2.6).');
    },
  },
};
