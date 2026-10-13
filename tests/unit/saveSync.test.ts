// Two instances of the game sharing one save (two tabs, or the Home Screen app next to its browser
// tab), modelled the way Chrome runs localStorage: every tab reads a cache of its own, a write lands
// in the writer's cache and the shared store at once, and reaches the other tab's cache only with
// its storage event, which under load arrives late (QA saw ~440 ms). Events reach a tab in the order
// the writes were made; a tab that wrote a key since keeps its own value in its cache.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_KEEP, SAVE_KEY, SaveStore, defaults, readRevs, type SaveChangeSource } from '../../src/meta/save.ts';
import { buyCosmetic, setDailyPar } from '../../src/meta/progression.ts';
import { mergeSaves } from '../../src/meta/saveMerge.ts';
import type { Save } from '../../src/meta/saveTypes.ts';
import type { StorageAdapter } from '../../src/platform/storage.ts';

const NOW = 1_760_000_000_000;

interface Pending {
  seq: number;
  key: string;
  value: string;
  /** The step from which the event may be delivered (see Browser.lag). */
  due: number;
}

class Browser {
  readonly shared = new Map<string, string>();
  readonly tabs: Tab[] = [];
  seq = 0;
  /** The current step, and how many steps a new event takes to arrive. */
  step = 0;
  lag: () => number = () => 0;
  tab(): Tab {
    const t = new Tab(this, this.tabs.length);
    this.tabs.push(t);
    return t;
  }
  pending(): number {
    return this.tabs.reduce((n, t) => n + t.inbox.length, 0);
  }
  /** Moves to the next step and delivers every event that is due by then. */
  tick(): void {
    this.step++;
    for (const t of this.tabs) while (t.inbox.length > 0 && (t.inbox[0] as Pending).due <= this.step) t.deliver();
  }
  /** Delivers every queued event (and those the deliveries cause) until all tabs are quiet. */
  settle(): void {
    for (let guard = 0; this.pending() > 0; guard++) {
      if (guard > 1000) throw new Error('storage events never settle (write ping-pong)');
      for (const t of this.tabs) t.deliver();
    }
  }
}

class Tab implements SaveChangeSource {
  readonly cache: Map<string, string>;
  readonly inbox: Pending[] = [];
  private readonly ownWrite = new Map<string, number>();
  private readonly cbs: ((key: string | null, value: string | null) => void)[] = [];
  readonly storage: StorageAdapter;
  constructor(
    private readonly browser: Browser,
    readonly id: number,
  ) {
    this.cache = new Map(browser.shared);
    this.storage = {
      get: (key) => this.cache.get(key) ?? null,
      set: (key, value) => {
        const seq = ++browser.seq;
        this.cache.set(key, value);
        this.ownWrite.set(key, seq);
        browser.shared.set(key, value);
        for (const other of browser.tabs) if (other !== this) other.inbox.push({ seq, key, value, due: browser.step + browser.lag() });
      },
      remove: (key) => void this.cache.delete(key),
      degraded: false,
    };
  }
  onStorage(cb: (key: string | null, value: string | null) => void): () => void {
    this.cbs.push(cb);
    return () => undefined;
  }
  onVisible(): () => void {
    return () => undefined;
  }
  /** The oldest queued event reaches this tab: its cache takes the value, then 'storage' fires. */
  deliver(): boolean {
    const ev = this.inbox.shift();
    if (!ev) return false;
    if ((this.ownWrite.get(ev.key) ?? 0) < ev.seq) this.cache.set(ev.key, ev.value);
    for (const cb of [...this.cbs]) cb(ev.key, ev.value);
    return true;
  }
}

let revCounter = 0;
function open(tab: Tab): SaveStore {
  return new SaveStore(tab.storage, { now: () => NOW, changes: tab, newRev: () => (++revCounter).toString(36) });
}

function seedSave(browser: Browser, runs: number): void {
  const s = defaults(NOW);
  s.stats.runs = runs;
  browser.shared.set(SAVE_KEY, JSON.stringify(s));
}

