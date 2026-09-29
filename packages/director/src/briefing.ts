/**
 * **The Director's briefing**: the run, as a designer would want it read.
 *
 * Jev is a classifier that reads natural language, so the state is written for
 * reading rather than as a table of labels. The shape is a list of fields —
 * sections, one line per object, a comma-joined line of what that object is —
 * with sub-items only for what is text by nature: a spell's behaviour, an
 * affix's effect, the player's own words. Every line is a measurement put into
 * words, never a verdict ("lost 9 of 60, nearly one of six hearts", not
 * "struggling"); what the numbers mean is Jev's to judge.
 *
 * A list of fields rather than sentences because each field is filled on its
 * own: a missing value drops its phrase and nothing else has to be reworded,
 * and a new fact is one more phrase or one more line.
 *
 * Numbers come from the constants the game runs on, never from a figure typed
 * here — a price the briefing quotes and a price the merchant charges have to
 * be the same number or the Director is advising on a game that does not exist.
 */
import {
  AFFIX_SLOTS, ARCHETYPES, COIN_VALUE, FOUNTAIN_HEAL_FRACTION, GOLD_ROOM_COINS, HP_PER_HEART, ITEMS,
  MANA_PER_HIT_FRACTION, MANA_REGEN_FRACTION_PER_S, MERCHANT_PRICE, RUN_BOSS_ROOM,
  RUN_AUDIENCE_ROOM, RUN_GUARDIAN_ROOM, audienceRoomFor, RUN_COMBAT_ROOMS, RUN_SHOP_ROOM, SMITH_PRICE, SPELL_LEVEL_MAX, SPELL_SCHOOLS, STAT_FAMILIES,
  MAX_HEARTS, STYLE_CARDS, TYPICAL_RUN_HEALTH_LOST, UNMEASURED, archetype, buildFacts, cardStyleTags, enemy,
  keyCost, keysLean, levelDamageMult, schoolOf, spellAffixById, statById, typicalHealthLostBy,
  baseXp, LEVEL_HP, LEVEL_SWORD_DAMAGE, LEVEL_MANA, swordAt,
} from "@jr/core";
import type {
  BaseItem, EncounterProfile, HeldKey, JournalDoor, Mood, ObservedLabels, RunContext, RunJournalEntry,
  SpaceArchetypeId, StatFamily,
} from "@jr/core";
import { AFFIX_LANES, laneFromText } from "./questions/affixes.ts";
import { clampFreeText } from "./questions/common.ts";
import { recentHistory } from "./questions/history.ts";
import { LAST_LOOK } from "./questions/specs.ts";

/* ------------------------------------------------------------------- input */

/** What the player told the run, and how they have been playing it. */
export interface BriefingPlayer {
  /** The style picked at the start, by its name on the card, and its preset id. */
  readonly style: string;
  readonly stylePreset?: string;
  /** What the style's spells do (`STYLE_CARDS[preset].does`), not the card's blurb. */
  readonly styleMeans?: string;
  /** What they typed at the start, if anything, and the lane `laneFromText` reads in it. */
  readonly ownWords?: string;
  readonly ownWordsLane?: string;
  readonly ownWordsLaneMeans?: string;
}

export interface BriefingBuild {
  /** The keys in order; null is an empty key. */
  readonly keys: readonly (HeldKey | null)[];
  readonly manaMax: number;
  /** Spell presses and those refused for mana, over the last fights. */
  readonly presses?: number;
  readonly refusedForMana?: number;
  /** Stat upgrades taken this run, by id, in order. */
  readonly statsTaken: readonly string[];
  /** The build facts `run/build-facts.ts` measured, for the plain-language lines. */
  readonly affixSlotsOpen?: string;
  readonly spellLevels?: string;
  readonly heldElements?: string;
  readonly buildShape?: string;
  readonly dominantTags?: readonly string[];
}

/** What the last fights measured, plus the three run labels that ride with them. */
export interface BriefingObserved extends Partial<ObservedLabels> {
  /**
   * Whether any fight has been played at all. False, and the buckets below are
   * the defaults `UNMEASURED` returns, which read as a player on a full bar
   * clearing fast and doing fair damage — three claims about a run that has
   * not started. Room 1 came back `peak` on every run because of exactly that,
   * so the section says so in words instead of printing them.
   */
  readonly measured?: boolean;
  readonly clear_speed?: string;
  readonly recent_damage?: string;
  readonly movement_pressure_recent?: string;
  /** The raw figures behind the buckets, where the caller has them. */
  readonly castsPerMinute?: number;
  readonly damagePerSecond?: number;
  readonly bodiesPerShot?: number;
  readonly swordShare?: number;
}

/** What the run has been offering, and what the player did with it. */
export interface BriefingOffers {
  /**
   * The off-style bucket, printed as a count only where the cards themselves
   * are not given (`keptLast`). The bucket is not the count: "drifting" is one
   * *or two* of the last three off the stated style, so it printed "1" for
   * both, and nothing said which cards they were.
   */
  readonly offStylePicks?: string;
  /**
   * **The last three cards kept, oldest first, each with its style tags** —
   * the fact the `variety` question is asked to read, as the cards rather than
   * as a bucket of them. A spell's tags are its own; an affix's and a stat's
   * are the styles whose tables claim them (`cardStyleTags`), which is what
   * `preference.consistency` counts.
   */
  readonly keptLast?: readonly { readonly name: string; readonly tags: readonly string[] }[];
  /** The stated style's tag, which the kept cards are counted against. */
  readonly statedStyle?: string;
  readonly keysLean?: string;
  /**
   * **The offers themselves, room by room**, counted rather than narrated.
   *
   * Three labels used to ride here as well — which badge had been on every one
   * of the last few offers, which the player walked through most, which they
   * were offered most and took least. They are gone: finding 5a measured that
   * the counts move nothing and that those sentences move the option they name
   * by up to forty points. Jev cannot walk a list, so nothing here is printed
   * as one either; code counts and the briefing prints the counts.
   */
  readonly doorsOffered?: readonly (readonly string[])[];
  readonly doorsTaken?: readonly string[];
}

/** The room this request is deciding, once round 1 has decided its shape. */
export interface BriefingRoomNow {
  readonly space: string;
  readonly size: string;
  readonly symmetry: string;
  readonly mood: Mood;
  readonly openness: string;
  readonly cover: string;
  readonly zones: readonly string[];
  readonly spawnGroups: readonly string[];
  readonly hazardCap: string;
  readonly tension: string;
  readonly waves: number;
  /**
   * **What the room's own step of the run-progress ramp allows**: bodies over
   * the whole fight, and bodies standing at once.
   *
   * The density question asks for a count, and the count it asks for is the
   * room's total; how many of them stand on the floor together is the ramp's
   * and no answer moves it. Without these two numbers the option text had to
   * carry both ideas at once ("many bodies at once: the hardest crowd") and
   * the two are not the same thing — a room 1 that may hold twelve bodies but
   * never more than four at a time is a middling count and a small crowd.
   */
  readonly bodyCap: number;
  readonly aliveCap: number;
}

export interface BriefingNow {
  readonly health: number;
  readonly maxHealth: number;
  readonly gold: number;
  /**
   * **The body's level and how far into the next one** (`run/levels.ts`).
   *
   * A fact, stated and left alone: no question is grounded on it, no option
   * mentions it, and nothing in the rule table reads it. It is here because
   * the briefing is the run written out for a reader and the level is part of
   * the run — two players in room 10 with the same cards can be a level apart.
   */
  readonly level?: number;
  readonly xpInto?: number;
  readonly xpToNext?: number;
  /** The room about to be decided, its kind, and how it was entered. */
  readonly roomIndex: number;
  /** The room this run's first audience falls in (`audienceRoomFor`); room 5 when absent. */
  readonly audienceRoom?: number;
  readonly roomType?: string;
  readonly doorIn?: string;
  /** One phrase per question this request asks, in the player's terms. */
  readonly deciding: readonly string[];
}

export interface BriefingInput {
  readonly player: BriefingPlayer;
  readonly build: BriefingBuild;
  readonly observed?: BriefingObserved;
  readonly offers?: BriefingOffers;
  /** Every room played so far, oldest first. */
  readonly rooms: readonly RunJournalEntry[];
  readonly now: BriefingNow;
  /** Set on a round-2 request: the room the first round decided. */
  readonly room?: BriefingRoomNow;
  /** The cards on this request's shelf, by pool, with what the offer machinery knows. */
  readonly cards?: readonly BriefingCardPool[];
}

/** One pool of candidates the request is choosing from. */
export interface BriefingCardPool {
  /** spell, affix or stat, and where it is being offered. */
  readonly kind: string;
  readonly where?: string;
  /** Per candidate: its id and the facts the pool tagged it with. */
  readonly candidates: readonly {
    readonly id: string;
    readonly facts: readonly string[];
    /** Affix candidates carry the actual held spells that can take them. */
    readonly compatibleHeldSpellIds?: readonly string[];
  }[];
  /** Whether a pity card or a temptation card is armed for this offer. */
  readonly pity?: boolean;
  readonly temptation?: boolean;
  /**
   * Groups the offer must hold at least one of each of. A spell offer to a
   * full staff is both an upgrade offer and a replacement offer, and an offer
   * that came out all one sort asks the player a question they did not have.
   */
  readonly guarantee?: readonly (readonly string[])[];
}

