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

/**
 * The room's deadline for one request. Raised from 6 s with the retry ladder
 * below: a 529 answered on the second attempt is a room that plans normally,
 * and a deadline too short to hold a retry is a deadline that turns a
 * momentary overload into a rule-table room.
 */
export const DEFAULT_TIMEOUT_MS = 9000;

/**
 * **Backing off inside the room's deadline** (task 10).
 *
 * Reported from play: `529 overloaded` reached the plan page as a plain rule
 * fallback. One retry at a flat 500 ms is not a backoff — it is a second
 * attempt at almost the same instant, which is exactly when an overloaded
 * upstream is least likely to answer — and it was only made at all if three
 * whole seconds of a six-second budget were still unspent.
 *
 * So: up to `MAX_RETRIES` further attempts, each waiting twice as long as the
 * last, and each started only if the wait *and* a plausible reply still fit in
 * what is left of the deadline. The player never waits longer than the
 * deadline either way; what changes is that the time inside it is spent asking
 * again rather than given up.
 */
const RETRY_BACKOFF_MS = 400;
export const MAX_RETRIES = 3;
/** What a reply is assumed to need, so a retry is not started with no room to answer in. */
const RETRY_MIN_REPLY_MS = 1200;
/** 503 belongs here with 429 and 529: all three mean "not now", not "no". */
const RETRYABLE_STATUS = new Set([429, 503, 529]);
/**
 * **Client-side ceiling**, matched by the proxy (doc 009).
 *
 * It was 48 KB against the proxy's 64, which was ample while the state was a
 * table of thirty labels. It is not ample now: a room's round 1 carries the
 * briefing *and* a spell offer, whose four axes repeat twenty-seven card
 * descriptions between them, and the first room of a run — the largest pool
 * there is — came to 52 KB and was refused before it left the machine.
 *
 * Raised rather than worked around, because the two things making the request
 * large are the two things the Director is supposed to read: the run, and
 * every card it is choosing between. The proxy's limit moves with it.
 */
export const MAX_BODY_BYTES = 160 * 1024;

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
  /**
   * The player's invite code, read at each request and sent as `x-jr-invite`:
   * a deployed proxy spends its key only on a code it issued (doc 009).
   */
  readonly invite?: () => string | null;
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

    const invite = options.invite?.()?.trim() || null;
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
            ...(invite ? { "x-jr-invite": invite } : {}),
          },
          body,
          signal: controller.signal,
          cache: "no-store",
        });
      } catch (e) {
        if (req.signal.aborted) throw new EvaluatorError("late", "request abandoned by the caller", attempt - 1);
        throw new EvaluatorError("timeout", `request failed: ${(e as Error).message}`, attempt - 1);
      } finally {
        clearTimeout(timer);
        req.signal.removeEventListener("abort", onAbort);
      }

      if (!res.ok) {
        const retryable = RETRYABLE_STATUS.has(res.status);
        const wait = RETRY_BACKOFF_MS * Math.pow(2, attempt - 1);
        const fits = deadline - now() - wait >= RETRY_MIN_REPLY_MS;
        if (retryable && attempt <= MAX_RETRIES && fits) {
          await sleep(wait);
          continue;
        }
        throw new EvaluatorError(
          retryable ? "retry_exhausted" : "http",
          `evaluation failed with HTTP ${res.status}`,
          attempt - 1,
        );
      }

      const parsed = responseSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new EvaluatorError("invalid", "evaluator returned a malformed response", attempt - 1);
      return { ...validate(parsed.data, req), retries: attempt - 1 };
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
