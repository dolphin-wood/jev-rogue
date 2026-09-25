---
id: 010
title: Content Ontology and Description Generation
status: proposed
date: 2026-09-21
summary: One closed vocabulary shared by summarizers, content tags, option descriptions and instructions. Common schema fields for every content entry. Descriptions are neutral facts — what a thing does, never who it suits or how it ranks — and a generator appends state-dependent sentences from templates, so Jev always sees the basis for a decision in the same words the state uses. Versioned for traces.
depends_on: [002, 004, 005, 006, 007]
---

# 010 Content Ontology and Description Generation

## Why

Jev sees only words. json-render put every fact Jev needed into candidate descriptions, down to the numbers. Here the words in `state` and the words in option descriptions must be the same closed vocabulary, or instructions like "prefer options marked matches_tension" have nothing to bind to.

## Summary labels (emitted by summarizers, allowed in state)

| Field | Levels |
|---|---|
| health | critical / low / ok / full |
| recent_damage | none / some / heavy |
| clear_speed | slow / normal / fast |
| movement_pressure_recent | light / heavy |
| run_progress | early / mid / late / pre_boss |
| gold | poor / ok / rich |
| tension | release / build / peak |
| tension_cap | release_only / build_allowed / peak_allowed |
| hazard_cap | none / low / high |
| keys_lean | spam / nuke / area / dot / melee / mixed |
| off_style_picks | none / one / two_running |
| last_tension | release / build / peak / none |
| since_release | just / a_while / long |
| last_room_kind | combat / elite / rest / none |
| damage_trend | rising / steady / falling |
| build_shape | raw / forming / formed |
| build_gaps | some / none |
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
| suitability (per encounter option) | softer_than_tension / matches_tension / harder_than_tension |
| counter_score (per encounter option) | favours / neutral / counters |

Bucketing thresholds live in `summarize.ts`, `build-shape.ts`, `observed.ts`
and `build-facts.ts`, and nowhere else.

`held_spells` is the one state field that is **prose rather than a label**: a
map from each held spell's id to a sentence saying its level, school, how it
is delivered (a bolt banked while the key rests, one charged while it is held),
element, cost band — cheap, moderate or dear by how many casts a full bar buys
— attached affixes and free slots. It is the same shape as
`card_facts`, and it exists for the same reason — the card questions ask which
of several descriptions fits a build, and the build has to be describable for
that to be a question. No number reaches Jev in it: the level is "level 3 of 5",
the cost is a band (`costBand`), and the free slots are counted in words.

### Facts, not verdicts

Every label above is a **quantity that was measured, with its buckets named for
what was measured**. Nothing in the state is code's classification of the
player, a simulated figure, or a judgement over several inputs: no
"bottleneck", no "mana sustain", no "build power", no "archetype". Classifying
the build is Jev's job, done through the questions; the table below is what it
is given to classify *from*. There is no build simulator in the game: what a
build does is measured in the fights it plays.

### The audit

Every label the Director is sent, classified: **(a)** a direct observation of
play, bucketed; **(b)** a simulated or predicted value; **(c)** a composite
judgement over several inputs. Nothing in class (b) or (c) is sent any more.

| Label | Class | Measured | Replaced by |
|---|---|---|---|
| `health` | a | hearts ÷ max | — |
| `recent_damage` | a | hearts lost over the last two rooms | — |
| `clear_speed` | a | the last room's length ÷ this player's own recent median, inside a band round the human curve | — |
| `movement_pressure_recent` | a | share of the last room with an enemy bullet within 90 px | was a constant `0.5` in both writers |
| `run_progress` | a | room index over the fourteen-fight run | was bucketing the retired nine-room shape |
| `gold` | a | gold held | — |
| `tension_cap`, `hazard_cap` | a | pacing rules over the run's history — constraints, not judgements | — |
| `last_tension`, `since_release`, `last_room_kind`, `damage_trend` | a | the run's own history, one label each | — |
| `build_shape` | a | keys filled, affix slots filled, spell levels, weighted | — |
| `build_gaps` | a | is any key empty | was "any of six required roles unfilled", true in every room |
| `keys_lean` | a | tally of the style tags on the keyed spells | — |
| `off_style_picks` | a | picks outside the stated style in the last three | `consistency`, a verdict, and hard-coded `on_plan` |
| `dominant_tags`, `held_schools` | a | tags and schools of what is held | — |
| `intent_preset`, `typed_intent`, `intent.free_text` | a | what the player said | — |
| `zones`, `spawn_groups`, `open_ratio_label`, `cover_label`, `last_shapes`, `room_type`, `portal_count`, `tension` | a | the room that exists | — |
| `mana_refused`, `mana_short_time` | a | see below | — |
| `hits_per_shot`, `cast_rate`, `damage_rate`, `sword_share`, `hurt_by` | a | see below | — |

