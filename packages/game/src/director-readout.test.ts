import { describe, expect, it } from "vitest";
import { buildReadout, CATEGORIES, categoryOf, DOORS_OUT, groupByCategory } from "./director-readout.ts";
import type { PlanRecord, ReadoutRequest } from "./director-readout.ts";
import type { ObservedRequest } from "@jr/director";

const q = (name: string) => ({ name, choice: null, probs: [], source: "rule" });

describe("director questions by category", () => {
  it("files each question under what it decides, shelves and zones included", () => {
    expect(categoryOf("next_tension")).toBe("pacing");
    expect(categoryOf("space")).toBe("room");
    expect(categoryOf("mood_brightness")).toBe("mood");
    expect(categoryOf("zone_edge_n")).toBe("layout");
    expect(categoryOf("wave_structure")).toBe("enemies");
    expect(categoryOf("portal_need")).toBe("portals");
    expect(categoryOf("shop_stat__overall")).toBe("cards");
    expect(categoryOf("something_new")).toBe("other");
  });

  it("gathers one room's requests into categories in a fixed order, naming the request", () => {
    // The fields the page's headers read are not what this test is about, so
    // they are filled from one place rather than spelled out three times.
    const req = (title: string, source: string, round: number, purpose: string, questions: ReadoutRequest["questions"]): ReadoutRequest =>
      ({ title, source, state: [], questions, round, purpose, subjects: "", raw: { state: {}, questions: {}, answers: {} } });
    const reqs: ReadoutRequest[] = [
      req("round 1", "jev", 1, "room", [q("space"), q("portal_need"), q("mood_temperature"), q("overall")]),
      req("round 2", "jev", 2, "room", [q("zone_centre"), q("density")]),
      req("doors", "rule", 1, "doors", [q("next_tension")]),
    ];
    const groups = groupByCategory(reqs);
    expect(groups.map((g) => g.category)).toEqual(["pacing", "room", "mood", "layout", "enemies", "portals", "cards"]);
    expect(groups.map((g) => g.category).every((c, i, a) => i === 0 || CATEGORIES.indexOf(a[i - 1]!) < CATEGORIES.indexOf(c))).toBe(true);
    expect(groups.find((g) => g.category === "enemies")!.questions[0]).toMatchObject({ name: "density", request: "round 2" });
  });
});

describe("the doors' request on the readout", () => {
  const observed = (round: number, questions: string[], dists: Record<string, Record<string, number>>): ObservedRequest => ({
    meta: { run_id: "r", room_index: 3, door_slot: null, round, purpose: DOORS_OUT },
    state: {}, source: "jev", dists,
    questions: Object.fromEntries(questions.map((n) => [n, { instructions: "", criteria: {} }])) as unknown as ObservedRequest["questions"],
  });

  it("joins each answer to its question and shows the cards behind each kind, once", () => {
    const log = [
      observed(1, ["portal_need", "door_spell__overall", "door_spell__variety"], {
        portal_need: { spell: 0.7, stat: 0.3 },
        door_spell__overall: { meteor: 0.8, shock_arc: 0.2 },
        door_spell__variety: { low: 0.1, medium: 0.9 },
      }),
      observed(2, ["spell_school"], { spell_school: { flame: 1 } }),
    ];
    const plans = new Map<string, PlanRecord>([[DOORS_OUT, {
      decisions: [
        { choice: "spell", probabilities: { spell: 0.7, stat: 0.3 }, confidence: 0.7, source: "jev" as const, question: "portal_need" },
        { choice: "medium", probabilities: { low: 0.1, medium: 0.9 }, confidence: 0.9, source: "jev" as const, question: "door_spell__variety" },
        { choice: "grade_2", probabilities: { grade_2: 1 }, confidence: null, source: "rule" as const, question: "normal_grade (code)" },
      ],
      offers: [{ prefix: "door_spell__", label: "spell door", blended: { meteor: 0.7, shock_arc: 0.3 }, ids: ["meteor", "shock_arc"] }],
    }]]);
    const [one, two] = buildReadout(log, plans);
    expect(one!.questions.find((x) => x.name === "portal_need")!.choice).toBe("spell");
    expect(one!.questions.find((x) => x.name === "door_spell__variety")!.choice).toBe("medium");
    expect(one!.questions.find((x) => x.name === "blended offer: spell door")).toMatchObject({ choice: "meteor, shock_arc" });
    // What code drew goes under the last round only, not once a round.
    expect(one!.questions.some((x) => x.name === "normal_grade (code)")).toBe(false);
    expect(two!.questions.filter((x) => x.name === "normal_grade (code)")).toHaveLength(1);
  });
});
