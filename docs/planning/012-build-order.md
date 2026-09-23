---
id: 012
title: Build Order
status: proposed
date: 2026-09-21
summary: The order the finished game is built in, as steps rather than editions. The Jev pipeline comes first so the Director hypothesis is exercised end to end before most content exists; combat, rooms, encounters, the run shape, the boss and the content tools follow; pacing and evaluation are the steps still open. Each step names its deliverables and how it is checked, and the built steps are marked.
depends_on: [001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 013, 014, 015]
---

# 012 Build Order

Principle: **the thinnest path that exercises Jev end to end comes first.**
Content grows around it. Every step moves toward the same finished game;
nothing here is a version, and no step is a lesser edition of a later one.

## 1. Foundations — done

- pnpm workspace; `core` stepping the simulation at a fixed 60 Hz; Phaser
  rendering and reading input only; Vite dev proxy; `.env.local`.
- The stateless proxy (009) as a Cloudflare Worker: it holds the key, answers
  CORS, caps the body at 64 KB and rate-limits per minute.

## 2. The Director pipeline — done

- One pipeline with three distribution sources — `jev`, `rule`
  (`packages/director/src/weights.ts`), `random`. The same questions, option
  filters and samplers run on every arm, so a comparison compares the one part
  that differs.
- The TypeSafe evaluator through the proxy; a failed request falls back to the
  rule table for that request, and after three failures in a row the rest of
  the run is served by the rule table.
- A trace per request; the `observe` hook; the debug sidebar and the room plan
  page's three tabs (room, Director inputs, Director questions), both showing
  every question's options and probabilities.

## 3. Combat core — done

- Movement and facing, dash, the sword basic attack, the spin attack charged
  by rage, mana, and three spells on three keys.
- Spell levels and affixes, affix tiers and shape fits, event affixes.
- Statuses: burn and poison gauges that fill then run as a clock, ice building
  to a freeze and a shatter on the frozen. Enemies carry the same gauges.
- Integer damage everywhere, the HUD overlay and the action bar, and doc 008's
  feel checklist.

## 4. Rooms — done

- The generator: space archetypes, symmetry, measurement against the requested
  labels, retries, authored fallbacks.
- Zone features (spike strip, poison pool, ice patch, crumbling floor, brazier,
  turret mount) and room mood derived into a palette under contrast rules.
- `planRoom`'s two rounds: archetype, symmetry and mood, then zone features and
  the encounter profile.

## 5. Encounters — done

- The archetypes: rusher, shooter, turret, sentinel, orbiter, tank, summoner
  and the lancer, plus the boss.
- Roster assembly under the tension's pressure band, measurement, retries and
  the tiered presets behind them.
- Elite affix sets drawn by code from the legal sets, elite rooms where part of
  the roster is elite, and the stray elite in a normal room.

## 6. Run shape and the reward line — done

- Fourteen fights, the merchant-and-blacksmith room, the boss room
  (`stageFor`, `RUN_COMBAT_ROOMS`).
- Portals: code enumerates the legal answers (`portalChoices`), the Director
  answers (`planPortals`), code assembles (`assemblePortals`). Reward kind ×
  difficulty, plus a spell door's school, a stat door's family and a grade;
  elite rules; the rare vendor room.
- The offer: three cards of the door's kind from `cardPool`, `planCards`'s
  three distributions blended by run progress, the wildcard, pity and
  temptation; gold rooms paying coins instead.
- The merchant and the blacksmith, gold, and dismantling a spell back into it.
- The intent screen before the run, the game-over card, and the settings.

## 7. Boss — done

Three phases by health with re-armed armour, the slam ring with a safe centre,
the leap from phase 2, adds that die with the phase, one threat at a time, and
the health bar at the bottom. The boss room offers no reward and no portals.

## 8. Content and tooling — done

`content:check`, the balance harness over encounters and seeds, the headless
reference player, `spell-check`, the calibration and room-measurement CLIs, and
the art and audio pipeline with its asset checks.

## 9. Pacing schedule

The run's length is set in doc 014 and the rooms are built; what is left is the
schedule that shapes them.

- Feed the computed tension cap (`pacingLabels`) into the door question instead
  of a constant, so a peak is followed by a low-threat beat as a property of
  the schedule rather than of which portal the player took.
- Bring the combat room from the reference player's median 12 s up to the 30 to
  40 s the pacing unit is built on, through structure and density before roster
  health.

Check: no two peak rooms in a row, and a human tester's median combat room
inside the 30 to 40 second band.

## 10. Jev in the browser

The browser constructs the rule arm today. Point it at the Jev arm through the
proxy, with the arm selectable for the comparison.

Check: fallback rate under 5% and Director fidelity above 80% over ten internal
runs, with traces readable.

## 11. Evaluation

- Blind-test mode, input and event recording, full replay with hash assertions,
  a remote trace sink, and a Pages deploy from CI alongside the Worker.
- The twelve-tester three-way protocol (`jev`, `rule`, `random`) and the tuning
  loop on real traces.

This is what decides which arm the game ships on. If `jev` and `rule` are
indistinguishable on the reward line, the game runs the rule table and the
project's question becomes where, if anywhere, Jev is better; the build order
does not assume the hypothesis holds.

Check: the success criteria of 001, evaluated and written up.
