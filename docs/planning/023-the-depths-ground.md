---
id: 023
title: The Depths' Ground
status: proposed
date: 2026-09-27
summary: The run's three depths were three skins over one room. Each is now a kind of ground and a kind of light. A room's floor features come only from its depth's ground — the ossuary's trap spikes and dead weeds, the flooded catacombs' poison pools and ice, the undercroft's spikes and tinder, with lava once its tiles are drawn — and the Director chooses among those as it always has. The flooded depth is cold and the undercroft warm, so the music's cold and warm versions and the colour filter both name the depth. That mood question is not asked there; the ossuary's is. Each depth also has a sound under everything, water dripping or embers ticking. Enemy rosters are not changed yet, because the mix ratios are what the pressure model is calibrated against.
depends_on: [002, 004, 018, 022]
---

# 023 The Depths' Ground

## Why

`rooms/biome.ts` made the run three places, and only the renderer read it: the
floors, walls and decals changed at rooms 6 and 11, and nothing else did. A
flooded catacomb stood spikes and dry grass, the burnt undercroft stood ice,
and the room's light was whatever the Director picked. So the three depths were
three skins over one room.

## What changed

**Ground.** The floor features a depth may offer are narrowed to what it is
made of (`BIOME_GROUND`). Code narrows what is legal and the Director judges
what fits (doc 002), so every zone question is still asked, over the smaller
list. Cover (`brazier`) and the turret's plinth are the dungeon's everywhere.

| Depth | Rooms | Ground |
|---|---|---|
| ossuary | 1–5 | `spike_strip`, `grass_patch` |
| flooded | 6–10 | `poison_pool`, `ice_patch` |
| furnace | 11–15 | `spike_strip`, `grass_patch`, `lava_channel` once its tiles are drawn |

**Light.** The flooded depth is cold and the undercroft warm
(`BIOME_TEMPERATURE`). A question with one answer is not asked, so
`mood_temperature` is left out of those rooms' round 1. The ossuary's is still
the Director's. Temperature already picks the music's cold or warm version
(doc 018), so the depth is heard as well as seen.

**Sound.** The flooded depth drips and the undercroft's embers tick, at
`DEPTH_AMBIENCE` (0.3) everywhere in them, under whatever the room's own grates
and braziers add (`ambienceLevels`).

## Not yet

**Rosters.** A furnace full of cinderlings and emberlings is the obvious next
step. The mix ratios (`MIX_RATIOS`) are what the pressure model's bands were
measured against, though, so a depth's lean has to be priced there first and
not added on top.

## Measured (2026-09-27)

`pnpm play rule 60 player`: runs reaching the boss went from 54 to 49 of 60.
Concentrating the flooded depth's ground on poison and ice costs a little more
through the middle of the run. The figure is kept in view, not corrected: the
ground is the point, and the hazard budget (`hazard_cap`) still bounds it.
