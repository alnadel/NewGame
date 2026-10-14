// v1.5 core mechanics on the game side (docs/V1_5_PLAN.md §2): what the renderer is told each frame
// (render MechView: the frost meter, deep shade, the Cold Snap's cloud and the dial's gold bud
// arcs), which Journey concepts teach which mechanic, and the test hook's render-only demos.
//
// Everything reads the sim defensively: the fields are the v1.5 contract, but a run without the
// mechanics (or a build whose sim doesn't fill them yet) leaves them at their defaults, and then
// nothing shows. The frost meter appears on a run once its frost first moves (a run without Cold
// Snap never fills it).
//
// Demos ('bud', 'bloom', 'snapReady', 'snap', 'deep') stage a plausible moment for visual review:
// a bud beside the trail ahead (growing), its sunflower, a full meter, a snap cloud over Nubs, deep
// shade; they put objects into the run's world and send the events to fx, audio and haptics, but
// never change a rule of the sim.

import {
  cloudAlive,
  queryCasters,
  trailX,
  TUNING,
  type Bud,
  type Caster,
  type Cloud,
  type ConceptId,
  type LevelDef,
  type RenderSnap,
  type SimEvent,
  type SimState,
} from '../core/index.ts';
import { CONCEPTS } from '../core/index.ts';
import { makeCaster, makeDisc, makePrism } from '../core/gen/catalog.ts';
import { insertCaster, takeId } from '../core/gen/store.ts';
import { rectPoly } from '../core/geom.ts';
import type { CasterKind } from '../core/index.ts';
import { createMechView, type MechView } from '../render/renderer.ts';

export type Mechanic = 'bud' | 'snap' | 'deep';

/**
 * The mechanic a Journey concept teaches (by its id, name or title: the core names the concepts),
 * or null. 'frosty' (a Chill concept) is not Cold Snap.
 */
export function mechanicOf(id: string | null | undefined): Mechanic | null {
  if (!id) return null;
  const c = (CONCEPTS as Readonly<Record<string, { name?: string; title?: string } | undefined>>)[id];
  const text = `${id} ${c?.name ?? ''} ${c?.title ?? ''}`.toLowerCase();
  if (/\b(buds?|bloom\w*|sunflowers?)\b/.test(text)) return 'bud';
  if (/\b(cold ?snap|snaps?|coldsnap)\b/.test(text)) return 'snap';
  if (/\bdeep\b/.test(text)) return 'deep';
  return null;
}

/** The mechanic a level introduces (its `introduces` concept), or null. */
export function levelMechanic(level: LevelDef | null): Mechanic | null {
  if (!level) return null;
  const m = mechanicOf(level.introduces);
  if (m) return m;
  for (const c of level.concepts as readonly ConceptId[]) {
    const k = mechanicOf(c);
    if (k && level.introduces === c) return k;
  }
  return null;
}

const DEMO_S = 6;
/** The demo bud stands this far ahead of Nubs and beside the trail (u). */
const DEMO_AHEAD = 70;
const DEMO_SIDE = 46;
const SNAP_TICKS = (): number => Math.max(1, Math.round(TUNING.frost.snapSec * 60));

export class Mechanics {
  readonly view: MechView = createMechView();
  /** Sends a staged (demo) event to fx, audio and haptics. */
  route: (ev: SimEvent) => void = () => {};
  private meterOn = false;
  private snapCloud: Cloud | null = null;
  private lastSnapId = -1;
  // Demo state (real seconds of `time` when each ends; −1 none).
  private demoDeepEnd = -1;
  private demoFrostEnd = -1;
  private demoSnapT0 = -1;
  private demoSnapId = -1;
  private demoBud: Bud | null = null;
  private demoBudEnd = -1;
  private readonly demoMask = new Uint8Array(360);
  private readonly casters: Caster[] = [];

