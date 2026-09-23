---
id: 003
title: Run Structure and Game Loop
status: proposed
date: 2026-09-21
summary: Fourteen fights, a merchant-and-blacksmith room, then the boss. Every room is a fight; there are no room types. What a portal promises is a reward kind crossed with a difficulty, plus a grade and a spell school or a stat family. Exits are portals standing on open floor, and a room ends in two beats: the offer appears as three cards in the UI, and choosing one raises the portals. Both beats are answered by a key press, never by walking into something. Code enumerates the legal portals, Jev answers per portal, code assembles them; Jev also picks the next room's tension. Defines the room state machine with wave-aware clearing, speculative versus committed plans, prefetch triggers, and the gold economy.
depends_on: [001, 002]
---

# 003 Run Structure and Game Loop

## Shape of a run

```
fight x 14  →  the merchant and the blacksmith  →  boss
```

Sixteen rooms. Rooms 1 to 14 are fights, room 15 holds the two vendors and no
enemies, room 16 is the boss (`RUN_COMBAT_ROOMS`, `stageFor`). Fourteen is doc
014's count: the number a twenty-minute run of 30 to 40 second fights was sized
against.

- Linear progression with branching exits: after a room is cleared **and its
  reward taken**, 1 to 3 portals rise on the open floor, each carrying a badge
  naming what is behind it. The player steps onto one and presses E. Previous
  rooms are gone.
- No map, no backtracking.

**The room type is not a choice. The reward is.** There are no room types to
enumerate. Every room before the vendors is a fight, and what differs between
them, which is what the player chooses at a portal, is two axes:

| Axis | Options |
|---|---|
| reward kind | stat, spell, affix, gold |
| difficulty | normal, elite |

That is the whole taxonomy. Healing lives in the stat pool as `Vigour`
(`+1 heart, filled`): taking it costs the other two cards on that screen, so
recovery is a **trade** made at a moment of the player's choosing rather than a
free stop. Gold has one place to go, the vendors, so the merchant stop is fixed
at the room before the boss rather than something the player could decline into
a run with no way to spend.

Three layers of decision at every portal:

| Layer | Owner | Decides |
|---|---|---|
| What may be offered | code (`portalChoices`) | portal count, legal kind sets, whether an elite is allowed, whether a vendor is |
| Which of the legal answers, per portal, and the next tension | Jev (`planPortals`, `planDoors`) | e.g. "a flame spell behind an elite, a stat, gold" |
| Which portal to enter | player | the visible choice |
| What the room behind each portal contains | Jev, per room | 004, 005, 007 |

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

Every portal also carries a **grade** — 1 ordinarily, 2 or 3 behind an elite
(2 at 65%, 3 at 35%), and 2 a quarter of the time from room 8 — and a spell
portal names a **school**, a stat portal a **family**:

| grade | spell | affix | stat | gold |
|---|---|---|---|---|
| 1 | level 1 | tier I | applied once | 14 coins |
| 2 | level 2 | tier II | applied twice | 28 coins |
| 3 | level 3 | tier III | applied twice | 42 coins |

Schools: flame, frost, venom, storm, void, spirit, stone; a school of two spells
fills the third card from the rest of the pool. Families: movement, survival,
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
  always paid for, and no room is thirty seconds of walking.

Two constraints follow. **Difficulty applies only to rooms with a fight**, so
the vendor stop and the boss take none — elite is a description of an encounter.
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

| Question | Options | Rule-arm lean |
|---|---|---|
| `portal_kinds` | every legal kind set, e.g. `stat+spell+gold` | gold when poor, stat when hurt, spell early, affix later |
| `elite_portal` | none, elite (when legal) | elite most of the time with several portals, a third with one; rarely when hurt |
| `elite_kind` | the four kinds, renormalised over the set chosen | even, gold a little less |
| `elite_grade` | 2, 3 | 65 / 35 |
| `normal_grade` | 1, 2 (from room 8) | 75 / 25 |
| `spell_school` | the seven schools, each option naming its spells | half the mass on the schools of the chosen style |
| `stat_family` | the four families | survival when hurt, mana when mana is tight, sword for melee |
| `npc_room` | none, merchant, smith (when legal) | about one in eight, more with gold to spend |

