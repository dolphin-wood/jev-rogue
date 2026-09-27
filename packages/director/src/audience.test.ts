/**
 * Room 5, the king's first audience (doc 022): the room is the run's shape and
 * code's, so none of the room's own questions are asked; the offer its door
 * promised still is.
 */
import { describe, expect, it } from "vitest";
import {
  AUDIENCE_FLOOR_FEATURES, ITEMS, MAX_HEARTS, ROOM_EXTENT, bucketClearSpeed, bucketGold, bucketHealth,
  bucketMovementPressure, bucketRecentDamage, bucketRunProgress, cardPool, emptyHistory, heldDominantTags,
  plainInstance, RUN_AUDIENCE_ROOM, GRID_W, Tile, audienceRoomFor, AUDIENCE_ROOMS,
} from "@jr/core";
import type { RunContext } from "@jr/core";
import { createDirector } from "./director.ts";
import type { ObservedRequest } from "./director.ts";

function ctx(seed: string): RunContext {
  const staff = { slots: 6, mana_max: 120 };
  const slots = [plainInstance("magic_bolt"), null, null];
  return {
    run_id: seed, seed, room_index: audienceRoomFor(seed),
    labels: {
      health: bucketHealth(MAX_HEARTS), recent_damage: bucketRecentDamage(0),
      clear_speed: bucketClearSpeed(30_000, 30_000), movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(audienceRoomFor(seed)), gold: bucketGold(0),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" }, preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
      build_shape: "forming",
    },
    staff, slots, inventory: [], history: emptyHistory(), intent: { preset: "dot" },
  };
}

describe("the king's first audience: the room plan", () => {
  it("builds the open arena at compact size in the hall's light, a peak, with one wave and no elites", async () => {
    for (let s = 0; s < 12; s++) {
      const d = createDirector("rule");
      const c = ctx(`aud${s}`);
      const r = await d.planRoom(c, { room_index: c.room_index, door_slot: 0, room_type: "combat" }, "build");
      expect(r.plan.params.space).toBe("audience_arena");
      expect(r.plan.params.size).toBe("compact");
      expect(r.plan.extent).toEqual(ROOM_EXTENT.compact);
      expect(r.plan.params.mood).toEqual({ temperature: "cold", brightness: "dim", particle_intensity: "calm" });
      expect(r.tension).toBe("peak");
      expect(r.plan.encounter?.waves.length).toBe(1);
      expect(r.elite_affixes).toEqual([]);
      expect(r.plan.measured.pillar_count).toBe(0);
      // Bare floor: nothing solid and permanent inside the walls (doc 022, "The arena").
      for (let y = 1; y < r.plan.extent.h - 1; y++)
        for (let x = 1; x < r.plan.extent.w - 1; x++) expect(r.plan.grid[y * GRID_W + x], `${x},${y}`).toBe(Tile.Floor);
      // One edge stands braziers; the other braziers or at most one floor feature — never a turret.
      const features = r.plan.zones.map((z) => z.feature);
      expect(features).toContain("brazier");
      expect(features).not.toContain("turret_mount");
      for (const f of features) expect(["brazier", ...AUDIENCE_FLOOR_FEATURES]).toContain(f);
      expect(features.filter((f) => f !== "brazier").length).toBeLessThanOrEqual(1);
    }
  });

  it("asks nothing about the room, and still asks the offer its door promised", async () => {
    const seen: ObservedRequest[] = [];
    const d = createDirector("rule", { observe: (o) => seen.push(o) });
    const c = ctx("aud-ask");
    const pool = cardPool(ITEMS, [], "stat", [{ shape: "bolt", count: 1, affixes: [] }], {}, { hurt: true });
    const r = await d.planRoom(c, { room_index: c.room_index, door_slot: 0, room_type: "combat" }, "build", {
      cards: [{ room_index: c.room_index, pool, count: 3, pity: false, temptation: false }],
    });
    const asked = seen.flatMap((o) => Object.keys(o.questions));
    for (const q of ["space", "size", "symmetry", "next_tension", "composition", "density"]) expect(asked).not.toContain(q);
    expect(r.offer?.cards[0]?.ids.length).toBe(3);
  });
});

describe("room 10's guardian: the room plan (doc 024)", () => {
  it("is planned as room 5 is, and its squad holds no plain warden", async () => {
    for (let s = 0; s < 12; s++) {
      const c = { ...ctx(`guard${s}`), room_index: 10 };
      const r = await createDirector("rule").planRoom(c, { room_index: 10, door_slot: 0, room_type: "combat" }, "build");
      expect(r.plan.params.space).toBe("audience_arena");
      expect(r.tension).toBe("peak");
      for (const wave of r.plan.encounter?.waves ?? []) for (const sp of wave.spawns) expect(sp.archetype).not.toBe("warden");
    }
  });
});

describe("the king's first audience: where it falls (doc 022)", () => {
  it("falls in room 4, 5 or 6, fixed for a run and spread across runs", () => {
    const seen = new Set<number>();
    for (let s = 0; s < 60; s++) {
      const room = audienceRoomFor(`run-${s}`);
      expect(AUDIENCE_ROOMS).toContain(room);
      expect(audienceRoomFor(`run-${s}`)).toBe(room);
      seen.add(room);
    }
    expect([...seen].sort()).toEqual([4, 5, 6]);
    expect(audienceRoomFor(undefined)).toBe(RUN_AUDIENCE_ROOM);
  });

  it("plans only the drawn room as the audience: the rooms either side are ordinary", async () => {
    const c = ctx("aud-either");
    for (const i of AUDIENCE_ROOMS) {
      const r = await createDirector("rule").planRoom({ ...c, room_index: i }, { room_index: i, door_slot: 0, room_type: "combat" }, "build");
      expect(r.plan.params.space === "audience_arena", `room ${i}`).toBe(i === c.room_index);
    }
  });
});

