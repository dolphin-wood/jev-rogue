import { describe, it, expect } from "vitest";
import {
  withTemperature, sampleOne, sampleWithoutReplacement, sampleUniform,
  dropKey, restrict, rankIn, validateDistribution,
} from "./sample.ts";
import { RngSource } from "../rng.ts";

const src = new RngSource("test-seed");
const dist = { a: 0.5, b: 0.3, c: 0.2 };

describe("temperature", () => {
  it("leaves the distribution unchanged at T = 1", () => {
    const t = withTemperature(dist, 1);
    for (const k of Object.keys(dist)) expect(t[k]!).toBeCloseTo(dist[k as keyof typeof dist], 10);
  });

  it("sharpens toward the mode below T = 1 and spreads above it", () => {
    expect(withTemperature(dist, 0.4).a!).toBeGreaterThan(dist.a);
    expect(withTemperature(dist, 2.5).a!).toBeLessThan(dist.a);
  });

  it("always sums to 1", () => {
    for (const t of [0.4, 0.7, 1, 2]) {
      const sum = Object.values(withTemperature(dist, t)).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it("rejects a non-positive temperature", () => {
    expect(() => withTemperature(dist, 0)).toThrow();
  });
});

describe("sampling", () => {
  it("is deterministic for a given seed", () => {
    const a = sampleWithoutReplacement(dist, 3, new RngSource("s").stream("reward", 1));
    const b = sampleWithoutReplacement(dist, 3, new RngSource("s").stream("reward", 1));
    expect(a).toEqual(b);
  });

  it("differs between decision keys, so response order cannot leak in", () => {
    const a = sampleWithoutReplacement(dist, 3, new RngSource("s").stream("reward", 1));
    const b = sampleWithoutReplacement(dist, 3, new RngSource("s").stream("reward", 2));
    expect(a).not.toEqual(b);
  });

  it("samples without replacement and never repeats", () => {
    for (let i = 0; i < 50; i++) {
      const got = sampleWithoutReplacement(dist, 3, src.stream("x", i));
      expect(new Set(got).size).toBe(got.length);
    }
  });

  it("returns fewer than requested when the pool is smaller", () => {
    expect(sampleWithoutReplacement({ a: 1 }, 3, src.stream("y")).length).toBe(1);
  });

  it("tracks the requested distribution over many draws", () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 4000; i++) counts[sampleOne(dist, src.stream("h", i))]!++;
    expect(counts.a! / 4000).toBeCloseTo(0.5, 1);
    expect(counts.c! / 4000).toBeCloseTo(0.2, 1);
  });

  it("does not take argmax", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(sampleOne(dist, src.stream("m", i)));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("wildcard", () => {
  it("is uniform and excludes the already-picked cards", () => {
    const pool = ["a", "b", "c", "d"];
    for (let i = 0; i < 100; i++) {
      const w = sampleUniform(pool, ["a", "b"], src.stream("w", i));
      expect(["c", "d"]).toContain(w);
    }
  });

  it("returns null when nothing is left", () => {
    expect(sampleUniform(["a"], ["a"], src.stream("w"))).toBeNull();
  });
});

describe("helpers", () => {
  it("dropKey renormalises and reports the dropped mass", () => {
    const { dist: d, dropped } = dropKey({ ...dist, fallback: 0.25 }, "fallback");
    expect(dropped).toBe(0.25);
    expect(Object.values(d).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(d).not.toHaveProperty("fallback");
  });

  it("restrict keeps only the allowed keys", () => {
    expect(Object.keys(restrict(dist, ["a", "c"])).sort()).toEqual(["a", "c"]);
  });

  it("rankIn is 1-based by descending probability", () => {
    expect(rankIn(dist, "a")).toBe(1);
    expect(rankIn(dist, "c")).toBe(3);
    expect(rankIn(dist, "zz")).toBe(-1);
  });
});

describe("validateDistribution", () => {
  const offered = ["a", "b", "c"];
  it("accepts a well-formed distribution", () => {
    expect(validateDistribution(dist, offered)).toBeNull();
  });
  it("rejects an unoffered key", () => {
    expect(validateDistribution({ a: 0.5, b: 0.3, zz: 0.2 }, offered)).toMatch(/not offered/);
  });
  it("rejects a wrong key count", () => {
    expect(validateDistribution({ a: 1 }, offered)).toMatch(/expected 3 keys/);
  });
  it("rejects negative and non-finite values", () => {
    expect(validateDistribution({ a: -0.1, b: 0.9, c: 0.2 }, offered)).toMatch(/negative/);
    expect(validateDistribution({ a: NaN, b: 0.5, c: 0.5 }, offered)).toMatch(/non-finite/);
  });
  it("rejects probabilities that do not sum to 1", () => {
    expect(validateDistribution({ a: 0.2, b: 0.2, c: 0.2 }, offered)).toMatch(/sum to/);
  });
  it("accepts the drift of two-decimal rounding, which grows with the options", () => {
    const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const rounded = { a: 0.71, b: 0.16, c: 0.06, d: 0.02, e: 0.02, f: 0.01, g: 0.01, h: 0 };
    expect(validateDistribution(rounded, eight)).toBeNull();
    expect(validateDistribution({ ...rounded, a: 0.65 }, eight)).toMatch(/sum to/);
  });
});
