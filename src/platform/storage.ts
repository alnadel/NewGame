// Key-value persistence with a graceful in-memory fallback (TECH_SPEC §12, CRITIQUE #20).
// Every call is guarded: Safari private mode, blocked site data, sandboxed iframes and full quotas
// all degrade to memory instead of throwing, and `degraded` tells the UI to warn once.

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** True when writes are not reaching durable storage (the session's data is memory-only). */
  readonly degraded: boolean;
}

const PROBE_KEY = 'shady.probe';

/**
 * Wraps a Web Storage area (localStorage by default). Values written this session are mirrored in
 * memory, so reads stay consistent even after the backing store starts failing.
 */
class WebStorageAdapter implements StorageAdapter {
  private readonly memory = new Map<string, string>();
  private readonly backing: Storage | null;
  private failed: boolean;

  constructor(backing: Storage | null) {
    this.backing = backing;
    this.failed = backing === null || !probe(backing);
  }

  get degraded(): boolean {
    return this.failed;
  }

  get(key: string): string | null {
    const mem = this.memory.get(key);
    if (mem !== undefined) return mem;
    if (this.failed || !this.backing) return null;
    try {
      return this.backing.getItem(key);
    } catch {
      this.failed = true;
      return null;
    }
  }

  set(key: string, value: string): void {
    this.memory.set(key, value);
    if (this.failed || !this.backing) return;
    try {
      this.backing.setItem(key, value);
    } catch {
      // Quota exceeded or storage revoked mid-session: keep playing from memory.
      this.failed = true;
    }
  }

  remove(key: string): void {
    this.memory.delete(key);
    if (this.failed || !this.backing) return;
    try {
      this.backing.removeItem(key);
    } catch {
      this.failed = true;
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
 * Asks the browser to exempt our storage from eviction (CRITIQUE #20: call after the first
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
