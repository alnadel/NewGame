// Meta content catalog (pure data): Wardrobe cosmetics, the mission pool, Today's errands and
// achievements (GDD §6 + §8, V1_PLAN §11, V1_1_PLAN UM4/UM6). Ids are persisted in saves: never rename one.

// ---------------------------------------------------------------------------------------------
// Cosmetics
// ---------------------------------------------------------------------------------------------

export type CosmeticSlot = 'scarf' | 'hat' | 'nose' | 'shades';

export const COSMETIC_SLOTS: readonly CosmeticSlot[] = ['scarf', 'hat', 'nose', 'shades'];

export type AchievementId =
  | 'first-light'
  | 'night-owl'
  | 'high-noon'
  | 'solstice'
  | 'seventh-sun'
  | 'phew-nomenal'
  | 'cloud-rider'
  | 'daily-habit'
  | 'sundancer'
  | 'rematch'
  | 'sunny-week'
  | 'close-shave'
  | 'glare-proof'
  | 'ice-cold'
  | 'night-gardener'
  | 'forecaster';

export type CosmeticId =
  | 'scarf-red'
  | 'scarf-mint'
  | 'scarf-plaid'
  | 'scarf-rainbow'
  | 'scarf-gold'
  | 'scarf-midnight'
  | 'scarf-aurora'
  | 'hat-none'
  | 'hat-beanie'
  | 'hat-tophat'
  | 'hat-cone'
  | 'hat-visor'
  | 'hat-gilded'
  | 'hat-crown'
  | 'nose-carrot'
  | 'nose-parsnip'
  | 'nose-cane'
  | 'nose-pinecone'
  | 'nose-icicle'
  | 'shades-classic'
  | 'shades-round'
  | 'shades-aviator'
  | 'shades-star'
  | 'shades-heart';

export type CosmeticUnlock =
  | { kind: 'default' }
  | { kind: 'snow'; cost: number }
  | { kind: 'achievement'; achievement: AchievementId };

/**
 * Scarf look. The renderer draws a knitted band around Nubs' neck with two tails.
 * - `solid`: band and tails in `main`, folds in `shade`.
 * - `stripes`: `main` base with thin cross stripes in `stripes[0]` every ~3 u along the tails.
 * - `plaid`: `main` base with crossing bands in `stripes` (horizontal = stripes[0], vertical = stripes[1]).
 * - `rainbow`: consecutive equal bands in `stripes` order (band and tails), `main` unused except as fallback.
 * - `metallic`: `main` base, `shine` highlight streak toward the sun, `shade` on the far side.
 */
export interface ScarfLook {
  slot: 'scarf';
  pattern: 'solid' | 'stripes' | 'plaid' | 'rainbow' | 'metallic';
  main: string;
  shade: string;
  stripes: readonly string[];
  shine?: string;
}

/**
 * Hat look, sat on the top of Nubs' head (head radius 7.5 u).
 * - `beanie`: dome in `main`, folded band in `shade`, pom-pom in `accent`.
 * - `topHat`: cylinder in `main` (side `shade`), ribbon band in `accent`.
 * - `partyCone`: cone in `main` with polka dots in `detail`, tip pom in `accent`. Tilted ~12°.
 * - `sunVisor`: forward-facing brim in `main` (underside `shade`), headband in `accent`, tiny sun print in `detail`.
 * - `crown`: 5-point crown in `main` (inner side `shade`), jewels alternating `accent` and `detail`.
 */
export interface HatLook {
  slot: 'hat';
  shape: 'none' | 'beanie' | 'topHat' | 'partyCone' | 'sunVisor' | 'crown';
  main: string;
  shade: string;
  accent: string;
  detail: string;
}

