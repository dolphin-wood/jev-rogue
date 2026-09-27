import { describe, expect, it } from "vitest";
import { DOOR_SIDES, GRID_H, GRID_W, ROOM_EXTENT, ROOM_SIZES, Tile } from "../types.ts";
import type { DoorSide, Mood, RoomParams, RoomSize, SpaceArchetypeId, Symmetry } from "../types.ts";
import { RngSource } from "../rng.ts";
import { BOSS_ARCHETYPES, PLAYABLE_ARCHETYPES, archetype } from "./archetypes.ts";
import { entryCell, idx } from "./masks.ts";
import { bandsFor, inMetricBand, measureRoom, measurementProblems } from "./measure.ts";
import { validateRoom } from "./validate.ts";
import { generateRoom, relaxArchetype, renderGrid, resolveEntry, toRoomPlan } from "./generate.ts";
import type { GeneratedRoom } from "./generate.ts";

const MOOD: Mood = { temperature: "cold", brightness: "dim", particle_intensity: "calm" };
const SYMMETRIES: readonly Symmetry[] = ["mirrored", "asymmetric"];
const SEEDS = 20;

function params(space: SpaceArchetypeId, symmetry: Symmetry, size: RoomSize): RoomParams {
  return { space, symmetry, size, mood: MOOD };
}

/** Every size in turn across the seeds, so each sweep covers all three. */
const sizeFor = (seed: number): RoomSize => ROOM_SIZES[seed % ROOM_SIZES.length]!;

function build(space: SpaceArchetypeId, symmetry: Symmetry, entry: DoorSide, seed: number): GeneratedRoom {
  const rng = new RngSource("room-sweep").stream("decision", space, symmetry, entry, seed);
  return generateRoom(params(space, symmetry, sizeFor(seed)), entry, "combat", rng);
}

function checkRoom(room: GeneratedRoom, label: string): void {
  const a = room.effective;
  const mask = room.mask;
  const ext = room.extent;
  const v = validateRoom({
    grid: room.grid, mask, archetype: a, entry: room.entry,
    zones: a.zoneSlots, spawnGroups: a.spawnGroups, ext,
  });
  expect({ label, problems: v.problems }).toEqual({ label, problems: [] });
  const m = measureRoom(room.grid, mask, entryCell(room.entry, ext), ext);
  expect({ label, problems: measurementProblems(m, a, room.params.symmetry, ext) })
    .toEqual({ label, problems: [] });
  // The room is its extent; the grid past it is wall.
  expect(ext).toEqual(ROOM_EXTENT[room.params.size]);
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++)
      if (x >= ext.w || y >= ext.h) expect(room.grid[idx(x, y)], `${label} ${x},${y}`).toBe(Tile.Wall);
}

describe("generateRoom", () => {
  /**
   * The exhaustive sweep. Twelve archetypes x two symmetry settings x twenty
   * seeds, rotating the entry across all four sides, every room validated and
   * measured against its archetype's bands. The relax rate is the share of
   * rooms that needed a parameter relaxed or the authored fallback; doc 004
   * folds a parameter into the archetype table above 10%.
   */
  it("produces a valid, in-band room for every archetype x symmetry x seed", () => {
    let total = 0;
    let relaxed = 0;
    let authored = 0;
    const worst: string[] = [];

    for (const a of PLAYABLE_ARCHETYPES) {
      for (const symmetry of SYMMETRIES) {
        let localRelax = 0;
        for (let seed = 0; seed < SEEDS; seed++) {
          const entry = DOOR_SIDES[seed % DOOR_SIDES.length]!;
          const room = build(a.id, symmetry, entry, seed);
          total++;
          if (room.relaxed) { relaxed++; localRelax++; }
          if (room.layout === "authored") authored++;
          checkRoom(room, `${a.id}/${symmetry}/${entry}/${seed}`);

          // the entry stays what the caller fixed, when the archetype has it
          expect(room.entry).toBe(resolveEntry(a, entry));
          expect(a.doors).toContain(room.entry);
          expect(room.grid.length).toBe(GRID_W * GRID_H);
        }
        if (localRelax > 0) worst.push(`${a.id}/${symmetry}=${localRelax}/${SEEDS}`);
      }
    }

    expect(total).toBe(PLAYABLE_ARCHETYPES.length * SYMMETRIES.length * SEEDS);
    const rate = relaxed / total;
    expect({ rate: rate < 0.1, relaxed, total, authored, worst })
      .toEqual({ rate: true, relaxed, total, authored, worst });
    expect(rate).toBeLessThan(0.1);
  });

  it("keeps every declared zone slot and spawn cell free floor and reachable", () => {
    for (const a of PLAYABLE_ARCHETYPES) {
      for (const symmetry of SYMMETRIES) {
        for (let seed = 0; seed < SEEDS; seed++) {
          const entry = DOOR_SIDES[seed % DOOR_SIDES.length]!;
          const room = build(a.id, symmetry, entry, seed);
          const declared = [
            ...room.zones.map((z) => [z.id, z.cells] as const),
            ...room.spawn_groups.map((g) => [g.id, g.cells] as const),
          ];
          expect(declared.length).toBeGreaterThan(0);
          for (const [id, cells] of declared) {
            for (const [x, y] of cells) {
              const tile = room.grid[idx(x, y)];
              if (tile !== Tile.Floor) {
                throw new Error(
                  `${a.id}/${symmetry}/${entry}/${seed}: ${id} cell ${x},${y} is tile ${tile}\n` +
                  renderGrid(room.grid, room.extent),
                );
              }
            }
          }
        }
      }
    }
  });

  it("is deterministic: the same seed gives an identical grid", () => {
    for (const a of PLAYABLE_ARCHETYPES) {
      for (const symmetry of SYMMETRIES) {
        const first = build(a.id, symmetry, "N", 7);
        const again = build(a.id, symmetry, "N", 7);
        expect(Array.from(again.grid)).toEqual(Array.from(first.grid));
        expect(again.entry).toBe(first.entry);
        expect(again.measured).toEqual(first.measured);
        const different = build(a.id, symmetry, "N", 8);
        expect(different.grid.length).toBe(first.grid.length);
      }
    }
  });

  it("varies the layout across seeds", () => {
    for (const a of PLAYABLE_ARCHETYPES) {
      if (a.cover === "none" && a.openness === "open") continue; // near-empty by design
      const seen = new Set<string>();
      for (let seed = 0; seed < SEEDS; seed++) {
        const room = build(a.id, "asymmetric", "N", seed * ROOM_SIZES.length);
        seen.add(renderGrid(room.grid, room.extent));
      }
      expect({ id: a.id, distinct: seen.size > 1 }).toEqual({ id: a.id, distinct: true });
    }
  });

  it("mirrors exactly when asked", () => {
    for (const a of PLAYABLE_ARCHETYPES) {
      for (let seed = 0; seed < 5; seed++) {
        const room = build(a.id, "mirrored", "E", seed);
        expect({ id: a.id, seed, err: room.measured.symmetry_error }).toEqual({ id: a.id, seed, err: 0 });
      }
    }
  });

  it("builds the boss arenas with a clear centre and cover kept off it", () => {
    for (const a of BOSS_ARCHETYPES) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const entry = DOOR_SIDES[seed % DOOR_SIDES.length]!;
        const rng = new RngSource("boss").stream("decision", a.id, entry, seed);
        const room = generateRoom(params(a.id, "mirrored", sizeFor(seed)), entry, "boss", rng);
        checkRoom(room, `${a.id}/${entry}/${seed}`);
        // The first audience's edges carry its braziers and ground (doc 022); the throne arenas carry nothing.
        if (a.id === "audience_arena") {
          expect(room.zones.map((z) => z.id)).toEqual(["edge_n", "edge_s"]);
          expect(room.measured.pillar_count).toBe(0);
          continue;
        }
        expect(room.zones).toEqual([]);
        expect(room.spawn_groups.map((g) => g.id)).toEqual(["surround"]);
        expect(inMetricBand(room.measured.pillar_count, bandsFor(a, room.extent).pillars)).toBe(true);
      }
    }
  });
});

