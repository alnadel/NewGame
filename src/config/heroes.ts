// Elementals (docs/ELEMENTALS.md): the playable heroes, their words and their ability. Pure data.

export type HeroId = 'nubs' | 'ember' | 'sprout' | 'volt' | 'drip';
export const HERO_IDS: readonly HeroId[] = Object.freeze(['nubs', 'ember', 'sprout', 'volt', 'drip'] as HeroId[]);
/** The swipe-down ability of each hero (Nubs' is the existing Cold Snap). */
export type AbilityKind = 'snap' | 'blaze' | 'seed' | 'thunder' | 'rain';
/** The candy face (render/candy.ts FACE key, kit.css face token) of a hero's coin, tile and stamp. */
export type HeroFace = 'ice' | 'red' | 'green' | 'violet' | 'blue';
/** How a hero's run ended (DeathInfo.heroCause). */
export type HeroDeath = 'melt' | 'snuff' | 'douse' | 'smother' | 'hiss' | 'wilt' | 'scorch' | 'starve' | 'fizzle' | 'overload' | 'freeze' | 'boil';

export interface HeroInfo {
  readonly id: HeroId;
  readonly name: string;        // 'Ember'
  readonly element: string;     // 'Fire'
  readonly tagline: string;     // 'Stay in the light.'
  readonly rules: readonly [string, string, string];
  readonly meter: string;       // 'Heat'
  readonly ability: AbilityKind;
  readonly abilityName: string; // 'BLAZE'
  readonly abilityLine: string; // 'Swipe down: BLAZE'
  /** Glyph id in render/glyphs.ts (ART adds 'nubs', 'ember', 'sprout', 'volt', 'drip', 'elementals'). */
  readonly glyph: string;
  readonly face: HeroFace;
  /** Trial number (1..8) whose pass unlocks the hero's roster tile; 0 = always (Nubs). */
  readonly intro: number;
  /** The Results recap tip after this hero failed ('' for Nubs: today's recap tips). */
  readonly deathTip: string;
}

const hero = (
  id: HeroId,
  name: string,
  element: string,
  tagline: string,
  rules: readonly [string, string, string],
  meter: string,
  ability: AbilityKind,
  abilityName: string,
  face: HeroFace,
  intro: number,
  deathTip: string,
): HeroInfo => Object.freeze({ id, name, element, tagline, rules, meter, ability, abilityName, abilityLine: `Swipe down: ${abilityName}`, glyph: id, face, intro, deathTip });

/** The five heroes (docs/ELEMENTALS.md §6.1). */
export const HEROES: Readonly<Record<HeroId, HeroInfo>> = Object.freeze({
  nubs: hero('nubs', 'Nubs', 'Snow', 'Stay in the shade.', ['Shade cools', 'Sun melts', 'Flakes chill'], 'Chill', 'snap', 'COLD SNAP', 'ice', 0, ''),
  ember: hero('ember', 'Ember', 'Fire', 'Stay in the light.', ['Light feeds', 'Shade snuffs', 'Flakes hiss'], 'Heat', 'blaze', 'BLAZE', 'red', 1,
    'Shadows swing with you. Turn the sun so they fall away from the flame.'),
  sprout: hero('sprout', 'Sprout', 'Leaf', "Ride the shadow's edge.", ['Edges feed', 'Full sun scorches', 'Flakes are a sip'], 'Sap', 'seed', 'SEED', 'green', 2,
    "Park the sun on a shadow's rim, not its middle."),
  volt: hero('volt', 'Volt', 'Storm', 'Strike new shade, fast.', ['New shade strikes', 'Same spot fizzles', 'Glare overloads'], 'Spark', 'thunder', 'THUNDERCLAP', 'violet', 3,
    'Strike a NEW shadow at least 40° from the last one.'),
  drip: hero('drip', 'Drip', 'Water', 'Not too hot, not too cold.', ['Sun warms', 'Shade cools', 'Both ends are fatal'], 'Temp', 'rain', 'CLOUDBURST', 'blue', 4,
    'Leave the sun (or the shade) before the needle hits the end.'),
});

/** The Results recap tip after a duo's Cold Snap smothered Ember (heroCause 'smother'). */
export const SMOTHER_TIP = "The Cold Snap's cloud smothers Ember too. Snap only while Ember's flame is high.";
