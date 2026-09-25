---
id: 018
title: Sound and Music
status: proposed
date: 2026-09-24
summary: Fifty-four synthesised effects in three categories — combat, world, UI — built so weight, spell school and telegraph family are each audible; loudness set per category by RMS, capped at -1 dBFS, with one mixing policy (retrigger floor, category cap, one blow per body, one tail per school, fading repeats, a four-voice priority budget, density gain) so a boss fight is not a wall of sound, and the music ducks only for the moments that matter. Music is a runtime WebAudio sequencer over a score held as data in core: one piece, one transport, four states that differ only in per-layer gain, a key and mode chosen by the room's temperature, and a ninety-one second loop. One audio object owns the global switch and two independent volumes.
depends_on: [005, 008, 009, 013]
---

# 018 Sound and Music

## Why

Sound is not decoration on a fight. Joonas Turner, who did the audio for
Nuclear Throne and Downwell, puts it at "one third of the overall immersion
and feel", and on Jan Willem Nijman's ordering in *The Art of Screenshake* it
comes ahead of every visual effect in the game.

The first set was written for a bullet hell: nine effects, a shot, a hit and a
death. The game is now a sword, eight schools of spell, sixteen enemy
archetypes with three families of telegraph, and a boss in three phases. Nine
effects cannot carry that. A player who cannot hear the difference between a
blow that landed and a blow that armour ate, or between a body about to charge
and a body about to slam the floor, is playing on sight alone in a room that
is often busier than sight can follow.

## What a sound is made of

Everything is **synthesised, seeded and pure**. The source of truth is a
function; the output is byte-reproducible; a change is a diff in a parameter
rather than a binary nobody can review. This is the same rule the sprite sheet
is generated under, for the same reason.

The synthesis kit lives in `core/audio/dsp.ts`: FM for metal and glass,
filtered noise for air and grit, pitch envelopes, transient layering, and a
short tail from three feedback delays with a lowpass on the feedback path.
There is no convolution reverb, because an impulse response is exactly the
sourced binary the pipeline exists to avoid.

A sound is **layers, not a waveform**. Turner decomposes a gunshot into "a sum
of projectile shooting out, chassis sounds, any animated part, trigger click".
Every effect is built the same way: a single oscillator with an envelope reads
as a beep whatever is done to it.

**Variants defeat fatigue.** Effects that repeat several times a second ship
three or four variants. The player never plays the same variant twice in a
row, and re-rolls rather than cycling, because a cycle is itself a pattern the
ear finds over a long fight.

## The three things the set has to make audible

**Weight.** A hit is not one sound with a volume knob. `hit_light` is a tick,
`hit_enemy` a thwack, `hit_heavy` a crunch with a sub layer under it that the
lighter two do not have. Which one plays is chosen by the damage dealt, not by
what threw it: a levelled, affixed bolt should land like a hammer and a bare one
should not, and neither of those is a fact about the sword. Armour intercepts
this: a blow a body's plate ate is `hit_armour`, bright and ringing and
unrewarding, so the player hears that the damage did not land where they
aimed.

**School.** Each of the eight spell families has its own timbre, so an element
is told apart in the channel the eyes are not on, exactly as bullet colour
tells it apart in the channel they are.

| School | Timbre |
|---|---|
| arcane | a glassy FM chime with a zap through it |
| storm | crackle over a hard pulse buzz — many small discharges, not one |
| stone | a thud with grit on it |
| flame | a falling note, a whoosh, then embers |
| frost | a crystalline tink with a shimmer of ice behind it |
| venom | a wet bubble, lowpassed and pitch-wobbled |
| void | a sub pull, and the only cast whose air sweeps inward |
| spirit | an airy shimmer, a fifth, breathed rather than struck |

`schoolOf` in the reward system is the taxonomy, reused rather than invented
again. The one exception is the plain magic bolt, which is filed under `void`
and gets the arcane chime, because a starting bolt speaking with a sub-bass
pull would be the loudest thing in the first room.

A spell landing is **the weight hit plus the school's tail**, so an element is
heard on the body it hits and not only as it leaves the hand.

**Telegraph family.** Three promises, three contours, and no two of them
rhyme.

