---
id: 002
title: Jev Integration Principles
status: proposed
date: 2026-09-21
summary: Decisions are Jev's, generation is the algorithm's. Roguelike procedural generation is kept intact; the parameter-decision layer that weight tables and hand-written rules own is Jev's, between a constraint layer and a generate-and-verify layer, both in code. Conventions for state (semantic labels only), questions (independent, escape option, exclusivity by resource), sampling (from probabilities, hard exclusions never left to prompts), the TypeSafe evaluator, request identity and cancellation, failure accounting, per-decision RNG streams, and a request-level cost budget.
depends_on: [001]
---

# 002 Jev Integration Principles

## The dividing line

**Decisions are Jev's. Generation is the algorithm's.**

A roguelike already has two kinds of code: procedural generators (rooms, encounters, loot) and the decision layer that feeds them parameters, traditionally weight tables and hand-written rules encoding the designer's taste. This project keeps every generator and replaces the decision layer with Jev. Three layers, in order:

| Layer | Owner | Does |
|---|---|---|
| Constraint | code | enumerates the legal options for a decision, enforces hard rules, filters by state |
| Decision | Jev | picks semantic parameters among the legal options for this player right now |
| Generate and verify | code | turns parameters into content with the existing algorithm, measures the result against the requested parameters, retries, falls back |

Code still computes every number, validates every result and performs every random draw. Jev only answers "among these legal parameters, which fit this player now". This is the split json-render uses: the composer never shows Jev JSON, Jev ticks boxes in `select` and `layout`, code assembles and validates.

### Not every parameter is a Jev parameter

"Parameter" covers four different things, and only one of them is a preference:

| Kind | Examples | Owner |
|---|---|---|
| Safety and fairness | spawn distance from the entry, bullet caps, reachability, the Director charter (001) | code, hard |
| Budget and balance | threat budget per tension band, elite affix sets, gold rates, reward grades | code, calibrated by the harness |
| Experience preference | open space or cover, counter the build or let it shine, which reward a portal promises | Jev |
| Variety and chance | layout seed, exact obstacle positions, which card the distribution yields | RNG and sampling |

A hand-written weight table is therefore **not** automatically a Jev candidate: it may encode calibrated balance rather than taste. Convert a table to a Jev decision only when its inputs are player intent and situation and its output is a preference among options that are all already legal, fair and in budget.

Applied to: portals (003), rooms (004), encounters (005), cards (007), room mood (008).

Consequences:

- A hard rule is never expressed as an instruction to Jev. "Never two elite portals in one room" is a filter on the option list, not a sentence in `instructions`.
- A soft preference ("vary the space archetype") is a sentence in `instructions`, and code accepts that sampling may occasionally violate it.
- If a question's options were not filtered by code first, the question is wrong.

## Primitives used

Choice only. Score and Noul exist in the API but are not used, so the capability contract is one sentence: Jev returns a probability distribution over options code supplied.

Choosing a quantity from a short option list ("grade 1", "grade 2") is a Choice, not counting. Code never asks Jev how many of something exist.

## Decision interface

```ts
type DecisionSource = "jev" | "rule" | "random";

interface Decision<TOption extends string = string> {
  choice: TOption;                       // after sampling and validation
  probabilities: Record<TOption, number>;
  confidence: number | null;
  source: DecisionSource;
  fallback_path?: FallbackPath;          // set when the primary source failed
  question?: string;                     // which question this answers
}

interface Director {
  mode: DirectorArm;                                                            // jev | rule | random
  planDoors(ctx: RunContext): Promise<DoorPlan>;                                // next tension (003)
  planRoom(ctx: RunContext, door: DoorRef, tension: Tension,
           alongside?: OfferRequest): Promise<RoomPlanResult>;                  // two rounds, 004 + 005; the offer rides in round 1
  planOffer(ctx: RunContext, req: OfferRequest): Promise<OfferPlan>;            // portals + card offers in one request, for a room with no room plan
  planPortals(ctx: RunContext, choices: PortalChoices): Promise<PortalPlan>;    // per-portal kind, elite, school, family, grade, vendor (003), alone
  planCards(ctx: RunContext, req: CardRequest): Promise<CardPlan>;              // one kind's offer or shelf (007), alone
}
```

