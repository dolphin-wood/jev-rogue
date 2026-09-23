import { describe, it, expect } from "vitest";
import { computeMetrics, checkCharter, blindTestResult, AGREEMENT_BAND, FIDELITY_TARGET } from "./metrics.ts";
import { memorySink } from "./trace.ts";
import type { DecisionTrace, TesterRanking } from "./index.ts";

const base: DecisionTrace = {
  run_id: "r", run_seed: "s", room_index: 1, door_slot: null, round: 1,
  purpose: "rewards", director_mode: "jev", source: "jev",
  content_hash: "c", prompt_hash: "p", model: "jev-latest",
  state: {}, questions: {}, sampled: ["a"], validation_failures: [], retries: 0,
  latency_ms: 100, input_tokens: 1000, applied: true, unmodified: true,
};

const offer = (rankInPool: number[]) => ({
  cards: rankInPool.map((_, i) => `c${i}`),
  rank_in_pool: rankInPool,
  blended_prob: rankInPool.map(() => 0.3),
  affixes: rankInPool.map(() => null),
  trimmed_items: [],
});

describe("computeMetrics", () => {
  it("measures agreement as rank 1 within the offer, not within the pool", () => {
    const traces: DecisionTrace[] = [
      { ...base, offer: offer([4, 7, 9]), player_choice_rank_in_offer: 1, player_choice_rank_in_pool: 4 },
      { ...base, offer: offer([2, 5, 8]), player_choice_rank_in_offer: 3, player_choice_rank_in_pool: 8 },
    ];
    // The pool's top card was in neither offer, yet one pick still agrees.
    expect(computeMetrics(traces).agreement_in_offer).toBe(0.5);
    expect(computeMetrics(traces).pool_top_presence).toBe(0);
  });

  it("counts an offer containing the pool leader", () => {
    const traces = [{ ...base, offer: offer([1, 5, 9]) }];
    expect(computeMetrics(traces).pool_top_presence).toBe(1);
  });

  it("measures fidelity only over decisions Jev actually answered", () => {
    const traces: DecisionTrace[] = [
      { ...base, unmodified: true },
      { ...base, unmodified: false },
      { ...base, source: "rule", fallback_path: "timeout", unmodified: false },
    ];
    const m = computeMetrics(traces);
    expect(m.director_fidelity).toBe(0.5);
    expect(m.fallback_rate).toBeCloseTo(1 / 3, 10);
    expect(m.by_fallback_path).toEqual({ timeout: 1 });
  });

  it("ignores abandoned plans", () => {
    const traces = [{ ...base, applied: false }, { ...base }];
    expect(computeMetrics(traces).decisions).toBe(1);
  });

  it("reports latency percentiles and token totals", () => {
    const traces = [10, 20, 30, 400].map((latency_ms) => ({ ...base, latency_ms }));
    const m = computeMetrics(traces);
    expect(m.latency_p50).toBe(20);
    expect(m.latency_p95).toBe(400);
    expect(m.input_tokens).toBe(4000);
  });

  it("returns null rather than zero when there is nothing to measure", () => {
    const m = computeMetrics([]);
    expect(m.agreement_in_offer).toBeNull();
    expect(m.director_fidelity).toBeNull();
    expect(m.fallback_rate).toBe(0);
  });

  it("exposes the target band and fidelity target as data", () => {
    expect(AGREEMENT_BAND).toEqual([0.4, 0.7]);
    expect(FIDELITY_TARGET).toBe(0.8);
  });
});

describe("checkCharter", () => {
  const ok = {
    combatScores: ["neutral", "counters", "favours"] as const,
    shieldedRooms: 1, totalRooms: 10, bossPhasesCounteringBuild: 1, minEffectivenessObserved: 0.8,
  };

  it("passes a compliant run", () => {
    expect(checkCharter({ ...ok }).ok).toBe(true);
  });

  it("flags a run below the showcase floor", () => {
    const r = checkCharter({ ...ok, combatScores: ["counters", "counters", "neutral"] });
    expect(r.ok).toBe(false);
    expect(r.violations.join(" ")).toMatch(/showcase ratio/);
  });

  it("flags shielded appearing in more than 30 percent of rooms", () => {
    expect(checkCharter({ ...ok, shieldedRooms: 4, totalRooms: 10 }).violations.join(" ")).toMatch(/shielded/);
  });

  it("flags more than one boss phase countering the build", () => {
    expect(checkCharter({ ...ok, bossPhasesCounteringBuild: 2 }).violations.join(" ")).toMatch(/boss phases/);
  });

  it("flags the primary damage path dropping below half", () => {
    expect(checkCharter({ ...ok, minEffectivenessObserved: 0.3 }).violations.join(" ")).toMatch(/damage path/);
  });
});

describe("blindTestResult", () => {
  const rank = (jev: number, rule: number, random: number): TesterRanking => ({
    arranged: { jev, rule, random }, replay: { jev, rule, random },
  });

  it("requires jev strictly above rule on both questions", () => {
    const tie: TesterRanking = { arranged: { jev: 1, rule: 1, random: 3 }, replay: { jev: 1, rule: 2, random: 3 } };
    expect(blindTestResult([tie]).jev_over_rule).toBe(0);
    expect(blindTestResult([rank(1, 2, 3)]).jev_over_rule).toBe(1);
  });

  it("computes each pairwise comparison independently, which a single winner cannot", () => {
    const r = blindTestResult([rank(3, 1, 2), rank(1, 2, 3)]);
    expect(r.jev_over_rule).toBe(0.5);
    expect(r.rule_over_random).toBe(1);
  });

  it("does not pass below twelve testers even at a high rate", () => {
    expect(blindTestResult(Array.from({ length: 11 }, () => rank(1, 2, 3))).passes).toBe(false);
    expect(blindTestResult(Array.from({ length: 12 }, () => rank(1, 2, 3))).passes).toBe(true);
  });
});

describe("memorySink", () => {
  it("collects traces for the debug panel and the metrics pass", () => {
    const sink = memorySink();
    sink.write(base);
    expect(sink.traces).toHaveLength(1);
  });
});
