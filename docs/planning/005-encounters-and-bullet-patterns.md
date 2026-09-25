---
id: 005
title: Encounters and Bullet Patterns
status: proposed
date: 2026-09-21
summary: Fifteen enemy archetypes from four movement behaviours, each with an elite form that is a different attack, and the attack kinds that answer them — blades, a lightning strike, thrown fire, and a bullet-pattern DSL with defined timing semantics. Encounters are assembled, not authored: Jev picks an encounter profile as five semantic parameters against the generated room; code assembles waves under a pressure budget, measures, retries, falls back to tiered presets. Elite rooms layer a code-drawn affix set. The boss is authored — three health-threshold phases and five signature moves (slam, quake, leap, hook, adds) — because a boss is the one encounter where illegibility ends a run. Bullet cap policy is defined once here.
depends_on: [002, 003, 004]
---

# 005 Encounters and Bullet Patterns

## Stance

Enemies are data: a movement behaviour, an attack and stats. Encounters are **assembled, not authored**: the same principle as rooms (004). Jev says what the fight should feel like as a few label choices; code builds the concrete waves to a pressure budget and verifies by measurement. The boss is the one exception, and the reason is at the bottom of this document.

## Movement behaviours (code)

| Behaviour | Rule |
|---|---|
| chase | straight toward the player, slide along obstacles |
| keep_distance | hold a target range; approach if too far, retreat if too close |
| orbit | circle the player at a radius, reverse on wall contact |
| stationary | never moves, and cannot be moved: no knockback, pull or shove; a body pressed against it, the player included, is the one that gives way |

No pathfinding. An enemy blocked for more than 1 s takes a random perpendicular nudge from `rng("gameplay")`.

## Attack kinds, because each one takes a different tactic away

An enemy is an opponent rather than a target if it changes the player's best
position, **invalidates a tactic the player was relying on**, and punishes
standing still. A bullet can only invalidate "stand in the path", so a roster
whose every body emits projectiles reads as a roster of one however its
patterns differ. The roster therefore attacks in kinds that are answered by
**different movements**.

| Kind | Shape | The tactic it invalidates | Carried by |
|---|---|---|---|
| bristle | all-round spikes, a tile of reach | standing next to it and trading | rusher, delver |
| claw | two swipes across a quarter-turn, a step in behind each | stepping out of the first one | delver |
| lance | the same drive from 1.5 tiles, spikes that stand and then burst | keeping the pace that answers a rusher | lancer |
| sweep | a spear swung flat through 210 degrees at 1.65 tiles | backing out, which is what a drive teaches | — |
| slash | 40-degree blade sweeping 60 degrees | staying inside melee range | boss |
| charge | a blade on the front of a committed run | standing in the lane | tank, boss II–III at range |
| slam | an overhead blow where it stands, and a ring on the floor round it | standing anywhere near it | tank |
| cleave | an overhead chop, no sweep, long reach | being on top of it or behind it | tank, boss II–III up close |
| thrust | narrow, long, no sweep, and it closes as it strikes | keeping a stride out of reach | rusher, delver (one turn in three) |
| bash | a short shove with the plate, little damage and great knockback | standing on a gunner while it reloads | warden |
| whirlwind | a narrow blade through two full turns | being adjacent at all | — |
| projectile | travels, dodgeable in flight | standing in the path | shooter, sentinel, orbiter, boss |
| lightning | a marked spot, then a bolt | standing anywhere, **including behind cover** | turret |
| thrown flame | lands, then burns for seconds | staying where you are once it lands | summoner |

Every blade is the same primitive with different numbers: a blade of
`bladeDeg` sweeping `sweepDeg` at `reachTiles`, the hitbox a spawned entity,
one hit per body per sweep, resolved nearest-then-leftmost, with the body
travelling at `commitSpeed` while the attack is live. So the difference
between a thrust and a whirlwind is a parameter block, not a system — which is
why the vocabulary holds two kinds no body currently carries: they cost
nothing to keep and a new archetype is a parameter block away.

**Lightning rather than a laser.** A marked spot then a bolt punishes a
*position* rather than a moment, and it costs less than a beam: the marker is
the telegraph and it shows exactly where, tracking is not a question because
the spot is fixed when marked, and cover is no answer because it strikes from
above. The delay is 900 ms, longer than a reaction window on purpose — the
player does not flinch out of it, they **travel** out of it. At 120 px/s a
radius of 1.2 tiles takes about 320 ms to leave; the rest of the budget is
because the marker has to be *noticed* while the player is busy, which a
telegraph attached to a body does not.

**The thrown flame is the only kind that changes the terrain.** A strike
punishes being somewhere at one instant and is then gone, so the player steps
out and steps back. A fire **removes floor from play while it burns**, which
shrinks the arena and forces the fight into less of it. It reuses the bullet
path entirely: a bullet flagged `leavesFire` lights a patch where it stops, so
the throw arcs, collides with walls and is capped like any other bullet, and
the new code is a pool of 24 patches with their own 3.2 s lifetime and a
520 ms damage cadence — standing in fire costs for **lingering**, not for
touching. **Fire damages enemies too**: a hazard that only burns the player is
a tax, one that burns everything is a tool, and knocking a body into it is a
use of the terrain. It is also the deliberate counter to a melee build, which
doc 001 permits; the pool cap is what keeps pressure from becoming
nullification.

**The floor remembers.** A strike and a burnt-out fire both leave a
`deco_scorch` mark: no gameplay effect, only that the floor shows what
happened on it. A mark lasts 7 s, marks landing on the same ground merge
rather than stack, and at most 8 exist at once, because a floor detail has to
stay ignorable at a glance. A mark is **dark and still** where live fire is
**bright and moving**, so the two are never confused without a colour the
player has to learn.

An encounter should mix three or four enemy types at most; beyond that the
player focuses on a subset and ignores the rest (015). With one attack kind
that rule is unusable, because two shooters are not two types in any way the
player perceives. With these kinds it is a real constraint on the assembler,
and a room of four bodies with four different answers is a brawl.

## Bullet pattern DSL

```json
{ "kind": "fan", "count": 3, "spread_deg": 30, "speed": 220, "aim": "player", "interval": 0.6 }
```

| Kind | Params | Semantics |
|---|---|---|
| single | speed, aim, interval | one bullet every `interval` |
| fan | count, spread_deg, speed, aim, interval | `count` bullets in an arc every `interval` |
| ring | count, speed, interval, rotate_deg | full circle every `interval`, rotated by `rotate_deg` per volley |
| spiral | arms, angular_speed, speed, interval | one bullet per arm every `interval`, arms rotate continuously |
| burst | count, speed_min, speed_max, cooldown | an even fan over 40 degrees with speed ramped linearly from `speed_min` to `speed_max`, then `cooldown`. Deterministic: a pure expansion cannot be random |
| rest | — | emits nothing |
| sequence | steps: [{pattern, duration}] | each step runs for `duration` seconds, then the next; loops |
| parallel | patterns[] | all run together; never terminates on its own |

Leaves run until their owner dies or the enclosing `sequence` step ends, and
fire their first volley at local t = 0 rather than after one interval —
otherwise a `sequence` step shorter than its child's interval emits nothing at
all. `aim` is `player` or `fixed:<deg>`. Bullets: radius, speed, lifetime
(default 6 s), optional `bounce` and `homing`. `expandPattern` is pure — no
rng, no clock, no world — so the simulation, the harness and the tests read
the same timing out of it.

Three fields carry everything that makes a pattern readable, and they are in
the DSL rather than in any one enemy:

- **Rhythm.** `rest` is why every shooting body is a `sequence` of volley and
  silence. A continuous stream has no moment of pressure because it has no
  moment of relief, and the silence is where the player repositions — and, in
  a game whose answer is to close, where they travel.
- **Shape.** `gap_deg` cuts a sector out of a ring or a fan. A dense uniform
  spray offers nothing to look for; a spray with a visible hole is a question
  the player can read before it arrives. On a ring the gap rotates with the
  ring, so standing in the safe sector is a moving job rather than a place to
  park.
- **Texture.** `size` scales a bullet. A slow fat bullet is a wall to walk
  around and a fast thin one is a line to step off; every bullet identical is
  the flattest a bullet hell can be.

Each shooting enemy alternates two shapes so a room is not one loop learned in
two seconds, and each starts its pattern at an offset derived from its id, so
a wave does not fire in unison.

## Ranged discipline (authoritative for 008 too)

The roster has exactly one archetype whose threat is a stream of projectiles,
because a melee player's job is to arrive and they cannot arrive through a
room that is full. Four rules hold the rest of it down:

- **Enemy bullets**: global cap 600. A volley that would exceed the cap is
  skipped entirely; bullets are never recycled early, so safe lanes are never
  erased.
