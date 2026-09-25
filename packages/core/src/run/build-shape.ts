/**
 * **How far the build has taken shape** (design doc 007, "What the player
 * needs at each stage").
 *
 * How hard the build hits is what the last fights measured (`run/observed.ts`);
 * this says whether there is a build at all yet. The two come apart
 * constantly: a single high-level spell can hit hard while two keys sit empty,
 * and three keys with no affixes on them can hit softly while every hole is
 * already filled. Pacing reads the first; **the offer reads this one**, because
 * what a player needs from a door is a function of what is missing, not of how
 * hard they are hitting.
 *
 * The rule the roguelikes this one learns from all share: *the less complete
 * the build, the more the offer should be things that let it take shape.* Slay
 * the Spire front-loads commons and card-draw; Hades' early boons are the ones
 * that define a run and its duo boons arrive once two gods are held; Isaac's
 * early pools are item pools rather than coins. Gold and generic stats are the
 * late-run currency, because they only pay off through a build that exists.
 *
 * Three levels, from three things the player can see on their own staff:
 *
 * - **raw** — keys are empty. Almost nothing the player holds is doing work
 *   yet, and a spell is worth more than anything else on offer.
 * - **forming** — the keys are filling, but they are bare. Affixes onto the
 *   spells that have open slots are what turns three spells into one build.
 * - **formed** — keys full, affixes on, levels up. There is nothing left to
 *   fill, so gold, stats and raising what is held are what is left to buy.
 *
 * It is a **ratio of what is filled to what can be**, bucketed. No number
 * reaches Jev.
 */
import type { BuildShape } from "../types.ts";

/**
 * The weights on the three halves of "a build".
 *
 * A key is worth most: an empty key is a spell the player cannot cast at all,
 * and no amount of affixes on the other two makes up for it. Affix slots come
 * next, because doc 013's affixes are what a build *is* — the events, as
 * against the numbers. Levels count least and are counted last: they are the
 * blacksmith's business, and a run that bought levels instead of breadth has a
 * narrow build rather than a finished one.
 */
export const SHAPE_WEIGHTS = { keys: 0.5, affixes: 0.3, levels: 0.2 } as const;

/** Below this the build is raw; above the second, formed. */
export const FORMING_ABOVE = 0.35;
export const FORMED_ABOVE = 0.7;

export interface BuildShapeInput {
  /** Keys holding a spell, and how many the staff has. */
  readonly keysFilled: number;
  readonly keySlots: number;
  /** Affixes attached across every key, and how many slots those keys offer. */
  readonly affixesAttached: number;
  readonly affixSlotsPerKey: number;
  /** Each held spell's level, and the cap a level can reach. */
  readonly levels: readonly number[];
  readonly levelMax: number;
}

/** The filled share, 0 to 1. Exported so a readout can show the raw figure. */
export function buildCompletion(input: BuildShapeInput): number {
  const keySlots = Math.max(1, input.keySlots);
  const keys = Math.min(1, input.keysFilled / keySlots);
  /*
   * Affix slots are counted against **every key the staff has**, not only the
   * filled ones. Counting them against the filled keys alone would let a run
   * holding one spell with three affixes read as fully affixed, which is the
   * narrow build above dressed as a finished one.
   */
  const affixSlots = Math.max(1, keySlots * input.affixSlotsPerKey);
  const affixes = Math.min(1, input.affixesAttached / affixSlots);
  const levelRoom = Math.max(1, keySlots * Math.max(1, input.levelMax - 1));
  const levels = Math.min(1, input.levels.reduce((t, l) => t + Math.max(0, l - 1), 0) / levelRoom);
  return SHAPE_WEIGHTS.keys * keys + SHAPE_WEIGHTS.affixes * affixes + SHAPE_WEIGHTS.levels * levels;
}

export function bucketBuildShape(completion: number): BuildShape {
  if (!Number.isFinite(completion) || completion <= FORMING_ABOVE) return "raw";
  return completion > FORMED_ABOVE ? "formed" : "forming";
}

export function buildShapeFor(input: BuildShapeInput): BuildShape {
  return bucketBuildShape(buildCompletion(input));
}

/**
 * **Which style the keys lean**, as a tally of the tags on the spells the
 * player is actually holding — a fact about the staff, not a verdict about the
 * player.
 *
 * It replaces `archetype` in the Jev state. That label came out of the build
 * simulator and folded in a *simulated* quantity (the share of its damage that
 * arrived as a dot), so "this is a dot build" was partly a prediction about a
 * bot's rotation. This counts tags and nothing else, and the tie is `mixed`
 * rather than an arbitrary winner, because two styles equally represented is
 * what the keys say.
 */
export type KeysLean = "spam" | "nuke" | "area" | "dot" | "melee" | "mixed";

const LEANS: readonly KeysLean[] = ["spam", "nuke", "area", "dot", "melee"];

export function keysLean(keyTags: readonly (readonly string[])[]): KeysLean {
  const tally = new Map<KeysLean, number>();
  for (const tags of keyTags)
    for (const lean of LEANS) if (tags.includes(lean)) tally.set(lean, (tally.get(lean) ?? 0) + 1);
  const ranked = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const first = ranked[0];
  const second = ranked[1];
  if (!first || first[1] === 0) return "mixed";
  return second && second[1] === first[1] ? "mixed" : first[0];
}