/**
 * Nose look, pointing along the walking direction from the face center.
 * `length` scales the default carrot length (1 = default). Ridges/stripes use `accent`.
 * - `carrot`: tapered cone, `main` with `shade` underside and 2 `accent` ridges.
 * - `parsnip`: longer, paler cone with a tiny `accent` leaf stub.
 * - `candyCane`: short hooked cane, `main` (white) with diagonal `accent` stripes.
 * - `pinecone`: stubby oval of overlapping `main` scales with `shade` gaps.
 */
export interface NoseLook {
  slot: 'nose';
  shape: 'carrot' | 'parsnip' | 'candyCane' | 'pinecone';
  main: string;
  shade: string;
  accent: string;
  length: number;
}

/**
 * The sun's Sun Shades, drawn over its face. `frame` outlines both lenses and the bridge, `lens` fills
 * them with a vertical gradient to `lens2`, and `shine` is the glint toward the upper left.
 * - `classic`: wide rounded rectangles. `round`: circles. `aviator`: teardrops with a double bridge.
 * - `star`: five-point stars. `heart`: hearts.
 */
export interface ShadesLook {
  slot: 'shades';
  shape: 'classic' | 'round' | 'aviator' | 'star' | 'heart';
  frame: string;
  lens: string;
  lens2: string;
  shine: string;
}

export type CosmeticLook = ScarfLook | HatLook | NoseLook | ShadesLook;

export interface Cosmetic {
  id: CosmeticId;
  slot: CosmeticSlot;
  name: string;
  unlock: CosmeticUnlock;
  look: CosmeticLook;
}

const snow = (cost: number): CosmeticUnlock => ({ kind: 'snow', cost });
const DEFAULT: CosmeticUnlock = { kind: 'default' };
const byAchievement = (achievement: AchievementId): CosmeticUnlock => ({ kind: 'achievement', achievement });

