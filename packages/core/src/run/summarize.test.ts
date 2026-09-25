import { describe, it, expect } from "vitest";
import {
  bucketHealth, bucketRecentDamage, bucketClearSpeed, bucketGold, bucketRunProgress,
  bucketConsistency, dominantTags, showcaseRatio, showcaseRatioWith,
  countersWouldBreachFloor, assertNoRawNumbers, summarize, SHOWCASE_FLOOR,
  bucketMovementPressure, expectedClearMs, expectedClearMsFor, NEAR_BULLET_HEAVY,
} from "./summarize.ts";
import type { CounterScore } from "../types.ts";

describe("buckets", () => {
  it("maps hearts to health with critical at one heart", () => {
    expect(bucketHealth(0)).toBe("critical");
    expect(bucketHealth(1)).toBe("critical");
    expect(bucketHealth(3)).toBe("low");
    expect(bucketHealth(5)).toBe("ok");
    expect(bucketHealth(6)).toBe("full");
  });

  it("maps damage, speed, gold and progress", () => {
    expect(bucketRecentDamage(0)).toBe("none");
    expect(bucketRecentDamage(2)).toBe("some");
    expect(bucketRecentDamage(3)).toBe("heavy");
    expect(bucketClearSpeed(30, 60)).toBe("fast");
    expect(bucketClearSpeed(60, 60)).toBe("normal");
    expect(bucketClearSpeed(120, 60)).toBe("slow");
    expect(bucketGold(0)).toBe("poor");
    expect(bucketGold(30)).toBe("ok");
    expect(bucketGold(100)).toBe("rich");
    // The fourteen-fight run of doc 014, not the nine-room shape that is gone.
    expect(bucketRunProgress(1)).toBe("early");
    expect(bucketRunProgress(4)).toBe("early");
    expect(bucketRunProgress(5)).toBe("mid");
    expect(bucketRunProgress(9)).toBe("mid");
    expect(bucketRunProgress(10)).toBe("late");
    expect(bucketRunProgress(13)).toBe("late");
    expect(bucketRunProgress(14)).toBe("pre_boss");
    expect(bucketRunProgress(16)).toBe("pre_boss");
  });

  /*
   * Doc 011: `clear_speed` was measured against a flat thirty seconds, which is
   * the reference player's pace and nobody else's, so every room a person
   * played read `slow`.
   */
  it("measures a room against what a person takes, and then against this player", () => {
    /*
     * The human baseline, recalibrated against a full played run: sixteen
     * rooms in 10:06, so about 38 seconds a fight with a longer opening one.
     * That run reads `normal`, not `fast` and not `slow` — a label that is
     * pinned either way is one the Director cannot use.
     */
    expect(bucketClearSpeed(55_000, expectedClearMs(1))).toBe("normal");
    expect(bucketClearSpeed(38_000, expectedClearMs(6))).toBe("normal");
    expect(bucketClearSpeed(65_000, expectedClearMs(16))).toBe("normal");
    // And a room that really does go badly still reads slow.
    expect(bucketClearSpeed(105_000, expectedClearMs(6))).toBe("slow");
    expect(bucketClearSpeed(105_000, 30_000)).toBe("slow");
    // It falls after the opening rooms and rises again at the boss.
    expect(expectedClearMs(6)).toBeLessThan(expectedClearMs(1));
    expect(expectedClearMs(16)).toBeGreaterThan(expectedClearMs(14));
    // With three cleared rooms behind it, the expectation is this player's own
    // median, so a fast player's slow room still reads slow.
    const fast = [20_000, 24_000, 22_000];
    expect(expectedClearMsFor(6, fast)).toBe(22_000);
    expect(bucketClearSpeed(32_000, expectedClearMsFor(6, fast))).toBe("slow");
    expect(bucketClearSpeed(22_000, expectedClearMsFor(6, fast))).toBe("normal");
    // Before there is a run to read, the baseline stands.
    expect(expectedClearMsFor(6, [20_000, 24_000])).toBe(expectedClearMs(6));
    // And a degenerate run cannot redefine the scale without limit.
    expect(expectedClearMsFor(6, [200, 200, 200])).toBeGreaterThan(200);
    expect(expectedClearMsFor(6, [9e6, 9e6, 9e6])).toBeLessThan(9e6);
  });

  it("reads movement pressure off the time spent under fire", () => {
    expect(bucketMovementPressure(0)).toBe("light");
    expect(bucketMovementPressure(NEAR_BULLET_HEAVY - 0.01)).toBe("light");
    expect(bucketMovementPressure(NEAR_BULLET_HEAVY)).toBe("heavy");
  });

  it("calls two consecutive off-plan picks a pivot", () => {
    expect(bucketConsistency([["spam"], ["spam"]], "spam")).toBe("on_plan");
    expect(bucketConsistency([["spam"], ["area"]], "spam")).toBe("drifting");
    expect(bucketConsistency([["area"], ["area"]], "spam")).toBe("pivoted");
  });

  it("orders dominant tags by count then name", () => {
    expect(dominantTags({ a: 1, b: 3, c: 3, d: 0 })).toEqual(["b", "c", "a"]);
  });
});

