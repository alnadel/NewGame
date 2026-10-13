// v1.4 gamification (docs/V1_4_PLAN.md): the player's Sun Rank (XP and levels), rewards and the
// Snow Globes that hold them, what is waiting to be claimed (the menu dots), and which features a
// new player has unlocked. CONTRACT FILE: the shapes below are fixed for the v1.4 builders; the
// meta builder owns the bodies (V14-SHIM stubs until then).

import type { CosmeticId } from './content.ts';
import type { Save } from './saveTypes.ts';

/** Menu features a new player unlocks one at a time (progressive disclosure). */
export type Feature = 'endless' | 'daily' | 'missions' | 'wardrobe' | 'profile';

export type RewardKind = 'snow' | 'cosmetic' | 'globe';

/** One reward to reveal: Snow, a cosmetic, or a Snow Globe (opened later, or at once by the reveal). */
export interface Reward {
  kind: RewardKind;
  /** Snow amount ('snow'), or the number of globes ('globe'); 1 for a cosmetic. */
  amount: number;
  cosmetic?: CosmeticId;
  /** Short headline for the reveal: "Rank 5!", "Chapter 2 complete", "Week streak". */
  title: string;
}

export interface RankView {
  /** 1-based rank level. */
  level: number;
  /** The rank's name ("Puddle", "Snowball", …). */
  title: string;
  /** Lifetime XP. */
  xp: number;
  /** XP into this level, and the XP this level needs. */
  into: number;
  need: number;
  /** into / need, 0..1. */
  fraction: number;
}

/** What waits for the player: drives the red dots on the Title tray and the Profile. */
export interface Claimables {
  /** Today's daily reward is ready to claim. */
  daily: boolean;
  /** Finished missions whose reward is unclaimed (0 when missions pay out automatically). */
  missions: number;
  /** Unopened Snow Globes. */
  globes: number;
  /** Wardrobe items new since the Wardrobe was last opened (bought, unlocked or now affordable). */
  wardrobe: number;
  /** Trophies (achievements) unlocked since the Profile was last opened. */
  trophies: number;
  total: number;
}

/** The gamification part of a finished run's outcome (RunOutcome.gamify). */
export interface GamifyOutcome {
  xpBefore: number;
  xpGained: number;
  /** Rank level before and after the run (rankAfter > rankBefore: rank up). */
  rankBefore: number;
  rankAfter: number;
  /** Rewards earned by this run (rank-ups, chapter complete, all missions, …), in reveal order. */
  rewards: Reward[];
  /** Features this run unlocked. */
  featuresUnlocked: Feature[];
}

/** V14-SHIM: rank 1, no XP. */
export function rankView(save: Save): RankView {
  void save;
  return { level: 1, title: 'Puddle', xp: 0, into: 0, need: 100, fraction: 0 };
}

/** V14-SHIM: nothing waiting. */
export function claimables(save: Save): Claimables {
  void save;
  return { daily: false, missions: 0, globes: 0, wardrobe: 0, trophies: 0, total: 0 };
}

/** V14-SHIM: every feature open. */
export function featureUnlocked(save: Save, f: Feature): boolean {
  void save;
  void f;
  return true;
}

/** "Unlocks at Rank 3" / "Pass level 4 to unlock" for a locked feature's button. */
export function featureHint(f: Feature): string {
  void f;
  return 'Keep playing to unlock';
}
