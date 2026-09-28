/**
 * What a portal offers: a reward kind and a difficulty.
 *
 * Doc 003's revision removes room *types* as a player-facing choice. Every
 * room before the merchant is a fight; what differs is what is behind it and
 * how hard it is. So this replaces `legalDoorSets`, which enumerated sets over
 * six types under five pacing constraints — and where the constraints did most
 * of the work, because four of the six types were services rather than places
 * the player wanted to go.
 *
 * The shape that remains is the one doc 002 asks for: **categorical choice with
 * no counting and no numeric comparison.** Four kinds crossed with two
 * difficulties, decided per portal, each with a reason attached.
 *
 * It is also a question whose answer the player can see. The portal's badge is
 * the reward kind, so the Director's decision and the player's decision are
 * about the same thing — which they were not when the badge said "combat" and
 * the reward was chosen somewhere else.
 */
import type { PortalSpec, RewardCardKind } from "../sim/exits.ts";
import type { Rng } from "../rng.ts";

import { SPELL_SCHOOLS, schoolOf } from "../spells/schools.ts";
import { BASE_ITEMS } from "../spells/items.ts";
import { ARCHETYPES } from "../content/tags.ts";
import type { BaseItem } from "../types.ts";
import type { SpellSchool } from "../spells/schools.ts";
import { STAT_FAMILIES, STAT_UPGRADES } from "./stats.ts";
import type { StatFamily } from "./stats.ts";
export type Difficulty = "normal" | "elite";

export interface DoorOffer {
  readonly reward: RewardCardKind;
  readonly difficulty: Difficulty;
  /**
   * What the badge names beyond the kind: every school a spell door's cards
   * belong to, every family a stat door's do, in the Director's order
   * (`cardTypesOf`) — read off the cards, not promised ahead of them — and
   * every door a **grade**: 1 ordinarily, 2 or 3 behind an elite,
   * occasionally 2 late in the run.
   */
  readonly schools?: readonly SpellSchool[];
  readonly families?: readonly StatFamily[];
  readonly grade: number;
  /**
   * **The cards behind the door**, decided when the door opened, by id and in
   * the Director's order. Absent for a door whose room pays no cards (gold, a
   * vendor, a fixed exit) and for one decided before cards travelled with it.
   */
  readonly cards?: readonly string[];
  /**
   * A door to a **room with no fight** instead of one: the merchant, the
   * blacksmith or the fountain alone, met mid-run. Never the only way on.
   */
  readonly npc?: NpcKind;
  /**
   * The run's shape fixed this door rather than the Director choosing it, so
   * it promises the room ahead and no reward (`fixedExit`, `PortalSpec.onward`).
   */
  readonly onward?: boolean;
}

/**
 * The three rooms that have no fight in them. The two vendors trade gold for
 * power; the **fountain** trades a fight's reward for health — one drink of
 * `FOUNTAIN_HEAL_FRACTION` of the bar, and then it is dry.
 */
export type NpcKind = "merchant" | "smith" | "fountain";


/**
 * **The schools a style's door may promise** (doc 006): a school serves a
 * style when it holds at least two spells tagged with it, so a door that
 * promises it to that style is a choice between spells rather than one card.
 *
 * Derived from the pool rather than written out. It was a hand-kept table,
 * and a table beside the data it summarises is a second copy that goes stale
 * the day a spell is added or re-tagged — the door then promises a school
 * that holds nothing for the style, which is the dead draw the door exists
 * to avoid. In `SPELL_SCHOOLS` order, so a door's draw is stable.
 */
const STYLE_SCHOOL_MIN = 2;
export const STYLE_SCHOOLS: Readonly<Record<string, readonly SpellSchool[]>> = styleSchools(BASE_ITEMS);

/** Per style, the schools holding at least `STYLE_SCHOOL_MIN` spells tagged with it. */
export function styleSchools(items: readonly BaseItem[]): Record<string, readonly SpellSchool[]> {
  const out: Record<string, readonly SpellSchool[]> = {};
  for (const style of ARCHETYPES) {
    out[style] = SPELL_SCHOOLS.filter((school) =>
      items.filter((i) => schoolOf(i.id) === school && i.tags.includes(style)).length >= STYLE_SCHOOL_MIN);
  }
  return out;
}