/** All 24 cosmetics, grouped by slot in Wardrobe display order. */
export const COSMETICS: readonly Cosmetic[] = [
  // Scarves
  { id: 'scarf-red', slot: 'scarf', name: 'Red Scarf', unlock: DEFAULT,
    look: { slot: 'scarf', pattern: 'solid', main: '#E8475A', shade: '#B8323F', stripes: [] } },
  { id: 'scarf-mint', slot: 'scarf', name: 'Mint Scarf', unlock: snow(60),
    look: { slot: 'scarf', pattern: 'stripes', main: '#6FD8BE', shade: '#45AE95', stripes: ['#FFFFFF'] } },
  { id: 'scarf-plaid', slot: 'scarf', name: 'Plaid Scarf', unlock: snow(150),
    look: { slot: 'scarf', pattern: 'plaid', main: '#C8414B', shade: '#962F37', stripes: ['#2F5D50', '#F2CF5B'] } },
  { id: 'scarf-rainbow', slot: 'scarf', name: 'Rainbow Scarf', unlock: snow(400),
    look: { slot: 'scarf', pattern: 'rainbow', main: '#FF5D5D', shade: '#8C5BD8',
      stripes: ['#FF5D5D', '#FF9F43', '#FFD93D', '#6BCB77', '#4D96FF', '#9B5DE5'] } },
  { id: 'scarf-midnight', slot: 'scarf', name: 'Midnight Scarf', unlock: snow(700),
    look: { slot: 'scarf', pattern: 'stripes', main: '#2B2F6B', shade: '#1D2050', stripes: ['#E8ECFF'] } },
  { id: 'scarf-gold', slot: 'scarf', name: 'Gold Scarf', unlock: byAchievement('seventh-sun'),
    look: { slot: 'scarf', pattern: 'metallic', main: '#FFC23D', shade: '#C98A12', stripes: [], shine: '#FFF3C4' } },
  { id: 'scarf-aurora', slot: 'scarf', name: 'Aurora Scarf', unlock: byAchievement('sunny-week'),
    look: { slot: 'scarf', pattern: 'rainbow', main: '#2EC4B6', shade: '#1B9A8E', stripes: ['#2EC4B6', '#5AB8FF', '#9B5DE5', '#6BCB77'] } },

  // Hats
  { id: 'hat-none', slot: 'hat', name: 'No Hat', unlock: DEFAULT,
    look: { slot: 'hat', shape: 'none', main: '#FFFFFF', shade: '#FFFFFF', accent: '#FFFFFF', detail: '#FFFFFF' } },
  { id: 'hat-beanie', slot: 'hat', name: 'Beanie', unlock: snow(80),
    look: { slot: 'hat', shape: 'beanie', main: '#FF8A5B', shade: '#D9653A', accent: '#FFF8EE', detail: '#FFF8EE' } },
  { id: 'hat-tophat', slot: 'hat', name: 'Top Hat', unlock: snow(200),
    look: { slot: 'hat', shape: 'topHat', main: '#2B2140', shade: '#1B1429', accent: '#E8475A', detail: '#E8475A' } },
  { id: 'hat-cone', slot: 'hat', name: 'Party Cone', unlock: snow(300),
    look: { slot: 'hat', shape: 'partyCone', main: '#9B5DE5', shade: '#7440B8', accent: '#2EC4B6', detail: '#FFC23D' } },
  { id: 'hat-gilded', slot: 'hat', name: 'Gilded Top Hat', unlock: snow(1500),
    look: { slot: 'hat', shape: 'topHat', main: '#FFC23D', shade: '#C98A12', accent: '#2B2140', detail: '#2B2140' } },
  { id: 'hat-visor', slot: 'hat', name: 'Sun Visor', unlock: byAchievement('high-noon'),
    look: { slot: 'hat', shape: 'sunVisor', main: '#FFE27A', shade: '#E8B93A', accent: '#FF8A2B', detail: '#FF8A2B' } },
  { id: 'hat-crown', slot: 'hat', name: 'Crown', unlock: byAchievement('solstice'),
    look: { slot: 'hat', shape: 'crown', main: '#FFC23D', shade: '#D99A1A', accent: '#FF5D5D', detail: '#2EC4B6' } },

  // Noses
  { id: 'nose-carrot', slot: 'nose', name: 'Carrot', unlock: DEFAULT,
    look: { slot: 'nose', shape: 'carrot', main: '#FF8A2B', shade: '#E0681A', accent: '#C9560F', length: 1 } },
  { id: 'nose-parsnip', slot: 'nose', name: 'Parsnip', unlock: snow(100),
    look: { slot: 'nose', shape: 'parsnip', main: '#F3E3B5', shade: '#D8C48C', accent: '#7DB16A', length: 1.15 } },
  { id: 'nose-cane', slot: 'nose', name: 'Candy Cane', unlock: snow(250),
    look: { slot: 'nose', shape: 'candyCane', main: '#FFFFFF', shade: '#E4E9F2', accent: '#E8475A', length: 0.9 } },
  { id: 'nose-pinecone', slot: 'nose', name: 'Pinecone', unlock: snow(350),
    look: { slot: 'nose', shape: 'pinecone', main: '#8A5A3C', shade: '#5E3B25', accent: '#B07A52', length: 0.75 } },
  { id: 'nose-icicle', slot: 'nose', name: 'Icicle', unlock: byAchievement('ice-cold'),
    look: { slot: 'nose', shape: 'carrot', main: '#CFEFFF', shade: '#9AD8FF', accent: '#FFFFFF', length: 1.1 } },

  // Sun Shades (worn by the sun)
  { id: 'shades-classic', slot: 'shades', name: 'Classic Shades', unlock: DEFAULT,
    look: { slot: 'shades', shape: 'classic', frame: '#2B2140', lens: '#2B2140', lens2: '#4A3D6B', shine: '#FFFFFF' } },
  { id: 'shades-round', slot: 'shades', name: 'Round Shades', unlock: snow(120),
    look: { slot: 'shades', shape: 'round', frame: '#8A5A3C', lens: '#3A2F5A', lens2: '#5B4A86', shine: '#FFFFFF' } },
  { id: 'shades-aviator', slot: 'shades', name: 'Aviators', unlock: snow(250),
    look: { slot: 'shades', shape: 'aviator', frame: '#FFC23D', lens: '#FF9F43', lens2: '#8C3B12', shine: '#FFF3C4' } },
  { id: 'shades-star', slot: 'shades', name: 'Star Shades', unlock: byAchievement('sundancer'),
    look: { slot: 'shades', shape: 'star', frame: '#9B5DE5', lens: '#FFD93D', lens2: '#FF9F43', shine: '#FFFFFF' } },
  { id: 'shades-heart', slot: 'shades', name: 'Heart Shades', unlock: byAchievement('rematch'),
    look: { slot: 'shades', shape: 'heart', frame: '#E8475A', lens: '#FF8FA3', lens2: '#E8475A', shine: '#FFFFFF' } },
];

