// Shadow-caster kinds: footprints, heights, biome weights and seeded names (GDD §2.7, V1_PLAN §7).
// Pure data: this module imports nothing. Sizes are full widths (x) × depths (y) in u before rotation.

export type CasterKind =
  | 'hut'
  | 'tree'
  | 'oak'
  | 'cottage'
  | 'stone'
  | 'hedge'
  | 'house'
  | 'arch'
  | 'stall'
  | 'column'
  | 'wall'
  | 'pedestal'
  | 'rock';

/** Every kind in a fixed order (index used by hashes and debug tooling). */
export const CASTER_KINDS: readonly CasterKind[] = Object.freeze([
  'hut', 'tree', 'oak', 'cottage', 'stone', 'hedge', 'house', 'arch', 'stall', 'column', 'wall', 'pedestal', 'rock',
] as CasterKind[]);

/** A solid block on the ground: footprint w × d, height h. */
export interface BlockSpec {
  readonly w: number;
  readonly d: number;
  readonly h: number;
}

/** A tree: square trunk prism plus a canopy disc at height z. */
export interface TreeSpec {
  readonly trunk: number;
  readonly trunkH: number;
  readonly canopyR: number;
  readonly canopyZ: number;
}

export const TREE: TreeSpec = Object.freeze({ trunk: 8, trunkH: 60, canopyR: 30, canopyZ: 75 });
export const OAK: TreeSpec = Object.freeze({ trunk: 10, trunkH: 70, canopyR: 40, canopyZ: 90 });

/** Plain prisms (roof shapes are render-only). */
export const BLOCKS = Object.freeze({
  cottage: Object.freeze({ w: 60, d: 44, h: 75 }),
  stone: Object.freeze({ w: 26, d: 26, h: 130 }),
  hedge: Object.freeze({ w: 100, d: 16, h: 40 }),
  hut: Object.freeze({ w: 36, d: 32, h: 55 }),
  house: Object.freeze({ w: 56, d: 56, h: 110 }),
  column: Object.freeze({ w: 24, d: 24, h: 140 }),
  wall: Object.freeze({ w: 100, d: 14, h: 50 }),
  pedestal: Object.freeze({ w: 10, d: 10, h: 30 }),
}) satisfies Readonly<Record<string, BlockSpec>>;

/** Arch: two square posts at ±postX on the local x axis and a lintel slab across them. */
export const ARCH = Object.freeze({ post: 14, postH: 90, postX: 32, lintelW: 78, lintelD: 14, z0: 70, z1: 90 });

/** Gate arch straddling the trail (V1_PLAN §7.2): posts centered at trailX ± postX. */
export const GATE_ARCH = Object.freeze({ post: 14, postH: 90, postX: 34, lintelW: 82, lintelD: 14, z0: 70, z1: 90, chance: 0.1 });

/** Stall: four thin posts under the roof corners, plus a roof slab. */
export const STALL = Object.freeze({ post: 4, postH: 40, roofW: 48, roofD: 34, z0: 40, z1: 46 });

/** Gazing ball mirror height above the ground (its pedestal is BLOCKS.pedestal). */
export const BALL_Z = 40;

/** Biome caster mix (weights need not sum to 1). */
export const BIOME_KINDS = Object.freeze({
  meadow: Object.freeze({
    kinds: Object.freeze(['tree', 'oak', 'cottage', 'stone', 'hedge', 'hut'] as CasterKind[]),
    weights: Object.freeze([40, 15, 15, 10, 10, 10]),
  }),
  oldtown: Object.freeze({
    kinds: Object.freeze(['house', 'tree', 'arch', 'stall', 'column', 'wall'] as CasterKind[]),
    weights: Object.freeze([20, 20, 15, 15, 15, 15]),
  }),
});

/**
 * Profile-0 tutorial chunk (V1_PLAN §6.1), y ∈ [0, 480) on a straight trail at x = 180. The start
 * hut sits on the right at y = 10, so θ0 points roughly east: the right-hand casters shade Nubs while
 * the player holds still, then the shade moves to the left-hand side and one big swing is needed.
 * side: +1 east / −1 west; lat: nearest-footprint distance from the centerline; rot: 15° steps.
 */
export interface AuthoredCaster {
  readonly kind: CasterKind;
  readonly y: number;
  readonly side: -1 | 1;
  readonly lat: number;
  readonly rot: number;
}

export const TUTORIAL = Object.freeze({
  casters: Object.freeze([
    { kind: 'hedge', y: 82, side: 1, lat: 20, rot: 6 },
    { kind: 'cottage', y: 168, side: 1, lat: 20, rot: 6 },
    { kind: 'cottage', y: 235, side: -1, lat: 20, rot: 6 },
    { kind: 'hedge', y: 321, side: -1, lat: 20, rot: 6 },
    { kind: 'hut', y: 395, side: -1, lat: 22, rot: 0 },
    { kind: 'stone', y: 440, side: -1, lat: 24, rot: 0 },
  ] as AuthoredCaster[]),
  /** Flakes on the centerline where the post-swing shade falls. */
  flakes: Object.freeze([300, 324, 348]),
});

/**
 * Start hut: first caster of every run, at y = 10 with its nearest edge 20 u from the centerline.
 * clearAhead: in generated (non-tutorial) worlds no other caster stands on the hut's side of the
 * trail for y ∈ (0, clearAhead) — about 2 s of Day-1 walking (3 s when Day 1 is Old Town, whose
 * taller casters throw longer dawn shadows). The sun starts pointing at the hut (θ0), so its shade
 * covers only the first ~15 u; after that, holding θ0 leaves Nubs in the sun until a swing finds
 * shade (the idle bot must die before 8:00 AM, V1_PLAN §13), while the far side and the casters
 * further ahead still offer shade to a player who turns the sun.
 */
export const START_HUT = Object.freeze({ y: 10, lat: 20, clearAhead: Object.freeze({ meadow: 140, oldtown: 200 }) });

/** Seeded names: "the {Adj} {Noun}". */
export const NAME_ADJECTIVES: readonly string[] = Object.freeze([
  'Old', 'Crooked', 'Blue', 'Little', 'Tall', 'Mossy', 'Lonely', 'Grumpy', 'Sleepy', 'Red', 'Leaning', 'Fancy',
]);

export const NAME_NOUNS: Readonly<Record<CasterKind, readonly string[]>> = Object.freeze({
  tree: Object.freeze(['Pine', 'Birch', 'Maple', 'Elm']),
  oak: Object.freeze(['Oak']),
  cottage: Object.freeze(['Cottage']),
  hut: Object.freeze(['Hut', 'Shed']),
  stone: Object.freeze(['Standing Stone', 'Menhir']),
  hedge: Object.freeze(['Hedge']),
  house: Object.freeze(['House', 'Bakery', 'Inn']),
  arch: Object.freeze(['Arch', 'Gate']),
  stall: Object.freeze(['Fruit Stall', 'Flower Stall']),
  column: Object.freeze(['Column', 'Statue']),
  wall: Object.freeze(['Wall']),
  pedestal: Object.freeze(['Gazing Ball']),
  rock: Object.freeze(['Shade Rock']),
});
