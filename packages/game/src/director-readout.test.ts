import { describe, expect, it } from "vitest";
import { CATEGORIES, categoryOf, groupByCategory } from "./director-readout.ts";
import type { ReadoutRequest } from "./director-readout.ts";

const q = (name: string) => ({ name, choice: null, probs: [], source: "rule" });

describe("director questions by category", () => {
  it("files each question under what it decides, shelves and zones included", () => {
    expect(categoryOf("next_tension")).toBe("pacing");
    expect(categoryOf("space")).toBe("room");
    expect(categoryOf("mood_brightness")).toBe("mood");
    expect(categoryOf("zone_edge_n")).toBe("layout");
    expect(categoryOf("wave_structure")).toBe("enemies");
    expect(categoryOf("npc_room")).toBe("portals");
    expect(categoryOf("shop_stat__overall")).toBe("cards");
    expect(categoryOf("something_new")).toBe("other");
  });

  it("gathers one room's requests into categories in a fixed order, naming the request", () => {
    const reqs: ReadoutRequest[] = [
      { title: "round 1", source: "jev", state: [], questions: [q("space"), q("portal_kinds"), q("mood_temperature"), q("overall")] },
      { title: "round 2", source: "jev", state: [], questions: [q("zone_centre"), q("density")] },
      { title: "doors", source: "rule", state: [], questions: [q("next_tension")] },
    ];
    const groups = groupByCategory(reqs);
    expect(groups.map((g) => g.category)).toEqual(["pacing", "room", "mood", "layout", "enemies", "portals", "cards"]);
    expect(groups.map((g) => g.category).every((c, i, a) => i === 0 || CATEGORIES.indexOf(a[i - 1]!) < CATEGORIES.indexOf(c))).toBe(true);
    expect(groups.find((g) => g.category === "enemies")!.questions[0]).toMatchObject({ name: "density", request: "round 2" });
  });
});
