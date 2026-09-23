---
id: 004
title: Room Generation
status: proposed
date: 2026-09-21
summary: Rooms are procedurally generated from parameters the Director chooses as semantic labels: one of twelve space archetypes (a feasible shape / openness / cover triple), symmetry and mood. Code generates the layout, verifies it against the requested labels by measurement, retries, and falls back to authored rooms. A second request fills the archetype's declared zone slots and chooses the encounter profile against the generated room. Defines the RoomPlan schema.
depends_on: [002, 003]
---

# 004 Room Generation

## Principle

Jev never sees a tile and never places anything. It answers "what kind of space should this room be" as a handful of independent label choices. Code turns the labels into a layout, **measures the result and checks it matches the labels**, and only then shows it. Without the measurement step Jev's choices would be wishes rather than decisions.

Why not per-tile or per-chunk Jev decisions: Jev has no spatial reasoning and every question is independent, so adjacency coherence is impossible to obtain from it. json-render likewise never lets Jev choose pixel positions, only parents and orders.

## Geometry

- Tile grid **21 × 13**, 32 px tiles, wall ring around it. Single screen, no camera.
- Four door positions at the edge midpoints. **The entry door is fixed before generation and never changes afterwards**: the player enters from the south when the chosen archetype supports that side, otherwise from the first supported side clockwise from it (`resolveEntry`). Every spawn-distance and clearance check in the generator is measured against this entry, so nothing downstream may reselect it.
- Readability floors, enforced by the generator regardless of parameters: corridors at least 3 tiles wide (every floor cell belongs to some 3 × 3 block of free floor), no single-tile dead ends, a clear 5-tile radius around the entry door, and no hazard within 4 tiles of any door.
- **Every "N tiles" rule is Manhattan distance.** Under a Euclidean metric the region at least 6 tiles from all four edge-midpoint doors in a 19 × 11 interior is essentially one row, which would force all four spawn groups into a single line.
- **A declared zone slot or spawn group must be its own mirror, or paired with its mirror.** Under `mirrored` the generator has to keep the reflection of every reserved cell free too, so a declaration that is not mirror-closed costs double the floor: on `cross_tight`, whose arms are five and nine tiles across, one unpaired corner slot is the difference between a 4% and a 54% relax rate.

## Round 1: space parameters (Jev)

Requested when the player enters the room, before the room exists (003). State: `room_type`, `run_progress`, `tension` (from the door plan), `hazard_cap`, `health`, `movement_pressure_recent`, `build_range`, `last_shapes`.

Shape, openness and cover are **not** three independent questions: their product contains combinations the generator cannot satisfy (a tight corridor with dense cover leaves no 3-tile path). Code instead offers twelve **space archetypes**, each a feasible triple the harness has validated across seeds, and Jev picks one. This is the coupled-parameter convention of 002.

Hazard placement and spawn placement are coupled to the mask in ways no seed can fix: a `ring` archetype walls off its 7 × 5 centre, so a centre hazard zone or a centre turret group would land entirely inside wall. So **each archetype declares its own zone slots and spawn groups**, whose cells its mask guarantees are free floor, and the conflict class disappears by construction rather than being detected per seed. Placement is therefore not a Jev parameter at all: Jev decides what fills each declared slot (round 2) and which declared groups the encounter uses (005).

Corridor and ring archetypes support **east and west doors only**. A corridor's band is seven rows and a ring's necks are three, both centred on the middle column, so every lane or arc slot would sit inside the 4-tile hazard clearance of a north or south door. A corridor or ring is therefore entered from its end, which `resolveEntry` settles before generation.

