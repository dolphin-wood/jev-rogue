import { describe, it, expect } from "vitest";
import {
  enterRoom, stepRoom, observeEnemies, isCleared, pendingWaves,
  startEncounter, tickEncounter, isPeaceful, ENTERING_MS,
} from "./machine.ts";
import type { EncounterPlan } from "../types.ts";
import type { RoomPhase, RoomState } from "./machine.ts";

const plan: EncounterPlan = {
  profile: { composition: "mixed", density: "normal", wave_structure: "steady", anchor: "none", entry: "far_front" },
  waves: [
    { at_ms: 0, spawns: [{ archetype: "rusher", spawn_group: "far", count: 2 }] },
    { at_ms: 2500, spawns: [{ archetype: "shooter", spawn_group: "far", count: 1 }] },
  ],
  measured_pressure: 2.5,
  band: [2, 3.5],
  elite_affixes: [],
  source: "rule",
};

/** Runs until the phase changes, applying observed enemy counts each step. */
function runUntil(
  state: RoomState,
  target: RoomPhase,
  living: (s: RoomState) => [number, number],
  maxSteps = 1000,
): RoomState {
  let s = state;
  for (let i = 0; i < maxSteps; i++) {
    if (s.phase === target) return s;
    const [enemies, summoners] = living(s);
    s = observeEnemies(s, enemies, summoners);
    s = stepRoom(s, 100).state;
  }
  throw new Error(`never reached ${target}, stuck in ${s.phase}`);
}

describe("clear condition", () => {
  it("does not clear while a wave is still pending, even with nothing alive", () => {
    let rt = startEncounter(plan);
    rt = { ...tickEncounter(rt, 100).runtime, livingEnemies: 0, livingSummoners: 0 };
    expect(pendingWaves(rt)).toBe(1);
    expect(isCleared(rt)).toBe(false);
  });

  it("clears once every wave has spawned and nothing is alive", () => {
    let rt = startEncounter(plan);
    rt = tickEncounter(rt, 3000).runtime;
    rt = { ...rt, livingEnemies: 0, livingSummoners: 0 };
    expect(pendingWaves(rt)).toBe(0);
    expect(isCleared(rt)).toBe(true);
  });

  it("does not clear while a summoner lives, because it keeps producing", () => {
    let rt = startEncounter(plan);
    rt = { ...tickEncounter(rt, 3000).runtime, livingEnemies: 0, livingSummoners: 1 };
    expect(isCleared(rt)).toBe(false);
  });

  it("releases each wave exactly once, at or after its time", () => {
    let rt = startEncounter(plan);
    const first = tickEncounter(rt, 50);
    expect(first.released).toHaveLength(1);
    rt = first.runtime;
    expect(tickEncounter(rt, 100).released).toHaveLength(0);
    rt = tickEncounter(rt, 100).runtime;
    const second = tickEncounter(rt, 2500);
    expect(second.released).toHaveLength(1);
    expect(tickEncounter(second.runtime, 5000).released).toHaveLength(0);
  });
});

describe("room state machine", () => {
  it("a combat room cannot open its doors before the delayed wave has fought", () => {
    let s = enterRoom("combat", plan);
    // Kill the first wave immediately and stay empty; the second wave is still owed.
    s = runUntil(s, "FIGHTING", () => [0, 0]);
    let steps = 0;
    while (s.phase === "FIGHTING" && steps < 20) {
      s = observeEnemies(s, 0, 0);
      s = stepRoom(s, 100).state;
      steps++;
      if (s.phase === "CLEARED") break;
    }
    // 20 steps of 100 ms is 2 s, still short of the 2.5 s wave.
    expect(s.phase).toBe("FIGHTING");
    expect(pendingWaves(s.encounter!)).toBe(1);
  });

  it("reaches CLEARED only after the last wave has spawned and died", () => {
    let s = enterRoom("combat", plan);
    s = runUntil(s, "CLEARED", (st) => [st.encounter && pendingWaves(st.encounter) > 0 ? 1 : 0, 0]);
    expect(s.phase).toBe("CLEARED");
    expect(pendingWaves(s.encounter!)).toBe(0);
  });

  it("a peaceful room goes straight from ENTERING to REWARDING", () => {
    let s = enterRoom("shop", null);
    expect(isPeaceful("shop")).toBe(true);
    s = stepRoom(s, ENTERING_MS).state;
    expect(s.phase).toBe("REWARDING");
  });

  it("holds ENTERING for the full beat before locking", () => {
    let s = enterRoom("combat", plan);
    s = stepRoom(s, ENTERING_MS - 1).state;
    expect(s.phase).toBe("ENTERING");
    s = stepRoom(s, 2).state;
    expect(s.phase).toBe("LOCKED");
  });

  it("waits in REWARDING until the reward is taken, then in DOORS_OPEN until a door is chosen", () => {
    let s: RoomState = { ...enterRoom("treasure", null), phase: "REWARDING", phaseMs: 0 };
    s = stepRoom(s, 5000).state;
    expect(s.phase).toBe("REWARDING");
    s = stepRoom({ ...s, rewardDone: true }, 100).state;
    expect(s.phase).toBe("DOORS_OPEN");
    s = stepRoom(s, 5000).state;
    expect(s.phase).toBe("DOORS_OPEN");
    s = stepRoom({ ...s, doorChosen: true }, 100).state;
    expect(s.phase).toBe("TRANSITION");
  });

  it("a room with no encounter clears immediately rather than hanging", () => {
    let s = enterRoom("combat", null);
    s = runUntil(s, "REWARDING", () => [0, 0]);
    expect(s.phase).toBe("REWARDING");
  });
});
