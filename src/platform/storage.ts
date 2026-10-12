// Key-value persistence with a graceful in-memory fallback (archive/TECH_SPEC §12, archive/CRITIQUE #20).
// Every call is guarded: Safari private mode, blocked site data, sandboxed iframes and full quotas
// all degrade to memory instead of throwing, and `degraded` tells the UI to warn once.

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** True when the latest write didn't reach durable storage (or there is none): data is memory-only. */
  readonly degraded: boolean;
}

const PROBE_KEY = 'shady.probe';

/**
 * Wraps a Web Storage area (localStorage by default). Values written this session are mirrored in
 * memory, so reads stay consistent even while the backing store fails.
 *
 * - Reads go to the backing store first, so a value another tab or the installed app wrote is
 *   seen; memory answers only when there is no backing store, it throws or holds nothing, or this
 *   adapter's own latest write of that key didn't reach it (memory is newer then).
 * - Every write tries the backing store again (no permanent failure latch: a full quota can free
 *   up), and `degraded` reports whether the latest write failed.
 */
class WebStorageAdapter implements StorageAdapter {
  private readonly memory = new Map<string, string>();
  private readonly backing: Storage | null;
  /** Keys whose latest write reached memory only. */
  private readonly unsynced = new Set<string>();
  private lastWriteFailed: boolean;

  constructor(backing: Storage | null) {
    this.backing = backing;
    this.lastWriteFailed = backing === null || !probe(backing);
  }

  get degraded(): boolean {
    return this.backing === null || this.lastWriteFailed;
  }

  get(key: string): string | null {
    if (this.backing && !this.unsynced.has(key)) {
      try {
        const value = this.backing.getItem(key);
        if (value !== null) return value;
      } catch {
        // Storage revoked or blocked: fall back to what this session wrote.
      }
    }
    return this.memory.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.memory.set(key, value);
    if (!this.backing) return;
    try {
      this.backing.setItem(key, value);
      this.unsynced.delete(key);
      this.lastWriteFailed = false;
    } catch {
      // Quota exceeded or storage revoked mid-session: keep playing from memory, retry next write.
      this.unsynced.add(key);
      this.lastWriteFailed = true;
    }
  }

  remove(key: string): void {
    this.memory.delete(key);
    this.unsynced.delete(key);
    if (!this.backing) return;
    try {
      this.backing.removeItem(key);
    } catch {
      // Nothing else to do: the key is gone from memory either way.
    }
  }
}

function probe(storage: Storage): boolean {
  try {
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Reading `localStorage` itself throws in some sandboxed contexts, so it is looked up defensively. */
function defaultBacking(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Creates the app's storage adapter. Pass a Storage to wrap something other than localStorage,
 * or `null` for a pure in-memory (degraded) store.
 */
export function createStorage(backing: Storage | null | undefined = defaultBacking()): StorageAdapter {
  return new WebStorageAdapter(backing ?? null);
}

/**
 * Asks the browser to exempt our storage from eviction (archive/CRITIQUE #20: call after the first
 * completed run). Resolves false when unsupported or refused; never rejects.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') {
      return false;
    }
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