Elite is legal from room 3 — the first two rooms are where the player learns
what their build does — never immediately after an elite room, and never while
`health` is `critical`. At most one portal is elite, and the elite goes **last**
in the assembled order, so the leftmost portal is never the hard one taken by
accident. Every kind appears at most once, because two portals promising the
same currency is one portal with extra steps. `ruleDoors` and `ruleOffer`
remain as the fallback if the Director cannot answer at all; a failed Jev call
already falls back to the rule table per question (002).

## The last stop mends

The merchant-and-blacksmith room before the boss restores **three hearts**, up
to the cap (`PREBOSS_MEND_HEARTS`). Health does not come back inside a run and
that is the design's tension — but a boss entered on a third of a health bar
is a slog no build can prevent, and measured, the runs that lost to the boss
arrived with 3.6 hearts against the winners' 5.6. The mend is at the stop the
player chose to reach, not a room they can choose to take, and it comes with
the blacksmith, so the stop is where a build is finished before the fight.

## Vendor rooms

Rarely, one portal leads to a room with the merchant or the blacksmith alone and
no fight: never before room 3, never as the only portal, never twice running, at
most twice a run, and never from the last fight, whose portals open onto the
vendors anyway. A vendor replaces the first *normal* portal, so the elite one
survives it. The merchant sells the same one card of each kind as the pre-boss
stop; the blacksmith raises a spell's level. The room costs a fight's reward, so
it is worth taking only with gold to spend — which is exactly when the rule arm
offers it more.

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
(peak is disallowed twice in a row and disallowed in the last fight),
`hazard_cap` (from `recent_damage` and `health`) and `pressure_cap` (used by 005
to filter encounters; never lowers an elite room below tier 4).

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

The vendor room never enters FIGHTING and goes ENTERING → REWARDING directly.
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
| fight or vendor room | previous room's DOORS_OPEN, per portal | the walk to a portal, typically 3 to 10 s |
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

- **All the options are visible at once**, from the middle of the room where the
  fight ended, which is what Sid Meier's objection to the blind choice actually
  asks for. A door at the edge of the camera puts the decision behind the player,
  with one option in comfortable view at a time.
- **A portal can be positioned behind enemies.** The level-design rule is that
  enemies belong between the player and the goal to encourage engagement; a door
  at the player's back cannot be used that way and a floor portal can. Portals
  are therefore **scattered across the open floor**, spread as far apart as the
  room allows, clear of the entry and of the spawn groups — which is also a
  reason to cross the room just fought in. The badges do not need to be adjacent
  to be read, because a badge says only what is behind its own portal; comparing
  options side by side is the card screen's job.
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
   reward object settles on the central floor under a beam of light, and
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
- **The reward in the centre pulls the player off wherever they won** — the
  Reward for Risk pattern, a prize in the middle of an arena drawing the player
  away from the foothold they held during the fight.

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
decide the outcome. `Vigour` in the stat pool is what stops that, and it puts
recovery against progress at a moment of the player's choosing.

Two rules about collection, because a pickup that interrupts a dodge is worse
than no pickup:

- **Hearts persist until the room is cleared** and collect on contact, so the
  player never has to stop mid-fight to take one.
- **Coins magnetise to the player once the room clears**, rather than needing to
  be walked over. Sweeping a cleared room for currency is a chore, not a
  decision, and the beat after a fight belongs to the reward choice.

## Gold economy

| Source | Amount |
|---|---|
| a coin | 3 gold |
| kill | a coin 22% of the time per unit of threat weight |
| breakable | 1 to 3 coins, four times in five |
| a gold portal's room | 14 coins per grade: 42, 84 or 126 gold |
| starting gold | 0 |

| Cost | Amount |
|---|---|
| merchant: stat / affix / spell | 20 / 30 / 45 |
| blacksmith: spell level 1→2 / 2→3 | 35 / 60 |

**The vendors' room** holds the merchant and the blacksmith and no reward
pedestal, and its portals are open from the start. The **merchant** sells one
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
| boss | 2 to 3 min |
| run | about 20 min (014) |

## End of run

Death or boss victory ends the run. On death the room freezes — the player can no
longer act — and a game-over card offers R to start a new run from room 1 or Esc
for the title. The boss's room offers no reward and raises no portals: the
victory is the end. The summary screen shows the room sequence, the rewards taken
and the final build. Director statistics are shown only outside blind-test mode
(011).
