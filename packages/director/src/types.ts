/** Director-side shapes (design docs 002 and 009). */
import type { Distribution } from "@jr/core";

export type DecisionSource = "jev" | "rule" | "random";

export type FallbackPath =
  | "timeout" | "http" | "invalid" | "declined" | "late"
  | "retry_exhausted" | "commit_check" | "deadline";

/** The escape option every question carries (doc 002). */
export const FALLBACK = "fallback";

export interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  /** Option key to description. Must include `fallback`. */
  readonly criteria: Readonly<Record<string, string>>;
}

export interface ChoiceAnswer {
  readonly choice: string;
  readonly probabilities: Distribution;
  readonly confidence: number | null;
}

export interface Evaluation {
  readonly answers: Readonly<Record<string, ChoiceAnswer>>;
  readonly usage: { readonly input_tokens: number | null };
}

export interface RequestMeta {
  readonly run_id: string;
  readonly room_index: number;
  readonly door_slot: number | null;
  readonly round: number;
  readonly purpose: string;
}

export interface EvaluatorRequest {
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, ChoiceQuestion>>;
  readonly signal: AbortSignal;
  readonly meta: RequestMeta;
}

export type Evaluator = (req: EvaluatorRequest) => Promise<Evaluation>;

/** Thrown for every failure the fallback contract routes to RuleDirector. */
export class EvaluatorError extends Error {
  readonly path: FallbackPath;
  constructor(path: FallbackPath, message: string) {
    super(message);
    this.path = path;
    this.name = "EvaluatorError";
  }
}

export interface Decision<T extends string = string> {
  readonly choice: T;
  readonly probabilities: Distribution;
  readonly confidence: number | null;
  readonly source: DecisionSource;
  readonly fallback_path?: FallbackPath;
  /** Which question this answers, for showing a plan's decisions by name. */
  readonly question?: string;
}
