# What we learned asking Jev

Findings from tuning the Director against live Jev (TypeSafe's `choice` model),
recorded so the next question is written knowing them. Each entry states what
was observed, the evidence, and what we now do about it. Numbers are from
the route reviews and `pnpm answer-stats` runs on the same 8 seeds at the
`average` skill profile unless noted.

## How Jev answers

Jev reads a `state` and a set of independent questions, and for each question
returns a probability over its options. It is a **classifier**: for one state
it says which option fits. It does not plan across calls, remember earlier
answers, count, compare numbers, or chain inferences; each question is
answered on its own.

## Findings

<a id="finding-0"></a>

### 0. The escape option is how "none of these" can be said at all
Jev always returns a full distribution that sums to 1, so even when every
option is wrong for the state, one of them still comes out on top, and a
sampler would act on it. The only way for the model to say "nothing here
fits" is an option that means exactly that. Every question therefore
carries `fallback` ("None of these fits; let the game decide."), as Jev's
own docs recommend for inputs that may fall outside the option set. When it
wins, the question is logged as **declined** and the rule table answers it.
- A decline is Jev's answer, not a failure: it says the state or the
  options leave it nothing to go on. The first room's look questions
  (options defined only against the room before) were all declined, and
  that pointed straight at the missing history.
- The **decline rate per question** is therefore a diagnostic: a question
  that declines often has options the state cannot ground (e.g.
  `stat_family` at 17% before its specs were fixed).
- A high probability on an ordinary option is not proof it fits: with no
  escape option, the least-wrong answer looks confident. Read the escape
  option's mass as how much the model trusts the list.
- The escape option leaves any ranking (a door cannot be badged "none of
  these"), and code never lets it be the only thing asked.
- **Confidence does not replace it.** Jev's `confidence` is computed from
  how peaked the distribution is: flat is low, one peak is high (its docs
  route answers under 0.3–0.5 to a human). That measures *which of these*
  is ambiguous, not *whether any* fits: with every option wrong, the
  least-wrong one can still peak and read as confident. We saw exactly that
  under label-matching clauses (`stat_family` at 0.54 confidence while 17%
  of its asks went to the escape option). So: the escape option answers
  "none of these"; confidence answers "which of these, and how sure".
  In a game a flat answer between acceptable options is not a problem to
  route away; sampling from it is what gives variety. A confidence floor
  only earns its place on a decision where one wrong pick costs the run.


### 1. An option that fits every state wins every state
A state label that never changes makes every option grounded on it fit
everywhere, and the question is decided by whichever option carries the most
clauses. `mana_sustain` read `tight` in 50 of 56 rooms (it was a prediction
from a simulated cast loop, not play), and the stat door won the portal
question at 99%.
**Now:** state carries measurements of play, bucketed, never predictions or
verdicts; a label that does not move is a bug to find.

### 2. An option with nothing it is wrong for is the sink
With `what` / `not_for` / `examples` options, an option that has no `not_for`
is the one every state falls into: `subspecies: none` 71%, `elite_presence`
81%, `mood_brightness` 81% bright while `dim` had no positive case.
Giving every middle option a `not_for` moved `mood_particles` 96% → 55%.
**Now:** every option, hand-written or generated, carries a `not_for`
written from its own data; a test fails if a hand-written spec lacks one.

### 3. Examples are noise on some questions and the whole mechanism on others
Deleting the two examples from `anchor` (nothing else changed) took it from
`tank` 56% to `none` 99%; one generic example each brought it back to 86%.
`stat_family` did the same. Removing examples *helped* density, waves, entry
and the zone slots.
**Rule:** where options differ by what they *are* (a description), examples
are noise and overfit; where options differ only by *which state line
applies*, an example is how Jev learns the mapping. Keep few, generic ones
there, and only there (`briefing.test.ts` pins the list).

### 4. An instruction that argues for one option decides it
Instructions are read before the options. Two clauses explaining that levels
raise mana costs took `stat_family` to 95% `mana` on states measuring little
mana trouble. A zone instruction saying "`none` is a real answer" argued for
`none`.
**Now:** instructions state principles even-handedly; no sentence makes one
option's case.

<a id="finding-5"></a>

### 5. Asking for variety concentrates the answer
Jev cannot see that it keeps giving the same door: each call is a fresh
classification, and "the affix badge has been on the last 4 offers" is, to a
classifier, one more fact the affix option matches. Measured longest
same-kind door streak: 5 with a code cap, 7 without it, **10** without it
once the streak was stated in the state, a `not_for` about repeated badges
was added to every kind, and the variety principle was put in the brief
(affix share 48% → 60%).
The look questions show the same: replacing the prescriptive line "the next
room should not look the same" with the bare fact raised their mean modal
share 59% → 72%.
**Rule:** variety is a property of a *sequence*; a classifier answers
*states*. Sequence properties belong to code (sampling, soft penalties,
caps), not to wording. `DOOR_STREAK_CAP` stays.

### 5a. Emphatic narration about an option raises it; neutral counts do not
A controlled test: one fixed briefing (an empty key, four open affix slots),
the `portal_need` question with its real specs, one sentence varied, 15
live calls each. Mean probability of `affix`:

| sentence added | affix |
|---|---|
| none | 3% |
| "The player has said they want more affixes." | 78% |
| "The player has said they do not want any more affixes." | 0% |
| "The affix slots, affix tiers and affix cards of the build are the ones listed above." (the word repeated, no new meaning) | 4% |
| "Doors: the affix badge has been on each of the last 4 offers." | 7% |
| "…the affix badge has been on the last 4 offers, and the player walked past it every time." | 16% |
| "…over the last 4 rooms the player walked past the affix door each time it was offered." | 32% |
| "…over the last 4 rooms the player chose the spell or stat door every time, never the affix door." | 44% |
| "Spell doors and stat doors have hardly appeared lately." | 2% (spell rose 81% → 90%) |

So it is not term frequency: repeating the word does nothing, and a stated
wish or refusal is read exactly, negation included. But a **history of the
player's behaviour around an option raises that option**, and the more the
sentence dwells on the option the more it rises, even when the behaviour is
avoiding it. Jev reads "the player keeps not choosing affix" as "affix is
what this is about". "Hardly appeared lately" does not make it compensate
either; it raised the kind it named.
A second run separated the *wording* from the *content*. The same history
as neutral counts moves nothing:

| sentence added | affix |
|---|---|
| none | 3% |
| "Doors taken in the last 4 rooms: spell 2, stat 2." | 3% |
| "Doors taken in the last 4 rooms: spell 2, stat 2, affix 0." | 7% |
| "Doors offered in the last 4 rooms: affix 4, spell 3, stat 3, gold 2. Doors taken: spell 2, stat 2." | 4% |
| the same four rooms as one plain line each ("Room 3: offered affix, spell, stat; took spell.") | 3% |

So what raised the option was the **emphatic, narrative framing** ("every
time", "never", "walked past it each time"), not the facts. Neutral counts
are safe, and they are also inert: they do not make Jev vary its answer.
**Rule:** state history as plain counts and plain per-room lines, with no
intensifiers ("every", "never", "always", "room after room", "most/least"),
and no sentence built around one option. Wishes the player actually
expressed (their own words) are read correctly. Variety and avoidance
belong to code (finding 5).

### 6. Arithmetic in the state does not move an option Jev never ranks
Gold was the top need 0 times in ~100 rooms in each of five runs, before and
after the briefing spelled out what the gold would buy at the next vendor
stop. Its 7% share of doors comes only from code filling a short ranking with
the stalest kind.
**Rule:** if an option must appear at some rate, that is a code floor, not a
fact.

### 7. Jev does not count, so counts arrive as lines
Streaks, "fights since the last release", "3 of the last 3 cards off style"
are computed by code and stated as one line each. A list Jev would have to
walk and count is not a fact it can use.

### 8. Unmeasured is not the same as zero
At the start of a run, facts defaulted to "no damage, just released", which
matched every clause of `peak`: room 1 was `peak` in every run.
**Now:** unmeasured facts say so ("no room played yet"); rooms 1–2 cannot be
`peak` (a code bound).

### 9. Fixtures leak into answers
`affix_intent` answered `wider` 100% because the harness fixed the start
preset at `spam` and typed no intent. Varying presets and intents gave
41 / 32 / 27.
**Rule:** judge a question on varied inputs; a degenerate answer may be the
fixture, not the model.

### 10. Two questions on the same facts are one question
Symmetry and the three mood questions were grounded on the same health /
damage / clear-speed partition and answered as one (91–100% one answer).
**Now:** each look question has its own alternation fact and at most one
other fact that genuinely moves.

### 11. Verdicts hide in content text
Item descriptions written for designers ("at the lowest mana cost in the
attack pool", "suits a spam build") reach Jev as option text and read as the
answer. **Now:** option and state text is written from params or from the
player-facing description, not from design notes.

### 12. Prose state changes confidence, not only answers
With label-matching clauses Jev answers at high confidence whether or not the
match means anything (`stat_family` at 0.54 while declining 17%). The prose
briefing lowered mean confidence (0.68 → 0.60) and improved the run-level
outcome (offer matches the build's need 40% → 49%, spell levels raised
62% → 71%, `stat_family` declines 17% → 0%). Confidence is not a quality
score across formats.

### 13. One temperature cannot serve a ranking
Sampling the top door sharply and the rest broadly needs two temperatures
(`PORTAL_NEED_TEMPERATURE`, `PORTAL_TAIL_TEMPERATURE`); one sharp value made
every room the same three badges.

### 14. Operational
- Upstream `529` (overloaded) happens; the evaluator retries with backoff
  inside the room's deadline and falls back to the rule arm.
- A round-1 request with the full card pool is ~52 KB; the client and proxy
  body limits had to be raised.
- Keyword reads of the player's own words misfire ("clear rooms fast" read as
  a mana complaint); prefer letting Jev read the sentence.

### 15. Every sequence property we tried to ask for, we ended up coding
Three in one pass, each the same shape: the design intent is about a *run*,
the question is about a *state*, and the wording that carried the intent
turned into an argument for one option.

| what varies over a run | said in prose | measured | now |
|---|---|---|---|
| the room's look | the alternation in the look questions' instructions, and a state line counting how long each part had held | `mood_particles` `calm` 91%, `mood_temperature` 65%, `symmetry` 58% | the streak line deleted, intent kept in the instructions, `LOOK_REPEAT_PENALTY` (0.33) on the last room's answer before the draw |
| whether a room has a priority target | "a run needs both, or the rooms that do have something to aim at stop reading as different", in the instructions **and** on `none` | `anchor` `none` 85%; with the sentence removed from both, 87% | the same 0.33 penalty on the last room's anchor |
| which cards the offer shows | nothing; the offer was Jev's fit ranking alone | a run saw 8.4 of 20 affixes and 9.0 of 25 spells, the top five taking 73–75% of its slots | `CARD_REPEAT_PENALTY` (0.45 a previous showing, floor 0.12), plus one unshown card guaranteed in the tail where the pool has one |

The look and the anchor are the clean case: **deleting the prose moved
nothing** (`anchor` 85% → 87%), and the code term moved it at once. The rule
is finding 5, and the cost of ignoring it is paid twice — once in the answer
and once in the tokens spent asking.

<a id="finding-16"></a>

### 16. Neutralising the state moved the questions it was not aimed at
Applying finding 5a's rule — plain counts, no intensifiers, no sentence built
round one option — across the whole briefing changed answers well away from
the doors. Eight seeds, `average`, briefing arm, before and after:

| question | before | after |
|---|---|---|
| `mood_particles` (raw, before the code penalty) | `calm` 91% | `calm` 72% |
| `mood_temperature` | `cold` 54% | `warm` 54% (the two now within 16 points) |
| `elite_portal` | `none` 58% | `none` 86% |
| `stat_family` | `survival` 75% | `survival` 42%, `movement` 39% |
| `subspecies` declined | 15% | 9% |

The look questions freed up without being touched: their streak line was the
sentence dwelling on their own answer. `elite_portal` went the other way by
almost thirty points, which nothing in the change was aimed at — so a state
edit is a change to *every* question in the request, and a pass that measures
only the question it meant to fix will miss the one it broke.

### 17. Gold needs a floor, not an argument; vendors need a cap
`portal_need` ranked `gold` first **0 times in 101 rooms**, before and after
the state spelled out the purse, the merchant's prices and what the two
together would buy. Its share of doors came entirely from the tail of the
ranking. `GOLD_FLOOR_ROOMS` — gold is put on the list when it has been off
the last five offers — took it from 7% of portals to 8%, which is the floor
and not a persuasion.

The vendors were the mirror image: 10% of portals against gold's 7%, and 1.5
mid-run vendor rooms a run, from caps of two rooms and four offers over rooms
2–12. Reported from play as "the game is pushing you to spend money". One
room, two offers and a rooms 4–10 window put them at 3% against gold's 8%.

### 18. A negative that is true of the whole pool is a decline, not a filter
The variant ranking's `not_for` opened with "a room the player meets no
ordinary <base> in" — true of nearly every option of nearly every room, since
the roster is decided in the round after. Where *every* option is wrong for
the state, nothing fits and the escape option takes the answer: the ranking
declined 15% of rooms at 0.21 on the escape. Moving the base into `what` and
writing the negative from the tags alone — which differ between options — took
the declines to 9%.
Finding 2's converse, and the same rule: a sentence written on the whole pool
distinguishes nothing, whichever direction it points.

### 19. A bound that names one option does not hold a streak two options long
`DOOR_STREAK_CAP` withholds "the kind that has been on every one of the last
four offers", and `doorStreakSpent` returned the **first** such kind in a fixed
order. With three doors drawn from four kinds, two kinds are on most offers, so
two streak together often: a live run offered spell *and* affix in rooms 1 to
4, the cap withheld spell, and affix went on to a fifth offer with the cap
nominally at four. Measured over 8 seeds at `average`: the longest same-kind
streak was 5 with the cap "on".
**Now:** `doorStreaksSpent` returns every kind that trips it and all of them
leave the list, down to a floor of two reward kinds.
**Rule:** a bound written over a set of options has to be evaluated over the
set, not over the first member of it. A cap measured at its own limit + 1 is
not a tuning question; it is a bug.

### 19a. And the cap is still needed: ten offers running without it
Finding 5 measured the streak with the prose still in the request. Measured
again with the prose **gone** — a neutral briefing, no streak counts, nothing
on any option about a repeated badge, no variety paragraph in
`DIRECTOR_BRIEF` — over 8 seeds, 16-room runs, 120 offers:

| badge | longest run of consecutive offers, cap off |
|---|---|
| affix | 10 |
| spell | 7 |
| stat | 6 |
| gold | 2 |

So removing the sentences stopped them *raising* the option (finding 5a) and
did nothing whatever for the variety they were written for. The reason is
visible in the same log: `portal_need` reads `build_shape` sharply — raw 88%
spell, forming 54% affix, formed 43% stat — and `forming` is where a run sits
for ten rooms of sixteen. Each answer is right about its own state; the
sequence they make is one badge. **`DOOR_STREAK_CAP` stays**, and nothing in
the request argues for variety.

### 20. The sink is the option with the longest case and the narrowest negative
Findings 1 and 2 in the form they keep coming back in. Over 8 seeds and 105
rooms, four questions were all but decided before they were asked:

| question | modal answer | its `what` | its `not_for` |
|---|---|---|---|
| `elite_presence` | `none` 83% (76% after, 72% with the look split) | 3 clauses of its own case | 1 narrow clause |
| `subspecies_weight` | `none` 70% | 3 clauses | 1 clause |
| `size` | `standard` 88% (`compact` 0%) | 1 clause | written about vendors' rooms |
| `next_tension` | `build` 85% (`release` 1%) | "the pitch most rooms sit at" | 2 clauses |

In every one of them the modal option's `what` ended by arguing for itself —
`none` "is the only room where what the player has learnt this run is simply
true", `build` is "the pitch most rooms sit at" — which is finding 4's mistake
moved one field to the left, out of the instructions and onto the option. And
in every one its neighbours carried the hedging: `elite_presence: one` had a
three-clause negative against `none`'s one.
**Rule:** across a question's options, the `what` and the `not_for` are about
the same length, and neither says which option is usual. Write the negative
from what the option costs, not from the rooms it is never chosen for.

### 21. An instruction may only name a fact the state prints
`subspecies_weight`'s instruction asked it to answer from "how far the run has
come, **how many rooms have been plain already** and how the player's build is
doing". The briefing never said. The variants a room held were in its enemy
list under their own names, so answering the question as asked meant
recognising thirteen ids and then counting rooms — two things a classifier does
not do (finding 7) — and it answered `none` 70% of the time instead.
**Now:** code counts and the state says it, in the same shape the pitch already
gets: "Rooms whose bodies were all ordinary: 4 of the 6 fought" and "Fights
since the last room with a variant body in it: 3".
**Rule:** an instruction that names a fact is a promise the state carries that
fact *as a line*, not as something derivable from one.

### 22. Gold does not read the purse, in either direction
Finding 6 and finding 17, re-measured with every argument for gold removed from
the request: the option no longer prices the purse against the shelf, the
glossary no longer calls a purse "the priciest thing the merchant sells with
change", and the state gives the arithmetic once instead of twice. 8 seeds, 104
asks, gold's share of `portal_need`'s probability mass:

| gold in hand | gold's mass |
|---|---|
| under 25 | 1.7% |
| 25–49 | 3.3% |
| 50–94 | 2.4% |
| 95 and over | 2.6% |

Flat, and what movement there is runs the wrong way. The same calls read the
build sharply (raw 88% spell, forming 54% affix, formed 43% stat), so the
ranking is working; gold is simply not an answer to "what does this build need
now". **`GOLD_FLOOR_ROOMS` stays, and it is the only thing putting gold on a
door.** Adding facts to move it has now been tried three times.

### 23. An option that names the wrong quantity is wrong even when it reads well
`density` sets how many bodies a room holds **over its whole fight**; how many
stand on the floor together is the run-progress ramp's and no answer changes
it. Both extremes said the other thing — "few bodies on the floor at once: a
breather", "many bodies at once: the hardest crowd the run currently allows" —
so the question described a room the game does not build, and in the opening
rooms, where twelve bodies arrive four at a time, it described the opposite of
what the player meets.
**Now:** the options quote `DENSITY_TARGETS` per round, the instruction says
once that the count is the total and not the crowd, and the state carries the
room's two ceilings ("Bodies this room may hold over its whole fight: 12",
"Bodies that stand on the floor at once in this room: at most 4"). Measured
over 8 seeds and 103 rooms, the answer spread out: normal 75% → 58%, sparse
10% → 25%, dense 14% → 17%. The first attempt put a mark against `sparse`
inside its own `what` ("the one answer that leaves the floor emptier than this
room would allow") and took it to **1%** with a tenth of the mass on the escape
option; the same figures with the editorial removed are the numbers above.

**And a parity problem the Director cannot fix.** With the targets multiplied
by the room's rounds (`targetCount`) and clamped by the ramp's own total, the
assembler returns *the same roster* for `normal` and `dense` at every room
index and every pitch, and a `sparse` room only a little smaller: measured,
room 7 at `build` is 12–13 bodies for sparse and 12–16 for both of the others,
room 14 at `peak` is 12–19 against 12–20 and 12–20. The option text is honest
about what is asked for; what the room does with it is `packages/core`'s.
**Rule:** an option that quotes a number quotes it from the constant the game
runs on, and names the quantity that constant is.

### 24. A stuck question can come unstuck without being touched
`mood_brightness` was 97% one answer when the look arrived buried in a room's
comma list, and 81% when `dim` had no positive case written on it. Measured now
— nothing about brightness changed in between, but the state was neutralised
(finding 16) and the look got its own line — it is `dim` 52% / `bright` 48%
over 97 asks. Its escape mass, 0.09, is the highest of any question in the
request, which is the honest reading: two thin options between which the state
genuinely does not decide.
**Rule:** a list of stuck questions goes stale. Re-measure before fixing, or a
pass spends itself on a question that fixed itself and misses the one that
broke (finding 16, from the other end).

### 24a. One fact per line, and the example that quotes it
The four parts of the last room's look arrived as one comma list ("Last room's
look: mirrored layout, warm light, dim, busy particles"), so each of the four
look questions read one clause of it and ignored three — and each question's
example had to quote all four to be a line the briefing prints, which is three
specific values of fields that question does not decide. Split into four lines,
each question's example is the single line its own answer is read off
("Last room's brightness: bright").

Measured over 8 seeds, 16-room runs, on the **rooms the player actually walks
into** (the raw answer is not the room: `LOOK_REPEAT_PENALTY` sits between
them):

| look | longest run of identical rooms, before → after | mean run |
|---|---|---|
| symmetry | 9 → 4 | 2.4 → 1.6 |
| temperature | 12 → 6 | 3.1 → 1.8 |
| brightness | 10 → 7 | 2.1 → 1.5 |
| particles | 16 → 8 | 5.1 → 2.1 |

The modal shares barely moved (56/54/60/60% → 58/56/55/58%), so this is not the
answer changing its mind; it is the answer *tracking the fact* instead of
ignoring it. The raw distributions concentrated hard as a result — `symmetry`
answered asymmetric 99% of the time, because the penalty had already made the
last room mirrored and the question now reads that — which is the honest shape
of an alternating question and not a stuck one. Read the sequence, not the
share, for anything code alternates.

### 25. A bucket boundary the briefing prints twice contradicts itself
The state gives each measured quantity as the figure and the bucket, so a
wrong cut is visible in one line: `hits_per_shot` bands on `v >= 1`, and a
player whose every shot hits exactly one body reads **"Bodies struck per shot
fired: 1.0, reads as several"**. The comment on the constant says the cut was
meant for "above it the spell is piercing or splitting", so the label is a
band's worth off, and it is the label the homing affix lane and the offer's
`eases` fact are read from. (`hitsPerShotSeveral` in
`packages/core/src/run/observed.ts`; not fixed here, it is core's.)
**Rule:** printing the figure beside the bucket is worth the tokens — it is the
only place a mis-cut bucket announces itself.
### 26. The parity rule is not a law, and two questions got worse for it
Finding 20's fix — cut the modal option's case to one clause, cut its
neighbours' hedging to match — was applied to four questions in one pass and
measured on the same eight seeds and the same profile at each step. Two moved
the right way and two moved further the wrong way:

| question | before | after parity | after a second pass |
|---|---|---|---|
| `elite_presence` `none` | 83% | 76% | — |
| `density` `normal` (with the counts fixed, finding 23) | 75% | 64% | 57%, and `sparse` 10% → 24% |
| `size` `standard` | 88%, `vast` 18% | **100%**, `vast` 0% | — |
| `subspecies_weight` `none` | 66% | **90%** | **100%** |

`size` and `subspecies_weight` are reverted to the text that measured better.
Two things to take from it. The first is that an option's length is a weight and
not a lever: shortening the modal option's case removes an argument, and where
the state gives the question nothing else to go on, what is left is the safe
answer with less to read. The second is `subspecies_weight`'s second pass — the
state gained the fact its own instruction asked for, "how many of the fights so
far held a variant body", and every phrasing of it (one-sided, then a two-sided
tally) pushed the answer further toward `none`, because in a run with no
variants the fact can only ever say *this run has been plain*. A count that is
only ever about one option is a case for it, tally or no tally.

Both questions are now stuck at or near one answer with nothing left to say to
them in words. The next thing to try is not a better sentence: it is the rate
floor findings 6 and 17 arrived at for gold — after N rooms with no variant,
`none` leaves the option list — and for `size`, either the same or dropping the
question. **Neither is implemented**; they are proposals for the hard-rule
review, because a bound is the user's call and not a pass's.

### 27. A choice Jev never makes is a rate, and a rate is code's
Three questions came out of the hard-rule review sitting at one answer
whatever the state said. `subspecies_weight` answered `none` 100% of the
time and `size` answered `standard` 100% after the rewording in finding 26.
`next_tension` answered `release` 1% of the time, and 0% even after
thirteen fights without a let-up and at one heart. Every lever made of words
had been tried on them: neutral text, parity of length, a fact the
instruction asked for, and removing the self-advocating clauses. None moved
the answer toward the rare option, and several moved it further away.

**Decided (user, 2026-09-25):** the rare answers get **rule floors**, the
way gold did (finding 17). After N rooms without a variant, `none` leaves
`subspecies_weight`'s list. After N rooms without a release, the next pitch
may be `release`. `size` gets the same treatment: after N rooms at
`standard`, it leaves the list. Jev still ranks what is left, so the
Director's reading of the state decides which variant, which size and
when inside the window. The code only decides that the rare option
happens at all.

**Rule:** when a question's rare option matters to the game but no state
makes Jev pick it, that is a **sequence property**: how often something
happens over a run, not what fits this state. Put it in code as a floor
instead of arguing for it in the option text. The symptom is a rare option
that stays at about 0% across states designed to favour it. Before adding a
floor, check finding 24 first: re-measure, because a stuck question can
come unstuck on its own.

### Options defined only against the past have nothing to fit on the first ask
The four look questions' options are written around the room before
("…whose last floor was already mirrored"). In room 1 there is no room
before, and live Jev declined all four in the first room of a real session.
**Now:** the first room's look is not asked; the rule table fills it and the
decision is marked `no_history`, not a decline. **Rule:** a question whose
options only mean something relative to history is not asked before there
is history.


### 28. Neutral card text changed nothing Jev answers; the style lean is Jev's (2026-09-25)
After the spell redesign (doc 006, thirty-nine spells) every card `what` was
rewritten as a neutral fact — the content table's `description`, which the
option now carries in place of `PLAYER_TEXT` — and the lane, family and school
specs lost their verdicts ("widens nothing", "buys the run room to go wrong",
"a bar that buys few casts ... is about to stop working").

**The wording itself is inert.** A controlled test: 30 round-1 requests from
the run below (4 spell and 2 affix offers per style), each asked twice with
state, instructions and every `not_for` identical and only the card `what`
varied — the neutral description (A) against the old
`${name}: ${PLAYER_TEXT}`, which carried "best when enemies bunch up", "the
hardest-hitting common attack", "your answer to being surrounded" (B):

| question | n | same top card | on-style mass A / B | mean total variation |
|---|---|---|---|---|
| spell `overall` | 20 | 100% | 0.94 / 0.92 | 0.10 |
| spell `for_style` | 20 | 75% | 0.97 / 0.97 | 0.15 |
| spell `for_needs` | 20 | 65% | 0.41 / 0.40 | 0.19 |
| affix `overall` | 10 | 100% | 0.69 / 0.70 | 0.13 |
| affix `for_style` | 10 | 100% | 0.80 / 0.84 | 0.12 |
| affix `for_needs` | 10 | 60% | 0.27 / 0.30 | 0.22 |

and the other questions in the same requests moved by at most a draw's worth
(`next_tension`, `size`, `portal_need`, `mood_temperature`, `affix_intent`
100% the same top answer; `variety` 90%; `space` 83%). So the verdicts were
not steering the card question: the offer reads the build and the stated
style, and a card's text is what distinguishes the candidates, not what ranks
them. That is the result the neutral-fact rule wants — the text can be as
plain as a rule sheet without costing the Director anything.

**The style lean is real, and it is the Director's.** 10 seeds, `expert`,
briefing arm (two runs a style, `route-review`'s players), against the rule
arm on the same seeds; on-style share of the cards put on a reward screen,
pool base rate in brackets:

| style | spells, Jev | spells, rule | affixes, Jev | affixes, rule | cards taken on-style, Jev / rule |
|---|---|---|---|---|---|
| spam (21%) | 64% of 47 | 43% of 35 | 38% of 26 | 19% of 47 | 71% / 45% |
| nuke (26%) | 46% of 24 | 35% of 31 | 33% of 9 | 29% of 28 | 31% / 30% |
| area (28%) | 58% of 38 | 54% of 35 | 27% of 44 | 25% of 44 | 61% / 54% |
| dot (26%) | 48% of 29 | 42% of 38 | 29% of 38 | 29% of 38 | 59% / 46% |
| melee (26%) | 66% of 35 | 50% of 38 | 40% of 35 | 37% of 41 | 85% / 66% |

- **Heavy is the thin style** on both arms: both Heavy runs died early (24
  spell cards in two runs), and it is the one style whose taken cards are no
  more on-style under Jev than under the rule table.
- **Affix offers barely lean for area and dot** (27–29% against a 20% base on
  both arms): `for_style` puts 0.80 of its mass on-style, but the blend, the
  wildcard and the novelty penalty spread it back out.
- **A card Jev never takes:** Mana Darts, offered 13 times (6 to the spam
  runs, the style it is tagged with) and taken twice, never by a spam run;
  Shatter, offered 5 times and never taken. **Always taken:** a style's own
  starter as an upgrade (Spirit Blades 6 of 6 in the melee runs), Seeker Swarm
  6 of 8 in the spam runs.
- **Ward is on about two affix screens in five** (20 of the 152 affix cards, taken 9
  times): it fits every shape and is the `need` card whenever health is low.
- **The Director shows less of the pool than the rule table**: 10.8 distinct
  spells and 10.2 affixes a run against 13.7 and 14.8, the five commonest
  taking 66% of the slots against about 50% — with `variety` answering `low`
  in 84% of offers, which sharpens the draw (and answers `low` for 9 of 14
  offers with two off-style picks running, `high` only with none).

Collapsed questions in the same log (n ≥ 50, raw answers): `symmetry`
asymmetric 96% and `mood_temperature` warm 90% (both alternated by
`LOOK_REPEAT_PENALTY`: the rooms came out 58% and 56%), `next_tension` build
88%, `anchor` none 85%, `variety` low 84%; the card questions are the spread
ones (`overall` modal 11%, `for_style` 7%). The A/B above rules the card text
out for all of them.
**Rule:** a verdict that does not decide the answer is still worth removing —
it cost nothing here, and it is a sentence a later edit could make decisive.
Measure a wording change as an A/B over logged requests (same state, one field
varied), not across two runs, whose rosters and seeds differ in everything else.

<a id="finding-29"></a>

### 29. Heavy's early deaths were the hands, not the Director; one starting spell on the Jev arm (2026-09-25)
Entry 28's two early Heavy deaths were read as the Director's thin lean. The
rule arm, measured before touching anything (`route-review`'s players, 40
seeds a style and profile), showed the same early deaths without Jev (expert
Heavy reached the boss in 57% of runs, every other style 82–100%), and found
their cause in the reference player both arms share:

- **The rotation pressed the first ready key**, and a key whose cooldown is
  shorter than its own windup and recovery is ready every time the hands are
  free. An expert Heavy run cast Earth Spikes 214 times and its other two keys
  11 and 0; an `average` player (1.2 s cast gap) pressed nothing but the first
  key in any style — before the redesign that key was Magic Bolt, so every
  style measured the same. The rotation now goes round the keys (the ready key
  cast longest ago first).
- **Earth Spikes slowed the caster to half speed** for 700 ms a cast, on the
  only key Heavy starts with: a lone room-1 shooter took 12.8 s and 4.5 HP
  against 4.2 s and none for the sword alone. `move_scale` 0.5 → 0.85.
- Ember Dart needed its second hit inside a second to light, which an
  `average` player never landed; `element_power` 1.6 → 2.4 (still two hits).

Rule arm, expert, runs reaching the boss: Heavy 57% → 99% (80 seeds; 92%
before the redesign); `average` Heavy 20% → 62%.

**Then the Jev arm**, 5 seeds, `expert`, briefing, one run a style (142
calls, no fallbacks): all five reached the boss and no offer was flagged;
the Heavy run won the whole run. Three runs died at the boss, which was being
redesigned at the time and is not this entry's number. Two things it showed:

- **With one starting spell, Jev puts the starter's own upgrade first** on the
  early spell screens (`overall` about 0.75 on it), and the reference player
  takes the first card: the Barrage run held one key through room 3 and the
  Blade run through room 4, where the rule arm has 1.9 keys entering room 2.
  Whether a person would take the level over a second key is the chooser's
  question, not Jev's; the harness takes the first card on purpose.
- **Mana Darts' negative named its own best use.** It read "a fight the key is
  pressed through without rest", which is the Barrage verb and, by doc 006,
  the way the key deals the most. Replaced with its real cost ("a bar running
  dry: each press costs a whole cast, however few darts are banked"), and
  measured as an A/B over 15 logged round-1 requests from rooms 1–3, the same
  state with only that sentence varied:

| question | Barrage run (n=3), mass new / old | other styles (n=12), new / old | Mana Darts top, new / old |
|---|---|---|---|
| `overall` | 0.06 / 0.03 | 0.01 / 0.01 | 0 / 0 |
| `for_style` | 0.14 / 0.04 | 0.00 / 0.00 | 0 / 0 |
| `for_needs` | 0.24 / 0.31 | 0.14 / 0.20 | 5 / 8 of 15 |

  The on-style mass for the style it is tagged with tripled, and the need mass
  fell — the new clause names a mana cost. It never topped `overall` either
  way: in those rooms the starter's upgrade leads `overall` by an order of
  magnitude. Too few requests to call; it is the text that was wrong, not the
  rate.

**Rule:** before reading a style's outcome as the Director's, check what the
hands did with the keys — `pnpm play` prints each held spell's casts a
minute (`SPELL_USE`). A key the reference player never presses turns an offer
question into a harness bug that looks like one.

<a id="finding-30"></a>

### 30. A count printed the wrong way round is read backwards; the rest was the hands again (2026-09-25)
Four changes, measured separately where they could be. The run numbers are 10
seeds, `expert`, briefing arm, two players a style (`route-review:jev 10
expert 700 briefing`, 286 calls, no fallbacks), against the rule arm on the
same seeds, and against entry 28.

**The neutral pass.** Every Jev-facing spec and instruction was swept for
verdicts, rankings against the pool and removed labels (`jev-text.test.ts`,
beside `spell-text.test.ts`): the door kinds ("the only door that changes what
the player can do at all", "which is how three separate spells become one
build"), the merchant ("the one place the player chooses"), the grades ("the
best roll the game has", "catch-up lever"), `composition`'s instruction ("the
build's range and the build's archetype ... one that suits it makes the room a
showcase, and the run needs both"), `subspecies_weight`'s "the only room where
what the player has learnt is simply true", and the style line the briefing
quotes, now `STYLE_CARDS[id].does` — what the style's spells do and its starter,
Blade's being Crescent Edge — where it used to quote the card's blurb ("slow,
expensive spells that end fights"). An A/B over 12–24 logged states each, old
text against new, nothing else varied:

| question | old → new |
|---|---|
| `next_tension`, `anchor`, `elite_presence`, `subspecies_weight`, `normal_grade`, `portal_need` | same top answer in 75–100%, mass within 0.05 |
| `elite_portal` | `none` mass 0.57 → 0.59 |
| `elite_grade` | `best` 0.49 → 0.42 (top 8 → 1 of 12): "the best roll" and "catch-up lever" were arguing for it |
| `composition` | `ranged_heavy` 0.54 → **0.82** with the facts named and nothing else; 0.74 with the two-sidedness restated neutrally ("a mix can press the way the player fights, or play into it"), which is what shipped |

`composition` is finding 15 again: what spread it was the sentence about the
*run* ("the run needs both"), and removing a verdict that happened to be a
sequence property concentrated the answer. It is at 88% one answer in the run
log (80% in entry 28); if it matters, the remedy is a code penalty on repeating
the last room's mix, not a sentence. The run log's `composition` was taken with
the fact-only instruction; the shipped one was measured only in the A/B.

**`variety` read the off-style count backwards.** Entry 28's `low` 84% was not
a stuck question: with the off-style count as it was printed, more off-style
picks produced *more* `low`. A controlled test, 6 logged states, only the
kept-card lines and the question varied, mean mass on each answer:

| off the stated style, of the last three (newest two) | entry 28's text: low / med / high | "tagged with the stated style: N of 3" and negatives only | "off the stated style: N of 3", negatives and one example each (shipped) | the same without the examples |
|---|---|---|---|---|
| 0 (0) | 0.42 / 0.15 / 0.41 | 0.14 / 0.27 / 0.57 | **1.00** / 0 / 0 | 0.61 / 0.21 / 0.18 |
| 1 (1) | 0.49 / 0.37 / 0.13 | 0.54 / 0.45 / 0.01 | 0 / **1.00** / 0 | 0.13 / 0.84 / 0.03 |
| 2 (2) | 0.63 / 0.30 / 0.06 | 0.76 / 0.22 / 0.01 | 0 / 0 / **1.00** | 0.34 / 0.20 / 0.45 |
| 3 (2) | 0.64 / 0.29 / 0.06 | 0.91 / 0.05 / 0.03 | 0.09 / 0.05 / **0.81** | 0.61 / 0.17 / 0.21 |

Three things were wrong and all three had to go. The options' negatives were
written about commitment ("a player who has committed to one direction and is
being paid for it"), and the one line that reads as commitment — which way the
keys lean — is the stated style in nine states of ten, because the starter is
on every staff. The count was a bucket (`drifting` printed "1" for one *or two*
off-style picks) and said nothing about which cards. And printed as "tagged
with the stated style: 0 of 3" it had to be turned round before the options,
which are about picks *off* the style, could be matched to it: Jev does no
arithmetic (finding 7), and read the higher number as the answer. The briefing
now prints the last three cards kept with their style tags and "Of those, off
the stated style: N of 3; of the newest two: M", and each option carries that
line at one value as its example — finding 3's case: the three options differ
only by which value of one line applies, and without the examples the answer
still turned back to `low` at three of three. In the run: `variety` low 34% /
medium 29% / high 36% (entry 28: 84 / 12 / 4), and by the count it tracks it
almost as a lookup (0 of 3 → low 1.00, 1 of 3 → medium 0.79–1.00, 2 or 3 of 3
→ high 0.58–1.00). With no card kept yet (room 1) it answers `low` or declines
(0.34 escape mass). That is close to the rule arm's mapping written as an
example, and the review should decide whether a one-fact question is worth a
Jev call at all.

**The early screens: what a copy does to the keys, said.** A copy of the
starter carried the same description as the spell and one extra flag, and
nothing joined it to the empty keys in the build section. Now the copy's
option says "This card is a copy of the spell on key 1: taken, it raises that
key's level and fills no key, so keys 2 and 3 stay empty", the card section
says once where a new spell goes, and the `overall` instruction says how each
sort of card lands on the staff. A/B over the run's 20 early spell screens
(rooms 1–2), only those facts removed or kept:

| | copy's mass in `overall` | copy on top |
|---|---|---|
| facts stripped | 0.70 | 19 of 20 |
| facts present (shipped) | 0.51 | 15 of 20 |
| room 1 only, stripped / present | 0.67 / 0.44 | 9 / 5 of 10 |

So the facts move it, and Jev still puts the level first on most early screens
— which is its reading of the brief ("a player building one thing wants more of
it"), and now a reading made with the keys in view.

**And the hands.** The reference player took the first card, which on an early
screen was the Director's first answer. It now takes, with a key empty, a new
spell — the first tagged with the stated style, else the first new one — and
otherwise the first card (`chooseCard`, `play/run.ts`). Keys held entering
rooms 2 / 3 / 4, mean over the runs:

| | entry 28, Jev | entry 29, rule | Jev, now | rule, now |
|---|---|---|---|---|
| keys | 1.3 / 1.9 / 2.3 | 1.9 entering room 2 | 2.0 / 3.0 / 3.0 | 2.0 / 3.0 / 3.0 |

That number is now the chooser's on both arms, and so is part of the on-style
share of cards *taken*.

**The run, against entry 28.** On-style share of the cards on reward screens:

| style | spells, Jev (28 → now) | spells, rule now | affixes, Jev (28 → now) | affixes, rule now | taken on-style, Jev / rule now |
|---|---|---|---|---|---|
| spam | 64% of 47 → 69% of 32 | 40% of 35 | 38% of 26 → 34% of 44 | 29% of 41 | 50% / 62% |
| nuke | 46% of 24 → 63% of 35 | 34% of 41 | 33% of 9 → 24% of 38 | 23% of 35 | 50% / 39% |
| area | 58% of 38 → 75% of 32 | 61% of 38 | 27% of 44 → 24% of 50 | 26% of 38 | 59% / 62% |
| dot | 48% of 29 → 63% of 35 | 40% of 25 | 29% of 38 → 24% of 38 | 29% of 34 | 50% / 35% |
| melee | 66% of 35 → 69% of 35 | 53% of 38 | 40% of 35 → 36% of 44 | 44% of 50 | 79% / 77% |

- **Heavy is no longer the thin style on spells** (46% → 63%), and both Heavy
  runs reached the boss. Affix offers lean less than in entry 28 for every
  style and sit at or below the rule arm's share: with `variety` answering
  `high` on a third of offers, the draw spreads.
- **The pool a run shows**: Jev 9.7 distinct spells (10.8 in entry 28) and 13.5
  affixes (10.2), top-five share 72% and 55% (66%, 66%); rule 13.6 and 13.7.
  The wider draw reached the affixes; the spell offers narrowed a little,
  which is the upgrade copies of held spells taking slots on a staff that
  fills by room 3.
- **Never and always taken**: in the spam runs Mana Darts was taken 4 times of
  6 (entry 28: 0 of 6; its negative was rewritten in entry 29), Seeker Swarm 1
  of 6 (entry 28: 6 of 8). Shatter 1 of 7, Brand 1 of 10 and Fork 1 of 8 are
  the new near-nevers. The starter's copy is the most-offered spell card of
  the spam, nuke and melee runs (Earth Spikes 12 times in the Heavy runs,
  taken twice). Ward is on 21 of 214 affix cards and taken 9 times (entry 28:
  20 of 152).
- **Collapsed questions** (raw answers, n ≥ 50, over 85%): `symmetry`
  asymmetric 96%, `mood_temperature` warm 93%, `size` standard 89%,
  `composition` ranged_heavy 88%, `elite_portal` none 87%, `next_tension`
  build 86%; `variety` and `anchor` (81%) left the list. `elite_portal` was 76%
  in entry 28 and the A/B above moves it by two points, so the rest is the runs.
- **Runs reaching the boss**: Jev 10 of 10 (entry 28: 8), rule 9 of 10. The boss
  was being reworked in another session during both runs, so neither the
  reach nor the wins are this entry's numbers.

**Rule:** a count is read in the direction it is printed. Print it as the
quantity the options are about ("off the style: 2 of 3", not "on it: 1 of 3"),
because turning it round is arithmetic. And a question whose options differ
only by one line's value needs that line on each option as its example, or the
answer drifts to whichever option reads safest.

<a id="finding-31"></a>

### 31. A list of Jev's own answers is read as a precedent; the run as it was built is not (2026-09-25)
Commit 993a7c0 gave the briefing a record of the Director's answers — one JSON
object a room, every kept question — and took the school and sparse-room caps
off the Jev arm on the grounds that Jev could now see its own run. It could,
and it kept to it. One live run (seed-0, `spam`, `expert`, 29 calls) was
recorded with the record in its briefing, and its 25 requests from room 3 on
were replayed twice each with the record and twice with the block removed,
nothing else varied:

| mass on the previous room's answer | with the record | without |
|---|---|---|
| all questions (1,228 answers) | **0.58** | 0.49 |
| `size` | **0.88** | 0.06 |
| `elite_portal` | 0.78 | 0.58 |
| `spell_school` | 0.82 | 0.65 |

The two arms differed by 0.11 on average (total variation) against 0.04
between two sends of the same request. `size` is the plain case: the run's
first two rooms happened to be `compact`, and with the record every later room
was `compact` at 0.82–0.95 where without it Jev wanted `standard` at ~0.85. The
run itself: `next_tension` build 13 of 13, `entry` flanks 13 of 13,
`symmetry` asymmetric 12 of 12, `mood_temperature` warm 12 of 12,
`spell_school` storm 9 of 9, `elite_portal` none 11 of 11 — no elite room at
all.

The record was also not the run. It held the *sampled* answers before code
finished the room: a door the vendor replaced (`affix > spell > gold >
fountain` over doors affix, spell, fountain), a variant *ranking* rather than
the bodies that came, `elite_portal: elite` with no word of which door. And it
listed every room in full beside the room lines that roll the early ones up.

**Now:** no record. What it was added for — the doors a run generated, not
only the ones taken — is in the journal as built and printed in each room's
lines: every door out with what was behind it, the fight as assembled (roster,
density, waves, entry, anchor, variants, enraged bodies), the room's size; the
rolled-up rooms tally their doors. Replayed the same way on a second recorded
run, these facts moved answers no more than noise toward repeating: 0.40 on
the previous answer with them, 0.39 without; mean total variation 0.07 against
0.04.

**Rule:** give Jev the run as it was built, in the briefing's own lines — not
a list of the Director's answers, which it reads as the precedent to keep.

<a id="finding-32"></a>

### 32. A principle about the run works once the state prints the run — if it says where, and that it weighs nothing without it (2026-09-25)
Findings 5 and 15 put every sequence property in code, because every sentence
asking for variety concentrated the answer. Those were measured when the state
did not print the run. With the rooms as built in the briefing (finding 31),
the question was asked again.

**The history alone does nothing.** Two live runs with the school cap off and
every door's school in the briefing: storm on 10 spell doors of 10 (`spam`),
spirit on 7 of 7 (`melee`).

**Where the sentence goes.** 44 requests from those runs, one change at a
time, two sends each; mass on the previous answer:

| | none | in the instruction | on every option's `not_for` |
|---|---|---|---|
| `spell_school` | 0.87 | **0.46** | 0.80 |
| `composition` | 0.78 | 0.58 | 0.53 |

The sentence was even-handed and named no option: "A run is travelled
through: over a run, the schools its spell doors promise should not settle
into one." `symmetry`, which already carries such a principle in its
instruction and on both options, was run with it removed: after a mirrored
room it moves to asymmetric at 0.76 with the principle and 0.14 without; after
an asymmetric one it stays at 0.58 and 0.54. It works in one direction only.
Rewording asymmetric's "buys variety" to "a floor to learn" changed nothing
(0.77 / 0.57), so the word was not the reason.

**Which sentence.** Shipped in the instruction, the generic sentence took a
four-style set of live runs to 45% of spell doors in the player's style — 1 of
10 for `spam` — and in its first room, with no door behind it, Jev's
`spell_school` for that run was storm 0.36 / void 0.30 at confidence 0.26
against 0.75 / 0.72 in a run without it. It was not reading the run; it read
"should not settle" as an argument against the obvious answer (finding 4). A
version that says where the run is and what it weighs when there is none — "The
spell doors earlier in this run, and the school each promised, are in the
state. A run whose doors have kept promising one school has settled into it,
which a run should not; where no spell door has promised a school yet, this
weighs nothing." — replayed on 100 requests across four styles, 300 calls:

| `spell_school` | none | generic | anchored |
|---|---|---|---|
| change from none with no history (total variation) | — | 0.41, top answer changed in 20% | **0.08, top answer unchanged** |
| mass on schools holding the stated style | 0.85 | 0.47 (`spam` 0.28) | **0.70** (`spam` 0.58) |

`composition` behaves the same way (with no history: the generic one changed
the top answer in 25% of requests, the anchored one in none; with history the
repeat rate under the confidence reading, finding 33, is 0.52 / 0.41 / 0.43).
Four live runs with the anchored wording: 93% of spell doors in style. For
`size` and `stat_family` neither wording moved anything (mass on the previous
answer 0.78 / 0.75 / 0.78 and 0.54 / 0.50 / 0.55), and they carry none.

**Rule:** a principle about the run can go in an instruction when the state
prints the run: name where in the state the run is, and say the principle
weighs nothing before there is one. A principle that does not is an argument
against whichever answer is most obvious. Measure it on the requests with no
history first.

<a id="finding-33"></a>

### 33. Read Jev's answer by its confidence, not through a temperature (2026-09-25)
TypeSafe documents a Choice as its `choice` — the option with the most
probability — gated on `confidence`, which is computed from the spread
(`(n × peak − 1) / (n − 1)`): act on a confident answer, and treat a low one
as the model saying it does not know. The Director instead sampled every
answer through a per-question temperature, mostly 0.4 (doc 002: argmax never
decides play, or one state always builds one room). A temperature below one
re-reads Jev's second option as weaker than Jev said it was: with the anchored
principle (finding 32) Jev put 0.46 on the previous school, and at 0.4 that
came back as a repeat 78% of the time.

Offline, over the logged answers of four live runs (60 rooms, 2,000 draws per
rule; later answers were conditioned on the history that really happened, so
this is a direction, not a forecast):

| rule | off Jev's top answer | same as last time | longest run | commonest answer's share |
|---|---|---|---|---|
| per-question temperature (as shipped) | 18% | 60% | 5.1 | 71% |
| always `choice` | 0% | 68% | 6.0 | 77% |
| `choice` at confidence ≥ 0.5, else the distribution as given | 20% | 60% | 5.1 | 71% |

The confidence reading matches the temperatures overall without a number per
question, and it is where the principle's hesitation becomes a different
answer: on the replayed `spell_school` requests, the previous school came back
65% of the time under the temperatures, 82% always taking `choice`, and 31%
under the confidence reading. Always taking `choice` locks `symmetry` (100%
repeats, runs of 11.8).

**Now:** a question Jev answers takes its `choice` at confidence ≥ 0.5
(TypeSafe's suggested floor, `JEV_CONFIDENT`) and draws from its distribution
as given below it; the confidence is TypeSafe's statistic over the distribution
actually drawn from, after code filtered the options and any repeat penalty.
The rule and random arms keep their temperatures, as do rankings
(`portal_need`, `subspecies`) and card draws. The cost: a question Jev is
always sure of is now fixed — `size` was `standard` in 92% of rooms and one
run's stat doors held survival ten times running.

**Rule:** take Jev's answer the way TypeSafe documents it. Its `choice` when it
is confident, its distribution when it is not; a temperature is a designer's
reading of Jev's uncertainty, and it hid the one hesitation we had asked for.

<a id="finding-34"></a>

### 34. A promise decided apart from the cards repeats; decide the doors when they open, with the cards behind them (2026-09-25)
A spell door promised a school — its own question, asked in the room's round 2
— and the offer behind it was forced to hold a card of that school; a stat
door promised a family. Even with the anchored principle and the confidence
reading, four live runs repeated the previous spell door's school 68% of the
time. The school is a proxy: a player wants spells of their style, and a style
spans schools (void holds spam spells and nuke spells). Asking for the top
two or three schools instead would not have helped — Jev's ranking is steady,
and its top two were the same pair on every door of a run (storm + void 10 of
10, spirit + stone 7 of 7).

And the doors were decided as the room began, before the fight they depend
on: one run walked into room 5 on 37 of 90 health and out on 12, through doors
chosen for 37 (fountain at 0.14), and died two rooms later.

**Now:** a room decides only how many doors it has. When the way out opens —
the reward taken, a gold room's coins scattered, a vendor's room entered — the
doors rise pending (turning, unreadable, "Opening…" beside them) and one
request decides them: the portal questions, and for every kind a door could be
the cards the room behind it will offer, read against the fight just played
and the build just changed. Each door keeps its kind's cards and is badged
from them (finding 35); the room behind it offers exactly those cards and asks
for none. `spell_school`, `stat_family`, their round-2 follow-up and the
school cap are gone.

Four live runs (one per style, `expert`) against four with the school promise:

| | promised school | cards decided with the door |
|---|---|---|
| spell cards in the stated style | 69% | 67% |
| distinct spells, of those shown | 63% | 60% |
| commonest school's share of spell cards | 53% (64% with the cap, 2 runs) | **46%** |
| schools seen in a run, of 7 | 4.3 (4.0) | **5.3** |
| spell door badge the same as the last | 68% | **41%** |
| Jev requests a run | 29 | 40 |

Style fit and card variety held; the school spread widened. The cost is a
request a room, and the opening request carries three card pools (80–103 KB):
about 60% more input tokens a run. None of these runs made a door decision
below half health, so whether the fountain now comes when it should is not yet
measured.

Operational, found on the way: `answerOffer` runs outside a world step, so the
`portals_open` it pushes never reached the scene's event loop — the scene asks
for the doors directly after it; and the scene's journal typed a room by the
door out of it (a fight left by a smith's door was a smithy), which it no
longer does.

**Rule:** a label or promise decided apart from what it describes repeats
whenever Jev's taste is steady, however varied the thing itself is, and then
needs a rule to hold it. Decide the thing, and read the label off it.

<a id="finding-35"></a>

### 35. A badge that names the commonest of three names one card (2026-09-25)
The first badge named the school most of a door's cards belonged to, the
first card breaking a tie. Across the four runs of finding 34, 9 of 22 spell
doors were badged by one card of three — three schools, three cards, and the
Director's first pick named the door. For a `spam` player that pick is usually
a level for the held storm spell, so a played run read "storm" on 6 of 9 spell
doors over offers that were mostly something else.

**Now:** a door names every school (every family, on a stat door) among its
cards, once each, in the Director's order: "Storm · Void · Stone". More than
one stands one to a line under the arch, so a row of doors cannot run their
names into each other.

**Rule:** a summary of three things is one of them; show the three.

## Standing rules that follow
- State: facts from play, in words, with counts precomputed; no verdicts, no
  prescriptions; every coined term explained. An instruction may name a fact
  only if the state prints it as a line.
- Options: single items, `what` / `not_for` on every one — generated ones
  included, written from the item's own table row — with few generic examples
  only where options differ by which fact applies. Roughly equal length across
  a question is a starting point and not a law: it moved two questions the
  right way and two the wrong way (finding 26), so measure it like anything
  else.
- State: the run as it was built — each room, its fight, each door and what
  was behind it — not a list of the Director's own answers, which Jev reads as
  a precedent to keep (finding 31).
- Instructions: principles, even-handed. A principle about the run may go in
  once the state prints the run, if it says where and that it weighs nothing
  without it; measure it first on requests with no history (finding 32).
- Code: safety bounds, sequence properties Jev does not answer to (streaks,
  rate floors), arithmetic. A rare option Jev never picks in any state gets a
  rate floor, not more words (finding 27).
- Answers: Jev's `choice` when its confidence is at least 0.5, its
  distribution as given below that — not a temperature re-reading its
  uncertainty (finding 33).
- Labels: decide the thing and read the label off it; a promise decided apart
  from what it describes repeats with Jev's steady taste (findings 34, 35).
- Content text: a card's `what` is its neutral description, never the
  player's copy; a verdict is removed even when it does not decide the
  answer, because a later edit could make it decisive (finding 28). Say what
  taking a card does to the staff ("a copy fills no key; keys 2 and 3 stay
  empty"), not only what the card is (finding 30).
- Counts: print the items themselves and then the count, in the direction the
  question is asked; a count printed the other way round is read backwards,
  and an option that differs from its neighbour by one counted line needs
  that line as its example (finding 30).
- Before blaming the Director, check the hands: the reference player's
  rotation and card choice decided two findings that first looked like Jev's
  (findings 29, 30).
- Measure a wording change as an A/B over logged requests — the same states,
  only the changed sentence swapped — before a live run (finding 28).
- Judge on varied inputs, live, same seeds, by run-level outcomes.
