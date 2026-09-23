---
id: 015
title: Room Geometry for Melee
status: proposed
date: 2026-09-21
summary: What a melee fight needs from room geometry, and the metrics that price it. Melee does not want mazing: geometry matters because ranged threats are present, and melee arenas stay largely open because obstacles obstruct the player's swing and movement more than the enemies'. Every one of the twelve archetypes has a clear run the full 19-tile interior width, which is closer to right than wrong; what the geometry lacks is variety in the width profile, footholds the player can back into, convex corners rather than pillar counts, and a spread of times-to-contact. Defines the melee metric set with formulas from the dungeon-room PCG literature, the enemy-composition limits that do more work than arena shape, and the pillar-versus-pit asymmetry that reprices the whole roster.
depends_on: [001, 004, 005, 013]
---

# 015 Room Geometry for Melee

## Why geometry matters at all

**Geometry matters because of the ranged half of the roster, not because of the
swing.** Doc 013's decision to keep ranged enemies is what makes any of this
load-bearing: without them, none of it matters.

Mike Stout, quoted in The Level Design Book:

> "Far Enemies are super simple, they're just dudes that shoot at you. But
> they're very interesting because environment matters. When you have Near
> Enemies, since they can't attack you from far away, your environment doesn't
> matter at all: you got them up on a ledge, behind cover — it's all the same
> as fighting on a flat plane."

Bart Vossen's interview study, covering developers from God of War 3 and The
Last of Us, converges independently: melee arenas should be **largely empty and
flat**, and his interviewees' concrete complaint is that "for a melee based
game, if you're trying a big combo and [get interrupted as] you bump into a
waist-height wall, it's really frustrating." His recommendation for making
level design matter in melee is **not more obstacles** but more interaction:
hazards, knockback targets, destructibles, enemy-driven terrain change.

So a melee arena stays largely open, and an obstacle earns its place by what it
does to the fight rather than by how much of the floor it takes.

### Obstacles help the player; a single central obstacle does not

From the design analysis of Zelda 1's dungeons:

> "The player fights five Stalfos in Room 3, but the two blockers in the room
> make it much easier to avoid them. Then, later, when the player fights three
> Stalfos in Room 4, the setup is harder, because there is only one large
> blocker in the center of the room" — and "it obstructs your movement more
> than the enemies."

Two things follow. **More obstacles made the larger enemy count easier**,
because they gave the player lanes to disengage down. And **a single central
obstacle is the hardest configuration**, because it constrains the player
without constraining the enemies.

A central pillar scores well on `pillar_count` and is close to the worst thing
the generator can produce, which is why the melee set below counts **convex
corners** instead: the cover metrics price what blocks a bullet, and say
nothing about what the player can stand behind or swing against.

## What the twelve archetypes measure

All twelve playable archetypes, four seeds each, mirrored and entered from the
south. Interior is 19 by 11, so 209 tiles. `open %` is the share of the
**mask's** floor left clear, so a corridor at 100 carries no obstacles inside
its band while its mask walls still count in the last column: pillars block
movement exactly as walls do, so that column counts everything solid inside the
border.

| archetype | open % | pillars | widest clear run | rows ≤3 wide | solid interior |
|---|---|---|---|---|---|
| open_arena | 92 | 0.0 | 19.0 | 0.0 | 16 |
| scattered_arena | 85 | 3.5 | 19.0 | 0.0 | 31 |
| pillared_arena | 85 | 7.0 | 19.0 | 0.0 | 32 |
| tight_arena | 80 | 7.0 | 19.0 | 1.3 | 41 |
| long_corridor | 100 | 0.0 | 19.0 | 4.0 | 52 |
| broken_corridor | 90 | 3.5 | 19.0 | 3.0 | 68 |
| gallery | 89 | 6.0 | 19.0 | 4.0 | 70 |
| choked_corridor | 82 | 3.0 | 19.0 | 2.0 | 81 |
| open_ring | 100 | 0.0 | 19.0 | 0.0 | 35 |
| cover_ring | 89 | 7.5 | 19.0 | 0.0 | 55 |
| cross_open | 98 | 3.0 | 19.0 | 0.0 | 64 |
| cross_tight | 84 | 6.3 | 19.0 | 0.0 | 84 |

`pnpm exec node --experimental-strip-types packages/harness/src/cli/measure-rooms.ts`
prints it. Every archetype has a widest clear run of 19 tiles, the room's full
interior width. Rows narrow enough to be a chokepoint run between zero and
four, and are zero in seven of twelve.

