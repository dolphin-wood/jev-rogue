---
id: 001
title: Vision and Scope
status: proposed
date: 2026-09-21
summary: A top-down, single-screen room roguelike whose Director is Jev, TypeSafe AI's choice-only decision model. Code decides what is allowed and computes everything numeric or spatial; Jev decides what should happen among the allowed options. Lists every Jev decision point, the full scope of the finished game, and what is permanently out of scope.
depends_on: []
---

# 001 Vision and Scope

## Background

The jev experiment in vercel-labs/json-render showed that Jev never generates text or JSON and only picks among finite options, yet when code decomposes "build a tree" into independent choice questions and owns assembly and validation, the result is a UI with design intent in under a second. This project applies the same division of labor to a roguelike: **decisions are Jev's, generation is the algorithm's.** Every procedural generator a roguelike normally has is kept, and the *preference* part of the parameter-decision layer becomes Jev. Safety, fairness and balance parameters stay in code even though they are also parameters; 002 classifies which is which.

Facts that shape the design:

- Jev exposes Choice, Score and Noul. This project uses Choice only (002). A Choice takes up to 255 options; questions in one request are evaluated independently and batching barely changes latency.
- Jev does not count, compare numbers, do multi-hop or spatial reasoning, or generate text. Irrelevant content in `state` degrades accuracy.
- Direct API: `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`, Bearer auth, 32k context.

## Vision

A Director that reads the player without pampering them. From the build style stated at run start and from what the player actually does, it shapes the portals offered, the space of each room, the enemies inside, the pace of the run, and the rewards on offer. The player should feel the run was arranged for them while roguelike randomness and tension stay intact.

## Director charter

The Director is allowed to shape a run, not to decide whether the player is allowed to play their build. Without a charter, two reasonable rules combine into a bad one: rewards help the build while encounters counter it, so the more the player commits, the more precisely the game answers them. These limits are code, checked by the harness (011), never instructions to Jev.

- **Showcase floor.** Each combat room gets a counter score from the encounter's tag overlap with the build's weaknesses, bucketed as `favours`, `neutral` or `counters`. A **showcase room** is one scored `favours` or `neutral`. At least 40% of a run's combat rooms must be showcase rooms, and the rule is enforced **prospectively**: a `counters` option is offered only if choosing it would leave the ratio at or above 40% *including the room being planned*. At two showcase rooms out of five the run sits exactly at the floor, so a counter would give two out of six and is therefore not offered. A consequence worth stating so it is not later mistaken for a bug: with no history, countering the very first combat room would give zero showcase rooms out of one, so **the opening combat room of a run never counters the build**. Elite rooms count on neither side of the ratio, since their portal was opt-in. When `build.archetype` changes, earlier rooms are re-scored against the new archetype from their stored encounter profiles, so a player who pivots does not inherit the previous build's history.
- **No nullification.** No encounter, affix or boss phase may reduce the build's primary damage path below 50% effectiveness, and none may take it to zero. `shielded` (element immunity) appears on at most one enemy per encounter and in at most 30% of a run's rooms.
- **Hard counters are opt-in.** The strongest counters appear only behind `elite` portals, whose badge the player read before choosing.

A run that satisfies the charter and still loses is the intended outcome. A run where the player cannot express their build is a bug.

## Genre

Top-down, single-screen rooms. A sword at the centre with three keyed spells around it (013); ranged enemies fire simple patterns and the boss fires composed ones, so geometry and positioning always matter. Combat is circle collision plus data-driven bullet and melee shapes, which keeps rooms cheap enough that every Director decision has a place to act. Run structure follows Hades' portal-choice model, the spell layer follows Astral Ascent's three self-contained spells, the look follows Wizard of Legend with geometric art.

## Jev decision points

Every decision below is a Choice over options that code has already verified as legal. Code samples from Jev's probability distribution rather than taking the top answer (002).

| Decision | When | Document |
|---|---|---|
| Tension of the next room (build / peak / release) | as the player leaves a room | 003 |
| Which reward kind each portal promises | on room entry, with the offer | 003 |
| Whether one portal is elite, which kind sits behind it, and how far its reward is graded up | same request | 003 |
| Whether the normal portals are graded up late in the run | same request | 003 |
| A spell portal's school, a stat portal's family | same request | 003 |
| Whether one portal leads to the merchant or the blacksmith instead of a fight | same request | 003 |
| Room space archetype and symmetry | on room entry, before the room is generated | 004 |
| Room mood (temperature, brightness, particle intensity) | same request | 008 |
| Feature per zone the generated room left open | after the room is generated | 004 |
| Encounter profile (composition, density, wave structure, anchor, entry) | same request | 005 |
| Which card of the portal's kind most deserves the offer, asked three ways: overall, for style, for needs | at the offer | 007 |
| Variety level for reward sampling | same request | 007 |
| Which off-style card is the most tempting | every fourth offer | 007 |
| Which card fills each kind's slot on the merchant's shelf | in the merchant's room | 007 |

Everything else stays in code: portal legality and count, pacing rules, the elite affix set, the boss's phases, spell math, connectivity, sampling, wildcards, pity and every number (002, 005, 006).

## Scope of the finished game

- One biome. A run is fourteen fights, a merchant-and-blacksmith room and a boss room, about 20 minutes (014).
- Eight enemy archetypes with calibrated threat weights; elite rooms add an affix set drawn from the legal ones; one boss with three fixed phases.
- 30 castable spells across seven schools, 20 affixes in three tiers, 12 stat upgrades in four families (006, 013).
- Procedurally generated rooms and boss arena driven by Jev-chosen parameters, with three authored fallback rooms (004); room mood derived from Jev-chosen labels (008).
- Encounters assembled from the archetypes to a calibrated pressure budget, with six tiered fallback presets (005).
- Intent screen with five build styles and free text; pick-one-of-three cards per portal; merchant and blacksmith; gold economy.
- Director arms `jev`, `rule` and `random` behind one interface, for blind testing (011).
- Geometric art on an eight-slot palette, synthesized audio.

## Out of scope

Permanently outside this game:

- Camera follow, multi-screen rooms.
- Additional biomes, characters, meta progression, achievements, saves mid-run.
- Multiplayer, gamepad, mobile.
- Jev generating any text, number or terrain, or computing spell results.

## Success criteria

- In blind tests, at least 65% of testers (n ≥ 12) identify the `jev` run as the one that felt arranged for them and say they prefer it.
- Zero waiting at portals: Jev latency is hidden by prefetching in every room type, including the vendor and boss rooms.
- Any Jev failure falls back to the local policy without the player noticing.
- Jev cost per run under USD 0.01 at the request schedule in 002.

## References

- json-render: `packages/core/src/experimental-compose.ts`, `experimental-composition-batch.ts`, `experimental-evaluator.ts`, `apps/web/lib/jev/grammar.ts`
- Jev: https://docs.typesafe.ai/introduction , https://docs.typesafe.ai/model-jaggedness/jev-1.13 , https://docs.typesafe.ai/api
