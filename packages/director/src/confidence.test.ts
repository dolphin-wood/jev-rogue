/**
 * **Jev's answer read the way TypeSafe documents it**: its `choice` when it is
 * confident, its distribution as given when it is not.
 */
import { describe, expect, it } from "vitest";
import { JEV_CONFIDENT, choiceConfidence } from "./director.ts";

describe("choiceConfidence", () => {
  it("is TypeSafe's statistic: 1 on a single peak, 0 on a flat spread", () => {
    expect(choiceConfidence({ a: 1, b: 0, c: 0 })).toBe(1);
    expect(choiceConfidence({ a: 0.5, b: 0.5 })).toBe(0);
    expect(choiceConfidence({ a: 1 / 3, b: 1 / 3, c: 1 / 3 })).toBeCloseTo(0, 10);
  });

  it("matches the worked example in TypeSafe's Choice docs", () => {
    // returns 0.61, billing 0.35, shipping 0.04 → confidence 0.42
    expect(choiceConfidence({ returns: 0.61, billing: 0.35, shipping: 0.04 })).toBeCloseTo(0.415, 3);
  });

  it("puts the line at TypeSafe's suggested floor", () => {
    expect(JEV_CONFIDENT).toBe(0.5);
  });
});
