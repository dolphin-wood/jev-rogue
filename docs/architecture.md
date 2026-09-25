# How Jev directs a run

**English** · [简体中文](architecture.zh-CN.md) · [日本語](architecture.ja.md)

This document describes the implemented decision path. For the design rationale, see [002: Jev integration principles](planning/002-jev-integration-principles.md); for the broader system, see [009: technical architecture](planning/009-technical-architecture.md). The measurements and failed approaches that shaped the current questions are in [Jev findings](research/jev-findings.md).

## The boundary

Jev is a **choice model**, not a level generator or a game loop. The game gives it a description of the current run and a set of named, legal options. Jev returns a probability distribution over those options. Code then draws from that distribution and builds the result.

```text
Run state and combat measurements
  → summarize the run and construct a briefing
  → enumerate and filter legal options in code
  → ask Jev one or more independent choice questions
  → validate and tune the returned distributions
  → sample with a seeded RNG
  → generate rooms, encounters, doors, or cards
  → verify the finished plan against game rules
```

This division preserves the roguelike's procedural generators. Jev chooses *what kind* of room, pressure, encounter, reward, or offer suits the run; it never places a tile, invents an enemy, writes a card, computes damage, or overrides a hard constraint. The same pipeline can use Jev, a rule table, or flat random weights as its distribution source ([`source.ts`](../packages/director/src/source.ts), [`director.ts`](../packages/director/src/director.ts)). That makes the rule arm both a control and the fallback when Jev cannot answer.

| Layer | Owner | Example |
|---|---|---|
| Facts and constraints | `packages/core` and `packages/director` | Current health, held spells, legal room shapes, encounter budget, pacing cap |
| Preference | Jev, rule table, or random source | Probability of `spell`, `affix`, `stat`, and `gold` doors |
| Realization | `packages/core` and `packages/director` | Seeded sampling, room layout, enemy assembly, card selection, final checks |
| Play and display | `packages/core` and `packages/game` | Fixed-step simulation, Phaser input and rendering |

## When decisions happen

The Director builds a plan at room boundaries, not on every simulation frame. For a combat room it uses two rounds: the first selects high-level room properties, including tension, space, size, symmetry, and mood. Independent portal and card questions can share this request because they read the same run. The second round receives the room that round one established and chooses encounter and zone details such as composition, density, waves, anchor, entry, variants, and elite presence. A fixed stop has no combat-room plan, so its offer is planned separately. The exact set of questions depends on which options remain legal ([`questions/room.ts`](../packages/director/src/questions/room.ts), [`director.ts`](../packages/director/src/director.ts)).

Questions are independent within a request. Code does not ask Jev to make one answer conditional on another answer in that same request. Where a later choice depends on an earlier one, it is built after the earlier round. For example, code asks which portal kinds to offer first; it asks about a spell door's school or a stat door's family only if such a door was actually selected.

## What Jev receives

The browser's default state format is a single `briefing` string: a structured, plain-language account of the game, player style, held build, recent measured combat, offer history, run history, current resources, and the decision at hand ([`briefing.ts`](../packages/director/src/briefing.ts)). Measurements are converted to facts, not verdicts: the briefing describes health lost and what the player holds, leaving the judgment to Jev. Its glossary and numeric claims come from game constants. An alternate `labels` format sends a compact table of semantic labels with option descriptions containing matching clauses. In the browser, `?state=labels` selects that comparison format; the rule table always reads the structured labels even when Jev reads a briefing.

Here is a **shortened illustration** of a real `portal_need` request shape. The production briefing is much longer, and the option text below is abbreviated; the keys and value types match the current builder. The example excludes any credential or transport headers.

