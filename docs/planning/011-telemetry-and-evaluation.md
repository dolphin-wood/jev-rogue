---
id: 011
title: Telemetry, Debugging and Evaluation
status: proposed
date: 2026-09-21
summary: Every Director decision emits a trace with inputs, outputs, the full offer, ranks within the offer and within the pool, latency, tokens, versions and the player's choice. Input, event and commitment logs make a run replayable frame for frame. The debug sidebar and the room plan page show every request in flight, the blind test hides Director statistics until every run is done, and the headless harness plays and measures the run the game plays.
depends_on: [002, 009, 010]
---

# 011 Telemetry, Debugging and Evaluation

## Decision trace

```ts
interface DecisionTrace {
  run_id: string; run_seed: string; room_index: number; door_slot: number | null; round: number;
  purpose: Purpose;                           // "doors" | "portals" | "room" | "encounter" | "cards:<kind>" | ...
  director_mode: "jev" | "rule" | "random" | "scripted";
  source: "jev" | "rule" | "random";          // what actually produced this decision (002)
  fallback_path?: "timeout" | "http" | "invalid" | "declined" | "late" | "retry_exhausted" | "commit_check" | "deadline";
  content_hash: string; prompt_hash: string; model: string;
  state: unknown; questions: unknown;                      // exactly as sent
  answers?: Record<string, { choice: string; probabilities: Record<string, number>; confidence: number | null }>;
  sampled: string[];                                       // after sampling and validation
  offer?: { cards: string[]; rank_in_pool: number[]; blended_prob: number[] };   // card offers only
  validation_failures: string[]; retries: number;
  latency_ms: number | null; input_tokens: number | null; error?: string;
  applied: boolean;                                        // false if the plan was abandoned or arrived late
  unmodified: boolean;                                     // what reached the player is exactly what Jev answered
  player_choice?: string; player_choice_rank_in_offer?: number; player_choice_rank_in_pool?: number;
}
```

The purpose names the request, so one room's traces read as the sequence it
actually made: `portals`, `room` twice, `encounter`, `cards:spell`, and
`cards:stat:shop-stat` for each of the merchant's shelves.

Sinks per 009: console, in memory for a session, and the remote sink where the
game is hosted. Free-text intent is the only player-authored field.

## Event recording and replay

Per-step inputs alone do not reproduce a run: they miss what the player did between rooms, and probabilities alone do not say which plan was actually committed, since a plan that arrived late or failed the commit check (003) is replaced by the rule table's answer even though the Jev answer exists in the trace. The run log therefore has three parts:

1. **Input log**: move vector, aim and fire per simulation step, run-length encoded.
2. **Event log**: every non-step player action with its tick — portal choice, card pick, skip, discard, a spell moved between keys, and a purchase at the merchant or the blacksmith.
3. **Commitment log**: for each plan, which variant was committed, its `source`, the tick it was committed at, and whether the commit check trimmed it.

Each run also records `code_version`, `content_hash` and `prompt_hash`, since a replay against different content is not the same run.

- **Decision replay**: the `scripted` director serves the commitment log, not the raw probabilities, so fallbacks and trims reproduce exactly. No Jev call.
- **Full replay**: decision replay plus the input and event logs; reproduces the run frame for frame because simulation is deterministic (008, 009). The harness asserts a replayed run ends with the identical final world hash, and this assertion is a regression test for every change to `core`.

## Debug sidebar and room plan page

Both are built from the same readout (`buildReadout`): every request the
Director made for this room, the state it carried, and every question in it with
**all** its options' probabilities, the answer drawn and which arm gave the
distribution. A request that was not made cannot be described, because the
readout is joined from what the Director reported through `observe`.

- **The sidebar** (backquote, or the corner button; hidden by default) adds what
  the readout cannot say on its own: the room as built against what was asked
  for — space, symmetry, mood, zone features, measured values, whether the plan
  was trimmed — the encounter's profile, pressure, band, roster and waves, the
  offer's cards with each card's origin, the portals and their promises, the
  player's stats and mods, enemy counts by archetype, and the run's room and
  tension history. It also hosts the loadout: the three keyed spells, their
  costs, cooldowns and affixes, with buttons to reorder the keys, and a row that
  spawns any enemy or the boss in front of the player.