There is **one** implementation, parameterised by where distributions come from, so the three arms share every summarizer label, option filter, generator and sampler and differ in exactly one component. `jev` is the subject. `rule` is the **control**: a hand-written weight table in place of Jev's distribution. It is the baseline the project must beat, because the thesis is that Jev replaces a weight table, not that adaptation replaces randomness. `random` ignores state entirely, uses flat weights, and exists only as the experimental floor. Full schemas for `RunContext` and each plan are in 009.

## State conventions

- **Semantic labels only.** No raw numbers reach Jev. `packages/core/src/run/summarize.ts` is the only module that converts numbers to labels; every label it can emit is listed in 010 so descriptions can reference the same words.
- **Decision-local state.** Each decision sends only the fields it needs.
- **Guidance is a label from code**, for example `tension_cap: "peak_allowed"`, never a number like `pressureCap: 4`.
- **Player free text** goes verbatim into `intent.free_text`, capped at 120 characters, with instructions stating it is design intent, not a rule.
- A request's state stays under about 1500 tokens.

Standard labels (complete list in 010):

| Field | Levels |
|---|---|
| health | critical / low / ok / full |
| mana_sustain | starved / tight / comfortable |
| recent_damage | none / some / heavy |
| clear_speed | slow / normal / fast |
| run_progress | early / mid / late / pre_boss |
| tension_cap | release_only / build_allowed / peak_allowed |
| hazard_cap | none / low / high |

## Question conventions

- **Parallel where the state is shared.** Questions that read the same state and do not depend on one another's answers go in **one request**, however many plans they belong to: a room's round 1 carries its space, symmetry and mood, its portals and its cards. The request's state is the union of what each plan sends. When several instances of one plan share a request — a vendor's three shelves — each is scoped by a prefix on its question names and state keys (`shop_stat__overall`, `shop_stat__card_facts`).
- **Independent.** Where one decision depends on another's answer, use two requests in sequence and put the first answer into the second request's state: a room's second round sees the room that was generated from the first round's answers, not the one that was asked for. Never rely on Jev seeing another question's answer in the same request.
- **Coupled parameters are one question over feasible combinations.** Independent questions span a product space, and a product of individually legal answers can be jointly infeasible. Whenever the combination must satisfy a budget or a structural rule, code enumerates the feasible combinations and Jev picks one: the set of reward kinds across a room's portals (003), space archetypes (004). Independent questions are only for parameters whose combinations the generator can always satisfy, and their joint feasibility is then an acceptance metric (011), not an assumption.
- **Cross-question constraints are code, not prose.** A rule that relates two answers is enforced after the response, never written into `instructions`. Jev evaluates each question alone and cannot honour it.
- **Scarce slots ask per slot, not per item.** "Which feature fills zone A" with `none`, never "which zone does the poison pool go to". A slot receives at most one item, so there is no overcapacity and no collision.
- **Mutually exclusive variants share a `resource`** and code post-filters: if two slots picked items with the same resource, keep one and drop the other to `none`.
- **Every question carries an escape option** named `fallback`, described as "none of these fits; let the game decide". Choosing it hands that single decision to the rule table. `fallback` is distinct from gameplay options such as `none` ("no feature"), which are ordinary choices.
- **Descriptions carry the decision basis** in the label vocabulary of 010. Jev never sees the data behind an option.
- **Every option says when it fits, in labels the request's state carries.** Jev matches a state to a description: "Few bodies: a breather. Suits release rooms, and a player with heavy recent damage" can be matched; "sparse population" cannot, and an unmatched question spreads its mass onto `fallback`. An instruction that names a label (`clear_speed`, `recent_damage`) is a promise that the label is in the state. Measured on the live model: grounding the encounter, grade and elite questions this way raised their mean confidence from about 0.5 to about 0.9 and took `fallback` mass to near zero.
- **Frequency is code.** "Rarely", "about one room in eight" and "not twice running" are counts, which Jev does not keep; the cap lives in the option filter (`portalChoices`) and the question asks only whether the option fits now.
- **Instructions are literal**: what to weigh, what to ignore, and that player text is intent rather than permission.