function gradeFor(elite: boolean, roomIndex: number, rng: Rng): number {
  if (elite) return rng.next() < 0.35 ? 3 : 2;
  return roomIndex >= 8 && rng.next() < 0.25 ? 2 : 1;
}

/**
 * A rule door's kind, difficulty and grade. It names no school or family: a
 * badge names what the cards behind it are (`cardTypesOf`), and a rule door's
 * cards are only drawn when its room is entered.
 */
function dressDoor(reward: RewardCardKind, difficulty: Difficulty, roomIndex: number, rng: Rng, _style?: string): DoorOffer {
  return { reward, difficulty, grade: gradeFor(difficulty === "elite", roomIndex, rng) };
}

export const REWARD_KINDS: readonly RewardCardKind[] = ["stat", "spell", "affix", "gold"];

/**
 * How many portals a room ends with: **one to three**, as doc 003 puts the
 * question, drawn rather than fixed. Three every time read as no randomness
 * at all — every room ended with the same three badges in a row, and the
 * choice stopped being one. Three is still the common case; two is a
 * narrower choice; one is a room that hands the player a direction, and
 * sometimes an elite they did not get to decline.
 */
export const PORTAL_COUNT_WEIGHTS: readonly (readonly [number, number])[] = [[3, 0.55], [2, 0.35], [1, 0.1]];

export function drawPortalCount(rng: Rng): number {
  const roll = rng.next();
  let acc = 0;
  for (const [count, weight] of PORTAL_COUNT_WEIGHTS) {
    acc += weight;
    if (roll < acc) return count;
  }
  return PORTAL_COUNT_WEIGHTS[0]![0];
}

/**
 * How many rooms a run fights through before the merchant and the boss.
 *
 * Named `RUN_*` rather than reusing doc 003's older `REGULAR_ROOMS` /
 * `BOSS_ROOM` from `pacing.ts`: those index the **six-type** structure this
 * file replaces, and two constants with the same name meaning slightly
 * different things is how a refactor goes wrong quietly.
 */
/**
 * 14, from 9: doc 014's count. Nine rooms of the old structure held three
 * empty ones; nine fights was already more combat than that, and fourteen is
 * the number the twenty-minute run was sized against.
 */
export const RUN_COMBAT_ROOMS = 14;
/** The merchant and blacksmith, fixed: gold needs somewhere to go. */
export const RUN_SHOP_ROOM = RUN_COMBAT_ROOMS + 1;
export const RUN_BOSS_ROOM = RUN_SHOP_ROOM + 1;
/**
 * **The king's first audience** (doc 022): the fight he drops into, plays
 * phase I in and leaves. **Which room it is, is drawn per run** from rooms 4
 * to 6 (`AUDIENCE_ROOMS`, `audienceRoomFor`): a drop-in the player can count
 * the rooms to is not a drop-in. Still one of the fourteen fights, entered
 * through an ordinary door; what it asks of the doors before it is
 * `leadsToFixedFight`. `RUN_AUDIENCE_ROOM` is where it falls when no run is
 * named — the bench, the lab and tests.
 */
export const AUDIENCE_ROOMS: readonly number[] = [4, 5, 6];
export const RUN_AUDIENCE_ROOM = 5;

/** The room this run's first audience falls in: one of `AUDIENCE_ROOMS`, from the run's seed. */
export function audienceRoomFor(seed: string | undefined): number {
  if (seed === undefined) return RUN_AUDIENCE_ROOM;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return AUDIENCE_ROOMS[(h >>> 0) % AUDIENCE_ROOMS.length]!;
}

/** Whether this room is the first audience, in the run whose audience falls in `audienceRoom`. */
export function isAudienceRoom(roomIndex: number, audienceRoom = RUN_AUDIENCE_ROOM): boolean {
  return roomIndex === audienceRoom;
}

