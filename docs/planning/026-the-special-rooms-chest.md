---
id: 026
title: The Special Room's Chest
status: proposed
date: 2026-09-28
summary: A room that asked something other than "kill everything" leaves a chest beside its reward when it clears. That means the first audience, the guardian, and a hold or destroy room. Pressing E at the chest shows a card of what it holds: CHEST_GOLD, a merchant's price for one stat card, and one stat upgrade. Code decides that there is a chest. The Director picks the stat from the stat door's own pool, in the room's round-1 request, with no extra call. The heal after the fixed fights is settled here too. The guardian leaves GUARDIAN_HEARTS hearts that fly to the player. The first audience needs none, because its spare hearts already come home when he leaves.
depends_on: [002, 007, 013, 022, 024, 025]
---

# 026 The Special Room's Chest

## Why

The special rooms cost more than an ordinary fight: the first audience and
the guardian are the run's two seams, and an objective room keeps sending
bodies. Until now they paid the same kind of thing an ordinary room does, a
grade higher at most. A chest makes the extra cost visible as extra reward,
and we already have its closed and open frames (`prop_chest_0`, `prop_chest_1`).

## What it is

| | |
|---|---|
| Which rooms | the first audience, the guardian (`isFixedFightRoom`), and any fight with an objective (`objectiveFor`, or one forced from the debug panel) |
| Where | beside the reward, two tiles to one side, never on a hazard (`placeChest`); beside the player in a room with no reward |
| How it opens | the interact key (E), as the reward does. A card shows the stat and the gold; the player takes it with E, Enter or a click, and the lid comes up. The fight is held while the card is up |
| What it pays | `CHEST_GOLD` (20, one stat card at the merchant), bursting out and flying to the player, and **one stat upgrade** applied at once |
| Doors | held for it, as they are for the reward: they rise once both are taken, in either order, and in a gold room once the chest alone is opened (`openWayOut`). The chest is all upside with nothing to choose, so a door beside it would only be a way to lose it unseen |
| How it is found | it drops in with a puff of dust and stands in the reward's floor light in gold, with motes, sparks and a chevron bobbing over it; the minimap marks it with an amber box while it is shut |
| Once open | the lid comes up on the gold, the gold flies home, and the chest fades away: an open chest left standing reads as one still to open |

## Who picks the stat

Doc 002: code narrows the options, and the Director chooses. The pool is the
stat door's own (`cardPool(…, "stat", …)`), and every entry in it can be used
by any build (doc 013). The request is one card with salt `chest`, riding in
the room's round 1 beside the room's other questions, so it costs no request
of its own. Its answers are recorded under the prefix `chest__`. If the
Director cannot answer, the rule offer picks one.

## The heal after a fixed fight

- **The first audience needs none.** The drop-in fills the bar and leaves
  `CRASH_HEARTS_SPARE` on the floor. Whatever is left of them comes home when
  he leaves (doc 022).
- **The guardian leaves `GUARDIAN_HEARTS` (2)**, flying to the player as it
  falls. It is the run's hardest room short of the throne, and the last
  stretch starts behind it.

Measured on `pnpm play rule 30`, the hearts do not change how many runs get
past room 10; the guardian's cost is in the fight itself. What they change is
how much the player has left for rooms 11 on.
