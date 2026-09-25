/**
 * **The two rooms that are the same every run**: the merchant's hall and the
 * Crypt King's throne hall (doc 004, doc 020).
 *
 * Both were generated like any room, from a fixed archetype and the run's own
 * seed, so their pillars moved between runs — and a boss fight whose walls,
 * cover and lines change every time is one the player cannot learn: where
 * the dashcut stuns itself, which pillar stops a sword wave, how much room a
 * leap has. The bench also fought in a different room from the game. These
 * are drawn by hand, at their own size, and every run and the bench meet the
 * same two rooms. Neither has hazards, features or anything that breaks.
 */
import { GRID_H, GRID_W, Tile } from "../types.ts";
import type { DoorSide, Extent, Mood, RoomPlan } from "../types.ts";
import { BOSS_ARCHETYPES } from "./archetypes.ts";
import { entryCell, maskFor } from "./masks.ts";
import { measureRoom } from "./measure.ts";

const CODES: Readonly<Record<string, Tile>> = {
  ".": Tile.Floor,
  "#": Tile.Wall,
  O: Tile.Pillar,
  // The throne's dais: solid, and drawn as the throne rather than as a column.
  T: Tile.Pillar,
  "+": Tile.Door,
  // Floor in the grid; each stands a destructible there (`RoomPlan.standing`).
  C: Tile.Floor,
  i: Tile.Floor,
};
const STANDING: Readonly<Record<string, "column" | "candelabrum">> = { C: "column", i: "candelabrum" };

/**
 * The throne hall, 23 × 13: the viewport's own shape (16:9), so the fixed
 * view that shows it whole is filled by it — one cell of wall round the edge
 * and nothing past it — at a little further out than the rest of the run's.
 * The king's throne on its dais a row out from the north wall, against a
 * block of it (so the whole of him seated is inside the view), a candelabrum
 * either side of it, and four columns (`C`) — each a single cell,
 * so the floor between them stays open, and each breakable: cover from a
 * sword wave or a volley, a wall for the dashcut to stun itself on, worn away
 * by the player's sword and the king's until the hall is bare. One door, the
 * one the player came in by: this is the end of the run.
 */
const THRONE_HALL: readonly string[] = [
  "#######################",
  "#.........###.........#",
  "#.........TTT.........#",
  "#.......i.....i.......#",
  "#...C.............C...#",
  "#.....................#",
  "#.....................#",
  "#.....................#",
  "#.....................#",
  "#.....................#",
  "#...C.............C...#",
  "#.....................#",
  "###########+###########",
];

/** The throne's dais cells, for the renderer to draw the throne over. */
export const THRONE_CELLS: readonly (readonly [number, number])[] = [[10, 2], [11, 2], [12, 2]];

/**
 * The merchant's hall: four columns at the corners of the floor, the stalls
 * (the merchant, the smith, the fountain) in the open middle where the vendor
 * placement puts them, and the four doors the room's portals stand in.
 */
const MERCHANT_HALL: readonly string[] = [
  "############+############",
  "#.......................#",
  "#.......................#",
  "#..OO...............OO..#",
  "#..OO...............OO..#",
  "#.......................#",
  "+.......................+",
  "#.......................#",
  "#.......................#",
  "#..OO...............OO..#",
  "#..OO...............OO..#",
  "#.......................#",
  "############+############",
];

function parse(rows: readonly string[]): {
  grid: Uint8Array; ext: Extent; standing: { kind: "column" | "candelabrum"; gx: number; gy: number }[];
} {
  const ext = { w: rows[0]!.length, h: rows.length };
  if (ext.w > GRID_W || ext.h > GRID_H) throw new Error(`fixed room ${ext.w}x${ext.h} is larger than the grid`);
  const grid = new Uint8Array(GRID_W * GRID_H).fill(Tile.Wall);
  const standing: { kind: "column" | "candelabrum"; gx: number; gy: number }[] = [];
  rows.forEach((row, y) => {
    if (row.length !== ext.w) throw new Error(`fixed room row ${y} is ${row.length} wide, not ${ext.w}`);
    for (let x = 0; x < ext.w; x++) {
      const tile = CODES[row[x]!];
      if (tile === undefined) throw new Error(`fixed room row ${y} has an unknown glyph ${row[x]}`);
      grid[y * GRID_W + x] = tile;
      const kind = STANDING[row[x]!];
      if (kind) standing.push({ kind, gx: x, gy: y });
    }
  });
  return { grid, ext, standing };
}

function plan(
  id: string, rows: readonly string[], room: "boss" | "shop", doors: readonly DoorSide[], mood: Mood,
): RoomPlan {
  const { grid, ext, standing } = parse(rows);
  const entry: DoorSide = "S";
  const m = measureRoom(grid, maskFor("arena", ext), entryCell(entry, ext), ext);
  return {
    id,
    room_type: room,
    params: {
      space: room === "boss" ? BOSS_ARCHETYPES[0]!.id : "open_arena",
      symmetry: "mirrored",
      size: room === "boss" ? "standard" : "compact",
      mood,
    },
    measured: {
      open_ratio: m.open_ratio, pillar_count: m.pillar_count,
      symmetry_error: m.symmetry_error, reachable_ratio: m.reachable_ratio,
    },
    grid,
    extent: ext,
    doors,
    entry,
    zones: [],
    spawn_groups: [],
    standing,
    encounter: null,
    reward_kind: "item",
    source: { params: "rule", layout: "authored", encounter: "none" },
    seed_key: id,
  };
}

const HALL_MOOD: Mood = { temperature: "cold", brightness: "dim", particle_intensity: "calm" };

/** The Crypt King's throne hall, the same in every run and on the bench. */
export function throneHall(mood: Mood = HALL_MOOD): RoomPlan {
  return plan("fixed-boss", THRONE_HALL, "boss", ["S"], mood);
}

/** The merchant's hall, the same in every run. */
export function merchantHall(mood: Mood = HALL_MOOD): RoomPlan {
  return plan("fixed-shop", MERCHANT_HALL, "shop", ["N", "E", "S", "W"], mood);
}
