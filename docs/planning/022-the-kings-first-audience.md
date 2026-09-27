---
id: 022
title: The King's First Audience
status: proposed
date: 2026-09-27
summary: The Crypt King is met twice. In room 5, the last fight of the ossuary, he drops out of the roof into an ordinary fight, and his landing kills every body in the room, which spill enough hearts to fill the player's bar and three more that stay on the floor. That first audience is phase I alone. At 60% of its bar the armour breaks and he goes back up out of the room, and the room pays its door's reward a grade higher. The final fight in the throne hall starts where the first one stopped, with the armour already gone. Phases II and III are stretched over a full bar that is larger than the one they had before. It takes the place of the guardian that seam would have held, not a room of its own, so the run is no longer and the count of fights is unchanged. Placed at room 5 rather than 10 because real players die before room 8: the meeting comes to every run, and its peak buys room 6 as the trough at the ramp's steepest step. Code decides all of it. The one Jev question the room keeps is its door's reward.
depends_on: [003, 005, 014, 019, 020]
---

# 022 The King's First Audience

## Why

**Every death in a measured run happens in his hall** (`encounters/ramp.ts`,
the boss band). The fountain at the vendors' stop means a player reaches him on
nearly a full bar, whatever the fourteen fights cost them, and then meets
seventeen moves, three phases and a 168 BPM rhythm for the first time, in
the one room where losing ends the run. The fight is readable (doc 020 made
every move a body and a beat), but only on a second look, and the first look
is the run.

The run also has no midpoint. Its three depths (`rooms/biome.ts`) are three
floors and three sets of walls, and nothing happens at the seams between them.
The genre marks those seams: a biome ends on a fight that is not like the rooms
before it.

Both problems have one answer. **Meet the king at the seam, and let the player
survive the meeting.**

## The shape of the run

```
fights 1–4  →  room 5: the first audience  →  fights 6–14  →  vendors  →  the king
```

Room 5 is still one of the fourteen fights (`RUN_COMBAT_ROOMS` is unchanged).
It is entered through an ordinary door that promised an ordinary reward, and it
starts as an ordinary fight. **It replaces the guardian this seam would
otherwise have held**, so the king's first appearance costs no extra time. Doc
014's twenty minutes still hold: a fight of about 20 s plus an audience of
40 to 50 s is where a guardian fight was going to be.

The seam at room 10, between the flooded depth and the furnace, keeps its
guardian. That is a separate document.

### Why room 5 and not room 10

**Real players often die before room 8.** The fitted `player` profile the
harness measures wins 55% and dies only in the hall, so the harness has been
measuring a stronger player than the ones actually playing. An audience at
room 10 would be met by a minority of runs. At room 5 nearly every run meets
him, and that is the only way the meeting can teach the fight.

Room 5 is also a seam, the last room of the ossuary (`BIOME_FROM`), so the
reason for putting him at a depth's end still holds.

**And room 5 sits in front of the ramp's steepest step.** Between the 3–5 band
and the 6–9 band (`encounters/ramp.ts`) everything moves at once. Hit damage
goes ×0.8 → ×1, body health ×1.5 → ×1.75, body damage ×1 → ×1.25, and a room
goes from two waves to three. The measured hearts lost per room jump there too
(0.71 at room 5, 1.19 at room 6, doc 014). With the audience recorded as a peak,
**room 6 becomes the trough** (below). So the steepest step is taken on a
low-tension room, right after the landing's hearts. Placing the king here
softens the cliff where players die, where placing him at room 10 would have
done nothing for it.

**What it costs.** The player meets him with one or two spells and a level or
two, so the audience's bar is small (below). Eleven rooms stand between the
first meeting and the last, and phase I is the phase built to be learned in
one sitting (doc 020, "one thing at a time").

## The drop-in

The player does not know the king is coming. The door into room 5 carried a
reward badge like any other, and the room fills like any other.

1. **The fight starts** with the room's first wave only. Code builds room 5's
   encounter itself, the way it builds the boss room's. It is one round of the
   `build` band with no subspecies share and no elites, and the room's later
   waves are never queued. These bodies are there to be crushed.
2. **The roof gives** once the player has killed **one** body, or 5 s after the
   room opens, whichever comes first. Nothing the player does before this can
   cost them anything, since step 3 heals it all back. So the opening stretch
   is pure setup: it exists to make room 5 look like room 4, so that the roof
   giving is a surprise and not a cutscene the door announced. One kill is
   enough to set that up. Two can take a room-5 build most of the 5 s. His mark
   goes down the way the meteor's landing mark does (`BOSS_METEOR_LAND_TELL_MS`,
   three beats), in view, **at least `BOSS_METEOR_LAND_PX` plus two tiles from
   the player**.
