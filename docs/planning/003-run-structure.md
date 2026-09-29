---
id: 003
title: Run Structure and Game Loop
status: proposed
date: 2026-09-21
summary: Fourteen fights, a merchant-blacksmith-and-fountain room, then the boss. Every room is a fight bar the rare stop with no fight in it. What a portal promises is a reward kind crossed with a difficulty, plus a grade and a spell school or a stat family. Exits are portals standing on open floor, and a room ends in two beats: the offer appears as three cards in the UI, and choosing one raises the portals. Both beats are answered by a key press, never by walking into something. Code enumerates the legal portals, Jev answers per portal, code assembles them; Jev also picks the next room's tension. Kills pay experience and levels arrive on their own, each adding five health, a whole point of sword damage and 3% mana. Defines the room state machine with wave-aware clearing, speculative versus committed plans, prefetch triggers, and the gold economy.
depends_on: [001, 002]
---

# 003 Run Structure and Game Loop

## Shape of a run

```
fight x 14  →  the merchant, the blacksmith and the fountain  →  boss
```

Sixteen rooms. Rooms 1 to 14 are fights, room 15 holds the two vendors and the
fountain and no enemies, room 16 is the boss (`RUN_COMBAT_ROOMS`, `stageFor`).
Fourteen is doc 014's count: the number a twenty-minute run of 30 to 40 second
fights was sized against. One or two of the fourteen may be given up for a room
with no fight in it, which is what the portal that leads to one costs.

- Linear progression with branching exits: after a room is cleared **and its
  reward taken**, 1 to 3 portals rise on the open floor, each carrying a badge
  naming what is behind it. The player steps onto one and presses E. Previous
  rooms are gone.
- No map, no backtracking.

**The run narrows twice, and neither narrowing is a question** (`fixedExit`).
Room 14 is the last fight and everything past it leads to the vendors' stop;
room 15 is the stop and everything past it leads to the boss. So each of those
two rooms ends with **exactly one portal**, and that portal wears **no reward
badge** — it names the room ahead, because it promises nothing else. Neither
costs a Director question: with one legal answer there is nothing to choose
(002, "a question with one option is not asked").

Both used to fall through to the rule draw and raise up to three portals with
three different reward badges on them, every one of which opened onto the same
room and none of which paid what it said. The stop was fixed first; the last
fight was not, and it was reported from play in the same words — random doors
around the shop.

**The room type is not a choice. The reward is.** There are no room types to
enumerate. Every room before the vendors is a fight bar the rare stop with no
fight in it, and what differs between the fights, which is what the player
chooses at a portal, is two axes:

| Axis | Options |
|---|---|
| reward kind | stat, spell, affix, gold |
| difficulty | normal, elite |

That is the whole taxonomy for a fight. Two things are not on it, and both are
rooms with **no fight in them**, reached through a portal like anything else:
the **vendors**, who trade gold for power, and the **fountain**, which trades
this room's reward for health. Healing also lives in the stat pool as `Vigour`,
so recovery is a trade made at a moment of the player's choosing rather than a
free stop. Gold has one place to go, the vendors, so the merchant stop is fixed
at the room before the boss rather than something the player could decline into
a run with no way to spend.

Three layers of decision at every portal:

| Layer | Owner | Decides |
|---|---|---|
| What may be offered | code (`portalChoices`) | portal count, which reward kinds are legal, whether an elite is allowed, whether a vendor or the fountain is |
| **Which reward the player needs most**, ranked | Jev (`portal_need`) | one option per badge — stat, spell, affix, gold, merchant, blacksmith, fountain |
| Which of the ranked answers become doors | code | the top `count` distinct: the first drawn at `PORTAL_NEED_TEMPERATURE`, the rest at `PORTAL_TAIL_TEMPERATURE`; a constraint makes an option fall through to the next |
| What each door promises, and the next tension | Jev (round 2) | the spell door's school, the stat door's family — asked only for the doors that exist |
| Which portal to enter | player | the visible choice |
| What the room behind each portal contains | Jev, per room | 004, 005, 007 |

### One question, ranked, instead of a menu of combinations

The portal question used to enumerate every legal **set** of kinds and ask Jev
to pick a whole set. With three doors drawn from four kinds every set shares
two thirds of its content with every other, so the options were near-identical
sentences and the answer went to whichever carried one more matching clause;
and a set says nothing about which of its members the player needs *most*,
which is the one thing a reward offer wants to know.

So it asks for the **need**, over single kinds, and code assigns the doors from
the ranking.

