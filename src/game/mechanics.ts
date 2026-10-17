// v1.5 core mechanics on the game side (docs/V1_5_PLAN.md §2) and v1.6's priced decisions
// (docs/V1_6_PLAN.md §2, §4): what the renderer is told each frame (render MechView: the frost
// meter and its pips, the Flow Ring's charge, deep shade, the Cold Snap's cloud, the dial's layers
// and the Heat Flare in progress), which Journey concepts teach which mechanic, and the test hook's
// render-only demos.
//
// The sim is read defensively: a run without the mechanics (or a sim that doesn't fill them yet)
// leaves the fields at their defaults and nothing shows. The frost meter appears on a run once its
// frost first moves (a run without Cold Snap never fills it).
//
// Demos stage a plausible moment for visual review (v1.5: 'bud', 'bloom', 'snapReady', 'snap',
// 'deep'; v1.6: 'ring', 'bleed', 'trick', 'pips', 'spill', 'cash', 'bank', 'deepBand', 'glass',
// 'land', 'landing', 'flare', 'flareSoon' (a kept flare 5 s ahead: the sim plays it), 'parry',
// 'noonHeat'). They put objects into the run's world (a bud, its
// sunflower, a low cloud, a kept flare through the core's debugFlare, a ring level through
// debugRing), stand in for the sim's masks and meters while they last and send the events to fx,
// audio and haptics, but never change a rule of the sim.

import {
  cloudAlive,
  CONCEPTS,
  dayTicks,
  debugFlare,
  debugRing,
  FLARE_KEPT,
  noonHeatAt,
  queryCasters,
  queryPickups,
  SNAP_TICKS,
  trailX,
  TUNING,
  PICKUP_ALIVE,
  type Bud,
  type Caster,
  type CasterKind,
  type Cloud,
  type Flare,
  type Pickup,
  type RenderSnap,
  type SimEvent,
  type SimState,
} from '../core/index.ts';
import { makeCaster, makeDisc, makePrism } from '../core/gen/catalog.ts';
import { insertCaster, takeId } from '../core/gen/store.ts';
import { rectPoly } from '../core/geom.ts';
import { createMechView, type MechView } from '../render/renderer.ts';

export type Mechanic = 'bud' | 'snap' | 'deep' | 'glass' | 'flare';

/**
 * The mechanic a Journey concept teaches, found by its id and name (the core names the concepts),
 * or null. 'frosty' (a Chill concept) is not Cold Snap.
 */
export function mechanicOf(id: string | null | undefined): Mechanic | null {
  if (!id) return null;
  const text = `${id} ${(CONCEPTS as Readonly<Record<string, { name: string } | undefined>>)[id]?.name ?? ''}`.toLowerCase();
  return /\b(buds?|bloom\w*|sunflowers?)\b/.test(text)
    ? 'bud'
    : /snap\b/.test(text)
      ? 'snap'
      : /\bdeep\b/.test(text)
        ? 'deep'
        : /\b(brittle|glass)\b/.test(text)
          ? 'glass'
          : /\bflares?\b/.test(text)
            ? 'flare'
            : null;
}

/** The demos last DEMO_S (s); the demo bud stands at least DEMO_AHEAD ahead and DEMO_SIDE beside the trail (u). */
const DEMO_S = 6;
const DEMO_AHEAD = 70;
const DEMO_SIDE = 46;
/** The demo snap cloud's lumps (dx, dy, r). */
const DEMO_LUMPS = new Float64Array([-18, 0, 17, 4, 8, 19, 20, -2, 16, 2, -9, 15]);
const RING_NEED = TUNING.ring.need;

export interface Mechanics {
  readonly view: MechView;
  /** Sends a staged (demo) event to fx, audio and haptics. */
  route: (ev: SimEvent) => void;
  /** A new run. */
  reset(): void;
  /** One tick's event (flare outcomes for the ruler, the ring's bleed). */
  onEvent(ev: SimEvent): void;
  /** Fills the view from the run (and any demo) for this frame; `time` is the session's real clock (s). */
  fill(s: SimState, time: number): MechView;
  /** Test hook demos (render-only moments; see the header). False for a name it doesn't know. */
  demo(name: string, s: SimState, snap: RenderSnap, time: number): boolean;
}