| Archetype | shape / openness / cover | zone slots | spawn groups |
|---|---|---|---|
| open_arena | arena / open / none | centre, edge_n, edge_s | far, flank_l, flank_r, surround |
| scattered_arena | arena / mixed / sparse | centre, edge_n | far, flank_l, flank_r, surround |
| pillared_arena | arena / mixed / dense | edge_n, edge_s | far, flank_l, flank_r |
| tight_arena | arena / tight / dense | edge_n, edge_s | far, flank_l, flank_r |
| long_corridor | corridor / open / none | lane_n, lane_s | far, flank_l, flank_r |
| broken_corridor | corridor / mixed / sparse | lane_n, alcove_e | far, flank_l, flank_r |
| gallery | corridor / mixed / dense | alcove_e, alcove_w | far, flank_l, flank_r |
| choked_corridor | corridor / tight / sparse | alcove_e, alcove_w | far, flank_l |
| open_ring | ring / open / none | arc_n, arc_s | ring_outer, flank_l, flank_r |
| cover_ring | ring / mixed / dense | arc_n, arc_s | ring_outer, flank_l, flank_r |
| cross_open | cross / open / sparse | centre, corner_ne | far, flank_l, flank_r, surround |
| cross_tight | cross / tight / dense | corner_ne, corner_sw | far, flank_l, flank_r |

| Question | Options | Instruction gist | Temperature |
|---|---|---|---|
| space | the twelve archetypes + fallback | vary against last_spaces; corridors and rings suit long-range builds, open arenas suit short range | 0.8 |
| symmetry | mirrored / asymmetric / fallback | mirrored reads faster; asymmetric for variety at release | 0.9 |
| temperature, brightness, particle_intensity | see 008 | room mood; derived palette, not layout | 0.9 |

Code filters options before the request: `space` drops the archetypes used in the last two rooms. `hazard_cap` is applied in round 2, where hazards are decided per slot, so it removes nothing here. `space` and `symmetry` are jointly feasible for every pair by construction, and mood never touches layout. Any remaining relaxation is reported as the relax rate in 011; a parameter that relaxes above 10% is folded into the archetype table.

Each option's description is generated from templates (010) and states its effect in the same labels the summarizer uses.

## Generator (code)

Deterministic given `rng("decision", room_index, door_slot, 1)` and the parameters.

1. **Mask** from the archetype's `shape`, in one of that shape's **skeletons** (below): arena (full rectangle), corridor (central band 21 × 7 with alcoves), ring (central 7 × 5 block of wall), cross (four corner blocks), each with the skeleton's walls and openings applied. Masks are code, not authored files.
2. **Obstacles** by the archetype's `openness` and `cover`: place pillar blocks (1 × 1 to 2 × 2) and wall stubs until the obstacle ratio falls in the band for `openness` (open 0 to 8%, mixed 8 to 16%, tight 16 to 26%) and the pillar count in the band for `cover` (none 0, sparse 2 to 4, dense 5 to 8). With `mirrored`, generate the left half and mirror it. Pillar count and obstacle ratio are coupled, not independent dials: eight 2 × 2 pillars are only about 15% of an arena, so wall stubs make up the difference at the tight end. If the finished layout contains nothing the player can run all the way around, one free-standing wall block is placed at the most open cell that has room for it: the **kiting obstacle** (015). It is `Tile.Wall`, not `Tile.Pillar`, so it spends obstacle ratio and leaves the cover label alone, which is what lets an archetype with a pillar band of 0 have one.
3. **Zone slots** from the archetype: 2 or 3 named slots at cells the mask guarantees are free floor, sized 5 × 3 (centre), 3 × 3 (edge, corner, alcove), 1 × 5 (lane) or a 5-cell arc (ring). Obstacle placement in step 2 treats slot cells as reserved. Slots are filled in round 2 and may end up `none`.
4. **Spawn groups** from the archetype: 3 or 4 named groups at cells the mask guarantees are free floor and at least 6 tiles from every supported entry. The encounter's `entry` parameter (005) selects among the groups this room actually has.
5. **Validate**: flood fill from the entry; every supported door reachable; reachable floor at least 70% of the mask floor; every spawn cell reachable; readability floors above hold.
6. **Measure and compare**: recompute obstacle ratio, pillar count and symmetry error against the archetype's bands, and confirm every declared zone slot and spawn cell is still free floor and reachable after step 2. `RoomMeasurements.open_ratio` is free floor divided by mask floor, matching its name and the round-2 `open_ratio_label`; the obstacle ratio the bands are stated in is one minus that.
7. On validation or measurement failure: new seed from the same stream, up to 5 attempts; then relax one parameter toward its neighbor label (dense → sparse, tight → mixed) and retry twice; then use the **authored fallback room** for the archetype's shape (below) and record `source.layout: "authored"` on the room plan (002).