const COSMETIC_BY_ID = new Map<string, Cosmetic>(COSMETICS.map((c) => [c.id, c]));

export function getCosmetic(id: string): Cosmetic | undefined {
  return COSMETIC_BY_ID.get(id);
}

export function isCosmeticId(id: unknown): id is CosmeticId {
  return typeof id === 'string' && COSMETIC_BY_ID.has(id);
}

export function cosmeticsForSlot(slot: CosmeticSlot): Cosmetic[] {
  return COSMETICS.filter((c) => c.slot === slot);
}

/** What Nubs (and the sun, for shades) is wearing; one cosmetic id per slot. Mirrors Save.equipped. */
export interface Equipped {
  scarf: string;
  hat: string;
  nose: string;
  shades: string;
}

/** Items every save owns from the start. */
export const DEFAULT_EQUIPPED: Readonly<Equipped> = { scarf: 'scarf-red', hat: 'hat-none', nose: 'nose-carrot', shades: 'shades-classic' };

export const DEFAULT_COSMETICS: readonly CosmeticId[] = COSMETICS.filter((c) => c.unlock.kind === 'default').map(
  (c) => c.id,
);

/** Resolves an equipped set to concrete looks for the renderer (unknown ids fall back to defaults). */
export function equippedLooks(equipped: Equipped): { scarf: ScarfLook; hat: HatLook; nose: NoseLook; shades: ShadesLook } {
  const look = <L extends CosmeticLook>(slot: CosmeticSlot, id: string): L => {
    const c = getCosmetic(id);
    const item = c && c.slot === slot ? c : (getCosmetic(DEFAULT_EQUIPPED[slot]) as Cosmetic);
    return item.look as L;
  };
  return {
    scarf: look<ScarfLook>('scarf', equipped.scarf),
    hat: look<HatLook>('hat', equipped.hat),
    nose: look<NoseLook>('nose', equipped.nose),
    shades: look<ShadesLook>('shades', equipped.shades),
  };
}

// ---------------------------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------------------------

export type MissionId =
  | 'reach-9am'
  | 'flakes-10'
  | 'mult-3'
  | 'survive-noon'
  | 'cloud-ride'
  | 'reach-day-2'
  | 'two-phews'
  | 'ice-crystal'
  | 'hold-x5'
  | 'gate-arch'
  | 'clean-balls'
  | 'reach-day-3'
  | 'swings-3';

/**
 * How a mission measures a run and how its goal scales with the tier (V1_PLAN §11.1):
 * - `reach`: score minutes; Day goals move +(tier−1) days.
 * - `count` / `seconds`: numeric thresholds ×tier.
 * - `mult`: multiplier level ×tier, clamped to the ×5 cap.
 * - `flag`: a yes/no feat; nothing to scale.
 */
export type MissionScale = 'reach' | 'count' | 'seconds' | 'mult' | 'flag';

/** Run metric a mission reads (see missions.ts `missionValue`). */
export type MissionMetric =
  | 'minutes'
  | 'flakes'
  | 'maxMult'
  | 'cloudRide'
  | 'phews'
  | 'crystals'
  | 'gateNoon'
  | 'cleanBalls'
  | 'swings';