/* --------------------------------------------------------------- the game */

/** Rooms written out in full; older ones are rolled up in one line. */
export const BRIEFING_RECENT_ROOMS = 5;
/** "Passed over" is only worth the tokens for the rooms still in short memory. */
export const BRIEFING_PASSED_OVER_ROOMS = 2;

const gold = (n: number) => `${n} gold`;
const pct = (share: number) => `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
const round1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** How many casts a full bar buys at some cost, as a whole number. */
function castsPerBar(manaMax: number, cost: number): number {
  return cost > 0 ? Math.max(1, Math.floor(manaMax / cost)) : 0;
}

/**
 * **The game, for a reader who has never seen it.** Jev has no context but
 * what it is sent, and the briefing is full of words this game made up — a
 * key, an affix, a smith, a style, an elite. Each is said once here, with its
 * numbers read off the constants the game runs on, and a word that needs its
 * own meaning where it is used carries it there.
 *
 * One word per thing, throughout: *merchant*, never "shop"; *smith*, never
 * "blacksmith"; *key*, never "slot"; *variant*, never "subspecies".
 */
export const THE_GAME: string = [
  "The game",
  `- A top-down action roguelike. A run is ${RUN_COMBAT_ROOMS} fights, then a fixed stop with a merchant, `
    + `a smith and a fountain and no enemies, then the boss: ${RUN_BOSS_ROOM} rooms in all. The player fights `
    + "with a sword and up to three spells.",
  `- Keys: the three spell slots; each holds one spell. A spell has a level (1 to ${SPELL_LEVEL_MAX}: more `
    + `damage, and about 10% more mana a cast per level) and up to ${AFFIX_SLOTS} affixes.`,
  "- Affix: a modifier attached to one spell that changes how it behaves (it bounces, chains, burns, "
    + "repeats...). Each has one fixed effect and a strength, 1 to 3: the least door strength that deals it. "
    + "A key does not take an affix it already carries.",
  `- School: a spell's family. There are ${SPELL_SCHOOLS.length}: ${SPELL_SCHOOLS.join(", ")}. `
    + "Element: fire, ice or poison, which builds a status on what it hits. Most spells have no element.",
  `- Mana: one shared bar, full at the start of every room. It trickles back on its own at `
    + `${Math.round(MANA_REGEN_FRACTION_PER_S * 100)}% of the bar a second, about `
    + `${Math.round(1 / MANA_REGEN_FRACTION_PER_S)} seconds for a full bar. A connecting sword swing returns `
    + `${Math.round(MANA_PER_HIT_FRACTION * 100)}% of the bar, so about `
    + `${Math.round(1 / MANA_PER_HIT_FRACTION)} hits refill it. A key pressed with too little mana does nothing.`,
  `- Stats: small permanent upgrades, in four families — ${STAT_FAMILIES.join(", ")} — with three in each. `
    + "Those four words are the answers to the stat-family question.",
  "- Doors: each room ends with one to three doors, each promising a reward for clearing the next room: "
    + "spell (a new spell, or a level for one on the staff), affix, stat, gold, or a room with no fight in "
    + `it — merchant (buys a card for gold: spell ${MERCHANT_PRICE["spell"]}, affix ${MERCHANT_PRICE["affix"]}, `
    + `stat ${MERCHANT_PRICE["stat"]}), smith (raises one held spell's level for gold: `
    + `${[1, 2, 3, 4].map((l) => `${SMITH_PRICE[l]} from level ${l}`).join(", ")}), or fountain (one drink, `
    + `back to ${Math.round(FOUNTAIN_HEAL_FRACTION * 100)}% more of the bar, then it is dry). A gold door `
    + `scatters about ${gold(GOLD_ROOM_COINS * COIN_VALUE)}.`,
  "- Elite, in two senses. An elite room is one behind a door marked elite: the same kind of fight made "
    + "harder, for a reward graded up one or two steps. An elite body is an enraged enemy hidden inside "
    + "an ordinary room — the same fight at twice the health and a little more damage — which drops a heal "
    + "and a coin when it falls.",
  "- Variant: a body the player has met before with one thing about it changed, so it is answered "
    + "differently without being a new enemy to learn.",
  `- Level: the player's own level, separate from a spell's. Killing a body pays experience — from `
    + `about ${baseXp("rusher")} for the lightest to about ${baseXp("summoner")} for the heaviest, two and a half times `
    + "that for an elite body, and nothing at all for a body another body summoned or for the boss. "
    + `Enough experience raises the level on its own, with no card and no choice: each level adds `
    + `${LEVEL_HP} health, ${LEVEL_SWORD_DAMAGE} sword damage and ${Math.round(LEVEL_MANA * 100)}% mana, and `
    + `hands back the ${LEVEL_HP} health it just added. A run reaches the boss around level 7, `
    + `which is a sword hitting for ${swordAt(7)} rather than ${swordAt(1)} and a bar of 90 health rather than 60. `
    + "Experience buys nothing else and cannot be spent.",
  "- The reward screen: clearing a room shows three cards and the player keeps one. The other two are "
    + "discarded. A door that promised gold pays a purse instead and shows no cards.",
  "- Tension: how hard a combat room is pitched. A release is a recovery room, a build keeps the run "
    + "moving, a peak is the hardest the run currently allows. A peak does not follow a peak, and the run's "
    + "pacing cap says how high the pitch may go right now.",
].join("\n");

/* ------------------------------------------------------------------- body */

export function briefing(input: BriefingInput): string {
  return [
    THE_GAME,
    section("The player", playerLines(input.player)),
    section("The build", buildLines(input.build)),
    ...maybe("What the last fights measured", observedLines(input.observed)),
    ...maybe("What the doors have been doing", offerLines(input.offers)),
    section("The run so far", runLines(input.rooms, input.now.maxHealth)),
    ...maybe("The bodies met so far", enemyLines(input.rooms)),
    ...maybe("This room, as round 1 decided it", input.room ? roomLines(input.room) : []),
    ...maybe("The cards this offer is choosing from", cardLines(input.cards, input.build.keys)),
    section("Right now", nowLines(input.now, input.rooms)),
    section("What is ahead", aheadLines(input.now)),
    section("Deciding in this request", input.now.deciding.map((d) => `- ${d}`)),
  ].join("\n\n");
}

/* ------------------------------------------------------------------ parts */

function playerLines(p: BriefingPlayer): string[] {
  const out = [`- Style: ${p.style}${p.stylePreset ? ` (${p.stylePreset})` : ""}`];
  if (p.styleMeans) out.push(`  - What the spells tagged with that style do: ${p.styleMeans}`);
  if (p.ownWords?.trim()) {
    out.push("- In their own words, typed before the run:");
    out.push(`  - "${p.ownWords.trim()}"`);
    /*
     * **A keyword read that found nothing says nothing.** It used to print
     * "names no affix lane in particular", which reads as the game's verdict
     * on the words — that they ask for nothing — when all it means is that no
     * English keyword matched: every sentence typed in Chinese or Japanese got
     * it, and the words themselves were left standing under a line
     * discounting them.
     */
    if (p.ownWordsLane) {
      out.push(`  - A keyword read of those words names the ${p.ownWordsLane} affix lane`);
      if (p.ownWordsLaneMeans) out.push(`  - That lane is: ${p.ownWordsLaneMeans}`);
    }
  } else {
    out.push("- In their own words: they typed nothing");
  }
  return out;
}

/**
 * **What a spell does, from its own numbers.**
 *
 * The item table's `description` is written for a designer choosing what to
 * build next: "at the lowest mana cost in the attack pool", "suits a spam
 * build". Those are verdicts about the pool, and a Director that reads them
 * is being told the answer to the question it is being asked. The parameters
 * are the spell, so the behaviour is written from them.
 */
