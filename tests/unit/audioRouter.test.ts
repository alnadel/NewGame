import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/core/sim/events.ts';
import type { SfxName, SfxParams } from '../../src/audio/recipes.ts';
import { createAudioView } from '../../src/audio/scene.ts';
import type { AudioView, Scene } from '../../src/audio/scene.ts';
import { DUCKS, SfxRouter } from '../../src/audio/sfxRouter.ts';

interface Played {
  name: SfxName;
  params: SfxParams;
  quantize: boolean;
  at: number;
}

/** A router wired to a recording output and a hand-driven millisecond clock. */
function setup(patch: Partial<AudioView> = {}) {
  const played: Played[] = [];
  const scenes: Scene[] = [];
  let now = 1000;
  const router = new SfxRouter(
    {
      play: (name, params, quantize) => played.push({ name, params, quantize, at: now }),
      applyScene: (scene) => scenes.push({ ...scene }),
    },
    () => now,
  );
  const view: AudioView = Object.assign(createAudioView(), { screen: 'play', phase: 'day', tDay: 10, dayLength: 50, eps: 30 }, patch);
  return {
    router,
    view,
    played,
    scenes,
    names: () => played.map((p) => p.name),
    advance(ms: number) {
      now += ms;
    },
    /** Sends one event per `everyMs` for `count` events. */
    stream(count: number, everyMs: number, make: (i: number) => SimEvent) {
      for (let i = 0; i < count; i++) {
        router.onEvents([make(i)], view);
        now += everyMs;
      }
    },
    /** Runs update() at 60 fps for `seconds`. */
    frames(seconds: number) {
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        router.update(view, 1 / 60);
        now += 1000 / 60;
      }
    },
  };
}

