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

## The two state formats, compared

The Jev arm has a second axis: `DirectorDeps.state_format`, `labels` or
`briefing` (002). It is not a mode of its own, because it changes nothing about
which questions are asked, which options are legal or how an answer is sampled
— only what Jev is *sent*. The rule table reads the structured facts either
way, or it would stop being a control.

`pnpm route-review:jev <seeds> [profile] [budget] [labels|briefing]` runs one,
and `JR_STATE` sets it from the environment; each writes its own answer log, so
the same seeds can be run under both and read side by side. What is compared:

- **the route** — offer against need, the longest run of one badge, the gold
  door's share, spell levels over the run, how much of the affix pool is ever
  offered;
- **`pnpm answer-stats <log>`**, per question: the modal answer's share and the
  mean confidence. Watch symmetry and the three moods, which alternate or do
  not; `portal_need`; `affix_intent` against the lane the player's own words
  name; `variety`; and `next_tension` in room 1;
- **the cost of being asked**: decline rate, fallback rate, and input tokens a
  call.

A format wins on the route, not on confidence. A state that makes every
question easy to answer the same way is worse than one that makes the answers
move with the run.

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

**`pnpm jev-run <seeds> <budget> [arm] [log] [intent-free-text]`** plays whole
runs on one arm and prints the arm-comparison metrics below. The arm is an
argument and the rule arm costs nothing, so the control and the subject are
measured by the same code over the same seeds rather than by two readouts that
happen to print similar words. It reports, per arm:

- hearts lost and seconds per band, cleared rooms only, against 005's targets;
- **room variety**: how many of the twelve space archetypes and the nine
  encounter shapes a run actually used, and the share of the most common one;
- **style adherence**: the share of cards taken that belong to the intent's
  schools, families or tag;
- the **fallback rate**, per request, with the path;
- **what each question wanted**: per question, how many distinct options its
  distribution ever put first, the share of the most common, and the mean mass
  on it. This is the degeneracy check, and it is the only one of these numbers
  that catches a question answering a constant — a Director that gives every
  room the same mood scores exactly the same as one that varies it on every
  other line here. The mean mass separates a question that is genuinely sure of
  one answer from one whose distribution is nearly flat and whose top option is
  therefore whichever way the tie broke.

**Pace the harness.** A played run puts a whole fight between two requests; the
harness puts nothing between them. Fired back to back, a four-seed run was rate
limited six times, three of them consecutively, and the failure counter above
switched two of the four runs to the rule table for good — a 51% fallback rate
that said nothing whatever about the questions. `jevEvaluator` therefore spaces
its requests by seconds and retries a rate-limited one; every attempt that
leaves the machine is counted, retries included, because the budget is money
rather than requests. Paced, the same runs fall back on nothing.

**`pnpm jev-probe`** plans one late room for a strong player and a struggling
one, on both arms, in five requests, and logs them. It is the cheapest way to
see whether a question moves with the state at all, and the readout to reach
for before spending a run: `Decision.confidence` is null by the time a plan
carries it, so the confidence and the escape-option mass — which are what say
whether a question is grounded — are read off the log afterwards.

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

## Skill profiles

The reference player is one opponent, and the numbers only mean something
against a fixed one. But one opponent is not enough: the model as it stands
clears the first room in about five seconds for nothing, where a person took two
minutes and 23 of 60 HP. Every band above is measured against somebody nobody
is. So the model takes a **`SkillProfile`** — a set of human limits — and there
are three named presets: `expert`, `average`, `novice`.

`pnpm play <arm> <seeds> [profile]` runs one of them and prints which it ran.
`expert` is the default and is the model unchanged: every clock at zero, every
attention budget unbounded, the same 230 ms reaction. Every published number
reproduces under it, and it is the profile the harness asserts on — a balance
regression should fail against a fixed opponent, not against a weaker one whose
weakness was retuned last week.

