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

Choice, and Noul for one decision. The capability contract is one sentence: Jev returns a probability distribution over options code supplied.

**Noul** (one probability that a statement holds) is used where every option has to be judged on its own rather than against the others: a reward card's fit (007, jev-findings 35). A choice question says which option is *the* answer, and over a long list the second-best option comes back near zero however well it fits; a Noul per option says how well each fits, and one option's yes costs no other option anything. The evaluator carries a Noul answer on as a two-option distribution, `{ yes, no }`, so the source, the rule table and the traces read one shape of answer. A Noul has no escape option: its answer is always a judgement. Score (a rubric level) exists in the API and is not used: measured against Noul on the same cards it separated a style's cards from the rest less well, used the bottom half of its scale, and cost more tokens.

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
  planDoors(ctx: RunContext): Promise<DoorPlan>;                                // pacing envelope, code only: no request
  planRoom(ctx: RunContext, door: DoorRef, suggested: Tension,
           alongside?: OfferRequest): Promise<RoomPlanResult>;                  // two rounds, 004 + 005; round 1 carries the tension and the offer
  planOffer(ctx: RunContext, req: OfferRequest): Promise<OfferPlan>;            // portals + card offers in one request, for a room with no room plan
  planPortals(ctx: RunContext, choices: PortalChoices): Promise<PortalPlan>;    // per-portal kind, elite, school, family, grade, vendor (003), alone
  planCards(ctx: RunContext, req: CardRequest): Promise<CardPlan>;              // one kind's offer or shelf (007), alone
}
```

There is **one** implementation, parameterised by where distributions come from, so the three arms share every summarizer label, option filter, generator and sampler and differ in exactly one component. `jev` is the subject. `rule` is the **control**: a hand-written weight table in place of Jev's distribution. It is the baseline the project must beat, because the thesis is that Jev replaces a weight table, not that adaptation replaces randomness. `random` ignores state entirely, uses flat weights, and exists only as the experimental floor. Full schemas for `RunContext` and each plan are in 009.

## State conventions

- **Semantic labels only.** No raw numbers reach Jev — `pressure_cap` reaches it as `tension_cap`, and a portal count as `one`, `two` or `three`. The grounding test runs `assertNoRawNumbers` over every request the Director makes. `packages/core/src/run/summarize.ts` is the only module that converts numbers to labels; every label it can emit is listed in 010 so descriptions can reference the same words.
- **Decision-local state.** Each decision sends only the fields it needs.
- **Guidance is a label from code**, for example `tension_cap: "peak_allowed"`, never a number like `pressureCap: 4`.
- **Player free text** goes verbatim into `intent.free_text`, capped at 120 characters, with instructions stating it is design intent, not a rule.
- A request's state stays under about 1500 tokens as a label table, and about 2500 as a briefing.

Standard labels (complete list in 010):

| Field | Levels |
|---|---|
| health | critical / low / ok / full |
| recent_damage | none / some / heavy |
| clear_speed | slow / normal / fast |
| run_progress | early / mid / late / pre_boss |
| tension_cap | release_only / build_allowed / peak_allowed |
| hazard_cap | none / low / high |
| last_tension | release / build / peak / none |
| since_release | just / a_while / long |
| last_room_kind | combat / elite / rest / none |
| damage_trend | rising / steady / falling |
| build_shape | raw / forming / formed |
| build_gaps | some / none |
| keys_lean | spam / nuke / area / dot / melee / mixed |
| off_style_picks | none / one / two_running |
| mana_refused | never / sometimes / often |
| mana_short_time | little / some / most |
| hits_per_shot | few / one / several |
| cast_rate | slow / steady / rapid |
| damage_rate | low / fair / high |
| sword_share | none / some / most |
| hurt_by | nothing / shots / blades / hazards |
| door_offered_running | none / spell / affix / stat / gold |
| door_taken_lean | none / mixed / spell / affix / stat / gold |
| door_skipped_most | none / spell / affix / stat / gold |
| last_mood_temperature | cold / warm / none |
| last_mood_brightness | dim / bright / none |
| last_mood_particles | calm / busy / none |
| last_symmetry | mirrored / asymmetric / none |
| spell_levels | all_base / some_raised / mostly_raised |
| affix_slots_open | none / few / many |
| held_elements | none / one / several |
| casts_per_bar | many / some / few |
| mana_stats_taken | none / one / several |

**The recent history is labels, not a list.** The state says where the run is
and how the player is, but a Director that cannot see what the run has just
*done* answers every room correctly on its own and produces a sequence that
reads as noise — three hard rooms running, or five builds with no breather.
Jev cannot reason over a sequence, so code walks the history and emits one
label each (`director/questions/history.ts`): the previous combat room's
tension, how long since the run last let up (counting a release room or any
non-fight room as letting up), and what the previous room was, with every
vendor — merchant, blacksmith and fountain — counting as a rest. No counts and
no arrays reach Jev.

**The offer has a history too, and it is the one the player feels.** The
Director answers each room from that room's labels, so a badge shown for the
sixth time looks exactly like one shown for the first — and reported from play,
once the affix slots opened the affix door won essentially every offer and "you
just close your eyes and pick affix". No single answer was wrong. Three labels
close it (`director/questions/history.ts`): `door_offered_running`, the kind
that has been on the badge for the last three offers running; `door_taken_lean`,
the kind the player walks through most; and `door_skipped_most`, the kind they
are offered and keep passing over, which is the half of revealed preference the
picks cannot show. Counts and arrays stay in code, as always.

**The look of the last room is a fact too** (`last_symmetry`, `last_mood_*`).
Four look-only questions — symmetry and the three moods — were each grounded on
the same partition of health, recent damage and clear speed, so a player who
was coping got the identical room sixteen times: measured over three live runs,
`mood_temperature` warm 100%, `mood_particles` busy 100%, symmetry asymmetric
94%, `mood_brightness` dim 91%, all at about 0.95 confidence. That is not a
model failing to answer; it is four questions that were one question, asked
four times, about a state that barely moves. Each now names a different field —
the room type, how deep the run is, the hazard cap, what the keys carry — and
each is told what the last room looked like.

That was expected to be enough and it was not. The state also counted how many
rooms running each part of the look had held, and a classifier reads a count
about one answer as an argument for it: with the streak line in, the look came
back `calm` in 91% of rooms; with it deleted and nothing else changed, 72%.
Alternation is a property of a *sequence* and each call is one state, so the
**intent** stays in the instructions, the **fact** in the state is the last
room's look and nothing more, and the **mechanism** is code —
`LOOK_REPEAT_PENALTY` multiplies the previous room's answer down before the
draw. The anchor took the same treatment for the same reason: "a run needs
both kinds of room" is a sentence about a run, and removing it from the
instructions moved `none` from 85% to 87% while the code term moved it at
once.

**The staff is a fact** (`run/build-facts.ts`). `build_shape` says how complete
the build is and `keys_lean` says which way it tilts; neither says what is *on*
it, so the offer question — which is entirely a question about the held build —
was answered without it. Five labels (`spell_levels`, `affix_slots_open`,
`held_elements`, `casts_per_bar`, `mana_stats_taken`) and one prose map,
`held_spells`, with a line per key: name, level, school, element, cost band,
what is attached and how many slots are free. The prose is the same shape as
`card_facts`, which the card questions already read well; the labels are what an
option can be *grounded* on. `casts_per_bar` in particular closes a loop the
state could not see at all: every level a spell gains raises its cost, stat
doors are a third of the offers at best, and the bar does not grow on its own.

### "Not this one", in the canonical clause shape

A fit clause can only assert that a field **is** one of some values, and that is
the right constraint — Jev matches a state to a description, and a negation is
not something a match carries. But a field's values are closed, so *every value
but one* is a positive clause that means the negation.

`KIND_CLAUSE` uses it: each reward kind's option is grounded on every value of
`door_offered_running` except its own. Adding one to all four is a constant on
all four, except for the kind the label names, which loses it — so the badge the
player has seen three rooms running keeps every argument it had and simply stops
being the one with the most matching clauses. No die is rolled and no option
leaves the list; a player who genuinely still needs affixes still gets them.

This is the shape to reach for whenever the design wants "less of this, not none
of this". A filter would be a code rule, and an RNG drop would be worse: it
would take the decision away from the Director instead of giving it the fact.

`damage_trend` needs the *series*, not the labels: `recent_damage` is already
the sum over the last two rooms, so two rooms at one heart and a quiet room
followed by a two-heart one are the same label. `RunHistory.hearts_lost` carries
it; rooms that cost nothing are skipped, or a rest room would read as the run
easing off when nothing about the fights had changed.

**`build_shape`** says how much of a build there is, as against how hard it
hits, which the observed labels (`damage_rate`, `cast_rate`, `sword_share`)
say from the fights themselves. Keys filled, affix slots filled and spell
levels, weighted and bucketed (`run/build-shape.ts`, doc 007). Every reward
kind's option owns exactly one of its three levels, which is what makes the
portal question a question — four options grounded on a shared pile of
conditions is a question answered by whichever option carries the most
conditions, not by the state.

## The briefing: the run written out

Jev is a general natural-language classifier, not a label matcher. So the state
has a second form, chosen per run by `DirectorDeps.state_format`, and the two
are an A/B rather than a migration: the same questions, over the same
code-filtered options, with the state either the **label table** above or the
**briefing** — the run as a designer would want it read
(`director/briefing.ts`).

The briefing is one field, `briefing`, holding a plain-text list. Not JSON:
JSON spends tokens on punctuation and loses the one thing prose has, which is
that a line can say what a number means without turning the number into a
verdict. Its shape is fixed:

- **Sections of fields**, one line per object, each line a comma-joined summary
  of that object. Sub-items only for what is text by nature — a spell's
  behaviour, an affix's effect, the player's own words. No assembled prose: a
  field that has no value drops its phrase and nothing else has to be reworded.
- **Facts, never verdicts**: "lost 9 of 60, nearly one of 6 hearts", not "a
  rough room". What the numbers mean is the Director's to judge. Nor
  prescriptions: "Last room's light: warm", never "and the next one should not
  look the same". A state that tells the Director what to
  answer is the weight table with the numbers spelt out, and the sentence is
  usually there because a question was coming back the same way — which is a
  reason to give a better fact, not to give an instruction.
- **Counts, not thresholds.** A label can say a badge has been on "the last
  three" offers; the fact is *how many*, and a badge on nine offers running and
  one on three are the same label and not the same run. The briefing counts:
  offers running per badge, offered against walked through per kind, fights
  since the run last let up, fights since the last room with a variant body in
  it, and the pitch of every fight so far in order. Jev cannot walk a list or count one,
  so code counts and the briefing prints the number.
- **Arithmetic is code's.** "Gold: 6" and "a spell costs 45" is a subtraction
  the Director has to do in its head, and measured it did not: the gold door
  was the top need once in 99 rooms. The briefing does the sum — what a purse
  would come to, what that buys, and what everything at the stop costs.
- **Every coined word is explained once**, in a glossary the briefing opens
  with, and every number in that glossary is read from the constant the game
  runs on — the merchant's prices, the mana regeneration rate, the run's
  length. A briefing that quotes a price the merchant does not charge is
  advising on a game that does not exist, and nothing but a test comparing it
  with the constant can catch that.
- **One word per thing**: merchant, never "shop"; smith, never "blacksmith";
  key, never "slot"; variant, never "subspecies".
- **Unmeasured is said, not defaulted.** Before the first fight the observed
  buckets read as a player on a full bar clearing fast — three claims about a
  run that has not started, and the reason room 1 came back `peak` on every
  run. The section says so in words instead.

The sections are: the game; the player, with the sentence they typed and the
affix lane a keyword read finds in it; the build, key by key with each spell's
behaviour written from its own parameters and each cast's cost as a number and
as casts a bar; what the last fights measured, each figure with the bucket the
game reads it as; what the doors have been offering and what the player does
with them, as **plain counts** — how many times each badge was offered and how
many times it was taken, with nothing said about who leans which way;
the run so far, the last five rooms in full and the earlier ones rolled up with
aggregates, then the pitch of every fight in order, the fights since the run
last let up and what the last room looked like, a line a part; the bodies met,
the close calls and how many fights held a variant body; on a round-2 request,
the room round 1 decided, down to how many bodies it may hold and how many of
them may stand at once; where the player stands now — the bar, the purse, what
the purse buys, what a gold door's payout would add to it, what the whole of
the stop costs and which vendors the run has been through; what is ahead;
and what this request is deciding.

**The last of those is generated from the question names.** A room's round 1
asks up to seventeen questions at once, and a hand-written line naming one of
them told the Director the wrong thing about the shape of its own job
(`deciding.ts`).

### Options as specs, not fit clauses

A fit clause asserts that a state field is one of some values. With a briefing
there is no field to assert, so every option carries a **spec** instead —
`what` it is, `not_for` what it is not for, and, rarely, `examples` written in
the same words the briefing prints (`questions/specs.ts`). Two things the
clause could not carry:

- a **negative**. "Not for a staff with every key full" is the most useful
  thing to say about a spell door, and the clause form could only approach it
  sideways, by listing every value of a field but one.
- room for the **design intent to live in the instructions**, where a rule
  about the offer belongs. On the label arm the reward-design brief is repeated
  on every option and every option therefore argues.

**Every option has a negative, generated ones included.** An option with
nothing it is wrong for is the one every state falls into: measured, the
options sent as `{ what }` alone — the space archetypes, the zone features, the
variant bodies — took their questions at 88%, 95% and 66%. The negatives for
those are written from each item's **own data**: a space's openness, cover and
shape; a feature's tags and hazard budget; a variant's base body and its tags.
A **card** takes one from its own table row too (`cardNotFor`): a spell's shape
or spread and then its range tag, element or mana cost; an affix's lane, whose
single written limit it shares with the two or three others in it; a stat's
family. It used to get one only where the pool could tag it with nothing or
where its single claim was an upgrade, which left most of a twenty-five-card
spell offer — the longest option list the Director sends — with no negative at
all. What is still true is that a sentence written on *most* of a pool is noise
rather than information, which is why the clauses are read off the card and not
off the offer.

**Examples are rare and generic.** An example says "a state that looks like
this is this option", so three of them on every option of every question stops
describing the options and starts prescribing the mapping. They are kept only
where two options are genuinely easy to confuse and one line of state is the
whole of what separates them — the two vendors, the two halves of the
composition mirror, the look-only questions, whose one real fact is what
the last room looked like, and `variety`, whose one real fact is how many of
the last three kept cards were off the stated style: without the example line
Jev read that count backwards, more off-style picks answering *less* variety. Each is **one line, and the line its own question is
answered from**: the look used to arrive as a four-part comma list, so each
look question's example quoted three specific values of fields it does not
decide. Split into a line a part, the rooms the player walks into stopped
repeating — the longest run of one look fell from 9, 12, 10 and 16 rooms to 4,
6, 7 and 8. `briefing.test.ts` asserts the list, so adding one is a decision
rather than a habit, and asserts that each is a line `briefing.ts` actually
emits.

An option with no hand-written spec falls back to its description with the fit
clause stripped: honest, and silent about what the option is not for.

## State is facts, not verdicts

**A label is a measured quantity with its buckets named for what was
measured.** `mana refused: never / sometimes / often` is a fact. `mana_sustain:
tight` is a verdict; so were `bottleneck: mana`, `archetype: nuke`,
`build_range: mid`, `build_power: weak` and `consistency: drifting`. Deciding
what the player needs is **Jev's** job, done through the questions and their
options. Code's job is to measure one quantity per label and bucket it, and
where a question needs a judgement to ground an option, the option cites the
facts instead.

It is not a stylistic preference. Three of those verdicts were **predictions
from an offline build simulator** — a cast loop firing on cooldown, which is
nobody's rotation — and one was a constant:

| Verdict | What it claimed | What play measured |
|---|---|---|
| `mana_sustain` | `tight` in 50 rooms of 56 | 0 of 27,978 ready presses refused for mana |
| `bottleneck` | `mana` for most builds | the same |
| `build_power` | a simulated damage figure against a fitted curve | damage a second, which the world already counts |
| `build_range` | — | hard-coded `mid` in the browser and the harness alike |
| `consistency` | — | hard-coded `on_plan`, so `variety` answered `low` at 0.98 for every offer of every run |

An option grounded on a stuck label fits every state, and the measured result
was the elite portal's reward answering `stat` at 99%. The facts that replaced
them are in `run/observed.ts`, measured on `WorldStats` while the player was
playing, taken over the last two fights, and bucketed at cut points fitted to
the `novice` and `average` skill profiles (doc 010).

Two rules follow. **A new label is checked for spread over a run before a
question is grounded on it** — and a fact that does not move is still worth
sending, because `mana refused: never` is a true thing the Director should
know, where `mana_sustain: tight` was a false one. And **`run_progress` and its
kind are facts too**: it read `pre_boss` in 24 rooms of 56 because it was still
bucketing the nine-room structure doc 003 replaced with fourteen fights.

## Ranked answers, not pre-built combinations

A question that offers **combinations** — "stat + spell + affix" against "spell
+ affix + gold" — asks Jev to compare bundles that mostly overlap. With three
doors drawn from four kinds every option shares two thirds of its content with
every other, so the options are near-identical sentences and the answer goes to
whichever happens to carry one more matching clause. It also throws away the
ranking, which is the one thing the answer should carry: a set says nothing
about which of its members the player needs *most*.

So a question that fills several slots offers **single options** and code takes
the top `n`, sampling without replacement at a documented temperature
(`PORTAL_NEED_TEMPERATURE`, below one, so the distribution is sharpened): the
first slot is almost always the top answer and the ones after it vary a little.
Hard constraints filter the options **before** the question is asked, and a
constraint that only bites after the ranking — at most one room with no fight
in it, never as the only way on — makes that option fall through to the
next-ranked one rather than costing a slot.

A **hard** sequencing rule is still a filter, not a sentence: a peak never
follows a peak, so `tensionsAfter` removes it from the option list. Core's
pacing cap only drops to `build_allowed` after *two* peaks running, which would
have permitted the pair.

## Question conventions

- **Parallel where the state is shared.** Questions that read the same state and do not depend on one another's answers go in **one request**, however many plans they belong to: a room's round 1 carries its intensity, space, symmetry, size and mood, its portals and its cards. The test of whether a question belongs in a request is whether it reads that request's state, not which plan it is filed under — `next_tension` belongs to the run's pacing and is asked with the room, because the room is where its answer is needed and the state is the same. The request's state is the union of what each plan sends. When several instances of one plan share a request — a vendor's three shelves — each is scoped by a prefix on its question names and state keys (`shop_stat__overall`, `shop_stat__card_facts`).
- **Independent.** Where one decision depends on another's answer, use two requests in sequence and put the first answer into the second request's state: a room's second round sees the room that was generated from the first round's answers, not the one that was asked for. Never rely on Jev seeing another question's answer in the same request.
- **Coupled parameters are one question over feasible combinations.** Independent questions span a product space, and a product of individually legal answers can be jointly infeasible. Whenever the combination must satisfy a budget or a structural rule, code enumerates the feasible combinations and Jev picks one: the set of reward kinds across a room's portals (003), space archetypes (004). Independent questions are only for parameters whose combinations the generator can always satisfy, and their joint feasibility is then an acceptance metric (011), not an assumption.
- **Cross-question constraints are code, not prose.** A rule that relates two answers is enforced after the response, never written into `instructions`. Jev evaluates each question alone and cannot honour it.
- **Scarce slots ask per slot, not per item.** "Which feature fills zone A" with `none`, never "which zone does the poison pool go to". A slot receives at most one item, so there is no overcapacity and no collision.
- **Mutually exclusive variants share a `resource`** and code post-filters: if two slots picked items with the same resource, keep one and drop the other to `none`.
- **Every question carries an escape option** named `fallback`, described as "none of these fits; let the game decide". Choosing it hands that single decision to the rule table. `fallback` is distinct from gameplay options such as `none` ("no feature"), which are ordinary choices.
- **Descriptions carry the decision basis** in the label vocabulary of 010. Jev never sees the data behind an option.
- **Every option says when it fits, in labels the request's state carries.** Jev matches a state to a description: "Few bodies: a breather. Fits when tension is release; when recent damage is heavy" can be matched; "sparse population" cannot, and an unmatched question spreads its mass onto `fallback`. An instruction that names a label (`clear_speed`, `recent_damage`) is a promise that the label is in the state. Measured on the live model: grounding the encounter, grade and elite questions this way raised their mean confidence from about 0.5 to about 0.9 and took `fallback` mass to near zero.
- **The fit clause has one shape, and code writes it.** `questions/fits.ts` is the only place a fit sentence is built, and it builds exactly one form — `Fits when health is low or critical; when recent damage is heavy.` — where the field names and the levels are the closed vocabulary of 010 and nothing else. The shape is canonical so that it can be read back: `fitPairs` parses a finished description, and the grounding test asserts against the requests the Director actually makes that every field named is a field that request's state carries and every level is one that field can take. A clause typed at a call site would pass unread; one built here cannot.
- **Some field must be covered end to end.** Two options that fit a release room and a peak room leave every build room matching neither, and the mass goes to `fallback` — which is what `mood_temperature` did, at 0.30 escape mass on the live model. Across a question's options, taken over the full unfiltered set, the levels of at least one field must all appear. Code-filtered subsets may be partial: an elite room cannot choose a single wave, a room offers only the entries its spawn groups support, and those options were removed for reasons Jev does not get a vote on.
- **One condition per option, never a conjunction.** Jev cannot carry two conditions through one match. Options whose fit was a disjunction of four label combinations ("fits health full or ok with fast or normal clears") matched nothing: `elite_portal` answered `none` for eighteen of twenty rooms whose state said health full, clears fast and no recent damage. An option that needs two conditions is an option whose two halves should have been two options.
- **No two options may read alike.** Four floor hazards described from their shared tags produced four near-identical sentences, and the slot questions came back at about 0.2 confidence while the slot with a shorter list came back at 0.99. Each option says the thing that is different about it.
- **Frequency is code.** "Rarely", "about one room in eight", "not twice running" and "once a run" are counts, which Jev does not keep; the cap lives in the option filter (`portalChoices`) and the question asks only whether the option fits now. The vendors are the worked example: the merchant, the blacksmith and the fountain are options of `portal_need`, and every rule about *how often* any of them may appear — one fountain a run, one vendor room, two vendor offers, only inside a window of rooms, never as the only portal, never straight after another room with no fight in it — is applied by removing the option before the question is built. What is left for Jev is the one thing it can answer from a state: whether a room with no fight in it fits this run right now, and which one. The fountain's option is grounded in `health` and `recent_damage`, the vendors' in `gold`, `run_progress` and `build_gaps`, so the question partitions health as well as gold and no state falls through to `fallback`.
- **Variety is code too, and so is a rate floor.** The same rule, from the other side. Where an answer should differ from the *last* one, code multiplies the previous answer down before the draw (`LOOK_REPEAT_PENALTY` for the four look questions and the anchor, `CARD_REPEAT_PENALTY` for a card already shown this run); where an option must appear at *some* rate, code puts it on the list (`GOLD_FLOOR_ROOMS`, `DOOR_STREAK_CAP` from the other end). Every one of these was tried as prose first and every one of them failed the same way: a sentence asking for variety is a sentence about the option it names, and it raises that option (finding 5a in `docs/research/jev-findings.md`). The cap was measured again with the prose *gone* — a neutral briefing, no streak counts, nothing on the options about a repeated badge, no variety paragraph in the brief — and over eight seeds and 120 offers the affix badge reached **ten consecutive offers**, spell seven and stat six. Removing the sentences stopped them raising the option; it did not make the classifier vary. A bound of this kind also has to hold for *every* option that trips it: two reward kinds streak together more often than not, and a cap that withheld only the first of them let the second run past it.
- **An option's length is a weight — and shortening it is not a fix.** The option with the longest case and the narrowest negative tends to be the one every state falls into, findings 1 and 2 in their commonest form: measured over eight seeds, `elite_presence` `none` 83%, `subspecies_weight` `none` 66%, `size` `standard` 88% with `compact` at 0%, `next_tension` `build` 85% with `release` at 1%, and in each the modal option's `what` argued its own case for three clauses (`none` "is the only room where what the player has learnt this run is simply true", `build` "the pitch most rooms sit at") against one narrow clause of what it was wrong for. Taking the argument out is right — an option may not make its own case — but it is not a lever: applied to all four, `elite_presence` improved by seven points, `density` by eleven, and `size` and `subspecies_weight` got **worse**, to 100% one answer (finding 26). Where the state gives a question nothing to go on, a shorter safe option is still the safe option. Those two are reverted and the rate they need is code's.
- **Nothing in the state is emphatic.** History is stated as plain counts and plain per-room lines — never "every", "never", "most", "again", "room after room", and never a sentence built round one option. A controlled test moved an option from 3% to 44% on the same four rooms of history, phrasing alone. `briefing.test.ts` sweeps the generated state for those words.
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
| room plan, two rounds, per portal offered (round 1 carries the tension, the portals and the cards) | up to 84, about 69 at the portal-count weights |
| vendor room: portals and every shelf, one request | up to 3 |
| Total | about 71, at most 87 |

**A room is two requests, not three.** The next room's intensity used to be a
request of its own, made as the player left the previous room so the portals
could be labelled with it — up to fifteen a run, and a third sequential call
before every fight. It reads exactly the state round 1 already carries and no
room question may read its answer, so it is a question *in* round 1 (004), and
the pacing envelope around it stays code. `planDoors` now makes no request at
all.

Speculative plans for the portals not taken are about 60% of the room plans; that is the price of planning after the reward is taken and still never making the player wait (003).

**Measured on the live model**, a reference run that reached the boss made **29 requests — fourteen rooms at two each, plus the merchant's — and 161k input tokens**, USD 0.0068 at USD 0.042 per 1M, with no fallback. The same run before the merge made about 43. The worst case, every portal planned speculatively, is about 87 requests and 191k tokens, USD 0.008: under the 001 target.
