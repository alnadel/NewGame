// Elementals v2 (docs/ELEMENTALS_V2.md): the five elements, their words and their verb. Pure data.
// Controls v3 (docs/CONTROLS_V3.md §0.1, §11.2, §13.1): what the button does and what a drag moves
// while each walks, and the copy that says so.

export type HeroId = 'nubs' | 'ember' | 'drip' | 'sprout' | 'gust';
export const HERO_IDS: readonly HeroId[] = Object.freeze(['nubs', 'ember', 'drip', 'sprout', 'gust'] as HeroId[]);
/** How the walking element is played (§1.3). */
export type Verb = 'sun' | 'burn' | 'grow' | 'steer' | 'blow';
/** Controls v3: what the action button does while an element walks ('none': no button). */
export type DriveAct = 'none' | 'snap' | 'burn' | 'grow' | 'calm';
/** Controls v3: what a world drag moves while an element walks. */
export type DragKind = 'sun' | 'steer' | 'vane';
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
  /** What the button does while this element walks (§0.1). nubs 'snap', ember 'burn', sprout 'grow', drip 'none', gust 'calm'. */
  readonly act: DriveAct;
  /** What a world drag moves. nubs, ember, sprout 'sun'; drip 'steer'; gust 'vane'. */
  readonly drag: DragKind;
  /** The TAG banner's two lines (§13.1). */
  readonly dragLine: string;
  readonly actLine: string;
  /** Canvas glyph id (render/glyphs.ts). */
  readonly glyph: string;
  /** Gesture icon id ('g-drag' | 'g-press' | 'g-steer' | 'g-vane'): DOM SVGs in src/ui/icons.ts only. */
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
  actLine: string,
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
    act: verb === 'sun' ? 'snap' : verb === 'steer' ? 'none' : verb === 'blow' ? 'calm' : verb,
    drag: verb === 'steer' ? 'steer' : verb === 'blow' ? 'vane' : 'sun',
    // A held-sun leg's drag line is its verb line; the other legs turn the sun.
    dragLine: verb === 'steer' || verb === 'blow' ? verbLine : SUN_LINE,
    actLine: actLine || verbLine,
    glyph: id,
    gesture: `g-${gesture}`,
    face,
    intro,
    deathTip,
  });

const SUN_LINE = 'Drag: turn the sun';

/** The five elements (§10.1; Controls v3 copy, docs/CONTROLS_V3.md §13.1). */
export const HEROES: Readonly<Record<HeroId, HeroInfo>> = Object.freeze({
  nubs: hero('nubs', 'Nubs', 'Ice', 'Stay in the shade.', 'Shade cools · Sun melts · Drag turns the sun', 'Chill', 'sun', SUN_LINE, '← → turn the sun · ↑ or ↓ Cold Snap', 'Button: Cold Snap', 'drag', 'ice', 0, ''),
  ember: hero('ember', 'Ember', 'Fire', 'Burn a way through.', 'Tap the flame button · Light refuels · Water douses', 'Flame', 'burn', 'Button: burn the next wall', '↑ burns the next wall · ← → turn the sun', '', 'press', 'red', 1,
    'Tap the flame button for each wall as it comes: Ember burns it right on time.'),
  drip: hero('drip', 'Drip', 'Water', 'Steer for shade and puddles.', 'Drag to steer · Puddles grow · Sun shrinks', 'Size', 'steer', 'Drag: steer Drip', '← → steer', 'No button: the sun holds', 'steer', 'blue', 2,
    "Before Drip's turn, let the sun settle on the dashed arcs, then steer into the shade."),
  sprout: hero('sprout', 'Sprout', 'Nature', 'Grow the way ahead.', 'Tap the leaf button · Bridges cross gaps · Sun and rain speed it', 'Sap', 'grow', 'Button: grow the next plant', '↑ grows the next one · ← → turn the sun', '', 'press', 'green', 3,
    'Tap the leaf button as soon as you see a gap: bridges take time to grow.'),
  gust: hero('gust', 'Gust', 'Air', 'Blow the weather away.', 'Drag to set the wind · Wind costs Lift · Rain soaks', 'Lift', 'blow', 'Drag: set the wind', '← → set the wind · ↑ calm', 'Button: calm the wind', 'vane', 'cloud', 4,
    'Drag the wind early so each cloud misses the trail, then calm it to save Lift.'),
});

const BRIDGE_TIP = 'Start each bridge early: tap the leaf button as soon as you see the gap.';
const DOUSE_TIP = "Walls come first; one more tap on the flame button dries the puddle on Ember's path. Rain douses fire too.";

/**
 * Cause-specific recap tips (§10.4), keyed `'<hero>:<cause>'` or `'<cause>'`. The Results recap tip is
 * CAUSE_TIPS[`${who}:${cause}`] ?? CAUSE_TIPS[cause] ?? HEROES[who].deathTip (Nubs' melt: today's tips).
 */
export const CAUSE_TIPS: Readonly<Record<string, string>> = Object.freeze({
  fall: BRIDGE_TIP,
  swept: BRIDGE_TIP,
  crash: 'Ember can burn walls past the Tag Stone too: one tap each.',
  'ember:crash': 'Tap the flame button for every wall: Ember burns it right on time.',
  douse: DOUSE_TIP,
  rain: DOUSE_TIP,
  sizzle: 'Hot stones glow orange. Steer around them.',
  soak: 'Rain soaks Gust. Drag the wind early so each cloud misses the trail.',
  fog: 'Fog drains Gust and muffles its wind. Blow it away before Gust gets there.',
  // Sprout fell short at a crossing it had started, with its Sap spent (the session picks it).
  'sprout:sap': 'Sprout ran out of Sap. Each extra tap on a plot spends 20: save Sap for the bridges.',
});
