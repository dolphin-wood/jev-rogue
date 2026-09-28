/**
 * **The staff, as facts** (design docs 002 and 007).
 *
 * `build_shape`, `build_gaps` and `keys_lean` say three things *about* the
 * staff; none of them says what is on it. A Director asked "which reward does
 * this player need most" was therefore answering without ever being told that
 * the player holds Shock Arc at level 5 with three affixes on it and Magic Bolt
 * at level 1 with none — which is the whole of the question. Reported from
 * play: once the affix slots were open the affix door won essentially every
 * offer, because nothing in the state could say the slots were nearly full,
 * that the levels had not moved, or that the bar was buying fewer casts every
 * time a level went up.
 *
 * So this module turns the held build into the two things Jev can use:
 *
 * - **`held_spells`**, one short line per key — the same shape `card_facts`
 *   uses, which the card questions already read well: the spell's name, its
 *   level, its school, its element, what it costs, what is on it and how many
 *   slots are left. Prose Jev matches a card description against.
 * - **six flat labels**, each a measured quantity with an honest bucket name,
 *   so an option can be *grounded* on them: levels, open affix slots, elements
 *   carried, casts a full bar buys, mana stats taken, and the affix-door run.
 *
 * Nothing here is a verdict. "casts per bar is few" is a count; "mana starved"
 * was a conclusion, and it is exactly the label doc 002 threw out.
 */
import type { ItemRegistry } from "../spells/items.ts";
import { AFFIX_SLOTS, SPELL_LEVEL_MAX, levelManaMult, spellCost } from "../sim/spells.ts";
import { schoolOf } from "../spells/schools.ts";
import { SPELL_AFFIXES, affixCostMult } from "../spells/affixes.ts";
import { STAT_UPGRADES } from "./stats.ts";

/** One key of the staff, as the run actually holds it. */
export interface HeldKey {
  readonly base: string;
  readonly level: number;
  readonly affixes: readonly { readonly id: string }[];
}

export interface BuildFactsInput {
  readonly keys: readonly HeldKey[];
  readonly items: ItemRegistry;
  /** The bar's cap, after any stat that raised it. */
  readonly manaMax: number;
  /** Every stat upgrade taken this run, by id, for `mana_stats_taken`. */
  readonly statsTaken?: readonly string[];
}

/**
 * How far the levels have moved, over what the keys could reach. `all_base` is
 * a run that has never raised one, which is what fourteen rooms of affix doors
 * produce.
 */
export type SpellLevels = "all_base" | "some_raised" | "mostly_raised";
/** Affix slots still empty across the whole staff. */
export type AffixSlotsOpen = "none" | "few" | "many";
/** How many elements the keys carry between them, infusion affixes included. */
export type HeldElements = "none" | "one" | "several";
/** How many casts a full bar buys, averaged over the keys. */
export type CastsPerBar = "many" | "some" | "few";
/** Mana-family stats taken this run. */
export type ManaStatsTaken = "none" | "one" | "several";

export interface BuildFacts {
  readonly spell_levels: SpellLevels;
  readonly affix_slots_open: AffixSlotsOpen;
  readonly held_elements: HeldElements;
  readonly casts_per_bar: CastsPerBar;
  readonly mana_stats_taken: ManaStatsTaken;
  /** One line per held key, keyed by spell id. */
  readonly held_spells: Readonly<Record<string, string>>;
}

/** What a build with nothing in it reports, so a caller never sends nothing. */
export const NO_BUILD: BuildFacts = {
  spell_levels: "all_base", affix_slots_open: "many", held_elements: "none",
  casts_per_bar: "many", mana_stats_taken: "none", held_spells: {},
};