An open room is what the melee literature asks for, so this table is closer to
correct than not. Three things are genuinely wrong with it, and none of them is
openness.

**One: no archetype is characterised by its width.** All twelve share the same
maximum, so `choked_corridor` and `open_arena` differ in how much is solid and
in how much of the floor is tight — the share of walkable tiles with less than
one reach of clearance runs from 41% in `open_arena` to 65% in `gallery` — but
not in how wide the widest lane is. Dead Cells is the counter-example with a designer's statement
behind it: its sewers biome has "tight spacing that restricts the ability to
jump and dodge and forc[es] the player to think about their mob management",
which is a deliberate per-biome width decision.

**Two: the footholds are all border.** A foothold is a tile with three or fewer
open approaches, somewhere the player can back into and be attacked from fewer
directions, and between 35% and 55% of walkable tiles qualify — but in the open
archetypes they are the wall ring and little else, so backing into one means
leaving the middle of the room entirely. Hades' Tartarus chambers
are "almost always completely walled in, making it forgiving for players
learning about the Cast while providing extra Wall Slam damage" — walled-in is
stated as *forgiving*, and as a player damage bonus.

**Three: the room has more empty middle per unit of reach than Zelda's does.**
Link's sword covers roughly one tile against a 16-tile room width, about 6%.
An arc of 1.8 tiles against a 19-tile interior is about 9.5%. Proportionally
slightly longer — but our room holds about 2.4 times the tiles. The
consequence is that there is more floor in which nothing is within reach of
anything, and the answer to that is **either a smaller effective fighting zone
or obstacles that compress enemies toward the player**, not obstacles that
lengthen the path.

## The metrics a melee room is scored by

Grouped by what they are for. Formulas and provenance are given where the
metric comes from published work; the synthesis into this set is not itself
sourced. `R` = 1.8 tiles, the arc's reach — doc 013's `BLADE_REACH` plus its
base spread. The melee-specific and structural metrics live in
`packages/core/src/rooms/melee-metrics.ts` and are printed per archetype by
`pnpm melee-rooms`, so the gap between what the generator optimises and what a
swing cares about is visible rather than argued about.

### Melee-specific

**Time-to-contact spread.** Geodesic distance over the walkable graph from the
player's entry tile to each enemy spawn, converted to seconds by enemy speed.
The target is a **spread, not a value**: some enemies arriving inside a second,
some at three, so that an approach order exists to be chosen. Related to
*average eccentricity* in the FPS MAP-Elites descriptor set.

**Detour ratio** = geodesic over Euclidean distance, averaged across entry to
each spawn. This is mazing, quantified. **The target is low, about 1.1 to 1.3.**
1.0 is a bare floor; above 1.5 is a maze and fights the swing.

**Arc yield.** For each walkable tile and each of the four facings attacks snap
to, the number of walkable tiles inside the arc sector of radius `R`; the
reported number is the **mean** across tiles, because at a reach of 1.8 tiles
the sector covers the adjacent ring and nothing further, so the whole range is
1 to 3 and the 90th percentile is 3.0 for every archetype — a number that
reports nothing. The mean asks what the typical tile pays, which is the
question whose answer differs between rooms; `arcYieldBest` keeps the
percentile. High where a wall or corner backs the player. **This is the only
metric that prices a free arc swing at all**, and it is the formal version of
the technique MMO players call body blocking or corner pulling: using geometry
to stack melee attackers into a line in front of a wide swing.

**Local width field.** Distance transform of the walkable mask giving per-tile
clearance, reported as a histogram: the fraction of walkable tiles with
clearance below `R`, between `R` and `2R`, and above `3R`. This is what
"narrow relative to reach" means operationally, and **a deliberate mix across
rooms is the point** rather than any single target.

**Encircleability, and footholds.** Per walkable tile, the count of open
approach directions. Tiles with three or fewer are footholds. A room with no
footholds is an always-surrounded room. Grounded in the Foothold pattern and
in Tartarus being walled-in on purpose.

**Wall adjacency of the fighting area.** The fraction of enemy-reachable floor
within one tile of a wall. If knockback into a wall does damage, this is
literally the player's damage multiplier map.

### What the ranged half needs

**Longest sightline, and visibility statistics** — mean, max, and the count of
local maxima, computed from a visibility matrix. Taken verbatim from the FPS
MAP-Elites descriptors. Ranged enemies need a sightline to threaten; spells
need one to be useful.