- **Player bullets**: pool of 900; oldest recycled when exhausted.
- **The turn budget scales with the room.** Two attack turns and two firing
  turns, **plus one of each per three awake bodies** — six of each at the
  twelve-body concurrency cap. A fixed two was right for the fight it was
  written against and wrong for a room of six: measured, an awake body spent
  **57% of its time waiting for a turn**, a melee body 43–65% of it circling
  the ring and a ranged body 62–79% of it hovering, which is what "the enemies
  wander about for ages doing nothing" is. The cap exists so a room cannot
  commit six bodies at once and leave no position to answer from; it does not
  have to mean four in six are idle.
- **A body waiting for a turn is still doing something.** Nothing awake may go
  more than **3 s** without attacking or making a move the player can read
  (`Enemy.threatMs`). A ranged body without a firing turn walks to a **fresh
  post** every 1.5 s — a new angle on the player at its own range, a new sight
  line — instead of hovering at the one it has. A melee body works the waiting
  ring in **steps** rather than circles: every 1.4 s it commits to one, closing
  the ring to 0.72 of its width when the player is not facing it and holding
  when they are. Measured, that takes the idle share from **57% to 9%**, and
  hits per second on the player from 2.74 to 3.23. What is left is the two
  emplacements, which are bolted to the floor and have nothing to do but wait —
  the point-blank pulse is their answer to being stood on.
- **Two firing turns per room.** At most two ranged bodies may be winding up
  or shooting at once, so three shooters are not three times the fire. A turn
  is held across the wind-up as well as the shot, because the wind-up is when
  the player is being asked to move; a body refused a turn drops that volley
  and its pattern clock carries on, rather than firing late and arriving
  bunched. **Every ranged attack draws on the same two turns**, not only the
  bullet patterns: a strike, a flame, the musket, a rift, a hook or a ward
  holds one for its wind-up (950 ms). Outside the cap, a room of those was
  every body attacking at once however many turns it allowed.
- **Sixty bullets in the air** is the other ceiling: while that many enemy
  bullets are alive no body is given a turn. The turns cap how many bodies
  are shooting; this caps what they have already shot, which a slow volley
  keeps in the room for seconds after its turn is over.
- **Nothing shoots for the room's first 1.2 s**, and the ranged clocks wait
  with it, so they start staggered as they were rather than together. The
  whole room sees the player walk in — one screen, and every aggro range
  covers most of it — and without the grace the first thing a room did was
  every ranged body firing at once.
- **Every volley is telegraphed**, and a body aims at where it last saw the
  player rather than where they are. The window is 320 ms scaled by the
  archetype's tempo and jittered a twelfth either way, so it runs from about
  260 ms for a skittish shooter to about 390 for an emplacement — never below
  260, which is the reaction floor every other telegraph in the game is sized
  against.
- **A ranged body never gives up its range.** Two rules kept one standing
  still and silent instead, and both read to the player as a body that hovers
  and ignores them. A body giving ground stops at the edge of the **view**,
  measured from the view's edge inward — measuring it as "how far past the
  edge" is zero for everything on screen, so the rule came out as "never give
  ground", and a shooter the player walked up to stayed at point blank, where
  it is silenced, for the rest of the fight. And the jam test — "is this body
  getting nearer the player?" — is asked only of a body that is trying to
  close: an orbiter holds a radius and a `keep_distance` body holds a range,
  so neither ever closes, so both counted as jammed forever, and a jammed body
  abandons its behaviour and walks straight in. Measured at twenty seconds a
  piece, the shooter and the orbiter fired **nought and one** time at point
  blank; they now fire eleven and twelve at every distance, and the sower
  seeds six times.
- **A body inside stone is put back on the floor.** Nothing places one there,
  but the world can make a cell solid under it, and a body inside one can
  neither move nor see, so it hovers over the wall until the room is abandoned.
- **A ranged body plants to shoot.** When its turn comes it stops where it
  stands for the aim, the volley and **320 ms afterwards**, and moves for none
  of it (420 ms for a non-projectile cast — a strike, a gout of flame, a seed,
  a ward). That is where "an archer must not have a completely safe firing
  position" lives: the trade is an action the player can see and punish, and
  the tail of the plant is the window they have been closing for. It replaces
  a rule that cancelled a moving body's volley inside four tiles — every
  ranged archetype strafes, orbits or gives ground, so what that rule
  actually said was that a body near the player never fired at all. Measured
  in a mixed room over thirty seconds it cost an orbiter ten of its twelve
  volleys and a shooter half of its shots.
- **Silence at point blank.** Inside 78 px a ranged body stops firing and
  gives ground instead, whatever its retreat budget says — that is the reward
  for closing on one, and it is also what stops the ranged archetypes living
  inside their own silence radius. Backing away is straight: the sideways
  component drops to a third while a body is re-opening a gap, because
  circling is for a body that is already at its range. The two emplacements
  cannot back off, so instead they **pulse**: a telegraphed eight-shot ring at
  110 px/s every 3.2 s, wide-gapped, aimed at nobody. Without it a player
  standing on a turret cut it down for free.

## Enemy archetypes

| Id | Behaviour | Attack | Threat weight | Role |
|---|---|---|---|---|
| rusher | chase | **one attack**: it walks up fast and drives its spikes out all round at arm's length, 0.7 heart, under a tile of reach, on a short tell. About a third of its turns are strung into a one-two | 1.25 | forces movement, and nothing in its kit crosses ground — summoners call rushers in three and four at a time, and several bodies arriving at speed is a lock rather than a fight |
**One threat table.** The weights below are the only ones: the pressure
model, the composition tiers the Director is offered and the harness all read
`threatWeight`. There used to be a second copy inside `assemble.ts` — the
rusher at 1.0 against 1.25, the tank at 3.0 against 5.0 — so the tier a
composition was *offered* as and the pressure it *measured* came from
different numbers, and calibrating one silently failed to move the other.

| shooter | keep_distance | one aimed shot at a time — a slow fat one, a silence, a fast thin one, a silence — and a three-shot burst down one line to close the cycle. **No spread, ever**: a fan closes the lane the player was going to arrive through | 1.5 | baseline ranged pressure |
| turret | stationary | lightning every 5.2 s, marking where the player is and, every other strike, where they are going; at point blank, the emplacement pulse | 2.0 | area denial |
| orbiter | orbit | single aimed shots from wherever its circle has taken it, long silences, and a quick pair as its second move | 2.0 | flanking pressure |
| tank | chase, slow | no bullets at all: a charge from range, 1.5 hearts, that knocks itself out on a wall; an overhead greatsword chop, 1.6 hearts, when the player is on top of it or behind it | 5.0 | sponge, screens others, owns the ground around it |
| summoner | keep_distance, far | thrown flame about every 7 s; spawns one rusher 1.5 s after it arrives, then every 6 s, max 3 alive | 4.5 | priority target |
| lancer | chase, quick | **a subspecies of the rusher**, drawn by the mixes like any other body and gated by the ramp until the player has met a rusher. The same spike drive from 1.5 tiles, 0.8 heart, on a longer windup — and the spikes then **stay standing for a quarter second and burst outward** in eight directions as slow bullets (0.4 heart) | 1.6 | the pace that answers the rusher is inside its reach, and after the drive the answer is the line between two spikes |
| sentinel | stationary | single slow fat shot, aim player, one at a time, with a sight line drawn along the lane while it aims; at point blank, the emplacement pulse | 1.7 | a turret whose threat is a lane, not the ground |
| warden | keep_distance at 84 px, slow | a heavy gunner whose arm is a gun: it raises it for 0.95 s with its reach drawn on the floor (a 48° cone out to 2.8 tiles, each ray cut short at the first wall), then fires a **dragon's-breath blast** — there at once along its whole length, one hit and a burn on whatever it covers, nothing left on the floor — then stands 1.3 s to reload. It fires at point blank, unlike the shooters | 2.6 | the answer is distance, a wall, or being on it while it reloads |
| bellringer | keep_distance, far | a **ward tether** to the nearest ally it can see: 18 armour, granted once. Standing in the line for a third of a second cuts it and knocks the ringer down; its death strips its wards, and alone it rings itself apart. What puts the shield back is the **toll**: a circle grows under it for 0.82 s and the bell rings, refilling every shield it still holds a line to, all at once, with a pulse of light running out along each line. The toll does **no damage**, and **any hit during the windup stops it**. What it leaves is a 2.5 s patch that makes the *allies* inside it 35% faster — drawn on the bodies, never on the floor | 2.0 | support: the kill-order question, the line is a place the player is invited into, and the windup is a window |
| rifter | stationary | a **rift** — a crack along a line toward the player, 0.9 s of growth, then an eruption; always the one line, so stepping across it is always the answer | 1.9 | denies a route, not a spot: the answer is across |
| snarecaster | keep_distance | a **hook** laid on the floor along the line it will be thrown, then thrown: on a hit it drags the player about four tiles toward it; on a miss it whips back behind itself. A hit is followed by the **lash** — the chain comes round its own feet in a 1.8-tile circle that grows through the drag and erupts 0.46 s after the player lands, for 0.8 heart — so a grab sets the player up rather than delivering them | 2.2 | moves the player into other bodies' reach, and then charges them for arriving |
| delver | chase | the rusher's stab and spike drive, turn and turn about, on the surface for a few seconds; then it dives, travels as a visible mound, and erupts where the mound stops | 1.7 | a body that is not there: lead it |
| cinderling | chase, slow | lobs a coal that lights the floor where it lands; fire heals it and speeds it up, and while it burns it trails fire | 1.8 | the player's element turned around: ice and the sword answer it |
| sower | orbit, wide | drops seeds (three at most) that arm after a dash's window and burst on proximity; the sword and fire set them off; it sheds its seeds on death | 2.0 | punishes the dodge, not the position |

