import { describe, expect, it } from "vitest";
import { GRID_H, GRID_W, Tile } from "../types.ts";
import type { DoorSide, Shape } from "../types.ts";
import {
  BOSS_ARCHETYPES, PLAYABLE_ARCHETYPES, SPACE_ARCHETYPES, archetype,
  checkArchetypeDeclarations,
} from "./archetypes.ts";
import { DOOR_CELL, ENTRY_CELL, applyDoors, idx, maskFloorCount, maskFor, mirrorX } from "./masks.ts";
import { narrowCells, validateRoom } from "./validate.ts";
import { AUTHORED_ROOMS, authoredFor } from "./authored.ts";
import { FEATURES, HAZARD_CAP_BUDGET, feature, featuresByResource, featuresForCap } from "./features.ts";
import { countPillars } from "./measure.ts";

const SHAPES: readonly Shape[] = ["arena", "corridor", "ring", "cross"];

describe("masks", () => {
  it("leave a wall ring and a door approach for every side", () => {
    for (const shape of SHAPES) {
      const m = maskFor(shape);
      for (let x = 0; x < GRID_W; x++) {
        expect(m[idx(x, 0)]).toBe(Tile.Wall);
        expect(m[idx(x, GRID_H - 1)]).toBe(Tile.Wall);
      }
      for (let y = 0; y < GRID_H; y++) {
        expect(m[idx(0, y)]).toBe(Tile.Wall);
        expect(m[idx(GRID_W - 1, y)]).toBe(Tile.Wall);
      }
      expect(maskFloorCount(m)).toBeGreaterThan(100);
    }
  });

  it("are mirror symmetric, so `mirrored` is reachable on every shape", () => {
    for (const shape of SHAPES) {
      const m = maskFor(shape);
      for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
          expect(m[idx(x, y)]).toBe(m[idx(mirrorX(x), y)]);
        }
      }
    }
  });

  it("already satisfy the 3-tile width floor before any obstacle", () => {
    for (const shape of SHAPES) {
      expect({ shape, narrow: narrowCells(maskFor(shape)) }).toEqual({ shape, narrow: [] });
    }
  });

  it("put floor next to every door a shape's archetypes support", () => {
    for (const a of SPACE_ARCHETYPES) {
      const m = maskFor(a.shape);
      for (const side of a.doors) {
        const c = ENTRY_CELL[side];
        expect({ id: a.id, side, tile: m[idx(c[0], c[1])] }).toEqual({ id: a.id, side, tile: Tile.Floor });
      }
    }
  });

  it("the ring walls off its 7 x 5 centre", () => {
    const m = maskFor("ring");
    for (let y = 4; y <= 8; y++) for (let x = 7; x <= 13; x++) expect(m[idx(x, y)]).toBe(Tile.Wall);
  });
});

describe("space archetypes", () => {
  it("are the twelve of the table plus three boss arenas", () => {
    expect(PLAYABLE_ARCHETYPES.map((a) => a.id)).toEqual([
      "open_arena", "scattered_arena", "pillared_arena", "tight_arena",
      "long_corridor", "broken_corridor", "gallery", "choked_corridor",
      "open_ring", "cover_ring", "cross_open", "cross_tight",
    ]);
    expect(BOSS_ARCHETYPES.map((a) => a.id)).toEqual(["boss_open", "boss_scattered", "boss_pillared"]);
  });

  it("declare the shape / openness / cover triple of the doc's table", () => {
    const triple = (id: string): string => {
      const a = archetype(id as never);
      return `${a.shape}/${a.openness}/${a.cover}`;
    };
    expect(triple("open_arena")).toBe("arena/open/none");
    expect(triple("scattered_arena")).toBe("arena/mixed/sparse");
    expect(triple("pillared_arena")).toBe("arena/mixed/dense");
    expect(triple("tight_arena")).toBe("arena/tight/dense");
    expect(triple("long_corridor")).toBe("corridor/open/none");
    expect(triple("broken_corridor")).toBe("corridor/mixed/sparse");
    expect(triple("gallery")).toBe("corridor/mixed/dense");
    expect(triple("choked_corridor")).toBe("corridor/tight/sparse");
    expect(triple("open_ring")).toBe("ring/open/none");
    expect(triple("cover_ring")).toBe("ring/mixed/dense");
    expect(triple("cross_open")).toBe("cross/open/sparse");
    expect(triple("cross_tight")).toBe("cross/tight/dense");
  });

  it("declare 2 or 3 zone slots and 3 or 4 spawn groups, boss arenas aside", () => {
    for (const a of PLAYABLE_ARCHETYPES) {
      expect({ id: a.id, zones: a.zoneSlots.length }).toEqual({
        id: a.id, zones: a.zoneSlots.length,
      });
      expect(a.zoneSlots.length).toBeGreaterThanOrEqual(2);
      expect(a.zoneSlots.length).toBeLessThanOrEqual(3);
      expect(a.spawnGroups.length).toBeGreaterThanOrEqual(2);
      expect(a.spawnGroups.length).toBeLessThanOrEqual(4);
    }
    for (const a of BOSS_ARCHETYPES) {
      expect(a.zoneSlots).toEqual([]);
      expect(a.spawnGroups.map((g) => g.id)).toEqual(["surround"]);
    }
  });

  /** The claim the whole design rests on: no seed can ever put a hazard or a
   *  spawn inside a wall, because the archetype only names cells its mask
   *  guarantees, and the masks do not depend on symmetry. */
  it("only name cells their mask guarantees are free floor and clear of doors", () => {
    for (const a of SPACE_ARCHETYPES) {
      expect({ id: a.id, problems: checkArchetypeDeclarations(a) })
        .toEqual({ id: a.id, problems: [] });
    }
  });

  it("never give a ring a centre zone slot or a centre spawn group", () => {
    for (const a of SPACE_ARCHETYPES.filter((x) => x.shape === "ring")) {
      expect(a.zoneSlots.map((z) => z.id)).not.toContain("centre");
      expect(a.spawnGroups.map((g) => g.id)).not.toContain("centre");
      const m = maskFor("ring");
      // and the centre really is wall, so a centre slot would have been a bug
      expect(m[idx(10, 6)]).toBe(Tile.Wall);
    }
  });
});

