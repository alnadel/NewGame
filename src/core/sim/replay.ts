// In-memory input recording and replay (V1_PLAN §1.2: RLE encoding is out of scope for v1).
// Because input.ts quantizes dTheta and release before they reach the sim, a replay of the recorded
// frames reproduces the live run bit for bit.

import { createRun } from './create.ts';
import { step } from './step.ts';
import { VERB_HOLD, VERB_TAP, type InputFrame, type RunConfig, type SimState } from './types.ts';

export interface Replay {
  readonly cfg: RunConfig;
  readonly frames: InputFrame[];
}

export function createReplay(cfg: RunConfig): Replay {
  return { cfg: { ...cfg }, frames: [] };
}

/** Appends a copy of the frame that was just fed to step(). */
export function recordFrame(r: Replay, f: InputFrame): void {
  const c: InputFrame = { dTheta: f.dTheta, down: f.down, downEdge: f.downEdge, upEdge: f.upEdge, release: f.release, key: f.key };
  if (f.snap) c.snap = true;
  // Elementals v2 (§7.9): the verb only when set, its point only with a tap or hold, the steer only when set.
  if (f.verb) {
    c.verb = f.verb;
    if (f.verb === VERB_TAP || f.verb === VERB_HOLD) {
      c.vx = f.vx ?? 0;
      c.vy = f.vy ?? 0;
    }
  }
  if (f.steer) c.steer = f.steer;
  r.frames.push(c);
}

/** Re-runs a recording from scratch. `onStep` sees the state after every tick. */
export function playReplay(r: Replay, onStep?: (s: SimState, i: number) => void): SimState {
  const s = createRun(r.cfg);
  for (let i = 0; i < r.frames.length; i++) {
    step(s, r.frames[i] as InputFrame);
    if (onStep) onStep(s, i);
  }
  return s;
}
