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
import type { BaseItem, DoorSet, RoomType, RunHistory, SummaryLabels } from "../types.ts";
import type { ItemRegistry } from "../spells/items.ts";
import type { Rng } from "../rng.ts";
import type { OfferCard, PortalSpec, RewardCardKind } from "../sim/exits.ts";
import { buildPerHit, castableAlone, levelDamageMult, levelManaMult, spellCost } from "../sim/spells.ts";
import { STAT_UPGRADES, statLine } from "./stats.ts";
import { SPELL_AFFIXES, affixFits, affixFitsLine } from "../spells/affixes.ts";
import { schoolOf } from "../spells/schools.ts";
import type { SpellShape } from "../spells/affixes.ts";
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
 * How much gold the safe pick is worth. Doc 003's economy puts the `gold`
 * reward kind at 20 and a combat clear at 10 to 15, so taking gold over an
 * item is worth about two rooms of income — enough that it is a real option
 * rather than a forfeit.
 */
export const GOLD_CARD_VALUE = 20;

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
export interface StatPart {
  readonly text: string;
  readonly tone: StatTone;
}

/** The numbers line as plain text, for places that cannot colour it. */
export function offerStats(item: BaseItem, level = 1): string {
  return offerStatParts(item, level).map((p) => p.text).join("  ");
}

export function offerStatParts(item: BaseItem, level = 1): StatPart[] {
  const parts: StatPart[] = [];
  const push = (text: string, tone: StatTone) => parts.push({ text, tone });
  /*
   * The mana a cast **actually** spends. `item.mana` is the spell's cost
   * *rank*, 1 to 7, and the keyed spell pays `spellCost` of it — 5 plus 2.5
   * a rank — so printing the rank said "3 mana" over a spell that took 10.
   * Only a keyed spell pays that; anything else still prints its own figure.
   */
  const mana = castableAlone(item)
    ? Math.round(spellCost(null, item.mana) * levelManaMult(level) * 10) / 10
    : item.mana;
  if (mana > 0) push(`${fmtMana(mana)} mana`, "mana");

  // At the spell's level: whole points, as the hit lands them.
  const rawDmg = item.params.damage;
  const dmg = typeof rawDmg === "number" && castableAlone(item) ? Math.floor(rawDmg * levelDamageMult(level) + 1e-6) : rawDmg;
  const count = item.params.count;
  const shape = item.params.shape;
  // The number the player is comparing: damage per cast, with the count that
  // makes it. A pillar does none by design and says what it does instead.
  // The element rides on the damage it colours: "10 poison dmg x3".
  const el = item.params.element;
  const tinted = typeof el === "string" && el !== "none" && shape !== "field" ? `${el} ` : "";
  const dmgTone: StatTone = el === "fire" || el === "ice" || el === "poison" ? el : "damage";
  if (typeof dmg === "number" && dmg > 0)
    push(typeof count === "number" && count > 1 ? `${dmg} ${tinted}dmg x${count}` : `${dmg} ${tinted}dmg`, dmgTone);
  if (shape === "orbit") push("orbits you", "trait");
  if (shape === "field") push("burning ground", "trait");
  if (shape === "pillar") push("raises a wall", "trait");
  if (shape === "dash") push("dash through", "trait");
  if (shape === "vortex") push("pulls enemies in", "trait");
  if (shape === "summon") push("summons an ally", "trait");
  const chain = item.params.chain;
  if (typeof chain === "number" && chain > 0) push(`chains x${chain}`, "trait");

  const repeat = item.params.repeat;
  if (typeof repeat === "number" && repeat > 0)
    push(`+${repeat} extra cast${repeat === 1 ? "" : "s"}`, "trait");

  const n = item.params.n;
  if (item.kind === "multicast" && typeof n === "number") push(`casts x${n}`, "trait");

  /*
   * An element is the whole effect of the rune that carries it, so it is named
   * rather than left out. `frost_rune` has `element: "ice"` and no numeric
   * parameter at all, so before this its card read "1 mana" and nothing else —
   * a line that passes a not-empty test while telling the player nothing.
   */
  const element = item.params.element;
  // A field already says "burning"; naming the element again is a word spent twice.
  if (typeof element === "string" && element !== "none" && shape !== "field" && !(typeof dmg === "number" && dmg > 0))
    push(`${element} damage`, element === "fire" || element === "ice" || element === "poison" ? element : "damage");

  for (const [key, raw] of Object.entries(item.params)) {
    if (typeof raw !== "number") continue;
    const label = MODIFIER_LABELS[key];
    if (!label) continue;
    if (key.endsWith("_mult")) {
      // A multiplier is read as the change, not the factor: 1.35 is "+35%".
      const pct = Math.round((raw - 1) * 100);
      if (pct !== 0) push(`${pct > 0 ? "+" : ""}${pct}% ${label}`, "mod");
    } else if (PERCENT_KEYS.has(key)) {
      // A chance or a share is a percentage. "+0.12 crit" is a number the
      // player has to translate; "+12% crit" is the thing itself.
      push(`+${Math.round(raw * 100)}% ${label}`, "mod");
    } else if (raw !== 0) {
      push(`${raw > 0 ? "+" : ""}${raw} ${label}`, "mod");
    }
  }
  return parts;
}