describe('SfxRouter events', () => {
  it('throttles detents to ≥ 50 ms apart and ≤ 20/s, softer when spinning fast', () => {
    const t = setup({ omega: 600 });
    t.stream(100, 10, (i) => ({ e: 'detent', dir: 1, index: i % 24 }));
    const clicks = t.played.filter((p) => p.name === 'detent');
    expect(clicks.length).toBeLessThanOrEqual(20);
    expect(clicks.length).toBeGreaterThanOrEqual(15);
    for (let i = 1; i < clicks.length; i++) expect((clicks[i] as Played).at - (clicks[i - 1] as Played).at).toBeGreaterThanOrEqual(50);
    expect(clicks[0]?.params.gain).toBeCloseTo(0.6, 6);
    const slow = setup({ omega: 0 });
    slow.router.onEvents([{ e: 'detent', dir: -1, index: 3 }], slow.view);
    expect(slow.played[0]?.params).toMatchObject({ index: 3, gain: 1 });
  });

  it('quantizes flake bells to the grid with their degree, at most 12/s', () => {
    const t = setup({ day: 3 });
    t.stream(30, 33, (i) => ({ e: 'flake', mult: 2, degree: i % 10, x: 0, y: 0, snow: 2 }));
    const bells = t.played.filter((p) => p.name === 'bell');
    expect(bells.length).toBe(12);
    expect(bells.every((b) => b.quantize)).toBe(true);
    expect(bells[0]?.params).toMatchObject({ day: 3, degree: 0 });
  });

  it('limits the melt "tss" to 3/s', () => {
    const t = setup();
    t.stream(10, 100, () => ({ e: 'flakeMelt', x: 0, y: 0 }));
    expect(t.names().filter((n) => n === 'melt').length).toBe(3);
  });

  it('only sighs "ahh" after at least 0.25 s lit', () => {
    const t = setup();
    t.router.onEvents([{ e: 'shadeEnter', litFor: 0.1 }], t.view);
    expect(t.played).toHaveLength(0);
    t.router.onEvents([{ e: 'shadeEnter', litFor: 0.3 }], t.view);
    expect(t.names()).toEqual(['ahh']);
  });

  it('maps the multiplier events', () => {
    const t = setup();
    t.router.onEvents([{ e: 'multUp', level: 4 }, { e: 'multReset', from: 1 }, { e: 'multReset', from: 3 }], t.view);
    expect(t.names()).toEqual(['multUp', 'multReset']);
    expect(t.played[0]?.params.level).toBe(4);
  });

  it('plays the dawn fanfare in the new day’s key and ducks the music for 1 s', () => {
    const t = setup({ day: 1 });
    t.router.onEvents([{ e: 'dawn', day: 2 }], t.view);
    expect(t.played[0]).toMatchObject({ name: 'dayFanfare', params: { day: 2 } });
    t.frames(0.9);
    expect(t.scenes.at(-1)?.duck).toBe(0.6);
    t.frames(0.2);
    expect(t.scenes.at(-1)?.duck).toBe(1);
  });

  it('dips the music under a lowpass for the 350 ms PHEW slow-mo', () => {
    const t = setup();
    t.router.onEvents([{ e: 'phew' }], t.view);
    expect(t.names()).toEqual(['phew']);
    t.frames(0.3);
    expect(t.scenes.at(-1)?.muffle).toBeLessThanOrEqual(1100);
    t.frames(0.1);
    expect(t.scenes.at(-1)?.muffle).toBeGreaterThan(10000);
  });

  it('climbs the pentatonic scale with each night’s frost flowers', () => {
    const t = setup({ phase: 'night' });
    t.stream(6, 300, () => ({ e: 'flower', x: 0, y: 0, snow: 2 }));
    expect(t.played.map((p) => p.params.degree)).toEqual([0, 1, 2, 3, 4, 0]);
    expect(t.played.every((p) => p.quantize)).toBe(true);
    t.router.onEvents([{ e: 'nightStart', day: 2 }, { e: 'flower', x: 0, y: 0, snow: 2 }], t.view);
    expect(t.played.at(-1)?.params.degree).toBe(0);
    expect(t.played.at(-2)?.name).toBe('nightfall');
  });

  it('maps the remaining cues (a gate arch rings) and keeps bookkeeping events silent', () => {
    const t = setup();
    const events: SimEvent[] = [
      { e: 'start' },
      { e: 'catch', omega: 200 },
      { e: 'crystal', mult: 2, x: 0, y: 0, snow: 10 },
      { e: 'shadeExit' },
      { e: 'noonBanner' },
      { e: 'noonPassed' },
      { e: 'cloudCapture', id: 4 },
      { e: 'glareTouch', ballId: 2 },
      { e: 'lowChill' },
      { e: 'hourEnd', day: 1, hour: 3, glyph: 'cool' },
      { e: 'gateArch', noon: true, snow: 0 },
      { e: 'ballPassed', clean: true },
    ];
    t.router.onEvents(events, t.view);
    expect(t.names()).toEqual(['catch', 'crystal', 'noon', 'noonPassed', 'cloud', 'glare', 'gate']);
  });

  it('gives every Elementals event a cue or an explicit silence', () => {
    const t = setup();
    const play = (ev: SimEvent): string[] => {
      t.played.length = 0;
      t.advance(500);
      t.router.onEvents([ev], t.view);
      return t.names();
    };
    expect(play({ e: 'ability', hero: 'ember', kind: 'blaze', x: 0, y: 0 })).toEqual(['blaze']);
    expect(play({ e: 'ability', hero: 'sprout', kind: 'seed', x: 0, y: 0 })).toEqual(['seed']);
    expect(play({ e: 'ability', hero: 'drip', kind: 'rain', x: 0, y: 0 })).toEqual(['rain']);
    // A THUNDERCLAP sounds through its strike event.
    expect(play({ e: 'ability', hero: 'volt', kind: 'thunder', x: 0, y: 0 })).toEqual([]);
    expect(play({ e: 'abilityEnd', kind: 'blaze' })).toEqual(['snapEnd']);
    expect(play({ e: 'tagSoon', to: 'drip', ticks: 90 })).toEqual(['detent']);
    expect(play({ e: 'tag', from: 'ember', to: 'drip', index: 1 })).toEqual(['tag']);
    expect(play({ e: 'tagClean', to: 'drip' })).toEqual(['phew']);
    // The flake's bell rings from its own event; Ember hisses, the others add nothing.
    expect(play({ e: 'heroPickup', hero: 'ember', delta: -5, x: 0, y: 0 })).toEqual(['snapEnd']);
    expect(play({ e: 'heroPickup', hero: 'sprout', delta: 5, x: 0, y: 0 })).toEqual([]);
  });

  it('climbs the pentatonic scale with Volt\'s strike chain, a THUNDERCLAP louder', () => {
    const t = setup();
    for (let chain = 1; chain <= 7; chain++) {
      t.router.onEvents([{ e: 'strike', chain, gain: chain, thunder: false, x: 0, y: 0 }], t.view);
      t.advance(400);
    }
    t.router.onEvents([{ e: 'strike', chain: 0, gain: 4, thunder: true, x: 0, y: 0 }], t.view);
    const strikes = t.played.filter((p) => p.name === 'strike');
    expect(strikes.map((p) => p.params.degree)).toEqual([2, 3, 4, 5, 6, 6, 6, 1]);
    expect(strikes.at(-1)?.params.gain).toBeGreaterThan(strikes[0]?.params.gain as number);
  });

  it('beats the heartbeat from a hero\'s health when the view has one', () => {
    const t = setup({ chill: 90, health: 8 });
    t.frames(1);
    expect(t.names()).toContain('heartbeat');
  });

  it('plays the death sweep on death', () => {
    const t = setup();
    const info = { day: 1, tDay: 20, minutes: 288, time: '10:48 AM', x: 0, y: 0, cause: 'plain' as const, line: 'Melted by You at 10:48 AM.' };
    t.router.onEvents([{ e: 'death', info }], t.view);
    expect(t.names()).toEqual(['death']);
  });

  it('resetRun clears the throttles', () => {
    const t = setup();
    t.stream(3, 10, () => ({ e: 'flakeMelt', x: 0, y: 0 }));
    t.router.onEvents([{ e: 'flakeMelt', x: 0, y: 0 }], t.view);
    expect(t.played).toHaveLength(3);
    t.router.resetRun();
    t.router.onEvents([{ e: 'flakeMelt', x: 0, y: 0 }], t.view);
    expect(t.played).toHaveLength(4);
  });
});

