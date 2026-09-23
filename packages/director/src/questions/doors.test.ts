import { describe, it, expect } from "vitest";
import { buildDoorQuestions, describeDoorSet, doorSetKey, parseDoorSetKey } from "./doors.ts";
import { ruleDoorWeights, ruleTensionWeights, randomDoorWeights, normalise } from "../rule.ts";
import { FALLBACK } from "../types.ts";
import { legalDoorSets, allowedTensions, sampleOne, RngSource } from "@jr/core";
import type { SummaryLabels, RunHistory } from "@jr/core";

const history: RunHistory = {
  rooms: [], tensions: [], profiles: [], spaces: [], counter_scores: [],
  shop_entered: false, rests_entered: 0, treasures_entered: 0,
  elite_last_room: false, shielded_rooms: 0,
};

const labels = (over: Partial<SummaryLabels> = {}): SummaryLabels => ({
  health: "ok", recent_damage: "none", clear_speed: "normal",
  movement_pressure_recent: "light", run_progress: "mid", gold: "ok",
  tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
  build: { archetype: "area", bottleneck: "accuracy", mana_sustain: "tight", range: "long", missing_roles: ["tracking"], dominant_tags: ["area"] },
  preference: { dominant: ["area"], consistency: "on_plan" },
  ...over,
});

const sets = legalDoorSets({ room_index: 4, history, health: "ok", recent_damage: "none", rest_owed: false });

describe("door questions", () => {
  it("offers whole sets as options, so three doors cannot come out identical", () => {
    const q = buildDoorQuestions(sets, labels());
    const keys = Object.keys(q.door_set!.criteria).filter((k) => k !== FALLBACK);
    expect(keys.length).toBe(sets.length);
    for (const k of keys) expect(new Set(parseDoorSetKey(k)).size).toBe(parseDoorSetKey(k).length);
  });

  it("always carries the escape option", () => {
    const q = buildDoorQuestions(sets, labels());
    expect(q.door_set!.criteria[FALLBACK]).toBeTruthy();
  });

  it("does not ask about tension when only one is permitted", () => {
    expect(buildDoorQuestions(sets, labels({ tension_cap: "release_only" })).next_tension).toBeUndefined();
    expect(buildDoorQuestions(sets, labels({ tension_cap: "peak_allowed" })).next_tension).toBeDefined();
  });

  it("offers exactly the permitted tensions plus the escape", () => {
    const q = buildDoorQuestions(sets, labels({ tension_cap: "build_allowed" }));
    expect(Object.keys(q.next_tension!.criteria).sort()).toEqual([FALLBACK, "build", "release"].sort());
  });

  it("describes each type's consequence in the label vocabulary", () => {
    const text = describeDoorSet(["combat", "rest"], labels({ health: "low" }));
    expect(text).toContain("combat");
    expect(text).toContain("rest");
    expect(text).toMatch(/low health/);
  });

  it("round-trips a set key", () => {
    expect(parseDoorSetKey(doorSetKey(["combat", "rest"]))).toEqual(["combat", "rest"]);
  });

  it("refuses to build a question with no legal set", () => {
    expect(() => buildDoorQuestions([], labels())).toThrow();
  });
});

describe("rule and random weights", () => {
  it("both produce valid distributions over exactly the legal sets", () => {
    for (const dist of [ruleDoorWeights(sets, labels()), randomDoorWeights(sets)]) {
      expect(Object.keys(dist).sort()).toEqual(sets.map(doorSetKey).sort());
      expect(Object.values(dist).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
  });

  it("the rule table responds to state where random does not", () => {
    const hurt = labels({ health: "low", recent_damage: "heavy" });
    const restSets = sets.filter((s) => s.includes("rest")).map(doorSetKey);
    const ruleHurt = ruleDoorWeights(sets, hurt);
    const ruleWell = ruleDoorWeights(sets, labels({ health: "full" }));
    const restMass = (d: Record<string, number>) => restSets.reduce((a, k) => a + (d[k] ?? 0), 0);
    expect(restMass(ruleHurt)).toBeGreaterThan(restMass(ruleWell));
    expect(restMass(randomDoorWeights(sets))).toBeCloseTo(restMass(randomDoorWeights(sets)), 10);
  });

  it("the rule table pushes elite when healthy and away from it when hurt", () => {
    const eliteSets = sets.filter((s) => s.includes("elite")).map(doorSetKey);
    const mass = (d: Record<string, number>) => eliteSets.reduce((a, k) => a + (d[k] ?? 0), 0);
    expect(mass(ruleDoorWeights(sets, labels({ health: "full" }))))
      .toBeGreaterThan(mass(ruleDoorWeights(sets, labels({ health: "low", recent_damage: "heavy" }))));
  });

  it("tension weights favour release after heavy damage and peak after fast clears", () => {
    const allowed = allowedTensions("peak_allowed");
    expect(ruleTensionWeights(allowed, labels({ recent_damage: "heavy" })).release!)
      .toBeGreaterThan(ruleTensionWeights(allowed, labels({ clear_speed: "fast" })).release!);
    expect(ruleTensionWeights(allowed, labels({ clear_speed: "fast" })).peak!)
      .toBeGreaterThan(ruleTensionWeights(allowed, labels({ clear_speed: "slow" })).peak!);
  });

  it("is sampled, not argmaxed, so the control keeps roguelike variance too", () => {
    const dist = ruleDoorWeights(sets, labels());
    const src = new RngSource("seed");
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(sampleOne(dist, src.stream("doors", i)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("normalise survives an all-zero table instead of dividing by zero", () => {
    const d = normalise({ a: 0, b: 0 });
    expect(d.a).toBeCloseTo(0.5, 10);
  });
});
