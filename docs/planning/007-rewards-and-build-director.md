---
id: 007
title: Rewards and Build Director
status: proposed
date: 2026-09-21
summary: Intent at run start (a build style and free text), revealed preference and the staff written out key by key feed one card request per offer. Card selection is the Director's main job and the part that is genuinely semantic, so the two questions that shape an offer carry the Director's brief — the standing rules of roguelike reward design, as words rather than as code rules. `build_shape` says how complete the build is, each reward kind owns one of its levels, and `spell_levels`, `affix_slots_open` and `casts_per_bar` say what the staff still has room for. The door has already fixed the reward kind, so Jev judges each of that kind's legal cards on its own — one Noul per card, "does this card belong on this screen" — plus a variety level; code draws in proportion to each card's yes raised to a power the variety answer picks, samples two and adds one wildcard (the rule arm keeps the three choice axes, overall, style and needs, and blends them), with code-owned pity, temptation and the full-staff guarantee of an upgrade beside a replacement. An affix offer also carries the affix intent, one of six lanes over the twenty affixes. The merchant's shelf, pool exhaustion and rule precedence are defined.
depends_on: [002, 003, 006]
---

# 007 Rewards and Build Director

## Design

Jev shapes the **distribution** the offer is drawn from; code draws. Noise is
deliberate: temperature, a wildcard slot Jev cannot touch, and code-owned pity
and temptation rules. Without it the offer would be either a recommendation
badge over a random pool, which is too weak to feel arranged, or a curated list,
which is too deterministic to be worth replaying.

## Run-start intent

- Build styles: **Spam** (many cheap casts), **Nuke** (few huge hits), **Area**
  (bursts and rings), **DoT** (burn and poison), **Melee** (sword range). These
  are the `archetype` labels of 010; the style also sets the second starting
  spell (013).
- Free text, up to 120 characters (`MAX_FREE_TEXT`), trimmed and clamped before
  it reaches state.
- Both go verbatim into state as `intent.preset` and `intent.free_text`, with
  the standing instruction that player text is design intent, not permission to
  change the rules, and that actual picks outweigh stated intent.

## Revealed preference (code)