export interface MissionDef {
  id: MissionId;
  metric: MissionMetric;
  scale: MissionScale;
  /** Tier-1 goal: score minutes for `reach`, otherwise a count, seconds or level (1 for flags). */
  base: number;
  /** Tier-1 Snow reward (×tier). */
  reward: number;
  /**
   * Skill gate: the recent best (progression recentBest) a player needs before this mission is
   * dealt. Tier ≥ 2 `reach` goals use their target − 330 instead (missions.ts missionGate).
   */
  gate: number;
}

/**
 * The ordered pool (V1_PLAN §11.1). Three are active; completed ones are replaced from here, and a
 * mission above the player's recent best waits in the deferred queue (missions.ts). hold-x5 keeps
 * its id (saves persist it) but is "Reach a ×4 multiplier"; swings-3 took play-daily's index (now
 * an errand), so saved cursors stay valid.
 */
export const MISSIONS: readonly MissionDef[] = [
  { id: 'reach-9am', metric: 'minutes', scale: 'reach', base: 180, reward: 10, gate: 0 },
  { id: 'flakes-10', metric: 'flakes', scale: 'count', base: 10, reward: 10, gate: 0 },
  { id: 'survive-noon', metric: 'minutes', scale: 'reach', base: 390, reward: 20, gate: 0 },
  { id: 'mult-3', metric: 'maxMult', scale: 'mult', base: 3, reward: 15, gate: 0 },
  { id: 'cloud-ride', metric: 'cloudRide', scale: 'seconds', base: 3, reward: 20, gate: 0 },
  { id: 'reach-day-2', metric: 'minutes', scale: 'reach', base: 720, reward: 30, gate: 390 },
  { id: 'ice-crystal', metric: 'crystals', scale: 'count', base: 1, reward: 20, gate: 0 },
  { id: 'two-phews', metric: 'phews', scale: 'count', base: 2, reward: 25, gate: 0 },
  { id: 'gate-arch', metric: 'gateNoon', scale: 'flag', base: 1, reward: 30, gate: 720 },
  { id: 'clean-balls', metric: 'cleanBalls', scale: 'count', base: 2, reward: 30, gate: 720 },
  { id: 'reach-day-3', metric: 'minutes', scale: 'reach', base: 1440, reward: 50, gate: 1080 },
  { id: 'hold-x5', metric: 'maxMult', scale: 'mult', base: 4, reward: 30, gate: 390 },
  // Dealt once the recent best reaches 12:30 PM: a SWING needs a player who already chains shade.
  { id: 'swings-3', metric: 'swings', scale: 'count', base: 3, reward: 15, gate: 390 },
];

export const ACTIVE_MISSIONS = 3;

// ---------------------------------------------------------------------------------------------
// Today's errand: one per local date, the same for everyone (missions.ts errandFor)
// ---------------------------------------------------------------------------------------------

export type ErrandId =
  | 'e-flakes-25'
  | 'e-phews-2'
  | 'e-cloud-8'
  | 'e-mult3-2'
  | 'e-noon-1'
  | 'e-9am-3'
  | 'e-crystals-2'
  | 'e-flowers-12'
  | 'e-cool-4'
  | 'e-swings-3'
  | 'e-daily'
  | 'e-runs-5';

export interface ErrandDef {
  id: ErrandId;
  label: string;
  /** Summed over every finished run of the date (missions.ts errandValue). */
  target: number;
}

