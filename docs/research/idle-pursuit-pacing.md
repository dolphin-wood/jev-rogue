# Idle enemies, pursuit, and build pacing — research notes

Web research for three questions: how dormant enemies should behave before they
notice the player, whether whole-map perfect pursuit is right for a locked
arena, and how roguelikes make sure the player reaches the boss with a mature
build. Numbers from Slay the Spire and Hades come from community wikis and
dataminers, not developer statements. Observations from play are marked
*(observed)*.

## 1. Idle / dormant behaviour

**Standing still reads as dead.** Treating the out-of-combat state as a looping
idle "very quickly feel[s] repetitive and artificial"; the cheap fix is *idle
breaks* — a short clip every few seconds (look around, shift weight) over the
base idle ([GDKeys, AI: Keys to Believable Enemies](https://gdkeys.com/ai-keys-to-believable-enemies/)).
The second fix is *occupation*: patrols make the room feel like it is breathing
and give the player a rhythm of windows.

**The perception ladder.** Calm → suspicious → alerted, driven by distance,
line of sight and noise; "chase when you spot them, investigate where they were
last seen, give up and return" ([UhiyamaLab, UE5 AI Perception](https://uhiyama-lab.com/en/notes/ue/ai-perception-sight-hearing/)).
Halo keeps a per-target model that can be *wrong*, and Bungie called
misperception the most interesting good mistake an AI can make
([Bungie on eight years of Halo AI](https://www.gamedeveloper.com/game-platforms/in-depth-bungie-on-eight-years-of-i-halo-i-ai)).
Halo 3 layered *stimulus behaviours* (spotting the player, a grenade landing, an
officer dying) over squad tasks
([Encounter design of Halo 3](https://www.gamedeveloper.com/design/combat-evolved-the-encounter-design-of-halo-3)).

**The wake telegraph.** Reaction time is about 0.25 s (15 frames), 0.3 s and up
for perceive-decide-press
([Bugnet, attack telegraphs](https://bugnet.io/blog/how-to-design-enemy-attack-telegraphs);
[Enemy attacks and telegraphing](https://www.gamedeveloper.com/design/enemy-attacks-and-telegraphing)).
A wake "!" is an aggro telegraph and needs the same budget: at least 0.25–0.4 s
before the body can act.

**Small-arena games mostly skip idle.** Hades spawns enemies live into a locked
arena; Isaac's rooms are active on entry, the idle being the movement pattern;
Nuclear Throne has sleeping enemies framed as a reward for the player who sees
them first ([wiki](https://nuclear-throne.fandom.com/wiki/Enemies)). Dead Cells
and Hyper Light Drifter have real pre-aggro, and Dead Cells players complain
about ranged aggro "through walls and from distance"
([Steam](https://steamcommunity.com/app/588650/discussions/3/2865910087351316486/)).
Dormancy pays off only when the player can act on it: a free hit, an engagement
order, a group avoided.

## 2. Pursuit

**Omniscient chase collapses a fight into bodies on a line.** Halo routes
through squares outside the player's sight and uses *territories* so the whole
room does not attack at once
([Halo AI](https://www.gamedeveloper.com/game-platforms/in-depth-bungie-on-eight-years-of-i-halo-i-ai)).

**Attack tokens** are the highest-value technique: DOOM (2016) gives each attack
type a few tokens, a demon must hold one to attack and releases it after, and
difficulty scales the pool
([AI of DOOM](https://www.gamedeveloper.com/design/cyber-demons-the-ai-of-doom-2016-);
[GDC 2018](https://www.gdcvault.com/play/1024940/Embracing-Push-Forward-Combat-in)).
Arkham lets two or three attack at once. Tokens must auto-release on death,
stun and abort ([Iron Reclamation devlog](https://lghts.itch.io/iron-reclamation/devlog/1092177/making-combat-feel-good-fair-readable-and-responsive-ai)).

**Rings and spacing.** A player-anchored ring of slots, nearest-free-slot
claiming, separation, and seek-with-offset
([Battle Circle AI](https://gamedevelopment.tutsplus.com/tutorials/battle-circle-ai-let-your-player-feel-like-theyre-fighting-lots-of-enemies--gamedev-13535)).
A survey of DmC, God of War 3, Ninja Gaiden 2, Arkham City and others: an attack
every 2–3 s from the crowd; a near group and a far group; a buffer zone round
the player; waiting enemies visibly do something; almost never attack from
off screen ([melee combat AI](https://www.gamedeveloper.com/design/enemy-design-and-enemy-ai-for-melee-combat-systems)).

**Ranged.** DOOM's ranged demons hold distance and deliberately miss more the
faster the player moves ([AI of DOOM](https://www.gamedeveloper.com/design/cyber-demons-the-ai-of-doom-2016-);
[Game AI Pro 3 ch. 33](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter33_Using_Your_Combat_AI_Accuracy_to_Balance_Difficulty.pdf)).
On losing line of sight, aim and path to the *last known position*. In a locked
room leashing is moot; what matters is a de-aggro breath so the fight has waves.

## 3. Build pacing

- **Slay the Spire**: normal rewards about 60 / 37 / 3 (common / uncommon /
  rare) with a pity offset starting at −5%, +1% per common, reset on a rare,
  capped at +40%; shops 54 / 37 / 9 and outside the pity; elites skew up; boss
  rewards all rare ([wiki](https://slay-the-spire.fandom.com/wiki/Card_Rewards)).
- **Hades**: the first chamber and mini-boss chambers force a boon; reward type
  follows a self-correcting controller toward a target ratio
  ([Chamber Reward](https://hades.fandom.com/wiki/Chamber_Reward)); runs land on
  about four gods' lines *(observed)*.
- **Dead Cells**: 2–4 scrolls per level, dual-stat scrolls weighted toward the
  player's *lowest* stat, so an unbalanced build self-corrects; DPS doubles
  every +5 ([Stats](https://deadcells.wiki.gg/wiki/Stats)).
- **Vampire Survivors**: 3–4 options a level, finite reroll, skip and banish
  ([Level up](https://vampire.survivors.wiki/w/Level_up)).
- **Binding of Isaac**: a treasure room guaranteed on every floor, plus a boss
  item ([Treasure Room](https://bindingofisaacrebirth.wiki.gg/wiki/Treasure_Room)).
- **Risk of Rain 2**: power bought with time against a difficulty clock.

## Recommendations for this game

Idle and wake:

1. Dormant bodies loop idle, idle breaks (look around) and short wanders inside
   a home radius, desynchronised per body.
2. Mix idle roles in a group: guard (stationary, scans), patrol, sleeper (noise
   only), idler.
3. Noticing is range ∩ line of sight, plus a hearing radius for the player's
   attacks and dashes.
4. Always telegraph the wake: a "!" and at least 0.3 s planted before acting.
5. Alerts spread to nearby allies with a short stagger, a visible ripple.
6. A body killed before it wakes should be worth something.

Pursuit:

7. Keep the flow field as navigation; feed it a target — a ring slot, or the
   last known position when sight is lost.
8. Attack tokens with auto-release (this game has them: `attackTokens`,
   `fireTokens`).
9. An attack from the crowd every 2–3 s; waiting bodies circle and reposition.
10. On losing sight: go to the last known position, look round, re-acquire.
11. Ranged bodies hold a band and back off from a closing player.
12. A de-aggro breath: a body that has held a token without landing for about
    4 s releases it and backs off.

Build pacing:

13. Fix the number of picks a run and design against it (8–12 meaningful picks
    for 15–20 rooms).
14. Structural guarantees over odds: the first reward build-defining; elite and
    pre-boss rewards graded up.
15. A pity counter on rarity.
16. Weight offers toward the key the player has invested in least (baseline)
    *and* toward what they hold (synergy); they do not conflict.
17. Instrument it: log the player's power at boss entry per run; fix the bottom
    decile structurally, not with a global buff.
