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
      body: JSON.stringify({ state: { x: "y".repeat(70_000) }, questions: {} }),
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

  it("passes the upstream status through without interpreting it", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 529 }));
    expect((await handle(post(), env, f as never)).status).toBe(529);
  });
});