- `tele_charge` rises and tightens: a body is about to cross the room in a
  line, and the answer is to stop being on that line. Charge, lance, bristle
  and thrust.
- `tele_slam` falls and swells, with a dread pair under it: the ground inside
  the circle is about to stop being ground. Slam, cleave, bash, whirlwind and
  sweep, and the boss's own moves an octave down.
- `tele_aim` is two thin steady tones and the only cue that does not move in
  pitch at all, which is what lets it be picked out while several of the other
  two are running.

A sidestep and a blink get no cue. They are movement rather than a
promise of damage, and cueing them would make the three families mean nothing.

The player's hurt is the one sound allowed to be unpleasant: it holds a minor
second so the two tones beat against each other, and its transient sits in the
2–3 kHz band the ear is most sensitive to, because it has to arrive over a
full room of fighting.

## The mix

Three categories, and each is levelled **by RMS and only limited by peak**.
Matching peaks would make a 40 ms click meter as loud as a 400 ms boom and
sound half as loud.

| Category | Sits | Effects |
|---|---|---|
| combat | on top, because it is the channel the player acts on | 35 |
| world | under combat | 13 |
| UI | under that: a menu is never competing with anything | 6 |

Nothing peaks above **-1 dBFS**. Effects are rendered at -1.4 dBFS, because
the player also applies a small random per-play volume and some of those rolls
are above unity.

Two rules keep a repeated effect from turning into a machine noise:

1. Never the same variant twice in a row.
2. A small random pitch and volume per play. Small deliberately: wide ranges
   sound jarring rather than natural.

The rest are about a room that fires fifteen effects a second, and they are
one pure policy, `SfxMixer` in `core/audio/mix.ts`, that the client asks
before every play. A boss fight is the case they are written for: the one big
body is struck several times a second, and without them every blow plays in
full with its spell's tail on top while the music is ducked for more than
half the fight.

3. **A floor on how often one effect may retrigger**, so eight enemies dying
   together read as one event rather than as eight.
4. **A cap on how many sounds of a category may start inside one window.**
   Five combat voices in 70 ms, three world voices in 90 ms, two UI voices in
   60.
5. **One blow per body.** Hits on the same body within 140 ms are one hit.
6. **One tail per school.** A spell's impact tail plays at most once per
   250 ms; the second one says nothing the first did not.
7. **Repeats fade.** Each further play of an effect within 450 ms is quieter
   by a third, down to 30%: the first of a flurry is the one that carries.
8. **A voice budget, by priority.** At most four combat effects sound at
   once. A request that outranks the lowest sounding voice steals it (a 40 ms
   fade, not a cut); otherwise it is dropped. Survival information — hurt,
   telegraphs, an enemy's blow arriving, the boss's own moves — outranks the answer to the player's action
   (hits, kills, armour breaking), which outranks the action (swings, casts),
   which outranks texture (tails, wall chips).
