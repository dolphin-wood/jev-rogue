/**
 * **How a Jev answer becomes a choice**, for the two exceptions to "its top
 * when it is confident": the questions about how often a kind of room comes
 * up, drawn from Jev's distribution as given, and the variant ranking, whose
 * escape is a stop rather than a decline.
 */
import { describe, expect, it } from "vitest";
import {
  ITEMS, MAX_HEARTS, bucketClearSpeed, bucketGold, bucketHealth, bucketMovementPressure,
  bucketRecentDamage, bucketRunProgress, emptyHistory, heldDominantTags, plainInstance, UNMEASURED,
} from "@jr/core";
import type { RunContext } from "@jr/core";
import { createDirector } from "./director.ts";
import type { Decision } from "./types.ts";
import { jevSource } from "./source.ts";
import { FALLBACK } from "./types.ts";
import type { ChoiceQuestion, Evaluator } from "./types.ts";

function ctx(seed: string, index: number): RunContext {
  const slots = [plainInstance("magic_bolt"), plainInstance("spark_spray"), null];
  return {
    run_id: seed, seed, room_index: index,
    labels: {
      health: bucketHealth(MAX_HEARTS), recent_damage: bucketRecentDamage(0),
      clear_speed: bucketClearSpeed(30_000, 30_000), movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(index), gold: bucketGold(40),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
      observed: UNMEASURED,
    },
    staff: { slots: 6, mana_max: 120 }, slots, inventory: [],
    history: { ...emptyHistory(), rooms: Array(index).fill("combat"), tensions: Array(index).fill("build") },
    intent: { preset: "spam" },
  };
}

/**
 * A confident Jev: 0.8 on each question's first option and the rest spread,
 * which is past `JEV_CONFIDENT` on every question with three options or fewer.
 * The variant ranking puts 0.6 on the escape, as the live model did.
 */
const confident: Evaluator = async ({ questions }) => ({
  answers: Object.fromEntries(Object.entries(questions).map(([name, q]) => {
    const keys = Object.keys(q.criteria).filter((k) => k !== FALLBACK);
    const escape = name === "subspecies" ? 0.6 : 0;
    const rest = keys.length > 1 ? (1 - escape) * 0.2 / (keys.length - 1) : 0;
    const probabilities: Record<string, number> = { [FALLBACK]: escape };
    keys.forEach((k, i) => { probabilities[k] = i === 0 ? (1 - escape) * (keys.length > 1 ? 0.8 : 1) : rest; });
    return [name, { choice: name === "subspecies" ? FALLBACK : keys[0]!, probabilities, confidence: 0.7 }];
  })),
  usage: { input_tokens: null },
});

async function decisions(n: number): Promise<Decision[]> {
  const out: Decision[] = [];
  const director = createDirector("jev", { evaluate: confident });
  for (let i = 0; i < n; i++) {
    const index = 6 + (i % 6);
    const plan = await director.planRoom(ctx(`s-${i}`, index), { room_index: index, door_slot: 0, room_type: "combat" }, "build");
    out.push(...plan.decisions);
  }
  return out;
}

const top = (d: Decision) => Object.entries(d.probabilities).sort((a, b) => b[1] - a[1])[0]![0];

describe("a confident Jev answer", () => {
  it("is drawn as given on a question about how often, so its second answer still happens", async () => {
    const all = await decisions(80);
    for (const q of ["composition", "wave_structure", "subspecies_weight"]) {
      const asked = all.filter((d) => d.question === q && d.source === "jev");
      expect(asked.length, q).toBeGreaterThan(20);
      expect(asked.some((d) => d.choice !== top(d)), `${q} never left its top`).toBe(true);
      // ... and still mostly its top: drawn as given, not flattened.
      expect(asked.filter((d) => d.choice === top(d)).length / asked.length, q).toBeGreaterThan(0.5);
    }
  });

  it("is taken at its top on a question about getting the one room right", async () => {
    const asked = (await decisions(40)).filter((d) => d.question === "size" && d.source === "jev");
    expect(asked.length).toBeGreaterThan(10);
    for (const d of asked) expect(d.choice).toBe(top(d));
  });
});

describe("the variant ranking's escape", () => {
  const q = (): ChoiceQuestion => ({
    type: "choice", instructions: "x",
    criteria: { lancer: "a", wisp: "b", [FALLBACK]: "none of these" },
  });
  const answer: Evaluator = async ({ questions }) => ({
    answers: Object.fromEntries(Object.keys(questions).map((name) => [name, {
      choice: FALLBACK, probabilities: { lancer: 0.3, wisp: 0.1, [FALLBACK]: 0.6 }, confidence: 0.2,
    }])),
    usage: { input_tokens: null },
  });

  it("is a stop: the ranking among the bodies Jev weighed is kept, and nothing is declined", async () => {
    const r = await jevSource(answer).distributions({ subspecies: q() }, {}, {} as never, new AbortController().signal);
    expect(r.declined).toBeUndefined();
    expect(r.dists["subspecies"]!["lancer"]).toBeCloseTo(0.75, 5);
    expect(r.dists["subspecies"]!["wisp"]).toBeCloseTo(0.25, 5);
  });

  it("still declines any other question with the same answer", async () => {
    const r = await jevSource(answer).distributions({ anchor: q() }, {}, {} as never, new AbortController().signal);
    expect(r.declined).toEqual(["anchor"]);
  });

  it("never shows as declined in a planned room", async () => {
    const ranked = (await decisions(60)).filter((d) => d.question === "subspecies");
    expect(ranked.length).toBeGreaterThan(0);
    for (const d of ranked) {
      expect(d.source).toBe("jev");
      expect(d.fallback_path).toBeUndefined();
    }
  });
});
