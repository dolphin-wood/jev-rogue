import { describe, expect, it } from "vitest";
import { bodyFeel, weightOf, type BodyFeelInput } from "./body-feel.ts";

const at = (over: Partial<BodyFeelInput> = {}) =>
  bodyFeel({ weight: "mid", framePx: 64, tick: 0, ...over });

describe("the body motion layer", () => {
  it("is at rest when nothing is happening", () => {
    const f = at();
    expect(f.scaleX).toBe(1);
    expect(f.scaleY).toBe(1);
    expect(f.offX).toBe(0);
    expect(f.tilt).toBe(0);
  });

  it("preserves area: a squash in one axis is a stretch in the other", () => {
    // A landing hit, which is the biggest squash in the set.
    const f = at({ hitMs: 160, hitX: 1, hitY: 0 });
    expect(f.scaleY).toBeLessThan(1);
    expect(f.scaleX).toBeGreaterThan(1);
    // Within the rounding the pixel grid imposes.
    expect(f.scaleX * f.scaleY).toBeGreaterThan(0.97);
    expect(f.scaleX * f.scaleY).toBeLessThan(1.03);
  });

  it("lands every scale on a whole art pixel, so a held pose cannot crawl", () => {
    for (const framePx of [64, 96]) {
      for (let ms = 0; ms <= 160; ms += 7) {
        const f = bodyFeel({ weight: "heavy", framePx, tick: 0, hitMs: ms, hitX: 1, hitY: 0 });
        expect(Number.isInteger(Math.round(framePx * f.scaleY * 1e6) / 1e6 * 1)).toBe(true);
        expect(framePx * f.scaleY).toBeCloseTo(Math.round(framePx * f.scaleY), 6);
      }
    }
  });

  it("gathers against the attack and commits along it", () => {
    const windup = at({ attack: "windup", attackMs: 40, aimX: 1, aimY: 0 });
    const lunge = at({ attack: "lunge", attackMs: 20, aimX: 1, aimY: 0 });
    expect(windup.offX).toBeLessThan(0);
    expect(lunge.offX).toBeGreaterThan(0);
    // And the commit stretches where the gather compressed.
    expect(lunge.offX - windup.offX).toBeGreaterThan(3);
  });

  it("recoils away from the blow and decays to nothing", () => {
    const fresh = at({ hitMs: 150, hitX: -1, hitY: 0 });
    const stale = at({ hitMs: 20, hitX: -1, hitY: 0 });
    expect(fresh.offX).toBeLessThan(-1);
    expect(Math.abs(stale.offX)).toBeLessThan(Math.abs(fresh.offX));
    expect(Math.abs(fresh.tilt)).toBeGreaterThan(Math.abs(stale.tilt));
  });

  it("moves a heavy body further than a light one", () => {
    const light = bodyFeel({ weight: "light", framePx: 64, tick: 0, hitMs: 160, hitX: 1, hitY: 0 });
    const heavy = bodyFeel({ weight: "heavy", framePx: 64, tick: 0, hitMs: 160, hitX: 1, hitY: 0 });
    expect(heavy.offX).toBeGreaterThan(light.offX);
    expect(heavy.scaleY).toBeLessThan(light.scaleY);
  });

  it("squashes through a turn and is done inside a fifth of a second", () => {
    expect(at({ sinceTurn: 0 }).scaleX).toBeLessThan(1);
    expect(at({ sinceTurn: 12 }).scaleX).toBe(1);
    // A body that has never turned is not mid-turn.
    expect(at({ sinceTurn: undefined }).scaleX).toBe(1);
  });

  it("keeps every effect inside a sane range, however they combine", () => {
    const f = bodyFeel({
      weight: "heavy", framePx: 64, tick: 33,
      attack: "lunge", attackMs: 10, aimX: 1, aimY: 0,
      hitMs: 160, hitX: -1, hitY: 0,
      moving: true, travelled: 40, stride: 11,
      dashMs: 120, sinceTurn: 0, hover: true, dying: 0.5,
    });
    expect(f.scaleX).toBeGreaterThanOrEqual(0.6);
    expect(f.scaleX).toBeLessThanOrEqual(1.45);
    expect(f.scaleY).toBeGreaterThanOrEqual(0.6);
    expect(f.scaleY).toBeLessThanOrEqual(1.45);
    expect(Math.abs(f.tilt)).toBeLessThanOrEqual(0.25);
  });

  it("reads weight off the body's size, as the rigs do", () => {
    expect(weightOf(9)).toBe("light");
    expect(weightOf(15)).toBe("mid");
    expect(weightOf(24)).toBe("heavy");
  });
});