```json
{
  "state": {
    "briefing": "The game\n- A top-down action roguelike...\nThe player\n- Style: Barrage (spam)\nThe build\n- Three spell keys...\nWhat the last fights measured\n- ...\nRight now\n- Health: 45 of 60...\n- Gold: 38...\n- Room 4 of 16\nDeciding in this request\n- ..."
  },
  "questions": {
    "portal_need": {
      "type": "choice",
      "instructions": "Which reward does this player need most right now? One option per portal badge; the highest answers become the portals out of this room, in that order. ...",
      "criteria": {
        "spell": {
          "what": "A new spell fills an empty key; a copy of one held raises its level.",
          "not_for": "A staff whose three keys are full and raised."
        },
        "affix": {
          "what": "A modifier attaches to a held spell or raises a duplicate's tier.",
          "not_for": "A staff with no affix slot left anywhere."
        },
        "stat": {
          "what": "A permanent player upgrade to movement, survival, mana, or sword.",
          "not_for": "A run with an empty spell key that this card would leave empty."
        },
        "gold": {
          "what": "A purse to spend later at the merchant or smith.",
          "not_for": "A player who already carries more than the stop can cost."
        },
        "fallback": {
          "what": "None of these fits; let the game decide."
        }
      }
    }
  }
}
```

Every question has `type: "choice"`, `instructions`, and a `criteria` map from **option IDs** to descriptions. The default briefing format uses option specs with `what`, usually `not_for`, and sometimes `examples`; the label format uses descriptive strings instead. `fallback` is an escape option in every question. It is not a door or any other gameplay option. Code filters options before constructing the question, so Jev is never asked to choose an impossible reward or an illegal room setting ([`questions/common.ts`](../packages/director/src/questions/common.ts)).

The proxy adds the configured model and server-side API key, then forwards the request to TypeSafe's System One endpoint. The browser sees only its own proxy URL and the response ([`evaluator.ts`](../packages/director/src/evaluator.ts), [`worker.ts`](../server/worker.ts)).

## What comes back, and what the game does with it

The following response is **illustrative**; the probabilities are chosen to show the contract, not copied from a live run:

```json
{
  "model": "jev-latest",
  "answers": {
    "portal_need": {
      "type": "choice",
      "choice": "spell",
      "probabilities": {
        "spell": 0.55,
        "affix": 0.20,
        "stat": 0.15,
        "gold": 0.08,
        "fallback": 0.02
      },
      "confidence": 0.91
    }
  },
  "usage": { "input_tokens": 1234 }
}
```

The evaluator checks that every asked question has an answer, `choice` is one of the offered IDs, the probability keys match the options, and the values form a valid distribution ([`evaluator.ts`](../packages/director/src/evaluator.ts)). The `choice` field is **not** automatically the game's final choice. If Jev selected `fallback` or assigned it more than half the probability, only that question goes to the rule table. Otherwise code removes `fallback`, renormalizes the remaining probabilities, applies decision-specific tuning, and samples with a deterministic stream derived from the run seed. For `portal_need`, it draws the first door from a sharper distribution and the remaining distinct doors from a broader one; other questions have their own sampling rules ([`source.ts`](../packages/director/src/source.ts), [`director.ts`](../packages/director/src/director.ts)).

The final plan still passes code-owned checks. Hard limits, such as encounter pressure, available resources, and the legal portal set, are enforced outside the prompt. A timeout, HTTP failure, malformed answer, declined answer, or failed commit check is recorded with a fallback path and answered by the **rule** source, never by flat random. Request deadlines, limited retries, and validation live in the evaluator; traces record the state, questions, distributions, selected source, and final decision ([`trace.ts`](../packages/director/src/trace.ts), [011: telemetry](planning/011-telemetry-and-evaluation.md)).

In a running game, open the top-right **DEBUG** button (or press backtick), then select **DIRECTOR**. The expandable **state as sent** and **questions as sent** sections show the full request for Jev-sourced decisions. The same panel shows the distributions used for planning, sampled choices, source and fallback status, latency, and token usage. If the rule source answered, its state is shown instead.

## Why the questions look this way

Jev evaluates the state and the supplied options; it does not own a persistent run memory. Code therefore summarizes the history before asking: recent combat, prior room looks, offer counts, what the player selected or passed over, and the current build. It also enforces sequence properties such as caps on repeating the same portal badge. This keeps the model focused on interpreting the *current* situation instead of counting a long log or enforcing an invariant through prose.

The project checks this behavior against two baselines. The `rule` arm uses hand-written weights over the same legal options and the same generator. The `random` arm uses flat weights and ignores state. Headless harnesses and request traces let us compare the resulting rooms and runs. The concrete experiments, including cases where a wording change made decisions worse, are documented in [Jev findings](research/jev-findings.md).
