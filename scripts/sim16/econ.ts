// v1.6 economy report (docs/V1_6_PLAN.md §2.1, §2.2, §2.4; CORE-1 owns this file): ring, bank and
// garden metrics and gates for `sim --check`, the `--policy` rows and the `--decisions` mode
// (policies plain/chase/naive/safe, snaps panic/plan). See registry.ts for the hooks.

import type { Sim16Ctx, Sim16Module } from './registry.ts';

export const ECON: Sim16Module = {
  name: 'econ',
  report(ctx: Sim16Ctx): void {
    if (ctx.policy !== null) console.log(`\n--policy ${ctx.policy}: the reactive rows carry it; the policies are not implemented yet (CORE-1, docs/V1_6_PLAN.md §2.2).`);
  },
  modes: {
    async decisions(): Promise<void> {
      console.log('sim --decisions: not implemented yet (CORE-1, docs/V1_6_PLAN.md §2.2).');
    },
  },
};