/**
 * A cast's cost band, said in words: doc 002 keeps numbers out of the state,
 * and a player reads a spell as cheap or dear rather than as 17.5 mana.
 *
 * Cut by how many casts a full bar buys: twelve or more is `cheap`, seven to
 * eleven `moderate`, fewer `dear`. The cuts were 0.18 and 0.32 of the bar,
 * from a costing the pool no longer has: at doc 006's prices (3.75 to 15 mana
 * a cast off 90) every bare spell in the pool read `cheap`, so the word said
 * nothing about any key. At these cuts a bare key reads cheap for cost ranks
 * one to three, moderate for four and five and dear for six and seven, and
 * levels and count affixes move it up.
 */
export function costBand(mana: number, manaMax: number): "cheap" | "moderate" | "dear" {
  const share = manaMax > 0 ? mana / manaMax : 1;
  if (share <= 1 / 11.8) return "cheap";
  return share <= 1 / 7 ? "moderate" : "dear";
}

/** The mana one cast of a key costs, at its level and with its affixes. */
export function keyCost(key: HeldKey, items: ItemRegistry): number {
  const base = items.get(key.base)?.mana ?? 7;
  const affixes = key.affixes.reduce((m, a) => m * affixCostMult(a.id), 1);
  return spellCost(null, base) * levelManaMult(key.level) * affixes;
}

/**
 * **How many casts a full bar buys**, averaged over the keys held.
 *
 * This is the fact the run was missing. Raising a spell's level raises its
 * cost by ten per cent a level (`levelManaMult`), stat doors are a third of
 * the offers at best, and the bar does not grow on its own — so a run that
 * levels without buying mana quietly ends up unable to cast, and the state
 * said nothing about it until the fight had already measured a refusal.
 * Counting casts rather than mana keeps it a quantity a player can check.
 */
export function bucketCastsPerBar(manaMax: number, costs: readonly number[]): CastsPerBar {
  if (costs.length === 0) return "many";
  const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
  if (mean <= 0) return "many";
  const casts = manaMax / mean;
  if (casts >= 6) return "many";
  return casts >= 3.5 ? "some" : "few";
}

/** A numeric param, or zero. */
function num(params: Readonly<Record<string, number | string>> | undefined, key: string): number {
  const v = params?.[key];
  return typeof v === "number" ? v : 0;
}

const ELEMENT_OF_AFFIX: Readonly<Record<string, string>> = Object.fromEntries(
  SPELL_AFFIXES.flatMap((a) => (a.element ? [[a.id, a.element]] : [])),
);

const MANA_STATS: ReadonlySet<string> = new Set(
  STAT_UPGRADES.filter((u) => u.family === "mana").map((u) => u.id),
);

/**
 * **What a key puts in the world, in a few words** (doc 006's shapes and
 * options), so a held spell reads as the thing it is and not only as its
 * school and cost: "Mana Darts, a bolt the key banks while it rests" says why
 * one press of it is the price of several darts, and "Arcane Cannon, a bolt
 * charged while the key is held" why its cost is paid on release. Written
 * from the item's params alone, and without a number, as the rest of the
 * line is.
 */
