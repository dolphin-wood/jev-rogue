/**
 * Where a decision's distribution comes from (design docs 002 and 011).
 *
 * Jev, the rule table and flat random are the same pipeline with one part
 * swapped. Writing them as three `DistributionSource` implementations, rather
 * than three Directors, is what makes the blind test compare that one part
 * and nothing else: the option filters, the samplers, the generators and the
 * validation are literally the same code on every arm.
 */
import { validateDistribution } from "@jr/core";
import type { Distribution } from "@jr/core";
import { EvaluatorError, FALLBACK } from "./types.ts";
import type {
  ChoiceQuestion, DecisionSource, Evaluator, FallbackPath, RequestMeta,
} from "./types.ts";
import { offeredKeys } from "./questions/common.ts";

export interface SourceResult {
  readonly dists: Readonly<Record<string, Distribution>>;
  readonly confidence: Readonly<Record<string, number | null>>;
  readonly source: DecisionSource;
  readonly fallback_path?: FallbackPath;
  readonly latency_ms: number | null;
  readonly input_tokens: number | null;
  /**
   * Questions Jev declined — chose the escape option, or put more than half
   * its mass there. They have no entry in `dists`; the Director asks the rule
   * table for those alone and keeps every other answer (doc 002).
   */
  readonly declined?: readonly string[];
}

export interface DistributionSource {
  readonly kind: DecisionSource;
  distributions(
    questions: Readonly<Record<string, ChoiceQuestion>>,
    state: Readonly<Record<string, unknown>>,
    meta: RequestMeta,
    signal: AbortSignal,
  ): Promise<SourceResult>;
}

/** Weights a rule table assigns to one question's options. */
export type WeightTable = (
  questionName: string,
  optionId: string,
  state: Readonly<Record<string, unknown>>,
) => number;

function normalise(keys: readonly string[], weight: (k: string) => number): Distribution {
  const raw = keys.map((k) => Math.max(0, weight(k)));
  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= 0) return Object.fromEntries(keys.map((k) => [k, 1 / keys.length]));
  return Object.fromEntries(keys.map((k, i) => [k, raw[i]! / total]));
}

/** A table-driven source. The escape option is never offered any mass. */
export function tableSource(kind: DecisionSource, table: WeightTable): DistributionSource {
  return {
    kind,
    async distributions(questions, state) {
      const dists: Record<string, Distribution> = {};
      const confidence: Record<string, number | null> = {};
      for (const [name, q] of Object.entries(questions)) {
        const keys = offeredKeys(q);
        dists[name] = normalise(keys, (k) => table(name, k, state));
        confidence[name] = null;
      }
      return { dists, confidence, source: kind, latency_ms: null, input_tokens: null };
    },
  };
}

/** Ignores every label; the experimental floor only (doc 002). */
export const flatTable: WeightTable = () => 1;

/**
 * The Jev source. Any failure throws `EvaluatorError`, which the Director
 * catches and replaces with the rule source for that one decision, per the
 * fallback contract.
 */
export function jevSource(evaluate: Evaluator, now: () => number = Date.now): DistributionSource {
  return {
    kind: "jev",
    async distributions(questions, state, meta, signal) {
      const started = now();
      const result = await evaluate({ state, questions, signal, meta });
      const dists: Record<string, Distribution> = {};
      const confidence: Record<string, number | null> = {};
      const declined: string[] = [];

      for (const [name, q] of Object.entries(questions)) {
        const answer = result.answers[name];
        if (!answer) throw new EvaluatorError("invalid", `no answer for "${name}"`);
        const reason = validateDistribution(answer.probabilities, Object.keys(q.criteria));
        if (reason) throw new EvaluatorError("invalid", `question "${name}": ${reason}`);

        // The escape option is removed before sampling: it is Jev declining,
        // not a gameplay answer. Choosing it, or mass above half on it, hands
        // this one question to the rule table (doc 002).
        const escape = answer.probabilities[FALLBACK] ?? 0;
        if (escape > 0.5 || answer.choice === FALLBACK) { declined.push(name); continue; }
        const keys = offeredKeys(q);
        if (keys.length === 0) throw new EvaluatorError("invalid", `question "${name}" offered nothing`);
        dists[name] = normalise(keys, (k) => answer.probabilities[k] ?? 0);
        confidence[name] = answer.confidence;
      }

      return {
        dists,
        confidence,
        source: "jev",
        latency_ms: Math.round(now() - started),
        input_tokens: result.usage.input_tokens,
        ...(declined.length ? { declined } : {}),
      };
    },
  };
}
