import { describe, it, expect } from "vitest";
import { rampFor, rampRoster, rampMinimum, rampDensities, rampAnchors } from "./ramp.ts";

describe("the run-progress ramp (doc 005)", () => {
  it("declares every field at every step, at every room index", () => {
    /*
     * A step missing a field reads as `undefined` at the call site and the
     * bound it was meant to set silently disappears — which is how a caller
     * came to be reading `ramp.roster` after the table moved to beats. Every
     * index in and beyond the run, so an out-of-range one is the last step
     * rather than a hole.
     */
    for (let i = 0; i <= 20; i++) {
      const r = rampFor(i);
      for (const key of ["waves", "perWave", "climaxBonus", "alive", "tokens"] as const)
        expect({ i, key, ok: typeof r[key] === "number" && Number.isFinite(r[key]) }).toEqual({ i, key, ok: true });
      expect({ i, densities: r.densities.length > 0 }).toEqual({ i, densities: true });
      expect({ i, anchors: r.anchors.length > 0 }).toEqual({ i, anchors: true });
      expect({ i, elites: typeof r.elites }).toEqual({ i, elites: "boolean" });
      // The derived bounds are numbers too: `roster` is no longer a field.
      expect(rampRoster(i)).toBeGreaterThan(0);
      expect(rampMinimum(i)).toBeGreaterThan(0);
      expect(rampMinimum(i)).toBeLessThanOrEqual(rampRoster(i));
    }
  });

  it("climbs, and never falls back", () => {
    for (let i = 1; i < 20; i++) {
      expect(rampFor(i).waves).toBeGreaterThanOrEqual(rampFor(i - 1).waves);
      expect(rampFor(i).perWave).toBeGreaterThanOrEqual(rampFor(i - 1).perWave);
      expect(rampFor(i).alive).toBeGreaterThanOrEqual(rampFor(i - 1).alive);
      expect(rampRoster(i)).toBeGreaterThanOrEqual(rampRoster(i - 1));
      expect(rampDensities(i).length).toBeGreaterThanOrEqual(rampDensities(i - 1).length);
      expect(rampAnchors(i).length).toBeGreaterThanOrEqual(rampAnchors(i - 1).length);
    }
    // The opening rooms are two beats, and the late run is three.
    expect(rampFor(1).waves).toBe(2);
    expect(rampFor(14).waves).toBe(3);
  });

  it("forgives the opening rooms in aim and speed, and is at full strength by the late run", () => {
    for (let i = 1; i < 20; i++) {
      expect(rampFor(i).hurt).toBeGreaterThanOrEqual(rampFor(i - 1).hurt);
      expect(rampFor(i).shotSpeed).toBeGreaterThanOrEqual(rampFor(i - 1).shotSpeed);
      expect(rampFor(i).aimSpreadDeg).toBeLessThanOrEqual(rampFor(i - 1).aimSpreadDeg);
    }
    expect(rampFor(1).hurt).toBeLessThan(1);
    expect(rampFor(1).shotSpeed).toBeLessThan(1);
    expect(rampFor(10)).toMatchObject({ hurt: 1, shotSpeed: 1 });
  });
});