/** Whether the doors out of this room open onto the first audience. */
export function leadsToAudience(roomIndex: number, audienceRoom = RUN_AUDIENCE_ROOM): boolean {
  return roomIndex + 1 === audienceRoom;
}

/**
 * **Room 10's guardian** (doc 024): the last fight of the flooded depth is the
 * Frontier Veteran's. Like the first audience it is one of the fourteen fights,
 * entered through an ordinary door, and the doors before it are narrowed the
 * same way (`leadsToFixedFight`).
 */
export const RUN_GUARDIAN_ROOM = 10;

export function isGuardianRoom(roomIndex: number): boolean {
  return roomIndex === RUN_GUARDIAN_ROOM;
}

/** A fight the run's shape fixes rather than the Director: the first audience or the guardian. */
export function isFixedFightRoom(roomIndex: number, audienceRoom = RUN_AUDIENCE_ROOM): boolean {
  return isAudienceRoom(roomIndex, audienceRoom) || isGuardianRoom(roomIndex);
}

/**
 * Whether the doors out of this room open onto a fixed fight: never elite, a
 * vendor or the fountain. The room behind them has to be a fight, and a fair
 * one — an elite room with the king on top of it is two spikes at once, and a
 * door into a room with no fight would move the fight into a room it cannot
 * happen in.
 */
export function leadsToFixedFight(roomIndex: number, audienceRoom = RUN_AUDIENCE_ROOM): boolean {
  return isFixedFightRoom(roomIndex + 1, audienceRoom);
}

/**
 * What a fixed fight pays — the first audience and the guardian: its door's own reward **one grade higher**,
 * capped at 3 (doc 022, "What it pays"). The reward for driving him off rides
 * on the reward the player chose at the door, so the choice still counts.
 */
export function audienceGrade(grade: number): number {
  return Math.min(3, grade + 1);
}

export interface RunShape {
  readonly roomIndex: number;
  /**
   * **Whether the room these portals lead out of is itself elite.** Rule 5:
   * no elite straight after an elite.
   *
   * The name is older than the meaning and both callers read it the older
   * way, passing the elite flag of the room *before* this one — so an elite
   * room's own doors were still allowed to promise another elite, and a real
   * run came back with rooms 4 and 5 both elite. The portals out of a room
   * are decided while the player is standing in it, so "the room just left"
   * is, from the next room's point of view, this one.
   */
  readonly lastWasElite: boolean;
  /**
   * Elite rooms **entered** so far this run, and ordinary fights since the
   * last one (0 while standing in an elite room, absent before the first).
   *
   * `lastWasElite` on its own only forbids two in a row, which over fourteen
   * fights permits seven. Measured: 30% of the fights of a rule run and 4 of
   * the 12 of a real one. Doc 003 has the elite as the run's spike, and a
   * spike every other room is the run's ordinary pitch with a badge on it.
   */
  readonly elitesSoFar?: number;
  readonly fightsSinceElite?: number;
  /** Doc 003 forbids an elite while the player is one hit from dying. */
  readonly critical: boolean;
  /**
   * The build style chosen before the run (doc 003's intent screen): spell
   * doors lean toward schools that hold spells of that style.
   */
  readonly style?: string;
  /** Vendor rooms already met this run, and whether the room just left was one. */
  readonly npcRooms?: number;
  readonly lastWasNpc?: boolean;
  /**
   * Vendor **portals already offered** this run, met or declined.
   *
   * Separate from `npcRooms`, and the reason is what a full Jev run looked
   * like without it: the merchant was on the portal list in nine rooms of
   * sixteen. Two of them could have been entered and the other seven were the
   * same badge appearing again and again, which reads as the game nagging
   * rather than as an opportunity. `NPC_ROOMS_MAX` caps what the run *spends*
   * on vendors; this caps what it *says about* them.
   */
  readonly npcOffers?: number;
  /**
   * Fountain rooms already met this run. Counted apart from the vendors, so
   * the run's one drink is not spent by a merchant stop and the other way
   * round; `lastWasNpc` still covers both, because two rooms with no fight in
   * a row is a gap in the run whichever two they are.
   */
  readonly fountains?: number;
  /** Fountain portals put on the list this run, taken or declined. */
  readonly fountainOffers?: number;
  /**
   * Whether the player is hurt enough for a fountain (`fountainWanted`: the
   * bar at or under `FOUNTAIN_OFFER_AT` of its maximum).
   *
   * The fountain is the run's answer to a bad stretch, and on a full or
   * nearly full bar it is a door that pays little — so a run that has only
   * been scratched is not offered one at all. A code bound rather than a
   * question, because "is the drink worth a room" has one right answer when
   * the bar is nearly full.
   */
  readonly hurt?: boolean;
  /** The room this run's first audience falls in (`audienceRoomFor`); room 5 when absent. */
  readonly audienceRoom?: number;
}