3. **The landing** is the meteor's landing, reused: the hitstop, the shake,
   the dust, the band (`bossShock`). **It kills every other body in the room**,
   in view or not. This is his entrance, and the fight after it is his alone.
   - **The entrance band does not hurt the player.** It is a spectacle, not a
     test. The first band that costs anything is the one his first slam
     throws in phase I.
   - Bodies he kills pay **no experience**, the same rule as a summoned body
     (`xpForKill`). The player did not kill them.
4. **The hearts.** Out of the bodies comes **enough health to fill the
   player's bar, plus `CRASH_HEARTS_SPARE = 3` more**. The count is set by what
   the player is missing, not by how many bodies there were: `missing + 3`
   hearts, shared among the corpses (a room with fewer bodies than hearts
   throws several from each).
   - The ones that fill the bar **fly to the player** (the cleared room's pull,
     `VACUUM_SPEED`) while his name is up. So the player starts phase I on a
     full bar, and never has to walk round the room while the king stands.
   - **The spare three stay on the floor as the fight's reserve.** They do not
     expire while he is in the room (`PICKUP_LIFETIME_MS` is suspended for
     them), and they **can't be picked up on a full bar**. At the moment a
     heart touched on a full bar is spent for nothing, and the spare three
     would be lost to the first step the player took. So stepping onto a spare
     heart is a choice the player makes when hurt, and where the hearts lie is
     part of the arena.
   - `CRASH_HEARTS_SPARE` is a starting figure. It is about three of phase I's
     blows at the room-5 band, and `boss-bench` and the playtest logs set it.
5. **His name** comes up as it does in the hall (`showKingName`), and after a
   beat the fight is phase I as doc 020 wrote it. Nothing else is in the room.

## The first audience

**Phase I, exactly as authored**, with the same shapes, strings and rests.
Nothing in phase I changes, because the whole point is that phase I is learned
here and is not asked again.

| | First audience (room 5) | Final (room 16) |
|---|---|---|
| Phases | I | II, III |
| Bar | `KING_AUDIENCE_HP`, spent down to the retreat | `KING_FINAL_HP`, all of it |
| Phase thresholds | none. At `KING_RETREAT_AT` he leaves | II from full, III at `KING_FINAL_III_AT` |
| Power | the room-5 ramp band's (body damage ×1, hit damage ×0.8) | the boss band's (×2.05), unchanged |
| Adds | none. The landing killed them | doc 005's phase II call, unchanged |
| Pays | the door's reward, one grade higher | the run |
| Losing | the run ends, as dying anywhere does | the run ends |

**Why the room's power, not the boss band's.** The ×2.05 was fitted to a
player at room 16, on a nearly full bar and after the vendors (`ramp.ts`, "the
boss band's power"). At room 5 that player has eleven fewer offers, one or two
spells and no vendors, so the room's own band is the fair price. The blows do not lose their
telegraphs, only their cost. Doc 019's rule is unchanged: no telegraph is ever
shortened.

**Losing ends the run.** A meeting he can't kill you in is a cutscene. The
audience has to be able to end a run, or it teaches nothing. The price is kept
fair in three other ways: the hearts from the landing, the room's lower power,
and a bar that stops at 60%.

### The retreat

At `KING_RETREAT_AT` (0.6 of the audience bar, the same threshold at which
phase II begins today) the phase change starts as it always has
(`stepBossPhase`). He stops dead, the armour breaks off him and the debris flies
(`boss_debris_*`), and he roars. **Then, where phase II would call its adds, he
goes up**, as the leap and the meteor go up (`BOSS_LEAP_UP_MS`), and does not
come down. His mark never shows.

- He is untouchable from the roar onward (`bossRoarMs`), so the retreat can't
  be burst through for a kill.
- The room clears when he is gone, and the reward rises. Any spare hearts
  still lying there are vacuumed to the player with the coins.
- The results trace records the audience: time taken, hearts lost, whether he
  was driven off (always, unless the player died).

### What it pays

The door's own reward, **one grade higher** (grade 1 → 2, 2 → 3, capped at
3). An offer is how this game pays for things, so the reward for driving off
the king comes as an offer. It is not a new currency. It rides on the reward
the player chose at the door, so the choice they made still matters.

## The final fight

**He comes back without what the player broke.** The throne entrance plays as
it does now (`kingIntro`, the goblet, the rise), and he stands **already in
phase II**. His body is drawn from the phase II frames (`boss_p2_*`, which the
renderer already picks by `e.phase`), so his missing armour is the player's own
doing, seen at a glance. The roar and the phase II call do not play at the
start, because he broke that armour in room 5. The phase II call belongs to
the phase *change*, and there is no change here.

**Phases II and III are stretched over a full bar, and the bar grows.** Today
II and III together are 60% of 3750, or 2250 health. The final bar is
`KING_FINAL_HP = 4500`, twice that. Phase III begins at
`KING_FINAL_III_AT = 0.5`, so each phase gets half. Doc 020 sized the fight to
about two minutes and two and a half passes of its music. Phase I has moved to
room 5, so the final fight needs more health to hold that length with the
denser phases alone. It also has to answer a player who has already seen the
king once. 4500 is a starting figure: `boss-bench` sets it, against a fight
length of 100 to 130 s and a win rate near today's 55% for the fitted `player`.

