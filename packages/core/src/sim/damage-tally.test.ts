/**
 * **Damage dealt, by what dealt it** (`WorldStats.dealtBy`, doc 011): the
 * tally a playtest log reads to say which spell, which affix and which status
 * a room's damage came from.
 */
import { describe, expect, it } from "vitest";
import { createWorld, step } from "./world.ts";
import { NO_INPUT } from "./types.ts";
import type { Enemy, World } from "./types.ts";
import { makeEnemy } from "./enemy.ts";
import { attachAffix } from "./spells.ts";
import { generateRoom, toRoomPlan } from "../rooms/index.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";
import { GRID_W, GRID_H, Tile } from "../types.ts";

const src = new RngSource("damage-tally");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("room"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid, zones: [] };
const PX = 300, PY = 300;

function world(spell: string, affixes: readonly string[] = []): World {
  const w = createWorld({
    room, encounter: null, props: 0, staff: { slots: 6, mana_max: 200 },
    slots: [plainInstance(spell), null, null, null, null, null], hearts: 6, rng: src.stream(spell, affixes.join()),
  });
  w.player.x = PX; w.player.y = PY; w.player.facing = 0;
  for (const id of affixes) w.spells[0] = attachAffix(w.spells[0]!, id) ?? w.spells[0]!;
  return w;
}

function body(w: World, dx: number, dy: number): Enemy {
  const e = makeEnemy(w.nextEnemyId++, "rusher", PX + dx, PY + dy, []);
  e.spawnFadeMs = 0; e.awake = true; e.hp = 1e6; e.maxHp = 1e6; e.speed = 0; e.attackCooldownMs = 1e9;
  w.enemies.push(e);
  return e;
}

const aim = { ...NO_INPUT, aimX: PX + 200, aimY: PY };
function play(w: World, frames: number, input: (t: number) => typeof aim): void {
  for (let t = 0; t < frames; t++) {
    w.player.mana = w.staff.mana_max;
    step(w, input(t));
    w.player.hearts = 6;
  }
}

const taken = (bodies: readonly Enemy[]) => bodies.reduce((t, e) => t + (e.maxHp - e.hp), 0);
const tallied = (w: World) => Object.values(w.stats.dealtBy).reduce((t, v) => t + v, 0);

describe("damage dealt, by what dealt it", () => {
  it("names the sword's blows", () => {
    const w = world("magic_bolt");
    const e = body(w, 22, 0);
    play(w, 60, () => ({ ...aim, swing: true }));
    expect(w.stats.dealtBy["sword"]).toBeGreaterThan(0);
    expect(tallied(w)).toBeCloseTo(taken([e]), 0);
  });

  it("parts a spell's own hits from the copies its chain throws", () => {
    const w = world("magic_bolt", ["chain"]);
    const bodies = [body(w, 120, 0), body(w, 150, 30)];
    play(w, 120, (t) => (t % 30 === 0 ? { ...aim, spell: 0 } : aim));
    expect(w.stats.dealtBy["spell:magic_bolt"]).toBeGreaterThan(0);
    expect(w.stats.dealtBy["affix:chain"]).toBeGreaterThan(0);
    expect(tallied(w)).toBeCloseTo(taken(bodies), 0);
  });

  it("names a status's ticks apart from the hit that lit it", () => {
    const w = world("mortar", ["kindle"]);
    const e = body(w, 150, 0);
    play(w, 240, (t) => (t === 0 ? { ...aim, spell: 0 } : aim));
    expect(w.stats.dealtBy["spell:mortar"]).toBeGreaterThan(0);
    expect(w.stats.dealtBy["dot:burn"]).toBeGreaterThan(0);
    expect(tallied(w)).toBeCloseTo(taken([e]), 0);
  });

  it("counts each cast and what it paid, by spell", () => {
    const w = world("magic_bolt");
    body(w, 120, 0);
    play(w, 90, (t) => (t % 30 === 0 ? { ...aim, spell: 0 } : aim));
    expect(w.stats.castsBy["magic_bolt"]).toBe(3);
    expect(w.stats.manaBy["magic_bolt"]).toBeGreaterThan(0);
  });
});
