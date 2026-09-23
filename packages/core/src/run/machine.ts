/**
 * Room state machine (design doc 003). The clear condition is the subtle part:
 * a room whose encounter schedules a wave at 2.5 s can have zero living
 * enemies at 1 s, and treating that as cleared would open the doors before the
 * fight had happened, then spawn enemies into a cleared room.
 */
import type { EncounterPlan, RoomType, Wave } from "../types.ts";

export type RoomPhase =
  | "ENTERING" | "LOCKED" | "FIGHTING" | "CLEARED"
  | "REWARDING" | "DOORS_OPEN" | "TRANSITION";

export const ENTERING_MS = 500;

/** Room types that never enter FIGHTING. */
const PEACEFUL: readonly RoomType[] = ["treasure", "shop", "rest"];

export function isPeaceful(type: RoomType): boolean {
  return PEACEFUL.includes(type);
}

export interface EncounterRuntime {
  readonly waves: readonly Wave[];
  /** Wave indices already spawned. */
  readonly spawned: ReadonlySet<number>;
  readonly elapsedMs: number;
  readonly livingEnemies: number;
  /** Summoners keep producing, so the room is not clear while one lives. */
  readonly livingSummoners: number;
}

export function startEncounter(plan: EncounterPlan): EncounterRuntime {
  return { waves: plan.waves, spawned: new Set(), elapsedMs: 0, livingEnemies: 0, livingSummoners: 0 };
}

export interface WaveRelease {
  readonly runtime: EncounterRuntime;
  /** Waves whose time has come on this step; the caller spawns them. */
  readonly released: readonly Wave[];
}

export function tickEncounter(rt: EncounterRuntime, dtMs: number): WaveRelease {
  const elapsedMs = rt.elapsedMs + dtMs;
  const spawned = new Set(rt.spawned);
  const released: Wave[] = [];
  rt.waves.forEach((w, i) => {
    if (!spawned.has(i) && w.at_ms <= elapsedMs) {
      spawned.add(i);
      released.push(w);
    }
  });
  return { runtime: { ...rt, elapsedMs, spawned }, released };
}

export function pendingWaves(rt: EncounterRuntime): number {
  return rt.waves.length - rt.spawned.size;
}

/** All three conditions, not just "no enemies alive" (doc 003). */
export function isCleared(rt: EncounterRuntime): boolean {
  return rt.livingEnemies === 0 && pendingWaves(rt) === 0 && rt.livingSummoners === 0;
}

export interface RoomState {
  readonly phase: RoomPhase;
  readonly type: RoomType;
  readonly phaseMs: number;
  readonly encounter: EncounterRuntime | null;
  /** Set once the reward or shop interaction is done. */
  readonly rewardDone: boolean;
  /** Set once the player walks through a door. */
  readonly doorChosen: boolean;
}

export function enterRoom(type: RoomType, encounter: EncounterPlan | null): RoomState {
  return {
    phase: "ENTERING",
    type,
    phaseMs: 0,
    encounter: encounter ? startEncounter(encounter) : null,
    rewardDone: false,
    doorChosen: false,
  };
}

/**
 * One transition step. Pure: the caller applies `released` waves and reports
 * living counts back through `encounter` before the next call.
 */
export function stepRoom(state: RoomState, dtMs: number): { state: RoomState; released: readonly Wave[] } {
  const phaseMs = state.phaseMs + dtMs;
  let released: readonly Wave[] = [];
  let encounter = state.encounter;

  switch (state.phase) {
    case "ENTERING":
      if (phaseMs < ENTERING_MS) return { state: { ...state, phaseMs }, released };
      // A peaceful room skips the fight entirely and goes straight to its reward.
      return {
        state: { ...state, phase: isPeaceful(state.type) || !encounter ? "REWARDING" : "LOCKED", phaseMs: 0 },
        released,
      };

    case "LOCKED":
      return { state: { ...state, phase: "FIGHTING", phaseMs: 0 }, released };

    case "FIGHTING": {
      if (encounter) {
        const tick = tickEncounter(encounter, dtMs);
        encounter = tick.runtime;
        released = tick.released;
      }
      const cleared = encounter ? isCleared(encounter) : true;
      return {
        state: { ...state, phase: cleared ? "CLEARED" : "FIGHTING", phaseMs: cleared ? 0 : phaseMs, encounter },
        released,
      };
    }

    case "CLEARED":
      return { state: { ...state, phase: "REWARDING", phaseMs: 0 }, released };

    case "REWARDING":
      return state.rewardDone
        ? { state: { ...state, phase: "DOORS_OPEN", phaseMs: 0 }, released }
        : { state: { ...state, phaseMs }, released };

    case "DOORS_OPEN":
      return state.doorChosen
        ? { state: { ...state, phase: "TRANSITION", phaseMs: 0 }, released }
        : { state: { ...state, phaseMs }, released };

    case "TRANSITION":
      return { state: { ...state, phaseMs }, released };
  }
}

/** Reports living counts back into the runtime after the caller has simulated. */
export function observeEnemies(state: RoomState, living: number, summoners: number): RoomState {
  if (!state.encounter) return state;
  return { ...state, encounter: { ...state.encounter, livingEnemies: living, livingSummoners: summoners } };
}
