/** Director-side shapes (design docs 002 and 009). */
import type { Distribution } from "@jr/core";

export type DecisionSource = "jev" | "rule" | "random";

export type FallbackPath =
  | "timeout" | "http" | "invalid" | "declined" | "late"
  | "retry_exhausted" | "commit_check" | "deadline"
  /** Not asked: the state holds nothing yet that could decide it (the first room's look). */
  | "no_history";

/** The escape option every question carries (doc 002). */
export const FALLBACK = "fallback";

/**
 * **An option written out rather than matched.**
 *
 * The string form of an option is a sentence ending in "Fits when health is
 * low or critical" — a clause built to be matched against a state of labels.
 * With the briefing the state is no longer a table of labels, so there is
 * nothing for that clause to match and it reads as an assertion about a field
 * that is not there.
 *
 * The object form is what the choice API offers instead: what the option is,
 * what it is *not* for, and a few examples in the same words the state uses.
 * A negative is something a description can carry and a fit clause cannot,
 * and examples are how a classifier is shown a boundary rather than told one.
 */
export interface OptionSpec {
  readonly what: string;
  readonly not_for?: string;
  readonly examples?: readonly string[];
}

export interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  /** Option key to its description, as a sentence or as a spec. Must include `fallback`. */
  readonly criteria: Readonly<Record<string, string | OptionSpec>>;
}

/**
 * **A yes-or-no question, answered with one probability** (TypeSafe's Noul).
 *
 * Used where every option has to be judged on its own rather than against the
 * others: a reward card's fit. A choice question over thirty-nine cards asks
 * which one is *the* answer, and the second-best card of a style comes back
 * near zero however well it fits (jev-findings 35). A Noul per card asks the
 * same thing of each, and one card's yes costs no other card anything.
 *
 * Its answer reaches the rest of the Director as a two-option distribution,
 * `{ yes, no }`, so the source, the rule table and the traces read it as any
 * other question.
 */
export interface NoulQuestion {
  readonly type: "noul";
  readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string };
}

/** The two keys a Noul answer is carried under. */
export const NOUL_YES = "yes";
export const NOUL_NO = "no";

export type Question = ChoiceQuestion | NoulQuestion;

export interface ChoiceAnswer {
  readonly choice: string;
  readonly probabilities: Distribution;
  readonly confidence: number | null;
}

export interface Evaluation {
  readonly answers: Readonly<Record<string, ChoiceAnswer>>;
  readonly usage: { readonly input_tokens: number | null };
  /**
   * Attempts beyond the first that the evaluator had to make — an overloaded
   * upstream answering `529`, backed off and asked again inside the room's
   * deadline. Recorded because a run that quietly retried half its requests
   * and a run that did not are the same run in every other number, and the
   * first one is a warning (doc 011).
   */
  readonly retries?: number;
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
  readonly questions: Readonly<Record<string, Question>>;
  readonly signal: AbortSignal;
  readonly meta: RequestMeta;
}

export type Evaluator = (req: EvaluatorRequest) => Promise<Evaluation>;

/** Thrown for every failure the fallback contract routes to RuleDirector. */
export class EvaluatorError extends Error {
  readonly path: FallbackPath;
  /** Attempts beyond the first that were made before giving up. */
  readonly retries: number;
  constructor(path: FallbackPath, message: string, retries = 0) {
    super(message);
    this.path = path;
    this.retries = retries;
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
