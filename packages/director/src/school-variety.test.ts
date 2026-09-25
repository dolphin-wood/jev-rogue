/**
 * **A school sits out the spell doors after it is promised**, on the rule arm.
 * A player who took a storm spell was offered storm on door after door: the
 * rule arm puts half its mass on the style's two schools and its table cannot
 * read the run. Jev can — its briefing carries its own answers — so it is not
 * capped.
 */
import { describe, expect, it } from "vitest";
import { SPELL_SCHOOLS, STAT_FAMILIES, emptyHistory, runStaff } from "@jr/core";
import type { RunContext } from "@jr/core";
import { createDirector } from "./director.ts";
import type { ChoiceAnswer, Evaluator } from "./types.ts";

function ctx(room: number): RunContext {
  return {
    run_id: "school", seed: `school-${room}`, room_index: room,
    labels: {
      health: "ok", recent_damage: "some", clear_speed: "normal",
      movement_pressure_recent: "light", run_progress: "early", gold: "ok",
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: [], consistency: "on_plan" },
    },
    staff: runStaff(),
    slots: [null, null, null],
    inventory: [],
    history: emptyHistory(),
    intent: { preset: "spam" },
  };
}

const choices = {
  count: 3, kinds: ["spell", "affix", "stat"] as const, npcKinds: [] as const,
  elite: false, lateGrade: false, schools: SPELL_SCHOOLS, families: STAT_FAMILIES,
};

/** A Jev that puts everything on storm whenever storm is offered, and on its first option otherwise. */
const stormJev: Evaluator = async (req) => {
  const answers: Record<string, ChoiceAnswer> = {};
  for (const [name, q] of Object.entries(req.questions)) {
    const keys = Object.keys(q.criteria);
    const pick = keys.includes("storm") ? "storm" : keys[0]!;
    answers[name] = { choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 1 : 0])), confidence: 0.9 };
  }
  return { answers, usage: { input_tokens: 1 } };
};

async function schools(arm: "rule" | "jev"): Promise<string[]> {
  const director = createDirector(arm, arm === "jev" ? { evaluate: stormJev } : {});
  const out: string[] = [];
  for (let room = 1; room <= 14; room++) {
    const plan = await director.planPortals(ctx(room), choices);
    const door = plan.doors.find((d) => d.reward === "spell" && d.school);
    if (door?.school) out.push(door.school);
  }
  return out;
}

describe("the school a spell door promises", () => {
  it("never repeats inside three spell doors on the rule arm", async () => {
    const seen = await schools("rule");
    expect(seen.length).toBeGreaterThanOrEqual(10);
    for (let i = 0; i < seen.length; i++)
      expect(seen.slice(Math.max(0, i - 2), i), `door ${i}: ${seen.join(" ")}`).not.toContain(seen[i]);
  });

  it("is not capped for Jev, which reads its own answers in the briefing instead", async () => {
    // A Jev that answers storm every time gets storm every time: no option is taken away from it.
    expect(new Set(await schools("jev"))).toEqual(new Set(["storm"]));
  });
});
