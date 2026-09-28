/**
 * **The special room's chest** (doc 026): a room that asked something other
 * than "kill everything" — the first audience, the guardian, a room objective
 * — leaves a chest when it clears, beside its own reward. Opening it pays
 * `CHEST_GOLD` and one stat upgrade.
 *
 * Which stat is the Director's (doc 002): the pool is the stat door's own,
 * every entry of which any build can use, and the chest's request rides in the
 * room's round 1 beside the room's other questions, one card asked for. Code
 * decides only that there is a chest; Jev decides what is in it.
 */
import { audienceRoomFor, isFixedFightRoom } from "./doors.ts";
import { objectiveFor } from "./objectives.ts";
import type { RoomType } from "../types.ts";

/** What the chest pays in gold: a merchant's price for one stat card. */
export const CHEST_GOLD = 20;

/** The salt the chest's card request carries, so its questions are named apart from the room's reward. */
export const CHEST_SALT = "chest";

/** Whether this room leaves a chest: a fixed fight, or a fight with an objective. */
export function hasChest(seed: string, roomIndex: number, roomType: RoomType, forcedObjective = false): boolean {
  if (roomType !== "combat" && roomType !== "elite") return false;
  return isFixedFightRoom(roomIndex, audienceRoomFor(seed)) || forcedObjective || objectiveFor(seed, roomIndex, roomType) !== null;
}
