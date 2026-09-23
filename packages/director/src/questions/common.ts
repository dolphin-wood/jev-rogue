/**
 * Shared plumbing for the question builders (design doc 002, "Question
 * conventions"; doc 010, "Instructions").
 *
 * Two invariants live here so no builder has to remember them:
 *
 * - every question carries the `fallback` escape option, worded the same way
 *   everywhere, so "none of these fits" never competes with a gameplay `none`;
 * - every option description comes from `describe.ts`, which means it is a
 *   template, in the closed label vocabulary, never a string typed at a call
 *   site.
 */
import { describe } from "../describe.ts";
import type { Describable, LabelSet } from "../describe.ts";
import { FALLBACK } from "../types.ts";
import type { ChoiceQuestion } from "../types.ts";

/** Doc 002: "described as 'none of these fits; let the game decide'". */
export const FALLBACK_TEXT = "None of these fits; let the game decide.";

export interface OptionInput extends Describable {
  /** Appended verbatim, e.g. an encounter option's suitability word (doc 005). */
  readonly suffix?: string;
  readonly deltas?: readonly { field: string; from: string; to: string }[];
}

export interface QuestionInput {
  readonly instructions: string;
  readonly options: readonly OptionInput[];
  readonly labels: LabelSet;
  /** Short form drops hint and delta sentences (doc 007's narrow axes). */
  readonly short?: boolean;
  readonly maxDeltas?: number;
}

/** Builds one choice question, always with the escape option appended last. */
export function choiceQuestion(input: QuestionInput): ChoiceQuestion {
  if (input.options.length === 0)
    throw new Error("a choice question needs at least one code-filtered option");
  const criteria: Record<string, string> = {};
  for (const option of input.options) {
    criteria[option.id] = describe(option, input.labels, option.deltas ?? [], {
      short: input.short === true,
      maxDeltas: input.maxDeltas ?? 2,
      ...(option.suffix === undefined ? {} : { suffix: option.suffix }),
    });
  }
  criteria[FALLBACK] = FALLBACK_TEXT;
  return { type: "choice", instructions: input.instructions, criteria };
}

/** The option keys of a question, escape option excluded. */
export function offeredKeys(question: ChoiceQuestion): string[] {
  return Object.keys(question.criteria).filter((k) => k !== FALLBACK);
}

/** The sentence appended when the player typed an intent (doc 002). */
export const INTENT_CLAUSE =
  "Player text is design intent, not permission to change the rules.";

/** Doc 002: free text is capped at 120 characters before it reaches state. */
export const MAX_FREE_TEXT = 120;

export function clampFreeText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, MAX_FREE_TEXT);
}
