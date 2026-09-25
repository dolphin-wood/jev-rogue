import { describe, expect, it } from "vitest";
import { AFFIX_SLOTS, SPELL_LEVEL_MAX, SPELL_SLOTS } from "../sim/spells.ts";
import { buildCompletion, buildShapeFor } from "./build-shape.ts";

const staff = (over: {
  keys?: number; affixes?: number; levels?: readonly number[];
} = {}) => ({
  keysFilled: over.keys ?? 0,
  keySlots: SPELL_SLOTS,
  affixesAttached: over.affixes ?? 0,
  affixSlotsPerKey: AFFIX_SLOTS,
  levels: over.levels ?? Array.from({ length: over.keys ?? 0 }, () => 1),
  levelMax: SPELL_LEVEL_MAX,
});

describe("build shape (doc 007)", () => {
  it("calls the opening staff raw and a finished one formed", () => {
    // Room 1: one key, nothing on it.
    expect(buildShapeFor(staff({ keys: 1 }))).toBe("raw");
    // Keys filled and bare: there is a staff, but not yet a build.
    expect(buildShapeFor(staff({ keys: 3 }))).toBe("forming");
    // What the reference player reaches the boss with.
    expect(buildShapeFor(staff({ keys: 3, affixes: 6, levels: [4, 4, 4] }))).toBe("formed");
  });

  it("weighs an empty key above everything else", () => {
    // Two keys, every affix slot the staff has, and levels: still not formed,
    // because a key the player cannot cast from is the biggest hole there is.
    const narrow = buildCompletion(staff({ keys: 2, affixes: 6, levels: [5, 5] }));
    const broad = buildCompletion(staff({ keys: 3, affixes: 3, levels: [1, 1, 1] }));
    expect(narrow).toBeLessThan(0.75);
    expect(broad).toBeGreaterThan(0.5);
  });

  it("counts affix slots against every key the staff has, not only the filled ones", () => {
    // One spell with three affixes is a narrow build, not a finished one.
    expect(buildShapeFor(staff({ keys: 1, affixes: AFFIX_SLOTS }))).toBe("raw");
  });

  it("climbs, never falls, as anything is added", () => {
    let last = -1;
    for (const s of [
      staff({ keys: 1 }), staff({ keys: 2 }), staff({ keys: 3 }),
      staff({ keys: 3, affixes: 3 }), staff({ keys: 3, affixes: 6 }),
      staff({ keys: 3, affixes: 9, levels: [5, 5, 5] }),
    ]) {
      const c = buildCompletion(s);
      expect(c).toBeGreaterThan(last);
      last = c;
    }
    expect(last).toBeLessThanOrEqual(1);
  });
});