export function spellBehaviour(item: BaseItem | undefined, level = 1): string {
  if (!item) return "no behaviour recorded";
  const p = item.params as Record<string, unknown>;
  const num = (k: string): number | null => (typeof p[k] === "number" ? (p[k] as number) : null);
  const str = (k: string): string | null => (typeof p[k] === "string" ? (p[k] as string) : null);
  const damage = (num("damage") ?? 0) * levelDamageMult(level);
  const count = num("count") ?? 1;
  const shape = str("shape") ?? "bolt";
  const bits: string[] = [];
  switch (shape) {
    case "orbit":
      if ((num("anchor_reach") ?? 0) > 0)
        bits.push(`${count} blades spin in place on the floor ${num("anchor_reach")} px ahead, or under the body it seeks, for ${num("lifetime") ?? 0} s`,
          `${round1(damage)} damage a pass`, "the ring stays where it was set when the player moves");
      else if ((num("stack_max") ?? 0) > 0)
        bits.push(`each cast adds ${count === 1 ? "a blade" : `${count} blades`} to a ring orbiting the player and renews the ring for ${num("lifetime") ?? 0} s, up to ${num("stack_max")} blades`,
          `${round1(damage)} damage a pass`);
      else bits.push(`${count} blades orbit the player for ${num("lifetime") ?? 0} s`, `${round1(damage)} damage a pass`);
      break;
    case "beam":
      bits.push(`held: while the key stays down, for up to ${num("lifetime") ?? 0} s, a line runs ${num("reach") ?? 0} px along the aim to the first wall`,
        `${round1(damage)} damage every ${num("tick_ms") ?? 0} ms to each body across it`,
        "the cost is paid once, at the press", "the player moves slowly while it is held, and a dash ends it");
      break;
    case "field":
      bits.push(str("element") === "poison"
        ? `a cloud of poison on the ground for ${num("lifetime") ?? 0} s that poisons and slows what stands in it`
        : str("element") === "ice"
          ? `frost on the ground for ${num("lifetime") ?? 0} s that slows what stands in it and chills it toward a freeze`
          : `a patch of ground burns for ${num("lifetime") ?? 0} s`, `${round1(damage)} damage a tick`);
      break;
    case "orb":
      bits.push((num("speed") ?? 0) > 0 ? `a slow orb drifts from the player for ${num("lifetime") ?? 0} s`
        : `an orb set down beside the player stands for ${num("lifetime") ?? 0} s`,
        `strikes the nearest body within ${num("zap_reach") ?? 0} px every ${num("zap_ms") ?? 0} ms for ${round1(damage)} damage`,
        "no damage on contact",
        `up to ${num("max_alive") ?? 1} from the key at once, a new one replacing the oldest`);
      break;
    case "boomerang":
      bits.push(`a blade thrown ${num("reach") ?? 0} px ahead that turns and returns to where the player is`,
        `${round1(damage)} damage to each body once on the way out and once on the way back`);
      break;
    case "trail":
      bits.push(`for ${round1((num("trail_ms") ?? 0) / 1000)} s a patch of ${str("element") === "poison" ? "poison" : "burning"} ground every ${num("drop_px") ?? 0} px the player travels`,
        "nothing while the player stands still",
        `${round1(damage)} damage a tick to what stands in it, never to the player`);
      break;
    case "enchant":
      bits.push(`for ${round1((num("enchant_ms") ?? 0) / 1000)} s every sword swing, hit or miss, also throws a wave ${num("wave_reach") ?? 0} px ahead`,
        `${round1(damage)} damage to each body the wave passes through`, "the sword's own damage is unchanged");
      break;
    case "stance":
      bits.push(`a guard for ${num("stance_ms") ?? 0} ms in which the player is slowed and cannot swing`,
        `the first enemy hit that would land is cancelled and answered with ${round1(damage)} damage to every body within ${num("answer_radius") ?? 0} px, staggering`,
        `with no hit taken it answers at ${Math.round((num("expire_share") ?? 0) * 100)}% as it ends`,
        "a dash ends the guard early and it answers as if it had run out");
      break;
    case "dash":
      if ((num("land") ?? 0) > 0)
        bits.push("the player leaps at the body it seeks, untouchable in the air", "cuts nothing on the way",
          `lands in a ring of broken ground for ${round1(damage)} damage`);
      else bits.push("the player dashes forward through the bodies in the way, untouchable for the travel",
        `${round1(damage)} damage to each body passed through, once`);
      break;
    case "vortex":
      bits.push(`a pull that drags bodies in for ${num("lifetime") ?? 0} s`, `${round1(damage)} damage a tick`);
      if ((num("collapse_damage") ?? 0) > 0)
        bits.push(`implodes as it ends for ${round1((num("collapse_damage") ?? 0) * levelDamageMult(level))} damage on every body still inside`);
      break;
    case "summon":
      bits.push(`a companion that follows the player for ${num("lifetime") ?? 0} s`,
        `shoots the nearest body within ${num("reach") ?? 0} px every ${round1(num("interval") ?? 0)} s for ${round1(damage)} damage`,
        "a recast renews it rather than adding a second");
      break;
    case "pillar":
      bits.push(`a pillar rises between the player and what they face and stands for ${num("lifetime") ?? 0} s, blocking bodies and shots`,
        `${round1(damage)} damage and a shove to what stands beside it as it rises`);
      break;
    case "eruption":
      if (str("pattern") === "ring")
        bits.push(`${count} rings of eruptions out from the player, one after another`, `${round1(damage)} damage to each body once`);
      else if (count === 1) bits.push("one eruption from the floor under the body it seeks", `${round1(damage)} damage`);
      else bits.push(`${count} eruptions from the floor in a ${str("pattern") ?? "line"}`, `${round1(damage)} damage each`);
      bits.push(`${num("windup_ms") ?? 0} ms of windup before the first`);
      if ((num("burn_ms") ?? 0) > 0)
        bits.push(`the floor under each keeps burning for ${round1((num("burn_ms") ?? 0) / 1000)} s`);
      if ((num("telegraph_ms") ?? 0) > 0)
        bits.push(`the ground is marked ${num("telegraph_ms")} ms before it goes off, and a body can walk out of the mark`);
      break;
    default:
      if ((num("lob") ?? 0) > 0) {
        bits.push(`a shell lobbed in an arc over bodies and walls to the body it seeks, landing after ${round1((num("lob") ?? 0) * 1000)} ms`,
          `${round1(damage)} damage to every body within ${num("lob_radius") ?? 0} px of where it lands`,
          "touches nothing on the way, and a body can walk out from under it");
        break;
      }
      bits.push(
        count > 1 ? `${count} projectiles in a ${num("spread") ?? 0}° spread` : "one projectile",
        `${round1(damage)} damage${count > 1 ? " each" : ""}`,
      );
  }
  /*
   * Doc 006's bolt options, each as what it does and no more: what the key
   * does when held or rested, and what the hit leaves behind.
   */
  const charges = num("charges") ?? 0;
  if (charges > 0)
    bits.push(`banks one shot every ${num("charge_ms") ?? 0} ms while the key is not pressed, up to ${charges} shots`,
      "a press fires every banked shot at once");
  const charge = num("charge") ?? 0;
  if (charge > 0)
    bits.push(`holding the key charges it for up to ${charge} ms with the player slowed`,
      "releasing fires it, from a quarter of the shot at a tap to the whole at a full charge",
      "mana is paid on release, and a dash cancels the charge for nothing");
  const doom = num("doom") ?? 0;
  if (doom > 0)
    bits.push(`marks the body it hits; ${doom} ms later the mark bursts for ${round1((num("doom_damage") ?? 0) * levelDamageMult(level))} damage round it`,
      "a marked body cannot be marked again until the mark bursts");
  const emit = num("emit") ?? 0;
  if (emit > 0)
    bits.push(`throws a shard every ${num("emit_ms") ?? 0} ms as it flies and bursts into ${emit} shards at the end`);
  const contagion = num("contagion") ?? 0;
  if (contagion > 0)
    bits.push(`when a body it poisoned dies, the poison jumps to up to ${contagion} bodies nearby, which carry it on`);
  const chain = num("chain");
  if (chain) bits.push(`chains to ${chain} more ${chain === 1 ? "body" : "bodies"}, each jump doing less damage`);
  const pierce = num("pierce") ?? 0;
  if (pierce >= 99) bits.push("passes through everything in its path");
  else if (pierce > 0) bits.push(`passes through ${pierce} ${pierce === 1 ? "body" : "bodies"}`);
  const seek = num("seek") ?? 0;
  if (seek >= 400) bits.push("steers hard onto a target");
  else if (seek > 0) bits.push("steers gently onto a target");
  const element = str("element");
  if (element && element !== "none") bits.push(`builds ${element} on what it hits`);
  const cooldown = num("cooldown_scale");
  if (cooldown && cooldown > 1) bits.push(`${Math.round((cooldown - 1) * 100)}% longer to come back than its cost implies`);
  return bits.join(", ") + ".";
}

