/**
 * What a cleared room offers: three cards and up to three ways out.
 *
 * This is the `RuleDirector` slot. Doc 003 gives both decisions to Jev — the
 * door set from `legalDoorSets`, and doc 007's reward kind — and doc 003 also
 * requires that **every** Jev decision has a rule-based answer that ships when
 * the model is slow, unreachable or returns something illegal: "the player
 * never waits". So the rules come first and Jev replaces the choice, not the
 * mechanism.
 *
 * Writing it this way round has a second benefit that is worth more than the
 * fallback: it makes the Director's contribution measurable. A run played on
 * these rules is the baseline that a run played on Jev's choices has to beat,
 * and without a baseline "the Director is working" is not a claim that can be
 * checked.
 */
import type { BaseItem, DoorSet, ObservedLabels, RoomType, RunHistory, SummaryLabels } from "../types.ts";
import type { ItemRegistry } from "../spells/items.ts";
import type { Rng } from "../rng.ts";
import type { OfferCard, PortalSpec, RewardCardKind } from "../sim/exits.ts";
import { SPELL_DAMAGE_SCALE } from "../sim/cast.ts";
import { AFFIX_SLOTS, SPELL_SLOTS, levelDamageMult, levelManaMult, spellCost, statusForecast, statusPerHit } from "../sim/spells.ts";
import { num } from "../spells/items.ts";
import { STAT_UPGRADES, statLine, statLinePart } from "./stats.ts";
import { AFFIX_SURCHARGE_KEY, SPELL_AFFIXES, affixFitsLine, affixStrengthFloor, affixFitsSpell, affixSurchargePct, affixSurchargeText, affixTierKey, itemShape } from "../spells/affixes.ts";
import { schoolOf } from "../spells/schools.ts";
import type { SpellAffix, SpellShape } from "../spells/affixes.ts";
import { legalDoorSets } from "./pacing.ts";
import { doorSpecs, ruleDoors, stageFor } from "./doors.ts";
import type { RunShape } from "./doors.ts";
import type { PacingInput } from "./pacing.ts";

export interface Offer {
  readonly cards: readonly OfferCard[];
  readonly coins?: number;
  readonly doors: readonly PortalSpec[];
}

/**
 * How much gold the safe pick is worth: about a room of a fight's income, a
 * real option against a card rather than a forfeit, and not so much that the
 * safe pick is always the right one while gold has nothing left to buy.
 */
export const GOLD_CARD_VALUE = 12;

/**
 * The cards on offer.
 *
 * **Gold is always one of the three, and it is always the last.** Doc 013 makes
 * it the safe pick, and gating the portals on taking a reward means the player
 * cannot decline — so gold *is* the decline, and it has to be present for that
 * gate to be fair rather than a forced commitment. Last, because a list is
 * read in order and the fallback belongs at the end of one.
 *
 * The other two are a castable and a modifier, which is the distinction the
 * player actually faces: a spell changes what they can do, an affix changes
 * how well they do what they already do. Doc 007 calls both `item`; that is
 * the Director's vocabulary and not the player's.
 */
/**
 * The numbers on a card, in one short line.
 *
 * Kept here rather than in the renderer because it is content formatting, not
 * layout: the same line belongs in a shop, in the staff editor and in a
 * tooltip, and three copies of "how do you write a damage multiplier" would
 * drift. Pure, so the wording is testable.
 *
 * Deliberately **one cost and one effect**, not a stat block. A card is read
 * in the second or two before a decision; doc 013's rule that "an affix should
 * have one number, not two" applies to how they are presented as much as to
 * how they are designed.
 */
/**
 * What each part of a numbers line is, so it can be coloured by kind rather
 * than read as one run of gold: the cost, the damage (in its element's
 * colour), what the spell does, and a modifier.
 */
export type StatTone = "mana" | "damage" | "fire" | "ice" | "poison" | "trait" | "mod" | "grade";

/** What a part's `{placeholder}`s are filled with: numbers, or content ids. */
export type StatArgs = Readonly<Record<string, string | number>>;

export interface StatPart {
  readonly text: string;
  readonly tone: StatTone;
  /**
   * A stable identifier for the sentence this part is, so a renderer can say
   * it in another language. `text` stays the English and stays authoritative:
   * the harness, the tests and the Director read it, and a renderer with no
   * table for `key` falls back to it.
   *
   * `args` carries **numbers and content ids only** — never English words —
   * so an element or a modifier label travels as `fire` or `damage_mult` and
   * is named by the renderer's own table.
   */
  readonly key?: string;
  readonly args?: StatArgs;
}

/**
 * The parts an **affix** card prints: what it does at tier one, and — for the
 * affixes that multiply how often a press lands — what it adds to the spell's
 * mana.
 *
 * The surcharge is on the card because it is part of the offer. An affix that
 * quietly raised the bill was a card the player accepted without being told
 * its price, and the price is the whole of what balances `fork` and `chain`
 * against the rest of the pool (`affixCostMult`). Accuracy and utility affixes
 * add nothing and so say nothing: "+0% mana" on nine cards out of twenty is
 * noise that hides the four that matter.
 */
export function affixStatParts(a: Pick<SpellAffix, "id" | "tiers">, tier = 1): StatPart[] {
  const parts: StatPart[] = [
    { text: a.tiers[Math.max(0, Math.min(2, tier - 1))]!.text, tone: "mod", key: affixTierKey(a.id, tier) },
  ];
  const surcharge = affixSurchargeText(a.id, tier);
  const pct = affixSurchargePct(a.id, tier);
  if (surcharge !== null && pct !== null)
    parts.push({ text: surcharge, tone: "mana", key: AFFIX_SURCHARGE_KEY, args: { pct } });
  return parts;
}

/**
 * **A slotted spell's numbers line, priced at what the bar will actually be
 * charged.**
 *
 * `offerStatParts` is handed a *item* and an item has no affixes, so it prices
 * a cast from the base cost and the level alone. A slot has affixes, and the
 * ones that multiply how often a press lands charge for it (`affixCostMult`),
 * so every panel that drew a slotted spell through `offerStatParts` printed a
 * figure the simulation does not subtract: a bolt carrying fork and chain read
 * "10 mana" over a key that spends twenty-two.
 *
 * `cost` is `slotCost` — the same call `stepSpells` makes before it takes the
 * mana — so the panel and the bar cannot disagree. `card-mana.test.ts` is the
 * assertion that they do not.
 */
export function slotStatParts(item: BaseItem, level: number, cost: number): StatPart[] {
  const n = Math.round(cost * 10) / 10;
  return offerStatParts(item, level).map((part) => (part.tone === "mana"
    ? { ...part, text: `${fmtMana(n)} mana`, key: "stat.mana", args: { n: fmtMana(n) } }
    : part));
}

/** The numbers line as plain text, for places that cannot colour it. */
export function offerStats(item: BaseItem, level = 1): string {
  return offerStatParts(item, level).map((p) => p.text).join("  ");
}

/** A multiple of the sword, to two places and no trailing zeros: 0.85, 2.15, 1.2. */
function fmtMult(k: number): string {
  return String(Math.round(k * 100) / 100);
}