/**
 * What an elemental spell does to the enemy's gauge, in one sentence: how
 * much one hit fills and how many it takes. Spells of one element differ —
 * a fast needle fills a quarter, a slow spike more than half — and the
 * difference is only a choice if it is written down.
 */
export function statusLine(item: BaseItem): string {
  const per = buildPerHit(item);
  if (per <= 0) return "";
  const element = item.params.element;
  const [name, verb] = element === "fire" ? ["Burn", "ignite"]
    : element === "poison" ? ["Poison", "poison"]
    : element === "ice" ? ["Chill", "freeze"] : ["Build-up", "apply"];
  const unit = item.params.shape === "field" ? "tick" : "hit";
  const hits = Math.ceil(1 / per - 1e-9);
  return `${name}: ${Math.round(per * 100)}% of the gauge a ${unit}, ${hits} ${unit}s to ${verb}.`;
}

/** A spell's description with its status line in front, for cards and the character screen. */
export function spellDetail(item: BaseItem): string {
  const line = statusLine(item);
  return line ? `${line} ${item.description}` : item.description;
}

/** A cost as the HUD shows mana: whole, or to one place. */
function fmtMana(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Which parameters are worth showing, and what to call them.
 *
 * An allow-list rather than a formatter over everything: `params` also carries
 * the simulation's own numbers — flight speed, lifetime, spread in degrees —
 * which are how the thing works rather than how good it is, and printing them
 * would bury the one figure that matters in five that do not.
 */
const MODIFIER_LABELS: Readonly<Record<string, string>> = {
  damage_mult: "damage",
  speed_mult: "speed",
  radius_mult: "size",
  count_add: "projectiles",
  pierce_add: "pierce",
  bounce: "bounces",
  homing: "homing",
  mana_mult: "mana cost",
  cooldown_mult: "cooldown",
  regen_add: "mana regen",
  cast_interval_mult: "cast time",
  crit_add: "crit",
  thorns: "thorns",
  lifesteal: "lifesteal",
  tracking_add: "tracking",
  // `fracture_rune` splits projectiles into fragments when they die, which is
  // an *event* rather than a number — the same shape as doc 013's `fork`.
  split: "fragments",
};

/** Modifiers the player reads as a percentage rather than as a raw number. */
const PERCENT_KEYS = new Set(["crit_add", "lifesteal", "tracking_add", "homing"]);

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
  held: readonly SpellShape[] = [], promise: OfferPromise = {},
): OfferCard[] {
  const grade = Math.max(1, Math.min(3, promise.grade ?? 1));
  return offerCardsUngraded(items, rng, owned, kind, held, promise)
    .map((c) => {
      if (grade <= 1 || c.kind === "gold") return c;
      if (c.kind === "stat") {
        const u = STAT_UPGRADES.find((x) => x.id === c.itemId);
        return u ? { ...c, grade, stats: statLine(u, Math.min(2, grade)) } : { ...c, grade };
      }
      const tag = gradeTag(c.kind, grade);
      return { ...c, grade, stats: tag ? `${tag}  ${c.stats}` : c.stats };
    });
}

/**
 * What a grade reads as in a card's numbers, where it changes a number: a
 * spell's level, a stat applied twice. An affix's grade is its **rarity**
 * (`rarityOf`), shown on the card's frame rather than as "tier III" in the
 * text, so it says nothing here.
 */
