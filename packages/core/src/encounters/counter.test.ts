import { describe, expect, it } from "vitest";
import type { CounterScore } from "../content/tags.ts";
import type { Composition, RoomType } from "../types.ts";
import {
  COMPOSITIONS, SHOWCASE_FLOOR_PERCENT, compositionOptions, counterAllowed, counterScore,
  filterForCharter, isShowcase, prospectiveShowcaseRatio, tallyShowcase,
} from "./counter.ts";

describe("counterScore", () => {
  it("scores the doc's two named counters", () => {
    // Doc 005: "melee_heavy vs long range and ranged_heavy vs short".
    expect(counterScore("melee_heavy", "long", "mixed")).toBe("counters");
    expect(counterScore("ranged_heavy", "short", "mixed")).toBe("counters");
  });

  it("scores the mirror of each as favours", () => {
    expect(counterScore("melee_heavy", "short", "mixed")).toBe("favours");
    expect(counterScore("ranged_heavy", "long", "mixed")).toBe("favours");
  });

  it("lets the range axis win over the archetype axis", () => {
    // area would pull melee_heavy toward favours, but the build is long range.
    expect(counterScore("melee_heavy", "long", "area")).toBe("counters");
    expect(counterScore("melee_heavy", "short", "nuke")).toBe("favours");
  });

  it("breaks a range tie on the build archetype", () => {
    expect(counterScore("melee_heavy", "mid", "nuke")).toBe("counters");
    expect(counterScore("melee_heavy", "mid", "spam")).toBe("favours");
    expect(counterScore("melee_heavy", "mid", "mixed")).toBe("neutral");
  });

  it("never lets mixed counter anything, so a composition list cannot be emptied", () => {
    for (const range of ["short", "mid", "long"] as const) {
      for (const arch of ["spam", "nuke", "area", "dot", "mixed"] as const) {
        expect(counterScore("mixed", range, arch)).toBe("neutral");
      }
    }
  });

  it("treats favours and neutral as showcase rooms", () => {
    expect(isShowcase("favours")).toBe(true);
    expect(isShowcase("neutral")).toBe(true);
    expect(isShowcase("counters")).toBe(false);
  });
});

describe("prospective showcase floor (doc 001)", () => {
  // The floor is tested AFTER the prospective addition, which is what keeps it
  // from being crossed one room at a time.
  const table: { showcase: number; combat: number; offered: boolean; why: string }[] = [
    { showcase: 0, combat: 0, offered: false, why: "0/1 = 0%: the first room can never counter" },
    { showcase: 1, combat: 1, offered: true, why: "1/2 = 50%" },
    { showcase: 1, combat: 2, offered: false, why: "1/3 = 33%" },
    { showcase: 2, combat: 4, offered: true, why: "2/5 = 40%, exactly at the floor" },
    { showcase: 2, combat: 5, offered: false, why: "2/6 = 33%: at the floor already, so no counter" },
    { showcase: 3, combat: 5, offered: true, why: "3/6 = 50%" },
    { showcase: 4, combat: 9, offered: true, why: "4/10 = 40%, exactly at the floor" },
    { showcase: 4, combat: 10, offered: false, why: "4/11 = 36%" },
    { showcase: 5, combat: 9, offered: true, why: "5/10 = 50%" },
  ];

  it.each(table)("$showcase showcase of $combat combat rooms -> offered=$offered ($why)", (row) => {
    const history = { combat_rooms: row.combat, showcase_rooms: row.showcase };
    expect(counterAllowed(history)).toBe(row.offered);

    const options = [
      { value: "mixed" as Composition, score: "neutral" as CounterScore },
      { value: "melee_heavy" as Composition, score: "counters" as CounterScore },
      { value: "ranged_heavy" as Composition, score: "favours" as CounterScore },
    ];
    const kept = filterForCharter(options, history).map((o) => o.value);
    expect(kept.includes("melee_heavy")).toBe(row.offered);
    // A charter filter never removes a showcase option.
    expect(kept).toEqual(expect.arrayContaining(["mixed", "ranged_heavy"]));
  });

  it("is exactly the doc's worked example", () => {
    // "At two showcase rooms out of five the run sits exactly at the floor, so
    // a counter would give two out of six and is therefore not offered."
    const at2of5 = { combat_rooms: 5, showcase_rooms: 2 };
    expect(at2of5.showcase_rooms / at2of5.combat_rooms).toBeCloseTo(0.4, 10);
    expect(prospectiveShowcaseRatio(at2of5, "counters")).toBeCloseTo(2 / 6, 10);
    expect(prospectiveShowcaseRatio(at2of5, "counters") * 100).toBeLessThan(SHOWCASE_FLOOR_PERCENT);
    expect(counterAllowed(at2of5)).toBe(false);

    const at3of5 = { combat_rooms: 5, showcase_rooms: 3 };
    expect(prospectiveShowcaseRatio(at3of5, "counters")).toBeCloseTo(3 / 6, 10);
    expect(prospectiveShowcaseRatio(at3of5, "counters") * 100).toBeGreaterThanOrEqual(SHOWCASE_FLOOR_PERCENT);
    expect(counterAllowed(at3of5)).toBe(true);
  });

  it("holds the floor for a whole run of counters-only choices", () => {
    // Walk a run always taking the hardest option the filter still allows.
    let combat = 0;
    let showcase = 0;
    for (let room = 0; room < 20; room++) {
      const allowed = counterAllowed({ combat_rooms: combat, showcase_rooms: showcase });
      combat++;
      if (!allowed) showcase++;
      expect(showcase * 100).toBeGreaterThanOrEqual(SHOWCASE_FLOOR_PERCENT * combat);
    }
  });

  it("lets elite rooms counter freely, since they count on neither side", () => {
    const history = { combat_rooms: 5, showcase_rooms: 0 };
    expect(counterAllowed(history, "combat")).toBe(false);
    for (const type of ["elite", "boss"] as RoomType[]) {
      expect(counterAllowed(history, type)).toBe(true);
    }
  });
});

