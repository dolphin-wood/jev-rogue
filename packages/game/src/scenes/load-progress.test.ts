import { describe, expect, it } from "vitest";
import { LoadProgress } from "./load-progress.ts";

describe("LoadProgress", () => {
  it("weights files by bytes, so a big sheet dominates many small effects", () => {
    const p = new LoadProgress();
    p.add("sheet");
    for (let i = 0; i < 100; i++) p.add(`sfx${i}`);
    p.update("sheet", 0, 12_000_000);
    for (let i = 0; i < 100; i++) { p.update(`sfx${i}`, 20_000, 20_000); p.finish(`sfx${i}`); }
    // Every file but one is in: by count that is 99%, by bytes about 14%.
    expect(p.value()).toBeGreaterThan(0.1);
    expect(p.value()).toBeLessThan(0.2);
    p.update("sheet", 6_000_000, 12_000_000);
    expect(p.value()).toBeCloseTo(8_000_000 / 14_000_000, 3);
    p.finish("sheet");
    expect(p.value()).toBe(1);
  });

  it("counts a file of unknown size as a typical one", () => {
    const p = new LoadProgress();
    for (const k of ["a", "b", "c", "d"]) p.add(k);
    p.update("a", 100, 100); p.finish("a");
    p.update("b", 100, 100); p.finish("b");
    expect(p.value()).toBeCloseTo(0.5, 5);
  });

  it("never goes backwards when a file turns out larger than assumed", () => {
    const p = new LoadProgress();
    for (const k of ["a", "b"]) p.add(k);
    p.update("a", 100, 100); p.finish("a");
    const before = p.value();
    p.update("b", 10, 10_000);
    expect(p.value()).toBe(before);
  });

  it("takes the bytes received as the size when none was reported", () => {
    const p = new LoadProgress();
    p.add("a");
    p.update("a", 500, 0);
    p.finish("a");
    expect(p.value()).toBe(1);
  });
});
