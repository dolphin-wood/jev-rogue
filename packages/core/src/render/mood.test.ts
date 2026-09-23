import { describe, it, expect } from "vitest";
import {
  moodTransform, tintRGBA, isProtected,
  PROTECTED_HUE_DEG, PROTECTED_HUE_TOLERANCE_DEG, PROTECTED_MIN_SATURATION,
} from "./mood.ts";
import { BASE_PALETTE, rgbToHsl, hexToRgb } from "./palette.ts";
import type { Mood } from "../types.ts";

const ALL_MOODS: Mood[] = (["cold", "warm"] as const).flatMap((t) =>
  (["dim", "bright"] as const).flatMap((b) =>
    (["calm", "busy"] as const).map((p) => ({ temperature: t, brightness: b, particle_intensity: p })),
  ),
);

function pixels(hexes: string[], alpha = 255): Uint8ClampedArray {
  const d = new Uint8ClampedArray(hexes.length * 4);
  hexes.forEach((hex, i) => {
    const [r, g, b] = hexToRgb(hex);
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = alpha;
  });
  return d;
}

const hexAt = (d: Uint8ClampedArray, i: number) =>
  "#" + [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]].map((c) => c!.toString(16).padStart(2, "0")).join("");

describe("mood transform", () => {
  it("shifts hue in opposite directions for warm and cold", () => {
    expect(moodTransform({ temperature: "warm", brightness: "dim", particle_intensity: "calm" }).hueShiftDeg)
      .toBeGreaterThan(0);
    expect(moodTransform({ temperature: "cold", brightness: "dim", particle_intensity: "calm" }).hueShiftDeg)
      .toBeLessThan(0);
  });

  it("makes bright rooms lighter than dim ones", () => {
    const bright = moodTransform({ temperature: "cold", brightness: "bright", particle_intensity: "calm" });
    const dim = moodTransform({ temperature: "cold", brightness: "dim", particle_intensity: "calm" });
    expect(bright.lightnessMul).toBeGreaterThan(dim.lightnessMul);
  });
});

describe("the protected enemy-bullet hue band", () => {
  it("covers the enemy bullet colour and excludes the player bullet colour", () => {
    const [hHot, sHot] = rgbToHsl(BASE_PALETTE.hot);
    const [hCool, sCool] = rgbToHsl(BASE_PALETTE.cool);
    expect(isProtected(hHot, sHot)).toBe(true);
    expect(isProtected(hCool, sCool)).toBe(false);
  });

  it("does not protect a desaturated pixel that merely sits near the hue", () => {
    expect(isProtected(PROTECTED_HUE_DEG, PROTECTED_MIN_SATURATION - 0.1)).toBe(false);
  });

  it("protects a band, not a single value, so anti-aliased bullet edges survive", () => {
    expect(isProtected(PROTECTED_HUE_DEG + PROTECTED_HUE_TOLERANCE_DEG - 1, 0.9)).toBe(true);
    expect(isProtected(PROTECTED_HUE_DEG + PROTECTED_HUE_TOLERANCE_DEG + 5, 0.9)).toBe(false);
  });

  it("handles hue wraparound rather than treating 359 and 1 as far apart", () => {
    expect(isProtected((PROTECTED_HUE_DEG + 358) % 360, 0.9)).toBe(true);
  });
});

describe("tintRGBA", () => {
  it("leaves the enemy bullet colour untouched for every mood", () => {
    for (const mood of ALL_MOODS) {
      const d = pixels([BASE_PALETTE.hot, BASE_PALETTE.body]);
      const report = tintRGBA(d, moodTransform(mood));
      expect(hexAt(d, 0)).toBe(BASE_PALETTE.hot);
      expect(report.protectedPixels).toBe(1);
      expect(report.shifted).toBe(1);
    }
  });

  it("actually moves the rest of the art", () => {
    const warm = pixels([BASE_PALETTE.body]);
    const cold = pixels([BASE_PALETTE.body]);
    tintRGBA(warm, moodTransform({ temperature: "warm", brightness: "bright", particle_intensity: "calm" }));
    tintRGBA(cold, moodTransform({ temperature: "cold", brightness: "dim", particle_intensity: "calm" }));
    expect(hexAt(warm, 0)).not.toBe(BASE_PALETTE.body);
    expect(hexAt(warm, 0)).not.toBe(hexAt(cold, 0));
  });

  it("skips fully transparent pixels but shifts anti-aliased edges", () => {
    const clear = pixels([BASE_PALETTE.body], 0);
    expect(tintRGBA(clear, moodTransform(ALL_MOODS[0]!)).opaque).toBe(0);
    expect(hexAt(clear, 0)).toBe(BASE_PALETTE.body);

    const edge = pixels([BASE_PALETTE.body], 90);
    const r = tintRGBA(edge, moodTransform(ALL_MOODS[0]!));
    expect(r.shifted).toBe(1);
    expect(edge[3]).toBe(90);
  });

  it("is deterministic and stable under a second application of the same mood", () => {
    const a = pixels([BASE_PALETTE.light]);
    const b = pixels([BASE_PALETTE.light]);
    const t = moodTransform(ALL_MOODS[3]!);
    tintRGBA(a, t);
    tintRGBA(b, t);
    expect(hexAt(a, 0)).toBe(hexAt(b, 0));
  });
});
