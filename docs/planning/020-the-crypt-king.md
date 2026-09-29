---
id: 020
title: The Crypt King
status: proposed
date: 2026-09-25
summary: The boss's identity and choreography. A dead king held in his armour by chains, with a greatsword and a burning heart, whose three phases are the armour coming off; every move doc 005 specifies is kept and given the body that makes it read — the sword for the slam, quake and backhand, the chains for the lash and the hook. The fight is played to its music: every move commits on the beat of the 168 BPM boss theme, heavy strikes on the downbeat, volleys on the beat grid, phase changes on a bar line, so the player learns the fight by ear as well as by eye. Mechanics, lanes, telegraph floors and the enrage gate are doc 005's and unchanged; this document owns what the boss looks like, when it moves, and how it is staged.
depends_on: [005, 008, 016, 018]
---

# 020 The Crypt King

## Why

Doc 005 made the boss a fight: layered threats whose answers disagree, lanes
in every volley, a punish window that must be paid for, an enrage that gates
the fight on the build. Measured, it does what it should. Played, it does not
look like any of it. It is drawn as a ring of stone plates around a gold core
— a construct from the game's geometric first draft, beside a hooded player
and a roster that are now detailed pixel art — and its poses barely move
(`sprite:amplitude` puts its windup-to-commit change at 0.08 against a floor
of 0.40). Its moves are a greatsword, a chain and two arms, and none of them
can be seen on the body throwing them.

The music now asks for more than the body gives. The boss theme is E minor
at 168 BPM, a riff over a galloping bass, and its three phases add the kit,
then the harmony, then a rage layer. A fight whose rhythm has nothing to do
with that is a fight with a soundtrack rather than a fight *to* one.

## Who he is

**The Crypt King**: the dungeon's last ruler, dead and not allowed to stay
dead, held upright inside his armour by chains that are also his weapons. A
greatsword taller than the player, a crown, and — where his heart was — the
gold core the current boss already has, burning.

The three phases are **the armour coming off**, which is what doc 005 already
does with plates, told as a body:

| Phase | Name | What is left | What it says |
|---|---|---|---|
| I (100%) | The King | Full plate, a torn royal cape, the crown straight, two chains wrapped round his forearms. The core shows only as a glow between the breastplate's seams. | Measured, heavy, deliberate. One thing at a time. |
| II (60%) | The Broken Crown | Pauldrons and helm gone, the breastplate split, a complete skull under a level crown, the chains torn loose and hanging to the floor. The core shows through the break. | The chains are free now, and they swing. |
| III (30%) | The Unbound Heart | Armour gone. A tall skeletal frame round the open, blazing core; the crown rests on the skull; three chains trail from the core itself. The sword is still in his hands. | Nothing holds him together but the heart. Fast. |

The core is where the weak point already is (armour re-arms at each phase
change, doc 005), so the thing the player has been told to break is the thing
the whole design is built around.

## The moves, given a body

Every move is doc 005's move. What changes is what the player sees doing it,
and — below — when it lands.

| Move | Doc 005 mechanic (unchanged) | Drawn as |
|---|---|---|
| **blade** (slash / charge / chop) | the melee cycle by phase | the greatsword: a two-handed sweep; the charge a sword-first run; the chop an overhead cut |
| **slam** | ring of shots from 64 px, the shockwave band | the sword driven point-down into the floor with both hands, the king kneeling on it; the band leaves from the blade |
| **quake** | four cracks along the compass, aimed at the player | the sword wrenched sideways in the floor it was planted in; the cracks run from the blade |
| **leap** | 0.3 s gather, arc to the mark, land for 1.4 hearts, the band | a crouch with the sword drawn back, the king in the air with the sword raised over his head, landing sword-first — he is no longer hidden behind an ellipse while airborne |
| **lash** | one / two / three limbs turning round the body | the chains: one at I, two at II, three at III. The limb geometry and its hit capsule are exactly doc 005's; the drawing over it is a chain of links rather than a bar, still untapered, still hollow while it holds still |
| **hook** | a chain laid on the line, thrown, reeled in | one of the same chains, thrown from the hand |
| **backhand** (`maul`) | the overstay ring, 120° + 90° sweep out to 2.4 tiles | the sword brought round flat, pommel-first, knocking the player out of his reach |
| **heart volley** | the existing phase-dependent projectile patterns and aimed telegraph | the king plants the sword, opens his free hand and channels amber energy from the core; the projectiles remain separate sprites |
| **adds** | two bodies at II, two at III | the dead of his court rising from the floor round the arena's edge on the phase change |

