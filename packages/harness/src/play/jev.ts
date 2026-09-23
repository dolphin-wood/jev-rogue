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
  /** Requests that reached TypeSafe. */
  calls: number;
  /** Requests refused locally because the budget was spent. */
  refused: number;
  failures: number;
  latencies: number[];
  inputTokens: number;
}

export interface JevOptions {
  /** Most requests allowed to reach TypeSafe over this evaluator's life. */
  readonly budget: number;
  /** Appends each request and response (never the key) as a JSON line. */
  readonly logFile?: string;
  readonly timeoutMs?: number;
}

export function jevEvaluator(options: JevOptions): { evaluate: Evaluator; ledger: JevLedger } {
  const key = process.env["TYPESAFE_API_KEY"];
  if (!key) throw new Error("TYPESAFE_API_KEY is not set (run with --env-file=.env.local)");
  const ledger: JevLedger = { calls: 0, refused: 0, failures: 0, latencies: [], inputTokens: 0 };
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

  const evaluate: Evaluator = async (req) => {
    if (ledger.calls >= options.budget) {
      ledger.refused++;
      throw new EvaluatorError("http", "harness Jev budget spent");
    }
    ledger.calls++;
    const started = Date.now();
    const log = (entry: Record<string, unknown>) => {
      if (options.logFile) appendFileSync(options.logFile, JSON.stringify({
        purpose: req.meta.purpose, round: req.meta.round, room: req.meta.room_index,
        ms: Date.now() - started, state: req.state, questions: req.questions, ...entry,
      }) + "\n");
    };
    try {
      const result = await inner(req);
      ledger.latencies.push(Date.now() - started);
      ledger.inputTokens += result.usage.input_tokens ?? 0;
      log({ answers: result.answers, input_tokens: result.usage.input_tokens });
      return result;
    } catch (e) {
      ledger.failures++;
      log({ error: e instanceof EvaluatorError ? `${e.path}: ${e.message}` : String(e), upstream: lastError || undefined });
      throw e;
    }
  };
  return { evaluate, ledger };
}