function buildLines(b: BriefingBuild): string[] {
  const out: string[] = [];
  b.keys.forEach((key, i) => {
    if (!key) { out.push(`- Key ${i + 1}: empty`); return; }
    const item = ITEMS.get(key.base);
    const element = typeof item?.params["element"] === "string" && item.params["element"] !== "none"
      ? `${String(item.params["element"])} element` : "no element";
    const free = AFFIX_SLOTS - key.affixes.length;
    const cost = keyCost(key, ITEMS);
    out.push(`- Key ${i + 1}: ${phrases(
      nameOf(key.base),
      `level ${key.level} of ${SPELL_LEVEL_MAX}`,
      `${schoolOf(key.base) ?? "no"} school`,
      element,
      `${Math.round(cost)} mana a cast (a bar of ${Math.round(b.manaMax)} buys ${castsPerBar(b.manaMax, cost)})`,
      free > 0 ? `${free} of ${AFFIX_SLOTS} affix slots free` : "no affix slot free",
    )}`);
    out.push(`  - Does: ${spellBehaviour(item, key.level)}`);
    for (const a of key.affixes) {
      const def = spellAffixById(a.id);
      const strength = def?.minStrength ?? 1;
      out.push(`  - ${def?.name ?? nameOf(a.id)}, strength ${strength} of 3${def?.text ? `: ${def.text}` : ""}`);
    }
  });
  const costs = b.keys.flatMap((k) => (k ? [keyCost(k, ITEMS)] : []));
  const mean = costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : 0;
  out.push(`- Mana: ${phrases(
    `a bar of ${Math.round(b.manaMax)}, full at the start of every room`,
    mean > 0 ? `the keys average ${Math.round(mean)} a cast, so a full bar buys about ${castsPerBar(b.manaMax, mean)}` : null,
    `a connecting sword hit returns ${Math.round(b.manaMax * MANA_PER_HIT_FRACTION)}`,
    b.presses
      ? `${b.refusedForMana ?? 0} of ${b.presses} presses refused for mana in the last two fights`
      : null,
  )}`);
  out.push(`- Stats taken: ${b.statsTaken.length ? countedStats(b.statsTaken) : "none"}`);
  if (b.affixSlotsOpen) {
    const total = b.keys.filter(Boolean).length * AFFIX_SLOTS;
    const open = b.keys.reduce((n, k) => n + (k ? AFFIX_SLOTS - k.affixes.length : 0), 0);
    out.push(`- Affix slots across the staff: ${open} of ${total} open (${b.affixSlotsOpen})`);
  }
  if (b.spellLevels) out.push(`- Spell levels: ${LEVELS_WORD[b.spellLevels] ?? b.spellLevels}`);
  if (b.heldElements) out.push(`- Elements the keys carry between them: ${ELEMENTS_WORD[b.heldElements] ?? b.heldElements}`);
  const schools = [...new Set(b.keys.flatMap((k) => (k ? [schoolOf(k.base)] : [])).flatMap((s) => (s ? [s] : [])))];
  out.push(`- Schools the player can cast: ${schools.length ? schools.join(", ") : "none"}`);
  if (b.dominantTags?.length) out.push(`- Tags the cards taken so far lean toward: ${b.dominantTags.join(", ")}`);
  if (b.buildShape) out.push(`- How filled in the build is: ${SHAPE_WORD[b.buildShape] ?? b.buildShape}`);
  return out;
}

const LEVELS_WORD: Readonly<Record<string, string>> = {
  all_base: "all keys at level 1; none raised",
  some_raised: "some keys raised above level 1, some not",
  mostly_raised: "all keys held raised above level 1",
};
const ELEMENTS_WORD: Readonly<Record<string, string>> = {
  none: "none: nothing the player casts builds a status",
  one: "one",
  several: "several",
};
const SHAPE_WORD: Readonly<Record<string, string>> = {
  raw: "raw: one or more keys are empty",
  forming: "forming: the keys are full and largely bare",
  formed: "formed: nothing left to fill, so a card raises what is there",
};

/**
 * The observed facts as sentences. Each names the quantity, the figure where
 * the caller measured one, and the bucket the game reads it as — so Jev can
 * use either and neither is a verdict.
 */
function observedLines(o: BriefingObserved | undefined): string[] {
  if (!o) return [];
  if (o.measured === false)
    return [
      "- Nothing yet: no fight has been played this run, so none of the figures below has been taken.",
      "- Not measured: damage dealt, bodies struck per shot, casting rate, the sword's share, time short "
        + "of mana, casts refused, what has been taking health, clear speed, health lost, time under fire.",
    ];
  const out: string[] = [];
  const line = (what: string, value: string | null | undefined) => { if (value) out.push(`- ${what}: ${value}`); };
  line("Damage the player deals",
    o.damage_rate ? `${o.damagePerSecond === undefined ? "" : `${Math.round(o.damagePerSecond)} a second, `}reads as ${o.damage_rate}` : null);
  line("Bodies struck per shot fired",
    o.hits_per_shot ? `${o.bodiesPerShot === undefined ? "" : `${o.bodiesPerShot.toFixed(1)}, `}reads as ${o.hits_per_shot}` : null);
  line("Casting rate",
    o.cast_rate ? `${o.castsPerMinute === undefined ? "" : `about ${Math.round(o.castsPerMinute)} casts a minute, `}reads as ${o.cast_rate}` : null);
  line("Share of the damage the sword did",
    o.sword_share ? `${o.swordShare === undefined ? "" : `${pct(o.swordShare)}, `}reads as ${o.sword_share}` : null);
  line("Time the bar spent under the cheapest key's cost", o.mana_short_time ? `${o.mana_short_time}` : null);
  line("Casts the bar refused for want of mana", o.mana_refused ? `${o.mana_refused}` : null);
  line("What took the most health", o.hurt_by ? (o.hurt_by === "nothing" ? "nothing: no health lost" : hurtWords(o.hurt_by)) : null);
  line("Clear speed against what this player usually takes", o.clear_speed ?? null);
  line("Health lost over the last two rooms", o.recent_damage ?? null);
  line("Time spent with an enemy bullet close", o.movement_pressure_recent ?? null);
  if (out.length === 0) return [];
  return out;
}

/**
 * **The badges, counted — and counted flatly.**
 *
 * This printed thresholds first ("on every one of the last three"), then
 * streaks and leaders: which badge had been on the last N offers running,
 * which the player walked through most, which they were offered most and took
 * least. A controlled test took those apart (finding 5a): the *facts* are
 * inert — "Doors taken in the last 4 rooms: spell 2, stat 2" leaves the affix
 * option exactly where it was, at 3% — while the *phrasing* is not. "The
 * player walked past the affix door every time" took affix to 32%, and
 * "chose the spell or stat door every time, never the affix door" to 44%,
 * for the same four rooms. Jev reads a sentence that dwells on an option as a
 * sentence arguing for it, whichever way the behaviour ran.
 *
 * So what is left is the counts, with nothing said about them. Which badge is
 * overdue and which has been shown too often are sequence properties, and
 * those are code's: `DOOR_STREAK_CAP` and `GOLD_FLOOR_ROOMS`.
 */
function offerLines(f: BriefingOffers | undefined): string[] {
  if (!f) return [];
  const out: string[] = [];
  const offered = f.doorsOffered ?? [];
  const taken = f.doorsTaken ?? [];
  const kinds = ["spell", "affix", "stat", "gold"] as const;
  if (offered.length > 0) {
    out.push(`- Doors offered, ${offered.length} ${offered.length === 1 ? "offer" : "offers"} so far: ${
      kinds.map((k) => `${k} ${offered.filter((room) => room.includes(k)).length}`).join(", ")}`);
    out.push(`- Doors taken: ${kinds.map((k) => `${k} ${taken.filter((t) => t === k).length}`).join(", ")}`);
  } else {
    out.push("- Doors offered so far: 0");
  }
  if (f.keptLast && f.statedStyle) {
    /*
     * **The cards, then the count.** Two plain lines: what was kept, each with
     * the tags the count is taken over, and how many of them carry the stated
     * style. No sentence about what that means — whether the player is
     * following their style or leaving it is the Director's reading.
     */
    const kept = f.keptLast;
    if (kept.length === 0) out.push("- Cards kept so far: none");
    else {
      out.push(`- Last ${kept.length === 1 ? "card" : `${kept.length} cards`} kept, oldest first: ${kept.map((c) =>
        `${c.name} (${c.tags.length ? `tagged ${c.tags.join(", ")}` : "no style tag"})`).join("; ")}`);
      /*
       * Counted as **off** the style, which is the quantity the question and
       * its options name: printed as "tagged with it: 0 of 3", a classifier
       * that does no arithmetic had to turn the count round before any option
       * could be matched against it (finding 7), and in a pilot of 22 offers
       * it answered `low` at 0.9 with every card kept off the style.
       */
      const off = (cs: typeof kept) => cs.filter((c) => !c.tags.includes(f.statedStyle!)).length;
      out.push(`- Of those, off the stated style: ${off(kept)} of ${kept.length}${
        kept.length > 2 ? `; of the newest two: ${off(kept.slice(-2))}` : ""}`);
    }
  } else if (f.offStylePicks) {
    out.push(`- Picks off the stated style, of the last three: ${OFF_STYLE_COUNT[f.offStylePicks] ?? f.offStylePicks}`);
  }
  if (f.keysLean) out.push(`- Which way the keys lean, by their tags: ${f.keysLean}`);
  return out;
}

/** The off-style bucket as the count it stands for; see `offerLines`. */
const OFF_STYLE_COUNT: Readonly<Record<string, string>> = {
  none: "0", one: "1", two_running: "2",
};