`card_facts` is code's own weight on a *card* — "this one eases what the last
rooms were shortest of" — and what was shortest is read off the observations
(`gapOf`).

### The observed labels, and where their cut points came from

Measured on the skill profiles (`pnpm play rule 3 <profile>`), per fight, over
the last two fights. The cuts sit between the profiles rather than around the
expert, because a scale calibrated on the model puts every human in one bucket.

| Label | Measured | novice / average / expert | Cuts |
|---|---|---|---|
| `mana_refused` | ready presses the bar refused ÷ presses of a key holding a spell | 0 / 0 / 0 | 0.05, 0.16 |
| `mana_short_time` | time under the **cheapest key's cost** ÷ fight time | 0.00 / 0.00 / 0.54 | 0.2, 0.5 |
| `hits_per_shot` | bodies struck ÷ projectiles fired (can exceed one) | 1.00 / 1.00 / 0.79 | 0.5, 1.0 |
| `cast_rate` | casts a minute | 7 / 40 / 100 | 15, 60 |
| `damage_rate` | damage a second | 3.5 / 20 / 25 | 12, 26 |
| `sword_share` | blade damage ÷ damage dealt | 0.71 / 0.41 / 0.27 | 0.15, 0.55 |
| `hurt_by` | the family that took the most health | — | the largest of three |

`mana_refused` reads `never` for every profile and every room, and that is the
finding rather than a fault: **mana does not stop anybody.** The bar also almost never
*empties* — it sits in single figures and refuses because what is left will not
pay for the key — so both mana facts are measured against **the key's cost**,
never against zero.

## Content tags

| Dimension | Values | Used by |
|---|---|---|
| role | attack, control, tracking | items |
| range | short, mid, long | items, enemies |
| element | fire, poison, ice, none | items, enemies |
| archetype | spam, nuke, area, dot, melee | items, presets, intent styles |
| pressure_kind | movement_pressure, ranged_pressure, melee_heavy, ranged_heavy, area_denial | encounters, features |
| hazard | hazard, slow_zone, damage_zone, cover, utility | features |
| rarity | common, uncommon, rare | items |

`keys_lean` adds `mixed` as a summarizer-only level; no item is tagged `mixed`.

## Common schema fields

```ts
interface ContentBase {
  id: string;                  // snake_case, unique across libraries
  tags: string[];              // from the vocabulary
  description: string;         // static sentence(s), present tense
  jev_hints?: { favor_when?: Label[]; avoid_when?: Label[] };   // bare field labels from the table above, e.g. "health:low"
  resource?: string;           // mutual exclusivity group
  numeric_ok?: boolean;        // allows digits in description (e.g. "+1 projectile")
}
```

`jev_hints` never reach Jev as fields; the generator turns them into sentences.

## Description rules

A description is a **neutral fact**: what the thing does, in the words the
state uses. It is the option's `what`, and a Director that reads a verdict in
it is being told the answer to the question it is asked (002, 006).

1. Name and effect in one clause; a second clause only for another effect.
2. No verdicts: not who it suits ("suits a spam build"), not how it ranks
   against the pool ("hits harder than any other common attack"), not whether
   it is good ("powerful", "reliable"). What a thing is *not* for goes in its
   `not_for`, as an objective situation.