describe('SfxRouter campaign', () => {
  it('plays the win jingle tiered by stars, or the soft miss sting, and ducks the score under it', () => {
    const t = setup({ day: 2 });
    t.router.onEvents([{ e: 'levelWon', passed: true, stars: 3, flakes: 9, minChill: 80 }], t.view);
    expect(t.played[0]).toMatchObject({ name: 'levelWin', params: { day: 2, level: 3 } });
    t.frames(2);
    expect(t.scenes.at(-1)?.duck).toBe(DUCKS.levelWin?.[0]);
    t.frames(0.6);
    expect(t.scenes.at(-1)?.duck).toBe(1);
    t.router.onEvents([{ e: 'levelWon', passed: false, stars: 0, flakes: 1, minChill: 5 }], t.view);
    expect(t.names().at(-1)).toBe('levelFail');
  });

  it('ducks direct plays too, never lifting a deeper duck', () => {
    const t = setup();
    t.router.cue('levelWin', { level: 1 });
    t.router.cue('dayFanfare', { day: 2 });
    t.frames(0.1);
    expect(t.scenes.at(-1)?.duck).toBe(DUCKS.levelWin?.[0]);
    t.router.cue('uiTap');
    expect(t.names()).toEqual(['levelWin', 'dayFanfare', 'uiTap']);
  });

  it('turns concept edges into signatures: gust, lock and unlock, eclipse, the final stretch (once each)', () => {
    const t = setup({ progress: 0.5 });
    t.frames(0.1);
    expect(t.played).toHaveLength(0);
    Object.assign(t.view, { gust: -1, locked: true, eclipse: 0.1, progress: 0.9 });
    t.frames(0.5);
    expect(t.names()).toEqual(['gust', 'lock', 'eclipse', 'finishNear']);
    expect(t.played[0]?.params.index).toBe(-1);
    expect(t.played[1]?.params.index).toBe(0);
    Object.assign(t.view, { gust: 0, locked: false });
    t.frames(0.1);
    expect(t.names().at(-1)).toBe('lock');
    expect(t.played.at(-1)?.params.index).toBe(1);
    // A gust that blows again within a second stays quiet.
    t.view.gust = 1;
    t.frames(0.1);
    expect(t.names().filter((n) => n === 'gust')).toHaveLength(1);
  });

  it('keeps concept cues off the Title and menus, and re-arms the finish line per run', () => {
    const t = setup({ screen: 'title', progress: 0.5 });
    t.frames(0.1);
    Object.assign(t.view, { gust: 1, locked: true, progress: 0.9 });
    t.frames(0.1);
    expect(t.played).toHaveLength(0);
    const r = setup({ progress: 0.8 });
    r.frames(0.1);
    r.view.progress = 0.9;
    r.frames(0.1);
    r.router.resetRun();
    r.view.progress = 0.1;
    r.frames(0.1);
    r.view.progress = 0.95;
    r.frames(0.1);
    expect(r.names()).toEqual(['finishNear', 'finishNear']);
  });

  it('plays SWING landings climbing with the chain', () => {
    const t = setup();
    t.router.onEvents([{ e: 'swing', deg: 80, chain: 2, snow: 1, x: 0, y: 0 }], t.view);
    expect(t.played[0]).toMatchObject({ name: 'swing', params: { level: 2 } });
  });
});