Every limit is a **parameter**, and the only randomness is hashed from the
world's own tick, so a seed still replays exactly. The parameters, each carrying
in `packages/harness/src/play/skill.ts` the reason it exists:

| | |
|---|---|
| `reactionMs`, `blindSpotMs` | how far behind the simulation the player's eyes are, and the deeper lag on anything behind them or off the screen |
| `decisionMs` | how often the movement plan is redone; the model re-scored sixteen directions every frame, a person commits to a dodge |
| `attentionBullets`, `attentionEnemies` | how many moving threats are priced at once |
| `aimErrorDeg`, `targetSwitchMs`, `velocityErr` | aim a few degrees out, a beat before changing target, a trajectory read by eye |
| `entryIdleMs`, `recoverMs` | reading the room from the door, and being flustered after a hit |
| `castReactionMs`, `castGapMs`, `swingReactionMs` | a rotation that is not a metronome, and a swing thrown a beat late — which is also a swing that misses |
| `dashDelayMs`, `dashSkipChance` | dashing after the shot is on you, or not at all |
| `spacingSlopPx`, `timidityPx`, `bodyFearPx` | the melee band held sloppily, held too wide, and backing away from bodies that cannot actually hurt you |

`bodyFearPx` is the one that is a beginner *mistake* rather than a beginner
*limit*, and it does the most work. Contact damage does not exist in this game,
so standing next to a turret is free and the model knows it; a new player does
not, gives every body room, and therefore spends the fight in the open with
nothing dying and everything shooting. That single misconception produces the
shape of a real first session — long rooms, mostly ranged damage — which no
amount of added lag does.

Fear **stops at contact**, though, and that boundary is not a detail. Backing
away from something faster than you is not an escape, it is a chase you lose:
fitted without the exemption, the novice was hit by rushers at a median 33 px —
inside a 32 px thrust — while fleeing them, and swung less than twice a room
because it was always running. Melee was then half its damage, the opposite of
what a real session shows. Somebody who has just been caught turns and mashes
the attack button, so once a body is inside the player's own reach the fear term
switches off and the model fights.

**A profile's reaction may not exceed the telegraph it is meant to read.** The
rusher's thrust winds up for 280 ms, and 005 sizes every telegraph against a
250 ms floor. Fitted at 320 ms, the novice had not perceived the attack on 43%
of the rusher hits it took — the whole windup happened before it could see it.
That is not a slow player, it is a player the game was never designed for, and
it makes every melee telegraph an unavoidable hit rather than a mistake. A
beginner is slow to *understand* a telegraph, which is what the decision rate
and the attention budget model; they are not slower than the telegraph. At
270 ms the model sees 70% of them and melee falls from half the damage to an
eighth. `saw the attack` in the `JR_MELEE=1` readout is the number that says so.

`JR_SKILL=timidityPx=60,castGapMs=2400` overrides individual parameters. It is
the bench a profile is fitted on; the preset is what the harness reports.
`JR_MELEE=1` adds, to each melee hit, the distance and off-axis angle at the
moment it landed plus whether the model had seen that body attacking when it
chose the step it was standing on and how stale that choice was — which is what
separates "stood too close" from "never saw it" from "saw it and was mid-dodge".

**How the model plays its keys.** Its rotation presses the ready key that was
cast longest ago, read off the casts it actually saw in the world, so all three
keys are used as a person uses them; always pressing the first ready key made a
spell whose cooldown is shorter than its own windup the only one ever cast.
It raises a line of spikes only at a body the line reaches, holds a charge spell
to full and lets go, presses a banked spell only when the press would fire,
casts a stance when a hit is about to land, an enchant before closing to swing
and a trail while moving, and walks through its own fields and trails, which
cannot hurt it — but not through burning grass, which can (004). `pnpm play`
prints each spell's use (`SPELL_USE`: seconds held, casts, and damage while it
was the only key), and `JR_ROOMS=<n>` stops a run after its first n rooms.

