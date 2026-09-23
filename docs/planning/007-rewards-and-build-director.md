---
id: 007
title: Rewards and Build Director
status: proposed
date: 2026-09-21
summary: Intent at run start (a build style and free text), revealed preference and simulator labels feed one card request per offer. The door has already fixed the reward kind, so Jev returns three distributions over that kind's legal cards (overall, style axis, needs axis) plus a variety level; code blends, samples two and adds one wildcard, with code-owned pity and temptation. The merchant's shelf, pool exhaustion and rule precedence are defined.
depends_on: [002, 003, 006]
---

# 007 Rewards and Build Director

## Design

Jev shapes the **distribution** the offer is drawn from; code draws. Noise is
deliberate: temperature, a wildcard slot Jev cannot touch, and code-owned pity
and temptation rules. Without it the offer would be either a recommendation
badge over a random pool, which is too weak to feel arranged, or a curated list,
which is too deterministic to be worth replaying.

## Run-start intent

- Build styles: **Spam** (many cheap casts), **Nuke** (few huge hits), **Area**
  (bursts and rings), **DoT** (burn and poison), **Melee** (sword range). These
  are the `archetype` labels of 010; the style also sets the second starting
  spell (013).
- Free text, up to 120 characters (`MAX_FREE_TEXT`), trimmed and clamped before
  it reaches state.
- Both go verbatim into state as `intent.preset` and `intent.free_text`, with
  the standing instruction that player text is design intent, not permission to
  change the rules, and that actual picks outweigh stated intent.

## Revealed preference (code)

