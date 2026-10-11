import { describe, expect, it } from 'vitest';
import { ARP_MIN_CHILL, MUFFLE_OPEN, MUFFLE_PAUSED, createAudioView, createScene, sceneFor } from '../../src/audio/scene.ts';
import type { AudioView, Scene } from '../../src/audio/scene.ts';

const scene = (patch: Partial<AudioView>): Scene => sceneFor(Object.assign(createAudioView(), patch), createScene());
const day = (patch: Partial<AudioView> = {}): Scene =>
  scene({ screen: 'play', phase: 'day', tDay: 10, dayLength: 50, eps: 30, epsNoon: 48, ...patch });

describe('sceneFor', () => {
  it('title and menus: a soft warm pad and nothing else', () => {
    for (const screen of ['title', 'menu'] as const) {
      const s = scene({ screen, f: 1, chill: 5, mult: 5 });
      expect(s.pad).toBeGreaterThan(0);
      expect(s.padCutoff).toBeLessThan(600);
      expect([s.arp, s.sizzle, s.crackle, s.cicadas, s.crickets, s.heartbeat]).toEqual([0, 0, 0, 0, 0, 0]);
      expect(s.muffle).toBe(MUFFLE_OPEN);
    }
  });

  it('daylight play: arpeggio density follows the multiplier, muted below 40 Chill', () => {
    expect(day({ mult: 1 }).arp).toBe(1);
    expect(day({ mult: 4 }).arp).toBe(4);
    expect(day({ mult: 5, chill: ARP_MIN_CHILL }).arp).toBe(5);
    expect(day({ mult: 5, chill: ARP_MIN_CHILL - 0.1 }).arp).toBe(0);
  });

  it('daylight play: sizzle and crackle follow f, heartbeat follows Chill', () => {
    const shaded = day({ f: 0 });
    expect([shaded.sizzle, shaded.crackle]).toEqual([0, 0]);
    const lit = day({ f: 1.8, glareW: 0.5 });
    expect(lit.sizzle).toBe(1.5);
    expect(lit.sizzleHz).toBe(6000);
    expect(lit.crackle).toBeGreaterThan(0);
    expect(day({ chill: 60 }).heartbeat).toBe(0);
    expect(day({ chill: 20 }).heartbeat).toBe(0.85);
    expect(day({ chill: 5 }).heartbeat).toBe(0.6);
  });

  it('daylight play: cicadas only around noon; pad brightens with elevation', () => {
    expect(day({ tDay: 25 }).cicadas).toBe(1);
    expect(day({ tDay: 10 }).cicadas).toBe(0);
    expect(day({ tDay: 31 }).cicadas).toBe(0);
    expect(day({ eps: 48 }).padCutoff).toBeGreaterThan(day({ eps: 10 }).padCutoff);
  });

  it('night: pad at 500 Hz and crickets; no arpeggio, sizzle or heartbeat', () => {
    const s = scene({ screen: 'play', phase: 'night', chill: 5, f: 1, mult: 5 });
    expect(s.padCutoff).toBe(500);
    expect(s.crickets).toBe(1);
    expect([s.arp, s.sizzle, s.cicadas, s.heartbeat]).toEqual([0, 0, 0, 0]);
  });

  it('hold (waiting for the first drag): pad only', () => {
    const s = scene({ screen: 'play', phase: 'hold', mult: 3, f: 1 });
    expect(s.pad).toBeGreaterThan(0);
    expect([s.arp, s.sizzle, s.heartbeat]).toEqual([0, 0, 0]);
  });

  it('paused: pad ducked and muffled, every tension loop stopped', () => {
    const s = day({ screen: 'paused', f: 1.5, chill: 5, mult: 5, tDay: 25 });
    expect(s.pad).toBeLessThan(day().pad);
    expect(s.muffle).toBe(MUFFLE_PAUSED);
    expect([s.arp, s.sizzle, s.crackle, s.cicadas, s.crickets, s.heartbeat]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('dying, dead and results: darker pad, no loops', () => {
    for (const s of [day({ screen: 'dying', f: 2, chill: 0 }), day({ phase: 'dead', f: 2, chill: 0 }), day({ screen: 'results' })]) {
      expect(s.pad).toBeGreaterThan(0);
      expect(s.padCutoff).toBeLessThan(800);
      expect([s.arp, s.sizzle, s.crackle, s.heartbeat]).toEqual([0, 0, 0, 0]);
    }
  });

  it('keys the music to the day (never below Day 1)', () => {
    expect(day({ day: 4 }).day).toBe(4);
    expect(day({ day: 0 }).day).toBe(1);
  });

  it('writes into the scene it is given (no per-frame allocation)', () => {
    const out = createScene();
    expect(sceneFor(createAudioView(), out)).toBe(out);
  });
});
