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
 */
import { GRID_H, GRID_W, Tile } from "../types.ts";
import type { Shape, SpaceArchetype } from "../types.ts";
import { archetype } from "./archetypes.ts";
import { idx } from "./masks.ts";

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
  if (rows.length !== GRID_H) throw new Error(`authored room needs ${GRID_H} rows, got ${rows.length}`);
  const grid = new Uint8Array(GRID_W * GRID_H);
  for (let y = 0; y < GRID_H; y++) {
    const row = rows[y]!;
    if (row.length !== GRID_W) throw new Error(`authored row ${y} needs ${GRID_W} columns`);
    for (let x = 0; x < GRID_W; x++) {
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
