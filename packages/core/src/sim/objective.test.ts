/** A room objective in play (doc 025): what ends the fight, and what does not. */
import { describe, expect, it } from "vitest";
import { createWorld, step, worldCleared } from "./world.ts";
import { NO_INPUT } from "./types.ts";
import type { World } from "./types.ts";
import { WORLD_H, WORLD_W } from "./collide.ts";
import { DESTROY_TARGETS, HOLD_MS, holdLeftS, targetsLeft } from "./objective.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import type { EncounterPlan } from "../types.ts";

const encounter: EncounterPlan = {
  profile: { composition: "mixed", density: "sparse", wave_structure: "steady", anchor: "none", entry: "far_front" },
  waves: [{ at_ms: 0, spawns: [{ archetype: "rusher", spawn_group: "far", count: 2 }] }],
  measured_pressure: 2, band: [1, 3], elite_affixes: [], source: "rule",
};

function objectiveWorld(kind: "hold" | "destroy", seed: string): World {
  const src = new RngSource(seed);
  const g = generateRoom(
    { space: "open_arena", symmetry: "mirrored", size: "compact", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room"), { plain: true },
  );
  const room = { ...toRoomPlan(g, { id: "o", seed_key: seed, reward_kind: "item", params_source: "rule" }), objective: kind };
  return createWorld({
    room, encounter, props: 0, staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null, null, null, null], hearts: 6,
    rng: src.stream("world"), roomIndex: 7, invincible: true, viewHalf: { x: WORLD_W, y: WORLD_H },
  });
}

const run = (w: World, ms: number) => { for (let i = 0; i < Math.ceil(ms / (1000 / 60)); i++) step(w, NO_INPUT); };

describe("a hold", () => {
  it("is not clear while its clock runs, however empty, and keeps sending bodies", () => {
    const w = objectiveWorld("hold", "h1");
    run(w, 300);
    for (const e of w.enemies) e.hp = 0;
    run(w, 200);
    expect(worldCleared(w)).toBe(false);
    run(w, 4000);
    expect(w.enemies.length + w.pendingWaves.length).toBeGreaterThan(0);
    expect(holdLeftS(w)).toBeGreaterThan(0);
  });

  it("clears when the clock is up, and whatever stands falls", () => {
    const w = objectiveWorld("hold", "h2");
    // Hitstops hold the clock as they hold everything else, so give it room.
    run(w, HOLD_MS + 6000);
    expect(w.objective!.done).toBe(true);
    run(w, 1500);
    expect(w.enemies).toHaveLength(0);
    expect(w.cleared).toBe(true);
  });
});

describe("a destroy room", () => {
  it("stands its turrets, marked, and is not clear while one stands", () => {
    const w = objectiveWorld("destroy", "d1");
    expect(targetsLeft(w)).toBe(DESTROY_TARGETS);
    for (const e of w.enemies) if (!e.objectiveTarget) e.hp = 0;
    run(w, 500);
    expect(worldCleared(w)).toBe(false);
  });

  it("clears when the last turret falls, and whatever stands falls with it", () => {
    const w = objectiveWorld("destroy", "d2");
    run(w, 1500);
    for (const e of w.enemies) if (e.objectiveTarget) e.hp = 0;
    run(w, 1500);
    expect(w.objective!.done).toBe(true);
    expect(w.enemies).toHaveLength(0);
    expect(w.cleared).toBe(true);
  });
});
