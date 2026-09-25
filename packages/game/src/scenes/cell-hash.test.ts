import { describe, expect, it } from "vitest";
import { cellHash } from "./cell-hash.ts";

describe("cellHash", () => {
  it("does not tile: a four-way pick repeats four cells on no more often than chance", () => {
    let same = 0;
    let n = 0;
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 40; x++) {
        const v = cellHash(x, y) % 4;
        for (const [dx, dy] of [[4, 0], [0, 4], [2, 0], [0, 2]] as const) {
          same += v === cellHash(x + dx, y + dy) % 4 ? 1 : 0;
          n++;
        }
      }
    // Chance is a quarter; the old hash was 1.0 at a period of four.
    expect(same / n).toBeLessThan(0.3);
  });

  it("spreads every variant count evenly", () => {
    for (const k of [2, 3, 4, 5, 6]) {
      const counts = new Array<number>(k).fill(0);
      for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) counts[cellHash(x, y) % k]!++;
      for (const c of counts) expect(c / 3600).toBeGreaterThan(0.8 / k);
    }
  });
});
