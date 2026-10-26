// Controls v3 chips and cues (docs/CONTROLS_V3.md §13.3): the words a refusal, a calm and an accepted
// press show on the cue line and the button's chip. Pure data; '{pct}' and '{s}' are filled by the
// reader (the meter's percent, the seconds to the TAG).

// Pure: the build drops it until a reader ships (UI's branch).
export const CONTROL_TEXT: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
  'refuse.charging': 'Cold Snap charging · {pct}%',
  'refuse.locked': 'Hand-off in {s} s',
  'refuse.wait': 'Get ready…',
  'refuse.busy': 'The snap is on',
  'refuse.nothing.burn': 'Nothing to burn yet',
  'refuse.nothing.grow': 'Nothing to grow yet',
  // A soft cue, not a refusal (§2.3): a Calm press on a calm vane.
  'cue.calm': 'The wind is calm',
  'refuse.low.burn': 'Low flame: turn the sun onto Ember',
  'refuse.low.grow': 'Low sap',
  'refuse.full.burn': 'Two walls ready',
  'refuse.full.grow': 'Two plants queued',
  'vane.rest': 'No weather in reach',
  'cue.armed': 'Armed',
  'cue.growing': 'Growing',
  'cue.ready': 'Cold Snap ready',
  'cue.retryTag': 'Back at the Tag Stone',
});
