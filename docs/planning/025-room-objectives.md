---
id: 025
title: Room Objectives
status: proposed
date: 2026-09-28
summary: A quarter of ordinary fights from room 3 on end another way. In a hold room the player survives a set time while the room keeps sending its waves; when the time is up, whatever still stands falls. In a destroy room three marked turrets stand far from the door and from each other on the bare arena, and the room sends its waves again, a set number of times, until all three are down. Code draws the objective from the run's seed, never two rooms running and never in a fixed fight. A door never promises one; the room says it on entry.
depends_on: [002, 003, 014, 022]
---

# 025 Room Objectives

## Why

Every ordinary room ended the same way: kill everything. Two other endings
use the bodies and rooms we already have, and change what the player does in
the room rather than what the room looks like.

## The two objectives

| | Hold | Destroy |
|---|---|---|
| What ends it | `HOLD_MS` survived | the `DESTROY_TARGETS` marked turrets down |
| While it runs | the room's waves come again, `REFILL_GAP_MS` apart, without end | the same, at most `DESTROY_REFILLS` times, so the room can't be farmed |
| When it's met | whatever still stands falls, paying nothing | the same |
| On screen | a banner on entry, and the seconds left | a banner on entry, the turrets left, and a gold mark over each |

A room with an objective is never clear before the objective is met, however
empty it stands (`worldCleared`).

**Destroy rooms are open.** They are built on the first audience's bare arena
(`audience_arena`), so no wall hides the player from the turrets and no wall
hides a turret from the player. The Director's space question is not asked
there.

The turrets stand on the room's spawn cells, each as far as the floor allows
from the door and from the other turrets, with open floor round each.

## Who decides

The objective is drawn by code from the run's seed and the room's place
(`objectiveFor`). Doc 002's rule applies: the Director answers the room's
other questions as usual, and the objective is not one of them.

- Only ordinary combat rooms, from `OBJECTIVE_FIRST_ROOM` (3) on, each at
  `OBJECTIVE_CHANCE` (0.25).
- Never two rooms running.
- Never an elite room, the first audience or the guardian.
- **A door never promises one.** A door promises a reward and a difficulty
  (doc 003). The room tells the player what it asks when they walk in.

## Measured

On `pnpm play rule 30 average`, objectives cost about four of thirty runs
reaching the boss. The harness plays weaker than a player does (doc 024), so
this is accepted.