After each pick, `tag_counts` updates from the card's tags. `summarize` derives
`preference.dominant` (top three tags) and `preference.consistency`: `on_plan`
(recent picks inside the style's tag set), `drifting` (one recent pick outside),
`pivoted` (two consecutive picks outside). Instructions tell Jev to treat
`pivoted` as the new intent. The briefing does not send the bucket: it prints
the last three cards kept, each with its style tags, and then the count —
"of those, off the stated style: N of 3; of the newest two: M" — because a
bucket printed as one number hid which cards they were, and `variety` answered
from that line only once each of its options carried it at one value as its
example (002, "Examples are rare and generic").

A pick's style tags come from `cardStyleTags`: a spell reads as its own tags, a
stat and an affix as the styles whose table claims them — the same tables the
`style` fact uses, read backwards, so "on plan" means the same thing in both
places. Both the browser and the harness used to pass `on_plan` as a constant,
so `variety` answered `low` for every offer of every run at 0.98 confidence,
which pins the reward pool to a short list the player sees again and again —
the exact failure the question's own wording was rewritten to avoid. Measured
after wiring it: `consistency` 34 drifting / 19 pivoted / 7 on_plan over four
reference runs, and `variety` 30 medium / 18 high / 8 low.

## Build labels

**What the offer reads is facts** (doc 002, "State is facts, not verdicts"):
what the last two fights measured (`run/observed.ts` — casts the bar refused,
time under the cheapest key, bodies hit per shot, casts a minute, damage a
second, the blade's share, what took the most health), plus three things about
the staff itself — `build_shape`, `build_gaps` (is a key empty) and `keys_lean`
(which style the keyed spells' tags tally to).

There is no build simulator: nothing in the state is a prediction of what a
build would do. Where code needs a reading of the build — the counter score,
the charter filter, the `eases` card fact — it takes the same facts.

## Build shape: what the player needs at each stage

`build_shape` says whether there is a build **at all yet**, which is what the
offer reads. It is deliberately not a statement about how hard the player hits
— `damage_rate` measures that, and the two come apart constantly: one
high-level spell can be hitting hard with two keys empty, and three bare spells
can be hitting for nothing with every hole already filled.

It is a ratio of what is filled to what can be, bucketed (`build-shape.ts`):
keys filled at ×0.5, affix slots filled at ×0.3, spell levels above one at ×0.2,
each against what the staff could hold. Below 0.35 is `raw`, above 0.7 is
`formed`, between them `forming`. No number reaches Jev.

**The rule every roguelike this one learns from shares: the less complete the
build, the more the offer should be the things that let it take shape.** Slay
the Spire front-loads commons and card draw and offsets rarity against bad
luck; Hades' early boons are the ones that define a run, and its duo boons only
exist once two gods are held; Dead Cells' early drops are mutations and weapons
rather than scrap; Risk of Rain's white items are what an early loop is made
of; Isaac's early rooms pay in item pools, not coins; Gungeon's early chests are
guns. Gold and generic stats are the late-run currency in all of them, because
both only pay off through a build that already exists.

So each stage has a thing it needs, and each reward kind owns one stage:

| Shape | What the player has | What they need | The door that gives it |
|---|---|---|---|
| `raw` | Empty keys; almost nothing is doing work | A castable, to have a build to shape | **spell** |
| `forming` | Keys full and bare | Events on the spells held — the affix slots that turn three spells into a build | **affix** |
| `formed` | Nothing left to fill | More of what is already there, and the choice of *which* | **stat**, **gold** |

### Grounding the doors in it

Every kind's option (`KIND_CLAUSE`, used by `portal_need`) owns **one level of
`build_shape` and nothing else**, plus one second clause naming a field no
other kind names:

| Kind | Primary | Second | What the staff still has room for |
|---|---|---|---|
| spell | `build_shape` is raw | `build_gaps` is some | `spell_levels` is all_base |
| affix | `build_shape` is forming | `hits_per_shot` is few | `affix_slots_open` is few or many |
| stat | `build_shape` is formed | `health` is low or critical | `casts_per_bar` is few; `mana_stats_taken` is none |
| gold | `gold` is poor | `run_progress` is mid or late | — |

The third column is the half the question was missing. `build_shape` is a
*ratio*, so it sits at `forming` for most of a run: once the keys fill and the
affix slots start opening, the affix door's primary clause holds room after room
after room, and it won essentially every offer — reported from play as "you just
close your eyes and pick affix". The staff's own facts break the tie honestly:
a staff with no slot left has nothing an affix can go on, a staff whose levels
have never moved is one a spell door raises, and a bar that buys few casts with
no mana stat ever taken is a build that is about to stop working.

Each kind also carries the run's own history, as **"not this one"** clauses over
`door_offered_running` and `door_skipped_most` (002, "Not this one, in the
canonical clause shape"). A badge on every one of the last three offers loses
one matching clause that the other three keep; a badge the player keeps walking
past loses another. Nothing is filtered and no die is rolled — a player who
genuinely still needs affixes still gets them.

The rooms with no fight in them are options of the same question and are
grounded the same way (`NPC_CLAUSE`): the merchant on `build_shape` raw or
forming and gold in hand, the blacksmith on gold and late progress, the
fountain on health and what took it.

**The same arithmetic applies to a question's instruction**, which is read
before the options: a sentence that argues one option's case decides the
question before Jev reaches the list. `stat_family` was given two clauses about
levels raising mana costs and answered `mana` in 95% of rooms, including rooms
whose bar had measured `little` time short. The facts were right; putting them
in the instruction rather than on the option that owns them was not. An
instruction names every option's subject evenly, or it names none of them.

Options competing over a shared pile of conditions make a question whose answer
is decided by how many conditions each option happens to carry, not by the
state. Measured before this: the reward behind an elite portal came back `stat`
at 99%, `spell` at 1.3%, `affix` and `gold` at nothing, because `stat` claimed
a mana bar that read tight in nine rooms of ten and `affix` claimed a build
with no gaps, which never occurred. Both of those were verdicts rather than
facts; they are gone (doc 002, "State is facts, not verdicts").

### The spell door to a full staff: both rewards, and one of each

With every key taken a spell card splits into two different rewards. A **copy**
of a held spell raises its level, which costs nothing to accept. A **new** spell
opens the replace prompt, which costs the player one they chose.

Both are real, and the offer holds both. It used to hold only the first, on the
reasoning that a replacement is a cost rather than a reward — but a run whose
keys filled with the first three spells it was shown is a run that can never
change its mind, and "I would swap Magic Bolt for that" is one of the genuine
decisions a roguelike staff offers. So a full staff sees every held spell that
can still be raised **and** the new spells that could replace one, and the
Director judges between them against the build written out key by key
(`held_spells`): a bare level-1 Magic Bolt beside a level-5 Void Orb is a
replacement candidate, the same staff after three levels is not.

Code's only rule here is the safety bound, `CardPool.guarantee`: where both
sorts exist and the offer has room, **at least one of each appears**. Three
upgrades is "which of your spells gets better", three new spells is "which of
your spells do you throw away", and the question the player actually has is
which of those two they want at all. Which way the offer *leans* is the
Director's; a card filled in to keep the guarantee is recorded with origin
`guaranteed`.

This is also where spell **levels** come from in the ordinary run. Measured
before it, a route review showed Magic Bolt at level 1 for fourteen rooms and
the first raise arriving at the blacksmith in room 15 — the spell door was an
upgrade door only after the keys filled, the reference player took the affix
door whenever one appeared, and the smith was never entered. Three things had to
change together: the offer (here), the `spell` kind's grounding on
`spell_levels` being `all_base`, and the reference player, which now takes the
spell door on a full staff with nothing raised and enters the blacksmith when it
can afford a level.

### The gold door

Gold is the one reward the player cannot use in the room they win it in, so it
has to pay for the wait. It scattered eight coins — 24 gold — against a merchant
who sells a stat for 20, an affix for 30 and a spell for 45; taking it cost a
card and bought less than the cheapest thing on the shelf, and it was correctly
the door players liked least. It is `GOLD_ROOM_COINS` = 16 coins, 48 gold, which
buys the priciest thing the merchant sells with change, and a graded gold door
pays its grade over.

That only means anything alongside somewhere to spend it, which is why the
vendors moved with it (003, "The early economy").

**And it needs a floor, because the Director never asks for it.** Measured
over five runs of about a hundred rooms each, `portal_need` ranked gold first
zero times — before and after the state spelled out the purse, the merchant's
prices and what the two together would buy.

Measured again on eight seeds and 104 offers with every argument for gold
taken out of the request — the option no longer prices the purse against the
shelf, the glossary no longer calls a purse "the priciest thing the merchant
sells with change", and the state says what the purse buys once instead of
twice — gold's share of the *probability mass* was 1.7% with under 25 gold in
hand, 3.3% between 25 and 49, 2.4% between 50 and 94 and 2.6% above that. It
does not read the purse, in either direction. The same ranking reads the build
sharply on the same calls: raw 88% spell, forming 54% affix, formed 43% stat.
That is not a fault in the state:
gold is the one option that is never the answer to "what does this build need
now", because what it buys is a decision made later. So its rate is code's
(002, "frequency is code"): `GOLD_FLOOR_ROOMS` puts gold on the list when it
has been off the last five offers. Five is about a third of the fights —
often enough that the shelf at the stop is affordable and that a player who
wants none of stat, spell and affix has an out, rare enough that the run is
not paid in a currency with one place to spend it.

## The Director's brief

Most of what Jev is asked in this game is a parameter: how dense, how bright,
which variant. Those are choices, and Jev makes them well, but a weight table
could make them too — which invites the fair question of whether the model is
being used for its own sake.

**Card selection is the part that is genuinely semantic**, and it is where the
Director's judgement should be spent. Choosing between thirty spell
descriptions, twenty affix descriptions or twelve stat descriptions,
weighed against a staff written out key by key and against a sentence the
player typed in their own words, is reading and judging fit. No weight table
reads "Shock Arc, level 5, storm school, no element, dear to cast, carries rime,
harvest and blight, no affix slot left" and concludes that a fourth affix is
worth nothing here; a table can only be *told* that, one rule at a time, by
someone who thought of the case first.

So the two questions that shape an offer — `portal_need` and `overall` — carry
`DIRECTOR_BRIEF`: the standing principles of roguelike reward design, written as
words Jev can match rather than as rules code applies. They are principles and
not rules on purpose — a rule about *this* state belongs in the state as a fact,
and a rule code could apply belongs in code or nowhere. Every clause is
something the genre does deliberately and this game was not doing:

- **Vary what you offer.** Hades never shows the same god three chambers
  running; Slay the Spire's map alternates elites, shops and campfires; Isaac
  rotates room types. Measured here before the run-history facts existed, the
  affix badge was on nearly every offer once the slots opened, and the player
  stopped choosing at all. The clause names the counts the briefing carries —
  offers running per badge, offered against walked through — and says that
  nothing in code holds the variety, which is true of everything except the
  last-resort streak cap 003 keeps.
- **Help an unformed build take shape first**, before anything that only pays
  off through a build (the rule the `build_shape` table above states).
- **Alternate the safe answer and the greedy one.** Hades' chamber rewards,
  Dead Cells' cursed chests, Balatro's blind skips: a run is a rhythm of
  banking and betting, and two greedy offers running is a difficulty spike the
  player did not choose.
- **Reward commitment, never punish it.** Hades pays for stacking one god;
  Balatro pays for committing to a hand type; Slay the Spire's archetype cards
  get better as more are taken. A Director that answers the build's gaps and
  nothing else quietly taxes the player for specialising.
- **Let the player finish something.** Isaac's half-collected transformations
  and Hades' one-boon-short duos are the genre's own complaint about itself. An
  offer that completes a thing already started is worth more than a better card
  that starts a fourth.
- **Leave the run somewhere to go.** A build with every slot full and nothing
  raised has raising left, not widening.
- **A run that has gone wrong can still be saved.** The genre's own account of
  what makes these games fair is the interplay of preparation and adaptation:
  a bad draw is survivable by playing well, and the offer is where the game
  says so. Code owns the clocks — pity, the elite's raised grade, the fountain —
  and the brief is what makes the Director read a struggling run as a reason to
  answer differently rather than as a number it has been handed.

It is a brief and not a rule set: code's job here remains to keep every legal
option on the list (002). Where a clause needs a fact to bite on, that fact is
in the state — `door_offered_running` for the first, `build_shape` and
`held_spells` for the second, `door_taken_lean` and `keys_lean` for the fourth,
`affix_slots_open` and `spell_levels` for the last.

## The offer: one kind, the door's promise, the Director's pick

Doc 003 fixes the reward kind at the portal, so one offer is three cards of
**one** kind — a spell, an affix or a stat — and the door has already promised a
school, a family and a grade. The questions are asked over that kind's legal
cards, in the room's own request.

- **The pool** (`cardPool`, code): castable spells, the affixes some held spell
  can take, or the twelve stats; owned cards leave it while enough new ones
  remain. The door's promise is a **constraint**, not a weight: a school or
  family with three or more cards *is* the pool; a smaller one is dealt in full
  (`forced`) and the rest of the pool fills the gap.
- **What a card is not for** (`cardNotFor`), from the card's own row in the
  content tables rather than from those facts: a spell's shape or spread and
  then its range tag, element or mana cost; an affix's lane, whose one written
  limit it shares with the two or three others in it; a stat's family. Every
  card carries one, because the offer is the longest option list the Director
  sends and an option with nothing it is wrong for is the one every state falls
  into (002, and finding 2). The old negative was written from the pool's facts
  and landed on almost nothing.
- **Facts per card** (code, `cardNeedsFor` + `cardPool`), one word each, in
  the state as `card_facts`. Every legal card stays in the pool; a fact only
  moves its weight.
  - `style`: it belongs to the build style the player **stated**.
  - `build`: it belongs to the style the keys **actually** lean (the tags
    most common on the held spells) — revealed preference, so a player who
    drifts from what they asked for is followed.
  - `need`: the run is hurt right now — a survival stat, `ward` or `retort`,
    offered while health is low. Health is the one need the offer is not the
    only answer to: the Director can also put a fountain behind a portal
    (003), which is the answer when the bar is the problem rather than the
    build.
  - `eases`: it answers what the last fights measured short (`gapOf`, read
    off the observed labels in this order: few bodies hit per shot, a bar that
    refused or ran under the cheapest key, a slow cast rate, a low damage
    rate) — accuracy (tracking and area spells; `seek`, `chain`, `scatter`;
    the movement family), mana (Barrage spells; the mana family), cast
    frequency (Barrage spells; `haste`, `repeat`, `resonance`; the mana
    family), damage (Heavy and Crowd spells; `brand`, `fork`, `pierce`,
    `kindle`, `blight`, `harvest`; the sword).
  - `synergy`: it works with what is held — a spell of an element the keys
    carry, or the infusion for it (`kindle` for fire, `rime` for ice, `blight`
    for poison).
  - `upgrade`: it raises something held — a spell's level, an affix's tier —
    which is how a build matures rather than widens.
  - `promised`: it is of the school or family the door named.
- **The rule arm's weights** read those facts: `overall` multiplies style 1.4,
  build 1.4, need 2, eases 1.5, synergy 1.3 and upgrade 1.4;
  `for_style` weighs style, build and synergy; `for_needs` weighs need,
  eases and upgrade. The Jev arm is asked the same questions over the
  same options and facts and weighs them itself.
- **What a copy is, said on the card.** A copy of a held spell raises that
  key's level and fills no key, and the offer says so twice: once for the
  whole screen ("Keys empty now: 2 and 3. A new spell taken from this offer
  goes on key 2; a copy leaves keys 2 and 3 empty") and once on the copy's own
  option. With only the `upgrade` flag, Jev put the starter's copy first on
  nineteen early screens of twenty and runs held one key into room 4; with
  the empty keys in view it still often prefers the level, which is its
  reading to make, but now made with the empty keys in front of it.
- **The build, written out.** `held_spells` puts one line per key into the
  state — name, level, school, how it is delivered, element, cost band (by
  casts a full bar buys), what is attached, how many slots are free — beside the five labels of `run/build-facts.ts`. This is what
  makes `overall` a semantic question rather than a fact lookup: the candidate
  descriptions and the build description are both prose, and the answer is which
  of the first fits the second. It was not sent at all before; the Director was
  choosing cards for a staff it had never been shown.
- **The questions** (Jev): one Noul per candidate, `fit_<id>` — "would this
  card be a good one to show this player on this reward screen?", with the
  card's own description and what it is not for — and `variety`,
  `affix_intent` on an affix offer, and `temptation` on a temptation offer.
  The Director's brief goes once in the state (`director_brief`) rather than
  in every card's question. The three choice axes below asked which card is
  *the* answer; over thirty-nine spells that left the second-best card of a
  style near zero however well it fitted, and half of each style's own spells
  never reached a screen in two runs of it (jev-findings 35).
- **The questions** (the rule arm, and the table any failed Jev request falls
  back to): `overall`, `for_style`, `for_needs`, `variety`,
  `affix_intent` on an affix offer, and `temptation` on a temptation offer. `for_style` and `for_needs` use the
  **short form** of each option description — the name plus one clause — since
  each axis is narrow enough not to need the hint sentences; `overall`
  carries the full description. A card's description is a neutral fact about
  what it does (006, 010); the player's card shows its own, friendlier text.
- **Sampling**: blend, temperature, two sampled, one wildcard — as below. The
  grade the door promised is applied by code (`cardsFor`).
- A gold door shows no cards; it scatters coins instead (003).

The browser and the harness both play offers built this way; the plan page and
the debug panel show each card's origin (sampled, wildcard, pity, temptation,
forced) and which arm answered.

## The affix intent

A spell offer fills a key; an **affix offer is what the build becomes**, and it
is the only offer whose direction the player can state in words. That direction
is one question, `affix_intent`, asked with an affix offer and only with one,
in the same request as the cards it steers.

The options are six **lanes**, disjoint over the twenty affixes, so an answer
names a real set:

| Lane | Affixes | Fits |
|---|---|---|
| `homing` | seek, ricochet | few bodies hit per shot, a run in which the sword has done nothing |
| `cheaper` | haste | a slow cast rate (no affix gives mana back; running dry is the mana family's) |
| `elemental` | kindle, rime, blight | keys leaning, or a stated style of, dot or area |
| `heavier` | fork, pierce, shatter, brand | keys leaning, or a stated style of, nuke; a low damage rate |
| `wider` | scatter, repeat, bloom, chain, harvest | keys leaning, or a stated style of, area or spam; heavy movement pressure |
| `survival` | ward, retort, slipstream, resonance | health low or critical, hurt most by blades, a stated melee style |

**Is the pool too small?** Twenty affixes, and every one of them is reachable:
each fits the shapes its hook fires on (013), `seek` fits only single-shot bolts
and seven fit every shape, and every one of them reaches a reward screen over
a handful of seeded runs. So the answer to "affixes feel like the same
few every time" was not the pool — it was that the affix door was on nearly
every offer, so the head of the blended distribution was seen again and again.
With the door varying, the histogram flattens out.

It is still **thin at the top end**, and worth noting for a content pass: three
keys with three slots each means one run can take nine of the twenty, so a
completed build holds nearly half the game's affixes. Thirty would leave more
between two runs.

The lane is a **weight, not a filter**: every legal affix stays in the pool, as
every other card does, and the chosen lane's cards are multiplied by
`AFFIX_INTENT_WEIGHT` in the blended distribution before temperature. A player
who asks to freeze things still sees the rest of the game; they simply see ice
more often than they would have.

Code applies the lane on both arms, so the arms differ in exactly one thing:
which lane was chosen. The plan records it as `CardPlan.affix_intent`.

### The player's own words

`intent.free_text` is the one Director input the player writes themselves, and
this is the question it bears on most. "I want to freeze things and shatter
them" has to produce ice affixes, or the field is decoration.

- **Jev** reads the sentence directly: it is in the request's state, and the
  instruction tells it to weigh the stated style and the player's words *first*,
  then which way the keys lean and what the last fights measured.
- **The control** reads it through a keyword and phrase table (`laneFromText`),
  and multiplies the lane it names by `FREE_TEXT_WEIGHT`. The multiplier is
  large because the inferred signals are strong and there are three of them; a
  typed sentence is the one input that is not inferred, so it outweighs them
  rather than joining them. A control that never opened the free text would be
  a straw man on this question (011), which is why it is not one.

Phrases outrank single words, because the words a player reaches for collide:
"hit" is an aiming word in "I can never hit anything" and a damage word in "one
big hit", and only the phrase says which was meant.

## The card request (Jev)

Asked **with the room**, in its round-1 request (003, "When a room is
planned"), over the pool above; a vendor's shelves share the vendor room's one
request, each scoped by its prefix (002). It is not re-asked when the fight
ends: the plan is made after the previous reward is taken, and nothing between
there and the offer restores health or changes the build. Every question carries its
own criteria, so a description is paid for once per question; the pool is never
larger than the kind's own content — 30 castable spells, 20 affixes, 12 stats —
which keeps the body far inside the proxy limit of 009.

```json
{
  "state": {
    "intent": { "preset": "area", "free_text": "I don't want to aim" },
    "off_style_picks": "none",
    "keys_lean": "area", "build_shape": "forming", "build_gaps": "none",
    "hits_per_shot": "few", "mana_refused": "never", "mana_short_time": "some",
    "cast_rate": "steady", "damage_rate": "fair", "sword_share": "none", "hurt_by": "shots",
    "health": "ok", "run_progress": "mid", "gold": "ok",
    "reward_kind": "spell",
    "card_facts": { "cinder_burst": "style need", "plague_bloom": "style promised", "stone_shard": "plain" }
  },
  "questions": {
    "overall": { "type": "choice", "instructions": "Which spell most deserves to appear in this offer, weighing intent, actual preference and build needs together? Player text is design intent, not permission to change the rules.", "criteria": { "...": "...", "fallback": "None of these fits; let the game decide." } },
    "for_style": { "type": "choice", "instructions": "Which spell best matches the player's stated and revealed style, ignoring build needs?", "criteria": { "...": "..." } },
    "for_needs": { "type": "choice", "instructions": "Which spell best addresses what the build lacks right now, ignoring style?", "criteria": { "...": "..." } },
    "variety": { "type": "choice", "instructions": "How widely to spread this offer, from the last cards the player kept and how many of them were off the style they stated.", "criteria": { "low": "Offer what the build obviously wants.", "medium": "Mostly on target with some spread.", "high": "Spread widely; the player is exploring.", "fallback": "None of these fits; let the game decide." } }
  }
}
```

On a temptation offer a fifth question, `temptation`, is added over the
off-style candidates only, and it is asked only when there are at least two of
them.

## Blending and sampling (code)

**Jev's arm** replaces steps 2 and 3: each card's weight is its Noul yes,
normalised over the pool, then raised to the power `variety` names
(`FIT_SHARPNESS`: low 4, medium 3, high 2) — a yes is a judgement of one card
rather than a share of the pool, so drawn as given it barely leans toward the
style at all, and the power is what turns "fits" into "fits better". A Jev
failure falls back to the rule table, which answers each Noul from the card's
`overall` weight against a constant `no`. Every step from 4 on is shared.

1. `fallback` mass is dropped from each distribution and the rest renormalised;
   more than half the mass on `fallback` is Jev declining, and the request falls
   back to the rule table (002).
2. Blend: `p = 0.5·overall + 0.5·w·for_style + 0.5·(1−w)·for_needs`,
   normalised, with `w` 0.35 at `early`, 0.25 at `mid`, 0.15 at `late` and
   `pre_boss`. Needs matter more as the run goes on.
3. Temperature from `variety`: low 0.4, medium 0.7, high 1.0.
4. **Novelty**: each card the run has already put on a reward screen keeps
   `CARD_REPEAT_PENALTY` of its mass per showing, down to `CARD_REPEAT_FLOOR`.
   Applied after the temperature, so the variety answer decides how sharply
   the *fit* is read and this decides what a repeat costs.
5. Sample **2 cards** without replacement from `rng("reward", room_index)`.
6. **1 wildcard** uniformly from the remaining pool with
   `rng("wildcard", room_index)`.
7. If every card drawn is one the run has shown before and the pool holds one
   it has not, the **last** slot gives way to the highest-blended unshown card.
   The top pick is never touched; this is the tail, as the guarantee is.
8. Record the ids, each card's origin, the blended distribution and every
   decision in the trace (011).

A one-card shelf skips the wildcard and is sampled outright.

Steps 4 and 7 are there because "the spells and affixes feel like the same
ones over and over" is a claim about a *sequence*, and Jev answers states: the
build that makes a card fit in room 5 is the same build in room 6, so a fit
ranking alone lands in the same corner of the pool every time. Measured over
eight seeds before them, a run saw 8.4 of the 20 affixes and 9.0 of the 25
spells, with the five commonest taking about three quarters of its slots. The
fit stays Jev's; only the spread is code's (002, "variety is code").

## Pity and temptation

Both are triggered by code; Jev only chooses *which* when a choice exists.

- **Pity**: when three offers running have held no `need` card, the wildcard
  slot goes to the highest-blended `need` card. Code picks; there is no
  question.
- **Temptation**: every fourth offer, the wildcard slot goes to an off-style
  card sampled from the `temptation` distribution. With fewer than two off-style
  candidates the question is not asked and code takes the one that exists.

Pity takes precedence over temptation when both trigger.

## Pool exhaustion

- Fewer than three eligible cards: the offer is what exists, every card
  `sampled`, no question asked.
- No `need` card left in the pool: pity does not fire and the slot reverts to a
  uniform wildcard.

## The merchant and the blacksmith

The merchant stocks **one card of each of stat, affix and spell**, each a
one-card `planCards` over that kind's pool with its own salt, and prices them 20,
30 and 45 gold. The blacksmith raises one spell's level, 35 gold to level 2 and
60 to level 3. Both are bought outright; there is no reroll, and gold cards do
not appear on the shelf.

The merchant is the one place the player **chooses** what they get rather than
choosing between what they are given, which is worth most to a build that has
not taken shape — so its option in `portal_need` is grounded on `build_shape`
being raw or forming, and it is ranked against the rewards rather than against
an escape option, so it takes a door only by outranking one. The caps are
code's, and they are tight: the window `NPC_FIRST_ROOM` to `NPC_LAST_ROOM`,
`NPC_ROOMS_MAX` vendor rooms entered, and `NPC_OFFERS_MAX` vendor portals
**offered**, met or declined. The last of those exists because a live Jev run
without it put the merchant on the portal list in nine rooms of sixteen, and
the tightening because a played run met a vendor three times and read as the
game pushing the player to spend. A vendor badge is rarer on the offer than a
gold one.

## Affix compatibility is a constraint, not a preference

An affix names the spell shapes it works on, and two further rules decide
whether it can attach: a spread does not home (so `seek` is dead on a spell that
throws several projectiles, and dead beside `scatter`), and a key with three
affixes takes only a **duplicate** of one it holds. A card the player cannot
attach anywhere is a lie told in the reward screen.

The offer filter used to read the shape alone, which cannot see the other two —
reported from play as a scatter-shot build being offered Seek over and over.
`fittingAffixes` now applies exactly the rule the reward screen will apply
(`affixFitsHeld`), and every pair of a real spell and a real affix is checked
against it in a test, so a new spell or a new affix that opens a dead
combination fails the build rather than reaching a player.



## Fallback and the control

Per the fallback contract (002), a card decision that Jev does not deliver is
produced by the rule table, never by the random one.

The rule arm builds the same distributions from a hand-tuned weight table read
off the same facts: on `overall`, a `need` card doubles and a `style` card is
×1.6; on its own axis each is ×3; on `temptation` a `need` card is ×1.5. On
`affix_intent` it weighs bodies hit per shot, the mana facts, which way the
keys lean and the stated style, and multiplies the lane the player's typed
words name.
`variety` is mapped from `preference.consistency` — `pivoted` weights `high`
×3, `on_plan` weights `low` ×2. Blending, sampling, wildcard, pity and
temptation are identical, so `jev` and `rule` differ in exactly one thing: where
the distribution came from.

The random arm uses flat weights, ignores every label, and is the experimental
floor only.
