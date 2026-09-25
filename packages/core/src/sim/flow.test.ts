import { describe, it, expect } from "vitest";
import { computeFlowField, distanceAt, followField, tileOf, UNREACHABLE } from "./flow.ts";
import { createWorld, step } from "./world.ts";
import { makeEnemy } from "./enemy.ts";
import { NO_INPUT } from "./types.ts";
import { GRID_W, GRID_H, TILE_PX, Tile } from "../types.ts";
import type { RoomPlan } from "../types.ts";
import { plainInstance } from "../spells/index.ts";
import { RngSource } from "../rng.ts";

/** An open room with one full-height wall, a gap at the bottom. */
function wallRoom(): RoomPlan {
  const grid = new Uint8Array(GRID_W * GRID_H).fill(Tile.Floor);
  for (let x = 0; x < GRID_W; x++) {
    grid[x] = Tile.Wall;
    grid[(GRID_H - 1) * GRID_W + x] = Tile.Wall;
  }
  for (let y = 0; y < GRID_H; y++) {
    grid[y * GRID_W] = Tile.Wall;
    grid[y * GRID_W + GRID_W - 1] = Tile.Wall;
  }
  // A divider at x = 10, open only at y = 11.
  for (let y = 1; y < 11; y++) grid[y * GRID_W + 10] = Tile.Wall;
  return {
    id: "w", room_type: "combat",
    params: { space: "open_arena", symmetry: "mirrored", size: "vast", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    measured: { open_ratio: 0.8, pillar_count: 0, symmetry_error: 0, reachable_ratio: 1 },
    grid, extent: { w: GRID_W, h: GRID_H }, doors: ["S"], entry: "S", zones: [], spawn_groups: [{ id: "far", cells: [[3, 3]] }],
    encounter: null, reward_kind: "item",
    source: { params: "rule", layout: "generated", encounter: "none" },
    seed_key: "w",
  };
}

const src = new RngSource("flow");

function world(room: RoomPlan) {
  return createWorld({
    room, encounter: null,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null, null, null, null],
    hearts: 6, rng: src.stream("w"),
  });
}

describe("flow field", () => {
  it("measures distance around a wall, not through it", () => {
    const room = wallRoom();
    // Target on the right of the divider, probe on the left at the same height.
    const field = computeFlowField(room.grid, 15 * TILE_PX, 3 * TILE_PX);
    const throughWall = distanceAt(field, 5 * TILE_PX, 3 * TILE_PX);
    expect(throughWall).toBeGreaterThan(10);
    // Straight-line distance is ten tiles; the path has to go down and back.
    expect(throughWall).toBeGreaterThan(Math.abs(15 - 5));
  });

  it("marks cells with no path as unreachable", () => {
    const grid = new Uint8Array(GRID_W * GRID_H).fill(Tile.Wall);
    grid[5 * GRID_W + 5] = Tile.Floor;
    const field = computeFlowField(grid, 5.5 * TILE_PX, 5.5 * TILE_PX);
    expect(distanceAt(field, 5.5 * TILE_PX, 5.5 * TILE_PX)).toBe(0);
    expect(distanceAt(field, 2.5 * TILE_PX, 2.5 * TILE_PX)).toBe(UNREACHABLE);
  });

  it("points downhill, and nowhere from the target tile", () => {
    const room = wallRoom();
    const field = computeFlowField(room.grid, 15 * TILE_PX, 3 * TILE_PX);
    const dir = followField(field, 5 * TILE_PX, 3 * TILE_PX);
    expect(dir).not.toBeNull();
    expect(Math.hypot(dir!.x, dir!.y)).toBeCloseTo(1, 6);
    expect(followField(field, 15.5 * TILE_PX, 3.5 * TILE_PX)).toBeNull();
  });

  it("is recomputed only when the player changes tile", () => {
    const w = world(wallRoom());
    step(w, NO_INPUT);
    const first = w.flow;
    step(w, NO_INPUT);
    expect(w.flow).toBe(first);
    w.player.x += TILE_PX * 2;
    step(w, NO_INPUT);
    expect(w.flow).not.toBe(first);
  });

  it("tileOf floors to the containing tile", () => {
    expect(tileOf(0, 0)).toEqual([0, 0]);
    expect(tileOf(TILE_PX * 2.9, TILE_PX * 1.1)).toEqual([2, 1]);
  });
});

describe("a chaser behind a wall", () => {
  it("routes around it instead of pressing into it", () => {
    const room = wallRoom();
    const w = world(room);
    w.player.x = 16 * TILE_PX;
    w.player.y = 3 * TILE_PX;
    const e = makeEnemy(1, "rusher", 4 * TILE_PX, 3 * TILE_PX, []);
    // Pathfinding is the subject here, so the enemy is woken directly rather
    // than walked into its own aggro range.
    e.awake = true;
    e.spawnFadeMs = 0;
    w.enemies.push(e);

    const startPath = distanceAt(computeFlowField(room.grid, w.player.x, w.player.y), e.x, e.y);
    for (let i = 0; i < 600; i++) step(w, NO_INPUT);
    const endPath = distanceAt(w.flow!, e.x, e.y);

    // Straight-line pursuit presses into the divider and the path distance
    // never falls. Any real progress means it is routing, whichever way
    // round the field sent it.
    expect(startPath).toBeGreaterThan(20);
    expect(endPath).toBeLessThan(startPath / 2);
  });

  it("reaches the player through the gap", () => {
    const room = wallRoom();
    const w = world(room);
    w.player.x = 16 * TILE_PX;
    w.player.y = 3 * TILE_PX;
    const e = makeEnemy(1, "rusher", 4 * TILE_PX, 3 * TILE_PX, []);
    // Pathfinding is the subject here, so the enemy is woken directly rather
    // than walked into its own aggro range.
    e.awake = true;
    e.spawnFadeMs = 0;
    w.enemies.push(e);

    let crossed = false;
    for (let i = 0; i < 2000 && !crossed; i++) {
      step(w, NO_INPUT);
      if (e.x > 11 * TILE_PX) crossed = true;
    }
    expect(crossed).toBe(true);
  });
});
