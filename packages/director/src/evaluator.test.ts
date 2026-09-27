import { describe, it, expect, vi } from "vitest";
import { createEvaluator, MAX_BODY_BYTES, MAX_RETRIES } from "./evaluator.ts";
import { EvaluatorError, FALLBACK } from "./types.ts";
import type { ChoiceQuestion, EvaluatorRequest, NoulQuestion } from "./types.ts";

const question: ChoiceQuestion = {
  type: "choice",
  instructions: "Pick one.",
  criteria: { a: "option a", b: "option b", [FALLBACK]: "let the game decide" },
};

function request(over: Partial<EvaluatorRequest> = {}): EvaluatorRequest {
  return {
    state: { health: "low" },
    questions: { pick: question },
    signal: new AbortController().signal,
    meta: { run_id: "r1", room_index: 3, door_slot: 0, round: 1, purpose: "rewards" },
    ...over,
  };
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const good = {
  answers: { pick: { type: "choice", choice: "a", probabilities: { a: 0.7, b: 0.2, [FALLBACK]: 0.1 }, confidence: 0.8 } },
  usage: { input_tokens: 1234 },
};

async function expectPath(p: Promise<unknown>, path: string) {
  await expect(p).rejects.toBeInstanceOf(EvaluatorError);
  await p.catch((e: EvaluatorError) => expect(e.path).toBe(path));
}

describe("evaluator", () => {
  it("returns validated answers and usage", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(good));
    const ev = createEvaluator({ url: "/api/decide", fetch: fetch as never });
    const out = await ev(request());
    expect(out.answers.pick!.choice).toBe("a");
    expect(out.answers.pick!.confidence).toBe(0.8);
    expect(out.usage.input_tokens).toBe(1234);
  });

  it("sends only state and questions, never the model or a key", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(good));
    await createEvaluator({ url: "/api/decide", fetch: fetch as never })(request());
    const body = JSON.parse(fetch.mock.calls[0]![1].body as string);
    expect(Object.keys(body).sort()).toEqual(["questions", "state"]);
    const headers = fetch.mock.calls[0]![1].headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");
  });

  it("carries a Noul answer on as a yes/no distribution", async () => {
    const fit: NoulQuestion = { type: "noul", instructions: "Does it fit?", criteria: { true: "yes", false: "no" } };
    const body = { answers: { fit: { type: "noul", noul: 0.8 } }, usage: { input_tokens: 5 } };
    const ev = createEvaluator({ url: "/x", fetch: vi.fn().mockResolvedValue(reply(body)) as never });
    const out = await ev(request({ questions: { fit } }));
    expect(out.answers.fit).toEqual({ choice: "yes", probabilities: { yes: 0.8, no: expect.closeTo(0.2, 9) }, confidence: null });
  });

  it("rejects an answer of the wrong kind", async () => {
    const fit: NoulQuestion = { type: "noul", instructions: "Does it fit?", criteria: { true: "yes", false: "no" } };
    const ev = createEvaluator({ url: "/x", fetch: vi.fn().mockResolvedValue(reply(good)) as never });
    await expectPath(ev(request({ questions: { pick: fit } })), "invalid");
  });

  it("rejects an answer outside the offered criteria", async () => {
    const bad = { ...good, answers: { pick: { ...good.answers.pick, choice: "zz" } } };
    const ev = createEvaluator({ url: "/x", fetch: vi.fn().mockResolvedValue(reply(bad)) as never });
    await expectPath(ev(request()), "invalid");
  });

  it("rejects probabilities whose keys are not exactly the offered ones", async () => {
    const bad = { ...good, answers: { pick: { ...good.answers.pick, probabilities: { a: 0.5, b: 0.5 } } } };
    const ev = createEvaluator({ url: "/x", fetch: vi.fn().mockResolvedValue(reply(bad)) as never });
    await expectPath(ev(request()), "invalid");
  });

  it("rejects probabilities that do not sum to one", async () => {
    const bad = { ...good, answers: { pick: { ...good.answers.pick, probabilities: { a: 0.1, b: 0.1, [FALLBACK]: 0.1 } } } };
    const ev = createEvaluator({ url: "/x", fetch: vi.fn().mockResolvedValue(reply(bad)) as never });
    await expectPath(ev(request()), "invalid");
  });

  it("rejects a missing answer", async () => {
    const ev = createEvaluator({ url: "/x", fetch: vi.fn().mockResolvedValue(reply({ answers: {} })) as never });
    await expectPath(ev(request()), "invalid");
  });

  it("passes a declined answer through: declining is per question, decided by the source", async () => {
    const declined = { answers: { pick: { type: "choice", choice: FALLBACK, probabilities: { a: 0.3, b: 0.3, [FALLBACK]: 0.4 }, confidence: 0.2 } } };
    const ev = createEvaluator({ url: "/x", fetch: vi.fn().mockResolvedValue(reply(declined)) as never });
    await expect(ev(request())).resolves.toMatchObject({ answers: { pick: { choice: FALLBACK } } });
  });

  it("retries on 429 and succeeds, recording how many attempts it took", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply({}, 429))
      .mockResolvedValueOnce(reply({}, 529))
      .mockResolvedValueOnce(reply(good));
    const ev = createEvaluator({ url: "/x", fetch: fetch as never, sleep: async () => {} });
    await expect(ev(request())).resolves.toMatchObject({ retries: 2 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  /** Doubling, so a second attempt is not fired at the instant the first failed. */
  it("waits longer before each retry", async () => {
    const waits: number[] = [];
    const fetch = vi.fn().mockResolvedValue(reply({}, 529));
    const ev = createEvaluator({
      url: "/x", fetch: fetch as never, sleep: async (ms) => { waits.push(ms); },
    });
    await expectPath(ev(request()), "retry_exhausted");
    expect(waits).toEqual([400, 800, 1600]);
  });

  it("gives up after the retry ladder, and says how many attempts it made", async () => {
    const fetch = vi.fn().mockResolvedValue(reply({}, 529));
    const ev = createEvaluator({ url: "/x", fetch: fetch as never, sleep: async () => {} });
    await expect(ev(request())).rejects.toMatchObject({ path: "retry_exhausted", retries: MAX_RETRIES });
    expect(fetch).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it("never retries 401 or 422", async () => {
    for (const status of [401, 422]) {
      const fetch = vi.fn().mockResolvedValue(reply({}, status));
      const ev = createEvaluator({ url: "/x", fetch: fetch as never, sleep: async () => {} });
      await expectPath(ev(request()), "http");
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("does not start a retry when too little of the room's deadline remains", async () => {
    let t = 0;
    const fetch = vi.fn().mockImplementation(async () => { t += 8500; return reply({}, 429); });
    const ev = createEvaluator({ url: "/x", fetch: fetch as never, now: () => t, sleep: async () => {} });
    await expectPath(ev(request()), "retry_exhausted");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports an abandoned request as late, not as a timeout", async () => {
    const ac = new AbortController();
    const fetch = vi.fn().mockImplementation(async () => { ac.abort(); throw new Error("aborted"); });
    const ev = createEvaluator({ url: "/x", fetch: fetch as never });
    await expectPath(ev(request({ signal: ac.signal })), "late");
  });

  it("refuses a body over the client size budget before sending", async () => {
    const fetch = vi.fn();
    const huge: ChoiceQuestion = {
      type: "choice",
      instructions: "x",
      criteria: Object.fromEntries(
        Array.from({ length: 600 }, (_, i) => [`k${i}`, "y".repeat(300)]).concat([[FALLBACK, "z"]]),
      ),
    };
    const ev = createEvaluator({ url: "/x", fetch: fetch as never });
    await expectPath(ev(request({ questions: { pick: huge } })), "invalid");
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(huge).length).toBeGreaterThan(MAX_BODY_BYTES);
  });

  it("reports malformed JSON as invalid", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const ev = createEvaluator({ url: "/x", fetch: fetch as never });
    await expectPath(ev(request()), "invalid");
  });
});
