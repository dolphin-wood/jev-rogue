/**
 * **Easing off runs at most two rooms** (`densitiesOffered`): after two sparse
 * fights running the next is not offered sparse, on either arm.
 */
import { describe, expect, it } from "vitest";
import {
  ITEMS, MAX_HEARTS, bucketClearSpeed, bucketGold, bucketHealth, bucketMovementPressure,
  bucketRecentDamage, bucketRunProgress, emptyHistory, plainInstance, heldDominantTags, UNMEASURED,
} from "@jr/core";
import type { EncounterProfile, RoomType, RunContext, Tension } from "@jr/core";
import { createDirector } from "./director.ts";

function ctx(over: {
  hearts?: number; damage?: number; clearMs?: number; index?: number; seed?: string;
  history?: { tensions: Tension[]; rooms: RoomType[] };
  /** What the last fights measured as damage a second (`run/observed.ts`). */
  power?: "low" | "fair" | "high";
} = {}): RunContext {
  const index = over.index ?? 5;
  const staff = { slots: 6, mana_max: 120 };
  const slots = [plainInstance("magic_bolt"), plainInstance("spark_spray"), null];
  const seed = over.seed ?? "tension";
  return {
    run_id: seed, seed, room_index: index,
    labels: {
      health: bucketHealth(over.hearts ?? MAX_HEARTS),
      recent_damage: bucketRecentDamage(over.damage ?? 0),
      clear_speed: bucketClearSpeed(over.clearMs ?? 30_000, 30_000),
      movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(index),
      gold: bucketGold(40),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: { range: "mid" },
      preference: { dominant: heldDominantTags(slots, ITEMS), consistency: "on_plan" },
      observed: { ...UNMEASURED, damage_rate: over.power ?? "fair" },
    },
    staff, slots, inventory: [],
    history: { ...emptyHistory(), ...(over.history ?? {}) },
    intent: { preset: "spam" },
  };
}


async function densities(lastTwo: readonly ("sparse" | "normal")[], n = 60): Promise<string[]> {
  const director = createDirector("rule");
  const out: string[] = [];
  const prev = lastTwo.map((density) => ({ density, anchor: "none" }) as unknown as EncounterProfile);
  for (let i = 0; i < n; i++) {
    // Hurt and recently hit hard: the state that asked for sparse room after room.
    const base = ctx({ seed: `sparse-${lastTwo.join("-")}-${i}`, hearts: 2, damage: 4, index: 9 });
    const c: RunContext = { ...base, room_index: 9, history: { ...base.history, profiles: prev } };
    const plan = await director.planRoom(c, { room_index: 9, door_slot: 0, room_type: "combat" }, "release");
    if (plan.profile) out.push(plan.profile.density);
  }
  return out;
}

describe("easing off runs at most two rooms", () => {
  it("offers no third sparse room in a row", async () => {
    const after = await densities(["sparse", "sparse"]);
    expect(after.length).toBeGreaterThan(50);
    expect(after).not.toContain("sparse");
  });

  it("still allows a second sparse room in a row", async () => {
    expect(await densities(["normal", "sparse"])).toContain("sparse");
  });

  it("still chooses sparse for a hurt player after rooms that were not", async () => {
    expect(await densities(["normal", "normal"])).toContain("sparse");
  });
});
