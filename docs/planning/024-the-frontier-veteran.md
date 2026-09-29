---
id: 024
title: The Frontier Veteran
status: proposed
date: 2026-09-27
summary: Room 10, the last fight of the flooded depth, is a guardian fight. Beside its ram (twice when the first misses), spray, shove and sweep, it drives stakes up from the floor, three lanes at range or rings round itself up close, and orders volleys: pale lines across the room, crossing thick round the player, that unroll and then fire while it stands with its arm up and its squad goes to ground. The Frontier Veteran is the warden's body, drawn larger in a violet light, with a heavy body's poise (doc 027), the warden's blunderbuss and the tank's ram. It has no phases. Its own move is the call. It raises its arm, marks show on the floor, and the dead rise round it; poise can't break the call, but a broken stance can. Its entrance is the first call, which raises the room's own wave. After that it calls only once its squad is cleared and the clean guardian window has passed. A burst of hits breaks its poise, an interrupt. Every hit also wears its stance, a gold bar under its health. Worn through, the stance breaks and it goes to its knees, stunned, taking more from every hit: the fight's big payoff. The ram knocks it out on a wall and wears the stance deep. The room is the first audience's bare arena, and its doors, reward, pacing and experience follow the audience room's. It stands where the opening view shows it, and its name is the small line over its bar. Code decides all of it; the Director still answers the door's reward.
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
| Poise | `GUARDIAN_POISE` (doc 027): about four hits in a row before one interrupts it, whole again after a pause, and not broken twice running. An interrupt, never a stun: no stars |
| Stance (架势) | `GUARDIAN_STANCE` (300): a gold bar under its health that every hit wears, a poise break `GUARDIAN_BREAK_STANCE` of it more and a wall `GUARDIAN_WALL_STANCE`. It flashes as it nears full. Left alone for 3 s it steadies, 30 a second. **Worn through, it is broken**: on its knees for `GUARDIAN_BROKEN_MS` (3.2 s) with stars over its head, whatever it had in hand dropped (a call goes unanswered), taking `GUARDIAN_BROKEN_TAKEN` (×1.5) from every hit, with a gold ring, sparks, and a long hitstop. The bar then drains with the time left. About eight seconds of a room-10 build's steady damage, so two or three breaks a fight |
| Attack window | after every complete action, `GUARDIAN_ACTION_GAP_MS` (1.8 s) disables every attack family together. A ready fire shot, ram, stake drive or volley cannot fill another move's recovery; this is the player's guaranteed damage window |
| Blunderbuss | the warden's shot: raise, level, a wide spray reaching `GUARDIAN_ATTACK_RANGE_MULT` as far and `GUARDIAN_MUSKET_SPREAD_MULT` as wide, then a reload to stand in |
| Ram | the tank's charge from mid range, launched at full speed with no acceleration buffer. Its current travel is about 204 px, 20% shorter than the earlier 255 px run. It ends in a hard brake and the authored backward-leaning recovery frame, not a held thrust. The Veteran's charge has no sector overlay; its short hitstop and camera thump give the launch weight. **A head-on wall knocks it out**: the fight's big opening, set up by standing with a wall behind you |
| Bash | the warden's shield shove, for a player standing on it, with the veteran's melee reach scaled by `GUARDIAN_ATTACK_RANGE_MULT` |
| Sweep | up close, by turns with the shove: the gun swung 210° across its front, heavier and wider than the shove, with the veteran's melee reach scaled by `GUARDIAN_ATTACK_RANGE_MULT`. Behind it, or out of reach |
| Ram twice | a ram that ends without its wall can come round again only after the same shared 1.8 s attack window. The second is another chance at the wall without reading as a continuous charge loop |
| Stake line (地刺) | every `GUARDIAN_STAKES_EVERY_MS`, at range: the gun's butt driven down, and three lanes fanned at the player drawn on the floor for `GUARDIAN_STAKES_TELE_MS`, then stakes. Their original reach and spacing stay intact, so the warning does not become sparse. It stands planted through it and a beat after |
| Palisade | the same turn on a player who has stuck to it: the player's Quake Ring in its hands, larger and violet — three rings of stakes breaking out round it one after another (a hostile `eruptRing`). Every future stake gets a visible violet floor footprint for the full 1.2 s tell, brightening in ring order. Its original radii and cells stay intact; the warning is the hit geometry. It hits once however many stakes the player stands in |
| Volley (排枪) | every `GUARDIAN_VOLLEY_EVERY_MS`, it turns on the player and raises its gun to give the order, the muzzle burning white, flickering, and flaring as each line fires. Nine thin lines out of the room's walls, edge to edge and through whatever stands in the room, **all crossing within two and a half tiles of the player** at angles spread round the clock, one through the player's feet. Thin and many, so the room reads as lanes, not walls. Only a line's white core hits, and only when it reaches the player's middle (`BEAM_GRAZE`): a graze passes. The glow round it falls off in layers into the floor, wider than what hits, never narrower. They cross thick where the player stands and part as they go, so the answer is to move out along a gap. Each runs out of the screen in 0.2 s, is held for the rest of `GUARDIAN_VOLLEY_TELE_MS` (2 s), and then fires: the whole line lit at once, white on a warm glow, gone like lightning. A beat apart. **It stands with its arm up until the last has fired** (`GUARDIAN_VOLLEY_MS`), and **its squad goes to ground**: each body sinks into the floor, a violet mound where it went down, untouchable and doing nothing, and rises again as a spawn does once the last line has fired. The player reads the lines and nothing else |