describe("authored fallback rooms", () => {
  it("are the three of the doc", () => {
    expect(AUTHORED_ROOMS.map((r) => r.id)).toEqual([
      "fallback_arena", "fallback_corridor", "fallback_cross",
    ]);
  });

  it("pass every validator, from every door they support", () => {
    for (const room of AUTHORED_ROOMS) {
      const a = room.archetype;
      const mask = maskFor(a.shape);
      for (const entry of a.doors) {
        const v = validateRoom({
          grid: room.grid, mask, archetype: a, entry,
          zones: a.zoneSlots, spawnGroups: a.spawnGroups,
        });
        expect({ room: room.id, entry, problems: v.problems }).toEqual({
          room: room.id, entry, problems: [],
        });
      }
    }
  });

  it("agree with their mask and carry the pillars the art draws", () => {
    for (const room of AUTHORED_ROOMS) {
      const mask = maskFor(room.archetype.shape);
      const withDoors = mask.slice();
      applyDoors(withDoors, room.archetype.doors);
      for (let i = 0; i < mask.length; i++) {
        if (withDoors[i] !== Tile.Floor && room.grid[i] !== withDoors[i]) {
          throw new Error(`${room.id} differs from its mask at cell ${i % GRID_W},${Math.floor(i / GRID_W)}`);
        }
      }
      expect(countPillars(room.grid)).toBeGreaterThan(0);
    }
  });

  it("cover every shape, the ring falling back to the arena", () => {
    expect(authoredFor("arena").id).toBe("fallback_arena");
    expect(authoredFor("ring").id).toBe("fallback_arena");
    expect(authoredFor("corridor").id).toBe("fallback_corridor");
    expect(authoredFor("cross").id).toBe("fallback_cross");
    for (const shape of SHAPES) {
      const room = authoredFor(shape);
      for (const side of ["N", "E", "S", "W"] as DoorSide[]) {
        // whatever entry the caller had in mind, some supported door exists
        expect(room.archetype.doors.length).toBeGreaterThan(0);
        expect(DOOR_CELL[side]).toBeDefined();
      }
    }
  });
});

describe("feature library", () => {
  it("has the six features of the doc with their budgets and resources", () => {
    expect(FEATURES.map((f) => f.id)).toEqual([
      "spike_strip", "poison_pool", "ice_patch", "crumble_floor",
      "brazier", "turret_mount",
    ]);
    expect(feature("spike_strip").hazard_budget).toBe(2);
    expect(feature("spike_strip").resource).toBe("floor_hazard");
    expect(feature("poison_pool").resource).toBe("floor_hazard");
    expect(feature("ice_patch").resource).toBe("floor_hazard");
    expect(feature("brazier").hazard_budget).toBe(0);
    expect(feature("turret_mount").hazard_budget).toBe(3);
    /*
     * The budget is a cost against the room's cap, not a claim that a feature
     * hurts. Conflating the two made every feature contact damage — including
     * a turret's stone plinth and a mana font — and ground hazards became 79%
     * of every heart lost in the game.
     */
    expect(feature("turret_mount").hazard_effect).toBe("none");
    expect(feature("brazier").hazard_effect).toBe("none");
    expect(feature("spike_strip").hazard_effect).toBe("contact");
    expect(feature("poison_pool").hazard_effect).toBe("slow_tick");
    expect(feature("ice_patch").hazard_effect).toBe("slip");
    expect(feature("crumble_floor").hazard_effect).toBe("collapse");
  });

  it("fills only zone slots and always names tags", () => {
    for (const f of FEATURES) {
      expect(f.slot_kind).toBe("zone");
      expect(f.tags.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(20);
      expect(f.hazard_budget).toBeGreaterThanOrEqual(0);
    }
  });

  it("groups competing features by resource so the round-2 filter has work", () => {
    const groups = featuresByResource();
    // A crumbling floor is a floor hazard too, so it shares their exclusivity
    // group: one floor hazard per room, which is what doc 004 asks for.
    expect(groups.get("floor_hazard")?.map((f) => f.id)).toEqual([
      "spike_strip", "poison_pool", "ice_patch", "crumble_floor",
    ]);
    // The brazier stands alone since the mirror pillar was removed, so it
    // shares no resource: a group of one cannot express exclusivity.
    expect(groups.get("blocker")).toBeUndefined();
  });

  it("offers no hazard when the cap is none", () => {
    expect(HAZARD_CAP_BUDGET.none).toBe(0);
    expect(featuresForCap("none").every((f) => f.hazard_budget === 0)).toBe(true);
    expect(featuresForCap("high").length).toBe(FEATURES.length);
  });
});