**Convex corner count.** Convex corners are what afford stepping out,
attacking, and stepping back. A free-standing pillar contributes four; a wall
alcove contributes two. Counting corners rather than pillars separates
arrangements that `pillar_count` reports as identical.

**Obstacle perimeter over area.** Separates one fat blob from several thin
walls at identical `open_ratio`, which the current metrics cannot distinguish.

### Structural, as constraints rather than objectives

- **Chokepoint count**, as articulation points or small min-cuts on the
  walkable graph. The literature calls these forced collision points. For a
  room this size the target is **0 to 2, and 0 should be common.**
- **Loop count**, as the number of solid regions entirely enclosed by reachable
  floor — obstacles the player can run all the way around. Counting independent
  cycles in the walkable graph instead measures **area**: on a four-connected
  grid every 2 × 2 patch of floor is a cycle, so an empty arena scores in the
  hundreds. Zero loops means the player can never circle out of a corner, which
  matters because the fastest body runs at 80% of the player and running is
  therefore not an escape. Where a layout has none, the generator places one —
  the kiting obstacle (004) — which lands in nine archetypes of twelve.
  `long_corridor`, `broken_corridor` and `choked_corridor` leave it nowhere
  free-standing to go and still measure zero.
- **Reachability**, and **no spawn within reaction distance of the entry tile**.
  Both hard constraints. Enemies spawning on or beside the player is named
  repeatedly as bad design, and flanking by movement is fine where flanking by
  spawning is not.

### Reusable formulas from the literature

The closest published system is the Evolutionary Dungeon Designer's
constrained MAP-Elites work, which defines seven feature dimensions for a
single room with formulas, including symmetry as
`highestSymmetricValue / totalWalls`, linearity as
`1 − AllPathsBetweenDoors / (#spatialPat + #NeighborsPerDoor)`, and leniency.
Its structure is worth copying above any individual formula: fitness is
**half inventorial and half spatial**, where inventorial is the quality of what
is in the room relative to its doors and target ratios, and spatial is the
quality and distribution of chambers, corridors and connectors. What is in the
room and how the room is shaped are scored separately and then combined.

Its pattern vocabulary is also the one this project lacks: **micro-patterns**
are treasures, enemies and walls; **meso-patterns** are treasure rooms, guard
rooms and ambushes; **spatial patterns** are chambers, corridors, connectors
and empty space.

**The strongest recommendation in the literature is against geometry proxies
altogether.** Cardamone and colleagues evolved FPS maps against "the players'
average fighting time" — a simulated outcome, not a geometric property — and
the objective-metrics survey work reaches for agent-based measures such as the
count of A\* nodes expanded off the optimal path. This project already has the
apparatus: the play harness runs a scripted reference player headlessly.

**The cheap, high-value simulated metric here is time-to-first-contact and
time-to-clear for the reference player, plus how many distinct approach orders
succeed.** A room where one order works is a puzzle; a room where every order
works equally is flat. Two or three viable orders at different costs is the
operational form of Stout's rule that every setup should ask the player a
question. *That last target is an inference, not a published rule.*

## Enemy composition, which does more work than geometry

Both the practitioner literature and Vossen's interviews put enemy mix above
arena shape, and the numbers are specific enough to use directly.

| Enemy types in one encounter | Reads as |
|---|---|
| 1 | Tutorial or rest; a type in isolation |
| 2 | Regular; two types working together |
| 3 | Complex; hard to manage the relationships |
| 4 | Brawl; the player perceives two factions |
| 5+ | Slaughter; the player focuses on a subset and ignores the rest |

Vossen's interviews independently land on **three to four types maximum**, with
the note that mixing more increases cognitive load and makes difficulty
unpredictable, and that **a new enemy type needs its own introduction
encounter with room to learn in** before appearing in combinations.

Doc 005's encounter profiles are built on composition labels and a pressure
budget, so this table is directly expressible there, and the introduction rule
is a sequencing constraint doc 003 can carry.

Two placement rules worth stating as hard constraints:

- **Melee-only groups are boring**, stated flatly in the source. Given that
  doc 013 makes the player melee-primary, this is the rule most at risk of
  being violated by accident.