**The first door is sharp, the rest are spread**, and that needs two
temperatures rather than one. A single value sharp enough to make the first
door reliably the top need also makes the second and third reliably the second
and third — and with three doors drawn from four reward kinds, that is the same
three badges in every room of the run. Measured on the live model with one
temperature: a run put an affix badge on twelve consecutive offers and gold on
none at all. The player's first door was answering their build; the offer as a
whole had stopped being a choice. So the top answer is drawn at
`PORTAL_NEED_TEMPERATURE`, which sharpens, and the rest of the ranking at
`PORTAL_TAIL_TEMPERATURE`, which spreads.

The rooms with no fight in them are options of the same question, so a
vendor takes a door by outranking a reward rather than through a question of
its own — and the elite door is drawn from the same distribution restricted to
the kinds that won, which removed `elite_kind` as a question of its own. A
vendor replaces the **last** door, the lowest-ranked reward, never the first.

## Before the run: the intent screen

The title card leads to the intent screen: five build styles — Barrage (spam),
Heavy (nuke), Crowd (area), Affliction (dot) and Blade (melee) — each naming the
second spell it starts with (Shock Arc, Stone Shard, Scatter Shot, Ember Dart,
Spirit Blades; Magic Bolt is always the first). Blade is the build that lives in
sword range: its spells circle and strike close, and its affix is Resonance,
which has the sword cast the spell. When the Director runs in Jev mode an input
field takes the player's own words as `intent.free_text`; in rule mode the field
is shown disabled, saying it needs Jev, since the rule arm cannot read text.

Under the cards, the chosen style's starting spell is shown with its numbers and
**cast live**: a small world running the real simulation in an open arena of its
own (every interior cell floor, so no body can stand in a wall), drawn by the
game's own renderer through a second camera — the spell on a key, three rushers
facing the caster (three, so a chain can jump twice), damage numbers and all,
rebuilt every few seconds. A spell that works at the caster's side is shown by
walking it through them and back.

The style reaches the Director's context for every decision, and the rule arm's
rewards: a spell portal picks a school holding a spell of the style half the
time, and a spell offer with no school deals two cards of the style when it has
them.

## What a portal promises

| Reward kind | What the three cards offer |
|---|---|
| stat | an intrinsic upgrade: move speed, dash cooldown, max mana, regen, health |
| spell | a castable, for one of the three keys |
| affix | one of doc 013's modifiers, to attach to a named spell |
| gold | coins scattered on the floor, no cards to choose between |

| Difficulty | |
|---|---|
| normal | a standard encounter, tiers 1 to 3 |
| elite | tiers 4 to 5, and a better roll on the same kind |

Every portal also carries a **grade**, and a spell portal names a **school**,
a stat portal a **family**.

**The grade.** The run's own strength rises with depth (`baseStrength`): I
until room 6, II until room 11, III after. That is the floor the room is
graded about.

- **Each normal portal draws its own grade** (`rollNormalGrades`): one below
  the run's own (20%), the run's own (55%) or one above (25%). The result is
  never below I or past III.
  - The floor under the room: at least one normal portal is at the run's own
    strength. If none drew it, the first one, the most needed, is raised to it.
  - So the doors of one room differ, and one of them can be the find. Choosing
    between a better door and the reward kind the build needs is part of the
    offer.
