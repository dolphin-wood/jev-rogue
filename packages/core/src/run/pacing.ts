/**
 * Hard pacing rules (design doc 003). These are constraints, never Jev
 * instructions: `legalDoorSets` enumerates what may be offered and Jev picks
 * one of the results. Rules apply in precedence order and a later rule never
 * overrides an earlier one.
 */
import type {
  DoorSet, PacingLabels, RoomType, RunHistory, SummaryLabels, Tension, TensionCap,
} from "../types.ts";

/** Rooms 1..9 are regular; room 10 is the boss. */
export const REGULAR_ROOMS = 9;
export const BOSS_ROOM = 10;

const OFFERABLE: readonly RoomType[] = ["combat", "elite", "treasure", "shop", "rest"];

/** All 1..3-element subsets of the offerable types, in a stable order. */
function subsets(types: readonly RoomType[]): DoorSet[] {
  const out: DoorSet[] = [];
  for (let mask = 1; mask < 1 << types.length; mask++) {
    const set: RoomType[] = [];
    for (let i = 0; i < types.length; i++) if (mask & (1 << i)) set.push(types[i]!);
    if (set.length <= 3) out.push(set);
  }
  return out;
}

export interface PacingInput {
  /** The room the player is in; the returned sets are what opens on leaving it. */
  readonly room_index: number;
  readonly history: RunHistory;
  readonly health: SummaryLabels["health"];
  readonly recent_damage: SummaryLabels["recent_damage"];
  /** True when the last two rooms both took heavy damage and no rest has been entered since. */
  readonly rest_owed: boolean;
}

export function legalDoorSets(input: PacingInput): DoorSet[] {
  const { room_index, history, health, rest_owed } = input;

  // Rule 1, terminal. Rules 3..7 do not apply to this set.
  if (room_index >= REGULAR_ROOMS) return [["boss"]];

  // Rule 2 and rule 3, the two forcing rules.
  const shopForced = !history.shop_entered && room_index >= 6;
  const restForced = rest_owed;

  // Rule 4: when both force, the set is exactly this.
  if (shopForced && restForced) return [["shop", "rest"]];

  let sets = subsets(OFFERABLE);

  if (shopForced) sets = sets.filter((s) => s.includes("shop"));
  else sets = sets.filter((s) => !s.includes("shop") || !history.shop_entered);
  if (history.shop_entered) sets = sets.filter((s) => !s.includes("shop"));

  if (restForced) sets = sets.filter((s) => s.includes("rest"));
  else if (room_index < 3) sets = sets.filter((s) => !s.includes("rest"));

  // Rule 5, elite.
  const eliteAllowed = room_index >= 3 && !history.elite_last_room && health !== "critical";
  if (!eliteAllowed) sets = sets.filter((s) => !s.includes("elite"));

  // Rule 6, treasure entered at most twice.
  if (history.treasures_entered >= 2) sets = sets.filter((s) => !s.includes("treasure"));

  // Rule 7, composition. Every set already contains only offerable types, so the
  // "at least one of" clause is satisfied by construction; the size bound is too.
  if (sets.length === 0) throw new Error(`no legal door set at room ${room_index}`);
  return sets;
}

export function pacingLabels(input: PacingInput & { tensions: readonly Tension[] }): PacingLabels {
  const { health, recent_damage, room_index, tensions } = input;

  let tension_cap: TensionCap = "peak_allowed";
  const lastTwoPeak = tensions.length >= 2 && tensions.slice(-2).every((t) => t === "peak");
  if (lastTwoPeak || room_index === REGULAR_ROOMS) tension_cap = "build_allowed";
  if (health === "critical" || recent_damage === "heavy") tension_cap = "release_only";

  const hazard_cap =
    health === "critical" || recent_damage === "heavy" ? "none"
    : health === "low" || recent_damage === "some" ? "low"
    : "high";

  const pressure_cap =
    tension_cap === "release_only" ? 2.0 : tension_cap === "build_allowed" ? 3.5 : 5.0;

  return { tension_cap, hazard_cap, pressure_cap };
}

/** Tensions the cap permits, always non-empty. */
export function allowedTensions(cap: TensionCap): Tension[] {
  if (cap === "release_only") return ["release"];
  if (cap === "build_allowed") return ["release", "build"];
  return ["release", "build", "peak"];
}