describe("retry and relax policy", () => {
  it("relaxes cover before openness, one label at a time", () => {
    expect(relaxArchetype(archetype("tight_arena"))).toMatchObject({ openness: "tight", cover: "sparse" });
    expect(relaxArchetype(archetype("choked_corridor"))).toMatchObject({ openness: "mixed", cover: "sparse" });
    expect(relaxArchetype(archetype("cross_open"))).toMatchObject({ openness: "open", cover: "none" });
    expect(relaxArchetype(archetype("scattered_arena"))).toMatchObject({ openness: "mixed", cover: "none" });
    expect(relaxArchetype(archetype("open_arena"))).toBeNull();
    expect(relaxArchetype(archetype("long_corridor"))).toBeNull();
  });

  it("reports how it got there", () => {
    const room = build("open_arena", "mirrored", "N", 3);
    expect(room.layout).toBe("generated");
    expect(room.relaxed).toBe(false);
    expect(room.authored_id).toBeNull();
    expect(room.attempts).toBeGreaterThanOrEqual(1);
  });
});

describe("entry selection", () => {
  it("keeps a supported side and otherwise takes the next one clockwise", () => {
    const corridor = archetype("long_corridor"); // E and W only
    expect(resolveEntry(corridor, "E")).toBe("E");
    expect(resolveEntry(corridor, "W")).toBe("W");
    expect(resolveEntry(corridor, "N")).toBe("E");
    expect(resolveEntry(corridor, "S")).toBe("W");
    const arena = archetype("open_arena");
    for (const side of DOOR_SIDES) expect(resolveEntry(arena, side)).toBe(side);
  });

  it("never selects the entry again after generation", () => {
    for (const side of DOOR_SIDES) {
      const room = build("open_ring", "asymmetric", side, 2);
      expect(room.entry).toBe(resolveEntry(archetype("open_ring"), side));
    }
  });
});

describe("toRoomPlan", () => {
  it("carries the generated space into the doc 004 RoomPlan shape", () => {
    const room = build("scattered_arena", "mirrored", "S", 1);
    const plan = toRoomPlan(room, {
      id: "run/3/1", seed_key: "run|3|1", reward_kind: "item", params_source: "jev",
    });
    expect(plan.id).toBe("run/3/1");
    expect(plan.grid).toBe(room.grid);
    expect(plan.entry).toBe(room.entry);
    expect(plan.encounter).toBeNull();
    expect(plan.source).toEqual({ params: "jev", layout: "generated", encounter: "none" });
    expect(plan.measured.open_ratio + room.measured.obstacle_ratio).toBeCloseTo(1, 10);
    expect(plan.zones.every((z) => z.feature === "none")).toBe(true);
    expect(plan.spawn_groups.length).toBeGreaterThan(0);
  });
});