## Round 2: hazards and encounter (Jev)

Issued as soon as the generated room exists. State adds the generated room's summary: `zones: ["A: center 5x3", "B: none"]`, `spawn_groups: ["far", "flank_left", "flank_right"]`, `open_ratio_label`, `cover_label`, plus the round-1 state.

| Question | Options | Notes |
|---|---|---|
| one question per declared zone slot | features whose `slot_kind` matches + `none` + `fallback` | per-slot question, so no overcapacity and no collision; when `hazard_cap` is `none` only non-hazard features and `none` are offered |
| composition, density, wave_structure, anchor, entry | encounter profile parameters, each with `fallback` | 005; `entry` names a spawn-group pattern, not the player's door, and is limited to what the generated spawn groups support |

The player's entry door is not a question here. It was fixed before generation and every clearance check depends on it.

Post-filter: two zones that picked features sharing a `resource` keep the higher-probability one, the other becomes `none`.

## Feature library (hazards and fixtures)

Six features fill zones. Examples:

```json
{
  "id": "spike_strip",
  "description": "Spike strip: damages on contact and restricts movement. Over-punishes a player already under movement pressure.",
  "tags": ["hazard", "movement_pressure"],
  "slot_kind": "zone",
  "hazard_budget": 2,
  "hazard_effect": "contact",
  "resource": "floor_hazard"
}
```

Others: `poison_pool` (slow tick, resource floor_hazard; it poisons ground enemies standing in it too), `ice_patch` (slip, no damage, resource floor_hazard), `crumble_floor` (collapses 3 s after it is stood on, so crossing it is free), `brazier` (a solid pillar that blocks bodies and bullets both ways and breaks when shot), `turret_mount` (turrets in the encounter spawn on its cells; the plinth itself does not hurt). Each feature names a `hazard_effect` — `contact`, `slow_tick`, `slip`, `collapse` or `none` — and that is what the simulation applies: `hazard_budget` is a cost against the room's cap, not a statement that something hurts. The sum of `hazard_budget` must stay under the `hazard_cap` band; code trims the lowest-probability zone to `none` if exceeded.

Solids are one list: a feature's `fixture` field names the prop it stands (`brazier` is the only one), and the simulation writes it into the grid like a crate, so movement, bullets, sight and the flow field agree about it. A feature with a fixture is never offered for a zone slot in the middle third of the arena — cover belongs at the edge of a fight, not in it — and a compact slot stands one fixture at its centre, a long one a pair at its ends.

## Boss arena

The boss arena is generated by the same generator from three arena-shaped archetypes that differ only in cover: `boss_open`, `boss_scattered`, `boss_pillared`. All three carry `open` openness, so `boss_pillared`'s five to eight pillars are 1 × 1 to stay inside the open band. Each declares one spawn group (`surround`, for boss adds) and no zone slots.

The boss room is the one room no Director request shapes: it builds `boss_open` with `mirrored` symmetry and a fixed mood, and its fight is the boss's three phases (005) rather than an assembled encounter. Generation is otherwise identical, plus two validations: a clear 7 × 5 centre for the boss, and every cover element at least 3 tiles from that centre. Fallback is the authored `fallback_arena`.

## Authored fallback rooms

Three hand-made rooms (`fallback_arena`, `fallback_corridor`, `fallback_cross`) are the only authored layouts. They pass every validator for every supported entry, but they are **not** required to land in their archetype's measurement bands: `fallback_arena` reuses `open_arena`'s declarations and carries four pillars, which is outside the `none` cover band. Band compliance is a property of generation, not of authored content. They carry fixed spawn groups and zones, so round 2 still runs against them when time allows; otherwise `RuleDirector` fills them (002).

## RoomPlan