export type RoomStage = "combat" | "shop" | "boss";

/** Where a room index falls in the fixed run shape. */
export function stageFor(roomIndex: number): RoomStage {
  if (roomIndex >= RUN_BOSS_ROOM) return "boss";
  if (roomIndex >= RUN_SHOP_ROOM) return "shop";
  return "combat";
}

/**
 * Which difficulties may be offered after this room.
 *
 * The only two pacing rules left. Everything else the old enumeration enforced
 * was about types that no longer exist.
 */
/**
 * **How far apart the elite rooms stand, and how many a run holds.**
 *
 * Two ordinary fights between them, and four in all. The old rule was "not
 * two in a row", which over fourteen fights allows seven — and it was not
 * even doing that, because both callers passed the difficulty of the room
 * *before* the one whose doors were being decided (`RunShape.lastWasElite`),
 * so a real run came back with rooms 4 and 5 both elite and 4 elites in its
 * 12 fights. An elite is the run's spike; a spike every other room is the
 * run's ordinary pitch wearing a badge.
 *
 * Four, because the run is fourteen fights: one in the opening third, two
 * through the middle and one before the stop is a shape, and the player can
 * still decline every one of them.
 */
export const ELITE_GAP_FIGHTS = 2;
export const ELITE_ROOMS_MAX = 4;

export function legalDifficulties(run: RunShape): readonly Difficulty[] {
  if (run.lastWasElite || run.critical || leadsToFixedFight(run.roomIndex, run.audienceRoom)) return ["normal"];
  if ((run.elitesSoFar ?? 0) >= ELITE_ROOMS_MAX) return ["normal"];
  // Absent before the first elite, which is when there is nothing to be near.
  if (run.fightsSinceElite !== undefined && run.fightsSinceElite < ELITE_GAP_FIGHTS) return ["normal"];
  // Elite from room 3, as doc 003 has always had it: the first two rooms are
  // where the player learns what their build does.
  return run.roomIndex >= 3 ? ["normal", "elite"] : ["normal"];
}

/**
 * The portals to offer, as the rules allow them.
 *
 * **Every kind appears at most once**, because two portals promising the same
 * currency is one portal with extra steps — the player's question is which
 * currency, and a duplicate answers it twice.
 *
 * Gold is always among them when there is more than one. It is the liquid
 * option: doc 013 makes it the safe pick, and with the merchant fixed before
 * the boss it is the only reward that can be spent on something else later.
 * Without it a player who wants none of stat, spell or affix has no out.
 */
