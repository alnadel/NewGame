// Meta content catalog (pure data): Wardrobe cosmetics, the mission pool and achievements.
// GDD §6 + §8 as trimmed by V1_PLAN §11. Ids are persisted in saves: never rename one.

// ---------------------------------------------------------------------------------------------
// Cosmetics
// ---------------------------------------------------------------------------------------------

export type CosmeticSlot = 'scarf' | 'hat' | 'nose';

export const COSMETIC_SLOTS: readonly CosmeticSlot[] = ['scarf', 'hat', 'nose'];

export type AchievementId =
  | 'first-light'
  | 'night-owl'
  | 'high-noon'
  | 'solstice'
  | 'seventh-sun'
  | 'phew-nomenal'
  | 'cloud-rider'
  | 'daily-habit';

export type CosmeticId =
  | 'scarf-red'
  | 'scarf-mint'
  | 'scarf-plaid'
  | 'scarf-rainbow'
  | 'scarf-gold'
  | 'hat-none'
  | 'hat-beanie'
  | 'hat-tophat'
  | 'hat-cone'
  | 'hat-visor'
  | 'hat-crown'
  | 'nose-carrot'
  | 'nose-parsnip'
  | 'nose-cane'
  | 'nose-pinecone';

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

export type CosmeticLook = ScarfLook | HatLook | NoseLook;

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

/** All 15 cosmetics, grouped by slot in Wardrobe display order. */
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
  { id: 'scarf-gold', slot: 'scarf', name: 'Gold Scarf', unlock: byAchievement('seventh-sun'),
    look: { slot: 'scarf', pattern: 'metallic', main: '#FFC23D', shade: '#C98A12', stripes: [], shine: '#FFF3C4' } },

  // Hats
  { id: 'hat-none', slot: 'hat', name: 'No Hat', unlock: DEFAULT,
    look: { slot: 'hat', shape: 'none', main: '#FFFFFF', shade: '#FFFFFF', accent: '#FFFFFF', detail: '#FFFFFF' } },
  { id: 'hat-beanie', slot: 'hat', name: 'Beanie', unlock: snow(80),
    look: { slot: 'hat', shape: 'beanie', main: '#FF8A5B', shade: '#D9653A', accent: '#FFF8EE', detail: '#FFF8EE' } },
  { id: 'hat-tophat', slot: 'hat', name: 'Top Hat', unlock: snow(200),
    look: { slot: 'hat', shape: 'topHat', main: '#2B2140', shade: '#1B1429', accent: '#E8475A', detail: '#E8475A' } },
  { id: 'hat-cone', slot: 'hat', name: 'Party Cone', unlock: snow(300),
    look: { slot: 'hat', shape: 'partyCone', main: '#9B5DE5', shade: '#7440B8', accent: '#2EC4B6', detail: '#FFC23D' } },
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

/** What Nubs is wearing; one cosmetic id per slot. Mirrors SaveV1.equipped. */
export interface Equipped {
  scarf: string;
  hat: string;
  nose: string;
}

/** Items every save owns from the start. */
export const DEFAULT_EQUIPPED: Readonly<Equipped> = { scarf: 'scarf-red', hat: 'hat-none', nose: 'nose-carrot' };

export const DEFAULT_COSMETICS: readonly CosmeticId[] = COSMETICS.filter((c) => c.unlock.kind === 'default').map(
  (c) => c.id,
);

/** Resolves an equipped set to concrete looks for the renderer (unknown ids fall back to defaults). */
export function equippedLooks(equipped: Equipped): { scarf: ScarfLook; hat: HatLook; nose: NoseLook } {
  const look = <L extends CosmeticLook>(slot: CosmeticSlot, id: string): L => {
    const c = getCosmetic(id);
    const item = c && c.slot === slot ? c : (getCosmetic(DEFAULT_EQUIPPED[slot]) as Cosmetic);
    return item.look as L;
  };
  return {
    scarf: look<ScarfLook>('scarf', equipped.scarf),
    hat: look<HatLook>('hat', equipped.hat),
    nose: look<NoseLook>('nose', equipped.nose),
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
  | 'play-daily';

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
  | 'x5Hold'
  | 'gateNoon'
  | 'cleanBalls'
  | 'dailyToday';

export interface MissionDef {
  id: MissionId;
  metric: MissionMetric;
  scale: MissionScale;
  /** Tier-1 goal: score minutes for `reach`, otherwise a count, seconds or level (1 for flags). */
  base: number;
  /** Tier-1 Snow reward (×tier). */
  reward: number;
}

/** The ordered pool (V1_PLAN §11.1). Three are active; completed ones are replaced from here. */
export const MISSIONS: readonly MissionDef[] = [
  { id: 'reach-9am', metric: 'minutes', scale: 'reach', base: 180, reward: 10 },
  { id: 'flakes-10', metric: 'flakes', scale: 'count', base: 10, reward: 10 },
  { id: 'mult-3', metric: 'maxMult', scale: 'mult', base: 3, reward: 15 },
  { id: 'survive-noon', metric: 'minutes', scale: 'reach', base: 390, reward: 20 },
  { id: 'cloud-ride', metric: 'cloudRide', scale: 'seconds', base: 3, reward: 20 },
  { id: 'reach-day-2', metric: 'minutes', scale: 'reach', base: 720, reward: 30 },
  { id: 'two-phews', metric: 'phews', scale: 'count', base: 2, reward: 25 },
  { id: 'ice-crystal', metric: 'crystals', scale: 'count', base: 1, reward: 20 },
  { id: 'hold-x5', metric: 'x5Hold', scale: 'seconds', base: 8, reward: 30 },
  { id: 'gate-arch', metric: 'gateNoon', scale: 'flag', base: 1, reward: 30 },
  { id: 'clean-balls', metric: 'cleanBalls', scale: 'count', base: 4, reward: 30 },
  { id: 'reach-day-3', metric: 'minutes', scale: 'reach', base: 1440, reward: 50 },
  { id: 'play-daily', metric: 'dailyToday', scale: 'flag', base: 1, reward: 15 },
];

export const ACTIVE_MISSIONS = 3;

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
];

const ACHIEVEMENT_BY_ID = new Map<string, AchievementDef>(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENT_BY_ID.get(id);
}

export function isAchievementId(id: unknown): id is AchievementId {
  return typeof id === 'string' && ACHIEVEMENT_BY_ID.has(id);
}