export function deliveryWords(item: { readonly params: Readonly<Record<string, number | string>> } | undefined): string {
  if (!item) return "a spell";
  const p = item.params;
  const n = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);
  const shape = typeof p["shape"] === "string" ? p["shape"] : "bolt";
  const pattern = typeof p["pattern"] === "string" ? p["pattern"] : "";
  const poison = p["element"] === "poison";
  if (n("charges") > 0) return "a bolt the key banks while it rests and looses all at once";
  if (n("charge") > 0) return "a bolt charged while the key is held and fired on release";
  if (n("doom") > 0) return "a bolt whose mark bursts a few seconds later";
  if (n("emit") > 0) return "a slow orb that throws shards as it flies";
  if (n("contagion") > 0) return "a poison bolt whose poison jumps on a death";
  if (n("telegraph_ms") > 0) return "a landing marked on the ground before it hits";
  if (n("land") > 0) return "a leap that lands in a ring of eruptions";
  if (n("collapse_damage") > 0) return "a pull that implodes as it ends";
  switch (shape) {
    case "orbit": return "blades circling the caster";
    case "field": return poison ? "a cloud of poison on the ground" : "a patch of burning ground";
    case "pillar": return "a pillar raised in front of the caster";
    case "dash": return "a dash through bodies";
    case "vortex": return "a pull under a body";
    case "summon": return "a companion that shoots on its own";
    case "eruption":
      return pattern === "ring" ? "rings of eruptions round the caster"
        : pattern === "line" ? "a line of eruptions ahead" : "eruptions round the body it seeks";
    case "boomerang": return "a thrown blade that comes back";
    case "orb": return "drifting orbs that strike what comes near";
    case "trail": return poison ? "poison ground behind the caster" : "burning ground behind the caster";
    case "enchant": return "waves thrown off every sword swing";
    case "stance": return "a guard that answers the next hit";
  }
  const count = n("count") || 1;
  if (n("chain") > 0) return "a projectile that chains between bodies";
  if (n("pierce") >= 99) return "a projectile through every body in a line";
  if (count > 1 && n("spread") >= 180) return "a ring of projectiles round the caster";
  if (count > 1) return n("seek") > 0 ? "several seeking projectiles" : "a spread of projectiles";
  return n("seek") >= 400 ? "one projectile that steers hard" : "one projectile";
}

/** A spell id as a player reads it: `magic_bolt` is "Magic Bolt". */
function titleOf(id: string): string {
  return id.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function buildFacts(input: BuildFactsInput): BuildFacts {
  const { keys, items, manaMax } = input;
  if (keys.length === 0) return NO_BUILD;

  const elements = new Set<string>();
  const held: Record<string, string> = {};
  const costs: number[] = [];
  let slotsOpen = 0;
  let raised = 0;

  for (const key of keys) {
    const item = items.get(key.base);
    const cost = keyCost(key, items);
    costs.push(cost);
    slotsOpen += Math.max(0, AFFIX_SLOTS - key.affixes.length);
    if (key.level > 1) raised++;
    const el = item?.params.element;
    if (typeof el === "string" && el !== "none") elements.add(el);
    for (const a of key.affixes) {
      const infused = ELEMENT_OF_AFFIX[a.id];
      if (infused) elements.add(infused);
    }
    const affixWords = key.affixes.length > 0
      ? key.affixes.map((a) => a.id).join(", ")
      : "nothing yet";
    const open = Math.max(0, AFFIX_SLOTS - key.affixes.length);
    /*
     * The cost band is what one press spends: on a banked key that is every
     * dart the bank holds, on a charged one it is paid on release.
     */
    const press = num(item?.params, "charges") > 0 ? "a press"
      : num(item?.params, "charge") > 0 ? "on release" : "to cast";
    held[key.base] = [
      titleOf(key.base),
      deliveryWords(item),
      `level ${key.level} of ${SPELL_LEVEL_MAX}`,
      `${schoolOf(key.base) ?? "no"} school`,
      `${typeof el === "string" && el !== "none" ? el : "no"} element`,
      `${costBand(cost, manaMax)} ${press}`,
      `carries ${affixWords}`,
      open === 0 ? "no affix slot left"
        : open === 1 ? "one affix slot free"
        : `${open === 2 ? "two" : "three"} affix slots free`,
    ].join(", ") + ".";
  }

  const manaStats = (input.statsTaken ?? []).filter((id) => MANA_STATS.has(id)).length;
  const slotTotal = Math.max(1, keys.length * AFFIX_SLOTS);
  return {
    spell_levels: raised === 0 ? "all_base" : raised >= keys.length ? "mostly_raised" : "some_raised",
    affix_slots_open: slotsOpen === 0 ? "none" : slotsOpen <= slotTotal / 2 ? "few" : "many",
    held_elements: elements.size === 0 ? "none" : elements.size === 1 ? "one" : "several",
    casts_per_bar: bucketCastsPerBar(manaMax, costs),
    mana_stats_taken: manaStats === 0 ? "none" : manaStats === 1 ? "one" : "several",
    held_spells: held,
  };
}