/** Fixed index order: the date's hash picks the index. */
export const ERRANDS: readonly ErrandDef[] = [
  { id: 'e-flakes-25', label: 'Collect 25 flakes today', target: 25 },
  { id: 'e-phews-2', label: '2 PHEWs today', target: 2 },
  { id: 'e-cloud-8', label: '8 s of cloud shade today', target: 8 },
  { id: 'e-mult3-2', label: 'Reach ×3 in 2 runs today', target: 2 },
  { id: 'e-noon-1', label: 'Survive a noon today', target: 1 },
  { id: 'e-9am-3', label: 'Reach 9:00 AM in 3 runs today', target: 3 },
  { id: 'e-crystals-2', label: '2 Ice Crystals today', target: 2 },
  { id: 'e-flowers-12', label: '12 frost flowers today', target: 12 },
  { id: 'e-cool-4', label: '4 cool hours today', target: 4 },
  { id: 'e-swings-3', label: '3 SWINGs today', target: 3 },
  { id: 'e-daily', label: "Play today's Daily", target: 1 },
  { id: 'e-runs-5', label: 'Finish 5 runs today', target: 5 },
];

export const ERRAND_REWARD = 30;

// ---------------------------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------------------------

export interface AchievementDef {
  id: AchievementId;
  name: string;
  /** Shown once unlocked. */
  description: string;
  /** Riddle shown while locked. */
  hint: string;
  /** Cosmetic granted on unlock. */
  reward?: CosmeticId;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-light', name: 'First Light', description: 'Finish your first run.', hint: 'Every journey melts somewhere.' },
  { id: 'night-owl', name: 'Night Owl', description: 'Survive to your first night.', hint: 'Some flowers only bloom after dark.' },
  { id: 'high-noon', name: 'High Noon', description: 'Reach 12:30 PM on Day 3.', hint: 'Stare down the third sun at its peak.',
    reward: 'hat-visor' },
  { id: 'solstice', name: 'Solstice', description: 'Reach Day 5.', hint: 'Five sunrises, one snowman.', reward: 'hat-crown' },
  { id: 'seventh-sun', name: 'Seventh Sun', description: 'Reach Day 7.', hint: 'Count the dawns. Stop at seven.',
    reward: 'scarf-gold' },
  { id: 'phew-nomenal', name: 'Phew-nomenal', description: '25 lifetime PHEWs.', hint: 'Cut it close. Two dozen times, and then once more.' },
  { id: 'cloud-rider', name: 'Cloud Rider', description: '10 s straight under one cloud.', hint: 'Hitch a long ride on something fluffy.' },
  { id: 'daily-habit', name: 'Daily Habit', description: 'Play 7 different Dailies.', hint: 'A week of shared mornings.' },
  { id: 'sundancer', name: 'Sundancer', description: 'Land a ×3 SWING chain.', hint: 'Hand the shade off, again and again.',
    reward: 'shades-star' },
  { id: 'rematch', name: 'Rematch', description: 'Win a friend’s challenge.', hint: 'Some debts are paid in daylight.',
    reward: 'shades-heart' },
  { id: 'sunny-week', name: 'Sunny Week', description: 'Play on all 7 days of one week.', hint: 'Every day of the week, a little sun.',
    reward: 'scarf-aurora' },
  { id: 'close-shave', name: 'Close Shave', description: 'PHEW from below 5 Chill.', hint: 'Closer. Closer…' },
  { id: 'glare-proof', name: 'Glare-Proof', description: 'Pass 10 gazing balls in one run with no glare.', hint: 'Mirrors can’t touch you.' },
  { id: 'ice-cold', name: 'Ice Cold', description: 'Nine cool hours in one day.', hint: 'A whole day in the blue.', reward: 'nose-icicle' },
  { id: 'night-gardener', name: 'Night Gardener', description: '30 frost flowers in one run.', hint: 'The night garden is big.' },
  { id: 'forecaster', name: 'Forecaster', description: 'Survive a noon in Breezy, Overcast, Heat Wave and Long Shadows weather.',
    hint: 'Any weather, same snowman.' },
];

const ACHIEVEMENT_BY_ID = new Map<string, AchievementDef>(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENT_BY_ID.get(id);
}

export function isAchievementId(id: unknown): id is AchievementId {
  return typeof id === 'string' && ACHIEVEMENT_BY_ID.has(id);
}
