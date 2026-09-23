---
id: 009
title: Technical Architecture
status: proposed
date: 2026-09-21
summary: Everything runs in the browser except a stateless key-holding proxy, required both to hide TYPESAFE_API_KEY and because the TypeSafe API rejects browser origins via CORS. The game is a static bundle (GitHub Pages); the proxy is a Cloudflare Worker. Core owns simulation at a fixed step; Phaser renders. Defines package layout, Director and plan schemas, transport, keyed RNG, content pipeline and tests.
depends_on: [002, 008]
---

# 009 Technical Architecture

## Does the game need a server?

The game logic does not. Rooms, encounters, spells, sampling, validation and traces all run in the browser. Two facts force one thin piece outside the browser:

1. `TYPESAFE_API_KEY` must not ship in client code; anyone could extract it and spend the quota.
2. The TypeSafe API enforces a CORS origin allowlist. A preflight from `http://localhost:5173` on 2026-09-21 returned HTTP 400 `Disallowed CORS origin`, so browsers cannot call `api.typesafe.ai` directly regardless of the key.

The piece is therefore a **stateless proxy**: it adds the `Authorization` header and the model, and forwards the body. It holds no game state and could be replaced by any HTTP forwarder.

The proxy does not tie the game to any hosting platform. The game is a static bundle and can live on GitHub Pages; the proxy lives wherever one HTTP function can run and answers CORS for the game's origin.

| Environment | Game | Proxy |
|---|---|---|
| local development | Vite dev server | A dev-server middleware at `/api/decide` that runs the Worker's own handler (`server/worker.ts`), with the key loaded from the repository root's `.env.local`. Development forwards exactly as hosting does. No separate process. |
| hosted | GitHub Pages (static bundle from CI) | Cloudflare Worker (`server/worker.ts`): forwards, adds the key from a Worker secret, sets `Access-Control-Allow-Origin` to the Pages origin, rate-limits per IP. Free tier covers this game's volume. |

Director arms `rule` and `random` never touch the proxy, so a build that runs either one needs no proxy at all.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Simulation | pure TypeScript in `packages/core`, fixed 60 Hz step | shared by the game and the headless harness |
| Rendering and input | Phaser 3 | mature WebGL batching for thousands of circles; owns no game state |
| Build | Vite, pnpm workspaces | fast, dev proxy built in |
| Validation | zod | content schemas, API responses |
| Tests | vitest | everything in core and director runs headless |
| Hosting | GitHub Pages for the game, Cloudflare Worker for the proxy | free, static, shareable URL |

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
| TYPESAFE_API_KEY | Worker secret / Vite dev proxy only | TypeSafe key; never in a client bundle |
| ALLOWED_ORIGIN | proxy | the game's origin for CORS, e.g. `https://<user>.github.io` |
| VITE_BASE | client build | base path for the static bundle |
| VITE_DECIDE_URL | client build | the hosted proxy's URL for the Jev arm; `/api/decide` when unset |

## Tests

- core: the room generator produces a valid, in-band room for every archetype × symmetry × seed with the relax rate under 10% (004); pressure bands, encounter assembly, elite and `shielded` affix rules, counter scoring and the showcase floor (001, 005); the spell parser, affix resolution and the deterministic damage math (006); label bucketing and the "no raw numbers in state" assertion (002, 010); room, mood and palette rendering data (008).
- director: evaluator with mocked fetch (success, out-of-criteria, malformed probabilities, timeout, 429 retry, abandoned request); option-set and description rules; offer blending, pity and temptation precedence; acceptance metrics (011).
- harness: pressure calibration over sampled profiles × rooms meets the correlation and band limits of 005; the six tiered presets pass individually; the Worker proxy's CORS, rate limit, body ceiling and key injection.
- game: the sprite atlas and the enemy frame set cover every enemy and animation the scenes ask for.
