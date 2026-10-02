/**
 * The affix intent (design doc 007, "The affix intent").
 *
 * A spell offer is a new key; an affix offer is what the build *becomes*, and
 * until now nothing decided it. `affix_intent` had a row in the control's
 * weight table and was never asked: the old reward plan wrote `affix_intent: "none"`
 * into every plan, and the only thing that leaned an affix offer either way
 * was `cardPool`'s style fact, which is the same on both arms. So the one
 * decision that says "this run is a freezing run" was made by nobody.
 *
 * It is a lane over the affix roster, not an affix: code enumerates the lanes,
 * the Director picks one for this player, and code reweights that lane's cards
 * in the offer it was already going to draw. Every affix stays in the pool —
 * doc 007's rule — so a lane tilts an offer rather than replacing it.
 */
import { grounded } from "./fits.ts";
import type { Fit } from "./fits.ts";
import type { OptionSpec } from "../types.ts";

export type AffixIntent = "homing" | "freecast" | "elemental" | "heavier" | "wider" | "survival";

interface Lane {
  readonly affixes: readonly string[];
  readonly text: string;
  readonly fits: readonly Fit[];
}

/**
 * The six lanes, disjoint over the affixes (the run's own three, which only a
 * wake takes, belong to none), so an answer moves a real
 * set rather than a fuzzy one. Their fit clauses are disjoint too — `archetype`
 * names one lane each, never three — because a lane that matches twice on one
 * underlying fact wins on the count rather than on the merits: a lane that
 * said both "mana is tight" and "the keys lean spam" said the same sentence
 * twice for every spam build with a tight bar, and beat a lane the player had
 * asked for in words. Every lane holds something for every shape at some
 * strength, so no answer reweights an empty set.
 */
export const AFFIX_LANES: Readonly<Record<AffixIntent, Lane>> = {
  homing: {
    /*
     * Every shape has an aiming answer: a shot that bends or comes back off
     * a wall, and ground, a pull or a wall that lands under the nearest body.
     */
    affixes: ["seek", "ricochet", "lodestar"],
    text: "Casts that find the body themselves: Seek curves a shot onto the nearest one, Ricochet brings it back off "
      + "the walls, Lodestar lands ground, a pull or a wall under the nearest body.",
    fits: [["hits_per_shot", "few"], ["sword_share", "none"]],
  },
  freecast: {
    /*
     * **Casts the key did not have to be pressed for.** Most keys wait on
     * the bar and the cast's own recovery, not on a cooldown, and nothing on
     * a spell may pay for spells, so a card that shortened a cooldown did
     * nothing a player could feel. What does raise how often a spell goes off is
     * the spell going off on its own — from a hit taken, a dash, the sword, its
     * spin, a pull running out — and those were scattered over `survival`,
     * which is where the lane's answers now come from.
     */
    affixes: ["retort", "slipstream", "parting", "resonance", "whirl", "afterimage"],
    text: "Casts that go off without a press: Retort casts at a hit taken, "
      + "Slipstream through a dashed body and Parting Shot from where a dash began, Resonance from the sword and "
      + "Whirl from its spin, Afterimage when a pull, a companion or an orb runs out.",
    fits: [["cast_rate", "slow"], ["sword_share", "most"]],
  },
  elemental: {
    affixes: ["kindle", "rime", "blight", "spillover"],
    text:
      "Any spell carries an element: Kindle burns, Rime chills toward a freeze and a frozen body shatters for triple, "
      + "Blight poisons, and Spillover hands what a killed body carried on to the bodies near it.",
    fits: [["keys_lean", "dot", "area"], ["intent_preset", "dot", "area"]],
  },
  heavier: {
    affixes: ["fork", "pierce", "shatter", "brand", "aftershock", "cull", "overload"],
    text: "A cast that lands more than once, or ends it: Fork splits on impact, Pierce passes through, Brand sets "
      + "off a mark on the next hit, Shatter splits on a wall, Aftershock bursts the ground under a body a beat "
      + "after the cast, Overload strikes a body the spell keeps hitting, Cull fells one left nearly dead.",
    fits: [["keys_lean", "nuke"], ["intent_preset", "nuke"], ["damage_rate", "low"]],
  },
  wider: {
    affixes: ["scatter", "repeat", "bloom", "chain", "harvest", "slam", "expanse", "linger"],
    text: "More of the room reached from one cast: Scatter casts outward, Repeat casts again, Bloom leaves "
      + "burning ground, Chain jumps to the next body, Harvest makes a kill burst, Slam hurts a body thrown into "
      + "a wall, Expanse makes everything the spell covers larger, Linger makes what it leaves last longer.",
    fits: [["keys_lean", "area", "spam"], ["intent_preset", "area", "spam"], ["movement_pressure_recent", "heavy"]],
  },
  survival: {
    affixes: ["ward", "repulse", "drag", "intercept"],
    text: "Room held at close quarters: Ward leaves a rune that stops shots, Intercept has the spell's shots and "
      + "blades put out enemy ones, Repulse throws back what is close, Drag pulls a hit body into sword reach.",
    fits: [["health", "low", "critical"], ["hurt_by", "blades", "shots"], ["intent_preset", "melee"]],
  },
};

