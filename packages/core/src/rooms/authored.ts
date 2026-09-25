/**
 * The three authored fallback rooms (doc 004, "Authored fallback rooms").
 *
 * These are the only hand-made layouts in the game. They are fixed grids, not
 * generated, and the generator falls back to one of them when five seeds and a
 * relaxed parameter have all failed; the room plan then records
 * `source.layout: "authored"`.
 *
 * Each one reuses an archetype's declared zone slots and spawn groups, so
 * round 2 can still fill their zones and the encounter can still pick a spawn
 * group. They are checked - for every supported door as the entry - by the
 * same `validateRoom` the generator uses.
 *
 * They are drawn on the base grid, 21 x 13, and stretched to a room's extent
 * by `authoredGrid`: every base cell becomes the block it maps to, and the
 * doors are stamped at the extent's own midpoints.
 */
import { GRID_H, GRID_W, Tile } from "../types.ts";
import type { Extent, Shape, SpaceArchetype } from "../types.ts";
import { archetype } from "./archetypes.ts";
import { applyDoors, idx } from "./masks.ts";
import { BASE_EXTENT, baseCellOf } from "./extent.ts";

export interface AuthoredRoom {
  readonly id: string;
  /** Whose door set, zone slots and spawn groups this layout carries. */
  readonly archetype: SpaceArchetype;
  readonly grid: Uint8Array;
}

const CODES: Readonly<Record<string, Tile>> = {
  ".": Tile.Floor,
  "#": Tile.Wall,
  O: Tile.Pillar,
  "+": Tile.Door,
};

function parse(rows: readonly string[]): Uint8Array {
  const { w, h } = BASE_EXTENT;
  if (rows.length !== h) throw new Error(`authored room needs ${h} rows, got ${rows.length}`);
  const grid = new Uint8Array(GRID_W * GRID_H).fill(Tile.Wall);
  for (let y = 0; y < h; y++) {
    const row = rows[y]!;
    if (row.length !== w) throw new Error(`authored row ${y} needs ${w} columns`);
    for (let x = 0; x < w; x++) {
      const tile = CODES[row[x]!];
      if (tile === undefined) throw new Error(`authored row ${y} has an unknown glyph ${row[x]}`);
      grid[idx(x, y)] = tile;
    }
  }
  return grid;
}

/** Open arena, four doors, four corner pillars well clear of every doorway. */
const FALLBACK_ARENA_ART: readonly string[] = [
  "##########+##########",
  "#...................#",
  "#...................#",
  "#...................#",
  "#...O...........O...#",
  "#...................#",
  "+...................+",
  "#...................#",
  "#...O...........O...#",
  "#...................#",
  "#...................#",
  "#...................#",
  "##########+##########",
];

/** Long hall entered from either end, with the four alcoves kept open. */
const FALLBACK_CORRIDOR_ART: readonly string[] = [
  "#####################",
  "####...#######...####",
  "####...#######...####",
  "#.......O...O.......#",
  "#...................#",
  "#...................#",
  "+...................+",
  "#...................#",
  "#...................#",
  "#.......O...O.......#",
  "####...#######...####",
  "####...#######...####",
  "#####################",
];

/** Four arms meeting at a wide junction, with three pillars in the long arm. */
const FALLBACK_CROSS_ART: readonly string[] = [
  "##########+##########",
  "######.........######",
  "######.........######",
  "######.........######",
  "#...O...............#",
  "#...................#",
  "+...................+",
  "#...................#",
  "#...O...........O...#",
  "######.........######",
  "######.........######",
  "######.........######",
  "##########+##########",
];

export const FALLBACK_ARENA: AuthoredRoom = {
  id: "fallback_arena",
  archetype: archetype("open_arena"),
  grid: parse(FALLBACK_ARENA_ART),
};

export const FALLBACK_CORRIDOR: AuthoredRoom = {
  id: "fallback_corridor",
  archetype: archetype("long_corridor"),
  grid: parse(FALLBACK_CORRIDOR_ART),
};

export const FALLBACK_CROSS: AuthoredRoom = {
  id: "fallback_cross",
  archetype: archetype("cross_open"),
  grid: parse(FALLBACK_CROSS_ART),
};

export const AUTHORED_ROOMS: readonly AuthoredRoom[] = [
  FALLBACK_ARENA, FALLBACK_CORRIDOR, FALLBACK_CROSS,
];

/** An authored room's grid at an extent: each base cell stretched to its block, the doors at the extent's. */
export function authoredGrid(room: AuthoredRoom, ext: Extent): Uint8Array {
  const grid = new Uint8Array(GRID_W * GRID_H).fill(Tile.Wall);
  for (let y = 0; y < ext.h; y++)
    for (let x = 0; x < ext.w; x++) {
      const [bx, by] = baseCellOf(x, y, ext);
      const t = room.grid[idx(bx, by)]!;
      grid[idx(x, y)] = t === Tile.Door ? Tile.Wall : t;
    }
  applyDoors(grid, room.archetype.doors, ext);
  return grid;
}

/**
 * The fallback for a shape. A `ring` has no authored twin, and its E/W doors
 * are a subset of the arena's, so it falls back to `fallback_arena`; so does
 * the boss arena (doc 004, "Boss arena").
 */
export function authoredFor(shape: Shape): AuthoredRoom {
  switch (shape) {
    case "corridor": return FALLBACK_CORRIDOR;
    case "cross": return FALLBACK_CROSS;
    case "arena":
    case "ring": return FALLBACK_ARENA;
  }
}
