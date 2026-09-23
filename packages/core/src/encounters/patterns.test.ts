import { describe, expect, it } from "vitest";
import {
  BURST_SPREAD_DEG, burst, emissionRate, expandPattern, fan, leafKinds, parallel, ring,
  sequence, single, spiral,
} from "./patterns.ts";

describe("leaf timing", () => {
  it("fires a single at 0 and then every interval", () => {
    const e = expandPattern(single({ speed: 200, aim: "player", interval: 0.5 }), 0, 1600);
    expect(e.map((x) => x.at_ms)).toEqual([0, 500, 1000, 1500]);
    expect(e.every((x) => x.aim === "player" && x.angle_deg === 0 && x.speed === 200)).toBe(true);
  });

  it("reports the window as half-open, so consecutive windows tile exactly", () => {
    const node = single({ speed: 200, aim: "player", interval: 0.5 });
    const whole = expandPattern(node, 0, 2000);
    const a = expandPattern(node, 0, 1000);
    const b = expandPattern(node, 1000, 1000);
    expect([...a, ...b].map((x) => x.at_ms)).toEqual(whole.map((x) => x.at_ms));
    expect(a.map((x) => x.at_ms)).toEqual([0, 500]);
    expect(b.map((x) => x.at_ms)).toEqual([1000, 1500]);
  });

  it("spreads a fan symmetrically around the aim direction", () => {
    const e = expandPattern(fan({ count: 3, spread_deg: 30, speed: 220, aim: "player", interval: 0.6 }), 0, 600);
    expect(e).toHaveLength(3);
    expect(e.map((x) => x.angle_deg)).toEqual([-15, 0, 15]);
    expect(e.every((x) => x.at_ms === 0)).toBe(true);
  });

  it("closes a ring and rotates it by rotate_deg per volley", () => {
    const e = expandPattern(ring({ count: 8, speed: 170, interval: 1, rotate_deg: 11 }), 0, 2000);
    expect(e).toHaveLength(16);
    const first = e.filter((x) => x.at_ms === 0).map((x) => x.angle_deg);
    const second = e.filter((x) => x.at_ms === 1000).map((x) => x.angle_deg);
    expect(first).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(second).toEqual(first.map((a) => (a + 11) % 360).sort((x, y) => x - y));
    expect(e.every((x) => x.aim === "fixed:0")).toBe(true);
  });

  it("turns spiral arms continuously with elapsed time", () => {
    const e = expandPattern(spiral({ arms: 2, angular_speed: 90, speed: 200, interval: 1 }), 0, 3000);
    const at = (t: number): number[] => e.filter((x) => x.at_ms === t).map((x) => x.angle_deg);
    expect(at(0)).toEqual([0, 180]);
    expect(at(1000)).toEqual([90, 270]);
    expect(at(2000)).toEqual([0, 180]);
  });

  it("gives a burst its spread and a speed ramp, then waits out the cooldown", () => {
    const e = expandPattern(
      burst({ count: 5, speed_min: 100, speed_max: 200, aim: "player", cooldown: 2 }),
      0,
      5000,
    );
    expect(e.filter((x) => x.at_ms === 0)).toHaveLength(5);
    expect(new Set(e.map((x) => x.at_ms))).toEqual(new Set([0, 2000, 4000]));
    const volley = e.filter((x) => x.at_ms === 0);
    expect(volley[0]!.angle_deg).toBe(-BURST_SPREAD_DEG / 2);
    expect(volley[4]!.angle_deg).toBe(BURST_SPREAD_DEG / 2);
    expect(volley.map((x) => x.speed)).toEqual([100, 125, 150, 175, 200]);
  });

  it("refuses a non-positive interval instead of looping forever", () => {
    expect(() => expandPattern(single({ speed: 1, aim: "player", interval: 0 }), 0, 100)).toThrow(/positive interval/);
  });
});

describe("sequence", () => {
  const seq = sequence([
    { pattern: single({ speed: 100, aim: "player", interval: 0.5 }), duration: 1 },
    { pattern: single({ speed: 200, aim: "fixed:90", interval: 0.25 }), duration: 1 },
  ]);

  it("runs each step for its duration, then the next", () => {
    const e = expandPattern(seq, 0, 2000);
    expect(e.filter((x) => x.speed === 100).map((x) => x.at_ms)).toEqual([0, 500]);
    expect(e.filter((x) => x.speed === 200).map((x) => x.at_ms)).toEqual([1000, 1250, 1500, 1750]);
  });

  it("loops, restarting each step's own clock", () => {
    const e = expandPattern(seq, 0, 4000);
    expect(e.filter((x) => x.speed === 100).map((x) => x.at_ms)).toEqual([0, 500, 2000, 2500]);
    expect(e.filter((x) => x.speed === 200).map((x) => x.at_ms)).toEqual([1000, 1250, 1500, 1750, 3000, 3250, 3500, 3750]);
  });

  it("expands a mid-cycle window the same way as the whole cycle", () => {
    const whole = expandPattern(seq, 0, 4000).filter((x) => x.at_ms >= 1200 && x.at_ms < 2600);
    const slice = expandPattern(seq, 1200, 1400);
    expect(slice.map((x) => [x.at_ms, x.speed])).toEqual(whole.map((x) => [x.at_ms, x.speed]));
  });

  it("refuses a sequence with no duration at all", () => {
    const bad = sequence([{ pattern: single({ speed: 1, aim: "player", interval: 1 }), duration: 0 }]);
    expect(() => expandPattern(bad, 0, 1000)).toThrow(/positive total step duration/);
  });
});

describe("parallel", () => {
  const par = parallel([
    single({ speed: 100, aim: "player", interval: 1 }),
    ring({ count: 4, speed: 150, interval: 2, rotate_deg: 0 }),
  ]);

  it("runs every child on the same clock", () => {
    const e = expandPattern(par, 0, 4000);
    expect(e.filter((x) => x.from === "single").map((x) => x.at_ms)).toEqual([0, 1000, 2000, 3000]);
    expect(e.filter((x) => x.from === "ring")).toHaveLength(8);
  });

  it("never terminates on its own: any later window still produces bullets", () => {
    expect(expandPattern(par, 600_000, 4000).length).toBeGreaterThan(0);
    expect(emissionRate(par, 60_000)).toBeCloseTo(emissionRate(par, 600_000), 5);
  });

  it("lists the leaf kinds it contains", () => {
    expect(leafKinds(par)).toEqual(["single", "ring"]);
    expect(leafKinds(sequence([{ pattern: par, duration: 1 }]))).toEqual(["single", "ring"]);
  });

  it("sorts emissions by time and then by position in the tree", () => {
    const e = expandPattern(par, 0, 2500);
    for (let i = 1; i < e.length; i++) expect(e[i]!.at_ms).toBeGreaterThanOrEqual(e[i - 1]!.at_ms);
    expect(e[0]!.path).toEqual([0]);
  });
});
