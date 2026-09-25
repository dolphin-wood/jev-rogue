---
id: 009
title: Technical Architecture
status: proposed
date: 2026-09-21
summary: Everything runs in the browser except a stateless proxy, required both to hide the deployer's TypeSafe key and because the TypeSafe API rejects browser origins via CORS; it spends the key only on requests carrying one of the deployer's invite codes. The game names the code, verifies it against the proxy before keeping it, and offers a row and a dialog for entering one. The game is a static bundle (GitHub Pages); the proxy is a Cloudflare Worker. Core owns simulation at a fixed step; Phaser renders. Defines package layout, Director and plan schemas, transport, keyed RNG, content pipeline and tests.
depends_on: [002, 008]
---

# 009 Technical Architecture

## Does the game need a server?

The game logic does not. Rooms, encounters, spells, sampling, validation and traces all run in the browser. Two facts force one thin piece outside the browser:

1. The deployer's key must not ship in client code; anyone could extract it and spend the quota.
2. The TypeSafe API enforces a CORS origin allowlist. A preflight from `http://localhost:5173` on 2026-09-21 returned HTTP 400 `Disallowed CORS origin`, so browsers cannot call `api.typesafe.ai` directly regardless of the key.

The piece is therefore a **stateless proxy**: it adds the `Authorization` header and the model to an invited request, and forwards the body. It holds no game state and could be replaced by any HTTP forwarder.

## Whose key

The key is the deployer's, a Worker secret, and it answers only requests carrying one of the deployer's **invite codes** (`x-jr-invite`, checked against the secret `INVITE_CODES` without early exit). A request without a valid code is refused with 401 `invite_required` before its body is read, and the evaluator's failure path hands the room to the rule arm. The deployed Worker is always gated: with `INVITE_CODES` unset it admits nobody. So a public build costs its host nothing for strangers, and the host shares Jev with a friend by sending them a code; revoking is removing the code.

### The invite is named, and checked before it is kept

A code is a credential the player holds, so the game says so. **Invitation code** is a row in the title menu and in Settings, under the *Jev* heading, showing the last four of a held code and opening a dialog to enter, change or clear one. A code also still arrives as `?invite=<code>` in a link, which is the easy way to hand one out.

