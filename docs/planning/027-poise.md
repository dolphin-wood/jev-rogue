---
id: 027
title: Poise
status: proposed
date: 2026-09-28
summary: Every body has poise; the plated and the elites show it as a thin gold line under their feet. A blow wears it by the blow's weight, not its damage, so a sword blow or a heavy spell wears it and a spray of sparks barely does. Nothing short of the break interrupts a body, and the break interrupts whatever it had started. How much poise a body has is set by how long its attacks are announced, so a held sword can never lock it and a quick attack is never unstoppable. Poise refills slowly, only after two seconds unhit, and after a break the body cannot be broken again for 1.85 s. The Frontier Veteran's poise is its stance. The bellringer's ward heals.
depends_on: [005, 006, 013, 019, 024]
---

# 027 Poise

## Why

Armour was the first answer, and it did two jobs badly. It was a second
health bar the player spent in two hits and then forgot. Once spent it was
gone, so a tank or the guardian could be held in stagger to its death. The
first version of poise fixed that for the heavy bodies only. Everything else
was still flinched by every sword blow while it was not attacking, and the
flinch pushed its next attack back.

That left the late run as a room of bodies waiting to be hit. A held sword
lands about every 400 ms against a 190 ms flinch, so a body in reach only
ever had 210 ms between blows, and no attack in the roster starts that fast.
The player's build grows every room, so by room 10 most bodies were cut down
before they had a turn at all ("后期的怪都在等着我去打它").

## What other action games do

