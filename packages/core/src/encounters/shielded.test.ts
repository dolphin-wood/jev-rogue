/**
 * The `shielded` share is an invariant from doc 001, not a trailing average,
 * so the gate has to be prospective in the same way the showcase floor is.
 */
import { describe, it, expect } from "vitest";
import { affixAllowed, SHIELDED_ROOM_SHARE_PERCENT } from "./affixes.ts";
import type { AffixContext } from "./affixes.ts";

const ctx = (rooms_seen: number, shielded_rooms: number): AffixContext => ({
  roster_size: 4, rooms_seen, shielded_rooms, build_elemental_only: false,
});

describe("shielded share", () => {
  it("never allows the first room, because one of one is 100 percent", () => {
    expect(affixAllowed("shielded", ctx(0, 0))).toBe(false);
  });

  it("refuses the transient overshoot a retrospective test would permit", () => {
    // 0 of 2 rooms: a retrospective test passes, but taking it gives 1 of 3 = 33%.
    expect(affixAllowed("shielded", ctx(2, 0))).toBe(false);
    // 0 of 3: taking it gives 1 of 4 = 25%, which is within the share.
    expect(affixAllowed("shielded", ctx(3, 0))).toBe(true);
  });

  it("allows exactly the boundary and refuses one past it", () => {
    expect(affixAllowed("shielded", ctx(9, 2))).toBe(true);   // 3 of 10 = 30%
    expect(affixAllowed("shielded", ctx(8, 2))).toBe(false);  // 3 of 9 = 33%
  });

  it("holds the invariant across a whole greedy run", () => {
    let rooms = 0;
    let shielded = 0;
    for (let i = 0; i < 10; i++) {
      if (affixAllowed("shielded", ctx(rooms, shielded))) shielded++;
      rooms++;
      expect(shielded * 100).toBeLessThanOrEqual(SHIELDED_ROOM_SHARE_PERCENT * rooms);
    }
    expect(shielded).toBe(3);
  });

  it("still refuses outright when the build has no non-elemental damage", () => {
    expect(affixAllowed("shielded", { ...ctx(9, 0), build_elemental_only: true })).toBe(false);
  });
});
