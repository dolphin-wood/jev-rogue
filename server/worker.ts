/**
 * Stateless proxy (design doc 009). It exists for two reasons only: the API key
 * must not ship in client code, and TypeSafe rejects browser origins by CORS.
 * It holds no game state. Timeouts, retries and response validation live in the
 * browser evaluator, so this stays trivial and is identical in behaviour to the
 * Vercel Function variant.
 */
const UPSTREAM = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_PER_MINUTE = 60;

export interface Env {
  TYPESAFE_API_KEY: string;
  ALLOWED_ORIGIN: string;
}

const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  const window = now - 60_000;
  const recent = (hits.get(ip) ?? []).filter((t) => t > window);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return recent.length > RATE_LIMIT_PER_MINUTE;
}

function cors(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-jr-run, x-jr-purpose, x-jr-round",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
    ...extra,
  };
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: cors(env, { "Content-Type": "application/json" }),
  });
}

export async function handle(request: Request, env: Env, fetchImpl = fetch): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, env);

  const origin = request.headers.get("Origin");
  if (origin && origin !== env.ALLOWED_ORIGIN) return json({ error: "origin_not_allowed" }, 403, env);

  const ip = request.headers.get("CF-Connecting-IP") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  if (rateLimited(ip, Date.now())) return json({ error: "rate_limited" }, 429, env);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "body_too_large" }, 413, env);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400, env);
  }
  if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400, env);
  const { state, questions } = body as { state?: unknown; questions?: unknown };
  if (!state || typeof state !== "object") return json({ error: "missing_state" }, 400, env);
  if (!questions || typeof questions !== "object") return json({ error: "missing_questions" }, 400, env);

  // The model and the key are added here and never travel from the browser.
  const upstream = await fetchImpl(UPSTREAM, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, state, questions }),
  });

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: cors(env, { "Content-Type": "application/json" }),
  });
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};