/** A finished endless run, as session.onDeath saves it (set + flush). */
function finishRun(store: SaveStore, minutes: number, snow: number): void {
  store.update((sv) => {
    sv.stats.runs += 1;
    sv.stats.lifetimeSnow += snow;
    sv.stats.wallet += snow;
    sv.stats.bestMinutes = Math.max(sv.stats.bestMinutes, minutes);
    sv.history.push({ m: minutes, s: snow, r: 4, d: '2026-10-13' });
    sv.history = sv.history.slice(-HISTORY_KEEP);
  });
  store.flush();
}

const disk = (b: Browser): Save => JSON.parse(b.shared.get(SAVE_KEY) as string) as Save;

describe('SaveStore across tabs with late storage events', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    revCounter = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("an idle tab's Daily par write never takes back a run the other tab saved (QA race)", () => {
    const browser = new Browser();
    seedSave(browser, 3);
    const tabA = browser.tab();
    const tabB = browser.tab();
    const a = open(tabA);
    const b = open(tabB);
    // B: a run ends (set + flush), then the first-run persistRequested flag (debounced).
    finishRun(b, 400, 20);
    b.update((sv) => {
      sv.flags.persistRequested = true;
    });
    // A's par job finishes before B's event reaches it: its cache still holds runs 3.
    expect(a.get().stats.runs).toBe(3);
    a.set(setDailyPar(a.get(), '2026-10-13', 469));
    a.flush();
    // The shared save now lacks B's run, until B hears of A's write and repairs it.
    expect(disk(browser).stats.runs).toBe(3);
    browser.settle();
    expect(disk(browser).stats.runs).toBe(4);
    expect(disk(browser).pars['2026-10-13']).toBe(469);
    expect(disk(browser).flags.persistRequested).toBe(true);
    expect(a.get().stats.runs).toBe(4);
    expect(b.get().stats.runs).toBe(4);
    // A then plays a run of its own.
    finishRun(a, 500, 10);
    browser.settle();
    vi.advanceTimersByTime(1000);
    browser.settle();
    expect(disk(browser).stats.runs).toBe(5);
    expect(disk(browser).history.map((h) => h.m)).toEqual([400, 500]);
    expect(b.get().stats.runs).toBe(5);
  });

  it('runs ending in both tabs within one event delay both count', () => {
    const browser = new Browser();
    seedSave(browser, 3);
    const a = open(browser.tab());
    const b = open(browser.tab());
    finishRun(a, 300, 5);
    finishRun(b, 600, 7);
    browser.settle();
    for (const s of [disk(browser), a.get(), b.get()]) {
      expect(s.stats.runs).toBe(5);
      expect(s.stats.wallet).toBe(12);
      expect(s.stats.bestMinutes).toBe(600);
      expect(s.history).toHaveLength(2);
    }
  });

  it('a purchase in one tab and a run in the other both survive, and the price is paid once', () => {
    const browser = new Browser();
    const seed = defaults(NOW);
    seed.stats.runs = 3;
    seed.stats.wallet = 500;
    browser.shared.set(SAVE_KEY, JSON.stringify(seed));
    const a = open(browser.tab());
    const b = open(browser.tab());
    const bought = buyCosmetic(b.get(), 'hat-beanie');
    if (!bought.ok) throw new Error('could not buy');
    b.set(bought.save);
    b.flush();
    finishRun(a, 450, 30);
    browser.settle();
    for (const s of [disk(browser), a.get(), b.get()]) {
      expect(s.unlocks.cosmetics).toContain('hat-beanie');
      expect(s.stats.wallet).toBe(500 - 80 + 30);
      expect(s.stats.runs).toBe(4);
    }
  });

  it('a stale event delivered after newer ones changes nothing', () => {
    const browser = new Browser();
    seedSave(browser, 3);
    const tabA = browser.tab();
    const a = open(tabA);
    const b = open(browser.tab());
    finishRun(b, 100, 1);
    const first = browser.shared.get(SAVE_KEY) as string;
    finishRun(b, 200, 2);
    browser.settle();
    const writes = browser.seq;
    // A late duplicate of B's first write: the cache already holds the newer save.
    for (const cb of (tabA as unknown as { cbs: ((k: string, v: string) => void)[] }).cbs) cb(SAVE_KEY, first);
    expect(a.get().stats.runs).toBe(5);
    expect(browser.seq).toBe(writes);
  });

  it('the stored save carries its revisions; a save without them is adopted as it is', () => {
    const browser = new Browser();
    const a = open(browser.tab());
    a.update((sv) => {
      sv.stats.wallet = 9;
    });
    a.flush();
    expect(readRevs(browser.shared.get(SAVE_KEY) as string)).toEqual(['1']);
    expect(readRevs('{"revs":["ok","BAD!",3]}')).toEqual(['ok']);
    expect(readRevs('nope')).toEqual([]);
    // A fresh tab loads it without rewriting (the revisions are not a repair).
    const b = open(browser.tab());
    expect(b.status).toBe('ok');
    b.flush();
    expect(browser.seq).toBe(1);
  });

  /** Two tabs finish runs, buy, set pars and change settings; returns what must have been saved. */
  function play(browser: Browser, stores: SaveStore[], steps: number, rand: (n: number) => number, only?: number) {
    const expected = { runs: 0, wallet: 0, snow: 0, best: 0, bought: [[], []] as string[][] };
    const shop = ['scarf-mint', 'hat-beanie', 'nose-parsnip', 'shades-round', 'scarf-plaid'];
    for (let step = 0; step < steps; step++) {
      const i = only ?? rand(2);
      const store = stores[i] as SaveStore;
      switch (rand(6)) {
        case 0:
        case 1: {
          const m = 300 + rand(900);
          const sn = rand(40);
          finishRun(store, m, sn);
          expected.runs++;
          expected.wallet += sn;
          expected.snow += sn;
          expected.best = Math.max(expected.best, m);
          break;
        }
        case 2: {
          const id = shop[rand(shop.length)] as string;
          const r = buyCosmetic(store.get(), id as never);
          if (r.ok) {
            expected.wallet -= store.get().stats.wallet - r.save.stats.wallet;
            expected.bought[i]?.push(id);
            store.set(r.save);
            store.flush();
          }
          break;
        }
        case 3:
          store.set(setDailyPar(store.get(), `2026-10-${10 + rand(9)}`, 300 + rand(500)));
          store.flush();
          break;
        case 4:
          store.update((sv) => {
            sv.settings.music = rand(11) / 10;
          });
          break;
        default:
          vi.advanceTimersByTime(rand(500));
      }
      browser.tick();
    }
    return expected;
  }

  function settleAll(browser: Browser): void {
    for (let k = 0; k < 3; k++) {
      vi.advanceTimersByTime(1000);
      browser.settle();
    }
  }

  // Seeded fuzz: storage events arrive up to 8 steps late (several runs and purchases apart).
  for (let seed = 1; seed <= 24; seed++) {
    it(`fuzz ${seed}: every run and every Snow spent or earned is counted once`, () => {
      let x = seed * 2654435761;
      const rand = (n: number): number => {
        x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
        return x % n;
      };
      const browser = new Browser();
      browser.lag = () => rand(9);
      const start = defaults(NOW);
      start.stats.runs = 3;
      // Enough that two tabs buying the whole shop at once can't overdraw (the wallet stops at 0).
      start.stats.wallet = 2000;
      browser.shared.set(SAVE_KEY, JSON.stringify(start));
      const tabs = [browser.tab(), browser.tab()];
      const stores = tabs.map(open);
      const e = play(browser, stores, 150, rand);
      settleAll(browser);
      const final = disk(browser);
      expect(final.stats.runs).toBe(3 + e.runs);
      expect(final.stats.lifetimeSnow).toBe(e.snow);
      expect(final.stats.wallet).toBe(2000 + e.wallet);
      expect(final.stats.bestMinutes).toBe(e.best);
      expect(final.history).toHaveLength(Math.min(HISTORY_KEEP, e.runs));
      for (const id of [...(e.bought[0] ?? []), ...(e.bought[1] ?? [])]) expect(final.unlocks.cosmetics).toContain(id);
      for (const s of stores) expect(JSON.stringify(s.get())).toBe(JSON.stringify({ ...final, revs: undefined }));
    });
  }

  it('tabs that lost track of each other (one heard nothing for 60 writes) still keep both sides\' progress', () => {
    let x = 7;
    const rand = (n: number): number => {
      x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
      return x % n;
    };
    const browser = new Browser();
    const start = defaults(NOW);
    start.stats.runs = 3;
    start.stats.wallet = 1000;
    browser.shared.set(SAVE_KEY, JSON.stringify(start));
    const tabs = [browser.tab(), browser.tab()];
    const stores = tabs.map(open);
    browser.lag = () => 1000;
    const e0 = play(browser, stores, 30, rand, 0);
    const e1 = play(browser, stores, 60, rand, 1);
    settleAll(browser);
    const final = disk(browser);
    expect(final.stats.runs).toBeGreaterThanOrEqual(3 + Math.max(e0.runs, e1.runs));
    expect(final.stats.runs).toBeLessThanOrEqual(3 + e0.runs + e1.runs);
    expect(final.stats.bestMinutes).toBe(Math.max(e0.best, e1.best));
    for (const id of [...(e0.bought[0] ?? []), ...(e1.bought[1] ?? [])]) expect(final.unlocks.cosmetics).toContain(id);
    for (const s of stores) expect(JSON.stringify(s.get())).toBe(JSON.stringify({ ...final, revs: undefined }));
  });
});

