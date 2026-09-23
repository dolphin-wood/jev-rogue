---
id: 005
title: Encounters and Bullet Patterns
status: proposed
date: 2026-09-21
summary: Fifteen enemy archetypes from four movement behaviours, each with an elite form that is a different attack, and the attack kinds that answer them — blades, a lightning strike, thrown fire, and a bullet-pattern DSL with defined timing semantics. Encounters are assembled, not authored: Jev picks an encounter profile as five semantic parameters against the generated room; code assembles waves under a pressure budget, measures, retries, falls back to tiered presets. Elite rooms layer a code-drawn affix set. The boss is authored — three health-threshold phases, a slam, a leap and adds — because a boss is the one encounter where illegibility ends a run. Bullet cap policy is defined once here.
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
| stationary | never moves |

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
| bristle | all-round spikes, a tile of reach | standing next to it and trading | rusher |
| lance | the same drive from 1.5 tiles, spikes that fly off | keeping the pace that answers a rusher | lancer |
| slash | 40-degree blade sweeping 60 degrees | staying inside melee range | boss |
| charge | a blade on the front of a committed run | standing in the lane | tank, boss II–III at range |
| cleave | an overhead chop, no sweep, long reach | being on top of it or behind it | tank, boss II–III up close |
| thrust | narrow, long, no sweep, and it closes as it strikes | standing in line and trading | — |
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
- **Two firing turns per room.** At most two ranged bodies may be winding up
  or shooting at once, so three shooters are not three times the fire. A turn
  is held across the wind-up as well as the shot, because the wind-up is when
  the player is being asked to move; a body refused a turn drops that volley
  and its pattern clock carries on, rather than firing late and arriving
  bunched.
- **Every volley is telegraphed** for 320 ms, and a body aims at where it last
  saw the player rather than where they are.
- **Silence at point blank.** Inside 78 px a ranged body stops firing, which
  is the reward for closing on one. The two emplacements cannot back off, so
  instead they **pulse**: a telegraphed eight-shot ring at 110 px/s every
  3.2 s, wide-gapped, aimed at nobody. Without it a player standing on a
  turret cut it down for free.

## Enemy archetypes

| Id | Behaviour | Attack | Threat weight | Role |
|---|---|---|---|---|
| rusher | chase | walks up and drives its spikes out all round, 0.7 heart, under a tile of reach; about a third of its drives are followed by a second almost at once | 1.25 | forces movement: kept at a pace, it is cut before it can |
| shooter | keep_distance | one aimed shot at a time — a slow fat one, a silence, a fast thin one, a silence — and a three-shot burst down one line to close the cycle. **No spread, ever**: a fan closes the lane the player was going to arrive through | 1.5 | baseline ranged pressure |
| turret | stationary | lightning every 5.2 s, marking where the player is and, every other strike, where they are going; at point blank, the emplacement pulse | 2.0 | area denial |
| orbiter | orbit | single aimed shots from wherever its circle has taken it, long silences, and a quick pair as its second move | 2.0 | flanking pressure |
| tank | chase, slow | no bullets at all: a charge from range, 1.5 hearts, that knocks itself out on a wall; an overhead greatsword chop, 1.6 hearts, when the player is on top of it or behind it | 5.0 | sponge, screens others, owns the ground around it |
| summoner | keep_distance, far | thrown flame about every 7 s; spawns one rusher 1.5 s after it arrives, then every 6 s, max 3 alive | 4.5 | priority target |
| lancer | chase, quick | **the rusher's elite form**: in an elite room up to two rushers at a time spawn as lancers, never drawn by the mixes. The same all-round spike drive from 1.5 tiles, 0.8 heart, on a longer windup — and the spikes then **hang for a quarter second and fly off** in eight directions as slow bullets (0.4 heart); when it dies, eight more grow out of where it fell, hang for 0.45 s and fly the same way | 1.6 | the pace that answers the rusher is inside its reach, and after the drive the answer is the line between two spikes |
| sentinel | stationary | single slow fat shot, aim player, one at a time, with a sight line drawn along the lane while it aims; at point blank, the emplacement pulse | 1.7 | a turret whose threat is a lane, not the ground |
| warden | keep_distance at 84 px, slow | a heavy gunner whose arm is a gun: it raises it for 0.95 s with its reach drawn on the floor (a 48° cone out to 2.8 tiles, each ray cut short at the first wall), then fires a **dragon's-breath blast** — there at once along its whole length, one hit and a burn on whatever it covers, nothing left on the floor — then stands 1.3 s to reload. It fires at point blank, unlike the shooters | 2.6 | the answer is distance, a wall, or being on it while it reloads |
| bellringer | keep_distance, far | no attack: a **ward tether** to the nearest ally it can see, 18 armour while the line holds; standing in the line for a third of a second cuts it and knocks the ringer down; a slow field (−25% speed, no damage) under itself; its death strips its wards, and alone it rings itself apart | 2.0 | support: the kill-order question, and the line is a place the player is invited into |
| rifter | stationary | a **rift** — a crack along a line toward the player, 0.9 s of growth, then an eruption; every third is a cross | 1.9 | denies a route, not a spot: the answer is across |
| snarecaster | keep_distance | a **hook** laid on the floor along the line it will be thrown, then thrown: on a hit it drags the player about four tiles toward it; on a miss it whips back behind itself | 2.2 | moves the player into other bodies' reach |
| delver | chase | spike drive on the surface for a few seconds, then it dives, travels as a visible mound, and erupts where the mound stops | 1.7 | a body that is not there: lead it |
| cinderling | chase, slow | lobs a coal that lights the floor where it lands; fire heals it and speeds it up, and while it burns it trails fire | 1.8 | the player's element turned around: ice and the sword answer it |
| sower | orbit, wide | drops seeds (three at most) that arm after a dash's window and burst on proximity; the sword and fire set them off; it sheds its seeds on death | 2.0 | punishes the dodge, not the position |

