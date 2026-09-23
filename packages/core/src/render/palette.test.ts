import { describe, it, expect } from "vitest";
import {
  BASE_PALETTE, CONTRAST_RULES, SLOTS, FIXED_SLOTS, HUE_SHIFT_DEG,
  contrastRatio, derivePalette, luminance, violations, substitution,
  rgbToHsl, hslToHex, hexToRgb, particleScale, candidateSteps, MIN_BULLET_HUE_SEPARATION_DEG, hueSeparation,
} from "./palette.ts";
import type { Mood } from "../types.ts";

const mood = (over: Partial<Mood> = {}): Mood => ({
  temperature: "cold", brightness: "dim", particle_intensity: "calm", ...over,
});

const ALL_MOODS: Mood[] = (["cold", "warm"] as const).flatMap((t) =>
  (["dim", "bright"] as const).flatMap((b) =>
    (["calm", "busy"] as const).map((p) => ({ temperature: t, brightness: b, particle_intensity: p })),
  ),
);

describe("colour maths", () => {
  it("round-trips hex through hsl", () => {
    for (const hex of Object.values(BASE_PALETTE)) {
      const [h, s, l] = rgbToHsl(hex);
      const back = hslToHex(h, s, l);
      const [r1, g1, b1] = hexToRgb(hex);
      const [r2, g2, b2] = hexToRgb(back);
      expect(Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)).toBeLessThanOrEqual(3);
    }
  });

  it("computes WCAG contrast symmetrically, with known anchors", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 6);
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 6);
  });
});

describe("derivePalette", () => {
  it("satisfies every contrast rule for all eight moods", () => {
    for (const m of ALL_MOODS) {
      const d = derivePalette(m);
      expect(violations(d.palette)).toEqual([]);
      expect(d.brightnessStep).toBeGreaterThanOrEqual(0);
    }
  });

  it("never recolours the enemy bullet slot", () => {
    for (const m of ALL_MOODS) expect(derivePalette(m).palette.hot).toBe(BASE_PALETTE.hot);
    for (const m of ALL_MOODS) for (const slot of FIXED_SLOTS) expect(substitution(derivePalette(m)).has(BASE_PALETTE[slot])).toBe(false);
  });

  it("shifts hue in opposite directions for warm and cold", () => {
    const warm = rgbToHsl(derivePalette(mood({ temperature: "warm" })).palette.body)[0];
    const cold = rgbToHsl(derivePalette(mood({ temperature: "cold" })).palette.body)[0];
    const baseHue = rgbToHsl(BASE_PALETTE.body)[0];
    expect(warm).toBeGreaterThan(baseHue);
    expect(cold).toBeLessThan(baseHue);
    // 8-bit quantisation costs about a degree on the round trip.
    expect(Math.abs(warm - cold)).toBeGreaterThan(2 * HUE_SHIFT_DEG - 2);
    expect(Math.abs(warm - cold)).toBeLessThan(2 * HUE_SHIFT_DEG + 2);
  });

  it("makes bright rooms lighter than dim rooms", () => {
    expect(luminance(derivePalette(mood({ brightness: "bright" })).palette.body))
      .toBeGreaterThan(luminance(derivePalette(mood({ brightness: "dim" })).palette.body));
  });

  it("steps brightness up rather than shipping an illegible room", () => {
    // A base whose mid tones are far too close to the enemy bullet colour.
    const bad = { ...BASE_PALETTE, shadow: "#ff3fa4", body: "#ff4fb0" };
    const d = derivePalette(mood({ brightness: "dim" }), bad);
    expect(d.adjustedForContrast).toBe(true);
  });

  it("falls back to the base palette rather than returning a failing one", () => {
    const impossible = { ...BASE_PALETTE, shadow: BASE_PALETTE.hot, body: BASE_PALETTE.hot, light: BASE_PALETTE.hot };
    const d = derivePalette(mood(), impossible);
    expect(d.brightnessStep).toBe(-1);
    expect(d.palette).toBe(impossible);
  });

  it("reports the rule that failed, naming both slots", () => {
    const v = violations({ ...BASE_PALETTE, shadow: BASE_PALETTE.hot });
    expect(v.join(" ")).toMatch(/hot on shadow/);
  });
});

describe("substitution", () => {
  it("maps only the slots that actually changed", () => {
    const d = derivePalette(mood());
    const map = substitution(d);
    for (const [from, to] of map) expect(from).not.toBe(to);
    for (const slot of SLOTS)
      if (!map.has(BASE_PALETTE[slot].toLowerCase()))
        expect(d.palette[slot]).toBe(BASE_PALETTE[slot]);
  });

  it("covers every contrast rule slot that the renderer will draw", () => {
    const slots = new Set(CONTRAST_RULES.flatMap((r) => [r.fg, r.bg]));
    for (const s of slots) expect(SLOTS).toContain(s);
  });
});

describe("bullet separation", () => {
  it("separates the two bullet families by hue, not by luminance", () => {
    // Both are bright: their luminance contrast is only about 1.26:1, so a
    // brightness rule here would be false comfort. Shape carries the rest.
    expect(contrastRatio(BASE_PALETTE.hot, BASE_PALETTE.cool)).toBeLessThan(1.5);
    expect(hueSeparation(BASE_PALETTE.hot, BASE_PALETTE.cool)).toBeGreaterThan(MIN_BULLET_HUE_SEPARATION_DEG);
    for (const m of ALL_MOODS) {
      const p = derivePalette(m).palette;
      expect(p.hot).toBe(BASE_PALETTE.hot);
      expect(p.cool).toBe(BASE_PALETTE.cool);
    }
  });
});

describe("candidateSteps", () => {
  it("tries the requested brightness first, then walks outward both ways", () => {
    expect(candidateSteps(2)[0]).toBe(2);
    expect(candidateSteps(2).slice(1, 3).sort()).toEqual([1, 3]);
    expect(new Set(candidateSteps(0)).size).toBe(candidateSteps(0).length);
  });

  it("searches downward too, because a brighter floor hides bright bullets", () => {
    expect(candidateSteps(3)).toContain(0);
    expect(candidateSteps(3).indexOf(2)).toBeLessThan(candidateSteps(3).indexOf(0));
  });
});

describe("particleScale", () => {
  it("is higher for busy rooms", () => {
    expect(particleScale(mood({ particle_intensity: "busy" }))).toBeGreaterThan(
      particleScale(mood({ particle_intensity: "calm" })),
    );
  });
});
