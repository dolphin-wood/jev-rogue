/**
 * **Room objectives** (doc 025): a fight with another way to end it.
 *
 * - **hold**: survive `HOLD_MS` while the room keeps sending bodies; when the
 *   time is up, whatever still stands falls.
 * - **destroy**: three turrets stand marked as targets, and the room keeps
 *   sending bodies until all three are down; then whatever still stands falls.
 *
 * An objective is drawn by code from the run's seed, never promised on a door:
 * a door promises a reward and a difficulty (doc 003), and a room that asks
 * something else of the player is found out on entering it. Only ordinary
 * fights from room 3 on carry one, never two rooms running, never an elite or
 * a fixed fight.
 */
import { RUN_COMBAT_ROOMS, audienceRoomFor, isFixedFightRoom } from "./doors.ts";
import type { RoomType } from "../types.ts";

export type RoomObjective = "hold" | "destroy";
export const ROOM_OBJECTIVES: readonly RoomObjective[] = ["hold", "destroy"];

/** A room's chance of an objective, before the rule that none follows another. */
export const OBJECTIVE_CHANCE = 0.25;
/** The first room one may fall in: the opening two rooms are where a build is learned. */
export const OBJECTIVE_FIRST_ROOM = 3;

function roll(seed: string, roomIndex: number, salt: string): number {
  let h = 2166136261;
  const s = `${seed}|${roomIndex}|${salt}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function eligible(seed: string, roomIndex: number): boolean {
  return roomIndex >= OBJECTIVE_FIRST_ROOM && roomIndex <= RUN_COMBAT_ROOMS
    && !isFixedFightRoom(roomIndex, audienceRoomFor(seed));
}

function drawn(seed: string, roomIndex: number): RoomObjective | null {
  if (!eligible(seed, roomIndex) || roll(seed, roomIndex, "objective") >= OBJECTIVE_CHANCE) return null;
  return ROOM_OBJECTIVES[Math.floor(roll(seed, roomIndex, "kind") * ROOM_OBJECTIVES.length)]!;
}

/**
 * This room's objective, or null: drawn from the run's seed and the room's
 * place, for an ordinary fight only, and never straight after one.
 */
export function objectiveFor(seed: string, roomIndex: number, roomType: RoomType): RoomObjective | null {
  if (roomType !== "combat") return null;
  if (drawn(seed, roomIndex - 1)) return null;
  return drawn(seed, roomIndex);
}
