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

import { SPELL_SCHOOLS } from "../spells/schools.ts";
import type { SpellSchool } from "../spells/schools.ts";
import { STAT_FAMILIES } from "./stats.ts";
import type { StatFamily } from "./stats.ts";
export type Difficulty = "normal" | "elite";

export interface DoorOffer {
  readonly reward: RewardCardKind;
  readonly difficulty: Difficulty;
  /**
   * What the badge promises beyond the kind. A spell door names a **school**
   * (doc 003's portal question with the build asked at the door), a stat door
   * a **family**, and every door a **grade**: 1 ordinarily, 2 or 3 behind an
   * elite, occasionally 2 late in the run.
   */
  readonly school?: SpellSchool;
  readonly family?: StatFamily;
  readonly grade: number;
  /**
   * A door to a **vendor's room** instead of a fight: the merchant or the
   * blacksmith alone, met mid-run. Rare, and never the only way on.
   */
  readonly npc?: NpcKind;
}

export type NpcKind = "merchant" | "smith";


/** The schools that hold at least one spell tagged with each build style. */
export const STYLE_SCHOOLS: Readonly<Record<string, readonly SpellSchool[]>> = {
  spam: ["storm", "void", "frost", "spirit"],
  nuke: ["stone", "storm", "frost", "spirit"],
  area: ["flame", "stone", "void", "spirit", "venom"],
  dot: ["flame", "venom"],
  melee: ["spirit", "stone", "storm"],
};

function gradeFor(elite: boolean, roomIndex: number, rng: Rng): number {
  if (elite) return rng.next() < 0.35 ? 3 : 2;
  return roomIndex >= 8 && rng.next() < 0.25 ? 2 : 1;
}

function dressDoor(reward: RewardCardKind, difficulty: Difficulty, roomIndex: number, rng: Rng, style?: string): DoorOffer {
  const grade = gradeFor(difficulty === "elite", roomIndex, rng);
  if (reward === "spell") {
    // Half the time, a school that holds a spell of the player's style.
    const leaning = style ? STYLE_SCHOOLS[style] ?? [] : [];
    const pool = leaning.length > 0 && rng.next() < 0.5 ? leaning : SPELL_SCHOOLS;
    return { reward, difficulty, grade, school: pool[rng.int(pool.length)]! };
  }
  if (reward === "stat") return { reward, difficulty, grade, family: STAT_FAMILIES[rng.int(STAT_FAMILIES.length)]! };
  return { reward, difficulty, grade };
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

export interface RunShape {
  readonly roomIndex: number;
  /** Whether the room just left was an elite one. Rule 5. */
  readonly lastWasElite: boolean;
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
export function legalDifficulties(run: RunShape): readonly Difficulty[] {
  if (run.lastWasElite || run.critical) return ["normal"];
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
  /** Every legal set of reward kinds, one per portal, no kind twice. */
  readonly kindSets: readonly (readonly RewardCardKind[])[];
  /** Whether one of the portals may be elite. */
  readonly elite: boolean;
  /** Late in the run a normal door may be graded up. */
  readonly lateGrade: boolean;
  /** Whether a vendor's room may replace one of the portals. */
  readonly npc: boolean;
  readonly schools: readonly SpellSchool[];
  readonly families: readonly StatFamily[];
}

/** First room a vendor may appear behind, and the most a run meets. */
export const NPC_FIRST_ROOM = 3;
export const NPC_ROOMS_MAX = 2;

export function portalChoices(run: RunShape, rng: Rng, count = drawPortalCount(rng)): PortalChoices {
  const n = Math.max(1, Math.min(count, REWARD_KINDS.length));
  return {
    count: n,
    kindSets: combinations(REWARD_KINDS, n),
    elite: legalDifficulties(run).includes("elite"),
    lateGrade: run.roomIndex >= 8,
    // Never the only way on, never twice running, never the last fight's
    // doors (those open onto the merchant anyway).
    npc: n >= 2 && run.roomIndex >= NPC_FIRST_ROOM && run.roomIndex < RUN_COMBAT_ROOMS - 1
      && !run.lastWasNpc && (run.npcRooms ?? 0) < NPC_ROOMS_MAX,
    schools: SPELL_SCHOOLS,
    families: STAT_FAMILIES,
  };
}

/** A kind set as one option id, and back. */
export function kindSetKey(set: readonly RewardCardKind[]): string {
  return set.join("+");
}
export function parseKindSetKey(key: string): RewardCardKind[] {
  return key.split("+") as RewardCardKind[];
}

export interface PortalAnswers {
  readonly kinds: readonly RewardCardKind[];
  /** The kind whose door is elite, or null for none. */
  readonly eliteKind: RewardCardKind | null;
  readonly eliteGrade: 2 | 3;
  /** A normal door's grade late in the run. */
  readonly normalGrade: 1 | 2;
  readonly school: SpellSchool;
  readonly family: StatFamily;
  readonly npc: NpcKind | null;
}

/**
 * The portals, from the Director's answers. The elite door goes **last**, so
 * the leftmost is never the hard one taken by accident; a vendor replaces
 * the first normal door, so the elite survives it.
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
    return {
      reward, difficulty: elite ? "elite" : "normal", grade,
      ...(reward === "spell" ? { school: a.school } : {}),
      ...(reward === "stat" ? { family: a.family } : {}),
    };
  });
  if (a.npc) {
    const i = doors.findIndex((d) => d.difficulty === "normal");
    if (i >= 0 && doors.length > 1) doors[i] = { reward: "gold", difficulty: "normal", grade: 1, npc: a.npc };
  }
  return doors;
}

/** Portal specs for the world, from door offers: what each opens onto. */
export function doorSpecs(doors: readonly DoorOffer[], roomIndex: number): PortalSpec[] {
  const stage = stageFor(roomIndex + 1);
  return doors.map((d) => ({
    reward: d.reward,
    elite: d.difficulty === "elite",
    ...(d.school ? { school: d.school } : {}),
    ...(d.family ? { family: d.family } : {}),
    ...(d.npc ? { npc: d.npc } : {}),
    grade: d.grade,
    // The stage of the room the portal leads *into*: the last combat room's
    // portals open onto the merchant, and the merchant's onto the boss. A
    // vendor's door opens onto a room with no fight in it.
    type: d.npc || stage === "shop" ? "shop" : stage === "boss" ? "boss" : "combat",
  }));
}

function combinations<T>(xs: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (xs.length < k) return [];
  const [head, ...rest] = xs;
  return [...combinations(rest, k - 1).map((c) => [head!, ...c]), ...combinations(rest, k)];
}
