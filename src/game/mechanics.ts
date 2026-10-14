// v1.5 core mechanics on the game side (docs/V1_5_PLAN.md §2): what the renderer is told each frame
// (render MechView: the frost meter, deep shade, the Cold Snap's cloud and the dial's gold bud
// arcs), which Journey concepts teach which mechanic, and the test hook's render-only demos.
//
// The sim is read defensively: a run without the mechanics (or a sim that doesn't fill them yet)
// leaves the fields at their defaults and nothing shows. The frost meter appears on a run once its
// frost first moves (a run without Cold Snap never fills it).
//
// Demos ('bud', 'bloom', 'snapReady', 'snap', 'deep') stage a plausible moment for visual review: a
// bud beside the trail ahead, its sunflower, a full meter, a low snap cloud over Nubs, deep shade.
// They put objects into the run's world and send the events to fx, audio and haptics, but never
// change a rule of the sim.

import { cloudAlive, CONCEPTS, queryCasters, trailX, TUNING, type Bud, type Caster, type CasterKind, type Cloud, type RenderSnap, type SimEvent, type SimState } from '../core/index.ts';
import { makeCaster, makeDisc, makePrism } from '../core/gen/catalog.ts';
import { insertCaster, takeId } from '../core/gen/store.ts';
import { rectPoly } from '../core/geom.ts';
import { createMechView, type MechView } from '../render/renderer.ts';

export type Mechanic = 'bud' | 'snap' | 'deep';

/**
 * The mechanic a Journey concept teaches, found by its id and name (the core names the concepts),
 * or null. 'frosty' (a Chill concept) is not Cold Snap.
 */
export function mechanicOf(id: string | null | undefined): Mechanic | null {
  if (!id) return null;
  const text = `${id} ${(CONCEPTS as Readonly<Record<string, { name: string } | undefined>>)[id]?.name ?? ''}`.toLowerCase();
  return /\b(buds?|bloom\w*|sunflowers?)\b/.test(text) ? 'bud' : /snap\b/.test(text) ? 'snap' : /\bdeep\b/.test(text) ? 'deep' : null;
}

/** The demos last DEMO_S (s); the demo bud stands at least DEMO_AHEAD ahead and DEMO_SIDE beside the trail (u). */
const DEMO_S = 6;
const DEMO_AHEAD = 70;
const DEMO_SIDE = 46;
/** The demo snap cloud's lumps (dx, dy, r). */
const DEMO_LUMPS = new Float64Array([-18, 0, 17, 4, 8, 19, 20, -2, 16, 2, -9, 15]);

export interface Mechanics {
  readonly view: MechView;
  /** Sends a staged (demo) event to fx, audio and haptics. */
  route: (ev: SimEvent) => void;
  /** A new run. */
  reset(): void;
  /** Fills the view from the run (and any demo) for this frame; `time` is the session's real clock (s). */
  fill(s: SimState, time: number): MechView;
  /** Test hook demos (render-only moments; see the header). False for a name it doesn't know. */
  demo(name: string, s: SimState, snap: RenderSnap, time: number): boolean;
}

