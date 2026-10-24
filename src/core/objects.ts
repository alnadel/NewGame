// World object types shared by generation, the sim and the renderer. Coordinates are world u
// (x east, y north, z up); polygons are flat CCW arrays [x0, y0, x1, y1, ...].
//
// Casters, clouds and balls are immutable once generated. Pickups carry their own melt/collect state
// because every run owns its world.

import type { BiomeId } from '../config/days.ts';
import type { CasterKind } from '../config/casters.ts';
import type { HeroDeath } from '../config/heroes.ts';
import type { ElKind } from '../config/trials.ts';

export type { BiomeId, CasterKind };

interface PartBounds {
  /** Ground-plane bounds of the part's footprint (discs: the canopy circle). */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** A solid block standing on the ground: convex footprint, height h. */
export interface PrismPart extends PartBounds {
  readonly t: 'prism';
  readonly pts: Float64Array;
  readonly n: number;
  readonly h: number;
}

/** A floating convex plate between heights z0 and z1 (arch lintels, stall roofs). */
export interface SlabPart extends PartBounds {
  readonly t: 'slab';
  readonly pts: Float64Array;
  readonly n: number;
  readonly z0: number;
  readonly z1: number;
}

/** A floating disc (tree canopy) of radius r at height z. */
export interface DiscPart extends PartBounds {
  readonly t: 'disc';
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly z: number;
}

export type Part = PrismPart | SlabPart | DiscPart;

export interface Caster {
  /** Unique, deterministic id (generation order). */
  readonly id: number;
  readonly kind: CasterKind;
  /** Seeded display name, e.g. "the Mossy Oak". */
  readonly name: string;
  readonly biome: BiomeId;
  /** Center of the caster (for trees: the trunk). */
  readonly x: number;
  readonly y: number;
  /** Rotation in degrees (multiple of 15; 0 for trees, rocks, gate arches). */
  readonly rot: number;
  readonly parts: readonly Part[];
  /** Ground footprint hull of the solid parts (prisms + slabs), CCW; hullN vertices. */
  readonly hull: Float64Array;
  readonly hullN: number;
  /** Ground bounds of every part, discs included. */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Tallest point of any part (u). */
  readonly maxZ: number;
  /** Which side of the trail it stands on: −1 west, +1 east, 0 straddling (gate arch). */
  readonly side: -1 | 0 | 1;
  /** Inserted by the validator. */
  readonly rescue: boolean;
  /** A gate arch straddling the trail. */
  readonly gate: boolean;
  /** Pedestal of a gazing ball: that ball's id, else −1. */
  readonly ballId: number;
  /** Chunk index that placed it. */
  readonly chunk: number;
}

/**
 * 'snap': the v1.5 Cold Snap cloud (z 0: its shadow lies right under it whatever θ is). 'rain':
 * Elementals v2, a rain cloud's shade proxy (z 0, made only on Trials; render/clouds.ts skips it).
 */
export type CloudKind = 'overtaker' | 'waiter' | 'parked' | 'snap' | 'rain';

/** A cloud at altitude z. Its position is analytic in absolute time (s since Day 1 dawn). */
export interface Cloud {
  readonly id: number;
  readonly kind: CloudKind;
  /** Spawn time (absolute s) and lifetime (s): it exists for tAbs ∈ [t0, t0 + life]. */
  readonly t0: number;
  readonly life: number;
  /** Center at t0 and velocity (u/s). */
  readonly x0: number;
  readonly y0: number;
  readonly vx: number;
  readonly vy: number;
  /** Ellipse radii (axis-aligned). */
  readonly rx: number;
  readonly ry: number;
  readonly z: number;
  /** Render-only lumps relative to the center: (dx, dy, r) × n, inside the ellipse. */
  readonly lumps: Float64Array;
}

export interface GazingBall {
  readonly id: number;
  /** Ball center on the ground plane; the mirror sits at height BALL_Z. */
  readonly x: number;
  readonly y: number;
  readonly name: string;
  /** Its pedestal caster. */
  readonly casterId: number;
  readonly day: number;
}

export type PickupKind = 'flake' | 'crystal' | 'flower';

export const PICKUP_ALIVE = 0;
export const PICKUP_TAKEN = 1;
export const PICKUP_MELTED = 2;
export type PickupState = 0 | 1 | 2;

export interface Pickup {
  readonly id: number;
  readonly kind: PickupKind;
  readonly x: number;
  readonly y: number;
  readonly day: number;
  /** Accumulated lit seconds (melts at TUNING.pickups.meltBudget). Render: shrink with melt. */
  melt: number;
  /** 0 alive, 1 taken, 2 melted. */
  state: PickupState;
  /**
   * v1.6 (docs/V1_6_PLAN.md §2.3): the flake cluster it belongs to (the id of the cluster's first
   * flake; −1 for crystals and flowers), its index in the cluster (0..cn − 1) and the cluster's size
   * (1 outside a cluster), and whether the cluster is glass (melts after TUNING.brittle.meltBudget;
   * read through meltBudgetOf).
   */
  readonly cluster: number;
  readonly ci: number;
  readonly cn: number;
  readonly brittle: boolean;
}

/**
 * v1.5 id spaces. Generated objects take ids from World.nextId; buds count from BUD_ID_BASE, and the
 * objects a run makes (a bloom's sunflower: RUNTIME_ID_BASE + its bud's index; a Cold Snap's cloud:
 * SNAP_ID_BASE + the run's snap count) sit above RUNTIME_ID_BASE, so they never shift a generated
 * id or name, and the validator can tell them apart (it ignores them: worlds stay a pure function of
 * their config).
 */
export const BUD_ID_BASE = 0x20000000;
/** v1.6: flakes placed two chunks behind the casters (like buds) take ids from here (CORE-2, T7). */
export const FLAKE_ID_BASE = 0x30000000;
export const RUNTIME_ID_BASE = 0x40000000;
/**
 * Elementals v2 (docs/ELEMENTALS_V2.md §3.1): trial object i (and a rain cloud's shade proxy) is
 * EL_ID_BASE + i, a plot's tree caster TREE_ID_BASE + i; both sit above RUNTIME_ID_BASE (the
 * validator ignores them) and below SNAP_ID_BASE (never mistaken for the snap cloud).
 */
export const EL_ID_BASE = 0x50000000;
export const TREE_ID_BASE = 0x58000000;
export const SNAP_ID_BASE = 0x60000000;

/** ElObj.state. */
export const EL_IDLE = 0;
export const EL_BURNING = 1;
export const EL_GONE = 2;

/** A trial object at run time (docs/ELEMENTALS_V2.md §3). Only step() writes it. */
export interface ElObj {
  readonly id: number;
  /** 'ice' turns into 'puddle' when it melts. */
  kind: ElKind;
  /** Centre x: weather drifts, the rest never move. */
  x: number;
  readonly y: number;
  /** Puddle, stone, plot, weather: radius (weather: rx); crossing: half-length along y. */
  r: number;
  /** Weather drift (u/s); 0 for the rest. */
  readonly drift: number;
  state: 0 | 1 | 2;
  /** Burn, melt or dry ticks left (0 none). */
  t: number;
  /** Flame Ember paid for the fire now burning here (0: none, or a spread fire). */
  paid: number;
  /** Sites: Sap poured in, and growth so far (≤ size). */
  size: number;
  grown: number;
  /** Sites: bit 0 lit, bit 1 under rain (refreshed every 6 ticks while growing). */
  light: number;
  /** A plot's tree caster (−1 none). */
  casterId: number;
  /** A wall, crossing or stone already touched (it acts once). */
  hit: boolean;
  /** Weather: drifting. */
  awake: boolean;
}

/** Everything a v2 Trial adds to a run (null in every Nubs run). */
export interface ElState {
  /** The trial's objects, y-sorted; never re-sorted (weather moves only in x). */
  readonly objs: ElObj[];
  /** The walker's lateral offset (u, + east) and Drip's steer target. */
  dx: number;
  dxTarget: number;
  /** Gust's wind (u/s, + east), decaying; windAt() adds the breeze. */
  wind: number;
  /** The site a hold is pouring into (index in objs, −1 none). */
  hold: number;
  /** Meter Ember's taps and Gust's swipes paid this leg, less Ember's feeds (steady health, §1.2). */
  spent: number;
  /** The walker's contacts this tick: 1 puddle, 2 rain, 4 fog, 8 stone. */
  touch: number;
  /** Ticks since the walking element's leg began. */
  legTick: number;
  /** An unbridged crossing took the walker this tick. */
  fell: boolean;
  /** What ended the run (heroDeath's line) and the object that did (−1 none). */
  cause: HeroDeath | null;
  causeObj: number;
  /** Drip's pre-TAG mask buffer (§4.4; derived, not hashed; empty when the Trial has no Drip leg). */
  readonly tagMask: Uint8Array;
}

/**
 * v1.5 Sunflower bud (docs/V1_5_PLAN.md). A bud beside the trail blooms into a tall sunflower (a
 * shade caster) once the sun has shone on it from within ±TUNING.buds.faceTol of its `face`
 * azimuth for TUNING.buds.growSec. Only step() writes `grow`, `state` and `casterId`.
 */
export interface Bud {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** The azimuth (degrees, like θ) the sun must shine from to grow it. */
  readonly face: number;
  /** Growth 0..1 (1 = blooming now). */
  grow: number;
  /** 0 bud, 1 bloomed. */
  state: 0 | 1;
  /** The sunflower caster once bloomed (world.byId), else −1. */
  casterId: number;
}

/** Flare.state: not decided yet, kept (it will fire), dropped (failed the keep test). */
export type FlareState = 0 | 1 | 2;
export const FLARE_PENDING = 0;
export const FLARE_KEPT = 1;
export const FLARE_DROPPED = 2;

/**
 * v1.6 Heat Flare (docs/V1_6_PLAN.md §2.5): the sun swells over the warning, every shadow snaps
 * shorter over the rise (ε + d·lift), holds, and falls back. Flares live on the World (w.flares,
 * sorted by riseTick); ticks are absolute. The validator (or `sim --bake` for Journey bosses)
 * decides `state` and may shift the ticks before it does; only generation and debugFlare write them.
 */
export interface Flare {
  readonly id: number;
  readonly day: number;
  /** Elevation lift at full strength (°). */
  readonly d: number;
  warnTick: number;
  riseTick: number;
  holdTick: number;
  fallTick: number;
  endTick: number;
  state: FlareState;
}