export function gradeTag(kind: RewardCardKind, grade: number): string {
  if (kind === "spell") return `Lv ${grade}`;
  if (kind === "affix") return "";
  // A stat's grade is already in its number (`statLine(u, times)`).
  if (kind === "stat") return "";
  return `x${grade}`;
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
  held: readonly SpellShape[], promise: OfferPromise,
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
  if (!kind) return mixedOffer(items, rng, owned);

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
        stats: statLine(u), description: u.description,
      }));
    case "spell":
      return (promise.school
        ? promised([...items.values()].filter(castableAlone), (i) => schoolOf(i.id) === promise.school, rng, owned)
        : promise.style
          ? leaning([...items.values()].filter(castableAlone), (i) => i.tags.includes(promise.style!), rng, owned)
          : pick([...items.values()].filter(castableAlone), rng, CARDS_PER_OFFER, owned))
        .map((i) => ({
          kind: "spell" as const, itemId: i.id, label: titleOf(i.id),
          stats: offerStats(i), description: spellDetail(i),
        }));
    case "affix":
      /*
       * Doc 013's twelve event affixes, now that every hook fires
       * (`sim/affix-hooks.ts`, and the test that shows each one doing what its
       * card says). Until that existed this drew from the numeric boosts, on
       * the grounds that a card whose effect is not wired is the multicast bug
       * freshly painted. The boosts leave the reward pool with this change,
       * which is where doc 013 always put them: numbers come from spell level
       * and the stat door, events come from here.
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
      return pick(fittingAffixes(held), rng, CARDS_PER_OFFER, owned).map((a) => ({
        kind: "affix" as const, itemId: a.id, label: a.name,
        stats: a.tiers[0]!.text,
        description: `${a.description} ${capital(affixFitsLine(a))}.`,
      }));
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
 *   preference, the build simulation's dominant tags).
 * - `need`: what the run is short of right now — survival when hurt, mana
 *   when mana is tight, a role no key fills.
 * - `bottleneck`: what the build simulation says limits it — damage, cast
 *   frequency, mana or accuracy — and this card eases.
 * - `synergy`: it works with what is held — an element the keys already
 *   carry, a spell of the same element.
 * - `upgrade`: it raises something held (a spell's level, an affix's tier),
 *   which is how a build matures rather than widens.
 * - `promised`: it is of the school or family the door named.
 *
 * Every legal card stays in the pool; the facts only move its weight.
 */
export type CardFact = "style" | "build" | "need" | "bottleneck" | "synergy" | "upgrade" | "promised";

export interface CardCandidate {
  readonly id: string;
  readonly description: string;
  readonly facts: readonly CardFact[];
}

/** What the build is short of, as labels. */
export interface CardNeeds {
  readonly style?: string;
  readonly hurt?: boolean;
  readonly manaTight?: boolean;
  readonly missingRoles?: readonly string[];
  /** The archetypes the held keys actually lean, from the build simulation. */
  readonly revealed?: readonly string[];
  /** The build simulation's bottleneck label. */
  readonly bottleneck?: string;
  /** Elements the held keys carry, including an infusion affix's. */
  readonly elements?: readonly string[];
  /** The ids of the held spells, and of the affixes on them. */
  readonly heldSpells?: readonly string[];
  readonly heldAffixes?: readonly string[];
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
    manaTight: labels.build.mana_sustain === "tight" || labels.build.mana_sustain === "starved",
    missingRoles: labels.build.missing_roles,
    revealed: labels.build.dominant_tags,
    bottleneck: labels.build.bottleneck,
    elements: [...elements],
    heldSpells: keys.map((k) => k.base),
    heldAffixes: keys.flatMap((k) => k.affixes.map((a) => a.id)),
  };
}

/** The blacksmith's price to raise a spell *from* this level. */
export const SMITH_PRICE: Readonly<Record<number, number>> = { 1: 35, 2: 60 };

/**
 * **The last stop mends** (task 10): the merchant's room before the boss
 * restores this many hearts, up to the cap.
 *
 * Health does not come back inside a run, and that is the design's tension —
 * but measured, the runs that lost to the boss arrived with 3.6 hearts on
 * average against the winners' 5.6, and a boss fight entered on a third of a
 * health bar is the slog the build could not prevent. Every roguelike this
 * one learns from rests before its boss (Slay the Spire's campfire, Hades'
 * fountain); the mend is at the stop the player chose to reach, not a room
 * they can choose to take.
 */
export const PREBOSS_MEND_HEARTS = 3;

/** Which spells, affixes and stat families ease each bottleneck. */
const BOTTLENECK_SPELL_TAGS: Readonly<Record<string, readonly string[]>> = {
  damage: ["nuke", "area"], cast_frequency: ["spam"], mana: ["spam"], accuracy: ["tracking", "area"],
};
const BOTTLENECK_AFFIXES: Readonly<Record<string, readonly string[]>> = {
  damage: ["brand", "fork", "pierce", "kindle", "blight"], cast_frequency: ["haste", "repeat", "resonance"],
  mana: ["echo", "harvest"], accuracy: ["seek", "chain", "scatter"],
};
const BOTTLENECK_FAMILIES: Readonly<Record<string, readonly string[]>> = {
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
}