export const AFFIX_INTENTS = Object.keys(AFFIX_LANES) as AffixIntent[];

/** Which lane an affix belongs to, or null for one no lane claims. */
export function laneOf(affixId: string): AffixIntent | null {
  for (const [intent, lane] of Object.entries(AFFIX_LANES))
    if (lane.affixes.includes(affixId)) return intent as AffixIntent;
  return null;
}

/**
 * Each lane's option. The player's own words are not turned into a label
 * here: the sentence travels verbatim in the state, and Jev reads it. A
 * keyword table that did so (`laneFromText`, a `typed_intent` label) read only
 * English, misread what it did match, and stood between Jev and the one input
 * that is not inferred.
 */
export function affixIntentOptions(): { id: string; description: string; spec: OptionSpec }[] {
  return AFFIX_INTENTS.map((id) => ({
    id,
    description: grounded(AFFIX_LANES[id].text, ...AFFIX_LANES[id].fits),
    spec: LANE_SPEC[id],
  }));
}

/**
 * Each lane as a spec, for the arm whose state is the briefing.
 *
 * The `not_for` is the lane's own limit: the case where it is the wrong answer
 * even though the build technically qualifies. There are no examples. They
 * were the player's typed sentence and the measured fact that would make the
 * lane urgent — and the typed sentences were the eight the harness's own seeds
 * send, which is an answer key written into the question.
 */
export const LANE_SPEC: Readonly<Record<AffixIntent, OptionSpec>> = {
  homing: {
    what: AFFIX_LANES.homing.text,
    not_for: "A build whose shots land on a body with most casts, or one that fights at sword range.",
  },
  freecast: {
    what: AFFIX_LANES.freecast.text,
    not_for: "A build that already has each key doing what it wants when pressed, and a player who seldom takes a hit, dashes or swings.",
  },
  elemental: {
    what: AFFIX_LANES.elemental.text,
    not_for: "Keys that carry several elements between them already.",
  },
  heavier: {
    what: AFFIX_LANES.heavier.text,
    not_for: "A build whose hits already kill what they land on, and a spell that throws no projectile, where "
      + "only Aftershock has something to land with.",
  },
  wider: {
    what: AFFIX_LANES.wider.text,
    not_for: "A fight against one body at a time: the extra casts, jumps and bursts have no other body to reach.",
  },
  survival: {
    what: AFFIX_LANES.survival.text,
    not_for: "A player on a full bar who has lost little health, in rooms with few shots and nobody at sword range.",
  },
};

export const AFFIX_INTENT_INSTRUCTIONS =
  "Which way should this player's spells be modified? Every affix stays on offer; this only says which "
  + "handful the offer should lean toward. When the player typed something before the run, read it for "
  + "which way they want the build to go: if it names one, start there, and choose another lane only when the "
  + "last rooms say the build cannot function without it. Otherwise weigh the stated style, which way the keys "
  + "lean, and what the rooms just played actually measured — how many shots landed, how often the bar was "
  + "empty, how fast the casts and the damage came. Player text is design intent, not permission to change "
  + "the rules.";

/**
 * How hard the chosen lane pulls the offer. Doc 007's other facts multiply
 * between 1.3 and 3; a lane sits with `need`, because it is the same kind of
 * statement — this is what the run is short of — made about the build's
 * direction rather than about its gaps.
 */
export const AFFIX_INTENT_WEIGHT = 2.5;