## Sampling conventions

- Sample from `probabilities` with the temperature the decision specifies. Argmax is never used for gameplay decisions.
- Before sampling, code drops options that hard rules exclude (there should be none, since they were filtered before the request) and renormalizes.
- Multi-picks sample without replacement; wildcard slots are drawn uniformly by code and are never influenced by Jev.
- `confidence` is recorded and drives UI hint strength only. It is not a gate.

## Probability validation

A response is valid only if all of the following hold; otherwise the request is treated as failed:

- Every question has an answer whose `choice` is one of the offered criteria keys.
- `probabilities` keys are exactly the offered keys; values are finite, non-negative, and sum to 1 within the rounding of two-decimal answers (± 0.005 per option, at least ± 0.01). Code renormalizes that drift.
- The answer is not `fallback`, and `fallback` holds no more than half the mass; otherwise the decision falls back.

## Evaluator

Native `fetch`, no SDK, shaped after json-render's `experimental_createEvaluator`:

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer ${TYPESAFE_API_KEY}
Content-Type: application/json
{ "model": "jev-latest", "state": {...}, "questions": {...} }
```

Response: `answers[name] = { type: "choice", choice, probabilities, confidence }`, `usage.input_tokens`. Parsed with zod. Timeout 6 s per request via AbortController; one retry with 500 ms backoff on 429 or 529 if at least 3 s remain; never retry other statuses. The browser posts to the project's own proxy, which adds the key and the model (009).

## Request identity and cancellation

Every request carries `{ run_id, room_index, door_slot | null, round, purpose }`. A response is applied only if the plan it belongs to is still pending; responses for committed or abandoned plans are dropped and logged. Abandoning a plan (player chose another portal) aborts its in-flight requests.

## Failure accounting

### The fallback contract

One rule, and every document defers to it: **whenever a Jev decision does not arrive, does not validate, or declines, the rule table produces that decision.** The random arm is never a fallback; it runs only when the experiment explicitly selects it, because falling back to state-blind weights would make a degraded `jev` run behave worse than the control it is measured against.

The paths that hand a decision to the rule table:

| Path | Where |
|---|---|
| timeout, HTTP error, invalid response, probability validation failure | 002 |
| Jev answers `fallback`, or `fallback` mass above 0.5 | 002 |
| response arrives after its plan was committed or abandoned | 002 |
| generator or assembler exhausts its retry and relax budget | 004, 005 |
| commit check cannot trim a plan into compliance | 003 |
| a pipeline misses its deadline | 003 |

Failures are counted per request in completion order across concurrent requests. Three consecutive failures switch the run to rule mode: no further Jev requests this run. A success resets the counter. Every trace records which arm produced the decision in `source`, so a `jev` run is always reportable as the mix it actually was.

An `observe` hook sees every request as it was answered — the state sent, every question with its options, the distribution each came back with, and which arm answered — so the debug sidebar and the room plan page can show it (011). The Director does not depend on the hook, and a readout that throws never breaks a plan.

## Randomness

Every random draw comes from a keyed stream derived from the run seed: `rng("world")` for the simulation, `rng("decision", room_index, door_slot, round)` for a room plan, `rng("portals", room_index)`, `rng("reward", room_index, salt)` and `rng("wildcard", room_index, salt)` for an offer. Because streams are keyed, the order in which asynchronous responses arrive cannot change which numbers a decision consumes. Replay is defined in 011.

## Request schedule and cost

Per run:

| Purpose | Requests |
|---|---|
| next tension, as a room clears | up to 15 |
| room plan, two rounds, per portal offered (round 1 carries the portals and cards) | up to 84, about 69 at the portal-count weights |
| vendor room: portals and every shelf, one request | up to 3 |
| Total | about 86, at most 102 |

Speculative plans for the portals not taken are about 60% of the room plans; that is the price of planning after the reward is taken and still never making the player wait (003). At about 2.2k tokens per request on average (a round 1 carries the offer's options, a round 2 and a tension request less) a typical run is about 190k input tokens, USD 0.008 at USD 0.042 per 1M, and the worst case about 225k, USD 0.0095: under the 001 target, with little margin at the worst case.