describe("showcase floor", () => {
  const s = (showcase: number, counters: number): CounterScore[] => [
    ...Array<CounterScore>(showcase).fill("neutral"),
    ...Array<CounterScore>(counters).fill("counters"),
  ];

  it("counts favours and neutral as showcase, counters as not", () => {
    expect(showcaseRatio(["favours", "neutral", "counters"])).toBeCloseTo(2 / 3, 10);
  });

  it("is prospective: at 2 of 5 a further counter would give 2 of 6 and breaches", () => {
    const history = s(2, 3);
    expect(showcaseRatio(history)).toBeCloseTo(0.4, 10);
    expect(showcaseRatioWith(history, "counters")).toBeCloseTo(2 / 6, 10);
    expect(countersWouldBreachFloor(history)).toBe(true);
  });

  it("allows a counter at 3 of 5, which would give 3 of 6", () => {
    const history = s(3, 2);
    expect(showcaseRatioWith(history, "counters")).toBeCloseTo(0.5, 10);
    expect(countersWouldBreachFloor(history)).toBe(false);
  });

  it("never lets a run walk below the floor one room at a time", () => {
    let history: CounterScore[] = [];
    for (let i = 0; i < 20; i++) {
      const next: CounterScore = countersWouldBreachFloor(history) ? "neutral" : "counters";
      history = [...history, next];
      expect(showcaseRatio(history)).toBeGreaterThanOrEqual(SHOWCASE_FLOOR - 1e-9);
    }
  });

  it("forces the first combat room of a run to be a showcase room", () => {
    // 0 showcase of 1 is 0%, below the floor, so a prospective check can never
    // allow the opening room to counter. This is intended, not an edge case.
    expect(showcaseRatio([])).toBe(1);
    expect(countersWouldBreachFloor([])).toBe(true);
  });

  it("settles between 40 and 60 percent showcase over a full run", () => {
    let history: CounterScore[] = [];
    for (let i = 0; i < 6; i++)
      history = [...history, countersWouldBreachFloor(history) ? "neutral" : "counters"];
    const ratio = showcaseRatio(history);
    expect(ratio).toBeGreaterThanOrEqual(SHOWCASE_FLOOR);
    expect(ratio).toBeLessThanOrEqual(0.6);
  });
});

describe("assertNoRawNumbers", () => {
  it("accepts a label-only state", () => {
    expect(() => assertNoRawNumbers({ health: "low", build: { archetype: "area" }, tags: ["a"] })).not.toThrow();
  });
  it("rejects a raw number and names the path", () => {
    expect(() => assertNoRawNumbers({ build: { hp: 37 } })).toThrow(/state\.build\.hp/);
  });
  it("rejects a number nested in an array", () => {
    expect(() => assertNoRawNumbers({ xs: ["a", 2] })).toThrow(/state\.xs\[1\]/);
  });
});

describe("summarize", () => {
  it("produces only labels, with pressure_cap the single permitted number", () => {
    const labels = summarize(
      {
        hearts: 3, heartsLostLastTwoRooms: 1, lastClearMs: 40, expectedClearMs: 60,
        nearMissesPerSecond: 0.2, gold: 30, roomIndex: 5,
        recentPickTags: [["area"]], tagCounts: { area: 2, control: 1 }, preset: "area",
        build: { range: "long" },
        tensions: ["build"],
      },
      { tension_cap: "build_allowed", hazard_cap: "low", pressure_cap: 3.5 },
    );
    expect(labels.health).toBe("low");
    expect(labels.clear_speed).toBe("fast");
    expect(labels.preference.consistency).toBe("on_plan");
    const { pressure_cap, ...rest } = labels;
    expect(pressure_cap).toBe(3.5);
    expect(() => assertNoRawNumbers(rest)).not.toThrow();
  });
});