export function offerStatParts(item: BaseItem, level = 1): StatPart[] {
  const parts: StatPart[] = [];
  const push = (text: string, tone: StatTone, key?: string, args?: StatArgs) =>
    parts.push(key ? { text, tone, key, args } : { text, tone });
  /*
   * The mana a cast **actually** spends. `item.mana` is the spell's cost
   * *rank*, 1 to 7, and the keyed spell pays `spellCost` of it — 5 plus 2.5
   * a rank — so printing the rank said "3 mana" over a spell that took 10.
   */
  const mana = Math.round(spellCost(null, item.mana) * levelManaMult(level) * 10) / 10;
  if (mana > 0) push(`${fmtMana(mana)} mana`, "mana", "stat.mana", { n: fmtMana(mana) });

  // At the spell's level: whole points, as the hit lands them — including the
  // scale every spell's damage is built with (`SPELL_DAMAGE_SCALE`). Without it
  // the card printed a little over half of every hit: 8 on a bolt that lands 14.
  const rawDmg = item.params.damage;
  const dmg = typeof rawDmg === "number"
    ? Math.floor(rawDmg * levelDamageMult(level) * SPELL_DAMAGE_SCALE + 1e-6) : rawDmg;
  const count = item.params.count;
  const shape = item.params.shape;
  /*
   * The number the player is comparing: damage per cast, with the count that
   * makes it. A pillar does none by design and says what it does instead.
   *
   * **The element is not in this figure.** It used to be — "6 fire dmg" —
   * which read as though the fire were the damage, when the hit is plain and
   * the fire is a separate, larger thing that happens afterwards. The element
   * stays as the figure's *colour*, and says what it is worth in its own part
   * below (`stat.status.*`).
   */
  const el = item.params.element;
  const dmgTone: StatTone = el === "fire" || el === "ice" || el === "poison" ? el : "damage";
  /*
   * **A sword-energy spell says what it is: so many swings of the sword**
   * (`sword`), at the spell's level, since what it lands is the sword's hit as
   * the build has sharpened it and no figure printed here could say that.
   * Its wake, when it has one, is its own part at its own share.
   */
  const sword = item.params.sword;
  if (typeof sword === "number" && sword > 0) {
    const k = fmtMult(sword * levelDamageMult(level));
    push(`sword dmg x${k}`, dmgTone, "stat.swordDmg", { mult: k });
    const wake = item.params.wake_share;
    if (typeof wake === "number" && wake > 0 && Number(item.params.wake_reach ?? 0) > 0) {
      const w = fmtMult(sword * wake * levelDamageMult(level));
      push(`wake: sword dmg x${w}`, dmgTone, "stat.wakeDmg", { mult: w });
    }
  } else if (typeof dmg === "number" && dmg > 0) {
    const many = typeof count === "number" && count > 1;
    /*
     * **`x5` is a lie for a line.** A spell whose `count` is cells of ground
     * rather than projectiles — Earth Spikes throws five spikes up along a
     * lane, one after the other — hits any one body **once**, and "7 dmg x5"
     * reads as thirty-five on the thing in front of you. It was reported as
     * exactly that. The figure is the damage a body takes, and how far the
     * spell reaches is a separate trait part (`stat.line`).
     */
    const line = item.params.pattern === "line" && (item.params.shape === "eruption" || item.params.speed === 0);
    // Rings of ground are the same case: `count` is rings, and a body is hit by one of them.
    const ring = item.params.pattern === "ring" && item.params.shape === "eruption";
    const n = line || ring ? 1 : count;
    const several = many && !line && !ring;
    push(several ? `${dmg} dmg x${n}` : `${dmg} dmg`, dmgTone,
      several ? "stat.dmgCount" : "stat.dmg", { n: dmg, ...(several ? { count: n as number } : {}) });
    /*
     * The reach is its own part, and only where the card has room for it: an
     * elemental line already spends its third part on the status, and the
     * card has to be read at a glance. Dropping the misleading `x5` is the
     * part that matters; how far the lane runs is in the description.
     */
    if (line && typeof count === "number" && count > 1 && el === "none")
      push(`line of ${count}`, "damage", "stat.line", { count });
  }
  /*
   * What the element is worth: the hits that trigger it, and then what it
   * does — a burn's total and its span, a freeze's span and its shatter.
   * "Burn: 36% of the gauge a hit" was the mechanism; this is the value.
   */
  const status = statusForecast(item);
  if (status) {
    const s = fmtSeconds(status.seconds);
    push(
      status.element === "ice"
        ? `Freeze · ${status.hits} hits · ${s} s, shatters x${status.shatter}`
        : `${status.element === "fire" ? "Burn" : "Poison"} · ${status.hits} hits · ${status.damage} dmg / ${s} s`,
      status.element,
      `stat.status.${status.element}`,
      status.element === "ice"
        ? { hits: status.hits, s, mult: status.shatter }
        : { hits: status.hits, dmg: status.damage, s },
    );
  }
  if (shape === "orbit") push("orbits you", "trait", "stat.orbit");
  if (shape === "field") {
    if (item.params.element === "poison") push("poison cloud", "trait", "stat.fieldPoison");
    else push("burning ground", "trait", "stat.field");
  }
  /*
   * The newer shapes (doc 006), each by the one fact the damage figure beside
   * it does not say: an orb's figure is a strike, so how often it strikes; a
   * thrown blade's is a pass, and it comes back for a second; a trail's is a
   * patch's tick; an enchant's is a wave, thrown for as long as it lasts; a
   * stance's is the answer to the hit it takes.
   */
  if (shape === "orb") {
    const n = Math.max(1, Math.round(1000 / Math.max(1, num(item.params, "zap_ms", 300))));
    push(`${n} strikes a second`, "trait", "stat.orb", { n });
  }
  if (shape === "boomerang") push("cuts out and back", "trait", "stat.boomerang");
  if (shape === "trail") {
    if (item.params.element === "poison") push("poison trail", "trait", "stat.trailPoison");
    else push("burning trail", "trait", "stat.trail");
  }
  if (shape === "enchant") {
    const s = fmtSeconds(Math.round(num(item.params, "enchant_ms", 5000) / 100) / 10);
    push(`sword waves ${s} s`, "trait", "stat.enchant", { s });
  }
  if (shape === "stance") push("answers a hit", "trait", "stat.stance");
  if (shape === "pillar") push("raises a wall", "trait", "stat.pillar");
  if (shape === "dash") push("dash through", "trait", "stat.dash");
  if (shape === "vortex") push("pulls enemies in", "trait", "stat.vortex");
  if (shape === "summon") push("summons an ally", "trait", "stat.summon");
  const chain = item.params.chain;
  if (typeof chain === "number" && chain > 0) push(`chains x${chain}`, "trait", "stat.chains", { n: chain });
  return parts;
}

/**
 * What an elemental spell does to the enemy's gauge, in one sentence: how
 * much one hit fills and how many it takes. Spells of one element differ —
 * a fast needle fills a quarter, a slow spike more than half — and the
 * difference is only a choice if it is written down.
 */
