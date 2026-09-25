import { describe, it, expect, vi } from "vitest";
import { handle } from "../../../../server/worker.ts";
import type { Env } from "../../../../server/worker.ts";

const env: Env = { TYPESAFE_API_KEY: "secret-key", ALLOWED_ORIGIN: "https://example.github.io" };
const body = JSON.stringify({ state: { health: "low" }, questions: { pick: { type: "choice" } } });

const post = (over: RequestInit & { origin?: string } = {}) =>
  new Request("https://proxy.test/api/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(over.origin ? { Origin: over.origin } : {}),
      "CF-Connecting-IP": Math.random().toString() },
    body,
    ...over,
  });

const upstreamOk = () => vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: {} }), { status: 200 }));

describe("proxy", () => {
  it("forwards state and questions, adding the model and the key", async () => {
    const fetchImpl = upstreamOk();
    await handle(post({ origin: env.ALLOWED_ORIGIN }), env, fetchImpl as never);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect(JSON.parse(init.body as string).model).toBe("jev-latest");
    expect(JSON.parse(init.body as string).state).toEqual({ health: "low" });
  });

  it("answers preflight with the configured origin", async () => {
    const res = await handle(new Request("https://p/", { method: "OPTIONS" }), env, upstreamOk() as never);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(env.ALLOWED_ORIGIN);
  });

  it("refuses an origin that is not the game", async () => {
    const res = await handle(post({ origin: "https://evil.test" }), env, upstreamOk() as never);
    expect(res.status).toBe(403);
  });

  it("refuses a body over the limit", async () => {
    const big = new Request("https://p/", {
      method: "POST", headers: { "CF-Connecting-IP": "x" },
      body: JSON.stringify({ state: { x: "y".repeat(300_000) }, questions: {} }),
    });
    expect((await handle(big, env, upstreamOk() as never)).status).toBe(413);
  });

  it("refuses malformed or incomplete bodies", async () => {
    const bad = (b: string) => new Request("https://p/", { method: "POST", headers: { "CF-Connecting-IP": "y" }, body: b });
    expect((await handle(bad("nope"), env, upstreamOk() as never)).status).toBe(400);
    expect((await handle(bad(JSON.stringify({ questions: {} })), env, upstreamOk() as never)).status).toBe(400);
    expect((await handle(bad(JSON.stringify({ state: {} })), env, upstreamOk() as never)).status).toBe(400);
  });

  it("rate limits a single client", async () => {
    const fixedIp = new Request("https://p/", {
      method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" }, body,
    });
    let last = 200;
    for (let i = 0; i < 70; i++)
      last = (await handle(fixedIp.clone(), env, upstreamOk() as never)).status;
    expect(last).toBe(429);
  });

  it("with invite codes set, spends the key only on a request carrying one", async () => {
    const gated: Env = { ...env, INVITE_CODES: "alpha, beta" };
    const fetchImpl = upstreamOk();
    expect((await handle(post(), gated, fetchImpl as never)).status).toBe(401);
    const wrong = post();
    wrong.headers.set("x-jr-invite", "gamma");
    expect((await handle(wrong, gated, fetchImpl as never)).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    const right = post();
    right.headers.set("x-jr-invite", "beta");
    expect((await handle(right, gated, fetchImpl as never)).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("the deployed Worker admits nobody when no invite codes are set", async () => {
    const { default: worker } = await import("../../../../server/worker.ts");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const req = post();
    req.headers.set("x-jr-invite", "anything");
    expect((await worker.fetch(req, env)).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("allows the invite header in preflight", async () => {
    const res = await handle(new Request("https://p/", { method: "OPTIONS" }), env, upstreamOk() as never);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("x-jr-invite");
  });

  it("passes the upstream status through without interpreting it", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 529 }));
    expect((await handle(post(), env, f as never)).status).toBe(529);
  });
});

/*
 * The verify endpoint (doc 009). Every code here is obviously fake; no real
 * invite code belongs in a tracked file.
 */
describe("invite verify", () => {
  const gated: Env = { ...env, INVITE_CODES: "test-code-alpha, test-code-beta" };
  let ip = 0;
  const verify = (code: unknown, over: { origin?: string; raw?: string } = {}) =>
    new Request("https://proxy.test/api/invite/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(over.origin ? { Origin: over.origin } : {}),
        // A fresh IP per request, so one test's calls never spend another's budget.
        "CF-Connecting-IP": `10.0.0.${ip++}`,
      },
      body: over.raw ?? JSON.stringify({ code }),
    });

  it("accepts a code the deployment holds, without calling Jev or reading the key", async () => {
    const fetchImpl = upstreamOk();
    const res = await handle(verify("test-code-beta", { origin: env.ALLOWED_ORIGIN }), gated, fetchImpl as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true, needed: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("works with no key configured at all", async () => {
    const keyless: Env = { TYPESAFE_API_KEY: "", ALLOWED_ORIGIN: env.ALLOWED_ORIGIN, INVITE_CODES: "test-code-alpha" };
    const res = await handle(verify("test-code-alpha"), keyless, upstreamOk() as never);
    expect(await res.json()).toEqual({ valid: true, needed: true });
  });

  it("rejects a code it does not hold, and says nothing else", async () => {
    const res = await handle(verify("test-code-wrong"), gated, upstreamOk() as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false, needed: true });
  });

  it("rejects an empty code", async () => {
    expect(await (await handle(verify("   "), gated, upstreamOk() as never)).json())
      .toEqual({ valid: false, needed: true });
  });

  it("refuses an oversize body without parsing it", async () => {
    const res = await handle(verify(null, { raw: JSON.stringify({ code: "x".repeat(4000) }) }), gated, upstreamOk() as never);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ valid: false, needed: true });
  });

  it("rejects a code over the length cap", async () => {
    expect(await (await handle(verify("x".repeat(200)), gated, upstreamOk() as never)).json())
      .toEqual({ valid: false, needed: true });
  });

  it("reports that no code is needed when the deployment has no gate", async () => {
    const res = await handle(verify(""), env, upstreamOk() as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true, needed: false });
  });

  it("refuses an origin that is not the game", async () => {
    const res = await handle(verify("test-code-beta", { origin: "https://evil.test" }), gated, upstreamOk() as never);
    expect(res.status).toBe(403);
  });

  it("answers the preflight with the configured origin", async () => {
    const res = await handle(
      new Request("https://proxy.test/api/invite/verify", { method: "OPTIONS" }), gated, upstreamOk() as never);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(env.ALLOWED_ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("rate limits through the Workers binding when one is bound", async () => {
    let calls = 0;
    const withLimiter: Env = {
      ...gated,
      INVITE_RATE_LIMIT: { limit: async () => ({ success: ++calls <= 2 }) },
    };
    const same = () => new Request("https://proxy.test/api/invite/verify", {
      method: "POST", headers: { "CF-Connecting-IP": "9.9.9.9" }, body: JSON.stringify({ code: "test-code-wrong" }),
    });
    expect((await handle(same(), withLimiter, upstreamOk() as never)).status).toBe(200);
    expect((await handle(same(), withLimiter, upstreamOk() as never)).status).toBe(200);
    expect((await handle(same(), withLimiter, upstreamOk() as never)).status).toBe(429);
  });

  it("still answers when the binding is absent, on its own smaller budget", async () => {
    const same = () => new Request("https://proxy.test/api/invite/verify", {
      method: "POST", headers: { "CF-Connecting-IP": "8.8.8.8" }, body: JSON.stringify({ code: "test-code-wrong" }),
    });
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await handle(same(), gated, upstreamOk() as never)).status;
    expect(last).toBe(429);
  });

  it("treats a binding that throws as absent rather than as a refusal", async () => {
    const broken: Env = { ...gated, INVITE_RATE_LIMIT: { limit: () => { throw new Error("not on this plan"); } } };
    const res = await handle(verify("test-code-alpha"), broken, upstreamOk() as never);
    expect(await res.json()).toEqual({ valid: true, needed: true });
  });
});