/** How many entries at the end of a list satisfy a test, counting back. */
function trailingRun<T>(xs: readonly T[], holds: (x: T) => boolean): number {
  let n = 0;
  for (let i = xs.length - 1; i >= 0 && holds(xs[i]!); i--) n++;
  return n;
}

function runLines(rooms: readonly RunJournalEntry[], maxHealth: number): string[] {
  if (rooms.length === 0)
    return [
      "- No room has been played yet: this is the first, and nothing about this player has been measured.",
      "- Nothing has been offered, taken or passed over; no damage has been taken and none avoided.",
    ];
  const out: string[] = [];
  const recent = rooms.slice(-BRIEFING_RECENT_ROOMS);
  const earlier = rooms.slice(0, rooms.length - recent.length);
  if (earlier.length) {
    const first = earlier[0]!.index, last = earlier[earlier.length - 1]!.index;
    const lost = earlier.reduce((s, r) => s + (r.health_lost ?? 0), 0);
    const doors = counted(earlier.flatMap((r) => (r.door_taken ? [r.door_taken] : [])));
    const picks = counted(earlier.flatMap((r) => (r.picked ?? []).map(nameOf)));
    out.push(`- ${first === last ? `Room ${first}` : `Rooms ${first}–${last}`}, rolled up: ${phrases(
      counted(earlier.map((r) => r.type)),
      `lost ${Math.round(lost)} of ${maxHealth} health in all`,
      doors ? `doors taken ${doors}` : null,
      picks ? `cards kept ${picks}` : null,
    )}`);
    const promised = promisesRolledUp(earlier);
    if (promised) out.push(`  - ${promised}`);
  }
  const lastTwo = new Set(rooms.slice(-BRIEFING_PASSED_OVER_ROOMS).map((r) => r.index));
  for (const r of recent) {
    const went = phrases(
      r.health_lost === undefined ? null : `lost ${hpWords(r.health_lost, maxHealth)}`,
      r.seconds === undefined ? null
        : `in ${Math.round(r.seconds)} s${r.expected_seconds === undefined ? "" : `, about ${Math.round(r.expected_seconds)} s is usual here`}`,
      r.hurt_by && (r.health_lost ?? 0) > 0
        ? `mostly to ${hurtWords(r.hurt_by)}${r.hurt_most_by ? ` (${r.hurt_most_by} most of all)` : ""}` : null,
    );
    out.push(`- Room ${r.index}: ${phrases(
      r.type,
      r.tension ?? null,
      // Past rooms get the space's name only: the archetype's sentence is a
      // paragraph a room, and what the alternation needs is the name.
      r.space ? `${r.size ? `${r.size} ` : ""}${r.space.replace(/_/g, " ")}` : null,
      r.symmetry ?? null,
      r.mood ? `${r.mood.temperature}, ${r.mood.brightness}, ${r.mood.particle_intensity}` : null,
    )}${went ? `; ${went}` : ""}`);
    if (r.encounter) out.push(`  - ${fightWords(r.encounter, r.enemies ?? [])}`);
    const chose = phrases(
      r.doors?.length ? `doors out ${r.doors.map(doorWords).join(", ")}`
        : r.doors_offered?.length ? `doors out ${r.doors_offered.join(", ")}` : null,
      r.door_taken ? `took ${r.door_taken}` : null,
      r.took_gold_instead ? "the reward was a purse, not cards" : null,
      r.picked?.length ? `kept ${r.picked.map(nameOf).join(", ")}` : null,
      lastTwo.has(r.index) && r.passed_over?.length ? `passed over ${r.passed_over.map(nameOf).join(", ")}` : null,
    );
    if (chose) out.push(`  - ${chose}`);
  }
  const taken = rooms.flatMap((r) => (r.door_taken ? [r.door_taken] : []));
  if (taken.length) out.push(`- Doors taken so far: ${counted(taken)}`);
  /*
   * **What the run has been pitching**, as the series and as a count.
   *
   * Each room's line already carries its own pitch, eleventh in a comma list
   * of twelve. Measured, that was not enough to be read as a sequence: on the
   * briefing arm `release` was all but unreachable and room 3 came back `peak`
   * in nearly every run. Neither is a fact the state was missing — it is a
   * fact the state was making Jev assemble out of five lines. Code assembles
   * it: the series, and how long since the run last let up.
   */
  const fights = rooms.filter((r) => r.tension);
  if (fights.length)
    out.push(`- Pitch of each fight so far, oldest first: ${fights.map((r) => r.tension).join(", ")}`);
  out.push(`- Fights since the run last let up (a release room, or a room with no fight in it): ${
    trailingRun(rooms, (r) => r.tension !== undefined && r.tension !== "release")}`);
  /*
   * **The look of the rooms, as a run of rooms.**
   *
   * It is in each room's line as three words among eleven others. Measured,
   * that was not enough: on the briefing arm `mood_brightness` came back
   * `bright` in 97% of rooms and `mood_particles` `calm` in 95%, against 50%
   * and 74% on the label arm, where the previous room's answer arrives as its
   * own field. The fact, not the verdict: how many rooms running each part of
   * the look has been the same.
   */
  /*
   * **One line each, not one line of four clauses.**
   *
   * They were a single comma list — "mirrored layout, warm light, dim, busy
   * particles" — which meant each look question read one clause of it and
   * ignored three, and each question's example had to quote all four to be a
   * line the briefing prints. Three quarters of every such example was a
   * specific value of a field the question does not answer, which is the
   * overfitting an example is supposed to avoid. Split, each question's one
   * fact is its own line and its example is that line.
   */
  const last = rooms.at(-1);
  if (last?.symmetry) out.push(`- ${LAST_LOOK.layout}${last.symmetry}`);
  if (last?.mood) {
    out.push(`- ${LAST_LOOK.light}${last.mood.temperature}`);
    out.push(`- ${LAST_LOOK.brightness}${last.mood.brightness}`);
    out.push(`- ${LAST_LOOK.particles}${last.mood.particle_intensity}`);
  }
  /*
   * **And nothing about how long the look has held.**
   *
   * There was a second line here counting the trailing run of each part of
   * the look — "cold light for the last 4 rooms, dim for the last 3". It is
   * the same shape of sentence finding 5a measured on the doors: a count
   * dressed as a narrative about one option, and it argues for the option it
   * names as surely as the door version did. The alternation the look
   * questions want is a sequence property, so the *intent* is in their
   * instructions and the *mechanism* is a code penalty on repeating this
   * line's answer (`LOOK_REPEAT_PENALTY`). The state says what the last room
   * looked like and stops there.
   */
  return out;
}

/**
 * **A room's fight as it was built**, in the words its questions answer in:
 * the roster, how many, how the waves came, where from, what anchored it,
 * which variant bodies it showed and how many it hid enraged. Read off the
 * assembled encounter, not off the answers that asked for it — the ramp and
 * the commit check can each step in between.
 */
function fightWords(e: EncounterProfile, enemies: readonly string[]): string {
  const variants = enemies.filter((id) => enemyNote(id) !== "");
  return `fight as built: ${[
    `${e.composition.replace(/_/g, " ")} roster`,
    `density ${e.density}`,
    `${e.wave_structure} waves`,
    `entering ${ENTRY_WORDS[e.entry] ?? e.entry.replace(/_/g, " ")}`,
    e.anchor === "none" ? "no anchor" : `anchored by a ${e.anchor}`,
    variants.length ? `variants ${variants.join(" and ")}` : "no variants",
    e.elite_presence && e.elite_presence !== "none" ? `${e.elite_presence} enraged` : "none enraged",
  ].join(", ")}`;
}

const ENTRY_WORDS: Readonly<Record<string, string>> = {
  flanks: "from the flanks", far_front: "from the far side", surround: "from all around",
};

/**
 * A door and what was behind it: "spell (storm, void)", "stat (movement;
 * elite, grade 2)" — every school or family among the door's cards, in the
 * Director's order (`cardTypesOf`), not a promise the cards were held to.
 */
function doorWords(d: JournalDoor): string {
  const types = d.schools ?? d.families ?? [];
  const marks = [d.elite ? "elite" : null, d.grade && d.grade > 1 ? `grade ${d.grade}` : null].filter(Boolean);
  const inside = [types.length ? types.join(", ") : null, marks.length ? marks.join(", ") : null].filter(Boolean);
  return `${d.kind}${inside.length ? ` (${inside.join("; ")})` : ""}`;
}

/**
 * What the rolled-up rooms' doors held, tallied: the recent rooms' lines
 * carry each door, and without this the run's first spell doors drop out of
 * the briefing as soon as they are more than five rooms old.
 */
function promisesRolledUp(rooms: readonly RunJournalEntry[]): string | null {
  const doors = rooms.flatMap((r) => r.doors ?? []);
  const schools = doors.flatMap((d) => (d.kind === "spell" ? d.schools ?? [] : []));
  const families = doors.flatMap((d) => (d.kind === "stat" ? d.families ?? [] : []));
  const elite = doors.filter((d) => d.elite).map((d) => d.kind);
  if (doors.length === 0) return null;
  return [
    schools.length ? `spell doors held ${counted(schools)}` : null,
    families.length ? `stat doors held ${counted(families)}` : null,
    elite.length ? `elite doors: ${counted(elite)}` : "no elite doors",
  ].filter(Boolean).join("; ");
}