describe('mergeSaves', () => {
  it('takes the side that changed, adds both sides\' counters and keeps both sides\' new runs', () => {
    const base = defaults(NOW);
    base.stats.runs = 5;
    base.history = [{ m: 100, s: 1, r: 4, d: '2026-10-10' }];
    const local = structuredClone(base);
    const remote = structuredClone(base);
    local.stats.runs = 6;
    local.history.push({ m: 200, s: 2, r: 4, d: '2026-10-12' });
    local.settings.music = 0.2;
    remote.stats.runs = 7;
    remote.history.push({ m: 300, s: 3, r: 4, d: '2026-10-11' }, { m: 310, s: 3, r: 4, d: '2026-10-12' });
    remote.pars['2026-10-12'] = 444;
    remote.daily['2026-10-12'] = { tries: 1, bestMinutes: 500, bestSnow: 4, glyphs: 'r' };
    local.daily['2026-10-12'] = { tries: 1, bestMinutes: 450, bestSnow: 9, glyphs: 'l' };
    const m = mergeSaves(base, local, remote);
    expect(m.stats.runs).toBe(8);
    expect(m.settings.music).toBe(0.2);
    expect(m.pars['2026-10-12']).toBe(444);
    expect(m.daily['2026-10-12']).toEqual({ tries: 2, bestMinutes: 500, bestSnow: 9, glyphs: 'r' });
    expect(m.history.map((h) => h.m)).toEqual([100, 300, 200, 310]);
  });

  it('a reset on one side stays a reset, apart from the other side\'s new progress', () => {
    const base = defaults(NOW);
    base.stats.runs = 9;
    base.unlocks.cosmetics.push('hat-beanie');
    base.history = [{ m: 100, s: 1, r: 4, d: '2026-10-10' }];
    const local = defaults(NOW);
    const remote = structuredClone(base);
    remote.pars['2026-10-13'] = 400;
    const m = mergeSaves(base, local, remote);
    expect(m.stats.runs).toBe(0);
    expect(m.unlocks.cosmetics).not.toContain('hat-beanie');
    expect(m.history).toEqual([]);
    expect(m.pars['2026-10-13']).toBe(400);
  });
});