- **The plan page** shows the same three things full size, one tab at a time —
  the room, the Director's inputs, the Director's questions — left and right
  change tab, up and down scroll. It can be turned off in Settings.

## Experiment modes

| Mode | Behaviour |
|---|---|
| jev | Director as designed |
| rule | same questions, labels, filters and sampling; the hand-tuned weight table (`weights.ts`) instead of Jev's distributions |
| random | the flat table: state-blind weights, the floor |
| scripted | replays a run's commitment log |

The arm is an argument to `createDirector`; the browser runs `rule` and
`pnpm play <arm> <seeds>` takes it on the command line. In blind-test mode the
end-of-run screen hides all Director statistics; they are revealed after the
tester has finished every run.

`rule` is the control that matters. Beating `random` only shows that adapting to the player beats ignoring them, which a weight table also does. The project's claim is that Jev replaces the weight table, so `rule` must be a genuine attempt: the same information, tuned by hand until its designer is satisfied, not a straw man.

## Blind-test protocol

Each tester plays **three** runs, `jev`, `rule` and `random`, order randomized, same intent preset, with a break between runs. Three runs plus breaks is about an hour per tester, which the recruiting plan has to budget for.

A single "which was best" answer cannot produce the comparisons the metrics need: a tester who names `random` tells us nothing about `jev` versus `rule`. So after all three runs the tester **ranks all three**, first to third, separately for each question, with ties allowed and recorded:

1. "Which run felt arranged for you?"
2. "Which run would you play again?"

From the two rankings:

- **Primary**: the share of testers who rank `jev` strictly above `rule` on **both** questions. A tie counts as a failure of the primary. Target at least 65% of at least 12 testers.
- **Secondary**: the share ranking `jev` above `random`, and separately `rule` above `random`. Both should be high; if `rule` does not beat `random`, the labels, generators or weight table are broken and the primary comparison is meaningless.

If `jev` and `rule` are statistically indistinguishable, the honest conclusion is that a weight table was sufficient for this game, and 013 records it as such.

## Metrics

Primary: blind-test success rate.

Secondary:

- **Agreement within offer**: share of picks equal to the offered card with the highest blended probability. Target band 40 to 70%.
- **Pool-top presence**: share of offers containing the pool's top-blended card. Diagnostic for temperature.
- **Director fidelity**: share of Jev answers that reach the player unmodified, versus those altered by validation retry, parameter relaxation, the commit check or fallback. Low fidelity means the generator, not Jev, is deciding, and any preference measured in the blind test cannot be attributed to Jev. Target: at least 80% unmodified, and the relax rate per parameter under 10% (004).
- **Charter compliance**: showcase floor per run, nullification violations, `shielded` frequency (001). Any violation is a bug, not a metric.
- Latency p50 / p95; fallback rate; `fallback` answer rate; late-response drop rate.
- Room generation retries per plan; encounter assembly retries; measurement mismatch rates for both.
- Run length, death room index, hearts lost per room by mode.
- Cost per run from `input_tokens`.

## Tuning loop

1. Filter traces with `player_choice_rank_in_offer = 3` (player took the wildcard or lowest card).
2. Check the state labels first; fix summarizer thresholds.
3. Then option descriptions (010).
4. Then instructions or temperature.
5. Compare metrics across `prompt_hash` values.

## Headless balance harness

Two commands run `packages/harness` over core's real `step`.

**`pnpm harness`** is the sweep, and its failures block `verify`:

- Generator: every archetype × both symmetries × 20 seeds produces a valid,
  measured-in-band room or reaches the authored fallback; the relax rate must
  stay under 10%.
- Encounters: every profile × the room fixtures × four bands assembles inside
  its pressure band without breaching the concurrency cap, and each tier
  reaches its authored preset often enough to be worth authoring.
- Charter: over 200 adversarial runs the showcase floor holds in every run and
  no nullification limit is breached (001).