**How the model picks a card** (`chooseCard`, `play/run.ts`), in order: the
health card when it is hurt; with a key empty, the first new spell tagged with
the stated style, else the first new spell; otherwise the first card, which is
the Director's top pick. A person with two empty keys fills one; a model that
always took the first card measured the Director's taste for levelling the
starter as a run that held one key into room 4, and every figure downstream
was a one-spell run's.

**The novice preset is provisional.** Its `castGapMs` of 8000 makes it nearly a
sword-only player, so it says little about spells. It is fitted to one observed session and
should be refitted when real logs arrive. As it stands, rooms 1 and 2 take about
36 seconds each for about 7 HP, rooms 3 and 4 take 68 to 71 seconds for 17 to
24 HP, **85% of the damage is ranged** and half the runs end by room 4. The
damage shape matches the observed session; the room length does not yet — the
real room 1 took two minutes. Reaching two minutes in the model is possible, but
every setting that got there also pushed melee back to half the damage, which is
the wrong shape for the sake of the right number. Length is the part to refit
when more logs arrive.

## Time-based state, calibrated against a person

Two of the labels the Director reads were measured against the reference player
and nobody else, so a person's run could never move either of them.

**`clear_speed`** was a room's length against a flat 30 seconds, which is the
model's pace: `novice` takes 53 to 69 seconds a room and `average` 8 to 36,
while a played run averages about 38 seconds a fight. Every room a person
played therefore read `slow`.

It is now measured in two parts:

- `expectedClearMs(roomIndex)` is the **human baseline**, a curve fitted to a
  full played run: 60 s at room 1, falling to 38 s by room 6 as the player
  learns faster than the rooms grow, 45 s at the last fight, 75 s at the boss.

  The first correction overshot. It was set from one early session where the
  opening room went to learning the buttons, and put room 1 at 105 s and the
  boss at 150. The run it is fitted to now is sixteen rooms in **10:06**, with
  the boss in **1:05** — about 38 seconds a fight — on a build of Magic Bolt Lv3,
  Shock Arc Lv5 [rime, harvest, blight], Void Orb Lv5 [ricochet, repeat, chain]
  and three Vigour. A curve that calls that run `fast` in every room is as
  useless as one that calls it `slow`, so the anchors are set to make an
  unhurried clear at this pace read `normal`, a sharp one `fast`, and a room
  that goes wrong `slow`.

  The same session says something the curve deliberately does not try to fix:
  **24 HP lost over the whole run**, which is a run that was never in danger.
  That is a balance question (005, 019), not a labelling one.
- `expectedClearMsFor(roomIndex, pastMs)` is what *this* player should take:
  once three fights have been cleared it is **their own recent median**, held
  inside 0.2× to 2.5× the baseline. Against the fixed curve alone the label says
  how good the player is, which is a fact about them and not about the room; a
  running median makes it say "this room went unusually well", which is what
  pacing is for. The clamp stops a run of four-second rooms redefining `fast`
  out of existence.

**`movement_pressure_recent`** took near-misses per second, which nothing
measured — the browser and the harness both passed a constant, so it was `light`
in every room of every run and the two options grounded on it were grounded on
nothing. It now reads the **share of the last room spent with an enemy bullet
within 90 px**, which the playtest log already records the same way in both
places; a fifth of the room is `heavy`.

Measured over four reference runs after the change, on the expert model:
`clear_speed` 29 fast / 20 normal / 11 slow, `movement_pressure_recent` 45 light
/ 15 heavy. Before it: 30 fast / 25 normal / 1 slow, and light everywhere.

## What the room measures

`WorldStats` records, per fight, what the player actually did: presses of a key
holding a spell and how many the bar refused, time under the cheapest key's
cost, projectiles fired and bodies struck, damage dealt and the blade's share
of it, and health lost split into enemy fire, blades and the floor. It lives on
the world rather than in the harness so the browser and the harness measure the
same things in the same place — otherwise the two arms are not comparable, and
that is exactly how `mana_sustain` survived: nothing in the game measured it.

