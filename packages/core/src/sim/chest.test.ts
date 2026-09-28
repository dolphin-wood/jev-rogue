/** A special room's chest (doc 026): where it stands, and what touching it pays. */
import { describe, expect, it } from "vitest";
import { answerOffer, chestInReach, createWorld, openChest, step } from "./world.ts";
import { NO_INPUT } from "./types.ts";
import type { World } from "./types.ts";
import { WORLD_H, WORLD_W } from "./collide.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import { CHEST_GOLD, hasChest } from "../run/chest.ts";
import { RUN_GUARDIAN_ROOM, audienceRoomFor } from "../run/doors.ts";
import { objectiveFor } from "../run/objectives.ts";

const DOORS = [{ reward: "spell", elite: false, type: "combat" }, { reward: "gold", elite: false, type: "combat" }] as const;

function chestWorld(seed: string, chest: boolean, gold = false): World {
  const src = new RngSource(seed);
  const g = generateRoom(
    { space: "open_arena", symmetry: "mirrored", size: "compact", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", "combat", src.stream("room"), { plain: true },
  );
  return createWorld({
    room: toRoomPlan(g, { id: "c", seed_key: seed, reward_kind: "item", params_source: "rule" }),
    encounter: null, props: 0, staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null, null, null, null], hearts: 6,
    rng: src.stream("world"), roomIndex: 7, chest, viewHalf: { x: WORLD_W, y: WORLD_H },
    offer: gold
      ? { cards: [], doors: DOORS }
      : { cards: [{ kind: "stat", label: "Fleet", itemId: "fleet", stats: "", description: "" }], doors: DOORS },
  });
}

describe("the way out", () => {
  it("does not open in a card room until the reward is taken", () => {
    for (const chest of [false, true]) {
      const w = chestWorld(`gate-${chest}`, chest);
      for (let i = 0; i < 5 && !w.cleared; i++) step(w, NO_INPUT);
      expect(w.cleared).toBe(true);
      expect(w.rewardPending).toBe(true);
      expect(w.portals.filter((p) => p.open)).toHaveLength(0);
      answerOffer(w);
      expect(w.portals.filter((p) => p.open)).toHaveLength(DOORS.length);
    }
  });

  it("opens in a gold room as it clears, chest or none", () => {
    for (const chest of [false, true]) {
      const w = chestWorld(`gold-${chest}`, chest, true);
      for (let i = 0; i < 5 && !w.cleared; i++) step(w, NO_INPUT);
      expect(w.cleared).toBe(true);
      expect(w.rewardDrop).toBeNull();
      expect(w.portals.filter((p) => p.open)).toHaveLength(DOORS.length);
    }
  });
});

describe("the chest", () => {
  it("stands beside the reward once the room clears, and pays its gold when opened, not on a touch", () => {
    const w = chestWorld("c1", true);
    for (let i = 0; i < 5 && !w.cleared; i++) step(w, NO_INPUT);
    expect(w.cleared).toBe(true);
    const c = w.chest!;
    expect(c).toBeTruthy();
    expect(c.open).toBe(false);
    if (w.rewardDrop) {
      const d = Math.hypot(c.x - w.rewardDrop.x, c.y - w.rewardDrop.y);
      expect(d).toBeGreaterThan(20);
      expect(d).toBeLessThan(80);
    }
    const gold0 = w.gold;
    w.player.x = c.x; w.player.y = c.y;
    for (let i = 0; i < 30; i++) step(w, NO_INPUT);
    expect(c.open).toBe(false);
    expect(chestInReach(w)).toBe(true);
    openChest(w);
    const opened = w.events.some((ev) => ev.what === "chest_opened");
    for (let i = 0; i < 60 * 3; i++) step(w, NO_INPUT);
    expect(opened).toBe(true);
    expect(c.open).toBe(true);
    expect(w.gold - gold0).toBe(CHEST_GOLD);
  });

  it("is not there in an ordinary room", () => {
    const w = chestWorld("c2", false);
    for (let i = 0; i < 5; i++) step(w, NO_INPUT);
    expect(w.chest).toBeUndefined();
  });

  it("comes from the fixed fights and the objective rooms only", () => {
    const seed = "chest-seed";
    expect(hasChest(seed, RUN_GUARDIAN_ROOM, "combat")).toBe(true);
    expect(hasChest(seed, audienceRoomFor(seed), "combat")).toBe(true);
    for (let i = 1; i <= 14; i++) {
      const special = i === RUN_GUARDIAN_ROOM || i === audienceRoomFor(seed) || objectiveFor(seed, i, "combat") !== null;
      expect(hasChest(seed, i, "combat"), `room ${i}`).toBe(special);
    }
    expect(hasChest(seed, 7, "shop")).toBe(false);
  });
});
