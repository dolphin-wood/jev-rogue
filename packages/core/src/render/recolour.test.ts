import { describe, it, expect } from "vitest";
import { recolourRGBA, substitutionTable, fixedKeys } from "./recolour.ts";
import { BASE_PALETTE, SLOTS, derivePalette } from "./palette.ts";
import type { Mood } from "../types.ts";

const ALL_MOODS: Mood[] = (["cold", "warm"] as const).flatMap((t) =>
  (["dim", "bright"] as const).flatMap((b) =>
    (["calm", "busy"] as const).map((p) => ({ temperature: t, brightness: b, particle_intensity: p })),
  ),
);

function pixels(hexes: string[], alpha = 255): Uint8ClampedArray {
  const d = new Uint8ClampedArray(hexes.length * 4);
  hexes.forEach((hex, i) => {
    const v = parseInt(hex.slice(1), 16);
    d[i * 4] = (v >> 16) & 255;
    d[i * 4 + 1] = (v >> 8) & 255;
    d[i * 4 + 2] = v & 255;
    d[i * 4 + 3] = alpha;
  });
  return d;
}

function hexAt(d: Uint8ClampedArray, i: number): string {
  return "#" + [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]
    .map((c) => c!.toString(16).padStart(2, "0")).join("");
}

describe("recolourRGBA", () => {
  it("swaps floor slots and leaves the enemy-bullet slot untouched, for every mood", () => {
    for (const mood of ALL_MOODS) {
      const table = substitutionTable(derivePalette(mood));
      const data = pixels([BASE_PALETTE.shadow, BASE_PALETTE.body, BASE_PALETTE.hot, BASE_PALETTE.cool]);
      recolourRGBA(data, table);
      expect(hexAt(data, 2)).toBe(BASE_PALETTE.hot);
      expect(hexAt(data, 3)).toBe(BASE_PALETTE.cool);
      for (const key of fixedKeys()) expect(table.has(key)).toBe(false);
    }
  });

  it("never invents a colour outside the derived palette", () => {
    for (const mood of ALL_MOODS) {
      const derived = derivePalette(mood);
      const table = substitutionTable(derived);
      const data = pixels(SLOTS.map((s) => BASE_PALETTE[s]));
      recolourRGBA(data, table);
      const allowed = new Set(Object.values(derived.palette).map((h) => h.toLowerCase()));
      for (let i = 0; i < SLOTS.length; i++) expect(allowed.has(hexAt(data, i))).toBe(true);
    }
  });

  it("does not touch transparent pixels or the alpha channel", () => {
    const table = substitutionTable(derivePalette(ALL_MOODS[0]!));
    const data = pixels([BASE_PALETTE.shadow], 0);
    const report = recolourRGBA(data, table);
    expect(hexAt(data, 0)).toBe(BASE_PALETTE.shadow);
    expect(data[3]).toBe(0);
    expect(report.opaque).toBe(0);
  });

  it("reports colours that are not in the palette at all", () => {
    const table = substitutionTable(derivePalette(ALL_MOODS[0]!));
    const data = pixels(["#010203", BASE_PALETTE.bone]);
    expect(recolourRGBA(data, table).offPalette).toEqual(["#010203"]);
  });

  it("counts what it saw so a renderer can assert the sheet was indexed", () => {
    const table = substitutionTable(derivePalette({ temperature: "warm", brightness: "bright", particle_intensity: "busy" }));
    const data = pixels([BASE_PALETTE.shadow, BASE_PALETTE.body, BASE_PALETTE.hot]);
    const r = recolourRGBA(data, table);
    expect(r.pixels).toBe(3);
    expect(r.opaque).toBe(3);
    expect(r.substituted).toBe(2);
  });

  it("is idempotent on an already recoloured buffer for the same mood", () => {
    const table = substitutionTable(derivePalette(ALL_MOODS[1]!));
    const data = pixels([BASE_PALETTE.shadow, BASE_PALETTE.body]);
    recolourRGBA(data, table);
    const once = [hexAt(data, 0), hexAt(data, 1)];
    recolourRGBA(data, table);
    expect([hexAt(data, 0), hexAt(data, 1)]).toEqual(once);
  });
});