Each has stats (hp, speed, radius), tags from 010, and a `description`. Threat
weights are the input to the pressure formula below and are calibrated by the
harness (011). The fastest body in the roster moves at under 0.88 of the
player's walking speed.

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
so a room is never a row of identical statues: a **guard** (emplacements and
heavies) stands and scans, and past close range sees only in a 140° cone in
front of it; a **patrol** walks a two-point beat; an **idler** wanders near
home; a **sleeper** (one quick body in three, one ranged in four) wakes only
when the player is close or it is hit, and shows a drifting "z". Standing
bodies glance at a neighbour now and then. The sword swinging and the dash
are **heard** through walls a little inside the aggro range. The alarm
spreads as a **ripple**, each neighbour a beat later the further it stands
(140–400 ms), so the room is seen to turn. The first hit on an unaware body
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

## Encounter profile (Jev, round 2 of the room plan)

Asked in the same request as the zone questions (004), after the room is generated. State adds the room's `spawn_groups` (names only), `open_ratio_label`, `cover_label`, plus `tension`, `pressure_cap`, `health`, `recent_damage`, `build_range`, `clear_speed`, `last_profiles`. Every option's description says when it fits in those labels (002).

| Question | Options | Instruction gist | Temperature |
|---|---|---|---|
| composition | melee_heavy / ranged_heavy / mixed / siege / fallback | from tension and `build_range`: melee presses a long-range build, ranged a short-range one, mixed suits any room and release most, siege peak with health to spare (whether this room may counter at all is the charter filter below) | 0.7 |
| density | sparse / normal / dense / fallback | from tension, health and `recent_damage`: dense at peak with health full or ok; sparse at release or after heavy damage | 0.6 |
| wave_structure | single / two_waves / trickle / fallback | single burst for peak, two waves for build and elite, trickle for release and a hurt player | 0.7 |
| anchor | none / tank / summoner / fallback | from `clear_speed`: a tank for fast or normal clears in a build or peak room; a summoner only for fast clears at peak; none for slow clears, low health, release | 0.6 |
| entry | far_front / flanks / surround / turrets_center / fallback | options limited to what the room's spawn groups support; far front for release and a hurt player, flanks for build, surround only with health full and little recent damage | 0.6 |

Code filters before asking: `density` drops `dense` when `pressure_cap` forbids the top tier; `entry` lists only patterns the generated room supports; `composition` drops the value equal to `last_profiles[0].composition` when three or more remain. **Charter filter (001)**: code scores each composition against the current build as `favours`, `neutral` or `counters`, then drops every `counters` option whose selection would put the run below the 40% showcase floor **counting this room**. Testing the ratio after the prospective addition, rather than before it, is what keeps the floor from being crossed one room at a time. Whether this room may counter at all is a code decision; Jev only decides how. Every option description ends with its suitability word for the current `tension` (`softer_than_tension` / `matches_tension` / `harder_than_tension`), computed by code from the tier band the parameter pushes toward.

## Assembly (code)

Deterministic given `rng("decision", room_index, door_slot, 2)` and the profile.