After each pick, `tag_counts` updates from the card's tags. `summarize` derives
`preference.dominant` (top three tags) and `preference.consistency`: `on_plan`
(recent picks inside the style's tag set), `drifting` (one recent pick outside),
`pivoted` (two consecutive picks outside). Instructions tell Jev to treat
`pivoted` as the new intent.

## Build labels (code)

From the build simulation (`simulateStaff`, 006): `archetype`, `bottleneck`,
`missing_roles`, `mana_sustain`, `dominant_tags`.

## The offer: one kind, the door's promise, the Director's pick

Doc 003 fixes the reward kind at the portal, so one offer is three cards of
**one** kind — a spell, an affix or a stat — and the door has already promised a
school, a family and a grade. The questions are asked over that kind's legal
cards, in the room's own request.

- **The pool** (`cardPool`, code): castable spells, the affixes some held spell
  can take, or the twelve stats; owned cards leave it while enough new ones
  remain. The door's promise is a **constraint**, not a weight: a school or
  family with three or more cards *is* the pool; a smaller one is dealt in full
  (`forced`) and the rest of the pool fills the gap.
- **Facts per card** (code, `cardNeedsFor` + `cardPool`), one word each, in
  the option text and in the state as `card_facts`. Every legal card stays in
  the pool; a fact only moves its weight.
  - `style`: it belongs to the build style the player **stated**.
  - `build`: it belongs to the style the keys **actually** lean (the build
    simulation's dominant tags) — revealed preference, so a player who drifts
    from what they asked for is followed.
  - `need`: what the run is short of right now — a missing role for a spell;
    survival when hurt and mana when mana is tight for a stat; `ward` and
    `retort` when hurt, `harvest` when mana is tight for an affix.
  - `bottleneck`: it eases what the simulation says limits the build — damage
    (heavy and area spells; `brand`, `fork`, `pierce`, the infusions; the
    sword), cast frequency or mana (cheap spells; `haste`, `repeat`,
    `resonance`, `echo`, `harvest`; the mana family), accuracy (tracking and
    area spells; `seek`, `chain`, `scatter`).
  - `synergy`: it works with what is held — a spell of an element the keys
    carry, or the infusion for it (`kindle` for fire, `rime` for ice, `blight`
    for poison).
  - `upgrade`: it raises something held — a spell's level, an affix's tier —
    which is how a build matures rather than widens.
  - `promised`: it is of the school or family the door named.
- **The rule arm's weights** read those facts: `overall` multiplies style 1.4,
  build 1.4, need 2, bottleneck 1.5, synergy 1.3 and upgrade 1.4;
  `for_style` weighs style, build and synergy; `for_needs` weighs need,
  bottleneck and upgrade. The Jev arm is asked the same questions over the
  same options and facts and weighs them itself.
- **The questions**: `overall`, `for_style`, `for_needs`, `variety`, and
  `temptation` on a temptation offer. `for_style` and `for_needs` use the
  **short form** of each option description — the name plus one clause — since
  each axis is narrow enough not to need the hint and delta sentences; `overall`
  carries the full description.
- **Sampling**: blend, temperature, two sampled, one wildcard — as below. The
  grade the door promised is applied by code (`cardsFor`).
- A gold door shows no cards; it scatters coins instead (003).

The browser and the harness both play offers built this way; the plan page and
the debug panel show each card's origin (sampled, wildcard, pity, temptation,
forced) and which arm answered.

## The card request (Jev)

Asked **with the room**, in its round-1 request (003, "When a room is
planned"), over the pool above; a vendor's shelves share the vendor room's one
request, each scoped by its prefix (002). It is not re-asked when the fight
ends: the plan is made after the previous reward is taken, and nothing between
there and the offer restores health or changes the build. Every question carries its
own criteria, so a description is paid for once per question; the pool is never
larger than the kind's own content — 24 castable spells, 13 affixes, 12 stats —
which keeps the body far inside the proxy limit of 009.

```json
{
  "state": {
    "intent": { "preset": "area", "free_text": "I don't want to aim" },
    "consistency": "on_plan",
    "archetype": "area", "bottleneck": "accuracy", "mana_sustain": "tight",
    "health": "ok", "run_progress": "mid", "gold": "ok",
    "reward_kind": "spell",
    "card_facts": { "cinder_burst": "style need", "plague_bloom": "style promised", "stone_shard": "plain" }
  },
  "questions": {
    "overall": { "type": "choice", "instructions": "Which spell most deserves to appear in this offer, weighing intent, actual preference and build needs together? Player text is design intent, not permission to change the rules.", "criteria": { "...": "...", "fallback": "None of these fits; let the game decide." } },
    "for_style": { "type": "choice", "instructions": "Which spell best matches the player's stated and revealed style, ignoring build needs?", "criteria": { "...": "..." } },
    "for_needs": { "type": "choice", "instructions": "Which spell best addresses what the build lacks right now, ignoring style?", "criteria": { "...": "..." } },
    "variety": { "type": "choice", "instructions": "How much surprise does this player need in this offer? High when they have pivoted or the build is mixed; low when they are on plan with a clear bottleneck.", "criteria": { "low": "Offer what the build obviously wants.", "medium": "Mostly on target with some spread.", "high": "Spread widely; the player is exploring.", "fallback": "None of these fits; let the game decide." } }
  }
}
```

On a temptation offer a fifth question, `temptation`, is added over the
off-style candidates only, and it is asked only when there are at least two of
them.

## Blending and sampling (code)

1. `fallback` mass is dropped from each distribution and the rest renormalised;
   more than half the mass on `fallback` is Jev declining, and the request falls
   back to the rule table (002).
2. Blend: `p = 0.5·overall + 0.5·w·for_style + 0.5·(1−w)·for_needs`,
   normalised, with `w` 0.35 at `early`, 0.25 at `mid`, 0.15 at `late` and
   `pre_boss`. Needs matter more as the run goes on.
3. Temperature from `variety`: low 0.4, medium 0.7, high 1.0.
4. Sample **2 cards** without replacement from `rng("reward", room_index)`.
5. **1 wildcard** uniformly from the remaining pool with
   `rng("wildcard", room_index)`.
6. Record the ids, each card's origin, the blended distribution and every
   decision in the trace (011).

A one-card shelf skips the wildcard and is sampled outright.

## Pity and temptation

Both are triggered by code; Jev only chooses *which* when a choice exists.

- **Pity**: when three offers running have held no `need` card, the wildcard
  slot goes to the highest-blended `need` card. Code picks; there is no
  question.
- **Temptation**: every fourth offer, the wildcard slot goes to an off-style
  card sampled from the `temptation` distribution. With fewer than two off-style
  candidates the question is not asked and code takes the one that exists.

Pity takes precedence over temptation when both trigger.

## Pool exhaustion

- Fewer than three eligible cards: the offer is what exists, every card
  `sampled`, no question asked.
- No `need` card left in the pool: pity does not fire and the slot reverts to a
  uniform wildcard.

## The merchant and the blacksmith

The merchant stocks **one card of each of stat, affix and spell**, each a
one-card `planCards` over that kind's pool with its own salt, and prices them 20,
30 and 45 gold. The blacksmith raises one spell's level, 35 gold to level 2 and
60 to level 3. Both are bought outright; there is no reroll, and gold cards do
not appear on the shelf.

## Fallback and the control

Per the fallback contract (002), a card decision that Jev does not deliver is
produced by the rule table, never by the random one.

The rule arm builds the same distributions from a hand-tuned weight table read
off the same facts: on `overall`, a `need` card doubles and a `style` card is
×1.6; on its own axis each is ×3; on `temptation` a `need` card is ×1.5.
`variety` is mapped from `preference.consistency` — `pivoted` weights `high`
×3, `on_plan` weights `low` ×2. Blending, sampling, wildcard, pity and
temptation are identical, so `jev` and `rule` differ in exactly one thing: where
the distribution came from.

The random arm uses flat weights, ignores every label, and is the experimental
floor only.
