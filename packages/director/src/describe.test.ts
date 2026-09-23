import { describe, it, expect } from "vitest";
import {
  describe as describeEntry, labelSet, deltaSentence, orderDeltas,
  missingSentences, promptHash, STATE_SENTENCES, MAX_STATIC_DESCRIPTION,
} from "./describe.ts";
import type { Describable } from "./describe.ts";

const tracking: Describable = {
  id: "passive_tracking",
  description: "Tracking passive: fired spells follow the cursor.",
  jev_hints: { favor_when: ["bottleneck:accuracy"] },
};

const labels = labelSet({
  health: "low",
  build: { bottleneck: "accuracy", mana_sustain: "tight", missing_roles: ["tracking"] },
});

describe("labelSet", () => {
  it("flattens nested labels and arrays into field:value refs", () => {
    expect(labels.has("health:low")).toBe(true);
    expect(labels.has("build.bottleneck:accuracy")).toBe(true);
    expect(labels.has("build.missing_roles:tracking")).toBe(true);
  });

  it("also emits the bare field name, so hints need not know the state shape", () => {
    expect(labels.has("bottleneck:accuracy")).toBe(true);
    expect(labels.has("missing_roles:tracking")).toBe(true);
  });
});

describe("describe", () => {
  it("fires a state sentence only when the hint matches the current labels", () => {
    const matching = labelSet({ bottleneck: "accuracy" });
    expect(describeEntry(tracking, matching)).toContain("accuracy bottleneck");
    expect(describeEntry(tracking, labelSet({ bottleneck: "mana" }))).toBe(tracking.description);
  });

  it("appends at most two delta sentences, most relevant first", () => {
    const out = describeEntry(tracking, labelSet({ bottleneck: "accuracy" }), [
      { field: "scatter", from: "tight", to: "wide" },
      { field: "mana_sustain", from: "tight", to: "starved" },
      { field: "bottleneck", from: "accuracy", to: "none" },
    ]);
    expect(out).toContain("Would clear the accuracy bottleneck.");
    expect(out).toContain("Would move mana sustain from tight to starved.");
    expect(out).not.toContain("scatter");
  });

  it("short form drops everything but the static sentence, for the narrow axes", () => {
    const out = describeEntry(tracking, labelSet({ bottleneck: "accuracy" }),
      [{ field: "bottleneck", from: "accuracy", to: "none" }], { short: true });
    expect(out).toBe(tracking.description);
    expect(out.length).toBeLessThan(80);
  });

  it("appends a suffix such as an encounter suitability word", () => {
    expect(describeEntry(tracking, labels, [], { suffix: "matches_tension." })).toMatch(/matches_tension\.$/);
  });

  it("stays a template, never model output, and stays inside the length rule", () => {
    expect(tracking.description.length).toBeLessThanOrEqual(MAX_STATIC_DESCRIPTION);
    for (const s of Object.values(STATE_SENTENCES)) expect(s.endsWith(".")).toBe(true);
  });
});

describe("deltaSentence", () => {
  it("says nothing when a label does not change", () => {
    expect(deltaSentence("mana_sustain", "tight", "tight")).toBeNull();
  });
  it("phrases clearing a bottleneck differently from shifting one", () => {
    expect(deltaSentence("bottleneck", "accuracy", "none")).toMatch(/clear the accuracy/);
    expect(deltaSentence("bottleneck", "accuracy", "mana")).toMatch(/from accuracy to mana/);
  });
  it("orders by decision relevance, not alphabetically", () => {
    const ordered = orderDeltas([
      { field: "scatter", from: "a", to: "b" },
      { field: "bottleneck", from: "a", to: "b" },
      { field: "mana_sustain", from: "a", to: "b" },
    ]).map((d) => d.field);
    expect(ordered).toEqual(["bottleneck", "mana_sustain", "scatter"]);
  });
});

describe("missingSentences", () => {
  it("reports a hint with no template, which would otherwise do nothing silently", () => {
    expect(missingSentences([{ id: "x", description: "d", jev_hints: { favor_when: ["gold:rich"] } }]))
      .toEqual(["gold:rich"]);
  });
  it("reports a hint that is not a known label at all", () => {
    expect(missingSentences([{ id: "x", description: "d", jev_hints: { favor_when: ["vibes:good"] } }])[0])
      .toMatch(/not a known label/);
  });
  it("passes entries whose hints all have templates", () => {
    expect(missingSentences([tracking])).toEqual([]);
  });
});

describe("promptHash", () => {
  it("is stable for the same templates and changes when instructions change", () => {
    expect(promptHash()).toBe(promptHash());
    expect(promptHash(["a"])).not.toBe(promptHash(["b"]));
  });
  it("is short enough to sit in every trace", () => {
    expect(promptHash()).toHaveLength(12);
  });
});