  /** A new run. */
  reset(): void {
    this.meterOn = false;
    this.snapCloud = null;
    this.lastSnapId = -1;
    this.demoDeepEnd = this.demoFrostEnd = this.demoSnapT0 = this.demoBudEnd = -1;
    this.demoSnapId = -1;
    this.demoBud = null;
  }

  /** Fills the view from the run (and any demo) for this frame; `time` is the session's real clock (s). */
  fill(s: SimState, time: number): MechView {
    const m = this.view;
    const nb = s.nubs;
    const frost = typeof nb.frost === 'number' ? nb.frost : 0;
    const snapTicks = typeof s.snapTicks === 'number' ? s.snapTicks : 0;
    if (frost > 0.001 || snapTicks > 0) this.meterOn = true;
    m.frost = frost;
    m.deep = nb.deep === true;
    m.snapLeft = snapTicks > 0 ? Math.min(1, snapTicks / SNAP_TICKS()) : 0;
    const id = typeof s.snapCloudId === 'number' ? s.snapCloudId : -1;
    if (id >= 0) this.lastSnapId = id;
    m.snapId = -1;
    m.snapFade = 0;
    if (this.lastSnapId >= 0) {
      const cl = this.cloud(s, this.lastSnapId);
      if (cl && cloudAlive(cl, s.tAbs)) {
        m.snapId = cl.id;
        m.snapFade = 1;
      } else if (snapTicks === 0) {
        this.lastSnapId = -1;
      }
    }
    const bud = s.guide.bud as Uint8Array | undefined;
    m.bud = bud ?? null;

    // Demos stand in for the sim while they last.
    if (time < this.demoFrostEnd) {
      this.meterOn = true;
      m.frost = 1;
    }
    if (time < this.demoDeepEnd) m.deep = true;
    if (this.demoSnapT0 >= 0) {
      const left = 1 - (time - this.demoSnapT0) / TUNING.frost.snapSec;
      if (left > 0) {
        this.meterOn = true;
        m.frost = 0;
        m.snapLeft = left;
        m.snapId = this.demoSnapId;
        m.snapFade = 1;
      } else {
        this.demoSnapT0 = -1;
        this.route({ e: 'snapEnd' });
      }
    }
    const b = this.demoBud;
    if (b && time < this.demoBudEnd) {
      // The demo bud grows while the sun shines from its arc (it never blooms by itself).
      const off = Math.abs((((s.sun.theta - b.face) % 360) + 540) % 360 - 180);
      b.grow = b.state === 0 ? Math.min(0.85, 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(time * 1.6)) * (off <= TUNING.buds.faceTol ? 1 : 0.6)) : 1;
      if (b.state === 0) m.bud = this.demoMask;
    } else if (b && time >= this.demoBudEnd) {
      this.demoBud = null;
    }
    m.meter = this.meterOn;
    return m;
  }

  private cloud(s: SimState, id: number): Cloud | null {
    const c = this.snapCloud;
    if (c && c.id === id) return c;
    const cs = s.world.clouds;
    for (let i = cs.length - 1; i >= 0; i--) {
      if ((cs[i] as Cloud).id === id) {
        this.snapCloud = cs[i] as Cloud;
        return this.snapCloud;
      }
    }
    return null;
  }

  /**
   * Test hook demos (render-only moments; see the header). Returns false for a name it doesn't know.
   */
  demo(name: string, s: SimState, snap: RenderSnap, time: number): boolean {
    switch (name) {
      case 'bud': {
        const b = this.stageBud(s, snap, time);
        this.route({ e: 'budGrow', id: b.id, x: b.x, y: b.y, grow: 0.5 });
        return true;
      }
      case 'bloom': {
        const b = this.demoBud && this.demoBud.state === 0 ? this.demoBud : this.stageBud(s, snap, time);
        this.bloom(s, b);
        this.demoBudEnd = time + DEMO_S;
        this.route({ e: 'bloom', id: b.id, x: b.x, y: b.y, snow: TUNING.buds.snow });
        return true;
      }
      case 'snapReady':
        this.demoFrostEnd = time + DEMO_S;
        this.route({ e: 'frostReady' });
        return true;
      case 'snap': {
        // A frosty cloud riding with Nubs. It flies so low (z 1) that its shadow sits right under it
        // wherever the sun points; the renderer draws the body over its shadow either way.
        const rx = 48;
        const ry = 32;
        const lumps = new Float64Array(15);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          lumps[3 * i] = Math.cos(a) * rx * 0.42;
          lumps[3 * i + 1] = Math.sin(a) * ry * 0.4;
          lumps[3 * i + 2] = ry * (0.5 + 0.04 * i);
        }
        const cl: Cloud = Object.freeze({
          id: takeId(s.world),
          kind: 'waiter',
          t0: s.tAbs,
          life: TUNING.frost.snapSec + 0.5,
          x0: s.nubs.x,
          y0: s.nubs.y,
          vx: 0,
          vy: s.phase === 'day' ? s.params.v : 0,
          rx,
          ry,
          z: 1,
          lumps,
        });
        s.world.clouds.push(cl);
        this.demoSnapId = cl.id;
        this.demoSnapT0 = time;
        this.demoFrostEnd = -1;
        this.route({ e: 'snap', x: s.nubs.x, y: s.nubs.y, cloudId: cl.id });
        return true;
      }
      case 'deep':
        this.demoDeepEnd = time + DEMO_S;
        this.route({ e: 'deepEnter' });
        return true;
      default:
        return false;
    }
  }

  /** A demo bud beside the trail ahead of Nubs, facing 60° round from the sun (gold arcs off the teal). */
  private stageBud(s: SimState, snap: RenderSnap, time: number): Bud {
    const y = s.nubs.y + Math.max(DEMO_AHEAD, (s.phase === 'day' ? s.params.v : 0) * 1.6);
    const tx = trailX(s.world.trail, y);
    // The side of the trail with more room from the casters there.
    const n = queryCasters(s.world, y - 40, y + 40, this.casters);
    let roomL = Infinity;
    let roomR = Infinity;
    for (let i = 0; i < n; i++) {
      const c = this.casters[i] as Caster;
      roomL = Math.min(roomL, Math.max(0, c.minX - (tx - DEMO_SIDE), tx - DEMO_SIDE - c.maxX));
      roomR = Math.min(roomR, Math.max(0, c.minX - (tx + DEMO_SIDE), tx + DEMO_SIDE - c.maxX));
    }
    const x = tx + (roomL > roomR ? -DEMO_SIDE : DEMO_SIDE);
    const face = (((Math.round(snap.theta) + 50) % 360) + 360) % 360;
    const b: Bud = { id: takeId(s.world), x, y, face, grow: 0.3, state: 0, casterId: -1 };
    const buds = s.world.buds as Bud[] | undefined;
    if (buds) {
      let i = 0;
      while (i < buds.length && (buds[i] as Bud).y <= y) i++;
      buds.splice(i, 0, b);
    }
    this.demoMask.fill(0);
    const tol = TUNING.buds.faceTol;
    for (let d = -tol; d <= tol; d++) this.demoMask[(((face + d) % 360) + 360) % 360] = 1;
    this.demoBud = b;
    this.demoBudEnd = time + DEMO_S * 2;
    return b;
  }

  /** The demo bud's sunflower: a stem prism and a disc head (the core's 'sunflower' shape). */
  private bloom(s: SimState, b: Bud): void {
    const w = s.world;
    const c = makeCaster({
      id: takeId(w),
      kind: 'sunflower' as CasterKind,
      name: 'the Sunflower',
      biome: 'meadow',
      x: b.x,
      y: b.y,
      rot: 0,
      parts: [makePrism(rectPoly(b.x, b.y, 3, 3, 1, 0), 62), makeDisc(b.x, b.y, 13, 70)],
      side: 0,
      rescue: false,
      gate: false,
      ballId: -1,
      chunk: -1,
    });
    insertCaster(w, c);
    b.state = 1;
    b.grow = 1;
    b.casterId = c.id;
  }
}