**A room is played in rounds** (doc 014: length is bought with structure).
Code sets `profile.rounds` — three for a build room, two for release, peak and
elite; the boss and the merchant are placed, not assembled — and never asks
it. Each round is a whole `wave_structure` of an even share of the roster, in
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
   last, and never later than sixteen seconds past its time; a planned wave
   larger than five is cut into chunks of five that go through the same gate.
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
5. **Measure**: `pressure = Σ over enemies of threat_weight ×
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

**1250 health and 60 armour**, three times a tank's, **re-armed at every phase
change** — Hades' rule that the break is the reward for a phase rather than a
state the fight stays in. Its health is about four tanks and it moves at a
shooter's pace, because a boss that can be outrun is a boss the whole fight is
spent outrunning. The pressure comes from its moves and its armour, not from
how long it takes to wear down: a wall of health with a few attacks is the
first failure the enemy-design survey (`docs/research/enemy-design-survey.md`)
names.

**Three phases are health thresholds**, at 100%, 60% and 30%, not timers.
The player's damage is what advances the fight, so a better build sees the
later phases sooner — the opposite of a timed boss, where a better build only
waits less. Each phase is the last one faster and wider in the same moves, so
the fight is one body learned three times:

| phase | at | patterns | pace, speed | blade |
|---|---|---|---|---|
| I | 100% | aimed single (1.1 s), fan of 3; rests 1.2 s | 1.0, 1.05 | slash |
| II | 60% | fan of 5, ring of 10, fast aimed single (0.7 s); rests under 1 s | 1.15, 1.15 | charge from beyond 120 px, overhead chop when the player is on it or behind it |
| III | 30% | three-arm spiral, ring of 14, fan of 5 at 60 degrees; rests 0.6 to 0.7 s | 1.3, 1.3 | charge from beyond 110 px, overhead chop close |

The rests are not padding. They are when a melee player closes, and without
them the arena is never safe to cross.

On top of its blade and its pattern it has three **signature moves**, one
threat at a time:

| move | tell | what happens | answer |
|---|---|---|---|
| slam | 0.7 s planted, a red ring growing, a white safe circle at its feet | a ring of 12 to 14 shots leaves from 64 px out; phase III sends a second ring into the gaps a beat later | step **in**, inside the white circle — the sword's own range is the safe place |
| leap (phase II on) | a mark on the player's spot, a shadow that grows, 1.3 s | it rises out of reach (nothing hits it in the air) and lands on the mark: 1.4 hearts within 46 px, plus a small ring | leave the mark; the half second it stays down is the opening |
| adds | the phase change | two bodies arrive: two rushers at phase II, a lancer and a shooter at phase III | the kill-order question; they die with the boss |

Moves come round on a list per phase — slam at I, slam and leap at II, and
leap, slam, slam, leap at III — every 4.2, 3.4 or 2.6 seconds. Its pattern
holds while a move runs **and while the player is inside 95 px**, so up close
it is a blade and at range it is a gun, never both at arm's length. Each phase
change drops the volley in hand, stands it still for 0.8 s and shakes the
room, and the renderer swaps the sheet: without the pause the player is told
"it is different now" while being shot at, which is a message they cannot
read. The HUD carries its health bar along the bottom, above the spell row so
the top row stays the player's, with its armour as a pale band and marks at
60% and 30%.

Measured with the reference player: 6 of 10 beaten, a mean of 41 s, 2.7 hearts
lost.

## Validation (code)

- Spawns never exceed spawn-group capacity per wave; overflow is deferred, never dropped silently.
- **Every archetype has a second move.** One attack per body is a body the
  player solves once and then stops watching. The rusher follows about a third
  of its spike drives with another almost at once; the shooter ends its cycle
  with a three-shot burst down one aimed line; the orbiter adds a quick pair
  from wherever its circle has taken it; the turret marks where the player
  *is* on one strike and where they are *going* on the next; the tank charges
  from range and, when the player is on top of it or behind it where a charge
  cannot start, raises the greatsword and brings it straight down; the lancer
  drives the same spikes from further out and then lets them fly, so its
  second move is the ranged half of its first, and it bursts eight more when
  it dies; the two emplacements, which fall silent like every ranged body at
  point blank, answer being stood on with the pulse; the summoner blinks a few
  tiles away when the sword gets within three tiles, once every four seconds,
  with a puff at both ends. Each is the archetype's first rule plus one
  inversion of it, which is what keeps it learnable.
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