`run/observed.ts` buckets them into the labels the Director reads, over the
last two fights (doc 010 has the cut points). `PlaytestRecorder` carries the
same three mana counters into the browser's exported log, so a real session
reports them beside its room times.

**A press is counted on the press**, not on the cast: every press of a key that
holds a spell, and a refusal whenever the cost exceeds the bar, whatever else
would also have stopped it. Counting only presses that were otherwise ready
measured the wrong thing twice — the browser's player presses anyway and wants
to know why nothing came out, and the reference model *declines* to press what
it cannot afford, so the refusal rate came back 0 of 27,978 and said mana was
free when the bar was the reason the model stayed quiet. The bar also almost
never reaches zero: it sits in single figures and refuses because what is left
will not pay for the key, so both mana measures are against **the key's cost**.

**Open, for the UI queue:** nothing on screen says why a cast did not happen.
`SpellStep.refused` distinguishes `mana`, `cooldown`, `busy` and `empty`, and
none of the four reaches the player — no flash on the bar, no cost tick, no
sound. A player whose press does nothing cannot tell a cooldown from an empty
bar, which is the one thing that would make the mana economy legible.

## Reading a route back

Pass rate and band averages say whether a run was survivable. They say nothing
about the thing the offer exists for — whether the doors and cards in front of
the player made sense to them — and optimising for pass rate hides it
completely: a run can meet every band target while handing a player with three
spells a fourth spell door, or selling them gold in a run with no vendor in it.

**`pnpm route-review <arm> <seeds> [profile]`** (and `pnpm route-review:jev
<seeds> [profile] [budget]` for the live model) prints the route: per room, the
portal it was entered by, the build at that moment, `build_shape` and gold, the
cards on the reward screen, and the portals out. Then it flags the offers that
do not make sense, as rules rather than as impressions — a spell door to a full
staff with no card that levels one, a stat door to a raw build with an empty
key, an affix card no held key can take, gold with no vendor left in the run,
every portal out promising the same currency, and either of the run's two fixed
exits offering more than one door or wearing a reward badge (003, `fixedExit`).

**Every seed is a different player.** The review used to fix the preset at
`spam` and send no typed intent, so `affix_intent` answered `wider` in 22 offers
of 22 — which reads as a degenerate question and is a degenerate *input*:
`wider` is the lane grounded on the preset being spam or area, and every run was
a spam run. The seeds now cycle a table of presets paired with the kind of
sentence a person types into a 120-character box, agreeing with the preset about
half the time, which is the case the Director has to get right.

It then prints, over every run:

- **the mix of kinds offered and taken**, and how often the **first** door
  matched what doc 007's `build_shape` table alone says a build of that shape
  needs. Expect this to sit *below* 100% and to have fallen since the run
  history was added: the brief deliberately overrides the table when the same
  badge has been shown three rooms running. It is a measure of agreement with
  one rule, not a score;
- **the longest run of one badge**, offer after offer, which the distribution
  cannot show — a mix that is 30% affix over a whole run is fine, and six
  consecutive affix offers in the middle of it is the complaint;
- **the affix histogram**, every affix in the game with how often it was offered
  and how often taken, because "affixes feel like the same few every time" is a
  claim about a histogram;
- **the spell levels room by room**, as the mean of the keys held, plus the
  share of keys above level 1 — buried before in a build string that read
  `magic_bolt@1` sixteen times;
- **the look-only answers**, so a rule run shows the same spread the live model
  does.

**`pnpm answer-stats <log.jsonl> [question ...]`** reads the JSON-lines log
`jevEvaluator` writes and prints, per question, how often each option was
chosen and the mean confidence. It costs nothing to run and it is what catches
the failure the route cannot: a question answered the same way every time looks
fine from the route and is four requests' worth of tokens spent on a constant.

## Calibration against real play

