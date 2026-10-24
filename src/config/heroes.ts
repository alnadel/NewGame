// Elementals v2 (docs/ELEMENTALS_V2.md): the five elements, their words and their verb. Pure data.

export type HeroId = 'nubs' | 'ember' | 'drip' | 'sprout' | 'gust';
export const HERO_IDS: readonly HeroId[] = Object.freeze(['nubs', 'ember', 'drip', 'sprout', 'gust'] as HeroId[]);
/** How the walking element is played (§1.3). */
export type Verb = 'sun' | 'burn' | 'grow' | 'steer' | 'blow';
/** The candy face (render/candy.ts FACE key, kit.css face class) of an element's coin, tile and stamp. */
export type HeroFace = 'ice' | 'red' | 'blue' | 'green' | 'cloud';
/** How a run on a Trial ended (DeathInfo.heroCause; §10.4). */
export type HeroDeath = 'melt' | 'fall' | 'crash' | 'snuff' | 'douse' | 'rain' | 'swept' | 'evaporate' | 'sizzle' | 'soak' | 'fog';

export interface HeroInfo {
  readonly id: HeroId;
  readonly name: string;          // 'Ember'
  readonly element: string;       // 'Fire'
  readonly tagline: string;       // 'Burn a way through.'
  readonly rules: readonly [string, string, string];
  readonly meter: string;         // 'Flame'
  readonly verb: Verb;
  readonly verbLine: string;      // 'Tap: burn a wall'
  readonly keyLine: string;       // '↑ burns the next wall · ← → turn the sun'
  /** The sun takes no input while this element walks (Drip, Gust). */
  readonly sunHeld: boolean;
  /** Canvas glyph id (render/glyphs.ts). */
  readonly glyph: string;
  /** Gesture icon id ('g-drag' | 'g-tap' | 'g-hold' | 'g-steer' | 'g-swipe'): DOM SVGs in src/ui/icons.ts only. */
  readonly gesture: string;
  readonly face: HeroFace;
  /** Trial number (1..7) whose pass unlocks the roster tile; 0 = always (Nubs). */
  readonly intro: number;
  /** The Results recap tip after this element failed ('' for Nubs: today's recap tips). */
  readonly deathTip: string;
}

const hero = (
  id: HeroId,
  name: string,
  element: string,
  tagline: string,
  rules: string,
  meter: string,
  verb: Verb,
  verbLine: string,
  keyLine: string,
  gesture: string,
  face: HeroFace,
  intro: number,
  deathTip: string,
): HeroInfo =>
  Object.freeze({
    id,
    name,
    element,
    tagline,
    rules: rules.split(' · ') as unknown as readonly [string, string, string],
    meter,
    verb,
    verbLine,
    keyLine,
    sunHeld: verb === 'steer' || verb === 'blow',
    glyph: id,
    gesture: `g-${gesture}`,
    face,
    intro,
    deathTip,
  });

/** The five elements (§10.1). */
export const HEROES: Readonly<Record<HeroId, HeroInfo>> = Object.freeze({
  nubs: hero('nubs', 'Nubs', 'Ice', 'Stay in the shade.', 'Shade cools · Sun melts · Drag turns the sun', 'Chill', 'sun', 'Drag: turn the sun', '← → turn the sun · ↓ Cold Snap', 'drag', 'ice', 0, ''),
  ember: hero('ember', 'Ember', 'Fire', 'Burn a way through.', 'Tap walls to burn · Light refuels · Water douses', 'Flame', 'burn', 'Tap: burn a wall', '↑ burns the next wall · ← → turn the sun', 'tap', 'red', 1,
    'Tap each wall when its ring pulses: Ember takes its own fire back. Light refuels.'),
  drip: hero('drip', 'Drip', 'Water', 'Steer for shade and puddles.', 'Drag to steer · Puddles grow · Sun shrinks', 'Size', 'steer', 'Drag: steer Drip', '← → steer', 'steer', 'blue', 2,
    "Before Drip's turn, set the sun on the dashed arcs, then steer into the shade."),
  sprout: hero('sprout', 'Sprout', 'Nature', 'Grow the way ahead.', 'Hold to grow · Bridges cross gaps · Sun and rain speed it', 'Sap', 'grow', 'Hold: grow a plant', 'Hold ↑ grows the next one · ← → turn the sun', 'hold', 'green', 3,
    'Start each bridge as soon as you see the gap: plants take time to grow.'),
  gust: hero('gust', 'Gust', 'Air', 'Blow the weather away.', 'Swipe to blow · Each swipe costs Lift · Rain soaks', 'Lift', 'blow', 'Swipe: blow the wind', '← → blow (each costs Lift)', 'swipe', 'cloud', 4,
    'Swipe early and only when you must: the wind keeps pushing, and each swipe costs Lift.'),
});

const BRIDGE_TIP = 'Start each bridge early: hold on the gap as soon as you see it.';
const DOUSE_TIP = 'Tap a puddle on Ember\'s path to dry it. Rain douses fire too.';

/**
 * Cause-specific recap tips (§10.4), keyed `'<hero>:<cause>'` or `'<cause>'`. The Results recap tip is
 * CAUSE_TIPS[`${who}:${cause}`] ?? CAUSE_TIPS[cause] ?? HEROES[who].deathTip (Nubs' melt: today's tips).
 */
export const CAUSE_TIPS: Readonly<Record<string, string>> = Object.freeze({
  fall: BRIDGE_TIP,
  swept: BRIDGE_TIP,
  crash: 'Ember can burn walls past the Tag Stone. Clear the next stretch too.',
  'ember:crash': 'Tap a wall when its ring pulses, before Ember reaches it.',
  douse: DOUSE_TIP,
  rain: DOUSE_TIP,
  sizzle: 'Hot stones glow orange. Steer around them.',
  soak: 'Rain soaks Gust. Push each cloud before it reaches the trail.',
  fog: 'Fog drains Gust and muffles its wind. Blow it away before Gust gets there.',
});