| Call | it plants and raises its arm for `GUARDIAN_CALL_MS`, a violet mark opening on the floor where each body will rise; then they rise. **Its poise is guarded through the call**, so a burst does not interrupt it; a broken stance drops it, and it calls again `BROKEN_CALL_RETRY_MS` later |

**The call.** An old soldier who still commands the drowned dead calls them, and the call
is both its entrance and its one move beyond a warden's.

- **Its entrance.** The room opens with it alone across the arena. After
  `GUARDIAN_ENTRANCE_MS` it makes its first call, which raises the room's own
  wave (one wave of the build band, at most `GUARDIAN_ENTRANCE_MAX`). That
  wave never walks in through the room.
- **Again.** It calls again once `GUARDIAN_CALL_EVERY_MS` has passed since the
  last call, and only after its squad is completely gone (`GUARDIAN_CALL_BELOW`).
  While any add lives the clock cannot fall below `GUARDIAN_CALL_CLEAR_GRACE_MS`,
  so clearing the last one always earns a clean window on the veteran. The later
  squad is `GUARDIAN_SQUAD`.
- **The rhythm.** A burst of hits for an interrupt; staying on it for its
  knees; a wall for the surest way there. The call and the volley are
  planted, so they are windows too: the player can hit it through the call,
  or get to the marks' side of the room first, and a player who finds a gap
  on its side of a volley can hit it standing. A stance worn through in the
  call drops it.

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
- **Its music** is the room score played at `VETERAN_MUSIC_RATE` (1.045), a
  slight pitch and tempo lift that adds tension without turning it into the
  king's theme.
- **The Director** answers the door's reward only (doc 002). The room is the
  run's shape.

## Measured before it ships

| Figure | Target |
|---|---|
| fight length, `average` and `player` | 40 to 60 s |
| hearts lost at room 10 | above an ordinary room's, below 3 |
| runs reaching the boss | not below today's |

## Measured (2026-09-30)

`pnpm guardian-bench <profile>`: a three-key build at level 6, eight seeds.
The first cut, on the warden's own numbers and the room's ramp band, ended
nearly every run at room 10 (5.5 hearts a fight for `player`). It was then cut
back so far that played runs took no damage from it at all. Three logged runs
lost nothing in room 10 and felled it in 21 to 33 s. The bench's `expert` lost
half a heart, so a player plays at or above `expert`. As tuned now:

| | |
|---|---|
| `GUARDIAN_HP` | 2000, for a fight of about half a minute to a minute |
| `GUARDIAN_POWER` | 0.7 of a warden's blows, not the room's ×1.45 (a ram costs a heart) |
| `GUARDIAN_FLAME` | 0.6 of a heart a spray hit, and the burn |
| `GUARDIAN_SHOT_EVERY` | 2.8 times a warden's 4.2 s |
| `GUARDIAN_ACTION_GAP_MS` | 1.8 s shared rest after every action |
| `GUARDIAN_STAKES_EVERY_MS` | 8 s |
| `GUARDIAN_VOLLEY_EVERY_MS` | 16 s, so a fight sees two |

| profile | won | mean | hearts lost a fight |
|---|---|---|---|
| `expert` | 8 / 8 | 26 s | 1.3 |
| `player` | 8 / 8 | 34 s | 2.2 |
| `average` | 8 / 8 | 46 s | 4.7 |
| `novice` | 0 / 8 | 89 s | the run |

It is the run's second-hardest room. A good player pays a heart or two, and
an average one a real share of the bar. `novice`, which already lost six
fights in eight at the lighter tuning, does not get past it. The two hearts
its death leaves (`GUARDIAN_HEARTS`) are the heal toward the last stretch.