- **Hades** ([Status effects](https://hades.fandom.com/wiki/Status_effects),
  [Armored enemies](https://hades.fandom.com/wiki/Armored_enemies),
  [Gameplay mechanics](https://hades.fandom.com/wiki/Gameplay_mechanics)).
  Most weapon hits stagger ordinary enemies, which cancels their attacks
  and movement. Elites carry **armour**: a yellow bar over their health, and
  while it holds they ignore stagger and knockback and keep attacking through
  the player's blows. Breaking it briefly stuns them. Bosses are never
  staggered. Hades keeps its *neutral game* (立回り) mostly through what
  surrounds the stagger rather than through the stagger itself:
  - rooms are crowds, several bodies at once and from several sides;
  - attacks come from range: shots, lobs and marked ground;
  - the player's dash is the main defence;
  - the armoured elites, the fight the player "can't hitstun", are answered
    by baiting an attack, dodging it and punishing it.
- **Elden Ring** ([Stance](https://eldenring.wiki.gg/wiki/Stance),
  [Poise](https://eldenring.wiki.gg/wiki/Poise)). Every enemy has a hidden
  stance, about 15 to 65 for ordinary enemies. Attacks deal stance damage
  **separately from their damage**, heavier attacks more. Stance recovers
  after a few seconds without being hit, then quickly. Many enemy attacks
  have hyper armour of their own.
- **Sekiro** ([Posture](https://sekiroshadowsdietwice.wiki.fextralife.com/Posture)).
  Posture is a **visible** bar, and a full bar is the kill. It recovers
  continuously, more slowly the more health is lost, so damage and posture
  pressure feed each other.
- **Beat-'em-ups and Musou**
  ([Immune to Flinching](https://tvtropes.org/pmwiki/pmwiki.php/Main/ImmuneToFlinching),
  [Super Armor](https://giantbomb.com/wiki/Concepts/Super_Armor)). Without
  super armour, enemies can be stun-locked with no counterplay, and the
  games turn into mash-fests. Super armour takes one hit without
  interruption and is broken by the next. Hyper armour takes everything and
  is kept rare.

Three things carry over:

1. **Poise damage is not damage.** Hits wear poise by their weight.
2. **Something has to stop a stun-lock**, whatever the numbers. Here that is
   the break's guard.
3. **Recovery waits for a lull.** Poise refills only after the body has been
   left alone for a while, so a player who backs off to dodge keeps their
   work.

## The rule

| | |
|---|---|
| Who has it | **every body** except the king. How much is set by how long its attacks are announced (`POISE` in `enemy.ts`, below) |
| What wears it | a blow's **weight**, not its damage (`poiseOfWeight`, below). All of the damage is still health |
| A blow it holds through | shown on its bar. A plated body (tank, breaker, warden, fusilier, an `armored` elite) also rings with sparks and the armour sound (`poise_hold`). It is **not interrupted**, and the sword no longer flinches it |
| The break | the blow that wears it through **interrupts** it: a `POISE_BREAK_STAGGER_MS` (0.35 s) flinch that cancels its attack, windup or aim, mid-attack included (`poise_break`). Its poise is whole again. It is not a stun: a stun, with the stars over the head, is a wall's |
| After a break | a guard of `POISE_GUARD_MS` past the stagger (1.85 s in all). Blows land, but they neither wear its poise nor interrupt it. It always gets a turn inside it, since every tell in the roster is shorter |
| Recovery | nothing comes back for `POISE_REGEN_DELAY_MS` (2 s) after its last blow, longer than a dodge and the attack it answered. Then it refills at `POISE_REGEN_PER_S` (40% of the bar a second) |
| Scaling | multiplied by the room's `hp` (the player's damage grows too) and softened in the opening by `Ramp.poise` (0.6 → 0.8 → 1 by room 6), blended room by room like the rest of the ramp. `armored` doubles it |
| Shown | on the **plated and the elites only**: a thin gold line under the feet, with no frame, filling as blows wear it, from the first blow until it has refilled. It flashes in its last quarter. During the guard it is pale and draining. The others break in two blows, so a bar on them was full the moment it appeared; whether they were stopped shows in the body. It is under the feet because over the head it was drawn across every damage number |
| Heard | a plated body's break is `armour_break`, which is rare and earned. Every other body's break is heard as the hit that caused it: a cue of its own on each would rattle under every fight |

### How much, by tell

Poise is what lets a body finish an attack the player is standing in. A held
sword lands about every 400 ms, so a body whose windup is `W` long takes at
most ⌈W / 400⌉ blows before it commits. Poise covers that and a little more.
It is never so much that a body whose tell is under a reaction's length
can't be stopped by anything the player has. The dash cancels a swing
outright, so a player who is holding the sword and sees a tell can always
leave.

| tier | bodies | tells | base | at room 8 (sword ≈ 15) |
|---|---|---|---|---|
| the quick blades | rusher, delver, burrower | 280–320 ms | 12 | 2 blows |
| the long blades | lancer 18; warden, fusilier 20 | 380–400 ms, the gun 950 | 18–20 | 3 blows |
| the heavy | tank, breaker | 520–640 ms | 28 | 4 blows |
| the gunners | shooter, turret, orbiter, sentinel, sower, cinderling and their subspecies | an aim of 320 ms | 8 | 1 blow |
| the casters | summoner, bellringer, rifter, snarecaster and their subspecies | 620–900 ms | 12 | 2 blows |

The gunners are lowest. They keep their distance, and a sword that reaches
one should break it. They aren't zero, so a gunner the player stands on
still gets its shot off inside the guard.

### What a blow does to poise

| blow | share of its damage |
|---|---|
| the sword | 1 (`SWORD_POISE`); the last cut of a run 1.5; a spin's blows 0.5 |
| a dash's cut, a free strike | 1 |
| a **heavy** spell (`weight` 1.2 and up: the cannon, the stone shard, the glacier spike, the void orb, the quake, the earth spikes, the counter-stance) | its own weight, 1.2–2.4 |
| a spell of the **bolt's** class (`weight` 1 to 1.2) | 0.4 |
| a **light** spell (`weight` under 1: sparks, darts, seekers, pellets, the scatter and the spray) | 0.1 |
| a spell's carried effect (a chain's arc, a mark's burst, a harvest) | 0.2 |
| the maw's pull; its collapse | 0.1; 1.2 |
| a tick: burn, poison cloud, lava, the slow half of doom | 0 |

A spell's `weight` already decided how far a hit pushes and whether it
staggered (doc 006), so it decides this too. A heavy spell cast on a body in
reach of the sword breaks what the sword alone would take two or three blows
to break. A build of light projectiles kills without breaking. It can still
reach the break with the sword, or it can avoid needing to.

## The Frontier Veteran

Its **stance is its poise**. The gold bar over its head fills by the same
poise damage, and a wall still fills 35% of it. Its break is the long
kneel: 3.2 s with stars, taking ×1.5, and a call in progress goes
unanswered. It no longer has a smaller hidden poise of 60 underneath that
flinched it every few blows. Nothing short of the stance interrupts it,
which is the Hades rule for bosses and elites, and every body's bar now
means one thing.

## Measured

Stand-and-mash (the player still, the sword held, one body in reach with 20×
health, 20 s, 10 seeds), hits the player took before and after:

| body | room 8 | room 12 |
|---|---|---|
| tank | 1.7 → 4.6 | 1.9 → 4.6 |
| rusher | 7.1 → 8.3 | 6.9 → 8.5 |
| lancer | 6.1 → 7.1 | 5.9 → 7.1 |
| gunners | unchanged | unchanged |

In the harness (24 runs, `rule`, expert), per cleared room, before → after:

| room | before | after |
|---|---|---|
| build | 0.99 | 0.96 |
| elite | 2.21 | 2.06 |
| peak | 1.35 | 1.26 |
| release | 1.02 | 1.00 |

Rooms 1–2 are 0.43 / 0.37 → 0.28 / 0.20. The reference player doesn't stand
and mash, and the break now gives it an interrupt it did not have before: the
old sword could never cancel an attack already under way. The Veteran bench
(`guardian-bench`, 8 seeds) is unchanged: 8 of 8 won in 23–24 s, with two
stance breaks a fight.

## The bellringer's ward heals

A hidden poise on an ally would have read as nothing happening, so the ward,
which was armour, now **heals**:

- The ally on a ringer's line regains `WARD_HEAL` (6%) of its health a
  second while the line holds, with green motes rising off it.
- The toll heals every ally on its lines `WARD_TOLL_HEAL` (30%) at once,
  with the pulse down the line.
- The answers stay the same: cut the line by standing in it, kill the
  ringer first, or hit it during the windup to stop the toll.
- Its "stand on the chain to break it" lesson goes away as soon as no chain
  is left, however the chain ended.
