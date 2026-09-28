---
id: 024
title: The Frontier Veteran
status: proposed
date: 2026-09-27
summary: Room 10, the last fight of the flooded depth, is a guardian fight. Beside its ram (twice when the first misses), spray, shove and sweep, it drives stakes up from the floor, three lanes at range or rings round itself up close, and orders volleys: pale lines across the room that unroll and then fire. The Frontier Veteran is the warden's body, drawn larger in a violet light, with a heavy body's poise (doc 027), the warden's blunderbuss and the tank's ram. It has no phases. Its own move is the call. It raises its arm, marks show on the floor, and the dead rise round it; the call can't be broken. Its entrance is the first call, which raises the room's own wave. After that it calls again whenever its squad is down to one and the call has come round. The ram knocks it out on a wall, and a wall is the fight's opening; a burst of hits breaks its poise for a shorter one. The room is the first audience's bare arena, and its doors, reward, pacing and experience follow the audience room's. It stands where the opening view shows it, and its name is the small line over its bar. Code decides all of it; the Director still answers the door's reward.
depends_on: [005, 013, 019, 022]
---

# 024 The Frontier Veteran

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
`idle_bare` drawing for its knocked-out stagger. It is drawn at
`GUARDIAN_SCALE` (2 for now, and it need not be a whole number) with its
collision radius scaled to match. It is tinted violet, with a violet pool
breathing under it and wisps rising round it, so it reads at a glance as more
than the wardens the player has fought since room 6.

**The name.** It was the Drowned Warden, but a gaoler's name sat oddly on a
heavy soldier with a shield and a blunderbuss. It is **the Frontier Veteran**
(边陲老将, 辺境の老将): an old soldier of the border, still at the last post
of the flooded depth, still calling the men who drowned with it.

It is not a new archetype. It is a warden carrying a guardian's state
(`Enemy.guardian`), so the frames, the renderer, the death and the palette
already know it. Nothing assembles it into an ordinary room.

## The fight

| | |
|---|---|
| Bar | `GUARDIAN_HP`, and `GUARDIAN_POWER` on its blows (see "Measured") |
| Poise | `GUARDIAN_POISE` (doc 027): about four hits in a row before one interrupts it, whole again after a pause, and not broken twice running |
| Blunderbuss | the warden's shot: raise, level, a wide spray, then a reload to stand in |
| Ram | the tank's charge from mid range. **A head-on wall knocks it out**: the fight's big opening, set up by standing with a wall behind you |
| Bash | the warden's shield shove, for a player standing on it |
| Sweep | up close, by turns with the shove: the gun swung 210° across its front, heavier and wider than the shove. Behind it, or out of reach |
| Ram twice | a ram that ends without its wall comes round again at once, off the first's recovery. The second is another chance at the wall |
| Stake line (地刺) | every `GUARDIAN_STAKES_EVERY_MS`, at range: the gun's butt driven down, and three lanes fanned at the player drawn on the floor for `GUARDIAN_STAKES_TELE_MS`, then stakes. It stands planted through it and a beat after |
| Palisade | the same turn on a player who has stuck to it: the player's Quake Ring in its hands, larger and violet — three rings of stakes breaking out round it one after another (a hostile `eruptRing`), the ground cracking where each will come up. It hits once however many stakes the player stands in |
| Volley (排枪) | every `GUARDIAN_VOLLEY_EVERY_MS`, its arm up to give the order: five lines from wall to wall at random angles, one through the ground near the player. Each is a thin pale line that unrolls along the way it will fire, then a bolt of light down all of it after `GUARDIAN_VOLLEY_TELE_MS` (1.5 s), a beat apart. It fights on while they come due |

| Call | it plants and raises its arm for `GUARDIAN_CALL_MS`, a violet mark opening on the floor where each body will rise; then they rise. **Its poise is guarded through the call**, so nothing interrupts it |

**The call.** An old soldier who still commands the drowned dead calls them, and the call
is both its entrance and its one move beyond a warden's.

- **Its entrance.** The room opens with it alone across the arena. After
  `GUARDIAN_ENTRANCE_MS` it makes its first call, which raises the room's own
  wave (one wave of the build band, at most `GUARDIAN_ENTRANCE_MAX`). That
  wave never walks in through the room.
- **Again.** It calls again once `GUARDIAN_CALL_EVERY_MS` has passed since the
  last call, and only when its squad is down to `GUARDIAN_CALL_BELOW`. The
  later squad is `GUARDIAN_SQUAD`.
- **The rhythm.** A wall for the long opening, a burst of hits for a shorter
  one. The call is planted and marked, so it is also a window: the player can
  hit it, or get to the marks' side of the room first. It is not invincible
  through the call, and the call can't be interrupted.

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
  Its death also leaves `GUARDIAN_HEARTS` hearts flying to the player, and
  the room leaves a chest (doc 026).
- **It is a peak**, so room 11 is the trough (doc 014).
- **It stands in sight.** It takes the cell farthest from the door that the
  opening view still shows, with room above for its bar and name, so its
  entrance call is seen.
- **Its name** is the small line over its bar, and nothing more: no title
  across the screen, no line of how to fight it.
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
