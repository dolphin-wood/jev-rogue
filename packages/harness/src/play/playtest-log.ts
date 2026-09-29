/**
 * The playtest log (design doc 011, "Calibration against real play").
 *
 * One shape, written by two writers: the browser records it while a person
 * plays, and the harness records it while a profile plays. That is the whole
 * point — a real session and a simulated one have to be the same kind of
 * object before "the novice profile is twice as fast as the person it is meant
 * to model" is a sentence anybody can check.
 *
 * Everything in it is either something the simulation already reports
 * (`World.stats`, the `player_hit` cause strings, the `enemy_killed` events) or
 * a count of keys pressed. Nothing here re-derives what the sim knows.
 *
 * Health is in **HP**, not hearts: that is what the bar shows and what a person
 * reports ("I lost 23 of 60"), and a log meant to be compared against what
 * somebody says about their session should use their units.
 */

import type { RoomBalance } from "@jr/core";

/** A heart is ten HP, as the HUD draws it. */
export const HP_PER_HEART = 10;

/** How near an enemy bullet has to be to count as pressure. See `nearMs`. */
export const NEAR_BULLET_PX = 90;

export interface RoomLog {
  readonly index: number;
  /** `combat`, `elite`, `boss`, `shop`. */
  readonly type: string;
  /** How long the room took, in ms. */
  readonly ms: number;
  /** Total HP lost in the room. */
  readonly hpLost: number;
  /**
   * HP lost by source, keyed by the simulation's own cause strings —
   * `melee:tank`, `bullet:shooter`, `hazard:spikes`, `dot:burn`. The keys are
   * not an invention of this log: they are what `player_hit` publishes, so a
   * source that is renamed in the sim is renamed here with it.
   */
  readonly bySource: Readonly<Record<string, number>>;
  readonly kills: number;
  /**
   * The body's level at the end of the room (`run/levels.ts`). Optional, so a
   * log exported before levels existed is still a log worth reading.
   */
  readonly level?: number;
  readonly dashes: number;
  readonly casts: number;
  readonly swings: number;
  /** How long an enemy bullet was within `NEAR_BULLET_PX`, in ms. */
  readonly nearMs: number;
  /**
   * **The mana economy, as the player met it** (doc 011): presses of a key
   * holding a spell, how many the bar refused for cost, and how long the bar
   * spent under the cheapest key's cost. Optional, because a log exported
   * before these existed is still a log worth reading.
   */
  readonly castPresses?: number;
  readonly castRefusedMana?: number;
  readonly manaShortMs?: number;
  /*
   * **What balance is read from**, as `RoomWatch` (`sim/room-watch.ts`)
   * writes it in both logs: the build, health in and out, damage dealt by
   * source, casts and mana by spell, kill times by archetype, statuses.
   * Optional, for logs exported before they existed.
   */
  readonly build?: RoomBalance["build"];
  readonly hp?: RoomBalance["hp"];
  readonly dealtBy?: RoomBalance["dealtBy"];
  readonly castsBy?: RoomBalance["castsBy"];
  readonly manaBy?: RoomBalance["manaBy"];
  readonly killTime?: RoomBalance["killTime"];
  readonly statuses?: RoomBalance["statuses"];
}

export interface PlaytestLog {
  /** `game` for a person's session, `harness` for a profile's. */
  readonly source: "game" | "harness";
  /** The skill profile, for a harness log; absent for a person. */
  readonly profile?: string;
  readonly seed: string;
  /** When it was recorded, ISO 8601, for telling two sessions apart. */
  readonly at: string;
  readonly rooms: readonly RoomLog[];
}

/**
 * The three families a source string falls into, so a log can answer "how much
 * of this was ranged" without knowing every archetype.
 *
 * Ranged damage is the share that separates a person from the reference player
 * most sharply: the model strafes bullets it has no business dodging, so its
 * damage is nearly all melee, while a new player is shot from across the room.
 */
export type DamageFamily = "ranged" | "melee" | "hazard";

export function familyOf(cause: string): DamageFamily {
  if (cause.startsWith("melee:") || cause.startsWith("contact:")) return "melee";
  if (cause.startsWith("hazard:") || cause.startsWith("dot:") || cause.startsWith("status:")) return "hazard";
  // Everything else is something that was fired or thrown: `bullet:*`, the
  // musket, the lobs, the rifts. Grouped as ranged because that is what it is
  // from the floor, whatever the sim calls the emitter.
  return "ranged";
}

/** HP lost per family, over a set of rooms. */
export function byFamily(rooms: readonly RoomLog[]): Record<DamageFamily, number> {
  const out: Record<DamageFamily, number> = { ranged: 0, melee: 0, hazard: 0 };
  for (const r of rooms)
    for (const [cause, hp] of Object.entries(r.bySource)) out[familyOf(cause)] += hp;
  return out;
}

/**
 * A blank room's counters, so both writers start from the same object and a
 * field added here has to be filled in both.
 */
export function emptyRoom(index: number, type: string): {
  index: number; type: string; ms: number; hpLost: number;
  bySource: Record<string, number>; kills: number; level: number;
  dashes: number; casts: number; swings: number; nearMs: number;
  castPresses: number; castRefusedMana: number; manaShortMs: number;
} {
  return {
    index, type, ms: 0, hpLost: 0, bySource: {}, kills: 0, level: 1, dashes: 0, casts: 0, swings: 0, nearMs: 0,
    castPresses: 0, castRefusedMana: 0, manaShortMs: 0,
  };
}