describe('SfxRouter v1.5 mechanics', () => {
  it('ticks a growing bud up the scale (≤ 8/s, ≥ 90 ms apart), then blooms', () => {
    const t = setup();
    t.stream(40, 30, (i) => ({ e: 'budGrow', id: 1, x: 0, y: 0, grow: i / 39 }));
    const ticks = t.played.filter((p) => p.name === 'budGrow');
    expect(ticks.length).toBeGreaterThanOrEqual(8);
    expect(ticks.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < ticks.length; i++) {
      expect((ticks[i] as Played).at - (ticks[i - 1] as Played).at).toBeGreaterThanOrEqual(90);
      expect((ticks[i] as Played).params.degree as number).toBeGreaterThanOrEqual((ticks[i - 1] as Played).params.degree as number);
    }
    expect(ticks.at(-1)?.params.degree).toBe(7);
    t.router.onEvents([{ e: 'bloom', id: 1, x: 0, y: 0, snow: 5 }], t.view);
    expect(t.names().at(-1)).toBe('bloom');
  });

  it('plays the frost meter, the snap (ducking the score) and its end; deep shade at most every 2.5 s', () => {
    const t = setup();
    t.router.onEvents([{ e: 'frostReady' }, { e: 'snap', x: 0, y: 0, cloudId: 3 }], t.view);
    expect(t.names()).toEqual(['frostReady', 'snap']);
    expect(DUCKS.snap).toBeDefined();
    t.router.onEvents([{ e: 'snapEnd' }, { e: 'deepEnter' }], t.view);
    t.advance(1000);
    t.router.onEvents([{ e: 'deepEnter' }], t.view);
    t.advance(2000);
    t.router.onEvents([{ e: 'deepEnter' }], t.view);
    expect(t.names()).toEqual(['frostReady', 'snap', 'snapEnd', 'deepEnter', 'deepEnter']);
  });
});

describe('SfxRouter heartbeat', () => {
  it('beats at once below 25 Chill, every 0.85 s, and tells the haptics hook', () => {
    const t = setup({ chill: 20 });
    const hooks: boolean[] = [];
    t.router.onHeartbeat = (strong) => hooks.push(strong);
    t.frames(3.5);
    const beats = t.played.filter((p) => p.name === 'heartbeat');
    expect(beats.length).toBe(5); // 0, 0.85, 1.7, 2.55, 3.4
    expect(hooks).toEqual([false, false, false, false, false]);
    expect(beats[0]?.at).toBe(1000);
  });

  it('beats harder and faster below 10 Chill', () => {
    const t = setup({ chill: 5 });
    t.frames(2.9);
    const beats = t.played.filter((p) => p.name === 'heartbeat');
    expect(beats.length).toBe(5); // 0, 0.6, 1.2, 1.8, 2.4
    expect(beats.every((b) => b.params.strong)).toBe(true);
  });

  it('stays silent with enough Chill, at night, and while paused', () => {
    for (const patch of [{ chill: 60 }, { chill: 5, phase: 'night' as const }, { chill: 5, screen: 'paused' as const }]) {
      const t = setup(patch);
      t.frames(2);
      expect(t.played).toHaveLength(0);
    }
  });

  it('applies a scene every frame', () => {
    const t = setup({ mult: 3 });
    t.frames(0.5);
    expect(t.scenes).toHaveLength(30);
    expect(t.scenes.at(-1)?.arp).toBe(3);
  });
});