Each has stats (hp, speed, radius), tags from 010, and a `description`. Threat
weights are the input to the pressure formula below and are calibrated by the
harness (011). The fastest body in the roster moves at under 0.88 of the
player's walking speed.

**What a body is made of.** The shooter, the orbiter and the sower **fly**:
burning ground, poison pools and lava pass under them. Some bodies
**resist** an element — a multiple of its damage, zero for immune, which also
stops the status building: the cinderling is immune to fire (fire heals it)
and takes ice at 1.5; the turret and the sentinel, being constructs, cannot
be poisoned; the warden and the tank take poison at half; the sower burns at
1.5 and takes poison at half; the summoner, which throws fire, takes it at
half.

The lancer and the sentinel exist because six archetypes was a short roster to
read fourteen rooms against, and each is **a known body with one rule
changed**, which is what makes it learnable: the lancer commits from range, so
the rusher's answer (step in) is wrong for it; the sentinel's threat is a
bullet, so the turret's answer (step off the marked ground) is wrong for it.
The seven after them (research: `docs/research/enemy-expansion.md`) each add
one question the roster did not ask, on six shared attack kinds in
`sim/attacks.ts` — **rift**, **mine**, **tether** (ward, hook, chain, beam),
**lob**, **slow field** and the warden's **flame** — so several bodies carry a
kind and the player learns it once. Every telegraph reads as drawn (dim,
still) or live (bright, moving) by luminance and motion, never by hue.

**A subspecies is not an elite.** The lancer is a *variant* of the rusher —
the same body with one rule changed, which is what makes it learnable — and
it is drawn by the compositions on its own merits, may carry affixes like any
other archetype, and is gated by the run-progress ramp until the player has
met the body it is a variant of. It used to be the rusher's elite form, with
every rusher in an elite room becoming one: that made it a difficulty
modifier rather than a body, met only behind an elite door and never learned
as its own thing.

**An elite is a different attack, not a multiplier.** A body with affixes
swaps in its elite move: the shooter lobs a pin shot onto the line the player
would back away along; the turret's lightning becomes a rift lance; the
sentinel's sight line becomes a beam, live for a third of a second; the
orbiter sows seeds in its own wake; the tank's chop cracks the floor ahead of
it; the summoner wards its newest minion; the warden fires a second barrel a
beat after its first; the bellringer peals, arming everything near it at
once; the rifter walks four cracks toward the player; the snarecaster anchors
its chain across the floor as a live line; the delver erupts three times along
its line; the cinderling, set alight, flares into a ring of fire; the sower
plants a ring of eight seeds round the player with two gaps. The rusher's is
the lancer. An elite room always arrives in at least two waves.

## Enemies sleep until noticed

Every archetype carries an `aggro_range`. An enemy wakes when the player comes
inside it with a clear line, when it is hit, or when a woken enemy within
150 px raises the alarm (research: `docs/research/idle-pursuit-pacing.md`).
Until then it fires nothing and plays an **idle role**, mixed within a group
so a room is never a row of identical statues — and every role has something
it is visibly doing, named on the body as its `idleAction` so the renderer and
a test read the same thing:

| Action | Who | What |
|---|---|---|
| `shift` | a sleeper | turns over every 2.6 to 5.2 s: the facing swings round over about 0.7 s and the body nudges |
| `stir` | a sleeper | the player has come inside **0.7** of its range: it lifts its head and looks straight at them for 0.6 s, then wakes if they are still inside 0.5 of it with a clear line, or settles for 2.4 s if they are not |
| `scan` | a guard | sweeps its look across its cone and holds its post |
| `step` | a guard | one arrival in three, walks a tile or two off the post and comes back on the next |
| `gather` | an idler or a patrol | about one arrival in four, goes to stand with an unaware neighbour within 140 px |
| `still` | anything | standing between actions; every awake body, whatever it is doing |

The **stir** is the point of the list. A body that goes from asleep to
charging in a single frame gives the player nothing; the lifted head is one
readable beat between "it has not seen me" and "it has", and backing off or
breaking the line during it costs the player nothing. Every one of these
decisions is drawn from the room's own stream, so a replay is a replay.

The roles themselves: a **guard** (emplacements and
heavies) keeps its post — a heavy shuffles a step or two and looks about, an
emplacement powers down — and past close range sees only in a 140° cone in
front of it; a **patrol** walks a two-point beat; an **idler** wanders near
home; a **sleeper** (one melee body in three, one ranged in four) wakes only
when the player is close or it is hit, is drawn in its dormant pair and shows
a drifting "z". Every body that can move walks while unaware, at 40% of its
speed, pausing half a second to a second and a half; only a sleeper is drawn
at rest. Standing
bodies glance at a neighbour now and then. The sword swinging and the dash
are **heard** through walls a little inside the aggro range. The alarm
spreads as a **ripple**, each neighbour a beat later the further it stands
(140–400 ms), so the room is seen to turn. After the ripple the fight is
still **heard**: a body with an awake neighbour inside its own aggro range
sees 1.3 times as far, and a sleeper with one wakes at the whole range, so
nothing sleeps through a fight it could watch. The first hit on an unaware body
lands at double — the ambush. A room holding only unaware bodies once the
fight has started wakes the nearest after 4 s, so a sleeper is a body the
player may reach first, never a room that cannot end.

**Pursuit is not perfect knowledge.** A body that has lost sight of the
player for 1.8 s stops and searches for 0.9 s before the flow field takes it
on; a pillar buys the player a beat, not an escape. The room is locked, so
there is no leash; attack and firing tokens already limit how many bodies
commit at once. An enemy that never changes state
is furniture, whatever its pattern does — and a room that activates as a block
has one pressure level from entry to clear, with no way to engage part of it,
retreat and come back. Waking per enemy makes a room a set of fights whose
order the player chooses, and it makes cover matter before the shooting starts
rather than only during it.

Ranges are set against the 672 by 416 px room, between 210 and 260. The
stationary emplacements get long reach because they cannot follow up on what
they notice; the slow tank gets the shortest so it never opens a fight it
cannot arrive at, and nothing reaches across the whole arena — a body that
engages before the player can make out what it is takes the choice of when to
fight away from them. Waking resets the pattern clock, so a body that has just
noticed the player still telegraphs before its first volley. The alarm radius
is there because enemies waking one at a time as the player edges forward
looks like a bug even when it is not: a group should turn together.

## The melee cycle

A chaser runs a four-phase loop: approach, wind up, lunge along a direction
locked when the windup ends, then recover while drifting back out. Contact
damage is not an attack, it is a collision, and a body parked at arm's length
doing nothing is the other half of the same mistake.

The windup is the enemy's question and the dodge is the player's answer, so
the windup has to be long enough to react to and the lunge short enough to
feel committed. Locking the direction is what makes the attack dodgeable
rather than a homing grab, and the recovery is the window in which the player
is meant to punish. A lunging body is exempt from the standoff separation for
its duration, because an attack pushed off its target by its own spacing rule
can never connect.

The timings belong to the **attack**, not to the enemy, because how long a
body takes to start, commit and recover *is* the attack: the rusher's drive
runs 280 / 190 / 460 ms, while the tank's charge is slow to start (its answer
is leaving the lane, and the player needs time to pick a direction and
travel), long in flight and slow to recover, which is the whole reward for
having got out of the way. Hitting a wall mid-commit staggers the attacker, so
*steering* an armoured charge is a skill the player has even when interrupting
it is not.

## Rhythm, and why a body is not a metronome

