import { describe, expect, it } from "vitest";
import { PlaytestRecorder } from "./debug-panel.ts";
import type { World } from "@jr/core";

/** Just enough of a world for `sample` to count a step. */
const world = {
  player: { x: 0, y: 0, swingMs: 0, dashMs: 0 },
  stats: { shotsFired: 0, castPresses: 0, castRefusedMana: 0, manaBelowKeyMs: 0 },
  enemyBullets: [], events: [], level: 1,
} as unknown as World;

const decision = (question: string, choice: string, source = "jev") => ({
  question, choice, source, confidence: 0.8,
  probabilities: { [choice]: 0.7, other: 0.3, never: 0.001 },
});

describe("the playtest log", () => {
  it("keeps every Director answer against the room it was for, including one decided before that room began", () => {
    const log = new PlaytestRecorder();
    log.startRun({ director: "jev", style: "spam" });
    log.begin("s", 1, "combat");
    log.decide(1, "room", [decision("density", "normal")]);
    log.attach(1, (r) => { r.doors = ["spell:storm", "stat:mana"]; });
    // The next room's pacing is decided on the way out of this one.
    log.decide(2, "doors", [decision("next_tension (advisory)", "peak", "rule")]);
    log.sample(world, 16);
    log.begin("s", 2, "combat");
    log.sample(world, 16);
    const out = JSON.parse(log.json());
    expect(out.run).toEqual({ director: "jev", style: "spam" });
    expect(out.rooms[0].decisions).toEqual([
      { purpose: "room", question: "density", choice: "normal", source: "jev", confidence: 0.8, p: { normal: 0.7, other: 0.3 } },
    ]);
    expect(out.rooms[0].doors).toEqual(["spell:storm", "stat:mana"]);
    expect(out.rooms[1].decisions[0]).toMatchObject({ purpose: "doors", choice: "peak", source: "rule" });
  });

  it("starts over with each run, and leaves out a room no step was played in", () => {
    const log = new PlaytestRecorder();
    log.startRun({ director: "rule", style: "melee" });
    log.begin("a", 1, "combat");
    log.sample(world, 16);
    log.begin("a", 2, "combat");
    log.sample(world, 16);
    log.startRun({ director: "rule", style: "nuke" });
    // The title's backdrop: begun and replaced without a step.
    log.begin("b", 1, "combat");
    log.begin("b", 1, "combat");
    log.sample(world, 16);
    const out = JSON.parse(log.json());
    expect(out.run.style).toBe("nuke");
    expect(out.rooms).toHaveLength(1);
  });
});