3. Digits only when the number is the decision and `numeric_ok` is set.
4. Static part under 220 characters.

## Description generator

`describe(entry, ctx) → string` joins:

1. The static `description`.
2. **State sentences** for each `jev_hints` label that matches the current labels, from templates in `director/describe.ts`: `favor_when bottleneck:accuracy` → "Directly addresses the current accuracy bottleneck." Hints use the bare field name; the matcher flattens the state to both the nested path and the bare name, so a hint author never needs to know where a label sits in the state object.
3. For encounter options, the **suitability** word from 005 appended as a sentence.

The state sentences are a table, one per label reference, in `director/describe.ts`. Suitability sentences are composed from the label words themselves, so a new level needs no new template. A `short` form drops the hint sentences, for the narrow reward axes (007).

## Fit clauses

Every option Jev is offered ends with a **fit clause**, built only by
`director/questions/fits.ts`, in one canonical form:

```
Fits when health is low or critical; when recent damage is heavy.
```

The field names are the summary labels above and the levels are theirs; the
conditions are alternatives, separated by a semicolon so that a value list
inside one condition and the boundary between two conditions are different
marks and the clause can be parsed back. `FIT_FIELDS` holds every field a clause
may name with every level it may take, and a clause naming anything else throws
at build time. The rules a fit clause exists to satisfy, and the failures that
produced them, are in 002 under "Question conventions".

`fitPairs` reads the pairs back out of a finished description, which is what
lets `questions/grounding.test.ts` check, over the requests the Director really
makes, that no option names a label its request does not carry.

## Option specs

A fit clause is a claim about the label state, so it goes with the label state.
The other state format (002) sends the run written out, and there every option
is instead an **option spec** (`questions/specs.ts`), the object form the choice
API takes:

| Field | What goes in it |
|---|---|
| `what` | What the option is, in the same plain words the briefing uses. |
| `not_for` | The case where it is the wrong answer even though the state might look like it fits. Every option has one. |
| `examples` | One generic line the briefing actually prints — only where two options are easy to confuse. |

Two things a clause could not carry: a negative, which is the most useful thing
to say about most options and which the clause form could only reach sideways
by naming every value of a field but one; and room for the design intent to sit
in the instructions, where a rule about the offer belongs rather than repeated
on every option so that every option argues.

**The negative is not optional, and an option generated from a content table
gets one too.** A space archetype, a zone feature and a variant body were each
sent as the table's own sentence and nothing else, on the grounds that the
sentence is the whole of what the thing is. It is — and an option with nothing
it is wrong for is the one every state falls into, which those three measured
as: `entry` 88% one answer, the alcove slots 95% one feature, `subspecies` 66%
`none`. Their negatives are generated from the same table: a space's openness,
cover and shape (`spaceSpec`), a feature's tags and hazard budget
(`featureSpec`), a variant's base body and tags (`subspeciesSpec`). A card's is
generated from the facts the pool tagged it with (`cardNotFor`) and only where
the pool tagged it with nothing, or with `upgrade` alone.

**Examples are the exception.** An example says "a state that looks like this is
this option", which is the answer written down; three of them on every option is
the weight table in prose. They are kept where two options are near-mirrors and
one line of state is the whole of what separates them (the vendors, the
composition mirror, the look questions, `variety`), they are written
generically, and `briefing.test.ts` asserts both the list of options that have
one and that each is a line `briefing.ts` emits. An option with no hand-written
spec still falls back to its description with the fit clause stripped
(`unground`).

## The run's recent history