The attack owns its shape; the **body owns the tempo it performs it at**. With
the shape alone every melee archetype wound up in 280 ms and recovered in 460,
so a rusher, a delver and a tank differed in what they did and never in how it
felt to be attacked by them — and a room of them beat like a clock, which is
what "the enemies are stiff and predictable" is. Five rules answer it, and all
five are constrained by the same thing: a telegraph is only a question if the
player can answer it.

- **Tempo per archetype.** A multiplier on the windup, the recovery, the rest
  after a turn and the ranged aim. Nervous bodies come in under 1 — the rusher
  at 0.86 / 0.9 / 0.75, the delver at 0.9, the shooter aiming at 0.85 — and
  heavy ones over it: the tank at 1.18 / 1.1, the warden at 1.15 with a 1.2
  aim, the emplacements at 1.15 to 1.2. **No tempo may take a tell below
  260 ms**, which is the reaction floor the lightning marker and the ranged
  aim are also sized against.
- **Jitter, inside readable bounds.** Every windup, rest and aim wanders a
  twelfth either way. A body whose windup is exactly 280 ms can be answered by
  counting instead of watching; a twelfth is under the eye's threshold for
  *unfairness* and well over its threshold for sameness. The **active window
  is never jittered** — the frame a blade becomes live is constant, and only
  the approach to it moves — because a hit frame that moves is not a tell, it
  is a lie.
- **No feints.** Every windup is followed by its blow. A tell is a promise;
  one that was sometimes not kept taught the player to wait on it rather than
  read it, and on the boss, whose moves are never interrupted, a blade raised
  and put away read as the game breaking. The variety is in the jitter above
  and the strings below, never in whether the blow comes.
- **Strings.** An attack is sometimes followed straight away by one more (the
  rusher 0.35, delver 0.3, lancer 0.25, boss 0.3, tank 0.18), keeping the
  attack token so nobody cuts in on it, at a fifth of the ordinary rest.
  Every blow in a string keeps its own full windup; what the player loses is
  the guarantee that one attack means one opening. **A string is a one-two and
  never a three**: at two repetitions one body held the room's turn for four
  seconds, and an enraged elite doing that cost six hearts in a measured room.
  A stagger breaks the string, which is what makes hitting first worth it.
- **Sidesteps and flanking.** The player's own swing or dash is the only
  signal in the game that says *they have committed*, so within 108 px a body
  that is not itself committed may answer it: a chaser hops across the line at
  1.9× its speed for 240 ms, a ranged body hops straight back, once every
  1.5 s at most, and never out of a windup or a lunge. And a body **waiting**
  for a turn works round toward the player's back rather than orbiting on its
  own clock, so a group that cannot all attack at once is still doing
  something — the player has to keep turning round.

### At most one melee attack in three travels

