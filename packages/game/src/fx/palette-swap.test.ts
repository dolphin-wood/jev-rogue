import { describe, expect, it } from "vitest";
import {
  LUT_MAX, applyLut, buildLut, enrageRamps, hslToRgb, lutUniforms, parseHex, rgbToHsl, toHex,
  type Ramps,
} from "./palette-swap.ts";

/** A stand-in for a body's `palette.json`: a ramp per material, darkest first. */
const BASE: Ramps = {
  outline: ["#030305"],
  eye: ["#045d6f", "#02a1a8", "#26c9cc"],
  shell: ["#1b1a35", "#26264f", "#333565", "#535279"],
};

describe("hex", () => {
  it("round-trips", () => {
    for (const hex of ["#030305", "#26c9cc", "#ffffff", "#000000"]) {
      expect(toHex(parseHex(hex))).toBe(hex);
    }
  });

  it("refuses anything that is not #rrggbb", () => {
    for (const bad of ["030305", "#fff", "#gggggg", ""]) expect(() => parseHex(bad)).toThrow();
  });
});

describe("buildLut", () => {
  it("is empty for a palette against itself, so a body can be skipped", () => {
    expect(buildLut(BASE, BASE).pairs).toEqual([]);
  });

  it("matches by material and shade, not by colour", () => {
    const to: Ramps = { shell: ["#100010", "#200020", "#300030", "#400040"] };
    const lut = buildLut(BASE, to);
    expect(lut.pairs.map((p) => [p.material, p.shade])).toEqual([
      ["shell", 0], ["shell", 1], ["shell", 2], ["shell", 3],
    ]);
    expect(toHex(lut.pairs[2]!.from)).toBe("#333565");
    expect(toHex(lut.pairs[2]!.to)).toBe("#300030");
  });

  it("leaves a material the target does not name alone", () => {
    const lut = buildLut(BASE, { shell: ["#100010"] });
    expect(lut.pairs.every((p) => p.material === "shell")).toBe(true);
    // The eye keeps its own colours: a subspecies palette is only what differs.
    expect(lut.pairs.some((p) => p.material === "eye")).toBe(false);
  });

  it("clamps a shorter target ramp to its last shade", () => {
    const lut = buildLut(BASE, { shell: ["#100010", "#200020"] });
    expect(lut.pairs.map((p) => toHex(p.to))).toEqual(["#100010", "#200020", "#200020", "#200020"]);
  });

  it("drops a pair that changes nothing", () => {
    const to: Ramps = { shell: ["#1b1a35", "#26264f", "#333565", "#999999"] };
    const lut = buildLut(BASE, to);
    expect(lut.pairs).toHaveLength(1);
    expect(lut.pairs[0]!.shade).toBe(3);
  });

  it("names a colour two ramps share, and maps it once", () => {
    const from: Ramps = { a: ["#112233"], b: ["#112233"] };
    const lut = buildLut(from, { a: ["#aaaaaa"], b: ["#bbbbbb"] });
    expect(lut.shared).toEqual(["#112233"]);
    expect(lut.pairs).toHaveLength(1);
    // The first ramp in the source's own order wins: a lookup is by colour and
    // cannot know which material a pixel came from.
    expect(toHex(lut.pairs[0]!.to)).toBe("#aaaaaa");
  });

  it("refuses a table longer than a body's palette may be", () => {
    const wide: Record<string, string[]> = {};
    for (let i = 0; i <= LUT_MAX; i++) wide[`m${i}`] = [`#${i.toString(16).padStart(2, "0")}0000`];
    const target = Object.fromEntries(Object.keys(wide).map((k) => [k, ["#ffffff"]]));
    expect(() => buildLut(wide, target)).toThrow(/over the 32/);
  });
});

