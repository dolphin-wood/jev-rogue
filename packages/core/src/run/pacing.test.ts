import { describe, it, expect } from "vitest";
import { legalDoorSets, pacingLabels, allowedTensions, REGULAR_ROOMS } from "./pacing.ts";
import type { RunHistory, RoomType } from "../types.ts";

const base: RunHistory = {
  rooms: [], tensions: [], profiles: [], spaces: [], counter_scores: [],
  shop_entered: false, rests_entered: 0, treasures_entered: 0,
  elite_last_room: false, shielded_rooms: 0,
};

const input = (over: Partial<Parameters<typeof legalDoorSets>[0]> = {}) => ({
  room_index: 4, history: base, health: "ok" as const,
  recent_damage: "none" as const, rest_owed: false, ...over,
});

const has = (sets: readonly (readonly RoomType[])[], t: RoomType) => sets.some((s) => s.includes(t));
const all = (sets: readonly (readonly RoomType[])[], t: RoomType) => sets.every((s) => s.includes(t));

describe("legalDoorSets precedence", () => {
  it("rule 1: the set after room 9 is exactly [boss], and rules 3..7 do not apply", () => {
    const sets = legalDoorSets(input({ room_index: REGULAR_ROOMS, rest_owed: true, health: "critical" }));
    expect(sets).toEqual([["boss"]]);
  });

  it("boss never appears before the terminal set", () => {
    for (let r = 1; r < REGULAR_ROOMS; r++)
      expect(has(legalDoorSets(input({ room_index: r })), "boss")).toBe(false);
  });

  it("rule 2: shop is forced from room 6 until entered, then never offered again", () => {
    expect(all(legalDoorSets(input({ room_index: 6 })), "shop")).toBe(true);
    expect(all(legalDoorSets(input({ room_index: 8 })), "shop")).toBe(true);
    const entered = legalDoorSets(input({ room_index: 8, history: { ...base, shop_entered: true } }));
    expect(has(entered, "shop")).toBe(false);
  });

  it("rule 4: when shop and rest both force, the set is exactly [shop, rest]", () => {
    const sets = legalDoorSets(input({ room_index: 7, rest_owed: true }));
    expect(sets).toEqual([["shop", "rest"]]);
  });

  it("rule 3: rest is forced when owed and unavailable before room 3", () => {
    expect(all(legalDoorSets(input({ room_index: 4, rest_owed: true })), "rest")).toBe(true);
    expect(has(legalDoorSets(input({ room_index: 2 })), "rest")).toBe(false);
  });

  it("rule 5: elite needs room 3, no elite last room, and health above critical", () => {
    expect(has(legalDoorSets(input({ room_index: 2 })), "elite")).toBe(false);
    expect(has(legalDoorSets(input({ room_index: 4 })), "elite")).toBe(true);
    expect(has(legalDoorSets(input({ room_index: 4, history: { ...base, elite_last_room: true } })), "elite")).toBe(false);
    expect(has(legalDoorSets(input({ room_index: 4, health: "critical" })), "elite")).toBe(false);
  });

  it("rule 6: treasure disappears after two have been entered", () => {
    expect(has(legalDoorSets(input({ history: { ...base, treasures_entered: 2 } })), "treasure")).toBe(false);
  });

  it("rule 7: every set has 1 to 3 distinct offerable types", () => {
    for (let r = 1; r < REGULAR_ROOMS; r++)
      for (const set of legalDoorSets(input({ room_index: r }))) {
        expect(set.length).toBeGreaterThanOrEqual(1);
        expect(set.length).toBeLessThanOrEqual(3);
        expect(new Set(set).size).toBe(set.length);
        expect(set.every((t) => t !== "boss")).toBe(true);
      }
  });

  it("the enumeration is never empty on any reachable state", () => {
    for (let r = 1; r <= REGULAR_ROOMS; r++)
      for (const shop of [false, true])
        for (const rest_owed of [false, true])
          for (const health of ["critical", "low", "ok", "full"] as const)
            for (const treasures of [0, 1, 2])
              for (const elite_last_room of [false, true]) {
                const sets = legalDoorSets(input({
                  room_index: r, rest_owed, health,
                  history: { ...base, shop_entered: shop, treasures_entered: treasures, elite_last_room },
                }));
                expect(sets.length).toBeGreaterThan(0);
              }
  });
});

describe("pacingLabels", () => {
  const p = (over: Partial<Parameters<typeof pacingLabels>[0]> = {}) =>
    pacingLabels({ ...input(), tensions: [], ...over });

  it("peak is disallowed twice in a row", () => {
    expect(p({ tensions: ["peak", "peak"] }).tension_cap).toBe("build_allowed");
    expect(p({ tensions: ["peak", "build"] }).tension_cap).toBe("peak_allowed");
  });

  it("peak is disallowed in the last regular room", () => {
    expect(p({ room_index: REGULAR_ROOMS }).tension_cap).toBe("build_allowed");
  });

  it("critical health or heavy damage forces release only", () => {
    expect(p({ health: "critical" }).tension_cap).toBe("release_only");
    expect(p({ recent_damage: "heavy" }).tension_cap).toBe("release_only");
  });

  it("hazard cap tracks health and damage", () => {
    expect(p({ health: "critical" }).hazard_cap).toBe("none");
    expect(p({ health: "low" }).hazard_cap).toBe("low");
    expect(p({ health: "full" }).hazard_cap).toBe("high");
  });

  it("pressure cap follows the tension cap", () => {
    expect(p({ health: "critical" }).pressure_cap).toBe(2.0);
    expect(p({ room_index: REGULAR_ROOMS }).pressure_cap).toBe(3.5);
    expect(p().pressure_cap).toBe(5.0);
  });

  it("allowedTensions is never empty and respects the cap", () => {
    expect(allowedTensions("release_only")).toEqual(["release"]);
    expect(allowedTensions("build_allowed")).not.toContain("peak");
    expect(allowedTensions("peak_allowed")).toContain("peak");
  });
});