- **The Director can lean a room up** (`normal_grade`, from room 4 while there
  is a strength above the run's own): raised odds are 5% below, 45% the run's
  own, 50% above. It is a catch-up for a run that is behind. The draw itself
  is code's.
- **An elite portal draws none.** It is always the run's own plus one, so its
  stars say where the run is.

What a grade deals:

| grade | spell | affix | stat | gold |
|---|---|---|---|---|
| 1 | level 1 | tier I | applied once | 8 coins |
| 2 | level 2 | tier II | applied twice | 16 coins |
| 3 | level 3 | tier III | applied twice | 24 coins |

Schools: flame, frost, venom, storm, void, spirit, stone. A school or family on
the portal promises **one card** of it; the other cards are drawn from the
whole pool as any offer's are, so a school of three spells does not deal the
same three cards every time. Families: movement, survival,
mana, sword, three stats each. The badge shows the school or family in its
colour under the portal and the grade as stars, and the prompt reads
"E  ELITE flame spell ★★". A graded-up reward is why an elite portal is worth
taking.

How many portals there are is drawn, not fixed: three 55% of the time, two 35%,
one the rest, and a lone portal is sometimes an elite. A room that always ends in
the same three badges in a row reads as having no randomness at all, and a
choice that is always the same width stops being weighed.

Four reasons this shape is what a portal promises:

- **The badge is informative.** "Affix, elite" is a decision; "combat" is a
  corridor. The thing the player can see is the thing they are choosing between.
- **The three cards are comparable.** With the kind fixed at the portal, the
  cards are three answers to one question rather than one spell, one affix and
  gold — three options that cannot be weighed against each other because they
  are not the same kind of thing. This is Hades' shape: the symbol on the door
  says whose boon it is, and *which* boon is the decision inside the room.
- **Jev gets a question doc 002's shape.** "Which currency should this portal
  offer, given this build" is four options with a reason attached to each:
  categorical choice, no counting, no numeric comparison. "A flame spell" is a
  plan; "a spell" is a lottery ticket.
- **No empty rooms.** Every reward kind sits behind a fight, so the reward is
  always paid for, and no room is thirty seconds of walking. The rooms with no
  fight are not exceptions to this: a vendor or the fountain is what the room is
  *for*, and it is paid for with the fight's reward rather than with a fight.

Two constraints follow. **Difficulty applies only to rooms with a fight**, so
the vendor stop, a fountain room and the boss take none — elite is a
description of an encounter.
And **the stat pool must be build-agnostic**: a portal the player can choose has
to give something usable whatever they are building, or it is a trap for half
the builds in the game. So the pool is movement speed, dash cooldown, maximum
mana, mana regeneration and health, plus the sword-specific ones, which are the
part that is not agnostic and therefore cannot be the whole pool.

## Who answers the portal question

Code draws the portal count and enumerates what is legal (`portalChoices`:
every set of distinct reward kinds of that size, whether an elite is allowed,
whether a grade-up is, whether a vendor is); the **Director** answers, in the
room's round-1 request ("When a room is planned", below); code assembles the
portals (`assemblePortals`). The questions, independent of one another:

| Question | Round | Options | Rule-arm lean |
|---|---|---|---|
| `portal_need` | 1 | one per badge: stat, spell, affix, gold, and the merchant, the blacksmith and the fountain where code allows them | spell for a raw build, affix for a forming one, stat and gold for a formed one; the merchant below a reward the build still needs; the fountain by health alone |
| `elite_portal` | 1 | none, elite (when legal) | elite most of the time with several portals, a third with one; rarely when hurt |
| `normal_grade` | 1 | ordinary, raised (from room 4, while a strength above the run's own is left): whether this room's per-door grade draws lean up | 75 / 25 |
| `spell_school` | 2 | the seven schools, each option naming its spells | half the mass on the schools of the chosen style |
| `stat_family` | 2 | the four families | survival when hurt, mana when the bar spent the fight under the cheapest key, sword when the blade did the damage |

The two promises are asked in **round 2**, and only for the doors the ranking
actually produced: asked in round 1 they were answered for a door two rooms in
three did not have. Which door is the elite one is no longer a question at all
— it is the need distribution restricted to the kinds that won.

Elite is legal from room 3 — the first two rooms are where the player learns
what their build does — never while `health` is `critical`, never within
`ELITE_GAP_FIGHTS` ordinary fights of the last elite room, and at most
`ELITE_ROOMS_MAX` a run. The gap and the cap are what "the elite is the run's
spike" means as a number: the older rule was only "not two in a row", which
over fourteen fights permits seven, and a spike every other room is the run's
ordinary pitch with a badge on it. Both are read from the room the player is
standing in, because these portals decide the next one.
At most one portal is elite, and the elite goes **last**
in the assembled order, so the leftmost portal is never the hard one taken by
accident. Every kind appears at most once, because two portals promising the
same currency is one portal with extra steps. `ruleDoors` and `ruleOffer`
remain as the fallback if the Director cannot answer at all; a failed Jev call
already falls back to the rule table per question (002).

## The fountain

A fountain is a stone basin the player walks to and drinks from with **E**. One
drink restores **50% of maximum health**, capped at full, and the fountain then
stands **dry**: full and dry are two drawings, and the water's three-frame
shimmer stops, so the state is read rather than remembered. A drink at a full
bar is **refused rather than spent** — the prompt says the bar is already full
before the press, and the press does nothing — because a fountain lost to a key
tapped while walking past is a loss the player cannot see happen and cannot
undo.

It is a percentage rather than a fixed amount so that a run which has raised
its maximum gets a bigger drink; a flat figure goes proportionally worthless as
the cap grows, which is the same scale-invariance reason doc 013 gives for the
stat cards.

There are two fountains in a run, and they are the same object.

### The last stop mends, and the player does the mending

The room before the boss holds the merchant, the blacksmith **and a fountain**,
in front of the two of them. Health does not otherwise come back inside a run
and that is the design's tension — but a boss entered on a third of a bar is a
slog no build can prevent, and measured, the runs that lost to the boss arrived
on a third of a bar against the winners' most of one.

The mend is at the stop the player chose to reach, not a room they can choose
to take. It is an **act** rather than a number: the room used to top the bar up
on entry while it was still fading in, so the one moment the run gives back was
a change nobody was looking at. Walking to the basin and pressing E is the same
heal, seen.

### The mid-run fountain is a portal the Director offers

The other is behind a portal, offered as an option of `portal_need` alongside the
two vendors, and it is **the Director's answer to a run that is going badly**
rather than a random roll. Its option is grounded in the labels that say so —
it fits when `health` is `low` or `critical`, and when `recent_damage` is
`heavy` — and the rule arm weights it by health alone: near nothing at a full
bar, where the drink would be refused anyway, and heavier than the escape
option at critical, where a card the run will not live to cast is worth less
than the bar.

The portal **says where it goes**: the fountain's own badge over it and its
name under it, because a room that costs a fight's reward has to be chosen on
purpose.

The hard rules are code's, not the Director's (`portalChoices`):

- never as the only portal, and never straight after another room with no fight
  in it, which would be two rooms in a row where nothing happens;
- at most **one** mid-run fountain a run — a second would make the bar
  something the player tops up rather than the budget doc 001 spends;
- never before room 3, and never from the last fight's doors, which open onto
  the vendors' stop and its own fountain.

It costs a fight and that fight's reward, which is what makes it a decision: on
a full bar it is the worst portal on offer, and one hit from dying it is the
only one.

## Vendor rooms

One portal can lead to a room with the merchant or the blacksmith alone and no
fight, and it is **rarer than any reward**: only between `NPC_FIRST_ROOM` and
`NPC_LAST_ROOM`, never as the only portal, never straight after another room
with no fight in it, at most `NPC_ROOMS_MAX` entered a run, at most
`NPC_OFFERS_MAX` *offered* a run, and never from the last fight, whose portals
open onto the vendors anyway. The window is the honest part of it: a vendor
before it is a shelf the player cannot afford, and one after it is a purchase
the fixed stop is a few rooms from making anyway. A vendor replaces the first *normal*
portal, so the elite one survives it — as the fountain does. The merchant sells
the same one card of each kind as the pre-boss stop; the blacksmith raises a
spell's level. The room costs a fight's reward.

### The early economy

Gold pays for nothing on its own. A run that met its first vendor at room 3 at
best and usually not at all was a run where the gold portal promised a currency
with nowhere to go, which is why it was the door players liked least — and the
answer is not only to pay more for it (007) but to make somewhere to spend it.

So while `build_shape` is `raw` or `forming`:

- **kills pay more.** `createWorld`'s `coinBoost` raises a kill's coin chance,
  ×2 at `raw` and ×1.4 at `forming`, capped at `COIN_BOOST_MAX`. A room of
  twelve bodies goes from about ten gold to about twenty, which is a vendor stop
  over four rooms rather than a second income.
- **the merchant is worth most here.** It is the one place the player
  *chooses* what they get instead of choosing between what they are given,
  which is worth most to a build that has not taken shape; the option is
  grounded on exactly that (007), and it is ranked against the rewards rather
  than against an escape option, so it takes a door only by outranking one.
  It is still bounded by the window and the caps above: worth most is not the
  same as often.

Both are bounded by code and decided inside the bound by the Director: the
multiplier is a cap, and which portals actually lead to a vendor is
`portal_need`'s ranking. The window and the two caps are what the whole thing
sits inside — without them a live Jev run put the merchant on the portal list
in nine rooms of sixteen, and a played run met a vendor three times, which is
not generosity, it is nagging. A vendor badge is now rarer on the offer than
a gold one, which is the shape a roguelike's shop keeps: apart from the fixed
stop, a room with no fight in it is a find.

## Tension (Jev)

`planDoors` asks one question, `next_tension`, when a room **clears**, because
the intended intensity of the next fight is the one decision that reads how the
room just played, and the next room's round 1 reads its answer:

> Choose the intended intensity of the next combat room, within the permitted
> range. After heavy damage lean to release; after fast clears lean to build or
> peak.

Options are `release`, `build`, `peak` and `fallback`, filtered by
`tension_cap`; a single permitted tension is not a decision and is not asked.
Temperature 0.6. `pacingLabels(runState)` produces the caps: `tension_cap`
(peak is disallowed twice in a row, in the **first two rooms**, and in the last
fight), `hazard_cap` (from `recent_damage` and `health`) and `pressure_cap`
(used by 005 to filter encounters; never lowers an elite room below tier 4).

**The opening rooms cannot peak** (`OPENING_ROOMS`). Measured over four
reference runs, room 1 came back `peak` every time on both arms and at high
confidence — correctly, against the state it was given, because nothing has
been measured yet and the unmeasured defaults read as a player on a full bar
who has taken nothing and cleared fast. The state is honest about that now
(002), and an honest state still leaves a judgement call on the first room of
every run that is not a judgement call: the opening rooms are where the player
learns what their build does, and the hardest room the run allows is the wrong
place for it. Same two rooms the elite door is withheld for, same reason.

**A badge shown four offers running leaves the list** (`DOOR_STREAK_CAP`).
This is the bound the Director is given every chance to make unnecessary, and
does not. It is told: the briefing counts how many offers running each badge
has been on and how many times each was offered against walked through (002),
each reward kind's spec says it is not for a run whose badge has been on
several offers running (010), and `DIRECTOR_BRIEF` states the variety principle
and says outright that nothing in code holds it. Measured over eight seeds with
the cap off, the longest same-kind streak was 7 before those facts existed and
10 after them, against 5 with the cap on — telling it louder made it worse.
The fourth offer is therefore where code stops offering the kind, which still
leaves three reward kinds and any vendor on the list. Where the ranking runs
short and code has to fill the remaining doors, it fills from the kind least
recently offered rather than in the order the kinds happen to be written in —
gold was last in that order and reached 2% of every portal shown.

## A note on entry sides

Corridor and ring archetypes support east and west entries only (004), so
leaving a room northward and drawing a corridor behind the next portal means the
player enters from the first supported side clockwise instead. Nothing about the
portals is affected, because the entry is resolved inside room generation and
never reaches a Jev question, but it does mean north-south corridors never
occur.

## Room state machine

```
ENTERING    → player at the portal they arrived through, enemies inactive, 0.5 s
LOCKED      → the room seals; the encounter is handed to the fight
FIGHTING    → encounter waves activate on schedule
CLEARED     → no living enemies AND no pending waves AND no summoner alive
REWARDING   → the reward drop, then the card screen
DOORS_OPEN  → portals rise with their badges; the next room's plans are requested (below)
TRANSITION  → fade, load the committed RoomPlan for the chosen portal, fade in → ENTERING
```

A room with no fight in it — the vendors' stop, a vendor's room or a
fountain's — never enters FIGHTING and goes ENTERING → REWARDING directly.
The clear condition counts pending waves, so a room with waves at 0 s and 2.5 s
cannot clear before the second wave has spawned and died.

## When a room is planned: once, with its offer

A room is planned in **one pass, and its offer is decided in that pass**: the
room's round-1 request carries the portals out of it and the cards in it
alongside space, symmetry and mood (002: questions that read the same state
and do not depend on one another are asked together). Round 2 — zones and
encounter — follows, because it reads the room round 1 generated. Nothing is
re-asked later in the room.

The plan is requested at the **previous room's DOORS_OPEN**, one plan per
portal, in parallel, on the tension `planDoors` set when that room cleared. By then the fight is over and its reward has been taken,
so the state the plan reads is the state the player arrives with: the build is
final, and health does not change on the way, because no room restores it
between a fight and the next. That is what makes one pass enough. A plan asked
during the fight would have read the build before its reward, and the card
pool itself depends on the build — the affixes a held spell can take, the
spells not yet owned — so the offer could not have been asked there.

The plan for the chosen portal is **committed** at TRANSITION; the others are
discarded. At TRANSITION code re-runs the hard rules on the plan once more,
with no Jev call: portal legality (an elite that is not legal becomes a normal
fight of the same kind), `hazard_cap`, the `pressure_cap` band (the assembler
trims the roster until it fits, 005), the charter checks (001) and spawn safety
against the fixed entry. A plan that cannot be trimmed into compliance is
replaced by the `RuleDirector` plan for that portal, and a trimmed plan is
flagged on the room plan page and in the debug sidebar.

| Room | Planned at | Time available |
|---|---|---|
| any room a portal leads to | previous room's DOORS_OPEN, per portal | the walk to a portal, typically 3 to 10 s |
| first room | intent screen submit | up to 6 s visible wait |

If a plan is not back at TRANSITION, that portal uses the `RuleDirector` plan
immediately. The player never waits.

## Exits are portals standing on open floor

An exit is a **portal on the open floor**, placed by the generator away from the
spawn groups and from the other portals, rather than a door cut into the border
wall. The border wall is solid everywhere, which retires a whole class of
collision bug rather than fixing it: a door tile that is not solid is a hole in
the room, and one that is solid with no art is an invisible wall.

Three reasons this is better rather than merely easier:

- **All the options are visible at once**, which is what Sid Meier's objection
  to the blind choice actually asks for. A door at the edge of the camera puts
  the decision behind the player, with one option in comfortable view at a time.
- **They rise in front of the player.** The camera follows the player and the
  room is larger than the screen (doc 008), so the portals are **made when the
  way out opens**, as one straight row inside the view: level or upright,
  three tiles apart, on reachable open floor clear of the zones' hazards, the
  row nearest the spot three tiles ahead of the player, one across their
  facing before one along it. Only a view with no such row takes each portal
  to the nearest open cell to its place. They used to be scattered across the room at
  its start, behind the enemies on the level-design rule that the goal belongs
  across the threat; with the room off the screen that was a search once the
  fight was over, and there is nothing to hide during it if they do not exist
  yet. The badges are read side by side; comparing what is behind them is the
  card screen's job.
- **The fiction it gives up was not being paid for.** Previous rooms are gone
  and there is no map, so the sense of walking through a dungeon was never
  supported by anything. A portal is more honest about the structure that exists.

What the portals need from the rest of the game:

- The generator places 1 to 3 portal cells on open floor, subject to the same
  fairness rules as spawns: reachable, not adjacent to each other, not inside a
  spawn group.
- `entryPosition` is the portal the player arrived through.
- Art: a portal in shut and open states, and the badge above it drawn from the
  **untinted** sheet, so the room's mood cannot recolour a promise about where
  the player is going.
- A shut portal is **not drawn at all**. What the raise has to say is *now there
  is a way out*, and a change of state reads best against nothing; three badges
  hanging over the arena during the fight say it when it matters least.

## The room ends in two beats

1. **The room clears**, and the room gets a beat to itself — about a second,
   long enough for the last death to finish and the dropped gold to fly in. A
   reward object settles **beside the player**, on the reachable open cell
   nearest two and a half tiles from them, under a beam of light, and
   standing by it and pressing E opens doc 007's offer as **three cards in the
   UI**. A gold room instead scatters coins that magnetise in, because there is
   nothing to choose.
2. **Choosing one raises the portals.** Arrows or A/D to select, Enter or J or a
   number or a click to take. Until the offer is answered there is no exit.

**The offer is a screen, not three pickups on the floor.** A reward has to be
**read**, not just seen: an item is a name, a cost, an effect and a sentence of
rules text that doc 010 generates, and none of that fits under a 64 px sprite on
a dungeon floor, which leaves the player choosing between three icons. A card
screen is also where affix text goes. It removes a problem as well: three
pickups have to stand on clear floor, far enough apart that walking near one does
not take it, in a room that may be full of pillars — a card screen has no
geometry.

**Both beats are answered by a key, never by walking into something.** The
player is at their fastest in the seconds after a fight, and a proximity trigger
means the card they happened to run over decides the build, or worse, that
brushing a portal ends the room. The simulation holds only the gate: while an
offer is pending there is no way out.

Splitting the two decisions in time is the point. The build decision is answered
first and alone; the route decision second, with the build already known.
Offering both at once makes each worse, because the player is then choosing a
card partly for where it lets them go. Two further things the beat does:

- **It gives the cleared room something to do.** Doc 014 asks for a trough of 30
  to 45 seconds after each peak; this is what goes in it.
- **The reward rises where the player won.** It was in the middle of the room,
  after the Reward for Risk pattern — a prize in the arena drawing the player off
  the foothold they held; with the room larger than the screen, the middle was
  as often off it, and the prize had to be looked for.

**Declining is taking the gold.** Gating the portals on taking a reward would be
a problem if every offer were a commitment. It is not: gold is one of the four
reward kinds and the safe pick, so gold is the "none of these" answer and it is
already in the pool. No separate decline mechanism is needed.

## Kills and scenery drop small pickups

Killing an enemy or breaking scenery drops hearts and coins, weighted so health
is a relief rather than an income.

- **The bodies worth it pay mana**: one orb for a heavy body, two more for an
  elite, five mana each, magnetised when near. An ordinary body pays nothing:
  an orb on every kill out-earned the sword, which is the supply (013).
- **A kill** also pays per unit of the body's threat weight: a heart at 5%, and
  only while the player has a heart missing, since a heart on the floor the
  player cannot take is a promise that teaches them to ignore the next one;
  otherwise a coin at 35%. An elite always drops two coins.
- **A streak**: a third kill within two seconds of the last, and every kill
  after it, banks extra rage, so clearing a pack fast is how the spin comes
  round.
- **A breakable** pays gold, four pots in five scattering one to three coins. No
  hearts: a heart is something a fight pays. A breakable that pays a quarter of a
  kill is furniture with a health bar, and the player learns to walk past it.

This is DOOM's push-forward principle and it fits the melee turn exactly:
resources placed to reward aggressive positioning. The player has to close to
kill, closing is the risk, and sustain is what closing pays. Nothing else in the
design rewards aggression directly.

**The rate is small, so doc 001's attrition budget keeps meaning something.**
Across a run of 14 fights at roughly five kills each, heart drops offset about a
fifth of the run's attrition — enough to make aggression pay without making the
health bar irrelevant. That is also why healing has to survive somewhere else:
kill drops alone would leave the run a monotonic decline in which two early hits
decide the outcome. `Vigour` in the stat pool and the fountain are what stop
that, and both put recovery against progress at a moment of the player's
choosing: `Vigour` costs the other two cards on its screen, the fountain costs
a fight and its reward.

Two rules about collection, because a pickup that interrupts a dodge is worse
than no pickup:

- **Hearts persist until the room is cleared** and collect on contact, so the
  player never has to stop mid-fight to take one.
- **Coins magnetise to the player once the room clears**, rather than needing to
  be walked over. Sweeping a cleared room for currency is a chore, not a
  decision, and the beat after a fight belongs to the reward choice.

## Experience and levels

Every number on the player's body came from the `stat` door, and a measured
run takes **1.8 stat cards** against 10.7 spell levels and 6 affixes. One of
the thirteen stats is health. So the body a player reached the boss with was
very nearly the body they started the run in, while the ramp (005) took a
body's health to ×1.78 and its damage to ×1.3. Only one side of the fight
was growing, and the side that was not is the one the player *is*.

**Kills pay experience, and levels arrive on their own.** There is no screen
and no choice: the `stat` door is where the player decides what their body
becomes, and a second, more frequent version of that decision would drown it.
A level is the floor under the build rather than a part of it.

### What a body pays is derived from the body

A hand-written number per archetype goes stale the moment a body's health
moves, and there are twenty-nine bodies. So a kill is worth

    round(base health × kit × variant ÷ 4)

read off the roster's own definition (`core/run/levels.ts`).

- **Base health, before the ramp.** A late room already holds more bodies and
  heavier ones; experience that also rode the ramp would make the last levels
  the fastest, which is the opposite of the curve below. The XP table is the
  only brake on the pace of levelling, and a second one would fight it.
- **Kit**, ×1.4 for a body that summons, ×1.2 for one with a pattern or a
  ranged attack, ×1 for a chaser. Health is what a body costs to kill, not
  what it costs to fight.
- **Variant**, ×1.15 for a subspecies: one verb changed (019) is a different
  question and not a bigger one.

That is 5 for a rusher, 8 for a shooter, 9 for a tank, 12 for a warden, 18 for
a summoner. On top of it sit the two multipliers that are about the encounter
rather than the body:

| | |
|---|---|
| an elite body | ×2.5 — the risk the room was built around |
| a body another body put on the floor | **0** — a summoner is an infinite tap, and a run that could farm one would have no curve at all |
| the boss, and anything in its hall | **0** — the run ends there, so a level earned on it is a number on the results screen |
| scenery | 0 |

### The curve is the run's kill counts

A measured fight is 10 to 14 bodies, so 70 to 110 experience. The table is
written against that: **45** to reach level 2, then 85, 130, 180, 235, 295,
360, 430, 505, widening by 85 a level beyond that.

The first entry is inside one room's takings, deliberately — the opening rooms
are where a run is most fragile and where the player has least reason to
believe it is going anywhere, so the first level-up lands in room 1 or 2. The
gaps then climb faster than the takings do, which is the brake: measured on the
fitted `player` profile the run reaches **level 2 in room 1, level 4 by room 4,
level 6 by room 10 and level 7 by room 13**, and the seventh is something a run
has to have cleared well to reach.

### What a level gives

**Five health, one whole point of sword damage, 3% of the bar.** Over six or
seven levels that is the boss met on **90 health instead of 60** and a sword
hitting for **15 instead of 9**, against a ramp that has been taking bodies to
×2.2 health and ×1.65 damage since room 14. On reaching a level the player is
handed back **the health it just added** — not a full heal, which would make
levelling the way out of a bad room, and not nothing, which reads as losing
health while the maximum grows away from the bar.

**Every level moves a number the player can see.** The first version made all
three gains percentages, and the sword's 5% came straight back as a bug report:
"at level 4 the sword still hits 9". It was not wrong, it was invisible — a
swing is 9, damage numbers over a body are whole, and 5% compounding prints 9,
9, 10, 10, 11. Three levels in a row told the player, in the one place they
were looking, that nothing had happened. So the sword's gain is a whole point,
health is five, and the level-up banner names the new figure — "sword 9 → 10" —
rather than a percentage nobody can check. The mana bar is the one percentage
left and it passes the same test by arithmetic: a 90-point staff rounds to 93,
96, 98, 101, 104, 107, so the gauge moves every level too.

Half a heart rather than a whole one so that **the stat cards stay the better
version of the same thing**. `Vigour` is a whole heart, twice a level, taken by
choice at a door the player walked through for it; `deep_well` is six levels of
bar, and `keen_edge`'s 15% passes a level's point as soon as the flat gains
have grown the base it multiplies. A level is what happens anyway; a card is a
decision, and a card the player could have had by waiting is not one.

### Where it lives

In the simulation, so that both callers get it by playing the game. The run
carries one number across the portal — the total — exactly as it carries gold,
rage and the stat modifiers; `createWorld` derives the level from it and folds
it into the body, and the world pays kills and raises levels mid-fight. That is
what makes a headless balance run and a browser run grow the same body at the
same moments, and it is pinned by a test that reads both callers.

**The Director is told the level and nothing acts on it.** It is a fact in the
briefing like the health and the purse, with the term explained in the
briefing's glossary; no question is grounded on it and no option mentions it.

### On screen

A third bar under health and mana, thinner and with no number on it, and the
level in the column the heart and the mana pip stand in. It is the one of the
three that is never urgent, and the only questions it answers are "what level
am I" and "am I nearly there".

**No floating `+N XP` at the corpse.** A kill already puts a damage number
there, a burst, a hitstop and a sound, and a second number over the same body
at the same instant competes with the one that says whether the swing was
enough — at six bodies on the floor it is six more strings in the busiest
half-second of the room. The gain goes to the bar instead, which lights the
band it was just paid: several kills in one beat merge into one wider band by
construction, nothing is drawn over the fight, and the feedback lands where the
player will look for the level rather than where the body fell.

A level itself is a toast on the strip that already announces what was gained,
a burst on the player in the character screen's green — gold is the staff,
green is the body, and the two happen in the same run — and `level_up`, the one
rising figure in the sound set.

### What it cost the rest of the run

A bar half again as large is a run half again as survivable, and more than
that: the fountain at the fixed stop refills half of it and an elite's heal is
a tenth of it, so every source of recovery grew with the maximum. Measured, the
`player` profile went from 45% of runs won to **100%**. The ramp's late bands
answer it — health ×1.52/1.62/1.78 → **×1.75/1.95/2.2** and damage
×1.1/1.2/1.3 → **×1.25/1.45/1.65** over rooms 6–9, 10–13 and 14–15 — and the
boss now takes the boss band's `power` like every other body, which the band
was always written to do ("only the beat is the boss's"). His **health** is
untouched: scaling that would make the fight longer rather than harder, and its
length is 020's. That lands the run back at **55%**, with the boss fight where
nine runs in twenty still end.

## Gold economy

| Source | Amount |
|---|---|
| a coin | 3 gold |
| kill | a coin 22% of the time per unit of threat weight, ×`coinBoost` while the build is unformed |
| breakable | 1 or 2 coins, one time in three |
| a gold portal's room | `GOLD_ROOM_COINS` (16) coins per grade: 48, 96 or 144 gold |
| the gold card | 12 gold a grade |
| a dismantled spell | its value, as coins that burst from it and fly to the player |
| starting gold | 0 |

| Cost | Amount |
|---|---|
| merchant: stat / affix / spell | 20 / 30 / 45 |
| blacksmith: spell level 1→2 / 2→3 | 35 / 60 |

**The vendors' room** holds the merchant, the blacksmith and a fountain, and no
reward pedestal, and its portals are open from the start. It has exactly **one
portal, and it is the boss** (`bossExit`), as the room before it has exactly one
portal and it is this room (`shopExit`); see "Shape of a run". The fountain stands in
front of the two of them, four tiles clear of either, so each of the three has
its own spot and its own prompt. The **merchant** sells one
card of each kind gold can buy — a stat, an affix at base tier, a spell — bought
one at a time for as long as the player can pay, and never the kind of the portal
that led there, since what the player came to do is spend. An affix or a spell is
charged when it lands, so cancelling the character-screen step costs nothing. The
**blacksmith** raises a spell's level on the character screen.

**Dismantling.** A spell card can be taken apart for gold instead of taken (X on
the card screen, or on the replace step with the new spell in hand), so a room
whose spells are all wrong for the build does not force one onto a key: 12 gold
at level 1, 14 more a level, plus 6 per affix tier invested in it. A spell
**replaced** on a key drops on the floor beside the player with its level and
affixes: a tap of E picks it back up, holding E dismantles it for the same
value. A copy of a spell already held levels that spell up instead (013). Affixes are never gold: a full spell can take a
new affix by giving one up, and the one given up is lost.

Inventory: the three spell keys. Taking a spell card on a full set asks **which
of the three spells goes** — on the character screen (doc 013), with the new spell in
hand: the three spells with their affixes down the left, the chosen one's full
card on the right, Enter to put the new spell on that key, or Escape to keep them
all and return to the cards. The affixes on the replaced spell go with it, and
the screen says which.

## Time budget

| Phase | Duration |
|---|---|
| intent screen | 15 to 30 s |
| normal fight | 30 to 60 s |
| elite fight | 60 to 90 s |
| reward beat and card screen | 10 to 30 s |
| the vendors' room | 10 to 30 s |
| a fountain's room | 5 to 15 s |
| boss | 2 to 3 min |
| run | about 20 min (014) |

## End of run

Death or boss victory ends the run. On death the room freezes — the player can no
longer act — and a game-over card offers R to start a new run from room 1 or Esc
for the title. The boss's room offers no reward and raises no portals: the
victory is the end. The summary screen shows the room sequence, the rewards taken
and the final build. Director statistics are shown only outside blind-test mode
(011).