export function ruleDoors(run: RunShape, rng: Rng, count = drawPortalCount(rng)): DoorOffer[] {
  const difficulties = legalDifficulties(run);
  /*
   * Three of the four kinds, drawn. **Gold is not forced in.**
   *
   * It was, on the reasoning that the player needs an out — and with three
   * doors out of four kinds it appears about three quarters of the time
   * anyway, so forcing it only bought the last quarter and cost something
   * bigger: played out, half the doors taken were gold, so the run was mostly
   * a currency it had one place to spend. An out that shows up in three offers
   * out of four is an out.
   *
   * The kind left out each time is what makes the offer a choice rather than a
   * menu: with all four present every time, the player never has to weigh what
   * they are giving up.
   */
  const kinds = rng.shuffle([...REWARD_KINDS]);
  const picked = kinds.slice(0, Math.max(1, Math.min(count, REWARD_KINDS.length)));
  // A single portal can still be elite: the one door offered is the hard one
  // about a third of the time it is offered alone, so a forced choice is
  // sometimes a forced fight.
  if (picked.length === 1 && difficulties.includes("elite") && rng.next() < 0.3)
    return [dressDoor(picked[0]!, "elite", run.roomIndex, rng, run.style)];

  return picked.map((reward, i) => dressDoor(
    reward,
    /*
     * At most one elite on offer, and never the first portal listed. An
     * offer where every door is elite is not a difficulty choice, and one
     * where the leftmost is elite gets taken by accident.
     */
    i === picked.length - 1 && difficulties.includes("elite") && picked.length > 1
      ? "elite"
      : "normal",
    run.roomIndex, rng, run.style,
  ));
}

/* ------------------------- the Director's portal question ------------------------- */

/**
 * What the Director may answer about the portals out of a room — the
 * **constraint layer** of doc 002. Code draws how many portals there are and
 * enumerates what is legal; the Director picks among the legal answers; code
 * assembles them (`assemblePortals`). Nothing here is a preference: a
 * preference is a weight, and weights belong to the Director's rule table.
 */
export interface PortalChoices {
  readonly count: number;
  /**
   * The reward kinds a portal here may stand for, **one per option**.
   *
   * It used to be `kindSets`: every legal *combination* of kinds, enumerated,
   * and the Director picked a whole set. That is the wrong question in two
   * ways. It asks Jev to compare bundles — "stat, spell and affix" against
   * "spell, affix and gold" — where with three doors drawn from four kinds
   * every bundle overlaps every other in two thirds of its content, so the
   * options are nearly the same sentence four times and the answer is decided
   * by which one happens to carry the most matching clauses. And it throws
   * away the ranking: a set answer says nothing about which door the player
   * needs *most*, which is the one thing the offer wants to know.
   *
   * So the question is "which reward does this player need most now?", asked
   * over single kinds, and code takes the top `count` distinct answers by
   * sampling without replacement at `PORTAL_NEED_TEMPERATURE`. The first door
   * is almost always the top need; the ones after it vary a little.
   */
  readonly kinds: readonly RewardCardKind[];
  /**
   * The rooms with **no fight** that may replace one of the portals here —
   * the merchant, the blacksmith, the fountain — as options of the same
   * question. Code's caps decide which of them are legal at all; whether one
   * is worth a door is the Director's answer, and it wins a door only by
   * outranking the reward kinds.
   */
  readonly npcKinds: readonly NpcKind[];
  /** Whether one of the portals may be elite. */
  readonly elite: boolean;
  /** Late in the run a normal door may be graded up. */
  readonly lateGrade: boolean;
  readonly schools: readonly SpellSchool[];
  readonly families: readonly StatFamily[];
}

/**
 * **How much the ranking is perturbed.**
 *
 * Below one, so the distribution is sharpened rather than flattened: the
 * top-ranked need wins the first door nearly every time, and the doors after
 * it are drawn from what is left with enough spread that two rooms in the same
 * state do not offer the same three badges in the same order. A run whose
 * every offer is the argmax is a run with no choice in it, and one drawn at
 * the raw distribution is a run whose first door is often not what the player
 * needs at all.
 */
export const PORTAL_NEED_TEMPERATURE = 0.45;

/**
 * **How much the doors *after* the first are perturbed.**
 *
 * One temperature cannot do both jobs. Sharp enough that the first door is
 * reliably the top need is also sharp enough that the second and third are
 * reliably the second and third, and with three doors drawn from four reward
 * kinds that makes almost every offer the same three badges — measured on the
 * live model, one run put an affix badge on twelve consecutive offers and gold
 * on none at all. The player's first door was answering their build; the offer
 * as a whole had stopped being a choice.
 *
 * So the ranking is drawn in two parts: the first door at
 * `PORTAL_NEED_TEMPERATURE`, which sharpens, and the rest at this, which
 * spreads. The Director's top answer still wins the door it was asked for, and
 * what stands beside it varies from room to room.
 */
