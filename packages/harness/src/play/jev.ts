/**
 * The Jev arm from Node, for the harness (task 12).
 *
 * The browser reaches TypeSafe through the project's proxy; the harness runs
 * the same proxy in-process (`server/worker.ts`'s `handle`) instead of
 * standing one up, so what it measures is what the game sends — the model
 * and the key are added in exactly one place.
 *
 * Calls cost money, so every evaluator made here has a hard budget: past it,
 * a request fails before it leaves the machine and the Director answers from
 * the rule table, as it does for any other failure (doc 002).
 *
 * The key is read from the environment (`node --env-file=.env.local`) and is
 * never printed or logged.
 */
import { appendFileSync } from "node:fs";
import { createEvaluator, EvaluatorError } from "@jr/director";
import type { Evaluator } from "@jr/director";
import { handle } from "../../../../server/worker.ts";

const UPSTREAM = "https://api.typesafe.ai/v1/systemone";

export interface JevLedger {
  /** Requests that reached TypeSafe, retries included: this is the money. */
  calls: number;
  /** Requests refused locally because the budget was spent. */
  refused: number;
  failures: number;
  /** Attempts that came back rate-limited, and evaluations a retry rescued. */
  rateLimited: number;
  retried: number;
  latencies: number[];
  inputTokens: number;
}

export interface JevOptions {
  /** Most requests allowed to reach TypeSafe over this evaluator's life. */
  readonly budget: number;
  /** Appends each request and response (never the key) as a JSON line. */
  readonly logFile?: string;
  readonly timeoutMs?: number;
  /**
   * Least time between two requests leaving the machine, and how many extra
   * attempts a rate-limited one gets. See `pace` below.
   */
  readonly minGapMs?: number;
  readonly attempts?: number;
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** A 429 or a 529: the upstream is asking for time, not refusing the request. */
function rateLimited(e: unknown): boolean {
  return e instanceof EvaluatorError && /\b(429|529)\b/.test(e.message);
}

export function jevEvaluator(options: JevOptions): { evaluate: Evaluator; ledger: JevLedger } {
  const key = process.env["TYPESAFE_API_KEY"];
  if (!key) throw new Error("TYPESAFE_API_KEY is not set (run with --env-file=.env.local)");
  const ledger: JevLedger = { calls: 0, refused: 0, failures: 0, rateLimited: 0, retried: 0, latencies: [], inputTokens: 0 };
  const env = { TYPESAFE_API_KEY: key, ALLOWED_ORIGIN: "" };
  // The evaluator reports a failed status without its body; the body is what says why.
  let lastError = "";

  const inner = createEvaluator({
    url: "http://harness.local/api/decide",
    timeoutMs: options.timeoutMs ?? 15_000,
    fetch: async (url, init) => handle(new Request(url, init), env, async (u, i) => {
      if (String(u) !== UPSTREAM) throw new Error("unexpected upstream");
      lastError = "";
      const res = await fetch(u, i);
      if (!res.ok) lastError = (await res.clone().text()).slice(0, 600);
      return res;
    }),
  });

  /*
   * **Pace the run.** A played run puts a whole fight between two requests; the
   * harness puts nothing between them and fires a run's worth in a few seconds,
   * which the upstream rate-limits. Measured without this, six requests of four
   * runs came back 429, three of them consecutively, and doc 002's circuit
   * breaker did exactly what it should — it switched two of the four runs to
   * the rule table for good. The result was a 51% fallback rate that said
   * nothing whatever about the questions.
   *
   * So the harness spaces its requests and gives a rate-limited one more
   * attempts, because the thing being measured is the Director's answers, not
   * the upstream's throughput. Every attempt that leaves the machine is
   * counted, retries included: the budget is money, not requests.
   *
   * The gap is seconds, not milliseconds. At 700 ms — about eighty requests a
   * minute — the limit was still reached after about twenty requests and the
   * retries were refused as well, which is a quota over a window rather than a
   * burst rule. A played run is slower than this by a wide margin.
   */
  const minGapMs = options.minGapMs ?? 3_500;
  const attempts = Math.max(1, options.attempts ?? 3);
  let ready: Promise<void> = Promise.resolve();
  let last = 0;
  const pace = async () => {
    const mine = ready.then(async () => {
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
    });
    ready = mine.catch(() => undefined);
    await mine;
  };

  const evaluate: Evaluator = async (req) => {
    const started = Date.now();
    // The upstream's latency, not this evaluator's queue: the pacing wait is
    // the harness standing in for a fight, and folding it in would report the
    // throttle as the model being slow.
    let sent = started;
    const log = (entry: Record<string, unknown>) => {
      if (options.logFile) appendFileSync(options.logFile, JSON.stringify({
        purpose: req.meta.purpose, round: req.meta.round, room: req.meta.room_index,
        ms: Date.now() - sent, state: req.state, questions: req.questions, ...entry,
      }) + "\n");
    };

    let last429: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (ledger.calls >= options.budget) {
        ledger.refused++;
        throw new EvaluatorError("http", "harness Jev budget spent");
      }
      await pace();
      ledger.calls++;
      sent = Date.now();
      try {
        const result = await inner(req);
        ledger.latencies.push(Date.now() - sent);
        ledger.inputTokens += result.usage.input_tokens ?? 0;
        if (attempt > 0) ledger.retried++;
        log({ answers: result.answers, input_tokens: result.usage.input_tokens, attempt });
        return result;
      } catch (e) {
        // Only a rate limit is worth asking again: doc 002 never retries the
        // rest, and neither does this.
        if (!rateLimited(e) || attempt === attempts - 1) {
          ledger.failures++;
          log({ error: e instanceof EvaluatorError ? `${e.path}: ${e.message}` : String(e), upstream: lastError || undefined, attempt });
          throw e;
        }
        last429 = e;
        ledger.rateLimited++;
        await sleep(1500 * (attempt + 1));
      }
    }
    // Unreachable: the loop either returns or throws on its last attempt.
    throw last429 instanceof Error ? last429 : new EvaluatorError("http", "rate limited");
  };
  return { evaluate, ledger };
}