The client records a **playtest log** while a person plays: per room, its index
and type, how long it took, HP lost keyed by the simulation's own cause strings,
kills, dashes, casts, swings, and how long an enemy bullet was within 90 px.
Nothing in it is re-derived — the HP and the causes are what `player_hit`
publishes, the kills are `enemy_killed` — and the harness writes the same shape
for a profile's run, which is what makes the two comparable at all. It is kept
in `localStorage` (every access wrapped, so a private window costs a log and not
a session) and exported from the debug sidebar's tools tab, as JSON to the
clipboard or a download. Nothing about the in-game UI changes.

Beside those, each room carries **what balance is read from**, written by one
`RoomWatch` (`sim/room-watch.ts`) that the recorder and the harness both call
every step: the build it was fought with (each key's spell, level and affixes,
and the stats off their base), health in and out, damage dealt by what dealt
it (`WorldStats.dealtBy`: `spell:<id>`, `sword`, `spin`, `affix:<id>` for an
affix's burst, copy or split, `dot:burn`, `ground:<kind>`, a doom's burst), casts
and mana by spell, kill times by archetype (an elite apart), and how many burns,
poisons, freezes and shatters took hold. They are a few numbers a room and stay
in memory for the session: storage keeps only the lean record a reload needs,
and the export carries everything.

**`pnpm play:calibrate <log.json> [seeds] [arm]`** lays a real log beside each
profile on the same room indices and prints the gap: room time and HP lost per
index, each profile as a percentage of the real session, and the share of damage
that was ranged, melee or hazard with the top causes. A synthetic sample lives
at `packages/harness/src/play/fixtures/sample-playtest-log.json` so the command
can be exercised before a real log exists; nothing is fitted to it.

The loop is: play a session, export the log, run `play:calibrate`, move one
parameter with `JR_SKILL=`, and when the gap closes, write the value into the
preset. What the loop is for is the open question at the end of this document —
the factor between a model second and a played second, which the boss was sized
on an *assumption* of one-and-a-half to two. A fitted novice profile measures it
instead.

Pressure calibration uses the same command: sample the encounter profile space ×
room parameter space and tune threat weights and factors until measured pressure
correlates with hearts lost (Spearman ≥ 0.7) and each band meets the limits in
005.

## What the run measures

Twenty-four seeded runs on the rule arm, the figures `pnpm play rule 24`
prints:

| | |
|---|---|
| Runs survived | 36/48 |
| Rooms timed out (model could not finish) | 0 |
| Combat room length, p10 / p50 / p90 | 8 / 19 / 31 s |
| Rooms under 5 s | 2 of 587 |
| Rooms cleared without losing a heart | 50% |
| Hearts lost per cleared room (release / build / peak / elite) | 0.18 / 0.54 / 0.63 / 1.18 |
| Hearts lost by room index, 1 to 10 | 0.08 / 0.05 / 0.33 / 0.84 / 0.71 / 1.19 / 0.60 / 1.09 / 0.78 / 0.63 |
| Boss | 42 s, 2.39 hearts, beaten in 36 of the 37 runs that reached it |
| Awake-body time with no attack and no threat move | 1.6% |
| Nothing visible in view, of uncleared room time | 15.1% |
| Presets reached (peak / elite) | 5% / 37% |

Taken over **forty-eight** runs rather than twelve, because a twenty-four run
sample was measured at ±4 on survival — two sets of the same configuration
came back 16/24 and 10/24 — and a single set is therefore not a number to tune
against.

Three of these figures are the joint recalibration's, and they move together
by design: the threat weights, the tier bands and the roster-length term in
the pressure model are one calibration and none of them may be moved alone.
The run-progress ramp (doc 005) is what the by-index row measures, and the
idle share is the token budget's.

The survival and heart figures moved when the roster got its rhythm and the
boss its two new moves (005): before, the model survived every run, cleared
63% of rooms without being touched and lost 1.8 hearts to the boss, which is a
roster that is watched rather than fought. Every band is still inside its
ceiling and no room is unfinishable; what changed is the tail, and the tail is
where a run is decided.

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