export const PORTAL_TAIL_TEMPERATURE = 1.3;

/**
 * First room a vendor may appear behind, and **the most a run meets** — the
 * global cap doc 003 asks the early economy to sit inside.
 *
 * Moved from room 3 to room 2 with the gold door's payout (`GOLD_ROOM_COINS`).
 * The two numbers are one decision: gold is only worth taking if there is
 * somewhere to spend it, and a run that met its first vendor at room 3 at best
 * and usually not at all was a run where the gold portal paid in a currency
 * with no shop. The cap stays at two, because a third vendor is a third room
 * with no fight in it, and the run is fourteen fights long.
 */
/**
 * **A room with no fight in it is rarer than any reward.**
 *
 * Reported from a real sixteen-room run: the shop badge was on the offer at
 * rooms 6, 10 and 15, and "it feels like the game is pushing you to spend
 * money. In a normal roguelike, apart from the shop, an NPC room should be
 * very rare, rarer than gold." The old numbers — two vendor rooms entered,
 * four vendor portals offered, from room 2 to room 12 — made the merchant
 * and the smith ordinary furniture rather than a find.
 *
 * So: **one** vendor room a run before the fixed stop, **two** offers, and a
 * window in the middle of the run. The window is the honest part of it. A
 * vendor before room 4 is a shelf the player cannot afford, and one after
 * room 10 is a purchase the fixed stop is four rooms away from making
 * anyway; between those the gold has somewhere to go and the stop is far
 * enough off to be worth not waiting for.
 *
 * `NPC_OFFERS_MAX` and `NPC_ROOMS_MAX` are different caps for the reason they
 * always were: the first is what the run *says about* vendors, the second
 * what it *spends* on them. Both have to be small, because a badge shown and
 * declined four times is the nagging the report was about.
 */
export const NPC_FIRST_ROOM = 4;
export const NPC_LAST_ROOM = 10;
export const NPC_ROOMS_MAX = 1;
/** How many times a run may put a vendor on the portal list at all. */
export const NPC_OFFERS_MAX = 2;
/**
 * The fountain's window and caps, the same shape as the vendors'.
 *
 * **One drink**, because the fountain is the run's answer to a bad stretch,
 * not an income: a second one would make the health bar a resource the player
 * tops up rather than the budget doc 001 spends. The boss approach has its
 * own fountain at the vendors' stop and does not draw on this one.
 *
 * It opens later than the vendors and closes later too: what it is for is a
 * run that has gone wrong, which takes a few rooms to happen, and the room
 * before the last fight is exactly where a player on a sliver of the bar
 * wants it. `RunShape.hurt` is the other half of that — on a full bar the
 * door pays nothing, so it is not offered at all.
 */
export const FOUNTAIN_FIRST_ROOM = 5;
export const FOUNTAIN_ROOMS_MAX = 1;
export const FOUNTAIN_OFFERS_MAX = 2;
/**
 * **The least the Director must give a room with no fight for it to take a
 * door**, as a share of the need ranking. The doors after the first come from
 * the spread tail of that ranking (`PORTAL_TAIL_TEMPERATURE`), and with three
 * doors from five or more options the third is close to a coin toss among
 * what was left — so a fountain the Director gave under one percent stood on
 * a door twice in one played run, and a smith at three percent took one too.
 * Below its floor the option leaves the ranking entirely.
 *
 * The smith's floor is higher: it spends the run's one vendor room on a
 * single level for a single key, where the merchant lets the player choose
 * among three kinds, so it has to be what the Director clearly wanted.
 */
export const NPC_MIN_NEED: Readonly<Record<NpcKind, number>> = {
  merchant: 0.1, fountain: 0.1, smith: 0.2,
};