The sword and the chains are **parts of the model** (016), so the rig can swing
them and the renderer knows where the blade is: the slam and quake draw their
bands and cracks from the blade's point rather than from the body's centre,
which is where the eye already is.

## Played to the music

### The grid

The boss theme runs at **168 BPM**: a beat is **357 ms**, a bar **1.43 s**,
the loop 32 bars (45.7 s). The fight keeps its own **beat clock**,
`bossFightMs` from the moment the fight starts, and the boss's timing is laid
on it (`sim/beat.ts`). It is advanced by the sim's own step, so the harness,
the replays and the bench stay deterministic and never need an audio clock.

The clock **runs through hitstop**. A freeze stops every body but not the
music, and the fight spends about 4% of its steps frozen (measured over
`boss-bench`), so a clock that stopped with them would fall a beat behind
the music within a few bars. It is advanced at the top of the step, before
the freeze and before any body moves, so everything in a step reads the same
beat; and the boss's own timers — the move in hand, the blade's windup, the
chains' telegraphs — are derived from absolute times on it rather than
counted down, so a freeze inside a telegraph cannot push the commit off the
line. A commit due *inside* a freeze lands as the freeze ends, because the
body is frozen until then.

- **Every move commits on a beat.** The telegraph lengths are rounded to whole
  beats (table below). When the gap before a move runs out, the move is
  chosen and **queued** to start at the time that puts its commit — the
  moment it promises damage — on the next line it can reach; what waits is the
  idle gap, by less than a bar. The stepped clock reaches that start on it or
  past it, by a step or by a freeze, and the telegraph gives the difference
  back so the commit is still on the line: at most one capped freeze and a
  step (117 ms) off telegraphs of 357 ms and more. A queue missed by more than
  that — a backhand ran through it — is queued again for the next line. The
  blade's windup is lengthened, never shortened, to reach its beat.
- **Heavy strikes land on the downbeat.** The slam, the quake and the leap's
  landing take beat 1 of a bar; the lash, the hook, the blade and the
  backhand take any beat. The player comes to hear *three, four, ONE* as
  "the ground is about to go".
- **Volleys fire on the grid.** Pattern intervals are rounded to beats; phase
  III's spiral arms emit on the eighth-note grid, in step with the rage
  layer's arpeggio.
- **Phase changes land on a bar line.** The 0.8 s stand-still (doc 005) runs
  until the next downbeat, and the music's phase layers turn over on the same
  bar, so the new phase's first move and the new section of the music arrive
  together.

| Telegraph | Doc 005 | On the grid | Beats |
|---|---|---|---|
| slam | 700 ms | 714 ms | 2 |
| quake | 620 ms | 714 ms | 2 |
| lash hold | 620 ms | 714 ms | 2 |
| leap (gather + air) | 1200 ms | 1428 ms (357 + 1071) | 4 |
| hook on the floor | 1000 ms | 1071 ms | 3 |
| blade and backhand windups | 420 ms and up, by kind | held on to the next beat, by under 357 ms | — |
| move cadence I / II / III | 4.2 / 3.4 / 2.6 s | 4.29 / 3.57 / 2.50 s | 12 / 10 / 7 |
| volley intervals | 1.0 / 1.4 / 2.0 s … | 1.07 / 1.43 / 2.14 s … | 3 / 4 / 6 |

Every figure on the grid is still above the 260 ms reaction floor, and every
one is at least as long as it was: the moves' telegraphs grew to whole beats,
and the blades' are held on to theirs. Measured on `boss-bench` against the
same code without the grid, the gate is unchanged — the blank and forming
builds lose every fight on the `average` profile, the formed and rich builds
win every one — and the formed build's cost did not move.

