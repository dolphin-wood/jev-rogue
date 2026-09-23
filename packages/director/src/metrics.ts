/**
 * The metrics that decide whether the experiment succeeded (design doc 011).
 * Kept separate from collection so they can be recomputed over exported logs.
 */
import { SHOWCASE_FLOOR, showcaseRatio } from "@jr/core";
import type { CounterScore } from "@jr/core";
import type { DecisionTrace } from "./trace.ts";

export interface Metrics {
  /** Share of picks equal to the offered card with the highest blended probability. */
  readonly agreement_in_offer: number | null;
  /** Share of offers that contained the pool's top-blended item. Temperature diagnostic. */
  readonly pool_top_presence: number | null;
  /** Share of Jev answers that reached the player unmodified. */
  readonly director_fidelity: number | null;
  readonly fallback_rate: number;
  readonly by_fallback_path: Readonly<Record<string, number>>;
  readonly latency_p50: number | null;
  readonly latency_p95: number | null;
  readonly input_tokens: number;
  readonly decisions: number;
}

export const AGREEMENT_BAND: readonly [number, number] = [0.4, 0.7];
export const FIDELITY_TARGET = 0.8;

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  // nearest-rank, so p95 of a short run names a real observation
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[i]!;
}

export function computeMetrics(traces: readonly DecisionTrace[]): Metrics {
  const applied = traces.filter((t) => t.applied);
  const rewards = applied.filter((t) => t.purpose === "rewards" && t.offer);

  const withChoice = rewards.filter((t) => t.player_choice_rank_in_offer != null);
  const agreement_in_offer = withChoice.length
    ? withChoice.filter((t) => t.player_choice_rank_in_offer === 1).length / withChoice.length
    : null;

  const pool_top_presence = rewards.length
    ? rewards.filter((t) => t.offer!.rank_in_pool.includes(1)).length / rewards.length
    : null;

  // Fidelity is only meaningful where Jev actually answered.
  const jevAnswered = applied.filter((t) => t.director_mode === "jev" && t.source === "jev");
  const director_fidelity = jevAnswered.length
    ? jevAnswered.filter((t) => t.unmodified).length / jevAnswered.length
    : null;

  const jevAttempted = applied.filter((t) => t.director_mode === "jev");
  const fallbacks = jevAttempted.filter((t) => t.source !== "jev");
  const by_fallback_path: Record<string, number> = {};
  for (const t of fallbacks) {
    const k = t.fallback_path ?? "unknown";
    by_fallback_path[k] = (by_fallback_path[k] ?? 0) + 1;
  }

  const latencies = applied.flatMap((t) => (t.latency_ms == null ? [] : [t.latency_ms]));

  return {
    agreement_in_offer,
    pool_top_presence,
    director_fidelity,
    fallback_rate: jevAttempted.length ? fallbacks.length / jevAttempted.length : 0,
    by_fallback_path,
    latency_p50: percentile(latencies, 0.5),
    latency_p95: percentile(latencies, 0.95),
    input_tokens: applied.reduce((a, t) => a + (t.input_tokens ?? 0), 0),
    decisions: applied.length,
  };
}

export interface CharterReport {
  readonly ok: boolean;
  readonly showcase_ratio: number;
  readonly violations: readonly string[];
}

/**
 * Charter compliance is a bug check, not a metric (doc 001). `combatScores`
 * excludes elite rooms, which count on neither side of the ratio.
 */
export function checkCharter(input: {
  readonly combatScores: readonly CounterScore[];
  readonly shieldedRooms: number;
  readonly totalRooms: number;
  readonly bossPhasesCounteringBuild: number;
  readonly minEffectivenessObserved: number;
}): CharterReport {
  const violations: string[] = [];
  const ratio = showcaseRatio(input.combatScores);
  if (input.combatScores.length > 0 && ratio < SHOWCASE_FLOOR - 1e-9)
    violations.push(`showcase ratio ${(ratio * 100).toFixed(1)}% is below the ${SHOWCASE_FLOOR * 100}% floor`);
  if (input.totalRooms > 0 && input.shieldedRooms / input.totalRooms > 0.3 + 1e-9)
    violations.push(`shielded appeared in ${input.shieldedRooms} of ${input.totalRooms} rooms, over 30%`);
  if (input.bossPhasesCounteringBuild > 1)
    violations.push(`${input.bossPhasesCounteringBuild} boss phases counter the build, at most one is allowed`);
  if (input.minEffectivenessObserved < 0.5 - 1e-9)
    violations.push(`primary damage path fell to ${(input.minEffectivenessObserved * 100).toFixed(0)}%, the floor is 50%`);
  return { ok: violations.length === 0, showcase_ratio: ratio, violations };
}

/** Ranking form of the blind test (doc 011): strictly above on both questions. */
export interface TesterRanking {
  readonly arranged: Readonly<Record<"jev" | "rule" | "random", number>>;
  readonly replay: Readonly<Record<"jev" | "rule" | "random", number>>;
}

export function blindTestResult(rankings: readonly TesterRanking[]) {
  const strictlyAbove = (r: TesterRanking, a: "jev" | "rule" | "random", b: "jev" | "rule" | "random") =>
    r.arranged[a] < r.arranged[b] && r.replay[a] < r.replay[b];
  const n = rankings.length;
  const primary = n ? rankings.filter((r) => strictlyAbove(r, "jev", "rule")).length / n : 0;
  return {
    testers: n,
    jev_over_rule: primary,
    jev_over_random: n ? rankings.filter((r) => strictlyAbove(r, "jev", "random")).length / n : 0,
    rule_over_random: n ? rankings.filter((r) => strictlyAbove(r, "rule", "random")).length / n : 0,
    passes: n >= 12 && primary >= 0.65,
  };
}