export function statusLine(item: BaseItem): string {
  const per = statusPerHit(item);
  if (per <= 0) return "";
  const element = item.params.element;
  const [name, verb] = element === "fire" ? ["Burn", "ignite"]
    : element === "poison" ? ["Poison", "poison"]
    : element === "ice" ? ["Chill", "freeze"] : ["Build-up", "apply"];
  const unit = item.params.shape === "field" || item.params.shape === "trail" ? "tick" : "hit";
  const hits = Math.ceil(1 / per - 1e-9);
  return `${name}: ${Math.round(per * 100)}% of the gauge a ${unit}, ${hits} ${unit}s to ${verb}.`;
}

/**
 * A spell's rules text, for cards and the character screen.
 *
 * It used to put `statusLine` in front of the description. The numbers line
 * now carries the element as a part of its own (`stat.status.*`), which says
 * what the status is *worth* rather than how the gauge fills, so repeating
 * the mechanism above the prose was two sentences about one thing — and the
 * translated screens dropped it anyway, because a translation replaces the
 * whole description. The status line stays exported for the harness and the
 * Director, which read the mechanism rather than the card.
 */
export function spellDetail(item: BaseItem): string {
  return item.description;
}

/** A cost as the HUD shows mana: whole, or to one place. */
function fmtMana(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** A span in seconds: whole where it is whole, one place where it is not. */
function fmtSeconds(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** What the door promised, beyond its kind. See `DoorOffer`. */
export interface OfferPromise {
  readonly school?: string;
  readonly family?: string;
  readonly grade?: number;
  /** The run's build style: a spell offer with no school leans toward spells tagged with it. */
  readonly style?: string;
}

export function offerCards(
  items: ItemRegistry, rng: Rng, owned: readonly string[], kind?: RewardCardKind,
  held: readonly HeldSpell[] = [], promise: OfferPromise = {},
): OfferCard[] {
  const grade = Math.max(1, Math.min(3, promise.grade ?? 1));
  return offerCardsUngraded(items, rng, owned, kind, held, promise)
    .map((c) => {
      if (grade <= 1 || c.kind === "gold") return c;
      if (c.kind === "stat") {
        const u = STAT_UPGRADES.find((x) => x.id === c.itemId);
        if (!u) return { ...c, grade };
        const part = statLinePart(u, Math.min(2, grade));
        return { ...c, grade, stats: part.text, statParts: [{ ...part, tone: "mod" as const }] };
      }
      const tag = gradeTagPart(c.kind, grade);
      return {
        ...c, grade,
        stats: tag ? `${tag.text}  ${c.stats}` : c.stats,
        statParts: tag ? [tag, ...(c.statParts ?? [{ text: c.stats, tone: "mod" as const }])] : c.statParts,
      };
    });
}

/**
 * What a grade reads as in a card's numbers, where it changes a number: a
 * spell's level, a stat applied twice. An affix's grade is its **rarity**
 * (`rarityOf`), shown on the card's frame rather than as "tier III" in the
 * text, so it says nothing here.
 */
export function gradeTag(kind: RewardCardKind, grade: number): string {
  return gradeTagPart(kind, grade)?.text ?? "";
}

/** The same tag, with the identifier a renderer translates it through. */
export function gradeTagPart(kind: RewardCardKind, grade: number): StatPart | null {
  if (kind === "spell") return { text: `Lv ${grade}`, tone: "grade", key: "grade.lv", args: { n: grade } };
  if (kind === "affix") return null;
  // A stat's grade is already in its number (`statLine(u, times)`).
  if (kind === "stat") return null;
  return { text: `x${grade}`, tone: "grade", key: "grade.x", args: { n: grade } };
}

/** A grade as a rarity: 1 common, 2 rare, 3 legendary. */
export type CardRarity = "common" | "rare" | "legendary";
export function rarityOf(grade: number | undefined): CardRarity {
  const g = Math.max(1, Math.min(3, grade ?? 1));
  return g === 3 ? "legendary" : g === 2 ? "rare" : "common";
}

/**
 * The cards a promise asks for, filled from the rest of the pool when the
 * promised group runs short: the door's school or family comes first, and a
 * school of two spells still shows three cards.
 */
function promised<T extends { id: string }>(
  pool: readonly T[], inGroup: (t: T) => boolean, rng: Rng, owned: readonly string[],
): T[] {
  const first = pick(pool.filter(inGroup), rng, CARDS_PER_OFFER, owned);
  if (first.length >= CARDS_PER_OFFER) return first;
  const rest = pick(pool.filter((t) => !inGroup(t)), rng, CARDS_PER_OFFER - first.length, owned);
  return [...first, ...rest];
}

/** Two cards from the style if it has them, the third from anywhere. */
function leaning<T extends { id: string }>(
  pool: readonly T[], inGroup: (t: T) => boolean, rng: Rng, owned: readonly string[],
): T[] {
  const first = pick(pool.filter(inGroup), rng, CARDS_PER_OFFER - 1, owned);
  const rest = pick(pool.filter((t) => !first.includes(t)), rng, CARDS_PER_OFFER - first.length, owned);
  return [...first, ...rest];
}

function offerCardsUngraded(
  items: ItemRegistry, rng: Rng, owned: readonly string[], kind: RewardCardKind | undefined,
  held: readonly HeldSpell[], promise: OfferPromise,
): OfferCard[] {
  /*
   * **The door fixes the kind; the cards are three answers to one question.**
   *
   * The first version dealt one spell, one affix and gold — three options that
   * cannot be weighed against each other, because they are not the same kind
   * of thing. Doc 003 moved that decision to the portal, so what arrives here
   * is a currency and the screen is where the player picks within it. This is
   * Hades' shape: the symbol on the door says whose boon it is, and *which*
   * boon is the decision in the room.
   */
  if (!kind) return mixedOffer(items, rng, owned, held);

  switch (kind) {
    case "gold":
      /*
       * A gold room pays out and shows no cards. Three cards reading "20
       * gold", "20 gold", "20 gold" is not a choice, and the decision the
       * player already made was at the door.
       */
      return [];
    case "stat":
      return (promise.family
        ? promised(STAT_UPGRADES, (u) => u.family === promise.family, rng, owned)
        : pick(STAT_UPGRADES, rng, CARDS_PER_OFFER, owned)).map((u) => ({
        kind: "stat" as const, itemId: u.id, label: u.name,
        stats: statLine(u), statParts: [{ ...statLinePart(u), tone: "mod" as const }],
        description: u.description,
      }));
    case "spell":
      return (promise.school
        ? promised([...items.values()], (i) => schoolOf(i.id) === promise.school, rng, owned)
        : promise.style
          ? leaning([...items.values()], (i) => i.tags.includes(promise.style!), rng, owned)
          : pick([...items.values()], rng, CARDS_PER_OFFER, owned))
        .map((i) => ({
          kind: "spell" as const, itemId: i.id, label: titleOf(i.id),
          stats: offerStats(i), statParts: offerStatParts(i), description: spellDetail(i),
        }));
    case "affix":
      /*
       * Doc 013's event affixes, every one of which fires a hook
       * (`sim/affix-hooks.ts`, and the test that shows each one doing what its
       * card says). Numbers come from spell level and the stat door; events
       * come from here.
       *
       * `owned` holds affix ids the player already has on some spell. A held
       * one is not excluded — a duplicate is an upgrade, and the pool is thin
       * against nine slots on purpose — it is only drawn after the new ones.
       */
      /*
       * And only affixes **some held spell can take**. An affix names the
       * shapes it works on, and a card the player cannot attach anywhere is a
       * dead draw dressed as a choice. `held` is the shapes on the staff; an
       * empty list means the caller does not know, and everything is dealt.
       */
      return pick(fittingAffixes(held), rng, CARDS_PER_OFFER, owned).map(affixCard);
  }
}

/* ------------------------- the Director's card question ------------------------- */

/**
 * What a candidate card is, as the rule table and Jev both read it: one-word
 * facts, never numbers (doc 002).
 *
 * - `style`: it belongs to the build style the player chose;
 * - `need`: it answers something the build is short of right now;
 * - `promised`: it is of the school or family the door named.
 */
/**
 * What code knows about a card against this run, one word each (task 9):
 *
 * - `style`: the build style the player **stated** at the start.
 * - `build`: the style the player's keys **actually** lean (revealed
 *   preference, the dominant tags of the spells held).
 * - `need`: what the run is short of right now — survival when hurt.
 * - `eases`: what the rooms just played measured least of — shots landing,
 *   casts, damage, a bar that would not pay — and this card eases.
 * - `synergy`: it works with what is held — an element the keys already
 *   carry, a spell of the same element.
 * - `upgrade`: it raises something held (a spell's level, an affix's tier),
 *   which is how a build matures rather than widens.
 * - `promised`: it is of the school or family the door named.
 *
 * Every legal card stays in the pool; the facts only move its weight.
 */
export type CardFact = "style" | "build" | "need" | "eases" | "synergy" | "upgrade" | "promised";

export interface CardCandidate {
  readonly id: string;
  readonly description: string;
  readonly facts: readonly CardFact[];
  /** For affixes, the held spell ids that can actually take this card. */
  readonly compatibleHeldSpellIds?: readonly string[];
}

/** What the build is short of, as labels. */
export interface CardNeeds {
  readonly style?: string;
  readonly hurt?: boolean;
  /** The styles the held keys actually lean: their most common tags. */
  readonly revealed?: readonly string[];
  /**
   * What the rooms just played were shortest of, derived from the **observed**
   * labels (`gapOf`). It is a fact about the card — "this eases the thing that
   * was missing" — and the thing that was missing is a measurement, not a
   * classification.
   */
  readonly gap?: string;
  /** Elements the held keys carry, including an infusion affix's. */
  readonly elements?: readonly string[];
  /** The ids of the held spells, and of the affixes on them. */
  readonly heldSpells?: readonly string[];
  readonly heldAffixes?: readonly string[];
  /**
   * Whether any key is still empty.
   *
   * With all three full, a spell card splits into two different rewards: a
   * copy of a held spell raises its level, and a spell the player does not
   * hold opens the replace screen. `cardPool` reads this and guarantees the
   * offer holds at least one of each (`CardPool.guarantee`), because those are
   * the two things a spell door can honestly be at that point and the player
   * should get to choose between them rather than be handed one.
   */
  readonly keysFree?: boolean;
}

/**
 * What a card offer reads off the run, for the facts above: one function for
 * the scene and the harness, so the browser and the measurement weigh the
 * same things.
 */
export function cardNeedsFor(
  labels: SummaryLabels, style: string,
  keys: readonly { readonly base: string; readonly affixes: readonly { readonly id: string }[] }[],
  items: ItemRegistry,
): CardNeeds {
  const elements = new Set<string>();
  for (const k of keys) {
    const tags = items.get(k.base)?.tags ?? [];
    for (const el of ["fire", "ice", "poison"]) if (tags.includes(el)) elements.add(el);
    for (const a of k.affixes) for (const [el, id] of Object.entries(INFUSION)) if (a.id === id) elements.add(el);
  }
  return {
    style,
    hurt: labels.health === "low" || labels.health === "critical",
    keysFree: keys.length < SPELL_SLOTS,
    revealed: labels.preference.dominant,
    gap: gapOf(labels.observed),
    elements: [...elements],
    heldSpells: keys.map((k) => k.base),
    heldAffixes: keys.flatMap((k) => k.affixes.map((a) => a.id)),
  };
}

/** The blacksmith's price to raise a spell *from* this level. */
export const SMITH_PRICE: Readonly<Record<number, number>> = { 1: 25, 2: 35, 3: 50, 4: 70 };

/**
 * **What the merchant charges**, by the kind of card on the shelf.
 *
 * It lived in the scene, where nothing else could read it — so the Director
 * was told the player was `rich` without ever being told what rich buys, and
 * the briefing that had to say "45 gold for a spell" would have had to repeat
 * the number rather than read it. One constant, and both the shelf and the
 * state quote the same figure.
 */
export const MERCHANT_PRICE: Readonly<Record<string, number>> = {
  stat: 20, affix: 30, spell: 45, gold: 0,
};

/**
 * **What one drink at a fountain restores**, as a share of the player's
 * maximum health — so a run that has raised the cap gets a bigger drink, and
 * the fountain never becomes the small change it would be at a fixed amount.
 * The drink is capped at full and the fountain then runs dry.
 *
 * Health does not otherwise come back inside a run, and that is the design's
 * tension — but measured, the runs that lost to the boss arrived on a third
 * of a bar against the winners' most of one, and a boss fight entered there
 * is the slog the build could not prevent. Every roguelike this one learns
 * from rests before its boss (Slay the Spire's campfire, Hades' fountain).
 *
 * There are two of them: one at the vendors' stop before the boss, which is
 * the stop the player chose to reach, and at most one mid-run, behind a
 * portal the Director offers when the run is going badly.
 */
export const FOUNTAIN_HEAL_FRACTION = 0.5;

/**
 * The bar after one drink, from the bar before it and the run's maximum. One
 * place, so the scene and the harness cannot drift on what a drink is worth.
 */
export function fountainDrink(health: number, max: number): number {
  return Math.min(max, health + max * FOUNTAIN_HEAL_FRACTION);
}

/** Whether a drink would do anything. A full bar refuses, so it is not wasted. */
export function fountainWouldHeal(health: number, max: number): boolean {
  return health < max - 1e-6;
}

/**
 * **How low the bar must be before a mid-run fountain is offered**, as a
 * share of the maximum. The gate used to be "any health lost", and a level-up
 * or a pickup keeps most bars a chip short of full — so a player who had
 * barely been scratched met a fountain door, drawn from the tail of the need
 * ranking where the Director had given it next to nothing. At two thirds a
 * drink restores at least a third of the bar before it is capped, which is
 * what a room given up for it has to be worth.
 */
export const FOUNTAIN_OFFER_AT = 2 / 3;

/** Whether the run is hurt enough for a mid-run fountain door (`RunShape.hurt`). */
export function fountainWanted(health: number, max: number): boolean {
  return health <= max * FOUNTAIN_OFFER_AT + 1e-6;
}

/**
 * **What the last rooms were shortest of**, from the observed facts alone.
 *
 * It replaces the build simulator's `bottleneck` verdict, which was a
 * prediction about a bot's rotation: it called mana the limit for nine builds
 * in ten while real play refused no press at all. The order is the order a
 * player would notice: a shot that misses, then a bar that will not pay, then
 * a rotation with gaps in it, then damage that is simply low.
 *
 * It is **code's own weight on a card**, not a label sent to Jev — Jev is given
 * the measurements and draws its own conclusion.
 */
export function gapOf(observed: ObservedLabels | undefined): string {
  if (!observed) return "none";
  if (observed.hits_per_shot === "few") return "accuracy";
  if (observed.mana_refused !== "never" || observed.mana_short_time === "most") return "mana";
  if (observed.cast_rate === "slow") return "cast_frequency";
  if (observed.damage_rate === "low") return "damage";
  return "none";
}

/**
 * Which spells, affixes and stat families ease each gap. No affix eases a
 * mana gap: nothing on a spell gives mana back, so the answer to running dry
 * is the mana upgrades and the sword.
 */
const GAP_SPELL_TAGS: Readonly<Record<string, readonly string[]>> = {
  damage: ["nuke", "area"], cast_frequency: ["spam"], mana: ["spam"], accuracy: ["tracking", "area"],
};
const GAP_AFFIXES: Readonly<Record<string, readonly string[]>> = {
  damage: ["brand", "fork", "pierce", "kindle", "blight", "harvest"], cast_frequency: ["haste", "repeat", "resonance"],
  mana: [], accuracy: ["seek", "chain", "scatter"],
};
const GAP_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  damage: ["sword"], cast_frequency: ["mana"], mana: ["mana"], accuracy: ["movement"],
};
/** The infusion affix for each element, for `synergy`. */
const INFUSION: Readonly<Record<string, string>> = { fire: "kindle", ice: "rime", poison: "blight" };

/**
 * The legal cards for one offer — doc 007's eligible pool, with the promise
 * enforced **as a constraint, not a weight**. A door that said "a flame
 * spell" and dealt a stone one would be a broken promise the Director could
 * sample into; so a school or family with enough cards *is* the pool, and one
 * too small for an offer is dealt in full (`forced`) with the rest of the
 * pool filling the gap.
 *
 * Owned cards leave the pool while enough new ones remain (a duplicate is
 * only the fallback when a category runs out).
 */
export interface CardPool {
  readonly kind: RewardCardKind;
  readonly candidates: readonly CardCandidate[];
  readonly forced: readonly string[];
  /**
   * **Groups of candidates the offer must hold at least one of each from**,
   * where both groups exist and the offer has room — code's only safety bound
   * on what the Director draws, and the smallest one that keeps a choice a
   * choice.
   *
   * Set for a spell offer to a **full staff**, where the two groups are the
   * held spells a copy would raise and the new spells a pick would replace one
   * with. Both are real rewards and they are not comparable, so an offer that
   * came out all one sort is not an offer the player can decide anything in:
   * three upgrades is "which of your spells gets better", three new spells is
   * "which of your spells do you throw away", and the question the player
   * actually has is which of those two they want at all.
   *
   * It is a guarantee, never a quota. Which sort the offer *leans* toward is
   * the Director's, judged against the build key by key.
   */
  readonly guarantee?: readonly (readonly string[])[];
}

/**
 * **Which affixes read as each build style**, for the `style` and `build`
 * card facts and, read backwards, for the style a taken affix counts toward
 * (`cardStyleTags`).
 *
 * Derived from doc 006's roster rather than from the old element-and-colour
 * styles. A style is a way of using a key, so an affix reads as a style when
 * two things hold: it **fits most of that style's spells** — the shapes each
 * style's spells have, against each affix's `shapes` and `affixFitsSpell`
 * (doc 013's fit table) — and the event it adds **works the style's own
 * verb**. The fit counts, over the spells tagged with each style (8, 10, 11,
 * 10 and 10 of them):
 *
 * - Every style's spells take the any-shape six — `ward`, `retort`,
 *   `slipstream`, `kindle`, `rime`, `blight`, and `resonance` bar the stance
 *   — so the fit does not decide those; the verb does.
 * - **Barrage** is five bolts, a banked bolt, an orb and a summon, and its
 *   verb is cadence. `echo` (a kill pays back the press) fits seven of its
 *   eight, `repeat` (one press casts twice) six, `fork` (one bolt lands as
 *   several) six, and `seek` and `ricochet` (a shot pressed without aiming
 *   still lands) fit its bolts: `ricochet` six, `seek` the four that fire
 *   one projectile.
 * - **Heavy** is single heavy bolts, a charge, a mark, a telegraphed and a
 *   line eruption, and two dashes; its verb is one committed hit. `haste`
 *   returns the long cooldown on a kill, `shatter` makes a committed shot
 *   that meets a wall still split, `fork` splits the one large hit, `brand`
 *   sets off on the next hit on the same body, and `rime`'s frozen body
 *   takes the next hit at triple. Each of the bolt-only ones fits six of ten.
 * - **Crowd** is seven bolts (one of them Frozen Orb's emitting orb), three
 *   eruptions and a collapsing pull; its verb is bodies together or in a line. `scatter` fits
 *   ten of its eleven and sends the cast outward, `chain` and `harvest`
 *   (seven each) carry a hit to the next body, and `pierce` (seven) takes a
 *   shot down the line.
 * - **Affliction** is fire and poison bolts, two fields, a trail, a line
 *   eruption, a contagion and a mark; its verb is a status that pays out
 *   while the caster moves on. `kindle` and `blight` add the status to any of
 *   its ten, `bloom` leaves burning ground where a shot runs out, and
 *   `brand` is a mark set off later, as `doom_sigil` is.
 * - **Blade** is an orbit, a boomerang, an enchant, a stance, a pillar, two
 *   dashes, a ring eruption and two short bolts; its verb is the sword's
 *   reach. The bolt-only affixes fit two of its ten and `seek` none, so its
 *   affixes are the four that fire off the fight at arm's length: `resonance`
 *   (the sword casts the spell), `retort` (a hit taken), `slipstream` (a dash
 *   through a body) and `ward` (a rune where the caster stands).
 *
 * Every affix reads as at least one style, so a taken affix always counts
 * toward something; `fork` and `brand` read as two, because their event
 * works two verbs.
 */
const AFFIX_STYLE: Readonly<Record<string, readonly string[]>> = {
  spam: ["repeat", "fork", "seek", "ricochet"],
  nuke: ["haste", "shatter", "fork", "brand", "rime"],
  area: ["scatter", "chain", "harvest", "pierce"],
  dot: ["kindle", "blight", "bloom", "brand"],
  melee: ["resonance", "retort", "slipstream", "ward", "momentum", "undertow", "finale"],
};

/**
 * **Which stat families read as each build style**, the same way: by what
 * the style's keys ask of the player.
 *
 * - Barrage presses often and Heavy casts dear: both are paid for from the
 *   bar, so `mana`.
 * - Crowd gathers bodies and several of its spells land only close (Scatter
 *   Shot, Frost Nova, Quake Ring); Affliction puts a status on and moves on:
 *   both are `movement`.
 * - Blade lives in sword reach: `sword`, and `survival`, since the roster's
 *   guard (Counter Stance) and its one defence (Stone Ward) are Blade spells
 *   and `wrath`, a survival stat, is the sword's spin.
 */
const STAT_STYLE: Readonly<Record<string, readonly string[]>> = {
  spam: ["mana"], nuke: ["mana"], area: ["movement"], dot: ["movement"], melee: ["sword", "survival"],
};

/**
 * **The build styles a taken card reads as**, for revealed preference
 * (`bucketConsistency`, doc 007).
 *
 * `preference.consistency` was hard-coded to `on_plan` in the browser and in
 * the harness alike, because nothing collected the tags a pick carries. That
 * made `variety` — whose whole job is to widen an offer for a player who has
 * drifted — answer `low` for every offer of every run at 0.98 confidence,
 * which pins the reward pool to a short list the player sees again and again.
 * The bucket existed and was never fed.
 *
 * A spell reads as its own tags. A stat and an affix have no tags, so they
 * read as the styles whose table claims them — the same tables the `style`
 * fact uses, read backwards, so "on plan" means the same thing here as it does
 * in the offer.
 */
export function cardStyleTags(
  items: ItemRegistry, kind: RewardCardKind, id: string,
): readonly string[] {
  if (kind === "spell") return items.get(id)?.tags ?? [];
  const table = kind === "affix" ? AFFIX_STYLE : STAT_STYLE;
  if (kind === "stat") {
    const family = STAT_UPGRADES.find((u) => u.id === id)?.family;
    return family ? Object.keys(table).filter((style) => table[style]?.includes(family)) : [];
  }
  return Object.keys(table).filter((style) => table[style]?.includes(id));
}

/**
 * **A candidate's own sentence: the content table's neutral fact.**
 *
 * This was `${name}: ${core's description}` when core's description was the
 * designer's — "at the lowest mana cost in the attack pool", "suits a spam
 * build", "the only stat that improves every part of the game at once" — and
 * every one of those is a verdict about where the card sits in the pool,
 * handed to the Director as the text of an option it is being asked to rank
 * (finding 11). It then moved to `PLAYER_TEXT`, the player's voice, which
 * turned out to carry verdicts of its own ("best when enemies bunch up", "the
 * hardest-hitting common attack", "your answer to being surrounded").
 *
 * Doc 006 ("What a spell tells Jev") makes the `description` the card's
 * `what`, written as a neutral fact — what the thing does, never who it suits
 * or how it ranks — so that is what the option carries. The player's line
 * stays in `PLAYER_TEXT`, where the game's English table reads it and a copy
 * pass can give it the game's own voice without reaching the Director.
 *
 * A spell's description already opens with its name (doc 010, rule 1), so it
 * is not prefixed a second time; an affix's and a stat's are.
 */
function cardText(id: string, description: string, name?: string): string {
  const title = name ?? titleOf(id);
  return description.startsWith(title) ? description : `${title}: ${description}`;
}

export function cardPool(
  items: ItemRegistry, owned: readonly string[], kind: RewardCardKind,
  held: readonly HeldSpell[] = [], promise: OfferPromise = {}, needs: CardNeeds = {},
): CardPool {
  const style = needs.style ?? promise.style;
  const revealed = needs.revealed ?? [];
  const neck = needs.gap ?? "none";
  const elements = needs.elements ?? [];
  type Entry = { id: string; description: string; facts: CardFact[]; group: boolean; compatibleHeldSpellIds?: readonly string[] };
  const when = (cond: boolean, fact: CardFact): CardFact[] => (cond ? [fact] : []);
  let all: Entry[] = [];
  if (kind === "spell") {
    all = [...items.values()].map((i) => ({
      id: i.id, description: cardText(i.id, i.description), group: !!promise.school && schoolOf(i.id) === promise.school,
      facts: [
        ...when(!!style && i.tags.includes(style), "style"),
        ...when(revealed.some((t) => i.tags.includes(t)), "build"),
        ...when((GAP_SPELL_TAGS[neck] ?? []).some((t) => i.tags.includes(t))
          || (neck === "mana" || neck === "cast_frequency") && i.mana <= 3, "eases"),
        ...when(elements.some((el) => el !== "none" && i.tags.includes(el)), "synergy"),
        ...when(!!needs.heldSpells?.includes(i.id), "upgrade"),
      ],
    }));
  } else if (kind === "stat") {
    all = STAT_UPGRADES.map((u) => ({
      id: u.id, description: cardText(u.id, u.description, u.name), group: !!promise.family && u.family === promise.family,
      facts: [
        ...when(!!style && !!STAT_STYLE[style]?.includes(u.family), "style"),
        ...when(revealed.some((t) => STAT_STYLE[t]?.includes(u.family)), "build"),
        ...when(!!needs.hurt && u.family === "survival", "need"),
        ...when(!!GAP_FAMILIES[neck]?.includes(u.family), "eases"),
      ],
    }));
  } else if (kind === "affix") {
    // A door whose strength is known deals only what it is strong enough for (`affixStrengthFloor`).
    all = fittingAffixes(held).filter((a) => promise.grade === undefined || affixStrengthFloor(a.id) <= promise.grade).map((a) => ({
      id: a.id,
      description: cardText(a.id, a.description, a.name),
      ...(held.length > 0 && held.every((key) => key.id)
        ? { compatibleHeldSpellIds: held.filter((key) => affixFitsHeld(a, key)).map((key) => key.id!) }
        : {}),
      group: false,
      facts: [
        ...when(!!style && !!AFFIX_STYLE[style]?.includes(a.id), "style"),
        ...when(revealed.some((t) => AFFIX_STYLE[t]?.includes(a.id)), "build"),
        ...when(!!needs.hurt && (a.id === "ward" || a.id === "retort"), "need"),
        ...when(!!GAP_AFFIXES[neck]?.includes(a.id), "eases"),
        // An infusion for an element already held, or a gauge affix on a status build.
        ...when(elements.some((el) => INFUSION[el] === a.id), "synergy"),
        ...when(!!needs.heldAffixes?.includes(a.id), "upgrade"),
      ],
    }));
  }
  /*
   * **A spell offer to a full staff is both things at once.**
   *
   * With every key taken, a copy of a held spell raises its level — a reward
   * with nothing to give up — and a spell the player does not hold opens the
   * replace prompt. This used to hand the whole offer to the first of those,
   * on the reasoning that the second is a cost rather than a reward. It is
   * not: a run whose keys filled early with the first three spells it was
   * shown is a run that can never change its mind, and "I would swap Magic
   * Bolt for that" is one of the real decisions a roguelike staff offers.
   *
   * So a full staff sees **both**: every held spell that can still be raised,
   * and the new spells that could replace one. Which of them the offer leans
   * toward is the Director's call, made against the build written out key by
   * key — a bare level-1 Magic Bolt beside a level-5 Void Orb is a replacement
   * candidate, the same staff after three levels is not. Code's only rule is
   * the safety bound: when both sorts exist, at least one of each appears
   * (`guarantee`), so the choice is always actually on the table.
   */
  let guarantee: readonly (readonly string[])[] | undefined;
  if (kind === "spell" && needs.keysFree === false) {
    const held = new Set(needs.heldSpells ?? []);
    const capped = new Set(owned);
    const upgrades = all.filter((e) => held.has(e.id) && !capped.has(e.id));
    const replacements = all.filter((e) => !held.has(e.id));
    if (upgrades.length > 0 && replacements.length > 0)
      guarantee = [upgrades.map((e) => e.id), replacements.map((e) => e.id)];
  }
  if (all.length === 0) return { kind, candidates: [], forced: [] };

  const have = new Set(owned);
  const freshFirst = (xs: Entry[], n: number) => {
    const fresh = xs.filter((x) => !have.has(x.id));
    return fresh.length >= n ? fresh : xs;
  };
  const tidy = (e: Entry): CardCandidate => ({
    id: e.id, description: e.description, facts: e.group ? [...e.facts, "promised"] : e.facts,
    ...(e.compatibleHeldSpellIds ? { compatibleHeldSpellIds: e.compatibleHeldSpellIds } : {}),
  });
  // The whole pool, the door's school or family marked `promised`: the
  // Director keeps one card of it in the offer (`cardAsk`), not the offer to it.
  const candidates = freshFirst(all, CARDS_PER_OFFER).map(tidy);
  const inPool = new Set(candidates.map((c) => c.id));
  const kept = (guarantee ?? [])
    .map((group) => group.filter((id) => inPool.has(id)))
    .filter((group) => group.length > 0);
  return {
    kind, candidates, forced: [],
    ...(kept.length > 1 ? { guarantee: kept } : {}),
  };
}

/**
 * **A door's cards, held to its strength.** The cards for every door are
 * drawn before the doors' strengths are decided — they come in one request —
 * so an affix the door turned out too weak for is swapped here for the next
 * candidate of the same pool it is strong enough for, in the pool's own
 * order, one not already on the door. A spell or a stat door, or a door
 * strong enough for all it drew, is left as it is.
 */
export function holdToStrength(kind: RewardCardKind, ids: readonly string[], strength: number, pool: CardPool | undefined): string[] {
  if (kind !== "affix") return [...ids];
  const fits = (id: string) => affixStrengthFloor(id) <= strength;
  if (ids.every(fits)) return [...ids];
  const kept = ids.filter(fits);
  const spare = (pool?.candidates ?? []).map((c) => c.id).filter((id) => fits(id) && !kept.includes(id));
  const out: string[] = [];
  for (const id of ids) {
    if (fits(id)) out.push(id);
    else {
      const next = spare.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

/** The cards for chosen ids, graded as the door promised. */
export function cardsFor(
  items: ItemRegistry, kind: RewardCardKind, ids: readonly string[], promise: OfferPromise = {},
): OfferCard[] {
  const grade = Math.max(1, Math.min(3, promise.grade ?? 1));
  return ids.flatMap((id) => {
    const c = cardOf(items, kind, id, grade);
    if (!c) return [];
    const tag = gradeTagPart(c.kind, grade);
    return [grade > 1
      ? {
        ...c, grade, stats: tag ? `${tag.text}  ${c.stats}` : c.stats,
        statParts: [
          ...(tag ? [tag] : []),
          ...(c.statParts ?? [{ text: c.stats, tone: "mod" as const }]),
        ],
      }
      : c];
  });
}

/** One card, by kind and id. */
function cardOf(items: ItemRegistry, kind: RewardCardKind, id: string, level = 1): OfferCard | null {
  if (kind === "spell") {
    const i = items.get(id);
    return i
      ? { kind, itemId: i.id, label: titleOf(i.id), stats: offerStats(i, level), statParts: offerStatParts(i, level), description: spellDetail(i) }
      : null;
  }
  if (kind === "stat") {
    const u = STAT_UPGRADES.find((x) => x.id === id);
    // An elite door's stat is applied twice, and says the doubled number.
    if (!u) return null;
    const part = statLinePart(u, Math.min(2, level));
    return {
      kind, itemId: u.id, label: u.name, stats: part.text,
      statParts: [{ ...part, tone: "mod" as const }], description: u.description,
    };
  }
  if (kind === "affix") {
    const a = SPELL_AFFIXES.find((x) => x.id === id);
    return a
      ? {
        kind, itemId: a.id, label: a.name, stats: affixStatParts(a).map((p) => p.text).join("  "),
        statParts: affixStatParts(a),
        description: `${a.description} ${capital(affixFitsLine(a))}.`,
      }
      : null;
  }
  return null;
}

/**
 * **One key, as the affix filter reads it.**
 *
 * The filter used to see a bare `SpellShape`, which is only the first of the
 * three reasons an affix can be a dead card. Reported from play: a scatter-shot
 * build was offered Seek over and over, and Seek does nothing on a spell that
 * throws several projectiles at once — `affixFitsSpell` refuses to attach it,
 * so the card was a reward that could not be taken. A card the player cannot
 * attach anywhere is a lie told in the reward screen, and `affixFits` alone
 * cannot see it, because the shape is `bolt` either way.
 *
 * So a key travels with everything the attach rule reads: its shape, how many
 * projectiles a cast throws, the affixes already on it, and whether it has a
 * slot left.
 */
export interface HeldSpell {
  /** The spell's id, so a card can name the keys it actually fits to Jev. */
  readonly id?: string;
  readonly shape: SpellShape;
  /** Projectiles per cast. A spread does not home, so `seek` is dead on one. */
  readonly count: number;
  /**
   * The cone it throws, in degrees; absent reads as none. A spell that already
   * goes out all round takes no `scatter`.
   */
  readonly spread?: number;
  /** How far its run's wake rolls, px (Dash Slash); absent reads as none. A run with a wake takes no `scatter`. */
  readonly wake?: number;
  /** Its own steer and pierce: a shot that already hunts or passes through everything takes no `seek` or `pierce`. */
  readonly seek?: number;
  readonly pierce?: number;
  /** Affix ids already attached, which both exclude and upgrade. */
  readonly affixes: readonly string[];
}

/** A key as `HeldSpell`, from the item on it and the affixes attached. */
export function heldSpell(
  item: (Pick<BaseItem, "params"> & Partial<Pick<BaseItem, "id">>) | null | undefined,
  affixes: readonly string[] = [],
): HeldSpell {
  return {
    ...(item?.id ? { id: item.id } : {}),
    shape: itemShape(item), count: Number(item?.params["count"] ?? 1),
    spread: Number(item?.params["spread"] ?? 0), wake: Number(item?.params["wake_reach"] ?? 0),
    seek: Number(item?.params["seek"] ?? 0), pierce: Number(item?.params["pierce"] ?? 0), affixes,
  };
}

/**
 * Whether this affix can go on this key at all: the attach rule the reward
 * screen will apply, asked before the card is dealt rather than after.
 *
 * A key with every slot full still takes a **duplicate** of an affix it holds,
 * because a duplicate is a tier rather than a fourth slot (doc 013).
 */
export function affixFitsHeld(affix: SpellAffix, key: HeldSpell): boolean {
  if (key.affixes.includes(affix.id)) return true;
  if (key.affixes.length >= AFFIX_SLOTS) return false;
  return affixFitsSpell(affix, {
    params: {
      shape: key.shape, count: key.count, spread: key.spread ?? 0, wake_reach: key.wake ?? 0,
      seek: key.seek ?? 0, pierce: key.pierce ?? 0,
    },
  }, key.affixes);
}

/** The affixes at least one held key can actually take; all of them if none are known. */
export function fittingAffixes(held: readonly HeldSpell[]): readonly SpellAffix[] {
  if (held.length === 0) return SPELL_AFFIXES;
  const fits = SPELL_AFFIXES.filter((a) => held.some((key) => affixFitsHeld(a, key)));
  // A staff with nowhere left to put anything still has to be offered
  // something, or the offer comes up empty and reads as a bug.
  return fits.length > 0 ? fits : SPELL_AFFIXES;
}

/** An affix as a reward card: its tier-one line, its surcharge, and where it fits. */
function affixCard(a: SpellAffix): OfferCard {
  return {
    kind: "affix", itemId: a.id, label: a.name,
    stats: affixStatParts(a).map((p) => p.text).join("  "),
    statParts: affixStatParts(a),
    description: `${a.description} ${capital(affixFitsLine(a))}.`,
  };
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** How many cards one offer shows. Three is the shape doc 003 describes. */
export const CARDS_PER_OFFER = 3;

/**
 * Picks `n` distinct entries, preferring what the player does not hold.
 *
 * Not a hard exclusion: late in a run a category can legitimately have nothing
 * new in it, and an offer that came up short would read as a bug rather than
 * as scarcity.
 */
function pick<T extends { id: string }>(
  pool: readonly T[], rng: Rng, n: number, owned: readonly string[],
): T[] {
  const have = new Set(owned);
  const fresh = rng.shuffle(pool.filter((i) => !have.has(i.id)));
  const rest = rng.shuffle(pool.filter((i) => have.has(i.id)));
  return [...fresh, ...rest].slice(0, n);
}

/**
 * The older mixed offer: one spell, one affix and gold.
 *
 * Kept for callers that have no door kind — the harness, and any room that
 * reaches a reward without having been chosen through a portal. The affix is
 * drawn as the affix door draws it: from the affixes some held spell can take.
 */
function mixedOffer(
  items: ItemRegistry, rng: Rng, owned: readonly string[], held: readonly HeldSpell[],
): OfferCard[] {
  const cards: OfferCard[] = [];
  const spell = pick([...items.values()], rng, 1, owned)[0];
  if (spell)
    cards.push({
      kind: "spell", itemId: spell.id, label: titleOf(spell.id),
      stats: offerStats(spell), statParts: offerStatParts(spell), description: spell.description,
    });
  const affix = pick(fittingAffixes(held), rng, 1, owned)[0];
  if (affix) cards.push(affixCard(affix));
  cards.push({
    kind: "gold", itemId: "", label: `${GOLD_CARD_VALUE} Gold`,
    stats: `+${GOLD_CARD_VALUE} gold`,
    statParts: [{ text: `+${GOLD_CARD_VALUE} gold`, tone: "mod", key: "stat.gold", args: { n: GOLD_CARD_VALUE } }],
    description: "Spend it at the merchant before the boss.",
  });
  return cards;
}

/**
 * An item id as a title. There is no display name in the content — doc 010
 * generates descriptions and the id is the only short handle — so the id is
 * humanised rather than a second name being invented that could drift from it.
 */
function titleOf(id: string): string {
  return id.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Prefers something the player does not have, and falls back to the whole pool.
 *
 * Not a hard exclusion: with 40 items and a 14-room run a late offer can
 * legitimately have nothing new in a category, and an offer that comes up
 * empty would leave a card missing — which reads as a bug, not as scarcity.
 */
function pickUnowned<T extends { id: string; description: string }>(
  pool: readonly T[], have: ReadonlySet<string>, rng: Rng,
): T | null {
  if (pool.length === 0) return null;
  const fresh = pool.filter((i) => !have.has(i.id));
  const from = fresh.length > 0 ? fresh : pool;
  return from[Math.floor(rng.next() * from.length)] ?? null;
}

/**
 * Which door set to offer, from the legal ones.
 *
 * The rule is **maximum agency, then variety**: the largest legal set, and
 * among equals the one containing the type the player has seen least. Doc 003
 * notes that three doors give "maximum agency, weaker pacing" — pacing is
 * exactly what Jev is for, and a baseline that always offers the widest choice
 * is both the most generous default and the easiest one to measure against,
 * since any improvement Jev makes has to come from *narrowing* the offer
 * usefully.
 *
 * When the pacing rules force a set there is nothing to choose and this returns
 * it unchanged, which is the correct behaviour rather than a special case.
 */
export function offerDoors(input: PacingInput): DoorSet {
  const legal = legalDoorSets(input);
  if (legal.length === 0) return ["combat"];

  const seen = new Map<RoomType, number>();
  for (const t of input.history.rooms) seen.set(t, (seen.get(t) ?? 0) + 1);
  const novelty = (set: DoorSet): number =>
    set.reduce((sum, t) => sum - (seen.get(t) ?? 0), 0);

  let best = legal[0]!;
  for (const set of legal) {
    if (set.length > best.length) { best = set; continue; }
    if (set.length === best.length && novelty(set) > novelty(best)) best = set;
  }
  return best;
}

/**
 * The whole offer for a room: the cards behind its own door, and the portals
 * out of it.
 *
 * One call because the two halves have to agree. The cards are of the kind the
 * player chose at the *previous* portal, and the portals are the kinds they may
 * choose next — getting those from separate places is how a room ends up
 * showing spell cards behind a door that promised gold.
 */
export function ruleOffer(
  items: ItemRegistry,
  rng: Rng,
  owned: readonly string[],
  run: RunShape,
  kind: RewardCardKind,
  held: readonly HeldSpell[] = [],
  promise: OfferPromise = {},
  portalCount?: number,
): Offer {
  // The boss's room ends the run: no reward to open, and no way on.
  if (stageFor(run.roomIndex) === "boss") return { cards: [], doors: [], coins: 0 };
  promise = { ...promise, style: promise.style ?? run.style };
  const doors = ruleDoors(run, rng, portalCount);
  return {
    cards: offerCards(items, rng, owned, kind, held, promise),
    // A graded gold door pays its grade over.
    ...(kind === "gold" ? { coins: goldRoomCoins(promise.grade) } : {}),
    doors: doorSpecs(doors, run.roomIndex),
  };
}

/**
 * **What a gold room scatters**, in coins; times `COIN_VALUE` that is what the
 * room is worth.
 *
 * It was eight coins — 24 gold — against a merchant who sells a stat for 20, an
 * affix for 30 and a spell for 45. So taking the gold portal cost the player a
 * card they would have been given for free and bought them less than the
 * cheapest thing on the shelf, and the door was correctly the one players liked
 * least: it was strictly the worst choice on offer.
 *
 * Sixteen coins is 48 gold, which buys the priciest thing the merchant sells
 * with change, or most of a level at the smith. That is the trade the door is
 * supposed to be: give up the card this room offers, and choose a better one
 * later. A graded gold door pays its grade over, so an elite gold portal is
 * two cards' worth of purchasing power.
 *
 * It only means anything alongside somewhere to spend it, which is why the
 * vendors' frequency moved with this number (`NPC_FIRST_ROOM`, `npc_room`).
 */
export const GOLD_ROOM_COINS = 16;

export function goldRoomCoins(grade = 1): number {
  return GOLD_ROOM_COINS * Math.max(1, grade);
}

/** A run that has just started, for the first room's inputs. */
export function emptyHistory(): RunHistory {
  return {
    rooms: [], tensions: [], profiles: [], spaces: [], counter_scores: [],
    shop_entered: false, rests_entered: 0, treasures_entered: 0,
    elite_last_room: false, shielded_rooms: 0,
  };
}