/**
 * Which bodies the run has actually met, and which of them cost the most
 * health. Nothing here is a verdict: it is a tally of what appeared and a
 * tally of what hurt.
 */
function enemyLines(rooms: readonly RunJournalEntry[]): string[] {
  const met = new Map<string, number>();
  const hurt = new Map<string, number>();
  for (const r of rooms) {
    for (const id of r.enemies ?? []) met.set(id, (met.get(id) ?? 0) + 1);
    if (r.hurt_most_by && (r.health_lost ?? 0) > 0)
      hurt.set(r.hurt_most_by, (hurt.get(r.hurt_most_by) ?? 0) + (r.health_lost ?? 0));
  }
  if (met.size === 0 && hurt.size === 0) return [];
  const out: string[] = [];
  if (met.size)
    out.push(`- Met so far: ${[...met].sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${id}${n > 1 ? ` in ${n} rooms` : ""}${enemyNote(id)}`).join(", ")}`);
  /*
   * Named by the **cause**, which for a blade is the body swinging it and for
   * a shot is the bullet family — `burst`, `lob` — rather than whatever fired
   * it. A list of bodies with two bodies in it that do not exist is what this
   * reads as if the line does not say so.
   */
  if (hurt.size)
    out.push(`- Health lost by cause, as a body that swung or a kind of shot that landed: `
      + `${[...hurt].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([id, n]) => `${id} ${Math.round(n)}`).join(", ")}`);
  const close = rooms.filter((r) => r.health_low !== undefined && r.health_low <= HP_PER_HEART);
  out.push(`- Rooms where the bar dropped to one heart or less: ${
    close.length ? close.map((r) => `room ${r.index}`).join(", ") : "none"}`);
  /*
   * **And no count of how much of the run has been ordinary bodies.**
   *
   * `subspecies_weight`'s instruction used to ask it to answer partly from how
   * many rooms have been plain already, and the state did not say, so two
   * lines were added here: the tally of fights with a variant body in them,
   * and the fights since the last one. Measured over eight seeds they moved
   * the question from `none` 66% to `none` 90%, and rephrasing the tally
   * two-sidedly took it to 100% — the fact can only ever say "this run has
   * been plain", and a count that is only about one option reads as a case for
   * it whichever way round it is written (finding 5a, finding 26). Both lines
   * are gone and the instruction no longer names them; the rate this question
   * is really about is a sequence property, which is code's.
   */
  return out;
}

/** One clause about a body, from the enemy table, for a name Jev has not seen. */
function enemyNote(id: string): string {
  try {
    const def = enemy(id as Parameters<typeof enemy>[0]);
    const base = (def as { base?: string }).base;
    return base ? ` (a variant of ${base})` : "";
  } catch { return ""; }
}

function roomLines(r: BriefingRoomNow): string[] {
  return [
    `- Space: ${spaceWords(r.space)}`,
    `- Size: ${r.size}`,
    `- Layout: ${r.symmetry}`,
    `- Look: ${r.mood.temperature}, ${r.mood.brightness}, ${r.mood.particle_intensity} particles`,
    `- Floor, as built: ${r.openness} to move on, ${r.cover} cover`,
    `- Zone slots waiting to be filled: ${r.zones.length ? r.zones.join(", ") : "none"}`,
    `- Places enemies can arrive from: ${r.spawnGroups.length ? r.spawnGroups.join(", ") : "none"}`,
    `- Hazards this room may hold: ${r.hazardCap}`,
    `- Pitch decided for this room: ${r.tension}`,
    `- Rounds of fighting this room plays: ${r.waves}`,
    `- Bodies this room may hold over its whole fight: ${r.bodyCap}`,
    `- Bodies that stand on the floor at once in this room: at most ${r.aliveCap}`,
  ];
}

/**
 * The candidates, by the facts the offer machinery attached to them — which
 * is what the pity, promise and guarantee mechanics act on. Their behaviour is
 * on the options themselves, so it is not repeated here: one voice a spell.
 */
function cardLines(
  pools: readonly BriefingCardPool[] | undefined, keys: readonly (HeldKey | null)[] = [],
): string[] {
  if (!pools?.length) return [];
  const out: string[] = [];
  for (const pool of pools) {
    out.push(`- ${pool.where ? `${pool.where}, ` : ""}${pool.kind} cards; each candidate's own behaviour is on its option below`);
    if (pool.kind === "affix" && pool.candidates.some((c) => c.compatibleHeldSpellIds))
      for (const key of keys) {
        if (!key) continue;
        const fits = pool.candidates.filter((c) => c.compatibleHeldSpellIds?.includes(key.base));
        out.push(`  - ${nameOf(key.base)} can take these affixes from this offer: ${fits.length
          ? fits.map((c) => nameOf(c.id)).join(", ") : "none"}`);
      }
    /*
     * **Where a spell card goes**, said once for the pool rather than on
     * every option. The build section lists the empty keys and the flags below
     * mark the copies, and nothing joined the two: that a copy raises a level
     * and leaves the empty keys as they are, while a new spell fills one, is
     * the difference between the two sorts of card on an early screen
     * (jev-findings 29). Only where a key is empty, which is the only case in
     * which the two sorts do different things to the staff.
     */
    const empty = keys.flatMap((k, i) => (k === null ? [i + 1] : []));
    if (pool.kind === "spell" && empty.length) {
      const held = keys.flatMap((k, i) => (k ? [`${nameOf(k.base)} on key ${i + 1}`] : []));
      out.push(`  - Keys empty now: ${empty.join(" and ")}. A new spell taken from this offer goes on key ${empty[0]}`
        + `${held.length ? `; a copy of a held spell (${held.join(", ")}) raises that key's level and leaves `
          + `${empty.length === 1 ? `key ${empty[0]}` : `keys ${empty.join(" and ")}`} empty` : ""}`);
    }
    const flagged = pool.candidates.filter((c) => c.facts.some((f) => NOTABLE.has(f)));
    if (flagged.length)
      for (const c of flagged)
        out.push(`  - ${nameOf(c.id)}: ${c.facts.filter((f) => NOTABLE.has(f)).map(factWords).join(", ")}`);
    else out.push("  - Nothing in this pool is tagged on style, need, element or promise");
    if (pool.pity)
      out.push("  - A pity card is armed: if nothing tagged as answering a need is drawn, code will add the one the blend ranks first");
    if (pool.temptation)
      out.push("  - A temptation card is armed: one slot will go to a card outside the stated style");
    if (pool.guarantee?.length)
      out.push(`  - One of each is guaranteed, across ${pool.guarantee.length} group${pool.guarantee.length === 1 ? "" : "s"}: the last slot the `
        + "Director draws will be given to a group with nothing in the offer yet, so the top picks stand "
        + `and only the tail moves. Groups: ${pool.guarantee.map(group).join("; ")}`);
  }
  return out;
}

/**
 * A guarantee group, named. A spell offer to a full staff splits the pool into
 * "copies of what is held" and "everything else", and the second of those is
 * the whole pool minus three — twenty-seven names on one line, for a group
 * whose membership the reader can infer from the first.
 */
const GROUP_NAMES_SHOWN = 6;
function group(ids: readonly string[]): string {
  if (ids.length <= GROUP_NAMES_SHOWN) return ids.map(nameOf).join(" / ");
  return `${ids.slice(0, GROUP_NAMES_SHOWN).map(nameOf).join(" / ")} and ${ids.length - GROUP_NAMES_SHOWN} others`;
}

/**
 * **The card facts, as facts rather than as verdicts.**
 *
 * These were code's own classifications written out as judgements — "covers a
 * role nothing on the staff covers", "answers what the last fights were
 * shortest of", "on the style the player stated" — which is the answer to the
 * card question printed beside the card (finding 11, and the reason the item
 * table's designer prose was taken out of the options in the first place).
 * Each now names the *thing matched* and leaves the matching to Jev: the
 * build section already writes out the stated style, the tags the picks lean
 * toward, the health bar and the elements the keys carry, so every one of
 * these is a pointer into a fact the reader has.
 *
 * `promised` and `upgrade` were never verdicts and are unchanged in substance.
 */
const FACT_WORDS: Readonly<Record<string, string>> = {
  style: "tagged with the stated style",
  build: "tagged with a tag the picks lean toward",
  need: "a Ward or Retort affix or a survival stat, offered while health is low",
  eases: "tagged for what the last fights measured short: shots landing, the bar, the cast rate or the damage",
  synergy: "carries an element the keys carry",
  upgrade: "a copy of a spell on the staff, which raises its level and fills no key",
  promised: "the school or family the door's badge names",
};
const factWords = (f: string) => FACT_WORDS[f] ?? f;

/**
 * Facts worth printing. `build` lands on much of a pool much of the time — it
 * asks whether a card shares a tag with the player's picks — so a line that
 * reported it named nearly every candidate and said nothing. It stays in the
 * vocabulary above, because a card whose *sole* fact is `build` is worth
 * distinguishing from one with none, but it does not on its own earn a
 * candidate a place on the line.
 */
const NOTABLE: ReadonlySet<string> = new Set(["style", "need", "eases", "synergy", "upgrade", "promised"]);

function nowLines(n: BriefingNow, rooms: readonly RunJournalEntry[]): string[] {
  const hearts = n.maxHealth / HP_PER_HEART;
  const lost = n.maxHealth - n.health;
  const typical = typicalHealthLostBy(n.roomIndex);
  const out = [
    `- Health: ${Math.round(n.health)} of ${n.maxHealth}, which is ${heartWords(n.health, n.maxHealth)}`,
    `- Health lost so far: ${hpWords(lost, n.maxHealth)}; the reference run this game is balanced against `
      + `had lost about ${Math.round(typical)} by room ${n.roomIndex}, and about ${TYPICAL_RUN_HEALTH_LOST} `
      + "over the whole run",
    `- Gold: ${n.gold}. At the merchant that is ${buys(n.gold)}; at the smith, `
      + `${n.gold >= (SMITH_PRICE[1] ?? 25) ? "one level or more" : "no level yet"}`,
    /*
     * **What a purse would actually be worth**, which the purse alone does not
     * say. Measured, the gold door was the top need once in 99 rooms: the
     * state carried the gold and the merchant's prices and left the arithmetic
     * between them — "6 now, 25 more, 31, which buys the stat" — to a
     * classifier that does not do arithmetic. Code does it.
     *
     * One line, and it says nothing twice. It used to repeat the whole shelf a
     * second time even where the extra purse bought exactly what the current
     * one already did, which is a second paragraph about one option for no new
     * fact — the shape finding 5a measures. Where the answer is the same, the
     * line says so and stops.
     */
    `- A gold door pays about ${gold(GOLD_ROOM_COINS * COIN_VALUE)}, bringing the purse to `
      + `${n.gold + GOLD_ROOM_COINS * COIN_VALUE}: at the merchant, `
      + `${buys(n.gold + GOLD_ROOM_COINS * COIN_VALUE) === buys(n.gold)
        ? "the same cards the purse already buys" : buys(n.gold + GOLD_ROOM_COINS * COIN_VALUE)}`,
    `- Everything at the stop, bought at once, is ${gold(shelfTotal())}; the smith takes `
      + `${gold(SMITH_PRICE[1] ?? 25)} upward a level on top of that`,
    `- Room ${n.roomIndex} of ${RUN_BOSS_ROOM}${n.roomType ? `, ${article(n.roomType)} ${n.roomType} room` : ""}`
      + `${n.doorIn ? `, entered through ${article(n.doorIn)} ${n.doorIn} door` : ""}`,
  ];
  if (n.level !== undefined)
    out.push(`- Level ${n.level}${n.xpInto !== undefined && n.xpToNext !== undefined
      ? `, ${Math.round(n.xpInto)} of ${n.xpToNext} experience into level ${n.level + 1}` : ""}`);
  const vendors = rooms.filter((r) => /merchant|smith|shop/.test(r.type));
  out.push(`- Vendors entered so far: ${vendors.length
    ? vendors.map((r) => `${r.type} in room ${r.index}`).join(", ") : "none"}`);
  const purses = rooms.filter((r) => r.took_gold_instead);
  if (purses.length) out.push(`- Purses taken instead of cards: ${purses.length}`);
  if (rooms.length === 0)
    out.push("- Nothing has been measured yet, so every fact above that reads as an average is a default, not an observation.");
  return out;
}

/** The merchant's whole shelf, at its prices, for judging what a purse is for. */
function shelfTotal(): number {
  return Object.values(MERCHANT_PRICE).reduce((a, b) => a + b, 0);
}

function aheadLines(n: BriefingNow): string[] {
  const fightsLeft = Math.max(0, RUN_COMBAT_ROOMS - n.roomIndex + (n.roomIndex <= RUN_COMBAT_ROOMS ? 1 : 0));
  return [
    n.roomIndex <= RUN_COMBAT_ROOMS
      ? `- ${fightsLeft} ${fightsLeft === 1 ? "fight" : "fights"} left before the stop, this one included`
      : "- The fights are over",
    `- ${n.roomIndex === RUN_SHOP_ROOM ? "This room" : `Room ${RUN_SHOP_ROOM}`} is the fixed stop: a `
      + "merchant, a smith and a fountain, no enemies. It is the last room gold can be spent in and the "
      + "last room health comes back in.",
    // The first audience (doc 022): stated as the run's shape, the same way the stop and the boss are.
    n.roomIndex <= (n.audienceRoom ?? RUN_AUDIENCE_ROOM)
      ? `- ${n.roomIndex === (n.audienceRoom ?? RUN_AUDIENCE_ROOM) ? "This room" : `Room ${n.audienceRoom ?? RUN_AUDIENCE_ROOM}`} is a fight the boss drops `
        + "into partway through: the room's bodies are crushed, the player's health is filled, and he fights "
        + "until his armour breaks, then leaves. It pays its door's reward one grade higher, and about a room's "
        + "experience as he leaves; the crushed bodies pay none."
      : `- The boss was met in room ${n.audienceRoom ?? RUN_AUDIENCE_ROOM} and driven off; he waits in room ${RUN_BOSS_ROOM}.`,
    // Room 10's guardian (doc 024), stated as the run's shape.
    ...(n.roomIndex <= RUN_GUARDIAN_ROOM ? [
      `- ${n.roomIndex === RUN_GUARDIAN_ROOM ? "This room" : `Room ${RUN_GUARDIAN_ROOM}`} is a guardian fight: one large `
        + "heavy body that rams and fires a spray, and calls squads of ordinary bodies to its side; it takes a "
        + "burst of hits, not one, to interrupt it, and a ram into a wall knocks it out. It pays its door's reward one grade higher, and a room's experience on the kill.",
    ] : []),
    `- ${n.roomIndex === RUN_BOSS_ROOM ? "This room" : `Room ${RUN_BOSS_ROOM}`} is the boss: one long fight `
      + "in an open hall against a single body with far more health than anything else in the run. It is "
      + "one body rather than a crowd, the fight is long, and the health bar the player arrives on is the "
      + "one they fight it with.",
  ];
}

/* ---------------------------------------------------------------- helpers */

function section(title: string, lines: readonly string[]): string {
  return [title, ...lines].join("\n");
}

function maybe(title: string, lines: readonly string[]): string[] {
  return lines.length ? [section(title, lines)] : [];
}

/** Comma-joined, missing phrases dropped. */
function phrases(...parts: readonly (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(", ");
}

/** "vigour ×2, fleet": repeats counted, first-seen order kept. */
function counted(names: readonly string[]): string {
  const n = new Map<string, number>();
  for (const x of names) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].map(([x, k]) => (k > 1 ? `${x} ×${k}` : x)).join(", ");
}

/** Stats taken, each with the family it belongs to and what it does. */
function countedStats(ids: readonly string[]): string {
  const n = new Map<string, number>();
  for (const x of ids) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].map(([id, k]) => {
    const stat = statById(id);
    const family: StatFamily | null = stat?.family ?? null;
    const effect = stat ? firstSentence(stat.description) : null;
    return `${stat?.name ?? nameOf(id)}${k > 1 ? ` ×${k}` : ""}${family ? ` (${family}` : ""}${
      family && effect ? `: ${effect.replace(/\.$/, "").toLowerCase()}` : ""}${family ? ")" : ""}`;
  }).join(", ");
}

/**
 * **A description's first sentence**, without treating a decimal point or an
 * abbreviation as the end of one.
 *
 * `/^[^.!?]+[.!?]/` cut "Move 8.5% faster" at "Move 8." and "e.g. a crowd" at
 * "e.g." — a latent trap, because the pool happens to hold no decimals today
 * and one added later would silently truncate a card's whole meaning.
 */
export function firstSentence(text: string | undefined): string | null {
  if (!text) return null;
  const s = text.trim();
  if (!s) return null;
  for (const m of s.matchAll(/[.!?]/g)) {
    const at = m.index;
    const before = s.slice(0, at);
    const after = s.slice(at + 1);
    // A decimal point, "8.5"; a version, "1.2.3".
    if (/\d$/.test(before) && /^\d/.test(after)) continue;
    // An abbreviation's stop, or a single initial: "e.g. a crowd", "J. Smith".
    if (ABBREVIATIONS.some((a) => before.toLowerCase().endsWith(a))) continue;
    if (/(^|[\s("'])[A-Za-z]$/.test(before)) continue;
    // A sentence ends at whitespace or at the end of the text; anything else
    // is punctuation inside a word.
    if (after.length > 0 && !/^\s/.test(after)) continue;
    return s.slice(0, at + 1);
  }
  return s;
}

const ABBREVIATIONS: readonly string[] = ["e.g", "i.e", "etc", "vs", "approx", "cf", "fig", "no"];

/** "a" or "an", so a door badge does not read as "a affix door". */
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

function hurtWords(by: string): string {
  return by === "shots" ? "enemy shots"
    : by === "blades" ? "enemy blades"
    : by === "hazards" ? "the floor's hazards" : by;
}

/**
 * Health as points **and** as hearts, because the bar the player watches is
 * six hearts and "9 of 60" is a number they never see.
 */
export function hpWords(lost: number, max: number): string {
  const hearts = max / HP_PER_HEART;
  const share = lost / HP_PER_HEART;
  if (lost <= 0) return "nothing";
  const n = Math.round(share * 10) / 10;
  const whole = Math.round(hearts);
  const how = n >= 0.8 && n < 1 ? `nearly one of ${whole} hearts`
    : n === 1 ? `one of ${whole} hearts`
    : `${n} of ${whole} hearts`;
  return `${Math.round(lost)} of ${max}, ${how}`;
}

/** Health as a count of hearts, for a bar the player reads in hearts. */
function heartWords(health: number, max: number): string {
  const hearts = health / HP_PER_HEART;
  if (health <= 0) return "none";
  if (hearts < 1) return `less than one of ${Math.round(max / HP_PER_HEART)} hearts`;
  const whole = Math.round(max / HP_PER_HEART);
  if (health >= max) return `all ${whole} hearts`;
  return `about ${Math.round(hearts * 10) / 10} of ${whole} hearts`;
}

/** What a purse buys at the merchant, said as the shelf reads it. */
function buys(coin: number): string {
  const priced = Object.entries(MERCHANT_PRICE).filter(([, price]) => price > 0);
  const can = priced.filter(([, price]) => coin >= price).map(([kind, price]) => `${kind} (${price})`);
  return can.length
    ? can.join(", ")
    : `nothing yet; the cheapest card is ${Math.min(...priced.map(([, p]) => p))}`;
}

/** A space by its name and what it is like to fight in; the current room only. */
function spaceWords(id: string): string {
  const name = id.replace(/_/g, " ");
  try {
    const d = archetype(id as SpaceArchetypeId).description;
    return d ? `${name} — ${d}` : name;
  } catch {
    return name;
  }
}

/** A spell, affix or stat by its display name; an id otherwise, made readable. */
export function nameOf(id: string): string {
  const affix = spellAffixById(id);
  if (affix) return affix.name;
  const stat = statById(id);
  if (stat) return stat.name;
  return id.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/* ------------------------------------------------------------- the adapter */

/**
 * **The briefing, from the state the Director already holds.**
 *
 * `RunContext` is the one thing every caller — the scene, the harness, a test
 * — already builds, so the briefing is derived from it rather than assembled
 * a second time at each call site. What it cannot hold is what this request
 * is for: the questions being asked, the room round 1 decided, and the cards
 * on the shelf. Those are the `extra`.
 */
export interface BriefingExtra {
  /** One phrase per question in this request, in the player's terms. */
  readonly deciding: readonly string[];
  readonly room?: BriefingRoomNow;
  readonly cards?: readonly BriefingCardPool[];
  readonly roomType?: string;
}

export function briefingFrom(ctx: RunContext, extra: BriefingExtra): string {
  const keys: (HeldKey | null)[] = ctx.slots.map((s, i) => (s ? {
    base: s.base,
    level: ctx.power?.levels[i] ?? 1,
    affixes: ctx.power?.affixes[i] ?? [],
  } : null));
  const manaMax = ctx.power?.mana_max ?? ctx.staff.mana_max;
  const facts = buildFacts({
    keys: keys.flatMap((k) => (k ? [k] : [])),
    items: ITEMS,
    manaMax,
    statsTaken: ctx.history.stats_taken ?? [],
  });
  const recent = recentHistory(ctx.history);
  const words = clampFreeText(ctx.intent.free_text);
  const lane = laneFromText(words);
  const card = STYLE_CARDS[ctx.intent.preset];
  const maxHealth = ctx.max_health ?? MAX_HEARTS * HP_PER_HEART;
  const journal = ctx.history.journal ?? [];
  return briefing({
    player: {
      style: card?.name ?? ctx.intent.preset,
      stylePreset: ctx.intent.preset,
      ...(card ? { styleMeans: card.does } : {}),
      ...(words ? { ownWords: words } : {}),
      ...(lane ? { ownWordsLane: lane, ownWordsLaneMeans: AFFIX_LANES[lane].text } : {}),
    },
    build: {
      keys, manaMax,
      statsTaken: ctx.history.stats_taken ?? [],
      affixSlotsOpen: facts.affix_slots_open,
      spellLevels: facts.spell_levels,
      heldElements: facts.held_elements,
      buildShape: ctx.labels.build_shape ?? "forming",
      dominantTags: ctx.labels.preference.dominant,
    },
    observed: {
      ...(ctx.labels.observed ?? UNMEASURED),
      clear_speed: ctx.labels.clear_speed,
      recent_damage: ctx.labels.recent_damage,
      movement_pressure_recent: ctx.labels.movement_pressure_recent,
      ...(ctx.observed_figures ?? {}),
      measured: ctx.observed_figures !== undefined,
    },
    offers: {
      offStylePicks: OFF_STYLE_WORDS[ctx.labels.preference.consistency] ?? "none",
      keptLast: keptCards(journal).slice(-3),
      statedStyle: ctx.intent.preset,
      keysLean: keysLean(ctx.slots.flatMap((s) => (s ? [ITEMS.get(s.base)?.tags ?? []] : []))),
      ...(ctx.history.doors_offered ? { doorsOffered: ctx.history.doors_offered } : {}),
      ...(ctx.history.doors_taken ? { doorsTaken: ctx.history.doors_taken } : {}),
    },
    rooms: journal,
    now: {
      health: healthOf(ctx, maxHealth),
      maxHealth,
      gold: ctx.gold ?? goldFromLabel(ctx.labels.gold),
      ...(ctx.level !== undefined ? { level: ctx.level } : {}),
      ...(ctx.xp_into !== undefined ? { xpInto: ctx.xp_into } : {}),
      ...(ctx.xp_to_next !== undefined ? { xpToNext: ctx.xp_to_next } : {}),
      roomIndex: ctx.room_index,
      audienceRoom: audienceRoomFor(ctx.seed),
      ...(extra.roomType ? { roomType: extra.roomType } : {}),
      // The badge on the door the player actually walked through, which the
      // last room's journal entry records; a room's `DoorRef` carries only
      // whether the fight is elite.
      ...(journal.at(-1)?.door_taken ? { doorIn: journal.at(-1)!.door_taken! } : {}),
      deciding: extra.deciding,
    },
    ...(extra.room ? { room: extra.room } : {}),
    ...(extra.cards ? { cards: extra.cards } : {}),
  });
}

/**
 * The cards the run has kept, oldest first, each with the style tags
 * `preference.consistency` is counted over. The journal records a pick as the
 * card's id (the scene) or its name in snake case (the harness), which are the
 * same string; a purse and a pick no content table knows are left out.
 */
function keptCards(journal: readonly RunJournalEntry[]): { name: string; tags: readonly string[] }[] {
  return journal.flatMap((r) => (r.picked ?? []).flatMap((id) => {
    const kind = ITEMS.has(id) ? "spell" : spellAffixById(id) ? "affix" : statById(id) ? "stat" : null;
    // A spell's tags include its role and range; only the style tags are counted.
    return kind ? [{ name: nameOf(id), tags: cardStyleTags(ITEMS, kind, id).filter((t) => STYLE_TAGS.has(t)) }] : [];
  }));
}

const STYLE_TAGS: ReadonlySet<string> = new Set(ARCHETYPES);

/** `preference.consistency` as the count it was taken from. */
const OFF_STYLE_WORDS: Readonly<Record<string, string>> = {
  on_plan: "none", drifting: "one", pivoted: "two_running",
};

/**
 * The health bar in points. `RunContext` carries the bucket, not the number,
 * because doc 002 keeps raw numbers out of the *labels*; the briefing is not
 * labels, and a Director told "low" and never told how low cannot say whether
 * a fountain is worth a room. A caller that has the figure sends it; one that
 * does not gets the middle of the bucket it sent, said as the bucket.
 */
function healthOf(ctx: RunContext, maxHealth: number): number {
  if (typeof ctx.health === "number") return ctx.health;
  const mid: Readonly<Record<string, number>> = { critical: 0.1, low: 0.35, ok: 0.75, full: 1 };
  return Math.round(maxHealth * (mid[ctx.labels.health] ?? 0.75));
}

/** The same for gold, whose label is three buckets wide. */
function goldFromLabel(label: string): number {
  return label === "rich" ? 80 : label === "ok" ? 38 : 10;
}
