/**
 * Server-side choice evaluator for TypeSafe's System One endpoint
 * (design docs 002 "Evaluator" and 009 "Evaluator transport").
 *
 * The browser posts to the project's own proxy, which adds the API key and the
 * model; the key never reaches client code, and TypeSafe rejects browser
 * origins by CORS in any case. Timeouts, retries and validation live here so
 * the proxy stays trivial.
 */
import { z } from "zod";
import { validateDistribution } from "@jr/core";
import { EvaluatorError } from "./types.ts";
import type { ChoiceAnswer, Evaluation, Evaluator, EvaluatorRequest } from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 6000;
const RETRY_BACKOFF_MS = 500;
/** Do not start a retry unless this much of the budget remains. */
const RETRY_MIN_REMAINING_MS = 3000;
const RETRYABLE_STATUS = new Set([429, 529]);
/** Client-side ceiling; the proxy allows 64 KB (doc 009). */
export const MAX_BODY_BYTES = 48 * 1024;

const probability = z.number().finite().min(0).max(1.0001);
const responseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal("choice"),
      choice: z.string(),
      probabilities: z.record(z.string(), probability),
      confidence: probability.nullish(),
    }),
  ),
  usage: z.object({ input_tokens: z.number().int().nonnegative().optional() }).partial().optional(),
});

export interface EvaluatorOptions {
  /** Proxy URL; `/api/decide` in development (doc 009). */
  readonly url: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export function createEvaluator(options: EvaluatorOptions): Evaluator {
  const url = options.url?.trim();
  if (!url) throw new Error("an evaluator needs a proxy URL");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new Error("timeoutMs must be a positive integer");
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return async (req: EvaluatorRequest): Promise<Evaluation> => {
    const deadline = now() + timeoutMs;
    const body = JSON.stringify({ state: req.state, questions: req.questions });
    if (body.length > MAX_BODY_BYTES)
      throw new EvaluatorError("invalid", `request body is ${body.length} bytes, over the ${MAX_BODY_BYTES} budget`);

    let attempt = 0;
    for (;;) {
      attempt++;
      const remaining = deadline - now();
      if (remaining <= 0) throw new EvaluatorError("timeout", "evaluation budget exhausted");

      const controller = new AbortController();
      const onAbort = () => controller.abort(req.signal.reason);
      req.signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("timeout")), remaining);

      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-jr-run": req.meta.run_id,
            "x-jr-purpose": req.meta.purpose,
            "x-jr-round": String(req.meta.round),
          },
          body,
          signal: controller.signal,
          cache: "no-store",
        });
      } catch (e) {
        if (req.signal.aborted) throw new EvaluatorError("late", "request abandoned by the caller");
        throw new EvaluatorError("timeout", `request failed: ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
        req.signal.removeEventListener("abort", onAbort);
      }

      if (!res.ok) {
        const retryable = RETRYABLE_STATUS.has(res.status);
        const budgetLeft = deadline - now() - RETRY_BACKOFF_MS;
        if (retryable && attempt === 1 && budgetLeft >= RETRY_MIN_REMAINING_MS) {
          await sleep(RETRY_BACKOFF_MS);
          continue;
        }
        throw new EvaluatorError(
          retryable ? "retry_exhausted" : "http",
          `evaluation failed with HTTP ${res.status}`,
        );
      }

      const parsed = responseSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new EvaluatorError("invalid", "evaluator returned a malformed response");
      return validate(parsed.data, req);
    }
  };
}

function validate(
  data: z.infer<typeof responseSchema>,
  req: EvaluatorRequest,
): Evaluation {
  const answers: Record<string, ChoiceAnswer> = {};
  for (const [name, question] of Object.entries(req.questions)) {
    const answer = data.answers[name];
    if (!answer) throw new EvaluatorError("invalid", `no answer for question "${name}"`);

    const offered = Object.keys(question.criteria);
    if (!offered.includes(answer.choice))
      throw new EvaluatorError("invalid", `question "${name}" answered outside the offered criteria`);

    const reason = validateDistribution(answer.probabilities, offered);
    if (reason) throw new EvaluatorError("invalid", `question "${name}": ${reason}`);

    // Declining is not an error and is not decided here: it hands that one
    // question to the rule table, which the source does (doc 002).

    answers[name] = {
      choice: answer.choice,
      probabilities: answer.probabilities,
      confidence: answer.confidence ?? null,
    };
  }
  return { answers, usage: { input_tokens: data.usage?.input_tokens ?? null } };
}
