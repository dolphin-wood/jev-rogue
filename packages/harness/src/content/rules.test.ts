import { describe, it, expect } from "vitest";
import { checkLibrary, checkGlobalIds, MAX_DESCRIPTION } from "./rules.ts";
import type { ContentEntry } from "./rules.ts";

const ok: ContentEntry = {
  id: "spike_strip",
  tags: ["hazard", "movement_pressure"],
  description: "Spike strip: damages on contact and restricts movement. Over-punishes a player already under movement pressure.",
  jev_hints: { avoid_when: ["health:critical"] },
};

const rules = (v: ReturnType<typeof checkLibrary>) => new Set(v.map((x) => x.rule));

describe("content rules", () => {
  it("accepts a well-formed entry", () => {
    expect(checkLibrary("features", [ok])).toEqual([]);
  });

  it("rejects an id that is not lower snake_case", () => {
    expect(rules(checkLibrary("f", [{ ...ok, id: "SpikeStrip" }]))).toContain("id-format");
  });

  it("rejects duplicate ids inside a library and across libraries", () => {
    expect(rules(checkLibrary("f", [ok, ok]))).toContain("id-unique");
    const cross = checkGlobalIds({ features: [ok], items: [ok] });
    expect(cross.map((v) => v.rule)).toContain("id-unique-global");
  });

  it("rejects a tag outside the closed vocabulary", () => {
    expect(rules(checkLibrary("f", [{ ...ok, tags: ["spicy"] }]))).toContain("tag-vocabulary");
  });

  it("rejects digits unless numeric_ok says the number is the decision", () => {
    const withNumber = { ...ok, description: "Adds 1 projectile." };
    expect(rules(checkLibrary("f", [withNumber]))).toContain("description-digits");
    expect(checkLibrary("f", [{ ...withNumber, numeric_ok: true }])).toEqual([]);
  });

  it("rejects an over-long or empty description", () => {
    expect(rules(checkLibrary("f", [{ ...ok, description: "x".repeat(MAX_DESCRIPTION + 1) }]))).toContain("description-length");
    expect(rules(checkLibrary("f", [{ ...ok, description: "  " }]))).toContain("description-present");
  });

  it("rejects a jev_hints label that is not in the summary vocabulary", () => {
    expect(rules(checkLibrary("f", [{ ...ok, jev_hints: { favor_when: ["vibes:good"] } }]))).toContain("hint-label");
    expect(checkLibrary("f", [{ ...ok, jev_hints: { favor_when: ["recent_damage:heavy"] } }])).toEqual([]);
  });

  it("rejects a resource group of one, which cannot express exclusivity", () => {
    expect(rules(checkLibrary("f", [{ ...ok, resource: "floor_hazard" }]))).toContain("resource-singleton");
    const pair = [
      { ...ok, id: "a", resource: "floor_hazard" },
      { ...ok, id: "b", resource: "floor_hazard" },
    ];
    expect(checkLibrary("f", pair)).toEqual([]);
  });
});