Three labels summarize what the run has just done, so that a question about the
next room can see the shape of the last few (002's state schema). They are
derived in `director/questions/history.ts` rather than in `summarize.ts`,
because they read `RunHistory` — the sequence of rooms and tensions — rather
than the raw player numbers that `summarize.ts` owns.

- `last_tension` — the previous combat room's tension.
- `since_release` — combat rooms since the run last let up: `just` (none or
  one), `a_while` (two or three), `long` (four or more). A release room and any
  non-fight room both count as letting up.
- `last_room_kind` — `combat`, `elite`, or `rest` for treasure, the shop and
  every vendor room (merchant, blacksmith, fountain).

- `damage_trend` — whether the last room that cost anything cost more than the
  one before it, from `RunHistory.hearts_lost`.

`next_tension` is the main reader; the encounter's density and staging and the
elite portal read them too.

Four more say what the **last room looked like** — `last_symmetry`,
`last_mood_temperature`, `last_mood_brightness`, `last_mood_particles` — so the
four look-only questions can alternate. They were each grounded on the same
partition of health, recent damage and clear speed, and came back 91% to 100%
one answer each over three live runs.

Each of those four now names its alternation fact and **exactly one** other
field, and that field has to be one that genuinely moves room to room. For a
question with no subject of its own, every extra field is another chance for a
near-constant to decide it: `room_type` is `combat` for fourteen rooms of
sixteen, and `hazard_cap` is `high` whenever the player is above two hearts.
Each of those, in turn, took its question to 98% and then to 100% of one
answer while the alternation clause sat there unread.

Three more say what the **offer** has been doing, which is the history the
player actually feels:

- `door_offered_running` — the reward kind on the badge for the last three
  offers running (`DOOR_RUN_LENGTH`), or `none` where they varied. Three,
  because with four kinds and three doors any kind appears about three offers
  in four, so two running is a coincidence, and four is a quarter of the run
  spent on one badge before the Director is told.
- `door_taken_lean` — the kind the player walks through most, or `mixed`.
- `door_skipped_most` — the kind offered most and taken least: what they keep
  walking past, which is the half of revealed preference the picks cannot show.

## The staff, as facts

`run/build-facts.ts` turns the held build into five labels and one prose map.
They exist because the offer question is entirely a question about the held
build, and the state said only how *complete* it was:

- `spell_levels` — none / some / most of the keys above level 1.
- `affix_slots_open` — empty slots across the staff, against what it could hold.
- `held_elements` — how many elements the keys carry, infusion affixes included.
- `casts_per_bar` — how many casts a full bar buys, averaged over the keys:
  `many` at six or more, `some` from 3.5, `few` below. Every level a spell gains
  raises its cost by ten per cent (`levelManaMult`) and the bar does not grow on
  its own, so this is the label that says a levelling run is about to stop
  casting — before a fight has to measure a refusal.
- `mana_stats_taken` — mana-family stats taken this run, from
  `RunHistory.stats_taken`.
- `held_spells` — the prose map described above.

## The affix intent

`affix_intent` (007) is a lane over the affix roster rather than a content
entry, so its option text is composed in `director/questions/affixes.ts` from
the lane's affixes and its fit clause. Each lane also carries the **words and
phrases** a player might type for it, which is how the control reads
`intent.free_text`; Jev reads the sentence itself.

## Instructions

All `instructions` strings are templates with label slots, written in the Director's question builders (`questions/*.ts` and `director.ts`). No instruction text is typed where the game asks for a plan. An instruction that names a label is a promise the label is in the state, and the grounding test holds it to that.

## Versioning

`content_hash` (all content JSON), `prompt_hash` (all templates and instructions) and `model` are attached to every trace (011). Any edit to a template changes `prompt_hash`, so metric shifts can be attributed.

## Checks in `pnpm content:check`

- Every tag in the vocabulary; every `jev_hints` label in the summary-label table.
- Description rules 3 and 4 enforced mechanically.
- Every `resource` shared by at least two entries: a group of one cannot express exclusivity.
- Ids lower snake_case and unique both within a library and across all of them.

`missingSentences` reports any hint with no state sentence, so a hint that would silently do nothing fails its test rather than shipping.

## Checks in the Director's grounding test

Run over every request the Director makes on the rule arm, so they cost no Jev call:

- every option carries a fit clause, and every field it names is in that request's state, with a level that field can take;
- at least one field is covered end to end across a question's full option set;
- no two options of a question read alike, and none is empty;
- every question carries the escape option, worded as 002 words it;
- no raw number reaches Jev;
- an instruction names no label the request does not carry.