Both routes go through the same check. The proxy answers a second path, `POST /invite/verify`, with `{ code }` and returns `{ valid, needed }` and nothing else: it never calls Jev, never reads the key, holds the same `MAX_INVITE_LENGTH` cap and the same constant-time comparison as the header check, keeps CORS to `ALLOWED_ORIGIN`, and is rate limited per IP — through the Workers Rate Limiting binding `INVITE_RATE_LIMIT` when the deployment has one, and otherwise through an in-isolate counter, because the binding is not on every plan and a deployment without it must still be able to tell a friend whether their code works. `needed: false` means this deployment has no gate at all (the dev server on the developer's own key), and the row then reads *Not needed when running locally* rather than sending the player after a code nothing will ask for.

A code that verifies is stored (`localStorage`, `jr.invite`), **turns the Jev Director on**, and is reported — *Invitation code accepted*. A code that does not is reported as *not recognised* and is not stored. A code from a link is taken out of the address bar with `replaceState` either way, so it is not in the next screenshot. Clearing the code turns the arm off again, unless the arm was never the code's to give. Nothing logs the code, in the Worker or in the client.

The dialog's text field is a real `<input>` laid over the canvas, invisible and focused for as long as the dialog is up, with the scene's keyboard plugin *and* the game-level keyboard manager switched off — the manager is what calls `preventDefault` on the captured keys, which is most of a code's alphabet, and leaving it on is why an earlier key field dropped characters and let the menu behind it move. Enter runs the selected action, Tab walks them, Escape closes; everything else is the browser's, which is what makes paste, selection and an IME work.

Players never enter a *key* into anyone's page — only a code, which spends nothing but the host's own allowance and can be revoked.

The *Jev Director* row (`jr.director`; `?director=` overrides it) can be on only while a code is held, in development, or against a proxy that reports no gate.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Simulation | pure TypeScript in `packages/core`, fixed 60 Hz step | shared by the game and the headless harness |
| Rendering and input | Phaser 3 | mature WebGL batching for thousands of circles; owns no game state |
| Build | Vite, pnpm workspaces | fast, dev proxy built in |
| Validation | zod | content schemas, API responses |
| Tests | vitest | everything in core and director runs headless |
| Hosting | any static host for the game (GitHub Pages, Vercel via `vercel.json`), Cloudflare Worker for the proxy | free, static, shareable URL; the Worker keeps its global rate limit |

## Repository layout

```
/
  docs/planning/              this series
  assets/                     palette, sprite atlas, sound sources
  packages/
    core/                     simulation (sim/), room generation (rooms/), encounters/,
                              spells/, run state and offers (run/), rendering data (render/),
                              content vocabulary (content/), RNG, shared types
    director/                 Director, the three arms, evaluator, question builders,
                              descriptions, weight table, plan shapes, traces
    game/                     Phaser client: scenes, debug panel, Director readout, audio, atlas
    harness/                  headless balance, play and asset CLIs over core
  server/worker.ts            Cloudflare Worker proxy
  .env.local                  TYPESAFE_API_KEY (git-ignored; used by the Vite dev proxy)
```

Content is TypeScript modules inside `core`, not a JSON tree: items, stat upgrades, affixes, enemies, space archetypes and zone features are each a typed table, so a bad id is a type error rather than a load-time failure. `core`, `director` and `harness` never import Phaser or DOM APIs.

## Simulation loop

`core` exposes `step(world, input, dtMs, items)` with `dtMs` fixed at `STEP_MS` (1000 / 60). The game accumulates real time and calls `step` zero or more times per frame; Phaser interpolates nothing and draws the latest world. Enemy AI, patterns, bullets, collisions, statuses, waves, casting, melee swings and hazards all live inside `step`. The harness calls the same `step` with a scripted player, which is what makes a balance number and a played number the same number.

## Director and plan schemas

```ts
interface RunContext {
  run_id: string; seed: string; room_index: number;
  labels: SummaryLabels;                     // all fields from 010, current
  staff: Staff;                              // the fixed run record (013)
  slots: (ItemInstance | null)[];            // the three spell keys
  inventory: ItemInstance[];
  history: {
    rooms: RoomType[]; tensions: Tension[]; profiles: EncounterProfile[];
    spaces: SpaceArchetypeId[];
    skeletons: string[];                     // outlines of the rooms so far, most recent first (004)
    counter_scores: CounterScore[];          // charter showcase floor (001)
    shop_entered: boolean; elite_last_room: boolean; shielded_rooms: number;
  };
  intent: { preset: Archetype; free_text?: string };
}
interface DoorRef { room_index: number; door_slot: 0 | 1 | 2; room_type: RoomType; }

interface DoorPlan {                          // 003, asked as the player leaves
  room_index: number; tension: Tension;
  source: { tension: DecisionSource };
  decisions: Decision[];
}
interface PortalPlan {                        // 003, the offer out of a room
  room_index: number;
  doors: DoorOffer[];                         // reward kind, difficulty, school | family, grade, npc
  source: DecisionSource; decisions: Decision[];
}
interface CardRequest {                       // 007
  room_index: number; pool: CardPool; count: number;
  pity: boolean; temptation: boolean; salt?: string;
}
interface CardPlan {
  room_index: number; ids: string[]; origins: CardOrigin[];
  blended: Distribution; variety: "low" | "medium" | "high";
  source: DecisionSource; decisions: Decision[];
}
interface RoomPlanResult {                    // 004 + 005, two rounds
  door: DoorRef; plan: RoomPlan;              // core's own RoomPlan: nothing re-describes the grid
  source: {
    params: DecisionSource; mood: DecisionSource; zones: DecisionSource;
    encounter: DecisionSource; affixes: DecisionSource | null;
    layout: "generated" | "authored";
  };
  profile: EncounterProfile | null;
  elite_affixes: EliteAffix[];
  trimmed: boolean;                           // the commit check had to cut the plan (003)
  decisions: Decision[];
}
```

Two rules hold for every plan: each sub-decision carries its own `source`, so a run is reportable as the mix it actually was even when one question fell back and the rest did not; and the `Decision` records travel with the plan, because the trace (011) needs the distribution that was sampled from, not just the answer.

One Director composes: summarizer → option filter → question builder → distribution source → validation → sampler → commit check → plan. Only the distribution source differs between the `jev`, `rule` and `random` arms, so a blind test compares that component and nothing else. Any thrown error inside the chain is caught at the plan boundary and answered from the rule table for that request; `random` answers only when it is the selected arm.

## Evaluator transport

```ts
interface Evaluator { (req: { state; questions; signal; meta: RequestMeta }): Promise<{ answers; usage }>; }
```

The browser implementation posts `{ state, questions }` to the proxy URL it was constructed with (`/api/decide` in development, `VITE_DECIDE_URL` in a hosted build), with `meta` as `x-jr-*` headers for logging. The game runs the rule arm unless the URL asks for another: `?director=jev` or `?director=random`. The proxy forwards to TypeSafe with `model: "jev-latest"` added and returns the body unchanged. Timeouts, retries and validation live in the browser evaluator (002), so the proxy stays trivial.

The proxy enforces: body ≤ 64 KB, ≤ 60 requests per minute per IP, only the `/v1/systemone` upstream, and `Access-Control-Allow-Origin` restricted to the configured game origin. The 64 KB ceiling is headroom; the client's own budget is 48 KB and the largest designed request, a card offer, is about 11 KB (007).

## Randomness

`RngSource(seed).stream(...key)` returns a deterministic generator seeded from `hash(seed, key)`. Streams are named in 002. The simulation advances its own stream inside `step`; decisions use their own keys, so network timing never affects gameplay randomness.

Traces go to a `TraceSink`; a console sink and an in-memory sink exist, and the in-memory one is what the harness and the tests read (011).

## Content pipeline

- Typed tables in `packages/core/src`, one module per library.
- `pnpm content:check`: the doc 010 description and vocabulary rules across every library, global id uniqueness, then the build-time resolutions that must succeed before the game ships. A failure there is a build failure, not a player's run failing.
- `pnpm verify` runs typecheck, tests, the asset checks, the content check, the spell check and the balance harness. It never calls Jev.
- `pnpm jev-run <seeds> <budget>` plays reference runs on the Jev arm and `pnpm jev-probe` plans one late room for a strong and a struggling player on both arms. Both run the Worker's handler in-process with the key from `.env.local`, hold a hard call budget (past it the rule table answers), and log every request and answer as JSON lines, never the key. A run is about 44 requests.
- Content is bundled at build time.

## Environment

| Variable | Where | Meaning |
|---|---|---|
| TYPESAFE_API_KEY | Worker secret / `.env.local` for the dev proxy and harness | the deployer's TypeSafe key; never in a client bundle |
| INVITE_CODES | Worker secret | comma-separated codes that may spend the key; unset admits nobody |
| INVITE_RATE_LIMIT | Worker binding, optional | per-IP limit on `/invite/verify` (`[[ratelimits]]`); absent, an in-isolate counter stands in |
| ALLOWED_ORIGIN | proxy | the game's origin for CORS, e.g. `https://<user>.github.io` or `https://<project>.vercel.app` |
| VITE_BASE | client build | base path for the static bundle |
| VITE_DECIDE_URL | client build | the hosted proxy's URL for the Jev arm; `/api/decide` when unset |

## Tests

- core: the room generator produces a valid, in-band room for every archetype × symmetry × seed with the relax rate under 10% (004); pressure bands, encounter assembly, elite and `shielded` affix rules, counter scoring and the showcase floor (001, 005); the spell parser, affix resolution and the deterministic damage math (006); label bucketing and the "no raw numbers in state" assertion (002, 010); room, mood and palette rendering data (008).
- director: evaluator with mocked fetch (success, out-of-criteria, malformed probabilities, timeout, 429 retry, abandoned request); option-set and description rules; offer blending, pity and temptation precedence; acceptance metrics (011).
- harness: pressure calibration over sampled profiles × rooms meets the correlation and band limits of 005; the six tiered presets pass individually; the Worker proxy's CORS, rate limit, body ceiling and key injection; the verify endpoint's valid, invalid, oversize, no-gate, rate-limited and preflight answers, and that it never reaches upstream.
- game: the sprite atlas and the enemy frame set cover every enemy and animation the scenes ask for.