/** The game side of the mechanics (closures, so the minifier shortens the state). */
export function createMechanics(): Mechanics {
  const view = createMechView();
  const mask = new Uint8Array(360);
  const casters: Caster[] = [];
  let meterOn = false;
  let cloud: Cloud | null = null;
  // Demo state: when each ends (the session's real clock, s), the demo snap's start and the demo bud.
  let deepEnd = -1;
  let frostEnd = -1;
  let snapT0 = -1;
  let bud: Bud | null = null;

  /** A demo bud ahead of Nubs on the roomier side of the trail, facing 50° round from the sun. */
  const stageBud = (s: SimState, snap: RenderSnap): Bud => {
    const y = s.nubs.y + Math.max(DEMO_AHEAD, (s.phase === 'day' ? s.params.v : 0) * 1.6);
    const tx = trailX(s.world.trail, y);
    let room = 0;
    for (let i = queryCasters(s.world, y - 40, y + 40, casters) - 1; i >= 0; i--) room += (casters[i] as Caster).x < tx ? 1 : -1;
    const face = (Math.round(snap.theta) + 410) % 360;
    const b: Bud = { id: takeId(s.world), x: tx + (room > 0 ? DEMO_SIDE : -DEMO_SIDE), y, face, grow: 0.45, state: 0, casterId: -1 };
    const buds = s.world.buds;
    let i = 0;
    while (i < buds.length && (buds[i] as Bud).y <= y) i++;
    buds.splice(i, 0, b);
    mask.fill(0);
    for (let d = -TUNING.buds.faceTol; d <= TUNING.buds.faceTol; d++) mask[(face + d + 360) % 360] = 1;
    return (bud = b);
  };

  const m: Mechanics = {
    view,
    route: () => {},
    reset() {
      meterOn = false;
      cloud = bud = null;
      deepEnd = frostEnd = snapT0 = -1;
    },
    fill(s, time) {
      const ticks = s.snapTicks ?? 0;
      view.frost = s.nubs.frost ?? 0;
      view.deep = s.nubs.deep === true;
      view.snapLeft = ticks > 0 ? Math.min(1, ticks / (TUNING.frost.snapSec * 60)) : 0;
      // The snap cloud is drawn frosty while it lives (even past snapCloudId, if the sim lets it).
      const id = s.snapCloudId ?? -1;
      if (id >= 0 && cloud?.id !== id) cloud = s.world.clouds.find((c) => c.id === id) ?? null;
      view.snapCloud = cloud && cloudAlive(cloud, s.tAbs) ? cloud : null;
      view.bud = s.guide.bud ?? null;
      // Demos stand in for the sim while they last.
      if (time < frostEnd) view.frost = 1;
      if (time < deepEnd) view.deep = true;
      if (snapT0 >= 0) {
        const left = 1 - (time - snapT0) / TUNING.frost.snapSec;
        if (left > 0) view.snapLeft = left;
        else {
          snapT0 = -1;
          m.route({ e: 'snapEnd' });
        }
      }
      if (bud?.state === 0) view.bud = mask;
      if (view.frost > 0.001 || view.snapLeft > 0) meterOn = true;
      view.meter = meterOn;
      return view;
    },
    demo(name, s, snap, time) {
      const nb = s.nubs;
      let ev: SimEvent;
      if (name === 'bud' || name === 'bloom') {
        const b = bud?.state === 0 ? bud : stageBud(s, snap);
        ev = { e: 'budGrow', id: b.id, x: b.x, y: b.y, grow: b.grow };
        if (name === 'bloom') {
          // Its sunflower: a stem prism and a disc head (the core's 'sunflower' shape).
          const c = makeCaster({
            id: takeId(s.world), kind: 'sunflower' as CasterKind, name: 'the Sunflower', biome: 'meadow', x: b.x, y: b.y, rot: 0,
            parts: [makePrism(rectPoly(b.x, b.y, 3, 3, 1, 0), 62), makeDisc(b.x, b.y, 13, 70)], side: 0, rescue: false, gate: false, ballId: -1, chunk: -1,
          });
          insertCaster(s.world, c);
          b.state = 1;
          b.casterId = c.id;
          ev = { e: 'bloom', id: b.id, x: b.x, y: b.y, snow: TUNING.buds.snow };
        }
      } else if (name === 'snap') {
        // A frosty cloud riding with Nubs, so low (z 1) that its shadow sits under it wherever the sun is.
        cloud = { id: takeId(s.world), kind: 'waiter', t0: s.tAbs, life: TUNING.frost.snapSec + 0.5, x0: nb.x, y0: nb.y, vx: 0, vy: s.phase === 'day' ? s.params.v : 0, rx: 48, ry: 32, z: 1, lumps: DEMO_LUMPS };
        s.world.clouds.push(cloud);
        snapT0 = time;
        frostEnd = -1;
        ev = { e: 'snap', x: nb.x, y: nb.y, cloudId: cloud.id };
      } else if (name === 'snapReady') {
        frostEnd = time + DEMO_S;
        ev = { e: 'frostReady' };
      } else if (name === 'deep') {
        deepEnd = time + DEMO_S;
        ev = { e: 'deepEnter' };
      } else {
        return false;
      }
      m.route(ev);
      return true;
    },
  };
  return m;
}
