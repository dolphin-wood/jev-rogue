/**
 * The Drowned Warden (doc 024): what makes the guardian more than a warden,
 * each held to what the document promises.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step, worldCleared } from "./world.ts";
import { meleeSpec } from "./enemy.ts";
import { NO_INPUT } from "./types.ts";
import type { Enemy, World } from "./types.ts";
import { WORLD_H, WORLD_W } from "./collide.ts";
import { GUARDIAN_ARMOUR, GUARDIAN_HP, GUARDIAN_SCALE, GUARDIAN_SQUAD, GUARDIAN_XP, guardianPhaseAt, makeGuardian } from "./guardian.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import { ENEMIES } from "../encounters/enemies.ts";
import { RUN_GUARDIAN_ROOM, leadsToFixedFight, isFixedFightRoom } from "../run/doors.ts";

function guardianWorld(seed: string): World {
  const src = new RngSource(seed);
  const g = generateRoom(
    { space: "audience_arena", symmetry: "mirrored", size: "compact", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room"),
  );
  return createWorld({
    room: toRoomPlan(g, { id: "g", seed_key: seed, reward_kind: "item", params_source: "rule" }),
    encounter: null, props: 0, staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null, null, null, null], hearts: 6,
    rng: src.stream("world"), roomIndex: RUN_GUARDIAN_ROOM, guardian: true, invincible: true,
    viewHalf: { x: WORLD_W, y: WORLD_H },
  });
}
const guardianOf = (w: World): Enemy => w.enemies.find((e) => e.guardian)!;

describe("the Drowned Warden: the body", () => {
  it("is a warden, larger, armoured, on its own bar", () => {
    const g = makeGuardian(1, 100, 100, RUN_GUARDIAN_ROOM);
    expect(g.archetype).toBe("warden");
    expect(g.maxHp).toBe(GUARDIAN_HP);
    expect(g.armour).toBe(GUARDIAN_ARMOUR);
    expect(g.radius).toBe(Math.round(ENEMIES.warden.radius * GUARDIAN_SCALE));
    expect(g.phase).toBe(1);
  });

  it("rams from range and shoves on top of it", () => {
    const g = makeGuardian(1, 100, 100, RUN_GUARDIAN_ROOM);
    g.closeIn = false;
    expect(meleeSpec(g)?.kind).toBe("charge");
    g.closeIn = true;
    expect(meleeSpec(g)?.kind).toBe("bash");
  });

  it("changes phase at 60% and 30%", () => {
    expect(guardianPhaseAt(1)).toBe(1);
    expect(guardianPhaseAt(0.61)).toBe(1);
    expect(guardianPhaseAt(0.6)).toBe(2);
    expect(guardianPhaseAt(0.3)).toBe(3);
  });
});

describe("the Drowned Warden: the room", () => {
  it("stands across the room from the door, and the room is a fight until it falls", () => {
    const w = guardianWorld("stand");
    const g = guardianOf(w);
    expect(g).toBeTruthy();
    expect(Math.hypot(g.x - w.player.x, g.y - w.player.y)).toBeGreaterThan(200);
    step(w, NO_INPUT);
    expect(worldCleared(w)).toBe(false);
  });

  it("grows its armour back and calls a squad at phase II", () => {
    const w = guardianWorld("p2");
    const g = guardianOf(w);
    g.armour = 0;
    g.hp = Math.floor(GUARDIAN_HP * 0.6);
    step(w, NO_INPUT);
    expect(g.phase).toBe(2);
    expect(g.armour).toBe(GUARDIAN_ARMOUR);
    expect(w.enemies.filter((e) => e !== g)).toHaveLength(GUARDIAN_SQUAD.length);
  });

  it("takes its squad with it, and pays a room's experience", () => {
    const w = guardianWorld("death");
    const g = guardianOf(w);
    g.hp = Math.floor(GUARDIAN_HP * 0.5);
    step(w, NO_INPUT);
    const xp0 = w.xp;
    g.hp = 0;
    for (let i = 0; i < 30; i++) step(w, NO_INPUT);
    expect(w.enemies).toHaveLength(0);
    expect(w.xp - xp0).toBeGreaterThanOrEqual(GUARDIAN_XP);
  });
});

describe("the Drowned Warden: the doors", () => {
  it("is room 10, a fixed fight, whose doors in are narrowed as room 5's are", () => {
    expect(RUN_GUARDIAN_ROOM).toBe(10);
    expect(isFixedFightRoom(10)).toBe(true);
    expect(leadsToFixedFight(9)).toBe(true);
    expect(leadsToFixedFight(4)).toBe(true);
    expect(leadsToFixedFight(8)).toBe(false);
  });
});
