---
id: 014
title: Run Length
status: proposed
date: 2026-09-21
summary: A run is fourteen combat rooms, the merchant room and the boss, sized at about twenty minutes. Sets the pacing unit as three nested loops — a 3 second exchange, a 30 to 40 second combat room, a 60 to 80 second room-and-trough cycle — a low-threat beat after every peak as a property of the schedule rather than of the portal the player took, and a reward cadence of one card offer per room against three spell slots, so the slots fill early and the rest of the run is spent on replacement decisions.
depends_on: [001, 003, 013]
---

# 014 Run Length

A run is fourteen fights, the merchant-and-blacksmith room and the boss, and it
is sized at about twenty minutes. Doc 003 carries the room structure; this
document carries the length, the pacing unit the rooms are built against, and
the reward cadence that length buys.

## Twenty minutes, and why that number

Published run lengths for the genre:

| Game | Run length |
|---|---|
| Brotato | 19m15s exactly |
| Nuclear Throne | 2 to 20 minutes |
| Vampire Survivors | 30 minutes on most stages |
| Isaac | 20 min to Mom, 30 to the Blue Womb, about 40 par for a deep run |
| Hades | 20 to 45 minutes |
| Enter the Gungeon | about 45 minutes |
| Dead Cells | 30 to 60 minutes |

The genre sits between 20 and 45 minutes, and this game takes the short end
deliberately. It is a browser game, the roster is eight enemy archetypes and a
boss, and Brotato ships a 19-minute run successfully. Aiming at Gungeon's 45
would require content this project does not have.

## The pacing unit

Three nested loops, after the structure Jaime Griesemer describes for Halo and
Valve's L4D director implements explicitly:

- **3 seconds** — one exchange. A combo, a dodge, a shot.
- **30 to 40 seconds** — one combat room. This is the beat the player
  remembers, and it is long enough to have an arc inside it.
- **60 to 80 seconds** — combat plus its trough. Room, offer, portal, next
  room.

Fourteen of those cycles is roughly 16 minutes, plus the boss and the merchant
visit, which lands at 20.

### Room duration is bought with structure before health

Thirty to forty seconds can come from more enemies, from more waves, or from
enemies that take longer to reach, and these are different games. The measured
hint is that rooms get longer when bullet density falls — elite rooms measure
42 seconds at the current density against 34 at a higher one, with no enemy
added either way — which says
duration is more available through structure than it looks, and that roster
health is the last lever to reach for, because it costs hearts.

Rooms are played in **rounds** (doc 005, Assembly): each round is a fight in
its pressure band on its own, and the next comes once the last has mostly
fallen, so the pause between rounds is the room's own small trough. The
headless reference player's median combat room is 22 seconds (p90 45 s;
build rooms, three rounds, 38 s). It is faster than a person by a factor that
is not measured, so the played figure sits inside the band.

### The trough

Valve's finding is worth adopting verbatim because they state both the rule and
the reason. Their director sustains a peak for 3 to 5 seconds after intensity
crests, then **holds minimal threat for 30 to 45 seconds, or until the players
have travelled far enough**, before building again. Their rationale slide:
"Constant, unchanging combat is fatiguing. Long periods of inactivity are
boring." The conclusion slide is the line to build to: **"Algorithm adjusts
pacing, not difficulty."**

Relief is a property of the schedule, not of the door the player picked. A
portal promises a reward kind and a difficulty, and neither of those is a
promise of quiet, so the rule is positional: after a peak room the next beat is
low-threat, and it ends on either time or spatial progress. The machinery is in
place for it: `pacingLabels` computes a tension cap from health, recent damage
and the last two tensions, `planDoors` asks `next_tension` only within the cap
it is handed, and doc 005's four pressure bands carry the answer into the
roster. What makes the trough a rule rather than an intention is handing the
computed cap to that question instead of a constant, which is step 9 of doc
012.

Bosses are exempt, as they are in L4D, for the reason Booth gives: boss
encounters are meant to change the pacing, so regulating them defeats them.

## Reward cadence

The target is **one meaningful upgrade per 60 to 120 seconds**, which is what
the short-run games converge on. One card offer per room, at one room per 60 to
80 seconds, sits at the fast end of that band — which is affordable because the
offer's kind is the player's choice, so a stat or gold room keeps the cadence
from going silent without spending the scarce thing.

Doc 013 settles on three spells with three affix slots each. The player starts
with `magic_bolt` and the style's second spell, so the third slot fills at the
first spell portal, normally inside the run's opening third. That is
deliberate: the player needs their verbs while they are still learning the
first one, and a run's opening minutes are the ones most easily wasted. From
there a spell card is a **replacement decision** that costs the affixes
invested in whatever it displaces, and that is the half of the run the length
exists to reach.

Fourteen offers is enough to fill three spells and nine affix slots only if the
player spends most of them on one or the other. That is the trade the portals
exist to pose, and it is why the schedule does not split the rewards evenly on
the player's behalf.

For reference, Astral Ascent runs four worlds of twelve rooms and takes 40
minutes to an hour and a half, reviewer-reported, with a build ceiling of four
spells at four modifier slots each. A 20-minute run supporting three spells at
three slots is the same shape scaled down, which is the intent.