/** Which affixes read as each build style. */
const AFFIX_STYLE: Readonly<Record<string, readonly string[]>> = {
  spam: ["repeat", "scatter", "fork", "echo", "seek"],
  nuke: ["shatter", "brand", "bloom", "pierce", "rime", "haste"],
  area: ["bloom", "scatter", "chain", "ricochet"],
  dot: ["brand", "chain", "harvest", "kindle", "blight"],
  melee: ["resonance", "retort", "slipstream", "ward", "haste"],
};

/** Which stat families read as each build style. */
const STAT_STYLE: Readonly<Record<string, readonly string[]>> = {
  spam: ["mana"], nuke: ["mana"], area: ["movement"], dot: ["movement"], melee: ["sword"],
};

export function cardPool(
  items: ItemRegistry, owned: readonly string[], kind: RewardCardKind,
  held: readonly SpellShape[] = [], promise: OfferPromise = {}, needs: CardNeeds = {},
): CardPool {
  const style = needs.style ?? promise.style;
  const revealed = needs.revealed ?? [];
  const neck = needs.bottleneck ?? "none";
  const elements = needs.elements ?? [];
  type Entry = { id: string; description: string; facts: CardFact[]; group: boolean };
  const when = (cond: boolean, fact: CardFact): CardFact[] => (cond ? [fact] : []);
  let all: Entry[] = [];
  if (kind === "spell") {
    all = [...items.values()].filter(castableAlone).map((i) => ({
      id: i.id, description: `${titleOf(i.id)}: ${i.description}`, group: !!promise.school && schoolOf(i.id) === promise.school,
      facts: [
        ...when(!!style && i.tags.includes(style), "style"),
        ...when(revealed.some((t) => i.tags.includes(t)), "build"),
        ...when(i.tags.some((t) => needs.missingRoles?.includes(t)), "need"),
        ...when((BOTTLENECK_SPELL_TAGS[neck] ?? []).some((t) => i.tags.includes(t))
          || (neck === "mana" || neck === "cast_frequency") && i.mana <= 3, "bottleneck"),
        ...when(elements.some((el) => el !== "none" && i.tags.includes(el)), "synergy"),
        ...when(!!needs.heldSpells?.includes(i.id), "upgrade"),
      ],
    }));
  } else if (kind === "stat") {
    all = STAT_UPGRADES.map((u) => ({
      id: u.id, description: `${u.name}: ${u.description}`, group: !!promise.family && u.family === promise.family,
      facts: [
        ...when(!!style && !!STAT_STYLE[style]?.includes(u.family), "style"),
        ...when(revealed.some((t) => STAT_STYLE[t]?.includes(u.family)), "build"),
        ...when((!!needs.hurt && u.family === "survival") || (!!needs.manaTight && u.family === "mana"), "need"),
        ...when(!!BOTTLENECK_FAMILIES[neck]?.includes(u.family), "bottleneck"),
      ],
    }));
  } else if (kind === "affix") {
    all = fittingAffixes(held).map((a) => ({
      id: a.id, description: `${a.name}: ${a.description}`, group: false,
      facts: [
        ...when(!!style && !!AFFIX_STYLE[style]?.includes(a.id), "style"),
        ...when(revealed.some((t) => AFFIX_STYLE[t]?.includes(a.id)), "build"),
        ...when((!!needs.hurt && (a.id === "ward" || a.id === "retort")) || (!!needs.manaTight && a.id === "harvest"), "need"),
        ...when(!!BOTTLENECK_AFFIXES[neck]?.includes(a.id), "bottleneck"),
        // An infusion for an element already held, or a gauge affix on a status build.
        ...when(elements.some((el) => INFUSION[el] === a.id), "synergy"),
        ...when(!!needs.heldAffixes?.includes(a.id), "upgrade"),
      ],
    }));
  }
  if (all.length === 0) return { kind, candidates: [], forced: [] };

  const have = new Set(owned);
  const freshFirst = (xs: Entry[], n: number) => {
    const fresh = xs.filter((x) => !have.has(x.id));
    return fresh.length >= n ? fresh : xs;
  };
  const tidy = (e: Entry): CardCandidate => ({
    id: e.id, description: e.description, facts: e.group ? [...e.facts, "promised"] : e.facts,
  });
  const group = all.filter((e) => e.group);
  const groupFresh = freshFirst(group, CARDS_PER_OFFER);
  if (group.length > 0 && groupFresh.length >= CARDS_PER_OFFER)
    return { kind, candidates: groupFresh.map(tidy), forced: [] };
  if (group.length > 0) {
    const rest = freshFirst(all.filter((e) => !e.group), CARDS_PER_OFFER - group.length);
    return { kind, candidates: rest.map(tidy), forced: group.slice(0, CARDS_PER_OFFER).map((e) => e.id) };
  }
  return { kind, candidates: freshFirst(all, CARDS_PER_OFFER).map(tidy), forced: [] };
}

