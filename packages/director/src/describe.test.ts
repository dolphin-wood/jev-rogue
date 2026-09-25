import { describe, it, expect } from "vitest";
import {
  describe as describeEntry, labelSet, missingSentences, promptHash, STATE_SENTENCES, MAX_STATIC_DESCRIPTION,
} from "./describe.ts";
import type { Describable } from "./describe.ts";

const fountain: Describable = {
  id: "fountain",
  description: "Fountain: one drink restores half the health bar.",
  jev_hints: { favor_when: ["health:low"] },
};

const labels = labelSet({
  health: "low",
  build: { range: "long" },
  preference: { dominant: ["area", "dot"] },
});

describe("labelSet", () => {
  it("flattens nested labels and arrays into field:value refs", () => {
    expect(labels.has("health:low")).toBe(true);
    expect(labels.has("build.range:long")).toBe(true);
    expect(labels.has("preference.dominant:dot")).toBe(true);
  });

  it("also emits the bare field name, so hints need not know the state shape", () => {
    expect(labels.has("range:long")).toBe(true);
    expect(labels.has("dominant:area")).toBe(true);
  });
});

describe("describe", () => {
  it("fires a state sentence only when the hint matches the current labels", () => {
    expect(describeEntry(fountain, labelSet({ health: "low" }))).toContain("low on health");
    expect(describeEntry(fountain, labelSet({ health: "full" }))).toBe(fountain.description);
  });

  it("short form drops everything but the static sentence, for the narrow axes", () => {
    const out = describeEntry(fountain, labelSet({ health: "low" }), { short: true });
    expect(out).toBe(fountain.description);
    expect(out.length).toBeLessThan(80);
  });

  it("appends a suffix such as an encounter suitability word", () => {
    expect(describeEntry(fountain, labels, { suffix: "matches_tension." })).toMatch(/matches_tension\.$/);
  });

  it("stays a template, never model output, and stays inside the length rule", () => {
    expect(fountain.description.length).toBeLessThanOrEqual(MAX_STATIC_DESCRIPTION);
    for (const s of Object.values(STATE_SENTENCES)) expect(s.endsWith(".")).toBe(true);
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
    expect(missingSentences([fountain])).toEqual([]);
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
