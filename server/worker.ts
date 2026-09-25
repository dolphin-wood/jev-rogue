/**
 * Stateless proxy (design doc 009). TypeSafe rejects browser origins by CORS,
 * so the game cannot call it directly, and the key must not ship in client
 * code. Whoever deploys the game deploys this beside it with their own key as
 * a secret, and the key answers **only requests carrying one of their invite
 * codes** (`x-jr-invite`, checked against `INVITE_CODES`): a public build
 * shared by link spends nothing for strangers, and a friend given a code plays
 * on the host's key. Without a valid code the request is refused and the game
 * plays the rule Director. The dev server and the harness, on the developer's
 * own machine, set no `INVITE_CODES` and so need none. It holds no game state.
 * Timeouts, retries and response validation live in the browser evaluator.
 *
 * It answers on two paths:
 *
 * - `POST /…/decide` (anything that is not the one below): the proxy proper.
 * - `POST /…/invite/verify`: **does this code work?** — so the game can tell a
 *   player their code was accepted instead of leaving them to discover it by
 *   playing a run that quietly fell back. It never calls Jev and never reads
 *   the key, so the worst an attacker gets from it is what they would get from
 *   trying codes against `decide` itself, more slowly.
 */
const UPSTREAM = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
/** Matched to the browser evaluator's ceiling, with room for the headers. */
const MAX_BODY_BYTES = 192 * 1024;
const RATE_LIMIT_PER_MINUTE = 60;
const MAX_INVITE_LENGTH = 128;
/**
 * The verify endpoint's own ceiling, used when the Rate Limiting binding is
 * not configured. Far below the proxy's, because this is the one endpoint
 * whose whole purpose is to say whether a guess was right.
 */
const VERIFY_LIMIT_PER_MINUTE = 10;
/** A body bigger than this is not a code; it is refused without being parsed. */
const MAX_VERIFY_BODY_BYTES = 2048;

/** The path the verify endpoint answers on, however the Worker is mounted. */
const VERIFY_PATH = "/invite/verify";

/**
 * The shape of a Workers Rate Limiting binding, declared here so the Worker
 * does not take a dependency on `@cloudflare/workers-types` for one method.
 */
export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  TYPESAFE_API_KEY: string;
  ALLOWED_ORIGIN: string;
  /**
   * Comma-separated invite codes that may spend the key. Undefined means no
   * gate (the dev server, the harness); the deployed Worker always has one,
   * and an empty list admits nobody.
   */
  INVITE_CODES?: string;
  /**
   * Optional per-IP limiter for the verify endpoint (`[[ratelimits]]` in
   * `wrangler.toml`). Optional on purpose: the binding is not available on
   * every plan, and a deployment that cannot have it must still be able to
   * tell a friend whether their code works. Without it the in-process
   * counter below applies, which is per isolate rather than global.
   */
  INVITE_RATE_LIMIT?: RateLimiterBinding;
}

const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number, perMinute = RATE_LIMIT_PER_MINUTE, bucket = ""): boolean {
  const window = now - 60_000;
  const at = `${bucket}${ip}`;
  const recent = (hits.get(at) ?? []).filter((t) => t > window);
  recent.push(now);
  hits.set(at, recent);
  if (hits.size > 10_000) hits.clear();
  return recent.length > perMinute;
}

function cors(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-jr-invite, x-jr-run, x-jr-purpose, x-jr-round",
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

  if (isVerifyPath(request)) return verifyInvite(request, env);

  // Before anything else, so a stranger learns nothing about the key or the body rules.
  if (!invited(request, env)) return json({ error: "invite_required" }, 401, env);
  if (!env.TYPESAFE_API_KEY) return json({ error: "no_key" }, 503, env);

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

  // The model and the key are added here and never travel to the browser.
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

/** Whether this request is for the verify endpoint rather than the proxy. */
function isVerifyPath(request: Request): boolean {
  let path: string;
  try { path = new URL(request.url).pathname; } catch { return false; }
  return path === VERIFY_PATH || path.endsWith(VERIFY_PATH);
}

/**
 * **Does this code work?** — and nothing else.
 *
 * It answers `{ valid, needed }`: `needed: false` means this deployment has
 * no gate at all (a developer running the dev server on their own key), which
 * is the difference between "your code is wrong" and "you do not need one".
 * No other field, so a wrong guess learns nothing except that it was wrong.
 */
async function verifyInvite(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin && origin !== env.ALLOWED_ORIGIN) return json({ error: "origin_not_allowed" }, 403, env);

  const ip = request.headers.get("CF-Connecting-IP") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  if (!(await verifyAllowed(env, ip))) return json({ error: "rate_limited" }, 429, env);

  const raw = await request.text();
  if (raw.length > MAX_VERIFY_BODY_BYTES) return json({ valid: false, needed: true }, 413, env);

  let code = "";
  try {
    const body = JSON.parse(raw) as { code?: unknown };
    if (typeof body?.code === "string") code = body.code.trim();
  } catch {
    return json({ error: "invalid_json" }, 400, env);
  }

  // Asked before the code is looked at, so an ungated deployment answers the
  // same whatever was typed — there is nothing here to be right about.
  const codes = env.INVITE_CODES;
  if (codes === undefined) return json({ valid: true, needed: false }, 200, env);
  return json({ valid: matchesCode(code, codes), needed: true }, 200, env);
}

/**
 * The verify endpoint's rate limit: the Workers binding when the deployment
 * has one, the in-process counter when it does not. A binding that throws —
 * a plan that refuses it at runtime rather than at deploy time — is treated
 * as absent rather than as a refusal, so the endpoint keeps working.
 */
async function verifyAllowed(env: Env, ip: string): Promise<boolean> {
  if (env.INVITE_RATE_LIMIT) {
    try {
      return (await env.INVITE_RATE_LIMIT.limit({ key: ip })).success;
    } catch { /* fall through to the in-process counter */ }
  }
  return !rateLimited(ip, Date.now(), VERIFY_LIMIT_PER_MINUTE, "verify:");
}

/** True when the deployment has no gate, or the request's `x-jr-invite` is one of its codes. */
function invited(request: Request, env: Env): boolean {
  if (env.INVITE_CODES === undefined) return true;
  return matchesCode(request.headers.get("x-jr-invite")?.trim() ?? "", env.INVITE_CODES);
}

/**
 * Whether `given` is one of `codes`, without stopping at the first match:
 * every code is compared, so how long the answer takes does not say which
 * one — or how many — the deployment holds.
 */
function matchesCode(given: string, codes: string): boolean {
  if (!given || given.length > MAX_INVITE_LENGTH) return false;
  let ok = false;
  for (const code of codes.split(",")) {
    const c = code.trim();
    if (c && sameString(c, given)) ok = true;
  }
  return ok;
}

/** Compares without stopping at the first difference, so timing does not spell out a code. */
function sameString(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** The deployed Worker: always gated, so an unset `INVITE_CODES` admits nobody. */
export default {
  fetch: (request: Request, env: Env) => handle(request, { ...env, INVITE_CODES: env.INVITE_CODES ?? "" }),
};