9. **Density gain.** With *n* combat voices sounding, a new one starts at
   √(2/*n*) of its level, so a pile of effects is not louder than the music
   under it. Survival cues are exempt.

The music ducks only for the moments that matter — being hurt, going down, a
boss changing phase, a heavy body dying — never for an ordinary blow.

Every swing is the same swing (doc 013), so every swing plays `swing_light`
and the spin plays `swing_spin`. `swing.chained` only says the conjured blade
is already out; it does not choose a sound.

Files are mono, 16-bit, 22.05 kHz and short: 54 effects in 118 files, about
1.6 MB in total.

## Music

**One piece, one transport, four states.** The states — title, explore, fight,
boss — play the same notes in the same bar; a state change is eight gain ramps
over a second and a half. Walking into a fight does not start a fight track:
it adds the kit and a driving bass to the bar already running. Intensity is
layering, never a cut to another song.

The piece is in A minor, at 84 BPM, on the progression i · i · VI · VII · i ·
iv · v · VI. Its eight bars run four times, with the melodic and percussion
figures permuted across the passes by a fixed order that does not itself
repeat, so nothing recurs exactly until bar 32 — a little over ninety-one
seconds. It is restrained: nothing plays on every sixteenth, the pad moves
twice a bar, and the drums are felt rather than counted. Chiptune-adjacent and
deliberately warmer than chiptune: triangles wherever a square would do, every
sustained voice detuned against itself by a few cents, and a lowpass on
everything but the hat.

**The room's mood is the key.** A warm room lifts the sixth, which is the note
that separates a dungeon from a lament; a cold room drops the key a minor
third and flattens the second, which is the Phrygian colour dark fantasy
dungeons are written in. Two notes and three semitones: enough to hear, not
enough to be a different piece.

Clearing a room gets a short sting — a rising fourth answered an octave up,
over the piece rather than instead of it — on its own bus, because the bell
layer is silent in a boss room and the one moment a bell has certainly been
earned is the moment the fight ends.

### Why a sequencer and not rendered loops

Ninety seconds of stereo at 32 kHz is eleven megabytes of wav per state, and
four states is forty-four. The only thing that brings that down is an Ogg or
Opus encoder, which is not in this repository and is not worth a build
dependency for one asset. A sequencer costs a few kilobytes of pattern data
and buys three things loops could not have given: layers that fade
independently, a key that follows the room, and a loop that is long without
being large, because length is arithmetic rather than bytes.

The instruments are **sample-level and live in core**, not built out of
`OscillatorNode`s. The browser renders each note once through the same
function the harness uses and schedules the buffer; the harness sums the same
buffers into a wav. One renderer used twice, so the mixdown that is reviewed
is the piece that plays. Notes are handed to WebAudio a bar ahead on a plain
interval rather than on the render loop: a 40 ms frame would otherwise be a
late note, and the ear is the better clock.

## The audio API

One object, `Sfx`, owns effects and music alike, so there is one switch rather
than two that have to agree.

- `setEnabled(on)` / `isEnabled()` — the global sound switch, obeyed by both.
  Aliased as `setMuted` / `isMuted`. Turning it off takes the music bus to
  silence without stopping the transport, so turning it back on rejoins the
  piece where it got to.
- `setSfxVolume(v)` / `getSfxVolume()` and `setMusicVolume(v)` /
  `getMusicVolume()` — independent of the switch and of each other, persisted
  under `jr.vol.sfx` and `jr.vol.music`.
- `unlock()` — starts the audio context and the music. Called from the first
  key press and the first click, because a browser will not let it start on
  anything else.
- `play(name, pitch)` — one effect.
- `setMusic(state, mood)` — free to re-assert; a repeat of the current state
  does nothing, so the caller never tracks edges. `musicSting()` for a clear.

Sound is **off until it is asked for** and remembered like the other settings
(`jr.sound`): a page that makes noise on its own is a page people close.

## Where the sounds are chosen

Every sound of a simulation step is decided in one method, `playWorldSounds`,
from three sources: the step's `WorldEvent`s; the rising edges of the player
states that have no event — the swing, the dash strike, the cast windup and
the cast itself, which is detected as a spell's cooldown starting, the one
edge that is true for a bolt, an eruption and a summon alike; and the set of
bodies that have just entered a windup, because a telegraph is a state and
cueing it every step would smear it into noise.

One method, because a hit's weight, a spell's school and a telegraph's family
are decisions about the mix and belong next to each other. Scattered beside
whichever particle burst happened to be nearby, they could not be seen or
changed without reading the renderer.

## Verification

Nobody can listen to a hundred and eighteen files and hold them in their head,
so `pnpm audio:check` renders every effect and an excerpt of every music state
from the code the game runs, and reports duration, peak, RMS, approximate
LUFS and spectral centroid per effect. It fails on any of:

- anything peaking above -1 dBFS, or effectively silent;
- a category spreading more than 9 LU, which is a mix nobody levelled;
- two effects in **different** categories within 0.06 cosine distance on a
  20-band spectral fingerprint with the envelope shape appended. A coin that
  reads as a sword hit is a bug, and it is one that only shows up as a number.
  Resemblance *inside* a category is often the point — the three weights of
  hit are meant to be a family.

`pnpm audio:check --listen` also writes two minutes of each state, the sting,
and a pass through every effect, to a temporary directory. Never into the
repository, which holds only what the game loads.