- Boss phases: the reference player's hearts lost in each of the three
  authored phases (`BOSS_PHASES`, 005) stay within ≤ 1 / ≤ 2 / ≤ 2.
- Elite affix sets: every legal set on sampled elite rosters stays in the elite
  pressure band after re-measurement, or degrades as 005 describes.
- Replay: recorded runs replay to an identical final world hash.

**`pnpm play <arm> <seeds>`** plays whole runs with the reference player model,
which moves away from the nearest bullet's predicted path and around contact
hazards, holds fire on the nearest enemy, takes the hearts on the floor, and
retreats to the entry when health is low. It walks the structure the game walks
(003): fourteen fights, the merchant, the boss, with portals
offering a reward kind and a difficulty and rewards applied through the same
`applyStat`, `equipItem` and `attachAffix` the scene uses. The Director plans
every fight and sets the tension, so a run measured here is a run played.

`JR_TRACE=<seed>:<room>` prints the player's position, state, target and the
model's decision every five seconds of one room, and an ASCII map at a timeout;
it is how a stuck room is diagnosed.

Pressure calibration uses the same command: sample the encounter profile space ×
room parameter space and tune threat weights and factors until measured pressure
correlates with hearts lost (Spearman ≥ 0.7) and each band meets the limits in
005.

## What the run measures

Twelve seeded runs on the rule arm, the figures `pnpm play rule 12` prints:

| | |
|---|---|
| Runs survived | 10/12 |
| Rooms timed out (model could not finish) | 0 |
| Combat room length, p10 / p50 / p90 | 7 / 12 / 18 s |
| Rooms under 5 s | 4 of 152 |
| Rooms cleared without losing a heart | 78% |
| Hearts lost per cleared room (build / peak / elite) | 0.21 / 0.21 / 0.38 |
| Boss | 74 s, 0.4 hearts, beaten in every run that reached it |
| Presets reached (peak / elite) | 42% / 51% |

The tunings those numbers hold up:

- **Density decides, the band guards** (`assemble.ts`). The fit takes the
  in-band count nearest the density target rather than the first count in the
  band, which is always the smallest. Targets read as bodies over the fight; the
  concurrency cap is a separate check, and a trickle may schedule up to
  twenty-four bodies, three to four every four seconds.
- **Bands are based on the measured pressure** of the rooms each tier should
  hold (005), not on a hand-guessed scale.
- **Roster health** is set so that a swing of nine kills nothing but a rusher in
  fewer than three, and the sword's knockback leaves a target in reach for the
  second swing.
- **Elite rooms are staged**: the rule arm sends an elite room to a trickle by
  preference. A packed single wave is the deadliest shape in the run — a
  six-body elite in a tight room takes six hearts in twenty seconds — and the
  heavy trickle is the *longer* fight rather than the spikier one.
- **Floor hazards come from the Director on both paths.** The scene assigns zone
  features with the rule arm's weights and the same one-hazard-per-room dedupe
  the harness gets, so a room built in the browser and the same room measured
  headless are the same room.
- A contact hazard waits 400 ms before its first heart, so a one-tile strip is
  crossed for free and standing on it is not.
- `TWO_WAVE_DELAY_MS` is 3 s. Six seconds puts the second wave outside the
  pressure model's window, which makes every two-wave roster look cheap and the
  fit buy more bodies to reach the same band.
- `placeProps` keeps the floor one region: a crate can stand where the floor has
  four floor neighbours and still be the only way between two halves of a room.
  A test holds it.

**What is not closed.** Doc 014 asks thirty to forty seconds a room and the
model's median is twelve. The arithmetic: the reference player clears a body
about every 1.2 seconds whatever the room holds, so length is a body count, and
the pressure model is nearly flat in a trickle's size, so the band cannot
express "longer". The model is faster than a person — it does not miss and it
dodges nearly everything — so twelve model seconds is more than twelve played
seconds, but the factor is not measured; the boss was sized on an assumed
one-and-a-half to two. The levers left are roster health and the density
targets, both of which move hearts as well as seconds, and 78% of rooms still
cost the model nothing.
