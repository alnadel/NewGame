// Safe-area insets (notch, home indicator, rounded corners) in CSS px (archive/TECH_SPEC §9.1).
//
// The real values come from the #safe-probe element in index.html, whose padding is
// env(safe-area-inset-*). For layout testing, `simulateSafeArea` sets the --safe-* custom properties
// on <html>; ui.css lays out with those properties and readSafeArea honours them too, so the DOM UI
// and the canvas HUD always agree.

import { onViewportChange, type Unsubscribe } from './lifecycle.ts';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const PX_RE = /^\s*(\d+(?:\.\d+)?)px\s*$/;

/** A simulated inset set via `--safe-<side>: <n>px` on <html>, if any. */
function override(side: (typeof SIDES)[number]): number | null {
  const m = PX_RE.exec(document.documentElement.style.getPropertyValue(`--safe-${side}`));
  return m ? Number(m[1]) : null;
}

/** Current insets; zeros when the probe is missing (e.g. a test page). */
export function readSafeArea(probe: HTMLElement | null = document.getElementById('safe-probe')): Insets {
  const out: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const style = probe ? getComputedStyle(probe) : null;
  for (const side of SIDES) {
    const simulated = override(side);
    const measured = style ? parseFloat(style.getPropertyValue(`padding-${side}`)) : 0;
    out[side] = simulated ?? (Number.isFinite(measured) ? measured : 0);
  }
  return out;
}

/** Calls back with fresh insets whenever they change (rotation, resize, simulation). */
export function onSafeAreaChange(cb: (insets: Insets) => void): Unsubscribe {
  let last = readSafeArea();
  return onViewportChange(() => {
    const next = readSafeArea();
    if (SIDES.some((s) => next[s] !== last[s])) {
      last = next;
      cb(next);
    }
  });
}

/**
 * Simulates insets (e.g. a 47 px notch) for layout review; pass null to return to the real values.
 * Fires a resize event so listeners re-read.
 */
export function simulateSafeArea(insets: Partial<Insets> | null): void {
  const style = document.documentElement.style;
  for (const side of SIDES) {
    const v = insets?.[side];
    if (v === undefined) style.removeProperty(`--safe-${side}`);
    else style.setProperty(`--safe-${side}`, `${v}px`);
  }
  window.dispatchEvent(new Event('resize'));
}
