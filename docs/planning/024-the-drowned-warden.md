---
id: 024
title: The Drowned Warden
status: proposed
date: 2026-09-27
summary: Room 10, the last fight of the flooded depth, is a guardian fight. The Drowned Warden is the warden's body, drawn larger in a violet light, with the warden's armour and blunderbuss and the tank's ram. It has no phases. Its own move is the call. It raises its arm, marks show on the floor, and the dead rise round it, with its armour back. Its entrance is the first call, which raises the room's own wave. After that it calls again whenever its squad is down to one and the call has come round. The ram knocks it out on a wall, which breaks its armour, and a wall is the fight's opening. The room is the first audience's bare arena, and its doors, reward, pacing and experience follow the audience room's. Its bar is over its head, and on entry the room shows its name and one line of what to do. Code decides all of it; the Director still answers the door's reward.
depends_on: [005, 013, 019, 022]
---

# 024 The Drowned Warden

## Why

Room 5 marks the first seam of the run with the king (doc 022). The second
seam, room 10, between the flooded catacombs and the burnt undercroft, needs
its own marker, and it can't be the king again. So it gets a guardian: a fight
between an elite and the boss, with its own move and its own bar, on the
elite's rule that no telegraph is ever shortened (doc 019). **It has no
phases.** Phases, roars and a name across the screen are the king's. On an
elite they are more ceremony than the fight carries.

## The body

**The warden's body.** It already has every frame the fight needs: the windup,
lunge and recovery its shield bash uses, which carry the ram too; the raise and
release of its blunderbuss, whose raised arm is also its call; and an
`idle_bare` drawing for when its armour is gone. It is drawn at
`GUARDIAN_SCALE` (2 for now, and it need not be a whole number) with its
collision radius scaled to match. It is tinted violet, with a violet pool
breathing under it and wisps rising round it, so it reads at a glance as more
than the wardens the player has fought since room 6.

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

| Call | it plants and raises its arm for `GUARDIAN_CALL_MS`, a violet mark opening on the floor where each body will rise; then they rise, and **its armour is back** |

**The call.** A warden who commands the drowned dead calls them, and the call
is both its entrance and its one move beyond a warden's.

- **Its entrance.** The room opens with it alone across the arena. After
  `GUARDIAN_ENTRANCE_MS` it makes its first call, which raises the room's own
  wave (one wave of the build band, at most `GUARDIAN_ENTRANCE_MAX`). That
  wave never walks in through the room.
- **Again.** It calls again once `GUARDIAN_CALL_EVERY_MS` has passed since the
  last call, and only when its squad is down to `GUARDIAN_CALL_BELOW`. The
  later squad is `GUARDIAN_SQUAD`.
- **The rhythm.** Wall, broken armour, the window, then a call that puts the
  armour back. The call is planted and marked, so it is also a window: the
  player can hit it, or get to the marks' side of the room first.

**Its squads die with it.** The fight is the guardian, and a room that ended
on a rusher still standing would not have ended.

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
- **On entry** the room shows its name, small and high, and one line of what
  to do: it calls the dead, and a ram into a wall breaks its armour. It never
  gets the king's great name.
- **Its bar** is over its head, with its name and no marks. The bottom bar is
  the king's alone.
- **The camera** stays the room's usual close one: at twice a warden's size
  it fits.
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

These were later raised back to 1300, 0.5 and 0.6. Real play showed the harness is weaker than a player (a player clears the unchanged main build almost every time), so a harness loss is a relative figure, not a limit.

| | `player` | `average` |
|---|---|---|
| room 10: hearts, seconds | 1.88, 28 s | 2.50, 32 s |
| runs reaching the boss, of 30 | 25 | 10 |
| the same, room 10 a plain fight in the same arena | — | 12 |

The guardian costs about what a hard ordinary room does, and it stops about
two runs in thirty of the `average` profile that the plain room would have let
through.

## Measured (2026-09-28, no phases)

With the phases gone and the call in their place, on the same numbers:

| `pnpm guardian-bench` | won | mean | hearts left of 6 |
|---|---|---|---|
| `player` | 8 / 8 | 32 s | 2.5 to 5.2 |
| `average` | 7 / 8 | 42 s | 0 to 3.4 |