- **A ranged enemy needs terrain that holds it apart**, which is the
  shipped top-down version of Stout's Far-on-a-ledge: Hades' Witches' Circle
  puts ranged Spreaders on outer islands across a magma moat with two pillars
  as their projectile cover and the player on a central island, so the player
  must choose between chip damage while clearing what is adjacent, or crossing
  to silence the ranged.

## Two room shapes worth generating as named archetypes

The single sharpest lever in the research is an asymmetry:

**A pillar blocks ranged attacks and does not block melee. A pit blocks melee
and does not block ranged.**

The first is documented from WoW arena play, where "melee auto attack 'white
hits' goes through pillars" while casters lose line of sight. The second
follows from pathing: a charger cannot cross a gap that a projectile crosses
freely.

So the two configurations reprice the entire roster in opposite directions. A
pit-ringed island makes melee enemies pathing-constrained and ranged enemies
dominant; a pillared room does the reverse. **This is worth generating as two
named archetypes rather than as a point on a continuous obstacle-density
axis**, because the continuous axis cannot express it. *This framing is an
inference rather than a sourced claim, but the two component facts are both
sourced.*

## Hazards and pits, as actually shipped

- **The player can fall in, and it costs a little.** Hyper Light Drifter: a
  fall does one point of damage and is non-lethal. Death's Door: a pit "will
  claim a hit" against a four-point health bar. Neither is instant death for
  the player, and that is the dominant convention.
- **The player must not fall in by accident.** Hyper Light Drifter is
  deliberately generous about edges so unintended falls are rare.
- **Hades chose a soft hazard over a pit.** Magma is damage over time with a
  grace period and a dash exemption; it hurts everyone including enemies; and
  there is no evidence that knocking an enemy into it is an instant kill. The
  reliable geometry payoff is the wall slam instead, which is a damage bonus
  rather than a kill.
- **Hazard terrain is an enemy-roster decision, not decoration.** Because
  Asphodel is islands in magma, every Asphodel enemy was given its own way of
  crossing it — hopping, floating, dashing — rather than bridges being added,
  which made that biome's enemies markedly more mobile than Tartarus's.
- **Pit kills eat drops.** Hyper Light Drifter players report losing upgrade
  drops to enemies falling in. Either drop loot at the pit edge or accept that
  pits punish the player for using them.
- **Player knockback needs invulnerability during it**, and must not chain.
  Zelda 1 violates this — Link can be knocked into a second enemy and take a
  second hit — and the historical disaster case is long uncontrollable
  knockback combined with bottomless pits.

## One technique to copy directly

In A Link to the Past's first combat room, the alcove opposite the player is
almost exactly the length of the knockback caused by one player attack. The
room is dimensioned to teach a mechanic's magnitude.

**Sizing a feature to equal one knockback length** is a cheap, transferable
technique and it is the kind of thing a generator can do deliberately once
knockback distance is a known constant.

## Calibration numbers

| | |
|---|---|
| Our interior | 19 × 11 = 209 tiles |
| Isaac normal room | 15 × 9 with walls, 13 × 7 usable, 90 grid objects maximum |
| Our room against Isaac's | about 2.3 times the cell count |
| Zelda 1 dungeon playfield | 16 × 11 tiles of 16 px, interior 12 × 7 |
| Dead Cells monster budget | one monster per five combat tiles; a dangerous monster counts as ten tiles |
| Detour ratio target | 1.1 to 1.3 |
| Chokepoints per room | 0 to 2, commonly 0 |
| Enemy types per encounter | 3 to 4 maximum |

Zelda 1's enemies snap to a 16 px lattice while Link moves on 8 px, so enemies
occupy a coarser grid than the player. That is a spacing-relevant asymmetry and
it is cheap to reproduce.

## What is not known

- **No published arena dimensions** for Hades, Hyper Light Drifter, Death's
  Door, Tunic or Wizard of Legend. Only Isaac and Dead Cells give real numbers.
- **No Nintendo statement** on Zelda 1's combat room geometry, or on why pots
  are breakable. The Iwata Asks material covers dungeon structure only.
- **No academic PCG work evaluating melee arenas specifically.** The metric
  literature is shaped by shooters, strategy maps and dungeon topology.
- **The games that shipped a coupling between corridor width and melee weapon
  value largely regressed away from it.** Dark Souls weapons bounce off walls,
  and the community reading is that it produced jank rather than tactics. If
  narrow corridors are to change the arc's value here, the mechanism should be
  **how many enemies can reach the player at once**, which is a pathing
  effect, not a swing collision.
