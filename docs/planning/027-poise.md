---
id: 027
title: Poise
status: proposed
date: 2026-09-28
summary: Armour is gone. It was a pool of health on a few bodies that had to be spent before they could be interrupted, gone for good once spent, so a heavy body was unstoppable for two hits and could then be held in stagger to its death. Heavy bodies have poise instead. It is hidden and takes no health. Damage wears it, and a hit it holds through rings off it with sparks. The hit that wears it through interrupts it, a short flinch that cancels what it had started; a stun is still a wall's. Poise fills again after a short time unhit, and after a break the body can't be broken again for a while. The bellringer's ward now heals instead of shielding, and the armoured affix gives poise.
depends_on: [005, 013, 019, 024]
---

# 027 Poise

## Why

Armour did two jobs badly. It was a second health bar that the player spent
in two hits and then forgot. Once spent it was gone, so a tank or the
guardian was interrupted by every hit after it and could be held down to
its death. Poise gives the same verb, "one hit will not stop it", and it
comes back.

## The rule

| | |
|---|---|
| Who has it | only the heavy bodies (`POISE`): tank and breaker 24, warden and fusilier 16, the Frontier Veteran `GUARDIAN_POISE` (60); an `armored` elite doubles its body's poise, or gets `ARMORED_POISE` (18) if it has none. Everything else has none and is interrupted by any hit, as before |
| What a hit does | all of its damage is health. The same damage wears the poise. A hit it holds through rings off it (`poise_hold`: steel sparks and the armour-hit sound) and does not interrupt it |
| The break | the hit that wears it through **interrupts** it: a `POISE_BREAK_STAGGER_MS` (0.35 s) flinch, longer than a hit's 0.19 s, that cancels its attack, windup or aim (`poise_break`: a ring, a spray, the break sound). Its poise is whole again. It is not a stun: the stun, the long window with its mark over the head, is a wall's (1.2 s) |
| After a break | `POISE_GUARD_MS` past the stagger in which it can't be broken again: hits land, but they neither wear it nor interrupt it. It can't be held down |
| Recovery | unhit for `POISE_RECOVER_MS`, it is whole again. A heavy body is broken by a burst, not by hits spread across a fight |
| Shown | never as a bar. What a hit does is all the player is told. A visible bar would have to be a stagger bar, and most bodies die before one could matter. The Frontier Veteran lives long enough for one, and has it on top of its poise: its stance (doc 024) |
| Stars | only a stun (`Enemy.stunMs`) shows stars over the head and the stun mark: a wall, a cut ward line, the Frontier Veteran's broken stance. A break's stagger, or a heavy spell's, has neither |

The king has none: nothing interrupts him (`canStagger`). The guardian's
call can't be broken, because its poise is guarded while its arm is up. A
wall still knocks the guardian and the tank out outright.

The tank's health went from 34 to 58, the 34 it had plus the 24 armour it
carried in front of them, so killing one takes the same damage as before.

## The bellringer's ward heals

A hidden poise on an ally would have read as nothing happening. So the
ward, which was armour, now **heals**:

- The ally on a ringer's line regains `WARD_HEAL` (6%) of its health a
  second while the line holds, with green motes rising off it.
- The toll heals every ally on its lines `WARD_TOLL_HEAL` (30%) at once,
  with the pulse down the line.
- The answers stay the same: cut the line by standing in it, kill the
  ringer first, or hit it during the windup to stop the toll.
- Its "stand on the chain to break it" lesson goes away as soon as no chain
  is left, however the chain ended.
