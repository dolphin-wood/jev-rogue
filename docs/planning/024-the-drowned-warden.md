---
id: 024
title: The Drowned Warden
status: proposed
date: 2026-09-27
summary: Room 10, the last fight of the flooded depth, is a guardian fight. The Drowned Warden is the warden's body, drawn larger and in its own light, with the warden's armour and blunderbuss and the tank's ram. It opens with a squad of ordinary bodies. The ram knocks it out on a wall, which breaks its armour, and a wall is the fight's opening. At 60% of its bar the armour grows back and a second squad comes; from then on a wall slam also throws a ring of broken floor. At 30% it rams twice and fires twice. The room is the first audience's arena, seen whole from the first frame, and its doors, reward, pacing and experience follow room 5's. Code decides all of it; the Director still answers the door's reward.
depends_on: [005, 013, 019, 022]
---

# 024 The Drowned Warden

## Why

Room 5 marks the first seam of the run with the king (doc 022). The second
seam, room 10, between the flooded catacombs and the burnt undercroft, needs
its own marker, and it can't be the king again. So it gets a guardian: a fight
between an elite and the boss, with its own moves, its own bar and phases, on
the elite's rule that no telegraph is ever shortened (doc 019).

## The body

**The warden's body.** It already has every frame the fight needs: the windup,
lunge and recovery its shield bash uses, which carry the ram too; the raise and
release of its blunderbuss; and an `idle_bare` drawing for when its armour is
gone. It is drawn at `GUARDIAN_DRAW_SCALE` (2 for now, and it need not be a
whole number) with its collision radius scaled to match, and in a cold light of
its own, so it reads at a glance as more than the wardens the player has fought
since room 6.

It is not a new archetype. It is a warden carrying a guardian's state
(`Enemy.guardian`), so the frames, the renderer, the death and the palette
already know it. Nothing assembles it into an ordinary room.

## The fight

| | |
|---|---|
| Bar | `GUARDIAN_HP`, and `GUARDIAN_POWER` on its blows (see "Measured") |
| Armour | `GUARDIAN_ARMOUR` from the start. Until it breaks, nothing interrupts it |
| Blunderbuss | the warden's shot: raise, level, a wide spray, then a reload to stand in |
| Ram | the tank's charge from mid range. **A head-on wall knocks it out and breaks its armour**: the fight's big opening, set up by standing with a wall behind you |
| Bash | the warden's shield shove, for a player standing on it |

| Phase | From | What changes |
|---|---|---|
| I | full | the squad it opened with; shot and ram by turns |
| II | 60% | **the armour grows back**, a second squad comes, and a wall slam also throws a ring of broken floor (`shockRing`) |
| III | 30% | it **rams twice**, the second off the first's recovery, and **fires twice** |

**It opens with a squad.** The room's own encounter is one wave of the build
band, so the player meets bodies they know alongside it. They die with it: the
fight is the guardian, and a room that ended on a rusher still standing would
not have ended.

## The room

- **The arena** is room 5's (`audience_arena`): open and bare, with braziers
  and at most one floor feature at its edges, `compact`. The ram smashes
  braziers it runs through, and walls are what stop it.
- **The view** is the whole room from the first frame. His ram and his spray
  cross the room.
- **The doors out of room 9** are never elite, a vendor or the fountain, as the
  doors out of room 4 are (`leadsToFixedFight`).
- **It pays** its door's reward a grade higher and `GUARDIAN_XP`, an ordinary
  room's take, on the kill.
- **It is a peak**, so room 11 is the trough (doc 014).
- **Its name** comes up as the room opens, and its bar is the boss's bar with
  its name, marked at 60% and 30%.
- **The Director** answers the door's reward only (doc 002). The room is the
  run's shape.

## Measured before it ships

| Figure | Target |
|---|---|
| fight length, `average` and `player` | 40 to 60 s |
| hearts lost at room 10 | above an ordinary room's, below 3 |
| runs reaching the boss | not below today's |

## Measured (2026-09-28)

`pnpm guardian-bench` (a three-key build at level 6) and `pnpm play rule 30`.
The first cut, on the warden's own numbers and the room's ramp band, ended
nearly every run at room 10: 5.5 hearts a fight for `player`, and a spray that
cost a whole heart and a burn at a warden's pace. As tuned:

| | |
|---|---|
| `GUARDIAN_HP` | 1000 |
| `GUARDIAN_POWER` | 0.3 of a warden's blows, not the room's ×1.45 |
| `GUARDIAN_FLAME` | 0.4 of a heart a spray hit, and the burn |
| `GUARDIAN_SHOT_EVERY` | twice a warden's 4.2 s |

| | `player` | `average` |
|---|---|---|
| room 10: hearts, seconds | 1.88, 28 s | 2.50, 32 s |
| runs reaching the boss, of 30 | 25 | 10 |
| the same, room 10 a plain fight in the same arena | — | 12 |

The guardian costs about what a hard ordinary room does, and it stops about
two runs in thirty of the `average` profile that the plain room would have let
through.

