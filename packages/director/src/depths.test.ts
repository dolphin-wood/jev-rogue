/**
 * The three depths are three kinds of ground and light, not three skins: a
 * room's floor features come from its depth's ground, and the flooded and
 * burnt depths have their own light (`rooms/biome.ts`).
 */
import { describe, expect, it } from "vitest";
import {
  BIOME_GROUND, GROUND_FEATURES, ITEMS, MAX_HEARTS, biomeFor, bucketClearSpeed, bucketGold, bucketHealth,
  bucketMovementPressure, bucketRecentDamage, bucketRunProgress, emptyHistory, featuresForCap, featuresForZone,
  heldDominantTags, plainInstance, ROOM_EXTENT,
} from "@jr/core";
import type { RunContext } from "@jr/core";
import { createDirector } from "./director.ts";
import type { ObservedRequest } from "./director.ts";

function ctx(index: number, seed: string): RunContext {
  const staff = { slots: 6, mana_max: 120 };
  const slots = [plainInstance("magic_bolt"), null, null];
  return {
    run_id: seed, seed, room_index: index,
    labels: {
      health: bucketHealth(MAX_HEARTS), recent_damage: bucketRecentDamage(0),
      clear_speed: bucketClearSpeed(30_000, 30_000), movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(index), gold: bucketGold(0),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" }, preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
      build_shape: "forming",
    },
    staff, slots, inventory: [],
    history: { ...emptyHistory(), rooms: ["combat", "combat"], tensions: ["build", "build"] },
    intent: { preset: "dot" },
  };
}

describe("the depths' ground", () => {
  it("offers a slot only its depth's ground, and cover everywhere", () => {
    const edge: [number, number][] = [[2, 2], [3, 2], [2, 3]];
    for (const biome of ["ossuary", "flooded", "furnace"] as const) {
      const ids = featuresForZone("high", edge, ROOM_EXTENT.compact, biome).map((f) => f.id);
      for (const id of ids) if (GROUND_FEATURES.has(id)) expect(BIOME_GROUND[biome], `${biome}: ${id}`).toContain(id);
      expect(ids, biome).toContain("brazier");
    }
    // No depth, no narrowing: the library as it was.
    expect(featuresForZone("high", edge, ROOM_EXTENT.compact).length).toBe(featuresForCap("high").length);
  });

  it("puts only a room's own ground on its floor, across the run", async () => {
    for (const index of [2, 3, 7, 8, 11, 12]) {
      for (let s = 0; s < 6; s++) {
        const d = createDirector("rule");
        const r = await d.planRoom(ctx(index, `g${index}-${s}`), { room_index: index, door_slot: 0, room_type: "combat" }, "build");
        const biome = biomeFor(index);
        for (const z of r.plan.zones)
          if (GROUND_FEATURES.has(z.feature)) expect(BIOME_GROUND[biome], `room ${index}: ${z.feature}`).toContain(z.feature);
      }
    }
  });
});

describe("the depths' light", () => {
  it("is cold in the flooded catacombs and warm in the undercroft, and not asked there", async () => {
    for (const [index, want] of [[7, "cold"], [12, "warm"]] as const) {
      const seen: ObservedRequest[] = [];
      const d = createDirector("rule", { observe: (o) => seen.push(o) });
      const r = await d.planRoom(ctx(index, `l${index}`), { room_index: index, door_slot: 0, room_type: "combat" }, "build");
      expect(r.plan.params.mood.temperature).toBe(want);
      expect(seen.flatMap((o) => Object.keys(o.questions))).not.toContain("mood_temperature");
    }
    // The ossuary's is the Director's.
    const seen: ObservedRequest[] = [];
    const d = createDirector("rule", { observe: (o) => seen.push(o) });
    await d.planRoom(ctx(3, "l3"), { room_index: 3, door_slot: 0, room_type: "combat" }, "build");
    expect(seen.flatMap((o) => Object.keys(o.questions))).toContain("mood_temperature");
  });
});