Giving the chasers a lunge fixed one thing and broke another: every body's
answer became a commitment that crossed ground, so three quarters of the
attacks in a fight were *something arriving at you at speed* and the only
thing the player ever had to read was a direction and a moment. So each melee
archetype has a cycle of moves of which **at most one in three travels**, and
the rest ask about **shape** — where the steel is, not when it arrives. Each
has a silhouette the player can name, and its telegraph draws that silhouette:
an all-round move is a ring on the body (contracting for a spike drive,
**growing** for the tank's slam, which is the tell that separates them), and
everything else is the sector its blade will sweep.

| Body | Cycle | Travels |
|---|---|---|
| rusher | the spike drive, and nothing else | none |
| lancer | the spike drive, its spikes left standing to burst | none |
| delver | stab (a stride out) → claw (two swipes) → spike drive | the stab, 1 in 3 |
| tank | slam, slam, ram — and the overhead chop whenever the player is on top of it or behind it | the ram, 1 in 3 of its far turns |
| warden | shield bash, at contact range only | none |
| boss | slash, ram, chop by phase and distance (its signature moves are below) | the ram |

Alternating rather than choosing purely by range is what keeps a cycle alive:
a stab commits from 63 px, a claw from 51 and a drive from 38, so a body that
always took whichever fitted would always take the stab, because it is the one
that fits first on the way in. On a claw or a drive turn the body keeps walking
until it is at that range, and the extra stride is itself the tell. **A string
counts as one turn**, so a combination never changes attack halfway through.

Measured over two minutes against each archetype: the rusher travels on 25% of
its attacks, the delver 28%, the tank 29%, and the lancer and the warden not at
all.

## Encounter profile (Jev, round 2 of the room plan)

Asked in the same request as the zone questions (004), after the room is generated. State adds the room's `spawn_groups` (names only), `open_ratio_label`, `cover_label`, plus `tension`, `pressure_cap`, `health`, `recent_damage`, `sword_share`, `clear_speed`, `last_profiles`. Every option's description says when it fits in those labels (002).

| Question | Options | Instruction gist | Temperature |
|---|---|---|---|
| composition | melee_heavy / ranged_heavy / mixed / siege / fallback | from tension and `sword_share`: melee presses a long-range build, ranged a short-range one, mixed suits any room and release most, siege peak with health to spare (whether this room may counter at all is the charter filter below) | 0.7 |
| density | sparse / normal / dense / fallback | from tension, health and `recent_damage`: dense at peak with health full or ok; sparse at release or after heavy damage | 0.6 |
| wave_structure | single / two_waves / trickle / fallback | single burst for peak, two waves for build and elite, trickle for release and a hurt player | 0.7 |
| anchor | none / tank / summoner / fallback | from `clear_speed`: a tank for fast or normal clears in a build or peak room; a summoner only for fast clears at peak; none for slow clears, low health, release | 0.6 |
| entry | far_front / flanks / surround / turrets_center / fallback | options limited to what the room's spawn groups support; far front for release and a hurt player, flanks for build, surround only with health full and little recent damage | 0.6 |

Code filters before asking: `density` drops `dense` when `pressure_cap` forbids the top tier; `entry` lists only patterns the generated room supports; `composition` drops the value equal to `last_profiles[0].composition` when three or more remain. **The anchor alternates in code**, the way the look does (002): the last room's answer keeps `LOOK_REPEAT_PENALTY` of its mass before the draw. Whether a room has a body worth killing first is the one encounter parameter that is about the run rather than the room — an anchored room only reads as one against a plain one — and that argument used to sit in the question's instructions, where it is a sentence making `none`'s case. Measured on eight seeds, `none` took 85% of rooms; removing the sentence took it to 87%, and the code term took it down. **Charter filter (001)**: code scores each composition against the current build as `favours`, `neutral` or `counters`, then drops every `counters` option whose selection would put the run below the 40% showcase floor **counting this room**. Testing the ratio after the prospective addition, rather than before it, is what keeps the floor from being crossed one room at a time. Whether this room may counter at all is a code decision; Jev only decides how. Every option description ends with its suitability word for the current `tension` (`softer_than_tension` / `matches_tension` / `harder_than_tension`), computed by code from the tier band the parameter pushes toward.

## Assembly (code)

Deterministic given `rng("decision", room_index, door_slot, 2)` and the profile.

**A room is played in rounds** (doc 014: length is bought with structure).
Code sets `profile.rounds` — one for a release room, two for build, peak and
elite (three went on and on when played); the boss and the merchant are
placed, not assembled — and never asks it. Each round is a whole `wave_structure` of an even share of the roster, in
roster order so the anchor opens the first; the next round is scheduled
`ROUND_GAP_MS` (the pressure model's time-to-kill plus half a second) after
the last wave of the one before, and at runtime the wave gate holds it until
the floor thins. **The room's pressure is its hardest round's**, each measured
as a fight of its own: the band is how intense the room gets, and more rounds
make it longer, not harder. So the density target, the roster ceiling and the
count range below are per round, times the rounds (`MAX_ROSTER` 40 over a
room). Measured against the one-round rooms: the median combat room went from
11 s to 22 s (build rooms 38 s), survival unchanged.

1. **Budget**: from `tension` and room type, a pressure band. Combat: release
   1.4 to 3.4, build 3.2 to 4.6, peak 4.4 to 6.1, bounded above by
   `pressure_cap`; the bands overlap slightly so a composition near an edge
   fits one or the other. Elite: 5.5 to 9.0 regardless of `pressure_cap`; it
   overlaps peak on purpose, because its floor sits where a heavy trickle of
   sixteen or more bodies lands. A `pressure_cap` clamp never leaves a band
   narrower than 0.5.
2. **Mix**: `composition` sets archetype ratios (melee_heavy: rusher 0.65,
   orbiter 0.25, tank 0.1; ranged_heavy: shooter 0.45, turret 0.2, sentinel
   0.2, orbiter 0.15; mixed: even over eight; siege: turret 0.35, sentinel
   0.25, shooter 0.25, rusher 0.15). `anchor` adds exactly one tank or
   summoner first.
3. **Count**: `density` sets a roster target — bodies over the whole fight,
   not on screen at once (sparse 5 to 7, normal 9 to 12, dense 14 to 18).
   Every count up to the cap is measured and, of those whose estimate is in
   the band, the one nearest the target is taken: **density decides, the band
   guards**. Stopping at the first count that enters the band would always
   take the smallest count the band allows, so density would decide nothing
   and the median room would be seven seconds. The cap is twelve for a single
   or two-wave roster (the concurrency cap, since those all stand on screen
   together) and `MAX_ROSTER` = 24 for a trickle.
4. **Waves**: `wave_structure` splits the roster: single (all at 0 s),
   two_waves (60% at 0 s, 40% at 3 s), trickle (3 to 4 enemies every 4 s until
   exhausted — the roster's time to kill is about six seconds, so anything
   tighter is a single wave arriving in instalments). Enemies are assigned to
   spawn groups per `entry`; overflow beyond a group's capacity moves to the
   next wave, and when the last wave is full a new one opens four seconds
   later. Nothing is ever dropped. The opening wave stands in the room when
   the player enters. Every later spawn is telegraphed on the floor for 0.38 s
   and then climbs out over another 0.38 s, intangible throughout (008). Later
   waves arrive **one at a time**: a wave releases when its time has come *and*
   no more than three bodies still stand, never sooner than 3.5 s after the
   last, and never later than sixteen seconds past its time — and then only
   if it leaves no more than eight standing, the most a gated release can, so
   a player who is not killing is not buried in the rest of the roster; a
   planned wave larger than five is cut into chunks of five that go through
   the same gate. A floor with nothing left standing calls the next wave at
   once, whatever its time: an empty room is never a countdown.
   Bodies in a wave land two tiles apart rather than in a clump.

   **One heavy of each kind per roster.** The tank, the turret and the
   summoner are each designed to be *the* thing a room is about, and the
   pressure model rewards a second one exactly as much as the first, so
   without a cap a room holds two tanks or two turrets — two charges to read
   at once, two strike markers on a floor built for one. `ROSTER_CAP` holds
   each at one; the mix ratios still decide how often the heavy appears at
   all. The presets obey the same rule and rise by how full the room is behind
   the heavies rather than by stacking them. A capped twelve-body roster still
   measures inside the elite band (about 8.9 in an open arena).
5. **Measure**: a roster's **length** is priced as well as its intensity —
   0.15 a body past ten. Concurrency answers "how many at once", and a
   trickle is deliberately cheap in it; but hearts are spent per second of
   exposure, and a trickle spends them by lasting. Measured, a thirty-four
   body dense trickle scored about 6 — inside peak — and cost four and a half
   hearts over seventy seconds, where a twelve-body single wave at the same
   score costs one and takes twenty.

   `pressure = Σ over enemies of threat_weight ×
   concurrency_factor(wave) × openness_factor(open_ratio, enemy) ×
   cover_factor(cover, enemy)`. The openness and cover factors take the enemy,
   not only the room: "open space raises ranged pressure and lowers melee
   pressure" is a per-enemy statement, and a factor outside the sum cannot
   express it. Concurrency counts only enemies alive at the same time under
   the wave schedule; cover does the reverse of openness. The result must land
   in the band.
6. **Retry**: out of band → adjust count by one and re-measure, up to 5 times;
   then relax `density` one step; then use the **tiered preset** for the band
   (one authored roster per tier, six total) and mark
   `source.encounter: "fallback"`.

**A floor on bodies.** A single wave's pressure climbs with every body, so a
release band would hold a single-wave room to three or four bodies and it
would be over before it was a fight. A combat room assembled with fewer than
six bodies is re-staged as a trickle — whose pressure is nearly flat in its
size — and takes the larger roster if that lands in the band. Release's
ceiling is set so a light room is four to nine bodies; raising every band
instead would put build out of reach of the ranged compositions, which top out
near 3.8.

**Elite rooms are not all elite.** The first body, every heavy (tank,
summoner, turret, sentinel) and about 35% of the rest carry the room's affixes
— and an elite rusher is a lancer, up to two at a time — while the others are
ordinary. A room where every body is pink is the same room with no elite
standing out. The other way round, from room 3 about one normal room in seven
hides a single **stray elite** with one affix (swift, armored or volatile; not
burning, which would make one body the run's largest source of burn), so an
elite can surprise the player without a door promising it.

## The run-progress ramp

An encounter is assembled against a **pressure band**, which says how intense
this room should feel against the player's state — and nothing at all about
how much game they have had. So the caps that hold a fight's size, all written
for the late run, applied from the first door: room 1 was handed a
seventeen-body trickle, which is unplayable before there is a build to play it
with.

The ramp is one table, in `encounters/ramp.ts`, and everything that caps a
fight reads it:

| rooms | waves | per wave | roster | alive at once | density | anchors | elites | turn base | hit damage | aim miss | shot speed | melee tell | body health | body damage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1–2 | 1 | 4 | 4 | 3 | to normal | none | no | 1 | ×0.5 | ±14° | ×0.8 | ×1.5 | ×1 | ×1 |
| 3–5 | 2 | 5 | 10 | 5 | to dense | tank | no | 2 | ×0.7 | ±10° | ×0.9 | ×1.28 | ×1 | ×1 |
| 6–9 | 3 | 5 (+1) | 16 | 6 | all | all | yes | 2 | ×0.85 | ±6° | ×1 | ×1.12 | ×1.2 | ×1.1 |
| 10–13 | 3 | 6 (+1) | 19 | 6 | all | all | yes | 2 | ×1 | ±4° | ×1 | ×1 | ×1.45 | ×1.2 |
| 14+ | 3 | 6 (+2) | 20 | 6 | all | all | yes | 2 | ×1 | ±4° | ×1 | ×1 | ×1.7 | ×1.3 |

**The ramp runs both ways.** Everything to the left of `body health` softens
the *opening* and has reached 1 by room 10; the last two columns harden the
*end*, and they were missing. A body in room 14 was exactly the body the
player met in room 6, while the build that meets it has three keys, a dozen
levels and six affixes — only one side of the fight grew, and a measured full
clear cost 24 of 60 health over sixteen rooms. Health scales first and
furthest, because health is what a build converts into time and it is the one
number that never surprises anybody mid-attack; damage scales second and more
gently. **No telegraph is shortened by either**, which is the same contract
doc 019 holds the elite tier to: the player's answers all still work, and they
cost more when they are missed.

It is a **hard filter, not a preference**, and it is applied at the world —
the last place before the bodies exist — so whatever either arm chose and
whatever fallback preset it reached, an early room is a small room. Doc 002
asks that code remove illegal options before either arm answers, which
`rampDensities` and `rampAnchors` are for; the clamps are the floor under
that, so the guarantee does not depend on the asking.

By room index rather than by tension, because tension is how hard *this* room
should feel and this is how much game the player has had: a peak room at index
2 should still be the hardest of the opening rooms, and still small.

Measured over twelve runs on the `average` profile — mean hearts lost by room
index, which is the shape the ramp is set against:

| room | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hearts | 0.03 | 0.14 | 0.39 | 0.89 | 0.78 | 1.76 | 1.48 | 0.77 | 0.83 | 1.69 | 2.04 | 0.57 | 2.03 | 1.08 |
| seconds | 7 | 9 | 14 | 23 | 21 | 28 | 23 | 19 | 22 | 21 | 25 | 15 | 25 | 18 |

A whole run costs that profile about 123 HP gross of a 60 HP bar, and a full
clear ends on 26 of 60 — a little over half the bar spent, which is the
target. The same run before the late-run columns existed ended near full.

## Where the bodies stand

An encounter is a roster and a schedule; **where** it stands decides whether a
room reads as a fight or as a hall with a knot in it. Doc 017 holds the
geometry; the rule is here because it is the encounter's.

- **The opening roster is dealt into stations**: groups of two or three, about
  one per viewport of open floor, to a maximum of four. One station stands in
  the view the player enters to, and the rest form a **chain at about seven
  tiles' spacing** — most of a viewport — growing out from it, each preferring
  open ground. Within a station the bodies stand at least 1.6 tiles apart. A
  station is tighter than the 150 px alarm radius and the next is further than
  it, so the ripple takes a station together and the room stays a set of
  fights whose order the player chooses.

  A chain, not farthest-point sampling. Farthest-point is the right rule for
  "as far apart as possible" and the wrong one for a room somebody has to walk
  across: it puts every station in a different corner, and the single largest
  reason a room had nothing on screen was the player walking between them.
- **Later waves are reinforcements.** Each lands on the nearest floor outside
  the player's view and at least six tiles from them, and arrives **awake**,
  so it walks in from off the edge of the screen. It arrives with no floor
  telegraph when it arrives out of sight — the rings and the climb are a
  warning for a player about to have a body grow out of the ground beside them
  (doc 008), and floor they cannot see needs none. The gate opens **one body
  early**, because a reinforcement spends a second or two crossing the floor
  before it is part of anything, and the wave should arrive as the last of the
  group in front of the player falls. The ceiling and the chunking are
  unchanged.
- **The next station is called while the last one is dying.** With the awake
  bodies down to one, the nearest unaware body wakes 0.95 s later; with a
  fight going on but nothing visible in the player's view, after 1.1 s; with
  nothing awake at all, after 4 s. Waiting for the screen to go quiet and
  *then* waking somebody means the player always sees the gap.
- **Nothing backs off the screen.** A body giving ground stops at the edge of
  the view and holds, and a body inside the view does not stop to search when
  it loses the line — the search is for a body that has genuinely lost the
  player across a room, and on screen it reads as idling.

Measured over twenty-four runs across every uncleared combat and elite room,
counting a body as in view only when the player can actually **see** it:

| | before stations | after |
|---|---|---|
| visible bodies in view, mean | 1.67 | **2.11** |
| nothing in view | 22.6% | **12.5%** |
| — of which: behind cover | 6.5% | 3.6% |
| — walking to the next station | 10.2% | 4.9% |
| — a wave walking in | 5.2% | 3.8% |
| — waiting on the wave gate | 0.7% | 0.3% |
| — stragglers hiding or fleeing | 0.0% | 0.0% |
| more than six in view | 0.2% | 0.6% |

The 3.6% left behind cover is a body on screen with a pillar between it and
the player for a moment, which is what doc 015 puts the pillars there for; it
is the floor under this measure rather than a fault in the placement.

## EncounterPlan

```ts
interface EncounterPlan {
  profile: { composition; density; wave_structure; anchor; entry };
  waves: { at_ms: number; spawns: { archetype: EnemyId; spawn_group: string; count: number }[] }[];
  measured_pressure: number;
  band: [number, number];
  source: "jev" | "rule" | "random";   // the fallback contract has no "fallback" value (002)
}
```

A room is CLEARED only when no enemies live, no waves are pending and no summoner is alive (003).

## Pressure calibration (harness, 011)

Threat weights and the three factors are estimates until calibrated. The harness samples the profile space × room parameter space, runs the reference player, and records hearts lost and clear time. Weights are tuned until measured pressure correlates with hearts lost (target Spearman ≥ 0.7 across the sample) and every band's median hearts lost stays under the limits below. Calibration is re-run whenever an archetype's stats or attack change.

| Band | Hearts lost by the reference player | Clear time |
|---|---|---|
| release | ≤ 1 | ≤ 45 s |
| build | ≤ 2 | ≤ 60 s |
| peak | ≤ 3 | ≤ 75 s |
| elite | ≤ 4 | ≤ 90 s |

These are ceilings, not targets, and the game sits far under them: the
reference player loses 0.1 to 0.4 hearts a room and clears one in 8 to 14
seconds. Two reasons, and neither is "the rooms are too easy" alone. The
reference player does not miss and reads a telegraph in 230 ms, so its hearts
are a floor on a person's rather than an estimate; and a fourteen-room run
whose only healing is the Vigour card and the odd dropped heart has a heart budget of roughly half a heart a room, so a
table that spends one to four a room describes a run nobody finishes. The
ceilings are the line an encounter must never cross; the figures to tune
toward are the measured ones in 011.

## Elite affixes (code)

Elite rooms layer an affix set on the assembled encounter. Affixes are stat and behaviour modifiers applied by code:

| Affix | Effect |
|---|---|
| armored | +60% hp |
| swift | +35% move speed, −20% pattern interval |
| burning | bullets apply fire on hit |
| splitting | dies into two rushers |
| shielded | immune to elements; only direct damage |
| volatile | on death, eight spikes grow out of the body, hang half a second and fly (at most two volatile bodies a room) |

Code enumerates the legal sets of one or two affixes and **draws one evenly
from them** — a pair where `pressure_cap` allows, otherwise a single. This is
a code decision rather than a Jev question because the enumeration is where
all the judgement is: the set has to satisfy the charter, the roster size and
the pressure band at once, and what is left after those filters is a handful
of sets that differ only in flavour. The draw is recorded as a decision like
any other, with its own distribution, so the readout shows what was possible.

Enumeration rules: never `armored` with `shielded`; `splitting` excluded when
the roster already has 8 or more enemies; and the charter limits (001) apply,
so `shielded` is applied to at most one enemy in the roster, is excluded when
taking it would put the run over 30% of rooms counting this one — the same
prospective test the showcase floor uses — and is excluded entirely when the
build's only damage path is elemental. After the set is applied, pressure is
re-measured with affix multipliers (armored ×1.3, swift ×1.3, others ×1.15,
each scaled by the share of the roster that actually carries it) and must stay
within the elite band; otherwise the roster shrinks by one and re-measures,
then the set drops to its first affix only.

**Elite bodies are enraged.** Every body in an elite room, whatever its
affixes, moves 15% faster and attacks 15% more often, and is drawn with a warm
pink cast and a pulsing ring at its feet. The affixes add their own
multipliers on top. A harder room that is the same bodies with longer health
bars reads as the sword being weak; a body that is visibly faster and angrier
reads as the room being harder.

## Boss (authored)

What the boss looks like, when its moves land and how the fight is staged —
the Crypt King, played on the beat of its theme — is doc 020. This section
owns what it does.

Room 16, after the merchant-and-blacksmith room. It is the one encounter that
is not assembled, and the reason is that a boss is a **hard gate**: a bad roll
in a normal room costs a heart and the player moves on, so the error is
bounded, while a bad roll in a boss ends the run through no fault of the
player. The charter (001) can constrain how *hard* a generated boss is; it
cannot constrain whether it is **legible** — whether its tells read, and
whether the fight has a shape the player can learn. Bullet density is
measurable; legibility is not, and the boss is the one encounter where
illegibility is fatal. The place where
generation is least recoverable is the place this project generates least, and
the genre is unanimous on it: Hades places fixed bosses at fixed chambers,
Enter the Gungeon authors twenty-one, Isaac and Dead Cells draw from authored
pools, and Valve's L4D director exempts boss encounters from adaptive pacing
outright — "Boss encounters are intended to change up the pacing anyhow."

The boss is an `EnemyId` like the rest rather than a scripted set-piece, and
that is the whole design. Everything the roster already has — perception lag,
the glance, firing turns, stagger, armour, the melee cycle, the ranged
telegraph — applies to it for free, so it is a fight the player already knows
how to read. A bespoke boss with its own state machine would be a second
combat system to balance, which doc 001's charter is against.

**6000 health and 60 armour**, the armour three times a tank's and
**re-armed at every phase change** — Hades' rule that the break is the reward
for a phase rather than a state the fight stays in. It moves at a shooter's
pace, because a boss that can be outrun is a boss the whole fight is
spent outrunning. The pressure comes from its moves and its armour, not from
how long it takes to wear down: a wall of health with a few attacks is the
first failure the enemy-design survey (`docs/research/enemy-design-survey.md`)
names.

### How a boss makes pressure, and why this one needed rebuilding

The fight was legible and it was not a fight. Measured and played, it asked
one question — *be somewhere else when this lands* — in four costumes, and a
player who stood in sword range and swung was never punished for standing
there. What follows is what the genre does instead, drawn from the games that
are actually about this, and it is the specification the moveset below is
built to.

**Layer threats whose answers disagree.** Hades' Asterius charges through the
arena while Theseus throws a spear at where you will be, and the two cannot be
answered by the same movement; the Hydra's heads deny a ring of ground while
the body's lunge denies the middle. Enter the Gungeon's bosses almost always
run a zone-denial pattern *and* an aimed shot at once, so the safe lane from
one is the firing line of the other. A boss that offers one threat at a time
is a boss the player answers with one habit at a time, which is what a quiz
is. **This is the single biggest change here**: the arms turn while the
pattern runs and while the body walks.

**Rhythm: a punish window is the reward for reading, and it must be paid.**
Soulslike design is explicit about it — the recovery after a committed attack
is where the player's damage comes from, and a boss with no recovery is a boss
you damage by accident. Cuphead is the same shape at range: every phase has a
beat where nothing is in the air and the player is expected to be shooting.
The rests between this boss's moves are load-bearing and stay; what changes is
that standing in the punish window *without leaving it* is now itself
punished.

**Patterns that force a direction, not a position.** Touhou's spell cards are
built on this: a rotating spoke pattern, a spiral, a closing wall with a lane
in it — the answer is a velocity, not a place, so the player is walking a
figure the pattern draws for them. Nuclear Throne's bosses do it with bullets
that fill the arena and leave a moving pocket. The rotating arm is the melee
form of the same idea and the counter-rotating spirals the ranged form: with
two sets of lanes scissoring, standing still is never right and the direction
that is right changes every second. Hollow Knight's Mantis Lords are the
minimal version — two attackers on opposite walls, so the correct answer is
always *which way do I go*, never *do I move*.

**Melee that punishes overstaying, with an honest windup.** Dead Cells' elites
and Hollow Knight's bosses both teach the same lesson: a melee player's
mistake is not being close, it is being close for too long. The answer is a
move with reach longer than the player's own, a large knockback and small
damage — it costs position rather than the run. It has to be telegraphed
honestly, which here means two telegraphs: the ring that fills while the clock
runs, and the windup of the swing itself.

**Escalate by kinds of move, then by pace, then by the arena, then by adds —
in that order.** Hades, Gungeon and Cuphead all add a *verb* per phase before
they add numbers. Numbers alone make a longer fight, not a different one. The
first boss of that run, Megaera, is the clearest statement of the other half
of it: she has three attacks and each one teaches a different answer — dodge
*through* the whip, leave the ground the lash marks, break line of sight from
the volley — and she does not get a fourth, she gets sisters. Hades himself is
the same principle at the top of the run: two phases, a chase that never lets
the player settle, and adds that change the kill order rather than the dodge.

**Teach one thing at a time first, then combine.** Cuphead's phase one is
always simpler than what it becomes, and Gungeon's bosses open with their most
readable pattern. This boss's phase I is deliberately unlayered for that
reason; the layering is the escalation.

**Use the arena.** Stone stops the shockwave and stops the quake's cracks, and
the hook is refused without a clear line: the pillars are the player's, and a
fight whose geometry does not matter is a fight played on an empty floor.

### Three phases, and the shape of each

**Three phases are health thresholds**, at 100%, 60% and 30%, not timers.
The player's damage is what advances the fight, so a better build sees the
later phases sooner — the opposite of a timed boss, where a better build only
waits less. Each phase adds a verb and then tightens everything, so the fight
is one body learned three times:

| phase | at | patterns | pace, speed | blade |
|---|---|---|---|---|
| I | 100% | one thing at a time, with a rest between each: aimed single (1.0 s), fan of 3, and a **ring of 12 with a 46° hole that sweeps a quarter-turn per volley** | 1.0, 1.05 | slash |
| II | 60% | **layered**: the holed ring of 14 with an aimed single inside it, then a fan of 5, then **two-arm rotating spokes** (spiral, 118°/s) | 1.15, 1.15 | charge from beyond 120 px, overhead chop when the player is on it or behind it |
| III | 30% | **counter-rotating spirals**, three arms each way at different rates, so the lanes scissor; then the ring of 16 with a 36° hole; then a fan of 5 at 62° with an aimed single through the middle of it | 1.3, 1.3 | charge from beyond 110 px, overhead chop close |

**Every volley leaves a lane.** The rings carry an explicit `gap_deg` that
rotates with them, the fans cover an arc and not a circle, and the spirals are
three arms at 120°. It is checked rather than asserted: `boss.test.ts` expands
every phase's pattern over a full cycle and fails if any set of simultaneous
shots leaves a widest angular gap under 18° — about forty px of arc at the
range these are read from, against a player eight px across. A gap narrower
than that asks for a dash, and the dash has a cooldown.

The rests are not padding. They are when a melee player closes, and without
them the arena is never safe to cross.

### The moveset

On top of its blade and its pattern it has five **signature moves**. Moves come
round on a list per phase — slam, lash, quake at I; slam, lash, leap, quake,
lash at II; leap, lash, quake, hook, slam, lash, leap at III — every 4.2, 3.4
or 2.6 seconds. **The lists alternate a move that denies a place with a move
that denies a direction**, which is what stops the fight settling into one kind
of dodge. A move it cannot land is not a move: the hook is refused without a
clear line or inside two tiles, and the slam takes its place.

| move | phase | telegraph | what happens | counterplay |
|---|---|---|---|---|
| **lash** (rotating arm) | I: one arm · II: two opposed · III: three at 120°, and faster | the limbs are **laid out at full length and held still for 0.62 s**, drawn hollow — an outline with a dotted spine, plainly not yet steel — and the first always points *away* from the player, so the sweep travels toward them rather than starting on top of them | they turn at 2.4 / 2.7 / 3.0 rad/s through most of a turn, a full turn, and a turn and a bit, cutting 0.65 hearts along their whole length with a 1.1 s re-arm so one sweep charges once. **The boss keeps walking at two thirds pace and keeps shooting its pattern**, so the threatened disc follows and the lanes to run down are the pattern's | **dash through the limb** on the i-frames, or **run the way it is turning**. A phase III tip moves at about 380 px/s against a walk of 150, so out at the tip it cannot be outrun and in near the body it easily can — which puts the safe circle exactly where the sword wants to be. The wake off the tip is what says which way it is going, and the direction alternates every cast |
| **slam** | I on | 0.7 s planted, the body **rising onto the raise and coming down on the plant**, a red ring growing outward and a white safe circle at its feet | a ring of 12 to 14 shots leaves from 64 px out, and a **shockwave** — a 34 px band of broken floor — sets off from the same 64 px at 230 / 260 / 290 px/s by phase, one heart, until it leaves the arena; phase III sends a second band and a second offset ring 0.52 s later | step **in** for the first beat, then **dash through the band** — the i-frames are what crossing it means, and distance only buys time |
| **quake** | I on | 0.62 s planted, a red ring **closing inward** with four nicks on it where the stone is about to give | the greatsword goes into the floor and four cracks run out along the compass, the first aimed at the player, each stopping at stone and carrying its own 0.9 s growth; phase III lays four more into the gaps 0.42 s later | stand **between** two cracks — not in and not out, which is neither of the other answers |
| **leap** | II on | a mark at full size on the player's spot from the first frame, a disc filling inside it as the clock runs, four ticks closing on the rim, and a thin ring at 64 px showing where the band will be born. **1.2 s: 0.3 s gathering on the floor, then 0.9 s in the air** | it crouches, springs, and **travels along an arc** — the body's own position is interpolated to the mark and lifted on a parabola, with its shadow left on the floor tightening as it rises, so the shadow closing on the mark is the clock. It lands for 1.4 hearts within 46 px with hitstop, a screen shake, a skirt of dust and stone chips, **and the landing throws the shockwave** | leave the mark, then answer the band as the slam's. The half second it stays down is the opening |
| **hook** | III | the snarecaster's chain, laid on the floor along the line it will be thrown — 1 s rather than the snarecaster's 0.73, because it is a heavier chain and there is more on screen to read it against | it reels the player in for half a heart, and what is waiting at the other end is the overhead chop | dash across the line while it lies there; caught, the chop still has its own 0.62 s raise |
| **backhand** (`maul`) | I on, whenever earned | **the overstay ring**: a ring at the punish's own reach, tightening onto the body and brightening as the clock fills, ticking round like a dial and turning white for the last third. Then the swing's own 0.42 s windup | the boss counts the time the player spends inside 92 px of it. Past **2.4 s** it drops whatever it was going to do and throws an arm through 120° of front, swept through another 90°, out to 2.4 tiles — **further than the player's own arc lands**. 0.6 hearts and the largest knockback in the game | **rotate out**. The clock drains at twice the rate it fills, so half a second away buys a whole second back, and the rhythm the fight wants is in, two or three swings, out. There is no standing place that hits the boss and is outside this, which is the point: the mistake being punished is not where you are, it is that you have not moved |
| adds | II, III | the phase change | two bodies arrive: two rushers at phase II, a lancer and a shooter at phase III | the kill-order question; they die with the boss |

Its pattern holds while a move runs **and while the player is inside 95 px** —
up close it is a blade and at range it is a gun, never both at arm's length —
**except during the lash**, which is the one deliberate layer in the fight.
Each phase change drops the volley in hand, stands it still for 0.8 s and
shakes the room, and the renderer swaps the sheet: without the pause the player
is told "it is different now" while being shot at, which is a message they
cannot read. The HUD carries its health bar along the bottom, above the spell
row so the top row stays the player's, with its armour as a pale band and
marks at 60% and 30%.

**Every telegraph outlasts the reaction floor**, and that is checked too: 260
ms is the roster's own windup floor, and `boss.test.ts` fails if any of the
moves, or any blade the boss reaches for, promises damage sooner.

### The shockwave and the arms are drawn on the pixel grid

Both are scan-converted onto a 2-unit grid (4 art px) rather than stroked as
curves, and both are drawn on **two layers**: a normal-blended one for the
upturned soil, the furrow, the cracks and the limbs, and an additive one for
the leading edge and the hot tip. Upturned earth is darker than the floor it
came out of, and an additive layer can only add light — drawn additively the
shockwave could only ever be a ring of glow, which is what made it read as an
overlay rather than as ground.

The band is scanned by rows in the left and right quadrants and by columns in
the top and bottom ones, so every run crosses the band radially and the crest
and furrow keep their width all the way round; scanning by rows alone smears
them flat across the top and bottom of the ring. It stays a **true circle** —
the sim's geometry is a circle, so the drawing is one — and the drawn band is
the band `shockwaveHits` tests, to within the cell that snapping costs. The
arms are drawn as the same capsule `armHits` tests, with no taper, because a
tapered limb looks better and lies about its own tip, which is the one part of
it a player is judging a dash against. `ground.test.ts` runs both drawings
against a recording pen and checks every cell against the sim's own predicate,
and checks that the ring is as wide as it is tall.

`pnpm ground:preview [out.png] [scale]` bakes both into a PNG through the same
`Pen` the play scene hands them, so they can be judged without a browser, and
`pnpm arena:preview [out.png] [shock|lash|air] [phase] [scale]` does the same
for a **real fight**: it steps the `boss-bench` fixture at the `average`
profile to the moment asked for and bakes the room's own floor, its stone, the
bodies and the bullets around the drawings. A swatch answers "is the ring a
circle"; only the arena answers "does any of this read".

### The enrage: the boss is gated on the build

Measured against four fixed build tiers (`pnpm boss-bench`), the boss was a
pure **reaction** test when its health was small: the reference player beat
it with an unlevelled, bare starting bolt as readily as with three filled
keys, because the sword alone wore it down inside the time it takes to make a
mistake. A fight a blank build wins is a fight the whole run was not
building toward, and the run is a build game.

Health alone cannot fix that: a longer fight is proportionally more dangerous
for every build alike, so doubling the bar doubles what the blank build pays
*and* what the formed one pays, and the ordering never changes. What changes
the ordering is a term that is **not linear in time**. So past 125 seconds the
boss **enrages** — everything it does costs more, climbing by 4.5% a second to
a ceiling of ×3, and its rests close by 1.2% a second to a ceiling of ×1.5.
A formed build never sees it. A forming one sees the start of it. A bare staff
fights the last minute of the fight inside it.

It is announced (`boss_enrage`, the phase cue) and drawn — the body burns, the
red deepening as the curve does — because a boss that silently gets stronger
is one nobody learns anything from losing to.

**The fight is two minutes long for a formed build**, because it is played to
its music (doc 020): the boss theme is a 45.7 s loop whose third phase adds
the rage layer, and a fight over in one pass of it — as it was at 2300 health,
46 s — ends before the fight's own music has been heard. The health sets the
length, and the line sits where a formed build finishes, so it finishes near
the line rather than comfortably inside it. Its base damage is ×0.18 of the
roster's, ×0.85 / ×1 / ×1.2 by phase: low because the enrage has to have
somewhere to go and because the fight is long, and doc 003's budget of a third
to a half of the bar is a budget for the whole fight, not for each second or
each move in it.

Measured over eight seeds a tier (`pnpm boss-bench`), on the `average`
profile — the one whose mistakes look like a person's:

| build | win rate | hearts lost | seconds |
|---|---|---|---|
| blank (bare bolt, no stats, 6 hearts) | 0/8 | dead at 183 s | — |
| forming (2 keys, 1 affix each, 7 hearts) | 0/8 | dead at 196 s | — |
| formed (2 keys, filled slots, 7 hearts) | 8/8 | 3.0 | 122 |
| rich (3 keys, 11 levels, 7 hearts) | 8/8 | 3.0 | 106 |

The formed build wins every time and pays under half its health, which is the
budget doc 003 sets.

**Where the damage comes from is the point of the rebuild.** Measured on the
`average` profile with a formed build, a little over half of it is now the
melee-range threats — the blades, the backhand and the arms — against a fight
that used to be answered entirely at range. The profile keeps its distance by
construction, so a player who fights in sword range, as the playtest log says
this one does, meets a larger share of it than the bench reports.

The `expert` profile, the zero-mistake bound rather than a player, loses with a
blank build and wins half its fights with a forming one: at two minutes the
enrage has long enough to reach even a player who dodges everything, which the
46-second fight never gave it. The gate is read on `average` and `novice`.

The `novice` profile loses with every build, and that is a **known gap in the
profile rather than in the boss**. It is too slow to put even a formed build's
damage into the bar before the line, so it fights the second half inside the
enrage and dies to bullets it is too slow to leave; the boss has no lever that changes
that short of removing the clock the gate is made of. The profile is
provisional (doc 011) and is the thing to fix.

## Validation (code)

- Spawns never exceed spawn-group capacity per wave; overflow is deferred, never dropped silently.
- **Every archetype has a second move.** One attack per body is a body the
  player solves once and then stops watching. The rusher alternates the stab
  and the spike drive, and strings about a third of its turns into a one-two;
  the shooter ends its cycle
  with a three-shot burst down one aimed line; the orbiter adds a quick pair
  from wherever its circle has taken it; the turret marks where the player
  *is* on one strike and where they are *going* on the next; the tank charges
  from range and, when the player is on top of it or behind it where a charge
  cannot start, raises the greatsword and brings it straight down; the lancer
  drives the same spikes from further out and then lets them fly, so its
  second move is the ranged half of its first, and it bursts eight more when
  it dies; the two emplacements, which fall silent like every ranged body at
  point blank, answer being stood on with the pulse; the cinderling, a chaser
  whose coal is its only attack, is not silenced at all and lobs it at the
  feet of a player it has reached, so standing still in front of it is burnt; the summoner blinks a few
  tiles away when the sword gets within three tiles, once every four seconds,
  with a puff at both ends; the bellringer tolls the circle under itself, which
  is the one move in its kit with a window in it; and the snarecaster
  lashes the ground round its own feet the moment a drag lands. Each is the
  archetype's first rule plus one inversion of it, which is what keeps it
  learnable.
- Summoner population cap 3, as a runtime gate shared across the room. A
  summoner's first minion arrives 1.5 s after it spawns, then every 6 s: a
  body that stands for six seconds before it does anything reads as a body
  that does nothing.
- Concurrent enemies never exceed 12.
- Elite affix sets always pass the elite pressure band after re-measurement or degrade as described.

## Implementation notes

Decisions the design left open, settled during implementation and recorded here so they are not re-litigated. Each is covered by a test.

- **Six presets over four bands.** The elite band is 3.5 wide against roughly
  1.4 for the others, so it is sliced into `elite_low`, `elite_mid` and
  `elite_high`; the release, build and peak presets carry their tiers' bands.
- **A preset brings its own entry pattern.** Forcing an authored twelve-body
  elite roster through a profile's chosen `far_front` group overflows into
  four waves and misses its own band, which is a fallback that cannot fall
  back. Presets are self-contained.
- **The summoner cap is a runtime gate, not a planning reservation.**
  `canSpawnMinion(alive, minions) = minions < 3 && alive < 12`. Reserving the
  minion slots at planning time makes roster pressure non-monotone — it *falls*
  from 6.34 to 5.66 as the count goes from 8 to 9 — which breaks the retry
  loop's assumption that one more body is more pressure. Both documented
  invariants still hold, and a test asserts monotonicity across all four
  compositions.
- **Relaxing density goes toward the side the measurement missed**, up if
  under the band and down if over, one step, with its own count retries.
  Worst-case retry budget is therefore ten.
- **The elite band and the concurrency cap.** The cap is on bodies *on
  screen*, not in the roster: a single or two-wave roster stops at twelve, a
  trickle may schedule up to `MAX_ROSTER` = 24 and never has more than two
  chunks up at once. Pressure is nearly flat in a trickle's size (a mixed
  trickle measures 2.8 at three bodies, 5.0 at twelve, 5.9 at twenty-four), so
  the band decides a trickle's intensity and the density target decides its
  length; a mixed trickle reaches peak from seven bodies and elite from about
  sixteen, while a `ranged_heavy` trickle tops out near 3.8 and falls back to a
  preset above build. Over the full 432-profile space against four room
  fixtures every assembly lands in its band or reaches a preset, at 0% presets
  for release and build, 42% at peak and 51% at elite; both elite figures are
  the `ranged_heavy` and `siege` trickles the band cannot admit. Moving the
  cap, the band or the weights is a calibration decision for 011, not a bug.
