// World object types shared by generation, the sim and the renderer. Coordinates are world u
// (x east, y north, z up); polygons are flat CCW arrays [x0, y0, x1, y1, ...].
//
// Casters, clouds and balls are immutable once generated. Pickups carry their own melt/collect state
// because every run owns its world.

import type { BiomeId } from '../config/days.ts';
import type { CasterKind } from '../config/casters.ts';

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

/** 'snap': the v1.5 Cold Snap cloud (z 0: its shadow lies right under it whatever θ is). */
export type CloudKind = 'overtaker' | 'waiter' | 'parked' | 'snap';

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
/** Elementals (docs/ELEMENTALS.md §1.3): Sprout's seeded sunflowers, SEED_ID_BASE + the run's seed count. */
export const SEED_ID_BASE = 0x50000000;
export const SNAP_ID_BASE = 0x60000000;

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