export function portalChoices(run: RunShape, rng: Rng, count = drawPortalCount(rng)): PortalChoices {
  const n = Math.max(1, Math.min(count, REWARD_KINDS.length));
  // Neither may be the only way on, and neither may follow another room with
  // no fight in it: two in a row is a hole in the run.
  const roomToSpare = n >= 2 && !run.lastWasNpc && !leadsToFixedFight(run.roomIndex, run.audienceRoom);
  const npc = roomToSpare && run.roomIndex >= NPC_FIRST_ROOM && run.roomIndex <= NPC_LAST_ROOM
    && (run.npcRooms ?? 0) < NPC_ROOMS_MAX && (run.npcOffers ?? 0) < NPC_OFFERS_MAX;
  /*
   * The fountain runs to the last fight, unlike the vendors: the room it would
   * displace is a fight, and a player who has to reach the boss on a sliver of
   * the bar is exactly who it is for. What it must not do is stand where the
   * vendors' stop already does, so it stops one short of the doors that open
   * onto it.
   */
  const fountain = roomToSpare && run.roomIndex >= FOUNTAIN_FIRST_ROOM && run.roomIndex < RUN_COMBAT_ROOMS
    && (run.fountains ?? 0) < FOUNTAIN_ROOMS_MAX && (run.fountainOffers ?? 0) < FOUNTAIN_OFFERS_MAX
    // A drink on a (nearly) full bar is a room that pays little; see `RunShape.hurt`.
    && run.hurt !== false;
  return {
    count: n,
    /*
     * **A spell door to a full staff is not a plain spell door.** It is an
     * upgrade door: `cardPool` deals copies of the keys already held, which
     * raise their level, because a new spell on a full staff costs the player
     * one they chose. The kind stays legal — an upgrade is a real reward — and
     * the option text says which of the two it is.
     */
    kinds: REWARD_KINDS,
    npcKinds: [...(npc ? ["merchant", "smith"] as const : []), ...(fountain ? ["fountain"] as const : [])],
    elite: legalDifficulties(run).includes("elite"),
    lateGrade: run.roomIndex >= 8,
    schools: SPELL_SCHOOLS,
    families: STAT_FAMILIES,
  };
}


export interface PortalAnswers {
  readonly kinds: readonly RewardCardKind[];
  /** The kind whose door is elite, or null for none. */
  readonly eliteKind: RewardCardKind | null;
  readonly eliteGrade: 2 | 3;
  /** A normal door's grade late in the run. */
  readonly normalGrade: 1 | 2;
  readonly npc: NpcKind | null;
}

/**
 * The portals, from the Director's answers. The elite door goes **last**, so
 * the leftmost is never the hard one taken by accident; a room with no fight
 * in it — a vendor or the fountain — replaces the first normal door, so the
 * elite survives it.
 */
export function assemblePortals(a: PortalAnswers): DoorOffer[] {
  const kinds = [...a.kinds];
  if (a.eliteKind && kinds.includes(a.eliteKind)) {
    kinds.splice(kinds.indexOf(a.eliteKind), 1);
    kinds.push(a.eliteKind);
  }
  const doors: DoorOffer[] = kinds.map((reward) => {
    const elite = reward === a.eliteKind;
    const grade = elite ? a.eliteGrade : a.normalGrade;
    return { reward, difficulty: elite ? "elite" : "normal", grade };
  });
  if (a.npc) {
    /*
     * The **last** normal door, not the first. `kinds` arrives in need order
     * now (`PORTAL_NEED_TEMPERATURE`), so the first of them is the reward the
     * Director ranked highest; replacing that one would have the vendor
     * consume exactly the door the player most wanted. The last is the one
     * ranked lowest, which is what a vendor is worth displacing.
     */
    for (let i = doors.length - 1; i >= 0; i--)
      if (doors[i]!.difficulty === "normal" && doors.length > 1) {
        doors[i] = { reward: "gold", difficulty: "normal", grade: 1, npc: a.npc };
        break;
      }
  }
  return doors;
}