The meteor into phase III, the rage tempo and the music's layers are
unchanged, because they already hang on `e.phase`.

## What code decides, and what Jev does

All of it is code's. It is the run's shape, like the vendors' stop and the
boss, and doc 002 does not ask a question with one answer.

- **The doors out of room 4** are ordinary reward doors, ranked by
  `portal_need` as always, but **no elite, no vendor, no fountain**: room 5
  has to be a fight, and a fair one. A vendor or fountain door taken there
  would move the audience into a room that has no fight. This is a
  `portalChoices` constraint, and Jev only sees the options that remain.
- **Room 5's space** is one of the boss archetypes (`boss_open`,
  `boss_scattered`) in the room's own depth, the ossuary, and no Jev question is
  asked. The king needs his arena, and the fight's geometry is his.
- **Room 5's encounter questions** (round 2) are not asked. The bodies are
  fodder with a fixed job.
- **Room 6 is the trough.** Room 5 is recorded in the run history with
  tension `peak`, so `pacingLabels` caps room 6's `next_tension` the way it
  caps the beat after any peak (doc 014). No new rule is needed, only the right
  fact.
- **Jev's briefing** gains the fact, neutrally stated: "Met the Crypt King in
  room 5 and drove him off; lost 22 of 70 health in the meeting." The boss
  room's briefing says the same. The rule arm reads a label `king_met`.

## Implementation

| Where | What |
|---|---|
| `encounters/enemies.ts` | `KING_AUDIENCE_HP`, `KING_RETREAT_AT`, `KING_FINAL_HP`, `KING_FINAL_III_AT`. A **boss script** (`"audience" \| "final"`) the boss body carries, read by `bossPhaseAt` for its thresholds |
| `sim/enemy.ts` | `stepBossPhase`: under `audience`, the threshold at `KING_RETREAT_AT` roars and then retreats instead of entering phase II. Under `final`, the body is made at phase 2 with no roar |
| `sim/world.ts` | the drop-in: trigger (one kill or 5 s), mark placement, landing, the room-wide crush, `missing + CRASH_HEARTS_SPARE` hearts (the missing ones pulled to the player, the spare ones held on the floor, not expiring and not taken on a full bar), no experience, `worldCleared` waiting on the king, not the queue |
| `run/doors.ts` | `RUN_AUDIENCE_ROOM = 5`. `stageFor` returns `"audience"`. `portalChoices` out of room 4 forbids elite, vendor and fountain |
| `run/offer.ts` | room 5's offer at door grade + 1 |
| `rooms/` | room 5 planned from a boss archetype in the room's biome, no round-2 questions |
| `run/summarize.ts`, director briefing | `king_met` and the neutral sentence |
| `game/scenes/play.ts` | the mark, the fall, the name card on the drop-in. The retreat's rise off the top of the view. The throne entrance ending on a phase II body |
| `harness` | `boss-bench --script audience\|final`. A full-run balance pass for hearts lost at room 5, at room 6 and at the boss, and the win rate |

### Tests

- The first landing never touches the player, from any position at the moment
  of the trigger.
- Crushed bodies pay no experience. Every other body in the room is dead after
  the landing.
- After the landing and the pull, the player is on a full bar, and exactly
  `CRASH_HEARTS_SPARE` hearts lie on the floor. A full bar does not take them,
  and they outlive `PICKUP_LIFETIME_MS`.
- The entrance band never hurts the player.
- The audience can't take the king below `KING_RETREAT_AT` of its bar. Every
  hit after the roar reads `boss_immune`.
- The room clears when he leaves.
- The doors out of room 4 never offer elite, vendor or fountain.
- The final king starts at phase 2 and enters phase 3 at `KING_FINAL_III_AT`.
  No phase II call fires at spawn.
- `elite-fairness`'s rule holds for the audience too: no telegraph is shorter
  than its constant.

## Measured before it ships

| Figure | Target |
|---|---|
| audience length (drop to retreat) | 40 to 50 s |
| audience bar (`KING_AUDIENCE_HP`) | set so the drop to the retreat takes 40 to 50 s at room-5 damage; a guess of a third of today's 3750 until `boss-bench` sets it |
| hearts lost at room 5 | at most room 6's today (1.19) |
| hearts lost at room 6 | falls, now that it is a trough |
| runs reaching room 8 | rises. This is measured on playtest logs, not the fitted profile, which already reaches it |
| final fight length | 100 to 130 s |
| run win rate, fitted `player` | about 55%, today's |
| deaths at the boss that are the player's first sight of a move | fall. That is the point of the document |
