// Local fallbacks for v1.1 contracts that the core and uiMeta batches provide (docs/V1_1_BUILD.md
// CC-n / A-n). Each one has the contract's exact signature; integration replaces every
// `V11-SHIM` with the real import (grep -rn V11-SHIM src tests must come back empty) and deletes
// this file.

import type { DayParams } from '../core/index.ts';

// V11-SHIM: CC-3 — `export type ForecastId` from src/core/index.ts.
export type ForecastId = 'clear' | 'breezy' | 'overcast' | 'heat' | 'long' | 'dazzle' | 'market';

// V11-SHIM: CC-3 — `DayParams.forecast: ForecastId` (read as `s.params.forecast`).
export function forecastOf(p: DayParams): ForecastId {
  return (p as DayParams & { forecast?: ForecastId }).forecast ?? 'clear';
}