/** The cards for chosen ids, graded as the door promised. */
export function cardsFor(
  items: ItemRegistry, kind: RewardCardKind, ids: readonly string[], promise: OfferPromise = {},
): OfferCard[] {
  const grade = Math.max(1, Math.min(3, promise.grade ?? 1));
  return ids.flatMap((id) => {
    const c = cardOf(items, kind, id, grade);
    if (!c) return [];
    const tag = gradeTag(c.kind, grade);
    return [grade > 1
      ? {
        ...c, grade, stats: tag ? `${tag}  ${c.stats}` : c.stats,
        statParts: [
          ...(tag ? [{ text: tag, tone: "grade" as const }] : []),
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
    return u ? { kind, itemId: u.id, label: u.name, stats: statLine(u, Math.min(2, level)), description: u.description } : null;
  }
  if (kind === "affix") {
    const a = SPELL_AFFIXES.find((x) => x.id === id);
    return a
      ? { kind, itemId: a.id, label: a.name, stats: a.tiers[0]!.text, description: `${a.description} ${capital(affixFitsLine(a))}.` }
      : null;
  }
  return null;
}

/** The affixes at least one held shape can take; all of them if none are known. */
function fittingAffixes(held: readonly SpellShape[]) {
  if (held.length === 0) return SPELL_AFFIXES;
  const fits = SPELL_AFFIXES.filter((a) => held.some((s) => affixFits(a, s)));
  return fits.length > 0 ? fits : SPELL_AFFIXES;
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
 * The older mixed offer: one spell, one modifier and gold.
 *
 * Kept for callers that have no door kind — the harness, and any room that
 * reaches a reward without having been chosen through a portal.
 */
function mixedOffer(items: ItemRegistry, rng: Rng, owned: readonly string[]): OfferCard[] {
  const all = [...items.values()];
  const cards: OfferCard[] = [];
  const spell = pick(all.filter(castableAlone), rng, 1, owned)[0];
  if (spell)
    cards.push({
      kind: "spell", itemId: spell.id, label: titleOf(spell.id),
      stats: offerStats(spell), description: spell.description,
    });
  const affix = pick(all.filter((i) => i.kind === "boost" || i.kind === "passive"), rng, 1, owned)[0];
  if (affix)
    cards.push({
      kind: "affix", itemId: affix.id, label: titleOf(affix.id),
      stats: offerStats(affix), description: affix.description,
    });
  cards.push({
    kind: "gold", itemId: "", label: `${GOLD_CARD_VALUE} Gold`,
    stats: `+${GOLD_CARD_VALUE} gold`,
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
  held: readonly SpellShape[] = [],
  promise: OfferPromise = {},
): Offer {
  // The boss's room ends the run: no reward to open, and no way on.
  if (stageFor(run.roomIndex) === "boss") return { cards: [], doors: [], coins: 0 };
  promise = { ...promise, style: promise.style ?? run.style };
  const doors = ruleDoors(run, rng);
  return {
    cards: offerCards(items, rng, owned, kind, held, promise),
    // A graded gold door pays its grade over.
    ...(kind === "gold" ? { coins: goldRoomCoins(promise.grade) } : {}),
    doors: doorSpecs(doors, run.roomIndex),
  };
}

/** What a gold room scatters: 14 coins a grade. */
export function goldRoomCoins(grade = 1): number {
  return 14 * Math.max(1, grade);
}

/** A run that has just started, for the first room's inputs. */
export function emptyHistory(): RunHistory {
  return {
    rooms: [], tensions: [], profiles: [], spaces: [], counter_scores: [],
    shop_entered: false, rests_entered: 0, treasures_entered: 0,
    elite_last_room: false, shielded_rooms: 0,
  };
}