### Keeping the music on the grid

The client starts the boss piece at `bossFightMs` modulo the loop, rather than
from its top, so the music and the fight share a downbeat from the first bar.
The two clocks can drift — the sim steps on frames, the music on the audio
clock — so the client measures the difference every bar, and past **60 ms**
re-seats the music with a short crossfade at the next bar line. The fight
never moves to meet the music; the music follows the fight.

### The enrage

Doc 005's enrage closes the rests. On the grid it closes them **in whole
beats**: the cadence drops a beat at a time toward its ceiling, so an enraged
king is heard as the same fight played tighter rather than as a fight that
has lost its time.

## Staging

- **The entrance.** The king sits on a throne at the far end of the arena. The
  fight starts when the player crosses the threshold: he stands on the riff's
  first downbeat, the name card — *The Crypt King* — holds for one bar, and
  his first move commits at the top of bar three.
- **The phase change.** Armour bursts off him as parts thrown out of the model
  (the plates the current boss sheds, now pauldrons, a helm, a breastplate),
  the crown remaining on the skull through both changes, the room shaking, the
  court's dead rising at the edge. It resolves on a bar line.
- **The wave is violet, the cut is red.** The greatsweep throws a sword wave
  and the greatslash throws none, and both cut the same sector. So the
  greatsweep's windup also draws, past the red sector, dashed violet arcs
  running outward (`drawWaveTell`, `TELE_WAVE`). The wave itself is drawn in
  the same violet (`KING_WAVE`), his cape's colour, not the red of his cuts.
  The player tells "step out of reach" from "leave the arc or dash it" before
  the blow lands.
- **The death.** He goes down on one knee on the sword, the core gutters out,
  the crown falls and rolls. The music stops on a final cadence rather than
  fading.

## Sound

The boss's own effects (`boss_impact`, `boss_sweep`, doc 018) stay, and each
move gains the sound of what now makes it: the chains **rattle** as the lash
turns and as the hook is thrown, the sword **rings once** as it is planted for
the slam and the quake, the leap takes off with a heavy rush of cloak. They
are survival cues and so are mixed at the top priority (018), and they land on
the beat by construction, because the moves do.

## What does not change

- Doc 005's mechanics: health, armour and its re-arming, the phase
  thresholds, every move's damage, reach, speed and counterplay, the lanes in
  every volley and their 18° minimum, the adds, the enrage's curve.
- The boss is still an `EnemyId`, so everything the roster has applies to it.
- The shockwave and the chains are still drawn on the pixel grid as the shapes
  the sim tests, with no taper.

## Verification

- `boss.test.ts` keeps its lane and reaction-floor checks. `rework.test.ts`
  fights the boss for thirty seconds in each phase under a freeze every 0.6 s,
  and checks that every blade and chain commits within one sim step of a beat
  and every slam, quake and leap landing within one step of a downbeat — or on
  the step a freeze ends, when the line fell inside it.
- `pnpm boss-bench` holds the gate: the blank and forming builds lose on
  `average`, the formed build wins eight of eight and pays about half its
  health, as doc 005 sets.
- `pnpm arena:preview` renders each phase's moves with the new body, so they
  can be judged in the room rather than as swatches.
- **The boss lab** (`?lab=boss`, the debug panel's BOSS tab) is the real fight
  with the run skipped: the boss's own moves, blades and volleys can each be
  held (`World.bossHold`), any move or blade is thrown on demand and still
  commits on its line (`queueBossMove`, `forceBossBlade`), the phase is set by
  hand, and the fight runs at 1×, ½×, ¼×, paused or a frame at a time, with a
  beat strip and a metronome on the fight's clock. It is where a move's
  animation, effects and sound are judged.

## Art

The body is new art, and only a new identity goes to the image generator
(016): one standing figure per phase, split into a model, and the key poses
the rig cannot reach. The order is `docs/art-workorder-boss.md`.