describe("tallyShowcase", () => {
  it("counts combat rooms only and ignores elite ones on both sides", () => {
    const history = {
      rooms: ["combat", "elite", "combat", "shop", "combat"] as RoomType[],
      counter_scores: ["counters", "counters", "favours", "neutral"] as CounterScore[],
    };
    // Scores line up with the four encounter rooms; the elite one is skipped.
    expect(tallyShowcase(history)).toEqual({ combat_rooms: 3, showcase_rooms: 2 });
  });

  it("accepts a run that only stored combat scores", () => {
    const history = {
      rooms: ["combat", "elite", "combat"] as RoomType[],
      counter_scores: ["counters", "favours"] as CounterScore[],
    };
    expect(tallyShowcase(history)).toEqual({ combat_rooms: 2, showcase_rooms: 1 });
  });

  it("passes a tally straight through", () => {
    const t = { combat_rooms: 3, showcase_rooms: 1 };
    expect(tallyShowcase(t)).toBe(t);
  });
});

describe("compositionOptions", () => {
  it("drops countering options at the floor but never empties the list", () => {
    const opts = compositionOptions({
      build_range: "long",
      build_archetype: "nuke",
      history: { combat_rooms: 5, showcase_rooms: 2 },
    });
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o.score !== "counters")).toBe(true);
    expect(opts.map((o) => o.value)).toContain("mixed");
  });

  it("offers the countering option once the run is above the floor", () => {
    const opts = compositionOptions({
      build_range: "long",
      build_archetype: "nuke",
      history: { combat_rooms: 5, showcase_rooms: 3 },
    });
    expect(opts.map((o) => o.value)).toContain("melee_heavy");
  });

  it("drops the repeat of the last composition when three or more remain", () => {
    const opts = compositionOptions({
      build_range: "mid",
      build_archetype: "mixed",
      history: { combat_rooms: 5, showcase_rooms: 5 },
      last_composition: "siege",
    });
    expect(opts).toHaveLength(COMPOSITIONS.length - 1);
    expect(opts.map((o) => o.value)).not.toContain("siege");
  });

  it("keeps the repeat when the charter already trimmed the list to two", () => {
    const opts = compositionOptions({
      build_range: "short",
      build_archetype: "nuke",
      history: { combat_rooms: 5, showcase_rooms: 2 },
      last_composition: "mixed",
    });
    expect(opts.map((o) => o.value)).toContain("mixed");
  });
});
