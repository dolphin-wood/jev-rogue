/**
 * **A charge's shield** (`Player.chargeShield`, doc 006): standing to charge
 * is standing in the open, so the charge raises a shield that takes the first
 * of what comes, and goes with the charge.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step } from "./world.ts";
import { NO_INPUT } from "./types.ts";
import type { Input, World } from "./types.ts";
import { castRift } from "./attacks.ts";
import { CHARGE_SHIELD_HEARTS } from "./spells.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import { GRID_W, GRID_H, Tile } from "../types.ts";

const src = new RngSource("charge-shield");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("room"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid, zones: [] };
const PX = 300, PY = 300;

function world(): World {
  const w = createWorld({
    room, encounter: null, props: 0, staff: { slots: 6, mana_max: 200 },
    slots: [plainInstance("arcane_cannon"), null, null, null, null, null], hearts: 6, rng: src.stream("w"),
  });
  w.player.x = PX; w.player.y = PY; w.player.facing = 0;
  return w;
}

const aim: Input = { ...NO_INPUT, aimX: PX + 200, aimY: PY };
const hold: Input = { ...aim, spell: 0 };

/** A stone on the player, landing in a few frames, for `hearts`. */
function stone(w: World, hearts: number): void {
  castRift(w, w.player.x, w.player.y, 0, 0, { width: 40, teleMs: 30, damage: hearts, rock: true });
}

function run(w: World, frames: number, input: Input = hold): void {
  for (let i = 0; i < frames; i++) { w.player.mana = w.staff.mana_max; step(w, input); }
}

describe("a charge's shield", () => {
  it("goes up as the charge starts and takes a small hit whole: no heart, and the charge still held", () => {
    const w = world();
    run(w, 3);
    expect(w.player.chargeKey).toBe(0);
    expect(w.player.chargeShield).toBe(CHARGE_SHIELD_HEARTS);
    const hearts = w.player.hearts;
    stone(w, 0.5);
    run(w, 30);
    expect(w.player.hearts).toBe(hearts);
    expect(w.player.chargeKey).toBe(0);
    expect(w.player.chargeShield).toBeCloseTo(CHARGE_SHIELD_HEARTS - 0.5, 5);
  });

  it("breaks on a hit bigger than it, which lands with what is left over", () => {
    const w = world();
    run(w, 3);
    const hearts = w.player.hearts;
    stone(w, CHARGE_SHIELD_HEARTS + 0.5);
    let broke = false;
    for (let i = 0; i < 30; i++) {
      run(w, 1);
      if (w.events.some((e) => e.kind === "spell" && e.what === "charge_shield_break")) broke = true;
    }
    expect(broke).toBe(true);
    expect(w.player.chargeShield).toBe(0);
    expect(hearts - w.player.hearts).toBeCloseTo(0.5, 5);
  });

  it("goes with the charge, and only a charge released and paid for raises the next one", () => {
    const w = world();
    run(w, 3);
    // Dashed out: gone, and the next charge raises none.
    run(w, 1, { ...hold, dash: true, moveX: 1 });
    expect(w.player.chargeKey).toBe(-1);
    expect(w.player.chargeShield).toBe(0);
    run(w, 40, aim);
    run(w, 3);
    expect(w.player.chargeKey).toBe(0);
    expect(w.player.chargeShield).toBe(0);
    // Released and paid: gone with the shot, and owed to the next charge.
    run(w, 60);
    run(w, 1, aim);
    expect(w.player.chargeKey).toBe(-1);
    expect(w.player.chargeShield).toBe(0);
    run(w, 90, aim);
    run(w, 3);
    expect(w.player.chargeKey).toBe(0);
    expect(w.player.chargeShield).toBe(CHARGE_SHIELD_HEARTS);
  });
});