```ts
interface RoomPlan {
  id: string;                       // run_id/room_index/door_slot
  room_type: RoomType;
  params: { space: SpaceArchetype; symmetry; mood: { temperature; brightness; particle_intensity } };
  measured: { open_ratio: number; pillar_count: number; symmetry_error: number };
  grid: Uint8Array;                 // 21*13 tile codes
  skeleton: string;                 // the outline it was built in (Skeletons, above)
  doors: DoorSide[];
  entry: DoorSide;
  zones: { id: string; cells: Cell[]; feature: FeatureId | "none" }[];
  spawn_groups: { id: string; cells: Cell[] }[];
  encounter: EncounterPlan | null;  // 005; null until round 2 or fallback
  reward_kind: RewardKind;          // 007
  source: {
    params: "jev" | "rule" | "random";      // which Director arm answered (002)
    layout: "generated" | "authored";
    encounter: "jev" | "rule" | "random" | "none";
  };
  seed_key: string;
}
```

## Skeletons

A shape is one outline, and four outlines on one grid read as four rooms repeated, however the obstacles fall inside them: the player sees the silhouette before anything in it. So each shape has several **skeletons** (`rooms/skeletons.ts`), each the shape's mask with rectangles walled off or opened up:

| Shape | Skeletons |
|---|---|
| arena | plain; octagon (stepped corners); waist (both sides pushed in); horseshoe (the top bitten in); notched (one top corner gone, asymmetric); bastions (square corner blocks) |
| corridor | plain; bays (a third alcove each side); sealed (alcoves walled up); pinched (the band narrowed mid-way); funnel (the far end narrowed, asymmetric) |
| ring | plain; twin (the core split by a lane, a figure of eight); bars (the core hollowed to two bars); wide (a larger core) |
| cross | plain; stubby (short side arms); plaza (the junction's corners opened); crown (the upper corners only); tee (the top arm walled off) |

The skeleton is **not a Jev parameter**. It changes nothing the archetype promises: a skeleton is used for an archetype only if every one of its declared zone and spawn cells stays floor, the entry is still a door, no new wall falls inside the entry's clear radius, and — for `mirrored` — the outline is its own reflection. A wall across a door's approach closes that door for the room. Two skeletons exclude an archetype they measurably cannot hold (`arena_octagon` for `tight_arena`, `ring_wide` for `cover_ring`, `cross_stubby` and `cross_tee` for `cross_tight`: the obstacle band did not fit and the builds relaxed). The boss arenas stay plain. Code draws the skeleton from the legal ones on the room's stream, leaving out the run's last two (`RunHistory.skeletons`), and the room plan records it (`RoomPlan.skeleton`).

## Content and variety

Twelve archetypes in nineteen skeletons, × 2 symmetry, before the seed; each room's two or three declared slots pick from six features and `none`, the encounter's spawn-group choice adds more, and mood multiplies the look by 8. `pnpm variety` measures how alike the rooms of one archetype come out over seeds — the obstacle cells two rooms share (Jaccard), the share of tiles that match, the distinct layouts and outlines. Over sixteen seeds per archetype and symmetry, the mean obstacle overlap is 0.34 and the mean tile match 0.87, with no archetype built in fewer than three outlines.

## Implementation notes

- **The `tight` openness band is 16 to 26 percent**, because the 3-tile width floor caps how densely a narrow mask can be packed once its reserved zone cells, their mirrors and the 5-tile entry clearance are carved out. Measured over the full sweep with all four entry sides, an 18% floor relaxes 43 of `cross_tight`'s 80 mirrored seeds and a 16% floor relaxes 3, against the 10% relax rate this doc allows a parameter. The three bands are contiguous and disjoint, so a measurement pins openness to exactly one label; the top of `tight` is 26% only to keep the band 10 points wide, and nothing observed comes near it.
- **Cover bands.** All fifteen archetypes hit none 0, sparse 2 to 4, dense 5 to 8.
- **Measured relax rate**: 0.00% over the mandated sweep of 12 archetypes × 2 symmetries × 20 seeds, and 0.28% over a wider sweep that also varies the entry across all four sides, all of it `cross_tight`, with no authored fallbacks and no validation failures in either.