/** An arc of `w` bins centred on bin `c`. */
function arcMask(c: number, w: number, out: Uint8Array): Uint8Array {
  out.fill(0);
  for (let d = -w >> 1; d <= w >> 1; d++) out[(((c + d) % 360) + 360) % 360] = 1;
  return out;
}

/** The game side of the mechanics (closures, so the minifier shortens the state). */
export function createMechanics(): Mechanics {
  const view = createMechView();
  const mask = new Uint8Array(360);
  const demoMask = new Uint8Array(360);
  const casters: Caster[] = [];
  const pickBuf: Pickup[] = [];
  let meterOn = false;
  let cloud: Cloud | null = null;
  // Demo state: when each ends (the session's real clock, s), the demo snap's start and the demo bud.
  let deepEnd = -1;
  let frostEnd = -1;
  let snapT0 = -1;
  let bud: Bud | null = null;
  // v1.6 demos: the meter's frost and the snap's banked income while they last, the bleeding ring,
  // the mask a demo draws (and on which layer), the demo flare, Noon Heat.
  let frostDemo = 0;
  let bankDemo = 0;
  let bleedEnd = -1;
  let ringEnd = -1;
  let ringLevel = 1;
  let ringFill = 0;
  let layer: 'deepBand' | 'glass' | 'land' | '' = '';
  let layerEnd = -1;
  let flareDemo: Flare | null = null;
  let heatDemo = 0;
  // The ring last frame (a falling charge is a bleed) and until when the bleed shows.
  let lastMult = 0;
  let lastCharge = 0;
  let bleedUntil = -1;
  let outVer = 0;

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

  /** A frosty cloud riding with Nubs, so low (z 1) that its shadow sits under it wherever the sun is. */
  const stageSnap = (s: SimState, time: number): SimEvent => {
    const nb = s.nubs;
    cloud = { id: takeId(s.world), kind: 'waiter', t0: s.tAbs, life: TUNING.frost.snapSec + 0.5, x0: nb.x, y0: nb.y, vx: 0, vy: s.phase === 'day' ? s.params.v : 0, rx: 48, ry: 32, z: 1, lumps: DEMO_LUMPS };
    s.world.clouds.push(cloud);
    snapT0 = time;
    frostEnd = -1;
    return { e: 'snap', x: nb.x, y: nb.y, cloudId: cloud.id };
  };

  /** Phase (0..4), the warning's share left and the phase's progress of flare `f` at absolute tick `t`. */
  const flarePhase = (f: Flare, t: number): void => {
    const a = t < f.riseTick ? f.warnTick : t < f.holdTick ? f.riseTick : t < f.fallTick ? f.holdTick : f.fallTick;
    const b = t < f.riseTick ? f.riseTick : t < f.holdTick ? f.holdTick : t < f.fallTick ? f.fallTick : f.endTick;
    view.flarePhase = t < f.warnTick || t >= f.endTick ? 0 : t < f.riseTick ? 1 : t < f.holdTick ? 2 : t < f.fallTick ? 3 : 4;
    view.flareT = view.flarePhase > 0 ? (t - a) / Math.max(1, b - a) : 0;
    view.flareLeft = view.flarePhase === 1 ? 1 - view.flareT : 0;
  };

  const m: Mechanics = {
    view,
    route: () => {},
    reset() {
      meterOn = false;
      cloud = bud = flareDemo = null;
      deepEnd = frostEnd = snapT0 = bleedEnd = layerEnd = bleedUntil = ringEnd = -1;
      frostDemo = bankDemo = heatDemo = lastMult = lastCharge = 0;
      layer = '';
      view.flareOut.clear();
      view.glassCluster = -1;
      outVer++;
    },
    onEvent(ev) {
      if (ev.e === 'flareParry' || ev.e === 'flareMiss') {
        view.flareOut.set(ev.id, ev.e === 'flareParry' ? 1 : 2);
        outVer++;
      }
    },
    fill(s, time) {
      const nb = s.nubs;
      const w = s.world;
      const v16 = w.v16;
      const ticks = s.snapTicks ?? 0;
      view.frost = Math.max(nb.frost ?? 0, (nb.frostH ?? 0) / 100);
      view.pips = v16?.bank ? 2 : 1;
      view.bankH = ticks > 0 ? (s.snapBankH ?? 0) : 0;
      view.deep = nb.deep === true;
      view.snapLeft = ticks > 0 ? Math.min(1, ticks / (SNAP_TICKS + (s.snapExt ?? 0))) : 0;
      // The snap cloud is drawn frosty while it lives (even past snapCloudId, if the sim lets it).
      const id = s.snapCloudId ?? -1;
      if (id >= 0 && cloud?.id !== id) cloud = w.clouds.find((c) => c.id === id) ?? null;
      view.snapCloud = cloud && cloudAlive(cloud, s.tAbs) ? cloud : null;
      const gd = s.guide;
      view.bud = gd.bud ?? null;
      // The Flow Ring: its fill toward the next level (×5: the buffer), bleeding while the charge falls.
      const mult = nb.mult;
      const charge = nb.ringCharge ?? 0;
      view.mult = mult;
      view.ring = v16?.ring === true;
      view.ringFill = Math.min(1, Math.max(0, charge / (RING_NEED[Math.min(mult, 5) - 1] ?? RING_NEED[3] ?? 1)));
      if (s.phase === 'day' && mult === lastMult && charge < lastCharge) bleedUntil = time + 0.25;
      lastMult = mult;
      lastCharge = charge;
      view.bleed = time < bleedUntil || time < bleedEnd;
      // Dial layers: deep shade, the glass flake's window, the landing (a snap is on).
      view.deepBand = gd.deep ?? null;
      view.glass = gd.flake ?? null;
      view.land = ticks > 0 ? (gd.land ?? null) : null;
      // The flare: the sim's, else the demo's (its kept flare, timed by the world's clock).
      const fi = s.flareIdx ?? -1;
      const cur = (s.flarePhase ?? 0) > 0 && fi >= 0 ? w.flares?.[fi] : undefined;
      view.flarePhase = 0;
      view.flareLeft = 0;
      view.flare = null;
      if (cur) {
        flarePhase(cur, s.tickAbs);
        view.flarePhase = s.flarePhase;
        view.flare = gd.flare ?? null;
      } else if (flareDemo) {
        flarePhase(flareDemo, s.tickAbs);
        if (view.flarePhase === 1) view.flare = demoMask;
        if (s.tickAbs >= flareDemo.endTick) flareDemo = null;
      }
      let sig = outVer * 7919;
      const fl = w.flares;
      for (let i = 0; fl && i < fl.length; i++) {
        const f = fl[i] as Flare;
        if (f.state === FLARE_KEPT) sig += f.id * 31 + f.riseTick;
      }
      view.flareSig = sig;
      view.noonHeat = heatDemo > 0 ? heatDemo : s.phase === 'day' || s.phase === 'night' || s.phase === 'hold' ? noonHeatAt(w, s.day, dayTicks(s.day) >> 1) : 1;
      // Demos stand in for the sim while they last.
      if (time < frostEnd) view.frost = frostDemo;
      if (time < ringEnd) {
        view.mult = ringLevel;
        view.ringFill = ringFill;
      }
      if (time < deepEnd) view.deep = true;
      if (snapT0 >= 0) {
        const left = 1 - (time - snapT0) / TUNING.frost.snapSec;
        if (left > 0) {
          view.snapLeft = left;
          view.bankH = bankDemo;
        } else {
          snapT0 = -1;
          m.route({ e: 'snapEnd' });
        }
      }
      if (time < layerEnd) {
        if (layer === 'deepBand') view.deepBand = demoMask;
        else if (layer === 'glass') view.glass = demoMask;
        else if (layer === 'land' && view.snapLeft > 0) view.land = demoMask;
      } else if (layer !== '') {
        layer = '';
        view.glassCluster = -1;
      }
      if (bud?.state === 0) view.bud = mask;
      if (view.frost > 0.001 || view.snapLeft > 0) meterOn = true;
      view.meter = meterOn;
      return view;
    },
    demo(name, s, snap, time) {
      // The single-file build has no demo hook (main.ts): the staging below compiles away there.
      if (import.meta.env.MODE === 'single') return false;
      const nb = s.nubs;
      const gd = s.guide;
      const theta = Math.round(snap.theta);
      let ev: SimEvent | null = null;
      const stage = (l: typeof layer): void => {
        layer = l;
        layerEnd = time + DEMO_S;
      };
      switch (name) {
        case 'bud':
        case 'bloom': {
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
          break;
        }
        case 'snap':
          ev = stageSnap(s, time);
          break;
        case 'snapReady':
        case 'pips':
        case 'spill':
          // One snap ready; two pips, the second 60 % full; both full and spilling over.
          frostDemo = name === 'snapReady' ? 1 : name === 'pips' ? 1.6 : 2;
          frostEnd = time + DEMO_S;
          ev = name === 'spill' ? { e: 'frostSpill', lostH: 30 } : { e: 'frostReady', charges: Math.floor(frostDemo) };
          break;
        case 'deep':
          deepEnd = time + DEMO_S;
          ev = { e: 'deepEnter' };
          break;
        case 'ring':
        case 'bleed':
          // The core's debug hook: ×3 two thirds of the way to ×4 (bleeding: ×4 at 40 %, draining);
          // the badge holds it for the demo whatever the sim's rules do next.
          ringLevel = name === 'ring' ? 3 : 4;
          ringFill = name === 'ring' ? 2 / 3 : 0.4;
          debugRing(s, ringLevel, ringFill * (RING_NEED[ringLevel - 1] as number));
          ringEnd = time + DEMO_S;
          if (name === 'bleed') bleedEnd = time + DEMO_S;
          return true;
        case 'trick':
          ev = { e: 'ringTrick', kind: 'swing', units: TUNING.ring.trick };
          break;
        case 'cash':
          // A snap at ×4 pours the ring into the frost: +0.3 of a snap.
          ev = { e: 'snapCash', level: 4, refundH: TUNING.bank.cashPerLevelH * 3 };
          break;
        case 'bank':
        case 'land':
          // A snap with income banked under it (frozen pips, the pending chip); the landing's teal is
          // where the shade will be when it ends (the shade now, before the cloud covers it).
          if (name === 'land') {
            demoMask.set(gd.now);
            stage('land');
          } else {
            bankDemo = TUNING.bank.bloomH;
            frostDemo = 0.6;
            frostEnd = time + TUNING.frost.snapSec;
          }
          ev = stageSnap(s, time);
          break;
        case 'landing':
          ev = { e: 'snapLand', chain: 2, own: true, x: nb.x, y: nb.y };
          break;
        case 'deepBand':
          // Deep shade at the sun's angle (inside the teal when Nubs is shaded).
          arcMask(theta, 14, demoMask);
          stage('deepBand');
          deepEnd = time + DEMO_S;
          ev = { e: 'deepEnter' };
          break;
        case 'glass': {
          // The nearest flakes ahead turn glass, and a thin arc 70° round from the sun saves them.
          arcMask(theta + 70, 16, demoMask);
          stage('glass');
          const n = queryPickups(s.world, nb.y, nb.y + 400, pickBuf);
          for (let i = 0; i < n; i++) {
            const p = pickBuf[i] as Pickup;
            if (p.state === PICKUP_ALIVE && p.kind === 'flake') {
              view.glassCluster = p.cluster >= 0 ? p.cluster : p.id;
              break;
            }
          }
          return true;
        }
        case 'flareSoon':
          // A kept flare whose warning starts in 5 s: the sim plays it (a new player's tip comes first).
          flareDemo = debugFlare(s, 300, 10);
          arcMask(theta + 40, 16, demoMask);
          return true;
        case 'flare':
        case 'parry': {
          if (name === 'flare' || !flareDemo) {
            // A kept flare whose warning starts now (the core's debug hook); the shade that holds
            // through it 40° round from the sun.
            flareDemo = debugFlare(s, 0, 10);
            arcMask(theta + 40, 16, demoMask);
          }
          const f = flareDemo as Flare;
          ev = name === 'flare' ? { e: 'flareWarn', id: f.id, ticks: f.riseTick - f.warnTick, d: f.d } : { e: 'flareParry', id: f.id, snap: false, snow: TUNING.flare.snow };
          if (name === 'parry') m.onEvent(ev);
          break;
        }
        case 'noonHeat':
          heatDemo = view.noonHeat = 1.25;
          ev = { e: 'dawn', day: s.day };
          break;
        default:
          return false;
      }
      m.route(ev);
      return true;
    },
  };
  return m;
}