describe("applyLut", () => {
  const lut = buildLut(BASE, { shell: ["#100010", "#200020", "#300030", "#400040"] });

  const pixels = (...cols: (readonly [string, number])[]): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(cols.length * 4);
    cols.forEach(([hex, a], i) => {
      const [r, g, b] = parseHex(hex);
      out.set([r, g, b, a], i * 4);
    });
    return out;
  };

  it("maps exactly the colours in the table and leaves the rest", () => {
    const px = pixels(["#333565", 255], ["#26c9cc", 255], ["#030305", 255]);
    expect(applyLut(px, lut)).toBe(1);
    expect(toHex([px[0]!, px[1]!, px[2]!])).toBe("#300030");
    // The eye and the outline are not in the table, so they are untouched.
    expect(toHex([px[4]!, px[5]!, px[6]!])).toBe("#26c9cc");
    expect(toHex([px[8]!, px[9]!, px[10]!])).toBe("#030305");
  });

  it("keeps alpha, and skips a fully transparent pixel", () => {
    // The atlas pads with zeroed RGBA, which matches any black entry; a padded
    // pixel that came out swapped would print the pad into the frame.
    const black = buildLut({ shell: ["#000000"] }, { shell: ["#ff0000"] });
    const px = pixels(["#000000", 0], ["#000000", 128]);
    expect(applyLut(px, black)).toBe(1);
    expect([...px.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...px.slice(4, 8)]).toEqual([255, 0, 0, 128]);
  });

  it("does nothing at all for an empty table", () => {
    const px = pixels(["#333565", 255]);
    expect(applyLut(px, buildLut(BASE, BASE))).toBe(0);
    expect(toHex([px[0]!, px[1]!, px[2]!])).toBe("#333565");
  });
});

describe("hsl", () => {
  it("round-trips every shade of the roster's own ramps", () => {
    for (const ramp of Object.values(BASE)) for (const hex of ramp) {
      const rgb = parseHex(hex);
      const back = hslToRgb(rgbToHsl(rgb));
      // Within a byte: the conversion is through floats.
      back.forEach((v, i) => expect(Math.abs(v - rgb[i]!)).toBeLessThanOrEqual(1));
    }
  });
});

describe("enrageRamps", () => {
  const warm = enrageRamps(BASE);

  it("never raises lightness, which is what keeps a body inside the value band", () => {
    for (const [material, ramp] of Object.entries(BASE)) {
      ramp.forEach((hex, i) => {
        const before = rgbToHsl(parseHex(hex))[2];
        const after = rgbToHsl(parseHex(warm[material]![i]!))[2];
        expect(after).toBeLessThanOrEqual(before + 0.005);
      });
    }
  });

  it("leaves the outline alone", () => {
    expect(warm.outline).toEqual(BASE.outline);
  });

  it("carries a hue toward the pink without passing it", () => {
    const before = rgbToHsl(parseHex(BASE.shell![3]!))[0];
    const after = rgbToHsl(parseHex(warm.shell![3]!))[0];
    expect(after).not.toBeCloseTo(before, 1);
    // 345 is the target; a pull of 0.55 must not overshoot onto the far side.
    expect(Math.abs(((after - 345 + 540) % 360) - 180))
      .toBeLessThan(Math.abs(((before - 345 + 540) % 360) - 180));
  });

  it("is a palette, so it composes with a subspecies swap", () => {
    // An elite pinner is the pinner's palette enraged, not the base body's:
    // the two channels never overwrite each other (doc 019).
    const sub: Ramps = { ...BASE, shell: ["#100010", "#200020", "#300030", "#400040"] };
    const lut = buildLut(sub, enrageRamps(sub));
    expect(lut.pairs.length).toBeGreaterThan(0);
    expect(lut.pairs.every((p) => p.material !== "outline")).toBe(true);
  });
});

describe("lutUniforms", () => {
  it("pads to the shader's fixed bound and normalises to 0..1", () => {
    const lut = buildLut(BASE, { shell: ["#ff0000"] });
    const u = lutUniforms(lut);
    expect(u.count).toBe(lut.pairs.length);
    expect(u.from).toHaveLength(LUT_MAX * 3);
    expect(u.to).toHaveLength(LUT_MAX * 3);
    expect(u.to[0]).toBeCloseTo(1, 5);
    expect(u.to[1]).toBeCloseTo(0, 5);
    // Everything past the count is zero, so a stale tail cannot match a pixel.
    expect([...u.from.slice(lut.pairs.length * 3)].every((v) => v === 0)).toBe(true);
  });
});