/**
 * **What a door shows is what is behind it.**
 *
 * The door's cards are decided when it opens, and its badge names every
 * school among a spell offer's cards (every family among a stat offer's), once
 * each, in the offer's order — which is the Director's. It named only the
 * commonest, the first card breaking a tie, and with three schools in three
 * cards that was one card of three: a spam player's doors read "storm" door
 * after door over offers that were two thirds something else. Before that it
 * was a promise decided on its own and forced onto the cards, which repeats
 * whenever the Director's taste is steady however varied the cards are.
 */
export function cardTypesOf(kind: RewardCardKind, ids: readonly string[]): { schools?: SpellSchool[]; families?: StatFamily[] } {
  const of = (id: string): string | undefined => kind === "spell" ? schoolOf(id) ?? undefined
    : kind === "stat" ? STAT_UPGRADES.find((u) => u.id === id)?.family : undefined;
  const seen: string[] = [];
  for (const id of ids) { const t = of(id); if (t && !seen.includes(t)) seen.push(t); }
  if (seen.length === 0) return {};
  return kind === "spell" ? { schools: seen as SpellSchool[] } : { families: seen as StatFamily[] };
}

/**
 * **The one way out of the vendors' stop: the boss.**
 *
 * The pre-boss room used to fall through to `ruleDoors`, because no portal
 * question is asked there — so it raised up to three portals with stat, spell
 * and affix badges on them, all of which led to the same boss fight. Three
 * doors that go to one place is not a choice, it is three copies of a door
 * with three different lies written on them.
 */
export function bossExit(): PortalSpec[] {
  return [{ reward: "gold", elite: false, grade: 1, type: "boss", boss: true, onward: true }];
}

/**
 * **The one way out of the last fight: the vendors' stop.**
 *
 * The same fault as `bossExit`, one room earlier and still there. Room
 * `RUN_COMBAT_ROOMS` is the last fight, and every portal out of it opens onto
 * the merchant whatever badge it wears — so the room was ending with up to
 * three doors promising a spell, an affix and a stat, all three of which led
 * to the same shop, and none of which handed out what it said. Reported from
 * play as "random doors around the shop".
 *
 * It is not a Director question either, and that is the point: with one legal
 * answer there is nothing to choose (doc 002, "a question with one option is
 * not asked"), so the room costs no portal question at all and the request it
 * would have ridden in is smaller.
 *
 * `onward` is what stops the badge lying: the door promises no currency, so it
 * is drawn as the room ahead rather than as a reward this room will never pay.
 */
export function shopExit(): PortalSpec[] {
  return [{ reward: "gold", elite: false, grade: 1, type: "shop", onward: true }];
}

/**
 * Whether this room's portals are fixed by the run's shape rather than asked
 * for: the last fight opens onto the vendors' stop, and the stop opens onto
 * the boss. One place, so the scene and the harness cannot disagree about
 * where the run narrows.
 */
export function fixedExit(roomIndex: number): PortalSpec[] | null {
  if (roomIndex === RUN_COMBAT_ROOMS) return shopExit();
  if (roomIndex === RUN_SHOP_ROOM) return bossExit();
  return null;
}

/** Portal specs for the world, from door offers: what each opens onto. */
export function doorSpecs(doors: readonly DoorOffer[], roomIndex: number): PortalSpec[] {
  const stage = stageFor(roomIndex + 1);
  return doors.map((d) => ({
    reward: d.reward,
    elite: d.difficulty === "elite",
    ...(d.schools ? { schools: d.schools } : {}),
    ...(d.families ? { families: d.families } : {}),
    ...(d.npc ? { npc: d.npc } : {}),
    ...(d.cards ? { cards: d.cards } : {}),
    grade: d.grade,
    // The stage of the room the portal leads *into*: the last combat room's
    // portals open onto the merchant, and the merchant's onto the boss. A
    // vendor's door opens onto a room with no fight in it.
    type: d.npc || stage === "shop" ? "shop" : stage === "boss" ? "boss" : "combat",
  }));
}

