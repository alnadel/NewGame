// What this device has already shown the player (UI-only, never part of the save): the Title's
// unlocked features and the Wardrobe's items, so a newly unlocked one wears a "NEW" mark until it
// is opened. The first read on a device takes everything current as seen (no wall of NEW marks
// after an update); without storage nothing is ever marked new.

import { createStorage } from '../platform/storage.ts';

const storage = createStorage();

export interface SeenSet {
  /** True when `id` is new: current but not seen yet. */
  isNew(id: string): boolean;
  /** Marks ids as seen (persisted). */
  see(...ids: string[]): void;
  /** On the first read on this device, marks `current` as seen; later calls do nothing. */
  init(current: readonly string[]): void;
}

export function seenSet(name: string): SeenSet {
  const key = `shady.ui.seen.${name}`;
  let ids: Set<string> | null = null;
  const load = (): Set<string> | null => {
    if (ids) return ids;
    const raw = storage.get(key);
    ids = raw === null ? null : new Set(raw.split(',').filter(Boolean));
    return ids;
  };
  const save = (): void => storage.set(key, [...(ids ?? [])].join(','));
  return {
    isNew: (id) => !storage.degraded && load() !== null && !(ids as Set<string>).has(id),
    see(...more) {
      const s = load() ?? new Set<string>();
      if (more.every((id) => s.has(id))) return;
      for (const id of more) s.add(id);
      ids = s;
      save();
    },
    init(current) {
      if (load() !== null) return;
      ids = new Set(current);
      save();
    },
  };
}
